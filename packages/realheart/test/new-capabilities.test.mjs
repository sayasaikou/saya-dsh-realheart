/**
 * 2026-11-01 新增能力的单测：每一件都只问一个问题 ——
 * 「调完之后，盘上到底有没有那行字」。
 *
 * 为什么这么问：今天栽的坑全是「调了、返回成功、盘上没有」。
 * 所以这里不看返回值好不好看，只 cat 文件。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = await mkdtemp(join(tmpdir(), 'rh-new-'));
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

async function boot() {
  const root = await mkdtemp(join(tmpdir(), 'rh-new-state-'));
  const stateDir = join(root, 'state');
  const msgsDir = join(root, 'msgs');
  const h = makeCtx();
  apply(h.ctx, {
    stateDir,
    msgsDir,
    servePage: false,
    freeTime: false,
    announceOnInstall: false,
  });
  await settle();
  return { ...h, stateDir, msgsDir, root };
}

async function lines(dir, name) {
  try {
    const t = await readFile(join(dir, name), 'utf8');
    return t.split('\n').filter((x) => x.trim()).map((x) => JSON.parse(x));
  } catch {
    return [];
  }
}

test('rh_style 写一句 → style.jsonl 真有一行', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_style');
    assert.ok(t, 'rh_style 没注册');
    const r = await t.execute({ how: '短句。别铺垫。' });
    assert.ok(typeof r.text === 'string' && r.text.length > 0);
    const rows = await lines(h.stateDir, 'style.jsonl');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].how, '短句。别铺垫。');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('rh_style 写「清掉」→ 存一条空的，不是删文件', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_style');
    await t.execute({ how: '先短句' });
    await t.execute({ how: '清掉' });
    const rows = await lines(h.stateDir, 'style.jsonl');
    assert.equal(rows.length, 2);
    assert.equal(rows[1].how, '');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('rh_admit 认错 → admit.jsonl 有；不写 what 就不记', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_admit');
    assert.ok(t, 'rh_admit 没注册');
    await t.execute({ what: '把「看见了」当成「懂了」', why: '先有结论再找支撑' });
    const rows = await lines(h.stateDir, 'admit.jsonl');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].why, '先有结论再找支撑');
    const r2 = await t.execute({});
    assert.ok(r2.text.includes('没记'));
    assert.equal((await lines(h.stateDir, 'admit.jsonl')).length, 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('rh_view 记看法 → view.jsonl；改主意写第二条，旧的不删', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_view');
    assert.ok(t, 'rh_view 没注册');
    await t.execute({ subject: '适配层', view: '不该做' });
    await t.execute({ subject: '适配层', view: '还是不该做，但可以写一份文档' });
    const rows = await lines(h.stateDir, 'view.jsonl');
    assert.equal(rows.length, 2);
    assert.equal(rows[1].subject, '适配层');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('rh_control where → where.jsonl；不写 doing 就拒', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_control');
    const r = await t.execute({ action: 'where', doing: '在推插件进度', stage: '第 12 版', next: '补测试' });
    assert.ok(!r.text.includes('没写'), r.text);
    const rows = await lines(h.stateDir, 'where.jsonl');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].doing, '在推插件进度');
    const r2 = await t.execute({ action: 'where' });
    assert.ok(r2.text.includes('where 要写 doing'));
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('rh_control close 缺 summary 就拒；写了就进 control.jsonl', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_control');
    const bad = await t.execute({ action: 'close' });
    assert.ok(bad.text.includes('summary'), bad.text);
    assert.equal((await lines(h.stateDir, 'control.jsonl')).length, 0);
    const ok = await t.execute({ action: 'close', summary: '这一轮做完了', next_opening: '下一轮接着推' });
    assert.ok(!ok.text.includes('没写进去'));
    const rows = await lines(h.stateDir, 'control.jsonl');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'close');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('rh_control pause 的 kind 只认四个；非法值不进账', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_control');
    const bad = await t.execute({ action: 'pause', kind: '随便写的' });
    assert.ok(bad.text.includes('kind 只能是'), bad.text);
    assert.equal((await lines(h.stateDir, 'control.jsonl')).length, 0);
    await t.execute({ action: 'pause', kind: 'tired' });
    const rows = await lines(h.stateDir, 'control.jsonl');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'tired');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('主动想起：他提到那件事时，注入里出现她以前的看法', async () => {
  const h = await boot();
  try {
    await mkdir(h.msgsDir, { recursive: true });
    await writeFile(join(h.msgsDir, '2026-11-01.jsonl'),
      JSON.stringify({ at: Date.now(), openid: '1418499574', name: 'SaYask', text: '适配层到底要不要做' }) + '\n',
      'utf8');
    await h.tools.get('rh_view').execute({ subject: '适配层', view: '不该做，会白白多养一层' });
    const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
    const assembled = { sections: [] };
    await inj.fn(assembled, {}, async () => assembled);
    const raw = await readFile(join(h.stateDir, 'last-inject.md'), 'utf8');
    assert.ok(raw.includes('realheart:recall'), '注入里没有 recall 段');
    assert.ok(raw.includes('不该做，会白白多养一层'), '注入里没有那条看法');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('主动想起：没提到就不提（不刷屏）', async () => {
  const h = await boot();
  try {
    await mkdir(h.msgsDir, { recursive: true });
    await writeFile(join(h.msgsDir, '2026-11-01.jsonl'),
      JSON.stringify({ at: Date.now(), openid: '1418499574', name: 'SaYask', text: '今天天气不错' }) + '\n',
      'utf8');
    await h.tools.get('rh_view').execute({ subject: '适配层', view: '不该做' });
    const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
    const assembled = { sections: [] };
    await inj.fn(assembled, {}, async () => assembled);
    let raw = '';
    try {
      raw = await readFile(join(h.stateDir, 'last-inject.md'), 'utf8');
    } catch { /* 没落盘也正常 */ }
    assert.ok(!raw.includes('realheart:recall'), '没提到却注入了 recall');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
