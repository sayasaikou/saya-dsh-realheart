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

/** 老约定：她的东西都在 ~/qqbot 下面。**只留给老用户和兼容用**，新装的不再默认指这里。 */
export const QQROOT = join(os.homedir(), 'qqbot');
export const DSH_HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh');

// 2026-11-04：默认根目录改成「插件自己的目录」。
// 为什么改：以前 root / stateDir / auditDir / historyDir / msgsDir 全指向 ~/qqbot ——
// 那是**沙耶那一台**的约定（qqbot-memory 落的账）。装给别人就是五个路径全指向不存在的
// 地方：不崩，但一半数据源是空的，而人看不出「为什么她什么都不记得」。
// 现在的判据：**默认值必须对着「装插件的那个人」成立**，不是对着某一台已经调好的机器。
export const HOME_ROOT = join(DSH_HOME, 'realheart');

export const DEFAULTS = {
  enabled: true,
  // 她的根：产物（pieces/）和人格都在这下面。可以换，换了等于换一个人住的房子。
  root: HOME_ROOT,
  // 账本、状态文件所在目录
  stateDir: join(HOME_ROOT, 'state'),
  // 三路事件源
  sessionsRoot: join(DSH_HOME, 'sessions'),
  // 下面三个是「qqbot 那套」的产物，**默认不接**（空 = 这一路没有）。
  // 接了才有：审计里的工具调用、对话历史、落盘的消息原文。
  // 用 qqbot 的人自己填上，不用的就别让它们指着不存在的目录。
  auditDir: '',
  historyDir: '',
  // 第四路：qqbot-memory 落盘的消息（data/msgs）—— text 里是真话，不是时间戳
  msgsDir: '',
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
  // 「今天聊到哪儿」那一段：切段间隔、摘要字数、整段预算
  talkGapMinutes: 20,
  talkSummaryChars: 60,
  talkBudgetChars: 380,
  // 摘要的指令句（空 = 用内置）
  promptTalkSummary: '',
  // 情绪词表：短唤醒里用来找「这句是不是变了」的钩子
  moodNudgeWords: ['累', '难受', '疼', '软', '困', '烦', '怕', '慌', '想哭', '委屈', '生气', '心里堵', '没劲', '不想动', '撑不住', '松了口气', '舒服', '爽', '开心', '高兴', '踏实', '沉'],
  // 观测页自动刷新（秒，0 = 不刷新）
  pageRefreshSec: 5,
  // 关掉哪几段注入。空 = 全开。名字见 FIELD_META 的 range。
  injectOffSections: [],
  // 心情一次最多摆几条（同时并存的状态）
  moodShowMax: 5,
  // 2026-11-14：外部能力注册表
  capsOn: true,
  capsFile: '',            // 空 = $DSH_HOME/realheart/capabilities.json
  capsDailyLimit: 30,
  capsTimeoutMs: 120000,   // 单次外部调用超时
  capsPollMs: 5000,        // 异步任务轮询间隔（记录里写了就按记录的）
  capsRetry: 1,            // 网络/5xx 重试次数（4xx 不重试）
  capsConfirmPrompt: 6,    // 提示词少于这么多字先问再动
  capsMediaKeepDays: 30,   // media 目录保留天数（0 = 不清理）
  capsJson: '',            // 设置页「外部能力」标签里那份整份 JSON；非空时优先于 capabilities.json      // 每条记录每天最多调几次（生成类按次计费，这是刹车）
  // 注入时只读心情账本的最后 N 条。账本长大了不该整份读进来（M1-4）。
  moodTailLines: 200,
  // 观测页：默认只在 127.0.0.1 上开，手机想看自己去反代或改 pageBind
  servePage: true,
  pagePort: 8098,
  pageBind: '127.0.0.1',
  // 首次运行提示只打一次（标记文件在 stateDir 下）
  announceOnInstall: true,
  // 自由时间：每天叫醒她几次。不用 systemd、不要 root。
  freeTime: true,
  freeTimeProfile: 'freetime',
  // 2026-11-04：`freeTimeFrom` 删了。它从 0.2.96 起就是**死配置** ——
  // 面板上有「自由时间从几点开始」，代码里一次都没读过（`slotsToday` 只看 freeTimeSlots）。
  // 给人一个改了没反应的开关，比不给更坏：他会以为自己改过了，然后去查别的地方。
  // 老配置里还留着这个键不会出事 —— loadUserConfig 会报一句「不是认识的配置项，忽略」。
  // 2026-11-04：默认 **07 / 12 / 20 三段**，而且**全部落在低谷价时段**。
  //
  // 沙耶：「默认值避开高峰时段，用低谷时段来跑比较好」。
  // DeepSeek 是峰谷定价：**工作日 09:00–12:00、14:00–18:00 高峰价，其余（含周末全天）半价**。
  // 默认这三个点是按这个挑的：
  //   07:00 跑 07–08   谷
  //   12:00 跑 12–13   谷（高峰到 12:00 为止，12 点整正好出高峰）
  //   20:00 跑 20–21   谷
  // 🔴 上一版默认是 09 / 14 —— 两个都正好踩在高峰的**开头上**，是最贵的两个点。
  //
  // ⚠️ minutes 是**天花板不是闹钟**：实测她最长只跑 22 分钟。
  //    它唯一的用处是写进 prompt 告诉她「这次大概有多长」。
  freeTimeSlots: [
    { start: '07:00', minutes: 60 },
    { start: '12:00', minutes: 60 },
    { start: '20:00', minutes: 60 },
  ],
  // 自由时间关心什么方向。
  // ⚠️ 是**建议**不是白名单 —— 写成白名单她就只剩那几个题材，比不配还窄。
  // 默认给 8 条而不是空：空着的时候她自由时间没方向，容易只剩「继续睡了」。
  // ⚠️ 这 8 条是**通用方向**，不是某个人爱看的：装插件的人自己改。
  freeTimeFocus: [
    'AI 与科技',
    '科学与科普',
    '语言与文字',
    '历史与社会',
    '设计与建筑',
    '游戏与虚拟世界',
    '硬件与动手折腾',
    '数据与统计',
  ],
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
  // 2026-11-04：默认 **60–120 分钟**（上一版是 30–60，再早是 0＝关）。
  // 为什么不像他那台一样 30–60：那是「已经调好、也知道自己在花钱」的人用的。
  // 装插件的人第一次开，一天二十来次模型调用会先把他吓一跳 —— 而「她偶尔主动找你」
  // 和「她一小时来一次」在读的人眼里完全是两种东西。默认宁可稀一点：稀了才好往密调。
  // ⚠️ 成本照旧写在面板上：一次完整的模型调用带注入。
  pingMinMinutes: 60,
  pingMaxMinutes: 120,
  pingFromHour: 9,
  pingToHour: 23,
  // 她的人格目录（freetime profile 用同一份，不另写一套）
  // 2026-11-04：默认不再指向 ~/qqbot/home（那是某一台的人格），改成插件自己的目录。
  // 目录不存在时 ensureFreeProfile 会铺一份**包内自带的默认人格**（见 scripts/persona-default.md）。
  personaHome: join(HOME_ROOT, 'persona'),
  // ── 提示词（2026-11-04，沙耶要的「全量开放」）──
  //
  // 为什么做成配置：他的原话是「把所有的配置都做成可调节选项……包括每次唤醒给她的提示词」。
  // 理由比我原来的保守做法对 —— 真要改的人会叫 agent 改，藏在源码里等于让 agent 去翻 4000 行。
  // 放上来，人和 agent 看的是同一份契约。
  //
  // ⚠️ **空 = 用内置那版**，不是「不注入」。
  //   这样内置文案更新时，没改过的人会自动跟着更新（改了的人保留自己的）。
  //    想彻底关掉那一段，用对应的 injectXxx 开关，别把这里清空 —— 清空等于回到默认。
  // ── 心情的呈现阈值（2026-11-04：沙耶要「能改的全放上来」）──
  // 这三个数字原来写死在代码里，而它们直接改她说话的样子。
  bleedMinLevel: 6,
  bleedMaxHours: 12,
  moodFadeHours: 24,
  promptFree: '',
  promptPing: '',
  // 另外三句「行为关键」的文案（2026-11-04 第二批）。
  // 为什么是这三句而不是那十几段：其余段是数据陈列（作品 / 待办 / 观测页状态），
  // 改文案收益近乎零；这三句每一句都直接决定她怎么说话。
  promptVoiceTail: '',
  promptTodayTail: '',
  promptMoodBan: '',
  // P-3b：改她的心那条暗道。默认关，关着时命令行连入口都不存在。
  allowManualMoodOverride: false,
  maxManualMoodOverridePerWeek: 3,
};

// 范围写在这里，Schema 和 validateConfig 共用一份 —— 两处各写一遍，迟早会漂。
export const RANGES = {
  pagePort: { min: 1, max: 65535 },
  indexTtlMs: { min: 60000, max: 7 * 24 * 60 * 60 * 1000 },
};

/** 只保留「能直接用的值」。
 *
 * 2026-11-11：宿主传进来的 config 里，volatile 的那些字段不是标量 ——
 * 实测是空对象（JSON.stringify 出来是 {}），在 0.2.2-rc 桌面上则是 undefined。
 * 不管它是包装、是代理还是没解析的表达式，它都不是用户写的值：
 * {...DEFAULTS, ...config} 把它当值收下，validateConfig 就会报「不是 true / false」。
 * 本插件的配置项全是标量或字符串数组，所以「对象一律丢掉」是安全的。
 * 显式写 null 的保留 —— 那是真的坏值，该报。
 */
export function plainConfig(obj) {
  const out = {};
  const dropped = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined) { dropped.push(k); continue; }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) { dropped.push(k); continue; }
    if (Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object')) { dropped.push(k); continue; }
    out[k] = v;
  }
  if (dropped.length) {
    try { out.__droppedByHost = dropped; } catch { /* 只用于诊断 */ }
    delete out.__droppedByHost; // 不污染配置，仅在上面统计
  }
  return out;
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(DEFAULTS.enabled).volatile(),
  root: Schema.string().default(DEFAULTS.root).volatile(),
  stateDir: Schema.string().default(DEFAULTS.stateDir).volatile(),
  sessionsRoot: Schema.string().default(DEFAULTS.sessionsRoot).volatile(),
  auditDir: Schema.string().default(DEFAULTS.auditDir).volatile(),
  historyDir: Schema.string().default(DEFAULTS.historyDir).volatile(),
  msgsDir: Schema.string().default(DEFAULTS.msgsDir).volatile(),
  ownerId: Schema.string().default(DEFAULTS.ownerId).volatile(),
  indexTtlMs: Schema.number().min(RANGES.indexTtlMs.min).max(RANGES.indexTtlMs.max).default(DEFAULTS.indexTtlMs).volatile(),
  injectMood: Schema.boolean().default(DEFAULTS.injectMood).volatile(),
  injectNow: Schema.boolean().default(DEFAULTS.injectNow).volatile(),
  injectVoice: Schema.boolean().default(DEFAULTS.injectVoice).volatile(),
  injectToday: Schema.boolean().default(DEFAULTS.injectToday).volatile(),
  voiceHints: Schema.array(Schema.string()).default(DEFAULTS.voiceHints).volatile(),
  sayLogPath: Schema.string().default(DEFAULTS.sayLogPath).volatile(),
  toolsOff: Schema.array(Schema.string()).default(DEFAULTS.toolsOff).volatile(),
  injectBudgetChars: Schema.number().min(200).max(20000).default(DEFAULTS.injectBudgetChars).volatile(),
  talkGapMinutes: Schema.number().min(5).max(720).default(DEFAULTS.talkGapMinutes).volatile(),
  talkSummaryChars: Schema.number().min(20).max(400).default(DEFAULTS.talkSummaryChars).volatile(),
  talkBudgetChars: Schema.number().min(100).max(2000).default(DEFAULTS.talkBudgetChars).volatile(),
  promptTalkSummary: Schema.string().default(DEFAULTS.promptTalkSummary).volatile(),
  moodNudgeWords: Schema.array(Schema.string()).default(DEFAULTS.moodNudgeWords).volatile(),
  pageRefreshSec: Schema.number().min(0).max(600).default(DEFAULTS.pageRefreshSec).volatile(),
  injectOffSections: Schema.array(Schema.string()).default(DEFAULTS.injectOffSections).description('关掉哪几段注入（段名见说明）').volatile(),
  moodShowMax: Schema.number().min(1).max(20).default(DEFAULTS.moodShowMax).description('心情一次最多摆几条').volatile(),
  capsOn: Schema.boolean().default(DEFAULTS.capsOn).volatile(),
  capsFile: Schema.string().default(DEFAULTS.capsFile).volatile(),
  capsDailyLimit: Schema.number().min(0).max(100000).default(DEFAULTS.capsDailyLimit).volatile(),
  capsTimeoutMs: Schema.number().min(5000).max(1800000).default(DEFAULTS.capsTimeoutMs).volatile(),
  capsPollMs: Schema.number().min(500).max(120000).default(DEFAULTS.capsPollMs).volatile(),
  capsRetry: Schema.number().min(0).max(5).default(DEFAULTS.capsRetry).volatile(),
  capsConfirmPrompt: Schema.number().min(0).max(200).default(DEFAULTS.capsConfirmPrompt).volatile(),
  capsMediaKeepDays: Schema.number().min(0).max(3650).default(DEFAULTS.capsMediaKeepDays).volatile(),
  // 注意：这一项**不加 volatile** —— 它要能被设置页写进 profile 并持久。
  moodTailLines: Schema.number().min(0).max(100000).default(DEFAULTS.moodTailLines).volatile(),
  servePage: Schema.boolean().default(DEFAULTS.servePage).volatile(),
  pagePort: Schema.number().min(RANGES.pagePort.min).max(RANGES.pagePort.max).default(DEFAULTS.pagePort).volatile(),
  pageBind: Schema.string().default(DEFAULTS.pageBind).volatile(),
  announceOnInstall: Schema.boolean().default(DEFAULTS.announceOnInstall).volatile(),
  freeTime: Schema.boolean().default(DEFAULTS.freeTime).volatile(),
  freeTimeProfile: Schema.string().default(DEFAULTS.freeTimeProfile).volatile(),
  freeTimeSlots: Schema.array(Schema.object({
    start: Schema.string(),
    minutes: Schema.number(),
  })).default(DEFAULTS.freeTimeSlots),
  freeTimeFocus: Schema.array(Schema.string()).default(DEFAULTS.freeTimeFocus).volatile(),
  pingContext: Schema.boolean().default(DEFAULTS.pingContext).volatile(),
  pingMinMinutes: Schema.number().min(0).max(1440).default(DEFAULTS.pingMinMinutes).volatile(),
  pingMaxMinutes: Schema.number().min(0).max(1440).default(DEFAULTS.pingMaxMinutes).volatile(),
  pingFromHour: Schema.number().min(0).max(23).default(DEFAULTS.pingFromHour).volatile(),
  pingToHour: Schema.number().min(0).max(23).default(DEFAULTS.pingToHour).volatile(),
  personaHome: Schema.string().default(DEFAULTS.personaHome).volatile(),
  bleedMinLevel: Schema.number().min(1).max(10).default(DEFAULTS.bleedMinLevel).volatile(),
  bleedMaxHours: Schema.number().min(0).max(168).default(DEFAULTS.bleedMaxHours).volatile(),
  moodFadeHours: Schema.number().min(1).max(720).default(DEFAULTS.moodFadeHours).volatile(),
  promptFree: Schema.string().default(DEFAULTS.promptFree).volatile(),
  promptPing: Schema.string().default(DEFAULTS.promptPing).volatile(),
  promptVoiceTail: Schema.string().default(DEFAULTS.promptVoiceTail).volatile(),
  promptTodayTail: Schema.string().default(DEFAULTS.promptTodayTail).volatile(),
  promptMoodBan: Schema.string().default(DEFAULTS.promptMoodBan).volatile(),
  allowManualMoodOverride: Schema.boolean().default(DEFAULTS.allowManualMoodOverride).volatile(),
  maxManualMoodOverridePerWeek: Schema.number().min(0).max(99).default(DEFAULTS.maxManualMoodOverridePerWeek).volatile(),
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
  const c = { ...DEFAULTS, ...plainConfig(cfg) };

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
  // 2026-11-04：auditDir / historyDir 不在这条线上 —— 它们**允许空**（空 = 不接这一路数据源）。
  // 默认值就是空：那是 qqbot 那套的产物，不用 qqbot 的人填了只会得到三个不存在的目录。
  for (const key of ['root', 'stateDir', 'sessionsRoot', 'personaHome']) checkDir(key, c[key], out);

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
    why: '作用：插件总开关。关 = 不注入、不记账、不注册工具，已写的账保留。\n默认：true。影响：关闭后行为差异极大。',
    ui: { unit: '', recommend: '', brief: '插件总开关。关 = 不注入、不记账、不注册工具，已写的账保留。', detail: '默认：true。影响：关闭后行为差异极大。' },
  },
  {
    key: 'injectMood', group: 'switch', topic: 'C', alias: '心情 状态 注入', label: '每轮注入状态', level: 'danger',
    range: 'true / false',
    why: '作用：每轮把她的状态（心情、没完的事）注入。\n默认：true。影响：关闭后她看不到自己的账，仍可写入但不受影响。',
    ui: { unit: '', recommend: '', brief: '每轮把她的状态（心情、没完的事）注入。', detail: '默认：true。影响：关闭后她看不到自己的账，仍可写入但不受影响。' },
  },
  {
    key: 'injectNow', group: 'inject', topic: 'C', alias: '时间 几点 现在 作息', label: '注入里带上「现在几点」', level: 'caution',
    range: 'true / false（默认 false）',
    why: '作用：注入当前时间（日期、星期、时段）。\n默认：true。影响：每轮多几十字；用于判断「此刻合不合适说」。',
    ui: { unit: '', recommend: '', brief: '注入当前时间（日期、星期、时段）。', detail: '默认：true。影响：每轮多几十字；用于判断「此刻合不合适说」。' },
  },
  {
    key: 'injectVoice', group: 'inject', topic: 'C', alias: '主动 说话 开口 有话直说 嘴 发消息', label: '注入里告诉她「你能主动开口」', level: 'caution',
    range: 'true / false（默认 true）',
    why: '作用：注入「你手上有主动发消息的路」。\n默认：true。影响：关闭后主动消息显著减少（实测：写出来之前几乎不发）。',
    ui: { unit: '', recommend: '', brief: '注入「你手上有主动发消息的路」。', detail: '默认：true。影响：关闭后主动消息显著减少（实测：写出来之前几乎不发）。' },
  },
  {
    key: 'voiceHints', group: 'inject', topic: 'C', alias: '主动 说话 路径 say 具体 怎么发', label: '告诉她具体怎么发（可选）', level: 'caution',
    range: '字符串数组（默认空）',
    why: '作用：给上面那段补具体发送命令，一行一条。\n默认：[]。影响：留空则只给意图、不给路径。不可自动探测，路径各机不同。',
    ui: { unit: '', recommend: '', brief: '给上面那段补具体发送命令，一行一条。', detail: '默认：[]。影响：留空则只给意图、不给路径。不可自动探测，路径各机不同。' },
  },
  {
    key: 'injectToday', group: 'inject', topic: 'C', alias: '今天我 做了什么 说了什么 三本账', label: '注入「今天我」', level: 'caution',
    range: 'true / false（默认 true）',
    why: '作用：注入「今天我」段（当天做过什么的摘要）。\n默认：true。影响：每轮多一段；关闭后她对今天没有连续印象。',
    ui: { unit: '', recommend: '', brief: '注入「今天我」段（当天做过什么的摘要）。', detail: '默认：true。影响：每轮多一段；关闭后她对今天没有连续印象。' },
  },
  {
    key: 'sayLogPath', group: 'ledger', topic: 'C', alias: '主动消息 账本 say 路径', label: '主动消息账本在哪', level: 'danger',
    range: '绝对路径（默认空 = 账本目录下的 say.jsonl）',
    why: '作用：主动消息账本的路径，用于「今天已经发过什么」。\n默认：空 = 由 root/work 推导。影响：路径错则读不到已发记录。',
    ui: { unit: '', recommend: '', brief: '主动消息账本的路径，用于「今天已经发过什么」。', detail: '默认：空 = 由 root/work 推导。影响：路径错则读不到已发记录。' },
  },
  {
    key: 'pingContext', group: 'switch', topic: 'D', alias: '短唤醒 调子 心情 叫醒', label: '短唤醒 · 带上她此刻的调子', level: 'caution',
    range: 'true / false（默认 true）',
    why: '作用：短唤醒时带上她此刻的调子。\n默认：true。影响：关闭后唤醒语气与心情脱钩。',
    ui: { unit: '', recommend: '', brief: '短唤醒时带上她此刻的调子。', detail: '默认：true。影响：关闭后唤醒语气与心情脱钩。' },
  },
  {
    key: 'pingMinMinutes', group: 'switch', topic: 'D', alias: '短唤醒 间隔 频率 叫醒', label: '短唤醒 · 最短间隔（分钟）', level: 'caution',
    range: '0–1440（0＝关，默认关）',
    why: '每隔一段随机时间叫她醒一下，只做一件事：此刻有没有想说的。有就说，没有就继续睡。跟「自由时间」分开是因为两件事节奏不同 —— 自由时间做东西要连续两小时、打断就做不成；想说话却该是随时能发生的。⚠️ 成本：每次唤醒都是一次完整的模型调用（带注入）。30–60 分钟随机 ≈ 一天二十来次。',
    ui: { unit: '分钟', recommend: '推荐 30~60', brief: '每隔一段随机时间叫她醒一下，只做一件事：此刻有没有想说的。', detail: '有就说，没有就继续睡。跟「自由时间」分开是因为两件事节奏不同 —— 自由时间做东西要连续两小时、打断就做不成；想说话却该是随时能发生的。⚠️ 成本：每次唤醒都是一次完整的模型调用（带注入）。30–60 分钟随机 ≈ 一天二十来次。' },
  },
  {
    key: 'pingMaxMinutes', group: 'switch', topic: 'D', alias: '短唤醒 间隔 频率 叫醒', label: '短唤醒 · 最长间隔（分钟）', level: 'caution',
    range: '0–1440（默认 0）',
    why: '作用：短唤醒最长间隔。\n默认：60。影响：必须 ≥ 最短间隔。',
    ui: { unit: '分钟', recommend: '推荐 60~120', brief: '短唤醒最长间隔。', detail: '默认：60。影响：必须 ≥ 最短间隔。' },
  },
  {
    key: 'pingFromHour', group: 'switch', topic: 'D', alias: '短唤醒 安静 时段 夜里', label: '短唤醒 · 从几点开始', level: 'caution',
    range: '0–23（默认 7）',
    why: '作用：短唤醒起始小时（0-23）。\n默认：8。影响：窗口外不唤醒。',
    ui: { unit: '点', recommend: '推荐 8~9', brief: '短唤醒起始小时（0-23）。', detail: '默认：8。影响：窗口外不唤醒。' },
  },
  {
    key: 'pingToHour', group: 'switch', topic: 'D', alias: '短唤醒 安静 时段 夜里', label: '短唤醒 · 到几点为止', level: 'caution',
    range: '0–23（默认 23）',
    why: '作用：短唤醒结束小时（0-23）。\n默认：23。影响：可跨零点（如 22→6）。',
    ui: { unit: '点', recommend: '推荐 22~23', brief: '短唤醒结束小时（0-23）。', detail: '默认：23。影响：可跨零点（如 22→6）。' },
  },
  {
    key: 'toolsOff', group: 'switch', topic: 'E', alias: '工具 权限 关掉', label: '关掉哪几个工具', level: 'danger',
    range: '工具名数组，例如 ["rh_view", "rh_claim"]（空 = 全开）',
    why: '作用：按名字停用工具，停用的不注册（不是调用时报错）。\n默认：[]。影响：减少工具表噪声，提高其余工具的命中率。',
    ui: { unit: '', recommend: '', brief: '按名字停用工具，停用的不注册（不是调用时报错）。', detail: '默认：[]。影响：减少工具表噪声，提高其余工具的命中率。' },
  },
  {
    key: 'root', group: 'ledger', topic: 'C', alias: '根目录', label: '她的根目录', level: 'danger',
    range: '绝对路径',
    why: '作用：她的根目录，其他路径默认相对它推导。\n默认：自动探测。影响：填错会导致账本/脚本全面错位。',
    ui: { unit: '', recommend: '', brief: '她的根目录，其他路径默认相对它推导。', detail: '默认：自动探测。影响：填错会导致账本/脚本全面错位。' },
  },
  {
    key: 'injectBudgetChars', group: 'inject', topic: 'F', alias: '注入 字数 预算 钱 token 费', label: '注入字数上限', level: 'caution',
    range: '200–20000（默认 2400）',
    why: '每轮塞进提示词的总字数。超了从优先级低的那段开始裁：待改 → 没完的事 → 她留的话；心情永不裁。裁掉会记一条。调大是花钱买完整，调小是省钱买残缺。',
    ui: { unit: '字', recommend: '推荐 2000~3000', brief: '每轮塞进提示词的总字数。', detail: '超了从优先级低的那段开始裁：待改 → 没完的事 → 她留的话；心情永不裁。裁掉会记一条。调大是花钱买完整，调小是省钱买残缺。' },
  },
  {
    key: 'moodTailLines', group: 'inject', topic: 'C', alias: '心情 注入 条数', label: '注入只读心情账本的最后几条', level: 'caution',
    range: '0–100000（默认 200，0＝全读）',
    why: '账本只增不改，注入每轮都要读。只读尾部是为了不让「账本变长」变成「每轮都变慢」。设 0 就每轮读全份 —— 账本很大时会明显拖慢。',
    ui: { unit: '条', recommend: '推荐 100~200', brief: '账本只增不改，注入每轮都要读。', detail: '只读尾部是为了不让「账本变长」变成「每轮都变慢」。设 0 就每轮读全份 —— 账本很大时会明显拖慢。' },
  },
  {
    key: 'moodFadeHours', group: 'inject', topic: 'C', alias: '心情 衰减 旧了 一天 收起来', label: '心情多久算「旧了」', level: 'caution',
    range: '1–720 小时（默认 24）',
    why: '作用：心情超过多少小时不再占正文，只收成一行点名。\n默认：24。影响：不修改账本值，只影响呈现。',
    ui: { unit: '小时', recommend: '推荐 24', brief: '心情超过多少小时不再占正文，只收成一行点名。', detail: '默认：24。影响：不修改账本值，只影响呈现。' },
  },
  {
    key: 'bleedMinLevel', group: 'inject', topic: 'C', alias: '渗透 心情 传染 跨场合 浓度', label: '别处的情绪多浓才带过来', level: 'caution',
    range: '1–10（默认 6）',
    why: '作用：别场合的情绪浓到几级才渗入本场合。\n默认：7。影响：调低会更易串场。',
    ui: { unit: '级', recommend: '推荐 6~8', brief: '别场合的情绪浓到几级才渗入本场合。', detail: '默认：7。影响：调低会更易串场。' },
  },
  {
    key: 'bleedMaxHours', group: 'inject', topic: 'C', alias: '渗透 心情 新的 多久 跨场合', label: '多新的别处情绪才会带过来', level: 'caution',
    range: '0–168 小时（默认 12，0＝不带）',
    why: '作用：别场合的情绪多新才渗入（小时）。\n默认：12。影响：调大带入更久之前的状态。',
    ui: { unit: '小时', recommend: '推荐 6~12', brief: '别场合的情绪多新才渗入（小时）。', detail: '默认：12。影响：调大带入更久之前的状态。' },
  },
  {
    key: 'stateDir', group: 'ledger', topic: 'C', alias: '账本 目录 数据', label: '账本目录', level: 'danger',
    range: '绝对路径',
    why: '改了等于换一份账：旧目录里的心情、待办、改动记录都不会跟过来。改之前先 export。',
    ui: { unit: '', recommend: '', brief: '改了等于换一份账：旧目录里的心情、待办、改动记录都不会跟过来。', detail: '改之前先 export。' },
  },
  {
    key: 'pageBind', group: 'page', topic: 'G', alias: '观测页 端口 绑定 手机 远程', label: '观测页绑定地址', level: 'danger',
    range: 'IP / localhost',
    why: '作用：观测页绑定地址。\n默认：127.0.0.1。影响：改 0.0.0.0 会暴露到网络，需自控访问。',
    ui: { unit: '', recommend: '', brief: '观测页绑定地址。', detail: '默认：127.0.0.1。影响：改 0.0.0.0 会暴露到网络，需自控访问。' },
  },
  {
    key: 'freeTime', group: 'switch', topic: 'D', alias: '自由时间 叫醒 放风', label: '自由时间', level: 'danger',
    range: 'true / false',
    why: '作用：自由时间机制开关。\n默认：true。影响：关闭后不触发自由时间任务。',
    ui: { unit: '', recommend: '', brief: '自由时间机制开关。', detail: '默认：true。影响：关闭后不触发自由时间任务。' },
  },
  {
    key: 'freeTimeSlots', group: 'freetime', topic: 'D', alias: '自由时间 时段 几点 列表 加号', label: '自由时间 · 哪几段', level: 'caution',
    range: '一行一段：「07:00 60」= 起点 + 上限分钟',
    why: '作用：自由时间的时间段列表（如 09:00-10:00）。\n默认：见配置。影响：窗口外不触发。',
    ui: { unit: '', recommend: '', brief: '自由时间的时间段列表（如 09:00-10:00）。', detail: '默认：见配置。影响：窗口外不触发。' },
  },
  {
    key: 'freeTimeFocus', group: 'freetime', topic: 'D', alias: '自由时间 关注 兴趣 看什么 题材', label: '自由时间 · 让她多看什么', level: 'caution',
    range: '一行一条（空 = 不限）',
    why: '作用：自由时间希望她关注的方向，一行一条。\n默认：[]。影响：留空则不给方向。',
    ui: { unit: '', recommend: '', brief: '自由时间希望她关注的方向，一行一条。', detail: '默认：[]。影响：留空则不给方向。' },
  },
  {
    key: 'freeTimeProfile', group: 'freetime', topic: 'D', alias: '自由时间 profile 环境', label: '自由时间用哪个 profile', level: 'danger',
    range: 'profile 名字（不能带路径）',
    why: '作用：自由时间起会话用的 profile。\n默认：空 = 同当前。影响：填错则该会话起不来。',
    ui: { unit: '', recommend: '', brief: '自由时间起会话用的 profile。', detail: '默认：空 = 同当前。影响：填错则该会话起不来。' },
  },
  {
    key: 'pagePort', group: 'page', topic: 'G', alias: '观测页 端口', label: '观测页端口', level: 'caution',
    range: '1–65535',
    why: '作用：观测页端口。\n默认：8098。影响：端口冲突时页面不可用，不影响主流程。',
    ui: { unit: '', recommend: '推荐 8098', brief: '观测页端口。', detail: '默认：8098。影响：端口冲突时页面不可用，不影响主流程。' },
  },
  {
    key: 'servePage', group: 'switch', topic: 'G', alias: '观测页 开关', label: '开观测页', level: 'caution',
    range: 'true / false',
    why: '作用：是否启动观测页。\n默认：true。影响：关闭后无页面，也不监听端口。',
    ui: { unit: '', recommend: '', brief: '是否启动观测页。', detail: '默认：true。影响：关闭后无页面，也不监听端口。' },
  },
  {
    key: 'indexTtlMs', group: 'inject', topic: 'C', alias: '索引 重建 缓存', label: '索引重建间隔', level: 'caution',
    range: '60000 – 604800000（毫秒）',
    why: '作用：事件索引重建间隔（毫秒）。\n默认：60000。影响：调小更实时、IO 更频繁。',
    ui: { unit: '毫秒', recommend: '推荐 3600000（1 小时）', brief: '事件索引重建间隔（毫秒）。', detail: '默认：60000。影响：调小更实时、IO 更频繁。' },
  },
  {
    key: 'announceOnInstall', group: 'other', topic: 'G', alias: '首次 安装 提示', label: '首次启动提示', level: 'normal',
    range: 'true / false',
    why: '作用：首次启动时输出安装提示。\n默认：true。影响：仅影响日志。',
    ui: { unit: '', recommend: '', brief: '首次启动时输出安装提示。', detail: '默认：true。影响：仅影响日志。' },
  },
  {
    key: 'sessionsRoot', group: 'ledger', topic: 'C', alias: '会话 目录', label: '会话目录', level: 'danger',
    range: '绝对路径',
    why: '作用：会话文件目录，用于索引与审计。\n默认：自动探测。影响：错则索引为空。',
    ui: { unit: '', recommend: '', brief: '会话文件目录，用于索引与审计。', detail: '默认：自动探测。影响：错则索引为空。' },
  },
  {
    key: 'auditDir', group: 'ledger', topic: 'C', alias: '审计 目录', label: '审计日志目录', level: 'danger',
    range: '绝对路径',
    why: '作用：审计日志目录（工具调用留痕）。\n默认：探测。影响：错则审计为空。',
    ui: { unit: '', recommend: '', brief: '审计日志目录（工具调用留痕）。', detail: '默认：探测。影响：错则审计为空。' },
  },
  {
    key: 'historyDir', group: 'ledger', topic: 'C', alias: '历史 对话 目录', label: '对话历史目录', level: 'danger',
    range: '绝对路径',
    why: '作用：对话历史目录（napcat 落盘）。\n默认：探测。影响：错则「今天聊到哪」为空。',
    ui: { unit: '', recommend: '', brief: '对话历史目录（napcat 落盘）。', detail: '默认：探测。影响：错则「今天聊到哪」为空。' },
  },
  {
    key: 'personaHome', group: 'ledger', topic: 'A', alias: '人格 目录 人格文件', label: '人格目录', level: 'danger',
    range: '绝对路径',
    why: '作用：人格文件目录。\n默认：探测。影响：错则读不到人格补充。',
    ui: { unit: '', recommend: '', brief: '人格文件目录。', detail: '默认：探测。影响：错则读不到人格补充。' },
  },
  {
    key: 'allowManualMoodOverride', group: 'boundary', topic: 'E', alias: '改写 她的心 心情 暗道', label: '允许人工改写她的心情', level: 'danger',
    range: 'true / false（默认 false）',
    why: '作用：是否允许人工改写她的心情。\n默认：false。影响：开启后改写会明确标注「不是你自己的」。',
    ui: { unit: '', recommend: '', brief: '是否允许人工改写她的心情。', detail: '默认：false。影响：开启后改写会明确标注「不是你自己的」。' },
  },
  {
    key: 'maxManualMoodOverridePerWeek', group: 'boundary', topic: 'E', alias: '改写 次数 上限 限额', label: '一周最多改写几次', level: 'danger',
    range: '0–99（默认 3）',
    why: '作用：一周最多改写几次。\n默认：3。影响：超额拒绝写入。',
    ui: { unit: '次/周', recommend: '推荐 3', brief: '一周最多改写几次。', detail: '默认：3。影响：超额拒绝写入。' },
  },
  {
    key: 'ownerId', group: 'ledger', topic: 'C', alias: '他 主人 owner QQ号 发给谁 收件人', label: '他本人的号', level: 'caution',
    range: '一串数字（QQ 号）；留空 = 不认识他',
    why: '作用：他本人的 QQ 号，用于过滤只属于他的记录。\n默认：空。影响：留空则不过滤，群消息可能混入。',
    ui: { unit: '', recommend: '', brief: '他本人的 QQ 号，用于过滤只属于他的记录。', detail: '默认：空。影响：留空则不过滤，群消息可能混入。' },
  },
  {
    key: 'msgsDir', group: 'ledger', topic: 'C', alias: '消息 账本 目录 第四路 落盘', label: '落盘消息目录', level: 'danger',
    range: '绝对路径；留空 = 不接这一路',
    why: '作用：落盘消息目录。\n默认：探测。影响：错则对账无数据。',
    ui: { unit: '', recommend: '', brief: '落盘消息目录。', detail: '默认：探测。影响：错则对账无数据。' },
  },
  {
    key: 'promptFree', group: 'prompt', topic: 'H', alias: '提示词 自由时间 唤醒 文案 说什么', label: '自由时间 · 提示词', level: 'caution',
    range: '整段文本（留空 = 用内置那版）',
    why: '作用：自由时间的提示词正文。\n默认：内置。影响：直接决定自由时间的产出质量。',
    ui: { unit: '', recommend: '', brief: '自由时间的提示词正文。', detail: '默认：内置。影响：直接决定自由时间的产出质量。' },
  },
  {
    key: 'promptPing', group: 'prompt', topic: 'H', alias: '提示词 短唤醒 文案 说什么', label: '短唤醒 · 提示词', level: 'caution',
    range: '整段文本（留空 = 用内置那版）',
    why: '作用：短唤醒的提示词正文。\n默认：内置。影响：直接决定唤醒时的开场行为。',
    ui: { unit: '', recommend: '', brief: '短唤醒的提示词正文。', detail: '默认：内置。影响：直接决定唤醒时的开场行为。' },
  },
  {
    key: 'promptVoiceTail', group: 'prompt', topic: 'H', alias: '提示词 主动开口 配额 别催', label: '「你能主动开口」的尾句', level: 'caution',
    range: '一两句话（留空 = 用内置那句）',
    why: '作用：「你能主动开口」段的尾句。\n默认：内置。影响：弱化会让主动消息变少。',
    ui: { unit: '', recommend: '', brief: '「你能主动开口」段的尾句。', detail: '默认：内置。影响：弱化会让主动消息变少。' },
  },
  {
    key: 'promptTodayTail', group: 'prompt', topic: 'H', alias: '提示词 今天我 战报 念出来', label: '「今天我」的尾句', level: 'caution',
    range: '一句话（留空 = 用内置那句）',
    why: '作用：「今天我」段的尾句。\n默认：内置。影响：控制该段的用法约束。',
    ui: { unit: '', recommend: '', brief: '「今天我」段的尾句。', detail: '默认：内置。影响：控制该段的用法约束。' },
  },
  {
    key: 'promptMoodBan', group: 'prompt', topic: 'H', alias: '提示词 心情 禁令 素材 说出来', label: '心情段的禁令句', level: 'caution',
    range: '一句话（留空 = 用内置那句）',
    why: '作用：心情段的禁令句（「知道就行，不必说出来」）。\n默认：内置。影响：删除后她会把心情当聊天素材说出来（已对照验证）。',
    ui: { unit: '', recommend: '', brief: '心情段的禁令句（「知道就行，不必说出来」）。', detail: '默认：内置。影响：删除后她会把心情当聊天素材说出来（已对照验证）。' },
  },
  {
    key: 'capsOn', group: 'caps', topic: 'H', alias: '外部能力 总开关 api', label: '外部能力总开关', level: 'caution',
    range: 'true / false（默认 true）',
    why: '作用：外部能力总开关。\n默认：true。影响：关闭后 rh_call 直接拒调。',
    ui: { unit: '', recommend: '', brief: '外部能力总开关。', detail: '默认：true。影响：关闭后 rh_call 直接拒调。' },
  },
  {
    key: 'capsFile', group: 'caps', topic: 'H', alias: '能力 配方 文件 路径', label: '配方文件路径', level: 'normal',
    range: '路径（默认空 = 账本目录/capabilities.json）',
    why: '作用：能力配方文件路径。\n默认：空 = 账本目录下 capabilities.json。影响：设置页「外部能力」有内容时以设置页为准。',
    ui: { unit: '', recommend: '', brief: '能力配方文件路径。', detail: '默认：空 = 账本目录下 capabilities.json。影响：设置页「外部能力」有内容时以设置页为准。' },
  },
  {
    key: 'capsDailyLimit', group: 'caps', topic: 'H', alias: '额度 次数 上限 花钱', label: '每条能力每日上限', level: 'caution',
    range: '整数（默认 30，0 = 不限）',
    why: '作用：每条能力每天最多调用次数（0 = 不限）。\n默认：30。影响：生成类按次计费，这是成本闸。',
    ui: { unit: '次/天', recommend: '推荐 20~50（0 = 不限）', brief: '每条能力每天最多调用次数（0 = 不限）。', detail: '默认：30。影响：生成类按次计费，这是成本闸。' },
  },
  {
    key: 'capsJson', group: 'caps', topic: 'H', alias: '配方 json 模型 端点 形态', label: '能力配方（整份 JSON）', level: 'caution',
    range: '{version, items[]}',
    why: '作用：能力配方（整份 JSON）。留空则用 capabilities.json。\n默认：空。影响：写了就以这里为准；不含密钥，可整段分享。\n修改后需重启。',
    ui: { unit: '', recommend: '', brief: '能力配方（整份 JSON）。留空则用 capabilities.json。', detail: '默认：空。影响：写了就以这里为准；不含密钥，可整段分享。\n修改后需重启。' },
  },
  {
    key: 'injectOffSections', group: 'inject', topic: 'C', alias: '', label: '关掉哪几段注入', level: 'caution',
    range: 'clock / mood / mood-nudge / admit / linger / reopen / hold / recall / situation / work / days / today / voice / own / exp / claim / view / where / style / pending-change / pending / status-page / kept / time',
    why: '作用：按段名关掉注入的某一段，空 = 全开。\n默认：[]。影响：关错会让她缺一块上下文，但不会报错。',
    ui: { unit: '', recommend: '', brief: '按段名关掉注入的某一段，空 = 全开。', detail: '默认：[]。影响：关错会让她缺一块上下文，但不会报错。' },
  },
  {
    key: 'moodShowMax', group: 'inject', topic: 'C', alias: '', label: '心情一次摆几条', level: 'normal',
    range: '1-20（默认 5）',
    why: '作用：同时并存的心情最多摆几条。\n默认：5。影响：调小可能丢掉「又喜又悲」并存的那一半。',
    ui: { unit: '条', recommend: '推荐 3~5', brief: '同时并存的心情最多摆几条。', detail: '默认：5。影响：调小可能丢掉「又喜又悲」并存的那一半。' },
  },
  {
    key: 'capsTimeoutMs', group: 'caps', topic: 'H', alias: '', label: '外部调用超时（毫秒）', level: 'normal',
    range: '5000-1800000（默认 120000）',
    why: '作用：单次外部 API 调用的上限。\n默认：120000。影响：视频类要留够（生成常需数分钟）。',
    ui: { unit: '毫秒', recommend: '推荐 120000', brief: '单次外部 API 调用的上限。', detail: '默认：120000。影响：视频类要留够（生成常需数分钟）。' },
  },
  {
    key: 'capsPollMs', group: 'caps', topic: 'H', alias: '', label: '异步轮询间隔（毫秒）', level: 'normal',
    range: '500-120000（默认 5000）',
    why: '作用：异步任务多久查一次。\n默认：5000。影响：调小更快出结果但请求更多；记录里写了 pollMs 时以记录为准。',
    ui: { unit: '毫秒', recommend: '推荐 5000', brief: '异步任务多久查一次。', detail: '默认：5000。影响：调小更快出结果但请求更多；记录里写了 pollMs 时以记录为准。' },
  },
  {
    key: 'capsRetry', group: 'caps', topic: 'H', alias: '', label: '失败重试次数', level: 'normal',
    range: '0-5（默认 1）',
    why: '作用：网络错误与 5xx 的重试次数。\n默认：1。影响：4xx 不重试（参数错重试也一样错）。',
    ui: { unit: '次', recommend: '推荐 1', brief: '网络错误与 5xx 的重试次数。', detail: '默认：1。影响：4xx 不重试（参数错重试也一样错）。' },
  },
  {
    key: 'capsConfirmPrompt', group: 'caps', topic: 'H', alias: '', label: '提示词最短长度（先问门槛）', level: 'caution',
    range: '0-200（默认 6）',
    why: '作用：生图/生视频的提示词少于这么多字就先问、不直接跑。\n默认：6。影响：调 0 = 不再拦截（force 也可绕过）。',
    ui: { unit: '字', recommend: '推荐 6', brief: '生图/生视频的提示词少于这么多字就先问、不直接跑。', detail: '默认：6。影响：调 0 = 不再拦截（force 也可绕过）。' },
  },
  {
    key: 'capsMediaKeepDays', group: 'caps', topic: 'H', alias: '', label: '媒体文件保留天数', level: 'normal',
    range: '0-3650（默认 30，0 = 不清理）',
    why: '作用：media 目录下按天分的旧目录多久清一次。\n默认：30。影响：调 0 则不清理，磁盘会一直长。',
    ui: { unit: '天', recommend: '推荐 30（0 = 不清理）', brief: 'media 目录下按天分的旧目录多久清一次。', detail: '默认：30。影响：调 0 则不清理，磁盘会一直长。' },
  },
  {
    key: 'talkGapMinutes', group: 'inject', topic: 'C', alias: '', label: '「今天聊到哪」切段间隔', level: 'normal',
    range: '5-720 分钟（默认 20）',
    why: '作用：把对话按间隔切成话题段，取最近两段摆进注入。\n默认：20 分钟。影响：调小会把一段话拆散，调大可能跨到上一个话题。',
    ui: { unit: '分钟', recommend: '推荐 20', brief: '把对话按间隔切成话题段，取最近两段摆进注入。', detail: '默认：20 分钟。影响：调小会把一段话拆散，调大可能跨到上一个话题。' },
  },
  {
    key: 'talkSummaryChars', group: 'inject', topic: 'C', alias: '', label: '摘要字数上限', level: 'normal',
    range: '20-400（默认 60）',
    why: '作用：一句话概括那段聊了什么，最长多少字。\n默认：60。影响：太短失去信息，太长挤占预算。',
    ui: { unit: '字', recommend: '推荐 60', brief: '一句话概括那段聊了什么，最长多少字。', detail: '默认：60。影响：太短失去信息，太长挤占预算。' },
  },
  {
    key: 'talkBudgetChars', group: 'inject', topic: 'C', alias: '', label: '「今天聊到哪」总预算', level: 'normal',
    range: '100-2000（默认 380）',
    why: '作用：摘要 + 最近两轮原文合起来最多多少字。\n默认：380。影响：超了先丢最旧的轮，最后才丢摘要。',
    ui: { unit: '字', recommend: '推荐 380', brief: '摘要 + 最近两轮原文合起来最多多少字。', detail: '默认：380。影响：超了先丢最旧的轮，最后才丢摘要。' },
  },
  {
    key: 'promptTalkSummary', group: 'prompt', topic: 'C', alias: '', label: '摘要的指令句', level: 'caution',
    range: '文本（默认空 = 内置）',
    why: '作用：让模型概括那段对话时用的指令。\n默认：空，用内置那句（含「只根据这段对话／不写动作描写」）。影响：删掉这几条约束它会开始编。',
    ui: { unit: '', recommend: '', brief: '让模型概括那段对话时用的指令。', detail: '默认：空，用内置那句（含「只根据这段对话／不写动作描写」）。影响：删掉这几条约束它会开始编。' },
  },
  {
    key: 'moodNudgeWords', group: 'inject', topic: 'C', alias: '', label: '情绪词表', level: 'normal',
    range: '字符串数组',
    why: '作用：短唤醒时拿这些词去最近几条消息里找「状态是不是变了」。\n默认：22 个常用词。影响：词太少抓不到钩子，太多会误报。',
    ui: { unit: '', recommend: '', brief: '短唤醒时拿这些词去最近几条消息里找「状态是不是变了」。', detail: '默认：22 个常用词。影响：词太少抓不到钩子，太多会误报。' },
  },
  {
    key: 'pageRefreshSec', group: 'page', topic: 'C', alias: '', label: '观测页自动刷新（秒）', level: 'normal',
    range: '0-600（默认 5，0 = 不刷新）',
    why: '作用：观测页多久自动刷一次。\n默认：5 秒。影响：调 0 就静止，得手动刷。',
    ui: { unit: '秒', recommend: '推荐 5', brief: '观测页多久自动刷一次。', detail: '默认：5 秒。影响：调 0 就静止，得手动刷。' },
  },
];

/** 面板用的整份描述（带当前值）。Python 侧拿它渲染，不自己维护一份。
 *
 * `builtins`（2026-11-04）：提示词那两项的**内置原文**。它们默认是空串
 * （空 = 用内置），所以面板光看 current 是看不出「留空会发生什么」的 ——
 * 把内置那版一并给出去，页面上就能写「留空时用的是下面这段」。 */
export function describeConfig(current = {}, builtins = {}) {
  const cfg = { ...DEFAULTS, ...plainConfig(current) };
  return {
    fields: FIELD_META.map((m) => ({
      ...m,
      current: cfg[m.key],
      def: DEFAULTS[m.key],
      builtin: builtins[m.key] || '',
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
