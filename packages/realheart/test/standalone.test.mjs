/**
 * 单独装能不能用（2026-11-01 他问的：「最好是把插件做到单独装也能正常使用」）。
 *
 * 这个文件模拟一个干净机器：没有 ~/qqbot、没有通道、没有 TTS，什么都没有。
 * 只问一句：它会不会自己把该建的目录建出来，工具会不会注册，注入会不会抛错。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 先把 HOME 换到一个空白目录 —— config.mjs 在模块加载时就算 QQROOT
const FAKE_HOME = await mkdtemp(join(tmpdir(), 'rh-standalone-home-'));
const DSH = await mkdtemp(join(tmpdir(), 'rh-standalone-dsh-'));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.DSH_HOME = DSH;

const { apply } = await import('../index.mjs');
const { DEFAULTS } = await import('../lib/config.mjs');

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

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

// 2026-11-04：默认根目录改成插件自己的目录（$DSH_HOME/realheart），
// 不再指向 ~/qqbot —— 那是**某一台机器**的约定。判据：默认值要对着「装插件的人」成立。
test('干净机器上：默认路径指向插件自己的目录，而且一开始不存在', async () => {
  assert.equal(DEFAULTS.root, join(DSH, 'realheart'));
  assert.equal(DEFAULTS.stateDir, join(DSH, 'realheart', 'state'));
  assert.equal(existsSync(join(DSH, 'realheart')), false);
});

test('干净机器上：起得来，八个工具都在，注入不抛错', async () => {
  const h = makeCtx();
  let threw = null;
  try {
    apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
    await settle();
  } catch (err) {
    threw = err;
  }
  assert.equal(threw, null, threw && String(threw));

  for (const name of [
    'rh_mood',
    'rh_pending',
    'rh_control',
    'rh_changes',
    'rh_style',
    'rh_admit',
    'rh_view',
    'rh_claim',
  ]) {
    assert.ok(h.tools.has(name), name + ' 没注册');
  }

  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  assert.ok(inj, '注入 handler 没挂');
  const assembled = { sections: [] };
  const out = await inj.fn(assembled, {}, async () => assembled);
  assert.ok(out && typeof out === 'object');
});

test('干净机器上：账本目录会被自己建出来（不用人先写 mkdir）', async () => {
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  const dir = join(DSH, 'realheart', 'state');
  assert.ok(existsSync(dir), '账本目录没建：' + dir);
  const names = await readdir(dir);
  assert.ok(Array.isArray(names));
});

test('干净机器上：写一条心情能落盘（没有通道也不影响写）', async () => {
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  const r = await h.tools.get('rh_mood').execute({ feeling: '有点累', level: 5 });
  assert.ok(typeof r.text === 'string' && r.text.length > 0, 'returned: ' + String(r?.text));
  assert.ok(!r.text.includes('没记'), '被拒了：' + r.text);
  const file = join(DSH, 'realheart', 'state', 'mood.jsonl');
  assert.ok(existsSync(file), 'mood.jsonl 没落盘');
});

test('收尾：清掉临时目录', async () => {
  await rm(FAKE_HOME, { recursive: true, force: true });
  await rm(DSH, { recursive: true, force: true });
  assert.ok(true);
});
