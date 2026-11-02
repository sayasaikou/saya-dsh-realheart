/**
 * 「你断言过的事」这一段（2026-11-02）。
 *
 * 为什么给它单开一份：`rh_claim` 从加进来那天起就**只有写、没有读** ——
 * 九个工具、十九个注入段，唯独它一个字都没被注进去过。
 * 这种漏不是报错，是静默：她写了，账上也有，就是永远不会被读到。
 * 纯函数测不到（它要跑整条注入），所以照 standalone 那套起假 ctx。
 *
 * 只钉三件：
 *   ① 有断言时，注入里真有这一段（不然又是白写）
 *   ② 被推翻的不出现（推翻了就不算断言了）
 *   ③ 一条都没有时，整段不出现（不做空段落凑数）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_HOME = await mkdtemp(join(tmpdir(), 'rh-claim-home-'));
const DSH = await mkdtemp(join(tmpdir(), 'rh-claim-dsh-'));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.DSH_HOME = DSH;

const { apply } = await import('../index.mjs');

const QQROOT = join(FAKE_HOME, 'qqbot');
const STATE = join(QQROOT, 'work', 'realheart');
const CLAIMS = join(STATE, 'claims.jsonl');
const SID = 'napcat-private-1418499574-claim';

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
  const sec = (out?.sections ?? []).find((s) => s.name === 'realheart:claim');
  return sec ? String(sec.text) : '';
}

test('有断言时，注入里真有这一段', async () => {
  await mkdir(STATE, { recursive: true });
  await writeFile(CLAIMS, [
    JSON.stringify({ at: '2026-11-02T10:00:00+08:00', action: 'add', id: 'aaaa1111', claim: '下周三之前能弄好', about: '那个接口', ref: null, by: 'her' }),
    '',
  ].join('\n'), 'utf8');

  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  const text = await inject(h);
  assert.ok(text.includes('你断言过的事'), '没注进去 —— 那就又是白写了：' + JSON.stringify(text));
  assert.ok(text.includes('下周三之前能弄好'), '断言内容不在：' + text);
  assert.ok(text.includes('那个接口'), '关于什么不在：' + text);
});

test('被推翻的不出现', async () => {
  await writeFile(CLAIMS, [
    JSON.stringify({ at: '2026-11-02T10:00:00+08:00', action: 'add', id: 'aaaa1111', claim: '下周三之前能弄好', about: '那个接口', ref: null, by: 'her' }),
    JSON.stringify({ at: '2026-11-02T11:00:00+08:00', action: 'add', id: 'bbbb2222', claim: '这周不会下雨', about: '天气', ref: null, by: 'her' }),
    JSON.stringify({ at: '2026-11-02T12:00:00+08:00', action: 'refute', id: 'aaaa1111', evidence: 'a:2026-11-02#88', by: 'her' }),
    '',
  ].join('\n'), 'utf8');

  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  const text = await inject(h);
  assert.ok(!text.includes('下周三之前能弄好'), '被推翻的那条还在：' + text);
  assert.ok(text.includes('这周不会下雨'), '没被推翻的应该还在：' + text);
});

test('一条都没有时，整段不出现', async () => {
  await rm(CLAIMS, { force: true });
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  const text = await inject(h);
  assert.equal(text, '', '没有断言时不该出现空段落，实际：' + JSON.stringify(text));
});

test('收尾：清掉临时目录', async () => {
  await rm(FAKE_HOME, { recursive: true, force: true });
  await rm(DSH, { recursive: true, force: true });
  assert.ok(true);
});
