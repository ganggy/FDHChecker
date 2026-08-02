import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const secretsDirectory = path.join(projectRoot, '.secrets');
const keyFile = path.join(secretsDirectory, 'ai-access-key');
const rotate = process.argv.includes('--rotate');
const copy = process.argv.includes('--copy');

await mkdir(secretsDirectory, { recursive: true, mode: 0o700 });

let accessKey = '';
if (!rotate) {
  try {
    accessKey = (await readFile(keyFile, 'utf8')).trim();
  } catch {
    // A key will be generated below.
  }
}

if (!accessKey) {
  accessKey = crypto.randomBytes(32).toString('hex');
  await writeFile(keyFile, `${accessKey}\n`, { mode: 0o600 });
  console.log(rotate ? 'AI Access Key rotated.' : 'AI Access Key created.');
} else {
  console.log('Existing AI Access Key preserved.');
}

if (copy) {
  const clipboardCommand = os.platform() === 'darwin'
    ? ['pbcopy', []]
    : os.platform() === 'win32'
      ? ['clip', []]
      : ['xclip', ['-selection', 'clipboard']];
  const result = spawnSync(clipboardCommand[0], clipboardCommand[1], {
    input: accessKey,
    encoding: 'utf8',
  });
  if (result.status === 0) console.log('AI Access Key copied to clipboard.');
  else console.log(`Key created at ${path.relative(projectRoot, keyFile)}; clipboard command is unavailable.`);
}
