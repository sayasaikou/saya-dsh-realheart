/**
 * 第二步：为什么记了心情，注入里却没有 mood 段？
 * 把每次 execute 的返回值打出来。
 */
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = await mkdtemp(join(tmpdir(), 'rh-exp2-home-'));
const DSH = await mkdtemp(join(tmpdir(), 'rh-exp2-dsh-'));
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

const r1 = await mood.execute(
  { feeling: '有点怕', level: 5, why_ref: '今早看到一篇讲深海噪声的文章，看完手有点发凉' },
  exec,
);
console.log('第 1 次写入 →', JSON.stringify(r1.text));

const r2 = await mood.execute({ feeling: '还想笑', level: 4, why_ref: 'none:unexplained' }, exec);
console.log('第 2 次写入 →', JSON.stringify(r2.text));

const r3 = await mood.execute({ feeling: '累，但不想睡', level: 5, why_ref: 'none:unexplained', fade: true }, exec);
console.log('第 3 次写入 →', JSON.stringify(r3.text));

const raw = await readFile(join(STATE, 'mood.jsonl'), 'utf8').catch(() => '(没有 mood.jsonl)');
console.log('\n账本内容：');
console.log(raw);

const ctl = await readFile(join(STATE, 'control.jsonl'), 'utf8').catch(() => '(没有 control.jsonl)');
console.log('\n控制账本：');
console.log(ctl);

const inj = h.handlers.find((x) => x.name === 'system-prompt/assemble');
const assembled = { sections: [] };
const out = await inj.fn(assembled, { agent: { session: { id: SID } } }, async () => assembled);
console.log('\n注入段落名：', (out?.sections ?? []).map((s) => s.name).join(' / '));
for (const s of out?.sections ?? []) {
  if (String(s.name).includes('mood')) console.log(`\n[${s.name}]\n${s.text}`);
}
console.log('\n最新的 last-inject：');
console.log(await readFile(join(STATE, 'last-inject.md'), 'utf8').catch(() => '(没有)'));

await rm(HOME, { recursive: true, force: true });
await rm(DSH, { recursive: true, force: true });
