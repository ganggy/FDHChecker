---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/duplicateAppointmentAlert.ts"
source_hash: "2ef30ac65a63390e23fe930dd87fc1bff27eb17f54b7594dc2ff15ed2b2108b3"
managed_by: "sync-ksp-vault"
---
# duplicateAppointmentAlert.ts

> Source: `server/duplicateAppointmentAlert.ts`
> SHA-256: `2ef30ac65a63390e23fe930dd87fc1bff27eb17f54b7594dc2ff15ed2b2108b3`

````typescript
import { getAppSetting, getUTFConnection, setAppSetting } from './db.js';
import { getBangkokDateTime } from './dailyWorkOverview.js';
import { pushLineMessages, type LineMessage } from './lineMessaging.js';

export type AppointmentItem = {
  appointmentId: number;
  hn: string;
  nextDate: string;
  nextTime: string;
  clinicCode: string;
  clinicName: string;
  departmentCode: string;
  departmentName: string;
  cause: string;
};

export type DuplicateAppointment = {
  hn: string;
  appointments: AppointmentItem[];
};

export type DuplicateAppointmentReport = {
  appointmentDate: string;
  duplicatePatients: DuplicateAppointment[];
  appointmentCount: number;
};

const ALERT_STATE_KEY = 'line_duplicate_appointment_alert_state';
const text = (value: unknown) => String(value ?? '').trim();
const num = (value: unknown) => Number(value || 0);
const cleanCause = (value: unknown) => {
  const valueText = text(value);
  return valueText && !/^[?\s]+$/.test(valueText) ? valueText : '';
};

export const getNextIsoDate = (isoDate: string) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid report date');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export const groupDuplicateAppointments = (
  appointments: AppointmentItem[],
  appointmentDate: string,
): DuplicateAppointmentReport => {
  const grouped = new Map<string, AppointmentItem[]>();
  for (const appointment of appointments) {
    if (!appointment.hn) continue;
    const items = grouped.get(appointment.hn) || [];
    items.push(appointment);
    grouped.set(appointment.hn, items);
  }
  const duplicatePatients = [...grouped.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([hn, items]) => ({
      hn,
      appointments: [...items].sort((left, right) => (
        left.nextTime.localeCompare(right.nextTime) || left.appointmentId - right.appointmentId
      )),
    }))
    .sort((left, right) => left.hn.localeCompare(right.hn));
  return {
    appointmentDate,
    duplicatePatients,
    appointmentCount: duplicatePatients.reduce((sum, item) => sum + item.appointments.length, 0),
  };
};

export const queryDuplicateAppointments = async (appointmentDate: string) => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         a.oapp_id,
         a.hn,
         DATE_FORMAT(a.nextdate, '%Y-%m-%d') AS next_date,
         COALESCE(DATE_FORMAT(a.nexttime, '%H:%i'), '') AS next_time,
         COALESCE(a.clinic, '') AS clinic_code,
         COALESCE(cl.name, '') AS clinic_name,
         COALESCE(a.depcode, '') AS department_code,
         COALESCE(k.department, '') AS department_name,
         COALESCE(a.app_cause, '') AS app_cause
       FROM oapp a
       LEFT JOIN clinic cl ON cl.clinic = a.clinic
       LEFT JOIN kskdepartment k ON k.depcode = a.depcode
       JOIN (
         SELECT hn
         FROM oapp
         WHERE nextdate = ?
           AND COALESCE(hn, '') <> ''
           AND COALESCE(oapp_status_id, 1) <> 4
         GROUP BY hn
         HAVING COUNT(*) > 1
       ) duplicate_hn ON duplicate_hn.hn = a.hn
       WHERE a.nextdate = ?
         AND COALESCE(a.oapp_status_id, 1) <> 4
       ORDER BY a.hn, a.nexttime, a.oapp_id`,
      [appointmentDate, appointmentDate],
    );
    const appointments = (Array.isArray(rows) ? rows : []).map((row) => {
      const item = row as Record<string, unknown>;
      return {
        appointmentId: num(item.oapp_id),
        hn: text(item.hn),
        nextDate: text(item.next_date) || appointmentDate,
        nextTime: text(item.next_time) || 'ไม่ระบุเวลา',
        clinicCode: text(item.clinic_code),
        clinicName: text(item.clinic_name),
        departmentCode: text(item.department_code),
        departmentName: text(item.department_name),
        cause: cleanCause(item.app_cause),
      } satisfies AppointmentItem;
    });
    return groupDuplicateAppointments(appointments, appointmentDate);
  } finally {
    connection.release();
  }
};

const appointmentLine = (appointment: AppointmentItem) => {
  const clinic = appointment.clinicName || appointment.clinicCode || 'ไม่ระบุคลินิก';
  const department = appointment.departmentName || appointment.departmentCode;
  const location = department && department !== clinic ? `${clinic} / ${department}` : clinic;
  const causeText = cleanCause(appointment.cause);
  const cause = causeText ? ` — ${causeText}` : '';
  return `   • ${appointment.nextTime} ${location}${cause}`;
};

export const buildDuplicateAppointmentMessages = (report: DuplicateAppointmentReport, maxLength = 4800) => {
  if (report.duplicatePatients.length === 0) return [];
  const header = [
    '⚠️ แจ้งเตือนนัดผู้ป่วยซ้ำซ้อน',
    `วันนัด ${report.appointmentDate}`,
    `พบ ${report.duplicatePatients.length} คน รวม ${report.appointmentCount} นัด`,
    '',
  ].join('\n');
  const footer = [
    '',
    'กรุณาตรวจสอบและแจ้งพยาบาลที่รับผิดชอบคลินิก',
    'เพื่อป้องกันการเปิด Visit ซ้ำซ้อนค่ะ',
  ].join('\n');
  const blocks = report.duplicatePatients.map((patient, index) => [
    `${index + 1}. HN ${patient.hn} — ${patient.appointments.length} นัด`,
    ...patient.appointments.map(appointmentLine),
  ].join('\n'));
  const messages: string[] = [];
  let current = header;
  for (const block of blocks) {
    const candidate = `${current}${current.endsWith('\n') ? '' : '\n\n'}${block}`;
    if (candidate.length + footer.length <= maxLength) {
      current = candidate;
    } else {
      messages.push(`${current}${footer}`.slice(0, maxLength));
      current = `${header}${block}`;
    }
  }
  messages.push(`${current}${footer}`.slice(0, maxLength));
  return messages;
};

export const sendDuplicateAppointmentAlertToLine = async (
  report: DuplicateAppointmentReport,
  options?: { targetId?: string; accessToken?: string },
) => {
  const messages = buildDuplicateAppointmentMessages(report);
  if (messages.length === 0) return 0;
  const targetId = text(options?.targetId || process.env.LINE_APPOINTMENT_TARGET_ID || process.env.LINE_OVERVIEW_TARGET_ID);
  const accessToken = text(options?.accessToken || process.env.LINE_APPOINTMENT_CHANNEL_ACCESS_TOKEN || process.env.LINE_OVERVIEW_CHANNEL_ACCESS_TOKEN);
  if (!targetId) throw new Error('LINE_APPOINTMENT_TARGET_ID or LINE_OVERVIEW_TARGET_ID is not configured');
  if (!accessToken) throw new Error('LINE appointment or overview channel access token is not configured');
  for (let index = 0; index < messages.length; index += 5) {
    const batch: LineMessage[] = messages.slice(index, index + 5).map((value) => ({ type: 'text', text: value }));
    await pushLineMessages(targetId, batch, accessToken);
  }
  return messages.length;
};

export const shouldRunDuplicateAppointmentAlert = (
  configuredTime: string,
  clock: { date: string; time: string },
  lastRunDate?: string | null,
) => /^([01]\d|2[0-3]):[0-5]\d$/.test(configuredTime)
  && clock.time === configuredTime
  && clock.date !== lastRunDate;

export const getLastDuplicateAppointmentAlertDate = async () => {
  const state = await getAppSetting<{ lastRunDate?: string }>(ALERT_STATE_KEY);
  return text(state?.lastRunDate) || null;
};

export const markDuplicateAppointmentAlertRun = async (runDate: string, appointmentDate: string) => {
  await setAppSetting(ALERT_STATE_KEY, { lastRunDate: runDate, appointmentDate, checkedAt: new Date().toISOString() });
};

export { getBangkokDateTime };

````
