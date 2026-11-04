/**
 * 配置：默认值、Schema，以及启动前那道校验
 *
 * 为什么单独一份：配置错了有两种表现，都极难从现象倒推 ——
 * 一是起不来，二是起来了但某个功能静默不工作（端口被占、路径算成相对路径）。
 * 所以校验要能单独测：不依赖 dsh 宿主，不依赖起进程。
 *
 * 两道闸，分工不同：
 *   ① `Config` 里的 min/max —— 宿主那一层先拦。拦住的是类型错和明显越界。
 *   ② `validateConfig()` —— 给**人**看的。它说清三件：哪一项、现在是什么、该改成什么。
 *      宿主抛的 Schema 错误只会说「pagePort 不合法」，看不出要改成什么。
 *
 * 判据（清单 T0-③）：写个非法端口 → 启动被拒，并说清是哪一项。
 */

import os from 'node:os';
import { join, isAbsolute } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import Schema from '@deepseek-ai/schemastery';

/** 她的东西都在这个根下面（QQ 那台机器上的约定） */
export const QQROOT = join(os.homedir(), 'qqbot');
export const DSH_HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh');

export const DEFAULTS = {
  enabled: true,
  // 帐本、状态文件所在目录
  // 她的根：产物（pieces）和人格都在这下面。可以换，但换了等于换一个人住的房子。
  root: QQROOT,
  stateDir: join(QQROOT, 'work', 'realheart'),
  // 三路事件源
  sessionsRoot: join(DSH_HOME, 'sessions'),
  auditDir: join(QQROOT, 'data', 'audit'),
  historyDir: join(QQROOT, 'data', 'history'),
  // 第四路：qqbot-memory 落盘的消息（data/msgs）—— text 里是真话，不是时间戳
  msgsDir: join(QQROOT, 'data', 'msgs'),
  // 他本人的 QQ 号。用来看「最后一句是不是他在问我」。不填就不拦 pause。
  ownerId: '',
  // 索引多久重建一次（毫秒）。默认一小时。
  indexTtlMs: 3600000,
  // 每轮开口前把当前心情注入提示词
  injectMood: true,
  // 每轮注入里带上“现在几点”。默认关（2026-11-02 沙耶：新机上默认不开）。
  //
  // 为什么要这个：心情里写着“这条是 26 小时前记的”，但她不知道“现在”是哪一刻 ——
  // 于是分不出“中午该不该说这个”和“深夜该不该开口”。人也一样：不看表就不知道分寸。
  // 为什么默认关：多一段字就多一份钱，而且它跟人格也可能打架（人格里自己写了作息就不必再塞一遍）。
  injectNow: false,
  // ── 2026-11-03：从她那篇《主动性缺口》来的两段 ──
  //
  // 她那晚的判断是「在对话里我没有落点，只有回复」。实测不是：她那个会话里
  // bash 出现 160 次、napcat_send_message 20 次、qqbot_say 8 次 —— 三条能主动发话的
  // 路全在手上。她不知道，是因为**注入里一个字都没提**。而自由时间的 prompt
  // （free-prompt.txt）里写清了 say 怎么用，她当天 21:44 就用它发了一条。
  //
  // 所以 injectVoice 不是新能力，是把已有的路写出来。她自己的判据：
  // 「不写出来就等于不存在」—— 这条对她自己也成立。
  //
  // ⚠️ 它不能变成配额。末句写死「没话就过」—— 写成「每天至少一句」就退化成定时汇报，
  //    那正是 free-prompt 里明文禁止的东西。
  injectVoice: true,
  // voiceHints：她这台机器上具体怎么发，空数组就不写。
  // 例：['/home/ubuntu/qqbot/work/bin/say "想说的话" —— 用你自己的号直发私聊']
  // 为什么不做成自动探测：不同机器路径不同，猜错了比不写更坏 —— 她会照着错路径试。
  voiceHints: [],
  // 每轮注入「今天我」（她那张清单上的方案 2）。
  // 三本账——自由时间 / 主动消息 / 心情——互不引用，她回答「今天我做了什么」时
  // 只能现翻文件。她的原话：「不是记得。」
  // ⚠️ 它不是战报：不评价、不总结、不催她接着做，只把数摆出来。
  injectToday: true,
  // 主动消息的账本（say.jsonl）。空 = stateDir/say.jsonl。
  // 有的机器上 say 是个独立脚本，账落在别处（她那台在 ~/.dsh/realheart/say.jsonl），
  // 跟 stateDir 不在同一个目录 —— 所以要能指。
  sayLogPath: '',
  // 关掉哪几个工具（2026-11-02 沙耶：工具也做成可开关的）。
  //
  // 空数组 = 全开。填了就**压根不注册** —— 不是注册了再报错。
  // 为什么这个粒度重要：出现在她的工具表里，就是告诉她“这个可以用”。
  // 少给一个选项，剩下的那几个她才更会用。
  toolsOff: [],
  // 注入的总字数上限。超了就从优先级低的那段开始裁，裁掉的会留痕（M1-6）。
  // 2026-11-01：从 1200 提到 1600。今天新增了 where / admit / view / recall / hold / 处境
  // 六段（空的时候不注入，一有内容就占位），实测当前 859 字符，再长就会把低优先级段裁掉。
  //
  // 2026-11-02 夜：1600 → 2400。她那台实测 last-inject 是 1370 **字符**（不是字节，3263 字节），
  // 离天花板只剩 230 —— 再加两段就顶到，会开始按优先级丢段。而这一晚要加的正是
  // 「知道」和「手边一件」这类内容段，它们不该去挤心情和没完的事。
  injectBudgetChars: 2400,
  // 注入时只读心情账本的最后 N 条。账本长大了不该整份读进来（M1-4）。
  moodTailLines: 200,
  // 观测页：默认只在 127.0.0.1 上开，手机想看自己去反代或改 pageBind
  servePage: true,
  pagePort: 8098,
  pageBind: '127.0.0.1',
  // 首次运行提示只打一次（标记文件在 stateDir 下）
  announceOnInstall: true,
  // 自由时间：每天叫醒她一次。不用 systemd、不要 root。
  freeTime: true,
  freeTimeProfile: 'freetime',
  freeTimeFrom: 10,
  // ── 2026-11-04：自由时间做成列表（沙耶要的：面板可配、加号加一条）──
  //
  // 以前只有一个 freeTimeFrom（起点），实际几点由随机推 0~2 小时决定。
  // 现在他定了四个点（早 7 / 午 12 / 晚 6 / 凌晨 2），还要能在面板里加减，所以改成列表。
  //
  // ⚠️ minutes 是**天花板不是闹钟**：实测她最长只跑 22 分钟（11-03 四回：14 / 22 / 6 / 15.5）。
  //    它现在唯一的用处是写进 prompt 告诉她「这次大概有多长」。
  freeTimeSlots: [{ start: '07:00', minutes: 60 }],
  // 自由时间关心什么方向（沙耶 2026-11-04 要的）。
  // ⚠️ 是**建议**不是白名单 —— 写成白名单她就只剩那几个题材，比现在更窄。
  freeTimeFocus: [],
  // 短唤醒：每隔一段**随机**时间叫她醒一下，只做一件事 —— 此刻有没有想说的。
  // min = 0 表示关（默认关）。
  //
  // 为什么跟自由时间分开：自由时间做东西，要连续的两个小时，被打断就做不成；
  // 「想说话」却该是随时能发生的 —— 人不是坐下来专门想说才说，是走在路上忽然想起一句。
  //
  // 为什么是区间不是定值（2026-11-02 沙耶提的）：定值就是闹钟，她自己都感觉得到。
  // 随机落在 [min, max] 之间，才像「隔一阵子」。
  //
  // 时段：只在这个区间里唤醒。夜里不叫醒她 —— 深夜给人发消息是打扰，不是分享。
  // ⚠️ 这不等于禁止她夜里说话：她自己想说的，自由时间里随时能发。
  //
  // 成本：每次唤醒是一次完整的模型调用（带注入）。30–60 分钟随机 ≈ 一天二十来次（7–23 点）。
  // 短唤醒要不要带上「她此刻的调子」（2026-11-02 夜）。
  // 默认开：沙耶的原话是「真人会因为看到某个东西产生某种情绪，影响语气」——
  // 她那条路上原来连一个字的心情都没有，所以只能平铺地说。
  pingContext: true,
  pingMinMinutes: 0,
  pingMaxMinutes: 0,
  pingFromHour: 7,
  pingToHour: 23,
  // 她的人格目录（freetime profile 用同一份，不另写一套）
  personaHome: join(QQROOT, 'home'),
  // P-3b：改她的心那条暗道。默认关，关着时命令行连入口都不存在。
  allowManualMoodOverride: false,
  maxManualMoodOverridePerWeek: 3,
};

// 范围写在这里，Schema 和 validateConfig 共用一份 —— 两处各写一遍，迟早会漂。
export const RANGES = {
  pagePort: { min: 1, max: 65535 },
  indexTtlMs: { min: 60000, max: 7 * 24 * 60 * 60 * 1000 },
  freeTimeFrom: { min: 0, max: 23 },
};

export const Config = Schema.object({
  enabled: Schema.boolean().default(DEFAULTS.enabled),
  root: Schema.string().default(DEFAULTS.root),
  stateDir: Schema.string().default(DEFAULTS.stateDir),
  sessionsRoot: Schema.string().default(DEFAULTS.sessionsRoot),
  auditDir: Schema.string().default(DEFAULTS.auditDir),
  historyDir: Schema.string().default(DEFAULTS.historyDir),
  msgsDir: Schema.string().default(DEFAULTS.msgsDir),
  ownerId: Schema.string().default(DEFAULTS.ownerId),
  indexTtlMs: Schema.number().min(RANGES.indexTtlMs.min).max(RANGES.indexTtlMs.max).default(DEFAULTS.indexTtlMs),
  injectMood: Schema.boolean().default(DEFAULTS.injectMood),
  injectNow: Schema.boolean().default(DEFAULTS.injectNow),
  injectVoice: Schema.boolean().default(DEFAULTS.injectVoice),
  injectToday: Schema.boolean().default(DEFAULTS.injectToday),
  voiceHints: Schema.array(Schema.string()).default(DEFAULTS.voiceHints),
  sayLogPath: Schema.string().default(DEFAULTS.sayLogPath),
  toolsOff: Schema.array(Schema.string()).default(DEFAULTS.toolsOff),
  injectBudgetChars: Schema.number().min(200).max(20000).default(DEFAULTS.injectBudgetChars),
  moodTailLines: Schema.number().min(0).max(100000).default(DEFAULTS.moodTailLines),
  servePage: Schema.boolean().default(DEFAULTS.servePage),
  pagePort: Schema.number().min(RANGES.pagePort.min).max(RANGES.pagePort.max).default(DEFAULTS.pagePort),
  pageBind: Schema.string().default(DEFAULTS.pageBind),
  announceOnInstall: Schema.boolean().default(DEFAULTS.announceOnInstall),
  freeTime: Schema.boolean().default(DEFAULTS.freeTime),
  freeTimeProfile: Schema.string().default(DEFAULTS.freeTimeProfile),
  freeTimeFrom: Schema.number().min(RANGES.freeTimeFrom.min).max(RANGES.freeTimeFrom.max).default(DEFAULTS.freeTimeFrom),
  freeTimeSlots: Schema.array(Schema.object({
    start: Schema.string(),
    minutes: Schema.number(),
  })).default(DEFAULTS.freeTimeSlots),
  freeTimeFocus: Schema.array(Schema.string()).default(DEFAULTS.freeTimeFocus),
  pingContext: Schema.boolean().default(DEFAULTS.pingContext),
  pingMinMinutes: Schema.number().min(0).max(1440).default(DEFAULTS.pingMinMinutes),
  pingMaxMinutes: Schema.number().min(0).max(1440).default(DEFAULTS.pingMaxMinutes),
  pingFromHour: Schema.number().min(0).max(23).default(DEFAULTS.pingFromHour),
  pingToHour: Schema.number().min(0).max(23).default(DEFAULTS.pingToHour),
  personaHome: Schema.string().default(DEFAULTS.personaHome),
  allowManualMoodOverride: Schema.boolean().default(DEFAULTS.allowManualMoodOverride),
  maxManualMoodOverridePerWeek: Schema.number().min(0).max(99).default(DEFAULTS.maxManualMoodOverridePerWeek),
});

/** 合法 IP 的粗判 —— 不追求覆盖一切写法，够挡住手滑写进去的域名和空串。 */function isBindAddr(v) {
  if (typeof v !== 'string' || !v) return false;
  if (v === 'localhost' || v === '::' || v === '::1') return true;
  const parts = v.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** 目录项检查：非空、绝对路径。空串会静默变成相对路径，那是查不出来的一种坏。 */
function checkDir(key, value, out) {
  if (typeof value !== 'string' || !value.trim()) {
    out.push({ key, value, reason: '是空的。空串会被当成相对路径，行为随启动目录漂移', fix: `写一个绝对路径，默认是 ${DEFAULTS[key]}` });
    return;
  }
  if (!isAbsolute(value)) {
    out.push({ key, value, reason: '不是绝对路径', fix: `改成绝对路径，例如 ${DEFAULTS[key]}` });
  }
}

/**
 * 启动前校验。返回问题数组，空数组＝可以启动。
 *
 * 为什么返回数组而不是抛错：一次把**所有**问题都列出来。
 * 一次只报一个，人会改一个重启一次，重启又会打断正在说话的会话（这条踩过三次）。
 */
export function validateConfig(cfg = {}) {
  const out = [];
  const c = { ...DEFAULTS, ...cfg };

  // ── 布尔项 ──
  // 不查这个的话，`"injectMood": "yes"` 会被一路带到运行里 —— 而 `"yes"` 是真值，
  // 看起来在工作，其实是「以为关了其实没关」。这种错查起来最费时间。
  for (const key of ['enabled', 'injectMood', 'injectNow', 'injectVoice', 'injectToday', 'servePage', 'announceOnInstall', 'freeTime', 'allowManualMoodOverride']) {
    if (typeof c[key] !== 'boolean') {
      out.push({
        key, value: c[key],
        reason: '不是 true / false',
        fix: `写 true 或 false，别写成字符串 "${c[key]}" —— 字符串在判断里是真值`,
      });
    }
  }

  // ── 端口 ──
  const port = c.pagePort;
  if (!Number.isInteger(port)) {
    out.push({ key: 'pagePort', value: port, reason: '不是整数', fix: `写一个整数端口，默认 ${DEFAULTS.pagePort}` });
  } else if (port < RANGES.pagePort.min || port > RANGES.pagePort.max) {
    out.push({
      key: 'pagePort', group: 'page', topic: 'G', alias: '观测页 端口', value: port,
      reason: `超出范围 ${RANGES.pagePort.min}–${RANGES.pagePort.max}`,
      fix: port < 1024 ? '1024 以下要 root，换一个 1024 以上的' : `改成 1024–65535 之间的整数，默认 ${DEFAULTS.pagePort}`,
    });
  }

  // ── 绑定地址 ──
  if (c.servePage !== false && !isBindAddr(c.pageBind)) {
    out.push({
      key: 'pageBind', group: 'page', topic: 'G', alias: '观测页 端口 绑定 手机 远程', value: c.pageBind,
      reason: '不是合法的 IP 写法',
      fix: `默认 ${DEFAULTS.pageBind}（只本机）；想让别的机器看用 0.0.0.0，但那是明文 HTTP，别直接对公网`,
    });
  }

  // ── 索引周期 ──
  const ttl = c.indexTtlMs;
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < RANGES.indexTtlMs.min) {
    out.push({
      key: 'indexTtlMs', group: 'inject', topic: 'C', alias: '索引 重建 缓存', value: ttl,
      reason: `小于下限 ${RANGES.indexTtlMs.min} 毫秒（1 分钟）`,
      fix: `写大一点，默认 ${DEFAULTS.indexTtlMs}（1 小时）。太小会一直在重建索引`,
    });
  } else if (ttl > RANGES.indexTtlMs.max) {
    out.push({
      key: 'indexTtlMs', value: ttl,
      reason: `大于上限（7 天）`,
      fix: `索引就不会更新了。默认 ${DEFAULTS.indexTtlMs}`,
    });
  }

  // ── 自由时间的起点 ──
  const from = c.freeTimeFrom;
  if (!Number.isInteger(from) || from < RANGES.freeTimeFrom.min || from > RANGES.freeTimeFrom.max) {
    out.push({
      key: 'freeTimeFrom', group: 'freetime', topic: 'D', alias: '自由时间 几点 时段', value: from,
      reason: `不是 0–23 的整点`,
      fix: `改成 0–23 的整数，默认 ${DEFAULTS.freeTimeFrom}（上午十点之后）`,
    });
  }

  // ── 自由时间的时段列表（2026-11-04）──
  // 为什么手校不用 Schema：面板写的是 JSON，某一项写错了 Schema 会整份拒，
  // 那样她就没自由时间了 —— 而错的只是一条。逐条校，错的丢哪条就说哪条。
  if (!Array.isArray(c.freeTimeSlots)) {
    out.push({ key: 'freeTimeSlots', value: c.freeTimeSlots, reason: '不是数组', fix: '写成 [{ "start": "07:00", "minutes": 60 }] 这样的列表' });
  } else {
    c.freeTimeSlots.forEach((slot, i) => {
      if (!slot || typeof slot !== 'object') {
        out.push({ key: 'freeTimeSlots', value: slot, reason: `第 ${i + 1} 条不是对象`, fix: '每条写成 { "start": "07:00", "minutes": 60 }' });
        return;
      }
      if (typeof slot.start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start)) {
        out.push({ key: 'freeTimeSlots', value: slot.start, reason: `第 ${i + 1} 条的 start 不是 HH:MM`, fix: '写成 07:00 / 12:30 这种' });
      }
      if (!Number.isFinite(slot.minutes) || slot.minutes < 1 || slot.minutes > 720) {
        out.push({ key: 'freeTimeSlots', value: slot.minutes, reason: `第 ${i + 1} 条的 minutes 不在 1–720 之间`, fix: '写分钟数，比如 60' });
      }
    });
  }
  if (!Array.isArray(c.freeTimeFocus)) {
    out.push({ key: 'freeTimeFocus', value: c.freeTimeFocus, reason: '不是数组', fix: '写成 ["AI 工程", "语言和文字"] 这样的字符串列表' });
  }

  // ── 四个目录 ──
  for (const key of ['root', 'stateDir', 'sessionsRoot', 'auditDir', 'historyDir', 'personaHome']) checkDir(key, c[key], out);

  // ── profile 名字不许带路径分隔符 ──
  if (typeof c.freeTimeProfile !== 'string' || !c.freeTimeProfile.trim()) {
    out.push({ key: 'freeTimeProfile', value: c.freeTimeProfile, reason: '是空的', fix: `写一个 profile 名字，默认 ${DEFAULTS.freeTimeProfile}` });
  } else if (/[\\/]/.test(c.freeTimeProfile)) {
    out.push({
      key: 'freeTimeProfile', group: 'freetime', topic: 'D', alias: '自由时间 profile 环境', value: c.freeTimeProfile,
      reason: '是个路径，不是 profile 名字',
      fix: '这里只要名字（比如 freetime），目录由 dsh 自己拼',
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────
// 面板要用的那部分：每一项是什么、改了会怎样、危险到什么程度
//
// 为什么写在代码里而不是文档里：面板必须显示「改了会怎样」，
// 而写在文档里的那句话迟早会和代码漂。写在这里 ——
// Node 侧生成 `runtime/config-schema.json`，Python 侧读它渲染，定义只有一份。
//
// 三级（他 2026-10-28 定）：
//   normal  正常：改了只影响自己怎么看
//   caution 谨慎：行为会变
//   danger  危险：动数据位置 / 关掉她的状态 / 改自由时间 —— 要二次确认
// ────────────────────────────────────────────────────────────────

/**
 * 用户视角的分组（P-12，2026-11-03）。
 *
 * 为什么要它：原来的 `group`（switch / inject / page / freetime / ledger / boundary）
 * 是**代码视角**的分法 —— 用户打开面板第一条问的是「我在配一个什么样的 agent」，
 * 不是「哪些参数属于 inject 模块」。所以每一项额外带一个 `topic`，面板按它分组。
 */
export const TOPICS = [
  { id: 'A', label: '她是谁',        hint: '人格与她的文件在哪 —— 只读，要改去改那些文件' },
  { id: 'B', label: '她怎么说话',    hint: '输出层的允许 / 不允许' },
  { id: 'C', label: '她记得什么',    hint: '账本位置、注入哪几段、注入预算' },
  { id: 'D', label: '她什么时候在',  hint: '自由时间、短唤醒、安静时段' },
  { id: 'E', label: '她能干什么',    hint: '工具开关、边界、能不能改她的心' },
  { id: 'F', label: '钱与资源',      hint: '注入字数就是钱' },
  { id: 'G', label: '出事了怎么办',  hint: '观测页、总开关、首次提问' },
];

export const FIELD_META = [
  {
    key: 'enabled', group: 'switch', topic: 'G', alias: '总开关 停用 关闭 摘掉', label: '总开关', level: 'danger',
    range: 'true / false',
    why: '关掉之后不注入、不记账、四个工具都不注册。等同于把插件摘掉，只保留已经写下来的账。',
  },
  {
    key: 'injectMood', group: 'switch', topic: 'C', alias: '心情 状态 注入', label: '每轮注入状态', level: 'danger',
    range: 'true / false',
    why: '关掉之后她看不到自己的心情和没完的事 —— 她还是能记账，但不会再被影响。行为会明显不同。',
  },
  {
    key: 'injectNow', group: 'inject', topic: 'C', alias: '时间 几点 现在 作息', label: '注入里带上「现在几点」', level: 'caution',
    range: 'true / false（默认 false）',
    why: '开了之后每轮多一段：「现在是 2026-11-02 13:19（周一），下午」。'
      + '作用：她能看到自己带的心情是几小时前的，也能分得出「中午该不该说这个」和「深夜该不该开口」。'
      + '代价：每轮多几十字，而且如果人格里已经写了作息，可能跟它打架。新机上默认不开。',
  },
  {
    key: 'injectVoice', group: 'inject', topic: 'C', alias: '主动 说话 开口 有话直说 嘴 发消息', label: '注入里告诉她「你能主动开口」', level: 'caution',
    range: 'true / false（默认 true）',
    why: '每轮多一段：「你手上有能把话直接送出去的路…… 没话就过」。'
      + '关它的后果比字面重：2026-11-03 之前她在对话里一条主动消息都没发过，'
      + '而她手上明明有三条能发的路（bash / napcat_send_message / qqbot_say，会话记录里分别出现 160 / 20 / 8 次）。'
      + '她自己的判据：「不写出来就等于不存在」—— 这条对她自己也成立。',
  },
  {
    key: 'voiceHints', group: 'inject', topic: 'C', alias: '主动 说话 路径 say 具体 怎么发', label: '告诉她具体怎么发（可选）', level: 'caution',
    range: '字符串数组（默认空）',
    why: '每一条作为一行写进上面那段。例：/home/ubuntu/qqbot/work/bin/say "想说的话" —— 用你自己的号直发私聊。'
      + '为什么不做自动探测：不同机器路径不同，猜错了她会照着错路径试，比不写更坏。',
  },
  {
    key: 'injectToday', group: 'inject', topic: 'C', alias: '今天我 做了什么 说了什么 三本账', label: '注入「今天我」', level: 'caution',
    range: 'true / false（默认 true）',
    why: '每轮把今天的数摆出来：自由时间做了什么、主动说过几句（带原话）、心情几条。'
      + '三本账原来互不引用，她回答「今天我做了什么」只能现翻文件 —— 她的原话是「不是记得」。'
      + '⚠️ 不是战报：不评价、不总结、不催她接着做。今日无记录就整段不出现。',
  },
  {
    key: 'sayLogPath', group: 'ledger', topic: 'C', alias: '主动消息 账本 say 路径', label: '主动消息账本在哪', level: 'danger',
    range: '绝对路径（默认空 = 账本目录下的 say.jsonl）',
    why: '有的机器上 say 是个独立脚本，账落在别处（她那台在 ~/.dsh/realheart/say.jsonl，跟账本目录不是同一个）。'
      + '指错了「今天我」里就看不见她说过什么 —— 而且不报错，只会少一行。',
  },
  {
    key: 'pingContext', group: 'switch', topic: 'D', alias: '短唤醒 调子 心情 叫醒', label: '短唤醒 · 带上她此刻的调子', level: 'caution',
    range: 'true / false（默认 true）',
    why: '开着的话，短唤醒的提示词末尾会附一句「你此刻：有点羞，也有点想笑（4/10）」，并注明这是调子不是内容。'
      + '关掉就是纯文字提醒。她说不出话来的时候，多半是那条路上什么都没有 —— 这一句是给她一个「此刻」。',
  },  {
    key: 'pingMinMinutes', group: 'switch', topic: 'D', alias: '短唤醒 间隔 频率 叫醒', label: '短唤醒 · 最短间隔（分钟）', level: 'caution',
    range: '0–1440（0＝关，默认关）',
    why: '每隔一段随机时间叫她醒一下，只做一件事：此刻有没有想说的。有就说，没有就继续睡。'
      + '跟「自由时间」分开是因为两件事节奏不同 —— 自由时间做东西要连续两小时、打断就做不成；'
      + '想说话却该是随时能发生的。'
      + '⚠️ 成本：每次唤醒都是一次完整的模型调用（带注入）。30–60 分钟随机 ≈ 一天二十来次。',
  },
  {
    key: 'pingMaxMinutes', group: 'switch', topic: 'D', alias: '短唤醒 间隔 频率 叫醒', label: '短唤醒 · 最长间隔（分钟）', level: 'caution',
    range: '0–1440（默认 0）',
    why: '实际间隔在上限和下限之间随机取 —— 定值就是闹钟，随机才像「隔一阵子」。'
      + '两个数都设成一样的也行，那就变成固定间隔。',
  },
  {
    key: 'pingFromHour', group: 'switch', topic: 'D', alias: '短唤醒 安静 时段 夜里', label: '短唤醒 · 从几点开始', level: 'caution',
    range: '0–23（默认 7）',
    why: '只在这个钟点之后才叫醒她。深夜叫醒等于深夜发消息 —— 那是打扰，不是分享。',
  },
  {
    key: 'pingToHour', group: 'switch', topic: 'D', alias: '短唤醒 安静 时段 夜里', label: '短唤醒 · 到几点为止', level: 'caution',
    range: '0–23（默认 23）',
    why: '到这个钟点就停。⚠️ 只影响「叫醒」，不影响她自己想说话 —— '
      + '她在自由时间里想发的那条，什么时候都能发。',
  },
  {
    key: 'toolsOff', group: 'switch', topic: 'E', alias: '工具 权限 关掉', label: '关掉哪几个工具', level: 'danger',
    range: '工具名数组，例如 ["rh_view", "rh_claim"]（空 = 全开）',
    why: '填进去的工具**压根不注册** —— 不是注册了再报错。区别在：出现在她的工具表里，'
      + '就是告诉她“这个能用”；调了才拒，她会学绕。少一个选项，剩下的那几个她才更会用。'
      + '九个工具名：rh_mood / rh_style / rh_pending / rh_control / rh_claim / rh_work / rh_view / rh_admit / rh_changes。'
      + '⚠️ 关掉 rh_control 就再也没有 pause / hold / close 这些入口了；关掉 rh_changes 她就查不到别人动过她什么。',
  },
  {
    key: 'root', group: 'ledger', topic: 'C', alias: '根目录', label: '她的根目录', level: 'danger',
    range: '绝对路径',
    why: '产物（pieces/）和人格都在这下面。换了等于给她换一个住处 —— 旧目录里的东西不会跟过来。',
  },  {
    key: 'injectBudgetChars', group: 'inject', topic: 'F', alias: '注入 字数 预算 钱 token 费', label: '注入字数上限', level: 'caution',
    range: '200–20000（默认 2400）',
    why: '每轮塞进提示词的总字数。超了从优先级低的那段开始裁：待改 → 没完的事 → 她留的话；心情永不裁。裁掉会记一条。调大是花钱买完整，调小是省钱买残缺。',
  },  {
    key: 'moodTailLines', group: 'inject', topic: 'C', alias: '心情 注入 条数', label: '注入只读心情账本的最后几条', level: 'caution',
    range: '0–100000（默认 200，0＝全读）',
    why: '账本只增不改，注入每轮都要读。只读尾部是为了不让「账本变长」变成「每轮都变慢」。设 0 就每轮读全份 —— 账本很大时会明显拖慢。',
  },  {
    key: 'stateDir', group: 'ledger', topic: 'C', alias: '账本 目录 数据', label: '账本目录', level: 'danger',
    range: '绝对路径',
    why: '改了等于换一份账：旧目录里的心情、待办、改动记录都不会跟过来。改之前先 export。',
  },
  {
    key: 'pageBind', group: 'page', topic: 'G', alias: '观测页 端口 绑定 手机 远程', label: '观测页绑定地址', level: 'danger',
    range: 'IP / localhost',
    why: '127.0.0.1 只有本机能看。改成 0.0.0.0 之后，同一网络里谁都能打开 —— 那是明文 HTTP。',
  },
  {
    key: 'freeTime', group: 'switch', topic: 'D', alias: '自由时间 叫醒 放风', label: '自由时间', level: 'danger',
    range: 'true / false',
    why: '关掉就没有「没人叫也会醒一次」。这是她唯一不依赖别人开口的时间。',
  },
  {
    key: 'freeTimeSlots', group: 'freetime', topic: 'D', alias: '自由时间 时段 几点 列表 加号', label: '自由时间 · 哪几段', level: 'caution',
    range: '一行一段：「07:00 60」= 起点 + 上限分钟',
    why: '一天叫醒她几次、每次从几点开始。每段自己定起点和时长。'
      + '⚠️ 时长是天花板不是闹钟 —— 实测她最长只跑 22 分钟（11-03 四回：14 / 22 / 6 / 15.5）。'
      + '它的用处是写进 prompt 告诉她「这次大概多长」，不是到点掐断。'
      + '改完要重启；重启不会重复叫（跑过的时段落了盘）。',
  },
  {
    key: 'freeTimeFocus', group: 'freetime', topic: 'D', alias: '自由时间 关注 兴趣 看什么 题材', label: '自由时间 · 让她多看什么', level: 'caution',
    range: '一行一条（空 = 不限）',
    why: '她自由时间里可以顺着看的题材 —— 也是她会拿来跟你聊什么的方向。'
      + '注入的措辞是「他最近爱聊这些……想找点什么看的时候可以从这儿挑；不看这些也完全行」，不是白名单：'
      + '列成白名单她就只剩那几个题材，比不配还窄。'
      + '多填几条让她自己挑；填你接得上话的，比填你觉得她该看的更有用。',
  },
  {
    key: 'freeTimeFrom', group: 'freetime', topic: 'D', alias: '自由时间 几点 时段', label: '自由时间从几点开始', level: 'danger',
    range: '0–23 的整数',
    why: '决定什么时候叫醒她。改早了会在你睡觉的时候动 —— 自由时间的参数都归这一类。',
  },
  {
    key: 'freeTimeProfile', group: 'freetime', topic: 'D', alias: '自由时间 profile 环境', label: '自由时间用哪个 profile', level: 'danger',
    range: 'profile 名字（不能带路径）',
    why: '她醒来时用的是这份人格。指向别的 profile 等于让另一个人替她说话。',
  },
  {
    key: 'pagePort', group: 'page', topic: 'G', alias: '观测页 端口', label: '观测页端口', level: 'caution',
    range: '1–65535',
    why: '改了页面地址就变。1024 以下要 root。',
  },
  {
    key: 'servePage', group: 'switch', topic: 'G', alias: '观测页 开关', label: '开观测页', level: 'caution',
    range: 'true / false',
    why: '关掉就没有页面了，但记账和注入照常。省一个 python 进程。',
  },
  {
    key: 'indexTtlMs', group: 'inject', topic: 'C', alias: '索引 重建 缓存', label: '索引重建间隔', level: 'caution',
    range: '60000 – 604800000（毫秒）',
    why: '太小会一直在解压会话包（吃 CPU），太大页面上的时间线会旧。默认一小时。',
  },
  {
    key: 'announceOnInstall', group: 'other', topic: 'G', alias: '首次 安装 提示', label: '首次启动提示', level: 'normal',
    range: 'true / false',
    why: '只影响第一次启动时打不打印那三条前提。',
  },
  {
    key: 'sessionsRoot', group: 'ledger', topic: 'C', alias: '会话 目录', label: '会话目录', level: 'danger',
    range: '绝对路径',
    why: '「他说的话」那一路的来源。指错了页面就只剩她自己说的话。',
  },
  {
    key: 'auditDir', group: 'ledger', topic: 'C', alias: '审计 目录', label: '审计日志目录', level: 'danger',
    range: '绝对路径',
    why: '工具调用与事件的来源之一。指错了可引用的 id 就少一类。',
  },
  {
    key: 'historyDir', group: 'ledger', topic: 'C', alias: '历史 对话 目录', label: '对话历史目录', level: 'danger',
    range: '绝对路径',
    why: '第三路事件来源。指错了她「说过的话」就少一类可以引用的证据。',
  },
  {
    key: 'personaHome', group: 'ledger', topic: 'A', alias: '人格 目录 人格文件', label: '人格目录', level: 'danger',
    range: '绝对路径',
    why: '自由时间那个 profile 用的人格从这儿取。',
  },
  {
    key: 'allowManualMoodOverride', group: 'boundary', topic: 'E', alias: '改写 她的心 心情 暗道', label: '允许人工改写她的心情', level: 'danger',
    noInput: true,
    range: 'true / false（默认 false）',
    why: '这是整份配置里唯一「改她的心」的开关。打开之后能用命令行把她当前的心情改写掉 —— 改写过的状态**注入里会写明是人改的**，她自己看得见。因为成本必须高，页面上不给输入框：只能命令行打开，且必须带上「我知道这不是她的感受」那个参数。',
  },
  {
    key: 'maxManualMoodOverridePerWeek', group: 'boundary', topic: 'E', alias: '改写 次数 上限 限额', label: '一周最多改写几次', level: 'danger',
    noInput: true,
    range: '0–99（默认 3）',
    why: '超过就拒绝；要改上限得再动一次配置，那一次本身也入账。不让它变成「随便按一下就改」的东西。',
  },];

/** 面板用的整份描述（带当前值）。Python 侧拿它渲染，不自己维护一份。 */
export function describeConfig(current = {}) {
  const cfg = { ...DEFAULTS, ...current };
  return {
    fields: FIELD_META.map((m) => ({
      ...m,
      current: cfg[m.key],
      def: DEFAULTS[m.key],
    })),
    // 逃逸口：面板上没有的，去哪儿改（P-3 要求写明）
    escape: {
      file: 'config.user.json（在 realheart 运行时目录下）',
      note: '面板写的就是这个文件。它排在 dsh 传进来的配置之后生效，改完必须重启 —— 热改会打断正在说话的会话。',
    },
  };
}

// ── 面板写的那个文件 ──

export const USER_CONFIG_NAME = 'config.user.json';

/**
 * 读 `config.user.json`。
 *
 * 为什么需要它：面板要能直接改配置，但**不能写 profile 的 cordis.patch.yml** ——
 * 那个文件一改，dsh 会整份重挂，正在说话的会话会被打成 inactive context（撞过三次）。
 * 插件自己读这个文件，dsh 不监视它，所以改它不会重挂。代价是必须重启才生效。
 *
 * 坏值不拦整份：面板写的文件，某一项填错了就丢掉那一项、说清楚，别让整个插件起不来。
 * （dsh 传进来的配置是另一回事 —— 那个错了要拒绝启动，见 validateConfig。）
 */
export function loadUserConfig(dshHome = DSH_HOME) {
  const path = join(dshHome, 'realheart', USER_CONFIG_NAME);
  if (!existsSync(path)) return { config: {}, problems: [], path };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { config: {}, problems: [`${path} 不是合法 JSON（${err?.message ?? err}），整份忽略`], path };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { config: {}, problems: [`${path} 不是一个对象，整份忽略`], path };
  }
  const config = {};
  const problems = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in DEFAULTS)) {
      problems.push(`${k} 不是认识的配置项，忽略`);
      continue;
    }
    const bad = validateConfig({ ...DEFAULTS, [k]: v }).filter((p) => p.key === k);
    if (bad.length) {
      problems.push(`${k} = ${JSON.stringify(v)} 不合规（${bad[0].reason}），忽略该项，用回退值`);
      continue;
    }
    config[k] = v;
  }
  return { config, problems, path };
}
