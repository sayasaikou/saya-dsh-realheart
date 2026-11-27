/**
 * 只放「给宿主看的 Schema」。
 *
 * 为什么单独一个文件（2026-11-15）：`@deepseek-ai/schemastery` 是 peerDependencies，
 * pnpm 不会把它装进插件目录，只有宿主进程里才解析得到。而 `lib/config.mjs` 原来静态 import 它，
 * 于是**命令行那条路一进门就炸** —— `npx realheart doctor` 报 Cannot find package，
 * 连它自带的「缺就自动补 peer」都跑不到（还没来得及执行就先抛了）。
 *
 * 现在：DEFAULTS / FIELD_META / REGIONS / 校验 / 面板描述全在 config.mjs，不依赖宿主；
 * 只有这个文件需要 schemastery，而且只有宿主会 import 它。
 */
import Schema from '@deepseek-ai/schemastery';
import { DEFAULTS, RANGES } from './config.mjs';

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
  pingJitterMinutes: Schema.number().min(0).max(60).default(DEFAULTS.pingJitterMinutes).volatile(),
  pingMinMinutes: Schema.number().min(0).max(1440).default(DEFAULTS.pingMinMinutes).volatile(),
  pingMaxMinutes: Schema.number().min(0).max(1440).default(DEFAULTS.pingMaxMinutes).volatile(),
  pingFromHour: Schema.number().min(0).max(23).default(DEFAULTS.pingFromHour).volatile(),
  pingToHour: Schema.number().min(0).max(23).default(DEFAULTS.pingToHour).volatile(),
  personaHome: Schema.string().default(DEFAULTS.personaHome).volatile(),
  bleedMinLevel: Schema.number().min(1).max(10).default(DEFAULTS.bleedMinLevel).volatile(),
  bleedMaxHours: Schema.number().min(0).max(168).default(DEFAULTS.bleedMaxHours).volatile(),
  moodFadeHours: Schema.number().min(1).max(720).default(DEFAULTS.moodFadeHours).volatile(),
  moodMaxHours: Schema.number().min(1).max(720).default(DEFAULTS.moodMaxHours).volatile(),
  moodAskWindows: Schema.string().default(DEFAULTS.moodAskWindows).volatile(),
  moodBehavior: Schema.boolean().default(DEFAULTS.moodBehavior).volatile(),
  promptFree: Schema.string().default(DEFAULTS.promptFree).volatile(),
  promptPing: Schema.string().default(DEFAULTS.promptPing).volatile(),
  promptVoiceTail: Schema.string().default(DEFAULTS.promptVoiceTail).volatile(),
  promptTodayTail: Schema.string().default(DEFAULTS.promptTodayTail).volatile(),
  promptMoodBan: Schema.string().default(DEFAULTS.promptMoodBan).volatile(),
  allowManualMoodOverride: Schema.boolean().default(DEFAULTS.allowManualMoodOverride).volatile(),
  maxManualMoodOverridePerWeek: Schema.number().min(0).max(99).default(DEFAULTS.maxManualMoodOverridePerWeek).volatile(),
});

