#!/bin/sh
# uninstall.sh 「卸掉安装器补装的依赖」那一节的回归检查（2026-11-01）。
#
# 为什么要它：那一段的判断全建在收据文件上（谁补的 / 插件本体还在不在 / 别人依不依赖），
# 而这几条都没有运行时可观测痕迹 —— 只能真的跑一遍看输出。
# 开发脚本，不进 npm 包（package.json 的 files 点名四个 .sh，不在这里面）。
#
# 跑法：  sh scripts/check-uninstall-receipt.sh
#         cd 到 packages/realheart 下再跑（脚本里不猜路径）

set -e

HERE=$(cd "$(dirname "$0")" && pwd)
UNINSTALL="$HERE/uninstall.sh"
[ -f "$UNINSTALL" ] || { echo "找不到 $UNINSTALL"; exit 1; }

FAIL=0
check() { # $1=用例名 $2=期望出现的串 $3=实际输出
  if printf '%s' "$3" | grep -qF "$2"; then
    echo "  ok  [$1] 出现：$2"
  else
    echo "  FAIL [$1] 没出现：$2"
    echo "       ---- 实际输出 ----"
    printf '%s\n' "$3" | sed 's/^/       /'
    FAIL=1
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
P="$TMP/profiles/fake"
mkdir -p "$P/node_modules"
printf '%s' '{"name":"fake","dsh":{"profile":{"bundles":["realheart"]}}}' > "$P/package.json"

# ── A：收据说是我补的、插件已卸、没人依赖 → 应该卸它 ──
printf '%s' '{"profile":"fake","peerAdds":[{"name":"@deepseek-ai/schemastery","autoAdded":true}]}' \
  > "$P/.realheart-install-receipt.json"
OUT=$(DSH_HOME="$TMP" sh "$UNINSTALL" --profile fake --dry-run 2>&1)
check A 'remove @deepseek-ai/schemastery' "$OUT"

# ── B：有别的 bundle 依赖它 → 不卸，并把是谁打出来 ──
mkdir -p "$P/node_modules/otherplugin"
printf '%s' '{"name":"otherplugin","dependencies":{"@deepseek-ai/schemastery":"*"}}' \
  > "$P/node_modules/otherplugin/package.json"
printf '%s' '{"name":"fake","dsh":{"profile":{"bundles":["otherplugin"]}}}' > "$P/package.json"
OUT=$(DSH_HOME="$TMP" sh "$UNINSTALL" --profile fake --dry-run 2>&1)
check B '不卸 @deepseek-ai/schemastery' "$OUT"
check B2 'otherplugin' "$OUT"

# ── C：插件本体还在 → 依赖一律不卸（它还要用）──
mkdir -p "$P/node_modules/realheart"
printf '%s' '{"name":"realheart"}' > "$P/node_modules/realheart/package.json"
OUT=$(DSH_HOME="$TMP" sh "$UNINSTALL" --profile fake --dry-run 2>&1)
check C '插件本体还在' "$OUT"

# ── D：没有收据（0.2.12 之前装的）→ 一句也不卸，给手动查看的路 ──
rm -rf "$P/node_modules/realheart" "$P/.realheart-install-receipt.json"
OUT=$(DSH_HOME="$TMP" sh "$UNINSTALL" --profile fake --dry-run 2>&1)
check D '没有安装收据' "$OUT"

# ── E：收据里 autoAdded:false（本来就有的）→ 不卸 ──
printf '%s' '{"profile":"fake","peerAdds":[{"name":"@deepseek-ai/schemastery","autoAdded":false}]}' \
  > "$P/.realheart-install-receipt.json"
OUT=$(DSH_HOME="$TMP" sh "$UNINSTALL" --profile fake --dry-run 2>&1)
check E '不用卸' "$OUT"

if [ "$FAIL" -eq 0 ]; then
  echo "== 全部通过 =="
else
  echo "== 有失败 =="
  exit 1
fi
