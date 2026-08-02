---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiLearningStore.ts"
source_hash: "ad1e1820d16f04845d7699d7fe356c934b2f4667283892353ee50c8de89d0f7d"
managed_by: "sync-ksp-vault"
---
# aiLearningStore.ts

> Source: `server/aiLearningStore.ts`
> SHA-256: `ad1e1820d16f04845d7699d7fe356c934b2f4667283892353ee50c8de89d0f7d`

````typescript
import crypto from 'crypto';
import { getRepstmConnection } from './db.js';
import { validateReadOnlySql } from './aiReadOnlyQuery.js';
import { saveManagedVaultNote } from './kspVaultManager.js';

export type AiFeedbackRating = 'correct' | 'incorrect' | 'remember';

export type LearningExample = {
  id: number;
  question: string;
  correction: string;
  title: string;
  safeSql: string;
  positiveCount: number;
  negativeCount: number;
  rememberCount: number;
  status: 'pending' | 'approved' | 'rejected';
};

const MIN_POSITIVE = Math.min(10, Math.max(2, Number(process.env.AI_LEARNING_MIN_POSITIVE) || 2));
const MAX_EXAMPLES = Math.min(1_000, Math.max(50, Number(process.env.AI_LEARNING_MAX_EXAMPLES) || 300));
const CACHE_MS = Math.min(10 * 60_000, Math.max(5_000, Number(process.env.AI_LEARNING_CACHE_MS) || 60_000));

const EXAMPLE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ai_learning_example (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    question_hash CHAR(64) NOT NULL UNIQUE,
    question TEXT NOT NULL,
    correction TEXT NULL,
    answer_excerpt TEXT NULL,
    safe_sql TEXT NULL,
    title VARCHAR(255) NULL,
    positive_count INT NOT NULL DEFAULT 0,
    negative_count INT NOT NULL DEFAULT 0,
    remember_count INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_by VARCHAR(128) NULL,
    use_count INT NOT NULL DEFAULT 0,
    last_used_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status_updated (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const FEEDBACK_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ai_feedback (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    example_id BIGINT NOT NULL,
    rating VARCHAR(16) NOT NULL,
    correction TEXT NULL,
    actor VARCHAR(128) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_example_created (example_id, created_at),
    INDEX idx_rating_created (rating, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

let ensurePromise: Promise<void> | null = null;
let cache: { expiresAt: number; examples: LearningExample[] } | null = null;

export const ensureAiLearningTables = async () => {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const connection = await getRepstmConnection();
      try {
        await connection.query(EXAMPLE_TABLE_SQL);
        await connection.query(FEEDBACK_TABLE_SQL);
      } finally {
        connection.release();
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
};

const normalizeQuestion = (value: string) => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 2_000);

const questionHash = (question: string) => crypto.createHash('sha256').update(normalizeQuestion(question)).digest('hex');

const safeStoredSql = (sql?: string) => {
  if (!sql) return '';
  try {
    return validateReadOnlySql(sql).sql;
  } catch {
    return '';
  }
};

const mapExample = (row: Record<string, unknown>): LearningExample => ({
  id: Number(row.id),
  question: String(row.question || ''),
  correction: String(row.correction || ''),
  title: String(row.title || ''),
  safeSql: String(row.safe_sql || ''),
  positiveCount: Number(row.positive_count || 0),
  negativeCount: Number(row.negative_count || 0),
  rememberCount: Number(row.remember_count || 0),
  status: ['approved', 'rejected'].includes(String(row.status)) ? String(row.status) as 'approved' | 'rejected' : 'pending',
});

export const recordAiFeedback = async (input: {
  question: string;
  answer: string;
  sql?: string;
  title?: string;
  rating: AiFeedbackRating;
  correction?: string;
  actor?: string;
}) => {
  await ensureAiLearningTables();
  const question = normalizeQuestion(input.question);
  if (!question) throw new Error('ไม่พบคำถามสำหรับบันทึก feedback');
  const correction = String(input.correction || '').trim().slice(0, 4_000);
  const safeSql = safeStoredSql(input.sql);
  const connection = await getRepstmConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO ai_learning_example
         (question_hash, question, correction, answer_excerpt, safe_sql, title, positive_count, negative_count, remember_count, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
       ON DUPLICATE KEY UPDATE
         question = VALUES(question),
         correction = CASE WHEN VALUES(correction) <> '' THEN VALUES(correction) ELSE correction END,
         answer_excerpt = VALUES(answer_excerpt),
         safe_sql = CASE WHEN VALUES(safe_sql) <> '' THEN VALUES(safe_sql) ELSE safe_sql END,
         title = CASE WHEN VALUES(title) <> '' THEN VALUES(title) ELSE title END,
         positive_count = positive_count + VALUES(positive_count),
         negative_count = negative_count + VALUES(negative_count),
         remember_count = remember_count + VALUES(remember_count)`,
      [
        questionHash(question), question, correction, String(input.answer || '').slice(0, 4_000), safeSql,
        String(input.title || '').slice(0, 255), input.rating === 'correct' ? 1 : 0,
        input.rating === 'incorrect' ? 1 : 0, input.rating === 'remember' ? 1 : 0,
        String(input.actor || '').slice(0, 128),
      ],
    );
    const [rows] = await connection.query(
      `SELECT * FROM ai_learning_example WHERE question_hash = ? FOR UPDATE`,
      [questionHash(question)],
    );
    const current = mapExample((rows as Array<Record<string, unknown>>)[0]);
    let status: LearningExample['status'] = current.status;
    if (input.rating === 'incorrect') status = current.negativeCount >= 2 ? 'rejected' : 'pending';
    else if (current.safeSql && (input.rating === 'remember' || (current.positiveCount >= MIN_POSITIVE && current.negativeCount === 0))) status = 'approved';
    await connection.query(
      `UPDATE ai_learning_example SET status = ?, safe_sql = CASE WHEN ? = 'incorrect' THEN NULL ELSE safe_sql END WHERE id = ?`,
      [status, input.rating, current.id],
    );
    await connection.query(
      'INSERT INTO ai_feedback (example_id, rating, correction, actor) VALUES (?, ?, ?, ?)',
      [current.id, input.rating, correction, String(input.actor || '').slice(0, 128)],
    );
    await connection.commit();
    cache = null;
    if (status === 'approved') {
      await saveManagedVaultNote({
        title: `รูปแบบคำถาม: ${question.slice(0, 120)}`,
        content: [
          '## คำถามที่ยืนยันแล้ว', question,
          correction ? `\n## คำอธิบายจากผู้ใช้\n${correction}` : '',
          current.title ? `\n## ชื่อรายงาน\n${current.title}` : '',
          current.safeSql ? `\n## SQL read-only ที่ผ่าน validator\n\`\`\`sql\n${current.safeSql}\n\`\`\`` : '',
          '\n> ต้องปรับวันที่และเงื่อนไขตามคำถามใหม่ ห้ามใช้ตัวเลขคำตอบเดิมเป็นข้อเท็จจริง',
        ].filter(Boolean).join('\n\n'),
        category: 'learning',
        tags: ['ai-learning', 'approved-example'],
        actor: String(input.actor || 'unknown'),
        source: 'ai_feedback',
        stableId: `feedback-${questionHash(question).slice(0, 20)}`,
      }).catch((error) => console.warn('Cannot mirror approved AI feedback to KSP Vault:', (error as Error).message));
    }
    return { ...current, status, learned: status === 'approved', minPositive: MIN_POSITIVE };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
};

const tokens = (value: string) => {
  const normalized = normalizeQuestion(value);
  const words = new Set<string>();
  try {
    type WordSegmenter = { segment: (input: string) => Iterable<{ isWordLike?: boolean; segment: string }> };
    const Segmenter = (Intl as unknown as {
      Segmenter?: new (locale: string, options: { granularity: 'word' }) => WordSegmenter;
    }).Segmenter;
    if (!Segmenter) throw new Error('Intl.Segmenter unavailable');
    const segmenter = new Segmenter('th', { granularity: 'word' });
    for (const item of segmenter.segment(normalized)) if (item.isWordLike && item.segment.length > 1) words.add(item.segment);
  } catch {
    for (const item of normalized.split(/[^a-z0-9ก-๙]+/i)) if (item.length > 1) words.add(item);
  }
  return words;
};

export const rankLearningExamples = (question: string, examples: LearningExample[], limit = 5) => {
  const normalized = normalizeQuestion(question);
  const questionTokens = tokens(normalized);
  return examples.map((example) => {
    const exampleTokens = tokens(example.question);
    let overlap = 0;
    for (const token of questionTokens) if (exampleTokens.has(token)) overlap += 1;
    const substring = normalized.includes(normalizeQuestion(example.question)) || normalizeQuestion(example.question).includes(normalized) ? 5 : 0;
    return { example, score: overlap * 2 + substring };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.example.rememberCount - left.example.rememberCount)
    .slice(0, limit)
    .map((item) => item.example);
};

const loadApprovedExamples = async () => {
  if (cache && cache.expiresAt > Date.now()) return cache.examples;
  await ensureAiLearningTables();
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      `SELECT * FROM ai_learning_example WHERE status = 'approved' ORDER BY remember_count DESC, positive_count DESC, updated_at DESC LIMIT ?`,
      [MAX_EXAMPLES],
    );
    const examples = (rows as Array<Record<string, unknown>>).map(mapExample).filter((example) => !example.safeSql || Boolean(safeStoredSql(example.safeSql)));
    cache = { expiresAt: Date.now() + CACHE_MS, examples };
    return examples;
  } finally {
    connection.release();
  }
};

export const getAiLearningContext = async (question: string) => {
  try {
    const matches = rankLearningExamples(question, await loadApprovedExamples());
    if (!matches.length) return '';
    const connection = await getRepstmConnection();
    try {
      await connection.query(
        `UPDATE ai_learning_example SET use_count = use_count + 1, last_used_at = NOW() WHERE id IN (${matches.map(() => '?').join(',')})`,
        matches.map((example) => example.id),
      );
    } finally {
      connection.release();
    }
    return [
      'ตัวอย่างที่ผู้ใช้ยืนยันแล้ว (เรียนรู้เฉพาะความหมายและรูปแบบ SQL; ห้ามคัดลอกวันที่หรือตัวเลขผลลัพธ์เดิม):',
      ...matches.map((example, index) => [
        `${index + 1}. คำถามตัวอย่าง: ${example.question}`,
        example.correction ? `คำอธิบายจากผู้ใช้: ${example.correction}` : '',
        example.title ? `ชื่อรายงาน: ${example.title}` : '',
        example.safeSql ? `SQL read-only ที่เคยผ่านการตรวจ: ${example.safeSql}` : '',
      ].filter(Boolean).join('\n')),
    ].join('\n\n');
  } catch (error) {
    console.warn('AI learning context unavailable:', (error as Error).message);
    return '';
  }
};

export const listAiLearningExamples = async (status = 'pending', limit = 100) => {
  await ensureAiLearningTables();
  const safeStatus = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      'SELECT * FROM ai_learning_example WHERE status = ? ORDER BY updated_at DESC LIMIT ?',
      [safeStatus, Math.min(500, Math.max(1, limit))],
    );
    return (rows as Array<Record<string, unknown>>).map(mapExample);
  } finally {
    connection.release();
  }
};

export const setAiLearningExampleStatus = async (id: number, status: 'approved' | 'rejected') => {
  await ensureAiLearningTables();
  const connection = await getRepstmConnection();
  try {
    const [result] = await connection.query(
      'UPDATE ai_learning_example SET status = ? WHERE id = ?', [status, id],
    );
    cache = null;
    return Number((result as { affectedRows?: number }).affectedRows || 0) > 0;
  } finally {
    connection.release();
  }
};

````
