#!/usr/bin/env bash
# Final ParaVega benchmark campaign: both suites (crossfilter histograms and
# linked scatterplot) on both data sets (synthetic, flights-10m), N reps.
# Follows scripts/run-ijpp-campaign.sh: wait for a quiet machine, require AC
# power, capture the environment before and after, and sample machine state
# (thermal warning, load, top foreign processes) every 30 s during the run.
#
#   bash bench/run-campaign.sh [--reps=5] [--max-wait=600]
#
#   --only=crossfilter-flights   run a subset (suite-dataset, comma separated)
#   --browser=firefox             run in puppeteer's Firefox instead of Chrome
#
# Portable to Linux: caffeinate, pmset and BSD df are used when present
# (thermal state is then read from /sys/class/thermal if available).
#
# Output: benchmark-results/vega/campaign-<timestamp>/ with one JSON per
# suite and data set, env-before.json, env-after.json, machine-state.csv and
# campaign.log.
set -u
export LC_ALL=C LANG=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

REPS=5; MAXWAIT=600; IDLE=150; ONLY=""; BROWSER=chrome
for arg in "$@"; do
  case "$arg" in
    --reps=*) REPS="${arg#--reps=}" ;;
    --max-wait=*) MAXWAIT="${arg#--max-wait=}" ;;
    --idle=*) IDLE="${arg#--idle=}" ;;
    --only=*) ONLY="${arg#--only=}" ;;   # e.g. --only=crossfilter-flights,scatter-synthetic
    --browser=*) BROWSER="${arg#--browser=}" ;;   # chrome (default) or firefox
  esac
done

STAMP="$(date +%Y%m%dT%H%M%S)"
KEEPAWAKE=""; command -v caffeinate >/dev/null 2>&1 && KEEPAWAKE="caffeinate -i"
OUT="benchmark-results/vega/campaign-$STAMP$([ "$BROWSER" != chrome ] && echo "-$BROWSER")$([ "${VEGA:-6}" = 5 ] && echo "-vega5" || echo "-vega6")"
mkdir -p "$OUT"
LOG="$OUT/campaign.log"
say() { echo "[campaign] $*" | tee -a "$LOG"; }

# Foreign CPU: everything except the benchmark's own processes.
foreign_cpu() {
  ps -Ao %cpu=,comm= | awk '
    { line = $0; sub(/^ *[0-9.]+ +/, "", line); n = split(line, p, "/"); c = p[n] }
    line ~ /Chrome for Testing|Google Chrome fo\)|Chromium|chrome-headless/ { next }
    c ~ /^(node|caffeinate|bash|ps|awk|sed|tee|sleep)$/ { next }
    { s += $1 } END { printf "%.0f", s + 0 }'
}
top_offenders() {
  ps -Ao %cpu=,comm= -r | awk '
    { line = $0; sub(/^ *[0-9.]+ +/, "", line); n = split(line, p, "/"); c = p[n]; gsub(/ /, "_", c) }
    line ~ /Chrome for Testing|Google Chrome fo\)|Chromium|chrome-headless/ { next }
    c ~ /^(node|caffeinate|bash|ps|awk)$/ { next }
    $1 + 0 > 5 && k < 3 { printf "%s %.0f%%  ", c, $1; k++ }'
}

# Results agreement across backends (not timed): both dashboards at 1M rows.
# Runs before the idle wait, so the machine settles before timing starts.
if [ -z "$ONLY" ]; then
  say "accuracy check (all backends, 1M rows)"
  for dash in three wide; do
    DASHBOARD=$dash node test/backends-browser.cjs 1000000 2>&1 | grep "bins differ" | sed "s/^/[$dash] /" >> "$OUT/accuracy.txt"
  done
fi

say "waiting up to ${MAXWAIT}s for foreign CPU < ${IDLE}% (2 min sustained)"
deadline=$(( $(date +%s) + MAXWAIT )); streak=0
while :; do
  fc=$(foreign_cpu)
  if [ "$fc" -lt "$IDLE" ]; then streak=$((streak + 1)); else streak=0; fi
  [ "$streak" -ge 6 ] && { say "quiet (foreign CPU ${fc}%), starting"; break; }
  if [ "$(date +%s)" -ge "$deadline" ]; then
    say "WARNING: no sustained quiet within ${MAXWAIT}s (foreign CPU ${fc}%; $(top_offenders)); starting anyway"
    break
  fi
  sleep 20
done

if command -v pmset >/dev/null 2>&1; then
  while ! pmset -g batt 2>/dev/null | grep -q "AC Power"; do say "on battery: waiting for AC power"; sleep 20; done
  say "power: $(pmset -g batt | head -1 | sed 's/.*from .//; s/.$//')"
fi

bash scripts/capture-env.sh > "$OUT/env-before.json" 2>/dev/null
say "start $(date -Iseconds), reps=$REPS"

(
  echo "timestamp,thermal,loadavg1,foreign_cpu_pct,swap_used_mb,disk_free_gb,top_foreign"
  while true; do
    if command -v pmset >/dev/null 2>&1; then
      if pmset -g therm 2>/dev/null | grep -q "No thermal warning"; then th=ok; else th=THERMAL_WARNING; fi
    elif [ -r /sys/class/thermal/thermal_zone0/temp ]; then
      th="temp_mC=$(cat /sys/class/thermal/thermal_zone0/temp)"
    else th=na; fi
    la=$(uptime | sed 's/.*averages*: *//' | cut -d' ' -f1 | tr -d ',')
    sw=$(sysctl -n vm.swapusage 2>/dev/null | sed 's/.*used = \([0-9.]*\)M.*/\1/')
    [ -z "$sw" ] && sw=$(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{if (t) printf "%.0f", (t-f)/1024}' /proc/meminfo 2>/dev/null)
    df_gb=$( (df -g "$ROOT" 2>/dev/null || df -BG "$ROOT" 2>/dev/null) | awk 'NR==2{gsub("G","",$4); print $4}')
    printf "%s,%s,%s,%s,%s,%s,%s\n" "$(date -Iseconds)" "$th" "${la:-na}" "$(foreign_cpu)" "${sw:-na}" "${df_gb:-na}" "$(top_offenders | tr ',' ' ')"
    sleep 30
  done
) > "$OUT/machine-state.csv" 2>/dev/null &
SAMPLER=$!
trap 'kill "$SAMPLER" 2>/dev/null' EXIT

run() {
  if [ -n "$ONLY" ] && ! echo ",$ONLY," | grep -q ",$1-$2,"; then return; fi
  say "suite=$1 dataset=$2 $3"
  # shellcheck disable=SC2086
  # Suite names: crossfilter, crossfilter-wide (six-view dashboard), scatter.
  local suite="${1%%-*}" dash=""
  [ "$1" = "crossfilter-wide" ] && dash="--dashboard=wide"
  # shellcheck disable=SC2086
  $KEEPAWAKE node bench/driver.cjs --suite="$suite" --dataset="$2" --reps="$REPS" --browser="$BROWSER" $dash $3 >> "$LOG" 2>&1
  # Move the newest result file of this run into the campaign directory.
  f=$(ls -t benchmark-results/vega/"$suite"-*.json 2>/dev/null | head -1)
  [ -n "$f" ] && mv "$f" "$OUT/$1-$2.json" && say "saved $OUT/$1-$2.json"
}

run crossfilter synthetic ""
run crossfilter flights   "--sizes=1000000,5000000,10000000"
run crossfilter-wide flights "--sizes=1000000,5000000,10000000 --threads=1,4,16"
run scatter     synthetic "--threads=1,4,16"
run scatter     flights   "--sizes=1000000,5000000,10000000 --threads=1,4,16"

bash scripts/capture-env.sh > "$OUT/env-after.json" 2>/dev/null
say "done $(date -Iseconds)"
