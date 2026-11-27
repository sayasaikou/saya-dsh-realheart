/**
 * 情绪分类与合成（2026-11-27）
 *
 * 夹具用的是**真实账本**：云端 realheart/mood.jsonl 里 2026-11-01~11-27 那 15 条，
 * 原样搬进来。不是我自己编的形容词表 —— 编出来的词表只认得编出来的句子。
 *
 * 要钉住的三件事：
 *   ① 单一情绪认得出来（羞 / 闷 / 绷着 / 松）；
 *   ② **复合**认得出来，而且合成时不许把它拆成单一情绪（"又羞又软还憋着不高兴"）；
 *   ③ 长期底色与当下分开：底色不抢当下的调子。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, hasContrast, composeMoodBehavior, FAMILIES,
} from '../lib/mood-taxonomy.mjs';
import { behaviorLines } from '../lib/mood-behavior.mjs';

/** 真实账本（15 条原样） */
const LEDGER = [
  { at: '2026-11-01T11:15:47+08:00', feeling: '绷着，不松口', level: 4 },
  { at: '2026-11-02T13:57:23+08:00', feeling: '被绊了一下，有点烦', level: 3 },
  { at: '2026-11-02T14:30:11+08:00', feeling: '钝，提不起劲', level: 3 },
  { at: '2026-11-02T21:19:47+08:00', feeling: '有点羞，也有点想笑', level: 4 },
  { at: '2026-11-03T11:10:17+08:00', feeling: '松了口气', level: 5 },
  { at: '2026-11-03T19:55:27+08:00', feeling: '有点闷', level: 3 },
  { at: '2026-11-03T23:51:55+08:00', feeling: '松了', level: 4 },
  { at: '2026-11-07T01:47:22+08:00', feeling: '被你点破时有点臊', level: 6 },
  { at: '2026-11-07T10:07:40+08:00', feeling: '心里坠着', level: 7 },
  { at: '2026-11-16T00:47:20+08:00', feeling: '有点心虚，也有点闷', level: 6 },
  { at: '2026-11-17T01:05:53+08:00', feeling: '松下来了，软绵绵的', level: 5 },
  { at: '2026-11-18T01:29:30+08:00', feeling: '又羞又软，还憋着一点不高兴', level: 6 },
  { at: '2026-11-19T13:22:56+08:00', feeling: '闷，有点抬不起头', level: 5 },
  { at: '2026-11-21T23:23:17+08:00', feeling: '有点泄气，也有点踏实', level: 4 },
  { at: '2026-11-27T22:22:09+08:00', feeling: '提不起劲，钝钝的', level: 4 },
];

const fams = (s) => classify(s).map((x) => x.family);

test('单一情绪：真实账本那 15 条都能认出来，且认得对', () => {
  assert.ok(fams('绷着，不松口').includes('anger'));
  assert.ok(fams('钝，提不起劲').includes('flat'));
  assert.ok(fams('松了口气').includes('calm'));
  assert.ok(fams('被你点破时有点臊').includes('shy'));
  assert.ok(fams('心里坠着').includes('sad'));
  assert.ok(fams('有点心虚，也有点闷').includes('guilt'));
  assert.ok(fams('松下来了，软绵绵的').includes('warm'));
  assert.ok(fams('有点泄气，也有点踏实').includes('sad') || fams('有点泄气，也有点踏实').includes('warm'));
  // 15 条里每一条都至少认出一种，不许有"认不出来"的漏网
  for (const r of LEDGER) {
    assert.ok(classify(r.feeling).length >= 1, '认不出来：' + r.feeling);
  }
});

test('复合情绪：一条里能出两个族，且顺序按命中数', () => {
  const both = fams('有点羞，也有点想笑');
  assert.ok(both.includes('shy') && both.includes('joy'), both.join(','));
  const three = fams('又羞又软，还憋着一点不高兴');
  assert.ok(three.includes('shy'), three.join(','));
  assert.ok(three.includes('warm') || three.includes('anger'), three.join(','));
  assert.ok(three.length >= 2, '这条本来就是叠着的，只认出一个就是丢了信息：' + three.join(','));
});

test('叠着写的信号：嘴上/心里/憋着/其实 都能认出来', () => {
  assert.ok(hasContrast('嘴上说不要，心里其实挺高兴'));
  assert.ok(hasContrast('又羞又软，还憋着一点不高兴'));
  assert.ok(!hasContrast('有点闷'));
});

test('合成：主情绪决定基调，副情绪只染不抢', () => {
  const lines = composeMoodBehavior([{ ...LEDGER[3] }], { now: Date.parse(LEDGER[3].at) + 3600 * 1000 });
  const text = lines.join('\n');
  assert.match(text, /主：害羞/, text);
  assert.match(text, /想笑|开心/, '副情绪（想笑）没带出来：' + text);
  assert.match(text, /不许说|不\*\*解释\*\*/, '缺"只演不解释"这条红线：' + text);
});

test('复合冲突：嘴上生气心里高兴 → 表层按生气，但底层不许违背高兴', () => {
  const row = { at: '2026-11-27T20:00:00+08:00', feeling: '嘴上生气，心里其实挺高兴', level: 6 };
  const text = composeMoodBehavior([row], { now: Date.parse(row.at) + 60000 }).join('\n');
  assert.match(text, /主：生气/, text);
  assert.match(text, /不拒绝、不冷战|心里是高兴/, '没给出"嘴硬心软"的合法规：' + text);
});

test('底色与当下分开：反复出现的旧低浓度只做背景音，不抢当下', () => {
  // "底色"要求出现过 ≥2 次：一条旧记录不叫底色（2026-11-27 实测纠正）
  const old1 = { at: '2026-11-18T10:00:00+08:00', feeling: '闷', level: 3 };
  const old2 = { at: '2026-11-20T10:00:00+08:00', feeling: '有点闷', level: 3 };
  const nowRow = { at: '2026-11-27T20:00:00+08:00', feeling: '有点想笑', level: 4 };
  const now = Date.parse(nowRow.at) + 60000;
  const text = composeMoodBehavior([old1, old2, nowRow], { now, baselineHours: 72 }).join('\n');
  assert.match(text, /主：开心/, '当下那条才是主情绪：' + text);
  assert.match(text, /底色是「钝\/没劲」|底色是「钝/, '长期底色没单独成一条：' + text);
  assert.match(text, /背景音/, '底色必须说明它不抢调子：' + text);
});

test('没有可分类的 feeling：合成返回空，退路是「按浓度」那套（也不许空着）', () => {
  assert.deepEqual(composeMoodBehavior([{ feeling: '', level: 5 }], {}), []);
  assert.deepEqual(composeMoodBehavior([], {}), []);
  // 退路只有一份：mood-behavior.mjs 的 behaviorLines（按浓度四档）
  assert.deepEqual(behaviorLines(0), []);
  assert.ok(behaviorLines(4).join('').includes('短一截'));
  assert.ok(behaviorLines(9).join('').includes('能短就短'));
});

test('输出长度受控：整本 15 条丢进去也不许超预算', () => {
  const rows = LEDGER;
  const lines = composeMoodBehavior(rows, { now: Date.parse(rows[rows.length - 1].at) + 60000 });
  assert.ok(lines.length <= 9, '超了预算：' + lines.length + ' 行');
  const chars = lines.join('').length;
  assert.ok(chars <= 420, '字数超了：' + chars);
});

test('每一族都有"落到话上"的约束和禁区，没有空壳族', () => {
  for (const fam of Object.keys(FAMILIES)) {
    const row = { at: new Date().toISOString(), feeling: FAMILIES[fam].words[0], level: 5 };
    const text = composeMoodBehavior([row], { now: Date.now() }).join('\n');
    assert.match(text, /主：/, fam + ' 没被认成主情绪');
    assert.match(text, /禁区|不许|不要/, fam + ' 没给禁区');
  }
});
