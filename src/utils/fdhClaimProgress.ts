export type FdhClaimProgressStage =
    | 'no-data'
    | 'prepare-data'
    | 'ready-to-submit'
    | 'partially-submitted'
    | 'rep-correction'
    | 'awaiting-rep'
    | 'awaiting-statement'
    | 'completed';

export interface FdhClaimProgress {
    total: number;
    ready: number;
    submitted: number;
    notSubmitted: number;
    readyNotSubmitted: number;
    needsFixNotSubmitted: number;
    submittedButIncomplete: number;
    repReceived: number;
    repErrors: number;
    statementReceived: number;
    coveragePercent: number;
    isFullySubmitted: boolean;
    stage: FdhClaimProgressStage;
    stageTitle: string;
    stageDescription: string;
}

type FdhTrackingRow = Record<string, unknown>;

const hasValue = (value: unknown) => String(value ?? '').trim() !== '';
const flag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'Y' || value === 'y';

export const isMissingFdhStatus = (value: unknown) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === ''
        || normalized.includes('ไม่พบ')
        || normalized.includes('ยังไม่ส่ง')
        || normalized.includes('not found')
        || normalized.includes('no data');
};

/**
 * ClaimDetail imported from FDH is the strongest evidence. A non-empty status
 * from track_trans also counts, except explicit "not found" responses.
 */
export const hasFdhSubmissionData = (row: FdhTrackingRow) => {
    if (flag(row.has_fdh_import) || hasValue(row.fdh_import_upload_uid) || hasValue(row.fdh_import_sent_at)) {
        return true;
    }
    if (
        hasValue(row.fdh_stm_period)
        || hasValue(row.fdh_settle_at)
        || (row.fdh_act_amt != null && row.fdh_act_amt !== '')
    ) {
        return true;
    }
    return !isMissingFdhStatus(row.fdh_claim_status_message);
};

const hasMeaningfulCode = (value: unknown) => {
    const normalized = String(value ?? '').trim().toUpperCase();
    return !['', '-', '--', '0', 'N/A', 'NA', 'NONE', 'NULL'].includes(normalized);
};

export const buildFdhClaimProgress = (
    rows: FdhTrackingRow[],
    isReady: (row: FdhTrackingRow) => boolean,
): FdhClaimProgress => {
    const total = rows.length;
    const ready = rows.filter(isReady).length;
    const submittedRows = rows.filter(hasFdhSubmissionData);
    const submitted = submittedRows.length;
    const notSubmitted = total - submitted;
    const readyNotSubmitted = rows.filter((row) => isReady(row) && !hasFdhSubmissionData(row)).length;
    const needsFixNotSubmitted = rows.filter((row) => !isReady(row) && !hasFdhSubmissionData(row)).length;
    const submittedButIncomplete = rows.filter((row) => !isReady(row) && hasFdhSubmissionData(row)).length;
    const repRows = submittedRows.filter((row) => flag(row.has_rep_import));
    const repReceived = repRows.length;
    const repErrors = repRows.filter((row) => (
        hasMeaningfulCode(row.rep_errorcode) || hasMeaningfulCode(row.rep_verifycode)
    )).length;
    const statementReceived = submittedRows.filter((row) => (
        flag(row.has_stm_import)
        || flag(row.has_inv_import)
        || hasValue(row.fdh_settle_at)
    )).length;
    const coveragePercent = total > 0 ? Math.round((submitted / total) * 1000) / 10 : 0;
    const isFullySubmitted = total > 0 && submitted === total;

    let stage: FdhClaimProgressStage;
    let stageTitle: string;
    let stageDescription: string;

    if (total === 0) {
        stage = 'no-data';
        stageTitle = 'ยังไม่มีรายการให้เปรียบเทียบ';
        stageDescription = 'ไม่พบรายการเข้าเกณฑ์ในกองทุนและช่วงวันที่เลือก';
    } else if (submitted === 0 && ready === 0) {
        stage = 'prepare-data';
        stageTitle = 'ขั้นตรวจและแก้ข้อมูล';
        stageDescription = `พบ ${total} รายการ แต่ยังไม่มีรายการพร้อมส่ง FDH`;
    } else if (submitted === 0) {
        stage = 'ready-to-submit';
        stageTitle = 'พร้อมส่ง FDH';
        stageDescription = `มี ${readyNotSubmitted} รายการพร้อมส่ง แต่ยังไม่พบข้อมูลจาก FDH`;
    } else if (submitted < total) {
        stage = 'partially-submitted';
        stageTitle = 'ส่ง FDH แล้วบางส่วน';
        stageDescription = `พบข้อมูล FDH ${submitted} จาก ${total} รายการ ยังไม่พบ ${notSubmitted} รายการ`;
    } else if (repErrors > 0) {
        stage = 'rep-correction';
        stageTitle = 'ได้รับ REP และมีรายการต้องแก้';
        stageDescription = `ส่ง FDH ครบแล้ว แต่พบ REP ติด C/D ${repErrors} รายการ`;
    } else if (repReceived < submitted) {
        stage = 'awaiting-rep';
        stageTitle = 'ส่ง FDH ครบแล้ว • รอ REP';
        stageDescription = `ส่งครบ ${submitted} รายการ ได้รับ REP แล้ว ${repReceived} รายการ`;
    } else if (statementReceived < submitted) {
        stage = 'awaiting-statement';
        stageTitle = 'ได้รับ REP ครบ • รอ STM/INV';
        stageDescription = `ได้รับ REP ครบ ${repReceived} รายการ พบ STM/INV แล้ว ${statementReceived} รายการ`;
    } else {
        stage = 'completed';
        stageTitle = 'ครบถึงขั้น STM/INV';
        stageDescription = `รายการทั้ง ${submitted} รายการมีข้อมูล FDH, REP และ STM/INV แล้ว`;
    }

    return {
        total,
        ready,
        submitted,
        notSubmitted,
        readyNotSubmitted,
        needsFixNotSubmitted,
        submittedButIncomplete,
        repReceived,
        repErrors,
        statementReceived,
        coveragePercent,
        isFullySubmitted,
        stage,
        stageTitle,
        stageDescription,
    };
};
