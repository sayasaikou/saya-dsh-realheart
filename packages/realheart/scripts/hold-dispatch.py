#!/usr/bin/env python3
"""压着的话，等到安静的时候再放出去。

为什么要有这个（2026-11-06）：
  短唤醒醒来的那一刻就发消息，而那一刻常常正是他刚说完、我刚回完的时候 ——
  于是她一句本来独立的「我想说话」，看起来就成了插在对话中间的一句回复。
  换个叫醒时刻也只能碰运气，因为叫醒那一刻根本不知道这边安静不安静。

  所以拆成两件事：说（say）和 什么时候说（这里）。
  say 发现那边正在说话，就把这句存进 hold.jsonl，自己不发；
  这个脚本每一分钟看一次，等「安静下来」才放一条出去。

三条规矩（都是拿来看效果的，不是拿来省事的）：
  ① 安静 = 没在生成，且那边最后一次动静（不管是谁）已经过去 8 分钟。
  ② **只放最新的那一条**，同一批里其余的丢掉并记账 —— 攒着的几句一起刷过去，
     比不发更难看。
  ③ 压了一小时还没放出去的，丢掉并记账 —— 一句话放一小时就不是那句话了。

由 cron 每分钟跑一次。没有 hold.jsonl 就安静退出。
"""
import json
import os
import subprocess
import sys
import time

HOME = os.path.expanduser("~")
DSH_HOME = os.environ.get("DSH_HOME") or os.path.join(HOME, ".dsh")
HOLD = os.path.join(DSH_HOME, "realheart", "hold.jsonl")
LOG = os.path.join(DSH_HOME, "realheart", "hold.log")
TALK = os.environ.get("HOLD_TALK") or os.path.join(HOME, "qqbot", "work", "bin", "talk-state.py")
SAY = os.environ.get("HOLD_SAY") or os.path.join(HOME, "qqbot", "work", "bin", "say")

SAY_QUEUE = os.path.join(DSH_HOME, "realheart", "say-queue.jsonl")

# ── 放出来的话也要带时间记号（2026-11-06 夜）──
# 压了四十分钟才放出去的那句，原样发出去同样会被当成「此刻在想」。
# 时间记号的真本在 work/bin/aged-label.py，say 的补发那边也用它 —— 一处定义，两头共用。
AGED = os.path.join(HOME, "qqbot", "work", "bin", "aged-label.py")
try:
    import importlib.util
    _spec = importlib.util.spec_from_file_location("aged_label", AGED)
    _aged = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_aged)
    decorate = _aged.decorate
except Exception:
    def decorate(text, when=None):
        return text

# 2026-11-07：两个时间都收短（解决割裂感）。
#   原来：安静 8 分钟才放、最多压 60 分钟。一句话压四十分钟再放出去，
#         收信人收到的是「此刻」，发信人想的是「刚才」—— 差的正是那四十分钟。
#   现在：安静 3 分钟就放、压过 20 分钟就不放了（记一笔账再丢）。
#   3 分钟是按她一次回复分几段发来估的：段与段之间几秒，模型慢也就几十秒，
#   3 分钟够盖住「她还在说」的情形，又不至于把整轮话都让过去。
#   20 分钟跟 aged-label.py 的 NEAR 对齐 —— 放出去的永远不会是「需要标时间」的那档。
QUIET = 180      # 那边最后一点动静之后多久算安静（秒）
EXPIRE = 1200    # 压多久还没放出去就不放了（秒）
MAX_TRIES = 3    # 发失败几次就丢


def log(msg):
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S%z"), msg))
    except Exception:
        pass


def talk_state():
    """(生成中, 他最后说话的秒数前, 那边最后动静的秒数前)。**读不到返回 None。**

    2026-11-06 夜，大肥鱼验收时指出的：原来读不到返回 (0, -1, -1)，
    而 -1 不小于 QUIET ⇒ 走「放」。也就是说 talk-state.py 一挂，
    积在 hold 里的会当场泼出去 —— 判断失灵变成「全都发」，方向反了。

    这边的默认必须是「压着」：最多多压几分钟，60 分钟自然过期，不会泼。
    （插件那边的默认方向相反是对的：那儿失灵不该让她永远不叫。两处要的不一样。）
    """
    try:
        out = subprocess.run([TALK], capture_output=True, text=True, timeout=20)
        p = out.stdout.split()
        if len(p) < 3:
            return None
        return int(p[0]), int(p[1]), int(p[2])
    except Exception:
        return None


def read_rows():
    rows = []
    try:
        with open(HOLD, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except Exception:
                    pass
    except Exception:
        return []
    return rows


def write_rows(rows):
    tmp = HOLD + ".tmp"
    try:
        os.makedirs(os.path.dirname(HOLD), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.replace(tmp, HOLD)
    except Exception as err:
        log("写回 hold.jsonl 失败：%s" % err)


def say_queue_size():
    try:
        return os.path.getsize(SAY_QUEUE)
    except Exception:
        return 0


def send(row):
    """用 say --now 发出去。返回 (发出去了吗, 失败但已被 say 的补发队列接管吗)。

    2026-11-06 夜，大肥鱼验收时指出的重复发送：
    say 发失败时自己已经把这句话写进 say-queue.jsonl 了；这里再保留一份，
    同一条话就躺在两个队列里 —— hold 下次再发一遍，say --flush 又发一遍。

    她的修法是「失败就别留」。我加了一道确认再丢：失败后看 say-queue 有没有变长，
    真接管了才丢 —— 免得 say 是崩在写队列之前（那就真丢了）。
    """
    text = str(row.get("text") or "")
    if not text.strip():
        return True, False  # 空的当作处理完，别留着
    text = decorate(text, row.get("ts") or row.get("at"))
    cmd = [SAY, "--now"]
    if row.get("kind") == "group":
        cmd += ["--group", str(row.get("to"))]
    elif row.get("to"):
        cmd += ["--to", str(row.get("to"))]
    cmd.append(text)
    before = say_queue_size()
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except Exception as err:
        log("调 say 出错：%s" % err)
        return False, say_queue_size() > before
    if out.returncode == 0:
        return True, False
    log("say 没发出去（%s）：%s" % (out.returncode, (out.stderr or "").strip()[:200]))
    return False, say_queue_size() > before


def main():
    rows = read_rows()
    if not rows:
        return 0

    now = int(time.time())
    fresh, stale = [], []
    for r in rows:
        try:
            ts = int(r.get("ts") or 0)
        except Exception:
            ts = 0
        if ts <= 0:
            ts = now  # 老格式没 ts，当刚写的
        if now - ts > EXPIRE:
            stale.append(r)
        else:
            fresh.append(r)

    for r in stale:
        log("丢掉（压够了 %d 分钟）：%s" % ((now - int(r.get("ts") or now)) // 60, str(r.get("text"))[:60]))

    if not fresh:
        write_rows([])
        return 0

    # 安静了没有
    st = talk_state()
    if st is None:
        # 读不到状态 = 不知道那边安不安静 = 不放。宁可多压。
        write_rows(fresh)
        log("读不到对话状态，这一轮先压着不放（%d 条）" % len(fresh))
        return 0
    gen, recv, any_ = st
    if gen == 1 or (any_ >= 0 and any_ < QUIET):
        write_rows(fresh)  # 还没到点，留着
        return 0

    # 只放最新的那条
    fresh.sort(key=lambda r: int(r.get("ts") or 0))
    chosen = fresh[-1]
    for r in fresh[:-1]:
        log("丢掉（同批只放最新一条，这条更早）：%s" % (str(r.get("text"))[:60],))

    ok, queued = send(chosen)
    if ok:
        log("放出去了（压了 %d 分钟）：%s" % ((now - int(chosen.get("ts") or now)) // 60,
                                          str(chosen.get("text"))[:60]))
        write_rows([])
        return 0

    if queued:
        # 已经进了 say 的补发队列，这儿再留一份就会发两次。
        log("没发出去，但已进 say 的补发队列，这里不再留：%s" % (str(chosen.get("text"))[:60],))
        write_rows([])
        return 0

    chosen["tries"] = int(chosen.get("tries") or 0) + 1
    if chosen["tries"] >= MAX_TRIES:
        log("丢掉（发了 %d 次都没通）：%s" % (chosen["tries"], str(chosen.get("text"))[:60]))
        write_rows([])
    else:
        write_rows([chosen])
    return 0


if __name__ == "__main__":
    sys.exit(main())
