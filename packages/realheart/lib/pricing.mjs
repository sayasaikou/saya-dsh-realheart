/**
 * 内置价目表（2026-11-14 录入）。
 *
 * 为什么要内置：「最便宜的模型」得有个价格依据。让模型每次去网上查一次价格，
 * 又慢又容易查到过时的数 —— 所以价格落成数据，随包发出去，运行时一次网络请求都不用。
 *
 * 记录里的 `price` 字段可以覆盖这里的值（各家账号的折扣、自己谈的价，以记录为准）。
 * 表里没有的模型 → 当「未知」，排序时排在已知价格之后、且提示用户补 price。
 *
 * 单位：
 *   per_image     每张图（元）
 *   per_second    每秒视频（元）—— 只有官方给了每秒折算的才写，token 计价的按典型分辨率折算
 *   per_1k_tokens 每千 token（元）
 *   per_1k_chars  每千字符（元）—— 语音合成按字符计价，汉字通常算 2 字符
 *   per_minute    每分钟（元）—— 语音识别、按分钟的接口
 *   per_song      每首（元）—— 音乐生成
 *   per_call      每次（元）—— 按次计价的接口
 *
 * ⚠️ 2026-11-22：加后三种是因为 TTS / 音乐 / ASR 进来了。原来只有三种单位，
 * 语音那条只能硬塞成 per_1k_tokens —— 数字照抄、单位错档，比价结果全是假的。
 */
export const PRICING_ASOF = '2026-11-14';

export const PRICING = {
  // ── 生图（元/张）──
  'doubao-seedream-5-5-261028': { unit: 'per_image', value: 0.3, note: '5.5 按 5.0-pro 档估', src: 'ark model detail' },
  'doubao-seedream-5-0-pro-260628': { unit: 'per_image', value: 0.3, note: '1K 0.3 / 2K 0.6', src: 'ark model detail' },
  'doubao-seedream-5-0-flash-260915': { unit: 'per_image', value: 0.12, note: '输入图首张免费', src: 'ark model detail' },
  'doubao-seedream-5-0-260128': { unit: 'per_image', value: 0.22, note: '5.0 lite 档', src: 'ark 积分说明' },
  'doubao-seedream-4-5-251128': { unit: 'per_image', value: 0.25, src: 'ark 积分说明' },
  'doubao-seedream-4-0-20260415': { unit: 'per_image', value: 0.2, note: '旧版，按档估', src: 'ark 积分说明' },
  'doubao-seedream-4-0-250828': { unit: 'per_image', value: 0.2, note: '旧版，按档估', src: 'ark 积分说明' },

  // ── 生视频（元/秒，按 720P 折算）──
  // Seedance 2.5 官方是 token 计价：70 元/百万 token（不含视频输入），
  // Token =（输入时长+输出时长）×宽×高×帧率÷1024，24fps。720P 折算约 1.51 元/秒。
  'doubao-seedance-2-5-260628': { unit: 'per_second', value: 1.51, note: '70 元/百万 token 折算 720P', src: 'ark 价格页' },
  'doubao-seedance-2-0-260128': { unit: 'per_second', value: 1.05, note: '按 2.0 档 720P 估', src: 'ark 价格页' },
  'doubao-seedance-2-0-fast-260128': { unit: 'per_second', value: 0.7, note: '按 fast 档估', src: 'ark 价格页' },
  'doubao-seedance-2-0-mini-260615': { unit: 'per_second', value: 0.5, note: '按 mini 档估', src: 'ark 价格页' },
  'doubao-seedance-1-0-pro-250528': { unit: 'per_second', value: 0.6, note: '旧版', src: 'ark 价格页' },
  'doubao-seedance-1-0-pro-fast-251015': { unit: 'per_second', value: 0.4, note: '旧版 fast', src: 'ark 价格页' },
  'doubao-seedance-1-0-lite-t2v-250428': { unit: 'per_second', value: 0.3, note: '旧版 lite', src: 'ark 价格页' },
  'doubao-seedance-1-0-lite-i2v-250428': { unit: 'per_second', value: 0.3, note: '旧版 lite', src: 'ark 价格页' },

  // ── 文本 / 视觉（元/千 token，粗估）──
  'doubao-seed-2-1-pro-260915': { unit: 'per_1k_tokens', value: 0.004, note: '视觉同价，按文本档估', src: 'ark 价格页' },
  'doubao-seed-2-1-lite-260915': { unit: 'per_1k_tokens', value: 0.0008, src: 'ark 价格页' },
  'doubao-seed-2-1-turbo-260628': { unit: 'per_1k_tokens', value: 0.0004, src: 'ark 价格页' },
  'deepseek-v4-1-flash-260910': { unit: 'per_1k_tokens', value: 0.0005, src: 'ark 价格页' },
};

/** 一条记录的价格：记录自己写的优先，其次内置表。都没有 → null（未知）。
 *  2026-11-22：currency 要透传 —— 可灵按美元计价，丢掉币种就会把它显示成「元/秒」。 */
export function priceOf(rec) {
  if (rec && rec.price && Number.isFinite(Number(rec.price.value))) {
    const out = { unit: String(rec.price.unit || 'per_image'), value: Number(rec.price.value), src: 'record' };
    if (rec.price.currency) out.currency = String(rec.price.currency);
    return out;
  }
  const p = PRICING[String(rec && rec.model || '')];
  return p ? { ...p } : null;
}

/**
 * 估算「这一次」要花多少（元）。跨单位可比 —— 这才是「最便宜」的正确比法。
 * 估不出来返回 null。
 */
export function estimateCost(rec, params = {}) {
  const p = priceOf(rec);
  if (!p) return null;
  const v = Number(p.value);
  if (!Number.isFinite(v)) return null;
  if (v === 0) return 0;
  if (p.unit === 'per_image') {
    const n = Number(params.n || params.count || 1);
    return v * (Number.isFinite(n) && n > 0 ? n : 1);
  }
  if (p.unit === 'per_second') {
    const d = Number(params.duration || params.seconds || (rec.defaults && rec.defaults.duration) || 5);
    return v * (Number.isFinite(d) && d > 0 ? d : 5);
  }
  if (p.unit === 'per_1m_tokens') {
    // 官方常按「每百万 token」报价，照原样存，换算只在这一处做
    const t = Number(params.tokens || 2000);
    return (v * (Number.isFinite(t) && t > 0 ? t : 2000)) / 1000000;
  }
  if (p.unit === 'per_1k_tokens') {
    const t = Number(params.tokens || 2000);
    return (v * (Number.isFinite(t) && t > 0 ? t : 2000)) / 1000;
  }
  if (p.unit === 'per_1k_chars') {
    // 默认按「一次 300 字」估 —— 一条语音消息的量级
    const c = Number(params.chars || params.textLength || 300);
    return (v * (Number.isFinite(c) && c > 0 ? c : 300)) / 1000;
  }
  if (p.unit === 'per_minute') {
    const m = Number(params.minutes || params.duration || 1);
    return v * (Number.isFinite(m) && m > 0 ? m : 1);
  }
  if (p.unit === 'per_song' || p.unit === 'per_call' || p.unit === 'per_video') {
    const n = Number(params.count || params.n || 1);
    return v * (Number.isFinite(n) && n > 0 ? n : 1);
  }
  return null;
}

/** 给面板/工具看的价目摘要 */
export function pricingTable(models) {
  const list = models && models.length ? models : Object.keys(PRICING);
  return list.map((m) => {
    const p = PRICING[m];
    return p
      ? { model: m, unit: p.unit, value: p.value, note: p.note || '', src: p.src || '', asOf: PRICING_ASOF }
      : { model: m, unit: '', value: null, note: '没录入价格 —— 在记录里写 price 字段', src: '', asOf: PRICING_ASOF };
  });
}
