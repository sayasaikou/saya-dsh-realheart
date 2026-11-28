/**
 * 心情 → 行为（2026-11-27）
 *
 * 这一组测的不是文案好不好看，是三件会直接改变她行为的事：
 *   ① 浓度必须落到**能做到的约束**上（句子长短、软尾、开不开话题），不是"你要显得低落"；
 *   ② 到点问 / 过期硬要是**两档**，不能混成一个"要不要记"；
 *   ③ 平淡的日子要能记 —— 否则断档永远分不清"没动"和"没记"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWindows, inWindow, behaviorLines, askPlan,
  minuteOfDay, sameLocalDay, hoursSince,
} from '../lib/mood-behavior.mjs';

test('窗口解析：正常写法、坏写法、跨零点', () => {
  assert.deepEqual(parseWindows('10:00-12:00,21:00-23:30'), [[600, 720], [1260, 1410]]);
  assert.deepEqual(parseWindows(' 9:00 - 9:30 '), [[540, 570]]);
  assert.deepEqual(parseWindows('乱写一气'), []);
  assert.deepEqual(parseWindows(''), []);
  assert.deepEqual(parseWindows('12:00-12:00'), []);
  const cross = parseWindows('22:00-02:00');
  assert.ok(inWindow(23 * 60, cross), '23:00 应在跨零点窗口内');
  assert.ok(inWindow(60, cross), '01:00 应在跨零点窗口内');
  assert.ok(!inWindow(12 * 60, cross), '12:00 不该在跨零点窗口内');
});

test('浓度 → 行为：低浓度不管，中浓度给硬约束，高浓度允许漏出来', () => {
  assert.deepEqual(behaviorLines(0), []);
  assert.deepEqual(behaviorLines(null), []);
  const low = behaviorLines(2).join('\n');
  assert.ok(low.includes('不影响你怎么说话'), low);

  const mid = behaviorLines(4).join('\n');
  assert.ok(mid.includes('短一截'), '该给句子长度的约束：' + mid);
  assert.ok(mid.includes('软尾'), '该给用词的约束：' + mid);
  // 2026-11-28：这一档只许说"怎么说"，不许说"别做什么"（那会压掉她的主动性）
  assert.ok(!mid.includes('不主动'), '不许用"不主动"写情绪：' + mid);
  assert.ok(!mid.includes('答完就停'), '不许用"答完就停"写情绪：' + mid);

  const high = behaviorLines(8).join('\n');
  assert.ok(high.includes('允许黏'), high);
  assert.ok(high.includes('只说一次'), '高浓度要防反复索取：' + high);

  const top = behaviorLines(10).join('\n');
  assert.ok(top.includes('先保证说话不出错'), top);
});

test('到点问：过期是硬要，窗口内是轻问，其余不吭声', () => {
  const w = parseWindows('10:00-12:00,21:00-23:30');

  const hard = askPlan({ hours: 30, hasToday: false, nowMin: 600, windows: w, maxHours: 20 });
  assert.equal(hard.kind, 'hard');
  assert.ok(hard.text.includes('先答这一句'), hard.text);
  assert.ok(hard.text.includes('none:unexplained'), '要给出"没变"也能写的写法');
  assert.ok(hard.text.includes('分不出是没动还是没记'), '要说清为什么必须记');

  const soft = askPlan({ hours: 5, hasToday: false, nowMin: 21 * 60 + 30, windows: w, maxHours: 20 });
  assert.equal(soft.kind, 'soft');
  assert.ok(soft.text.includes('不用等出事才记'), soft.text);

  const quiet1 = askPlan({ hours: 5, hasToday: true, nowMin: 21 * 60 + 30, windows: w, maxHours: 20 });
  assert.equal(quiet1.kind, 'none', '今天记过就不该再问');

  const quiet2 = askPlan({ hours: 5, hasToday: false, nowMin: 15 * 60, windows: w, maxHours: 20 });
  assert.equal(quiet2.kind, 'none', '不在窗口内不该问');

  const unknown = askPlan({ hours: null, hasToday: false, nowMin: 600, windows: w });
  assert.equal(unknown.kind, 'none', '拿不到时间就闭嘴，不猜');
});

test('过期阈值可调，且过期优先于窗口', () => {
  const w = parseWindows('10:00-12:00');
  const a = askPlan({ hours: 10, hasToday: false, nowMin: 600, windows: w, maxHours: 8 });
  assert.equal(a.kind, 'hard', '过了 maxHours 就是硬要，哪怕在窗口里');
  const b = askPlan({ hours: 10, hasToday: false, nowMin: 600, windows: w, maxHours: 48 });
  assert.equal(b.kind, 'soft', '阈值放宽后就降成轻问');
});

test('时间工具：分钟数、同一天、距今小时', () => {
  const d = new Date(2026, 10, 27, 21, 15, 0);
  assert.equal(minuteOfDay(d), 21 * 60 + 15);
  assert.ok(sameLocalDay(d.getTime(), d.getTime()));
  const y = new Date(2026, 10, 26, 23, 59, 0);
  assert.ok(!sameLocalDay(y.getTime(), d.getTime()));
  assert.equal(hoursSince('坏时间'), null);
  const two = hoursSince(new Date(Date.now() - 2 * 3600 * 1000).toISOString());
  assert.ok(two > 1.9 && two < 2.1, String(two));
});
