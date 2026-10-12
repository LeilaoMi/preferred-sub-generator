#!/data/data/com.termux/files/usr/bin/bash
# 在手机 Termux 里做"国内视角"实测并回传。
# 配置放在 ~/.psg.env（SITE_URL、SUB_TOKEN），不要提交到仓库。
# 必须关掉代理/VPN 再跑；脚本检测到出口不在 CN 会自动中止，不会污染数据。
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${PSG_ENV:-$HOME/.psg.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "缺少 $ENV_FILE（需要 SITE_URL 和 SUB_TOKEN）" >&2
  exit 1
fi
set -a; . "$ENV_FILE"; set +a
LOG_DIR="$HOME/.psg-logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/probe-$(date +%Y%m%d-%H%M).log"
command -v termux-wake-lock >/dev/null && termux-wake-lock || true
# --pool 全量实测过审池；--speed 0 不测带宽（省流量）；--samples 3 筛掉时通时断的
node scripts/probe-ips.js --pool --speed 0 --samples 3 --concurrency 16 "$@" 2>&1 | tee "$LOG"
command -v termux-wake-unlock >/dev/null && termux-wake-unlock || true
# 只保留最近 30 份日志
ls -1t "$LOG_DIR"/probe-*.log 2>/dev/null | tail -n +31 | xargs -r rm -f
