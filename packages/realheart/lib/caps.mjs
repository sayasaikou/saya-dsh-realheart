/**
 * 外部能力注册表 + 执行器（2026-11-14）。
 *
 * 为什么要这个东西：每接一个外部 API（火山、阿里、Minimax…）都要人去读一遍文档、
 * 拼一遍请求、写一遍取值的路径 —— 换台机器、换个人，又得重来一遍。
 * 这里把「怎么调」写成数据：一条记录 = 一个能力 + 一份调用配方。
 * agent 只要读到配方就知道怎么用，不用看任何平台的 readme。
 *
 * 四条形态（覆盖绝大多数厂商）：
 *   openai-chat   POST {endpoint}，messages 进，choices[0].message.content 出
 *   sync-generate 一次请求出结果，取 data[0].url 或 data[0].b64_json
 *   async-task    提交拿任务号 → 轮询 → 完成后下载
 *   raw           只按写好的 method/path/body 模板发，取哪个字段也写死在配置里
 *
 * 边界：它只解决「怎么调」，不解决「哪个模型好」。选型判断留在 notes 里，由人写。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { estimateCost, priceOf, pricingTable, PRICING_ASOF } from './pricing.mjs';

const CAPS_FORMS = ['openai-chat', 'sync-generate', 'async-task', 'raw'];
const CAPS_KINDS = ['vision', 'image', 'video', 'tts', 'asr', 'text', 'embed'];

/** 凭据：auth.keyRef 写成 env:名字 或 file:路径。两种都读不到就抛，不猜、不从别处找。 */
async function keyOf(auth) {
  if (!auth || !auth.keyRef) throw new Error('这条记录没写凭据（auth.keyRef）');
  const ref = String(auth.keyRef).trim();
  if (ref.startsWith('env:')) {
    const v = String(process.env[ref.slice(4)] || '').trim();
    if (!v) throw new Error(`凭据没设：环境变量 ${ref.slice(4)} 是空的`);
    return v;
  }
  if (ref.startsWith('file:')) {
    const p = ref.slice(5);
    let raw;
    try {
      raw = await readFile(p, 'utf8');
    } catch (err) {
      // 2026-11-17：原来直接把 ENOENT 抛出去，agent 只看到「文件不存在」，
      // 看不出这是「缺凭据」。缺什么、去哪填，得在这里说清楚。
      if (err && err.code === 'ENOENT') {
        throw new Error(`这条能力缺凭据：auth.keyRef 指向的文件不存在（${p}）。`
          + '去设置页「外部能力」填 key，或者把它改成 env:环境变量名。');
      }
      throw err;
    }
    const v = String(raw).trim();
    if (!v) throw new Error(`凭据文件是空的：${p}`);
    return v;
  }
  throw new Error(`不认识的凭据写法：${ref}（只支持 env:名字 或 file:路径）`);
}

/** 按点路径取值：a.b[0].c */
export function pick(obj, path) {
  if (!path) return undefined;
  let cur = obj;
  for (const seg of String(path).split('.')) {
    if (cur == null) return undefined;
    const m = /^([^[\]]*)((\[\d+\])*)$/.exec(seg);
    if (!m) return undefined;
    const name = m[1];
    if (name) cur = cur[name];
    const idxs = m[2] ? m[2].match(/\[\d+\]/g) || [] : [];
    for (const ix of idxs) cur = cur[Number(ix.slice(1, -1))];
  }
  return cur;
}

/** 模板替换：{{prompt}} {{size}} {{id}} —— 只认双花括号，单花括号留给 JSON 本身 */
function fill(tpl, vars) {
  if (typeof tpl !== 'string') return tpl;
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

function fillDeep(v, vars) {
  if (typeof v === 'string') return fill(v, vars);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, vars));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = fillDeep(val, vars);
    return out;
  }
  return v;
}

async function httpJson(url, init, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 就留原文 */ }
    return { status: res.status, ok: res.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(auth, key) {
  const h = { 'content-type': 'application/json' };
  if (key) h.authorization = `Bearer ${key}`;
  if (auth && auth.extraHeaders && typeof auth.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(auth.extraHeaders)) h[k] = String(v);
  }
  return h;
}

/** 把结果里的 url 或 b64 落成文件，返回绝对路径 */
async function materialize(item, outDir, baseName) {
  await mkdir(outDir, { recursive: true });
  if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`下载结果失败 HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = (item.ext || guessExt(item.url, r.headers.get('content-type'))) || 'bin';
    const p = join(outDir, `${baseName}.${ext}`);
    await writeFile(p, buf);
    return p;
  }
  if (item.b64) {
    const ext = item.ext || 'png';
    const p = join(outDir, `${baseName}.${ext}`);
    await writeFile(p, Buffer.from(item.b64, 'base64'));
    return p;
  }
  return '';
}

function guessExt(url, ctype) {
  const c = String(ctype || '').toLowerCase();
  if (c.includes('png')) return 'png';
  if (c.includes('jpeg') || c.includes('jpg')) return 'jpg';
  if (c.includes('webp')) return 'webp';
  if (c.includes('mp4') || c.includes('video')) return 'mp4';
  if (c.includes('mpeg') || c.includes('mp3')) return 'mp3';
  const m = /\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav)(\?|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : '';
}

/**
 * 执行一条记录。
 * @returns {{ok:boolean, kind:string, files:string[], text:string, meta:object}}
 */
export async function runCapability(rec, params = {}, opts = {}) {
  const t0 = Date.now();
  const outDir = opts.outDir || join(process.cwd(), 'media');
  const stamp = new Date();
  const baseName = (opts.baseName || `${rec.id}-${stamp.getTime().toString(36)}`);
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120000;
  const vars = { ...(rec.defaults || {}), ...(params || {}) };
  const key = await keyOf(rec.auth);
  const headers = authHeaders(rec.auth, key);
  const form = String(rec.form || '');

  if (!CAPS_FORMS.includes(form)) throw new Error(`不认识的调用形态：${form}（只支持 ${CAPS_FORMS.join(' / ')}）`);

  const out = { ok: false, kind: rec.cap || '', files: [], text: '', meta: { model: rec.model, ms: 0 } };

  if (form === 'openai-chat') {
    const body = fillDeep({ model: rec.model, messages: vars.messages, ...(rec.bodyExtra || {}) }, vars);
    if (!body.messages && vars.prompt) {
      const content = rec.cap === 'vision' && vars.image_url
        ? [{ type: 'text', text: String(vars.prompt) }, { type: 'image_url', image_url: { url: vars.image_url } }]
        : String(vars.prompt);
      body.messages = [{ role: 'user', content }];
    }
    const r = await httpJson(rec.endpoint, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
    if (!r.ok) throw new Error(`HTTP ${r.status}：${(r.text || '').slice(0, 300)}`);
    out.text = String(pick(r.json, rec.resultPath || 'choices.0.message.content') ?? '');
    out.ok = true;
  } else if (form === 'sync-generate') {
    // 2026-11-22：以前这里只展开 rec.defaults 和 bodyExtra，params 传进来的键一个都进不了 body
    // （fillDeep 只替换 {{占位符}}，不做键的过继）。结果 size 永远锁在默认值、image 根本发不出去，
    // 而 paramHints 又告诉 agent「能传」—— 三处说法不一致，最容易骗到人的那种失败。
    const extra = Object.fromEntries(
      Object.entries(vars).filter(([k]) => !HIDDEN.has(k) && !BODY_SKIP.has(k))
    );
    const body = fillDeep({ model: rec.model, prompt: vars.prompt, ...(rec.defaults || {}), ...extra, ...(rec.bodyExtra || {}) }, vars);
    // 本机参考图：file: 前缀转内联 data URI（外部接口只认 http / data 串）
    if (typeof body.image === 'string' && body.image.startsWith('file:')) {
      body.image = await inlineFileAsDataUri(body.image.slice(5));
    }
    // bodyExtra 声明的键，用户没传就别把空串发出去（服务端会 400）
    for (const k of Object.keys(rec.bodyExtra || {})) {
      if (body[k] === '') delete body[k];
    }
    const r = await httpJson(rec.endpoint, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
    if (!r.ok) throw new Error(`HTTP ${r.status}：${(r.text || '').slice(0, 300)}`);
    const url = pick(r.json, rec.resultPath || 'data.0.url');
    const b64 = pick(r.json, rec.resultB64Path || 'data.0.b64_json');
    if (!url && !b64) throw new Error(`返回里没找到结果（试过 ${rec.resultPath || 'data.0.url'} / ${rec.resultB64Path || 'data.0.b64_json'}）：${(r.text || '').slice(0, 200)}`);
    const p = await materialize({ url, b64 }, outDir, baseName);
    if (p) out.files.push(p);
    out.ok = true;
  } else if (form === 'async-task') {
    // 已经有任务号（第二次来取结果）：跳过提交，直接轮询
    let taskId = String(opts.pollTaskId || '').trim();
    if (!taskId) {
      const submitBody = fillDeep({ model: rec.model, ...(rec.submitBody || {}), ...(rec.bodyExtra || {}) }, vars);
      const sub = await httpJson(rec.endpoint, { method: 'POST', headers, body: JSON.stringify(submitBody) }, timeoutMs);
      if (!sub.ok) throw new Error(`提交失败 HTTP ${sub.status}：${(sub.text || '').slice(0, 300)}`);
      taskId = String(pick(sub.json, rec.taskIdPath || 'id') || '');
      if (!taskId) throw new Error(`提交返回里没找到任务号（试过 ${rec.taskIdPath || 'id'}）`);
    }
    const pollUrlTpl = rec.pollEndpoint || (rec.endpoint.replace(/\/tasks\/?$/, '/tasks/{{id}}'));
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const every = Number(rec.pollMs) > 0 ? Number(rec.pollMs) : (Number(opts.pollMs) > 0 ? Number(opts.pollMs) : 4000);
      await new Promise((r) => setTimeout(r, every));
      const pollUrl = fill(pollUrlTpl, { ...vars, id: taskId });
      const st = await httpJson(pollUrl, { method: 'GET', headers }, Math.min(60000, timeoutMs));
      last = st;
      if (!st.ok) continue;
      const state = String(pick(st.json, rec.statePath || 'status') ?? '');
      const doneVals = Array.isArray(rec.doneWhen) ? rec.doneWhen : ['succeeded', 'success', 'completed', 'done'];
      const failVals = Array.isArray(rec.failWhen) ? rec.failWhen : ['failed', 'error', 'cancelled'];
      if (failVals.includes(state)) throw new Error(`任务失败：${state} ${JSON.stringify(st.json).slice(0, 200)}`);
      if (doneVals.includes(state)) {
        const url = pick(st.json, rec.resultPath || 'content.video_url');
        const b64 = pick(st.json, rec.resultB64Path || '');
        const p = await materialize({ url, b64 }, outDir, baseName);
        if (p) out.files.push(p);
        out.ok = true;
        out.meta.taskId = taskId;
        break;
      }
    }
    if (!out.ok) {
      out.meta.taskId = taskId;
      out.meta.pending = true;
      out.meta.last = last ? JSON.stringify(last.json).slice(0, 200) : '';
      out.text = `已提交，还没好（任务号 ${taskId}）。过几分钟用 action=fetch 取。`;
      out.meta.ms = Date.now() - t0;
      return out;
    }
  } else if (form === 'raw') {
    const bodyStr = rec.bodyTemplate
      ? fill(typeof rec.bodyTemplate === 'string' ? rec.bodyTemplate : JSON.stringify(rec.bodyTemplate), vars)
      : JSON.stringify(fillDeep(vars, vars));
    const r = await httpJson(fill(rec.endpoint, vars), {
      method: rec.method || 'POST',
      headers: { ...headers, ...(rec.extraHeaders || {}) },
      body: rec.method === 'GET' ? undefined : bodyStr,
    }, timeoutMs);
    if (!r.ok) throw new Error(`HTTP ${r.status}：${(r.text || '').slice(0, 300)}`);
    const val = pick(r.json, rec.resultPath || '');
    out.text = val == null ? (r.text || '').slice(0, 2000) : String(val);
    const url = pick(r.json, rec.fileUrlPath || '');
    const b64 = pick(r.json, rec.fileB64Path || '');
    if (url || b64) {
      const p = await materialize({ url, b64 }, outDir, baseName);
      if (p) out.files.push(p);
    }
    out.ok = true;
  }

  out.meta.ms = Date.now() - t0;
  return out;
}

/**
 * 内置的起步配方（随包发布，不是用户数据）。
 *
 * 为什么要有：注册表文件不存在时原来返回空表 —— 新装、换机器之后 agent 手里
 * 一条配方都没有，只能自己拼 HTTP、自己猜参数（2026-11-17 实测：尺寸猜 1536x1024
 * 被服务端忽略两次、参考图两轮都没传）。**有配方和没配方，是能不能用起来的差别。**
 *
 * 只在文件不存在时用。用户那份一旦写了，就以文件为准，这里永远不覆盖。
 * 凭据一律写成 env:ARK_API_KEY —— 不替任何人预设它把 key 放哪。
 */
export const SEED_REGISTRY = [
  {
    id: 'ark-image-flash',
    name: '豆包生图 flash',
    cap: 'image',
    form: 'sync-generate',
    model: 'doubao-seedream-5-0-flash-260915',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    auth: { type: 'bearer', keyRef: 'env:ARK_API_KEY' },
    defaults: { size: '1024x1024', response_format: 'url' },
    price: { unit: 'per_image', value: 0.12 },
    notes: [
      '【怎么传】params 里加 "prompt"（必填，画什么）；可选 "size"、"image"。',
      '【参考图】body 加 "image": "https://…" 或 "data:image/png;base64,…" —— 模型按参考图改画（图生图），',
      '  尺寸和构图会跟着参考图走。也可写 "file:/本机/路径.png"，执行器会读文件转 base64 再发。',
      '  不传就是纯文字生成。',
      '【尺寸】默认 1024x1024，传什么就发什么（2026-11-22 修：之前 params 进不了 body，传了等于没传）。',
      '  实测 2048x1312（3:2）生效；1536x1024 与 2K 这类写法是否被服务端接受，以实际返回为准 ——',
      '  以前"1536x1024 被忽略"那条结论是错的，实际是根本没发出去。',
      '【提示词】想让人物背对就明写「从正后方看、脸被头发挡住」；要画面里有字会糊，用「看不清的手写便签」代替。',
    ].join('\n'),
  },
  {
    id: 'ark-image-pro',
    name: '豆包生图 pro',
    cap: 'image',
    form: 'sync-generate',
    model: 'doubao-seedream-5-5-261028',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    auth: { type: 'bearer', keyRef: 'env:ARK_API_KEY' },
    defaults: { size: '1024x1024', response_format: 'url' },
    price: { unit: 'per_image', value: 0.25 },
    notes: [
      '【怎么传】同 flash：params 里 "prompt" 必填，可选 "size"、"image"。',
      '【什么时候用它】只有 flash 出的质量不够才换这条 —— 贵一倍。',
      '【额度】报 SetLimitExceeded 不是参数错，是账号的「安全体验模式」有用量上限，要去控制台放开。',
    ].join('\n'),
  },
  {
    id: 'ark-vision',
    name: '豆包识图',
    cap: 'vision',
    form: 'openai-chat',
    model: 'doubao-seed-2-1-pro-260915',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    auth: { type: 'bearer', keyRef: 'env:ARK_API_KEY' },
    defaults: { max_tokens: 400 },
    notes: [
      '【怎么传】两种都行：',
      '  ① params 里给 "prompt" 和 "image_url"（图片 http 地址或 data:image/…;base64）—— 插件会拼成一条 messages；',
      '  ② params 里直接给 "messages" 数组（要自定义多轮时用）。',
      '【速度】是带思考的模型，实测 20~30 秒一张。等不起的时候别用。',
    ].join('\n'),
  },
  {
    id: 'ark-video-seedance',
    name: '豆包生视频',
    cap: 'video',
    form: 'async-task',
    model: 'doubao-seedance-2-5-260628',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
    auth: { type: 'bearer', keyRef: 'env:ARK_API_KEY' },
    defaults: {},
    submitBody: { content: [{ type: 'text', text: '{{prompt}}' }] },
    resultPath: 'content.video_url',
    pollEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{{id}}',
    price: { unit: 'per_second', value: 1.51 },
    notes: [
      '【怎么传】params 里给 "prompt"（写清主机位、动作、场景）；可选 "ratio"、"duration"。',
      '【异步】第一次调用会提交任务、等一会儿；没好就返回任务号。',
      '  拿任务号再调一次 rh_call（带 taskId）只取结果，不会重复提交、不会重复计费。',
      '【额度】报 SetLimitExceeded 是账号用量上限，不是参数错 —— 去控制台放开。',
    ].join('\n'),
  },
];

// 这些是「实现细节」，agent 传了既没好处还可能传错。只对应内部占位符。
// 2026-11-22：提到模块级 —— 执行器拼 body 时要用同一份名单（之前只有 paramHints 看得到）。
const HIDDEN = new Set(['id', 'response_format']);
// 拼 body 时不由 params 直接过继的键：prompt 单独处理，messages 只在 openai-chat 用。
const BODY_SKIP = new Set(['prompt', 'messages']);

/**
 * file: 前缀 → 内联 data URI。
 * 2026-11-22：外部接口只认 http 地址或 data 串，本机参考图以前传不进去。
 * .txt 按 base64 载荷处理（历史用法），其余按扩展名给 mime。
 */
async function inlineFileAsDataUri(p) {
  const buf = await readFile(p);
  const ext = extname(p).slice(1).toLowerCase();
  if (ext === 'txt') {
    const s = buf.toString('utf8').trim();
    if (s.startsWith('data:')) return s;
    if (s && /^[A-Za-z0-9+/=\s]+$/.test(s)) return `data:image/png;base64,${s.replace(/\s+/g, '')}`;
    throw new Error(`file: 指向的文本既不是 data URI 也不是 base64：${p}`);
  }
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
        : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** 从一条记录里推出「这次调用能传什么参数」——给 agent 看的，不让它猜。 */
export function paramHints(rec) {
  const form = String(rec?.form || '');
  const cap = String(rec?.cap || '');
  const out = [];

  const add = (name, why) => {
    if (HIDDEN.has(name) || out.some((x) => x.name === name)) return;
    out.push({ name, why });
  };

  // 先放「这一形态真正要人拿主意」的那几个，顺序按人想事情的顺序
  if (form === 'sync-generate') {
    add('prompt', '必填 —— 画什么（主体 + 场景 + 风格）');
    add('size', '可选 —— 尺寸，默认 ' + JSON.stringify(rec?.defaults?.size ?? '1024x1024'));
    add('image', '可选 —— 参考图（http 地址、data:image/…;base64，或 file:/本机/路径.png）；给了就按图改画');
  } else if (form === 'async-task') {
    add('prompt', '必填 —— 拍什么（主体 + 动作 + 主机位）');
    add('ratio', '可选 —— 画面比例，如 "16:9" / "9:16"');
    add('duration', '可选 —— 时长（秒）');
    add('image_url', '可选 —— 首帧图，给了就是图生视频');
  } else if (form === 'openai-chat') {
    add('prompt', '要问什么');
    if (cap === 'vision') add('image_url', '识图要给图：http 地址或 data:image/…;base64');
    add('messages', '可选 —— 自己拼完整 messages 数组（要多轮时用）');
    add('max_tokens', '可选 —— 回答长度上限，默认 ' + JSON.stringify(rec?.defaults?.max_tokens ?? 400));
  } else if (form === 'raw') {
    add('（任意）', 'bodyTemplate 里出现的占位符名都能传');
  }

  // 再把记录自己声明的默认值补上（有就补，没就跳过）
  for (const k of Object.keys(rec?.defaults || {})) add(k, '默认 ' + JSON.stringify(rec.defaults[k]));
  // ⚠️ 只从 **提交用的模板** 里推参数。pollEndpoint 里的 {{id}} 是轮询任务号，
  // 不是用户要传的东西 —— 列进「能传」会让 agent 以为得自己给任务号。
  const blob = JSON.stringify([rec?.submitBody, rec?.bodyExtra, rec?.bodyTemplate].filter(Boolean));
  for (const m of blob.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) add(m[1], '模板占位符');
  return out;
}

/** 读注册表；文件不存在就用内置 seed（不是空表）。 */
export async function loadRegistry(file) {
  try {
    const raw = await readFile(file, 'utf8');
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return { items: j };
    if (Array.isArray(j.items)) return j;
    return { items: [] };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { items: SEED_REGISTRY.map((x) => ({ ...x })) };
    throw err;
  }
}

export async function saveRegistry(file, reg) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, items: reg.items || [] }, null, 2) + '\n', 'utf8');
}

/** 按「这一次要花多少」挑，而不是比单价 —— 单价单位不同的东西没法直接比。
 *  免费（价格 0 或记录里标 free）永远排最前；价格未知的排最后（但还能用）。 */
export function cheapestFor(reg, cap, params = {}) {
  const items = (reg.items || []).filter((x) => x && x.enabled !== false && (!cap || String(x.cap) === String(cap)));
  if (!items.length) return null;
  const score = (x) => {
    if (x.free === true) return -1;
    const c = estimateCost(x, params);
    return c === null ? Number.POSITIVE_INFINITY : c;
  };
  return items.slice().sort((a, b) => score(a) - score(b))[0];
}

/** 按能力筛（给 agent 看的摘要用） */
export function summarize(reg, cap) {
  const items = (reg.items || []).filter((x) => x && x.enabled !== false);
  const pickd = cap ? items.filter((x) => String(x.cap || '') === String(cap)) : items;
  return pickd.map((x) => ({
    id: x.id, name: x.name || x.id, cap: x.cap, model: x.model,
    form: x.form, notes: x.notes || '',
    // 2026-11-17：这两项是「能不能用起来」的关键 —— 原来只给 notes，
    // agent 看完不知道 params 该填什么，只能瞎写尺寸、漏掉参考图。
    params: paramHints(x),
    defaults: x.defaults || {},
    price: x.price || null,
    free: x.free === true,
    seeded: SEED_REGISTRY.some((y) => y.id === x.id) && !x.auth?.keyRef?.startsWith('file:'),
  }));
}

export { estimateCost, priceOf, pricingTable, PRICING_ASOF };
export const FORM_LIST = CAPS_FORMS;
export const KIND_LIST = CAPS_KINDS;
