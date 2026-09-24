#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${FDH_APP_DIR:-/opt/FDHChecker}"
export PATH="$APP_DIR/node_modules/.bin:${PATH:+${PATH}:}/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"
STATE_DIR="${FDH_UPDATE_STATE_DIR:-$APP_DIR/.update-state}"
JOB_ID="${FDH_UPDATE_JOB_ID:?missing FDH_UPDATE_JOB_ID}"
STARTED_AT="${FDH_UPDATE_STARTED_AT:?missing FDH_UPDATE_STARTED_AT}"
FROM_COMMIT="${FDH_UPDATE_FROM_COMMIT:?missing FDH_UPDATE_FROM_COMMIT}"
TO_COMMIT="${FDH_UPDATE_TO_COMMIT:?missing FDH_UPDATE_TO_COMMIT}"
ACTION="${FDH_UPDATE_ACTION:-update}"
ACTOR="${FDH_UPDATE_ACTOR:-admin}"
CHANGE_SUMMARY="${FDH_UPDATE_CHANGE_SUMMARY:-}"
DEPLOY_BRANCH="${FDH_DEPLOY_BRANCH:-main}"
HEALTH_BASE_URL="${FDH_HEALTH_BASE_URL:-http://127.0.0.1:3506}"
PM2_APPS="${FDH_PM2_APPS:-fdh-backend fdh-frontend}"
STATE_FILE="$STATE_DIR/current.json"
LOG_FILE="$STATE_DIR/update-$JOB_ID.log"
HISTORY_FILE="$STATE_DIR/history-$JOB_ID.json"
CURRENT_STAGE="starting"
CODE_CHANGED=0
RUNNER_NAME="${FDH_UPDATE_RUNNER_NAME:-}"
PM2_TIMEOUT="${FDH_PM2_TIMEOUT_SECONDS:-120}"
TIMEOUT_BIN=""

mkdir -p "$STATE_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"
# A saved/resurrected PM2 process must never replay a deployment.
if ! mkdir "$STATE_DIR/started-$JOB_ID" 2>/dev/null; then
  exit 0
fi

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  printf '%s' "$value"
}

write_state() {
  local status="$1" stage="$2" progress="$3" message="$4" completed_at="${5:-}"
  local now temp_file
  now="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  temp_file="$STATE_FILE.tmp.$$"
  printf '{\n  "id": "%s",\n  "status": "%s",\n  "stage": "%s",\n  "progress": %s,\n  "message": "%s",\n  "action": "%s",\n  "actor": "%s",\n  "changeSummary": "%s",\n  "branch": "%s",\n  "fromCommit": "%s",\n  "toCommit": "%s",\n  "startedAt": "%s",\n  "updatedAt": "%s"' \
    "$(json_escape "$JOB_ID")" "$(json_escape "$status")" "$(json_escape "$stage")" "$progress" \
    "$(json_escape "$message")" "$(json_escape "$ACTION")" "$(json_escape "$ACTOR")" \
    "$(json_escape "$CHANGE_SUMMARY")" "$(json_escape "$DEPLOY_BRANCH")" "$(json_escape "$FROM_COMMIT")" \
    "$(json_escape "$TO_COMMIT")" "$(json_escape "$STARTED_AT")" "$now" > "$temp_file"
  if [[ -n "$completed_at" ]]; then
    printf ',\n  "completedAt": "%s"' "$(json_escape "$completed_at")" >> "$temp_file"
  fi
  printf ',\n  \"runnerName\": \"%s\"' "$(json_escape "$RUNNER_NAME")" >> "$temp_file"
  printf '\n}\n' >> "$temp_file"
  mv -f "$temp_file" "$STATE_FILE"
  chmod 600 "$STATE_FILE"
}

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG_FILE"
}

run_step() {
  local seconds="$1" label="$2" result=0
  shift 2
  log "BEGIN $label timeout=${seconds}s"
  "$TIMEOUT_BIN" --kill-after=10s "${seconds}s" "$@" >> "$LOG_FILE" 2>&1 || result=$?
  log "END $label exit=$result"
  return "$result"
}

restart_apps() {
  local app_name
  for app_name in $PM2_APPS; do
    run_step "$PM2_TIMEOUT" "pm2 describe $app_name" pm2 describe "$app_name" || return $?
  done
  for app_name in $PM2_APPS; do
    run_step "$PM2_TIMEOUT" "pm2 restart $app_name" pm2 restart "$app_name" || return $?
  done
}

fail_job() {
  local exit_code=${1:-$?}
  trap - ERR EXIT TERM INT HUP
  set +e
  local completed_at recovery_message
  completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  log "FAILED stage=$CURRENT_STAGE exit=$exit_code"
  recovery_message="ระบบยังไม่ได้เปลี่ยน Source code"
  if [[ "$CODE_CHANGED" == "1" && "$CURRENT_STAGE" == "restarting" ]]; then
    # The daemon may still be handling a timed-out CLI request. Avoid a racing rollback.
    recovery_message="Source code เปลี่ยนแล้ว แต่รีสตาร์ตไม่ครบ กรุณาตรวจ PM2 และ log ก่อนดำเนินการต่อ"
  elif [[ "$CODE_CHANGED" == "1" ]]; then
    log "attempting automatic recovery to $FROM_COMMIT"
    write_state "running" "recovering" 98 "เกิดข้อผิดพลาด กำลังกู้คืนรุ่นเดิมอัตโนมัติ"
    if run_step 120 "recovery git reset" git reset --hard "$FROM_COMMIT" \
      && run_step 900 "recovery dependencies" npm ci --include=dev \
      && run_step 1800 "recovery build" npm run build:all \
      && restart_apps; then
      recovery_message="กู้คืนรุ่นเดิมแล้ว"
      log "automatic recovery completed"
    else
      recovery_message="กู้คืนอัตโนมัติไม่สำเร็จ ต้องตรวจเซิร์ฟเวอร์ทันที"
      log "automatic recovery failed"
    fi
  fi
  write_state "failed" "$CURRENT_STAGE" 100 "ดำเนินการไม่สำเร็จในขั้นตอน $CURRENT_STAGE — $recovery_message" "$completed_at"
  cp -f "$STATE_FILE" "$HISTORY_FILE"
  chmod 600 "$HISTORY_FILE"
  exit "$exit_code"
}
trap fail_job ERR
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
trap 'result=$?; if [[ "$result" != "0" ]]; then fail_job "$result"; fi' EXIT

TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"
[[ -n "$TIMEOUT_BIN" ]] || { log "missing timeout (install coreutils)"; false; }
[[ "$PM2_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || { log "invalid FDH_PM2_TIMEOUT_SECONDS"; false; }
for app_name in $PM2_APPS; do
  [[ "$app_name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ && "$app_name" != "all" && "$app_name" != fdh-update-* ]] \
    || { log "invalid restart target"; false; }
done

for command_name in git npm pm2 curl; do
  command -v "$command_name" >/dev/null 2>&1 || { log "missing command: $command_name"; false; }
done

cd "$APP_DIR"

CURRENT_STAGE="connecting"
write_state "running" "$CURRENT_STAGE" 8 "กำลังเชื่อมต่อ GitHub"
log "$ACTION requested by=$ACTOR branch=$DEPLOY_BRANCH from=$FROM_COMMIT to=$TO_COMMIT"
run_step 120 "git fetch" git fetch --prune origin "$DEPLOY_BRANCH"

[[ "$(git branch --show-current)" == "$DEPLOY_BRANCH" ]] || { log "branch mismatch"; false; }
[[ -z "$(git status --porcelain -uno)" ]] || { log "working tree is dirty"; false; }
[[ "$(git rev-parse HEAD)" == "$FROM_COMMIT" ]] || { log "current commit changed"; false; }
git update-ref "refs/fdh-restore-points/$JOB_ID" "$FROM_COMMIT"

CURRENT_STAGE="downloading"
if [[ "$ACTION" == "rollback" ]]; then
  write_state "running" "$CURRENT_STAGE" 24 "กำลังย้อน Source code ไปยังเวอร์ชันที่เลือก"
  git merge-base --is-ancestor "$TO_COMMIT" "$FROM_COMMIT" >> "$LOG_FILE" 2>&1
  git reset --hard "$TO_COMMIT" >> "$LOG_FILE" 2>&1
elif [[ "$ACTION" == "update" ]]; then
  actual_remote="$(git rev-parse "origin/$DEPLOY_BRANCH")"
  [[ "$actual_remote" == "$TO_COMMIT" ]] || { log "remote changed to $actual_remote"; false; }
  write_state "running" "$CURRENT_STAGE" 24 "กำลังดาวน์โหลดและติดตั้ง Source code รุ่นใหม่"
  git merge --ff-only "origin/$DEPLOY_BRANCH" >> "$LOG_FILE" 2>&1
else
  log "invalid action: $ACTION"
  false
fi
CODE_CHANGED=1

CURRENT_STAGE="dependencies"
write_state "running" "$CURRENT_STAGE" 42 "กำลังติดตั้ง dependency"
# The PM2 daemon may pass NODE_ENV=production/npm_config_omit=dev to this
# worker. Tests and both builds still require TypeScript, Vite and test tools.
run_step 900 "dependencies" npm ci --include=dev || run_step 900 "dependencies install" npm install --include=dev --no-audit

CURRENT_STAGE="testing"
write_state "running" "$CURRENT_STAGE" 58 "กำลังทดสอบความถูกต้องของระบบ"
run_step 1800 "tests" npm run check

CURRENT_STAGE="building"
write_state "running" "$CURRENT_STAGE" 76 "กำลังสร้าง Frontend และ Backend"
run_step 1800 "build" npm run build:all

if [[ "${FDH_DEPLOY_BACKUP:-0}" == "1" ]]; then
  CURRENT_STAGE="backup"
  write_state "running" "$CURRENT_STAGE" 83 "กำลังสำรองฐานข้อมูล"
  run_step 1800 "backup" bash deploy/scripts/backup-databases.sh
fi

CURRENT_STAGE="restarting"
write_state "running" "$CURRENT_STAGE" 89 "กำลังรีสตาร์ตบริการ ระบบอาจตัดการเชื่อมต่อชั่วคราว"
restart_apps
# Restarting existing apps does not require saving the global PM2 process list.

CURRENT_STAGE="health_check"
write_state "running" "$CURRENT_STAGE" 95 "เชื่อมต่อกลับแล้ว กำลังตรวจสอบความพร้อม"
for endpoint in live ready; do
  healthy=0
  for _attempt in $(seq 1 20); do
    if curl --fail --silent --show-error --max-time 10 "$HEALTH_BASE_URL/api/$endpoint" >/dev/null; then
      healthy=1
      break
    fi
    sleep 2
  done
  [[ "$healthy" == "1" ]] || { log "health check failed: $endpoint"; false; }
done

CURRENT_STAGE="completed"
completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
if [[ "$ACTION" == "rollback" ]]; then
  write_state "completed" "$CURRENT_STAGE" 100 "ย้อนเวอร์ชันสำเร็จและระบบพร้อมใช้งาน" "$completed_at"
else
  write_state "completed" "$CURRENT_STAGE" 100 "อัปเดตสำเร็จและระบบพร้อมใช้งาน" "$completed_at"
fi
cp -f "$STATE_FILE" "$HISTORY_FILE"
chmod 600 "$HISTORY_FILE"
log "COMPLETED action=$ACTION $FROM_COMMIT -> $TO_COMMIT"
