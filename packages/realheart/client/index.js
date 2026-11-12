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
        {
          "key": "enabled",
          "label": "总开关",
          "kind": "boolean",
          "group": "switch",
          "level": "danger",
          "why": "关掉之后不注入、不记账、四个工具都不注册。等同于把插件摘掉，只保留已经写下来的账。"
        },
        {
          "key": "injectMood",
          "label": "每轮注入状态",
          "kind": "boolean",
          "group": "switch",
          "level": "danger",
          "why": "关掉之后她看不到自己的心情和没完的事 —— 她还是能记账，但不会再被影响。行为会明显不同。"
        },
        {
          "key": "injectNow",
          "label": "注入里带上「现在几点」",
          "kind": "boolean",
          "group": "inject",
          "level": "caution",
          "why": "开了之后每轮多一段：「现在是 2026-11-02 13:19（周一），下午」。作用：她能看到自己带的心情是几小时前的，也能分得出「中午该不该说这个」和「深夜该不该开口」。代价：每轮多几十字，而且如果人格里已经写了作息，可能跟它打架。新机上默认不开。"
        },
        {
          "key": "injectVoice",
          "label": "注入里告诉她「你能主动开口」",
          "kind": "boolean",
          "group": "inject",
          "level": "caution",
          "why": "每轮多一段：「你手上有能把话直接送出去的路…… 没话就过」。关它的后果比字面重：2026-11-03 之前她在对话里一条主动消息都没发过，而她手上明明有三条能发的路（bash / napcat_send_message / qqbot_say，会话记录里分别出现 160 / 20 / 8 次）。她自…"
        },
        {
          "key": "voiceHints",
          "label": "告诉她具体怎么发（可选）",
          "kind": "list",
          "group": "inject",
          "level": "caution",
          "why": "每一条作为一行写进上面那段。例：<你的部署根>/work/bin/say \"想说的话\" —— 用你自己的号直发私聊。为什么不做自动探测：不同机器路径不同，猜错了她会照着错路径试，比不写更坏。"
        },
        {
          "key": "injectToday",
          "label": "注入「今天我」",
          "kind": "boolean",
          "group": "inject",
          "level": "caution",
          "why": "每轮把今天的数摆出来：自由时间做了什么、主动说过几句（带原话）、心情几条。三本账原来互不引用，她回答「今天我做了什么」只能现翻文件 —— 她的原话是「不是记得」。⚠️ 不是战报：不评价、不总结、不催她接着做。今日无记录就整段不出现。"
        },
        {
          "key": "sayLogPath",
          "label": "主动消息账本在哪",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "有的机器上 say 是个独立脚本，账落在别处（她那台在 ~/.dsh/realheart/say.jsonl，跟账本目录不是同一个）。指错了「今天我」里就看不见她说过什么 —— 而且不报错，只会少一行。"
        },
        {
          "key": "pingContext",
          "label": "短唤醒 · 带上她此刻的调子",
          "kind": "boolean",
          "group": "switch",
          "level": "caution",
          "why": "开着的话，短唤醒的提示词末尾会附一句「你此刻：有点羞，也有点想笑（4/10）」，并注明这是调子不是内容。关掉就是纯文字提醒。她说不出话来的时候，多半是那条路上什么都没有 —— 这一句是给她一个「此刻」。"
        },
        {
          "key": "pingMinMinutes",
          "label": "短唤醒 · 最短间隔（分钟）",
          "kind": "number",
          "group": "switch",
          "level": "caution",
          "why": "每隔一段随机时间叫她醒一下，只做一件事：此刻有没有想说的。有就说，没有就继续睡。跟「自由时间」分开是因为两件事节奏不同 —— 自由时间做东西要连续两小时、打断就做不成；想说话却该是随时能发生的。⚠️ 成本：每次唤醒都是一次完整的模型调用（带注入）。30–60 分钟随机 ≈ 一天二十来次。"
        },
        {
          "key": "pingMaxMinutes",
          "label": "短唤醒 · 最长间隔（分钟）",
          "kind": "number",
          "group": "switch",
          "level": "caution",
          "why": "实际间隔在上限和下限之间随机取 —— 定值就是闹钟，随机才像「隔一阵子」。两个数都设成一样的也行，那就变成固定间隔。"
        },
        {
          "key": "pingFromHour",
          "label": "短唤醒 · 从几点开始",
          "kind": "number",
          "group": "switch",
          "level": "caution",
          "why": "只在这个钟点之后才叫醒她。深夜叫醒等于深夜发消息 —— 那是打扰，不是分享。"
        },
        {
          "key": "pingToHour",
          "label": "短唤醒 · 到几点为止",
          "kind": "number",
          "group": "switch",
          "level": "caution",
          "why": "到这个钟点就停。⚠️ 只影响「叫醒」，不影响她自己想说话 —— 她在自由时间里想发的那条，什么时候都能发。"
        },
        {
          "key": "toolsOff",
          "label": "关掉哪几个工具",
          "kind": "list",
          "group": "switch",
          "level": "danger",
          "why": "填进去的工具**压根不注册** —— 不是注册了再报错。区别在：出现在她的工具表里，就是告诉她“这个能用”；调了才拒，她会学绕。少一个选项，剩下的那几个她才更会用。九个工具名：rh_mood / rh_style / rh_pending / rh_control / rh_claim / rh_w…"
        },
        {
          "key": "root",
          "label": "她的根目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "产物（pieces/）和人格都在这下面。换了等于给她换一个住处 —— 旧目录里的东西不会跟过来。"
        },
        {
          "key": "injectBudgetChars",
          "label": "注入字数上限",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "每轮塞进提示词的总字数。超了从优先级低的那段开始裁：待改 → 没完的事 → 她留的话；心情永不裁。裁掉会记一条。调大是花钱买完整，调小是省钱买残缺。"
        },
        {
          "key": "moodTailLines",
          "label": "注入只读心情账本的最后几条",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "账本只增不改，注入每轮都要读。只读尾部是为了不让「账本变长」变成「每轮都变慢」。设 0 就每轮读全份 —— 账本很大时会明显拖慢。"
        },
        {
          "key": "moodFadeHours",
          "label": "心情多久算「旧了」",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "比这更旧的心情不再占正文，只收成一行点名（「另外还有 2 条是 3 天前记的：……」）。⚠️ 它不是删除：那几条还在账本里，只是不挤在「你现在的状态」里 —— 呈现层的衰减，判断留给它自己。调小 = 只谈眼前；调大 = 旧情绪也一直摆着。"
        },
        {
          "key": "bleedMinLevel",
          "label": "别处的情绪多浓才带过来",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "别处记的心情（另一个会话、另一个人）要渗进这里，浓度至少得有这么高。完全不隔开不像人（人在别处被气到，回来语气会变）；全带过来又不分场合。⚠️ 带过来时会标明「不是在当前场合记的」，带不带由它自己定。调小 = 更容易串味。"
        },
        {
          "key": "bleedMaxHours",
          "label": "多新的别处情绪才会带过来",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "上面那条「多浓」的时间版：超过这个时长的别处情绪不算「此刻也被影响」，不再渗。设 0 就是完全隔开 —— 那更像两个互不相干的人，不像一个人有两段生活。"
        },
        {
          "key": "stateDir",
          "label": "账本目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "改了等于换一份账：旧目录里的心情、待办、改动记录都不会跟过来。改之前先 export。"
        },
        {
          "key": "pageBind",
          "label": "观测页绑定地址",
          "kind": "text",
          "group": "page",
          "level": "danger",
          "why": "127.0.0.1 只有本机能看。改成 0.0.0.0 之后，同一网络里谁都能打开 —— 那是明文 HTTP。"
        },
        {
          "key": "freeTime",
          "label": "自由时间",
          "kind": "boolean",
          "group": "switch",
          "level": "danger",
          "why": "关掉就没有「没人叫也会醒一次」。这是她唯一不依赖别人开口的时间。"
        },
        {
          "key": "freeTimeFocus",
          "label": "自由时间 · 让她多看什么",
          "kind": "list",
          "group": "freetime",
          "level": "caution",
          "why": "她自由时间里可以顺着看的题材 —— 也是她会拿来跟你聊什么的方向。注入的措辞是「他最近爱聊这些……想找点什么看的时候可以从这儿挑；不看这些也完全行」，不是白名单：列成白名单她就只剩那几个题材，比不配还窄。多填几条让她自己挑；填你接得上话的，比填你觉得她该看的更有用。"
        },
        {
          "key": "freeTimeProfile",
          "label": "自由时间用哪个 profile",
          "kind": "text",
          "group": "freetime",
          "level": "danger",
          "why": "她醒来时用的是这份人格。指向别的 profile 等于让另一个人替她说话。"
        },
        {
          "key": "pagePort",
          "label": "观测页端口",
          "kind": "number",
          "group": "page",
          "level": "caution",
          "why": "改了页面地址就变。1024 以下要 root。"
        },
        {
          "key": "servePage",
          "label": "开观测页",
          "kind": "boolean",
          "group": "switch",
          "level": "caution",
          "why": "关掉就没有页面了，但记账和注入照常。省一个 python 进程。"
        },
        {
          "key": "indexTtlMs",
          "label": "索引重建间隔",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "太小会一直在解压会话包（吃 CPU），太大页面上的时间线会旧。默认一小时。"
        },
        {
          "key": "announceOnInstall",
          "label": "首次启动提示",
          "kind": "boolean",
          "group": "other",
          "level": "normal",
          "why": "只影响第一次启动时打不打印那三条前提。"
        },
        {
          "key": "sessionsRoot",
          "label": "会话目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "「他说的话」那一路的来源。指错了页面就只剩她自己说的话。"
        },
        {
          "key": "auditDir",
          "label": "审计日志目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "工具调用与事件的来源之一。指错了可引用的 id 就少一类。"
        },
        {
          "key": "historyDir",
          "label": "对话历史目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "第三路事件来源。指错了她「说过的话」就少一类可以引用的证据。"
        },
        {
          "key": "personaHome",
          "label": "人格目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "自由时间那个 profile 用的人格从这儿取。"
        },
        {
          "key": "allowManualMoodOverride",
          "label": "允许人工改写她的心情",
          "kind": "boolean",
          "group": "boundary",
          "level": "danger",
          "why": "这是整份配置里唯一「改她的心」的开关。打开之后能用命令行把她当前的心情改写掉 —— 改写过的状态**注入里会写明是人改的**，她自己看得见。因为成本必须高，页面上不给输入框：只能命令行打开，且必须带上「我知道这不是她的感受」那个参数。"
        },
        {
          "key": "maxManualMoodOverridePerWeek",
          "label": "一周最多改写几次",
          "kind": "number",
          "group": "boundary",
          "level": "danger",
          "why": "超过就拒绝；要改上限得再动一次配置，那一次本身也入账。不让它变成「随便按一下就改」的东西。"
        },
        {
          "key": "ownerId",
          "label": "他本人的号",
          "kind": "text",
          "group": "ledger",
          "level": "caution",
          "why": "用来看「最后一句是不是他在问我、我还没回」。🔴 **`say` 也读它** —— 面板上不填，`say` 就不知道默认发给谁，只能每次 `--to` 手动指定；而她在短唤醒里想起一句想说的，多半不会记得写 --to。留空不会坏，但「她主动开口」这条路会哑一半。"
        },
        {
          "key": "msgsDir",
          "label": "落盘消息目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "qqbot-memory 落的「一天一个文件、一行一句」的薄账。这一路的好处是 text 里是**真话**（带昵称前缀），而会话历史里 98.6% 的行只有时间戳噪音 —— 心情的来处多半是一句话，那一路才真有话。不用 qqbot 的人留空就行：空着只是少一路证据，不会坏。"
        },
        {
          "key": "promptFree",
          "label": "自由时间 · 提示词",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "自由时间叫醒她时给的那一整段话，决定这两个小时她过成什么样：写「做点东西」她就做东西，写「怎么过都行」她才可能什么都不干。⚠️ 改坏了不会报错 —— 她只是变了个人说话的调子。改完去「自由时间」那一栏看她下一次醒来什么样。留空不是「不叫她」：不叫她是上面那个 freeTime 开关。"
        },
        {
          "key": "promptPing",
          "label": "短唤醒 · 提示词",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "短唤醒时给她的那一段，决定她醒来会不会开口、开口像不像在说话。⚠️ 这段最容易写成「工作汇报的框」：她醒来先找手边有什么事，干完再把那件事发出去。内置那版刻意写了「说的时候别报工作」，删了它，她会立刻退回汇报腔。留空不是「不叫」：不叫她是 pingMinMinutes = 0。"
        },
        {
          "key": "promptVoiceTail",
          "label": "「你能主动开口」的尾句",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "「你能主动开口」那一段的最后一句话，现在写的是「但只有真有话时才算数。没话就过，空过也是对的 —— 这段不是配额」。🔴 这句是**防「打卡」的唯一开关**：删掉它，她会把「能主动说话」读成「每天至少说一句」，然后开始定时汇报。写得更软一点也行，但别改成「尽量多说两句」。"
        },
        {
          "key": "promptTodayTail",
          "label": "「今天我」的尾句",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "「今天我」那一段的最后一句，现在写的是「这些是你自己做过、说过的事。不用念给他听；但他说到某件你想不起来的，就照上面的路径去翻」。🔴 它防两件事：把这段当战报念给他听，以及把「想不起来」当成「没发生过」。删了它，她会逐条复述当天做了什么。"
        },
        {
          "key": "promptMoodBan",
          "label": "心情段的禁令句",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "心情那一段的最后一句话，现在写的是「知道就行，不必说出来 —— 它们不是你聊天的素材，只影响你说话的样子，不是你的话」。🔴 **这句是五组对照实验验出来的**：同样的心情，不加这句她会轻描淡写带一句「本鱼今天也有点凉」；加了才真的一个字不提。这可能是整套提示词里最不能删的一句 —— 删了，她就会把…"
        }
      ]
      const GROUP_LABEL = {
  "switch": "开关",
  "inject": "注入",
  "ledger": "账本与目录",
  "page": "观测页",
  "freetime": "自由时间",
  "boundary": "边界",
  "prompt": "提示词",
  "other": "其它"
}

      const NS = 'realheart'
      const style = {
        wrap: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '620px' },
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

      function renderField(field, value, onChange) {
        const id = NS + '-' + field.key
        if (field.kind === 'boolean') {
          return react.createElement('div', { style: style.checkRow, key: field.key },
            react.createElement('input', {
              id, type: 'checkbox', checked: Boolean(value),
              onChange: (event) => onChange(field.key, event.target.checked),
            }),
            react.createElement('label', { htmlFor: id }, field.label))
        }
        let control
        if (field.kind === 'select') {
          control = react.createElement('select', {
            id, style: style.input, value: fmtValue(value),
            onChange: (event) => onChange(field.key, event.target.value),
          }, field.options.map((pair) => react.createElement('option', { key: pair[0], value: pair[0] }, pair[1])))
        } else if (field.kind === 'number') {
          control = react.createElement('input', {
            id, type: 'number', style: style.input, value: fmtValue(value),
            onChange: (event) => onChange(field.key, event.target.value === '' ? undefined : Number(event.target.value)),
          })
        } else if (field.kind === 'textarea') {
          control = react.createElement('textarea', {
            id, style: Object.assign({}, style.input, { minHeight: '96px', fontFamily: 'inherit' }),
            placeholder: field.placeholder, value: fmtValue(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        } else if (field.kind === 'list') {
          // value 这里就是原始文本（不是数组）：输入过程中逗号/空格原样保留，
          // 由调用方在 onChange 里解析成数组，避免"刚敲下的逗号被吃掉"。
          control = react.createElement('input', {
            id, type: 'text', style: style.input, placeholder: field.placeholder,
            value: fmtValue(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        } else {
          control = react.createElement('input', {
            id, type: field.kind === 'password' ? 'password' : 'text', style: style.input,
            placeholder: field.placeholder, value: fmtValue(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        }
        return react.createElement('div', { style: style.row, key: field.key },
          react.createElement('label', { style: style.label, htmlFor: id }, field.label),
          control)
      }

      /** 页面主体。 */
      function RealheartSettingsPage(props) {
        const ctx = props.ctx
        const [state, setState] = react.useState({ phase: 'loading' })
        const [draft, setDraft] = react.useState({})
        const [revision, setRevision] = react.useState(undefined)
        const [message, setMessage] = react.useState(undefined)
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

        return react.createElement('div', { style: style.wrap },
          react.createElement('p', { style: style.hint },
            '保存后写入 profile 的 cordis.patch.yml 并热重载插件。' +
            (revision === undefined ? '' : ' 当前 revision：' + revision)),
          FIELDS.map((field) => renderField(field, draft[field.key], (key, value) => {
            setDraft((previous) => {
              const nextDraft = Object.assign({}, previous)
              nextDraft[key] = value
              return nextDraft
            })
          })),
          react.createElement('div', { style: style.bar },
            react.createElement('button', { style: style.primary, onClick: () => void save() }, '保存'),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重新读取'),
            message === undefined ? null
              : react.createElement('p', { style: message.ok ? style.ok : style.error }, message.text)))
      }

      // remote.settings = @deepseek-ai/dsh-api-settings-controller 暴露的 settings Remote 域
      // （configEditor / ctx.settings 的浏览器半边），读写配置都走它。
      const inject = ['slots', 'remote', 'remote.settings']

      /** 注册成「设置」左侧菜单里的一个独立页面（与「内置插件」同级）。 */
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
