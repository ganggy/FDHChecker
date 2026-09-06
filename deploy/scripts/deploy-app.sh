#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${FDH_APP_DIR:-/opt/FDHChecker}"
DEPLOY_BRANCH="${FDH_DEPLOY_BRANCH:-agent/add-local-ai}"
HEALTH_BASE_URL="${FDH_HEALTH_BASE_URL:-http://127.0.0.1:3506}"
PM2_APPS="${FDH_PM2_APPS:-fdh-checker-api}"

log() { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

for command_name in git npm pm2 curl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "ไม่พบคำสั่ง $command_name"
done

[[ -d "$APP_DIR/.git" ]] || fail "$APP_DIR ไม่ใช่ Git repository"
cd "$APP_DIR"

current_branch="$(git branch --show-current)"
[[ "$current_branch" == "$DEPLOY_BRANCH" ]] || fail "branch ปัจจุบันคือ $current_branch แต่กำหนดให้ deploy $DEPLOY_BRANCH"
[[ -z "$(git status --porcelain)" ]] || fail "working tree มีไฟล์แก้ไข กรุณา commit/stash ก่อน deploy"

before_commit="$(git rev-parse HEAD)"
log "fetch origin/$DEPLOY_BRANCH (current ${before_commit:0:8})"
git fetch --prune origin "$DEPLOY_BRANCH"
git merge --ff-only "origin/$DEPLOY_BRANCH"
after_commit="$(git rev-parse HEAD)"

log "ติดตั้ง dependency และตรวจสอบคุณภาพ"
npm ci
npm run check
npm run build:all

if [[ "${FDH_DEPLOY_BACKUP:-0}" == "1" ]]; then
  log "สำรองฐานข้อมูลตาม FDH_DEPLOY_BACKUP=1"
  bash deploy/scripts/backup-databases.sh
fi

for app_name in $PM2_APPS; do
  pm2 describe "$app_name" >/dev/null 2>&1 || fail "ไม่พบ PM2 app: $app_name"
done

log "restart PM2: $PM2_APPS"
# shellcheck disable=SC2086
pm2 restart $PM2_APPS
pm2 save

for endpoint in live ready; do
  healthy=0
  for _attempt in $(seq 1 15); do
    if curl --fail --silent --show-error --max-time 10 "$HEALTH_BASE_URL/api/$endpoint" >/dev/null; then
      healthy=1
      break
    fi
    sleep 2
  done
  [[ "$healthy" == "1" ]] || fail "health check /api/$endpoint ไม่ผ่าน"
done

log "สำเร็จ ${before_commit:0:8} -> ${after_commit:0:8}; live/ready ผ่าน"
