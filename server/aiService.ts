import path from 'path';
import { fileURLToPath } from 'url';
import { VaultKnowledgeBase, type VaultMatch } from './vaultKnowledge.js';

export type AiProvider = 'ollama' | 'openai';

export type ReportSummaryInput = {
  title: string;
  filters?: Record<string, string | number | boolean | null>;
  rows: Array<Record<string, unknown>>;
  notes?: string;
};

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultVaultPath = path.resolve(moduleDirectory, '..');
const provider = (): AiProvider => process.env.AI_PROVIDER?.trim().toLowerCase() === 'openai'
  ? 'openai'
  : 'ollama';
const ollamaBaseUrl = () => (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const ollamaModel = () => process.env.OLLAMA_MODEL || 'qwen3:4b-instruct';
const reportRowLimit = () => Math.max(1, Number(process.env.AI_REPORT_MAX_ROWS) || 50);
const requestTimeoutMs = () => Math.max(5_000, Number(process.env.AI_TIMEOUT_MS) || 90_000);

let vault: VaultKnowledgeBase | null = null;
export const getKnowledgeVault = () => {
  if (!vault) {
    vault = new VaultKnowledgeBase(
      path.resolve(process.env.VAULT_PATH || defaultVaultPath),
      Number(process.env.VAULT_CACHE_MS) || 5 * 60_000,
      Number(process.env.VAULT_MAX_FILE_BYTES) || 2_500_000,
    );
  }
  return vault;
};

const SYSTEM_INSTRUCTIONS = [
  'คุณคือผู้ช่วยภาษาไทยของระบบ FDHChecker',
  'ตอบเฉพาะจากข้อมูลที่ Backend แนบมา ห้ามใช้ความจำเพื่อเติมข้อเท็จจริง',
  'ห้ามสร้างหรือเสนอ SQL และห้ามอ้างว่าสามารถเชื่อมฐานข้อมูลได้',
  'ห้ามเปิดเผยหรือทวนข้อมูลส่วนบุคคลของผู้ป่วย เช่น HN, VN, AN, เลขบัตร, ชื่อ, ที่อยู่ หรือข้อมูลสุขภาพรายบุคคล',
  'ถ้าหลักฐานไม่พอ ให้บอกตรง ๆ ว่าข้อมูลไม่เพียงพอ',
  'ตอบให้กระชับ อ่านง่าย และใช้ภาษาไทยเป็นหลัก',
].join('\n');

const buildGroundedPrompt = (question: string, matches: VaultMatch[]) => {
  const evidence = matches.map((match, index) => (
    `[แหล่งข้อมูล ${index + 1}: ${match.source} > ${match.heading}]\n${match.content}`
  )).join('\n\n');
  return `คำถามจากผู้ใช้:\n${question}\n\nข้อมูลที่ค้นพบใน Vault:\n${evidence}\n\nอ้างอิงแหล่งข้อมูลด้วย [1], [2] ต่อท้ายข้อความที่เกี่ยวข้อง`;
};

const callOllama = async (prompt: string) => {
  const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel(),
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTIONS },
        { role: 'user', content: prompt },
      ],
      options: {
        temperature: 0.1,
        num_ctx: Number(process.env.OLLAMA_CONTEXT_LENGTH) || 8_192,
        num_predict: Number(process.env.OLLAMA_MAX_TOKENS) || 1_000,
      },
    }),
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });
  const payload = await response.json() as {
    message?: { content?: string };
    error?: string;
  };
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${payload.error || response.statusText}`);
  const text = payload.message?.content?.trim();
  if (!text) throw new Error('Ollama returned no text');
  return text;
};

const extractOpenAIText = (payload: Record<string, unknown>): string => {
  if (typeof payload.output_text === 'string') return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];
    const text = content
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => String(part.text))
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
};

const callOpenAI = async (prompt: string) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      reasoning: { effort: 'none' },
      instructions: SYSTEM_INSTRUCTIONS,
      input: prompt,
      max_output_tokens: 1_000,
      text: { verbosity: 'low' },
    }),
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error && typeof payload.error === 'object'
      ? String((payload.error as Record<string, unknown>).message || response.statusText)
      : response.statusText;
    throw new Error(`OpenAI API ${response.status}: ${error}`);
  }
  const text = extractOpenAIText(payload);
  if (!text) throw new Error('OpenAI API returned no text');
  return text;
};

const generateText = (prompt: string) => provider() === 'openai'
  ? callOpenAI(prompt)
  : callOllama(prompt);

export const answerGroundedQuestion = (question: string, matches: VaultMatch[]) => (
  generateText(buildGroundedPrompt(question, matches))
);

const SENSITIVE_FIELD = /^(hn|vn|an|cid|pid|patient_?name|person_?name|first_?name|last_?name|fname|lname|birthday|birth_?date|address|phone|mobile)$/i;
const PATIENT_IDENTIFIER_VALUE = /(?:\b(?:hn|vn|an|cid|pid)\s*[:=]?\s*[a-z0-9-]{4,}\b|\b\d{13}\b)/i;

export const containsPatientIdentifier = (value: string) => PATIENT_IDENTIFIER_VALUE.test(value);

const findSensitiveField = (value: unknown, currentPath = ''): string | null => {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitiveField(value[index], `${currentPath}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const fieldPath = currentPath ? `${currentPath}.${key}` : key;
    if (SENSITIVE_FIELD.test(key)) return fieldPath;
    const found = findSensitiveField(nestedValue, fieldPath);
    if (found) return found;
  }
  return null;
};

export const validateReportPayload = (input: ReportSummaryInput) => {
  if (!input || typeof input !== 'object') throw new Error('report payload is required');
  if (!String(input.title || '').trim()) throw new Error('report title is required');
  if (!Array.isArray(input.rows)) throw new Error('report rows must be an array');
  if (input.rows.length > reportRowLimit()) {
    throw new Error(`report rows exceed the limit of ${reportRowLimit()} rows`);
  }
  for (const row of input.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('each report row must be an object');
  }
  const sensitiveKey = findSensitiveField({ filters: input.filters, rows: input.rows });
  if (sensitiveKey) throw new Error(`sensitive patient field is not allowed: ${sensitiveKey}`);
  const serialized = JSON.stringify(input);
  if (containsPatientIdentifier(serialized)) throw new Error('patient identifier value is not allowed');
  if (serialized.length > 80_000) throw new Error('report payload is too large');
  return input;
};

export const summarizeReport = async (input: ReportSummaryInput) => {
  const report = validateReportPayload(input);
  const prompt = [
    'สรุปรายงานต่อไปนี้ โดยถือว่าตัวเลขทั้งหมดผ่านการคำนวณจาก Backend แล้ว',
    'ห้ามคำนวณยอดสำคัญใหม่ ห้ามเดาข้อมูลที่ไม่มี และห้ามเสนอ SQL',
    'ให้สรุปภาพรวม จุดสังเกต และตัวกรองที่ใช้ หากมี',
    `ชื่อรายงาน: ${report.title}`,
    `ตัวกรอง: ${JSON.stringify(report.filters || {})}`,
    `ข้อมูลสรุป (${report.rows.length} แถว): ${JSON.stringify(report.rows)}`,
    report.notes ? `หมายเหตุจาก Backend: ${report.notes}` : '',
  ].filter(Boolean).join('\n\n');
  return generateText(prompt);
};

export const getAiStatus = async () => {
  const selectedProvider = provider();
  if (selectedProvider === 'openai') {
    return {
      provider: selectedProvider,
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      reachable: null,
    };
  }

  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    const payload = await response.json() as { models?: Array<{ name?: string }> };
    const models = (payload.models || []).map((item) => item.name).filter(Boolean);
    return {
      provider: selectedProvider,
      model: ollamaModel(),
      configured: models.some((name) => name === ollamaModel() || name === `${ollamaModel()}:latest`),
      reachable: response.ok,
      baseUrl: ollamaBaseUrl(),
      installedModels: models,
    };
  } catch (error) {
    return {
      provider: selectedProvider,
      model: ollamaModel(),
      configured: false,
      reachable: false,
      baseUrl: ollamaBaseUrl(),
      error: (error as Error).message,
    };
  }
};
