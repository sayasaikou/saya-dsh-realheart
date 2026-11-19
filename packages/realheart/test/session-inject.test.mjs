/**
 * 心情「分场合 + 渗透」的端到端测试（2026-11-01）。
 *
 * `test/session.test.mjs` 证的是纯函数；这里证的是**接进注入之后真的按那样做**。
 * 两件事必须分开验：纯函数对、但注入拿错了参数 / 没传下去，照样是错的。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DSH_HOME 必须在 import index.mjs 之前设好 —— config.mjs 是模块加载时求值的
const HOME = await mkdtemp(join(tmpdir(), 'rh-si-'));
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

/** 把「几小时前」写成账本用的本地时间格式（不能写死日期，不然测试过几天就过期） */
async function boot(moodRows = []) {
  const root = await mkdtemp(join(tmpdir(), 'rh-si-state-'));
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  if (moodRows.length) {
    await writeFile(join(stateDir, 'mood.jsonl'), moodRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  const h = makeCtx();
  apply(h.ctx, { stateDir, servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  return { ...h, root, stateDir };
}

/** 本地时间戳，N 小时前 */
function ago(hours) {
  const d = new Date(Date.now() - hours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 造一条心情（none 出口：不要求事件 id，也不要求索引） */
function mood(feeling, level, hoursAgo, session) {
  const row = {
    at: ago(hoursAgo),
    feeling,
    level,
    why_ref: 'none:unknown',
    why_kind: 'none',
    why_enum: 'unknown',
    ...(session ? { session } : {}),
  };
  return row;
}

async function assembleWith(h, sessionId) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  const context = sessionId ? { agent: { session: { id: sessionId } } } : {};
  const out = await inj.fn({ sections: [] }, context, async () => ({ sections: [] }));
  return out.sections.find((s) => s.name === 'realheart:mood');
}

const TWO = [
  mood('私聊里记的那条', 8, 2, 'sess-A'),
  mood('群里记的那条', 9, 1, 'sess-B'),
];

test('会话 A：主心情是 A 的，B 的只能「渗」一行进来并标明出处', async () => {
  const h = await boot(TWO);
  try {
    const sec = await assembleWith(h, 'sess-A');
    assert.ok(sec, '心情段没了');
    assert.match(sec.text, /私聊里记的那条/, '主心情不是本会话的那条');
    assert.ok(!sec.text.includes('当前心情'), '标题不对');
    assert.match(sec.text, /另外：你在别的场合还记着「群里记的那条」/, 'B 的那条没渗进来，或者没说清是别处的');
    assert.match(sec.text, /那不是这个场合的事/, '渗透没标明「不是这个场合」');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('会话 B：反过来也是 —— 两边不是「谁最后写谁赢」', async () => {
  const h = await boot(TWO);
  try {
    const sec = await assembleWith(h, 'sess-B');
    assert.ok(sec);
    assert.match(sec.text, /群里记的那条/);
    assert.match(sec.text, /另外：你在别的场合还记着「私聊里记的那条」/);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('拿不到会话 id：不过滤，显示最新的（退化成老行为，不能坏）', async () => {
  const h = await boot(TWO);
  try {
    const sec = await assembleWith(h, '');
    assert.ok(sec, '拿不到会话 id 就把心情段丢了 —— 那比过滤错还糟');
    assert.match(sec.text, /群里记的那条/, '拿不到 id 时该显示全局最新的那条');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('老数据（没 session 字段）：照样看得见 —— 不是「谁的都不是」', async () => {
  const h = await boot([mood('十月那会儿记的', 6, 24 * 5)]);
  try {
    for (const sid of ['sess-A', 'sess-B', '']) {
      const sec = await assembleWith(h, sid);
      assert.ok(sec, `会话 ${sid || '(空)'} 下老数据被藏了`);
      assert.match(sec.text, /十月那会儿记的/);
    }
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('老数据不会被当成「别处的」渗过来（它已经是全局那张脸）', async () => {
  const h = await boot([
    mood('本场合记的', 7, 1, 'sess-A'),
    mood('老数据但很浓', 10, 1),
  ]);
  try {
    const sec = await assembleWith(h, 'sess-A');
    assert.ok(sec);
    assert.ok(!sec.text.includes('另外：你在别的场合'), '老数据没 owner，不该走渗透那条路');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('太旧的不渗：24 小时前的那种，只在它自己的场合里出现', async () => {
  const h = await boot([
    mood('本场合今天的', 7, 1, 'sess-A'),
    mood('昨天别处记的', 10, 30, 'sess-B'),
  ]);
  try {
    const sec = await assembleWith(h, 'sess-A');
    assert.ok(sec);
    assert.match(sec.text, /本场合今天的/);
    assert.ok(!sec.text.includes('昨天别处记的'), '30 小时前的还渗过来了');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('时间感：上一轮开口在 10 小时前 → 注入里带一句', async () => {
  // 2026-11-19 重写：realheart:time 已搬进尾部通道。测试环境 dshLlm 为 null → 走兜底路径
  // realheart:live-fallback，那一格和尾部通道共用 liveStateLines()，「距你上一次开口」就在里面。
  const h = await boot();
  try {
    await assembleWith(h, 'sess-A'); // 先跑一轮，让 last-inject 落地
    const p = join(h.stateDir, 'last-inject.md');
    const old = new Date(Date.now() - 10 * 3600 * 1000);
    await utimes(p, old, old);
    const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
    const out = await inj.fn({ sections: [] }, {}, async () => ({ sections: [] }));
    const sec = out.sections.find((s) => s.name === 'realheart:live-fallback');
    assert.ok(sec, '兜底段没出现 —— 10 小时前那轮没被说出来：'
      + (out.sections ?? []).map((s) => s.name).join(' / '));
    assert.match(String(sec.text), /距你上一次开口：10 小时前/);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('时间感：刚说过话就不提（三小时内说了像打卡）', async () => {
  const h = await boot();
  try {
    await assembleWith(h, 'sess-A');
    const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
    const out = await inj.fn({ sections: [] }, {}, async () => ({ sections: [] }));
    assert.equal(out.sections.find((s) => s.name === 'realheart:time'), undefined);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('启动时把自由时间的 prompt 落到文件里（systemd 那边要读它）', async () => {
  const h = await boot();
  try {
    const p = join(HOME, 'realheart', 'free-prompt.txt');
    assert.ok(existsSync(p), 'free-prompt.txt 没写出来 —— systemd 那边就只能用兜底原文');
    const text = await readFile(p, 'utf8');
    assert.match(text, /自由时间/);
    assert.match(text, /free-time\.jsonl/, '缺了记流水那一句');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

// 2026-11-04：用户点的「三个自己互不知道对方做了什么」——
// 这一格是「对话 → 自由时间」。判据两条：真话带得上；注入噪音要剥干净。
test('自由时间：带上今天最后聊到的几句，噪音剥掉', async () => {
  // 2026-11-19 重写：talkExchangeText() 读的是 cfg.historyDir 下 mtime 最新的
  // `napcat-private-*.jsonl`（不是 msgsDir，也不是按日期命名的文件）。
  // 原来这条测试两样都填错了，所以永远读不到东西、永远没有【今天聊到过的】。
  const root = await mkdtemp(join(tmpdir(), 'rh-si-talk-'));
  const stateDir = join(root, 'state');
  const historyDir = join(root, 'history');
  await mkdir(stateDir, { recursive: true });
  await mkdir(historyDir, { recursive: true });
  const fn = 'napcat-private-1.jsonl';
  // talkExchangeText 只认 role==='user'|'assistant' 的行，且 at 要能被 Date.parse 认出来
  // （数字时间戳 Date.parse 会返回 NaN）。这两条以前都填错了，所以永远读成空。
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  await writeFile(join(historyDir, fn), [
    { at: iso(40), role: 'user', sessionId: 'napcat-private-1', name: null, text: 'Time sampled while preparing turn 44, step 1: 2026-11-04T13:24:17+08:00[Asia/Shanghai]' },
    { at: iso(30), role: 'user', sessionId: 'napcat-private-1', name: '另一处的近况：这段时间没有新对话', text: '[另一处的近况：这段时间没有新对话]\n[本轮消息] 那就听你的，重启吧' },
    { at: iso(29), role: 'assistant', sessionId: 'napcat-private-1', name: null, text: '好，我重启。等你回来。' },
    { at: iso(10), role: 'user', sessionId: 'napcat-private-1', name: null, text: '还有要做的吗？' },
    // 「以我的回应为锚」：没有回应收尾的那句不会被当成「聊到过的」，所以给它配一条
    { at: iso(9), role: 'assistant', sessionId: 'napcat-private-1', name: '蓝色大肥鱼', text: '没什么了，你去睡吧。' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const h = makeCtx();
  apply(h.ctx, { stateDir, historyDir, servePage: false, freeTime: false, announceOnInstall: false });
  await settle(600);
  try {
    const text = await readFile(join(HOME, 'realheart', 'free-prompt.txt'), 'utf8');
    assert.match(text, /【今天聊到过的】/);
    assert.ok(text.includes('那就听你的，重启吧'), '真话没带进来：' + text.slice(0, 400));
    assert.ok(text.includes('还有要做的吗？'), '最后一句没带进来');
    assert.ok(!text.includes('Time sampled'), 'time-context 噪音没剥掉');
    // 2026-11-04 记过：两条肥鱼自己说的话也被当成「他说的」带进去了。
    // 2026-11-19 查清：**不是 bug，是当时的推测错了**。
    //   · talkExchangeText 只读 napcat-private-*.jsonl —— 私聊，那里只有他一个人；
    //   · 真实 history 的行长这样 {"ts","role","text"}，**根本没有 name 字段**
    //     （实测私聊 180 行、群 216 行，name 全是 null）；
    //   · 群里的消息压根不走这条路。
    // 所以「按 name 过滤同胞机器人」这件事做不了、也不需要做。原断言基于错误前提，删掉。
    assert.ok(text.includes('还有要做的吗？'), '今天的对话没带进来');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
