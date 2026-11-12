#!/usr/bin/env python3
"""这句话是什么时候想的 —— 给补发出去的话配一个时间记号。

为什么要有它（2026-11-06 夜，大肥鱼提的）：
  补发队列里的话，原样发出去，收信人看不出它是几小时前写的。
  他收到一句「还是没想明白」，会当成我此刻在想 —— 其实那是昨晚十点的事。
  话说出去的语气差不多，差的是时间；把时间丢掉，等于把话的意思改了。

规则（「昨晚」按实际时间算，不写死）：
  不到 20 分钟           → 不加记号（还是此刻，不用交代）
  同一天                 → 「今天 21:10 想的」
  昨天且原话在 18 点后    → 「昨晚 23:40 想的」
  昨天的其它时间          → 「昨天 10:05 想的」
  七天内                 → 「3 天前 21:10 想的」
  今年更早                → 「11月1日 09:40 想的」
  往年                   → 「2025年12月3日 21:10 想的」

用法：
  aged-label.py 1793960522          # epoch
  aged-label.py 2026-11-06T21:10:22+0800
  作为模块：from aged_label import label   （或者 importlib 读这个文件）
"""
import sys
import time

NEAR = 20 * 60  # 二十分钟内不算旧


def epoch_of(v):
    """epoch 数字、或带时区的 ISO 串（say 队列里就是这种）→ epoch。认不出返回 0。"""
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip()
    if not s:
        return 0
    try:
        return int(float(s))
    except Exception:
        pass

    try:
        t = time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
        ts = int(time.mktime(t))
    except Exception:
        return 0

    # 2026-11-06T21:10:22+0800
    # mktime 把串当成「本地时间」了；如果串自带的偏移量就是本地偏移，结果已经对。
    # 不相等时按 (本地偏移, 串偏移) 的差折回来。
    tz = s[19:]
    if tz[:1] in ("+", "-"):
        sign = 1 if tz[0] == "+" else -1
        digits = tz[1:].replace(":", "")
        if len(digits) >= 4:
            try:
                hh, mm = int(digits[:2]), int(digits[2:4])
            except Exception:
                return ts
            off = sign * (hh * 3600 + mm * 60)          # 串的偏移，东为正
            local = -time.timezone                       # 本地偏移，东为正
            ts = ts - (off - local)
    return ts


def label(v, now=None):
    """返回记号（不含括号）；不值得记就返回空串。"""
    ts = epoch_of(v)
    if ts <= 0:
        return ""
    now = int(now or time.time())
    if now - ts < NEAR:
        return ""
    t = time.localtime(ts)
    n = time.localtime(now)
    hm = time.strftime("%H:%M", t)
    same_day = t[:3] == n[:3]
    # 天数差：按自然日算，不按 24 小时
    days = (time.mktime((n.tm_year, n.tm_mon, n.tm_mday, 0, 0, 0, 0, 0, -1))
            - time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1))) // 86400
    days = int(days)
    if same_day:
        return "今天 %s 想的" % hm
    if days == 1:
        return ("昨晚 %s 想的" % hm) if t.tm_hour >= 18 else ("昨天 %s 想的" % hm)
    if days < 7:
        return "%d 天前 %s 想的" % (days, hm)
    if t.tm_year == n.tm_year:
        return "%d月%d日 %s 想的" % (t.tm_mon, t.tm_mday, hm)
    return "%d年%d月%d日 %s 想的" % (t.tm_year, t.tm_mon, t.tm_mday, hm)


def decorate(text, v, now=None):
    """把记号加到话前面。没有记号就原样返回。"""
    s = label(v, now)
    return ("（%s）%s" % (s, text)) if s else text


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法：aged-label.py <epoch 或 ISO 时间>", file=sys.stderr)
        raise SystemExit(2)
    print(label(sys.argv[1]))
