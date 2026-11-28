/**
 * 年龄层：状态类数据的时间维度（2026-11-28）
 *
 * 起因（沙耶）：「不只是单个心情，我是说所有的，要有衰减或者类似的」——
 * 心情已经有了半衰期，但其余几层还是**永久有效**：
 *   · 表现层（style）：7 天只加一句"注意"，还照样摆在正文里；
 *   · 认过的错（admit）：**完全没有时间**，最近三条永远挂在那儿；
 *   · 看法（view）：也没有时间，三个月前的看法跟昨天的一样重；
 *   · 待改（pending-change）：挂多久都一样；
 *   · 没完的事（pending）：挂一个月也不提醒。
 *
 * 判据：**任何一条进注入的状态，都必须能回答"这是什么时候的事"** ——
 * 答不出来，它就会被当成"现在"，而这正是上一版心情踩的坑（早上记的困演到晚上）。
 *
 * 两类东西，两种处理：
 *   ① 可衰减的（心情）—— 按半衰期算有效浓度，见 mood-taxonomy.mjs；
 *   ② **无强度的**（表现 / 认错 / 看法 / 待改 / 待办）—— 没有"浓度"可算，
 *      所以按**年龄分档**：还新 → 正文；有点旧 → 正文 + 年龄；很旧 → 收成一行点名；太旧 → 不提。
 *      不假装是衰减，是**过期的证据要摆出来**。
 */

const H = 3600000;

/**
 * 每类的年龄档位（小时）。`keep` 是还占正文的上限，`mention` 是还值得点名的上限。
 *
 * 怎么定的：按"这件事多久还算数"来定，不是按"多久算旧"。
 *   · 表现层是她自己写的说话方式 —— 两周还合用，两个月前的一定不对了；
 *   · 认过的错 —— 一周内还记得住，一个月后还挂着就是惩罚了；
 *   · 看法 —— 人对事物的看法变得慢，所以给到 30 天；
 *   · 待改 —— 两周内还算"正在改"，两个月后要么做了要么撤了。
 */
export const AGE_RULES = {
  style: { keep: 24 * 14, mention: 24 * 60 },
  admit: { keep: 24 * 7, mention: 24 * 30 },
  view: { keep: 24 * 30, mention: 24 * 120 },
  pendingChange: { keep: 24 * 14, mention: 24 * 60 },
  // 待办不衰减：没干完就是没干完。但久挂要提醒 —— 要么做，要么撤。
  pending: { keep: Infinity, mention: Infinity, nagAfter: 24 * 14 },
};

/** 距现在多少小时。取不到时间返回 null（不猜）。 */
export function hoursSince(at, now = Date.now()) {
  const t = Date.parse(String(at || ''));
  if (Number.isNaN(t)) return null;
  return (now - t) / H;
}

/** 人话年龄："刚刚" / "3 小时前" / "今天早些时候" / "昨天" / "4 天前"。按日历日判断。 */
export function ageLabel(hours, atMs, nowMs = Date.now()) {
  if (hours === null || hours === undefined) return '';
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 0) return '';
  if (h < 1) return '刚刚';
  if (h < 6) return `${Math.round(h)} 小时前`;
  const t = Number(atMs);
  if (Number.isFinite(t)) {
    const a = new Date(t);
    const b = new Date(nowMs);
    const sameDay = a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay) return '今天早些时候';
    const y = new Date(b.getFullYear(), b.getMonth(), b.getDate() - 1);
    if (a.getFullYear() === y.getFullYear() && a.getMonth() === y.getMonth() && a.getDate() === y.getDate()) {
      return '昨天';
    }
    return `${Math.round(h / 24)} 天前`;
  }
  return h < 36 ? '昨天' : `${Math.round(h / 24)} 天前`;
}

/** 落在哪一档：fresh（很新）/ old（该带年龄）/ stale（只该点名）/ expired（别提了）。 */
export function ageBucket(kind, hours) {
  const rule = AGE_RULES[kind] || { keep: 24 * 30, mention: 24 * 120 };
  // ⚠️ 先挡 null：Number(null) === 0，会把"没写时间"当成"刚刚"（实测踩过）
  if (hours === null || hours === undefined) return 'unknown';
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 0) return 'unknown';
  if (h <= 24) return 'fresh';
  if (h <= rule.keep) return 'old';
  if (h <= rule.mention) return 'stale';
  return 'expired';
}

/**
 * 把一批记录按年龄切开。返回值里的每条都带上 `hours` 和 `age`，注入时直接用。
 *
 * ⚠️ 时间**只认记录自己写下的 at**，绝不看文件的 mtime ——
 * 文件每次装配都会被重写，拿 mtime 算就是"越读越不过期"
 * （2026-11-19 在时间感那段栽过一次，同一个坑不再踩第二次）。
 */
export function splitByAge(kind, rows, now = Date.now()) {
  const out = { fresh: [], old: [], stale: [], expired: [], unknown: [] };
  for (const r of rows || []) {
    const h = hoursSince(r?.at, now);
    const t = Date.parse(String(r?.at || ''));
    const item = { row: r, hours: h, atMs: Number.isNaN(t) ? null : t, age: ageLabel(h, Number.isNaN(t) ? null : t, now) };
    out[ageBucket(kind, h)].push(item);
  }
  return out;
}

/**
 * 久挂提醒（只对待办这类不衰减的）：挂够久了就明说"要么做，要么撤"。
 * 返回 '' = 不用提。
 */
export function nagLine(kind, items) {
  const rule = AGE_RULES[kind];
  if (!rule || !rule.nagAfter) return '';
  const tooOld = (items || []).filter((it) => Number(it.hours) > rule.nagAfter);
  if (!tooOld.length) return '';
  const days = Math.round(Number(tooOld[0].hours) / 24);
  return `（其中 ${tooOld.length} 件挂了超过 ${days} 天了 —— 要么这两天做掉，要么撤掉；`
    + '挂着不做比撤掉更费神。）';
}
