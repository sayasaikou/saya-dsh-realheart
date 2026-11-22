/**
 * 文本 / 视觉（认识图）模型。都是 openai-chat 形态。
 *
 * 为什么把 context 单独写进 limits：agent 判断「这段话塞不塞得下」全靠它。
 * 之前没有这个字段，只能凭记忆猜，猜错的代价是整段请求 400。
 */

export const LLM_MODELS = [
  {
    vendor: 'volcengine',
    model: 'doubao-seed-2-1-pro-260915',
    recordId: 'ark-vision',
    name: '豆包识图',
    cap: 'vision',
    form: 'openai-chat',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaults: { max_tokens: 400 },
    params: {
      prompt: { desc: '要问什么 —— 「描述这张图」「读出上面的文字」「这个人手里拿的是什么」' },
      image_url: { desc: '识图必须给图：http 地址 或 data:image/png;base64,…', required: true },
      max_tokens: { desc: '可选 —— 回答长度上限，默认 400' },
      messages: { desc: '可选 —— 自己拼完整 messages 数组（要多轮追问时用）' },
    },
    input: 'text + image（http 地址或 data: 串）',
    output: 'text',
    limits: { contextTokens: null, maxOutput: null },
    docs: 'https://www.volcengine.com/docs/82379/1298459',
    asOf: '2026-11-22',
    priceNote: '视觉与文本同价，按输入/输出 token 分别计费，具体档位以火山价格页为准',
    promptGuide: ['问得越具体答案越有用：「这张图里有几个人」比「描述一下」好。', '要 OCR 就直说「逐字读出图里的文字」。'],
    pitfalls: ['是带思考的模型，实测 20~30 秒一张 —— 等不起的时候别用。'],
    unverified: ['上下文长度与单次输出上限的具体数字', '每千 token 的单价'],
  },

  // ── 阿里百炼（Qwen）──────────────────────────────────────
  // 走 OpenAI 兼容端点，所以形态就是 openai-chat，参数直接平铺进 body。
  // 价格字段只能放「输入」价（一个 value 装不下输入/输出两档），输出价写在 priceNote 里。
  {
    vendor: 'dashscope',
    recordId: 'dashscope-qwen3-8-max',
    model: 'qwen3.8-max',
    name: 'Qwen3.8 Max',
    cap: 'text',
    form: 'openai-chat',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    price: { unit: 'per_1k_tokens', value: 0.012 },
    priceNote: '输入 12 元/百万 token（=0.012 元/千）、输出 36 元/百万（=0.036 元/千）；缓存命中输入 1.5 元/百万。'
      + '最大输入 991808，思考模式 983616，最大思维链 262144（华北2北京）',
    input: 'text（原生还吃 image / video）+ messages 历史',
    output: 'OpenAI 格式 chat.completion，choices[0].message.content',
    limits: { contextTokens: 1000000, maxOutput: 131072 },
    docs: 'https://help.aliyun.com/zh/model-studio/qwen3-8-max',
    asOf: '2026-11-22',
    params: {
      prompt: { desc: '要问什么（单轮时用；要多轮就自己拼 messages）', required: false },
      messages: { desc: '可选 —— 完整 messages 数组；只有 messages[0] 能是 system，最后一条必须是 user' },
      temperature: { desc: '随机性' },
      top_p: { desc: '核采样阈值，(0,1.0)' },
      max_tokens: { desc: '输出长度上限' },
    },
    pitfalls: [
      '**上下文写着 100 万，但最大输入只有 991808**（思考模式 983616）—— 按 1000000 去塞会失败。',
      'API Key 跟地域绑定：北京 key 打新加坡端点返回 401 invalid_api_key，看着像 key 失效，其实是地域错。',
      '官方现在推荐换业务空间专属域名 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com，但 dashscope.aliyuncs.com 文档写明仍可用。',
      'Qwen-Audio 系列**不支持** OpenAI 兼容协议，只能走 DashScope 原生协议。',
    ],
    unverified: ['qwen4-max 的上下文与最大输出（只核到价格 10/30 元每百万）'],
  },
  {
    vendor: 'dashscope',
    recordId: 'dashscope-qwen3-8-flash',
    model: 'qwen3.8-flash',
    name: 'Qwen3.8 Flash',
    cap: 'text',
    form: 'openai-chat',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    price: { unit: 'per_1k_tokens', value: 0.0008 },
    priceNote: '输入 0.8 元/百万 token（=0.0008 元/千）、输出 2.7 元/百万（=0.0027 元/千）；缓存命中输入 0.1 元/百万。'
      + '北京有 100 万 token 免费额度（90 天）',
    input: 'text + image / video（原生多模态）',
    output: 'OpenAI 格式 chat.completion',
    limits: { contextTokens: 1000000, maxOutput: 131072 },
    docs: 'https://help.aliyun.com/zh/model-studio/qwen3-8-flash',
    asOf: '2026-11-22',
    params: {
      prompt: { desc: '要问什么' },
      messages: { desc: '可选 —— 完整 messages 数组，最后一条必须是 user' },
      temperature: { desc: '随机性' },
      max_tokens: { desc: '输出长度上限' },
    },
    pitfalls: [
      '便宜的那条 —— 一般问答先试它，不够再上 max。',
      '同一把 key 地域绑定，跨地域调会 401。',
      '它同时兼容 Anthropic 协议（官方写明能接 Claude Code），别以为只有 OpenAI 一种接法。',
    ],
    unverified: ['Anthropic 兼容协议的具体端点路径'],
  },
  {
    vendor: 'dashscope',
    recordId: 'dashscope-qwen-plus',
    model: 'qwen-plus',
    name: 'Qwen Plus',
    cap: 'text',
    form: 'openai-chat',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    price: { unit: 'per_1k_tokens', value: 0.0008 },
    priceNote: '输入 ≤128k 档：输入 0.8 元/百万（=0.0008 元/千）、输出 2 元/百万（=0.002 元/千）；'
      + '128k<输入≤256k 档 2.4/20；256k<输入≤1M 档 4.8/48（全档按命中档统一结算）',
    input: 'text',
    output: 'OpenAI 格式 chat.completion',
    limits: { contextTokens: 1000000, maxOutput: 32768 },
    docs: 'https://help.aliyun.com/zh/model-studio/qwen-plus',
    asOf: '2026-11-22',
    params: {
      prompt: { desc: '要问什么' },
      messages: { desc: '可选 —— 完整 messages 数组' },
      temperature: { desc: '随机性' },
      max_tokens: { desc: '输出长度上限' },
    },
    pitfalls: [
      '**阶梯计费按「单次请求输入 token 总量」定档，整单按那一档结算** —— 一次塞 300k 输入会把整单拉进最贵档。',
      '最大输出只有 32768（思考模式也是），思维链上限 81920 —— 要长输出选 max 系列。',
      '北京静态限流 30000 RPM / 5M TPM，但快照 qwen-plus-2025-12-01 只有 120 RPM / 1M TPM —— 换 ID 时容易踩。',
    ],
    unverified: ['qwen-plus-latest 与 qwen-plus 的差异是否只在版本滚动'],
  },

  // ── MiniMax 文本 ────────────────────────────────────────
  {
    vendor: 'minimax',
    recordId: 'minimax-text-m3',
    model: 'MiniMax-M3.1-Flash',
    name: 'MiniMax M3.1 Flash',
    cap: 'text',
    form: 'openai-chat',
    endpoint: 'https://api.minimax.cn/v1/chat/completions',
    price: { unit: 'per_1k_tokens', value: 0.001 },
    priceNote: '输入 1.00 元/百万 token（=0.001 元/千）、输出 4.00 元/百万（=0.004 元/千）、缓存读取 0.10 元/百万。'
      + 'MiniMax-M3：≤512k 输入 2.10 入 / 8.40 出；>512k 4.20 / 16.80',
    input: 'messages（text / image_url / video_url 内容块；**不支持音频输入**）',
    output: 'OpenAI Chat Completions；思考内容在 choices[0].message.reasoning_content',
    limits: { contextTokens: 1000000 },
    docs: 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
    asOf: '2026-11-22',
    params: {
      prompt: { desc: '要问什么' },
      messages: { desc: '可选 —— 标准 OpenAI 结构，支持多模态内容块' },
      max_tokens: { desc: '生成长度上限（新接入建议用 max_completion_tokens）' },
    },
    pitfalls: [
      'temperature 与 top_p 传了**不生效**（固定 1 与 0.95）—— 别以为调了。',
      '思考 token 计入输出上限：设太小会 finish_reason=length 且 content 为空，看起来像模型没回答。',
      '多轮 function call 必须把带 tool_calls 与 reasoning_content 的完整 message 回填历史，否则上下文断片。',
      'n 只支持 1；presence/frequency_penalty、logit_bias 被忽略。',
    ],
    unverified: ['最大输出 token 的具体数值（文档只说用 max_tokens 限制）'],
  },

  // ── DeepSeek 官方 ───────────────────────────────────────
  // 价格是**美元 / 百万 token**，而且分高峰/低谷（低谷是高峰的一半）。
  // 单位换算成「元/千」时要乘币种，所以这里单独标 currency。
  {
    vendor: 'deepseek',
    recordId: 'deepseek-flash',
    model: 'deepseek-flash',
    name: 'DeepSeek V4.1 Flash',
    cap: 'text',
    form: 'openai-chat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    price: { unit: 'per_1k_tokens', value: 0.0003, currency: 'USD' },
    priceNote: '美元/百万 token（高峰价，低谷是它的一半）：输入 cache miss $0.30、cache hit $0.006、输出 $1.20。'
      + '高峰时段为 UTC 周一至周五 01:00-04:00 与 06:00-10:00（中国节假日除外），其余全是低谷',
    input: 'text + image（这一档支持视觉；V4 Pro 不支持）',
    output: 'OpenAI 格式 chat.completion；也支持 Anthropic 格式（/anthropic）',
    limits: { contextTokens: 1000000, maxOutput: 393216 },
    docs: 'https://api-docs.deepseek.com/quick_start/pricing',
    asOf: '2026-11-22',
    params: {
      prompt: { desc: '要问什么' },
      messages: { desc: '可选 —— 完整 messages 数组' },
      max_tokens: { desc: '输出上限，模型最大 384K' },
    },
    pitfalls: [
      '**模型名写 `deepseek-flash`**。旧名 deepseek-v4-flash / deepseek-v4-flash-vision-exp 还认，但对应模型已退役，实际由 V4.1-Flash 承接并按 Flash 价计费。',
      '上下文 1M、最大输出 384K —— 别拿 1M 当输出上限用。',
      '默认是思考模式，非思考模式要显式关。',
      '高峰/低谷价差一倍，批量活挑低谷跑（UTC 时段，换算北京时间会错开）。',
    ],
    unverified: ['思考模式的开关字段名（定价页没写，要查 thinking mode 那篇）'],
  },
  {
    vendor: 'deepseek',
    recordId: 'deepseek-v4-pro',
    model: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    cap: 'text',
    form: 'openai-chat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    price: { unit: 'per_1k_tokens', value: 0.00132, currency: 'USD' },
    priceNote: '美元/百万 token（高峰价）：输入 cache miss $1.32、cache hit $0.044、输出 $3.96；低谷减半',
    input: 'text（**不支持视觉** —— 要读图用 flash 那档）',
    output: 'OpenAI 格式 chat.completion；也支持 Anthropic 格式',
    limits: { contextTokens: 1000000, maxOutput: 393216 },
    docs: 'https://api-docs.deepseek.com/quick_start/pricing',
    asOf: '2026-11-22',
    params: {
      prompt: { desc: '要问什么' },
      messages: { desc: '可选 —— 完整 messages 数组' },
      max_tokens: { desc: '输出上限，模型最大 384K' },
    },
    pitfalls: [
      '并发上限比 flash 低一档（500 vs 2500）—— 批量并发会先撞它。',
      '**不支持图像输入**，图文混着的活交给 flash。',
    ],
    unverified: ['思考模式的开关字段名'],
  },
];
