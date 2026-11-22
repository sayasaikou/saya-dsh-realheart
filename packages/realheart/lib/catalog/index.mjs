/**
 * 型号目录：知道「这个厂商的这个型号该怎么调」的内置知识（2026-11-22 拆成目录）。
 *
 * 为什么要有这一层：
 *   在此之前，一条能力记录要人手写完 id / endpoint / model / defaults / notes。
 *   新用户手上只有一把 key —— 他不知道该填什么端点、参数叫什么、尺寸档位怎么选。
 *   于是「外部能力」这个功能等于只有作者会用。
 *
 * 这一层的职责：**选型号就带出整套规范**。
 *   厂商 → 型号 → { 调用形态、端点、参数表、输入输出格式、硬限制、计费、官方文档、踩过的坑 }
 *
 * 为什么拆文件（2026-11-22）：原来一个 catalog.mjs 里每加一个厂商就要往下滚 60 行，
 * 图片/视频/语音/音乐/文本混在一起，改图片的价会在视频那几行里找半天。
 * 现在按能力拆开，厂商公共信息（key 放哪、文档在哪、认证头怎么带）收在 vendors.mjs 一份。
 *
 * 收录原则（重要）：
 *   - **只收对得上官方文档的。**（火山那几条另外亲手跑通过）
 *   - 不确定的一律不写进正文，塞进 unverified —— agent 照着编出来的规范去调，比起没有更糟。
 *   - 用户自己加的型号另存（capabilities.json），不跟这里混。
 */
import { VENDORS } from './vendors.mjs';
import { IMAGE_MODELS } from './image.mjs';
import { VIDEO_MODELS } from './video.mjs';
import { AUDIO_MODELS } from './audio.mjs';
import { MUSIC_MODELS } from './music.mjs';
import { LLM_MODELS } from './llm.mjs';

/** 摊平的型号表（顺序＝展示顺序：先图、再视频、再语音、再音乐、最后文本） */
const ALL_MODELS = [
  ...IMAGE_MODELS,
  ...VIDEO_MODELS,
  ...AUDIO_MODELS,
  ...MUSIC_MODELS,
  ...LLM_MODELS,
];

/** 按 vendor 分组后的老形状（保持 CATALOG 的对外语义不变） */
function groupByVendor(models) {
  const order = Object.keys(VENDORS);
  const buckets = new Map();
  for (const m of models) {
    if (!VENDORS[m.vendor]) {
      // 写错 vendor 名字等于这条永远装不上 —— 宁可当场炸，也别静默丢一条
      throw new Error(`型号目录里 vendor 没登记：${m.vendor}（${m.model || m.name || '?'}）`);
    }
    if (!buckets.has(m.vendor)) buckets.set(m.vendor, []);
    buckets.get(m.vendor).push(m);
  }
  const out = [];
  for (const v of order) {
    const list = buckets.get(v);
    if (!list || !list.length) continue;
    const meta = VENDORS[v];
    out.push({
      vendor: meta.vendor,
      vendorName: meta.vendorName,
      keyEnv: meta.keyEnv,
      keySecretEnv: meta.keySecretEnv,
      keyNote: meta.keyNote,
      doc: meta.doc,
      auth: meta.auth,
      models: list,
    });
  }
  return out;
}

export const CATALOG = groupByVendor(ALL_MODELS);

/** 把所有型号摊平，方便按 id 找 */
export function flattenCatalog() {
  const out = [];
  for (const v of CATALOG) {
    for (const m of v.models) {
      out.push({
        ...m,
        vendor: v.vendor,
        vendorName: v.vendorName,
        keyEnv: v.keyEnv,
        keySecretEnv: v.keySecretEnv,
        keyNote: v.keyNote,
        vendorDoc: v.doc,
        auth: v.auth,
        doc: m.docs || v.doc,
        catalogId: v.vendor + '/' + m.model,
      });
    }
  }
  return out;
}

/** 按 catalogId（vendor/model）或光秃秃的 model 找一条 */
export function findCatalogModel(needle) {
  const n = String(needle || '').trim();
  if (!n) return null;
  const all = flattenCatalog();
  return all.find((x) => x.catalogId === n)
    || all.find((x) => x.model === n)
    || all.find((x) => x.model.toLowerCase() === n.toLowerCase())
    || null;
}

/** 一条记录的默认 id：厂商 + 型号 */
export function catalogRecordId(entry) {
  return entry.vendor + '-' + String(entry.model).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

/** 把 limits 摊成给人看的一行（agent 判断「塞不塞得下」用） */
export function limitsLine(limits) {
  if (!limits || typeof limits !== 'object') return '';
  const parts = [];
  const push = (label, v, unit = '') => {
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v)) {
      if (!v.length) return;
      parts.push(label + ' ' + v.join(' / '));
      return;
    }
    if (typeof v === 'object') return;
    parts.push(label + ' ' + v + unit);
  };
  if (limits.promptMax != null) push('提示词 ≤', limits.promptMax, ' 字');
  if (limits.textMax != null) push('文本 ≤', limits.textMax, ' 字符');
  if (limits.contextTokens != null) push('上下文', limits.contextTokens, ' tokens');
  if (limits.maxOutput != null) push('单次输出 ≤', limits.maxOutput);
  if (limits.refImagesMax != null) push('参考图 ≤', limits.refImagesMax, ' 张');
  if (limits.maxImagesPerCall != null) push('单次最多', limits.maxImagesPerCall, ' 张');
  if (limits.sizes && limits.sizes.length) push('尺寸', limits.sizes);
  if (limits.resolutions && limits.resolutions.length) push('分辨率', limits.resolutions);
  if (limits.ratios && limits.ratios.length) push('比例', limits.ratios);
  if (limits.durationMin != null || limits.durationMax != null) {
    const a = limits.durationMin;
    const b = limits.durationMax;
    parts.push('时长 ' + (a != null && b != null ? a + '~' + b : (b != null ? '≤' + b : '≥' + a)) + ' 秒'
      + (limits.durationAuto != null ? '（' + limits.durationAuto + ' = 自动）' : ''));
  }
  if (limits.fps) push('帧率', Array.isArray(limits.fps) ? limits.fps.join('~') : limits.fps, ' fps');
  if (limits.sidePx) push('宽高各', limits.sidePx.join('~'), ' px');
  if (limits.fileSizeMaxMB != null) push('文件 ≤', limits.fileSizeMaxMB, ' MB');
  return parts.join(' ｜ ');
}

/**
 * 把目录条目 + 用户给的 key 变成一条可直接用的能力记录。
 *
 * 2026-11-22：notes 只留「怎么写提示词 + 踩过的坑」。
 * 「怎么传 / 输入输出 / 硬限制 / 文档」各自有结构化字段，由工具那边单独渲染 ——
 * 全塞进 notes 会变成一坨长文本，agent 读到第三行就丢了重点。
 */
export function buildRecordFromCatalog(entry, { id, keyRef, extra = {} } = {}) {
  if (!entry) throw new Error('没有这个型号');
  const hint = [];
  if (entry.promptGuide?.length) hint.push('【怎么写提示词】' + entry.promptGuide.join(' '));
  if (entry.pitfalls?.length) hint.push('【踩过的坑】' + entry.pitfalls.join(' '));

  const vendorAuth = entry.auth || { type: 'bearer' };
  let auth;
  if (vendorAuth.type === 'kling-jwt') {
    // 可灵的 JWT 要一对 key，凭据写法不一样，不能套 bearer
    const akRef = keyRef || ('env:' + entry.keyEnv);
    const skRef = akRef.startsWith('env:')
      ? 'env:' + (entry.keySecretEnv || 'KLING_SECRET_KEY')
      : akRef.replace(/access/i, 'secret');
    auth = { type: 'kling-jwt', keyRef: akRef, secretRef: skRef };
  } else if (vendorAuth.type === 'header') {
    auth = { type: 'header', headerName: vendorAuth.headerName || 'x-api-key', keyRef: keyRef || ('env:' + entry.keyEnv) };
  } else {
    auth = { type: 'bearer', keyRef: keyRef || ('env:' + entry.keyEnv) };
  }

  const rec = {
    id: id || entry.recordId || catalogRecordId(entry),
    name: entry.name || entry.model,
    cap: entry.cap,
    form: entry.form,
    model: entry.model,
    endpoint: entry.endpoint,
    auth,
    defaults: entry.defaults || {},
    // 规格（agent 直接要的东西）
    input: entry.input || '',
    output: entry.output || '',
    limits: entry.limits || null,
    docs: entry.doc || entry.docs || '',
    priceNote: entry.priceNote || '',
    asOf: entry.asOf || '',
    unverified: entry.unverified || [],
    blocked: entry.blocked || '',
    // 参数表：paramHints 拿它生成「能传什么」，比从模板里反推准
    paramSpec: entry.params || {},
    notes: hint.join('\n'),
    source: { vendor: entry.vendor, model: entry.model, catalog: entry.catalogId, doc: entry.doc || entry.docs || '' },
  };
  for (const k of [
    'submitBody', 'bodyTemplate', 'bodyExtra', 'method', 'extraHeaders',
    'resultPath', 'resultB64Path', 'resultHexPath', 'fileUrlPath', 'fileB64Path',
    'taskIdPath', 'statePath', 'doneWhen', 'failWhen', 'pollEndpoint', 'pollMs', 'pollMethod',
    'followUp', 'modelInBody', 'pollUrlPath', 'bodyType',
    'responseType', 'fileExt', 'price', 'free', 'enabled', 'blocked', 'transport',
  ]) {
    if (entry[k] !== undefined) rec[k] = entry[k];
  }
  return { ...rec, ...extra };
}
