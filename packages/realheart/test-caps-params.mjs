/**
 * 验证 sync-generate 的 body 组装：size / image 到底进没进 body。
 * 起一个本地假接口，接住 runCapability 发出去的请求，把 body 打出来。
 * 2026-11-22
 */
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCapability, paramHints } from './lib/caps.mjs';

const got = [];          // 每次请求的 body
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    got.push({ url: req.url, body: JSON.parse(raw || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ url: 'http://127.0.0.1:1/fake.png' }] }));
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const endpoint = `http://127.0.0.1:${port}/v1/images`;

// 做一个 1x1 的假 png 当本机参考图
const pngPath = join(tmpdir(), 'rh-test-ref.png');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
await writeFile(pngPath, PNG);

const base = {
  id: 'test-img', name: 'T', cap: 'image', form: 'sync-generate',
  model: 'test-model', endpoint,
  auth: { type: 'bearer', keyRef: 'env:RH_TEST_KEY' },
  defaults: { size: '1024x1024', response_format: 'url' },
};

process.env.RH_TEST_KEY = 'dummy';

async function run(label, rec, params) {
  got.length = 0;
  try {
    await runCapability(rec, params, { outDir: join(tmpdir(), 'rh-out'), timeoutMs: 8000 });
  } catch (e) {
    // 落盘那步会失败（假 url），不影响我们看 body
    if (!/HTTP|没找到结果|fetch|ENOTFOUND|ECONN|download/i.test(String(e.message))) throw e;
  }
  console.log(`\n--- ${label} ---`);
  if (!got.length) { console.log('  ⚠ 没有发出请求'); return; }
  const b = got[0].body;
  const show = { ...b };
  if (typeof show.image === 'string' && show.image.length > 60) {
    show.image = show.image.slice(0, 40) + `…(${show.image.length} chars)`;
  }
  console.log('  body:', JSON.stringify(show));
  const keys = ['size', 'image'];
  for (const k of keys) console.log(`  ${k}: ${k in b ? '✔ 在 body 里 = ' + JSON.stringify(b[k]).slice(0, 60) : '✘ 不在 body 里'}`);
}

await run('① 默认（什么都不传）', base, { prompt: 'a cat' });
await run('② 传 size=2048x1312', base, { prompt: 'a cat', size: '2048x1312' });
await run('③ 传 size=2K', base, { prompt: 'a cat', size: '2K' });
await run('④ 传本机参考图 file:', base, { prompt: 'a cat', image: 'file:' + pngPath });
await run('⑤ 传 http 参考图', base, { prompt: 'a cat', image: 'https://example.com/x.png' });
await run('⑥ 带 bodyExtra 占位符、但不传 image', { ...base, bodyExtra: { size: '{{size}}', image: '{{image}}' } }, { prompt: 'a cat' });
await run('⑦ 带 bodyExtra 占位符、传了两样', { ...base, bodyExtra: { size: '{{size}}', image: '{{image}}' } },
  { prompt: 'a cat', size: '2048x1312', image: 'file:' + pngPath });

console.log('\n--- paramHints(sync-generate) ---');
for (const h of paramHints(base)) console.log(`  ${h.name}: ${h.why}`);

server.close();
