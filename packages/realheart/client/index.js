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
          "why": "作用：插件总开关。关 = 不注入、不记账、不注册工具，已写的账保留。\n默认：true。影响：关闭后行为差异极大。"
        },
        {
          "key": "injectMood",
          "label": "每轮注入状态",
          "kind": "boolean",
          "group": "switch",
          "level": "danger",
          "why": "作用：每轮把她的状态（心情、没完的事）注入。\n默认：true。影响：关闭后她看不到自己的账，仍可写入但不受影响。"
        },
        {
          "key": "injectNow",
          "label": "注入里带上「现在几点」",
          "kind": "boolean",
          "group": "inject",
          "level": "caution",
          "why": "作用：注入当前时间（日期、星期、时段）。\n默认：true。影响：每轮多几十字；用于判断「此刻合不合适说」。"
        },
        {
          "key": "injectVoice",
          "label": "注入里告诉她「你能主动开口」",
          "kind": "boolean",
          "group": "inject",
          "level": "caution",
          "why": "作用：注入「你手上有主动发消息的路」。\n默认：true。影响：关闭后主动消息显著减少（实测：写出来之前几乎不发）。"
        },
        {
          "key": "voiceHints",
          "label": "告诉她具体怎么发（可选）",
          "kind": "list",
          "group": "inject",
          "level": "caution",
          "why": "作用：给上面那段补具体发送命令，一行一条。\n默认：[]。影响：留空则只给意图、不给路径。不可自动探测，路径各机不同。"
        },
        {
          "key": "injectToday",
          "label": "注入「今天我」",
          "kind": "boolean",
          "group": "inject",
          "level": "caution",
          "why": "作用：注入「今天我」段（当天做过什么的摘要）。\n默认：true。影响：每轮多一段；关闭后她对今天没有连续印象。"
        },
        {
          "key": "sayLogPath",
          "label": "主动消息账本在哪",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "作用：主动消息账本的路径，用于「今天已经发过什么」。\n默认：空 = 由 root/work 推导。影响：路径错则读不到已发记录。"
        },
        {
          "key": "pingContext",
          "label": "短唤醒 · 带上她此刻的调子",
          "kind": "boolean",
          "group": "switch",
          "level": "caution",
          "why": "作用：短唤醒时带上她此刻的调子。\n默认：true。影响：关闭后唤醒语气与心情脱钩。"
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
          "why": "作用：短唤醒最长间隔。\n默认：60。影响：必须 ≥ 最短间隔。"
        },
        {
          "key": "pingFromHour",
          "label": "短唤醒 · 从几点开始",
          "kind": "number",
          "group": "switch",
          "level": "caution",
          "why": "作用：短唤醒起始小时（0-23）。\n默认：8。影响：窗口外不唤醒。"
        },
        {
          "key": "pingToHour",
          "label": "短唤醒 · 到几点为止",
          "kind": "number",
          "group": "switch",
          "level": "caution",
          "why": "作用：短唤醒结束小时（0-23）。\n默认：23。影响：可跨零点（如 22→6）。"
        },
        {
          "key": "toolsOff",
          "label": "关掉哪几个工具",
          "kind": "list",
          "group": "switch",
          "level": "danger",
          "why": "作用：按名字停用工具，停用的不注册（不是调用时报错）。\n默认：[]。影响：减少工具表噪声，提高其余工具的命中率。"
        },
        {
          "key": "root",
          "label": "她的根目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "作用：她的根目录，其他路径默认相对它推导。\n默认：自动探测。影响：填错会导致账本/脚本全面错位。"
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
          "why": "作用：心情超过多少小时不再占正文，只收成一行点名。\n默认：24。影响：不修改账本值，只影响呈现。"
        },
        {
          "key": "bleedMinLevel",
          "label": "别处的情绪多浓才带过来",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "作用：别场合的情绪浓到几级才渗入本场合。\n默认：7。影响：调低会更易串场。"
        },
        {
          "key": "bleedMaxHours",
          "label": "多新的别处情绪才会带过来",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "作用：别场合的情绪多新才渗入（小时）。\n默认：12。影响：调大带入更久之前的状态。"
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
          "why": "作用：观测页绑定地址。\n默认：127.0.0.1。影响：改 0.0.0.0 会暴露到网络，需自控访问。"
        },
        {
          "key": "freeTime",
          "label": "自由时间",
          "kind": "boolean",
          "group": "switch",
          "level": "danger",
          "why": "作用：自由时间机制开关。\n默认：true。影响：关闭后不触发自由时间任务。"
        },
        {
          "key": "freeTimeSlots",
          "label": "自由时间 · 哪几段",
          "kind": "list",
          "group": "freetime",
          "level": "caution",
          "why": "作用：自由时间的时间段列表（如 09:00-10:00）。\n默认：见配置。影响：窗口外不触发。"
        },
        {
          "key": "freeTimeFocus",
          "label": "自由时间 · 让她多看什么",
          "kind": "list",
          "group": "freetime",
          "level": "caution",
          "why": "作用：自由时间希望她关注的方向，一行一条。\n默认：[]。影响：留空则不给方向。"
        },
        {
          "key": "freeTimeProfile",
          "label": "自由时间用哪个 profile",
          "kind": "text",
          "group": "freetime",
          "level": "danger",
          "why": "作用：自由时间起会话用的 profile。\n默认：空 = 同当前。影响：填错则该会话起不来。"
        },
        {
          "key": "pagePort",
          "label": "观测页端口",
          "kind": "number",
          "group": "page",
          "level": "caution",
          "why": "作用：观测页端口。\n默认：8098。影响：端口冲突时页面不可用，不影响主流程。"
        },
        {
          "key": "servePage",
          "label": "开观测页",
          "kind": "boolean",
          "group": "switch",
          "level": "caution",
          "why": "作用：是否启动观测页。\n默认：true。影响：关闭后无页面，也不监听端口。"
        },
        {
          "key": "indexTtlMs",
          "label": "索引重建间隔",
          "kind": "number",
          "group": "inject",
          "level": "caution",
          "why": "作用：事件索引重建间隔（毫秒）。\n默认：60000。影响：调小更实时、IO 更频繁。"
        },
        {
          "key": "announceOnInstall",
          "label": "首次启动提示",
          "kind": "boolean",
          "group": "other",
          "level": "normal",
          "why": "作用：首次启动时输出安装提示。\n默认：true。影响：仅影响日志。"
        },
        {
          "key": "sessionsRoot",
          "label": "会话目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "作用：会话文件目录，用于索引与审计。\n默认：自动探测。影响：错则索引为空。"
        },
        {
          "key": "auditDir",
          "label": "审计日志目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "作用：审计日志目录（工具调用留痕）。\n默认：探测。影响：错则审计为空。"
        },
        {
          "key": "historyDir",
          "label": "对话历史目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "作用：对话历史目录（napcat 落盘）。\n默认：探测。影响：错则「今天聊到哪」为空。"
        },
        {
          "key": "personaHome",
          "label": "人格目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "作用：人格文件目录。\n默认：探测。影响：错则读不到人格补充。"
        },
        {
          "key": "allowManualMoodOverride",
          "label": "允许人工改写她的心情",
          "kind": "boolean",
          "group": "boundary",
          "level": "danger",
          "why": "作用：是否允许人工改写她的心情。\n默认：false。影响：开启后改写会明确标注「不是你自己的」。"
        },
        {
          "key": "maxManualMoodOverridePerWeek",
          "label": "一周最多改写几次",
          "kind": "number",
          "group": "boundary",
          "level": "danger",
          "why": "作用：一周最多改写几次。\n默认：3。影响：超额拒绝写入。"
        },
        {
          "key": "ownerId",
          "label": "他本人的号",
          "kind": "text",
          "group": "ledger",
          "level": "caution",
          "why": "作用：他本人的 QQ 号，用于过滤只属于他的记录。\n默认：空。影响：留空则不过滤，群消息可能混入。"
        },
        {
          "key": "msgsDir",
          "label": "落盘消息目录",
          "kind": "text",
          "group": "ledger",
          "level": "danger",
          "why": "作用：落盘消息目录。\n默认：探测。影响：错则对账无数据。"
        },
        {
          "key": "promptFree",
          "label": "自由时间 · 提示词",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "作用：自由时间的提示词正文。\n默认：内置。影响：直接决定自由时间的产出质量。"
        },
        {
          "key": "promptPing",
          "label": "短唤醒 · 提示词",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "作用：短唤醒的提示词正文。\n默认：内置。影响：直接决定唤醒时的开场行为。"
        },
        {
          "key": "promptVoiceTail",
          "label": "「你能主动开口」的尾句",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "作用：「你能主动开口」段的尾句。\n默认：内置。影响：弱化会让主动消息变少。"
        },
        {
          "key": "promptTodayTail",
          "label": "「今天我」的尾句",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "作用：「今天我」段的尾句。\n默认：内置。影响：控制该段的用法约束。"
        },
        {
          "key": "promptMoodBan",
          "label": "心情段的禁令句",
          "kind": "textarea",
          "group": "prompt",
          "level": "caution",
          "why": "作用：心情段的禁令句（「知道就行，不必说出来」）。\n默认：内置。影响：删除后她会把心情当聊天素材说出来（已对照验证）。"
        },
        {
          "key": "capsOn",
          "label": "外部能力总开关",
          "kind": "boolean",
          "group": "caps",
          "level": "caution",
          "why": "作用：外部能力总开关。\n默认：true。影响：关闭后 rh_call 直接拒调。"
        },
        {
          "key": "capsFile",
          "label": "配方文件路径",
          "kind": "text",
          "group": "caps",
          "level": "normal",
          "why": "作用：能力配方文件路径。\n默认：空 = 账本目录下 capabilities.json。影响：设置页「外部能力」有内容时以设置页为准。"
        },
        {
          "key": "capsDailyLimit",
          "label": "每条能力每日上限",
          "kind": "number",
          "group": "caps",
          "level": "caution",
          "why": "作用：每条能力每天最多调用次数（0 = 不限）。\n默认：30。影响：生成类按次计费，这是成本闸。"
        },
        {
          "key": "capsJson",
          "label": "能力配方（整份 JSON）",
          "kind": "textarea",
          "group": "caps",
          "rows": 22,
          "level": "caution",
          "why": "作用：能力配方（整份 JSON）。留空则用 capabilities.json。\n默认：空。影响：写了就以这里为准；不含密钥，可整段分享。\n修改后需重启。"
        }
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
            id, style: Object.assign({}, style.input, {
              minHeight: field.rows ? (field.rows * 16) + 'px' : '96px',
              fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px',
            }),
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

        const tabBar = react.createElement('div', { style: style.tabs },
          groups.map((g) => react.createElement('button', {
            key: g,
            onClick: () => setTab(g),
            style: g === activeTab ? style.tabOn : style.tabOff,
          }, GROUP_LABEL[g] || g)))

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
