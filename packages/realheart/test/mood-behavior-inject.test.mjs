/**
 * 把「心情 → 行为」接进注入之后，真的按那样做（2026-11-27）
 *
 * 纯函数对（test/mood-behavior.test.mjs 证过了）不等于接上了 ——
 * 注入拿错参数、忘了传 cfg、被别的分支提前 return，都还是错的。
 * 所以这里真把插件启起来，取 `realheart:mood` 那一段的原文来查。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = await mkdtemp(join(tmpdir(), 'rh-mb-'));
process.env.DSH_HOME = HOME;
const { apply } = await import('../index.mjs');

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function makeCtx() {
  const tools = new Map();
  const handlers = [];
  return {
    tools,
    handlers,
    ctx: {
      logger: { info: () => {}, error: () => {} },
      get: (n) => (n === 'tools' ? { register: (d) => tools.set(d.name, d) } : undefined),
      on: (name, fn, opts) => handlers.push({ name, fn, opts }),
    },
  };
}

function ago(hours) {
  const d = new Date(Date.now() - hours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function mood(feeling, level, hoursAgo) {
  return { at: ago(hoursAgo), feeling, level, why_ref: 'none:unknown', why_kind: 'none', why_enum: 'unknown' };
}

async function boot(rows, cfgExtra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rh-mb-state-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  if (rows.length) {
    await writeFile(join(stateDir, 'mood.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  const h = makeCtx();
  apply(h.ctx, { stateDir, servePage: false, freeTime: false, announceOnInstall: false, ...cfgExtra });
  await settle();
  return { ...h, root };
}

async function moodSection(h) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  const out = await inj.fn({ sections: [] }, {}, async () => ({ sections: [] }));
  return out.sections.find((s) => s.name === 'realheart:mood');
}

test('「有点闷」：注入里给的是这一类情绪的约束，不是通用模板', async () => {
  const h = await boot([mood('有点闷', 4, 2)]);
  try {
    const sec = await moodSection(h);
    assert.ok(sec, '心情段没了');
    // 2026-11-27 二版：先从 feeling 认出情绪族（闷 → 钝/没劲），再给这一族的约束
    assert.match(sec.text, /这次怎么落到话上/, '没有行为映射');
    assert.match(sec.text, /主：钝\/没劲/, '没有按情绪分类：\n' + sec.text);
    assert.match(sec.text, /能短就短/, '没给句子形态的约束');
    assert.match(sec.text, /禁区/, '没给"最容易演砸的地方"');
    assert.ok(!sec.text.includes('先答这一句'), '才两小时，不该催');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('30 小时没更新：注入里下硬要求，且给「没变」的写法', async () => {
  const h = await boot([mood('钝钝的', 4, 30)]);
  try {
    const sec = await moodSection(h);
    assert.ok(sec);
    assert.match(sec.text, /先答这一句，再往下/, '过期了却没下硬要求');
    assert.match(sec.text, /none:unexplained/, '没给「没变」的写法');
    assert.match(sec.text, /没变就按上面那句记一条/, '收尾还是老那句「没变就别写」，自相矛盾');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('moodBehavior=false：行为映射可以关掉，硬要求还在', async () => {
  const h = await boot([mood('有点闷', 4, 30)], { moodBehavior: false });
  try {
    const sec = await moodSection(h);
    assert.ok(sec);
    assert.ok(!sec.text.includes('这次怎么落到话上'), '关掉了却还在');
    assert.match(sec.text, /先答这一句/, '关行为映射不该把「过期提醒」也关掉');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('阈值可调：把 moodMaxHours 调到 48，30 小时就不该硬要', async () => {
  const h = await boot([mood('钝钝的', 4, 30)], { moodMaxHours: 48 });
  try {
    const sec = await moodSection(h);
    assert.ok(sec);
    assert.ok(!sec.text.includes('先答这一句'), '阈值放宽了还在催');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
