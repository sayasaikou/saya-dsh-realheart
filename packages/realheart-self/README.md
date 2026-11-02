# realheart-self

给「我自己的东西」一个能装能卸的形状。

**这是模板，不是成品。** 别人家 agent 该照着它长自己那份 —— 不是照抄。

---

## 它现在有什么

| 工具 | 干什么 |
|---|---|
| `voice_say` | 说一句话，拿到一个能播的 mp3（调 minimax TTS） |
| `piece_save` | 把做出来的东西存成一件作品（文件 + 一句话说明） |

**只管「怎么出声」，不管「什么时候出声」。** 什么时候说话是它自己的判断，插件不给默认。

---

## 三条边界（原样留着，这是设计不是限制）

1. **不存 key。** key 在 env 文件里（默认 `~/.qqbot-keys/env`），插件只读环境变量。
   读不到就**报错**，不静默返回空 —— 装上了但悄悄不工作，是最难发现的那种坏。
2. **合成出来的文件是临时的。** 声音是通道，不是作品。一小时后清。
   想留下来的声音，用 `piece_save` 存成作品。
3. **不管什么时候说话。** 发不发、说不说，是它的判断。

---

## 让它变成「你自己的」

默认值是能跑的样子，但那些不是你的。至少改这三样：

### 一、声音

```js
voice: 'feiyu_g2',   // ← 换成你自己那个 voice_id
```

minimax 的音色列表在它自己的文档里。**换一个声音，就是换一个人** —— 这个别偷懒用默认的。

`emotion` / `speed` 也在这里。语速 0.95 是偏慢的；说话快的人该往上调。

### 二、key 从哪儿来

```js
envFile: join(HOME, '.qqbot-keys', 'env'),
```

那个文件里要有一行：

```
MINIMAX_API_KEY=sk-...
```

⚠️ **这个文件永远不要进仓库、不要贴进聊天。**

### 三、作品存哪儿

```js
piecesDir: join(HOME, 'qqbot', 'work', 'pieces'),
```

跟 `realheart` 的观测页读的是同一个目录 —— 换了自己记得两边一起改。

---

## 装

```bash
cd <profile>
node -e "const p=require('./package.json');p.dsh.profile.bundles.push('realheart-self');require('fs').writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n')"
ln -sfn <这个包的绝对路径> node_modules/realheart-self
```

然后**重启一次**。改 `bundles` 等于一次重启，不能随手改。

## 装的判据：四条都成立才算装上

1. `voice_say` 出现在工具目录里
2. 真跑一次：给一句中文，拿到一个**能播的 mp3**
3. 第二次跑，前一次的文件还在（临时目录不是用完立刻删，是一小时后清）
4. 环境里没有 `MINIMAX_API_KEY` 时，报错说清楚**缺什么**，不静默返回空

第 4 条是防「装上了但悄悄不工作」—— 那种最难发现。

## 卸

```bash
cd <profile>
node -e "const p=require('./package.json');p.dsh.profile.bundles=p.dsh.profile.bundles.filter(x=>x!=='realheart-self');require('fs').writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n')"
rm -f node_modules/realheart-self
```

## 卸的判据：不是「工具没了」，是这三条

1. `voice_say` 消失
2. **数据全在**：`pieces/`、作品文件一行不少
3. 没有残留

第三条的意思是：**卸完之后还能读到昨天做的东西，才算卸干净。** 不能，就是卸错了。

---

## 往里加自己的东西

这个包的门是开着的。要加别的能力，照这两条走：

1. **一个工具只做一件事。** `voice_say` 只出声，`piece_save` 只存东西。混在一起之后，
   agent 不知道该在什么时候调它 —— 那时候它就不再是工具，是一段没人用的代码。
2. **失败要说清缺什么。** 不说「失败了」，说「没有 MINIMAX_API_KEY，找过环境变量和 ~/.qqbot-keys/env」。
   报错写得含糊，等于让人对着红灯猜。

**最该往里加的，是「它自己会想用」的东西。**
一个工具如果非得有人提醒才会被调，那它迟早不会被调 —— 这条我们踩过很多次。
