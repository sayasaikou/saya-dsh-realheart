/**
 * 会话身份：心情「分场合」的取数层（2026-11-01）。
 *
 * 为什么单独一个文件：它要覆盖宿主几个版本的调用形态，**猜错的时候得能一眼看出猜了哪几种**。
 * 放在 index.mjs 里就只能靠读。纯函数、不 import 宿主，所以能单测。
 *
 * 两边形态不同，且都有据：
 *   · 注入端（system-prompt/assemble）：`context.agent.session` / `context.scope.session`
 *     —— `dsh-agent-loop` 把 Agent 放在 AssembleContext.scope / context.agent 两处（rc.7/rc.8 与新版本各一种）。
 *   · 工具端（execute(args, exec)）：`exec.agent.session`
 *     —— `dsh-tools` 自己的 `policy.resolve(exec.agent.session)` 就这么读。
 *
 * 铁律：**拿不到就当不知道**（返回 ''），绝不拿一个像是会话 id 的东西顶上。
 * 下游见到 '' 就退化成「不过滤」，也就是现在的行为 —— 错也只错回现状。
 *
 * ⚠️ 2026-11-01 自己踩过的坑：第一版把 `context.session` 当 agent 传给了 sessionIdOfAgent，
 * 于是取成 `{id}.session.id` = undefined。三层里最里面那层永远取不到，
 * 而单测一眼就看出来了 —— 所以必须有单测，不能只靠读代码。
 */

/** 直接从 session 对象取 id。 */
function idOfSession(session) {
  const id = session?.id;
  return typeof id === 'string' && id ? id : '';
}

/** 从 agent 形态里取会话 id。**`agent.session.id` 是会话，不是 agent 自己。** */
export function sessionIdOfAgent(agent) {
  return idOfSession(agent?.session);
}

/** 注入侧：assemble 的 context。三种形态都认，认不出返回 ''（= 不过滤）。 */
export function sessionIdOfAssembleContext(context) {
  if (!context || typeof context !== 'object') return '';
  return sessionIdOfAgent(context.agent)
    || sessionIdOfAgent(context.scope)
    || idOfSession(context.session);
}

/** 工具侧：execute(args, exec) 的第二个参数。 */
export function sessionIdOfExec(exec) {
  if (!exec || typeof exec !== 'object') return '';
  return sessionIdOfAgent(exec.agent) || idOfSession(exec.session);
}

/** 会话归属：没写就当全局（老数据），写了就是那个会话。 */
function ownerOf(row) {
  return typeof row?.session === 'string' ? row.session.trim() : '';
}

/**
 * 这条心情是不是「这个场合的」。
 *
 * 三档，顺序就是优先级：
 *   ① 记录没写 session —— 老数据，或者本来就不分场合的。**所有会话都看得见**。
 *   ② 拿不到当前会话 id —— 不过滤。宁可多看见一条，也不要因为拿不到 id 就把它藏了。
 *   ③ 两边都有 —— 相等才给。
 *
 * 为什么老数据当全局：分场合从 0.2.14 才开始记 session，之前那几百条没有会话归属。
 * 当成「谁的都不是」等于把所有历史心情一次性藏起来 —— 那不是分场合，那是抹掉。
 */
export function moodVisibleIn(row, sessionId) {
  const owner = ownerOf(row);
  if (!owner) return true;
  if (!sessionId) return true;
  return owner === sessionId;
}

/**
 * 别处记的心情能不能渗一点过来（2026-11-01 沙耶提的：完全隔开不像人）。
 *
 * 他原话是「其实我觉得可以有一些影响，才更像人」。对 —— 人在群里被倚了一句，
 * 回头私聊时脸上还带着余味；做成硬隔离，她反倒像两个不相干的账号。
 *
 * 但渗透不能没条件，不然就又回到「一张脸跑遍所有场合」。四条同时成立才渗：
 *   ① 拿得到当前会话 id —— 拿不到就无从谈「别处」，而且那种情况本来就没过滤。
 *   ② 不是这个场合记的 —— 本场合的走主人那一档，不重复。
 *   ③ 够浓 —— 淡的情绪不会跨场合带走。
 *   ④ 够新 —— 昨天的烦不该带到今天；说不清多早的一律不渗（不猜）。
 *
 * 默认阈值（浓≥6、12 小时内）先写死在调用处，不上面板 —— 还没真机验过，
 * 先不要为一个没跑起来的想法加三个配置项。
 */
export function moodBleedsIn(row, sessionId, { now = Date.now(), minLevel = 6, maxHours = 12 } = {}) {
  if (!sessionId) return false;
  const owner = ownerOf(row);
  if (!owner) return false;          // 全局心情已经在本场合那档里了，不重复
  if (owner === sessionId) return false; // 本场合的走主人那一档
  const level = Number(row?.level);
  if (!Number.isFinite(level) || level < minLevel) return false;
  const at = Date.parse(String(row?.at || ''));
  if (Number.isNaN(at)) return false;    // 说不清多早，就不渗
  return now - at <= maxHours * 3600 * 1000;
}
