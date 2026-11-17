/**
 * 型号目录：知道「这个厂商的这个型号该怎么调」的内置知识。
 *
 * 为什么要有这一层：
 *   在此之前，一条能力记录要人手写完 id / endpoint / model / defaults / notes。
 *   新用户手上只有一把 key —— 他不知道该填什么端点、参数叫什么、尺寸档位怎么选，
 *   甚至不知道自己那家厂商支持什么。于是「外部能力」这个功能等于只有作者会用。
 *
 * 这一层的职责：**选型号就带出整套规范**。
 *   厂商 → 型号 → { 调用形态、端点、参数表（含必填/枚举/默认值）、提示词怎么写、踩过的坑 }
 *   `rh_capabilities action=setup` 拿这份规范直接生成一条可用的记录，用户只需要 key。
 *
 * 收录原则（重要）：
 *   - **只收我们能对得上文档、且（火山那几条）亲手跑通过的型号。**
 *   - 不确定的一律不写。宁可少一条，也不要让 agent 照着一份编出来的规范去调 —— 那比起没有更糟。
 *   - 用户自己加的型号另存（capabilities.json），不跟这里混。
 */

/** 参数说明的统一写法：{ required, desc, values?, example? } */
const P = (desc, extra = {}) => ({ desc, ...extra });

export const CATALOG = [
  {
    vendor: 'volcengine',
    vendorName: '火山方舟（豆包）',
    keyEnv: 'ARK_API_KEY',
    keyNote: '在火山控制台 → API Key 管理里建，格式是一串 uuid。',
    doc: 'https://www.volcengine.com/docs/82379',
    models: [
      {
        model: 'doubao-seedream-5-0-flash-260915',
        name: '豆包生图 flash',
        cap: 'image',
        form: 'sync-generate',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
        defaults: { size: '1024x1024', response_format: 'url' },
        price: { unit: 'per_image', value: 0.12 },
        params: {
          prompt: P('必填 —— 画什么：主体 + 场景 + 风格 + 光线。中文可以，但别要求画面里出现清晰文字（会糊）', { required: true }),
          size: P('可选 —— 尺寸，默认 1024x1024', { values: ['1024x1024', '2048x1312', '1312x2048'] }),
          image: P('可选 —— 参考图（http 地址 或 data:image/png;base64,…）。给了就是图生图，尺寸和构图跟着参考图走'),
        },
        promptGuide: [
          '写「画面里有什么、在做什么、什么光、什么质感」，一段话，不用罗列关键词。',
          '要人物背对镜头就明写「从正后方看、脸被头发挡住、手臂垂在身侧」——不写它会画成正面。',
          '要画面里有字会糊，用「看不清的手写便签」这类说法代替。',
        ],
        pitfalls: [
          '尺寸只有两档真生效：1024x1024 和 2048x1312（3:2）。**写 1536x1024 会被静默忽略、照样出方图**，不报错。',
          '报 SetLimitExceeded 不是参数错，是账号的「安全体验模式」有用量上限，要去控制台放开。',
        ],
      },
      {
        model: 'doubao-seedream-5-5-261028',
        name: '豆包生图 pro',
        cap: 'image',
        form: 'sync-generate',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
        defaults: { size: '1024x1024', response_format: 'url' },
        price: { unit: 'per_image', value: 0.25 },
        params: {
          prompt: P('必填 —— 画什么', { required: true }),
          size: P('可选 —— 默认 1024x1024', { values: ['1024x1024', '2048x1312', '1312x2048'] }),
          image: P('可选 —— 参考图，给了就是图生图'),
        },
        promptGuide: ['同 flash，但这条细节更好、也更吃提示词：把材质和光线写具体，收益比 flash 明显。'],
        pitfalls: ['贵一倍 —— 只有 flash 出不来才换这条。', '同样受「安全体验模式」用量上限影响。'],
      },
      {
        model: 'doubao-seed-2-1-pro-260915',
        name: '豆包识图',
        cap: 'vision',
        form: 'openai-chat',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        defaults: { max_tokens: 400 },
        params: {
          prompt: P('要问什么 —— 「描述这张图」「读出上面的文字」「这个人手里拿的是什么」'),
          image_url: P('识图必须给图：http 地址 或 data:image/png;base64,…', { required: true }),
          max_tokens: P('可选 —— 回答长度上限，默认 400'),
          messages: P('可选 —— 自己拼完整 messages 数组（要多轮追问时用）'),
        },
        promptGuide: ['问得越具体答案越有用：「这张图里有几个人」比「描述一下」好。', '要 OCR 就直说「逐字读出图里的文字」。'],
        pitfalls: ['是带思考的模型，实测 20~30 秒一张 —— 等不起的时候别用。'],
      },
      {
        model: 'doubao-seedance-2-5-260628',
        name: '豆包生视频',
        cap: 'video',
        form: 'async-task',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
        defaults: {},
        submitBody: { content: [{ type: 'text', text: '{{prompt}}' }] },
        resultPath: 'content.video_url',
        pollEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{{id}}',
        price: { unit: 'per_second', value: 1.51 },
        params: {
          prompt: P('必填 —— 拍什么：主机位 + 主体动作 + 场景 + 光线。镜头语言写在最前面', { required: true }),
          ratio: P('可选 —— 画面比例', { values: ['16:9', '9:16', '1:1'] }),
          duration: P('可选 —— 时长（秒）'),
          image_url: P('可选 —— 首帧图，给了就是图生视频（比纯文字稳）'),
        },
        promptGuide: [
          '第一句写机位：「固定机位，中景」「手持跟拍，从背后」。',
          '然后写动作，写清「一开始…然后…最后…」，模型才知道片内怎么走。',
          '一次只写一个连续动作 —— 写三个不同场景它只会做出前一个。',
        ],
        pitfalls: [
          '异步：第一次提交拿任务号，没出结果就带 taskId 再调一次（不会重复计费）。',
          '报 SetLimitExceeded 是账号用量上限，不是参数错。',
        ],
      },
    ],
  },
  {
    vendor: 'openai',
    vendorName: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    keyNote: 'platform.openai.com → API keys，格式 sk-…。',
    doc: 'https://platform.openai.com/docs/api-reference/images',
    models: [
      {
        model: 'gpt-image-1',
        name: 'GPT Image',
        cap: 'image',
        form: 'sync-generate',
        endpoint: 'https://api.openai.com/v1/images/generations',
        defaults: { size: '1024x1024' },
        resultPath: 'data.0.b64_json',
        resultB64Path: 'data.0.b64_json',
        params: {
          prompt: P('必填 —— 画什么', { required: true }),
          size: P('可选 —— 默认 1024x1024', { values: ['1024x1024', '1536x1024', '1024x1536', 'auto'] }),
          quality: P('可选 —— low / medium / high，默认 auto'),
          n: P('可选 —— 出几张，默认 1'),
        },
        promptGuide: ['这条吃自然语言长描述，把场景、光线、材质、机位写清楚，比堆关键词好。'],
        pitfalls: [
          '**返回的是 b64_json 不是 url** —— 如果拿不到结果，先看 resultPath 是不是配成了 data.0.url。',
          '这条的尺寸档位和豆包完全不同（1536x1024 在这是合法的、在豆包会被忽略）—— 换厂商一定要重看参数表。',
        ],
      },
      {
        model: 'dall-e-3',
        name: 'DALL·E 3',
        cap: 'image',
        form: 'sync-generate',
        endpoint: 'https://api.openai.com/v1/images/generations',
        defaults: { size: '1024x1024', response_format: 'url', n: 1 },
        params: {
          prompt: P('必填 —— 画什么', { required: true }),
          size: P('可选 —— 只有三档', { values: ['1024x1024', '1792x1024', '1024x1792'] }),
          quality: P('可选 —— standard / hd'),
          style: P('可选 —— vivid / natural'),
        },
        promptGuide: ['这条会自己改写你的提示词，所以写意图就行，不用抠细节。'],
        pitfalls: ['n 只能是 1（一次一张）。', '尺寸只有三档，写别的会直接报错（这条不静默忽略，是好事）。'],
      },
    ],
  },
];

/** 把所有型号摊平，方便按 id 找 */
export function flattenCatalog() {
  const out = [];
  for (const v of CATALOG) {
    for (const m of v.models) {
      out.push({
        ...m,
        vendor: v.vendor,
        vendorName: v.vendorName,
        keyEnv: v.keyEnv,
        keyNote: v.keyNote,
        doc: v.doc,
        catalogId: v.vendor + '/' + m.model,
      });
    }
  }
  return out;
}

/** 按 catalogId（vendor/model）或光秃秃的 model 找一条 */
export function findCatalogModel(needle) {
  const n = String(needle || '').trim();
  if (!n) return null;
  const all = flattenCatalog();
  return all.find((x) => x.catalogId === n)
    || all.find((x) => x.model === n)
    || all.find((x) => x.model.toLowerCase() === n.toLowerCase())
    || null;
}

/**
 * 把目录条目 + 用户给的 key 变成一条可直接用的能力记录。
 * notes 按三段式拼好（怎么传 / 怎么写提示词 / 踩过的坑）—— agent 拿到就能调。
 */
export function buildRecordFromCatalog(entry, { id, keyRef, extra = {} } = {}) {
  if (!entry) throw new Error('没有这个型号');
  const hint = [];
  const req = Object.entries(entry.params || {}).filter(([, v]) => v && v.required).map(([k]) => k);
  hint.push('【怎么传】params 里必填：' + (req.join(' / ') || '（无）')
    + '；可选：' + (Object.keys(entry.params || {}).filter((k) => !req.includes(k)).join(' / ') || '（无）') + '。');
  if (entry.params?.size?.values) hint.push('【尺寸】只有这几档真生效：' + entry.params.size.values.join(' / ') + '。');
  if (entry.promptGuide?.length) hint.push('【怎么写提示词】' + entry.promptGuide.join(' '));
  if (entry.pitfalls?.length) hint.push('【踩过的坑】' + entry.pitfalls.join(' '));

  const rec = {
    id: id || (entry.vendor + '-' + entry.model.replace(/[^a-z0-9]+/gi, '-').toLowerCase()),
    name: entry.name || entry.model,
    cap: entry.cap,
    form: entry.form,
    model: entry.model,
    endpoint: entry.endpoint,
    auth: { type: 'bearer', keyRef: keyRef || ('env:' + entry.keyEnv) },
    defaults: entry.defaults || {},
    notes: hint.join('\n'),
    source: { vendor: entry.vendor, model: entry.model, catalog: entry.catalogId, doc: entry.doc },
  };
  for (const k of ['submitBody', 'resultPath', 'resultB64Path', 'pollEndpoint', 'price', 'free', 'bodyExtra', 'taskIdPath', 'statePath']) {
    if (entry[k] !== undefined) rec[k] = entry[k];
  }
  return { ...rec, ...extra };
}
