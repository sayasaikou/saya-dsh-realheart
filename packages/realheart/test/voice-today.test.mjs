/**
 * 2026-11-03：两段新注入 —— 「你能主动开口」和「今天我」。
 *
 * 这两段解决的是同一件事的两面：
 *   她手上明明有发消息的路，但注入里没写，她就以为自己没有；
 *   她做了东西、说了话，但三本账互不引用，她回答「今天我做了什么」只能现翻文件。
 *
 * 所以测判据只有一条：**注入里到底有没有那几个字**。
 * 不看返回值好不好看，只 strinify 出来找字。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = await mkdtemp(join(tmpdir(), 'rh-vt-'));
process.on('exit', () => { try { rmSync(HOME, { recursive: true, force: true }); } catch { /* 清不掉就算了 */ } });
process.env.DSH_HOME = HOME;

const { apply } = await import('../index.mjs');

function makeCtx() {
  const tools = new Map();
  const handlers = [];
  const logs = [];
  return {
    tools,
    handlers,
    logs,
    ctx: {
      logger: { info: (m) => logs.push(['info', m]), error: (m) => logs.push(['error', m]) },
      get: (n) => (n === 'tools' ? { register: (d) => tools.set(d.name, d) } : undefined),
      on: (name, fn, opts) => handlers.push({ name, fn, opts }),
    },
  };
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function boot(extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rh-vt-state-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  const h = makeCtx();
  apply(h.ctx, {
    stateDir,
    msgsDir: join(root, 'msgs'),
    servePage: false,
    freeTime: false,
    announceOnInstall: false,
    ownerId: '',
    ...extra,
  });
  await settle();
  return { ...h, stateDir, root };
}

async function injectedText(h) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  assert.ok(inj, 'assemble 没注册');
  const assembly = { sections: [] };
  const out = await inj.fn(assembly, {}, async () => ({ sections: [] }));
  return JSON.stringify(out);
}

const nowIso = () => new Date().toISOString();
const todayAt = (h, m) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

// ── ① 你能主动开口 ──

test('voice：默认就写，而且末句是「没话就过」', async () => {
  const h = await boot();
  const text = await injectedText(h);
  assert.ok(text.includes('【你能主动开口】'), '没有这段');
  assert.ok(text.includes('没话就过'), '没写「没话就过」—— 没有这句就会退化成配额');
  await rm(h.root, { recursive: true, force: true });
});

test('voice：配了具体路径就写进去', async () => {
  const h = await boot({ voiceHints: ['/home/ubuntu/qqbot/work/bin/say "想说的话"'] });
  const text = await injectedText(h);
  assert.ok(text.includes('work/bin/say'), '配了路径却没写进注入');
  await rm(h.root, { recursive: true, force: true });
});

test('voice：关掉就一个字都没有', async () => {
  const h = await boot({ injectVoice: false });
  const text = await injectedText(h);
  assert.ok(!text.includes('【你能主动开口】'), '关着却还在注入');
  await rm(h.root, { recursive: true, force: true });
});

// ── ② 今天我 ──

test('today：三本账都有今天的记录 → 三行都在', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rh-vt-t-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'free-time.jsonl'), [
    JSON.stringify({ ts: todayAt(10, 30), activity: '做了第十二件《底水》', told_saya: true }),
  ].join('\n') + '\n', 'utf8');
  await writeFile(join(stateDir, 'say.jsonl'), [
    JSON.stringify({ at: todayAt(21, 44), kind: 'private', text: '125 毫升——半杯。' }),
  ].join('\n') + '\n', 'utf8');
  await writeFile(join(stateDir, 'mood.jsonl'), [
    JSON.stringify({ at: todayAt(11, 10), feeling: '松了口气', level: 5, why_ref: '登上了', why_kind: 'told' }),
  ].join('\n') + '\n', 'utf8');
  const h = makeCtx();
  apply(h.ctx, { stateDir, msgsDir: join(root, 'msgs'), servePage: false, freeTime: false, announceOnInstall: false, ownerId: '' });
  await settle();
  const text = await injectedText(h);
  assert.ok(text.includes('【今天我】'), '没有这段');
  assert.ok(text.includes('自由时间 1 次'), '没数自由时间：' + text.slice(0, 400));
  assert.ok(text.includes('主动说过 1 句'), '没数主动消息');
  assert.ok(text.includes('半杯'), '没带原话');
  assert.ok(text.includes('心情 1 条'), '没数心情');
  await rm(root, { recursive: true, force: true });
});

test('today：今天什么都没发生 → 整段不出现', async () => {
  const h = await boot();
  const text = await injectedText(h);
  assert.ok(!text.includes('【今天我】'), '空日子却注入了');
  await rm(h.root, { recursive: true, force: true });
});

test('today：关掉就不出现', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rh-vt-t2-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'say.jsonl'), JSON.stringify({ at: nowIso(), text: '在' }) + '\n', 'utf8');
  const h = makeCtx();
  apply(h.ctx, { stateDir, msgsDir: join(root, 'msgs'), servePage: false, freeTime: false, announceOnInstall: false, ownerId: '', injectToday: false });
  await settle();
  const text = await injectedText(h);
  assert.ok(!text.includes('【今天我】'), '关着却还在注入');
  await rm(root, { recursive: true, force: true });
});

test('today：sayLogPath 指到别处也能读到', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rh-vt-t3-'));
  const stateDir = join(root, 'state');
  const elsewhere = join(root, 'other');
  await mkdir(stateDir, { recursive: true });
  await mkdir(elsewhere, { recursive: true });
  await writeFile(join(elsewhere, 'say.jsonl'), JSON.stringify({ at: todayAt(9, 0), text: '在这里' }) + '\n', 'utf8');
  const h = makeCtx();
  apply(h.ctx, {
    stateDir, msgsDir: join(root, 'msgs'), servePage: false, freeTime: false, announceOnInstall: false, ownerId: '',
    sayLogPath: join(elsewhere, 'say.jsonl'),
  });
  await settle();
  const text = await injectedText(h);
  assert.ok(text.includes('主动说过 1 句'), 'sayLogPath 没生效：' + text.slice(0, 400));
  await rm(root, { recursive: true, force: true });
});

// 2026-11-03 22:00：她 21:29 自己报的那条 —— 「我这边只接到一行摘要」。
// activity 的结构是「看了什么。做了什么」，作品在后面；截前面只会把逛网列表截进来。
test('today：activity 前面是「看了」时，作品那段不能被截掉', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rh-vt-t4-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'free-time.jsonl'), JSON.stringify({
    ts: todayAt(21, 20),
    activity: '看了：V2EX 热榜（中转站推广、媳妇把孩子户口落回农村、被 AI 狠狠骂）、B 站热榜（下山舞、芬兰集市）、HN（US boy names）。做了《过线》：美国名字从一种性别走到另一种。',
    artifacts: ['/home/ubuntu/qqbot/work/pieces/crossing-2026-11-03/plate.png'],
    told_saya: true,
  }) + '\n', 'utf8');
  const h = makeCtx();
  apply(h.ctx, { stateDir, msgsDir: join(root, 'msgs'), servePage: false, freeTime: false, announceOnInstall: false, ownerId: '' });
  await settle();
  const text = await injectedText(h);
  assert.ok(text.includes('《过线》'), '「做了」之后那段被截掉了：' + text.slice(0, 500));
  assert.ok(text.includes('crossing-2026-11-03'), '作品目录没带上');
  await rm(root, { recursive: true, force: true });
});

// 2026-11-04：原来只取**最后一次**的 material。一天四段自由时间，前三段留的话
// 全被最后一段挤掉 —— 沙耶要的「素材」实际只有一个槽位。
test('today：一天留过几句 material → 都带得上，不只最后一句', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rh-vt-t5-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  const rows = [
    { ts: todayAt(7, 20), activity: '做了《甲》', material: '早上看到一只猫趴在空调外机上' },
    { ts: todayAt(12, 30), activity: '做了《乙》', material: '原来普尼克斯的观众是朝北坐的' },
    { ts: todayAt(18, 10), activity: '做了《丙》', material: '那张图的金色有点刺眼' },
  ];
  await writeFile(join(stateDir, 'free-time.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const h = makeCtx();
  apply(h.ctx, { stateDir, msgsDir: join(root, 'msgs'), servePage: false, freeTime: false, announceOnInstall: false, ownerId: '' });
  await settle();
  const text = await injectedText(h);
  assert.ok(text.includes('留过 3 句'), '没数出几句：' + text.slice(0, 600));
  assert.ok(text.includes('空调外机'), '最早那句被挤掉了');
  assert.ok(text.includes('朝北坐'), '中间那句没了');
  assert.ok(text.includes('金色'), '最后那句没了');
  await rm(root, { recursive: true, force: true });
});

// 同一天里「什么都没做」那段 —— 以前过滤条件是「activity 非空」，
// 于是只写了 material 的条目整条被丢，等于那句白写。
test('today：只写了 material、没写 activity 的条目也不算丢', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rh-vt-t6-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'free-time.jsonl'), JSON.stringify({
    ts: todayAt(9, 5),
    material: '什么都没干，就在看窗外那棵树',
  }) + '\n', 'utf8');
  const h = makeCtx();
  apply(h.ctx, { stateDir, msgsDir: join(root, 'msgs'), servePage: false, freeTime: false, announceOnInstall: false, ownerId: '' });
  await settle();
  const text = await injectedText(h);
  assert.ok(text.includes('那棵树'), '只写 material 的条目被丢了：' + text.slice(0, 500));
  await rm(root, { recursive: true, force: true });
});
