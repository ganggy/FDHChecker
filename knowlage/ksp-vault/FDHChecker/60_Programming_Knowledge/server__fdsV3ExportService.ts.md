---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/fdsV3ExportService.ts"
source_hash: "a6671874d03fd7931a5b29df9ad4469dbb250f95befffb0522efc4d36bc69b8b"
managed_by: "sync-ksp-vault"
---
# fdsV3ExportService.ts

> Source: `server/fdsV3ExportService.ts`
> SHA-256: `a6671874d03fd7931a5b29df9ad4469dbb250f95befffb0522efc4d36bc69b8b`

````typescript
import crypto from 'node:crypto';
import type { FdhExportData, FdhRow } from './fdhExport.js';
import type {
  FdsV3Payload,
  FdsV3Visit,
  FdsV3ValidationResult,
  FdsV3ValidationIssue,
  FdsV3Patient,
  FdsV3Encounter,
  FdsV3EncounterOpd,
  FdsV3EncounterIpd,
  FdsV3LeaveDay,
  FdsV3DiagnosisIcd10,
  FdsV3Procedure,
  FdsV3Benefits,
  FdsV3Cha,
  FdsV3ChaItem,
  FdsV3Pren,
} from './models/fdsV3Types.js';

export const FDS_V3_VERSION = '3.0.0.59';

/**
 * Generate 27-character transaction ID:
 * Format: hcode(5)-YYYYMMDDHHMMSS(14)-NNNNNN(6)
 */
export const generateFdsV3TransactionId = (hcode: string, sequence = 1): string => {
  const safeHcode = (hcode || '00000').padStart(5, '0').slice(0, 5);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;
  const seqStr = String(sequence).padStart(6, '0').slice(-6);
  return `${safeHcode}-${timestamp}-${seqStr}`;
};

/**
 * Clean string or return fallback
 */
const str = (val: unknown, fallback = ''): string => {
  if (val == null) return fallback;
  return String(val).trim();
};

const num = (val: unknown, fallback = 0): number => {
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Map ISO datetime string from date + time
 */
const formatFdsDateTime = (dateVal: unknown, timeVal?: unknown): string => {
  const d = str(dateVal).replace(/[^0-9-]/g, '');
  if (!d) return new Date().toISOString().slice(0, 19);

  let datePart = d;
  // If YYYYMMDD
  if (d.length === 8 && !d.includes('-')) {
    datePart = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }

  let timePart = '00:00:00';
  const t = str(timeVal).replace(/[^0-9:]/g, '');
  if (t) {
    if (t.includes(':')) {
      const parts = t.split(':');
      timePart = `${parts[0].padStart(2, '0')}:${(parts[1] || '00').padStart(2, '0')}:${(parts[2] || '00').padStart(2, '0')}`;
    } else if (t.length >= 4) {
      timePart = `${t.slice(0, 2)}:${t.slice(2, 4)}:00`;
    }
  }

  return `${datePart}T${timePart}`;
};

/**
 * Convert 16-files export records into unified FDS v3 JSON Payload
 */
export const buildFdsV3PayloadFrom16Files = (
  rawData: FdhExportData,
  config: Record<string, unknown>,
  hospitalName = 'โรงพยาบาลทั่วไป',
): FdsV3Payload => {
  const hcode = str(config.hcode, '10665');
  const hisSecret = str(config.hisSecret, '');
  const hisSourceKey = str(config.hisSourceKey, '');
  const hisName = str(config.hisName, 'HOSxP');
  const hisVersion = str(config.hisVersion, '4.5.2');
  const generatedDateTime = new Date().toISOString().slice(0, 19);
  const transactionId = generateFdsV3TransactionId(hcode);

  const patMap = new Map<string, FdhRow>();
  (rawData.PAT || []).forEach((row) => {
    const hn = str(row.HN);
    if (hn) patMap.set(hn, row);
  });

  const insMap = new Map<string, FdhRow>();
  (rawData.INS || []).forEach((row) => {
    const seq = str(row.SEQ) || str(row.HN);
    if (seq) insMap.set(seq, row);
  });

  const aerMap = new Map<string, FdhRow>();
  (rawData.AER || []).forEach((row) => {
    const seq = str(row.SEQ);
    if (seq) aerMap.set(seq, row);
  });

  // Group ODX by SEQ
  const odxBySeq = new Map<string, FdhRow[]>();
  (rawData.ODX || []).forEach((row) => {
    const seq = str(row.SEQ);
    if (!odxBySeq.has(seq)) odxBySeq.set(seq, []);
    odxBySeq.get(seq)!.push(row);
  });

  // Group IDX by AN
  const idxByAn = new Map<string, FdhRow[]>();
  (rawData.IDX || []).forEach((row) => {
    const an = str(row.AN);
    if (!idxByAn.has(an)) idxByAn.set(an, []);
    idxByAn.get(an)!.push(row);
  });

  // Group OOP by SEQ
  const oopBySeq = new Map<string, FdhRow[]>();
  (rawData.OOP || []).forEach((row) => {
    const seq = str(row.SEQ);
    if (!oopBySeq.has(seq)) oopBySeq.set(seq, []);
    oopBySeq.get(seq)!.push(row);
  });

  // Group IOP by AN
  const iopByAn = new Map<string, FdhRow[]>();
  (rawData.IOP || []).forEach((row) => {
    const an = str(row.AN);
    if (!iopByAn.has(an)) iopByAn.set(an, []);
    iopByAn.get(an)!.push(row);
  });

  // Group LVD by AN
  const lvdByAn = new Map<string, FdhRow[]>();
  (rawData.LVD || []).forEach((row) => {
    const an = str(row.AN);
    if (!lvdByAn.has(an)) lvdByAn.set(an, []);
    lvdByAn.get(an)!.push(row);
  });

  // Group CHT by SEQ or AN
  const chtBySeq = new Map<string, FdhRow[]>();
  (rawData.CHT || []).forEach((row) => {
    const key = str(row.AN) || str(row.SEQ);
    if (!chtBySeq.has(key)) chtBySeq.set(key, []);
    chtBySeq.get(key)!.push(row);
  });

  // Group CHA by SEQ or AN
  const chaBySeq = new Map<string, FdhRow[]>();
  (rawData.CHA || []).forEach((row) => {
    const key = str(row.AN) || str(row.SEQ);
    if (!chaBySeq.has(key)) chaBySeq.set(key, []);
    chaBySeq.get(key)!.push(row);
  });

  // Group ADP by SEQ or AN
  const adpBySeq = new Map<string, FdhRow[]>();
  (rawData.ADP || []).forEach((row) => {
    const key = str(row.AN) || str(row.SEQ);
    if (!adpBySeq.has(key)) adpBySeq.set(key, []);
    adpBySeq.get(key)!.push(row);
  });

  // Group DRU by SEQ or AN
  const druBySeq = new Map<string, FdhRow[]>();
  (rawData.DRU || []).forEach((row) => {
    const key = str(row.AN) || str(row.SEQ);
    if (!druBySeq.has(key)) druBySeq.set(key, []);
    druBySeq.get(key)!.push(row);
  });

  // Collect distinct visits from OPD and IPD
  const visits: FdsV3Visit[] = [];
  const processedKeys = new Set<string>();

  // Helper to build a visit
  const buildVisit = (opdRow?: FdhRow, ipdRow?: FdhRow): FdsV3Visit | null => {
    const hn = str(opdRow?.HN) || str(ipdRow?.HN);
    const seq = str(opdRow?.SEQ) || str(ipdRow?.AN);
    if (!hn || !seq || processedKeys.has(seq)) return null;
    processedKeys.add(seq);

    const patRow = patMap.get(hn) || {};
    const insRow = insMap.get(seq) || insMap.get(hn) || {};
    const key = str(ipdRow?.AN) || seq;

    // 1. Patient
    const id = str(patRow.PERSON_ID) || str(insRow.CID) || '0000000000000';
    const idType = str(patRow.IDTYPE, '1');
    const gender = str(patRow.SEX) === '1' ? '1' : '2';
    const birthDate = str(patRow.DOB);
    const patientName = {
      given: str(patRow.FNAME) || str(patRow.NAMEPAT, 'ผู้รับบริการ'),
      family: str(patRow.LNAME, '-'),
      prefix: str(patRow.TITLE, ''),
      line: `${str(patRow.TITLE)}${str(patRow.FNAME)} ${str(patRow.LNAME)}`.trim(),
    };
    const patientAddress = {
      city: str(patRow.CHANGWAT, '00').padStart(2, '0').slice(0, 2),
      district: str(patRow.AMPHUR, '00').padStart(2, '0').slice(0, 2),
      postalCode: '10000',
      line: 'ที่อยู่ตามทะเบียน รพ.',
    };
    const patient: FdsV3Patient = {
      birthDate,
      gender,
      hn,
      id,
      idType,
      name: patientName,
      maritalStatus: str(patRow.MARRIAGE, '1'),
      nationality: str(patRow.NATION, '99'),
      address: patientAddress,
    };

    // 2. Encounter
    let opd: FdsV3EncounterOpd | undefined;
    if (opdRow) {
      opd = {
        clinic: str(opdRow.CLINIC, '00000').padStart(5, '0').slice(0, 5),
        dateTime: formatFdsDateTime(opdRow.DATEOPD, opdRow.TIMEOPD),
        seq,
        typeIn: str(opdRow.TYPEIN, '1'),
        typeOut: str(opdRow.TYPEOUT, '1'),
      };
    }

    let ipd: FdsV3EncounterIpd | undefined;
    if (ipdRow) {
      const an = str(ipdRow.AN);
      const leaveRows = lvdByAn.get(an) || [];
      const leaveDay: FdsV3LeaveDay[] = leaveRows.map((lvd, idx) => ({
        dateTimeOut: formatFdsDateTime(lvd.DATEOUT, lvd.TIMEOUT),
        dateTimeIn: formatFdsDateTime(lvd.DATEIN, lvd.TIMEIN),
        qtyDay: num(lvd.QTYDAY, 1),
        seqLvd: num(lvd.SEQLVD, idx + 1),
      }));
      const totalLeaveDay = leaveDay.reduce((acc, curr) => acc + curr.qtyDay, 0);

      ipd = {
        an,
        admDateTime: formatFdsDateTime(ipdRow.DATEADM, ipdRow.TIMEADM),
        dscDateTime: formatFdsDateTime(ipdRow.DATEDSC, ipdRow.TIMEDSC),
        dischStat: str(ipdRow.DISCHS, '1'),
        dischType: str(ipdRow.DISCHT, '1'),
        seq,
        dept: str(ipdRow.DEPT, '01'),
        admType: 'C',
        admSource: 'O',
        wardDsc: str(ipdRow.WARDDSC, '01'),
        svcType: str(ipdRow.SVCTYPE, 'I'),
        adjRw: num(ipdRow.ADJRW, 0) || undefined,
        drgCode: str(ipdRow.DRG) || undefined,
        totalLeaveDay: totalLeaveDay > 0 ? totalLeaveDay : undefined,
        leaveDay: leaveDay.length > 0 ? leaveDay : undefined,
      };
    }

    // Clinical
    const bodyWeight = num(ipdRow?.ADM_W || opdRow?.BTEMP ? 0 : 0) || (ipdRow ? num(ipdRow.ADM_W, 0) : undefined);
    const clinical = {
      chiefComplaint: str(opdRow?.DETAIL, 'ตรวจรักษาทั่วไป'),
      bodyWeight: bodyWeight && bodyWeight > 0 ? bodyWeight : undefined,
    };

    // Diagnosis
    const rawDx = ipdRow ? (idxByAn.get(str(ipdRow.AN)) || []) : (odxBySeq.get(seq) || []);
    const diagnosisIcd10: FdsV3DiagnosisIcd10[] = rawDx.map((dx) => ({
      dateTime: formatFdsDateTime(dx.DATEDX || opdRow?.DATEOPD || ipdRow?.DATEADM),
      diagType: str(dx.DXTYPE, '1'),
      icd10: str(dx.DIAG).replace('.', ''),
      professionId: str(dx.DRDX, 'ว00000'),
    }));

    // Procedures
    const rawProc = ipdRow ? (iopByAn.get(str(ipdRow.AN)) || []) : (oopBySeq.get(seq) || []);
    const procedure: FdsV3Procedure[] = rawProc.map((pr) => ({
      clinic: str(pr.CLINIC, '00000').padStart(5, '0').slice(0, 5),
      dateTimein: formatFdsDateTime(pr.DATEIN || pr.DATEOPD || opdRow?.DATEOPD),
      dateTimeOut: formatFdsDateTime(pr.DATEOUT || pr.DATEOPD || opdRow?.DATEOPD),
      professionId: str(pr.DROPID, 'ว00000'),
      Oper: [{ code: str(pr.OPER) }],
    }));

    // AER
    const aerRow = aerMap.get(seq);
    const aer = aerRow ? {
      ucAe: str(aerRow.UCAE),
      referNo: str(aerRow.REFER_NO),
      refMainIn: str(aerRow.REFMAINI),
    } : undefined;

    const encounter: FdsV3Encounter = {
      opd,
      ipd,
      clinical,
      diagnosisIcd10,
      procedure,
      aer,
    };

    // 3. Benefits & Billing
    const inscl = str(insRow.INSCL, 'UCS').toUpperCase();
    const claim = {
      hcode: str(insRow.HOSPMAIN, hcode),
      hmain: str(insRow.HOSPMAIN, hcode),
      permitNo: str(insRow.PERMITNO) || undefined,
      hType: str(insRow.HTYPE, '1'),
      inscl,
      isUsedDm: '0' as const,
      isUsedHt: '0' as const,
      uuc: str(opdRow?.UUC || ipdRow?.UUC, '1') === '2' ? ('2' as const) : ('1' as const),
    };

    const chtRows = chtBySeq.get(key) || [];
    const cht = chtRows.map((c) => ({
      invoiceNo: str(c.INVOICE_NO, seq),
      total: num(c.TOTAL, 0),
    }));
    if (cht.length === 0) {
      cht.push({ invoiceNo: seq, total: 0 });
    }

    // Line items from ADP and DRU
    const adpRows = adpBySeq.get(key) || [];
    const druRows = druBySeq.get(key) || [];
    const lineItems: FdsV3ChaItem[] = [];

    adpRows.forEach((adp) => {
      const isLab = str(adp.TYPE) === '2' || Boolean(adp.TMLTCODE);
      const codeSys = isLab ? 'TMLT' : 'SE';
      const stdCode = str(adp.TMLTCODE) || str(adp.CODE);
      lineItems.push({
        localCode: str(adp.CODE),
        stdCode,
        codeSys,
        descript: str(adp.CAGCODE) || str(adp.CODE, 'บริการทางการแพทย์'),
        qty: num(adp.QTY, 1),
        unitPrice: num(adp.RATE, 0),
        chargeAmt: num(adp.TOTAL, 0) || (num(adp.QTY, 1) * num(adp.RATE, 0)),
        reimbPrice: num(adp.RATE, 0),
        serviceDate: formatFdsDateTime(adp.DATEOPD || opdRow?.DATEOPD || ipdRow?.DATEADM),
      });
    });

    druRows.forEach((dru) => {
      lineItems.push({
        localCode: str(dru.DID),
        stdCode: str(dru.DIDSTD) || str(dru.DID),
        codeSys: 'TMT',
        descript: str(dru.DIDNAME, 'ยา'),
        qty: num(dru.AMOUNT, 1),
        unitPrice: num(dru.DRUGPRIC, 0),
        chargeAmt: num(dru.TOTAL, 0) || (num(dru.AMOUNT, 1) * num(dru.DRUGPRIC, 0)),
        reimbPrice: num(dru.DRUGPRIC, 0),
        serviceDate: formatFdsDateTime(dru.DATE_SERV || opdRow?.DATEOPD || ipdRow?.DATEADM),
      });
    });

    // CHA Categories
    const chaRows = chaBySeq.get(key) || [];
    const cha: FdsV3Cha[] = chaRows.map((c) => ({
      invoiceNo: str(c.INVOICE_NO, seq),
      chrgItem: str(c.CHRGITEM, '11'),
      amount: num(c.AMOUNT, 0),
      date: formatFdsDateTime(c.DATE || opdRow?.DATEOPD || ipdRow?.DATEADM),
      items: lineItems,
    }));

    if (cha.length === 0 && lineItems.length > 0) {
      const sum = lineItems.reduce((acc, curr) => acc + curr.chargeAmt, 0);
      cha.push({
        invoiceNo: seq,
        chrgItem: 'G1',
        amount: sum,
        date: formatFdsDateTime(opdRow?.DATEOPD || ipdRow?.DATEADM),
        items: lineItems,
      });
    }

    const benefits: FdsV3Benefits = {
      claim,
      cht,
      cha,
    };

    // 4. Check for Prenatal (from ADP gravida / ga_week)
    let pren: FdsV3Pren | undefined;
    const prenatalAdp = adpRows.find((r) => r.GRAVIDA || r.GA_WEEK || r.LMP);
    if (prenatalAdp) {
      pren = {
        edc: formatFdsDateTime(prenatalAdp.DATEOPD || opdRow?.DATEOPD).slice(0, 10),
        gravida: str(prenatalAdp.GRAVIDA, '1'),
        lmp: str(prenatalAdp.LMP, '2026-01-01'),
        pregnantWomenCid: id,
        gaWeek: num(prenatalAdp.GA_WEEK, 0) || undefined,
      };
    }

    return {
      uniqueId: `${hcode}-${seq}`,
      patient,
      practitioner: [
        {
          cid: '1100000000000',
          pvType: '1',
          professionId: diagnosisIcd10[0]?.professionId || 'ว00000',
        },
      ],
      encounter,
      benefits,
      pren,
    };
  };

  // Build visits from OPD
  (rawData.OPD || []).forEach((opdRow) => {
    const v = buildVisit(opdRow, undefined);
    if (v) visits.push(v);
  });

  // Build visits from IPD
  (rawData.IPD || []).forEach((ipdRow) => {
    const v = buildVisit(undefined, ipdRow);
    if (v) visits.push(v);
  });

  // Calculate totalVisits summary
  let ucVisits = 0;
  let csopVisits = 0;
  let ssopVisits = 0;
  let cipnVisits = 0;
  let aipnVisits = 0;

  visits.forEach((v) => {
    const ins = v.benefits.claim.inscl;
    const isIpd = Boolean(v.encounter.ipd);
    if (ins === 'UCS') {
      ucVisits += 1;
    } else if (ins === 'OFC') {
      if (isIpd) cipnVisits += 1;
      else csopVisits += 1;
    } else if (ins === 'SSS') {
      if (isIpd) aipnVisits += 1;
      else ssopVisits += 1;
    }
  });

  return {
    fdhVersion: FDS_V3_VERSION,
    generatedDateTime,
    hcode,
    hisSecret,
    hisName,
    hisSourceKey,
    hisVersion,
    hospitalName,
    transactionId,
    auditSoftName: 'FDHChecker',
    auditSoftVersion: '1.0.2',
    totalVisits: {
      total: visits.length,
      totalUcVisits: ucVisits,
      totalCsopVisits: csopVisits,
      totalSsopVisits: ssopVisits,
      totalCipnVisits: cipnVisits,
      totalAipnVisits: aipnVisits,
    },
    data: visits,
  };
};

/**
 * Validate FDS v3 Payload against MOPH FDS Rules (Zero-Error Pre-flight Guard)
 */
export const validateFdsV3Payload = (payload: FdsV3Payload): FdsV3ValidationResult => {
  const errors: FdsV3ValidationIssue[] = [];
  const warnings: FdsV3ValidationIssue[] = [];

  // 1. Metadata check
  if (!payload.hcode || !/^\d{5}$/.test(payload.hcode)) {
    errors.push({
      severity: 'error',
      rule: 'FDS-001',
      path: 'hcode',
      message: 'รหัสสถานพยาบาล (HCODE) ต้องเป็นตัวเลข 5 หลัก',
    });
  }

  if (!payload.hisSecret) {
    warnings.push({
      severity: 'warning',
      rule: 'FDS-001',
      path: 'hisSecret',
      message: 'ยังไม่ได้ระบุ hisSecret (Token NewAuthenCode สปสช) — จำเป็นสำหรับการส่งจริงผ่าน API',
    });
  }

  if (!payload.hisSourceKey) {
    warnings.push({
      severity: 'warning',
      rule: 'FDS-001',
      path: 'hisSourceKey',
      message: 'ยังไม่ได้ระบุ hisSourceKey (NHSO Digital Platform Key) — จำเป็นสำหรับการส่งจริงผ่าน API',
    });
  }

  if (!payload.transactionId || payload.transactionId.length !== 27) {
    errors.push({
      severity: 'error',
      rule: 'FDS-001',
      path: 'transactionId',
      message: 'transactionId ต้องมีความยาว 27 ตัวอักษรตามรูปแบบ hcode(5)-YYYYMMDDHHMMSS(14)-NNNNNN(6)',
    });
  }

  if (payload.totalVisits.total !== payload.data.length) {
    errors.push({
      severity: 'error',
      rule: 'FDS-001',
      path: 'totalVisits.total',
      message: `totalVisits.total (${payload.totalVisits.total}) ไม่ตรงกับจำนวน visits ใน data (${payload.data.length})`,
    });
  }

  const specialDetected = {
    pren: 0,
    cmhs: 0,
    disa: 0,
    dmis: 0,
    ntip: 0,
    napsAdvise: 0,
  };

  // 2. Validate each Visit
  payload.data.forEach((visit, index) => {
    const vn = visit.encounter.opd?.seq || visit.encounter.ipd?.an || `row-${index + 1}`;

    // Patient checks
    if (!visit.patient.id || visit.patient.id.length < 13) {
      errors.push({
        severity: 'error',
        rule: 'FDS-002',
        path: `data[${index}].patient.id`,
        vn,
        message: `เลขประจำตัวผู้ป่วย (CID) ไม่ครบ 13 หลัก (${visit.patient.id})`,
      });
    }

    if (!visit.patient.birthDate) {
      errors.push({
        severity: 'error',
        rule: 'FDS-002',
        path: `data[${index}].patient.birthDate`,
        vn,
        message: 'ไม่พบวันเกิดของผู้ป่วย',
      });
    }

    // IPD Mandatory checks
    if (visit.encounter.ipd) {
      const ipd = visit.encounter.ipd;
      const inscl = visit.benefits.claim.inscl;

      if (!visit.encounter.clinical.bodyWeight || visit.encounter.clinical.bodyWeight <= 0) {
        warnings.push({
          severity: 'warning',
          rule: 'FDS-003',
          path: `data[${index}].encounter.clinical.bodyWeight`,
          vn,
          message: 'ผู้ป่วยใน (IPD) ต้องมีน้ำหนักแรกรับ (bodyWeight)',
        });
      }

      if (['OFC', 'SSS'].includes(inscl)) {
        if (!ipd.dept) {
          errors.push({
            severity: 'error',
            rule: 'FDS-003',
            path: `data[${index}].encounter.ipd.dept`,
            vn,
            message: `สิทธิ ${inscl} ผู้ป่วยในต้องระบุแผนกหลัก (dept)`,
          });
        }
        if (!ipd.admType) {
          errors.push({
            severity: 'error',
            rule: 'FDS-003',
            path: `data[${index}].encounter.ipd.admType`,
            vn,
            message: `สิทธิ ${inscl} ผู้ป่วยในต้องระบุประเภทการรับ (admType)`,
          });
        }
      }
    }

    // Diagnosis checks
    if (visit.encounter.diagnosisIcd10.length === 0) {
      errors.push({
        severity: 'error',
        rule: 'FDS-004',
        path: `data[${index}].encounter.diagnosisIcd10`,
        vn,
        message: 'ไม่พบการวินิจฉัยโรค (ICD-10)',
      });
    } else {
      const hasPrinc = visit.encounter.diagnosisIcd10.some((dx) => dx.diagType === '1');
      if (!hasPrinc) {
        warnings.push({
          severity: 'warning',
          rule: 'FDS-004',
          path: `data[${index}].encounter.diagnosisIcd10`,
          vn,
          message: 'ไม่พบ Principal diagnosis (diagType=1)',
        });
      }
    }

    // Special modules counts
    if (visit.pren) specialDetected.pren += 1;
    if (visit.cmhs) specialDetected.cmhs += 1;
    if (visit.disa) specialDetected.disa += 1;
    if (visit.dmis) specialDetected.dmis += 1;
    if (visit.ntip) specialDetected.ntip += 1;
    if (visit.napsAdvise) specialDetected.napsAdvise += 1;
  });

  return {
    valid: errors.length === 0,
    totalVisits: payload.data.length,
    ucVisits: payload.totalVisits.totalUcVisits || 0,
    ofcVisits: (payload.totalVisits.totalCsopVisits || 0) + (payload.totalVisits.totalCipnVisits || 0),
    sssVisits: (payload.totalVisits.totalSsopVisits || 0) + (payload.totalVisits.totalAipnVisits || 0),
    cipnVisits: payload.totalVisits.totalCipnVisits || 0,
    aipnVisits: payload.totalVisits.totalAipnVisits || 0,
    errors,
    warnings,
    specialModulesDetected: specialDetected,
  };
};

````
