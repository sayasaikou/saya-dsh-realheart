/**
 * 心情跨场合 + 来源不限（2026-11-02 沙耶提的两个真问题）。
 *
 * ① 「群里记过、私聊看不见」：以前本场合一条没有就写「无记录」，
 *    而同一次注入的第 16 行又写「记了 1 条，最后一条是今天」—— 自相矛盾。
 *    现在本场合没有就退到最近一条别处的，**但必须说清是哪儿记的**。
 *
 * ② 「来源只限聊天」：她上网看到的、做作品时冒出来的感受拿不到事件 id，
 *    以前一律拒。现在允许写成一段自述，标 `why_kind: told`。
 *
 * 这两条都是行为层的，纯函数测不到 —— 得起一个假 ctx，照 standalone 那套。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_HOME = await mkdtemp(join(tmpdir(), 'rh-cross-home-'));
const DSH = await mkdtemp(join(tmpdir(), 'rh-cross-dsh-'));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.DSH_HOME = DSH;

const { apply } = await import('../index.mjs');
const { sessionLabel } = await import('../lib/session.mjs');

const QQROOT = join(FAKE_HOME, 'qqbot');
const STATE = join(QQROOT, 'work', 'realheart');
const MOOD = join(STATE, 'mood.jsonl');

const GROUP = 'napcat-group-1107584206-aaa';
const PRIVATE = 'napcat-private-1418499574-bbb';

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

/** 造一条真话，让事件索引非空 —— 否则 told 会被自动降成 none:unexplained。 */
async function seedIndex() {
  await mkdir(join(QQROOT, 'data', 'msgs'), { recursive: true });
  await writeFile(
    join(QQROOT, 'data', 'msgs', '2026-01-01.jsonl'),
    JSON.stringify({ at: '2026-01-01T10:00:00+08:00', name: '他', text: '[他] 今天就到这吧' }) + '\n',
    'utf8',
  );
}

/** 跑一轮注入，把 realheart:mood 那段的正文抽出来。 */
async function inject(h, sessionId) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  assert.ok(inj, '注入 handler 没挂');
  const assembled = { sections: [] };
  const out = await inj.fn(assembled, { agent: { session: { id: sessionId } } }, async () => assembled);
  const mood = (out?.sections ?? []).find((s) => s.name === 'realheart:mood');
  return mood ? String(mood.text) : '';
}

// ── 纯函数：场合标签 ──

test('sessionLabel：群聊 / 私聊都认得出，认不出就老实说另一个会话', () => {
  assert.equal(sessionLabel(GROUP), '群聊 1107584206');
  assert.equal(sessionLabel(PRIVATE), '私聊 1418499574');
  assert.equal(sessionLabel('whatever-x'), '另一个会话');
  assert.equal(sessionLabel(''), '另一个会话');
  assert.equal(sessionLabel(null), '另一个会话');
});

// ── 行为：本场合没有，就退到别处的，并标明 ──

test('群里记的心情，私聊里也看得见 —— 但写着「不是在当前场合记的」', async () => {
  await seedIndex();
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  const r = await h.tools.get('rh_mood').execute(
    { feeling: '绷着，不松口', level: 4, why_ref: 'none:unexplained' },
    { agent: { session: { id: GROUP } } },
  );
  assert.ok(!String(r.text).includes('没记'), '群里这条没写进去：' + r.text);

  const text = await inject(h, PRIVATE);
  assert.ok(text.includes('绷着，不松口'), '私聊注入里看不到群里那条。实际：' + JSON.stringify(text));
  assert.ok(text.includes('不是在当前场合记的'), '没有标明是别处记的 —— 她会把它当成这里的情绪');
  assert.ok(text.includes('群聊 1107584206'), '没说是哪个场合：' + text);
  assert.ok(!text.includes('心情：无记录'), '又回到「无记录」了，自相矛盾没修掉');
});

test('本场合自己记的，不带「别处」那句', async () => {
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  await h.tools.get('rh_mood').execute(
    { feeling: '还有点兴奋', level: 6, why_ref: 'none:unexplained' },
    { agent: { session: { id: PRIVATE } } },
  );
  const text = await inject(h, PRIVATE);
  assert.ok(text.includes('还有点兴奋'), '本场合的没注进来：' + text);
  assert.ok(!text.includes('不是在当前场合记的'), '本场合的反而被标成别处的了：' + text);
});

// ── 行为：来源不限聊天 ──

test('拿不到事件 id、但说得清来处 → 能写进去，标成 told', async () => {
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  const told = '今早看到一篇讲深海噪声的文章，看完手有点发凉';
  const r = await h.tools.get('rh_mood').execute(
    { feeling: '有点怕', level: 5, why_ref: told },
    { agent: { session: { id: PRIVATE } } },
  );
  assert.ok(!String(r.text).includes('没记'), '说得清的来处被拒了：' + r.text);

  const rows = (await readFile(MOOD, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const last = rows[rows.length - 1];
  assert.equal(last.feeling, '有点怕');
  assert.equal(last.why_kind, 'told', '没标成 told，实际：' + last.why_kind);
  assert.equal(last.why_ref, told, '来处存的不是她那句话：' + last.why_ref);
});

test('太短的自述还是拒 —— 「不知道」三个字不算来处', async () => {
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  const r = await h.tools.get('rh_mood').execute(
    { feeling: '闷', level: 3, why_ref: '不知道' },
    { agent: { session: { id: PRIVATE } } },
  );
  assert.ok(String(r.text).includes('没记'), '这么短的自述不该过：' + r.text);
});

// ── 行为：多条并存，不是只留最后一条 ──

test('同一个场合记了两条不同的情绪 → 两条都在注入里', async () => {
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  const exec = { agent: { session: { id: PRIVATE } } };
  await h.tools.get('rh_mood').execute({ feeling: '有点怕', level: 5, why_ref: 'none:unexplained' }, exec);
  await h.tools.get('rh_mood').execute({ feeling: '还想笑', level: 4, why_ref: 'none:unexplained' }, exec);

  const text = await inject(h, PRIVATE);
  assert.ok(text.includes('有点怕'), '前一条掉了：' + text);
  assert.ok(text.includes('还想笑'), '后一条掉了：' + text);
  assert.ok(text.includes('【你现在带着的】'), '没走多条那个分支：' + text);
  assert.ok(text.includes('同时存在'), '没说「同时存在」—— 那就又成一条盖一条了：' + text);
});

test('别处记的会摆出来，但标明是别处的、带不带由她自己定', async () => {
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  await h.tools.get('rh_mood').execute({ feeling: '还算稳', level: 5, why_ref: 'none:unexplained' }, { agent: { session: { id: PRIVATE } } });
  // 低浓度也放行 —— 判断由她做，不由阈值替她挡（2026-11-02 沙耶）
  await h.tools.get('rh_mood').execute({ feeling: '有点堵', level: 3, why_ref: 'none:unexplained' }, { agent: { session: { id: GROUP } } });

  const text = await inject(h, PRIVATE);
  assert.ok(text.includes('还算稳'), '本场合那条没了：' + text);
  assert.ok(text.includes('有点堵'), '别处那条没摆出来：' + text);
  assert.ok(text.includes('带不带过来') || text.includes('不是这里的事'), '没说明那是别处的：' + text);
});

test('收尾：清掉临时目录', async () => {
  await rm(FAKE_HOME, { recursive: true, force: true });
  await rm(DSH, { recursive: true, force: true });
  assert.ok(true);
});
