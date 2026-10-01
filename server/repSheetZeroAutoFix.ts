import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getUTFConnection } from './db/connection.js';
import { readHospitalSchema } from './hospitalSchema.js';
import { getNextHospitalSerial } from './hospitalDatabase.js';
import { evaluateHerbalMedicationMatch } from '../src/utils/herbalMedicationRules.js';

export interface RepSheetZeroFixOpportunity {
  fixType: 'LINK_AUTHEN' | 'REMOVE_NUMERIC_DX' | 'ADD_DENTAL_EXAM' | 'SET_PRIMARY_DX' | 'ADD_HERBAL_DIAG';
  title: string;
  detail: string;
  autoFixable: boolean;
}

export interface RepSheetZeroFixDetectionResult {
  vn: string;
  an?: string;
  hn: string;
  opportunities: RepSheetZeroFixOpportunity[];
  canAutoFix: boolean;
}

export interface RepSheetZeroFixExecutionResult {
  vn: string;
  an?: string;
  hn: string;
  success: boolean;
  actionsApplied: string[];
  message: string;
}

/**
 * ตรวจสอบโอกาสในการแก้ไขข้อมูลอัตโนมัติ (Auto-Fix) สำหรับ Visit ใน REP Data Sheet 0
 */
export async function detectRepSheetZeroFix(params: {
  vn: string;
  an?: string;
  hn?: string;
  errorcode?: string;
  verifycode?: string;
  reason?: string;
}): Promise<RepSheetZeroFixDetectionResult> {
  const { vn, an } = params;
  if (!vn && !an) {
    return { vn: '', an: '', hn: params.hn || '', opportunities: [], canAutoFix: false };
  }

  const connection = await getUTFConnection();
  try {
    const has = await readHospitalSchema(connection, [
      'ovst', 'ovstdiag', 'vn_stat', 'authenhos', 'nhso_authen', 'dtmain', 'visit_pttype', 'opitemrece', 'drugitems'
    ]);

    const opportunities: RepSheetZeroFixOpportunity[] = [];

    // 1. ตรวจสอบการผูก Claim Code / Authen Code
    if (vn && (has('ovst', 'vn', 'claim_code') || has('visit_pttype', 'vn', 'auth_code')) && has('authenhos', 'claim_code')) {
      let currentClaimCode = '';
      let currentVstdate = '';
      let currentCid = '';

      if (has('ovst', 'vn')) {
        const [ovstRows] = await connection.query<RowDataPacket[]>(
          `SELECT o.hn, o.vstdate, pt.cid ${has('ovst', 'claim_code') ? ', o.claim_code' : ''}
           FROM ovst o 
           LEFT JOIN patient pt ON o.hn = pt.hn
           WHERE o.vn = ? LIMIT 1`,
          [vn]
        );
        const ovst = ovstRows[0];
        currentVstdate = String(ovst?.vstdate || '');
        currentCid = String(ovst?.cid || '');
        if (has('ovst', 'claim_code')) {
          currentClaimCode = String(ovst?.claim_code || '').trim();
        }
      }

      if (!currentClaimCode && has('visit_pttype', 'vn', 'auth_code')) {
        const [vpRows] = await connection.query<RowDataPacket[]>(
          `SELECT auth_code FROM visit_pttype WHERE vn = ? AND TRIM(IFNULL(auth_code, '')) <> '' LIMIT 1`,
          [vn]
        );
        currentClaimCode = String(vpRows[0]?.auth_code || '').trim();
      }

      if (!currentClaimCode) {
        // ค้นหา Claim Code ใน authenhos โดย vn หรือ pid(cid) + created_date
        const [authRows] = await connection.query<RowDataPacket[]>(
          `SELECT claim_code FROM authenhos 
           WHERE (vn = ? OR (? <> '' AND pid = ? AND created_date = ?)) 
             AND TRIM(IFNULL(claim_code, '')) <> ''
           ORDER BY created_date DESC, created_time DESC LIMIT 1`,
          [vn, currentCid, currentCid, currentVstdate]
        );
        const candidate = authRows[0]?.claim_code;
        if (candidate) {
          opportunities.push({
            fixType: 'LINK_AUTHEN',
            title: 'ผูกรหัส Claim / Authen Code',
            detail: `พบรหัส ${candidate} ในประวัติ Authen พร้อมผูกเข้า Visit อัตโนมัติ`,
            autoFixable: true,
          });
        }
      }
    }

    // 2. ตรวจสอบรหัสหัตถการตัวเลขตกค้างในตารางวินิจฉัย (ovstdiag)
    if (vn && has('ovstdiag', 'vn', 'icd10')) {
      const [numRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM ovstdiag WHERE vn = ? AND icd10 REGEXP '^[0-9]'`,
        [vn]
      );
      const numCount = Number(numRows[0]?.cnt || 0);
      if (numCount > 0) {
        opportunities.push({
          fixType: 'REMOVE_NUMERIC_DX',
          title: 'ลบรหัสหัตถการตัวเลขตกค้างในตารางโรค',
          detail: `พบรหัสตัวเลข ${numCount} รายการใน ovstdiag ซึ่งอาจทำให้ติด C/Deny`,
          autoFixable: true,
        });
      }
    }

    // 3. ตรวจสอบกรณีทันตกรรมขาด dtmain
    if (vn && has('dtmain', 'vn') && has('ovstdiag', 'vn', 'icd10')) {
      const [dtRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM dtmain WHERE vn = ?`,
        [vn]
      );
      const hasDt = Number(dtRows[0]?.cnt || 0) > 0;
      if (!hasDt) {
        const [diagDental] = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt FROM ovstdiag WHERE vn = ? AND (icd10 LIKE 'K0%' OR icd10 LIKE 'Z012%')`,
          [vn]
        );
        const isDental = Number(diagDental[0]?.cnt || 0) > 0;
        if (isDental) {
          opportunities.push({
            fixType: 'ADD_DENTAL_EXAM',
            title: 'สร้างบันทึกทันตกรรม (dtmain)',
            detail: 'มีรหัสโรคฟันแต่ยังไม่มีข้อมูล dtmain พร้อมสร้างให้อัตโนมัติ',
            autoFixable: true,
          });
        }
      }
    }

    // 4. ตรวจสอบกรณีขาดรหัสโรคหลัก (Primary Diagnosis / PDX)
    if (vn && has('ovstdiag', 'vn', 'diagtype')) {
      const [pdxRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM ovstdiag WHERE vn = ? AND diagtype = '1'`,
        [vn]
      );
      const pdxCount = Number(pdxRows[0]?.cnt || 0);
      if (pdxCount === 0) {
        const [anyDx] = await connection.query<RowDataPacket[]>(
          `SELECT ovst_diag_id, icd10 FROM ovstdiag WHERE vn = ? ORDER BY ovst_diag_id ASC LIMIT 1`,
          [vn]
        );
        if (anyDx.length > 0) {
          opportunities.push({
            fixType: 'SET_PRIMARY_DX',
            title: 'กำหนดรหัสโรคหลัก (PDX)',
            detail: `ยังไม่มีรหัสโรคหลัก (diagtype=1) สามารถตั้งค่ารหัส ${anyDx[0].icd10} เป็นโรคหลักได้`,
            autoFixable: true,
          });
        }
      }
    }

    // 5. ตรวจสอบยาสมุนไพรขาดรหัสวินิจฉัย (ADD_HERBAL_DIAG)
    if (vn && has('opitemrece', 'vn', 'icode') && has('drugitems', 'icode', 'name')) {
      const [herbRows] = await connection.query<RowDataPacket[]>(
        `SELECT DISTINCT di.name
         FROM opitemrece oo
         JOIN drugitems di ON di.icode = oo.icode
         WHERE oo.vn = ?
           AND COALESCE(oo.qty, 0) > 0
           ${has('drugitems', 'ttmt_code') ? 'AND di.ttmt_code IS NOT NULL' : ''}
           ${has('drugitems', 'sks_product_category_id') ? 'AND di.sks_product_category_id IN (3, 4)' : ''}`,
        [vn]
      );
      if (Array.isArray(herbRows) && herbRows.length > 0) {
        const herbNames = herbRows.map((r) => String(r.name || '')).filter(Boolean);
        const [dxRows] = await connection.query<RowDataPacket[]>(
          `SELECT icd10 FROM ovstdiag WHERE vn = ?`,
          [vn]
        );
        const currentDiags = (Array.isArray(dxRows) ? dxRows : []).map((r) => String(r.icd10 || ''));
        const assessment = evaluateHerbalMedicationMatch(currentDiags, herbNames.join(', '));
        if (assessment.status !== 'valid' && assessment.medicineRecommendations.length > 0) {
          const recCodes: string[] = [];
          for (const rec of assessment.medicineRecommendations) {
            for (const ind of rec.indications) {
              for (const c of ind.diagnosisCodes) {
                if (c && c !== 'U57' && !recCodes.includes(c)) recCodes.push(c);
              }
            }
          }
          if (recCodes.length > 0) {
            opportunities.push({
              fixType: 'ADD_HERBAL_DIAG',
              title: 'เพิ่มรหัสวินิจฉัยยาสมุนไพร',
              detail: `สั่งยาสมุนไพร (${herbNames.join(', ')}) แต่ขาดรหัสโรคตามข้อบ่งใช้ พร้อมเติมรหัส ${recCodes[0]} อัตโนมัติ`,
              autoFixable: true,
            });
          }
        }
      }
    }

    return {
      vn,
      an,
      hn: params.hn || '',
      opportunities,
      canAutoFix: opportunities.length > 0,
    };
  } finally {
    connection.release();
  }
}

/**
 * ทำการแก้ไขข้อมูลอัตโนมัติ (Apply Auto-Fix) ให้กับ Visit ใน REP Data Sheet 0
 */
export async function applyRepSheetZeroFix(params: {
  vn: string;
  an?: string;
  fixType?: 'ALL' | 'LINK_AUTHEN' | 'REMOVE_NUMERIC_DX' | 'ADD_DENTAL_EXAM' | 'SET_PRIMARY_DX' | 'ADD_HERBAL_DIAG';
  actorName?: string;
}): Promise<RepSheetZeroFixExecutionResult> {
  const { vn, an, fixType = 'ALL', actorName = 'admin' } = params;
  if (!vn && !an) {
    return { vn: '', an: '', hn: '', success: false, actionsApplied: [], message: 'ไม่ระบุ VN หรือ AN' };
  }

  const connection = await getUTFConnection();
  try {
    const has = await readHospitalSchema(connection, [
      'ovst', 'ovstdiag', 'vn_stat', 'authenhos', 'dtmain', 'visit_pttype', 'opitemrece', 'drugitems'
    ]);

    const actionsApplied: string[] = [];

    // ดึง HN, vstdate, vsttime, doctor และ CID
    let currentHn = '';
    let currentVstdate = '';
    let currentVsttime = '09:00:00';
    let currentDoctor = '900';
    let currentCid = '';
    if (vn && has('ovst', 'vn')) {
      const [ovstRows] = await connection.query<RowDataPacket[]>(
        `SELECT o.hn, o.vstdate, o.vsttime, o.doctor, pt.cid 
         FROM ovst o 
         LEFT JOIN patient pt ON o.hn = pt.hn 
         WHERE o.vn = ? LIMIT 1`,
        [vn]
      );
      currentHn = String(ovstRows[0]?.hn || '');
      currentVstdate = String(ovstRows[0]?.vstdate || '');
      currentVsttime = String(ovstRows[0]?.vsttime || '09:00:00');
      currentDoctor = String(ovstRows[0]?.doctor || '900');
      currentCid = String(ovstRows[0]?.cid || '');
    }

    await connection.beginTransaction();

    // 1. LINK_AUTHEN
    if ((fixType === 'ALL' || fixType === 'LINK_AUTHEN') && vn && (has('ovst', 'vn', 'claim_code') || has('visit_pttype', 'vn', 'auth_code')) && has('authenhos', 'claim_code')) {
      const [authRows] = await connection.query<RowDataPacket[]>(
        `SELECT claim_code FROM authenhos 
         WHERE (vn = ? OR (? <> '' AND pid = ? AND created_date = ?)) 
           AND TRIM(IFNULL(claim_code, '')) <> ''
         ORDER BY created_date DESC, created_time DESC LIMIT 1`,
        [vn, currentCid, currentCid, currentVstdate]
      );
      const candidate = authRows[0]?.claim_code;
      if (candidate) {
        if (has('ovst', 'vn', 'claim_code')) {
          await connection.query(
            `UPDATE ovst SET claim_code = ? WHERE vn = ? AND (claim_code IS NULL OR TRIM(claim_code) = '')`,
            [candidate, vn]
          );
        }
        if (has('visit_pttype', 'vn', 'auth_code')) {
          await connection.query(
            `UPDATE visit_pttype SET auth_code = ? WHERE vn = ? AND (auth_code IS NULL OR TRIM(auth_code) = '')`,
            [candidate, vn]
          );
        }
        actionsApplied.push(`ผูกรหัส Claim/Authen Code (${candidate}) เข้าสู่ Visit ใน ovst/visit_pttype เรียบร้อย`);
      }
    }

    // 2. REMOVE_NUMERIC_DX
    if ((fixType === 'ALL' || fixType === 'REMOVE_NUMERIC_DX') && vn && has('ovstdiag', 'vn', 'icd10')) {
      const [delRes] = await connection.query(
        `DELETE FROM ovstdiag WHERE vn = ? AND icd10 REGEXP '^[0-9]'`,
        [vn]
      );
      const delCount = Number((delRes as { affectedRows?: number })?.affectedRows || 0);
      if (delCount > 0) {
        actionsApplied.push(`ลบรหัสหัตถการตัวเลขตกค้างออกจาก ovstdiag (${delCount} รายการ) เรียบร้อย`);
      }
    }

    // 3. SET_PRIMARY_DX
    if ((fixType === 'ALL' || fixType === 'SET_PRIMARY_DX') && vn && has('ovstdiag', 'vn', 'diagtype')) {
      const [pdxRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM ovstdiag WHERE vn = ? AND diagtype = '1'`,
        [vn]
      );
      if (Number(pdxRows[0]?.cnt || 0) === 0) {
        const [anyDx] = await connection.query<RowDataPacket[]>(
          `SELECT ovst_diag_id, icd10 FROM ovstdiag WHERE vn = ? ORDER BY ovst_diag_id ASC LIMIT 1`,
          [vn]
        );
        if (anyDx.length > 0) {
          const firstId = anyDx[0].ovst_diag_id;
          const firstIcd = anyDx[0].icd10;
          await connection.query(
            `UPDATE ovstdiag SET diagtype = '1' WHERE ovst_diag_id = ?`,
            [firstId]
          );
          if (has('vn_stat', 'vn', 'pdx')) {
            await connection.query(
              `UPDATE vn_stat SET pdx = ? WHERE vn = ? AND (pdx IS NULL OR TRIM(pdx) = '')`,
              [firstIcd, vn]
            );
          }
          actionsApplied.push(`กำหนดรหัส ${firstIcd} เป็นโรคหลัก (diagtype=1) ใน ovstdiag และ vn_stat เรียบร้อย`);
        }
      }
    }

    // 4. ADD_DENTAL_EXAM
    if ((fixType === 'ALL' || fixType === 'ADD_DENTAL_EXAM') && vn && has('dtmain', 'vn')) {
      const [diagDental] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM ovstdiag WHERE vn = ? AND (icd10 LIKE 'K0%' OR icd10 LIKE 'Z012%')`,
        [vn]
      );
      const isDental = Number(diagDental[0]?.cnt || 0) > 0;
      if (isDental) {
        const [existingDm] = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt FROM dtmain WHERE vn = ?`,
          [vn]
        );
        const dmCount = Number(existingDm[0]?.cnt || 0);
        if (dmCount === 0) {
          const [maxTmRows] = await connection.query<RowDataPacket[]>(
            `SELECT COALESCE(MAX(tm_no), 0) AS max_no FROM dtmain WHERE vn = ?`,
            [vn]
          );
          const nextTmNo = Number(maxTmRows[0]?.max_no || 0) + 1;
          const nextDtmainId = await getNextHospitalSerial(connection, 'dtmain_id', 'dtmain', 'dtmain_id');

          const [dttmMatches] = await connection.query<RowDataPacket[]>(
            `SELECT code, icd9cm, icd10tm_operation_code FROM dttm WHERE code = '3002' LIMIT 1`
          );
          const dttmRow = dttmMatches[0];
          const tmcode = dttmRow ? String(dttmRow.code) : '3002';
          const icd9 = dttmRow ? String(dttmRow.icd10tm_operation_code || dttmRow.icd9cm || '2330010') : '2330010';

          const [pdxRows] = await connection.query<RowDataPacket[]>(
            `SELECT icd10 FROM ovstdiag WHERE vn = ? AND diagtype = '1' LIMIT 1`,
            [vn]
          );
          const primaryIcd = pdxRows[0]?.icd10 || 'Z012';

          await connection.query(
            `INSERT INTO dtmain (
              dtmain_id, vn, hn, vstdate, vsttime, doctor, tmcode, icd9, icd, tm_no, fee, scount, tcount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
            [
              nextDtmainId,
              vn,
              currentHn,
              currentVstdate,
              '09:00:00',
              '900',
              tmcode,
              icd9,
              primaryIcd,
              nextTmNo,
            ]
          );
          actionsApplied.push(`บันทึกหัตถการตรวจสุขภาพช่องปาก (Oral examination: รหัส ${tmcode} / ${icd9}) ลงใน dtmain เรียบร้อย`);
        }
      }
    }

    // 5. ADD_HERBAL_DIAG
    if ((fixType === 'ALL' || fixType === 'ADD_HERBAL_DIAG') && vn && has('opitemrece', 'vn', 'icode') && has('drugitems', 'icode', 'name')) {
      const [herbRows] = await connection.query<RowDataPacket[]>(
        `SELECT DISTINCT di.name
         FROM opitemrece oo
         JOIN drugitems di ON di.icode = oo.icode
         WHERE oo.vn = ?
           AND COALESCE(oo.qty, 0) > 0
           ${has('drugitems', 'ttmt_code') ? 'AND di.ttmt_code IS NOT NULL' : ''}
           ${has('drugitems', 'sks_product_category_id') ? 'AND di.sks_product_category_id IN (3, 4)' : ''}`,
        [vn]
      );
      if (Array.isArray(herbRows) && herbRows.length > 0) {
        const herbNames = herbRows.map((r) => String(r.name || '')).filter(Boolean);
        const [dxRows] = await connection.query<RowDataPacket[]>(
          `SELECT icd10 FROM ovstdiag WHERE vn = ?`,
          [vn]
        );
        const currentDiags = (Array.isArray(dxRows) ? dxRows : []).map((r) => String(r.icd10 || ''));
        const assessment = evaluateHerbalMedicationMatch(currentDiags, herbNames.join(', '));
        if (assessment.status !== 'valid' && assessment.medicineRecommendations.length > 0) {
          const codesToAdd = new Set<string>();
          for (const rec of assessment.medicineRecommendations) {
            for (const ind of rec.indications) {
              const specific = ind.diagnosisCodes.find((c) => c && c !== 'U57' && !currentDiags.some((cd) => cd.replace(/[^A-Z0-9]/g, '').startsWith(c)));
              if (specific) {
                codesToAdd.add(specific);
                break;
              }
            }
          }

          for (const code of codesToAdd) {
            const nextDiagId = await getNextHospitalSerial(connection, 'ovst_diag_id', 'ovstdiag', 'ovst_diag_id');
            await connection.query(
              `INSERT INTO ovstdiag (
                ovst_diag_id, vn, hn, vstdate, vsttime, icd10, diagtype, doctor, staff, episode
              ) VALUES (?, ?, ?, ?, ?, ?, '2', ?, ?, 1)`,
              [
                nextDiagId,
                vn,
                currentHn,
                currentVstdate,
                currentVsttime,
                code,
                currentDoctor,
                actorName || 'admin',
              ]
            );
            actionsApplied.push(`เพิ่มรหัสวินิจฉัยยาสมุนไพร (${code}) ใน ovstdiag เรียบร้อย`);
          }
        }
      }
    }

    await connection.commit();

    return {
      vn,
      an,
      hn: currentHn,
      success: actionsApplied.length > 0,
      actionsApplied,
      message: actionsApplied.length > 0
        ? `แก้ไขอัตโนมัติสำเร็จ (${actionsApplied.length} การดำเนินการ)`
        : 'ตรวจไม่พบรายการที่เข้าเงื่อนไขแก้ไขอัตโนมัติในฐานข้อมูล',
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    return {
      vn,
      an,
      hn: '',
      success: false,
      actionsApplied: [],
      message: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการแก้ไขอัตโนมัติ',
    };
  } finally {
    connection.release();
  }
}

/**
 * แก้ไขอัตโนมัติแบบกลุ่ม (Batch Auto-Fix)
 */
export async function batchApplyRepSheetZeroFix(params: {
  items: Array<{ vn: string; an?: string }>;
  actorName?: string;
}): Promise<{
  total: number;
  fixedCount: number;
  results: RepSheetZeroFixExecutionResult[];
}> {
  const items = params.items || [];
  const results: RepSheetZeroFixExecutionResult[] = [];
  let fixedCount = 0;

  for (const item of items) {
    if (!item.vn && !item.an) continue;
    const res = await applyRepSheetZeroFix({
      vn: item.vn,
      an: item.an,
      fixType: 'ALL',
      actorName: params.actorName,
    });
    results.push(res);
    if (res.success) {
      fixedCount++;
    }
  }

  return {
    total: items.length,
    fixedCount,
    results,
  };
}
