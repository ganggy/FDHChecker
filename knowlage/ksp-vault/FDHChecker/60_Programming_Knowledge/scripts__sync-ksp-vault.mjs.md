---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "scripts/sync-ksp-vault.mjs"
source_hash: "7b7a8c32bf0578eb88eb0fc0e05390cc3650949322dbf100a1b41298c16c64c3"
managed_by: "sync-ksp-vault"
---
# sync-ksp-vault.mjs

> Source: `scripts/sync-ksp-vault.mjs`
> SHA-256: `7b7a8c32bf0578eb88eb0fc0e05390cc3650949322dbf100a1b41298c16c64c3`

````javascript
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};
const canonicalRoot = path.resolve(valueAfter('--target') || process.env.KSP_VAULT_PATH || path.join(projectRoot, 'knowlage', 'ksp-vault'));
const vaultRoot = path.join(canonicalRoot, 'FDHChecker');
const generatedDirectories = [
  '00_Home', '10_Rules_and_Config', '20_Data_Model', '30_Claims_and_Knowledge',
  '40_Project_Documentation', '50_Operations', '60_Programming_Knowledge',
];

const assertSafeVaultPath = (target) => {
  const resolved = path.resolve(target);
  if (resolved === '/' || resolved === projectRoot || resolved.length < 12) throw new Error(`Unsafe vault target: ${resolved}`);
};
assertSafeVaultPath(vaultRoot);

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const slash = (value) => value.split(path.sep).join('/');
const noteName = (relative) => relative.replace(/[\\/:*?"<>|]/g, '__').replace(/\s+/g, ' ').trim();
const codeLanguage = (file) => ({
  '.ts': 'typescript', '.tsx': 'tsx', '.mjs': 'javascript', '.js': 'javascript',
  '.json': 'json', '.sh': 'bash', '.css': 'css', '.html': 'html', '.md': 'markdown', '.txt': 'text',
}[path.extname(file).toLowerCase()] || 'text');

const manifest = [];
const writeGenerated = async (relativeOutput, content, metadata) => {
  const output = path.join(vaultRoot, relativeOutput);
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n*$/, '\n');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, normalizedContent, 'utf8');
  manifest.push({
    output: slash(path.relative(vaultRoot, output)),
    sha256: hash(normalizedContent),
    bytes: Buffer.byteLength(normalizedContent),
    ...metadata,
  });
};

const frontmatter = (metadata) => [
  '---',
  'ksp_schema: 1',
  'project: FDHChecker',
  ...Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
  '---',
  '',
].join('\n');

const sourceNote = (source, category, content) => {
  const relativeSource = slash(path.relative(projectRoot, source));
  const sourceHash = hash(content);
  return `${frontmatter({ type: 'source-snapshot', category, source: relativeSource, source_hash: sourceHash, managed_by: 'sync-ksp-vault' })}# ${path.basename(source)}\n\n> Source: \`${relativeSource}\`  \n> SHA-256: \`${sourceHash}\`\n\n\`\`\`\`${codeLanguage(source)}\n${content}\n\`\`\`\`\n`;
};

const listFiles = async (directory, predicate, depth = Infinity) => {
  const output = [];
  const visit = async (current, level) => {
    if (level > depth) return;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full, level + 1);
      else if (entry.isFile() && predicate(full)) output.push(full);
    }
  };
  await visit(directory, 0);
  return output.sort();
};

const renderJsonTree = (value, level = 0) => {
  const indent = '  '.repeat(level);
  if (Array.isArray(value)) return value.map((item) => `${indent}- ${typeof item === 'object' ? `\n${renderJsonTree(item, level + 1)}` : String(item)}`).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => (
    item && typeof item === 'object'
      ? `${indent}- **${key}**\n${renderJsonTree(item, level + 1)}`
      : `${indent}- **${key}:** ${String(item)}`
  )).join('\n');
  return `${indent}${String(value)}`;
};

const findObsidianVault = async () => {
  const explicit = valueAfter('--mirror') || process.env.KSP_OBSIDIAN_PATH;
  if (explicit) return path.resolve(explicit);
  if (!args.includes('--obsidian')) return '';
  const configPath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const paths = Object.values(config.vaults || {}).map((item) => String(item?.path || '')).filter(Boolean);
  return paths.find((item) => path.basename(item).toLowerCase() === 'ksp-vault')
    || paths.find((item) => item.toLowerCase().includes('ksp-vault'))
    || '';
};

const copyNewerTree = async (source, destination) => {
  const entries = await fs.readdir(source, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyNewerTree(sourcePath, destinationPath);
    else if (entry.isFile()) {
      const [sourceStat, destinationStat] = await Promise.all([
        fs.stat(sourcePath), fs.stat(destinationPath).catch(() => null),
      ]);
      if (!destinationStat || sourceStat.mtimeMs > destinationStat.mtimeMs) {
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath);
      }
    }
  }
};

const obsidianRoot = await findObsidianVault();
await fs.mkdir(vaultRoot, { recursive: true });
if (obsidianRoot) {
  await copyNewerTree(
    path.join(obsidianRoot, 'FDHChecker', '70_AI_Managed'),
    path.join(vaultRoot, '70_AI_Managed'),
  );
}
const priorRevisionPath = path.join(vaultRoot, '_ksp', 'revisions.jsonl');
const priorRevisions = await fs.readFile(priorRevisionPath, 'utf8').catch(() => '');
for (const directory of generatedDirectories) await fs.rm(path.join(vaultRoot, directory), { recursive: true, force: true });
await fs.mkdir(path.join(vaultRoot, '70_AI_Managed'), { recursive: true });

const rootDocs = (await listFiles(projectRoot, (file) => path.dirname(file) === projectRoot && path.extname(file).toLowerCase() === '.md', 0));
for (const source of rootDocs) {
  const content = await fs.readFile(source, 'utf8');
  const relativeOutput = path.join('40_Project_Documentation', path.basename(source));
  await writeGenerated(relativeOutput, `${frontmatter({ type: 'project-document', category: 'documentation', source: path.basename(source), source_hash: hash(content), managed_by: 'sync-ksp-vault' })}${content}`, {
    type: 'project-document', source: path.basename(source),
  });
}

const knowledgeRoot = path.join(projectRoot, 'knowlage');
const knowledgeFiles = await listFiles(knowledgeRoot, (file) => ['.md', '.txt', '.json'].includes(path.extname(file).toLowerCase()));
for (const source of knowledgeFiles) {
  if (source.startsWith(path.join(knowledgeRoot, 'ksp-vault'))) continue;
  const content = await fs.readFile(source, 'utf8');
  const relative = slash(path.relative(knowledgeRoot, source));
  await writeGenerated(path.join('30_Claims_and_Knowledge', relative), `${frontmatter({ type: 'domain-knowledge', category: 'claims', source: `knowlage/${relative}`, source_hash: hash(content), managed_by: 'sync-ksp-vault' })}${content}`, {
    type: 'domain-knowledge', source: `knowlage/${relative}`,
  });
}

const businessRulesPath = path.join(projectRoot, 'server', 'config', 'business_rules.json');
const businessRulesText = await fs.readFile(businessRulesPath, 'utf8');
const businessRules = JSON.parse(businessRulesText);
await writeGenerated(
  path.join('10_Rules_and_Config', 'Business Rules Overview.md'),
  `${frontmatter({ type: 'rule-catalog', category: 'claims', source: 'server/config/business_rules.json', source_hash: hash(businessRulesText), managed_by: 'sync-ksp-vault' })}# FDHChecker Business Rules\n\n${renderJsonTree(businessRules)}\n`,
  { type: 'rule-catalog', source: 'server/config/business_rules.json' },
);

const semanticSource = await fs.readFile(path.join(projectRoot, 'server', 'aiHosxpCatalog.ts'), 'utf8');
const semanticMatch = semanticSource.match(/HOSXP_SEMANTIC_CATALOG\s*=\s*`([\s\S]*?)`\.trim\(\)/);
await writeGenerated(
  path.join('20_Data_Model', 'HOSxP Semantic Catalog.md'),
  `${frontmatter({ type: 'data-catalog', category: 'data-model', source: 'server/aiHosxpCatalog.ts', source_hash: hash(semanticSource), managed_by: 'sync-ksp-vault' })}# HOSxP Semantic Catalog\n\n${semanticMatch?.[1]?.trim() || semanticSource}\n`,
  { type: 'data-catalog', source: 'server/aiHosxpCatalog.ts' },
);

const configFiles = [
  ...(await listFiles(path.join(projectRoot, 'src', 'config'), () => true)),
  ...(await listFiles(path.join(projectRoot, 'server', 'config'), () => true)),
  path.join(projectRoot, 'public', 'repErrorCatalog.json'),
];
for (const source of configFiles) {
  const content = await fs.readFile(source, 'utf8');
  const relative = slash(path.relative(projectRoot, source));
  await writeGenerated(path.join('10_Rules_and_Config', `${noteName(relative)}.md`), sourceNote(source, 'rules-and-config', content), {
    type: 'source-snapshot', source: relative,
  });
}

const programmingFiles = [
  ...(await listFiles(path.join(projectRoot, 'server'), (file) => ['.ts', '.mjs'].includes(path.extname(file)))),
  ...(await listFiles(path.join(projectRoot, 'src'), (file) => ['.ts', '.tsx', '.css'].includes(path.extname(file)))),
  ...(await listFiles(path.join(projectRoot, 'scripts'), (file) => ['.mjs', '.sh'].includes(path.extname(file)))),
];
for (const source of programmingFiles) {
  const content = await fs.readFile(source, 'utf8');
  const relative = slash(path.relative(projectRoot, source));
  const category = /operational|overview|monitor|alert|report|claim|fund|fdh/i.test(relative) ? 'operations' : 'programming';
  const folder = category === 'operations' ? '50_Operations' : '60_Programming_Knowledge';
  await writeGenerated(path.join(folder, `${noteName(relative)}.md`), sourceNote(source, category, content), {
    type: 'source-snapshot', source: relative,
  });
}

const counts = manifest.reduce((result, item) => {
  result[item.type] = (result[item.type] || 0) + 1;
  return result;
}, {});
const home = `${frontmatter({ type: 'index', category: 'home', managed_by: 'sync-ksp-vault' })}# FDHChecker Knowledge Hub\n\nVault กลางสำหรับเงื่อนไขการเบิก โครงสร้างข้อมูล การปฏิบัติงาน และความรู้การพัฒนา FDHChecker\n\n## หมวดความรู้\n\n- [[10_Rules_and_Config/Business Rules Overview|เงื่อนไขและ Business Rules]]\n- [[20_Data_Model/HOSxP Semantic Catalog|โครงสร้างข้อมูล HOSxP]]\n- [[30_Claims_and_Knowledge|ความรู้การเบิกและเอกสารอ้างอิง]]\n- [[40_Project_Documentation|เอกสารโครงการทั้งหมด]]\n- [[50_Operations|เงื่อนไขที่ใช้จริงใน Backend และงานปฏิบัติการ]]\n- [[60_Programming_Knowledge|Source knowledge สำหรับต่อยอดโปรแกรม]]\n- [[70_AI_Managed|ความรู้ที่ AI เพิ่มและปรับปรุงพร้อม revision]]\n\n## สถานะ\n\n- Source files: ${manifest.length.toLocaleString('en-US')}\n- Manifest: [[_ksp/manifest.json]]\n- Schema: [[_ksp/schema.json]]\n- การแก้จาก AI จะอยู่ใน \`70_AI_Managed\` และไม่เขียนทับ source snapshot\n`;
await writeGenerated(path.join('00_Home', 'FDHChecker Knowledge Hub.md'), home, { type: 'index', source: 'generated' });

const generatedAt = new Date().toISOString();
await writeGenerated(path.join('_ksp', 'schema.json'), `${JSON.stringify({
  name: 'ksp-vault', version: 1, project: 'FDHChecker',
  portableFormats: ['markdown', 'json', 'jsonl'],
  managedZones: { generated: generatedDirectories.filter((item) => item !== '_ksp'), ai: ['70_AI_Managed'] },
  noteMetadata: ['ksp_schema', 'project', 'type', 'category', 'source', 'source_hash', 'managed_by'],
}, null, 2)}\n`, { type: 'schema', source: 'generated' });
await writeGenerated(path.join('_ksp', 'manifest.json'), `${JSON.stringify({
  schema: 1, project: 'FDHChecker', generatedAt, counts, files: manifest,
}, null, 2)}\n`, { type: 'manifest', source: 'generated' });
const revision = JSON.stringify({ timestamp: generatedAt, action: 'sync', files: manifest.length, counts });
await fs.writeFile(path.join(vaultRoot, '_ksp', 'revisions.jsonl'), `${priorRevisions}${priorRevisions && !priorRevisions.endsWith('\n') ? '\n' : ''}${revision}\n`, 'utf8');

if (obsidianRoot) {
  assertSafeVaultPath(path.join(obsidianRoot, 'FDHChecker'));
  const mirrorRoot = path.join(obsidianRoot, 'FDHChecker');
  await fs.mkdir(mirrorRoot, { recursive: true });
  for (const directory of generatedDirectories) {
    await fs.rm(path.join(mirrorRoot, directory), { recursive: true, force: true });
    await fs.cp(path.join(vaultRoot, directory), path.join(mirrorRoot, directory), { recursive: true });
  }
  await fs.cp(path.join(vaultRoot, '_ksp'), path.join(mirrorRoot, '_ksp'), { recursive: true, force: true });
  const canonicalAi = path.join(vaultRoot, '70_AI_Managed');
  const mirrorAi = path.join(mirrorRoot, '70_AI_Managed');
  await fs.mkdir(mirrorAi, { recursive: true });
  await fs.cp(canonicalAi, mirrorAi, { recursive: true, force: true });
  console.log(JSON.stringify({ vaultRoot, obsidianRoot, mirrorRoot, files: manifest.length, counts }));
} else {
  console.log(JSON.stringify({ vaultRoot, files: manifest.length, counts }));
}

````
