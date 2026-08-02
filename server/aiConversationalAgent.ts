import crypto from 'crypto';
import { buildReportAttachment, type ExportableReport, type ReportFormat } from './aiReportExport.js';
import { HOSXP_SEMANTIC_CATALOG } from './aiHosxpCatalog.js';
import { executeReadOnlyQuery } from './aiReadOnlyQuery.js';
import { generateAgentText } from './aiService.js';

type ConversationEntry = {
  question: string;
  answer: string;
  sql?: string;
  title?: string;
  createdAt: number;
};

type ConversationState = {
  entries: ConversationEntry[];
  expiresAt: number;
};

type QueryPlan = {
  action: 'query' | 'clarify' | 'not_data' | 'deny';
  title?: string;
  sql?: string;
  clarification?: string;
  reason?: string;
};

export type ConversationalAgentAnswer = {
  answer: string;
  report?: {
    type: 'dynamic-query' | 'clarification' | 'read-only-denied';
    source: 'HOSxP';
    totalRows?: number;
    returnedRows?: number;
    tables?: string[];
  };
  attachment?: {
    filename: string;
    mimeType: string;
    base64: string;
    size: number;
  };
  needsClarification?: boolean;
};

const SESSION_TTL_MS = Math.max(10 * 60_000, Number(process.env.AI_CONVERSATION_TTL_MS) || 2 * 60 * 60_000);
const MAX_SESSIONS = Math.min(1_000, Math.max(20, Number(process.env.AI_CONVERSATION_MAX_SESSIONS) || 200));
const MAX_HISTORY = Math.min(20, Math.max(4, Number(process.env.AI_CONVERSATION_MAX_TURNS) || 12));
const conversations = new Map<string, ConversationState>();

const cleanExpired = () => {
  const now = Date.now();
  for (const [key, value] of conversations) if (value.expiresAt <= now) conversations.delete(key);
  while (conversations.size > MAX_SESSIONS) {
    const oldest = conversations.keys().next().value as string | undefined;
    if (!oldest) break;
    conversations.delete(oldest);
  }
};

const stateFor = (key: string) => {
  cleanExpired();
  const current = conversations.get(key) || { entries: [], expiresAt: Date.now() + SESSION_TTL_MS };
  current.expiresAt = Date.now() + SESSION_TTL_MS;
  conversations.delete(key);
  conversations.set(key, current);
  return current;
};

export const rememberConversationExchange = (
  key: string,
  question: string,
  answer: string,
  context?: { sql?: string; title?: string },
) => {
  const state = stateFor(key);
  state.entries.push({ question, answer: answer.slice(0, 2_000), sql: context?.sql, title: context?.title, createdAt: Date.now() });
  if (state.entries.length > MAX_HISTORY) state.entries.splice(0, state.entries.length - MAX_HISTORY);
};

const requestedFormat = (question: string): ReportFormat | undefined => {
  const normalized = question.toLowerCase();
  if (/excel|xlsx|เอ็กเซล/.test(normalized)) return 'xlsx';
  if (/word|docx|เวิร์ด/.test(normalized)) return 'docx';
  if (/\bcsv\b/.test(normalized)) return 'csv';
  if (/\bjson\b/.test(normalized)) return 'json';
  if (/สร้างไฟล์|ส่งออก|ดาวน์โหลด/.test(normalized)) return 'xlsx';
  return undefined;
};

const extractJson = (text: string) => {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI planner คืนรูปแบบที่อ่านไม่ได้');
  return JSON.parse(cleaned.slice(start, end + 1)) as QueryPlan;
};

const bangkokNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
};

const PLANNER_SYSTEM = `
คุณเป็น Query Planner ภาษาไทยสำหรับ FDHChecker
หน้าที่คือแปลงคำถามข้อมูลโรงพยาบาลเป็น SQL แบบอ่านอย่างเดียว โดยตอบ JSON เท่านั้น

กฎบังคับ:
1. action ต้องเป็น query, clarify, not_data หรือ deny
2. ใช้ query เมื่อคำถามตอบจาก catalog ได้ และ sql ต้องเป็น SELECT หรือ WITH...SELECT เพียง statement เดียว
3. ห้าม INSERT, UPDATE, DELETE, REPLACE, DROP, ALTER, CREATE, TRUNCATE, CALL, SET, USE และห้ามแก้ข้อมูลทุกกรณี
4. ถ้าผู้ใช้ขอแก้/ลบ/เพิ่ม/บันทึกข้อมูล ให้ action=deny
5. ถ้าขาดวันที่ เกณฑ์โรค หรือความหมายสำคัญที่ทำให้ผลต่างกัน ให้ action=clarify พร้อมคำถามสั้น ๆ หนึ่งข้อ
6. ถ้าไม่ใช่คำถามข้อมูล HOSxP ให้ action=not_data
7. ห้ามใช้ตารางหรือคอลัมน์นอก catalog ห้ามเดาชื่อคอลัมน์
8. ใช้ alias ภาษาอังกฤษที่สั้นและสื่อความหมาย ผลรายการ LIMIT ไม่เกิน 200
9. คำถามต่อเนื่องให้อ้างอิงบริบทก่อนหน้า
10. ห้ามเพิ่ม filter ที่ผู้ใช้ไม่ได้ขอ โดยเฉพาะห้ามใช้ pttype='OPD'; OPD ให้เลือกจากตาราง ovst ตาม catalog

JSON schema:
{"action":"query|clarify|not_data|deny","title":"ชื่อรายงาน","sql":"SELECT ...","clarification":"คำถามกลับ","reason":"เหตุผลสั้น ๆ"}
`.trim();

const buildPlannerPrompt = (question: string, history: ConversationEntry[], correction?: string) => {
  const historyText = history.length
    ? history.map((entry, index) => [
      `${index + 1}. ผู้ใช้: ${entry.question}`,
      `ผู้ช่วย: ${entry.answer}`,
      entry.sql ? `SQL ที่ผ่านการตรวจครั้งนั้น: ${entry.sql}` : '',
    ].filter(Boolean).join('\n')).join('\n\n')
    : 'ยังไม่มีบริบทก่อนหน้า';
  return [
    `เวลาปัจจุบันประเทศไทย: ${bangkokNow()}`,
    HOSXP_SEMANTIC_CATALOG,
    `บริบทสนทนา:\n${historyText}`,
    `คำถามล่าสุด: ${question}`,
    correction ? `แผนก่อนหน้าใช้ไม่ได้: ${correction}\nแก้แผนโดยใช้เฉพาะ catalog` : '',
    'คืน JSON เท่านั้น',
  ].filter(Boolean).join('\n\n');
};

const planQuestion = async (question: string, history: ConversationEntry[], correction?: string) => {
  const text = await generateAgentText(PLANNER_SYSTEM, buildPlannerPrompt(question, history, correction), {
    json: true, temperature: 0, maxTokens: 1_200,
  });
  const plan = extractJson(text);
  if (!['query', 'clarify', 'not_data', 'deny'].includes(plan.action)) throw new Error('AI planner เลือก action ไม่ถูกต้อง');
  return plan;
};

const forbiddenMutationQuestion = (question: string) => (
  /(?:ช่วย|ให้|ต้องการ|ขอ).*(?:แก้ไข|อัปเดต|เปลี่ยนแปลง|ลบ|บันทึก|เพิ่มข้อมูล).*(?:ผู้ป่วย|คนไข้|hn|vn|an|cid|hosxp)/i.test(question)
  || /(?:แก้ไข|อัปเดต|ลบ).*(?:ใน hosxp|ฐานข้อมูล)/i.test(question)
);

const reportFromRows = (title: string, rows: Array<Record<string, unknown>>): ExportableReport => {
  const keys = Object.keys(rows[0] || {});
  return {
    title,
    subtitle: 'สร้างจาก HOSxP ด้วย Read-only AI Agent',
    metadata: [{ label: 'จำนวนแถว', value: rows.length.toLocaleString('th-TH') }],
    columns: keys.map((key) => ({ key, label: key, width: Math.min(35, Math.max(12, key.length + 4)) })),
    rows,
    wordColumnKeys: keys.slice(0, 7),
  };
};

const ANSWER_SYSTEM = `
คุณคือผู้ช่วยข้อมูลโรงพยาบาล FDHChecker
ตอบคำถามจากผลลัพธ์ที่ Backend แนบมาเท่านั้น ห้ามเดาหรือเพิ่มข้อเท็จจริง
รักษาตัวเลขและรหัสให้ตรงกับข้อมูล อธิบายเป็นภาษาไทย กระชับ และตอบคำถามโดยตรง
ห้ามแสดง SQL ห้ามอ้างว่าสามารถแก้ไขฐานข้อมูล และห้ามให้คำวินิจฉัยทางการแพทย์ที่ไม่มีในข้อมูล
ถ้ามีหลายแถวให้สรุปภาพรวมและแสดงรายการสำคัญไม่เกิน 10 รายการ
`.trim();

const answerFromRows = async (question: string, title: string, rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return `ไม่พบข้อมูลสำหรับ “${question}” ตามเงื่อนไขที่ระบุ`;
  const evidence = rows.slice(0, 50);
  try {
    return await generateAgentText(ANSWER_SYSTEM, [
      `คำถาม: ${question}`,
      `ชื่อชุดข้อมูล: ${title}`,
      `จำนวนแถวที่ Backend พบ: ${rows.length}`,
      `ข้อมูลสูงสุด 50 แถวแรก: ${JSON.stringify(evidence)}`,
    ].join('\n\n'), { temperature: 0.1, maxTokens: 1_000 });
  } catch {
    return `พบข้อมูล ${rows.length.toLocaleString('th-TH')} รายการ\n${rows.slice(0, 10).map((row) => JSON.stringify(row)).join('\n')}`;
  }
};

const safeFilename = (title: string) => (
  `fdh-ai-${crypto.createHash('sha1').update(title).digest('hex').slice(0, 10)}`
);

export const answerConversationalDataQuestion = async (
  question: string,
  conversationKey: string,
): Promise<ConversationalAgentAnswer | null> => {
  const state = stateFor(conversationKey);
  if (forbiddenMutationQuestion(question)) {
    const answer = 'ระบบ AI นี้เป็นโหมดอ่านอย่างเดียว จึงค้นหา วิเคราะห์ และสร้างรายงานได้ แต่ไม่สามารถแก้ไข ลบ หรือเพิ่มข้อมูลใน HOSxP ได้';
    rememberConversationExchange(conversationKey, question, answer);
    return { answer, report: { type: 'read-only-denied', source: 'HOSxP' } };
  }

  const format = requestedFormat(question);
  const reuseLast = format && /(?:ผล|ข้อมูล|รายงาน)?(?:เมื่อกี้|ก่อนหน้า|เดิม|ชุดเดิม)/.test(question);
  let plan: QueryPlan | null = null;
  if (reuseLast) {
    const previous = [...state.entries].reverse().find((entry) => entry.sql);
    if (previous?.sql) plan = { action: 'query', sql: previous.sql, title: previous.title || 'รายงานจากคำถามก่อนหน้า' };
  }
  if (!plan) plan = await planQuestion(question, state.entries);

  if (plan.action === 'not_data') return null;
  if (plan.action === 'deny') {
    const answer = plan.reason || 'คำขอนี้เกี่ยวข้องกับการแก้ไขข้อมูล แต่ AI Agent อนุญาตเฉพาะการอ่านข้อมูลเท่านั้น';
    rememberConversationExchange(conversationKey, question, answer);
    return { answer, report: { type: 'read-only-denied', source: 'HOSxP' } };
  }
  if (plan.action === 'clarify' || !plan.sql) {
    const answer = plan.clarification || 'ต้องการตรวจสอบช่วงวันที่หรือเงื่อนไขใดครับ';
    rememberConversationExchange(conversationKey, question, answer);
    return { answer, needsClarification: true, report: { type: 'clarification', source: 'HOSxP' } };
  }

  let queryResult: Awaited<ReturnType<typeof executeReadOnlyQuery>> | null = null;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      queryResult = await executeReadOnlyQuery(plan.sql || '');
      break;
    } catch (error) {
      lastError = (error as Error).message.slice(0, 300);
      if (attempt === 0 && !reuseLast) {
        plan = await planQuestion(question, state.entries, lastError);
        if (plan.action !== 'query' || !plan.sql) break;
      }
    }
  }
  if (!queryResult || !plan.sql) {
    const answer = 'ยังสร้างคำค้นข้อมูลที่ปลอดภัยสำหรับคำถามนี้ไม่ได้ กรุณาระบุช่วงเวลา ชนิดผู้ป่วย หรือเงื่อนไขที่ต้องการให้ชัดขึ้น';
    rememberConversationExchange(conversationKey, question, answer);
    return { answer, needsClarification: true, report: { type: 'clarification', source: 'HOSxP' } };
  }

  const title = String(plan.title || 'ผลการค้นข้อมูล HOSxP').slice(0, 120);
  const answer = await answerFromRows(question, title, queryResult.rows);
  const attachment = format
    ? await buildReportAttachment(format, reportFromRows(title, queryResult.rows), safeFilename(title))
    : undefined;
  const finalAnswer = `${answer}${queryResult.truncated ? '\nแสดงผลตามขีดจำกัดของระบบ' : ''}${attachment ? `\nสร้างไฟล์ ${attachment.filename} แล้ว` : ''}`;
  rememberConversationExchange(conversationKey, question, finalAnswer, { sql: plan.sql, title });
  return {
    answer: finalAnswer,
    report: {
      type: 'dynamic-query', source: 'HOSxP', totalRows: queryResult.rows.length,
      returnedRows: queryResult.rows.length, tables: queryResult.tables,
    },
    attachment,
  };
};
