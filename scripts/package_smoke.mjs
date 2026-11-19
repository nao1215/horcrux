// Installs the package the way a user does (npm pack, then npm install of the
// tarball into an empty project) and loads it with require() and import,
// including the subpaths the README documents. Each consumer splits a file,
// saves the shards and binds them back, so a build that emits code Node
// cannot load, or a README import that does not resolve, fails here.
//
// Usage: npm run build && node scripts/package_smoke.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'horcrux-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
}

try {
  const packed = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', work], root));
  const tarball = join(work, packed[0].filename);
  const files = packed[0].files.map((f) => f.path);
  for (const unwanted of ['test/', 'src/', '.github/', 'doc/']) {
    if (files.some((f) => f.startsWith(unwanted))) {
      throw new Error(`the package ships ${unwanted}: ${files.join(', ')}`);
    }
  }

  const app = join(work, 'app');
  mkdirSync(app);
  run(npm, ['init', '-y'], app);
  run(npm, ['install', '--no-audit', '--no-fund', tarball], app);

  const body = (imports) => `${imports}
const fs = require_fs();
const path = require_path();
const dir = fs.mkdtempSync(path.join(require_os().tmpdir(), 'horcrux-consumer-'));
const input = path.join(dir, 'secret.bin');
const data = Buffer.alloc(1000, 7);
fs.writeFileSync(input, data);
for (const [total, threshold] of [[5, 3], [3, 3]]) {
  const result = await split(input, total, threshold);
  const files = await saveHorcruxes(result.horcruxes, dir, nodeAdapter);
  const out = path.join(dir, 'restored-' + total + '-' + threshold);
  await bind(files.slice(0, threshold), out);
  if (!fs.readFileSync(out).equals(data)) throw new Error('restored bytes differ for ' + total + '/' + threshold);
  for (const f of files) fs.unlinkSync(f);
}
const buffered = await splitBuffer(Buffer.from('Secret message'), 'message.txt', { total: 4, threshold: 2 });
const restored = await bindHorcruxes(buffered.horcruxes.slice(0, 2));
if (restored.data.toString() !== 'Secret message') throw new Error('bindHorcruxes returned ' + restored.data.toString());
if (typeof configureReactNative !== 'function') throw new Error('configureReactNative is missing');
fs.rmSync(dir, { recursive: true, force: true });
console.log('ok');
`;

  const cjs = `(async () => {
const require_fs = () => require('fs');
const require_path = () => require('path');
const require_os = () => require('os');
${body(`const { split, bind, nodeAdapter, splitBuffer } = require('@nao1215/horcrux');
const { saveHorcruxes } = require('@nao1215/horcrux/core/split');
const { bindHorcruxes } = require('@nao1215/horcrux/core/bind');
const { configureReactNative } = require('@nao1215/horcrux/adapters/react-native');`)}
})().catch((e) => { console.error(e); process.exit(1); });
`;
  const esm = `import * as fsModule from 'fs';
import * as pathModule from 'path';
import * as osModule from 'os';
const require_fs = () => fsModule;
const require_path = () => pathModule;
const require_os = () => osModule;
${body(`import { split, bind, nodeAdapter, splitBuffer, saveHorcruxes as rootSave, bindHorcruxes as rootBind } from '@nao1215/horcrux';
import { saveHorcruxes } from '@nao1215/horcrux/core/split';
import { bindHorcruxes } from '@nao1215/horcrux/core/bind';
import { configureReactNative } from '@nao1215/horcrux/adapters/react-native';
if (rootSave !== saveHorcruxes || rootBind !== bindHorcruxes) throw new Error('the root and the subpaths export different functions');`)}`;

  writeFileSync(join(app, 'consumer.cjs'), cjs);
  writeFileSync(join(app, 'consumer.mjs'), esm);
  for (const consumer of ['consumer.cjs', 'consumer.mjs']) {
    const out = run('node', [consumer], app).trim();
    if (out !== 'ok') throw new Error(`${consumer} printed ${out}`);
    console.log(`${consumer}: ok`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
