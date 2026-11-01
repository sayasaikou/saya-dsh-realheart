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

test('会等：hold 挂一句 → holds 看得到 → unhold 销掉', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_control');
    const bad = await t.execute({ action: 'hold' });
    assert.ok(bad.text.includes('about'), bad.text);
    const r = await t.execute({ action: 'hold', about: '那个适配层到底做不做' });
    assert.ok(!r.text.includes('没写进去'), r.text);
    const rows = await lines(h.stateDir, 'hold.jsonl');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'hold');
    const list = await t.execute({ action: 'holds' });
    assert.ok(list.text.includes('适配层'), list.text);
    const off = await t.execute({ action: 'unhold' });
    assert.ok(off.text.includes('销了'), off.text);
    const after = await t.execute({ action: 'holds' });
    assert.ok(after.text.includes('（没欠着的话。）'), after.text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('断言账：add 要 about；refute 要 evidence；推翻后原文不删', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_claim');
    assert.ok(t, 'rh_claim 没注册');
    const noAbout = await t.execute({ action: 'add', claim: '这个接口不支持 X' });
    assert.ok(noAbout.text.includes('about'), noAbout.text);
    const ok = await t.execute({ action: 'add', claim: '这个接口不支持 X', about: '接口文档' });
    assert.ok(!ok.text.includes('没写进去'), ok.text);
    const list1 = await t.execute({ action: 'list' });
    assert.ok(list1.text.includes('不支持 X'), list1.text);
    const noEv = await t.execute({ action: 'refute', id: 'x' });
    assert.ok(noEv.text.includes('evidence'), noEv.text);
    const id = (await lines(h.stateDir, 'claims.jsonl'))[0].id;
    const off = await t.execute({ action: 'refute', id, evidence: '文档 12.3 节写着支持' });
    assert.ok(!off.text.includes('没写进去'), off.text);
    const list2 = await t.execute({ action: 'list' });
    assert.ok(!list2.text.includes('不支持 X'), '推翻了却还在 list 里');
    const rows = await lines(h.stateDir, 'claims.jsonl');
    assert.equal(rows.length, 2, '推翻要留两行：原文 + 那笔推翻');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('linger：写进去后会出现在注入里（带剩余分钟）', async () => {
  const h = await boot();
  try {
    await mkdir(h.msgsDir, { recursive: true });
    await writeFile(join(h.msgsDir, '2026-11-01.jsonl'),
      JSON.stringify({ at: Date.now(), openid: '1418499574', text: '在吗' }) + '\n',
      'utf8');
    const r = await h.tools.get('rh_control').execute({ action: 'linger', minutes: 20, why: '先想想怎么说' });
    assert.ok(!r.text.includes('没写进去'), r.text);
    const rows = await lines(h.stateDir, 'control.jsonl');
    assert.equal(rows[0].action, 'linger');
    assert.equal(rows[0].minutes, 20);
    const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
    const assembled = { sections: [] };
    await inj.fn(assembled, {}, async () => assembled);
    const raw = await readFile(join(h.stateDir, 'last-inject.md'), 'utf8');
    assert.ok(raw.includes('realheart:linger'), '注入里没有 linger 段');
    assert.ok(raw.includes('先等一会儿'), '注入里没有那句提示');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('重开提示：收尾后他又开口，注入里会提一句别复读结尾', async () => {
  const h = await boot();
  try {
    await mkdir(h.msgsDir, { recursive: true });
    const f = join(h.msgsDir, '2026-11-01.jsonl');
    await writeFile(f, JSON.stringify({ at: Date.now() - 3600000, text: '早' }) + '\n', 'utf8');
    await h.tools.get('rh_control').execute({ action: 'close', summary: '聊到扯平这件事', next_opening: '问周末去不去看展' });
    await writeFile(f, JSON.stringify({ at: Date.now() - 3600000, text: '早' }) + '\n'
      + JSON.stringify({ at: Date.now(), text: '醒着吗' }) + '\n', 'utf8');
    const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
    const assembled = { sections: [] };
    await inj.fn(assembled, {}, async () => assembled);
    const raw = await readFile(join(h.stateDir, 'last-inject.md'), 'utf8');
    assert.ok(raw.includes('realheart:reopen'), '没有 reopen 段');
    assert.ok(raw.includes('别复读'), '没有那句提醒');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('自己的事：add → 进了注入 → step 改到哪了 → done 就不在了', async () => {
  const h = await boot();
  try {
    await mkdir(h.msgsDir, { recursive: true });
    await writeFile(join(h.msgsDir, '2026-11-01.jsonl'),
      JSON.stringify({ at: Date.now(), text: '在吗' }) + '\n', 'utf8');
    const t = h.tools.get('rh_work');
    assert.ok(t, 'rh_work 没注册');
    const r = await t.execute({ action: 'add', what: '潟湖的声学', stage: '算完模态', next: '做音频对比' });
    assert.ok(!r.text.includes('没写'), r.text);
    const open = await lines(h.stateDir, 'works.jsonl');
    assert.equal(open[0].action, 'add');
    assert.equal(open[0].what, '潟湖的声学');
    const id = open[0].id;
    const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
    const assembled = { sections: [] };
    await inj.fn(assembled, {}, async () => assembled);
    let raw = await readFile(join(h.stateDir, 'last-inject.md'), 'utf8');
    assert.ok(raw.includes('realheart:work'), '注入里没有 work 段');
    assert.ok(raw.includes('潟湖的声学'), '注入里没有那件事');
    await t.execute({ action: 'step', id, next: '先把两种情况的音频做出来' });
    await t.execute({ action: 'done', id });
    const list = await t.execute({ action: 'list' });
    assert.ok(list.text.includes('手上没事'), list.text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('again：一天最多 2 次，第 3 次就被拦', async () => {
  const h = await boot();
  try {
    const t = h.tools.get('rh_control');
    const a = await t.execute({ action: 'again' });
    assert.ok(!a.text.includes('没写进去'), a.text);
    const b = await t.execute({ action: 'again' });
    assert.ok(!b.text.includes('没写进去'), b.text);
    const c = await t.execute({ action: 'again' });
    assert.ok(c.text.includes('2 次'), c.text);
    const rows = await lines(h.stateDir, 'again.jsonl');
    assert.equal(rows.length, 2);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
