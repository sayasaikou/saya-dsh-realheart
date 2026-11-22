/**
 * 音乐生成。cap 用 'music'。
 *
 * 与 tts 的区别不在技术，在选型：音乐是「给一段描述/歌词，拿回一首带编曲的歌」，
 * 时长、是否带人声、能否续写都不一样。这些差异只能写在 limits 和 notes 里。
 */

export const MUSIC_MODELS = [
  {
    vendor: 'minimax',
    recordId: 'minimax-music',
    model: 'music-3.0',
    name: 'MiniMax 音乐生成',
    cap: 'music',
    form: 'sync-generate',
    endpoint: 'https://api.minimax.cn/v1/music_generation',
    blocked: '这套模型 2026-08-20 已下线，不再对新用户开放（只留历史付费用户）—— 现在调不了；要本地生成得自己托管 MiniMax Music 3 的开源权重',
    bodyTemplate: {
      model: 'music-3.0',
      prompt: '{{prompt}}',
      lyrics: '{{lyrics}}',
      is_instrumental: false,
      audio_setting: { sample_rate: 44100, format: 'mp3' },
    },
    resultPath: 'data.audio',
    resultHexPath: 'data.audio',
    fileExt: 'mp3',
    price: { unit: 'per_song', value: 1.0 },
    priceNote: '1.0 元/首（Music-3.0 下线前的价目）',
    input: 'prompt（≤2000 字符：风格/情绪/场景）+ lyrics（≤3500 字符，\\n 分行，支持 [Verse] [Chorus] [Bridge] 结构标签）',
    output: 'data.audio —— 默认 hex，output_format=url 时给 24 小时链接',
    limits: { promptMax: 2000, lyricsMax: 3500 },
    docs: 'https://platform.minimaxi.com/docs/api-reference/music-generation',
    asOf: '2026-11-22',
    params: {
      prompt: { desc: '风格/情绪/场景描述，≤2000 字符；纯音乐时必填', required: false },
      lyrics: { desc: '歌词，≤3500 字符；非纯音乐必填', required: false },
    },
    pitfalls: [
      '★ **模型已下线**：不是参数问题，是这家不做了。真要生成音乐，现役可选的是别的家（见注册表里其它 music 条目）。',
      'data.status 是 1=合成中 / 2=已完成，不是任务状态机 —— 别当轮询字段用。',
      '歌词超长不静默截断，直接 2013 参数异常。',
    ],
    unverified: ['生成音频的时长上限（文档没给秒数）'],
  },
];
