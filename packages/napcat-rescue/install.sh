#!/bin/bash
# napcat-rescue —— 把「我掉线了」变成一张能扫的码
#
# 装什么：
#   · 一个独立的小服务（python，不依赖 dsh）
#   · 一个 systemd 单元，开机自起
#   · 一个 cron 任务：按了「我确认掉了」按钮之后真的重启 NapCat
#
# 不装什么：
#   · 不动 NapCat 自己的配置
#   · 不动防火墙（80 端口重定向要的话自己加，见 README）
#
# 用法：
#   ./install.sh [--port 8099] [--dir ~/napcat-rescue] [--uin 123456789]
#
# --uin 给了就把「确认掉了」按钮接上（重启哪个号）。不给就只做只读的登录状态 + 二维码。

set -euo pipefail

PORT=8099
DIR="$HOME/napcat-rescue"
UIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --dir)  DIR="$2";  shift 2 ;;
    --uin)  UIN="$2";  shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "不认识的参数：$1（试试 --help）"; exit 2 ;;
  esac
done

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "=== 1. 依赖 ==="
if ! command -v python3 >/dev/null 2>&1; then
  echo "缺 python3。apt install python3 / pacman -S python / brew install python"
  exit 1
fi
echo "python3: $(python3 -V 2>&1)"

# segno 是纯 python 的二维码库，没有 C 依赖，pip 装很快
if ! python3 -c 'import segno' >/dev/null 2>&1; then
  echo "缺 segno（画二维码用的）。装它："
  echo "  python3 -m pip install --user segno"
  echo "或者用系统包：apt install python3-segno"
  exit 1
fi
echo "segno: 有"

echo
echo "=== 2. 铺文件到 $DIR ==="
mkdir -p "$DIR"
cp "$HERE/qq-rescue.py" "$DIR/"
cp "$HERE/qq-rescue-watch.sh" "$DIR/"
cp "$HERE/check-secret-leak.sh" "$DIR/"
chmod 700 "$DIR/qq-rescue.py" "$DIR/qq-rescue-watch.sh" "$DIR/check-secret-leak.sh"

echo
echo "=== 3. 生成口令 ==="
if [ -f "$DIR/config.json" ]; then
  echo "config.json 已存在，保留原口令（重装不会把已经发出去的地址弄失效）"
else
  # 32 字节 hex。这是唯一挡住别人看你二维码的东西，别用短口令。
  SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  umask 077
  cat > "$DIR/config.json" <<EOF
{
  "port": $PORT,
  "secret": "$SECRET",
  "qr_ttl": 45
}
EOF
  chmod 600 "$DIR/config.json"
  echo "新口令已生成（写进 $DIR/config.json，权限 600）"
fi

chmod 600 "$DIR/config.json"

echo
echo "=== 4. 装 systemd 单元 ==="
sed -e "s#__DIR__#$DIR#g" -e "s#__USER__#$(id -un)#g" \
  "$HERE/qq-rescue.service.tpl" | sudo tee /etc/systemd/system/qq-rescue.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now qq-rescue.service
sleep 2
if systemctl is-active --quiet qq-rescue; then
  echo "qq-rescue.service: active"
else
  echo "起不来。看：journalctl -u qq-rescue -n 30 --no-pager"
  exit 1
fi

echo
echo "=== 5. cron（按按钮后真的重启 NapCat）==="
if [ -n "$UIN" ]; then
  CRON_LINE="* * * * * $DIR/qq-rescue-watch.sh $UIN >/dev/null 2>&1"
  if crontab -l 2>/dev/null | grep -qF "qq-rescue-watch.sh"; then
    echo "cron 已经有这一条了，跳过"
  else
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    echo "已装 cron：$CRON_LINE"
  fi
else
  echo "没给 --uin，跳过。这样页面上只有「看状态 / 扫二维码」，没有「确认掉了」按钮"
fi

echo
echo "=== 装好了 ==="
SECRET_SHOWN="$(python3 -c "import json;print(json.load(open('$DIR/config.json'))['secret'])")"
echo "打开这个地址（口令在路径里，不是 ?secret=）："
echo "  http://<这台机器的地址>:$PORT/$SECRET_SHOWN/"
echo
echo "本机先试："
echo "  curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:$PORT/$SECRET_SHOWN/"
echo "（200 = 通；404 = 口令写错了）"
echo
echo "⚠️ 这个地址本身就是登录凭证 —— 别贴进聊天、issue、截图。"
