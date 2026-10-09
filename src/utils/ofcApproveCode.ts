import businessRules from '../config/business_rules.json';

type RightRow = { hipdata_code?: unknown; fund?: unknown; pttype?: unknown; hipdata_desc?: unknown };
const codes = new Set([...businessRules.insurance_mapping.OFC_LGO.hipdata_codes, 'OFC', 'LGO', 'CSCD', 'A1'].map((code) => code.toUpperCase()));

export const isLgoRight = (row: RightRow): boolean => {
    const code = String(row.hipdata_code || '').trim().toUpperCase();
    const name = `${row.fund || ''} ${row.pttype || ''} ${row.hipdata_desc || ''}`.toLowerCase();
    return code === 'LGO'
        || /\blgo\b|อปท|องค์กรปกครองส่วนท้องถิ่น|ท้องถิ่น/.test(name);
};

export const isOfcRight = (row: RightRow): boolean => {
    if (isLgoRight(row)) return false;
    const code = String(row.hipdata_code || '').trim().toUpperCase();
    const name = `${row.fund || ''} ${row.pttype || ''} ${row.hipdata_desc || ''}`.toLowerCase();
    return ['OFC', 'CSCD', 'A1'].includes(code)
        || /\b(ofc|cscd)\b|ข้าราชการ|เบิกตรง|เบิกจ่ายตรง|ส่วนราชการ|เบิกหน่วยงาน/.test(name);
};

export const isOfcLgoRight = (row: RightRow) => {
    const code = String(row.hipdata_code || '').trim().toUpperCase();
    const name = `${row.fund || ''} ${row.pttype || ''} ${row.hipdata_desc || ''}`.toLowerCase();
    return codes.has(code)
        || businessRules.insurance_mapping.OFC_LGO.keywords.some((keyword) => name.includes(keyword.toLowerCase()))
        || /\b(ofc|lgo|cscd)\b|ข้าราชการ|เบิกตรง|เบิกจ่ายตรง|อปท|องค์กรปกครองส่วนท้องถิ่น/.test(name);
};

// PP/EP are NHSO authentication/close-right codes, not KTB approval codes.
// Keep leading zeroes; no fixed code length is assumed.
export const hasApproveCode = (value: unknown) => {
    const code = String(value || '').trim();
    return Boolean(code) && !/^(PP|EP)/i.test(code) && !/^0+$/.test(code) && !['-', 'null', 'undefined'].includes(code.toLowerCase());
};

// สิทธิ LGO ไม่ต้องมี approve code มีหรือไม่มีเลขปิดสิทธิ ก็ได้
// เฉพาะสิทธิ OFC/CSCD (ข้าราชการ/เบิกตรงกรมบัญชีกลาง) เท่านั้นที่ต้องรอ Approve code จาก KTB EDC
export const isWaitingOfcApprove = (row: RightRow & { approve_code?: unknown; authen_code?: unknown }): boolean => {
    if (isLgoRight(row)) return false;
    return (isOfcRight(row) || isOfcLgoRight(row)) && !hasApproveCode(row.approve_code ?? row.authen_code);
};
