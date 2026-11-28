/**
 * 年龄层（2026-11-28）：状态类的数据都要能回答"这是什么时候的事"
 *
 * 为什么单开一组测试：这一层的 bug 不会报错，只会让三个月前的东西
 * 静悄悄地当"现在"用 —— 症状是"她说话不对劲"，而没人会去查注入。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_RULES, hoursSince, ageLabel, ageBucket, splitByAge, nagLine,
} from '../lib/aging.mjs';

const NOW = Date.parse('2026-11-28T20:00:00+08:00');
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();

test('时间只认记录里的 at，不看文件 mtime', () => {
  const rows = [{ at: at(24 * 40), what: '很久以前的一条' }];
  const r = splitByAge('admit', rows, NOW);
  assert.equal(r.expired.length + r.stale.length, 1, '40 天前的认错不该还算新');
  // 拿不到时间：归 unknown，不猜成"刚刚"
  const bad = splitByAge('admit', [{ what: '没写时间' }], NOW);
  assert.equal(bad.unknown.length, 1);
  assert.equal(hoursSince(''), null);
  assert.equal(hoursSince('乱写'), null);
});

test('年龄档位按 kinds 走：表现 14 天还算数，认错 7 天就该退', () => {
  assert.equal(ageBucket('style', 24 * 10), 'old');
  assert.equal(ageBucket('style', 24 * 20), 'stale');
  assert.equal(ageBucket('admit', 24 * 10), 'stale');
  assert.equal(ageBucket('admit', 24 * 40), 'expired');
  assert.equal(ageBucket('view', 24 * 20), 'old');
  assert.equal(ageBucket('view', 24 * 60), 'stale');
  // 待办永不判过期（没干完就是没干完）
  assert.equal(ageBucket('pending', 24 * 365), 'old');
  assert.ok(AGE_RULES.pending.keep === Infinity);
});

test('年龄说法按日历日', () => {
  assert.equal(ageLabel(0.3, NOW - 0.3 * 3600000, NOW), '刚刚');
  assert.equal(ageLabel(3, NOW - 3 * 3600000, NOW), '3 小时前');
  assert.equal(ageLabel(12, Date.parse('2026-11-28T08:00:00+08:00'), NOW), '今天早些时候');
  assert.equal(ageLabel(22, Date.parse('2026-11-27T22:00:00+08:00'), NOW), '昨天');
  assert.equal(ageLabel(24 * 5, NOW - 24 * 5 * 3600000, NOW), '5 天前');
});

test('久挂提醒：只有待办有，且只在真的挂久了才说', () => {
  const fresh = [{ hours: 3 }, { hours: 30 }];
  assert.equal(nagLine('pending', fresh), '');
  const old = [{ hours: 24 * 20 }, { hours: 40 }];
  const line = nagLine('pending', old);
  assert.match(line, /要么这两天做掉，要么撤掉/);
  assert.match(line, /1 件/);
  // 别的类没有 nagAfter，不该冒出来
  assert.equal(nagLine('style', [{ hours: 24 * 999 }]), '');
});

test('分档不改原记录、每条都带年龄', () => {
  const rows = [{ at: at(2), what: 'a' }, { at: at(24 * 20), what: 'b' }];
  const r = splitByAge('admit', rows, NOW);
  assert.equal(r.fresh.length, 1);
  assert.equal(r.fresh[0].row.what, 'a');
  assert.ok(r.fresh[0].age);
  assert.ok('hours' in r.fresh[0] && 'atMs' in r.fresh[0]);
  assert.equal(r.stale.length, 1, '20 天前对 admit 来说是 stale');
});
