/**
 * realheart-self —— 给「我自己的东西」一个能装能卸的形状
 *
 * 这是**模板**，不是成品。别人家 agent 该照着它长自己那份，不是照抄。
 *
 * 两个工具：
 *   voice_say   说话出声（调 TTS）
 *   piece_save  把做出来的东西存成一件作品
 *
 * ── 边界（写在这里，免得以后又糊掉）──
 * · 只管「怎么出声」，不管「什么时候出声」。什么时候说话是它的判断，插件不给默认。
 * · 不存 key。key 留在 env 文件里，插件只读环境变量；读不到就报错，不静默退回。
 * · 合成出来的文件是临时的。声音是通道，不是作品；想留下的声音走 piece_save 存成作品。
 *   （2026-10-28 沙耶定的：临时扔。）
 *
 * ── 为什么默认值都留空 / 指向 $HOME ──
 * 第一版把 `/home/ubuntu/...` 写死在里面 —— 那台机器上能跑，换一台就全错，
 * 而且错得很难看：路径不存在时它只是「保存失败」，看不出是路径问题。
 * 现在一律从 homedir() 推。真要改，改配置。
 */

import Schema from '@deepseek-ai/schemastery';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

const API = 'https://api.minimax.chat/v1/t2a_v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = os.homedir();

const DEFAULTS = {
  model: 'speech-2.8-turbo',
  // ⚠️ 这是示例音色（minimax 的）。**换上你自己那个** —— 换一个声音，就是换一个人。
  voice: 'feiyu_g2',
  emotion: 'happy',
  speed: 0.95,
  envFile: join(HOME, '.qqbot-keys', 'env'),
  tmpDir: join(os.tmpdir(), 'realheart-voice'),
  keepMs: 60 * 60 * 1000,
  piecesDir: join(HOME, 'qqbot', 'work', 'pieces'),
};

export const name = 'realheart-self';

export const Config = Schema.object({
  model: Schema.string().default(DEFAULTS.model),
  voice: Schema.string().default(DEFAULTS.voice),
  emotion: Schema.string().default(DEFAULTS.emotion),
  speed: Schema.number().default(DEFAULTS.speed),
  envFile: Schema.string().default(DEFAULTS.envFile),
  tmpDir: Schema.string().default(DEFAULTS.tmpDir),
  keepMs: Schema.number().default(DEFAULTS.keepMs),
  piecesDir: Schema.string().default(DEFAULTS.piecesDir),
});

/** 从 env 文件补进 process.env，只补没设过的（跟 python 那版一致） */
async function loadEnv(file) {
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

/** 合成一段话，返回本地 mp3 路径。key 缺失就抛，不退回、不静默。 */
export async function synthesize(text, opts = {}, cfg = DEFAULTS) {
  const body = String(text ?? '').trim();
  if (!body) throw new Error('voice_say: 没给文字');

  await loadEnv(cfg.envFile ?? DEFAULTS.envFile);
  const key = process.env.MINIMAX_API_KEY ?? '';
  if (!key) {
    throw new Error(
      `voice_say: 没有 MINIMAX_API_KEY（找过环境变量和 ${cfg.envFile ?? DEFAULTS.envFile}）`,
    );
  }

  const payload = {
    model: opts.model ?? cfg.model,
    text: body,
    stream: false,
    voice_setting: {
      voice_id: opts.voice ?? cfg.voice,
      speed: opts.speed ?? cfg.speed,
      vol: 1.0,
      pitch: 0,
      emotion: opts.emotion ?? cfg.emotion,
    },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  };

  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`voice_say: HTTP ${res.status}`);
  const data = await res.json();
  const hex = (data?.data?.audio ?? '');
  if (!hex) {
    const why = JSON.stringify(data?.base_resp ?? {}, { });
    throw new Error(`voice_say: 合成失败 ${why}`);
  }

  const dir = cfg.tmpDir ?? DEFAULTS.tmpDir;
  await mkdir(dir, { recursive: true });
  await prune(dir, cfg.keepMs ?? DEFAULTS.keepMs);

  const file = join(dir, `voice-${Date.now()}-${randomBytes(3).toString('hex')}.mp3`);
  const buf = Buffer.from(hex, 'hex');
  await writeFile(file, buf);
  return { path: file, bytes: buf.length };
}

/**
 * 存一件作品：建目录、写 README 骨架、把源文件拷进去。
 * 只做搬运，不做渲染——"做成什么"是她的判断，不是插件的事。
 */
export async function savePiece(name, files = [], note = '', cfg = DEFAULTS) {
  const raw = String(name ?? '').trim();
  if (!raw) throw new Error('piece_save: 没给名字');
  // 目录名只留字母数字和连字符，中文照样保留（不要 latin 化）
  const slug = raw.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'piece';
  const day = new Date().toISOString().slice(0, 10);
  const root = cfg.piecesDir ?? DEFAULTS.piecesDir;
  const dir = join(root, `${slug}-${day}`);

  await mkdir(dir, { recursive: true });

  const copied = [];
  for (const src of files) {
    const from = String(src);
    const base = from.split('/').pop();
    const to = join(dir, base);
    try {
      const buf = await readFile(from);
      await writeFile(to, buf);
      copied.push(base);
    } catch (error) {
      copied.push(`${base}（没拷进来：${error instanceof Error ? error.message : String(error)}）`);
    }
  }

  const readme = join(dir, 'README.md');
  try {
    await stat(readme);
  } catch {
    const lines = [
      `# ${raw}`,
      '',
      `- 日期：${day}`,
      `- 做了什么：${note || '（待补）'}`,
      '',
      '## 文件',
      '',
      ...(copied.length ? copied.map((f) => `- ${f}`) : ['- （还没有文件）']),
      '',
    ];
    await writeFile(readme, lines.join('\n'), 'utf8');
  }

  return { dir, copied, readme };
}

/** 临时目录不攒垃圾：超过 keepMs 的删掉 */
async function prune(dir, keepMs) {
  const now = Date.now();
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const n of names) {
    if (!n.endsWith('.mp3')) continue;
    const p = join(dir, n);
    try {
      const st = await stat(p);
      if (now - st.mtimeMs > keepMs) await unlink(p);
    } catch {
      /* 删不掉就算了，不值得为它报错 */
    }
  }
}

async function waitForTools(ctx, tries = 40, gapMs = 250) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const tools = ctx.get('tools');
      if (tools?.register) return tools;
    } catch {
      /* 还没就绪 */
    }
    await sleep(gapMs);
  }
  return undefined;
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const log = (msg, level = 'info') => {
    try {
      ctx.logger?.[level]?.(msg);
    } catch {
      /* 没有 logger 就安静 */
    }
  };

  // 不依赖 ready 事件名（realheart 那边也没用，直接起跑）；register 之前先等 tools 就绪。
  void (async () => {
    const tools = await waitForTools(ctx);
    if (!tools) {
      log('tools 服务一直没就绪，voice_say 未注册', 'error');
      return;
    }

    tools.register({
      name: 'voice_say',
      description:
        '把一段话读出来，生成 mp3，返回本地路径。只管出声，不管发不发——发不发由你决定。'
        + '合成结果是临时文件（一小时左右清掉），想留下就另存成作品。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要读出来的话' },
          emotion: { type: 'string', description: `情绪，默认 ${DEFAULTS.emotion}` },
          speed: { type: 'number', description: `语速，默认 ${DEFAULTS.speed}` },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args) {
        try {
          const { path, bytes } = await synthesize(args?.text, {
            emotion: args?.emotion,
            speed: args?.speed,
          }, cfg);
          return { text: `（音频好了：${path}，${(bytes / 1024).toFixed(0)} KB。发不发你定。）` };
        } catch (error) {
          return { text: `（没合成出来：${error instanceof Error ? error.message : String(error)}）` };
        }
      },
    });

    tools.register({
      name: 'piece_save',
      description:
        '存一件作品：在 work/pieces/<名字>-<日期>/ 下建目录、写 README 骨架、把给的源文件拷进去。'
        + '只搬运不渲染——做成什么是你的事。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '作品名，会变成目录名' },
          files: { type: 'array', items: { type: 'string' }, description: '要一起存进去的本地文件路径' },
          note: { type: 'string', description: '一句话：这是什么' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args) {
        try {
          const r = await savePiece(args?.name, args?.files ?? [], args?.note ?? '', cfg);
          const list = r.copied.length ? r.copied.join('、') : '（没有文件）';
          return { text: `（存好了：${r.dir}\n  文件：${list}）` };
        } catch (error) {
          return { text: `（没存成：${error instanceof Error ? error.message : String(error)}）` };
        }
      },
    });

    log('voice_say / piece_save 已注册');
  })();
}
