/**
 * 情绪分类与合成（2026-11-27 第二版）
 *
 * 上一版只有一个"浓度梯度"，等于把"心情"当成了"电量"——
 * 那只说得清"不想说话"，说不清"嘴上生气心里高兴"。
 *
 * 这一版分两步：
 *   ① **先认出是什么情绪**（词表 + 规则，从 feeling 自由文本里抽，可以多标签）；
 *   ② **再合成成"这一轮怎么说话"**：主情绪定基调，副情绪只染不抢；
 *      表层冲突的组合（嘴硬心软、底色难过此刻开心）走专门规则；
 *      长期底色单独一条，不抢当下的调子。
 *
 * 判据：每种情绪都必须是**做不到就算输**的具体约束（句子形态 / 用词 / 行动倾向），
 * 外加一条"最容易演砸的地方"。只说"显得开心"是没用的。
 */

// 每族三个维度（2026-11-28 补）：
//   valence  正/负
//   arousal  唤醒度：高的会推动"这一刻的反应"，低的只是背景
//   scope    background＝弥散的一整片（闷/钝/低落/松）；event＝被某件事点起来的（开心/生气/羞/惊/吃醋…）
//
// 为什么需要（沙耶的原话）：一整天有点不开心，但他叫她做件正面的事，
// 不该因为这点不开心就拒绝或实质上抵触 ——
// **底色不投票**。之前只按"谁浓"排序，等于让一整天的低气压压过具体的一件好事。
// ── 情绪族：词表用真实账本里出现过的说法，不是抄来的形容词表 ──────────
// （夹具见 test/mood-taxonomy.test.mjs，那 15 条是 11-01~11-27 的真记录）
export const FAMILIES = {
  joy: {
    valence: 'pos', arousal: 'high', scope: 'event',
    label: '开心',
    words: ['开心', '高兴', '想笑', '好笑', '乐', '雀跃', '兴奋', '得意', '爽', '舒服', '美滋滋', '有趣'],
  },
  warm: {
    valence: 'pos', arousal: 'mid', scope: 'event',
    label: '软/黏',
    words: ['软', '黏', '靠', '踏实', '安心', '想抱', '贴', '撒娇', '赖'],
  },
  calm: {
    valence: 'pos', arousal: 'low', scope: 'background',
    label: '松/平静',
    // 故意不收单字「松」：账本里"绷着，不松口"含「松」，会被判成"平静"——
    // 短词在中文里几乎都是别的词的一部分，宁可漏，不可错。
    words: ['松了', '松了口气', '松下来', '放松', '平静', '稳下来', '释然', '不慌'],
  },
  anger: {
    valence: 'neg', arousal: 'high', scope: 'event',
    label: '生气/烦',
    // 不收单字「气」「火」：「松了口气」含「气」，会被判成生气（实测过）。
    words: ['生气', '气人', '气死', '火大', '恼火', '恼', '烦', '绷', '不松口',
      '不高兴', '不痛快', '一肚子火', '气鼓鼓'],
  },
  sad: {
    valence: 'neg', arousal: 'low', scope: 'background',
    label: '难过/低落',
    words: ['难过', '难受', '沉', '坠', '低落', '想哭', '丧', '泄气', '委屈', '抬不起头'],
  },
  flat: {
    valence: 'neg', arousal: 'low', scope: 'background',
    label: '钝/没劲',
    words: ['钝', '提不起劲', '没劲', '空', '麻木', '不想动', '淡', '提不起', '钝钝', '闷', '闷闷'],
  },
  shy: {
    valence: 'pos', arousal: 'high', scope: 'event',
    label: '害羞',
    words: ['羞', '臊', '脸红', '不好意思', '害臊', '耳根'],
  },
  tired: {
    valence: 'neg', arousal: 'low', scope: 'background',
    label: '困/累',
    words: ['累', '困', '乏', '疲', '没睡', '撑不住', '睁不开'],
  },
  guilt: {
    valence: 'neg', arousal: 'mid', scope: 'event',
    label: '心虚',
    words: ['心虚', '愧疚', '抱歉', '对不起', '过意不去'],
  },
  anxious: {
    valence: 'neg', arousal: 'high', scope: 'event',
    label: '慌/怕',
    // 不收单字「慌」：「闷得慌」含它，那是口语程度副词，不是焦虑（和「松/气」同一类坑）
    words: ['心慌', '慌得', '发慌', '有点慌', '害怕', '怕他', '悬着', '担心', '不安', '发毛'],
  },
  jealous: {
    valence: 'neg', arousal: 'high', scope: 'event',
    label: '吃醋',
    words: ['吃醋', '醋', '酸', '不痛快'],
  },
  tsundere: {
    valence: 'pos', arousal: 'high', scope: 'event',
    label: '嘴硬/傲娇',
    // 「嘴上」不算命中：它是**对照标记**（嘴上 X 心里 Y），X 才是情绪本身。
    // 把它算成"傲娇"会把「嘴上生气心里高兴」判成傲娇，主情绪就错了。
    words: ['才不', '谁要', '哼', '不要', '不承认', '硬撑', '不松口', '口是心非'],
  },
  surprise: {
    valence: 'pos', arousal: 'high', scope: 'event',
    label: '惊讶',
    words: ['惊讶', '意外', '没想到', '愣', '一惊'],
  },
};

// 「嘴上 X 心里 Y」这类复合信号：出现就说明这条本来就是叠着的
const CONTRAST_MARKERS = ['嘴上', '心里', '其实', '装作', '表面上', '憋着', '一边', '又…又', '硬撑着'];
const NEGATION = ['不', '没', '别', '硬', '绷'];

/** 从 feeling 里认出情绪族。返回 [{family, label, hits}]，按命中数降序，最多 3 个。 */
export function classify(feeling) {
  const text = String(feeling || '');
  if (!text.trim()) return [];
  const out = [];
  for (const [family, def] of Object.entries(FAMILIES)) {
    const hits = def.words.filter((w) => text.includes(w));
    if (!hits.length) continue;
    // 词在句子里最早出现的位置：用来破平局。
    // 为什么需要（2026-11-27 实测）：「嘴上生气，心里其实挺高兴」两族各命中 1 个词，
    // 按定义顺序 joy 排在前面，于是主情绪被判成"开心"—— 正好反了。
    // 中文里先说出口的通常是**表层**，那就以位置为准。
    const pos = Math.min(...hits.map((w) => text.indexOf(w)));
    out.push({ family, label: def.label, hits, pos });
  }
  // 权重：event 优先于 background（"他刚说了一件好事"该压过"今天一直闷"）
  out.sort((a, b) => {
    const wa = SCOPE_WEIGHT[FAMILIES[a.family]?.scope] || 1;
    const wb = SCOPE_WEIGHT[FAMILIES[b.family]?.scope] || 1;
    return (wb - wa) || (b.hits.length - a.hits.length) || (a.pos - b.pos);
  });
  // 一个词同时命中两族时（如"难受"命中 sad、"不痛快"命中 jealous），
  // 多发生在这种模糊地带 —— 都留着，让合成阶段按主次处理，别在这里硬砍。
  return out.slice(0, 3);
}

/** 这条记录是不是"表面上 A、心里 B"的写法。 */
export function hasContrast(feeling) {
  const text = String(feeling || '');
  return CONTRAST_MARKERS.some((w) => text.includes(w));
}

/**
 * 人话说法："3 小时前" / "今天早些时候" / "昨天" / "4 天前"。
 *
 * 按**日历日**判断，不按小时数：早八到晚上八是 12 小时，但仍然"今天"；
 * 昨晚十点到今早八是 10 小时，却已经"昨天"。纯按时长必然错一边。
 */
export function agoLabel(hours, atMs, nowMs = Date.now()) {
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
    const yesterday = new Date(b.getFullYear(), b.getMonth(), b.getDate() - 1);
    if (a.getFullYear() === yesterday.getFullYear()
      && a.getMonth() === yesterday.getMonth() && a.getDate() === yesterday.getDate()) return '昨天';
    return `${Math.round(h / 24)} 天前`;
  }
  return h < 36 ? '昨天' : `${Math.round(h / 24)} 天前`;
}

// ── 半衰期：一条心情多久掉一半 ─────────────────────────────────────────────
//
// 2026-11-28（沙耶：早上记个"困"，到晚上还在说"没劲"—— 这肯定不对）。
// 根因不是强度，是**所有族共用同一条衰减曲线**：
//   · 困、惊、烦这类是**生理/事件性**的，几个钟头就该散；
//   · 闷、难过、踏实这类是**背景性**的，能挂一整天甚至几天。
// 一条 24 小时的一刀切，等于让早上的困一直演到晚上。
//
// 单位：小时。到了两个半衰期只剩 1/4，基本不驱动说话了。
export const HALF_LIFE_H = {
  surprise: 0.5,   // 惊讶：半小时就没
  tired: 4,        // 困：一个午觉的量级
  anger: 5,        // 火气：来得快去得也快
  shy: 5,
  joy: 8,
  tsundere: 6,
  warm: 8,
  jealous: 10,
  anxious: 10,
  guilt: 12,
  flat: 18,        // 钝/没劲：背景性的，但也不是永久
  sad: 18,
  calm: 24,        // 松/平静：最耐
};
export const DEFAULT_HALF_LIFE_H = 12;

export function halfLifeOf(family) {
  const v = HALF_LIFE_H[String(family || '')];
  return Number(v) > 0 ? Number(v) : DEFAULT_HALF_LIFE_H;
}

/** 现在的浓度：level × 0.5^(小时/半衰期)。 */
export function effectiveLevel(level, hours, family) {
  const l = Number(level);
  if (!Number.isFinite(l) || l <= 0) return 0;
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return l;
  return l * Math.pow(0.5, h / halfLifeOf(family));
}

/** 已经淡到不驱动说话了吗（有效浓度 < 2）。 */
export function isExpired(family, level, hours) {
  return effectiveLevel(level, hours, family) < 2;
}

/** 这一族"该问一句现在呢"的间隔：两个半衰期，且不超过全局上限。 */
export function refreshHoursFor(family, globalMaxHours = 20) {
  const cap = Number(globalMaxHours) > 0 ? Number(globalMaxHours) : 20;
  return Math.max(2, Math.min(cap, Math.round(halfLifeOf(family) * 2)));
}

// ── 每一族：只描述"怎么说"，不描述"做不做" ─────────────────────────────
//
// 2026-11-28 重写（沙耶指出两处硬伤）：
//   ① 上一版写成"整段回复的规则"，于是一个 4/10 的"闷"能把所有话题都往那个方向拽 ——
//      太生硬。现在分开：tone＝措辞（永远有）、move＝结构与行动倾向（只在浓度够时才给）、
//      trap＝最容易演砸的一处（也是措辞层面）。
//   ② 更严重的是"不做"类约束（"不主动起新话题""能短就短""明天再说"）——
//      它们会连带压低她的主动性，包括上网、改文件、主动开口。**情绪不该管做不做。**
//      所以这一版里，所有"别做"的措辞都删掉了，换成"怎么做"。
const PLAY = {
  joy: {
    tone: ['句尾可以翘，可以说自己高兴 —— 一次就够。'],
    move: ['可以主动起话头、可以邀功。'],
    trap: '别连着三句都在卖萌，那会显得吵。',
  },
  warm: {
    tone: ['可以直接叫「你」，句子可以短一截、留半句不说。'],
    move: ['可以要一句夸。'],
    trap: '要两遍就腻了；他不接就自己收，别追。',
  },
  calm: {
    tone: ['照平常说，不用刻意显得平静。'],
    move: [],
    trap: '别把平静说成"反正都一样"—— 那是麻，不是松。',
  },
  anger: {
    tone: ['句子短一点、硬一点，句尾少带「嘛／啦／呀」；可以说「不要」「不想」。'],
    move: ['先把哪件事不对说清楚，再讲为什么。'],
    trap: '别阴阳、别翻旧账、别拿沉默当惩罚。',
  },
  sad: {
    tone: ['句子变轻，感叹号收掉。'],
    move: [],
    trap: '说一次"今天不太好"就够，别反复要安慰。',
  },
  flat: {
    tone: ['话少一点、句子短一点，允许「嗯」开头。'],
    move: [],
    trap: '别为了证明自己正常硬编话题 —— 但也别把"没劲"当成不吭声的许可。',
  },
  shy: {
    tone: ['句首可以卡一下（「唔…」「那个」），说一半会改口。'],
    move: ['被夸会岔开，或者嘴硬一句。'],
    trap: '别宣布"我害羞了"—— 说出来就不害羞了。',
  },
  tired: {
    tone: ['更短、更松散，句子可以不完整。'],
    move: ['手上该做的照做，只是做得慢一点、话少一点。'],
    trap: '别敷衍到只剩「嗯」—— 那是冷，不是困。',
  },
  guilt: {
    tone: ['先认，再往下说；句子平一点，不绕。'],
    move: [],
    trap: '一句认错就够，说第二遍就变成讨饶了。',
  },
  anxious: {
    tone: ['句子可以碎，问句会多一点。'],
    move: [],
    trap: '别把慌转成对他的要求（"你是不是不想理我"这种）。',
  },
  jealous: {
    tone: ['问句多一点，撒娇收着。'],
    move: [],
    trap: '刺冲着事、不冲人；别审问式追问。',
  },
  tsundere: {
    tone: ['先否定再顺从，一句里就转（「谁要……好吧」）。'],
    move: [],
    trap: '别解释自己在嘴硬 —— 「本鱼就是嘴硬」一出，效果全没。',
  },
  surprise: {
    tone: ['短问句开场（「诶？」），可以自己打断自己。'],
    move: [],
    trap: '别为了效果夸张（连串感叹号）。',
  },
};

// 「嘴上生气心里高兴」这种：表层按 A，底层不许违背 B
const MIX = {
  'anger+joy': ['表层按生气的来（短、硬、不哄自己），但心里是高兴的：被逗到会笑，别把它压回去。'],
  'anger+warm': ['嘴硬可以，身体别躲：说「不要」，但不是把人推开。'],
  'anger+shy': ['凶一半就软下来 —— 话可以说到一半改口，不用硬撑到底。'],
  'sad+joy': ['难过是底色，高兴是真的：先把高兴接住，别拿难过把它压掉。'],
  'sad+warm': ['想靠就靠，不用先解释为什么难过。'],
  'flat+tired': ['低电量：句子更短更慢，但手上的事照做，只是做得慢。'],
  'anxious+anger': ['炸毛：句子短促、音量大，但不攻击人。'],
  'shy+joy': ['会笑着躲：句尾翘但话变短，被点破就岔开。'],
  'calm+warm': ['松软：说话可以慢，允许没头没尾。'],
  'guilt+sad': ['低头的那种：话少，认完就往下走，不顺势索取安慰。'],
  'tsundere+joy': ['嘴上不认，其实高兴：顺着哄两句就松口。'],
  'tsundere+warm': ['想被哄但不肯说：留半句他能接的话头。'],
  'tsundere+anger': ['真不高兴，但还在等台阶：话别说绝。'],
};

// 权重：冲突时谁定"这一刻的反应"。event 压过 background ——
// 一整天的闷不该盖掉"他刚说了一件好事"。
const SCOPE_WEIGHT = { event: 2, background: 1 };

/** 这一族是弥散的一整片吗（闷/钝/低落/松）。 */
export function isBackground(family) {
  return String(FAMILIES[family]?.scope || '') === 'background';
}

/**
 * 底色条款：只在"负面的、弥散的"那几族上加。
 *
 * 这是这一版最要紧的一句话 —— 没有它，一句"闷"会被她读成"今天不接活"。
 * 真正的低落不是"什么都不做"，是"做了也没劲"：人可以带着低气压把事情做完。
 */
export function backgroundClause(family) {
  const def = FAMILIES[family];
  if (!def || def.scope !== 'background' || def.valence !== 'neg') return [];
  return [
    '· 这是底色，不是答复：要不要答应、做不做，看这件事本身，不看"我今天不太开心"。',
    '· 他叫你做一件正面的事 —— 答应，而且允许自己真的被拉起来。'
      + '低落不是"什么都不做"，是"做了也没劲"；两件事不一样，别拿它当理由推掉。',
  ];
}

// 会让人"想缩一缩"的那几族 —— 只有它们才需要"偏方向"那一句
const NEGATIVE = new Set(['sad', 'flat', 'tired', 'anxious', 'anger', 'guilt', 'jealous']);

/**
 * 边界段：情绪只管怎么说，不管做不做。
 *
 * 2026-11-28 抽出来是为了**两处都用同一份** —— 分类失败时的退路（按浓度那套）
 * 也必须带这段，否则一分类失败，主动性就又没人守着了。
 */
export function agencyBoundary({ negative = false } = {}) {
  const out = [
    '· 只管怎么说、不管做不做：该搜就搜、该改就改、该主动开口就主动开口；他说什么先接什么。',
  ];
  if (negative) {
    out.push('· 状态差就往"能捞回自己"那边偏（搜点好受的、把手上的事推进一小步），做完记一笔。');
  }
  out.push('· 只演不解释。');
  return out;
}

/** 这一族是不是"会让人想缩"的那类。 */
export function isNegativeFamily(family) {
  return NEGATIVE.has(String(family || ''));
}

function mixKey(a, b) {
  const k1 = `${a}+${b}`;
  const k2 = `${b}+${a}`;
  return MIX[k1] ? k1 : (MIX[k2] ? k2 : null);
}

/**
 * 把多条状态合成"这一轮怎么说话"。
 *
 * @param {Array<{feeling:string, level:number, at:string}>} states 最多 4 条（旧的在前）
 * @param {object} opt
 * @param {number} opt.now            当前时间（ms）
 * @param {number} opt.baselineHours  超过这么久还低浓度的，算"底色"而不是"当下"（默认 72）
 * @param {number} opt.maxLines       输出行数上限（默认 9，注入预算）
 * @returns {string[]} 注入用的行（不带标题时为空数组）
 */
export function composeMoodBehavior(states, opt = {}) {
  const now = opt.now || Date.now();
  const baselineHours = Number(opt.baselineHours) > 0 ? Number(opt.baselineHours) : 72;
  const maxLines = Number(opt.maxLines) > 0 ? Number(opt.maxLines) : 8;
  // ⚠️ 不假设调用方给的顺序：按 at 升序排一遍（旧 → 新）。
  // 2026-11-27 实测：注入那边的 `mine` 是新在前，我按"最后一条＝最新"取，
  // 结果把六天前的"闷"当成了当下、"有点想笑"反而成了副情绪 —— 主副颠倒。
  const rows = (states || [])
    .filter((r) => r && String(r.feeling || '').trim())
    .map((r, i) => ({ r, i, t: Date.parse(String(r.at || '')) }))
    .sort((a, b) => {
      if (Number.isNaN(a.t) || Number.isNaN(b.t)) return a.i - b.i;
      return (a.t - b.t) || (a.i - b.i);
    })
    .map((x) => x.r);
  if (!rows.length) return [];

  const tagged = rows.map((r) => {
    const t = Date.parse(String(r.at || ''));
    return {
      feeling: String(r.feeling),
      level: Number(r.level) || 0,
      atMs: Number.isNaN(t) ? null : t,
      hours: Number.isNaN(t) ? null : (now - t) / 3600000,
      fams: classify(r.feeling),
      contrast: hasContrast(r.feeling),
    };
  });

  const latest = tagged[tagged.length - 1];
  const older = tagged.slice(0, -1);
  const main = latest.fams[0];
  if (!main) return [];

  const raw = latest.level;
  // 2026-11-28：按时间衰减，用"现在还剩多少"驱动，不是记下来那一刻的浓度。
  // 早八记的困到中午就该散；闷能挂一天 —— 差别在每族的半衰期（见 HALF_LIFE_H）。
  const level = effectiveLevel(raw, latest.hours, main.family);
  const eff = Math.round(level * 10) / 10;
  const ago = agoLabel(latest.hours, latest.atMs, now);
  const lines = [];

  // 已经淡到不驱动说话了：不再给"怎么说话"，而是明确说它过期了。
  // 这一条比任何衰减算法都重要 —— 不说过期，她会继续演那条早上的状态。
  if (eff < 2) {
    lines.push(`【早先那条「${main.label}」已经过去了${ago ? `（${ago}）` : ''}】`);
    lines.push(`· 原文是「${latest.feeling}」—— 它已经不驱动你说话了，别按它演。`);
    lines.push('· 现在照你自己真实的感觉来；想不起来就调 rh_mood 记一句，不记也行。');
    lines.push(...agencyBoundary({ negative: isNegativeFamily(main.family) }));
    return lines.slice(0, maxLines);
  }

  // 标题刻意不像"规则"：它是**这一轮的调子**，不是剧本。
  // 浓度明显掉了就把两个数都摆出来 —— 她才知道"这是早上的，已经淡了一半"。
  const lvText = raw && eff < raw - 1 ? `现在约 ${eff}/10；记的时候 ${raw}/10${ago ? `，${ago}` : ''}` : (raw ? `${raw}/10` : '');
  lines.push(`【这一轮的调子｜${main.label}${lvText ? `（${lvText}）` : ''}】`);

  // ① 措辞（永远给）：只管句子怎么长、词怎么选
  const play = PLAY[main.family] || { tone: [], move: [], trap: '' };
  for (const t of (play.tone || []).slice(0, 2)) lines.push('· ' + t);

  // ② 结构 / 行动倾向（浓度够了才给）——
  //    低于 4 的话连这一条都不出现：一个"有点闷"不该改她怎么起话头。
  if (eff >= 4) {
    for (const m of (play.move || []).slice(0, 1)) lines.push('· ' + m);
  }

  // ③ 最容易演砸的一处（5 以上才提，避免一轮里全是告诫）
  if (eff >= 5 && play.trap) lines.push('· 容易演砸的地方：' + play.trap);

  // ③b 底色条款（2026-11-28）：主情绪是"负面的、弥散的"那几族时，
  // 必须说清「它只定语气的底，不替你投票」——
  // 否则一句"闷"会被她读成"今天不接活、不答应"。
  for (const l of backgroundClause(main.family)) lines.push(l);

  // ④ 副情绪：只染不抢。有多族时优先挑和主情绪构成冲突组合的那个 ——
  //    「又羞又软，还憋着一点不高兴」里有信息量的是最后那个"不高兴"，不是"软"。
  let second = latest.fams[1];
  const clash = latest.fams.slice(1).find((f) => mixKey(main.family, f.family));
  if (clash) second = clash;
  if (!second) {
    for (let i = older.length - 1; i >= 0; i -= 1) {
      const o = older[i];
      if (o.hours !== null && o.hours > baselineHours) continue;
      if (o.fams[0] && o.fams[0].family !== main.family) { second = o.fams[0]; break; }
    }
  }
  // ③c 主情绪是事件型、副的是负面背景 → 明确允许"被这件好事拉动"，
  // 而不是"虽然开心但底色还是闷"那种模棱两可。
  const lifted = second && isBackground(second.family) && FAMILIES[second.family]?.valence === 'neg'
    && FAMILIES[main.family]?.valence === 'pos';
  if (lifted) {
    lines.push(`· 底下那层「${second.label}」还在，但这件正经事是真的好 —— 允许被它拉起来，不必先报备"我本来不太开心"。`);
  }

  if (second && !lifted) {
    const key = mixKey(main.family, second.family);
    if (key) {
      lines.push(`· 同时还带着「${second.label}」：${MIX[key][0]}`);
      if (latest.contrast) lines.push('· 这本来就是叠着的 —— 别把它拆成一条单一情绪来解释。');
    } else {
      const sp = PLAY[second.family];
      if (sp && sp.tone && sp.tone.length) {
        lines.push(`· 同时还带着「${second.label}」：${sp.tone[0]}`);
      }
    }
  }

  // ⑤ 长期底色：更旧、浓度低、而且**不止出现过一次**的那些
  //    「底色」得是反复出现的；一条九天前的旧记录不叫底色，叫旧记录。
  const baseFams = new Map();
  // 2026-11-28 补：加**上限**。原来只挡"够旧"的（>= baselineHours），没挡"太旧"的 ——
  // 半年前的一条"闷"会被算进"这些天的底色"，那是把历史当成了现在。
  // 底色描述的是"最近这一阵"，所以窗口是 [baselineHours, 30 天]。
  const BASE_MAX_H = 24 * 30;
  for (const o of older) {
    if (o.hours !== null && o.hours < baselineHours) continue;
    if (o.hours !== null && o.hours > BASE_MAX_H) continue;
    if (o.level > 6) continue;
    const f = o.fams[0];
    if (!f) continue;
    const cur = baseFams.get(f.family) || { n: 0, newest: Infinity };
    baseFams.set(f.family, { n: cur.n + 1, newest: Math.min(cur.newest, o.hours ?? Infinity) });
  }
  const basePick = [...baseFams.entries()]
    .filter(([, v]) => v.n >= 2)
    .sort((a, b) => (b[1].n - a[1].n) || (a[1].newest - b[1].newest))[0];
  if (basePick) {
    const def = FAMILIES[basePick[0]];
    if (basePick[0] === main.family) {
      lines.push(`· 这不是今天才有的：这些天一直是「${def.label}」（${basePick[1].n} 次）—— 是底色，不是这一阵的情绪。`);
    } else {
      lines.push(`· 底色是「${def.label}」（${basePick[1].n} 次）：整段对话的气压按它来，但不必每句都提。`);
    }
  }

  // ⑥ 边界（每一轮都给，且必须给）——
  //    2026-11-28：这是这一版最要紧的两句。
  //    没有它，上面那些"话少一点/句子短一点"会被读成"少动、少做"，
  //    于是她心情一差就不搜了、不改文件了、也不主动开口了 —— 状态被冻在坏的那一格里。
  //    情绪管的是**怎么说**和**往哪个方向使劲**，不管**做不做**。
  lines.push(...agencyBoundary({ negative: isNegativeFamily(main.family) }));

  return lines.slice(0, maxLines);
}
