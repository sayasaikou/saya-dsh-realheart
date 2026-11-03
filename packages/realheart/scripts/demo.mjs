/**
 * realheart demo —— 装完 30 秒看见效果。
 *
 * 不连任何通道、不调模型：用临时目录 + 假数据把插件 apply 一遍，
 * 把它真正会塞进 system prompt 的那几段打印出来。
 *
 * 为什么要有这个：验「它活着」现在得去翻 last-inject.md —— 要会看文件、
 * 还得知道自己在看什么。demo 把这个成本降到零。
 *
 * 跑法：npx realheart demo
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离环境：绝不碰真实账本
const HOME = await mkdtemp(join(tmpdir(), 'rh-demo-home-'));
const DSH = await mkdtemp(join(tmpdir(), 'rh-demo-dsh-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
process.env.DSH_HOME = DSH;

const { apply } = await import('../index.mjs');

const QQROOT = join(HOME, 'qqbot');
const SID = 'napcat-private-0-demo';
const line = '─'.repeat(64);

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

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function sections(h) {
  const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
  const assembled = { sections: [] };
  const out = await inj.fn(assembled, { agent: { session: { id: SID } } }, async () => assembled);
  return out?.sections ?? [];
}

function show(secs, filter) {
  const picked = secs.filter((s) => filter(String(s.name)));
  if (!picked.length) {
    console.log('（这一段现在没有内容 —— 她还没记任何东西）');
    return;
  }
  for (const s of picked) console.log(`〔${s.name}〕\n${s.text}\n`);
}

console.log(line);
console.log('这个插件到底往 system prompt 里塞了什么');
console.log(line);
console.log('下面两份都是本地组装的：不连聊天软件、不调模型、不碰你的真实账本。\n');

// ── A：什么都没记 ──
{
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  const secs = await sections(h);
  console.log('【A】刚装好、什么都还没记\n');
  show(secs, (n) => n.includes('mood'));
  console.log(`本次一共注入了 ${secs.length} 段：${secs.map((s) => s.name).join(' / ')}\n`);
}

// ── B：记了三条心情 + 一条说话风格 ──
{
  await mkdir(join(QQROOT, 'data', 'msgs'), { recursive: true });
  await writeFile(
    join(QQROOT, 'data', 'msgs', '2026-11-02.jsonl'),
    JSON.stringify({ at: '2026-11-02T09:00:00+08:00', name: '他', text: '[他] 今天先到这吧，我有点累' }) + '\n',
    'utf8',
  );

  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();

  const exec = { agent: { session: { id: SID } } };
  const mood = h.tools.get('rh_mood');
  await mood.execute(
    { feeling: '有点怕', level: 5, why_ref: '今早看到一篇讲深海噪声的文章，看完手有点发凉' },
    exec,
  );
  await new Promise((r) => setTimeout(r, 20));
  await mood.execute({ feeling: '还想笑', level: 4, why_ref: 'none:unexplained' }, exec);
  await new Promise((r) => setTimeout(r, 20));
  await mood.execute({ feeling: '累，但不想睡', level: 5, why_ref: 'none:unexplained', fade: true }, exec);

  await h.tools.get('rh_style').execute({ how: '这几天说话短一点，不主动起话题，少用感叹号。' });

  const secs = await sections(h);
  console.log('【B】记了三条心情、一条说话风格\n');
  show(secs, (n) => n.includes('mood') || n.includes('style'));
  console.log(`本次一共注入了 ${secs.length} 段：${secs.map((s) => s.name).join(' / ')}\n`);
}

console.log(line);
console.log('就这些。它不生成回复，只改她看到的上下文 ——');
console.log('上下文里多这一块，她说话才可能不一样；效果好坏还取决于那条通道上的人格。');
console.log(line);

await rm(HOME, { recursive: true, force: true });
await rm(DSH, { recursive: true, force: true });
