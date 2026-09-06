import iconv from 'iconv-lite';

export const FDH_FILE_CODES = [
  'INS', 'PAT', 'OPD', 'ORF', 'ODX', 'OOP', 'IPD', 'IRF',
  'IDX', 'IOP', 'CHT', 'CHA', 'AER', 'ADP', 'LVD', 'DRU',
] as const;

export type FdhFileCode = typeof FDH_FILE_CODES[number];
export type FdhExportProfile = 'standard' | 'fwf-migrants';
export type FdhPatientType = 'ALL' | 'OPD' | 'IPD';
export type FdhRow = Record<string, unknown>;
export type FdhExportData = Record<FdhFileCode, FdhRow[]>;

export interface FdhOopConsolidationResult {
  rows: FdhRow[];
  duplicateGroups: number;
  mergedRows: number;
}

export interface FdhValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  file?: FdhFileCode;
  row?: number;
  field?: string;
  key?: string;
  message: string;
}

export interface FdhValidationResult {
  valid: boolean;
  profile: FdhExportProfile;
  counts: Record<FdhFileCode, number>;
  errors: FdhValidationIssue[];
  warnings: FdhValidationIssue[];
  totalRows: number;
}

const STANDARD_LAYOUTS: Record<FdhFileCode, string[]> = {
  INS: ['HN', 'INSCL', 'SUBTYPE', 'CID', 'DATEIN', 'DATEEXP', 'HOSPMAIN', 'HOSPSUB', 'GOVCODE', 'GOVNAME', 'PERMITNO', 'DOCNO', 'OWNRPID', 'OWNNAME', 'AN', 'SEQ', 'SUBINSCL', 'RELINSCL', 'HTYPE'],
  PAT: ['HCODE', 'HN', 'CHANGWAT', 'AMPHUR', 'DOB', 'SEX', 'MARRIAGE', 'OCCUPA', 'NATION', 'PERSON_ID', 'NAMEPAT', 'TITLE', 'FNAME', 'LNAME', 'IDTYPE'],
  OPD: ['HN', 'CLINIC', 'DATEOPD', 'TIMEOPD', 'SEQ', 'UUC', 'DETAIL', 'BTEMP', 'SBP', 'DBP', 'PR', 'RR', 'OPTYPE', 'TYPEIN', 'TYPEOUT'],
  ORF: ['HN', 'DATEOPD', 'CLINIC', 'REFER', 'REFERTYPE', 'SEQ', 'REFERDATE'],
  ODX: ['HN', 'DATEDX', 'CLINIC', 'DIAG', 'DXTYPE', 'DRDX', 'PERSON_ID', 'SEQ'],
  OOP: ['HN', 'DATEOPD', 'CLINIC', 'OPER', 'DROPID', 'PERSON_ID', 'SEQ', 'SERVPRICE'],
  IPD: ['HN', 'AN', 'DATEADM', 'TIMEADM', 'DATEDSC', 'TIMEDSC', 'DISCHS', 'DISCHT', 'WARDDSC', 'DEPT', 'ADM_W', 'UUC', 'SVCTYPE'],
  IRF: ['AN', 'REFER', 'REFERTYPE'],
  IDX: ['AN', 'DIAG', 'DXTYPE', 'DRDX'],
  IOP: ['AN', 'OPER', 'OPTYPE', 'DROPID', 'DATEIN', 'TIMEIN', 'DATEOUT', 'TIMEOUT'],
  CHT: ['HN', 'AN', 'DATE', 'TOTAL', 'PAID', 'PTTYPE', 'PERSON_ID', 'SEQ', 'OPD_MEMO', 'INVOICE_NO', 'INVOICE_LT'],
  CHA: ['HN', 'AN', 'DATE', 'CHRGITEM', 'AMOUNT', 'PERSON_ID', 'SEQ'],
  AER: ['HN', 'AN', 'DATEOPD', 'AUTHAE', 'AEDATE', 'AETIME', 'AETYPE', 'REFER_NO', 'REFMAINI', 'IREFTYPE', 'REFMAINO', 'OREFTYPE', 'UCAE', 'EMTYPE', 'SEQ', 'AESTATUS', 'DALERT', 'TALERT'],
  ADP: ['HN', 'AN', 'DATEOPD', 'TYPE', 'CODE', 'QTY', 'RATE', 'SEQ', 'CAGCODE', 'DOSE', 'CA_TYPE', 'SERIALNO', 'TOTCOPAY', 'USE_STATUS', 'TOTAL', 'QTYDAY', 'TMLTCODE', 'STATUS1', 'BI', 'CLINIC', 'ITEMSRC', 'PROVIDER', 'GRAVIDA', 'GA_WEEK', 'DCIP/E_screen', 'LMP', 'SP_ITEM'],
  LVD: ['SEQLVD', 'AN', 'DATEOUT', 'TIMEOUT', 'DATEIN', 'TIMEIN', 'QTYDAY'],
  DRU: ['HCODE', 'HN', 'AN', 'CLINIC', 'PERSON_ID', 'DATE_SERV', 'DID', 'DIDNAME', 'AMOUNT', 'DRUGPRIC', 'DRUGCOST', 'DIDSTD', 'UNIT', 'UNIT_PACK', 'SEQ', 'DRUGTYPE', 'DRUGREMARK', 'PA_NO', 'TOTCOPAY', 'USE_STATUS', 'TOTAL', 'SIGCODE', 'SIGTEXT', 'PROVIDER'],
};

const FWF_LAYOUTS: Record<FdhFileCode, string[]> = {
  ...STANDARD_LAYOUTS,
  INS: ['HN', 'INSCL', 'SUBTYPE', 'CID', 'HCODE', 'DATEEXP', 'HOSPMAIN', 'HOSPSUB', 'GOVCODE', 'GOVNAME', 'PERMITNO', 'DOCNO', 'OWNRPID', 'OWNNAME', 'AN', 'SEQ', 'SUBINSCL', 'RELINSCL', 'HTYPE'],
};

export const getFdhLayouts = (profile: FdhExportProfile): Record<FdhFileCode, string[]> => (
  profile === 'fwf-migrants' ? FWF_LAYOUTS : STANDARD_LAYOUTS
);

export const normalizeFdhProfile = (value: unknown): FdhExportProfile => (
  String(value || '').trim().toLowerCase() === 'fwf-migrants' ? 'fwf-migrants' : 'standard'
);

export const normalizePipeValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n|]/g, ' ')
    .replace(/"/g, '')
    .trim();
};

export const projectFdhData = (data: Partial<FdhExportData>, profile: FdhExportProfile): FdhExportData => {
  const layouts = getFdhLayouts(profile);
  return Object.fromEntries(FDH_FILE_CODES.map((file) => [
    file,
    (Array.isArray(data[file]) ? data[file] : []).map((row) => Object.fromEntries(
      layouts[file].map((field) => [field, row?.[field] ?? '']),
    )),
  ])) as FdhExportData;
};

export const consolidateFdhOopRows = (input: FdhRow[]): FdhOopConsolidationResult => {
  const selected = new Map<string, { row: FdhRow; priority: number; occurrences: number }>();

  input.forEach((sourceRow, index) => {
    const { _SOURCE_PRIORITY: rawPriority, ...row } = sourceRow;
    const naturalKeyParts = ['HN', 'SEQ', 'OPER'].map((field) => normalizePipeValue(row[field]));
    const hasNaturalKey = naturalKeyParts.every(Boolean);
    const key = hasNaturalKey ? naturalKeyParts.join('|') : `__invalid_row_${index}`;
    const priority = Number.isFinite(Number(rawPriority)) ? Number(rawPriority) : 0;
    const current = selected.get(key);

    if (!current) {
      selected.set(key, { row, priority, occurrences: 1 });
      return;
    }

    current.occurrences += 1;
    const currentProvider = normalizePipeValue(current.row.DROPID);
    const candidateProvider = normalizePipeValue(row.DROPID);
    if (priority > current.priority || (priority === current.priority && !currentProvider && candidateProvider)) {
      current.row = row;
      current.priority = priority;
    }
  });

  let duplicateGroups = 0;
  let mergedRows = 0;
  selected.forEach((entry) => {
    if (entry.occurrences > 1) {
      duplicateGroups += 1;
      mergedRows += entry.occurrences - 1;
    }
  });

  return {
    rows: [...selected.values()].map((entry) => entry.row),
    duplicateGroups,
    mergedRows,
  };
};

export const scopeFdhData = (input: Partial<FdhExportData>, patientType: FdhPatientType): FdhExportData => {
  const data = Object.fromEntries(FDH_FILE_CODES.map((file) => [file, Array.isArray(input[file]) ? input[file]! : []])) as FdhExportData;
  if (patientType === 'IPD') {
    return { ...data, OPD: [], ORF: [], ODX: [], OOP: [] };
  }
  if (patientType === 'OPD') {
    return { ...data, IPD: [], IRF: [], IDX: [], IOP: [], LVD: [] };
  }
  return data;
};

export const serializeFdhFile = (
  data: Partial<FdhExportData>,
  file: FdhFileCode,
  profile: FdhExportProfile,
  includeHeader = true,
): string => {
  const columns = getFdhLayouts(profile)[file];
  const rows = Array.isArray(data[file]) ? data[file]! : [];
  const header = includeHeader ? columns.join('|') : '';
  const body = rows.map((row) => columns.map((column) => normalizePipeValue(row?.[column])).join('|')).join('\r\n');
  if (!body) return header;
  return includeHeader ? `${header}\r\n${body}` : body;
};

export interface FdhFilePayload {
  code: FdhFileCode;
  filename: string;
  rowCount: number;
  content: Buffer;
}

export const buildFdhFiles = (
  data: Partial<FdhExportData>,
  profile: FdhExportProfile,
  includeHeader = true,
  encoding = 'utf8',
): FdhFilePayload[] => FDH_FILE_CODES.map((code) => {
  const text = serializeFdhFile(data, code, profile, includeHeader);
  const normalizedEncoding = String(encoding || 'utf8').trim().toLowerCase();
  const content = normalizedEncoding === 'cp874' || normalizedEncoding === 'tis620'
    ? iconv.encode(text, 'cp874')
    : Buffer.from(text, 'utf8');
  return { code, filename: `${code}.txt`, rowCount: data[code]?.length || 0, content };
});

const REQUIRED_FIELDS: Partial<Record<FdhFileCode, string[]>> = {
  INS: ['HN', 'INSCL', 'CID', 'HOSPMAIN', 'HOSPSUB', 'SEQ'],
  PAT: ['HCODE', 'HN', 'DOB', 'SEX', 'MARRIAGE', 'OCCUPA', 'NATION', 'PERSON_ID', 'NAMEPAT', 'TITLE', 'FNAME', 'LNAME', 'IDTYPE'],
  OPD: ['HN', 'CLINIC', 'DATEOPD', 'TIMEOPD', 'SEQ', 'UUC', 'TYPEIN'],
  IPD: ['HN', 'AN', 'DATEADM', 'TIMEADM', 'DATEDSC', 'TIMEDSC', 'DISCHS', 'DISCHT', 'WARDDSC', 'DEPT', 'UUC', 'SVCTYPE'],
  ORF: ['HN', 'DATEOPD', 'CLINIC', 'REFER', 'REFERTYPE', 'SEQ', 'REFERDATE'],
  ODX: ['HN', 'DATEDX', 'CLINIC', 'DIAG', 'DXTYPE', 'SEQ'],
  OOP: ['HN', 'DATEOPD', 'CLINIC', 'OPER', 'SEQ'],
  IRF: ['AN', 'REFER', 'REFERTYPE'],
  IDX: ['AN', 'DIAG', 'DXTYPE'],
  IOP: ['AN', 'OPER', 'OPTYPE', 'DATEIN', 'TIMEIN', 'DATEOUT', 'TIMEOUT'],
  CHT: ['HN', 'DATE', 'TOTAL', 'PAID', 'PTTYPE', 'PERSON_ID', 'SEQ', 'INVOICE_NO'],
  CHA: ['HN', 'DATE', 'CHRGITEM', 'AMOUNT', 'PERSON_ID', 'SEQ'],
  AER: ['HN', 'DATEOPD', 'SEQ'],
  ADP: ['HN', 'DATEOPD', 'TYPE', 'CODE', 'QTY', 'RATE', 'SEQ', 'TOTAL'],
  LVD: ['SEQLVD', 'AN', 'DATEOUT', 'TIMEOUT', 'DATEIN', 'TIMEIN', 'QTYDAY'],
  DRU: ['HCODE', 'HN', 'CLINIC', 'PERSON_ID', 'DATE_SERV', 'DID', 'DIDNAME', 'AMOUNT', 'DRUGPRIC', 'UNIT', 'SEQ', 'USE_STATUS', 'TOTAL'],
};

const DATE_FIELDS = new Set(['DATEIN', 'DATEEXP', 'DOB', 'DATEOPD', 'DATEDX', 'DATEADM', 'DATEDSC', 'DATE', 'AEDATE', 'DATEOUT', 'DATE_SERV', 'REFERDATE', 'LMP']);
const TIME_FIELDS = new Set(['TIMEOPD', 'TIMEADM', 'TIMEDSC', 'AETIME', 'TIMEIN', 'TIMEOUT']);
const value = (row: FdhRow, field: string) => normalizePipeValue(row[field]);
const keyOf = (row: FdhRow, fields: string[]) => fields.map((field) => value(row, field)).join('|');
const money = (input: unknown) => Number.parseFloat(normalizePipeValue(input) || '0');
const isValidHcode = (input: unknown) => {
  const hcode = normalizePipeValue(input);
  return /^\d{5}$/.test(hcode) && hcode !== '00000';
};
const isCalendarDate = (text: string) => {
  if (!/^\d{8}$/.test(text)) return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const UNIQUE_FIELDS: Record<FdhFileCode, string[]> = {
  INS: ['HN', 'SEQ'], PAT: ['HCODE', 'HN'], OPD: ['HN', 'SEQ'],
  ORF: ['HN', 'SEQ', 'REFER', 'REFERTYPE'], ODX: ['HN', 'SEQ', 'DIAG', 'DXTYPE'],
  OOP: ['HN', 'SEQ', 'OPER'], IPD: ['AN'], IRF: ['AN', 'REFER', 'REFERTYPE'],
  IDX: ['AN', 'DIAG', 'DXTYPE'], IOP: ['AN', 'OPER', 'DATEIN', 'TIMEIN'],
  CHT: ['HN', 'AN', 'SEQ'], CHA: ['HN', 'AN', 'SEQ', 'CHRGITEM'],
  AER: ['HN', 'AN', 'SEQ'], ADP: ['HN', 'AN', 'SEQ', 'TYPE', 'CODE', 'RATE'],
  LVD: ['AN', 'SEQLVD'], DRU: ['HN', 'AN', 'SEQ', 'DID', 'DRUGPRIC'],
};

export const validateFdhData = (
  input: Partial<FdhExportData>,
  profile: FdhExportProfile,
  expectedHcode?: string,
): FdhValidationResult => {
  const data = projectFdhData(input, profile);
  const errors: FdhValidationIssue[] = [];
  const warnings: FdhValidationIssue[] = [];
  const add = (issue: Omit<FdhValidationIssue, 'severity'>, severity: 'error' | 'warning' = 'error') => {
    (severity === 'error' ? errors : warnings).push({ ...issue, severity });
  };
  const counts = Object.fromEntries(FDH_FILE_CODES.map((file) => [file, data[file].length])) as Record<FdhFileCode, number>;

  for (const requiredFile of ['INS', 'PAT', 'CHT'] as FdhFileCode[]) {
    if (!counts[requiredFile]) add({ code: 'REQUIRED_FILE', file: requiredFile, message: `แฟ้ม ${requiredFile} ต้องมีข้อมูลอย่างน้อย 1 แถว` });
  }
  if (!counts.OPD && !counts.IPD) add({ code: 'OPD_OR_IPD_REQUIRED', message: 'ต้องมีข้อมูลแฟ้ม OPD หรือ IPD อย่างน้อยหนึ่งแฟ้ม' });

  const dependencies: Array<[FdhFileCode, FdhFileCode]> = [
    ['ORF', 'OPD'], ['ODX', 'OPD'], ['OOP', 'OPD'],
    ['IRF', 'IPD'], ['IDX', 'IPD'], ['IOP', 'IPD'], ['LVD', 'IPD'],
  ];
  dependencies.forEach(([child, parent]) => {
    if (counts[child] && !counts[parent]) add({ code: 'FILE_DEPENDENCY', file: child, message: `แฟ้ม ${child} ต้องส่งพร้อมแฟ้ม ${parent}` });
  });

  FDH_FILE_CODES.forEach((file) => {
    const seen = new Set<string>();
    data[file].forEach((row, index) => {
      const requiredFields = [
        ...(REQUIRED_FIELDS[file] || []),
        ...(file === 'INS' ? [profile === 'fwf-migrants' ? 'HCODE' : 'DATEIN'] : []),
      ];
      for (const field of requiredFields) {
        if (!value(row, field)) add({ code: 'REQUIRED_FIELD', file, row: index + 1, field, message: `${file} แถว ${index + 1}: ${field} ห้ามว่าง` });
      }
      for (const [field, raw] of Object.entries(row)) {
        const text = normalizePipeValue(raw);
        if (!text) continue;
        if (DATE_FIELDS.has(field) && !isCalendarDate(text)) add({ code: 'DATE_FORMAT', file, row: index + 1, field, message: `${file} แถว ${index + 1}: ${field} ต้องเป็นวันที่จริงในรูปแบบ YYYYMMDD` });
        if (TIME_FIELDS.has(field) && !/^([01]\d|2[0-3])[0-5]\d$/.test(text)) add({ code: 'TIME_FORMAT', file, row: index + 1, field, message: `${file} แถว ${index + 1}: ${field} ต้องเป็น HHMM` });
      }
      const uniqueFields = UNIQUE_FIELDS[file];
      const naturalKey = keyOf(row, uniqueFields);
      if (uniqueFields.every((field) => value(row, field))) {
        if (seen.has(naturalKey)) add({ code: 'DUPLICATE_ROW', file, row: index + 1, key: naturalKey, message: `${file} มีข้อมูลซ้ำที่คีย์ ${naturalKey}` });
        seen.add(naturalKey);
      }
    });
  });

  const patHn = new Set(data.PAT.map((row) => value(row, 'HN')));
  const insKeys = new Set(data.INS.map((row) => keyOf(row, ['HN', 'SEQ'])));
  const opdKeys = new Set(data.OPD.map((row) => keyOf(row, ['HN', 'SEQ'])));
  const ipdAn = new Set(data.IPD.map((row) => value(row, 'AN')));
  const chtKeys = new Set(data.CHT.map((row) => keyOf(row, ['HN', 'SEQ'])));

  data.INS.forEach((row, index) => {
    const hn = value(row, 'HN');
    const inscl = value(row, 'INSCL').toUpperCase();
    if (profile === 'standard' && ['UCS', 'WEL', 'OFC', 'LGO'].includes(inscl) && !value(row, 'PERMITNO')) {
      add({
        code: 'PERMITNO_REQUIRED',
        file: 'INS',
        row: index + 1,
        field: 'PERMITNO',
        key: keyOf(row, ['HN', 'SEQ']),
        message: `INS แถว ${index + 1}: HN ${hn}, VN/SEQ ${value(row, 'SEQ')} สิทธิ ${inscl} ต้องมี Claim/Auth/Approve code ใน PERMITNO`,
      });
    }
    if (!patHn.has(hn)) add({ code: 'INS_PAT_LINK', file: 'INS', row: index + 1, key: hn, message: `INS HN ${hn} ไม่พบใน PAT` });
    if (profile === 'fwf-migrants') {
      if (value(row, 'INSCL') !== 'FWF') add({ code: 'FWF_INSCL', file: 'INS', row: index + 1, field: 'INSCL', message: 'FWF Migrants กำหนด INSCL เป็น FWF' });
      if (!value(row, 'CID')) add({ code: 'FWF_FCODE', file: 'INS', row: index + 1, field: 'CID', message: `HN ${hn} ยังไม่มี FCode จาก FDH-Migrants` });
      if (Buffer.byteLength(value(row, 'CID'), 'utf8') > 16) add({ code: 'FWF_FCODE_LENGTH', file: 'INS', row: index + 1, field: 'CID', message: `HN ${hn}: FCode ต้องยาวไม่เกิน 16 bytes` });
      if (!isValidHcode(value(row, 'HCODE'))) add({ code: 'FWF_HCODE', file: 'INS', row: index + 1, field: 'HCODE', message: 'HCODE ต้องเป็นตัวเลข 5 หลักและห้ามเป็น 00000' });
    }
  });

  data.PAT.forEach((row, index) => {
    const hcode = value(row, 'HCODE');
    if (!isValidHcode(hcode)) add({ code: 'HCODE_FORMAT', file: 'PAT', row: index + 1, field: 'HCODE', message: 'PAT.HCODE ต้องเป็นตัวเลข 5 หลักและห้ามเป็น 00000' });
    if (expectedHcode && hcode !== expectedHcode) add({ code: 'HCODE_MISMATCH', file: 'PAT', row: index + 1, field: 'HCODE', message: `PAT HCODE ${hcode || '(ว่าง)'} ไม่ตรงกับหน่วยบริการ ${expectedHcode}` });
  });
  data.DRU.forEach((row, index) => {
    const hcode = value(row, 'HCODE');
    if (!isValidHcode(hcode)) add({ code: 'HCODE_FORMAT', file: 'DRU', row: index + 1, field: 'HCODE', message: 'DRU.HCODE ต้องเป็นตัวเลข 5 หลักและห้ามเป็น 00000' });
    if (expectedHcode && hcode !== expectedHcode) add({ code: 'HCODE_MISMATCH', file: 'DRU', row: index + 1, field: 'HCODE', message: `DRU HCODE ${hcode || '(ว่าง)'} ไม่ตรงกับหน่วยบริการ ${expectedHcode}` });
  });

  data.OPD.forEach((row, index) => {
    const key = keyOf(row, ['HN', 'SEQ']);
    if (!insKeys.has(key)) add({ code: 'OPD_INS_LINK', file: 'OPD', row: index + 1, key, message: `OPD ${key} ไม่พบ HN/SEQ ใน INS` });
    if (!chtKeys.has(key)) add({ code: 'OPD_CHT_LINK', file: 'OPD', row: index + 1, key, message: `OPD ${key} ไม่พบ HN/SEQ ใน CHT` });
  });
  const opdByKey = new Map(data.OPD.map((row) => [keyOf(row, ['HN', 'SEQ']), row]));
  data.AER.forEach((row, index) => {
    if (value(row, 'AN')) return;
    const optype = value(opdByKey.get(keyOf(row, ['HN', 'SEQ'])) || {}, 'OPTYPE');
    const ucae = value(row, 'UCAE');
    if (!['0', '1', '2', '3'].includes(optype)) {
      add({
        code: 'AER_OPTYPE_INVALID',
        file: 'AER',
        row: index + 1,
        field: 'UCAE',
        message: `AER แถว ${index + 1}: มีข้อมูล AER แต่ OPD.OPTYPE ไม่ใช่ Refer/Accident/Emergency`,
      });
    }
    if (['2', '3'].includes(optype) && !ucae) {
      add({ code: 'AER_UCAE_REQUIRED', file: 'AER', row: index + 1, field: 'UCAE', message: `AER แถว ${index + 1}: OPTYPE ${optype} ต้องระบุ UCAE` });
    }
    if (['0', '1'].includes(optype) && ucae) {
      add({ code: 'AER_UCAE_REFER', file: 'AER', row: index + 1, field: 'UCAE', message: `AER แถว ${index + 1}: OPTYPE ${optype} ควรเว้น UCAE ตามคู่มือ` }, 'warning');
    }
  });
  data.IPD.forEach((row, index) => {
    const an = value(row, 'AN');
    const hn = value(row, 'HN');
    if (!data.INS.some((ins) => value(ins, 'HN') === hn && value(ins, 'AN') === an)) add({ code: 'IPD_INS_LINK', file: 'IPD', row: index + 1, key: an, message: `IPD AN ${an} ไม่พบใน INS` });
    if (!data.CHT.some((cht) => value(cht, 'HN') === hn && value(cht, 'AN') === an)) add({ code: 'IPD_CHT_LINK', file: 'IPD', row: index + 1, key: an, message: `IPD AN ${an} ไม่พบใน CHT` });
  });

  for (const file of ['ORF', 'ODX', 'OOP', 'AER', 'ADP', 'CHA', 'DRU'] as FdhFileCode[]) {
    data[file].forEach((row, index) => {
      const key = keyOf(row, ['HN', 'SEQ']);
      if (!opdKeys.has(key) && !value(row, 'AN')) add({ code: 'OPD_LINK', file, row: index + 1, key, message: `${file} ${key} ไม่พบ HN/SEQ ใน OPD` });
    });
  }
  for (const file of ['IRF', 'IDX', 'IOP', 'LVD'] as FdhFileCode[]) {
    data[file].forEach((row, index) => {
      const an = value(row, 'AN');
      if (!ipdAn.has(an)) add({ code: 'IPD_LINK', file, row: index + 1, key: an, message: `${file} AN ${an} ไม่พบใน IPD` });
    });
  }

  const chaTotals = new Map<string, number>();
  data.CHA.forEach((row) => {
    const key = keyOf(row, ['HN', 'AN', 'SEQ']);
    chaTotals.set(key, (chaTotals.get(key) || 0) + money(row.AMOUNT));
  });
  data.CHT.forEach((row, index) => {
    const key = keyOf(row, ['HN', 'AN', 'SEQ']);
    const detailTotal = chaTotals.get(key);
    if (detailTotal == null) add({ code: 'CHT_CHA_LINK', file: 'CHT', row: index + 1, key, message: `CHT ${key} ไม่พบรายละเอียดใน CHA` });
    else if (Math.abs(money(row.TOTAL) - detailTotal) > 0.01) add({ code: 'CHT_CHA_TOTAL', file: 'CHT', row: index + 1, key, message: `ยอด CHT ${money(row.TOTAL).toFixed(2)} ไม่เท่ากับผลรวม CHA ${detailTotal.toFixed(2)}` });
  });
  const invoiceOwners = new Map<string, string>();
  data.CHT.forEach((row, index) => {
    const invoiceNo = value(row, 'INVOICE_NO');
    const owner = keyOf(row, ['HN', 'AN', 'SEQ']);
    const existingOwner = invoiceOwners.get(invoiceNo);
    if (invoiceNo && existingOwner && existingOwner !== owner) {
      add({ code: 'DUPLICATE_INVOICE_NO', file: 'CHT', row: index + 1, field: 'INVOICE_NO', key: invoiceNo, message: `CHT.INVOICE_NO ${invoiceNo} ซ้ำกับเคสอื่น` });
    }
    if (invoiceNo) invoiceOwners.set(invoiceNo, owner);
  });

  data.IOP.forEach((row, index) => {
    if (value(row, 'OPER').length > 8) add({ code: 'IOP_OPER_LENGTH', file: 'IOP', row: index + 1, field: 'OPER', message: 'IOP.OPER ต้องยาวไม่เกิน 8 ตัวอักษร' });
  });
  data.ADP.forEach((row, index) => {
    const code = value(row, 'CODE');
    if (profile === 'standard' && code.startsWith('UNMAPPED:')) {
      add({
        code: 'ADP_ITEM_MAPPING',
        file: 'ADP',
        row: index + 1,
        field: 'CODE',
        key: code.replace(/^UNMAPPED:/, ''),
        message: `รายการ HOSxP ${code.replace(/^UNMAPPED:/, '')} ยังไม่มีรหัส ADP ที่กองทุนกำหนด`,
      });
    }
  });
  data.DRU.forEach((row, index) => {
    if (money(row.DRUGPRIC) <= 0) add({ code: 'DRUG_PRICE', file: 'DRU', row: index + 1, field: 'DRUGPRIC', message: 'DRUGPRIC ต้องมากกว่า 0' });
    if (!['1', '2', '3', '4'].includes(value(row, 'USE_STATUS'))) add({ code: 'DRUG_USE_STATUS', file: 'DRU', row: index + 1, field: 'USE_STATUS', message: 'DRU.USE_STATUS ต้องเป็น 1, 2, 3 หรือ 4' });
    if (!value(row, 'DIDSTD')) add({ code: 'DRUG_CATALOG', file: 'DRU', row: index + 1, field: 'DIDSTD', message: `ยา ${value(row, 'DID')} ยังไม่มีรหัสมาตรฐาน Drug Catalog` }, 'warning');
  });
  if (profile === 'fwf-migrants') {
    data.ADP.forEach((row, index) => {
      const code = value(row, 'CODE');
      if (!code || code.startsWith('UNMAPPED:')) {
        add({
          code: 'FWF_ITEM_MAPPING',
          file: 'ADP',
          row: index + 1,
          field: 'CODE',
          key: code.replace(/^UNMAPPED:/, ''),
          message: `รายการ HOSxP ${code.replace(/^UNMAPPED:/, '') || '(ไม่ทราบรหัส)'} ยังไม่ได้จับคู่กับ fwf_item`,
        });
      }
    });
  }

  return {
    valid: errors.length === 0,
    profile,
    counts,
    errors,
    warnings,
    totalRows: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
};

export const selectFdhUploadFiles = (files: FdhFilePayload[]): FdhFilePayload[] => (
  files.filter((file) => file.rowCount > 0)
);

export const uploadFdhFiles = async (
  uploadUrl: string,
  token: string,
  files: FdhFilePayload[],
  timeoutMs = 120_000,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append('type', 'txt');
    files.forEach((file) => {
      form.append('file', new Blob([Uint8Array.from(file.content)], { type: 'text/plain' }), file.filename);
    });
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    });
    const rawText = await response.text();
    let payload: unknown = rawText;
    try { payload = rawText ? JSON.parse(rawText) : {}; } catch { /* preserve text */ }
    return { ok: response.ok, status: response.status, payload, rawText };
  } finally {
    clearTimeout(timeout);
  }
};
