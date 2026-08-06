---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiService.ts"
source_hash: "eec27dd5ecea8d308d72ce2d5eaa6f3e9c17671342b7060980cdc49f8ecf1233"
managed_by: "sync-ksp-vault"
---
# aiService.ts

> Source: `server/aiService.ts`
> SHA-256: `eec27dd5ecea8d308d72ce2d5eaa6f3e9c17671342b7060980cdc49f8ecf1233`

````typescript
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
const defaultVaultPath = path.resolve(moduleDirectory, '..', 'knowlage', 'ksp-vault');
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
      path.resolve(process.env.KSP_VAULT_PATH || process.env.VAULT_PATH || defaultVaultPath),
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

type ConversationContext = Array<{ question: string; answer: string }>;

export const estimatePromptTokens = (value: string) => {
  let estimate = 0;
  for (const character of Array.from(String(value || ''))) {
    if (/\p{Script=Thai}|\p{Script=Han}/u.test(character)) estimate += 1;
    else if (/\s/u.test(character)) estimate += 0.08;
    else if (/[A-Za-z0-9_]/.test(character)) estimate += 0.28;
    else estimate += 0.45;
  }
  return Math.ceil(estimate);
};

const truncatePromptMiddle = (value: string, targetTokens: number) => {
  const characters = Array.from(value);
  if (estimatePromptTokens(value) <= targetTokens) return value;
  let low = 128;
  let high = characters.length;
  let best = characters.slice(-Math.min(characters.length, 128)).join('');
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const headLength = Math.floor(keep * 0.55);
    const tailLength = keep - headLength;
    const candidate = `${characters.slice(0, headLength).join('')}\n\n[ตัดบริบทเก่าที่เกินขนาด]\n\n${characters.slice(-tailLength).join('')}`;
    if (estimatePromptTokens(candidate) <= targetTokens) {
      best = candidate;
      low = keep + 1;
    } else high = keep - 1;
  }
  return best;
};

export const compactPromptForContext = (
  systemInstructions: string,
  prompt: string,
  contextLength: number,
  maxOutputTokens: number,
) => {
  const reserve = Math.max(512, Math.ceil(contextLength * 0.08));
  const inputBudget = Math.max(1_024, contextLength - maxOutputTokens - reserve);
  const promptBudget = Math.max(768, inputBudget - estimatePromptTokens(systemInstructions));
  return truncatePromptMiddle(prompt, promptBudget);
};

const conversationContextText = (history: ConversationContext) => history.slice(-8).map((entry, index) => (
  `${index + 1}. ผู้ใช้: ${entry.question}\nผู้ช่วย: ${entry.answer}`
)).join('\n\n');

const buildGroundedPrompt = (question: string, matches: VaultMatch[], history: ConversationContext = []) => {
  const evidence = matches.map((match, index) => (
    `[แหล่งข้อมูล ${index + 1}: ${match.source} > ${match.heading}]\n${match.content}`
  )).join('\n\n');
  const conversation = history.length ? `บริบทก่อนหน้า:\n${conversationContextText(history)}\n\n` : '';
  return `${conversation}คำถามล่าสุดจากผู้ใช้:\n${question}\n\nข้อมูลที่ค้นพบใน Vault:\n${evidence}\n\nอ้างอิงแหล่งข้อมูลด้วย [1], [2] ต่อท้ายข้อความที่เกี่ยวข้อง`;
};

const callOllama = async (
  prompt: string,
  systemInstructions = SYSTEM_INSTRUCTIONS,
  options?: { json?: boolean; temperature?: number; maxTokens?: number },
) => {
  const contextLength = Math.max(4_096, Number(process.env.OLLAMA_CONTEXT_LENGTH) || 8_192);
  const maxOutputTokens = Math.min(
    Math.max(256, options?.maxTokens || Number(process.env.OLLAMA_MAX_TOKENS) || 1_200),
    Math.floor(contextLength / 3),
  );
  let fittedPrompt = compactPromptForContext(systemInstructions, prompt, contextLength, maxOutputTokens);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel(), stream: false, think: false,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
        messages: [
          { role: 'system', content: systemInstructions },
          { role: 'user', content: fittedPrompt },
        ],
        ...(options?.json ? { format: 'json' } : {}),
        options: {
          temperature: options?.temperature ?? 0.1,
          num_ctx: contextLength,
          num_predict: maxOutputTokens,
        },
      }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
    const payload = await response.json() as {
      message?: { content?: string };
      error?: string | { message?: string; type?: string };
    };
    const errorText = typeof payload.error === 'string'
      ? payload.error
      : String(payload.error?.message || response.statusText);
    const contextExceeded = response.status === 400 && /context size|exceed_context_size|n_ctx/i.test(errorText);
    if (contextExceeded && attempt === 0) {
      fittedPrompt = compactPromptForContext(
        systemInstructions, fittedPrompt, Math.max(4_096, Math.floor(contextLength * 0.72)), maxOutputTokens,
      );
      continue;
    }
    if (!response.ok) {
      if (contextExceeded) throw new Error('บริบท AI ยาวเกินขนาดหลังจากย่ออัตโนมัติแล้ว กรุณาเริ่มบทสนทนาใหม่');
      throw new Error(`Ollama ${response.status}: ${errorText}`);
    }
    const text = payload.message?.content?.trim();
    if (!text) throw new Error('Ollama returned no text');
    return text;
  }
  throw new Error('บริบท AI ยาวเกินขนาดหลังจากย่ออัตโนมัติแล้ว กรุณาเริ่มบทสนทนาใหม่');
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

export const answerGroundedQuestion = (question: string, matches: VaultMatch[], history: ConversationContext = []) => (
  generateText(buildGroundedPrompt(question, matches, history))
);

export const answerGeneralConversation = (question: string, history: ConversationContext = []) => generateAgentText(
  [
    'คุณคือผู้ช่วยภาษาไทยของ FDHChecker ที่สุภาพและสนทนาเป็นธรรมชาติ',
    'คำถามนี้ไม่ใช่การค้นฐานข้อมูล HOSxP และไม่มีหลักฐานจากระบบแนบมา',
    'ตอบความรู้ทั่วไปได้ แต่ต้องบอกเมื่อไม่แน่ใจ ห้ามอ้างว่าพบข้อมูลผู้ป่วยหรือข้อมูลโรงพยาบาล',
    'ห้ามให้คำวินิจฉัยหรือคำสั่งรักษาเฉพาะบุคคล และห้ามอ้างว่าสามารถแก้ไขฐานข้อมูลได้',
    'ตอบกระชับและชวนผู้ใช้ระบุข้อมูลเพิ่มเมื่อจำเป็น',
  ].join('\n'),
  [
    history.length ? `บริบทก่อนหน้า:\n${conversationContextText(history)}` : '',
    `คำถามล่าสุด:\n${question}`,
    'ถ้าคำถามล่าสุดเป็นคำตอบสั้น ๆ ให้ตีความร่วมกับคำถามก่อนหน้า และถามข้อมูลเพิ่มเฉพาะที่จำเป็นต่อผลลัพธ์',
  ].filter(Boolean).join('\n\n'),
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

````
