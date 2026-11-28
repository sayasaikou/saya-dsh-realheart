/**
 * 年龄层接进注入之后，真的按那样做（2026-11-28）
 *
 * 纯函数对不等于接上了。这里真启插件，把四条账本写成"很久以前"的样子，
 * 看注入里到底还有没有它们 —— 上一版的毛病正是这类东西**永久占着正文**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = await mkdtemp(join(tmpdir(), 'rh-age-'));
process.env.DSH_HOME = HOME;
const { apply } = await import('../index.mjs');

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function makeCtx() {
  const handlers = [];
  const tools = new Map();
  return {
    handlers, tools,
    ctx: {
      logger: { info: () => {}, error: () => {} },
      get: (n) => (n === 'tools' ? { register: (d) => tools.set(d.name, d) } : undefined),
      on: (name, fn, opts) => handlers.push({ name, fn, opts }),
    },
  };
}

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

async function boot(files) {
  const root = await mkdtemp(join(tmpdir(), 'rh-age-s-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  for (const [name, rows] of Object.entries(files)) {
    await writeFile(join(stateDir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  const h = makeCtx();
  apply(h.ctx, { stateDir, servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  return { ...h, root, stateDir };
}

function sectionText(out, name) {
  const s = out.sections.find((x) => x.name === name);
  return s ? s.text : '';
}

async function assemble(h) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  return inj.fn({ sections: [] }, {}, async () => ({ sections: [] }));
}

test('认过的错：40 天前的进不了正文，且不装作没有', async () => {
  const h = await boot({
    'admit.jsonl': [
      { at: daysAgo(40), what: '很早以前的那件事', why: '原因' },
      { at: daysAgo(2), what: '前天那件事', why: '原因' },
    ],
  });
  try {
    const text = sectionText(await assemble(h), 'realheart:admit');
    assert.ok(text.includes('前天那件事'), '新的那条该在：\n' + text);
    assert.ok(!text.includes('很早以前的那件事'), '40 天前的错还占着正文：\n' + text);
    assert.match(text, /更早的|不摆了/, '旧的那条应该有一句交代：\n' + text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('看法：三个月前的不再摆上来，但会说"记过几条"', async () => {
  const h = await boot({
    'view.jsonl': [
      { at: daysAgo(200), subject: '老看法', view: '很久以前是这么想的' },
      { at: daysAgo(3), subject: '新看法', view: '现在这么想' },
    ],
  });
  try {
    const text = sectionText(await assemble(h), 'realheart:view');
    assert.ok(text.includes('新看法'), '新的该在：\n' + text);
    assert.ok(!text.includes('很久以前是这么想的'), '200 天前的看法还在正文：\n' + text);
    assert.match(text, /更早的看法/, '该交代一句还有旧的：\n' + text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('表现层：两个月前写的调子不再当"现在"', async () => {
  const h = await boot({
    'style.jsonl': [{ at: daysAgo(70), how: '说话要软一点、句子拖长' }],
  });
  try {
    const text = sectionText(await assemble(h), 'realheart:style');
    assert.ok(!text.includes('句子拖长'), '70 天前的调子还在驱动语气：\n' + text);
    assert.match(text, /太久了|rh_style/, '该告诉她可以重写：\n' + text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('表现层：两周内的照常用，并标出年龄', async () => {
  const h = await boot({
    'style.jsonl': [{ at: daysAgo(9), how: '说话要软一点、句子拖长' }],
  });
  try {
    const text = sectionText(await assemble(h), 'realheart:style');
    assert.ok(text.includes('句子拖长'), '9 天前的不该被收掉：\n' + text);
    assert.match(text, /9 天前/, '该标年龄：\n' + text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('没完的事：挂了二十天要提醒"要么做要么撤"', async () => {
  const h = await boot({
    'works.jsonl': [{ at: daysAgo(20), action: 'add', id: 'w1', what: '那件一直没弄完的事' }],
  });
  try {
    const text = sectionText(await assemble(h), 'realheart:work');
    assert.ok(text.includes('那件一直没弄完的事'), text);
    assert.match(text, /挂了超过|要么.*做掉|要么撤掉/, '久挂没提醒：\n' + text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('断点快照：断在两天前要说得出口', async () => {
  const h = await boot({ 'where.jsonl': [{ at: daysAgo(2), doing: '在改心情层' }] });
  try {
    const text = sectionText(await assemble(h), 'realheart:where');
    assert.ok(text.includes('在改心情层'), text);
    assert.match(text, /2 天前/, '断点没带年龄：\n' + text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
