type Row = Record<string, unknown>;

// Merge the latest imported claim after reading HIS. This avoids a cross-server
// SQL join and keeps the hospital database name independent of the app database.
export function mergeFdhClaimDetails(rows: Row[], details: Row[], patientType: 'OPD' | 'IPD') {
  const key = patientType === 'IPD' ? 'an' : 'vn';
  const latest = new Map(details.map((row) => [String(row[key] ?? ''), row]));
  return rows.map((row) => {
    const detail = latest.get(String(row[key] ?? ''));
    if (!detail) return row;
    const result: Row = {
      ...row,
      fdh_claim_detail_status: detail.claim_status,
      fdh_claim_code: detail.claim_code,
      fdh_upload_uid: detail.upload_uid,
      fdh_status_label: (patientType === 'OPD' && detail.claim_status === '' ? null : detail.claim_status) ?? row.fdh_status_label,
    };
    if (patientType === 'OPD') result.fdh_sent_at = detail.sent_at;
    else {
      result.fdh_claim_detail_sent_at = detail.sent_at;
      result.fdh_transaction_uid = detail.upload_uid ?? row.fdh_transaction_uid;
      result.fdh_reservation_datetime = detail.sent_at ?? row.fdh_reservation_datetime;
      if (detail.sent_at != null && row.dchdate != null) {
        const sent = String(detail.sent_at_day ?? detail.sent_at).slice(0, 10);
        const discharged = String(row.dchdate).slice(0, 10);
        result.fdh_days_from_discharge = Math.trunc((Date.parse(`${sent}T00:00:00Z`) - Date.parse(`${discharged}T00:00:00Z`)) / 86400000);
        result.fdh_days_note = 'ส่ง FDH แล้ว';
      }
    }
    return result;
  });
}
