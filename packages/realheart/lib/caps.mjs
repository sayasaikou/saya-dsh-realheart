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
import { createHmac } from 'node:crypto';
import { dirname, join, extname } from 'node:path';
import { estimateCost, priceOf, pricingTable, PRICING_ASOF } from './pricing.mjs';
import { flattenCatalog, buildRecordFromCatalog, limitsLine } from './catalog.mjs';

const CAPS_FORMS = ['openai-chat', 'sync-generate', 'async-task', 'raw'];
const CAPS_KINDS = ['vision', 'image', 'video', 'tts', 'asr', 'text', 'embed', 'music'];

/**
 * 价格单位的说法。原来这段在 index.mjs 里被抄了四遍
 * （`unit === 'per_image' ? '张' : unit === 'per_second' ? '秒' : '千token'`），
 * 于是「元/千字符」这种单位一律被显示成「元/千token」—— 数字对、意思错，
 * 最容易让人照着一个错单位去比价。现在只留这一份。
 */
export const UNIT_LABEL = {
  per_image: '元/张',
  per_second: '元/秒',
  per_minute: '元/分钟',
  per_1k_tokens: '元/千 token',
  per_1m_tokens: '元/百万 token',
  per_1k_chars: '元/千字符',
  per_song: '元/首',
  per_video: '元/个视频',
  per_call: '元/次',
  free: '免费',
};

export function unitLabel(unit) {
  const u = String(unit || '').trim();
  return UNIT_LABEL[u] || (u ? '元/' + u.replace(/^per_/, '') : '单位未标');
}

/**
 * 一条记录的价格说法（记录没写就看内置价目表；都没有就说没录）。
 * 2026-11-22：币种得上屏 —— 可灵是美元计价，写成「元/秒」比不写还糟。
 */
export function moneyText(rec) {
  if (!rec) return '价格未录';
  if (rec.free === true) return '免费';
  const p = priceOf(rec);
  if (!p) return '价格未录';
  const label = unitLabel(p.unit).replace(/^元/, p.currency === 'USD' ? '美元' : '元');
  return p.value + ' ' + label + (p.src && p.src !== 'record' ? '（内置价目表）' : '');
}

/**
 * 凭据：auth.keyRef 写成 env:名字 或 file:路径。两种都读不到就抛，不猜、不从别处找。
 *
 * 2026-11-22：拆出 readRef，因为不是每家都只吃一把 key ——
 * 可灵要 access + secret 一对（现签 JWT），Google 要放自定义头而不是 Bearer。
 */
async function readRef(ref, what = '凭据') {
  if (!ref) throw new Error(`这条记录没写${what}（auth.keyRef）`);
  const s = String(ref).trim();
  if (s.startsWith('env:')) {
    const v = String(process.env[s.slice(4)] || '').trim();
    if (!v) throw new Error(`${what}没设：环境变量 ${s.slice(4)} 是空的`);
    return v;
  }
  if (s.startsWith('file:')) {
    const p = s.slice(5);
    let raw;
    try {
      raw = await readFile(p, 'utf8');
    } catch (err) {
      // 2026-11-17：原来直接把 ENOENT 抛出去，agent 只看到「文件不存在」，
      // 看不出这是「缺凭据」。缺什么、去哪填，得在这里说清楚。
      if (err && err.code === 'ENOENT') {
        throw new Error(`这条能力缺${what}：auth.keyRef 指向的文件不存在（${p}）。`
          + '去设置页「外部能力」填 key，或者把它改成 env:环境变量名。');
      }
      throw err;
    }
    const v = String(raw).trim();
    if (!v) throw new Error(`${what}文件是空的：${p}`);
    return v;
  }
  throw new Error(`不认识的${what}写法：${s}（只支持 env:名字 或 file:路径）`);
}

async function keyOf(auth) {
  if (!auth) throw new Error('这条记录没写凭据（auth.keyRef）');
  return readRef(auth.keyRef, '凭据');
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

/**
 * 拿二进制响应（TTS 这类直接把音频流吐回来、没有 JSON 的接口）。
 * 用 httpJson 取会先 text() 再拼，音频就此报废 —— 顺手还看不到是哪里坏的。
 */
async function httpBinary(url, init, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      ok: res.ok,
      buf,
      ctype: res.headers.get('content-type') || '',
      head: res.ok ? '' : buf.toString('utf8').slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 请求头里的占位符：{{uuid}} / {{ts}} 现填。
 * 为的是天工那类「必须带 Idempotency-Key、且每次请求都得是新值」的接口 ——
 * 写死一个常量等于把后续请求都当成同一笔重试，永远拿回第一个任务。
 */
function filledHeaders(h) {
  if (!h || typeof h !== 'object') return {};
  const now = new Date();
  const vars = {
    uuid: (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
      ? globalThis.crypto.randomUUID()
      : 'idem-' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 10),
    ts: String(now.getTime()),
    iso: now.toISOString(),
  };
  const out = {};
  for (const [k, v] of Object.entries(h)) out[k] = fill(String(v), vars);
  return out;
}

function authHeaders(auth, key) {
  const h = { 'content-type': 'application/json' };
  if (key) {
    // 不是每家都用 Authorization: Bearer —— Google 的 x-goog-api-key、BFL 的 x-key
    // 都只认自己的头名。原来一律塞 Bearer，这类厂商第一次调必然 401。
    if (auth && auth.type === 'header' && auth.headerName) h[auth.headerName] = key;
    else h.authorization = `Bearer ${key}`;
  }
  if (auth && auth.extraHeaders && typeof auth.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(auth.extraHeaders)) h[k] = String(v);
  }
  return h;
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * 可灵用 JWT（HS256）鉴权：access key 当 iss，secret 当签名密钥，现签现用。
 * 试出来的一对 key 各放一个环境变量，缺一个就报「缺凭据」，别让它变成 401 猜谜。
 */
async function klingJwt(auth) {
  const ak = await readRef(auth.keyRef, 'access key');
  const sk = await readRef(auth.secretRef, 'secret key');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 }));
  const data = head + '.' + body;
  const sig = createHmac('sha256', sk).update(data).digest('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return data + '.' + sig;
}

/**
 * 把结果里的 url / b64 / hex 落成文件，返回绝对路径。
 * 2026-11-22：加 hex —— MiniMax 这类直接把音频编成十六进制串塞在 JSON 里，
 * 原来只认 url 和 b64，于是「调用成功、拿回一段字符串、没有文件」。
 */
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
  if (item.hex) {
    const ext = item.ext || 'mp3';
    const p = join(outDir, `${baseName}.${ext}`);
    await writeFile(p, Buffer.from(String(item.hex).replace(/\s+/g, ''), 'hex'));
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
  // 可灵那类要现签 JWT 的，key 不是从环境变量直接拿，而是签出来的一串
  const key = rec.auth && rec.auth.type === 'kling-jwt'
    ? await klingJwt(rec.auth)
    : await keyOf(rec.auth);
  const headers = { ...authHeaders(rec.auth, key), ...filledHeaders(rec.extraHeaders) };
  const form = String(rec.form || '');
  // 有的接口收 multipart/form-data（Stability），不能带 application/json 那个头，
  // 否则 fetch 不会替你生成 boundary，服务端直接 415。
  const isMultipart = String(rec.bodyType || '') === 'multipart';
  if (isMultipart) delete headers['content-type'];

  if (!CAPS_FORMS.includes(form)) throw new Error(`不认识的调用形态：${form}（只支持 ${CAPS_FORMS.join(' / ')}）`);

  const out = { ok: false, kind: rec.cap || '', files: [], text: '', meta: { model: rec.model, ms: 0 } };

  if (form === 'openai-chat') {
    // 2026-11-22：与 sync-generate 同一处病 —— defaults 里声明的键（max_tokens、temperature…）
    // 原来根本进不了 body，只有写进 bodyExtra 的模板才会到。于是「默认 400 字」从来没有生效过，
    // agent 还照着 paramHints 里的默认值去估算回答长度。
    const extra = Object.fromEntries(
      Object.entries(vars).filter(([k]) => !HIDDEN.has(k) && !BODY_SKIP_CHAT.has(k))
    );
    const body = fillDeep({ model: rec.model, ...extra, messages: vars.messages, ...(rec.bodyExtra || {}) }, vars);
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
    // 两种请求体风格：
    //   平铺（OpenAI 那套）—— 参数直接是 body 的键
    //   模板（阿里 DashScope 那套）—— body 是 { model, input:{messages|prompt}, parameters:{} }，
    //     参数藏在嵌套结构里，只能靠模板映射。以前没有这条路，DashScope 那几家根本没法用这套形态调。
    let body = rec.bodyTemplate
      ? fillDeep(rec.bodyTemplate, vars)
      : fillDeep({
        ...(rec.modelInBody === false ? {} : { model: rec.model }),
        prompt: vars.prompt,
        ...(rec.defaults || {}),
        ...extra,
        ...(rec.bodyExtra || {}),
      }, vars);
    // 本机参考图：file: 前缀转内联 data URI（外部接口只认 http / data 串）
    if (typeof body.image === 'string' && body.image.startsWith('file:')) {
      body.image = await inlineFileAsDataUri(body.image.slice(5));
    }
    if (rec.bodyTemplate) body = await inlineFileDeep(body);
    // bodyExtra 声明的键，用户没传就别把空串发出去（服务端会 400）
    for (const k of Object.keys(rec.bodyExtra || {})) {
      if (body[k] === '') delete body[k];
    }
    // 模板里没被填上的占位符会变成空串（如 seed / negative_prompt 没传）——
    // 原样发出去就是 400。整棵树上把空串剪掉，但保留显式的 0 / false。
    if (rec.bodyTemplate) body = pruneEmpty(body);
    // multipart 那几家（Stability）要把字段一个个挂上去，不能 JSON.stringify
    const payload = isMultipart ? await toFormData(body) : JSON.stringify(body);
    // 有的接口（OpenAI /v1/audio/speech 这类）响应体就是成品文件，没有 JSON
    if (String(rec.responseType || '') === 'binary') {
      const bin = await httpBinary(rec.endpoint, { method: 'POST', headers, body: payload }, timeoutMs);
      if (!bin.ok) throw new Error(`HTTP ${bin.status}：${bin.head}`);
      await mkdir(outDir, { recursive: true });
      const ext = rec.fileExt || guessExt('', bin.ctype) || 'bin';
      const p = join(outDir, `${baseName}.${ext}`);
      await writeFile(p, bin.buf);
      out.files.push(p);
      out.ok = true;
      out.meta.bytes = bin.buf.length;
      out.meta.ms = Date.now() - t0;
      return out;
    }
    const r = await httpJson(rec.endpoint, { method: 'POST', headers, body: payload }, timeoutMs);
    if (!r.ok) throw new Error(`HTTP ${r.status}：${(r.text || '').slice(0, 300)}`);
    const url = pick(r.json, rec.resultPath || 'data.0.url');
    const b64 = pick(r.json, rec.resultB64Path || 'data.0.b64_json');
    const hex = pick(r.json, rec.resultHexPath || '');
    if (!url && !b64 && !hex) {
      throw new Error(`返回里没找到结果（试过 ${rec.resultPath || 'data.0.url'} / `
        + `${rec.resultB64Path || 'data.0.b64_json'}${rec.resultHexPath ? ' / ' + rec.resultHexPath : ''}）：`
        + `${(r.text || '').slice(0, 200)}`);
    }
    const p = await materialize({ url, b64, hex, ext: rec.fileExt }, outDir, baseName);
    if (p) out.files.push(p);
    // 顺带把原文摘要留一份：音频这类「拿到文件但想确认时长/音色」的时候有用
    if (!out.files.length) out.text = String(r.text || '').slice(0, 1000);
    out.ok = true;
  } else if (form === 'async-task') {
    // 已经有任务号（第二次来取结果）：跳过提交，直接轮询
    let taskId = String(opts.pollTaskId || '').trim();
    let submitJson = null;
    if (!taskId) {
      // 有的新接口把模型写进 URL 路径（可灵 3.0），body 里再塞一个 model 会被当成未知字段
      const modelPart = rec.modelInBody === false ? {} : { model: rec.model };
      let submitBody = fillDeep({ ...modelPart, ...(rec.submitBody || {}), ...(rec.bodyExtra || {}) }, vars);
      if (rec.submitBody) {
        submitBody = await inlineFileDeep(submitBody);
        submitBody = pruneEmpty(submitBody);
      }
      const sub = await httpJson(rec.endpoint, { method: 'POST', headers, body: JSON.stringify(submitBody) }, timeoutMs);
      if (!sub.ok) throw new Error(`提交失败 HTTP ${sub.status}：${(sub.text || '').slice(0, 300)}`);
      submitJson = sub.json;
      taskId = String(pick(sub.json, rec.taskIdPath || 'id') || '');
      if (!taskId) throw new Error(`提交返回里没找到任务号（试过 ${rec.taskIdPath || 'id'}）`);
    }
    // 有的厂商（BFL）提交时直接给一条 polling_url，只能原样用 —— 自己拼域名会跨集群路由，
    // 官方明写不要自己拼。所以优先用响应里那条。
    let pollUrlTpl = rec.pollEndpoint || (rec.endpoint.replace(/\/tasks\/?$/, '/tasks/{{id}}'));
    if (rec.pollUrlPath && submitJson) {
      const fromResp = pick(submitJson, rec.pollUrlPath);
      if (fromResp) pollUrlTpl = String(fromResp);
    }
    // 阿里百炼的任务查询是 POST（带 auth 头、无 body）；按 GET 发会被网关绕一圈才报错
    const pollMethod = String(rec.pollMethod || 'GET').toUpperCase();
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const every = Number(rec.pollMs) > 0 ? Number(rec.pollMs) : (Number(opts.pollMs) > 0 ? Number(opts.pollMs) : 4000);
      await new Promise((r) => setTimeout(r, every));
      const pollUrl = fill(pollUrlTpl, { ...vars, id: taskId });
      const st = await httpJson(pollUrl, { method: pollMethod, headers }, Math.min(60000, timeoutMs));
      last = st;
      if (!st.ok) continue;
      const state = String(pick(st.json, rec.statePath || 'status') ?? '');
      const doneVals = Array.isArray(rec.doneWhen) ? rec.doneWhen : ['succeeded', 'success', 'completed', 'done'];
      const failVals = Array.isArray(rec.failWhen) ? rec.failWhen : ['failed', 'error', 'cancelled'];
      if (failVals.includes(state)) throw new Error(`任务失败：${state} ${JSON.stringify(st.json).slice(0, 200)}`);
      if (doneVals.includes(state)) {
        let url = pick(st.json, rec.resultPath || 'content.video_url');
        let b64 = pick(st.json, rec.resultB64Path || '');
        let hex = pick(st.json, rec.resultHexPath || '');
        // 有些厂商完成任务只给「文件号」，还要再调一次文件接口才拿到下载地址
        // （MiniMax 的 Hailuo / 异步 TTS 都是两跳）。以前只能干看着，等于跑不通。
        if (!url && !b64 && !hex && rec.followUp && rec.followUp.endpoint) {
          const fid = pick(st.json, rec.followUp.idPath || 'file_id');
          if (fid) {
            const fu = await httpJson(
              fill(rec.followUp.endpoint, { ...vars, fileId: fid, id: taskId }),
              { method: String(rec.followUp.method || 'GET').toUpperCase(), headers },
              Math.min(60000, timeoutMs),
            );
            if (!fu.ok) throw new Error(`取文件失败 HTTP ${fu.status}：${(fu.text || '').slice(0, 200)}`);
            url = pick(fu.json, rec.followUp.urlPath || 'file.download_url');
            if (!url) throw new Error(`文件接口里没找到下载地址（试过 ${rec.followUp.urlPath || 'file.download_url'}）：${(fu.text || '').slice(0, 200)}`);
          }
        }
        const p = await materialize({ url, b64, hex, ext: rec.fileExt }, outDir, baseName);
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
 * 内置配方（随包发布，不是用户数据）。
 *
 * 为什么要有：注册表文件不存在时原来返回空表 —— 新装、换机器之后 agent 手里
 * 一条配方都没有，只能自己拼 HTTP、自己猜参数（2026-11-17 实测：尺寸猜 1536x1024
 * 被服务端忽略两次、参考图两轮都没传）。**有配方和没配方，是能不能用起来的差别。**
 *
 * 2026-11-22：不再手写一遍 —— 直接从型号目录（lib/catalog/）派生。
 * 原来这里和 catalog.mjs 各存一份规范，加一个型号要改两处，改漏一处的结果是
 * 「目录里能装，装完和目录说的不一样」。现在规范只有 catalog 一份真东西。
 *
 * 凭据一律写成 env:<该厂商的默认变量名> —— 不替任何人预设它把 key 放哪。
 */
export const SEED_REGISTRY = flattenCatalog().map((x) => buildRecordFromCatalog(x));

// 这些是「实现细节」，agent 传了既没好处还可能传错。只对应内部占位符。
// 2026-11-22：提到模块级 —— 执行器拼 body 时要用同一份名单（之前只有 paramHints 看得到）。
const HIDDEN = new Set(['id', 'response_format']);
// 拼 body 时不由 params 直接过继的键：prompt 单独处理，messages 只在 openai-chat 用。
// image_url / image 是「拿去拼 content」或「单独转 data URI」的，原样塞进 body 会 400。
const BODY_SKIP = new Set(['prompt', 'messages', 'image_url']);
const BODY_SKIP_CHAT = new Set(['prompt', 'messages', 'image_url', 'image']);

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

/**
 * 表单体：multipart 那几家（Stability / OpenAI 语音识别）每个字段单独挂，不能 JSON.stringify。
 * 值写成 file:/本机/路径 时按文件上传（语音识别必须要真的文件流，不是路径字符串），
 * 其余对象/数组按 JSON 串塞进字段。
 */
async function toFormData(body) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body || {})) {
    if (v === '' || v == null) continue;
    if (typeof v === 'string' && v.startsWith('file:')) {
      const p = v.slice(5);
      const buf = await readFile(p);
      const ext = extname(p).slice(1).toLowerCase();
      const mime = ext === 'mp3' ? 'audio/mpeg'
        : ext === 'wav' ? 'audio/wav'
          : ext === 'm4a' ? 'audio/mp4'
            : ext === 'ogg' ? 'audio/ogg'
              : ext === 'webm' ? 'audio/webm'
                : ext === 'flac' ? 'audio/flac'
                  : ext === 'png' ? 'image/png'
                    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                      : 'application/octet-stream';
      fd.append(k, new Blob([buf], { type: mime }), extname(p) ? p.split(/[\\/]/).pop() : (k + '.bin'));
      continue;
    }
    fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return fd;
}

/** 把树里所有 file: 开头的字符串就地换成 data URI（模板形态下参考图埋在嵌套结构里） */
async function inlineFileDeep(v) {
  if (typeof v === 'string') {
    return v.startsWith('file:') ? inlineFileAsDataUri(v.slice(5)) : v;
  }
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) out.push(await inlineFileDeep(x));
    return out;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = await inlineFileDeep(val);
    return out;
  }
  return v;
}

/**
 * 剪掉模板里没填上的空串。
 * 模板里写了 {{seed}}、用户没传 seed → 填成 ''，原样发出去服务端就 400。
 * 只剪空串，不动 0 / false / 空数组 —— 那三个都是有意义的取值
 * （false 是「关掉水印」这种正当参数，剪掉就变默认值了）。
 */
function pruneEmpty(v) {
  if (Array.isArray(v)) return v.map(pruneEmpty);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === '') continue;
      out[k] = pruneEmpty(val);
    }
    return out;
  }
  return v;
}

/**
 * 从一条记录里推出「这次调用能传什么参数」——给 agent 看的，不让它猜。
 *
 * 三种来源，按可信度排：
 *   ① rec.paramSpec（型号目录里写好的参数表：描述、必填、可选值）—— 最准，优先用
 *   ② 按形态的兜底（老的、手写的记录没有 paramSpec，只能按形态猜一个常见键名）
 *   ③ defaults 与提交模板里的占位符 —— 兜底补齐，别漏
 * 有 ① 的时候 ②③ 只做去重补充，不会把「这个型号没有的参数」列进来。
 */
export function paramHints(rec) {
  const form = String(rec?.form || '');
  const cap = String(rec?.cap || '');
  const spec = rec?.paramSpec && typeof rec.paramSpec === 'object' ? rec.paramSpec : {};
  const out = [];

  const add = (name, why) => {
    if (HIDDEN.has(name) || out.some((x) => x.name === name)) return;
    out.push({ name, why });
  };

  const whyOfSpec = (sp) => {
    const bits = [];
    const desc = String(sp?.desc || '').trim();
    if (sp?.required && !/必填/.test(desc)) bits.push('必填');
    if (desc) bits.push(desc);
    const vals = Array.isArray(sp?.values) ? sp.values.filter((v) => v != null && v !== '') : [];
    if (vals.length) bits.push('可取：' + vals.join(' / '));
    return bits.join(' —— ') || '模板占位符';
  };

  // ① 型号目录声明的参数表
  for (const [name, sp] of Object.entries(spec)) add(name, whyOfSpec(sp));

  // ② 形态兜底（只在没有声明参数表时，才按形态给一套常见键名）
  if (!out.length) {
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
  }

  // 再把记录自己声明的默认值补上（有就补，没就跳过）
  for (const k of Object.keys(rec?.defaults || {})) add(k, '默认 ' + JSON.stringify(rec.defaults[k]));
  // ⚠️ 只从 **提交用的模板** 里推参数。pollEndpoint 里的 {{id}} 是轮询任务号，
  // 不是用户要传的东西 —— 列进「能传」会让 agent 以为得自己给任务号。
  const blob = JSON.stringify([rec?.submitBody, rec?.bodyExtra, rec?.bodyTemplate].filter(Boolean));
  for (const m of blob.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) add(m[1], '模板占位符');
  return out;
}

/**
 * 读注册表；文件不存在就用内置 seed（不是空表）。
 *
 * 🔴 2026-11-22 修一个让整个功能形同虚设的问题：
 * 原来自家文件一旦存在就**只用文件**、完全不看 SEED_REGISTRY。而云端那份
 * config.user.json 早在插件上线第一天就写出来了 —— 于是后来往 SEED 里加的配方
 * 一条都读不到，表现成「我明明加了啊」。
 *
 * 现在的规矩：**以文件为准，SEED 只补文件里没有的 id**（按 id 合并）。
 *   · 用户改过某条 → 文件里有同 id，用文件的（用户优先，改不会被覆盖）
 *   · 用户不想用某条 → 写 enabled:false（有现成机制），不要靠删
 *   · 内置新加了型号 → 文件里没有这个 id，自动补进来
 */
export async function loadRegistry(file) {
  const mergeSeed = (items) => {
    const seedById = new Map(SEED_REGISTRY.map((s) => [s.id, s]));
    const mineById = new Map();
    for (const x of items) {
      if (x && x.id) mineById.set(x.id, x);
    }
    /**
     * 同 id 的合并是**字段级**的，不是整条替换。
     * 理由：老版本写进文件的那几条只有 id/端点/默认值，没有后来才加的
     * input / output / limits / docs / paramSpec。整条替换会让「规格内置」
     * 在这台机器上彻底失效 —— 文件在，新字段永远看不见。
     * 所以：以 SEED 打底，文件里写了的字段盖上去（用户改过的照旧优先）。
     */
    const merged = SEED_REGISTRY.map((s) => {
      const mine = mineById.get(s.id);
      return mine ? { ...s, ...mine } : { ...s };
    });
    const tail = items.filter((x) => x && x.id && !seedById.has(x.id));
    return [...merged, ...tail];
  };
  try {
    const raw = await readFile(file, 'utf8');
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return { items: mergeSeed(j) };
    if (Array.isArray(j.items)) return { ...j, items: mergeSeed(j.items) };
    return { items: mergeSeed([]) };
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

/** 凭据是不是现成可用：只查「变量在不在 / 文件在不在」，不泄露值。 */
export function keyReady(rec) {
  const ref = String(rec?.auth?.keyRef || '').trim();
  if (!ref) return false;
  if (ref.startsWith('env:')) return Boolean(String(process.env[ref.slice(4)] || '').trim());
  if (ref.startsWith('file:')) {
    try { return existsSync(ref.slice(5)); } catch { return false; }
  }
  return false;
}

/**
 * 按能力筛（给 agent 看的摘要用）。
 *
 * 2026-11-22：补上「这条到底能不能用」和「规格」两组字段。
 * 之前 agent 只看到 id / 形态 / 价格，于是经常挑一条没配 key 的去调，
 * 或者不知道上下文多长、输出是什么格式 —— 全得靠猜。
 */
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
    money: moneyText(x),
    free: x.free === true,
    seeded: SEED_REGISTRY.some((y) => y.id === x.id) && !x.auth?.keyRef?.startsWith('file:'),
    // 2026-11-22 新增：规格 + 可用性
    input: x.input || '',
    output: x.output || '',
    limits: limitsLine(x.limits),
    docs: x.docs || '',
    asOf: x.asOf || '',
    keyRef: String(x.auth?.keyRef || ''),
    ready: keyReady(x),
    blocked: x.blocked || '',
    unverified: Array.isArray(x.unverified) ? x.unverified : [],
  }));
}

export { estimateCost, priceOf, pricingTable, PRICING_ASOF, limitsLine };
export const FORM_LIST = CAPS_FORMS;
export const KIND_LIST = CAPS_KINDS;
