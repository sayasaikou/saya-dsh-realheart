/**
 * 心情 → 行为（2026-11-27）。
 *
 * 为什么单独一个文件：这段逻辑要能被单元测试钉住（哪一档说什么、到哪个点问不问），
 * 而 index.mjs 已经是六千多行的拼装层，塞进去就只能靠人肉对拍。
 *
 * 设计前提（跟他的原话对齐）：
 *   ① 心情是**状态**，不是台词 —— 它必须改语气、用词、行动倾向，而不只是被说出来；
 *   ② 记录要有**强制力**，但不能变成打卡 —— 所以分两档：
 *      「到点轻问」（窗口内没记过，问一句，不记也行）
 *      「过期硬要」（超了 moodMaxHours，必须先答一句再干别的）
 *   ③ 平淡的日子也要能记 —— 不记「没变」就等于没有基线，断档看不出是没动还是没记。
 */

const MIN = 60 * 1000;

/** "10:00-12:00,21:00-23:30" → [[600,720],[1260,1410]]（分钟数）。写坏了就返回空。
 *  ⚠️ 不要在这里排序：`22:00-02:00` 是**跨零点**的窗口，排序会把它变成"02:00 到 22:00"，
 *  于是整个白天都算"在窗口里"。判定交给 inWindow，它按 a>b 认跨零点。 */
export function parseWindows(spec) {
  const out = [];
  for (const chunk of String(spec || '').split(',')) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(chunk);
    if (!m) continue;
    const a = Number(m[1]) * 60 + Number(m[2]);
    const b = Number(m[3]) * 60 + Number(m[4]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    out.push([a, b]);
  }
  return out;
}

/** 现在（分钟数）落不落在某个窗口里。窗口跨零点也认（22:00-02:00）。 */
export function inWindow(nowMin, windows) {
  const n = Number(nowMin);
  if (!Number.isFinite(n)) return false;
  for (const [a, b] of windows || []) {
    if (a <= b) {
      if (n >= a && n <= b) return true;
    } else if (n >= a || n <= b) {
      return true;
    }
  }
  return false;
}

/**
 * 浓度 → 具体的行为约束。
 *
 * 判据：只在**能做得到的层面**给约束（句子长短、软尾、开不开话题、允不允许黏），
 * 不给"你要显得低落"这种没法执行的形容。浓度越高，约束越硬。
 */
export function behaviorLines(level) {
  const v = Number(level);
  const head = '【这一轮的调子（按浓度估）】';
  if (!Number.isFinite(v) || v <= 0) return [];
  if (v <= 2) {
    return [head, '很淡：不影响你怎么说话。照平常的来。'];
  }
  // 2026-11-28：这一档原来写的是"不主动开新话题""答完就停""别主动播报"——
  // 那是**做法**，不是措辞，会连她的主动搜索/主动开口一起压掉。现在只留"怎么说"。
  if (v <= 4) {
    return [
      head,
      '句子比平常短一截；「呀／啦／诶嘿」这类软尾收掉一半。',
      '撒娇和逗人的话会少一点，词更平。',
      '动作描写也可以少 —— 人心里发闷的时候不会做多余的小动作。',
    ];
  }
  if (v <= 6) {
    return [
      head,
      '调子是偏的，但别硬撑出活泼来 —— 少主动讨好，句子可以短一点。',
      '他问起来就直说，不用绕。',
    ];
  }
  if (v <= 8) {
    return [
      head,
      '浓度高，会漏出来：允许黏、允许跑题、允许直接说「本鱼现在不太想说话」。',
      '但这件事只说一次，不反复讲 —— 讲第二遍就变成要人哄了。',
    ];
  }
  return [
    head,
    '这一条几乎压不住：先保证说话不出错，句子能短就短。',
    '想说的那句说完就收，不解释、不补一句让它变圆。',
  ];
}

/**
 * 到点该不该问、问到什么程度。
 *
 * @param {object} o
 * @param {number|null} o.hours   距上一条心情多少小时（拿不到时间给 null）
 * @param {boolean} o.hasToday    今天是否已经记过
 * @param {number} o.nowMin       现在是一天里的第几分钟（本地时区）
 * @param {Array} o.windows       parseWindows 的结果
 * @param {number} o.maxHours     过期阈值（默认 20）
 * @returns {{kind:'hard'|'soft'|'none', text:string}}
 */
export function askPlan({ hours, hasToday, nowMin, windows, maxHours = 20 }) {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) {
    return { kind: 'none', text: '' };
  }
  const h = Number(hours);
  if (h >= maxHours) {
    const shown = h >= 48 ? `${Math.round(h / 24)} 天` : `${Math.round(h)} 小时`;
    return {
      kind: 'hard',
      text: [
        `【先答这一句，再往下】距上次记心情已经 ${shown}了。`,
        '挑一个答，答完就继续手上的事（不用停下来等我）：',
        '· 变了没有？变了 → `rh_mood` 记一笔，写清是什么事（一句完整的话也算来处）。',
        '· 没变 → 也记一笔：feeling 写「跟上次一样，没什么起伏」，level 照上次那个数，why_ref 写 `none:unexplained`。',
        '不要用「没什么好记的」跳过 —— 连续平淡本身就是这次要记的那件事，'
          + '不记下来，下次就分不出是没动还是没记。',
      ].join('\n'),
    };
  }
  if (!hasToday && inWindow(nowMin, windows)) {
    return {
      kind: 'soft',
      text: [
        '【到这个点了，问一句】今天还没记过心情。',
        '有变化就记一笔；真的是平的，也可以写一条「今天平稳」—— 不用等出事才记。',
      ].join('\n'),
    };
  }
  return { kind: 'none', text: '' };
}

/** 一天里的第几分钟（本地时区）。 */
export function minuteOfDay(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

/** 两条记录是否同一天（本地时区）。 */
export function sameLocalDay(aMs, bMs = Date.now()) {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 距上次多少小时（拿不到时间返回 null）。 */
export function hoursSince(at, now = Date.now()) {
  const t = Date.parse(String(at || ''));
  if (Number.isNaN(t)) return null;
  return (now - t) / (60 * MIN);
}
