import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export type VaultMatch = {
  source: string;
  heading: string;
  content: string;
  score: number;
  denseScore?: number;
  sparseScore?: number;
};

type VaultChunk = Omit<VaultMatch, 'score' | 'denseScore' | 'sparseScore'> & {
  tokens: Set<string>;
  normalized: string;
  hash: string;
  embedding?: number[];
};

type EmbeddingCacheEntry = {
  hash: string;
  embedding: number[];
};

type EmbeddingCacheFile = {
  version: 1;
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
};

const DEFAULT_EXTENSIONS = new Set(['.md', '.txt']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-ssr',
  '.vite',
  'coverage',
]);
const SEARCH_STOPWORDS = new Set([
  'การ', 'ที่', 'และ', 'หรือ', 'ของ', 'ใน', 'เป็น', 'มี', 'ได้', 'ให้',
  'ต้อง', 'ใช้', 'อะไร', 'อย่างไร', 'ไหม', 'ครับ', 'ค่ะ', 'สำหรับ',
]);
const DOMAIN_SYNONYMS: Array<[string, string[]]> = [
  ['ฟอกไต', ['dialysis', 'hemodialysis']],
  ['ล้างไต', ['dialysis', 'hemodialysis']],
  ['ไต', ['kidney', 'renal']],
  ['เบิกจ่าย', ['claim', 'reimbursement', 'fund']],
  ['เบิก', ['claim', 'reimbursement']],
  ['ปฏิเสธ', ['deny', 'denied', 'reject']],
  ['ผู้ป่วยนอก', ['opd']],
  ['ผู้ป่วยใน', ['ipd']],
  ['หัตถการ', ['procedure']],
  ['ยา', ['drug', 'medication']],
  ['สิทธิ์', ['privilege', 'pttype']],
  ['กองทุน', ['fund']],
];

type SegmentPart = { segment: string; isWordLike?: boolean };
type WordSegmenter = { segment: (input: string) => Iterable<SegmentPart> };
const SegmenterConstructor = (Intl as unknown as {
  Segmenter?: new (locale: string, options: { granularity: 'word' }) => WordSegmenter;
}).Segmenter;
const THAI_WORD_SEGMENTER = typeof SegmenterConstructor === 'function'
  ? new SegmenterConstructor('th', { granularity: 'word' })
  : null;

const normalize = (value: string) => value
  .normalize('NFC')
  .toLocaleLowerCase('th-TH')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const tokenizeThai = (value: string): string[] => {
  const normalized = normalize(value);
  if (!normalized) return [];

  const words: string[] = THAI_WORD_SEGMENTER
    ? Array.from(THAI_WORD_SEGMENTER.segment(normalized))
      .filter((part) => part.isWordLike)
      .map((part) => part.segment)
    : normalized.split(/[^\p{L}\p{N}_]+/u);

  const thaiCompounds = words.slice(0, -1)
    .map((word, index) => ({ word, next: words[index + 1] }))
    .filter(({ word, next }) => /^[\p{Script=Thai}]+$/u.test(word)
      && /^[\p{Script=Thai}]+$/u.test(next))
    .map(({ word, next }) => `${word}${next}`)
    .filter((word) => word.length <= 20);

  return Array.from(new Set([...words, ...thaiCompounds].filter((word) => word.length > 1)));
};

const chunkHash = (source: string, heading: string, content: string) => (
  crypto.createHash('sha256').update(`${source}\n${heading}\n${content}`).digest('hex')
);

export const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

const ollamaBaseUrl = () => (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const embeddingModel = () => process.env.OLLAMA_EMBED_MODEL || 'bge-m3';

const isValidEmbedding = (value: unknown): value is number[] => (
  Array.isArray(value)
  && value.length > 0
  && value.every((item) => typeof item === 'number' && Number.isFinite(item))
);

const isEmbeddingCacheFile = (value: unknown): value is EmbeddingCacheFile => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EmbeddingCacheFile>;
  return candidate.version === 1 && typeof candidate.model === 'string'
    && Boolean(candidate.entries) && typeof candidate.entries === 'object';
};

export const fetchOllamaEmbeddings = async (
  texts: string[],
  model = embeddingModel(),
  baseUrl = ollamaBaseUrl(),
): Promise<number[][] | null> => {
  if (!texts.length) return [];
  // 1. Try modern /api/embed batch endpoint
  try {
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: texts,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
      }),
      signal: AbortSignal.timeout(Math.max(10_000, Number(process.env.AI_TIMEOUT_MS) || 60_000)),
    });
    if (response.ok) {
      const payload = await response.json() as { embeddings?: number[][] };
      if (Array.isArray(payload.embeddings)
        && payload.embeddings.length === texts.length
        && payload.embeddings.every(isValidEmbedding)
        && payload.embeddings.every((embedding) => embedding.length === payload.embeddings?.[0].length)) {
        return payload.embeddings;
      }
    }
  } catch {
    // ignore and try fallback
  }

  // 2. Fallback to /api/embeddings (single input per item)
  try {
    const results: number[][] = [];
    for (const text of texts) {
      const response = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: text,
          keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const payload = await response.json() as { embedding?: number[] };
      if (!isValidEmbedding(payload.embedding)) return null;
      if (results.length > 0 && payload.embedding.length !== results[0].length) return null;
      results.push(payload.embedding);
    }
    return results;
  } catch {
    return null;
  }
};

const splitIntoChunks = (text: string, source: string): VaultChunk[] => {
  const chunks: VaultChunk[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let heading = path.basename(source);
  let buffer: string[] = [];
  let length = 0;

  const flush = () => {
    const content = buffer.join('\n').trim();
    buffer = [];
    length = 0;
    if (content.length < 30) return;
    const normalized = normalize(`${heading}\n${content}`);
    const hash = chunkHash(source, heading, content);
    chunks.push({
      source,
      heading,
      content: content.slice(0, 2_400),
      normalized,
      hash,
      tokens: new Set(tokenizeThai(normalized)),
    });
  };

  for (const line of lines) {
    const markdownHeading = line.match(/^#{1,6}\s+(.+)$/);
    if (markdownHeading) {
      flush();
      heading = markdownHeading[1].trim();
      continue;
    }

    if (!line.trim() && length >= 700) {
      flush();
      continue;
    }

    buffer.push(line);
    length += line.length + 1;
    if (length >= 1_800) flush();
  }
  flush();
  return chunks;
};

const walkFiles = async (root: string, extensions: Set<string>): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (directory: string) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.knowledge') continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(fullPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  };
  await visit(root);
  return files;
};

export class VaultKnowledgeBase {
  private chunks: VaultChunk[] = [];
  private lastIndexedAt = 0;
  private indexedFiles = 0;

  constructor(
    readonly root: string,
    private readonly cacheMs = 5 * 60_000,
    private readonly maxFileBytes = 2_500_000,
  ) {}

  private getCacheFilePath(): string {
    if (process.env.VAULT_EMBEDDING_CACHE_FILE) {
      return path.resolve(process.env.VAULT_EMBEDDING_CACHE_FILE);
    }
    const preferredDir = path.resolve(this.root, '..', '..', 'data');
    return path.join(preferredDir, 'vault_embeddings_cache.json');
  }

  async reindex(force = false) {
    if (!force && this.chunks.length && Date.now() - this.lastIndexedAt < this.cacheMs) {
      return this.status();
    }

    const configuredExtensions = (process.env.VAULT_INCLUDE_EXTENSIONS || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .map((item) => (item.startsWith('.') ? item : `.${item}`));
    const extensions = configuredExtensions.length
      ? new Set(configuredExtensions)
      : DEFAULT_EXTENSIONS;
    const files = await walkFiles(this.root, extensions);
    const nextChunks: VaultChunk[] = [];
    let indexedFiles = 0;

    for (const file of files) {
      const stat = await fs.stat(file);
      if (stat.size === 0 || stat.size > this.maxFileBytes) continue;
      const content = await fs.readFile(file, 'utf8');
      const source = path.relative(this.root, file) || path.basename(file);
      nextChunks.push(...splitIntoChunks(content, source));
      indexedFiles += 1;
    }

    // Load persistent embedding cache
    const cachePath = this.getCacheFilePath();
    const model = embeddingModel();
    let cache: Record<string, EmbeddingCacheEntry> = {};
    let cacheNeedsWrite = false;
    try {
      const raw = await fs.readFile(cachePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (isEmbeddingCacheFile(parsed)) {
        if (parsed.version === 1 && parsed.model === model && parsed.entries && typeof parsed.entries === 'object') {
          cache = parsed.entries;
        }
      } else if (parsed && typeof parsed === 'object') {
        // One-time migration: the legacy cache was created by the configured embedding model.
        cache = parsed as Record<string, EmbeddingCacheEntry>;
        cacheNeedsWrite = true;
      }
    } catch {
      cache = {};
    }

    // Match chunks with cached embeddings
    const unEmbedded: VaultChunk[] = [];
    for (const chunk of nextChunks) {
      const cached = cache[chunk.hash];
      if (cached && isValidEmbedding(cached.embedding)) {
        chunk.embedding = cached.embedding;
      } else {
        unEmbedded.push(chunk);
      }
    }

    // Batch embed missing chunks via Ollama
    if (unEmbedded.length > 0) {
      const batchSize = Math.max(4, Math.min(32, Number(process.env.VAULT_EMBED_BATCH_SIZE) || 24));
      for (let i = 0; i < unEmbedded.length; i += batchSize) {
        const batch = unEmbedded.slice(i, i + batchSize);
        const texts = batch.map((c) => `${c.heading}\n${c.content.slice(0, 1_200)}`);
        try {
          const embeddings = await fetchOllamaEmbeddings(texts);
          if (embeddings && embeddings.length === batch.length) {
            batch.forEach((c, idx) => {
              c.embedding = embeddings[idx];
              cache[c.hash] = { hash: c.hash, embedding: embeddings[idx] };
            });
            cacheNeedsWrite = true;
          } else {
            // Ollama might be unavailable or busy, stop embedding batching and proceed
            break;
          }
        } catch {
          break;
        }
      }

    }

    if (cacheNeedsWrite) {
      const entries = Object.fromEntries(nextChunks
        .filter((chunk) => isValidEmbedding(chunk.embedding))
        .map((chunk) => [chunk.hash, { hash: chunk.hash, embedding: chunk.embedding as number[] }]));
      const firstEmbedding = Object.values(entries)[0]?.embedding;
      const cacheFile: EmbeddingCacheFile = {
        version: 1,
        model,
        dimensions: firstEmbedding?.length || 0,
        entries,
      };
      try {
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, JSON.stringify(cacheFile), 'utf8');
      } catch (error) {
        console.warn('Cannot write vault embeddings cache:', error);
      }
    }

    this.chunks = nextChunks;
    this.indexedFiles = indexedFiles;
    this.lastIndexedAt = Date.now();
    return this.status();
  }

  async search(query: string, limit = 5): Promise<VaultMatch[]> {
    await this.reindex();
    const normalizedQuery = normalize(query);
    const synonymTokens = DOMAIN_SYNONYMS
      .filter(([phrase]) => normalizedQuery.includes(phrase))
      .flatMap(([, synonyms]) => synonyms);
    const queryTokens = Array.from(new Set([
      ...tokenizeThai(normalizedQuery).filter((token) => !SEARCH_STOPWORDS.has(token)),
      ...synonymTokens,
    ]));

    // Generate Deep Learning Query Embedding
    let queryEmbedding: number[] | null = null;
    try {
      const embeddings = await fetchOllamaEmbeddings([query]);
      if (embeddings && embeddings.length > 0) {
        queryEmbedding = embeddings[0];
      }
    } catch {
      queryEmbedding = null;
    }

    if (!queryTokens.length && !queryEmbedding) return [];

    const semanticWeight = Number(process.env.VAULT_SEMANTIC_WEIGHT) || 28;
    const ranked = this.chunks
      .map((chunk) => {
        let sparseScore = 0;
        const normalizedSource = chunk.source.replace(/\\/g, '/');

        // 1. Sparse Lexical Scoring
        for (const token of queryTokens) {
          if (chunk.tokens.has(token)) sparseScore += token.length >= 5 ? 3 : 1.5;
          if (chunk.normalized.includes(token)) sparseScore += 0.5;
          if (normalize(chunk.heading).includes(token)) sparseScore += 2;
        }
        if (normalizedQuery.length >= 6 && chunk.normalized.includes(normalizedQuery)) {
          sparseScore += 12;
        }

        // 2. Dense Semantic Scoring (Deep Learning via Cosine Similarity)
        let denseScore = 0;
        if (queryEmbedding && chunk.embedding) {
          denseScore = cosineSimilarity(queryEmbedding, chunk.embedding);
        }

        // 3. Category & Folder Priority
        let folderBoost = 0;
        if (/^FDHChecker\/70_AI_Managed\//i.test(normalizedSource)) folderBoost += 7;
        else if (/^FDHChecker\/(10_Rules_and_Config|20_Data_Model|30_Claims_and_Knowledge)\//i.test(normalizedSource)) folderBoost += 4;
        else if (/^FDHChecker\/50_Operations\//i.test(normalizedSource)) folderBoost += 2;
        else if (/^FDHChecker\/40_Project_Documentation\//i.test(normalizedSource)) folderBoost -= 2;
        else if (/^FDHChecker\/60_Programming_Knowledge\//i.test(normalizedSource)) folderBoost -= 3;
        if (/\/extracted\//i.test(normalizedSource)) folderBoost -= 2;

        // 4. Hybrid Combination
        const semanticContribution = denseScore > 0.25 ? (denseScore * semanticWeight) : 0;
        const totalScore = semanticContribution + sparseScore + (sparseScore > 0 || semanticContribution > 5 ? folderBoost : 0);

        return {
          ...chunk,
          score: totalScore,
          denseScore,
          sparseScore,
        };
      })
      .filter((chunk) => chunk.score > 3.0 || (chunk.denseScore && chunk.denseScore > 0.45))
      .sort((a, b) => b.score - a.score);

    const selected: typeof ranked = [];
    const headings = new Set<string>();
    const perSource = new Map<string, number>();
    for (const chunk of ranked) {
      const headingKey = `${chunk.source}\u0000${chunk.heading}`;
      if (headings.has(headingKey) || (perSource.get(chunk.source) || 0) >= 2) continue;
      headings.add(headingKey);
      perSource.set(chunk.source, (perSource.get(chunk.source) || 0) + 1);
      selected.push(chunk);
      if (selected.length >= limit) break;
    }
    return selected.map(({ tokens: _tokens, normalized: _normalized, hash: _hash, embedding: _emb, ...match }) => match);
  }

  status() {
    const embeddedChunks = this.chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0).length;
    return {
      root: this.root,
      indexedFiles: this.indexedFiles,
      chunks: this.chunks.length,
      embeddedChunks,
      embedModel: embeddingModel(),
      lastIndexedAt: this.lastIndexedAt ? new Date(this.lastIndexedAt).toISOString() : null,
    };
  }
}
