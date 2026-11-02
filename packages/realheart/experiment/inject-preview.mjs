/**
 * 离线实验：把她的真实注入组装出来，看心情那一段到底长什么样。
 *
 * 不碰她、不调模型 —— 只用假数据跑 apply，把 system-prompt 段落打印出来。
 * 跑法：node experiment/inject-preview.mjs
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = await mkdtemp(join(tmpdir(), 'rh-exp-home-'));
const DSH = await mkdtemp(join(tmpdir(), 'rh-exp-dsh-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
process.env.DSH_HOME = DSH;

const { apply } = await import('../index.mjs');

const QQROOT = join(HOME, 'qqbot');
const STATE = join(QQROOT, 'work', 'realheart');
const SID = 'napcat-private-1418499574-exp';

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

// ── 情况 A：什么都没记（她现在的实际状态）──
{
  const h = makeCtx();
  apply(h.ctx, { servePage: false, freeTime: false, announceOnInstall: false });
  await settle();
  const secs = await sections(h);
  console.log('\n========== A · 没有心情时的注入 ==========\n');
  for (const s of secs) {
    if (String(s.name).includes('mood')) console.log(`[${s.name}]\n${s.text}\n`);
  }
  const names = secs.map((s) => s.name).join(' / ');
  console.log('（本次注入了这几段：' + names + '）');
}

// ── 情况 B：记了三条心情 + 一条 style ──
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
  console.log('\n========== B · 有心情（3 条）+ style 时的注入 ==========\n');
  for (const s of secs) {
    if (String(s.name).includes('mood') || String(s.name).includes('style')) {
      console.log(`[${s.name}]\n${s.text}\n`);
    }
  }
  const names = secs.map((s) => s.name).join(' / ');
  console.log('（本次注入了这几段：' + names + '）');
}

await rm(HOME, { recursive: true, force: true });
await rm(DSH, { recursive: true, force: true });
