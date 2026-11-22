/**
 * 厂商表：一个厂商的公共信息只写一次（凭据怎么来、文档在哪、默认头怎么带）。
 *
 * 为什么独立出来：型号会一直加，但「这条 key 放哪个环境变量」是厂商级的，
 * 每个型号重写一遍就一定会写歪 —— 2026-11-22 之前 catalog.mjs 里
 * 每个 vendor 块都重复了一遍 keyEnv/keyNote，加第三个厂商时已经开始不一致。
 *
 * auth 字段说明（写进能力记录时用）：
 *   bearer         authorization: Bearer <key>          —— 绝大多数厂商
 *   header         <headerName>: <key>                  —— Google 的 x-goog-api-key 这类
 *   kling-jwt      JWT（HS256），用 access key + secret 现签 —— 可灵
 *   query          ?key=<key>                           —— 少数老接口
 */
export const VENDORS = {
  volcengine: {
    vendor: 'volcengine',
    vendorName: '火山方舟（豆包）',
    keyEnv: 'ARK_API_KEY',
    keyNote: '火山控制台 → API Key 管理，一串 uuid。',
    doc: 'https://www.volcengine.com/docs/82379',
    auth: { type: 'bearer' },
  },
  dashscope: {
    vendor: 'dashscope',
    vendorName: '阿里云百炼（通义）',
    keyEnv: 'DASHSCOPE_API_KEY',
    keyNote: '百炼控制台 → API-KEY 管理，形如 sk-…。（注意与阿里云 AK/SK 不是一回事）',
    doc: 'https://help.aliyun.com/zh/model-studio/',
    auth: { type: 'bearer' },
  },
  minimax: {
    vendor: 'minimax',
    vendorName: 'MiniMax',
    keyEnv: 'MINIMAX_API_KEY',
    keyNote: 'MiniMax 开放平台 → 接口密钥。'
      + '⚠️ 国内 API 域名是 api.minimax.cn（不是 platform.minimaxi.com —— 那是文档站），国际站是 api.minimax.io，两边账号和 key 不通用。',
    doc: 'https://platform.minimaxi.com/docs/llms.txt',
    auth: { type: 'bearer' },
  },
  kling: {
    vendor: 'kling',
    vendorName: '可灵（快手）',
    keyEnv: 'KLING_API_KEY',
    keySecretEnv: 'KLING_SECRET_KEY',
    keyNote: '可灵开放平台 → API Key（新方案，所有模型都支持）。'
      + 'AK/SK 签 JWT 是旧版接口专用，要用就把 secret 放 KLING_SECRET_KEY。'
      + '国内域名 api-beijing.klingai.com，海外 api-singapore.klingai.com。',
    doc: 'https://kling.ai/document-api/llms.txt',
    auth: { type: 'bearer' },
  },
  openai: {
    vendor: 'openai',
    vendorName: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    keyNote: 'platform.openai.com → API keys，形如 sk-…。国内访问需要能连上的网络。',
    doc: 'https://platform.openai.com/docs/api-reference',
    auth: { type: 'bearer' },
  },
  google: {
    vendor: 'google',
    vendorName: 'Google（Gemini API）',
    keyEnv: 'GEMINI_API_KEY',
    keyNote: 'aistudio.google.com → Get API key。请求头写 x-goog-api-key，不是 Bearer。',
    doc: 'https://ai.google.dev/gemini-api/docs',
    auth: { type: 'header', headerName: 'x-goog-api-key' },
  },
  bfl: {
    vendor: 'bfl',
    vendorName: 'Black Forest Labs（FLUX）',
    keyEnv: 'BFL_API_KEY',
    keyNote: 'bfl.ai 控制台 → API Keys。',
    doc: 'https://docs.bfl.ai/',
    auth: { type: 'header', headerName: 'x-key' },
  },
  stability: {
    vendor: 'stability',
    vendorName: 'Stability AI',
    keyEnv: 'STABILITY_API_KEY',
    keyNote: 'platform.stability.ai → API Keys，形如 sk-…。',
    doc: 'https://platform.stability.ai/docs/api-reference',
    auth: { type: 'bearer' },
  },
  deepseek: {
    vendor: 'deepseek',
    vendorName: 'DeepSeek',
    keyEnv: 'DEEPSEEK_API_KEY',
    keyNote: 'platform.deepseek.com → API keys，形如 sk-…。余额与 key 是分开的，欠费会直接 402。',
    doc: 'https://api-docs.deepseek.com/',
    auth: { type: 'bearer' },
  },
};
