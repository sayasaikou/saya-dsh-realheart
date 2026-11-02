#!/bin/sh
# 自检：日志里不许出现当前口令。
#
# 挂在 unit 的 ExecStartPost 上 —— 每次重启之后自动跑一次。
# 位置的理由：口令不是只在换口令时才漏，改代码时更容易漏，而改完代码都会重启。
# 不全量读 journal：最近一小时几 KB 就够，因为它在"刚启动"那一刻检查的
# 正是重启之前那段运行的痕迹。
set -e
cd "$(dirname "$0")"

SECRET=$(python3 -c "import json;print(json.load(open('config.json'))['secret'])")
N=$(sudo journalctl -u qq-rescue --no-pager --since '-1h' 2>/dev/null | grep -cF "$SECRET" || true)
N=${N:-0}

if [ "$N" -ne 0 ]; then
  echo "FAIL 日志里出现口令 ${N} 次（应该 0）" >&2
  exit 1
fi
echo "OK 日志里没有口令"
