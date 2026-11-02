#!/bin/bash
# qq-rescue-watch.sh -- 抢救页按了「我确认掉了」，这里负责真的重启 NapCat。
#
# 为什么不在抢救页里直接重启（写在这儿，免得以后有人图省事搬回去）：
#   · qq-rescue.service 开着 NoNewPrivileges=true，sudo 用不了，也不该为省事拆掉；
#   · systemd 默认 KillMode=control-group，从服务里起的子进程挂在服务的 cgroup 下，
#     服务一重启就把 NapCat 一起带走。
# 所以页面只留记号，重启交给这个用户级 cron 干。
#
# 命令行匹配用 /proc/<pid>/cmdline 的第一段**完全相等**，不用 pkill -f ——
# 2026-10-27 那次 pkill -f 把执行它的进程自己也杀了。

FLAG=/home/ubuntu/qqbot/rescue/.reset-request
RUNNING=$FLAG.running
LOG=/home/ubuntu/qqbot/rescue/reset.log
LAUNCHER=/home/ubuntu/napcatrun/launcher.sh
RUNDIR=/home/ubuntu/napcatrun
UIN=3676939737

[ -f "$FLAG" ] || exit 0
mv "$FLAG" "$RUNNING" 2>/dev/null || exit 0

TS=$(date '+%F %T')
echo "$TS REQUEST 收到重启请求" >> "$LOG"

# 日志别无限长
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 200000 ]; then
  tail -n 300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

qq_pids() {
  local pid first
  for pid in /proc/[0-9]*; do
    pid=${pid#/proc/}
    [ -r "/proc/$pid/cmdline" ] || continue
    first=$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | head -n 1)
    [ "$first" = "/opt/QQ/qq" ] && echo "$pid"
  done
}

PIDS=$(qq_pids)
echo "$TS TERM [$PIDS]" >> "$LOG"
for p in $PIDS; do kill -TERM "$p" 2>/dev/null; done

WAITED=0
while [ "$WAITED" -lt 20 ]; do
  [ -z "$(qq_pids)" ] && break
  sleep 1
  WAITED=$((WAITED + 1))
done

LEFT=$(qq_pids)
if [ -n "$LEFT" ]; then
  echo "$TS KILL [$LEFT]（TERM 20 秒没退）" >> "$LOG"
  for p in $LEFT; do kill -KILL "$p" 2>/dev/null; done
  sleep 2
fi
echo "$TS STOPPED waited=${WAITED}s left=[$(qq_pids)]" >> "$LOG"

cd "$RUNDIR" || { echo "$TS ABORT 进不去 $RUNDIR" >> "$LOG"; rm -f "$RUNNING"; exit 1; }
setsid nohup ./launcher.sh -q "$UIN" >> "$RUNDIR/run.log" 2>&1 < /dev/null &
echo "$TS STARTED launcher.sh pid=$!" >> "$LOG"

# 等 6099 回来，记一笔结果（不阻塞太久）
for i in $(seq 1 40); do
  if (exec 3<>/dev/tcp/127.0.0.1/6099) 2>/dev/null; then
    exec 3>&- 3<&-
    echo "$TS WEBUI_UP 6099 已监听（等了 ${i} 秒）" >> "$LOG"
    break
  fi
  sleep 1
done

rm -f "$RUNNING"
echo "$TS DONE" >> "$LOG"
