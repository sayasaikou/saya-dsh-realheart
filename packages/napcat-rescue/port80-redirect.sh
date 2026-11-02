#!/bin/bash
# 保住 80 → 8099 的端口重定向。
#
# 为什么要它：iptables 规则**重启就没了**，防火墙重载也会丢。
# 我们踩过 —— 某天忽然打不开抢救页，查了半天发现规则没了。
#
# 逻辑：有这条规则就什么都不做，没有就加。可以每分钟跑一次。
#
# cron 示例：
#   * * * * * /path/to/port80-redirect.sh

set -uo pipefail

PORT="${1:-8099}"
RULE="-t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports $PORT"
ADD="-t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports $PORT"
LOG="$HOME/port80-redirect.log"

if sudo iptables $RULE 2>/dev/null; then
  exit 0    # 还在，什么都不做
fi

if sudo iptables $ADD 2>/dev/null; then
  echo "$(date '+%F %T') re-added 80->$PORT" >> "$LOG"
else
  echo "$(date '+%F %T') FAILED to add 80->$PORT" >> "$LOG"
  exit 1
fi
