import dotenv from 'dotenv';
import { pushLineMessages } from './lineMessaging.js';

dotenv.config();

const targetId = String(process.env.LINE_TARGET_ID || '').trim();
const accessToken = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();

if (!accessToken) throw new Error('กรุณาตั้ง LINE_CHANNEL_ACCESS_TOKEN ในไฟล์ .env');
if (!targetId) throw new Error('กรุณาตั้ง LINE_TARGET_ID ในไฟล์ .env');

const timestamp = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Asia/Bangkok',
}).format(new Date());

await pushLineMessages(targetId, [{
  type: 'text',
  text: `✅ ทดสอบ FDH Checker จากเครื่อง DEV สำเร็จ\nเวลา ${timestamp}`,
}], accessToken);

const maskedTarget = targetId.length > 8
  ? `${targetId.slice(0, 4)}…${targetId.slice(-4)}`
  : 'configured';
console.log(`LINE test message sent to ${maskedTarget}`);
