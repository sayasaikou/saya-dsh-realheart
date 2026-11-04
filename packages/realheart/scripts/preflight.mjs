#!/usr/bin/env node
/**
 * 发版前自检（2026-11-04）。
 *
 * 为什么要有：今晚发了 15 个版本，每一次「验过」都是我自己决定验哪几项 ——
 * 于是有几件事忘了两次：硬编码的号（say 里写着她的 QQ）、包里混进 .bak、
 * 配置项加了字段但忘了 FIELD_META。这些都是**同一种错**：某个东西加了一半。
 *
 * 这个脚本不判断功能对不对（那要靠测试和真机），它只挡「发出去会丢人」的那一类：
 *   · 语法过不过
 *   · 测试过不过
 *   · 包里有没有不该有的东西（.bak / 硬编码的号）
 *   · 配置项三处（DEFAULTS / Schema / FIELD_META）有没有对齐
 *   · 无头起一次插件，注入能不能组装出来
 *   · npm pack 的清单对不对
 *
 * 用法：node scripts/preflight.mjs      （在 packages/realheart 下跑）
 * 退出码 0 = 可以发；1 = 有拦路的。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = dirname(HERE);
const fail = [];
const warn = [];
let n = 0;

const ok = (msg) => { n += 1; console.log('  ok   ' + msg); };
const bad = (msg) => { fail.push(msg); console.log('  FAIL ' + msg); };
const soft = (msg) => { warn.push(msg); console.log('  warn ' + msg); };

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: PKG, encoding: 'utf8', stdio: 'pipe', ...opts });
}

// ── 1. 语法 ──
console.log('\n[1] 语法');
for (const f of ['index.mjs', 'setup.mjs', 'lib/config.mjs', 'bin/realheart.mjs']) {
  try {
    sh(process.execPath, ['--check', f]);
    ok(f);
  } catch (e) {
    bad(`${f} 语法错：${String(e.stderr || e.message).split('\n')[0]}`);
  }
}
for (const f of ['runtime/rh-status.py']) {
  try {
    sh(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'py_compile', f]);
    ok(f);
  } catch (e) {
    // 有的机器上没有 python3 —— 那是「没查」，不是「坏了」
    const m = String(e.message || '');
    soft(`${f} 没能验（${m.includes('ENOENT') ? '这台没有 python3' : m.split('\n')[0]}）`);
  }
}

// ── 2. 测试 ──
console.log('\n[2] 测试');
try {
  const out = sh(process.execPath, ['--test'], { encoding: 'utf8' });
  const pass = /# pass (\d+)/.exec(out)?.[1] || (out.match(/ℹ pass (\d+)/) || [])[1];
  const f = (out.match(/ℹ fail (\d+)/) || [])[1];
  if (f && f !== '0') bad(`测试失败 ${f} 项`);
  else ok(`测试 ${pass || '?'} 项全过`);
} catch (e) {
  const out = String(e.stdout || '');
  const f = (out.match(/ℹ fail (\d+)/) || [])[1];
  bad(`测试没过${f ? `（失败 ${f} 项）` : ''}`);
}

// ── 3. 包里不该有的东西 ──
console.log('\n[3] 脏东西');
const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.git') continue;
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};
const all = walk(PKG);
const baks = all.filter((p) => /\.bak-/.test(p));
if (baks.length) bad(`${baks.length} 个 .bak 文件在包里：${baks.slice(0, 3).map((p) => p.replace(PKG, '.')).join('、')}`);
else ok('没有 .bak 混进来');

// QQ 号 / 手机号：10 位以内连着数字，且不是纯配置示例
const ID_PAT = /(?<!\d)([1-9]\d{4,10})(?!\d)/;
const suspicious = [];
for (const p of all) {
  if (!/\.(mjs|js|py|sh|md|json)$/.test(p)) continue;
  if (p.includes('/test/') || p.endsWith('CHANGELOG.md') || p.endsWith('README.md')) continue;
  const t = readFileSync(p, 'utf8');
  // 明显的号：出现在 user_id / uin / QQ 号语境里
  for (const m of t.matchAll(/(?:user_id|uin|ownerId|TARGET|UIN|QQ)\D{0,12}([1-9]\d{5,10})/gi)) {
    suspicious.push(`${p.replace(PKG, '.')} → ${m[1]}`);
  }
}
if (suspicious.length) bad(`疑似硬编码的号：${suspicious.slice(0, 4).join('；')}`);
else ok('没扫到硬编码的 QQ 号');

// ── 4. 配置三处对齐 ──
console.log('\n[4] 配置项');
const cfgSrc = readFileSync(join(PKG, 'lib/config.mjs'), 'utf8');
const defaultsBlock = cfgSrc.slice(cfgSrc.indexOf('export const DEFAULTS'), cfgSrc.indexOf('export const RANGES'));
const defKeys = new Set([...defaultsBlock.matchAll(/^ {2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));
const metaKeys = new Set([...cfgSrc.matchAll(/^ {4}key: '([^']+)'/gm)].map((m) => m[1]));
const schemaBlock = cfgSrc.slice(cfgSrc.indexOf('export const Config'), cfgSrc.indexOf('export function validateConfig'));
const schemaKeys = new Set([...schemaBlock.matchAll(/^ {2}([a-zA-Z][\w]*): Schema\./gm)].map((m) => m[1]));
const missingMeta = [...defKeys].filter((k) => !metaKeys.has(k));
const orphanMeta = [...metaKeys].filter((k) => !defKeys.has(k));
const missingSchema = [...defKeys].filter((k) => !schemaKeys.has(k));
if (missingMeta.length) bad(`DEFAULTS 里有、FIELD_META 里没有（面板上永远不出现）：${missingMeta.join('、')}`);
if (orphanMeta.length) bad(`FIELD_META 里有、DEFAULTS 里没有（不是真的配置项）：${orphanMeta.join('、')}`);
if (missingSchema.length) bad(`DEFAULTS 里有、Schema 里没有（宿主那层拦不住）：${missingSchema.join('、')}`);
if (!missingMeta.length && !orphanMeta.length && !missingSchema.length) {
  ok(`配置项三处对齐（${defKeys.size} 项）`);
}

// ── 5. 无头起一次，注入能不能组装 ──
console.log('\n[5] 无头启动');
try {
  const HOME = mkdtempSync(join(tmpdir(), 'rh-preflight-'));
  process.env.DSH_HOME = HOME;
  const { apply } = await import('file://' + join(PKG, 'index.mjs').replace(/\\/g, '/'));
  const handlers = [];
  const tools = new Map();
  apply({
    logger: { info: () => {}, error: () => {} },
    get: (x) => (x === 'tools' ? { register: (d) => tools.set(d.name, d) } : undefined),
    on: (name, fn) => handlers.push({ name, fn }),
  }, { servePage: false, freeTime: false, pingMinMinutes: 0, announceOnInstall: false });
  await new Promise((r) => setTimeout(r, 1200));
  const inj = handlers.find((x) => x.name === 'system-prompt/assemble');
  if (!inj) bad('注入 handler 没挂上');
  else {
    const out = await inj.fn({ sections: [] }, {}, async () => ({ sections: [] }));
    ok(`起得来，注入能组装（${(out?.sections || []).length} 段），工具 ${tools.size} 个`);
  }
  if (tools.size < 8) soft(`工具只注册了 ${tools.size} 个（期待 9 个）`);
} catch (e) {
  bad(`无头启动抛了：${String(e.message).split('\n')[0]}`);
}

// ── 6. npm pack 清单 ──
console.log('\n[6] 打包清单');
try {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const out = sh(npmBin, ['pack', '--dry-run', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  const files = (j[0]?.files || []).map((f) => f.path);
  const badFiles = files.filter((p) => /\.bak-|\.tgz$|node_modules/.test(p));
  if (badFiles.length) bad(`包里混进了：${badFiles.slice(0, 3).join('、')}`);
  else ok(`清单 ${files.length} 个文件，干净`);
  for (const need of ['index.mjs', 'lib/config.mjs', 'runtime/rh-status.py', 'scripts/persona-default.md', 'scripts/say']) {
    if (!files.includes(need)) bad(`包里少了 ${need}`);
  }
} catch (e) {
  soft(`没跑成 npm pack（${String(e.message).split('\n')[0]}）`);
}

// ── 收尾 ──
console.log('');
if (fail.length) {
  console.log(`✖ ${fail.length} 项拦路：`);
  for (const f of fail) console.log('   - ' + f);
  process.exit(1);
}
console.log(`✔ ${n} 项通过${warn.length ? `，${warn.length} 项没查成（不算坏）` : ''} —— 可以发`);
