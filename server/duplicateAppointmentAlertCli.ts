import 'dotenv/config';
import {
  buildDuplicateAppointmentMessages,
  getBangkokDateTime,
  getLastDuplicateAppointmentAlertDate,
  getNextIsoDate,
  markDuplicateAppointmentAlertRun,
  queryDuplicateAppointments,
  sendDuplicateAppointmentAlertToLine,
  shouldRunDuplicateAppointmentAlert,
} from './duplicateAppointmentAlert.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const scheduled = args.includes('--scheduled');
const dateArg = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
const clock = getBangkokDateTime();
const appointmentDate = dateArg || getNextIsoDate(clock.date);

if (scheduled) {
  const configuredTime = String(process.env.LINE_APPOINTMENT_REPORT_TIME || '11:00').trim();
  const lastRunDate = await getLastDuplicateAppointmentAlertDate();
  if (!shouldRunDuplicateAppointmentAlert(configuredTime, clock, lastRunDate)) {
    console.log(`Skipped duplicate appointment alert: configured=${configuredTime}, now=${clock.time}, last=${lastRunDate || '-'}`);
    process.exit(0);
  }
}

console.log(`Querying duplicate appointments for ${appointmentDate}...`);
const report = await queryDuplicateAppointments(appointmentDate);

if (dryRun) {
  const messages = buildDuplicateAppointmentMessages(report);
  console.log(messages.length > 0 ? messages.join('\n\n---\n\n') : 'ไม่พบนัดผู้ป่วยซ้ำซ้อน');
  process.exit(0);
}

const messageCount = await sendDuplicateAppointmentAlertToLine(report);
if (scheduled) await markDuplicateAppointmentAlertRun(clock.date, appointmentDate);
console.log(`Duplicate appointment alert complete: ${report.duplicatePatients.length} patient(s), ${report.appointmentCount} appointment(s), ${messageCount} message(s).`);
process.exit(0);
