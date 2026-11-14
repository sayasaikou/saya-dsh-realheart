/**
 * realheart 设置页（浏览器半仓 · 手写客户端模块 · 免构建）。
 *
 * 骨架照抄同类设置页那份（同一条路），但内容是 realheart 自己的。
 *
 * 形态照搬宿主自带的客户端包（@deepseek-ai/dsh-client-ui-settings-plugins）：
 *   window.__ModuleLoader__.load({ id, factory })
 *   factory(require) 里先 `var module = { exports: {} }; var exports = module.exports`，
 *   末尾 `exports.apply = apply; exports.inject = inject; return module.exports`。
 * 少了这两行 `var module/exports` 会在浏览器里抛 `ReferenceError: exports is not defined`，
 * 进而把客户端模块图带崩 —— 这是必须严格照抄的原因。
 *
 * 页面挂在「设置 → 插件」的 settings.plugins.tab 列表槽（与内置插件页同一套）。
 * 读写配置走宿主已有的 settings Remote 域（= ctx.settings / configEditor）：
 *   describe() → 当前值 + revision
 *   update(ns, patch, revision) → 写 profile 的 cordis.patch.yml 并热重载
 * 所以保存后会自动追加配置行，与别的插件行为一致。
 *
 * 顶部 window 守卫：本文件是浏览器专属；万一被 Node 侧扫描/import 时安静退出，绝不拖累宿主启动。
 */

const moduleLoader = typeof window === 'undefined' ? undefined : window.__ModuleLoader__

if (moduleLoader !== undefined && moduleLoader !== null) {
  moduleLoader.load({
    id: 'realheart',
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports

      const react = require('react')

      /** 设置页字段（与 src/config.ts 的 Config 一一对应）。 */
      const FIELDS = [
        { "key": "enabled", "label": "总开关", "kind": "switch", "group": "switch",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "插件总开关。关 = 不注入、不记账、不注册工具，已写的账保留。", "detail": "默认：true。影响：关闭后行为差异极大。" },
        { "key": "injectMood", "label": "每轮注入状态", "kind": "switch", "group": "switch",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "每轮把她的状态（心情、没完的事）注入。", "detail": "默认：true。影响：关闭后她看不到自己的账，仍可写入但不受影响。" },
        { "key": "injectNow", "label": "注入里带上「现在几点」", "kind": "switch", "group": "inject",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "注入当前时间（日期、星期、时段）。", "detail": "默认：true。影响：每轮多几十字；用于判断「此刻合不合适说」。" },
        { "key": "injectVoice", "label": "注入里告诉她「你能主动开口」", "kind": "switch", "group": "inject",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "注入「你手上有主动发消息的路」。", "detail": "默认：true。影响：关闭后主动消息显著减少（实测：写出来之前几乎不发）。" },
        { "key": "voiceHints", "label": "告诉她具体怎么发（可选）", "kind": "tags", "group": "inject",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "给上面那段补具体发送命令，一行一条。", "detail": "默认：[]。影响：留空则只给意图、不给路径。不可自动探测，路径各机不同。" },
        { "key": "injectToday", "label": "注入「今天我」", "kind": "switch", "group": "inject",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "注入「今天我」段（当天做过什么的摘要）。", "detail": "默认：true。影响：每轮多一段；关闭后她对今天没有连续印象。" },
        { "key": "sayLogPath", "label": "主动消息账本在哪", "kind": "text", "group": "ledger",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "主动消息账本的路径，用于「今天已经发过什么」。", "detail": "默认：空 = 由 root/work 推导。影响：路径错则读不到已发记录。" },
        { "key": "pingContext", "label": "短唤醒 · 带上她此刻的调子", "kind": "switch", "group": "switch",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "短唤醒时带上她此刻的调子。", "detail": "默认：true。影响：关闭后唤醒语气与心情脱钩。" },
        { "key": "pingMinMinutes", "label": "短唤醒 · 最短间隔（分钟）", "kind": "number", "group": "switch",
          "level": "caution", "unit": "分钟", "recommend": "推荐 30~60",
          "brief": "每隔一段随机时间叫她醒一下，只做一件事：此刻有没有想说的。", "detail": "有就说，没有就继续睡。跟「自由时间」分开是因为两件事节奏不同 —— 自由时间做东西要连续两小时、打断就做不成；想说话却该是随时能发生的。⚠️ 成本：每次唤醒都是一次完整的模型调用（带注入）。30–60 分钟随机 ≈ 一天二十来次。" },
        { "key": "pingMaxMinutes", "label": "短唤醒 · 最长间隔（分钟）", "kind": "number", "group": "switch",
          "level": "caution", "unit": "分钟", "recommend": "推荐 60~120",
          "brief": "短唤醒最长间隔。", "detail": "默认：60。影响：必须 ≥ 最短间隔。" },
        { "key": "pingFromHour", "label": "短唤醒 · 从几点开始", "kind": "number", "group": "switch",
          "level": "caution", "unit": "点", "recommend": "推荐 8~9",
          "brief": "短唤醒起始小时（0-23）。", "detail": "默认：8。影响：窗口外不唤醒。" },
        { "key": "pingToHour", "label": "短唤醒 · 到几点为止", "kind": "number", "group": "switch",
          "level": "caution", "unit": "点", "recommend": "推荐 22~23",
          "brief": "短唤醒结束小时（0-23）。", "detail": "默认：23。影响：可跨零点（如 22→6）。" },
        { "key": "toolsOff", "label": "关掉哪几个工具", "kind": "tags", "group": "switch",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "按名字停用工具，停用的不注册（不是调用时报错）。", "detail": "默认：[]。影响：减少工具表噪声，提高其余工具的命中率。" },
        { "key": "root", "label": "她的根目录", "kind": "text", "group": "ledger",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "她的根目录，其他路径默认相对它推导。", "detail": "默认：自动探测。影响：填错会导致账本/脚本全面错位。" },
        { "key": "injectBudgetChars", "label": "注入字数上限", "kind": "number", "group": "inject",
          "level": "caution", "unit": "字", "recommend": "推荐 2000~3000",
          "brief": "每轮塞进提示词的总字数。", "detail": "超了从优先级低的那段开始裁：待改 → 没完的事 → 她留的话；心情永不裁。裁掉会记一条。调大是花钱买完整，调小是省钱买残缺。" },
        { "key": "moodTailLines", "label": "注入只读心情账本的最后几条", "kind": "number", "group": "inject",
          "level": "caution", "unit": "条", "recommend": "推荐 100~200",
          "brief": "账本只增不改，注入每轮都要读。", "detail": "只读尾部是为了不让「账本变长」变成「每轮都变慢」。设 0 就每轮读全份 —— 账本很大时会明显拖慢。" },
        { "key": "moodFadeHours", "label": "心情多久算「旧了」", "kind": "number", "group": "inject",
          "level": "caution", "unit": "小时", "recommend": "推荐 24",
          "brief": "心情超过多少小时不再占正文，只收成一行点名。", "detail": "默认：24。影响：不修改账本值，只影响呈现。" },
        { "key": "bleedMinLevel", "label": "别处的情绪多浓才带过来", "kind": "number", "group": "inject",
          "level": "caution", "unit": "级", "recommend": "推荐 6~8",
          "brief": "别场合的情绪浓到几级才渗入本场合。", "detail": "默认：7。影响：调低会更易串场。" },
        { "key": "bleedMaxHours", "label": "多新的别处情绪才会带过来", "kind": "number", "group": "inject",
          "level": "caution", "unit": "小时", "recommend": "推荐 6~12",
          "brief": "别场合的情绪多新才渗入（小时）。", "detail": "默认：12。影响：调大带入更久之前的状态。" },
        { "key": "stateDir", "label": "账本目录", "kind": "text", "group": "ledger",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "改了等于换一份账：旧目录里的心情、待办、改动记录都不会跟过来。", "detail": "改之前先 export。" },
        { "key": "pageBind", "label": "观测页绑定地址", "kind": "text", "group": "page",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "观测页绑定地址。", "detail": "默认：127.0.0.1。影响：改 0.0.0.0 会暴露到网络，需自控访问。" },
        { "key": "freeTime", "label": "自由时间", "kind": "switch", "group": "switch",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "自由时间机制开关。", "detail": "默认：true。影响：关闭后不触发自由时间任务。" },
        { "key": "freeTimeSlots", "label": "自由时间 · 哪几段", "kind": "tags", "group": "freetime",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "自由时间的时间段列表（如 09:00-10:00）。", "detail": "默认：见配置。影响：窗口外不触发。" },
        { "key": "freeTimeFocus", "label": "自由时间 · 让她多看什么", "kind": "tags", "group": "freetime",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "自由时间希望她关注的方向，一行一条。", "detail": "默认：[]。影响：留空则不给方向。" },
        { "key": "freeTimeProfile", "label": "自由时间用哪个 profile", "kind": "text", "group": "freetime",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "自由时间起会话用的 profile。", "detail": "默认：空 = 同当前。影响：填错则该会话起不来。" },
        { "key": "pagePort", "label": "观测页端口", "kind": "number", "group": "page",
          "level": "caution", "unit": "", "recommend": "推荐 8098",
          "brief": "观测页端口。", "detail": "默认：8098。影响：端口冲突时页面不可用，不影响主流程。" },
        { "key": "servePage", "label": "开观测页", "kind": "switch", "group": "switch",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "是否启动观测页。", "detail": "默认：true。影响：关闭后无页面，也不监听端口。" },
        { "key": "indexTtlMs", "label": "索引重建间隔", "kind": "number", "group": "inject",
          "level": "caution", "unit": "毫秒", "recommend": "推荐 3600000（1 小时）",
          "brief": "事件索引重建间隔（毫秒）。", "detail": "默认：60000。影响：调小更实时、IO 更频繁。" },
        { "key": "announceOnInstall", "label": "首次启动提示", "kind": "switch", "group": "other",
          "level": "normal", "unit": "", "recommend": "",
          "brief": "首次启动时输出安装提示。", "detail": "默认：true。影响：仅影响日志。" },
        { "key": "sessionsRoot", "label": "会话目录", "kind": "text", "group": "ledger",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "会话文件目录，用于索引与审计。", "detail": "默认：自动探测。影响：错则索引为空。" },
        { "key": "auditDir", "label": "审计日志目录", "kind": "text", "group": "ledger",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "审计日志目录（工具调用留痕）。", "detail": "默认：探测。影响：错则审计为空。" },
        { "key": "historyDir", "label": "对话历史目录", "kind": "text", "group": "ledger",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "对话历史目录（napcat 落盘）。", "detail": "默认：探测。影响：错则「今天聊到哪」为空。" },
        { "key": "personaHome", "label": "人格目录", "kind": "text", "group": "ledger",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "人格文件目录。", "detail": "默认：探测。影响：错则读不到人格补充。" },
        { "key": "allowManualMoodOverride", "label": "允许人工改写她的心情", "kind": "switch", "group": "boundary",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "是否允许人工改写她的心情。", "detail": "默认：false。影响：开启后改写会明确标注「不是你自己的」。" },
        { "key": "maxManualMoodOverridePerWeek", "label": "一周最多改写几次", "kind": "number", "group": "boundary",
          "level": "danger", "unit": "次/周", "recommend": "推荐 3",
          "brief": "一周最多改写几次。", "detail": "默认：3。影响：超额拒绝写入。" },
        { "key": "ownerId", "label": "他本人的号", "kind": "text", "group": "ledger",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "他本人的 QQ 号，用于过滤只属于他的记录。", "detail": "默认：空。影响：留空则不过滤，群消息可能混入。" },
        { "key": "msgsDir", "label": "落盘消息目录", "kind": "text", "group": "ledger",
          "level": "danger", "unit": "", "recommend": "",
          "brief": "落盘消息目录。", "detail": "默认：探测。影响：错则对账无数据。" },
        { "key": "promptFree", "label": "自由时间 · 提示词", "kind": "code", "group": "prompt",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "自由时间的提示词正文。", "detail": "默认：内置。影响：直接决定自由时间的产出质量。", "rows": 6 },
        { "key": "promptPing", "label": "短唤醒 · 提示词", "kind": "code", "group": "prompt",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "短唤醒的提示词正文。", "detail": "默认：内置。影响：直接决定唤醒时的开场行为。", "rows": 6 },
        { "key": "promptVoiceTail", "label": "「你能主动开口」的尾句", "kind": "code", "group": "prompt",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "「你能主动开口」段的尾句。", "detail": "默认：内置。影响：弱化会让主动消息变少。", "rows": 6 },
        { "key": "promptTodayTail", "label": "「今天我」的尾句", "kind": "code", "group": "prompt",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "「今天我」段的尾句。", "detail": "默认：内置。影响：控制该段的用法约束。", "rows": 6 },
        { "key": "promptMoodBan", "label": "心情段的禁令句", "kind": "code", "group": "prompt",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "心情段的禁令句（「知道就行，不必说出来」）。", "detail": "默认：内置。影响：删除后她会把心情当聊天素材说出来（已对照验证）。", "rows": 6 },
        { "key": "capsOn", "label": "外部能力总开关", "kind": "switch", "group": "caps",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "外部能力总开关。", "detail": "默认：true。影响：关闭后 rh_call 直接拒调。" },
        { "key": "capsFile", "label": "配方文件路径", "kind": "text", "group": "caps",
          "level": "normal", "unit": "", "recommend": "",
          "brief": "能力配方文件路径。", "detail": "默认：空 = 账本目录下 capabilities.json。影响：设置页「外部能力」有内容时以设置页为准。" },
        { "key": "capsDailyLimit", "label": "每条能力每日上限", "kind": "number", "group": "caps",
          "level": "caution", "unit": "次/天", "recommend": "推荐 20~50（0 = 不限）",
          "brief": "每条能力每天最多调用次数（0 = 不限）。", "detail": "默认：30。影响：生成类按次计费，这是成本闸。" },
        { "key": "capsJson", "label": "能力配方（整份 JSON）", "kind": "code", "group": "caps",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "能力配方（整份 JSON）。留空则用 capabilities.json。", "detail": "默认：空。影响：写了就以这里为准；不含密钥，可整段分享。\n修改后需重启。", "rows": 22 },
        { "key": "injectOffSections", "label": "关掉哪几段注入", "kind": "tags", "group": "inject",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "按段名关掉注入的某一段，空 = 全开。", "detail": "默认：[]。影响：关错会让她缺一块上下文，但不会报错。" },
        { "key": "moodShowMax", "label": "心情一次摆几条", "kind": "number", "group": "inject",
          "level": "normal", "unit": "条", "recommend": "推荐 3~5",
          "brief": "同时并存的心情最多摆几条。", "detail": "默认：5。影响：调小可能丢掉「又喜又悲」并存的那一半。" },
        { "key": "capsTimeoutMs", "label": "外部调用超时（毫秒）", "kind": "number", "group": "caps",
          "level": "normal", "unit": "毫秒", "recommend": "推荐 120000",
          "brief": "单次外部 API 调用的上限。", "detail": "默认：120000。影响：视频类要留够（生成常需数分钟）。" },
        { "key": "capsPollMs", "label": "异步轮询间隔（毫秒）", "kind": "number", "group": "caps",
          "level": "normal", "unit": "毫秒", "recommend": "推荐 5000",
          "brief": "异步任务多久查一次。", "detail": "默认：5000。影响：调小更快出结果但请求更多；记录里写了 pollMs 时以记录为准。" },
        { "key": "capsRetry", "label": "失败重试次数", "kind": "number", "group": "caps",
          "level": "normal", "unit": "次", "recommend": "推荐 1",
          "brief": "网络错误与 5xx 的重试次数。", "detail": "默认：1。影响：4xx 不重试（参数错重试也一样错）。" },
        { "key": "capsConfirmPrompt", "label": "提示词最短长度（先问门槛）", "kind": "number", "group": "caps",
          "level": "caution", "unit": "字", "recommend": "推荐 6",
          "brief": "生图/生视频的提示词少于这么多字就先问、不直接跑。", "detail": "默认：6。影响：调 0 = 不再拦截（force 也可绕过）。" },
        { "key": "capsMediaKeepDays", "label": "媒体文件保留天数", "kind": "number", "group": "caps",
          "level": "normal", "unit": "天", "recommend": "推荐 30（0 = 不清理）",
          "brief": "media 目录下按天分的旧目录多久清一次。", "detail": "默认：30。影响：调 0 则不清理，磁盘会一直长。" },
        { "key": "talkGapMinutes", "label": "「今天聊到哪」切段间隔", "kind": "number", "group": "inject",
          "level": "normal", "unit": "分钟", "recommend": "推荐 20",
          "brief": "把对话按间隔切成话题段，取最近两段摆进注入。", "detail": "默认：20 分钟。影响：调小会把一段话拆散，调大可能跨到上一个话题。" },
        { "key": "talkSummaryChars", "label": "摘要字数上限", "kind": "number", "group": "inject",
          "level": "normal", "unit": "字", "recommend": "推荐 60",
          "brief": "一句话概括那段聊了什么，最长多少字。", "detail": "默认：60。影响：太短失去信息，太长挤占预算。" },
        { "key": "talkBudgetChars", "label": "「今天聊到哪」总预算", "kind": "number", "group": "inject",
          "level": "normal", "unit": "字", "recommend": "推荐 380",
          "brief": "摘要 + 最近两轮原文合起来最多多少字。", "detail": "默认：380。影响：超了先丢最旧的轮，最后才丢摘要。" },
        { "key": "promptTalkSummary", "label": "摘要的指令句", "kind": "code", "group": "prompt",
          "level": "caution", "unit": "", "recommend": "",
          "brief": "让模型概括那段对话时用的指令。", "detail": "默认：空，用内置那句（含「只根据这段对话／不写动作描写」）。影响：删掉这几条约束它会开始编。", "rows": 6 },
        { "key": "moodNudgeWords", "label": "情绪词表", "kind": "tags", "group": "inject",
          "level": "normal", "unit": "", "recommend": "",
          "brief": "短唤醒时拿这些词去最近几条消息里找「状态是不是变了」。", "detail": "默认：22 个常用词。影响：词太少抓不到钩子，太多会误报。" },
        { "key": "pageRefreshSec", "label": "观测页自动刷新（秒）", "kind": "number", "group": "page",
          "level": "normal", "unit": "秒", "recommend": "推荐 5",
          "brief": "观测页多久自动刷一次。", "detail": "默认：5 秒。影响：调 0 就静止，得手动刷。" }
      ]
      const GROUP_LABEL = {
            "switch": "开关",
            "inject": "注入",
            "ledger": "路径与账本",
            "page": "观测页",
            "freetime": "自由时间",
            "boundary": "边界",
            "prompt": "提示词",
            "caps": "外部能力",
            "other": "其它"
      }

      const NS = 'realheart'
      const style = {
        wrap: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '620px' },
        tabs: { display: 'flex', flexWrap: 'wrap', gap: '6px', borderBottom: '1px solid var(--dsw-alias-border-l2, #d0d0d0)', paddingBottom: '10px' },
        tabOn: { font: 'inherit', fontSize: '12px', padding: '5px 11px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)', background: 'var(--dsw-alias-bg-l1, #fff)', color: 'inherit', cursor: 'pointer', fontWeight: 600 },
        tabOff: { font: 'inherit', fontSize: '12px', padding: '5px 11px', borderRadius: '6px', border: '1px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #888)', cursor: 'pointer' },
        fieldHead: { display: 'flex', alignItems: 'center', gap: '6px' },
        rec: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)' },
        help: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '15px', height: '15px', borderRadius: '50%', border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)', fontSize: '10px', color: 'var(--dsw-alias-label-tertiary, #888)', cursor: 'help', userSelect: 'none' },
        brief: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary, #888)', margin: 0, lineHeight: 1.55 },
        value: { fontSize: '13px', color: 'var(--dsw-alias-label-primary, #333)', padding: '3px 0', wordBreak: 'break-word' },
        numWrap: { display: 'flex', alignItems: 'center', gap: '6px' },
        unit: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' },
        switchWrap: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' },
        switchBox: { width: '16px', height: '16px' },
        switchText: { fontSize: '13px' },
        hint: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' },
        row: { display: 'flex', flexDirection: 'column', gap: '4px' },
        label: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #555)' },
        input: {
          font: 'inherit', fontSize: '13px', padding: '7px 9px', borderRadius: '6px',
          border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)',
          background: 'var(--dsw-alias-bg-l1, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
        },
        checkRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
        bar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
        btn: {
          font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
          border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)', background: 'transparent', color: 'inherit',
        },
        primary: {
          font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
          border: '1px solid transparent', background: 'var(--dsw-alias-state-business-primary, #1677ff)', color: '#fff',
        },
        error: { color: 'var(--dsw-alias-state-error-primary, #d4380d)', fontSize: '12px', margin: 0, whiteSpace: 'pre-wrap' },
        ok: { color: 'var(--dsw-alias-state-success-primary, #389e0d)', fontSize: '12px', margin: 0 },
      }

      /** 值 → 输入框里的字符串。
       * 对象/数组走 JSON，别让 String() 把它变成 "[object Object]"。 */
      function fmtValue(v) {
        if (v === undefined || v === null) return ''
        if (typeof v === 'object') return JSON.stringify(v, null, 2)
        return String(v)
      }

      /** 解包 Remote 结果：{ ok, value } / { ok:false, error }。 */
      function unwrap(result) {
        if (result !== null && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
          if (result.ok !== true) {
            const code = result.error && result.error.code
            const message = result.error && result.error.message
            throw new Error((code ? code + ': ' : '') + (message || 'remote call failed'))
          }
          return result.value
        }
        return result
      }

      /** Remote 方法签名（见 typert.remote-client.d.ts）：
       *  describe() → { writable, hasDocument, namespaces: SettingsNamespaceView[] }
       *  update(ns, patch, expectedRevision) → SettingsNamespaceView
       * 两者都返回 { ok, value } 包装。
       */

      /** 取 Remote 门面（客户端服务名 `remote`）。 */
      function remoteOf(ctx) {
        try {
          const viaNamespace = ctx.remote && ctx.remote.settings
          if (viaNamespace && typeof viaNamespace.describe === 'function') return { settings: viaNamespace }
          const viaService = typeof ctx.get === 'function' ? ctx.get('remote.settings') : undefined
          if (viaService && typeof viaService.describe === 'function') return { settings: viaService }
          return null
        } catch (error) {
          return null
        }
      }

      function toList(value) {
        const raw = String(value == null ? '' : value)
        return raw.split(/[,，\s]+/).map((item) => item.trim()).filter((item) => item !== '')
      }

      /** 一个配置项。只读时只给值；编辑时给控件。
       *  下方一行小灰字是核心说明，右侧 ⓘ 的 title 里才是大段来历（原生 tooltip，悬停约 1 秒出现）。 */
      function renderField(field, value, onChange, editing) {
        const id = NS + '-' + field.key
        const ro = !editing

        // 只读时把值翻成能读的样子
        const shown = () => {
          if (field.kind === 'switch') return Boolean(value) ? '开' : '关'
          if (field.kind === 'tags') return Array.isArray(value) && value.length ? value.join('、') : '（空）'
          if (value === undefined || value === null || value === '') return '（默认）'
          const s = String(value)
          return s.length > 160 ? s.slice(0, 160) + '…' : s
        }

        let control
        if (ro) {
          control = react.createElement('div', { style: style.value }, shown())
        } else if (field.kind === 'switch') {
          control = react.createElement('label', { style: style.switchWrap, htmlFor: id },
            react.createElement('input', {
              id, type: 'checkbox', checked: Boolean(value), style: style.switchBox,
              onChange: (event) => onChange(field.key, event.target.checked),
            }),
            react.createElement('span', { style: style.switchText }, Boolean(value) ? '开' : '关'))
        } else if (field.kind === 'code') {
          control = react.createElement('textarea', {
            id, style: Object.assign({}, style.input, {
              minHeight: (field.rows || 6) * 16 + 'px',
              fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px',
            }),
            value: fmtValue(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        } else if (field.kind === 'tags') {
          control = react.createElement('input', {
            id, type: 'text', style: style.input,
            placeholder: '用逗号分隔',
            value: Array.isArray(value) ? value.join(', ') : fmtValue(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        } else if (field.kind === 'number') {
          control = react.createElement('div', { style: style.numWrap },
            react.createElement('input', {
              id, type: 'number', style: Object.assign({}, style.input, { width: '160px' }),
              value: fmtValue(value),
              onChange: (event) => onChange(field.key, event.target.value === '' ? undefined : Number(event.target.value)),
            }),
            field.unit ? react.createElement('span', { style: style.unit }, field.unit) : null)
        } else {
          control = react.createElement('input', {
            id, type: 'text', style: style.input, value: fmtValue(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        }

        const head = react.createElement('div', { style: style.fieldHead },
          react.createElement('label', { style: style.label, htmlFor: id }, field.label),
          field.recommend ? react.createElement('span', { style: style.rec }, field.recommend) : null,
          field.detail ? react.createElement('span', { style: style.help, title: field.detail }, '?') : null)

        return react.createElement('div', { style: style.row, key: field.key },
          head,
          control,
          field.brief ? react.createElement('p', { style: style.brief }, field.brief) : null)
      }

      /** 页面主体。only = 只显示某一组的字段（用来把一个组单开成一页）。 */
      function RealheartSettingsPage(props) {
        const ctx = props.ctx
        const only = props.only || ''
        // 页内标签：组当标签页，一次只看一组。默认落第一组。
        const groups = []
        for (const field of FIELDS) if (groups.indexOf(field.group) < 0) groups.push(field.group)
        const [tab, setTab] = react.useState('')
        const activeTab = tab !== '' && groups.indexOf(tab) >= 0 ? tab : groups[0]
        const shown = FIELDS.filter((field) => field.group === activeTab)
        const [state, setState] = react.useState({ phase: 'loading' })
        const [draft, setDraft] = react.useState({})
        const [revision, setRevision] = react.useState(undefined)
        const [message, setMessage] = react.useState(undefined)
        // 默认只读：进页面先看，点「编辑」才允许改（2026-11-14 沙耶）
        const [editing, setEditing] = react.useState(false)
          const [writable, setWritable] = react.useState(true)

        const load = react.useCallback(async () => {
          const remote = remoteOf(ctx)
          if (remote === null) {
            setState({ phase: 'unsupported' })
            return
          }
          setState({ phase: 'loading' })
          try {
            const described = unwrap(await remote.settings.describe())
            const list = described && Array.isArray(described.namespaces) ? described.namespaces : []
            if (!Array.isArray(described && described.namespaces)) {
              throw new Error('describe 返回的形状不对：' + JSON.stringify(described).slice(0, 200))
            }
            setWritable(described.writable !== false)
            const row = list.find((item) => item && item.ns === NS)
            if (row === undefined) {
              setState({ phase: 'missing' })
              return
            }
            const normalized = Object.assign({}, row.value || {})
            for (const field of FIELDS) {
              if (field.kind === 'list' && Array.isArray(normalized[field.key])) {
                normalized[field.key] = normalized[field.key].join(', ')
              }
            }
            setDraft(normalized)
            setRevision(row.revision)
            setState({ phase: 'ready' })
          } catch (error) {
            setState({ phase: 'error', error: String(error && error.message ? error.message : error) })
          }
        }, [ctx])

        react.useEffect(() => { void load() }, [load])

        const save = async () => {
          const remote = remoteOf(ctx)
          if (remote === null) return
          setMessage(undefined)
          try {
            const described = unwrap(await remote.settings.describe())
            const list = described && Array.isArray(described.namespaces) ? described.namespaces : []
            if (!Array.isArray(described && described.namespaces)) {
              throw new Error('describe 返回的形状不对：' + JSON.stringify(described).slice(0, 200))
            }
            setWritable(described.writable !== false)
            const row = list.find((item) => item && item.ns === NS)
            const next = {}
            for (const field of FIELDS) {
              if (!Object.prototype.hasOwnProperty.call(draft, field.key)) continue
              // 数组字段在表单里是逗号分隔字符串，保存时再解析
              next[field.key] = field.kind === 'list' ? toList(draft[field.key]) : draft[field.key]
            }
            await unwrap(await remote.settings.update(NS, next, row ? row.revision : revision))
            setMessage({ ok: true, text: '已保存（写入 profile 的 cordis.patch.yml，插件会热重载）' })
            await load()
          } catch (error) {
            setMessage({ ok: false, text: '保存失败：' + String(error && error.message ? error.message : error) })
          }
        }

        if (state.phase === 'loading') return react.createElement('p', { style: style.hint }, '读取配置中…')

        if (state.phase === 'unsupported') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.hint }, '当前宿主没有暴露 settings Remote 域，无法在本页读写配置。可以手动在 profile 的 cordis.patch.yml 追加：'),
            react.createElement('pre', { style: style.hint },
              '- id: ' + NS + '\n  name: ' + NS + '\n  config:\n    mode: forward\n    url: ws://<napcat-ip>:3001\n    accessToken: <token>\n    adminUsers: [\'<你的QQ>\']'))
        }

        if (state.phase === 'missing') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.hint }, '宿主里没找到 realheart 的配置条目。确认插件已安装并启用，再点重试。'),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重试'))
        }

        if (state.phase === 'error') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.error }, '读取配置失败：' + state.error),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重试'))
        }

        const editBtn = react.createElement('button', {
          onClick: () => setEditing(!editing),
          style: editing ? style.primary : style.btn,
        }, editing ? '完成编辑' : '编辑')

        const tabBar = react.createElement('div', { style: style.tabs },
          groups.map((g) => react.createElement('button', {
            key: g,
            onClick: () => setTab(g),
            style: g === activeTab ? style.tabOn : style.tabOff,
          }, GROUP_LABEL[g] || g)),
          react.createElement('span', { style: { flex: 1 } }),
          editBtn)

        return react.createElement('div', { style: style.wrap },
          tabBar,
          react.createElement('p', { style: style.hint },
            '保存后写入 profile 的 cordis.patch.yml 并热重载插件。' +
            (revision === undefined ? '' : ' 当前 revision：' + revision)),
          shown.map((field) => renderField(field, draft[field.key], (key, value) => {
            setDraft((previous) => {
              const nextDraft = Object.assign({}, previous)
              nextDraft[key] = value
              return nextDraft
            })
          }, editing)),
          react.createElement('div', { style: style.bar },
            editing ? react.createElement('button', { style: style.primary, onClick: () => void save() }, '保存') : null,
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重新读取'),
            message === undefined ? null
              : react.createElement('p', { style: message.ok ? style.ok : style.error }, message.text)))
      }

      // remote.settings = @deepseek-ai/dsh-api-settings-controller 暴露的 settings Remote 域
      // （configEditor / ctx.settings 的浏览器半边），读写配置都走它。
      const inject = ['slots', 'remote', 'remote.settings']

      /** 注册成「设置」左侧菜单里的独立页面（与「内置插件」同级）。
       *  2026-11-14：外部能力单开一页 —— 那堆配方塞在二十来项配置中间没人找得到。 */
      function apply(ctx) {
        const Page = (props) => react.createElement(RealheartSettingsPage, Object.assign({}, props, { ctx: ctx }))
        // 用 slots.inject 等宿主声明出 settings.section 之后再注册；
        // 直接 register 会在槽还不存在时抛错，导致整条客户端 entry 变成 failed。
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'realheart',
          order: 62,
          label: () => 'Realheart',
        }, Page))
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
}
