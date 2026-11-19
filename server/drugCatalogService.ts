import AdmZip from 'adm-zip';
import crypto from 'crypto';
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import type mysql from 'mysql2/promise';
import { getRepstmConnection, getUTFConnection } from './db.js';
import { getAppSetting, setAppSetting } from './repositories/system.repository.js';
import { readHospitalIdentity } from './siteProfile.js';

export interface DrugCatalogIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface DrugCatalogRow {
  HospDrugCode: string;
  ProductCat: string;
  TMTID: string;
  SpecPrep: string;
  GenericName: string;
  TradeName: string;
  DFSCode: string;
  DosageForm: string;
  Strength: string;
  Content: string;
  UnitPrice: number;
  Price2?: number;
  Price3?: number;
  Distributor: string;
  Manufacturer: string;
  ISED: 'E' | 'N';
  NDC24: string;
  Packsize: string;
  Packprice: string;
  UpdateFlag: 'A' | 'E' | 'U' | 'D';
  DateChange: string;
  DateUpdate: string;
  DateEffective: string;
  DateExpiry: string;
  active: boolean;
  has_override: boolean;
  r51_flagged: boolean;
  validation_status: 'ready' | 'warning' | 'error';
  issues: DrugCatalogIssue[];
}

const DRUG_CATALOG_OVERRIDE_SQL = `
  CREATE TABLE IF NOT EXISTS fdh_drug_catalog_override (
    hosp_drug_code VARCHAR(32) NOT NULL PRIMARY KEY,
    product_cat VARCHAR(4) NULL,
    tmtid VARCHAR(16) NULL,
    spec_prep VARCHAR(8) NULL,
    generic_name VARCHAR(255) NULL,
    trade_name VARCHAR(255) NULL,
    dfs_code VARCHAR(32) NULL,
    dosage_form VARCHAR(128) NULL,
    strength VARCHAR(128) NULL,
    content VARCHAR(128) NULL,
    unit_price DECIMAL(15,2) NULL,
    distributor VARCHAR(255) NULL,
    manufacturer VARCHAR(255) NULL,
    ised VARCHAR(4) NULL,
    ndc24 VARCHAR(32) NULL,
    packsize VARCHAR(64) NULL,
    packprice VARCHAR(64) NULL,
    update_flag VARCHAR(4) NULL,
    date_change VARCHAR(32) NULL,
    date_update VARCHAR(32) NULL,
    date_effective VARCHAR(32) NULL,
    date_expiry VARCHAR(32) NULL,
    updated_by VARCHAR(128) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const text = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const formatDateSlash = (raw: unknown, fallbackToday = false): string => {
  const s = text(raw);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    const dd = String(raw.getDate()).padStart(2, '0');
    const mm = String(raw.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${raw.getFullYear()}`;
  }
  if (fallbackToday) {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  return '';
};

const resolveIsed = (drugAccount: unknown, overrideIsed: unknown): 'E' | 'N' => {
  const ov = text(overrideIsed).toUpperCase();
  if (ov === 'E' || ov === 'N') return ov;
  const acc = text(drugAccount).toUpperCase();
  if (!acc) return 'E';
  if (/^(ก|ข|ค|ง|จ|E|ED|A|B|C|D)/.test(acc)) return 'E';
  return 'N';
};

export const validateDrugCatalogRow = (row: Omit<DrugCatalogRow, 'validation_status' | 'issues'>): DrugCatalogIssue[] => {
  const issues: DrugCatalogIssue[] = [];
  const add = (severity: 'error' | 'warning', code: string, message: string) => issues.push({ severity, code, message });

  if (!row.HospDrugCode) add('error', 'DC-01', 'ไม่มีรหัสยาโรงพยาบาล (HospDrugCode)');
  if (!/^[1-7]$/.test(row.ProductCat)) add('error', 'DC-02', 'ProductCat ต้องเป็น 1–7');
  if (row.ProductCat === '1' && !/^\d{6,7}$/.test(row.TMTID)) {
    add('error', 'DC-03', 'ยาแผนปัจจุบัน (ProductCat=1) ต้องมีรหัส TMTID 6 หลัก');
  }
  if (!row.GenericName) add('warning', 'DC-04', 'ไม่มีชื่อสามัญทางยา (GenericName)');
  if (!row.TradeName) add('warning', 'DC-05', 'ไม่มีชื่อการค้า (TradeName)');
  if (!row.DosageForm) add('warning', 'DC-06', 'ไม่มีรูปแบบยา (DosageForm)');
  if (!row.Strength) add('warning', 'DC-07', 'ไม่มีความแรง (Strength)');
  if (!row.Content) add('warning', 'DC-08', 'ไม่มีขนาดบรรจุ (Content)');
  if (row.UnitPrice <= 0) add('error', 'DC-09', 'ราคาต่อหน่วย (UnitPrice) ต้องมากกว่า 0');
  if (row.ISED !== 'E' && row.ISED !== 'N') add('error', 'DC-10', 'ISED ต้องเป็น E (ในบัญชี) หรือ N (นอกบัญชี)');
  if (row.NDC24 && !/^\d{24}$/.test(row.NDC24)) add('warning', 'DC-11', 'NDC24 ไม่ครบ 24 หลัก');
  if (!['A', 'E', 'U', 'D'].includes(row.UpdateFlag)) add('error', 'DC-12', 'UpdateFlag ต้องเป็น A, E, U หรือ D');
  return issues;
};

const ensureDrugCatalogTable = async (repConn: mysql.PoolConnection) => {
  await repConn.query(DRUG_CATALOG_OVERRIDE_SQL);
};

export const getDrugCatalogItems = async (options: { includeInactive?: boolean } = {}) => {
  const hosConn = await getUTFConnection();
  const repConn = await getRepstmConnection();
  try {
    await ensureDrugCatalogTable(repConn);

    const whereActive = options.includeInactive ? '' : `WHERE COALESCE(di.istatus, 'Y') <> 'N' AND COALESCE(di.name, '') NOT LIKE 'ยา.%'`;
    let drugRows: unknown;
    try {
      [drugRows] = await hosConn.query(`
        SELECT
          di.icode,
          COALESCE(di.istatus, 'Y') AS istatus,
          CASE
            WHEN NULLIF(TRIM(di.sks_product_category_id), '') IS NOT NULL THEN TRIM(di.sks_product_category_id)
            WHEN COALESCE(TRIM(di.did), '') LIKE '4%' THEN '3'
            ELSE '1'
          END AS product_cat,
          COALESCE(NULLIF(TRIM(di.tpu_code_list), ''), NULLIF(TRIM(di.tmt_tp_code), ''), NULLIF(TRIM(di.sks_drug_code), ''), '') AS tmtid,
          COALESCE(TRIM(di.sks_specprep), '') AS spec_prep,
          COALESCE(NULLIF(TRIM(di.generic_name), ''), TRIM(di.name), '') AS generic_name,
          COALESCE(NULLIF(TRIM(t.trade_name), ''), NULLIF(TRIM(di.trade_name), ''), TRIM(di.name), '') AS trade_name,
          COALESCE(TRIM(di.sks_dfs_code), '') AS dfs_code,
          COALESCE(NULLIF(TRIM(t.dosage_form), ''), NULLIF(TRIM(di.sks_dfs_text), ''), TRIM(di.dosageform), '') AS dosage_form,
          COALESCE(TRIM(di.strength), '') AS strength,
          COALESCE(NULLIF(CAST(di.packqty AS CHAR), ''), NULLIF(TRIM(di.capacity_name), ''), TRIM(di.units), '1') AS content,
          ROUND(COALESCE(di.unitprice, 0), 2) AS unit_price,
          ROUND(COALESCE(di.price2, di.unitprice, 0), 2) AS price2,
          ROUND(COALESCE(di.price3, di.unitprice, 0), 2) AS price3,
          COALESCE(TRIM(t.manufacturer), '') AS tmt_manufacturer,
          COALESCE(TRIM(di.drugaccount), '') AS drugaccount,
          COALESCE(TRIM(di.did), '') AS ndc24,
          COALESCE(di.packqty, 1) AS packqty,
          di.last_update,
          di.sks_rev_date,
          di.begin_date,
          di.finish_date
        FROM drugitems di
        LEFT JOIN tmt_tpu_code t ON t.tpu_code = COALESCE(NULLIF(TRIM(di.tpu_code_list), ''), NULLIF(TRIM(di.sks_drug_code), ''))
        ${whereActive}
        ORDER BY di.icode ASC
      `);
    } catch {
      // Fallback if tmt_tpu_code table does not exist in this HOSxP instance
      [drugRows] = await hosConn.query(`
        SELECT
          di.icode,
          COALESCE(di.istatus, 'Y') AS istatus,
          CASE
            WHEN NULLIF(TRIM(di.sks_product_category_id), '') IS NOT NULL THEN TRIM(di.sks_product_category_id)
            WHEN COALESCE(TRIM(di.did), '') LIKE '4%' THEN '3'
            ELSE '1'
          END AS product_cat,
          COALESCE(NULLIF(TRIM(di.tpu_code_list), ''), NULLIF(TRIM(di.tmt_tp_code), ''), NULLIF(TRIM(di.sks_drug_code), ''), '') AS tmtid,
          COALESCE(TRIM(di.sks_specprep), '') AS spec_prep,
          COALESCE(NULLIF(TRIM(di.generic_name), ''), TRIM(di.name), '') AS generic_name,
          COALESCE(NULLIF(TRIM(di.trade_name), ''), TRIM(di.name), '') AS trade_name,
          COALESCE(TRIM(di.sks_dfs_code), '') AS dfs_code,
          COALESCE(NULLIF(TRIM(di.sks_dfs_text), ''), TRIM(di.dosageform), '') AS dosage_form,
          COALESCE(TRIM(di.strength), '') AS strength,
          COALESCE(NULLIF(CAST(di.packqty AS CHAR), ''), NULLIF(TRIM(di.capacity_name), ''), TRIM(di.units), '1') AS content,
          ROUND(COALESCE(di.unitprice, 0), 2) AS unit_price,
          ROUND(COALESCE(di.price2, di.unitprice, 0), 2) AS price2,
          ROUND(COALESCE(di.price3, di.unitprice, 0), 2) AS price3,
          '' AS tmt_manufacturer,
          COALESCE(TRIM(di.drugaccount), '') AS drugaccount,
          COALESCE(TRIM(di.did), '') AS ndc24,
          COALESCE(di.packqty, 1) AS packqty,
          di.last_update,
          di.sks_rev_date,
          di.begin_date,
          di.finish_date
        FROM drugitems di
        ${whereActive}
        ORDER BY di.icode ASC
      `);
    }

    const [ovRows] = await repConn.query(`SELECT * FROM fdh_drug_catalog_override`);
    const ovMap = new Map<string, Record<string, unknown>>();
    if (Array.isArray(ovRows)) {
      for (const ov of ovRows as Record<string, unknown>[]) {
        ovMap.set(text(ov.hosp_drug_code), ov);
      }
    }

    // Detect drug icodes involved in SSS R51 errors
    const r51Icodes = new Set<string>();
    try {
      const [r51Rows] = await repConn.query(
        `SELECT DISTINCT vn FROM sss_import_row WHERE check_code LIKE '%R51%' AND vn IS NOT NULL AND vn <> ''`
      );
      const r51Vns = Array.isArray(r51Rows)
        ? (r51Rows as Record<string, unknown>[]).map((r) => text(r.vn)).filter(Boolean)
        : [];
      if (r51Vns.length > 0) {
        const ph = r51Vns.map(() => '?').join(',');
        const [opDrugs] = await hosConn.query(
          `SELECT DISTINCT oi.icode FROM opitemrece oi JOIN drugitems di ON di.icode = oi.icode WHERE oi.vn IN (${ph})`,
          r51Vns,
        );
        if (Array.isArray(opDrugs)) {
          for (const d of opDrugs as Record<string, unknown>[]) {
            r51Icodes.add(text(d.icode));
          }
        }
      }
    } catch {
      // ignore if sss_import_row doesn't exist yet
    }

    const todaySlash = formatDateSlash(new Date(), true);
    const items: DrugCatalogRow[] = (Array.isArray(drugRows) ? drugRows as Record<string, unknown>[] : []).map((r) => {
      const code = text(r.icode);
      const ov = ovMap.get(code);
      const rawTmt = text(ov?.tmtid ?? r.tmtid).replace(/\D/g, '');
      const rawCat = text(ov?.product_cat ?? r.product_cat) || '1';
      const productCat = /^[1-7]$/.test(rawCat) ? rawCat : '1';
      const unitPrice = num(ov?.unit_price ?? r.unit_price);
      const packQty = text(ov?.packsize ?? (num(r.packqty) > 1 ? String(r.packqty) : ''));
      const updateFlagRaw = text(ov?.update_flag).toUpperCase();
      const updateFlag: 'A' | 'E' | 'U' | 'D' =
        updateFlagRaw === 'E' || updateFlagRaw === 'U' || updateFlagRaw === 'D' ? updateFlagRaw : 'A';

      const base: Omit<DrugCatalogRow, 'validation_status' | 'issues'> = {
        HospDrugCode: code,
        ProductCat: productCat,
        TMTID: rawTmt,
        SpecPrep: text(ov?.spec_prep ?? r.spec_prep),
        GenericName: text(ov?.generic_name ?? r.generic_name),
        TradeName: text(ov?.trade_name ?? r.trade_name),
        DFSCode: text(ov?.dfs_code ?? r.dfs_code),
        DosageForm: text(ov?.dosage_form ?? r.dosage_form),
        Strength: text(ov?.strength ?? r.strength),
        Content: text(ov?.content ?? r.content),
        UnitPrice: unitPrice,
        Price2: num(r.price2),
        Price3: num(r.price3),
        Distributor: text(ov?.distributor ?? r.tmt_manufacturer),
        Manufacturer: text(ov?.manufacturer ?? r.tmt_manufacturer),
        ISED: resolveIsed(r.drugaccount, ov?.ised),
        NDC24: text(ov?.ndc24 ?? r.ndc24).replace(/\D/g, ''),
        Packsize: packQty,
        Packprice: text(ov?.packprice),
        UpdateFlag: updateFlag,
        DateChange: formatDateSlash(ov?.date_change ?? r.last_update, false) || todaySlash,
        DateUpdate: formatDateSlash(ov?.date_update ?? r.sks_rev_date ?? r.last_update, false) || todaySlash,
        DateEffective: formatDateSlash(ov?.date_effective ?? r.begin_date, false) || todaySlash,
        DateExpiry: formatDateSlash(ov?.date_expiry ?? r.finish_date, false),
        active: text(r.istatus).toUpperCase() === 'Y',
        has_override: Boolean(ov),
        r51_flagged: r51Icodes.has(code),
      };

      const issues = validateDrugCatalogRow(base);
      const hasError = issues.some((i) => i.severity === 'error');
      return {
        ...base,
        validation_status: hasError ? 'error' : issues.length > 0 ? 'warning' : 'ready',
        issues,
      };
    });

    const summary = items.reduce(
      (acc, it) => {
        acc.total += 1;
        acc[it.validation_status] += 1;
        if (it.ProductCat === '1' && !/^\d{6,7}$/.test(it.TMTID)) acc.missingTmt += 1;
        if (it.r51_flagged) acc.r51Flagged += 1;
        return acc;
      },
      { total: 0, ready: 0, warning: 0, error: 0, missingTmt: 0, r51Flagged: 0 },
    );

    return { items, summary };
  } finally {
    hosConn.release();
    repConn.release();
  }
};

export const saveDrugCatalogOverride = async (payload: Partial<DrugCatalogRow> & { HospDrugCode: string; updatedBy?: string }) => {
  const code = text(payload.HospDrugCode);
  if (!code) throw new Error('กรุณาระบุรหัสยา (HospDrugCode)');
  const repConn = await getRepstmConnection();
  try {
    await ensureDrugCatalogTable(repConn);
    await repConn.query(
      `INSERT INTO fdh_drug_catalog_override (
         hosp_drug_code, product_cat, tmtid, spec_prep, generic_name, trade_name,
         dfs_code, dosage_form, strength, content, unit_price, distributor, manufacturer,
         ised, ndc24, packsize, packprice, update_flag, date_change, date_update,
         date_effective, date_expiry, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         product_cat = VALUES(product_cat),
         tmtid = VALUES(tmtid),
         spec_prep = VALUES(spec_prep),
         generic_name = VALUES(generic_name),
         trade_name = VALUES(trade_name),
         dfs_code = VALUES(dfs_code),
         dosage_form = VALUES(dosage_form),
         strength = VALUES(strength),
         content = VALUES(content),
         unit_price = VALUES(unit_price),
         distributor = VALUES(distributor),
         manufacturer = VALUES(manufacturer),
         ised = VALUES(ised),
         ndc24 = VALUES(ndc24),
         packsize = VALUES(packsize),
         packprice = VALUES(packprice),
         update_flag = VALUES(update_flag),
         date_change = VALUES(date_change),
         date_update = VALUES(date_update),
         date_effective = VALUES(date_effective),
         date_expiry = VALUES(date_expiry),
         updated_by = VALUES(updated_by)`,
      [
        code,
        text(payload.ProductCat) || null,
        text(payload.TMTID).replace(/\D/g, '') || null,
        text(payload.SpecPrep) || null,
        text(payload.GenericName) || null,
        text(payload.TradeName) || null,
        text(payload.DFSCode) || null,
        text(payload.DosageForm) || null,
        text(payload.Strength) || null,
        text(payload.Content) || null,
        payload.UnitPrice != null ? num(payload.UnitPrice) : null,
        text(payload.Distributor) || null,
        text(payload.Manufacturer) || null,
        text(payload.ISED) || null,
        text(payload.NDC24).replace(/\D/g, '') || null,
        text(payload.Packsize) || null,
        text(payload.Packprice) || null,
        text(payload.UpdateFlag) || null,
        text(payload.DateChange) || null,
        text(payload.DateUpdate) || null,
        text(payload.DateEffective) || null,
        text(payload.DateExpiry) || null,
        payload.updatedBy || 'Staff',
      ],
    );
    return { ok: true, HospDrugCode: code };
  } finally {
    repConn.release();
  }
};

export const getDrugCatalogChiSeq = async (): Promise<number> => {
  const stored = await getAppSetting<{ chiSeq?: number }>('drug_catalog_chi_seq').catch(() => null);
  return Number(stored?.chiSeq) || 8;
};

export const saveDrugCatalogChiSeq = async (seq: number) => {
  await setAppSetting('drug_catalog_chi_seq', { chiSeq: seq });
  return seq;
};

export type DrugCatalogExportTarget = 'nhso' | 'chi' | 'fdh';
export type DrugCatalogPriceTier = 1 | 2 | 3;

const pickExportPrice = (it: DrugCatalogRow, priceTier: DrugCatalogPriceTier): number => {
  if (priceTier === 2 && it.Price2 != null && it.Price2 > 0) return Number(it.Price2.toFixed(2));
  if (priceTier === 3 && it.Price3 != null && it.Price3 > 0) return Number(it.Price3.toFixed(2));
  return Number(it.UnitPrice.toFixed(2));
};

export const buildDrugCatalogExportFile = async (
  items: DrugCatalogRow[],
  target: DrugCatalogExportTarget,
  options: { priceTier?: DrugCatalogPriceTier; chiSeq?: number } = {},
): Promise<{ buffer: Buffer; filename: string; contentType: string; usedChiSeq?: number }> => {
  const hosConn = await getUTFConnection();
  let hcode = '11101';
  try {
    const ident = await readHospitalIdentity(hosConn);
    if (ident.hospital_code) hcode = ident.hospital_code;
  } finally {
    hosConn.release();
  }

  const priceTier: 1 | 2 | 3 = options.priceTier === 2 ? 2 : options.priceTier === 3 ? 3 : 1;
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  if (target === 'nhso') {
    // 25 columns — exact NHSO format: {hcode}_Export_DrugCat.xls
    const rows = items.map((it) => ({
      HOSPDRUGCODE: it.HospDrugCode,
      PRODUCTCAT: it.ProductCat,
      TMTID: it.TMTID,
      SPECPREP: it.SpecPrep,
      GENERICNAME: it.GenericName,
      TRADENAME: it.TradeName,
      DFSCODE: it.DFSCode,
      DOSAGEFORM: it.DosageForm,
      STRENGTH: it.Strength,
      CONTENT: it.Content || '1',
      UNITPRICE: pickExportPrice(it, priceTier),
      DISTRIBUTOR: it.Distributor,
      MANUFACTURER: it.Manufacturer,
      ISED: it.ISED,
      NDC24: it.NDC24,
      PACKSIZE: it.Packsize,
      PACKPRICE: it.Packprice,
      UPDATEFLAG: '',
      DATECHANGE: '',
      DATEUPDATE: '',
      DATEEFFECTIVE: todayDate,
      ISED_APPROVED: it.ISED,
      NDC24_APPROVED: '',
      DATE_APPROVED: todayDate,
      ISED_STATUS: '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DrugCatalog');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    return {
      buffer,
      filename: `${hcode}_Export_DrugCat.xls`,
      contentType: 'application/vnd.ms-excel',
    };
  }

  if (target === 'chi') {
    // 22 columns — exact CHI/สกส. format: {hcode}DrugN{seq:03d}.xls
    const nextSeq = options.chiSeq != null && Number.isFinite(options.chiSeq)
      ? Math.max(1, Math.floor(options.chiSeq))
      : (await getDrugCatalogChiSeq()) + 1;
    await saveDrugCatalogChiSeq(nextSeq);

    const effectiveDate = new Date(2010, 9, 1); // 2010-10-01 as in hospital CHI template
    const rows = items.map((it) => ({
      HospDrugCode: it.HospDrugCode,
      ProductCat: it.ProductCat,
      TMTID: it.TMTID,
      SpecPrep: it.SpecPrep,
      GenericName: it.GenericName,
      TradeName: it.TradeName,
      DFSCode: it.DFSCode,
      DosageForm: it.DosageForm,
      Strength: it.Strength,
      Content: it.Content || '1',
      UnitPrice: pickExportPrice(it, priceTier),
      Distributor: it.Distributor,
      Manufacturer: it.Manufacturer,
      ISED: it.ISED,
      NDC24: it.NDC24,
      PackSize: it.Packsize,
      PackPrice: it.Packprice,
      UpdateFlag: it.UpdateFlag || 'A',
      DateChange: effectiveDate,
      DateUpdate: '',
      DateEffective: effectiveDate,
      RP: '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DrugCatalog');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    return {
      buffer,
      filename: `${hcode}DrugN${String(nextSeq).padStart(3, '0')}.xls`,
      contentType: 'application/vnd.ms-excel',
      usedChiSeq: nextSeq,
    };
  }

  // target === 'fdh': 22 columns — exact FDH Thai headers: DrugCat4FDH.xlsx
  const rows = items.map((it, idx) => ({
    row: idx + 1,
    'รหัสยา Hosp Drug Code': it.HospDrugCode,
    'ประเภทยาและเวชภัณฑ์': it.ProductCat,
    'รหัสยา TMT': it.TMTID,
    'ชื่อยาสามัญ': it.GenericName,
    'ชื่อทางการค้า': it.TradeName,
    'DSF Code': it.DFSCode === '-' ? '' : it.DFSCode,
    'ลักษณะยา': it.DosageForm,
    'ปริมาณยาต่อหน่วยยา': it.Strength,
    'ราคากลางต่อหน่วยที่เบิกได้': pickExportPrice(it, priceTier),
    Distributor: it.Distributor,
    Manufacturer: it.Manufacturer,
    ISED: it.ISED,
    'SPEC PREP': it.SpecPrep || '',
    'รหัสยา 24 หลักจากหน่วยบริการ': it.NDC24,
    'Pack Size': it.Packsize || '',
    'Pack Price': it.Packprice || '',
    'Date Change': '',
    'Date Update': '',
    'Date Effective': '',
    'File Name': '',
    'รหัสโรงพยาบาล': hcode,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DrugCatalog');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    buffer,
    filename: 'DrugCat4FDH.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
};

export const buildDrugCatalogExcelBuffer = (items: DrugCatalogRow[]): Buffer => {
  const rows = items.map((it) => ({
    HospDrugCode: it.HospDrugCode,
    ProductCat: it.ProductCat,
    TMTID: it.TMTID,
    SpecPrep: it.SpecPrep,
    GenericName: it.GenericName,
    TradeName: it.TradeName,
    DFSCode: it.DFSCode,
    DosageForm: it.DosageForm,
    Strength: it.Strength,
    Content: it.Content,
    UnitPrice: Number(it.UnitPrice.toFixed(2)),
    Distributor: it.Distributor,
    Manufacturer: it.Manufacturer,
    ISED: it.ISED,
    NDC24: it.NDC24,
    Packsize: it.Packsize,
    Packprice: it.Packprice,
    UpdateFlag: it.UpdateFlag,
    DateChange: it.DateChange,
    DateUpdate: it.DateUpdate,
    DateEffective: it.DateEffective,
    DateExpiry: it.DateExpiry,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DrugCatalog');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const xmlEsc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const buildDrugCatalogXmlZip = async (items: DrugCatalogRow[]) => {
  const hosConn = await getUTFConnection();
  let hcode = '11101';
  let hospitalName = 'โรงพยาบาลโคกศรีสุพรรณ';
  try {
    const ident = await readHospitalIdentity(hosConn);
    if (ident.hospital_code) hcode = ident.hospital_code;
    if (ident.hospital_name) hospitalName = ident.hospital_name;
  } finally {
    hosConn.release();
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyymmdd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const dtIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const itemLines = items.map((it) =>
    [
      it.HospDrugCode, it.ProductCat, it.TMTID, it.SpecPrep, it.GenericName, it.TradeName,
      it.DFSCode, it.DosageForm, it.Strength, it.Content, it.UnitPrice.toFixed(2),
      it.Distributor, it.Manufacturer, it.ISED, it.NDC24, it.Packsize, it.Packprice,
      it.UpdateFlag, it.DateChange, it.DateUpdate, it.DateEffective, it.DateExpiry,
    ].map((f) => String(f ?? '').replace(/[|\r\n]/g, ' ').trim()).join('|')
  ).join('\r\n');

  const docBody =
    `<?xml version="1.0" encoding="windows-874"?>\r\n` +
    `<DrugCatalogue Version="1.0">\r\n` +
    `<Header>\r\n` +
    `<HCODE>${xmlEsc(hcode)}</HCODE>\r\n` +
    `<HNAME>${xmlEsc(hospitalName)}</HNAME>\r\n` +
    `<DATETIME>${dtIso}</DATETIME>\r\n` +
    `<RECCOUNT>${items.length}</RECCOUNT>\r\n` +
    `</Header>\r\n` +
    `<Items>\r\n${itemLines}\r\n</Items>\r\n` +
    `</DrugCatalogue>\r\n`;

  const cp874 = iconv.encode(docBody, 'cp874');
  const checksum = crypto.createHash('md5').update(cp874).digest('hex');
  const finalBuf = iconv.encode(`${docBody}<?EndNote Checksum="${checksum}"?>`, 'cp874');

  const xmlName = `DrugCatalog_${hcode}_${yyyymmdd}.xml`;
  const zipName = `${hcode}_DrugCatalog_${yyyymmdd}.zip`;
  const zip = new AdmZip();
  zip.addFile(xmlName, finalBuf);

  return { buffer: zip.toBuffer(), filename: zipName, hcode, yyyymmdd };
};
