#!/bin/bash
# 卸掉 napcat-rescue。
#
# 默认**保留** config.json 和日志 —— 那里面没有秘密，但可能有你排查时要看的东西。
# 要连目录一起删：./uninstall.sh --purge

set -euo pipefail

PURGE=0
DIR="$HOME/napcat-rescue"

while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --dir)   DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "不认识的参数：$1"; exit 2 ;;
  esac
done

echo "=== 停服务 ==="
if systemctl list-unit-files 2>/dev/null | grep -q '^qq-rescue.service'; then
  sudo systemctl disable --now qq-rescue.service 2>/dev/null || true
  sudo rm -f /etc/systemd/system/qq-rescue.service
  sudo systemctl daemon-reload
  echo "unit 已删"
else
  echo "没有这个 unit（可能没装过）"
fi

echo
echo "=== 删 cron ==="
if crontab -l 2>/dev/null | grep -qF "qq-rescue-watch.sh"; then
  crontab -l 2>/dev/null | grep -vF "qq-rescue-watch.sh" | crontab -
  echo "已删那一行"
else
  echo "cron 里没有相关内容"
fi

echo
if [ "$PURGE" -eq 1 ]; then
  echo "=== 删目录 $DIR ==="
  rm -rf "$DIR"
  echo "删了"
else
  echo "文件留在 $DIR（含 config.json 和日志）"
  echo "要连它一起删：./uninstall.sh --purge"
fi

echo
echo "剩下你自己决定的："
echo "  · iptables 的 80→8099 规则（如果是你加的）"
echo "    查看：sudo iptables -t nat -L PREROUTING -n --line-numbers"
echo "    删除：sudo iptables -t nat -D PREROUTING <行号>"
