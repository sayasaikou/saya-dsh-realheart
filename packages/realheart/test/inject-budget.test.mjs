/**
 * 注入预算压力测试（M1-6 的落地）
 *
 * 待办原文：「真实量级的记忆卡跑一次注入，断言心情小节仍在；被裁时日志有一行。」
 *
 * 为什么单独开一份：integration.test.mjs 里那三条预算测试，样本是「一句心情 + 三条短留言」，
 * 测的是「裁的顺序对不对」。可真实那台机器上，心情账本已经几百条、她留的话和没完的事攒了一堆 ——
 * 预算真正会炸的时候不在小样本里，在**平时的样子**里。所以这里按真实量级灌一遍：
 * 心情 300 条、没完的事几条、她留的话几条，预算压到 200 字，看这轮注入还站不站得住。
 *
 * 四条判据：
 *   ① 心情段仍在 —— 它是她此刻的样子，缺了这轮她就在裸奔（P 系列所有注入的前提）
 *   ② 裁掉了要留痕，而且那行得写清裁了什么（少一段不能是静默的）
 *   ③ 预算小到 1 字、段全被裁光 —— 这一轮**更要**留痕。
 *      踩过的坑：先 `return` 后留痕，全裁光那轮就是静默的，而那恰恰是最该被看见的一轮
 *   ④ 心情段自己就比预算长时，不许被裁（CHANGELOG：「超预算时按优先级从低到高裁……心情永不裁」）
 *
 * 测试辅助（假 ctx / boot）照 test/integration.test.mjs 抄，不另造一套 ——
 * 那套已经证明能让 apply() 真的跑起来（真 dsh 不用起，真 python 不用有）。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DSH_HOME 必须在 import 之前设好 —— config.mjs 是模块加载时求值的。
// 不设的话 apply() 会去读本机真的 config.user.json，测试就跟着环境漂了。
const HOME = await mkdtemp(join(tmpdir(), 'rh-budget-'));
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
      logger: {
        info: (m) => logs.push(['info', m]),
        error: (m) => logs.push(['error', m]),
      },
      get: (n) => (n === 'tools' ? { register: (d) => tools.set(d.name, d) } : undefined),
      on: (name, fn, opts) => handlers.push({ name, fn, opts }),
    },
  };
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function boot(over = {}) {
  // 记下 mkdtemp 建的父目录：清理时删它，不然每跑一次就留一个空目录在 TEMP 里
  let root = null;
  let stateDir = over.stateDir;
  if (!stateDir) {
    root = await mkdtemp(join(tmpdir(), 'rh-budget-state-'));
    stateDir = join(root, 'state');
  }
  const h = makeCtx();
  apply(h.ctx, {
    stateDir,
    servePage: false, // 不起观测页：这一路跟预算无关，起了只会拖时间
    freeTime: false,
    announceOnInstall: false,
    ...over,
  });
  await settle();
  return { ...h, stateDir, root };
}

/** 注入 handler 只挂一个；找不到就说明这个文件什么也没测到，直接判失败。 */
function injector(h) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  assert.ok(inj, '注入 handler 没挂上 —— 那这条测试什么也没测');
  assert.equal(inj.opts?.global, true, '注入没带 { global: true } —— 注册了也不会被触发');
  return inj;
}

/** 每次都给一个新的 assembly 对象：同一份对象只会注入一次（M1-7 的去重）。 */
async function assembleOnce(h) {
  return injector(h).fn({ sections: [] }, {}, async () => ({ sections: [] }));
}

/** 读 inject-problems.log；没有这个文件就是空数组（不是故障，是「还没记过」）。 */
async function readProblems(stateDir) {
  try {
    const raw = await readFile(join(stateDir, 'inject-problems.log'), 'utf8');
    return raw.split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
}

const budgetLinesOf = (lines) => lines.filter((l) => l.includes('budget'));
const sectionNames = (out) => (Array.isArray(out?.sections) ? out.sections.map((s) => s.name) : []);

// ── 真实量级的夹具 ──

/**
 * 300 条心情。账本默认只读最后 moodTailLines（200）条，所以「最后一条」必须是最近的：
 * 拿一条十二天前记的当「此刻」，注入里会出现「早该淡了」，那是另一个故事。
 */
function moodRows(n = 300) {
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({
      at: new Date(now - (n - i) * 3600_000).toISOString(),
      feeling: `第${i}条心情`,
      level: 5,
      why_ref: '',
      why_kind: 'none',
      decay: null,
    });
  }
  rows[n - 1] = {
    at: new Date(now).toISOString(),
    feeling: '今天下午一直有点闷，说不上来为什么',
    level: 6,
    why_ref: '',
    why_kind: 'none',
    decay: null,
  };
  return rows;
}

const PENDING_SEEDS = [
  '把观测页的手机入口做通（现在只绑 127.0.0.1，手机打不开）',
  '卸载脚本要认补装的依赖，不然 schemastery 那一路会漏',
  '心情按会话过滤 —— 事件里带了 session，注入里还没筛',
];

const KEPT_SEEDS = [
  '他说「明天陪你去医院」这句我记着，别在他忙的时候翻出来问',
  '下次他熬到两点还没睡，先问一句累不累，再谈正事',
  '那个未结的 pg 备份方案不要再自己提第二次，他想说会说',
  '写同人的时候不要写成剧本，要有呼吸和停顿',
];

/** 按真实量级灌一次：心情 300 条 + 没完的事 3 条 + 她留的话 4 条。 */
async function fillRealistic(h) {
  const rows = moodRows(300);
  await writeFile(join(h.stateDir, 'mood.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const add = h.tools.get('rh_pending');
  for (const text of PENDING_SEEDS) await add.execute({ action: 'add', text });
  const ctl = h.tools.get('rh_control');
  for (const text of KEPT_SEEDS) await ctl.execute({ action: 'keep', text });
}

// ── ① ② 共用同一次注入：待办原文说的是「跑一次注入」，不是跑两次 ──

const HEAVY_BUDGET = 200;

let heavy = null;
async function heavyRun() {
  if (heavy) return heavy;
  const h = await boot({ injectBudgetChars: HEAVY_BUDGET });
  await fillRealistic(h);
  const out = await assembleOnce(h);
  // 留痕必须在调完之后立刻读 —— 读晚了别的东西也可能往里写
  const problems = await readProblems(h.stateDir);
  heavy = { h, out, problems };
  return heavy;
}

after(async () => {
  if (heavy?.h?.root) await rm(heavy.h.root, { recursive: true, force: true });
});

test('①心情 300 条 + 留的话 + 没完的事，预算 200 时注入里仍有 realheart:mood', async () => {
  const { out } = await heavyRun();
  const names = sectionNames(out);
  assert.ok(
    names.includes('realheart:mood'),
    `心情段被裁了 —— 它是优先级最高的那段，别人都该先走。实际留下的：${names.join(' / ') || '（空）'}`,
  );
  // 不只看「有这一段」，还要看是**哪一条**：账本 300 条，注入必须用最后那条
  const mood = out.sections.find((s) => s.name === 'realheart:mood');
  assert.match(mood.text, /今天下午一直有点闷/, '注入的心情不是最后一条 —— 尾部窗口算错了');
  assert.ok(!mood.text.includes('第0条心情'), '把整份账本都读进来了');
});

test('②同一次注入里被裁，要在 inject-problems.log 留一条含 budget 的记录', async () => {
  const { out, problems } = await heavyRun();
  const budgetLines = budgetLinesOf(problems);
  assert.ok(
    budgetLines.length >= 1,
    `超预算裁了段，日志里却没有 budget 那一行（日志共 ${problems.length} 行：${problems.join(' | ') || '空'}）`,
  );
  const line = budgetLines[budgetLines.length - 1];
  // 「裁掉了」这三个字是给人看的：只有 budget 一个词，翻日志的人还是不知道该找什么
  assert.match(line, /裁掉了/, `日志那行没说清裁的是哪几段：${line}`);
  assert.match(line, /kept|pending|status-page/, `日志那行没点名被裁的段：${line}`);
  // 既然心情还在（①），这行里就不该出现心情
  assert.ok(!/裁掉了.*mood/.test(line), `心情被裁了（①应该已经失败）—— 日志：${line}`);
  // 预算确实生效了：不是一段没裁，也不是全裁光
  const names = sectionNames(out);
  assert.ok(names.length >= 1, '一段都没留下 —— 200 字足够装下心情段');
});

test('③预算压到 1 字、段全被裁光（心情除外），那一轮仍然要在日志里留痕', async () => {
  const h = await boot({ injectBudgetChars: 1 });
  try {
    await fillRealistic(h);
    const out = await assembleOnce(h);

    // 1 字连一段都装不下。
    // ⚠️ 2026-11-02 改：保底从「只保心情」扩到「她自己那三样」（mood / pending / pending-change），
    // 所以这里不能再要求「除心情以外一段不剩」—— 待办段现在也有保底，它留下来是对的。
    // 真正要钉的还是原来那两件：保底的那几段一定在；以及「全裁光」那一轮也必须留痕。
    const left = sectionNames(out).filter((n) => String(n).startsWith('realheart:'));
    const FLOORED = ['realheart:mood', 'realheart:pending', 'realheart:pending-change'];
    const others = left.filter((n) => !FLOORED.includes(n));
    assert.deepEqual(others, [], `预算 1 字居然还剩了不保底的段：${others.join(' / ')}`);

    // 关键：这一轮最该被看见，所以不能是静默的
    const problems = await readProblems(h.stateDir);
    assert.ok(
      budgetLinesOf(problems).length >= 1,
      `全裁光那一轮是静默的（日志 ${problems.length} 行：${problems.join(' | ') || '空'}）`
      + ' —— 这正是「先 return 后留痕」的坑',
    );
  } finally {
    await rm(h.root ?? h.stateDir, { recursive: true, force: true });
  }
});

test('④心情段自己就比预算长时不许被裁（心情永不裁）', async () => {
  const h = await boot({ injectBudgetChars: HEAVY_BUDGET });
  try {
    // 一条比预算长得多的心情：注入时还要加上边界那句，只会更长
    const feeling = `今天一整天都闷着。${'说不清是被什么压着，就是提不起劲。'.repeat(20)}`;
    assert.ok(feeling.length > HEAVY_BUDGET, '夹具没造好：这条心情本身就该比预算长');
    await writeFile(
      join(h.stateDir, 'mood.jsonl'),
      `${JSON.stringify({
        at: new Date().toISOString(),
        feeling,
        level: 7,
        why_ref: '',
        why_kind: 'none',
        decay: null,
      })}\n`,
    );

    const out = await assembleOnce(h);
    const names = sectionNames(out);
    const problems = await readProblems(h.stateDir);
    const dropped = budgetLinesOf(problems).join(' | ') || '（没有留痕）';
    assert.ok(
      names.includes('realheart:mood'),
      `心情段自己 ${feeling.length} 字、预算 ${HEAVY_BUDGET} 字，它被裁了。`
      + `实际留下的段：${names.join(' / ') || '（空）'}；留痕：${dropped}`,
    );
  } finally {
    await rm(h.root ?? h.stateDir, { recursive: true, force: true });
  }
});
