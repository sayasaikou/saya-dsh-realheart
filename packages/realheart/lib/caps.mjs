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
import { dirname, join } from 'node:path';

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
    const v = (await readFile(p, 'utf8')).trim();
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
    const body = fillDeep({ model: rec.model, prompt: vars.prompt, ...(rec.defaults || {}), ...(rec.bodyExtra || {}) }, vars);
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
      await new Promise((r) => setTimeout(r, Number(rec.pollMs) > 0 ? Number(rec.pollMs) : 4000));
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

/** 读注册表；文件不存在就给空表，不自动造。 */
export async function loadRegistry(file) {
  try {
    const raw = await readFile(file, 'utf8');
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return { items: j };
    if (Array.isArray(j.items)) return j;
    return { items: [] };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { items: [] };
    throw err;
  }
}

export async function saveRegistry(file, reg) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, items: reg.items || [] }, null, 2) + '\n', 'utf8');
}

/** 按能力筛（给 agent 看的摘要用） */
export function summarize(reg, cap) {
  const items = (reg.items || []).filter((x) => x && x.enabled !== false);
  const pickd = cap ? items.filter((x) => String(x.cap || '') === String(cap)) : items;
  return pickd.map((x) => ({
    id: x.id, name: x.name || x.id, cap: x.cap, model: x.model,
    form: x.form, notes: x.notes || '',
  }));
}

export const FORM_LIST = CAPS_FORMS;
export const KIND_LIST = CAPS_KINDS;
