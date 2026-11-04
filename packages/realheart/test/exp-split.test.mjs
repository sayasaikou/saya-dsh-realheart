/**
 * 「你最近经历过的事」—— 分两格（2026-11-02 夜）。
 *
 * 为什么给它单开一份：
 *   这一格原来取「最近 2 条 activity」，全是从 free-time.jsonl 来的。
 *   而短唤醒从那天起也能「弄两下」，那些事记在 small.jsonl。
 *   两类混装有两个后果，都测得到：
 *     ① 小动作会把作品挤出去（这一格只有两个位置）
 *     ② 「刚才」和「那天」是两种时间感，混着写两个都不成立
 *
 * 只钉四件：
 *   ① 作品和小动作同时存在时，两行都在
 *   ② 只有小动作时，也出现（不能因为没作品就整段消失）
 *   ③ 都没有时，整段不出现（不做空段落凑数）
 *   ④ 小动作那行给的是相对时间，不是日期
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_HOME = await mkdtemp(join(tmpdir(), 'rh-exp-home-'));
const DSH = await mkdtemp(join(tmpdir(), 'rh-exp-dsh-'));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.DSH_HOME = DSH;

const { apply } = await import('../index.mjs');

const QQROOT = join(FAKE_HOME, 'qqbot');
const STATE = join(QQROOT, 'work', 'realheart');
const FREE = join(STATE, 'free-time.jsonl');
const SMALL = join(DSH, 'realheart', 'small.jsonl');
const SID = 'napcat-private-1418499574-exp';

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

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function inject(h) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  assert.ok(inj, '注入 handler 没挂');
  const assembled = { sections: [] };
  const out = await inj.fn(assembled, { agent: { session: { id: SID } } }, async () => assembled);
  const sec = (out?.sections ?? []).find((s) => s.name === 'realheart:exp');
  return sec ? String(sec.text) : '';
}

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

test('作品和小动作同时有：两行都在', async () => {
  await mkdir(STATE, { recursive: true });
  await mkdir(join(DSH, 'realheart'), { recursive: true });
  await writeFile(FREE, [
    JSON.stringify({ ts: '2026-11-02T21:44:53+0800', activity: '第十一件，做了块浮雕模型《西南望》。', artifacts: [], told_saya: true, why_not: null }),
    '',
  ].join('\n'), 'utf8');
  await writeFile(SMALL, [
    JSON.stringify({ at: minutesAgo(12), kind: 'small', did: '算了一下潟湖的换水时间：5 天换一遍上层', left: null }),
    '',
  ].join('\n'), 'utf8');

  const h = makeCtx();
  apply(h.ctx, { stateDir: STATE, servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  const text = await inject(h);
  assert.ok(text.includes('你最近经历过的事'), '整段没出现：' + JSON.stringify(text));
  assert.ok(text.includes('浮雕模型'), '作品那行不在：' + text);
  assert.ok(text.includes('《西南望》'), '书名号标题不该被丢掉：' + text);
  assert.ok(text.includes('5 天换一遍上层'), '小动作那行不在：' + text);
  assert.ok(!text.includes(JSON.stringify(minutesAgo(12)).slice(1, 11)), '小动作不该用日期，应该用相对时间：' + text);
});

test('只有小动作：也出现（没作品不能整段消失）', async () => {
  await rm(FREE, { force: true });
  const h = makeCtx();
  apply(h.ctx, { stateDir: STATE, servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  const text = await inject(h);
  assert.ok(text.includes('换水时间'), '只有小动作时该出现：' + JSON.stringify(text));
  assert.ok(!text.includes('作品（'), '没作品就不该有作品那行：' + text);
});

test('都没有：整段不出现', async () => {
  await rm(SMALL, { force: true });
  const h = makeCtx();
  apply(h.ctx, { stateDir: STATE, servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  const text = await inject(h);
  assert.equal(text, '', '两样都没有时不该凑一段空的，实际：' + JSON.stringify(text));
});

test('收尾：清掉临时目录', async () => {
  await rm(FAKE_HOME, { recursive: true, force: true });
  await rm(DSH, { recursive: true, force: true });
  assert.ok(true);
});
