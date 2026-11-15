/**
 * realheart 设置页（浏览器半仓 · 手写客户端模块 · 免构建）。
 * 0.4.0 重构：左侧目录 + 分区 + 混合密度网格 + 滑钮 + 三层说明。
 *
 * 骨架照搬同类设置页（必须严格照抄，否则会把客户端模块图带崩）：
 *   window.__ModuleLoader__.load({ id, factory })
 *   factory 里先 `var module = { exports: {} }; var exports = module.exports`，末尾 return module.exports
 *
 * 关键约束（全部有依据，别改回去）：
 * 1. 用容器查询，不用视口媒体查询 —— 宿主窗口 1440 而面板 480 时，@media 会按窗口给桌面布局。
 * 2. 栅格显式 repeat(12, minmax(0,1fr)) + grid-column: span N，不用 auto-fit（无法跨列、末行塌陷）。
 *    每个栅格子项必须 min-width: 0，否则长路径撑破轨道 → 面板横向滚动（WCAG 1.4.10 不合格）。
 * 3. 只读态用 readOnly，不用 disabled —— disabled 会把 60 个字段全踢出 Tab 序，读屏用户读不到任何值。
 *    只读态的开关渲染成文字「开启/关闭」（readonly 对 checkbox 无意义）。
 * 4. 滑钮用 <input type=checkbox role=switch>，标签文字不随状态变（APG：变了就读成另一个控件）。
 * 5. 折叠区用 display:none 隐藏（自动脱离 Tab 序与无障碍树），并补 [hidden]{display:none!important}，
 *    否则作者样式会压掉 UA 的 display:none —— 面板「关着」但内容还看得见。
 * 6. 文本类字段是非受控的（defaultValue + ref），打字不重渲染整页；
 *    受控 + 全量 state 会在每键触发 60 个组件重渲染，且格式化会打断中文输入法组合态。
 * 7. 帮助文字对比度 ≥4.5:1（WCAG 1.4.3 不给豁免）；用 label-secondary，不用 tertiary。
 */

const moduleLoader = typeof window === 'undefined' ? undefined : window.__ModuleLoader__

if (moduleLoader !== undefined && moduleLoader !== null) {
  moduleLoader.load({
    id: 'realheart',
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports

      const react = require('react')

      /** 字段表（由 lib/config.mjs 的 FIELD_META 生成，不手抄） */
      const FIELDS = [
  {
    "def": true,
    "key": "enabled",
    "region": "boot",
    "label": "总开关",
    "kind": "switch",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "插件总开关。关 = 不注入、不记账、不注册工具，已写的账保留。",
    "detail": "默认：true。影响：关闭后行为差异极大。"
  },
  {
    "def": true,
    "key": "injectMood",
    "region": "inject",
    "label": "每轮注入状态",
    "kind": "switch",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "每轮把她的状态（心情、没完的事）注入。",
    "detail": "默认：true。影响：关闭后她看不到自己的账，仍可写入但不受影响。"
  },
  {
    "def": false,
    "key": "injectNow",
    "region": "inject",
    "label": "注入里带上「现在几点」",
    "kind": "switch",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "注入当前时间（日期、星期、时段）。",
    "detail": "默认：true。影响：每轮多几十字；用于判断「此刻合不合适说」。"
  },
  {
    "def": true,
    "key": "injectVoice",
    "region": "inject",
    "label": "注入里告诉她「你能主动开口」",
    "kind": "switch",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "注入「你手上有主动发消息的路」。",
    "detail": "默认：true。影响：关闭后主动消息显著减少（实测：写出来之前几乎不发）。"
  },
  {
    "def": [],
    "key": "voiceHints",
    "region": "inject",
    "label": "告诉她具体怎么发（可选）",
    "kind": "tags",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "给上面那段补具体发送命令，一行一条。",
    "detail": "默认：[]。影响：留空则只给意图、不给路径。不可自动探测，路径各机不同。"
  },
  {
    "def": true,
    "key": "injectToday",
    "region": "inject",
    "label": "注入「今天我」",
    "kind": "switch",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "注入「今天我」段（当天做过什么的摘要）。",
    "detail": "默认：true。影响：每轮多一段；关闭后她对今天没有连续印象。"
  },
  {
    "def": "",
    "key": "sayLogPath",
    "region": "paths",
    "label": "主动消息账本在哪",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "主动消息账本的路径，用于「今天已经发过什么」。",
    "detail": "默认：空 = 由 root/work 推导。影响：路径错则读不到已发记录。"
  },
  {
    "def": true,
    "key": "pingContext",
    "region": "ping",
    "label": "带上她此刻的调子",
    "kind": "switch",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "短唤醒时带上她此刻的调子。",
    "detail": "默认：true。影响：关闭后唤醒语气与心情脱钩。"
  },
  {
    "def": 60,
    "key": "pingMinMinutes",
    "region": "ping",
    "label": "最短间隔",
    "kind": "number",
    "level": "caution",
    "unit": "分钟",
    "recommend": "推荐 30~60",
    "brief": "每隔一段随机时间叫她醒一下，只做一件事：此刻有没有想说的。",
    "detail": "有就说，没有就继续睡。跟「自由时间」分开是因为两件事节奏不同 —— 自由时间做东西要连续两小时、打断就做不成；想说话却该是随时能发生的。⚠️ 成本：每次唤醒都是一次完整的模型调用（带注入）。30–60 分钟随机 ≈ 一天二十来次。"
  },
  {
    "def": 120,
    "key": "pingMaxMinutes",
    "region": "ping",
    "label": "最长间隔",
    "kind": "number",
    "level": "caution",
    "unit": "分钟",
    "recommend": "推荐 60~120",
    "brief": "短唤醒最长间隔。",
    "detail": "默认：60。影响：必须 ≥ 最短间隔。"
  },
  {
    "def": 9,
    "key": "pingFromHour",
    "region": "ping",
    "label": "从几点开始",
    "kind": "number",
    "level": "caution",
    "unit": "点",
    "recommend": "推荐 8~9",
    "brief": "短唤醒起始小时（0-23）。",
    "detail": "默认：8。影响：窗口外不唤醒。"
  },
  {
    "def": 23,
    "key": "pingToHour",
    "region": "ping",
    "label": "到几点为止",
    "kind": "number",
    "level": "caution",
    "unit": "点",
    "recommend": "推荐 22~23",
    "brief": "短唤醒结束小时（0-23）。",
    "detail": "默认：23。影响：可跨零点（如 22→6）。"
  },
  {
    "def": [],
    "key": "toolsOff",
    "region": "limits",
    "label": "关掉哪几个工具",
    "kind": "tags",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "按名字停用工具，停用的不注册（不是调用时报错）。",
    "detail": "默认：[]。影响：减少工具表噪声，提高其余工具的命中率。"
  },
  {
    "key": "root",
    "region": "paths",
    "label": "她的根目录",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "她的根目录，其他路径默认相对它推导。",
    "detail": "默认：自动探测。影响：填错会导致账本/脚本全面错位。"
  },
  {
    "def": 2400,
    "key": "injectBudgetChars",
    "region": "inject",
    "label": "注入字数上限",
    "kind": "number",
    "level": "caution",
    "unit": "字",
    "recommend": "推荐 2000~3000",
    "brief": "每轮塞进提示词的总字数。",
    "detail": "超了从优先级低的那段开始裁：待改 → 没完的事 → 她留的话；心情永不裁。裁掉会记一条。调大是花钱买完整，调小是省钱买残缺。"
  },
  {
    "def": 200,
    "key": "moodTailLines",
    "region": "inject",
    "label": "注入只读心情账本的最后几条",
    "kind": "number",
    "level": "caution",
    "unit": "条",
    "recommend": "推荐 100~200",
    "brief": "账本只增不改，注入每轮都要读。",
    "detail": "只读尾部是为了不让「账本变长」变成「每轮都变慢」。设 0 就每轮读全份 —— 账本很大时会明显拖慢。"
  },
  {
    "def": 24,
    "key": "moodFadeHours",
    "region": "inject",
    "label": "心情多久算「旧了」",
    "kind": "number",
    "level": "caution",
    "unit": "小时",
    "recommend": "推荐 24",
    "brief": "心情超过多少小时不再占正文，只收成一行点名。",
    "detail": "默认：24。影响：不修改账本值，只影响呈现。"
  },
  {
    "def": 6,
    "key": "bleedMinLevel",
    "region": "inject",
    "label": "别处的情绪多浓才带过来",
    "kind": "number",
    "level": "caution",
    "unit": "级",
    "recommend": "推荐 6~8",
    "brief": "别场合的情绪浓到几级才渗入本场合。",
    "detail": "默认：7。影响：调低会更易串场。"
  },
  {
    "def": 12,
    "key": "bleedMaxHours",
    "region": "inject",
    "label": "多新的别处情绪才会带过来",
    "kind": "number",
    "level": "caution",
    "unit": "小时",
    "recommend": "推荐 6~12",
    "brief": "别场合的情绪多新才渗入（小时）。",
    "detail": "默认：12。影响：调大带入更久之前的状态。"
  },
  {
    "key": "stateDir",
    "region": "paths",
    "label": "账本目录",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "改了等于换一份账：旧目录里的心情、待办、改动记录都不会跟过来。",
    "detail": "改之前先 export。"
  },
  {
    "def": "127.0.0.1",
    "key": "pageBind",
    "region": "page",
    "label": "观测页绑定地址",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "观测页绑定地址。",
    "detail": "默认：127.0.0.1。影响：改 0.0.0.0 会暴露到网络，需自控访问。"
  },
  {
    "def": true,
    "key": "freeTime",
    "region": "freetime",
    "label": "自由时间",
    "kind": "switch",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "自由时间机制开关。",
    "detail": "默认：true。影响：关闭后不触发自由时间任务。"
  },
  {
    "def": [
      {
        "start": "07:00",
        "minutes": 60
      },
      {
        "start": "12:00",
        "minutes": 60
      },
      {
        "start": "20:00",
        "minutes": 60
      }
    ],
    "key": "freeTimeSlots",
    "region": "freetime",
    "label": "哪几段",
    "kind": "code",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "自由时间的时间段列表（如 09:00-10:00）。",
    "detail": "默认：见配置。影响：窗口外不触发。"
  },
  {
    "def": [
      "AI 与科技",
      "科学与科普",
      "语言与文字",
      "历史与社会",
      "设计与建筑",
      "游戏与虚拟世界",
      "硬件与动手折腾",
      "数据与统计"
    ],
    "key": "freeTimeFocus",
    "region": "freetime",
    "label": "让她多看什么",
    "kind": "tags",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "自由时间希望她关注的方向，一行一条。",
    "detail": "默认：[]。影响：留空则不给方向。"
  },
  {
    "def": "freetime",
    "key": "freeTimeProfile",
    "region": "freetime",
    "label": "自由时间用哪个 profile",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "自由时间起会话用的 profile。",
    "detail": "默认：空 = 同当前。影响：填错则该会话起不来。"
  },
  {
    "def": 8098,
    "key": "pagePort",
    "region": "page",
    "label": "观测页端口",
    "kind": "number",
    "level": "caution",
    "unit": "",
    "recommend": "推荐 8098",
    "brief": "观测页端口。",
    "detail": "默认：8098。影响：端口冲突时页面不可用，不影响主流程。"
  },
  {
    "def": true,
    "key": "servePage",
    "region": "page",
    "label": "开观测页",
    "kind": "switch",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "是否启动观测页。",
    "detail": "默认：true。影响：关闭后无页面，也不监听端口。"
  },
  {
    "def": 3600000,
    "key": "indexTtlMs",
    "region": "inject",
    "label": "索引重建间隔",
    "kind": "number",
    "level": "caution",
    "unit": "毫秒",
    "recommend": "推荐 3600000（1 小时）",
    "brief": "事件索引重建间隔（毫秒）。",
    "detail": "默认：60000。影响：调小更实时、IO 更频繁。"
  },
  {
    "def": true,
    "key": "announceOnInstall",
    "region": "boot",
    "label": "首次启动提示",
    "kind": "switch",
    "level": "normal",
    "unit": "",
    "recommend": "",
    "brief": "首次启动时输出安装提示。",
    "detail": "默认：true。影响：仅影响日志。"
  },
  {
    "key": "sessionsRoot",
    "region": "paths",
    "label": "会话目录",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "会话文件目录，用于索引与审计。",
    "detail": "默认：自动探测。影响：错则索引为空。"
  },
  {
    "def": "",
    "key": "auditDir",
    "region": "paths",
    "label": "审计日志目录",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "审计日志目录（工具调用留痕）。",
    "detail": "默认：探测。影响：错则审计为空。"
  },
  {
    "def": "",
    "key": "historyDir",
    "region": "paths",
    "label": "对话历史目录",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "对话历史目录（napcat 落盘）。",
    "detail": "默认：探测。影响：错则「今天聊到哪」为空。"
  },
  {
    "key": "personaHome",
    "region": "paths",
    "label": "人格目录",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "人格文件目录。",
    "detail": "默认：探测。影响：错则读不到人格补充。"
  },
  {
    "def": false,
    "key": "allowManualMoodOverride",
    "region": "limits",
    "label": "允许人工改写她的心情",
    "kind": "switch",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "是否允许人工改写她的心情。",
    "detail": "默认：false。影响：开启后改写会明确标注「不是你自己的」。"
  },
  {
    "def": 3,
    "key": "maxManualMoodOverridePerWeek",
    "region": "limits",
    "label": "一周最多改写几次",
    "kind": "number",
    "level": "danger",
    "unit": "次/周",
    "recommend": "推荐 3",
    "brief": "一周最多改写几次。",
    "detail": "默认：3。影响：超额拒绝写入。"
  },
  {
    "def": "",
    "key": "ownerId",
    "region": "paths",
    "label": "他本人的号",
    "kind": "text",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "他本人的 QQ 号，用于过滤只属于他的记录。",
    "detail": "默认：空。影响：留空则不过滤，群消息可能混入。"
  },
  {
    "def": "",
    "key": "msgsDir",
    "region": "paths",
    "label": "落盘消息目录",
    "kind": "text",
    "level": "danger",
    "unit": "",
    "recommend": "",
    "brief": "落盘消息目录。",
    "detail": "默认：探测。影响：错则对账无数据。"
  },
  {
    "def": "",
    "key": "promptFree",
    "region": "prompt",
    "label": "自由时间的提示词",
    "kind": "code",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "自由时间的提示词正文。",
    "detail": "默认：内置。影响：直接决定自由时间的产出质量。"
  },
  {
    "def": "",
    "key": "promptPing",
    "region": "prompt",
    "label": "短唤醒的提示词",
    "kind": "code",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "短唤醒的提示词正文。",
    "detail": "默认：内置。影响：直接决定唤醒时的开场行为。"
  },
  {
    "def": "",
    "key": "promptVoiceTail",
    "region": "prompt",
    "label": "「你能主动开口」的尾句",
    "kind": "code",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "「你能主动开口」段的尾句。",
    "detail": "默认：内置。影响：弱化会让主动消息变少。"
  },
  {
    "def": "",
    "key": "promptTodayTail",
    "region": "prompt",
    "label": "「今天我」的尾句",
    "kind": "code",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "「今天我」段的尾句。",
    "detail": "默认：内置。影响：控制该段的用法约束。"
  },
  {
    "def": "",
    "key": "promptMoodBan",
    "region": "prompt",
    "label": "心情段的禁令句",
    "kind": "code",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "心情段的禁令句（「知道就行，不必说出来」）。",
    "detail": "默认：内置。影响：删除后她会把心情当聊天素材说出来（已对照验证）。"
  },
  {
    "def": true,
    "key": "capsOn",
    "region": "caps",
    "label": "外部能力总开关",
    "kind": "switch",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "外部能力总开关。",
    "detail": "默认：true。影响：关闭后 rh_call 直接拒调。"
  },
  {
    "def": "",
    "key": "capsFile",
    "region": "caps",
    "label": "配方文件路径",
    "kind": "text",
    "level": "normal",
    "unit": "",
    "recommend": "",
    "brief": "能力配方文件路径。",
    "detail": "默认：空 = 账本目录下 capabilities.json。影响：设置页「外部能力」有内容时以设置页为准。"
  },
  {
    "def": 30,
    "key": "capsDailyLimit",
    "region": "caps",
    "label": "每条能力每日上限",
    "kind": "number",
    "level": "caution",
    "unit": "次/天",
    "recommend": "推荐 20~50（0 = 不限）",
    "brief": "每条能力每天最多调用次数（0 = 不限）。",
    "detail": "默认：30。影响：生成类按次计费，这是成本闸。"
  },
  {
    "def": "",
    "key": "capsJson",
    "region": "caps",
    "label": "能力配方（整份 JSON）",
    "kind": "code",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "能力配方（整份 JSON）。留空则用 capabilities.json。",
    "detail": "默认：空。影响：写了就以这里为准；不含密钥，可整段分享。\n修改后需重启。"
  },
  {
    "def": [],
    "key": "injectOffSections",
    "region": "inject",
    "label": "关掉哪几段注入",
    "kind": "multi",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "按段名关掉注入的某一段，空 = 全开。",
    "detail": "默认：[]。影响：关错会让她缺一块上下文，但不会报错。",
    "options": [
      "clock",
      "mood",
      "mood-nudge",
      "admit",
      "linger",
      "reopen",
      "hold",
      "recall",
      "situation",
      "work",
      "days",
      "today",
      "voice",
      "own",
      "exp",
      "claim",
      "view",
      "where",
      "style",
      "pending-change",
      "pending",
      "status-page",
      "kept",
      "time"
    ]
  },
  {
    "def": 5,
    "key": "moodShowMax",
    "region": "inject",
    "label": "心情一次摆几条",
    "kind": "number",
    "level": "normal",
    "unit": "条",
    "recommend": "推荐 3~5",
    "brief": "同时并存的心情最多摆几条。",
    "detail": "默认：5。影响：调小可能丢掉「又喜又悲」并存的那一半。"
  },
  {
    "def": 120000,
    "key": "capsTimeoutMs",
    "region": "caps",
    "label": "外部调用超时",
    "kind": "number",
    "level": "normal",
    "unit": "毫秒",
    "recommend": "推荐 120000",
    "brief": "单次外部 API 调用的上限。",
    "detail": "默认：120000。影响：视频类要留够（生成常需数分钟）。"
  },
  {
    "def": 5000,
    "key": "capsPollMs",
    "region": "caps",
    "label": "异步轮询间隔",
    "kind": "number",
    "level": "normal",
    "unit": "毫秒",
    "recommend": "推荐 5000",
    "brief": "异步任务多久查一次。",
    "detail": "默认：5000。影响：调小更快出结果但请求更多；记录里写了 pollMs 时以记录为准。"
  },
  {
    "def": 1,
    "key": "capsRetry",
    "region": "caps",
    "label": "失败重试次数",
    "kind": "number",
    "level": "normal",
    "unit": "次",
    "recommend": "推荐 1",
    "brief": "网络错误与 5xx 的重试次数。",
    "detail": "默认：1。影响：4xx 不重试（参数错重试也一样错）。"
  },
  {
    "def": 6,
    "key": "capsConfirmPrompt",
    "region": "caps",
    "label": "提示词最短长度",
    "kind": "number",
    "level": "caution",
    "unit": "字",
    "recommend": "推荐 6",
    "brief": "生图/生视频的提示词少于这么多字就先问、不直接跑。",
    "detail": "默认：6。影响：调 0 = 不再拦截（force 也可绕过）。"
  },
  {
    "def": 30,
    "key": "capsMediaKeepDays",
    "region": "caps",
    "label": "媒体文件保留天数",
    "kind": "number",
    "level": "normal",
    "unit": "天",
    "recommend": "推荐 30（0 = 不清理）",
    "brief": "media 目录下按天分的旧目录多久清一次。",
    "detail": "默认：30。影响：调 0 则不清理，磁盘会一直长。"
  },
  {
    "def": 20,
    "key": "talkGapMinutes",
    "region": "inject",
    "label": "「今天聊到哪」切段间隔",
    "kind": "number",
    "level": "normal",
    "unit": "分钟",
    "recommend": "推荐 20",
    "brief": "把对话按间隔切成话题段，取最近两段摆进注入。",
    "detail": "默认：20 分钟。影响：调小会把一段话拆散，调大可能跨到上一个话题。"
  },
  {
    "def": 60,
    "key": "talkSummaryChars",
    "region": "inject",
    "label": "摘要字数上限",
    "kind": "number",
    "level": "normal",
    "unit": "字",
    "recommend": "推荐 60",
    "brief": "一句话概括那段聊了什么，最长多少字。",
    "detail": "默认：60。影响：太短失去信息，太长挤占预算。"
  },
  {
    "def": 380,
    "key": "talkBudgetChars",
    "region": "inject",
    "label": "「今天聊到哪」总预算",
    "kind": "number",
    "level": "normal",
    "unit": "字",
    "recommend": "推荐 380",
    "brief": "摘要 + 最近两轮原文合起来最多多少字。",
    "detail": "默认：380。影响：超了先丢最旧的轮，最后才丢摘要。"
  },
  {
    "def": "",
    "key": "promptTalkSummary",
    "region": "prompt",
    "label": "摘要的指令句",
    "kind": "code",
    "level": "caution",
    "unit": "",
    "recommend": "",
    "brief": "让模型概括那段对话时用的指令。",
    "detail": "默认：空，用内置那句（含「只根据这段对话／不写动作描写」）。影响：删掉这几条约束它会开始编。"
  },
  {
    "def": [
      "累",
      "难受",
      "疼",
      "软",
      "困",
      "烦",
      "怕",
      "慌",
      "想哭",
      "委屈",
      "生气",
      "心里堵",
      "没劲",
      "不想动",
      "撑不住",
      "松了口气",
      "舒服",
      "爽",
      "开心",
      "高兴",
      "踏实",
      "沉"
    ],
    "key": "moodNudgeWords",
    "region": "inject",
    "label": "情绪词表",
    "kind": "tags",
    "level": "normal",
    "unit": "",
    "recommend": "",
    "brief": "短唤醒时拿这些词去最近几条消息里找「状态是不是变了」。",
    "detail": "默认：22 个常用词。影响：词太少抓不到钩子，太多会误报。"
  },
  {
    "def": 5,
    "key": "pageRefreshSec",
    "region": "page",
    "label": "观测页自动刷新",
    "kind": "number",
    "level": "normal",
    "unit": "秒",
    "recommend": "推荐 5",
    "brief": "观测页多久自动刷一次。",
    "detail": "默认：5 秒。影响：调 0 就静止，得手动刷。"
  },
  {
    "def": 0,
    "key": "pingJitterMinutes",
    "region": "ping",
    "label": "额外抖动",
    "kind": "number",
    "level": "normal",
    "unit": "分钟",
    "recommend": "推荐 0~10",
    "brief": "在 min~max 随机的间隔上再叠一层 ±N 分钟。",
    "detail": "min~max 的随机决定「这次多久以后」；抖动是防止同样的配置长期形成可预期的节奏。默认 0 = 只用 min~max。"
  }
]
      /** 分区表（同上，来自 REGIONS） */
      const REGIONS = [
  {
    "id": "boot",
    "title": "插件",
    "desc": "整个 realheart 的总开关",
    "switchKey": "enabled",
    "switchKind": "danger",
    "alwaysOpen": true,
    "whenOff": "插件已停用：不注入、不记账、工具不注册。已经写下来的账都还在。"
  },
  {
    "id": "inject",
    "title": "注入",
    "desc": "每轮开口前，往提示词里放什么",
    "switchKey": "injectMood",
    "whenOff": "不注入状态：她看不到自己的心情和没完的事，仍可记账但不受影响。"
  },
  {
    "id": "ping",
    "title": "短唤醒",
    "desc": "隔一段时间叫醒她一次，看有没有想说的",
    "switchKey": "pingMinMinutes",
    "switchKind": "proxy",
    "proxyOn": 30,
    "proxyOff": 0,
    "proxyNote": "＝最短间隔",
    "whenOff": "不叫醒：她只会在你说话时出现。"
  },
  {
    "id": "freetime",
    "title": "自由时间",
    "desc": "按时间段落自己起一个会话",
    "switchKey": "freeTime",
    "whenOff": "不触发自由时间。"
  },
  {
    "id": "prompt",
    "title": "提示词",
    "desc": "这几段话会原样进她的提示词。留空 = 用内置那版",
    "switchKey": "",
    "whenOff": ""
  },
  {
    "id": "caps",
    "title": "外部能力",
    "desc": "识图 / 生图 / 生视频，靠配方调外部 API",
    "switchKey": "capsOn",
    "whenOff": "调不了外部能力：rh_call 直接拒绝。"
  },
  {
    "id": "page",
    "title": "观测页",
    "desc": "本机的状态页（端口 8098）",
    "switchKey": "servePage",
    "whenOff": "不开页面，也不监听端口。"
  },
  {
    "id": "paths",
    "title": "路径与账本",
    "desc": "账本、会话、人格文件在哪儿。改错会读不到东西",
    "switchKey": "",
    "collapsible": true,
    "defaultOpen": false,
    "whenOff": ""
  },
  {
    "id": "limits",
    "title": "边界与工具",
    "desc": "人工改写心情、停用工具",
    "switchKey": "",
    "collapsible": true,
    "defaultOpen": false,
    "whenOff": ""
  }
]

      const NS = 'realheart'
      /** 这几项的值是「结构」不是「文本」：界面上按 JSON 编辑，保存前要 parse。
       *  freeTimeSlots 是 Schema.array(Schema.object(...)) —— 早先被当成分隔符数组，
       *  会显示成 [object Object]，一保存就把它写坏。 */
      const JSON_FIELDS = ['freeTimeSlots']
      const isJsonField = (k) => JSON_FIELDS.indexOf(k) >= 0
      // 内容本身是 JSON 文本的（不一定需要 parse 回对象），也给「校验」按钮
      const CHECKABLE = ['freeTimeSlots', 'capsJson']
      // 分区序号只算一次：目录、区标题共用同一个编号，别两处各数一遍
      REGIONS.forEach((r, i) => { r.no = String(i + 1).padStart(2, '0') })
      const GROUPED = REGIONS.map((r) => ({ region: r, fields: FIELDS.filter((f) => f.region === r.id) }))
                             .filter((g) => g.fields.length > 0)

      // ── 视觉令牌（全部挂在 .rh4 上，只覆盖宿主没给的那几项）──────────────
      // 原则：中性色占九成，品牌色只标"可交互 / 当前项"；层次靠字号+字重+前景灰三档，
      // 不靠边框堆叠。间距一律取自 4px 刻度，避免 3/7/13 这种随手数。
      const CSS = `
.rh4{
  container-type:inline-size;display:block;
  --r4-fg1:var(--dsw-alias-label-primary,#1f2328);
  --r4-fg2:var(--dsw-alias-label-secondary,#4a5159);
  --r4-fg3:var(--dsw-alias-label-tertiary,#7b828b);
  --r4-bg1:var(--dsw-alias-bg-l1,#fff);
  --r4-bg2:var(--dsw-alias-bg-l2,#f5f6f8);
  --r4-bg3:var(--dsw-alias-bg-l3,#eceff3);
  --r4-line:color-mix(in srgb, var(--dsw-alias-border-l2,#d0d0d0) 70%, transparent);
  --r4-line-strong:var(--dsw-alias-border-l2,#d0d0d0);
  --r4-accent:var(--dsw-alias-brand-primary,#3b82f6);
  --r4-danger:#b42318;
  --r4-ok:#1a7f37;
  --r4-r-sm:6px; --r4-r-md:10px; --r4-r-lg:14px;
  --r4-sp1:4px; --r4-sp2:8px; --r4-sp3:12px; --r4-sp4:16px; --r4-sp5:24px; --r4-sp6:32px;
  color:var(--r4-fg1);font-size:13px;line-height:20px;
  -webkit-font-smoothing:antialiased;
}
.rh4 *{box-sizing:border-box}
.rh4 [hidden]{display:none!important}
.rh4 :focus-visible{outline:2px solid var(--r4-accent);outline-offset:2px;border-radius:var(--r4-r-sm)}
.rh4 ::placeholder{color:var(--r4-fg3)}

/* 骨架：左目录 + 右内容 */
.rh4-shell{display:flex;gap:var(--r4-sp6);align-items:flex-start}
.rh4-nav{flex:0 0 176px;display:flex;flex-direction:column;gap:1px;position:sticky;top:0}
.rh4-navitem{
  position:relative;display:flex;align-items:center;gap:var(--r4-sp2);width:100%;min-height:34px;
  padding:6px var(--r4-sp3) 6px 14px;border:0;border-radius:var(--r4-r-sm);background:transparent;
  color:var(--r4-fg2);font:inherit;font-size:13px;text-align:left;cursor:pointer;
  transition:background 120ms ease,color 120ms ease;
}
.rh4-navitem:hover{background:var(--r4-bg2);color:var(--r4-fg1)}
.rh4-navitem.on{background:var(--r4-bg2);color:var(--r4-fg1);font-weight:600}
.rh4-navitem.on::before{
  content:"";position:absolute;left:4px;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--r4-accent);
}
.rh4-navno{
  font-size:10.5px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:.04em;
  color:var(--r4-fg3);flex:0 0 auto;width:14px;
}
.rh4-navitem.on .rh4-navno{color:var(--r4-accent)}
.rh4-main{flex:1 1 auto;min-width:0}
.rh4-select{
  display:none;width:100%;min-height:36px;margin-bottom:var(--r4-sp4);padding:6px 10px;
  border-radius:var(--r4-r-sm);border:1px solid var(--r4-line-strong);background:var(--r4-bg1);
  color:inherit;font:inherit;
}
@container (max-width: 45rem){ .rh4-shell{display:block} .rh4-nav{display:none} .rh4-select{display:block} }

/* 工具条 */
.rh4-bar{display:flex;align-items:center;gap:var(--r4-sp2);flex-wrap:wrap;margin-bottom:var(--r4-sp5)}
.rh4-search{
  flex:1 1 220px;min-width:0;min-height:34px;padding:6px 10px 6px 30px;border-radius:var(--r4-r-sm);
  border:1px solid var(--r4-line-strong);background:var(--r4-bg1) no-repeat 9px center;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%237b828b' stroke-width='2.2' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><path d='M20 20l-4.2-4.2'/></svg>");
  color:inherit;font:inherit;font-size:13px;transition:border-color 120ms ease,box-shadow 120ms ease;
}
.rh4-search:focus{border-color:var(--r4-accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--r4-accent) 16%, transparent)}
.rh4-tools{display:flex;align-items:center;gap:var(--r4-sp2)}
.rh4-vline{width:1px;height:20px;background:var(--r4-line-strong);opacity:.7;margin:0 2px}
.rh4-btn{
  min-height:32px;padding:5px var(--r4-sp3);border-radius:var(--r4-r-sm);border:1px solid var(--r4-line-strong);
  background:var(--r4-bg1);color:var(--r4-fg1);font:inherit;font-size:13px;cursor:pointer;
  transition:background 120ms ease,border-color 120ms ease,box-shadow 120ms ease;
}
.rh4-btn:hover{background:var(--r4-bg2)}
.rh4-btn:active{background:var(--r4-bg3)}
.rh4-btn.primary{
  background:var(--r4-accent);border-color:transparent;color:#fff;font-weight:600;
  box-shadow:0 1px 2px color-mix(in srgb, var(--r4-accent) 35%, transparent);
}
.rh4-btn.primary:hover{filter:brightness(1.06)}
.rh4-btn.ghost{border-color:transparent;background:transparent;color:var(--r4-fg2)}
.rh4-btn.ghost:hover{background:var(--r4-bg2);color:var(--r4-fg1)}
.rh4-btn:disabled{opacity:.45;cursor:not-allowed}
.rh4-note{
  display:flex;gap:8px;align-items:flex-start;
  font-size:12px;line-height:18px;color:var(--r4-fg2);margin:0 0 var(--r4-sp3);
  padding:9px 11px;border-radius:var(--r4-r-md);background:var(--r4-bg2);
  text-wrap:pretty;
}
.rh4-noteicon{
  flex:0 0 auto;width:15px;height:15px;border-radius:50%;background:var(--r4-line-strong);
  color:var(--r4-bg1);font-size:10px;line-height:15px;text-align:center;font-style:italic;
  font-weight:600;margin-top:1px;
}
.rh4-hit{font-size:12px;line-height:18px;color:var(--r4-fg2);margin:0 0 var(--r4-sp3)}

/* 分区：靠"顶部一道线 + 序号 + 标题"分界，不用四边卡片（窄容器下卡片边距吃宽度） */
.rh4-sec{margin:0 0 var(--r4-sp6);padding-top:var(--r4-sp5);border-top:1px solid var(--r4-line)}
.rh4-sec:first-of-type{border-top:0;padding-top:0}
.rh4-sechead{display:flex;align-items:flex-start;gap:var(--r4-sp3);margin-bottom:var(--r4-sp2)}
.rh4-secmeta{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.rh4-eyebrow{
  display:flex;align-items:center;gap:6px;font-size:10.5px;line-height:14px;
  letter-spacing:.09em;text-transform:uppercase;color:var(--r4-fg3);font-weight:600;
}
.rh4-sectitle{font-size:15px;font-weight:600;line-height:22px;margin:0;color:var(--r4-fg1);letter-spacing:-.01em}
.rh4-secdesc{font-size:12px;line-height:17px;color:var(--r4-fg2);margin:0}
.rh4-secgrow{flex:1 1 auto}
.rh4-off{
  font-size:12px;line-height:18px;color:var(--r4-fg2);margin:var(--r4-sp2) 0 var(--r4-sp3);
  padding:8px 10px;border-radius:var(--r4-r-sm);background:var(--r4-bg2);
  border-left:2px solid var(--r4-line-strong);
}

/* 栅格：12 列 + 容器查询；行 hover 只亮编辑态 */
.rh4-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:2px var(--r4-sp3)}
.rh4-f{grid-column:span 12;min-width:0;padding:var(--r4-sp2) 10px;margin:0 -10px;border-radius:var(--r4-r-sm);display:flex;flex-direction:column}
.rh4.editing .rh4-f:hover{background:var(--r4-bg2)}
@container (min-width: 30rem){ .rh4-f.half{grid-column:span 6} }
@container (min-width: 48rem){ .rh4-f.half{grid-column:span 6} .rh4-f.third{grid-column:span 4} }

/* 一行三列时，标签折成两行的那个字段会把输入框顶下去 —— 整行看上去犬牙交错。
   用 subgrid 让同一网格行的字段共享「标签行 / 控件行 / 备注行」三行的高度，
   于是所有控件落在同一条基线上，备注也自然对齐。
   （Chromium 117+ / Safari 16+ / Firefox 71+；不支持的浏览器退回上面的 flex 竖排。） */
@supports (grid-template-rows: subgrid){
  .rh4-f{display:grid;grid-template-rows:subgrid;grid-row:span 3;row-gap:0}
  .rh4-f > .rh4-lblrow,.rh4-f > div{align-self:start}
}

.rh4-lblrow{display:flex;align-items:center;gap:var(--r4-sp2);min-height:20px}
.rh4-lbl{font-size:13px;font-weight:500;line-height:20px;color:var(--r4-fg1)}
.rh4-rec{
  font-size:11px;line-height:16px;color:var(--r4-fg3);padding:0 6px;border-radius:999px;
  background:var(--r4-bg2);white-space:nowrap;
}
.rh4-help{
  display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;
  border:1px solid var(--r4-line-strong);font-size:10px;line-height:1;color:var(--r4-fg3);
  cursor:help;user-select:none;flex:0 0 auto;transition:color 120ms ease,border-color 120ms ease;
}
.rh4-help:hover{color:var(--r4-accent);border-color:var(--r4-accent)}
.rh4-brief{
  font-size:12px;line-height:17px;color:var(--r4-fg3);margin:5px 0 0;
  max-width:62ch;text-wrap:pretty;
}

/* 输入 */
.rh4-in{
  width:100%;min-height:32px;padding:5px 10px;border-radius:var(--r4-r-sm);
  border:1px solid var(--r4-line-strong);background:var(--r4-bg1);color:var(--r4-fg1);
  font:inherit;font-size:13px;transition:border-color 120ms ease,box-shadow 120ms ease,background 120ms ease;
}
.rh4-in:hover{border-color:color-mix(in srgb, var(--r4-fg3) 55%, transparent)}
.rh4-in:focus{border-color:var(--r4-accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--r4-accent) 16%, transparent);outline:none}
/* 只读：不做成"输入框长相"，让它看起来就是一段值；聚焦时才浮出描边（键盘可读仍成立） */
.rh4-in[readonly]{
  border-color:transparent;background:transparent;padding-left:0;padding-right:0;cursor:text;
  color:var(--r4-fg1);
}
.rh4-in[readonly]:hover{border-color:transparent;background:transparent}
.rh4-in[readonly]:focus{border-color:var(--r4-line-strong);box-shadow:none;padding-left:10px}
.rh4-numwrap{display:flex;align-items:baseline;gap:6px;min-width:0}
.rh4-num{min-inline-size:calc(6ch + 2.5rem);max-width:170px;font-variant-numeric:tabular-nums}
.rh4-unit{font-size:12px;color:var(--r4-fg3);flex:0 0 auto}
.rh4-code{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;
  font-variant-ligatures:none;tab-size:2;white-space:pre-wrap;overflow-wrap:anywhere;min-height:96px;resize:vertical;
  background:var(--r4-bg1);
}
.rh4-val{font-size:13px;line-height:20px;padding:4px 0;word-break:break-word;white-space:pre-wrap;color:var(--r4-fg1)}
.rh4-val.dim{color:var(--r4-fg3)}
/* 逗号分隔这种短值不需要整行宽，撑满反而显得空 */
.rh4-in.rh4-short{max-width:440px}
/* 改过的字段：左侧一道 accent 细条（inset 阴影，不占布局），一眼看出这次动了哪几项 */
.rh4-f.dirty{box-shadow:inset 3px 0 0 var(--r4-accent);background:color-mix(in srgb, var(--r4-accent) 6%, transparent)}
.rh4-f.dirty .rh4-lbl{font-weight:600}
.rh4-f.dirty .rh4-lbl::after{
  content:'';display:inline-block;width:6px;height:6px;border-radius:50%;
  background:var(--r4-accent);margin-left:6px;vertical-align:2px;
}
.rh4-copy{
  margin-left:6px;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;
  border:1px solid var(--r4-line);background:transparent;color:var(--r4-fg3);cursor:pointer;
  transition:color 120ms ease,border-color 120ms ease,background 120ms ease;
}
.rh4-copy:hover{color:var(--r4-fg1);border-color:var(--r4-line-strong);background:var(--r4-bg2)}
/* 编辑态每个字段都挂一个「默认」，常亮会跟标签抢注意力：默认半透明，指到那行才实心 */
.rh4.editing .rh4-f .rh4-copy{opacity:.5}
.rh4.editing .rh4-f:hover .rh4-copy,.rh4.editing .rh4-f .rh4-copy:hover,.rh4.editing .rh4-f .rh4-copy:focus-visible{opacity:1}

/* 滑钮：52×32，整行可点 */
.rh4-swrow{display:flex;align-items:center;gap:var(--r4-sp3);min-height:48px;cursor:pointer}
.rh4-swrow.ro{cursor:default}
.rh4-swtext{flex:1 1 auto;min-width:0}
.rh4-sw{position:relative;flex:0 0 auto;width:52px;height:32px}
.rh4-sw input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.rh4-sw input:focus-visible + .rh4-track{outline:2px solid var(--r4-accent);outline-offset:2px}
.rh4-track{
  display:block;width:52px;height:32px;border-radius:999px;background:color-mix(in srgb, var(--r4-fg3) 32%, var(--r4-bg1));
  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--r4-fg3) 30%, transparent);
  transition:background 140ms ease,box-shadow 140ms ease;pointer-events:none;
}
.rh4-knob{
  position:absolute;top:50%;left:5px;width:16px;height:16px;border-radius:50%;background:#fff;
  transform:translateY(-50%);
  transition:left 240ms cubic-bezier(.2,0,0,1),width 240ms cubic-bezier(.2,0,0,1),height 240ms cubic-bezier(.2,0,0,1);
  pointer-events:none;box-shadow:0 1px 2px rgba(16,24,40,.28),0 0 0 .5px rgba(16,24,40,.06);
}
.rh4-sw input:checked + .rh4-track{background:var(--r4-accent);box-shadow:inset 0 0 0 1px color-mix(in srgb, #000 8%, var(--r4-accent))}
.rh4-sw input:checked ~ .rh4-knob{left:23px;width:24px;height:24px}
.rh4-sw input:disabled + .rh4-track{opacity:.35}
.rh4-sw input:disabled ~ .rh4-knob{opacity:.45}
.rh4-state{font-size:12.5px;color:var(--r4-fg2);flex:0 0 auto;font-variant-numeric:tabular-nums}

/* 段名 chips */
.rh4-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.rh4-chip{
  display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;
  border:1px solid var(--r4-line-strong);font-size:11.5px;line-height:17px;
  font-family:ui-monospace,Consolas,monospace;cursor:pointer;color:var(--r4-fg2);
  background:var(--r4-bg1);transition:background 120ms ease,color 120ms ease,border-color 120ms ease;
}
.rh4-chip input{width:0;height:0;opacity:0;position:absolute}
.rh4-chip:hover{border-color:var(--r4-fg3)}
.rh4-chip.on{
  background:color-mix(in srgb, var(--r4-accent) 12%, var(--r4-bg1));
  color:var(--r4-fg1);border-color:color-mix(in srgb, var(--r4-accent) 55%, transparent);
}

/* 改动清单 */
.rh4-diff{
  margin:0 0 var(--r4-sp4);padding:var(--r4-sp3) var(--r4-sp4);border-radius:var(--r4-r-md);
  border:1px solid var(--r4-line-strong);background:var(--r4-bg1);
  box-shadow:0 1px 2px rgba(16,24,40,.04);
}
.rh4-diffhead{display:flex;align-items:center;gap:var(--r4-sp2);padding-bottom:9px;border-bottom:1px solid var(--r4-line-strong)}
.rh4-diffhead h4{margin:0;font-size:12px;font-weight:600;color:var(--r4-fg1)}
.rh4-diffhead .rh4-btn{min-height:28px;padding:2px 10px;font-size:12px}
.rh4-diffrow{
  display:grid;grid-template-columns:minmax(0,1fr) auto 12px auto;gap:var(--r4-sp2);align-items:baseline;
  font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:22px;color:var(--r4-fg2);
  padding:2px 0;
}
.rh4-diffkey{color:var(--r4-fg1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rh4-diffold{color:var(--r4-fg3);text-decoration:line-through;text-decoration-thickness:1.5px;justify-self:end;opacity:.9}
.rh4-diffarrow{color:var(--r4-fg3);text-align:center}
.rh4-diffnew{color:var(--r4-fg1);font-weight:600;justify-self:end}
.rh4-dangerbox{
  margin-top:var(--r4-sp2);padding:var(--r4-sp2) var(--r4-sp3);border-radius:var(--r4-r-sm);
  background:color-mix(in srgb, var(--r4-danger) 7%, var(--r4-bg1));
  border-left:3px solid var(--r4-danger);
}
.rh4-dangerbox h4{margin:0 0 4px;font-size:12px;font-weight:600;color:var(--r4-danger)}
.rh4-dangerbox .rh4-diffrow{color:var(--r4-danger)}
.rh4-msg{font-size:12px;line-height:18px;margin:0 0 var(--r4-sp3);padding:7px 10px;border-radius:var(--r4-r-sm)}
.rh4-msg.ok{color:var(--r4-ok);background:color-mix(in srgb, var(--r4-ok) 8%, var(--r4-bg1))}
.rh4-msg.err{color:var(--r4-danger);background:color-mix(in srgb, var(--r4-danger) 8%, var(--r4-bg1))}
`

      // 编辑态给根节点挂 .editing，让「行 hover 高亮」只在能改的时候出现
      const rootClass = (editing) => 'rh4' + (editing ? ' editing' : '')

      const ensureCss = () => {
        try {
          if (typeof document === 'undefined') return
          if (document.getElementById('rh4-style')) return
          const el = document.createElement('style')
          el.id = 'rh4-style'
          el.textContent = CSS
          document.head.appendChild(el)
        } catch { /* 样式注入失败不该让整页挂掉 */ }
      }

      // ── 小工具 ────────────────────────────────────────────────────────
      const fmtValue = (v) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v))
      const toList = (s) => String(s || '').split(/[,，\n]/).map((x) => x.trim()).filter(Boolean)
      const valOf = (v) => {
        if (v === undefined) return ''
        if (Array.isArray(v)) return v.join(', ')
        if (typeof v === 'object') return JSON.stringify(v, null, 2)
        return String(v)
      }
      /** 只读态要显示成「开启/关闭」而不是禁用滑钮 */
      const onoff = (v) => (v ? '开启' : '关闭')

      /** 「没设过」和「明确设成空」要分得开（沙耶 2026-11-15 提的）：
       *  undefined/null → （默认 = def）；'' 或 [] → （空）
       *  返回 { bare: boolean, hint: string } —— bare 表示值是空的，hint 是占位说明。 */
      const blankOf = (field, v) => {
        const none = v === undefined || v === null
        const empty = !none && (v === '' || (Array.isArray(v) && v.length === 0))
        if (!none && !empty) return { bare: false, hint: '' }
        if (none) {
          const d = field.def
          const show = d === undefined ? '' : (typeof d === 'object' ? JSON.stringify(d) : String(d))
          return { bare: true, hint: show ? '（默认 = ' + show + '）' : '（默认）' }
        }
        return { bare: true, hint: '（空）' }
      }

      /** 保存前的一致性校验：返回 [{key, msg}] */
      /** 危险改动：保存前列出来要人再点一次。 */
      const dangersOf = (before, after) => {
        const out = []
        if (before.enabled !== false && after.enabled === false) out.push('关掉整个插件（不注入、不记账、工具不注册）')
        if (String(before.capsJson || '').trim() && !String(after.capsJson || '').trim()) out.push('清空能力配方（外部能力会失效）')
        if (Number(after.injectBudgetChars) > 0 && Number(after.injectBudgetChars) < 1000) out.push('注入预算降到 1000 字以下（大部分段落会被裁）')
        if (Array.isArray(after.toolsOff) && Array.isArray(before.toolsOff) && after.toolsOff.length > before.toolsOff.length + 3) out.push('一次停用了 3 个以上工具')
        return out
      }

      const validateAll = (v) => {
        const out = []
        // 结构型字段先归一：界面上是字符串，校验要拿对象
        const vv = Object.assign({}, v)
        for (const k of JSON_FIELDS) {
          if (typeof vv[k] === 'string') {
            try { vv[k] = JSON.parse(vv[k]) } catch { out.push({ key: k, msg: '不是合法 JSON' }) }
          }
        }
        v = vv
        const num = (k) => Number(v[k])
        if (Number.isFinite(num('pingMinMinutes')) && num('pingMinMinutes') > 0) {
          const a = num('pingMinMinutes')
          const b = num('pingMaxMinutes')
          if (Number.isFinite(b) && b < a) out.push({ key: 'pingMaxMinutes', msg: '最长间隔比最短间隔还短' })
        }
        const t = (k) => Number(v[k])
        if (Number.isFinite(t('capsTimeoutMs')) && Number.isFinite(t('capsPollMs')) && t('capsPollMs') > t('capsTimeoutMs')) {
          out.push({ key: 'capsPollMs', msg: '轮询间隔比总超时还长，任务等不到结果' })
        }
        if (Number.isFinite(num('pagePort')) && (num('pagePort') < 1 || num('pagePort') > 65535)) {
          out.push({ key: 'pagePort', msg: '端口要在 1–65535 之间' })
        }
        if (Number.isFinite(num('injectBudgetChars')) && num('injectBudgetChars') < 500) {
          out.push({ key: 'injectBudgetChars', msg: '低于 500 字，注入几乎会被裁空' })
        }
        const slots = v.freeTimeSlots
        if (Array.isArray(slots)) {
          for (const s of slots) {
            if (!s || typeof s !== 'object') continue
            if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s.start || ''))) {
              out.push({ key: 'freeTimeSlots', msg: '时间段里的时间要写成 HH:MM' })
              break
            }
          }
        }
        return out
      }

      // ── 滑钮（受控，自己持状态）──────────────────────────────────────
      function Switch(props) {
        const { id, checked, onToggle, readOnly } = props
        const [on, setOn] = react.useState(Boolean(checked))
        react.useEffect(() => { setOn(Boolean(checked)) }, [checked])
        if (readOnly) {
          return react.createElement('span', { style: null, className: 'rh4-state' + (on ? '' : ' off') },
            on ? '开启' : '关闭')
        }
        return react.createElement('label', { className: 'rh4-sw' },
          react.createElement('input', {
            id, type: 'checkbox', role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            checked: on,
            onChange: (e) => { const nx = e.target.checked; setOn(nx); onToggle(nx) },
          }),
          react.createElement('span', { className: 'rh4-track', 'aria-hidden': 'true' }),
          react.createElement('span', { className: 'rh4-knob', 'aria-hidden': 'true' }))
      }

      /** 结构型字段的「校验」按钮：当场 parse 一次，别等保存才知道 JSON 坏了。 */
      function JsonCheck(props) {
        const [info, setInfo] = react.useState(null)
        return react.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          react.createElement('button', {
            type: 'button', className: 'rh4-copy', title: '校验这份 JSON 能不能解析',
            onClick: () => {
              const text = String(props.getText() || '').trim()
              if (!text) { setInfo({ ok: true, text: '空（等于没设）' }); return }
              try {
                const v = JSON.parse(text)
                const n = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0)
                setInfo({ ok: true, text: '合法，' + (Array.isArray(v) ? n + ' 条' : n + ' 个键') })
              } catch (err) {
                const m = /position (\d+)/.exec(String(err && err.message))
                const pos = m ? Number(m[1]) : -1
                const line = pos >= 0 ? text.slice(0, pos).split('\n').length : 0
                setInfo({ ok: false, text: '不合法' + (line ? '（第 ' + line + ' 行附近）' : '') })
              }
            },
          }, '校验'),
          info ? react.createElement('span', {
            className: 'rh4-rec', style: info.ok ? { color: '#1a7f37' } : { color: '#b42318' },
          }, info.text) : null)
      }

      /** 一个字段。parent 只读 pendingRef，不重渲染。 */
      function Field(props) {
        const { field, value, base, editing, pendingRef, onDirty, errs } = props
        const id = 'rh4-' + field.key
        const kind = field.kind
        const err = errs[field.key]
        const set = (v) => { pendingRef.current[field.key] = v; if (onDirty) onDirty(field.key) }

        // 跟读回来那份比：对象/数组用 JSON 比，标量直接比
        const pend = pendingRef.current
        // 注意比的是 base（读回来那份）不是 value —— value 已经优先取了 pendingRef，
        // 拿它自己跟自己比永远相等，这个标记就永远不会亮。
        const orig = base === undefined ? undefined : base
        const dirty = (field.key in pend) && (() => {
          const a = pend[field.key]
          if (a === orig) return false
          if (a && typeof a === 'object') return JSON.stringify(a) !== JSON.stringify(orig)
          if (orig && typeof orig === 'object') return JSON.stringify(orig) !== JSON.stringify(a)
          return String(a === undefined ? '' : a) !== String(orig === undefined ? '' : orig)
        })()

        const head = react.createElement('div', { className: 'rh4-lblrow' },
          react.createElement('label', { className: 'rh4-lbl', htmlFor: id }, field.label),
          field.recommend ? react.createElement('span', { className: 'rh4-rec' }, field.recommend) : null,
          field.detail ? react.createElement('span', { className: 'rh4-help', title: field.detail, 'aria-label': '说明' }, '?') : null,
          (editing && field.def !== undefined && kind !== 'switch')
            ? react.createElement('button', {
                type: 'button', className: 'rh4-copy', title: '恢复成默认值',
                onClick: () => set(field.def),
              }, '重置')
            : null,
          // capsJson / freeTimeSlots 这类结构型：给一个「校验」，不用等保存才知道错
          (editing && CHECKABLE.indexOf(field.key) >= 0)
            ? react.createElement(JsonCheck, {
                key: 'jc', getText: () => {
                  const p = pendingRef.current[field.key]
                  return typeof p === 'string' ? p : valOf(p)
                },
              })
            : null)

        const blank = blankOf(field, value)

        let body
        if (kind === 'switch') {
          // 整行可点：标签 + 滑钮同一行，48px
          body = react.createElement('div', { className: 'rh4-swrow' + (editing ? '' : ' ro') },
            react.createElement('div', { className: 'rh4-swtext' },
              react.createElement('label', { className: 'rh4-lbl', htmlFor: id }, field.label),
              field.detail ? react.createElement('span', { className: 'rh4-help', title: field.detail, style: { marginLeft: '6px' }, 'aria-label': '说明' }, '?') : null,
              (editing && field.def !== undefined)
                ? react.createElement('button', {
                    type: 'button', className: 'rh4-copy', style: { marginLeft: '6px' }, title: '恢复成默认值',
                    onClick: () => set(field.def),
                  }, '重置')
                : null),
            react.createElement(Switch, {
              id, checked: Boolean(value), readOnly: !editing,
              onToggle: (nx) => set(nx),
            }))
        } else if (kind === 'number') {
          body = react.createElement('div', null,
            head,
            react.createElement('div', { className: 'rh4-numwrap' },
              react.createElement('input', {
                // 用 text 不用 number：number 在只读态仍带浏览器 spinner，看着像能点。
                id, className: 'rh4-in rh4-num', type: 'text', inputMode: 'decimal',
                defaultValue: blank.bare ? '' : fmtValue(value),
                placeholder: blank.bare && !editing ? blank.hint : undefined,
                readOnly: !editing,
                onChange: (e) => {
                  const raw = String(e.target.value).trim();
                  set(raw === '' ? undefined : (Number.isFinite(Number(raw)) ? Number(raw) : raw));
                },
              }),
              field.unit ? react.createElement('span', { className: 'rh4-unit' }, field.unit) : null,
              err ? react.createElement('span', { className: 'rh4-msg err' }, err) : null))
        } else if (kind === 'multi') {
          // 段名表：勾选而不是手打 24 个名字
          const picked = Array.isArray(value) ? value : []
          const toggle = (name) => {
            const next = picked.indexOf(name) >= 0 ? picked.filter((x) => x !== name) : picked.concat([name])
            set(next)
          }
          body = editing
            ? react.createElement('div', null,
                head,
                react.createElement('div', { className: 'rh4-chips' },
                  (field.options || []).map((name) => react.createElement('label', {
                    key: name, className: 'rh4-chip' + (picked.indexOf(name) >= 0 ? ' on' : ''),
                  },
                    react.createElement('input', {
                      type: 'checkbox', checked: picked.indexOf(name) >= 0,
                      onChange: () => toggle(name),
                    }),
                    react.createElement('span', null, name)))),
                react.createElement('p', { className: 'rh4-brief' },
                  picked.length ? ('关掉 ' + picked.length + ' 段：' + picked.join('、')) : '一段都没关（全开）'))
            : react.createElement('div', null,
                head,
                react.createElement('div', { className: 'rh4-val' + (picked.length ? '' : ' dim') },
                  picked.length ? picked.join('、') : '（空 —— 全开）'))
        } else if (kind === 'code' || kind === 'tags') {
          const rows = field.key === 'capsJson' ? 22 : 6
          body = react.createElement('div', null,
            head,
            kind === 'code'
              ? react.createElement('textarea', {
                  id, className: 'rh4-in rh4-code', rows,
                  style: { minHeight: (rows * 18) + 'px' },
                  defaultValue: blank.bare ? '' : (isJsonField(field.key)
                    ? JSON.stringify(value === undefined ? [] : value, null, 2)
                    : valOf(value)),
                  placeholder: blank.bare && !editing ? blank.hint : undefined,
                  readOnly: !editing,
                  spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off',
                  'aria-invalid': err ? 'true' : undefined,
                  'aria-describedby': err ? id + '-err' : undefined,
                  onChange: (e) => set(e.target.value),
                })
              : react.createElement('input', {
                  id, className: 'rh4-in rh4-short', type: 'text', defaultValue: fmtValue(value), readOnly: !editing,
                  placeholder: '用逗号分隔',
                  onChange: (e) => set(toList(e.target.value)),
                }),
            err ? react.createElement('span', { className: 'rh4-msg err', id: id + '-err' }, err) : null)
        } else {
          const isPath = /(dir|root|path|Dir)$/.test(field.key) || /路径|目录|在哪儿/.test(field.label)
          body = react.createElement('div', null,
            head,
            react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
              react.createElement('input', {
                id, className: 'rh4-in', type: 'text',
                defaultValue: blank.bare ? '' : fmtValue(value),
                placeholder: blank.bare && !editing ? blank.hint : undefined,
                readOnly: !editing,
                onChange: (e) => set(e.target.value),
              }),
              (!editing && isPath && typeof navigator !== 'undefined' && navigator.clipboard)
                ? react.createElement('button', {
                    type: 'button', className: 'rh4-copy',
                    onClick: () => { try { navigator.clipboard.writeText(fmtValue(value)) } catch {} },
                  }, '复制')
                : null),
            err ? react.createElement('span', { className: 'rh4-msg err' }, err) : null)
        }

        return react.createElement('div', {
          // dirty：这一项和读回来时不一样了。编辑态改了三五个字段之后，
          // 光看控件是分不出「本来就是这值」和「我刚改的」的 —— 标出来。
          className: 'rh4-f'
            + (kind === 'number' || kind === 'text' || kind === 'tags' ? ' third' : '')
            + (dirty ? ' dirty' : ''),
          key: field.key,
        },
          body,
          field.brief ? react.createElement('p', { className: 'rh4-brief' }, field.brief) : null)
      }

      /** 一个分区。总开关关掉时子项隐藏，只留一句说明。 */
      function Section(props) {
        const { region, fields, values, editing, pendingRef, onDirty, errs, forcedOpen, gen } = props
        const [open, setOpen] = react.useState(region.defaultOpen !== false)
        const live = (k) => (k in pendingRef.current ? pendingRef.current[k] : values[k])

        let swState = null
        if (region.switchKey) {
          if (region.switchKind === 'proxy') {
            const v = Number(live(region.switchKey))
            swState = Number.isFinite(v) && v > 0
          } else {
            swState = Boolean(live(region.switchKey))
          }
        }
        const collapsedBySwitch = region.switchKey && region.switchKind !== 'proxy' && swState === false
        const proxyOff = region.switchKind === 'proxy' && swState === false
        const isOpen = forcedOpen ? true : (collapsedBySwitch || proxyOff ? false : open)

        const head = react.createElement('div', { className: 'rh4-sechead' },
          region.collapsible
            ? react.createElement('button', {
                className: 'rh4-btn ghost', style: { minHeight: '24px', padding: '0 8px', fontSize: '12px' },
                onClick: () => setOpen(!open), 'aria-expanded': isOpen ? 'true' : 'false',
              }, isOpen ? '收起' : '展开')
            : null,
          // 小标题给"分区序号 + 英文 id"，长页面里扫一眼就知道走到第几段
          react.createElement('div', { className: 'rh4-secmeta' },
            react.createElement('div', { className: 'rh4-eyebrow' },
              react.createElement('span', null, region.no || ''),
              react.createElement('span', null, region.id)),
            react.createElement('h3', { className: 'rh4-sectitle' }, region.title),
            region.desc ? react.createElement('p', { className: 'rh4-secdesc' }, region.desc) : null),
          react.createElement('span', { className: 'rh4-secgrow' }),
          // 本区恢复默认：只对「有默认值」的项生效（路径类的 def 是 undefined，跳过）
          (editing && fields.some((f) => f.def !== undefined))
            ? react.createElement('button', {
                type: 'button', className: 'rh4-copy', title: '把本区这些项都恢复成默认值（还没保存，可放弃）',
                onClick: () => {
                  for (const f of fields) if (f.def !== undefined) pendingRef.current[f.key] = f.def;
                  if (onDirty) onDirty(region.id);
                },
              }, '本区重置')
            : null,
          region.switchKey
            ? react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                region.switchKind === 'proxy' ? react.createElement('span', { className: 'rh4-rec' }, region.proxyNote || '') : null,
                react.createElement(Switch, {
                  id: 'rh4-sec-' + region.id,
                  checked: Boolean(swState),
                  readOnly: !editing,
                  onToggle: (nx) => {
                    if (region.switchKind === 'proxy') {
                      pendingRef.current[region.switchKey] = nx ? (region.proxyOn || 30) : (region.proxyOff || 0)
                    } else {
                      pendingRef.current[region.switchKey] = nx
                    }
                    if (onDirty) onDirty(region.switchKey)
                  },
                }))
            : null)

        const offNote = (collapsedBySwitch || proxyOff) && region.whenOff
          ? react.createElement('p', { className: 'rh4-off' }, region.whenOff)
          : null

        const grid = isOpen
          ? react.createElement('div', { className: 'rh4-grid' },
              fields.map((f) => react.createElement(Field, {
                key: f.key + ':' + gen, field: f,
                value: live(f.key), base: values[f.key], editing, pendingRef, onDirty, errs,
              })))
          : null

        return react.createElement('section', { className: 'rh4-sec' },
          head,
          react.createElement('div', { className: 'rh4-hr', 'aria-hidden': 'true' }),
          offNote,
          grid)
      }

      // ── 页面 ──────────────────────────────────────────────────────────
      function remoteOf(ctx) {
        try {
          const r = ctx && ctx.remote
          if (r && r.settings) return r
          return null
        } catch { return null }
      }
      const unwrap = (x) => (x && typeof x === 'object' && 'ok' in x && x.ok && 'value' in x ? x.value : x)

      function Page(props) {
        const ctx = props.ctx
        ensureCss()

        const [state, setState] = react.useState({ phase: 'loading' })
        const [values, setValues] = react.useState({})
        const [revision, setRevision] = react.useState(undefined)
        const [editing, setEditing] = react.useState(false)
        const [active, setActive] = react.useState(REGIONS[0] ? REGIONS[0].id : '')
        const [query, setQuery] = react.useState('')
        const [errs, setErrs] = react.useState({})
        const [confirm, setConfirm] = react.useState(null)
        const [msg, setMsg] = react.useState(undefined)
        const [tick, setTick] = react.useState(0)
        // 非受控输入靠 defaultValue，重读后必须靠 key 换掉 DOM 节点才看得到新值
        const [gen, setGen] = react.useState(0)
        const pendingRef = react.useRef({})

        const load = react.useCallback(async () => {
          const remote = remoteOf(ctx)
          if (remote === null) { setState({ phase: 'unsupported' }); return }
          setState({ phase: 'loading' })
          try {
            const described = unwrap(await remote.settings.describe())
            if (!described || !Array.isArray(described.namespaces)) {
              throw new Error('describe 返回的形状不对：' + JSON.stringify(described).slice(0, 200))
            }
            const row = described.namespaces.find((n) => n && n.ns === NS)
            if (!row) { setState({ phase: 'missing' }); return }
            pendingRef.current = {}
            setGen((g) => g + 1)
            setValues(Object.assign({}, row.value || {}))
            setRevision(row.revision)
            setState({ phase: 'ready' })
          } catch (err) {
            setState({ phase: 'error', error: String(err && err.message ? err.message : err) })
          }
        }, [ctx])

        react.useEffect(() => { void load() }, [load])

        // Esc：先关确认面板，再退出编辑态（不保存）。挂 window 上，页面切走也会解绑。
        react.useEffect(() => {
          if (typeof window === 'undefined' || !window.addEventListener) return undefined
          const onKey = (ev) => {
            if (ev.key !== 'Escape') return
            if (confirm) { setConfirm(null); return }
            if (editing) { pendingRef.current = {}; setEditing(false); setErrs({}); void load() }
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [confirm, editing, load])

        const markDirty = () => setTick((n) => n + 1)

        const changedKeys = () => {
          const p = pendingRef.current
          return Object.keys(p).filter((k) => {
            const before = values[k]
            const after = p[k]
            if (Array.isArray(before) || Array.isArray(after)) return JSON.stringify(before || []) !== JSON.stringify(after || [])
            return String(before === undefined ? '' : before) !== String(after === undefined ? '' : after)
          })
        }

        const doSave = async () => {
          const remote = remoteOf(ctx)
          if (remote === null) return
          const keys = changedKeys()
          if (!keys.length) { setMsg({ ok: true, text: '没有改动。' }); setConfirm(null); return }
          const merged = Object.assign({}, values)
          for (const k of keys) merged[k] = pendingRef.current[k]
          const bad = validateAll(merged)
          if (bad.length) {
            const map = {}
            for (const b of bad) map[b.key] = b.msg
            setErrs(map)
            setMsg({ ok: false, text: '有几项互相矛盾，改完再存：' + bad.map((b) => b.key + '（' + b.msg + '）').join('；') })
            setConfirm(null)
            return
          }
          const patch = {}
          for (const k of keys) {
            const raw = pendingRef.current[k]
            if (isJsonField(k) && typeof raw === 'string') {
              try { patch[k] = JSON.parse(raw) } catch (err) {
                setErrs({ [k]: '不是合法 JSON：' + String((err && err.message) || err).slice(0, 60) })
                setMsg({ ok: false, text: k + ' 不是合法 JSON，改完再存。' })
                setConfirm(null)
                return
              }
            } else {
              patch[k] = raw
            }
          }
          try {
            await unwrap(await remote.settings.update(NS, patch, revision))
            setMsg({ ok: true, text: '已保存 ' + keys.length + ' 项（写入 profile，插件会热重载）' })
            setConfirm(null)
            setErrs({})
            setEditing(false)
            await load()
          } catch (err) {
            setMsg({ ok: false, text: '保存失败：' + String(err && err.message ? err.message : err) })
          }
        }

        if (state.phase === 'loading') return react.createElement('p', { className: 'rh4-note' }, '读取配置中…')
        if (state.phase === 'unsupported') {
          return react.createElement('p', { className: 'rh4-note' },
            '当前宿主没有暴露 settings Remote 域，这一页读不了配置。可以手改 profile 的 cordis.patch.yml。')
        }
        if (state.phase === 'missing') {
          return react.createElement('div', null,
            react.createElement('p', { className: 'rh4-note' }, '宿主里没找到 realheart 的配置条目。确认插件已安装并启用，再点重试。'),
            react.createElement('button', { className: 'rh4-btn', onClick: () => void load() }, '重试'))
        }
        if (state.phase === 'error') {
          return react.createElement('div', null,
            react.createElement('p', { className: 'rh4-msg err' }, '读取配置失败：' + state.error),
            react.createElement('button', { className: 'rh4-btn', onClick: () => void load() }, '重试'))
        }

        const q = query.trim().toLowerCase()
        const hit = q
          ? FIELDS.filter((f) => (f.label + ' ' + f.brief + ' ' + f.key + ' ' + f.region).toLowerCase().includes(q))
          : null
        const hitRegions = hit ? REGIONS.filter((r) => hit.some((f) => f.region === r.id)) : null

        const keysChanged = changedKeys()

        const toolbar = react.createElement('div', { className: 'rh4-bar' },
          react.createElement('input', {
            className: 'rh4-search', type: 'search', placeholder: '搜配置（名字 / 说明 / 键名）',
            value: query, onChange: (e) => setQuery(e.target.value), 'aria-label': '搜配置',
          }),
          // 右侧动作按"读 / 写"分两簇，中间一条竖线：主次一眼分得开
          react.createElement('div', { className: 'rh4-tools' },
            react.createElement('button', { className: 'rh4-btn ghost', onClick: () => void load() }, '重新读取'),
          // 导出：把当前生效的整份配置变成 JSON。排查时贴给我比描述快得多（里面没有凭据）。
          react.createElement('button', {
            className: 'rh4-btn',
            title: '把当前配置导成 JSON（不含任何 key）',
            onClick: () => {
              const out = { exportedAt: new Date().toISOString(), ns: NS, version: (values && values.__v) || undefined, config: {} }
              for (const f of FIELDS) out.config[f.key] = values[f.key]
              const text = JSON.stringify(out, null, 2)
              try {
                if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
                  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'realheart-config-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json'
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  setTimeout(() => URL.revokeObjectURL(url), 2000)
                  setMsg({ ok: true, text: '已导出（下载里那个 realheart-config-*.json）' })
                } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(text)
                  setMsg({ ok: true, text: '已复制到剪贴板' })
                }
              } catch (err) {
                setMsg({ ok: false, text: '导出没成功：' + String((err && err.message) || err) })
              }
              // 两个分支都没走成（比如没有下载能力）也要说一句，别静默
              if (!(typeof document !== 'undefined' && typeof Blob !== 'undefined')
                && !(typeof navigator !== 'undefined' && navigator.clipboard)) {
                setMsg({ ok: false, text: '这个环境导不出来（没有下载也没有剪贴板），可以手动复制下面搜索框里的值。' })
              }
            },
          }, '导出 JSON'),
            react.createElement('span', { className: 'rh4-vline', 'aria-hidden': 'true' }),
            editing
              ? react.createElement('button', {
                  className: 'rh4-btn' + (confirm ? ' ghost' : ' primary'),
                  // 没改动就禁用；确认面板开着时也禁用 —— 主操作只有一个，在确认卡里
                  disabled: keysChanged.length === 0 || Boolean(confirm),
                  onClick: () => {
                    const keys = changedKeys()
                    if (!keys.length) return
                    const after = Object.assign({}, values)
                    for (const k of keys) after[k] = pendingRef.current[k]
                    setConfirm({ keys, danger: dangersOf(values, after) })
                  },
                }, '保存（改动 ' + keysChanged.length + ' 项）')
              : react.createElement('button', { className: 'rh4-btn primary', onClick: () => setEditing(true) }, '编辑'),
            editing
              ? react.createElement('button', {
                  className: 'rh4-btn ghost',
                  onClick: () => { pendingRef.current = {}; setEditing(false); setErrs({}); setConfirm(null); void load() },
                }, '放弃')
              : null))

        const diffPanel = confirm && confirm.keys.length
          ? react.createElement('div', { className: 'rh4-diff' },
              react.createElement('div', { className: 'rh4-diffhead' },
                react.createElement('h4', null, '这次要保存的改动 · ' + confirm.keys.length + ' 项'),
                react.createElement('span', { className: 'rh4-secgrow' }),
                react.createElement('button', { className: 'rh4-btn ghost', onClick: () => setConfirm(null) }, '返回修改'),
                react.createElement('button', {
                  className: 'rh4-btn primary',
                  onClick: () => void doSave(),
                }, (confirm.danger && confirm.danger.length) ? '确认执行（有风险）' : '确认保存')),
              confirm.keys.map((k) => react.createElement('div', { className: 'rh4-diffrow', key: k },
                react.createElement('span', { className: 'rh4-diffkey' }, k),
                react.createElement('span', { className: 'rh4-diffold' },
                  values[k] === undefined ? '（默认）' : valOf(values[k])),
                react.createElement('span', { className: 'rh4-diffarrow' }, '→'),
                react.createElement('span', { className: 'rh4-diffnew' },
                  pendingRef.current[k] === undefined ? '（默认）' : valOf(pendingRef.current[k])))),
              (confirm.danger && confirm.danger.length)
                ? react.createElement('div', { className: 'rh4-dangerbox' },
                    react.createElement('h4', null, '这几项要再确认一次'),
                    confirm.danger.map((d, i) => react.createElement('div', {
                      key: 'd' + i, className: 'rh4-diffrow',
                    }, '· ' + d)))
                : null)
          : null

        const nav = react.createElement('div', { className: 'rh4-nav', role: 'tablist', 'aria-label': '配置分区' },
          GROUPED.map((g, idx) => react.createElement('button', {
            key: g.region.id,
            role: 'tab',
            'aria-selected': (!q && active === g.region.id) ? 'true' : 'false',
            className: 'rh4-navitem' + ((!q && active === g.region.id) ? ' on' : ''),
            onClick: () => { setActive(g.region.id); setQuery('') },
          },
            // 序号不是装饰：九个区里靠它一眼定位，比记住标题快
            react.createElement('span', { className: 'rh4-navno', 'aria-hidden': 'true' },
              String(idx + 1).padStart(2, '0')),
            react.createElement('span', null, g.region.title))))

        const select = react.createElement('select', {
          className: 'rh4-select', value: active, 'aria-label': '选择配置分区',
          onChange: (e) => { setActive(e.target.value); setQuery('') },
        }, GROUPED.map((g) => react.createElement('option', { key: g.region.id, value: g.region.id }, g.region.title)))

        const body = q
          ? react.createElement('div', null,
              react.createElement('p', { className: 'rh4-hit' },
                '命中 ' + hit.length + ' 项，分布在 ' + hitRegions.length + ' 个区'),
              GROUPED.filter((g) => hit.some((f) => f.region === g.region.id)).map((g) => react.createElement(Section, {
                key: g.region.id,
                region: g.region,
                fields: g.fields.filter((f) => hit.some((h) => h.key === f.key)),
                values, editing, pendingRef, onDirty: markDirty, errs, forcedOpen: true, gen,
              })))
          : react.createElement(Section, {
              key: active,
              region: (REGIONS.find((r) => r.id === active) || REGIONS[0]),
              fields: (GROUPED.find((g) => g.region.id === active) || GROUPED[0]).fields,
              values, editing, pendingRef, onDirty: markDirty, errs, gen,
            })

        return react.createElement('div', { className: rootClass(editing) },
          react.createElement('div', { className: 'rh4-shell' },
            nav,
            // 工具条与内容同宽（都在右栏里）：跨过左目录会让"编辑"按钮贴到最右边，
            // 和下面的开关、值对不齐 —— 视觉上一眼就能看出来别扭。
            react.createElement('div', { className: 'rh4-main' },
              select,
              react.createElement('p', { className: 'rh4-note' },
                react.createElement('span', { className: 'rh4-noteicon', 'aria-hidden': 'true' }, 'i'),
                react.createElement('span', null,
                  '这里的保存写进 profile 的 cordis.patch.yml，插件会热重载；观测页面板上那份是 config.user.json，改完要重启。两处都能改，别同时改同一项。')),
              toolbar,
              msg ? react.createElement('p', { className: 'rh4-msg ' + (msg.ok ? 'ok' : 'err') }, msg.text) : null,
              diffPanel,
              body)))
      }

      // remote.settings = @deepseek-ai/dsh-api-settings-controller 暴露的 settings Remote 域
      const inject = ['slots', 'remote', 'remote.settings']

      /** 注册成「设置」左侧菜单里的一个页面。 */
      function apply(ctx) {
        const PageBound = (props) => react.createElement(Page, Object.assign({}, props, { ctx }))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'realheart',
          order: 62,
          label: () => 'Realheart',
        }, PageBound))
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
}
