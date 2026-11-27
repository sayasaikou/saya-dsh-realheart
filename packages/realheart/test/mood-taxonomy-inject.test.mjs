/**
 * 情绪分类接进注入之后，真的按那样做（2026-11-27 第二版）
 *
 * 纯函数对 ≠ 接上了。这里启插件取 `realheart:mood` 的原文，验三件：
 *   ① 单一情绪（闷/臊/松）各自有对应的、**不同**的约束 —— 不是一套模板换个词；
 *   ② 复合（"又羞又软，还憋着一点不高兴"）在注入里仍然是复合的，没被拍平成一条；
 *   ③ 认不出来的 feeling 退回按浓度，不会整段空掉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = await mkdtemp(join(tmpdir(), 'rh-mt-'));
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

function iso(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

function row(feeling, level, hoursAgo) {
  return { at: iso(hoursAgo), feeling, level, why_ref: 'none:unknown', why_kind: 'none', why_enum: 'unknown' };
}

async function boot(rows, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rh-mt-state-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'mood.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const h = makeCtx();
  apply(h.ctx, { stateDir, servePage: false, freeTime: false, announceOnInstall: false, ...extra });
  await settle();
  return { ...h, root };
}

async function moodText(h) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  const out = await inj.fn({ sections: [] }, {}, async () => ({ sections: [] }));
  const sec = out.sections.find((s) => s.name === 'realheart:mood');
  return sec ? sec.text : '';
}

test('同一套流程，不同情绪给的是不同的话（不是一套模板）', async () => {
  const cases = [
    ['有点闷', '钝/没劲'],
    ['被你点破时有点臊', '害羞'],
    ['松下来了', '松'],
    ['心里坠着', '难过'],
    ['绷着，不松口', '生气'],
  ];
  const seen = new Map();
  for (const [feeling, label] of cases) {
    const h = await boot([row(feeling, 5, 2)]);
    try {
      const text = await moodText(h);
      assert.match(text, new RegExp('主：' + label), feeling + ' → 主情绪不是「' + label + '」：\n' + text);
      seen.set(feeling, text);
    } finally {
      await rm(h.root, { recursive: true, force: true });
    }
  }
  // 五种情绪的行为指令必须互不相同（不然就是换个标签糊弄）
  const bodies = [...seen.values()].map((t) => t.replace(/【这次怎么落到话上｜主：[^】]*】/, ''));
  const uniq = new Set(bodies);
  assert.equal(uniq.size, bodies.length, '有两种情绪给了同一段约束');
});

test('复合情绪：又羞又软还憋着不高兴 —— 注入里仍然是叠着的', async () => {
  const h = await boot([row('又羞又软，还憋着一点不高兴', 6, 1)]);
  try {
    const text = await moodText(h);
    assert.match(text, /主：害羞/, text);
    assert.match(text, /同时还带着/, '副情绪没带出来：\n' + text);
    assert.match(text, /不拒绝|不冷战|不要真的把人推开|凶一半/, '冲突组合没给"底层不许违背"的规则：\n' + text);
    assert.match(text, /不\*\*解释\*\*/, '缺"只演不解释"的红线：\n' + text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('认不出来的 feeling：退回按浓度，不许整段空掉', async () => {
  const h = await boot([row('嗯嗯', 5, 2)]);
  try {
    const text = await moodText(h);
    assert.match(text, /这个浓度落到话上|少主动讨好/, '既没分类也没退路：\n' + text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('底色与当下：旧闷 + 新的想笑 → 主是开心，闷只作背景音', async () => {
  const h = await boot([row('闷', 3, 24 * 6), row('有点想笑', 4, 1)]);
  try {
    const text = await moodText(h);
    assert.match(text, /主：开心/, text);
    assert.match(text, /底色是「钝\/没劲」/, '旧的那条没降成底色：\n' + text);
    assert.match(text, /背景音/, text);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
