#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${FDH_APP_DIR:-/opt/FDHChecker}"
STATE_DIR="${FDH_UPDATE_STATE_DIR:-$APP_DIR/.update-state}"
JOB_ID="${FDH_UPDATE_JOB_ID:?missing FDH_UPDATE_JOB_ID}"
STARTED_AT="${FDH_UPDATE_STARTED_AT:?missing FDH_UPDATE_STARTED_AT}"
FROM_COMMIT="${FDH_UPDATE_FROM_COMMIT:?missing FDH_UPDATE_FROM_COMMIT}"
TO_COMMIT="${FDH_UPDATE_TO_COMMIT:?missing FDH_UPDATE_TO_COMMIT}"
ACTION="${FDH_UPDATE_ACTION:-update}"
ACTOR="${FDH_UPDATE_ACTOR:-admin}"
CHANGE_SUMMARY="${FDH_UPDATE_CHANGE_SUMMARY:-}"
DEPLOY_BRANCH="${FDH_DEPLOY_BRANCH:-agent/add-local-ai}"
HEALTH_BASE_URL="${FDH_HEALTH_BASE_URL:-http://127.0.0.1:3506}"
PM2_APPS="${FDH_PM2_APPS:-fdh-backend fdh-frontend}"
STATE_FILE="$STATE_DIR/current.json"
LOG_FILE="$STATE_DIR/update-$JOB_ID.log"
HISTORY_FILE="$STATE_DIR/history-$JOB_ID.json"
CURRENT_STAGE="starting"
CODE_CHANGED=0

mkdir -p "$STATE_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

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
  printf '\n}\n' >> "$temp_file"
  mv -f "$temp_file" "$STATE_FILE"
  chmod 600 "$STATE_FILE"
}

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG_FILE"
}

fail_job() {
  local exit_code=$?
  trap - ERR
  set +e
  local completed_at recovery_message
  completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  log "FAILED stage=$CURRENT_STAGE exit=$exit_code"
  recovery_message="ระบบยังไม่ได้เปลี่ยน Source code"
  if [[ "$CODE_CHANGED" == "1" ]]; then
    log "attempting automatic recovery to $FROM_COMMIT"
    write_state "running" "recovering" 98 "เกิดข้อผิดพลาด กำลังกู้คืนรุ่นเดิมอัตโนมัติ"
    if git reset --hard "$FROM_COMMIT" >> "$LOG_FILE" 2>&1 \
      && npm ci >> "$LOG_FILE" 2>&1 \
      && npm run build:all >> "$LOG_FILE" 2>&1 \
      && pm2 restart $PM2_APPS >> "$LOG_FILE" 2>&1; then
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

for command_name in git npm pm2 curl; do
  command -v "$command_name" >/dev/null 2>&1 || { log "missing command: $command_name"; false; }
done

cd "$APP_DIR"

CURRENT_STAGE="connecting"
write_state "running" "$CURRENT_STAGE" 8 "กำลังเชื่อมต่อ GitHub"
log "$ACTION requested by=$ACTOR branch=$DEPLOY_BRANCH from=$FROM_COMMIT to=$TO_COMMIT"
git fetch --prune origin "$DEPLOY_BRANCH" >> "$LOG_FILE" 2>&1

[[ "$(git branch --show-current)" == "$DEPLOY_BRANCH" ]] || { log "branch mismatch"; false; }
[[ -z "$(git status --porcelain)" ]] || { log "working tree is dirty"; false; }
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
npm ci >> "$LOG_FILE" 2>&1

CURRENT_STAGE="testing"
write_state "running" "$CURRENT_STAGE" 58 "กำลังทดสอบความถูกต้องของระบบ"
npm run check >> "$LOG_FILE" 2>&1

CURRENT_STAGE="building"
write_state "running" "$CURRENT_STAGE" 76 "กำลังสร้าง Frontend และ Backend"
npm run build:all >> "$LOG_FILE" 2>&1

if [[ "${FDH_DEPLOY_BACKUP:-0}" == "1" ]]; then
  CURRENT_STAGE="backup"
  write_state "running" "$CURRENT_STAGE" 83 "กำลังสำรองฐานข้อมูล"
  bash deploy/scripts/backup-databases.sh >> "$LOG_FILE" 2>&1
fi

CURRENT_STAGE="restarting"
write_state "running" "$CURRENT_STAGE" 89 "กำลังรีสตาร์ตบริการ ระบบอาจตัดการเชื่อมต่อชั่วคราว"
for app_name in $PM2_APPS; do
  pm2 describe "$app_name" >/dev/null 2>&1 || { log "missing PM2 app: $app_name"; false; }
done
# shellcheck disable=SC2086
pm2 restart $PM2_APPS >> "$LOG_FILE" 2>&1
pm2 save >> "$LOG_FILE" 2>&1

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
