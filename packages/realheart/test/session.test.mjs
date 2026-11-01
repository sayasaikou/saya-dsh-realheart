/**
 * 会话身份的测试（2026-11-01）。
 *
 * 这一层几乎全是「拿不到怎么办」——所以大半用例在证「拿不到时退化成现状，而不是瞎猜」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionIdOfAgent,
  sessionIdOfAssembleContext,
  sessionIdOfExec,
  moodVisibleIn,
  moodBleedsIn,
} from '../lib/session.mjs';

const SID = 'sess-abc-123';

// ── 取数：三种形态都要认，认不出就给空串 ──

test('sessionIdOfAgent：从 agent.session.id 取', () => {
  assert.equal(sessionIdOfAgent({ session: { id: SID } }), SID);
});

test('sessionIdOfAgent：id 不是非空字符串一律当没拿到', () => {
  for (const bad of [undefined, null, {}, { session: null }, { session: {} }, { session: { id: '' } }, { session: { id: 42 } }, 'str']) {
    assert.equal(sessionIdOfAgent(bad), '', `这个应当返回空串：${JSON.stringify(bad)}`);
  }
});

test('注入侧：context.agent / context.scope / context.session 三种形态都认', () => {
  assert.equal(sessionIdOfAssembleContext({ agent: { session: { id: 'a1' } } }), 'a1');
  assert.equal(sessionIdOfAssembleContext({ scope: { session: { id: 's2' } } }), 's2');
  assert.equal(sessionIdOfAssembleContext({ session: { id: 'c3' } }), 'c3');
});

test('注入侧：agent 优先于 scope（新宿主两处都有时拿 agent）', () => {
  assert.equal(
    sessionIdOfAssembleContext({ agent: { session: { id: 'from-agent' } }, scope: { session: { id: 'from-scope' } } }),
    'from-agent',
  );
});

test('注入侧：什么都没有是空串，不抛', () => {
  for (const bad of [undefined, null, {}, [], 0, 'x']) {
    assert.equal(sessionIdOfAssembleContext(bad), '');
  }
});

test('工具侧：execute 的第二参数认 agent 也认 session', () => {
  assert.equal(sessionIdOfExec({ agent: { session: { id: 'e1' } } }), 'e1');
  assert.equal(sessionIdOfExec({ session: { id: 'e2' } }), 'e2');
  assert.equal(sessionIdOfExec({}), '');
  assert.equal(sessionIdOfExec(undefined), '');
});

// ── 过滤：三档优先级 ──

test('没写 session 的记录：所有会话都看得见（老数据不是「谁的都不是」）', () => {
  const old = { at: '2026-10-20 12:00:00', feeling: '闷' };
  assert.equal(moodVisibleIn(old, 'sess-a'), true);
  assert.equal(moodVisibleIn(old, 'sess-b'), true);
  assert.equal(moodVisibleIn(old, ''), true);
  assert.equal(moodVisibleIn({ session: null }, 'sess-a'), true);
  assert.equal(moodVisibleIn({ session: '   ' }, 'sess-a'), true);
});

test('写了 session 的记录：只在那个会话里出现', () => {
  const row = { at: '2026-11-01 09:00:00', feeling: '嗯', session: 'sess-a' };
  assert.equal(moodVisibleIn(row, 'sess-a'), true);
  assert.equal(moodVisibleIn(row, 'sess-b'), false);
});

test('拿不到当前会话 id：不过滤（宁可多看见一条，也不因拿不到就藏了）', () => {
  const row = { at: '2026-11-01 09:00:00', feeling: '嗯', session: 'sess-a' };
  assert.equal(moodVisibleIn(row, ''), true);
  assert.equal(moodVisibleIn(row, undefined), true);
});

test('前后空白不算不同会话', () => {
  const row = { session: '  sess-a  ' };
  assert.equal(moodVisibleIn(row, 'sess-a'), true);
});

test('坏输入不抛', () => {
  assert.equal(moodVisibleIn(null, 'x'), true);
  assert.equal(moodVisibleIn(undefined, ''), true);
  assert.equal(moodVisibleIn({ session: 123 }, 'x'), true); // 非字符串当没写
});


// ── 渗透：别处的心情什么时候能渗过来 ──

const NOW = Date.parse('2026-11-01T10:00:00+08:00');
const fresh = (over = {}) => ({ at: '2026-11-01 09:30:00', level: 7, session: 'sess-b', ...over });

test('渗透：别处 + 浓 + 新 → 渗', () => {
  assert.equal(moodBleedsIn(fresh(), 'sess-a', { now: NOW }), true);
});

test('渗透：本场合记的不渗', () => {
  assert.equal(moodBleedsIn(fresh({ session: 'sess-a' }), 'sess-a', { now: NOW }), false);
});

test('渗透：没写会话的不渗（它已经是全局那张脸）', () => {
  assert.equal(moodBleedsIn(fresh({ session: null }), 'sess-a', { now: NOW }), false);
});

test('渗透：太淡不渗', () => {
  assert.equal(moodBleedsIn(fresh({ level: 3 }), 'sess-a', { now: NOW }), false);
});

test('渗透：太旧不渗', () => {
  assert.equal(moodBleedsIn(fresh({ at: '2026-10-30 09:30:00' }), 'sess-a', { now: NOW }), false);
});

test('渗透：说不清多早 → 不渗（不猜）', () => {
  assert.equal(moodBleedsIn(fresh({ at: '' }), 'sess-a', { now: NOW }), false);
  assert.equal(moodBleedsIn(fresh({ at: '不知道' }), 'sess-a', { now: NOW }), false);
});

test('渗透：拿不到当前会话 id → 不渗', () => {
  assert.equal(moodBleedsIn(fresh(), '', { now: NOW }), false);
});

test('渗透：阈值可调', () => {
  assert.equal(moodBleedsIn(fresh({ level: 3 }), 'sess-a', { now: NOW, minLevel: 3 }), true);
  assert.equal(moodBleedsIn(fresh(), 'sess-a', { now: NOW, maxHours: 0.1 }), false);
});
