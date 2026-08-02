import crypto from 'crypto';
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
const responseCacheMs = () => Math.max(0, Number(process.env.AI_RESPONSE_CACHE_MS) || 5 * 60_000);
const responseCacheMax = () => Math.max(1, Number(process.env.AI_RESPONSE_CACHE_MAX) || 100);

let vault: VaultKnowledgeBase | null = null;
const responseCache = new Map<string, { text: string; expiresAt: number }>();
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
  'ถ้าหลักฐานไม่พอ ให้บอกตรง ๆ ว่าข้อมูลไม่เพียงพอ',
  'ตอบให้กระชับ อ่านง่าย และใช้ภาษาไทยเป็นหลัก',
].join('\n');

const buildGroundedPrompt = (question: string, matches: VaultMatch[]) => {
  const evidence = matches.map((match, index) => (
    `[แหล่งข้อมูล ${index + 1}: ${match.source} > ${match.heading}]\n${match.content}`
  )).join('\n\n');
  return `คำถามจากผู้ใช้:\n${question}\n\nข้อมูลที่ค้นพบใน Vault:\n${evidence}\n\nอ้างอิงแหล่งข้อมูลด้วย [1], [2] ต่อท้ายข้อความที่เกี่ยวข้อง`;
};

const callOllama = async (
  prompt: string,
  systemInstructions = SYSTEM_INSTRUCTIONS,
  options?: { json?: boolean; temperature?: number; maxTokens?: number },
) => {
  const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel(),
      stream: false,
      keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
      messages: [
        { role: 'system', content: systemInstructions },
        { role: 'user', content: prompt },
      ],
      ...(options?.json ? { format: 'json' } : {}),
      options: {
        temperature: options?.temperature ?? 0.1,
        num_ctx: Number(process.env.OLLAMA_CONTEXT_LENGTH) || 8_192,
        num_predict: options?.maxTokens || Number(process.env.OLLAMA_MAX_TOKENS) || 1_200,
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

const callOpenAI = async (
  prompt: string,
  systemInstructions = SYSTEM_INSTRUCTIONS,
  options?: { json?: boolean; maxTokens?: number },
) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      reasoning: { effort: 'none' },
      instructions: systemInstructions,
      input: prompt,
      max_output_tokens: options?.maxTokens || 1_000,
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

const generateText = async (prompt: string) => {
  const selectedProvider = provider();
  const selectedModel = selectedProvider === 'ollama' ? ollamaModel() : (process.env.OPENAI_MODEL || 'gpt-5.6-terra');
  const cacheKey = crypto.createHash('sha256').update(`${selectedProvider}:${selectedModel}:${prompt}`).digest('hex');
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.text;
  if (cached) responseCache.delete(cacheKey);

  const text = selectedProvider === 'openai' ? await callOpenAI(prompt) : await callOllama(prompt);
  const cacheDuration = responseCacheMs();
  if (cacheDuration > 0) {
    responseCache.set(cacheKey, { text, expiresAt: Date.now() + cacheDuration });
    while (responseCache.size > responseCacheMax()) {
      const oldestKey = responseCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      responseCache.delete(oldestKey);
    }
  }
  return text;
};

export const generateAgentText = async (
  systemInstructions: string,
  prompt: string,
  options?: { json?: boolean; temperature?: number; maxTokens?: number },
) => (
  provider() === 'openai'
    ? callOpenAI(prompt, systemInstructions, options)
    : callOllama(prompt, systemInstructions, options)
);

export const answerGroundedQuestion = (question: string, matches: VaultMatch[]) => (
  generateText(buildGroundedPrompt(question, matches))
);

export const answerGeneralConversation = (question: string) => generateAgentText(
  [
    'คุณคือผู้ช่วยภาษาไทยของ FDHChecker ที่สุภาพและสนทนาเป็นธรรมชาติ',
    'คำถามนี้ไม่ใช่การค้นฐานข้อมูล HOSxP และไม่มีหลักฐานจากระบบแนบมา',
    'ตอบความรู้ทั่วไปได้ แต่ต้องบอกเมื่อไม่แน่ใจ ห้ามอ้างว่าพบข้อมูลผู้ป่วยหรือข้อมูลโรงพยาบาล',
    'ห้ามให้คำวินิจฉัยหรือคำสั่งรักษาเฉพาะบุคคล และห้ามอ้างว่าสามารถแก้ไขฐานข้อมูลได้',
    'ตอบกระชับและชวนผู้ใช้ระบุข้อมูลเพิ่มเมื่อจำเป็น',
  ].join('\n'),
  question,
  { temperature: 0.3, maxTokens: 800 },
);

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
  const serialized = JSON.stringify(input);
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
