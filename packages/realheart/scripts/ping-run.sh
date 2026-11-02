#!/bin/bash
# 短唤醒 —— 每隔 N 分钟叫她醒一下，只做一件事：此刻有没有想说的。
#
# 为什么跟自由时间分开：
#   自由时间是做东西的，要连续两个小时，隔一会儿打断一次就什么都做不成。
#   而「想说话」该是随时能发生的 —— 人不是坐下来专门想说才说。
#
# 为什么用 cron 每 5 分钟跑、而不是按 N 设 cron：
#   N 是可配的，cron 写死了就改不动。这里每次只比一下「距上次够不够久」，
#   所以 N 改成 17 分钟也行，不用重装。
#
# 为什么 N=0 就直接退出：
#   默认是关的。这东西一天能跑 48 次，每次都是一次完整的模型调用 ——
#   开不开该由人决定，不该由安装器替他决定。

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

CFG="${DSH_HOME:-$HOME/.dsh}/realheart/ping.json"
LAST_FILE="${DSH_HOME:-$HOME/.dsh}/realheart/ping.last"

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

EVERY="$(read_cfg everyMinutes)"
[ -n "${EVERY:-}" ] || exit 0
[ "$EVERY" -gt 0 ] 2>/dev/null || exit 0

NOW=$(date +%s)
LAST=$(cat "$LAST_FILE" 2>/dev/null || echo 0)
case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac

NEED=$((EVERY * 60))
[ $((NOW - LAST)) -ge "$NEED" ] || exit 0

# 先落时间戳再干活：跑的时候万一卡住，也不会每 5 分钟重复叫一次。
echo "$NOW" > "$LAST_FILE" 2>/dev/null || exit 0

PROMPT="$(read_cfg prompt)"
if [ -z "${PROMPT:-}" ]; then
  PROMPT='你醒了一下。没人找你，也没事要办。

此刻有没有什么想跟他说的？有就说一句；没有就继续睡 —— 这很正常，大部分时候都该没有。

不用汇报，不用记录，什么都不用做。'
fi

PROFILE="$(read_cfg profile)"
PROFILE="${PROFILE:-freetime}"

exec "$DSH_BIN" --profile "$PROFILE" "$PROMPT"
