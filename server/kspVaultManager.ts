import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

export type KspVaultCategory = 'claims' | 'data' | 'operations' | 'programming' | 'terminology' | 'learning' | 'general';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, '..');
const defaultRoot = path.join(projectRoot, 'knowlage', 'ksp-vault');
const allowedCategories = new Set<KspVaultCategory>([
  'claims', 'data', 'operations', 'programming', 'terminology', 'learning', 'general',
]);

export const getKspVaultRoot = () => {
  const configured = path.resolve(process.env.KSP_VAULT_PATH || process.env.VAULT_PATH || defaultRoot);
  return path.basename(configured).toLowerCase() === 'fdhchecker' ? configured : path.join(configured, 'FDHChecker');
};

const safePart = (value: string, fallback = 'note') => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^a-z0-9ก-๙_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 100) || fallback;

const atomicWrite = async (target: string, content: string) => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, target);
};

const appendAudit = async (entry: Record<string, unknown>) => {
  const root = getKspVaultRoot();
  const auditPath = path.join(root, '_ksp', 'ai-audit.jsonl');
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(auditPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, 'utf8');
};

export const saveManagedVaultNote = async (input: {
  title: string;
  content: string;
  category?: KspVaultCategory | string;
  tags?: string[];
  actor?: string;
  source?: string;
  stableId?: string;
}) => {
  const root = getKspVaultRoot();
  const title = String(input.title || '').trim().slice(0, 160);
  const content = String(input.content || '').trim().slice(0, 30_000);
  if (!title || !content) throw new Error('title และ content ของ Vault ห้ามว่าง');
  const requestedCategory = String(input.category || 'general').toLowerCase() as KspVaultCategory;
  const category = allowedCategories.has(requestedCategory) ? requestedCategory : 'general';
  const id = safePart(input.stableId || title, crypto.createHash('sha1').update(title).digest('hex').slice(0, 12));
  const relative = path.join('70_AI_Managed', category, `${id}.md`);
  const target = path.join(root, relative);
  const existing = await fs.readFile(target, 'utf8').catch(() => '');
  const revisionId = new Date().toISOString().replace(/[:.]/g, '-');
  if (existing) {
    const revisionPath = path.join(root, '_ksp', 'ai-revisions', category, id, `${revisionId}.md`);
    await atomicWrite(revisionPath, existing);
  }
  const tags = Array.from(new Set((input.tags || []).map((tag) => safePart(String(tag), '')).filter(Boolean))).slice(0, 20);
  const body = [
    '---',
    'ksp_schema: 1',
    'project: FDHChecker',
    'type: "ai-managed-knowledge"',
    `category: ${JSON.stringify(category)}`,
    `title: ${JSON.stringify(title)}`,
    `tags: ${JSON.stringify(tags)}`,
    `source: ${JSON.stringify(String(input.source || 'user-and-ai'))}`,
    `managed_by: "FDH Local AI"`,
    `updated_by: ${JSON.stringify(String(input.actor || 'unknown').slice(0, 128))}`,
    `updated_at: ${JSON.stringify(new Date().toISOString())}`,
    '---',
    '',
    `# ${title}`,
    '',
    content,
    '',
  ].join('\n');
  await atomicWrite(target, body);
  await appendAudit({
    action: existing ? 'update' : 'create', relativePath: relative.split(path.sep).join('/'),
    category, title, actor: String(input.actor || 'unknown').slice(0, 128),
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
  });
  return { root, relativePath: relative.split(path.sep).join('/'), title, category, updated: Boolean(existing) };
};

export const buildKspVaultExport = async () => {
  const root = getKspVaultRoot();
  const zip = new AdmZip();
  zip.addLocalFolder(root, 'FDHChecker');
  return zip.toBuffer();
};

export const getKspVaultStatus = async () => {
  const root = getKspVaultRoot();
  const manifestPath = path.join(root, '_ksp', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8').catch(() => '{}')) as Record<string, unknown>;
  const audit = await fs.readFile(path.join(root, '_ksp', 'ai-audit.jsonl'), 'utf8').catch(() => '');
  return {
    root,
    schema: manifest.schema || 1,
    generatedAt: manifest.generatedAt || null,
    generatedFiles: Array.isArray(manifest.files) ? manifest.files.length : 0,
    aiChanges: audit.split('\n').filter(Boolean).length,
  };
};
