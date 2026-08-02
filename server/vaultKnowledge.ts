import { promises as fs } from 'fs';
import path from 'path';

export type VaultMatch = {
  source: string;
  heading: string;
  content: string;
  score: number;
};

type VaultChunk = Omit<VaultMatch, 'score'> & {
  tokens: Set<string>;
  normalized: string;
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
    chunks.push({
      source,
      heading,
      content: content.slice(0, 2_400),
      normalized,
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

  async reindex(force = false) {
    if (!force && this.chunks.length && Date.now() - this.lastIndexedAt < this.cacheMs) {
      return this.status();
    }

    const configuredExtensions = (process.env.VAULT_INCLUDE_EXTENSIONS || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .map((item) => item.startsWith('.') ? item : `.${item}`);
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
    if (!queryTokens.length) return [];

    const ranked = this.chunks
      .map((chunk) => {
        let score = 0;
        for (const token of queryTokens) {
          if (chunk.tokens.has(token)) score += token.length >= 5 ? 3 : 1.5;
          if (chunk.normalized.includes(token)) score += 0.5;
          if (normalize(chunk.heading).includes(token)) score += 2;
        }
        if (normalizedQuery.length >= 6 && chunk.normalized.includes(normalizedQuery)) score += 12;
        if (score > 0) {
          if (/^FDHChecker\/70_AI_Managed\//i.test(chunk.source)) score += 7;
          else if (/^FDHChecker\/(10_Rules_and_Config|20_Data_Model|30_Claims_and_Knowledge)\//i.test(chunk.source)) score += 4;
          else if (/^FDHChecker\/50_Operations\//i.test(chunk.source)) score += 2;
          else if (/^FDHChecker\/40_Project_Documentation\//i.test(chunk.source)) score += 1;
          if (/\/extracted\//i.test(chunk.source)) score -= 2;
        }
        return { ...chunk, score };
      })
      .filter((chunk) => chunk.score > 0)
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
    return selected.map(({ tokens: _tokens, normalized: _normalized, ...match }) => match);
  }

  status() {
    return {
      root: this.root,
      indexedFiles: this.indexedFiles,
      chunks: this.chunks.length,
      lastIndexedAt: this.lastIndexedAt ? new Date(this.lastIndexedAt).toISOString() : null,
    };
  }
}
