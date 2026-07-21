import crypto from 'node:crypto';
import { fetchWithTimeout } from './httpClient.js';

export type LineSourceType = 'user' | 'group' | 'room';

export type LineWebhookTarget = {
  targetId: string;
  sourceType: LineSourceType;
};

export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string };

type LineWebhookSource = {
  type?: unknown;
  userId?: unknown;
  groupId?: unknown;
  roomId?: unknown;
};

type LineWebhookEvent = {
  type?: unknown;
  replyToken?: unknown;
  source?: LineWebhookSource;
  message?: { type?: unknown; text?: unknown };
};

export type LineWebhookPayload = {
  events?: LineWebhookEvent[];
};

const LINE_MESSAGING_API_BASE = 'https://api.line.me/v2/bot/message';

const secureEqual = (left: Buffer, right: Buffer) => (
  left.length === right.length && crypto.timingSafeEqual(left, right)
);

export const verifyLineWebhookSignature = (
  rawBody: Buffer,
  signature: string,
  channelSecret: string,
) => {
  const cleanSignature = String(signature || '').trim();
  const cleanSecret = String(channelSecret || '').trim();
  if (!rawBody.length || !cleanSignature || !cleanSecret) return false;
  const expected = crypto.createHmac('sha256', cleanSecret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(cleanSignature, 'base64');
  } catch {
    return false;
  }
  return secureEqual(expected, received);
};

export const parseLineWebhookPayload = (rawBody: Buffer): LineWebhookPayload => {
  const parsed = JSON.parse(rawBody.toString('utf8')) as LineWebhookPayload;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.events)) {
    throw new Error('Invalid LINE webhook payload');
  }
  return parsed;
};

export const getLineWebhookTarget = (source: LineWebhookSource | undefined): LineWebhookTarget | null => {
  const sourceType = String(source?.type || '').trim() as LineSourceType;
  const targetId = sourceType === 'group'
    ? String(source?.groupId || '').trim()
    : sourceType === 'room'
      ? String(source?.roomId || '').trim()
      : sourceType === 'user'
        ? String(source?.userId || '').trim()
        : '';
  if (!targetId || !['user', 'group', 'room'].includes(sourceType)) return null;
  return { targetId, sourceType };
};

export const getLineIdCommandReply = (event: LineWebhookEvent) => {
  const text = String(event.message?.text || '').trim().toUpperCase();
  if (event.type !== 'message' || event.message?.type !== 'text' || !['#FDH-ID', 'FDH ID'].includes(text)) {
    return null;
  }
  const target = getLineWebhookTarget(event.source);
  const replyToken = String(event.replyToken || '').trim();
  if (!target || !replyToken) return null;
  return { target, replyToken };
};

const assertHttpsUrl = (value: string, label: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
  return url.toString();
};

export const validateLineMessages = (messages: LineMessage[]) => {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 5) {
    throw new Error('LINE requires 1-5 messages per request');
  }
  return messages.map((message) => {
    if (message.type === 'text') {
      const text = String(message.text || '').trim();
      if (!text || text.length > 5000) throw new Error('LINE text must contain 1-5000 characters');
      return { type: 'text' as const, text };
    }
    return {
      type: 'image' as const,
      originalContentUrl: assertHttpsUrl(message.originalContentUrl, 'originalContentUrl'),
      previewImageUrl: assertHttpsUrl(message.previewImageUrl, 'previewImageUrl'),
    };
  });
};

const callLineMessagingApi = async (
  endpoint: 'push' | 'reply',
  channelAccessToken: string,
  payload: Record<string, unknown>,
) => {
  const token = String(channelAccessToken || '').trim();
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetchWithTimeout(`${LINE_MESSAGING_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, 30_000);
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`LINE Messaging API returned ${response.status}: ${responseText.slice(0, 300)}`);
  }
};

export const pushLineMessages = async (
  targetId: string,
  messages: LineMessage[],
  channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
) => {
  const to = String(targetId || '').trim();
  if (!to) throw new Error('LINE target ID is required');
  await callLineMessagingApi('push', channelAccessToken, {
    to,
    messages: validateLineMessages(messages),
  });
};

export const replyLineMessages = async (
  replyToken: string,
  messages: LineMessage[],
  channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
) => {
  const cleanReplyToken = String(replyToken || '').trim();
  if (!cleanReplyToken) throw new Error('LINE reply token is required');
  await callLineMessagingApi('reply', channelAccessToken, {
    replyToken: cleanReplyToken,
    messages: validateLineMessages(messages),
  });
};
