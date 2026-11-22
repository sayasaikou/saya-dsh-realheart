/**
 * rh_capabilities / rh_call 这两个工具的**输出**（2026-11-22）。
 *
 * 为什么要单独测输出：那次改的是「给 agent 看什么」，而 agent 只看得到这段文字 ——
 * 结构对不对、字段有没有真渲染出来，只有把工具真跑一遍才算数。
 * 光测 caps.mjs 里的函数，改坏了渲染照样全绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_HOME = await mkdtemp(join(tmpdir(), 'rh-caps-tool-home-'));
const DSH = await mkdtemp(join(tmpdir(), 'rh-caps-tool-dsh-'));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
process.env.DSH_HOME = DSH;

const { apply } = await import('../index.mjs');

function makeCtx() {
  const tools = new Map();
  const handlers = [];
  return {
    tools,
    handlers,
    ctx: {
      logger: { info: () => {}, error: () => {} },
      get: (n) => (n === 'tools' ? { register: (d) => tools.set(d.name, d) } : undefined),
      on: (name, fn, opts) => handlers.push({ name, fn, opts }),
    },
  };
}

const h = makeCtx();
apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
await new Promise((r) => setTimeout(r, 400));
const caps = h.tools.get('rh_capabilities');
const call = h.tools.get('rh_call');

test('rh_capabilities 挂上了', () => {
  assert.ok(caps, 'rh_capabilities 没注册');
  assert.ok(call, 'rh_call 没注册');
});

test('list：分组、可用标记、价格、输入→输出都在', async () => {
  const { text } = await caps.execute({ action: 'list' });
  assert.ok(text.includes('外部能力'), text.slice(0, 200));
  assert.ok(text.includes('【image】'), '没按能力分组');
  assert.ok(text.includes('【video】'));
  assert.ok(text.includes('【tts】'));
  assert.ok(/✓ 可用|缺 key\(/.test(text), '没有可用性标记');
  assert.ok(text.includes('id=ark-image-flash'), '老的 id 不能丢（别人记的是这个）');
  assert.ok(/元\/张|美元\/张|价格未录/.test(text));
  assert.ok(text.includes('→'), '该给出输入→输出');
});

test('list cap=image：把能传的参数和硬限制摊开', async () => {
  const { text } = await caps.execute({ action: 'list', cap: 'image' });
  assert.ok(text.includes('传:'), '没列参数');
  assert.ok(text.includes('prompt'), 'prompt 该在参数里');
  assert.ok(text.includes('限:'), '没列硬限制');
  assert.ok(!text.includes('【video】'), 'cap 过滤没生效');
});

test('get：规格卡给全（输入输出/限制/文档/没核实的）', async () => {
  const { text } = await caps.execute({ action: 'get', id: 'dashscope-wan-t2i' });
  assert.ok(text.includes('规格：'), text.slice(0, 300));
  assert.ok(text.includes('输入：'));
  assert.ok(text.includes('输出：'));
  assert.ok(text.includes('限制：'));
  assert.ok(text.includes('官方文档：https://'), '官方文档链接要能被点开');
  assert.ok(text.includes('计价原文：'), '价格原话要留着');
  assert.ok(text.includes('没核实到的：'), '没核到的要明说，不能装成结论');
  assert.ok(text.includes('怎么调'), '该给可照抄的调用骨架');
  assert.ok(text.includes('"prompt"'), '骨架里该有 prompt');
  assert.ok(text.includes('2121') === false);
});

test('get：调不了的那条要说清为什么', async () => {
  const { text } = await caps.execute({ action: 'get', id: 'dashscope-cosyvoice-tts' });
  assert.ok(text.includes('调不了'), '不说明白，agent 会一直试');
  assert.ok(text.includes('WebSocket'));
});

test('rh_call：调不了的那条当场拒，不发出请求', async () => {
  const r = await call.execute({ id: 'dashscope-cosyvoice-tts', params: { text: '你好' } });
  assert.ok(r.text.includes('调不了'));
  // 真发出去的话会出现 HTTP 状态码或「已提交」这类回执
  assert.ok(!/HTTP [45]\d\d/.test(r.text), '不该真去发请求：' + r.text);
  assert.ok(!r.text.includes('已提交'), '不该真去提交任务');
  assert.ok(r.text.includes('list cap=tts'), '该指一条能用的路');
});

test('pricing：单位说法统一（千字符不会被说成千 token）', async () => {
  const { text } = await caps.execute({ action: 'pricing' });
  assert.ok(text.includes('内置价目表'));
});

test('收尾：清临时目录', async () => {
  await rm(FAKE_HOME, { recursive: true, force: true });
  await rm(DSH, { recursive: true, force: true });
  assert.ok(true);
});
