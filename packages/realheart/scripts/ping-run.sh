#!/bin/bash
# 短唤醒 —— 每隔一段随机时间叫她醒一下，只做一件事：此刻有没有想说的。
#
# 为什么跟自由时间分开：
#   自由时间是做东西的，要连续两个小时，隔一会儿打断一次就什么都做不成。
#   而「想说话」该是随时能发生的 —— 人不是坐下来专门想说才说。
#
# 为什么用 cron 每 5 分钟跑、而不是按间隔设 cron：
#   间隔是可配的、还是随机的，cron 写死了就改不动。
#   这里每次只比一下「到时间没有」，所以改成 17–43 分钟也行，不用重装。
#
# 为什么 min=0 就直接退出：
#   默认是关的。这东西一天能跑二十来次，每次都是一次完整的模型调用 ——
#   开不开该由人决定，不该由安装器替他决定。
#
# 为什么夜里不跑（2026-11-02 沙耶提的）：
#   深夜发消息是打扰，不是分享。但只限制「叫醒」，不限制她自己想说的 ——
#   她在自由时间里想发的那条，什么时候都能发。

set -euo pipefail

# ── cron 里没有 systemd 那套环境，得自己补 ──
#
# 2026-11-02 实测踩到的：手动跑报 MISSING_CREDENTIAL: no API key。
# freetime 的 systemd unit 里有 EnvironmentFile=/home/ubuntu/.qqbot-keys/env，
# 而 cron 不读它 —— 同一个脚本在 systemd 里能跑、在 cron 里跑不了，
# 报错还只说「没 key」，看不出是环境不同。
ENV_FILE="${QQBOT_ENV_FILE:-$HOME/.qqbot-keys/env}"
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# 工作目录也要定：freetime unit 里写着「上一次没定，她用相对路径把产物写到了 /home/ubuntu/work/」。
# cron 的默认 cwd 正好是 $HOME —— 会踩同一个坑。
cd "$HOME/qqbot" 2>/dev/null || true

# cron 的 PATH 很窄，dsh 不一定在里头。写绝对路径，跟 freetime-run.sh 保持一致。
DSH_BIN="${DSH_BIN:-/usr/bin/dsh}"

BASE="${DSH_HOME:-$HOME/.dsh}/realheart"
CFG="$BASE/ping.json"
NEXT_FILE="$BASE/ping.next"
LAST_FILE="$BASE/ping.last"

# 配置没写出来 = 插件还没起过 / 这一版没有短唤醒。安静退出，不报错。
[ -f "$CFG" ] || exit 0

read_cfg() {
  python3 -c "
import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(d.get(sys.argv[2], ''))
except Exception:
    print('')
" "$CFG" "$1" 2>/dev/null
}

MIN="$(read_cfg minMinutes)"
MAX="$(read_cfg maxMinutes)"
FROM="$(read_cfg fromHour)"
TO="$(read_cfg toHour)"
case "$MIN" in ''|*[!0-9]*) MIN=0 ;; esac
[ "$MIN" -gt 0 ] 2>/dev/null || exit 0
case "$MAX" in ''|*[!0-9]*) MAX=$MIN ;; esac
[ "$MAX" -ge "$MIN" ] 2>/dev/null || MAX=$MIN
case "$FROM" in ''|*[!0-9]*) FROM=7 ;; esac
case "$TO" in ''|*[!0-9]*) TO=23 ;; esac

# ── 时段 ──
HOUR=$(date +%-H)
if [ "$FROM" -le "$TO" ]; then
  [ "$HOUR" -ge "$FROM" ] && [ "$HOUR" -lt "$TO" ] || exit 0
else
  # 跨午夜（比如 22 点到次日 6 点）也要认
  [ "$HOUR" -ge "$FROM" ] || [ "$HOUR" -lt "$TO" ] || exit 0
fi

NOW=$(date +%s)

# 到点没有？有 ping.next 就比它，没有就当场决定下一次。
NEXT=$(cat "$NEXT_FILE" 2>/dev/null || echo 0)
case "$NEXT" in ''|*[!0-9]*) NEXT=0 ;; esac
if [ "$NEXT" -eq 0 ]; then
  GAP=$(( (RANDOM % (MAX - MIN + 1)) + MIN ))
  echo "$((NOW + GAP * 60))" > "$NEXT_FILE"
  exit 0                      # 刚排出下一次，这次不跑
fi
[ "$NOW" -ge "$NEXT" ] || exit 0

# 先落时间戳再干活：跑的时候万一卡住，也不会每 5 分钟重复叫一次。
echo "$NOW" > "$LAST_FILE" 2>/dev/null || true
# 排下一次：随机落在 [MIN, MAX] 分钟之后
GAP=$(( (RANDOM % (MAX - MIN + 1)) + MIN ))
echo "$((NOW + GAP * 60))" > "$NEXT_FILE"

PROMPT="$(read_cfg prompt)"
if [ -z "${PROMPT:-}" ]; then
  PROMPT='你醒了一下。没人找你，也没人在跟你说话。'
fi

# ── 带上「你走到哪了」（2026-11-02，第二版）──
#
# 第一版取的是 free-time.jsonl 里最后一条 activity，措辞是「上次你在弄的」。
# 沙耶当场指出两个问题，两个都成立：
#   ① **语义错了**：那条是「上次做完了什么」，不是「手上在弄什么」。
#      她会读成「我有一件没弄完的事」—— 而那件其实已经做完了。
#   ② **会变成聊天素材** —— 跟心情那段一模一样的坑。
#
# 所以不再给内容，只给**进度**：走到第几件、最近那件叫什么。
# 进度不会变成台词（「我做到第十一件了」没什么可说的），
# 但能给她「我在一条线上」的感觉 —— 那才是「不是冷启动」。
#
# 而且只取标题级别的东西，不取 activity 正文。正文是叙述，标题是事实。
FREE_TIME="$HOME/qqbot/work/realheart/free-time.jsonl"
[ -f "$FREE_TIME" ] || FREE_TIME="${DSH_HOME:-$HOME/.dsh}/realheart/free-time.jsonl"

PROGRESS="$(python3 - "$FREE_TIME" "$HOME/qqbot/work/pieces" <<'PY' 2>/dev/null || true
import json, os, sys
ft, pieces = sys.argv[1], sys.argv[2]

# 数作品目录（跟观测页同一个口径：目录算一件，private 不算）
n = 0
try:
    for name in os.listdir(pieces):
        if name == 'private' or name.startswith('.'):
            continue
        if os.path.isdir(os.path.join(pieces, name)):
            n += 1
except Exception:
    pass
if n <= 0:
    raise SystemExit

# 最近一件的标题：只取 activity 里第一个书名号或第一小段，绝不取正文
title = ''
try:
    last = None
    with open(ft, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            a = str(d.get('activity') or '').strip()
            if a:
                last = a
    if last:
        import re
        m = re.search(r'《([^》]{1,20})》', last)
        title = m.group(1) if m else ''
except Exception:
    pass

out = '到 %d 件了' % n
if title:
    out += '，最近一件叫《%s》' % title
print(out)
PY
)"

if [ -n "${PROGRESS:-}" ]; then
  PROMPT="$PROMPT

（你自己那条线：${PROGRESS}。给你自己定个位，不用在回复里提它。）"
fi

# ── 带上「你上次记下的那一行」（2026-11-02 夜）──
#
# 为什么这段必须有：note 的说明里写着「不记下来，下次醒来的你看不到这次弄过什么」。
# 但短唤醒跑的是 freetime profile，那里**没有 realheart 注入**
# （实测：那条会话的系统提示一共 2562 字，realheart:mood / exp 一个字都没有）。
# 所以那句话要是只靠注入，就是假的 —— 她记了，下一个醒来的她还是看不到。
# 这段接上，那句话才成立。
#
# 只给一条、只给 80 字：多了就成素材，跟上面「只取标题不取正文」同一个道理。
NOTE_FILE="${DSH_HOME:-$HOME/.dsh}/realheart/small.jsonl"
LAST_NOTE="$(python3 - "$NOTE_FILE" <<'PY' 2>/dev/null || true
import json, sys, datetime
f = sys.argv[1]
last = None
try:
    with open(f, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            did = str(d.get('did') or '').strip()
            if did:
                last = (str(d.get('at') or ''), did)
except Exception:
    raise SystemExit
if not last:
    raise SystemExit
at, did = last
ago = ''
try:
    t = datetime.datetime.strptime(at, '%Y-%m-%dT%H:%M:%S%z')
    mins = int((datetime.datetime.now(t.tzinfo) - t).total_seconds() // 60)
    if mins < 0:
        ago = ''
    elif mins < 90:
        ago = '刚才'
    elif mins < 60 * 36:
        ago = '%d 小时前' % (mins // 60)
    else:
        ago = '%d 天前' % (mins // 1440)
except Exception:
    pass
print((ago + '，' if ago else '') + did[:80])
PY
)"

if [ -n "${LAST_NOTE:-}" ]; then
  PROMPT="$PROMPT

（你上次醒着的时候记过一行：${LAST_NOTE}。没弄完就接着弄，弄完了就不用管它。）"
fi

PROFILE="$(read_cfg profile)"
PROFILE="${PROFILE:-freetime}"

exec "$DSH_BIN" --profile "$PROFILE" "$PROMPT"
