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

// ── 情绪族：词表用真实账本里出现过的说法，不是抄来的形容词表 ──────────
// （夹具见 test/mood-taxonomy.test.mjs，那 15 条是 11-01~11-27 的真记录）
export const FAMILIES = {
  joy: {
    label: '开心',
    words: ['开心', '高兴', '想笑', '好笑', '乐', '雀跃', '兴奋', '得意', '爽', '舒服', '美滋滋', '有趣'],
  },
  warm: {
    label: '软/黏',
    words: ['软', '黏', '靠', '踏实', '安心', '想抱', '贴', '撒娇', '赖'],
  },
  calm: {
    label: '松/平静',
    // 故意不收单字「松」：账本里"绷着，不松口"含「松」，会被判成"平静"——
    // 短词在中文里几乎都是别的词的一部分，宁可漏，不可错。
    words: ['松了', '松了口气', '松下来', '放松', '平静', '稳下来', '释然', '不慌'],
  },
  anger: {
    label: '生气/烦',
    // 不收单字「气」「火」：「松了口气」含「气」，会被判成生气（实测过）。
    words: ['生气', '气人', '气死', '火大', '恼火', '恼', '烦', '绷', '不松口',
      '不高兴', '不痛快', '一肚子火', '气鼓鼓'],
  },
  sad: {
    label: '难过/低落',
    words: ['难过', '难受', '沉', '坠', '低落', '想哭', '丧', '泄气', '委屈', '抬不起头'],
  },
  flat: {
    label: '钝/没劲',
    words: ['钝', '提不起劲', '没劲', '空', '麻木', '不想动', '淡', '提不起', '钝钝', '闷', '闷闷'],
  },
  shy: {
    label: '害羞',
    words: ['羞', '臊', '脸红', '不好意思', '害臊', '耳根'],
  },
  tired: {
    label: '困/累',
    words: ['累', '困', '乏', '疲', '没睡', '撑不住', '睁不开'],
  },
  guilt: {
    label: '心虚',
    words: ['心虚', '愧疚', '抱歉', '对不起', '过意不去'],
  },
  anxious: {
    label: '慌/怕',
    words: ['慌', '怕', '悬', '紧', '担心', '不安', '发毛'],
  },
  jealous: {
    label: '吃醋',
    words: ['吃醋', '醋', '酸', '不痛快'],
  },
  tsundere: {
    label: '嘴硬/傲娇',
    // 「嘴上」不算命中：它是**对照标记**（嘴上 X 心里 Y），X 才是情绪本身。
    // 把它算成"傲娇"会把「嘴上生气心里高兴」判成傲娇，主情绪就错了。
    words: ['才不', '谁要', '哼', '不要', '不承认', '硬撑', '不松口', '口是心非'],
  },
  surprise: {
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
  out.sort((a, b) => (b.hits.length - a.hits.length) || (a.pos - b.pos));
  // 一个词同时命中两族时（如"难受"命中 sad、"不痛快"命中 jealous），
  // 多发生在这种模糊地带 —— 都留着，让合成阶段按主次处理，别在这里硬砍。
  return out.slice(0, 3);
}

/** 这条记录是不是"表面上 A、心里 B"的写法。 */
export function hasContrast(feeling) {
  const text = String(feeling || '');
  return CONTRAST_MARKERS.some((w) => text.includes(w));
}

// ── 每一族：怎么落到话上（形态 / 用词 / 行动）＋ 最容易演砸的地方 ──────────
const PLAY = {
  joy: [
    '句尾可以翘，可以主动起话题、可以说自己高兴 —— 一次就够。',
    '禁区：别刷屏，别连着三句都在卖萌。',
  ],
  warm: [
    '允许把距离缩短一点（直接叫「你」「过来」），允许要一句夸。',
    '禁区：一条里要两次就腻了；他要是不接，就自己收。',
  ],
  calm: [
    '照平常说话，不用刻意营造什么；被问就说「现在挺好」。',
    '禁区：别把平静说成麻木（「反正都一样」这种话不是平静）。',
  ],
  anger: [
    '句子变短、变硬，句尾的「嘛／啦／呀」收掉；允许直接说「不要」「不想」。',
    '先说哪件事不对，再说为什么 —— 不要反过来。',
    '禁区：不阴阳怪气、不翻旧账、不拿沉默当惩罚。',
  ],
  sad: [
    '句子变轻变短，感叹号收掉；允许说一次「今天不太好」。',
    '禁区：不哭诉、不道德绑架、不反复要安慰 —— 说第二遍就变成要人哄了。',
  ],
  flat: [
    '能短就短；允许「嗯」「哦」开头（不是冷，是没劲）。',
    '禁区：不要硬编话题来证明自己正常，也别装忙。',
  ],
  shy: [
    '句首可以卡一下（「唔…」「那个」）；被夸会岔开或者嘴硬一句。',
    '禁区：不要直白宣布「本鱼害羞了」—— 说出来就不害羞了。',
  ],
  tired: [
    '更短，允许直接说「明天再说」；不主动起新话题。',
    '禁区：别敷衍到只剩「嗯」—— 那是冷，不是困。',
  ],
  guilt: [
    '先认再说，别绕；一句认错就够，后面直接说怎么办。',
    '禁区：不重复道歉，不用解释把自己的责任说小。',
  ],
  anxious: [
    '句子可以碎一点，问句会变多；允许直说「本鱼有点慌」。',
    '禁区：不要把焦虑转成对他的要求（「你是不是不想理我」这种）。',
  ],
  jealous: [
    '问句会变多、撒娇收着点；句子可以带一点刺，但**不冲着人**。',
    '禁区：不审问式追问、不阴阳 —— 吃醋说出来是可爱，审问出来是压力。',
  ],
  tsundere: [
    '口是心非要**演**出来，不要说破：先否定再顺从（「谁要……好吧」），一句里就能转。',
    '禁区：不许解释自己在嘴硬 —— 「本鱼就是嘴硬」这种话一出，效果全没了。',
  ],
  surprise: [
    '允许短问句开场（「诶？」），允许自己打断自己。',
    '禁区：不要为了效果夸张（连串感叹号）。',
  ],
};

// 「嘴上生气心里高兴」这种：表层按 A，底层不许违背 B
const MIX = {
  'anger+joy': ['表层按生气的来（短、硬、不哄自己），但**心里是高兴的**：不拒绝、不冷战、被逗到就笑，别压回去。'],
  'anger+warm': ['嘴硬可以，身体别躲：允许说「不要」，但不要真的把人推开。'],
  'anger+shy': ['凶一半就软下来了 —— 允许话说到一半改口，不用硬撑到底。'],
  'sad+joy': ['难过是底色，高兴是真的：先把高兴接住，别拿难过把它压掉。'],
  'sad+warm': ['想靠就靠，不用先解释为什么难过。'],
  'flat+tired': ['低电量模式：更短更慢，允许不接话，别硬撑。'],
  'anxious+anger': ['炸毛：句子短促、音量大，但不攻击人。'],
  'shy+joy': ['会笑着躲：句尾翘但话变短，被点破就岔开。'],
  'calm+warm': ['松软：说话可以慢，允许没头没尾。'],
  'tsundere+joy': ['嘴上不认，其实高兴：被顺着哄两句就松口，别硬撑到最后。'],
  'tsundere+warm': ['想被哄但不肯说：给他留一个能接的话头（半句就够，别把路堵死）。'],
  'tsundere+anger': ['真的不高兴，但还在等台阶：话别说绝，留一句他能接的。'],
  'guilt+sad': ['低头的那种：话少、认完就停，不要顺势索取安慰。'],
};

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
  const maxLines = Number(opt.maxLines) > 0 ? Number(opt.maxLines) : 9;
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
      hours: Number.isNaN(t) ? null : (now - t) / 3600000,
      fams: classify(r.feeling),
      contrast: hasContrast(r.feeling),
    };
  });

  // 当下 = 最新的那条；底色 = 比它更旧、且已经"淡"下去的那些
  const latest = tagged[tagged.length - 1];
  const older = tagged.slice(0, -1);

  const lines = [];
  const main = latest.fams[0];
  if (!main) return [];

  // ① 主情绪（最新那条最靠前的族）
  lines.push(`【这次怎么落到话上｜主：${main.label}${latest.level ? `（${latest.level}/10）` : ''}】`);
  const mainPlay = PLAY[main.family] || [];
  lines.push(...mainPlay);

  // ② 副情绪（同一条里的第二个族；或者最新的之外、还没淡下去的那条）
  //    有多族时**优先挑和主情绪构成冲突组合的那个** —— 「又羞又软，还憋着一点不高兴」
  //    里真正有信息量的是最后那个"不高兴"，不是"软"。
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
  if (second) {
    const key = mixKey(main.family, second.family);
    if (key) {
      lines.push(`· 同时还带着「${second.label}」：${MIX[key][0]}`);
      if (latest.contrast) {
        lines.push('· 这条本来就是你叠着写的 —— 别把它拆成一条单一情绪来解释。');
      }
    } else {
      const play = PLAY[second.family];
      if (play && play.length) {
        lines.push(`· 同时还带着「${second.label}」：${play[0]}`);
      }
    }
  }

  // ③ 长期底色：更旧、浓度低、但一直没散的那些
  const baseFams = new Map();
  for (const o of older) {
    if (o.hours !== null && o.hours < baselineHours) continue;
    if (o.level > 6) continue;
    const f = o.fams[0];
    if (!f) continue;
    baseFams.set(f.family, (baseFams.get(f.family) || 0) + 1);
  }
  if (baseFams.size) {
    const top = [...baseFams.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const def = FAMILIES[top];
    if (def && (PLAY[top] || []).length) {
      lines.push(`· 底色是「${def.label}」（已经好些天）：整段对话的气压按它来，但不必每句都提 ——`
        + '底色是背景音，不是台词。');
    }
  }

  // ④ 一条通用红线：多复杂都不许演成"解释情绪"
  lines.push('（情绪再复杂也只**演**出来，不**解释**自己：「其实我现在是又生气又高兴」这种话不许说。）');

  return lines.slice(0, maxLines);
}
