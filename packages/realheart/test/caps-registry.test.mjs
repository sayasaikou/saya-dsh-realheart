/**
 * 外部能力注册表的结构与合并规则（2026-11-22）。
 *
 * 这一天把它从「4 条手写配方」扩到「一份型号目录 + 派生配方」，所以这里守四件事：
 *   ① 目录里的每条都能被装出来，且字段齐全（缺 endpoint / 缺 price 单位这类）
 *   ② 注册表文件存在时，SEED 只补「文件里没有的 id」，同 id 以文件为准
 *   ③ 模板形态的请求体填得对：占位符替换、空串剪掉、file: 转 data URI
 *   ④ 价格单位与币种不串味（千字符不能被说成千 token，美元不能被说成元）
 *
 * 也顺手守一条隐私红线：目录是随包发出去的东西，里面不许出现本机路径、自己的号。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SEED_REGISTRY, loadRegistry, saveRegistry, summarize, paramHints,
  moneyText, unitLabel, limitsLine, runCapability, KIND_LIST, FORM_LIST, estimateCost,
} from '../lib/caps.mjs';
import { CATALOG, flattenCatalog } from '../lib/catalog.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'rh-caps-'));

test('型号目录：每条都能装成记录，字段不残缺', () => {
  const all = flattenCatalog();
  assert.ok(all.length >= 20, '目录条数太少，扩了个寂寞');
  const ids = new Set();
  for (const entry of all) {
    assert.ok(entry.vendor, entry.model + ' 没有 vendor');
    assert.ok(entry.model, entry.name + ' 没有 model');
    assert.ok(entry.endpoint && /^(https?|wss?):\/\//.test(entry.endpoint), entry.model + ' 端点不像个 URL：' + entry.endpoint);
    assert.ok(KIND_LIST.includes(entry.cap), entry.model + ' 的 cap 不在白名单：' + entry.cap);
    assert.ok(FORM_LIST.includes(entry.form), entry.model + ' 的 form 不在白名单：' + entry.form);
    assert.ok(entry.input && entry.output, entry.model + ' 缺 input/output 说明');
    assert.ok(entry.docs && /^https?:\/\//.test(entry.docs), entry.model + ' 缺官方文档链接');
    assert.ok(entry.params && Object.keys(entry.params).length, entry.model + ' 没有参数表');
    for (const [k, v] of Object.entries(entry.params)) {
      assert.ok(v && v.desc, entry.model + ' 的参数 ' + k + ' 没有说明');
    }
    if (entry.price) {
      assert.ok(Object.keys(unitLabel(entry.price.unit)) !== null);
      assert.ok(Number.isFinite(Number(entry.price.value)), entry.model + ' 价格不是数字');
      assert.ok(/^per_|^free$/.test(entry.price.unit), entry.model + ' 价格单位不认识：' + entry.price.unit);
    }
    if (entry.blocked) {
      assert.ok(entry.blocked.length > 8, entry.model + ' 说了不能调，但没说为什么');
    }
    const id = entry.recordId || (entry.vendor + '-' + entry.model.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    assert.ok(!ids.has(id), '记录 id 撞了：' + id);
    ids.add(id);
  }
});

test('SEED_REGISTRY 与目录一一对应，且没有重复 id', () => {
  const fromCatalog = flattenCatalog().length;
  assert.equal(SEED_REGISTRY.length, fromCatalog);
  const ids = SEED_REGISTRY.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, '有重复 id');
  for (const r of SEED_REGISTRY) {
    assert.ok(r.auth && r.auth.keyRef, r.id + ' 没有凭据写法');
    assert.ok(String(r.auth.keyRef).startsWith('env:'), r.id + ' 的凭据不是环境变量（随包发出的东西不该指向本机路径）');
  }
});

/**
 * 随包内容不许带本机路径。
 *
 * ⚠️ 「自己的号 / 群号」那一条**不在这里查** —— 要查就得把号码本身写进这个文件，
 * 而仓库是公开的，等于用泄漏本身当检测手段。那件事靠发布前对 npm 包整目录 grep
 * （号码只出现在当次命令里，不落盘）。这里只守得住路径和凭据写法。
 */
test('随包内容不许带本机 / 服务器路径', async () => {
  const files = ['vendors.mjs', 'image.mjs', 'video.mjs', 'audio.mjs', 'music.mjs', 'llm.mjs', 'index.mjs'];
  for (const f of files) {
    const p = join(import.meta.dirname, '..', 'lib', 'catalog', f);
    let src = '';
    try { src = await readFile(p, 'utf8'); } catch { continue; }
    assert.ok(!/\/home\/[a-z]+/.test(src), f + ' 里出现服务器家目录');
    assert.ok(!/[A-Za-z]:\\\\Users\\\\/.test(src), f + ' 里出现本机用户目录');
    assert.ok(!/file:\/\/\/[A-Za-z]/.test(src), f + ' 里出现本机文件路径');
  }
});

test('loadRegistry：文件存在时 SEED 只补缺失，同 id 以文件为准（字段级）', async () => {
  const dir = await tmp();
  const f = join(dir, 'capabilities.json');
  const first = SEED_REGISTRY[0];
  await writeFile(f, JSON.stringify({
    version: 1,
    items: [
      // 用户改过的：只写了 id/name，其它字段该由 SEED 补齐（这正是「规格内置」能不能生效的关键）
      { id: first.id, name: '我自己改的名字', cap: 'image', form: 'sync-generate', model: 'x', endpoint: 'http://x', auth: { keyRef: 'env:ARK_API_KEY' } },
      // 用户自己加的：必须原样保留
      { id: 'my-own', name: '自加的一条', cap: 'image', form: 'sync-generate', model: 'y', endpoint: 'http://y', auth: { keyRef: 'env:ARK_API_KEY' } },
      // 用户关掉的：enabled:false 要活下来
      { id: SEED_REGISTRY[1].id, enabled: false },
    ],
  }, null, 2), 'utf8');

  const reg = await loadRegistry(f);
  const ids = reg.items.map((x) => x.id);
  const mine = reg.items.find((x) => x.id === first.id);
  assert.equal(mine.name, '我自己改的名字', '同 id 该以文件为准');
  assert.ok(mine.limits, '文件里没写的字段该由 SEED 补上（规格内置靠这个）');
  assert.ok(reg.items.some((x) => x.id === 'my-own'), '用户自加的条目不能丢');
  assert.equal(reg.items.find((x) => x.id === SEED_REGISTRY[1].id).enabled, false, 'enabled:false 要保住');
  assert.ok(ids.includes('dashscope-wan-t2i'), '内置新增的型号要能补进来');
  assert.equal(new Set(ids).size, ids.length, '合并后不该有重复 id');
});

test('loadRegistry：文件不存在就用 SEED，文件坏掉要抛（不能假装空表）', async () => {
  const dir = await tmp();
  const reg = await loadRegistry(join(dir, 'nope.json'));
  assert.equal(reg.items.length, SEED_REGISTRY.length);

  const bad = join(dir, 'bad.json');
  await writeFile(bad, '{ this is not json', 'utf8');
  await assert.rejects(() => loadRegistry(bad));
});

test('saveRegistry 落盘后能读回来（形状不变）', async () => {
  const dir = await tmp();
  const f = join(dir, 'sub', 'capabilities.json');
  await saveRegistry(f, { items: [{ id: 'a', cap: 'image', form: 'sync-generate', model: 'm', endpoint: 'http://x', auth: { keyRef: 'env:K' } }] });
  const back = await loadRegistry(f);
  assert.ok(back.items.some((x) => x.id === 'a'));
});

test('moneyText：单位与币种不串味', () => {
  assert.equal(moneyText({ price: { unit: 'per_image', value: 0.12 } }), '0.12 元/张');
  assert.equal(moneyText({ price: { unit: 'per_1k_chars', value: 0.35 } }), '0.35 元/千字符');
  assert.equal(moneyText({ price: { unit: 'per_second', value: 0.084, currency: 'USD' } }), '0.084 美元/秒');
  assert.equal(moneyText({ price: { unit: 'per_video', value: 2 } }), '2 元/个视频');
  assert.equal(moneyText({ free: true }), '免费');
  assert.equal(moneyText({ model: 'no-such-model' }), '价格未录');
});

test('estimateCost：新单位能算出「这一次」的钱', () => {
  const sec = estimateCost({ price: { unit: 'per_second', value: 0.6 } }, { duration: 5 });
  assert.equal(sec, 3);
  const chars = estimateCost({ price: { unit: 'per_1k_chars', value: 0.35 } }, { chars: 1000 });
  assert.equal(chars, 0.35);
  const song = estimateCost({ price: { unit: 'per_song', value: 1 } }, {});
  assert.equal(song, 1);
  const unknown = estimateCost({ price: { unit: 'per_widget', value: 1 } }, {});
  assert.equal(unknown, null);
});

test('paramHints：有参数表就用参数表，不再按形态瞎猜', () => {
  const rec = SEED_REGISTRY.find((x) => x.id === 'dashscope-wan-t2i');
  const hints = paramHints(rec);
  const names = hints.map((h) => h.name);
  assert.ok(names.includes('prompt'), '该有 prompt');
  assert.ok(names.includes('size'));
  const size = hints.find((h) => h.name === 'size');
  assert.ok(size.why.includes('1280*1280'), '可选值要摊开给 agent 看：' + size.why);
  const prompt = hints.find((h) => h.name === 'prompt');
  assert.ok(prompt.why.startsWith('必填'), '必填要标出来：' + prompt.why);
});

test('summarize：能用的排前面，缺 key 的标出来，blocked 的说明原因', () => {
  const rows = summarize({ items: SEED_REGISTRY }, 'video');
  assert.ok(rows.length >= 3);
  for (const r of rows) {
    assert.ok('ready' in r);
    assert.ok(r.money);
    if (r.blocked) assert.ok(r.blocked.length > 8);
  }
  const tts = summarize({ items: SEED_REGISTRY }, 'tts');
  assert.ok(tts.some((r) => r.blocked), 'CosyVoice 那条该被标成调不了');
  assert.equal(limitsLine({ durationMin: 2, durationMax: 15 }).includes('2~15'), true);
});

test('模板形态请求体：占位符替换、空串剪掉、file: 转 data URI', async () => {
  const got = [];
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      got.push(JSON.parse(raw || '{}'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: { choices: [{ message: { content: [{ image: 'http://127.0.0.1:1/x.png' }] } }] } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const dir = await tmp();
  const img = join(dir, 'ref.png');
  await writeFile(img, PNG);
  process.env.RH_TEST_KEY = 'dummy';

  const rec = {
    id: 'tmpl', name: 'T', cap: 'image', form: 'sync-generate',
    model: 'm', endpoint: `http://127.0.0.1:${port}/gen`,
    auth: { type: 'bearer', keyRef: 'env:RH_TEST_KEY' },
    bodyTemplate: {
      model: 'm',
      input: { messages: [{ role: 'user', content: [{ image: '{{image}}' }, { text: '{{prompt}}' }] }] },
      parameters: { size: '{{size}}', n: 1, seed: '{{seed}}', watermark: false },
    },
    resultPath: 'output.choices.0.message.content.0.image',
  };

  try {
    await runCapability(rec, { prompt: '一只猫', size: '1280*1280', image: 'file:' + img }, { outDir: dir, timeoutMs: 5000 });
  } catch (e) {
    // 下载那步会失败（假 URL），body 已经发出去了，不影响断言
    if (!/HTTP|fetch|download|ECONN/i.test(String(e.message))) throw e;
  }
  server.close();
  assert.equal(got.length, 1, '没有发出请求');
  const body = got[0];
  assert.equal(body.input.messages[0].content[1].text, '一只猫');
  assert.ok(body.input.messages[0].content[0].image.startsWith('data:image/png;base64,'), 'file: 没转成 data URI');
  assert.equal(body.parameters.size, '1280*1280');
  assert.equal(body.parameters.n, 1);
  assert.equal(body.parameters.watermark, false, 'false 不能被当成空值剪掉');
  assert.ok(!('seed' in body.parameters), '没传的 seed 该被剪掉，不然服务端 400');
});

test('异步提交：空串剪掉、modelInBody=false 时 body 里没有 model', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ status: 'succeed', outputs: [] }] }));
        return;
      }
      seen.push({ url: req.url, body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { id: 'task-1' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  process.env.RH_TEST_KEY = 'dummy';

  const rec = {
    id: 'async', name: 'A', cap: 'video', form: 'async-task', modelInBody: false,
    model: 'kling-3.0', endpoint: `http://127.0.0.1:${port}/t2v`,
    auth: { type: 'bearer', keyRef: 'env:RH_TEST_KEY' },
    extraHeaders: { 'X-DashScope-Async': 'enable' },
    submitBody: { prompt: '{{prompt}}', settings: { duration: 5, aspect_ratio: '{{aspect_ratio}}', audio: 'off' } },
    taskIdPath: 'data.id', statePath: 'data.0.status', doneWhen: ['succeed'], failWhen: ['failed'],
    pollEndpoint: `http://127.0.0.1:${port}/tasks?task_ids={{id}}`,
    resultPath: 'data.0.outputs.0.url',
    pollMs: 10,
  };
  const out = await runCapability(rec, { prompt: '一个海浪' }, { outDir: await tmp(), timeoutMs: 3000 });
  server.close();
  assert.equal(seen.length, 1);
  assert.ok(!('model' in seen[0].body), 'modelInBody:false 时不该往 body 里塞 model');
  assert.equal(seen[0].body.prompt, '一个海浪');
  assert.equal(seen[0].body.settings.duration, 5);
  assert.ok(!('aspect_ratio' in seen[0].body.settings), '没传的占位符该被剪掉');
  assert.equal(out.ok, true);
  assert.equal(out.meta.taskId, 'task-1');
});

test('目录按能力分组后仍能按 vendor/model 找到（setup 那条路没断）', () => {
  assert.ok(Array.isArray(CATALOG) && CATALOG.length);
  for (const v of CATALOG) {
    assert.ok(v.vendorName && v.models.length);
    for (const m of v.models) assert.ok(m.form);
  }
});

test('multipart + Accept 头：拿得到二进制文件，且不带 JSON 的 content-type', async () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  let seen = null;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen = { ctype: req.headers['content-type'] || '', accept: req.headers.accept || '', raw: Buffer.concat(chunks) };
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  process.env.RH_TEST_KEY = 'dummy';

  const rec = {
    id: 'mp', name: 'M', cap: 'image', form: 'sync-generate', modelInBody: false,
    model: 'core', endpoint: `http://127.0.0.1:${port}/gen`,
    auth: { type: 'bearer', keyRef: 'env:RH_TEST_KEY' },
    bodyType: 'multipart',
    extraHeaders: { accept: 'image/*' },
    responseType: 'binary',
    fileExt: 'png',
    bodyTemplate: { prompt: '{{prompt}}', aspect_ratio: '{{aspect_ratio}}' },
  };
  const out = await runCapability(rec, { prompt: '灯塔', aspect_ratio: '21:9' }, { outDir: await tmp(), timeoutMs: 5000 });
  server.close();
  assert.ok(seen, '没发出请求');
  assert.ok(seen.ctype.startsWith('multipart/form-data'), '该是 multipart，实际：' + seen.ctype);
  assert.equal(seen.accept, 'image/*', 'Accept 头没带上 —— 不带就只能拿到 base64 JSON');
  const body = seen.raw.toString('utf8');
  assert.ok(body.includes('灯塔'), '表单里没有 prompt');
  assert.ok(body.includes('21:9'));
  assert.ok(!body.includes('"model"'), 'modelInBody:false 时不该出现 model');
  assert.equal(out.files.length, 1);
  assert.ok(out.files[0].endsWith('.png'));
  assert.equal((await readFile(out.files[0])).length, PNG.length, '落盘的不是原图');
});

test('pollUrlPath：轮询用响应里给的那条地址，不自己拼', async () => {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'POST' && req.url === '/submit') {
        res.end(JSON.stringify({ id: 'x1', polling_url: `http://127.0.0.1:${server.address().port}/poll/x1?token=abc` }));
        return;
      }
      res.end(JSON.stringify({ status: 'Ready', result: { sample: null } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  process.env.RH_TEST_KEY = 'dummy';

  const rec = {
    id: 'bflish', name: 'B', cap: 'image', form: 'async-task', model: 'm',
    endpoint: `http://127.0.0.1:${port}/submit`,
    auth: { type: 'bearer', keyRef: 'env:RH_TEST_KEY' },
    submitBody: { prompt: '{{prompt}}' },
    taskIdPath: 'id', pollUrlPath: 'polling_url',
    statePath: 'status', doneWhen: ['Ready'], failWhen: ['Error'],
    resultPath: 'result.sample', pollMs: 10,
  };
  await runCapability(rec, { prompt: '猫' }, { outDir: await tmp(), timeoutMs: 3000 });
  server.close();
  assert.ok(hits.includes('/poll/x1?token=abc'), '没按响应给的 polling_url 去轮询：' + hits.join(','));
  assert.ok(!hits.some((u) => u.includes('/tasks/')), '不该自己拼轮询地址');
});

test('extraHeaders 支持 {{uuid}}：每次请求都是新值', async () => {
  const keys = [];
  let port = 0;
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end(Buffer.from('fake-mp3'));
      return;
    }
    keys.push(req.headers['idempotency-key'] || '');
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ audio_url: `http://127.0.0.1:${port}/a.mp3` }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  process.env.RH_TEST_KEY = 'dummy';

  const rec = {
    id: 'idem', name: 'I', cap: 'music', form: 'sync-generate', model: 'm',
    endpoint: `http://127.0.0.1:${port}/music`,
    auth: { type: 'bearer', keyRef: 'env:RH_TEST_KEY' },
    extraHeaders: { 'Idempotency-Key': '{{uuid}}' },
    bodyTemplate: { prompt: '{{prompt}}' },
    resultPath: 'data.0.audio_url',
  };
  try {
    await runCapability(rec, { prompt: '夏日' }, { outDir: await tmp(), timeoutMs: 5000 });
    await runCapability(rec, { prompt: '夏日' }, { outDir: await tmp(), timeoutMs: 5000 });
  } finally {
    server.close();
  }
  assert.equal(keys.length, 2);
  assert.ok(keys[0] && keys[1], 'Idempotency-Key 没带上');
  assert.ok(/^[\w.:-]{6,}$/.test(keys[0]), '格式不像幂等键：' + keys[0]);
  assert.notEqual(keys[0], keys[1], '两次请求用了同一个幂等键 —— 会被服务端当成重试');
});
