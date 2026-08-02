---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/lineBot.ts"
source_hash: "8e7f6ba0e5278ec927ae955bea1a6b60333f51cca26cf25b6d6232f9a30a018b"
managed_by: "sync-ksp-vault"
---
# lineBot.ts

> Source: `server/lineBot.ts`
> SHA-256: `8e7f6ba0e5278ec927ae955bea1a6b60333f51cca26cf25b6d6232f9a30a018b`

````typescript
import crypto from 'crypto';
import path from 'path';
import type { Request, Response } from 'express';
import { answerGroundedQuestion, getAiStatus, getKnowledgeVault } from './aiService.js';
import type { VaultMatch } from './vaultKnowledge.js';

type LineMentionee = {
  index: number;
  length: number;
  type: 'user' | 'all';
  userId?: string;
  isSelf?: boolean;
};

type LineWebhookEvent = {
  type: string;
  mode?: 'active' | 'standby';
  webhookEventId?: string;
  replyToken?: string;
  source?: { type: 'user' | 'group' | 'room'; userId?: string; groupId?: string; roomId?: string };
  message?: {
    type: string;
    text?: string;
    mention?: { mentionees?: LineMentionee[] };
  };
};

type LineWebhookBody = { events?: LineWebhookEvent[] };
type RequestWithRawBody = Request & { rawBody?: Buffer };

const processedEventIds = new Map<string, number>();

const cleanupProcessedEvents = () => {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, timestamp] of processedEventIds) {
    if (timestamp < cutoff) processedEventIds.delete(id);
  }
};

export const verifyLineSignature = (rawBody: Buffer, signature: string, channelSecret: string) => {
  if (!signature || !channelSecret) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
};

export const wasBotMentioned = (event: LineWebhookEvent) => (
  event.message?.mention?.mentionees?.some((mentionee) => (
    mentionee.type === 'user' && mentionee.isSelf === true
  )) ?? false
);

export const shouldAnswerEvent = (event: LineWebhookEvent) => {
  if (event.type !== 'message' || event.mode === 'standby' || event.message?.type !== 'text') return false;
  if (!event.message.text?.trim() || !event.replyToken) return false;
  return event.source?.type === 'user' || wasBotMentioned(event);
};

export const extractQuestion = (event: LineWebhookEvent) => {
  const original = event.message?.text || '';
  const mentions = (event.message?.mention?.mentionees || [])
    .filter((mentionee) => mentionee.type === 'user' && mentionee.isSelf)
    .sort((a, b) => b.index - a.index);
  let question = original;
  for (const mention of mentions) {
    question = `${question.slice(0, mention.index)} ${question.slice(mention.index + mention.length)}`;
  }
  return question.replace(/^[\s,:：\-–—]+/, '').replace(/\s+/g, ' ').trim();
};

const appendSources = (answer: string, matches: VaultMatch[]) => {
  const sources = matches
    .map((match, index) => `[${index + 1}] ${match.source} > ${match.heading}`)
    .join('\n');
  const combined = `${answer}\n\nแหล่งข้อมูลใน Vault:\n${sources}`;
  return combined.length <= 4_900 ? combined : `${combined.slice(0, 4_860)}…`;
};

const buildExtractiveFallback = (matches: VaultMatch[]) => {
  const excerpts = matches.slice(0, 3).map((match, index) => {
    const text = match.content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^[-#>*_`]+\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 520);
    return `[${index + 1}] ${match.heading}\n${text}${match.content.length > 520 ? '…' : ''}`;
  });
  return [
    'ขณะนี้ระบบ AI ยังไม่พร้อมใช้งาน จึงแสดงข้อความที่ค้นพบจาก Vault โดยตรง:',
    ...excerpts,
  ].join('\n\n');
};

const replyToLine = async (replyToken: string, text: string) => {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`LINE reply API ${response.status}: ${await response.text()}`);
};

const processEvent = async (event: LineWebhookEvent) => {
  if (!shouldAnswerEvent(event)) return;
  if (event.webhookEventId && processedEventIds.has(event.webhookEventId)) return;
  if (event.webhookEventId) processedEventIds.set(event.webhookEventId, Date.now());

  const question = extractQuestion(event);
  if (!question) {
    await replyToLine(event.replyToken!, 'กรุณาพิมพ์คำถามต่อท้าย @ชื่อบอท ครับ');
    return;
  }

  try {
    const matches = await getKnowledgeVault().search(question, Number(process.env.VAULT_TOP_K) || 5);
    if (!matches.length) {
      await replyToLine(event.replyToken!, 'ไม่พบข้อมูลที่เกี่ยวข้องใน Vault กรุณาลองระบุคำสำคัญหรือหัวข้อให้ชัดเจนขึ้นครับ');
      return;
    }
    let answer: string;
    try {
      answer = await answerGroundedQuestion(question, matches);
    } catch (error) {
      console.error('AI answer unavailable; using Vault extract fallback:', error);
      answer = buildExtractiveFallback(matches);
    }
    await replyToLine(event.replyToken!, appendSources(answer, matches));
  } catch (error) {
    console.error('LINE bot event error:', error);
    try {
      await replyToLine(event.replyToken!, 'ขออภัย ระบบค้นความรู้ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งครับ');
    } catch (replyError) {
      if (event.webhookEventId) processedEventIds.delete(event.webhookEventId);
      throw replyError;
    }
  }
};

export const lineWebhookHandler = async (req: RequestWithRawBody, res: Response) => {
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
  const signature = req.header('x-line-signature') || '';
  if (!channelSecret || !process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) {
    return res.status(503).json({ error: 'LINE bot is not configured' });
  }
  if (!req.rawBody || !verifyLineSignature(req.rawBody, signature, channelSecret)) {
    return res.status(401).json({ error: 'Invalid LINE signature' });
  }

  try {
    cleanupProcessedEvents();
    const body = req.body as LineWebhookBody;
    await Promise.all((body.events || []).map(processEvent));
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('LINE webhook error:', error);
    return res.status(500).json({ error: 'LINE webhook processing failed' });
  }
};

export const getLineBotStatus = async (reindex = false) => {
  const knowledgeBase = getKnowledgeVault();
  const ai = await getAiStatus();
  let vaultStatus = knowledgeBase.status();
  let vaultError: string | null = null;
  try {
    vaultStatus = await knowledgeBase.reindex(reindex);
  } catch (error) {
    vaultError = (error as Error).message;
  }
  return {
    configured: Boolean(
      process.env.LINE_CHANNEL_SECRET?.trim()
      && process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
      && ai.configured
    ),
    webhookPath: '/api/line/webhook',
    provider: ai.provider,
    model: ai.model,
    credentials: {
      lineChannelSecret: Boolean(process.env.LINE_CHANNEL_SECRET?.trim()),
      lineAccessToken: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()),
      aiConfigured: ai.configured,
    },
    vault: {
      name: path.basename(vaultStatus.root),
      indexedFiles: vaultStatus.indexedFiles,
      chunks: vaultStatus.chunks,
      lastIndexedAt: vaultStatus.lastIndexedAt,
      error: vaultError,
    },
  };
};

````
