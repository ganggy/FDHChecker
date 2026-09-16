#!/usr/bin/env bash
set -Eeuo pipefail
# Entire deployment runs in a disposable directory with fake git/npm/PM2/curl.
SOURCE="$(pwd)/deploy/scripts/self-update-runner.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/bin" "$ROOT/app"
export PATH="$ROOT/bin:$PATH"
export FDH_APP_DIR="$ROOT/app" FDH_DEPLOY_BRANCH=main
export FDH_UPDATE_STARTED_AT=2026-09-14T08:00:00Z FDH_UPDATE_ACTOR=test
export FDH_UPDATE_FROM_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export FDH_UPDATE_TO_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
export FDH_PM2_APPS='fdh-backend fdh-frontend' FDH_PM2_TIMEOUT_SECONDS=1
export FDH_DEPLOY_BACKUP=0
export NODE_ENV=production npm_config_omit=dev
export TRACE="$ROOT/trace"
cat > "$ROOT/bin/git" <<'SH'
#!/usr/bin/env bash
echo "git $*" >> "$TRACE"
case "$1" in
  branch) echo main ;;
  rev-parse) if [[ "$2" == HEAD ]]; then echo "$FDH_UPDATE_FROM_COMMIT"; else echo "$FDH_UPDATE_TO_COMMIT"; fi ;;
esac
SH
cat > "$ROOT/bin/npm" <<'SH'
#!/usr/bin/env bash
echo "npm $*" >> "$TRACE"
if [[ "$1" == ci && "$*" != *--include=dev* ]]; then
  echo 'fixture: production install omitted required build tools' >&2
  exit 9
fi
if [[ "$1 $2" == 'run check' && "${SCENARIO:-}" == test-failure ]]; then
  exit 1
fi
SH
cat > "$ROOT/bin/pm2" <<'SH'
#!/usr/bin/env bash
echo "pm2 $*" >> "$TRACE"
if [[ "$1" == restart && "$2" == fdh-backend ]]; then
  case "${SCENARIO:-success}" in
    timeout) sleep 15 ;;
    failure) exit 7 ;;
  esac
fi
SH
cat > "$ROOT/bin/curl" <<'SH'
#!/usr/bin/env bash
echo "curl $*" >> "$TRACE"
SH
chmod +x "$ROOT/bin/"*

for SCENARIO in success rollback test-failure failure timeout; do
  export SCENARIO
  export FDH_UPDATE_JOB_ID="fixture-$SCENARIO"
  export FDH_UPDATE_RUNNER_NAME="fdh-update-$FDH_UPDATE_JOB_ID"
  export FDH_UPDATE_STATE_DIR="$ROOT/$SCENARIO"
  export FDH_UPDATE_ACTION=update
  [[ "$SCENARIO" != rollback ]] || export FDH_UPDATE_ACTION=rollback
  : > "$TRACE"
  result=0
  bash "$SOURCE" || result=$?
  state="$FDH_UPDATE_STATE_DIR/current.json"
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(j.runnerName!==process.env.FDH_UPDATE_RUNNER_NAME) process.exit(1)' "$state"
  if [[ "$SCENARIO" == success || "$SCENARIO" == rollback ]]; then
    [[ "$result" == 0 ]]
    grep -q '"status": "completed"' "$state"
    grep -q '"progress": 100' "$state"
    grep -q 'pm2 restart fdh-frontend' "$TRACE"
    grep -q '/api/ready' "$TRACE"
    [[ -f "$FDH_UPDATE_STATE_DIR/history-$FDH_UPDATE_JOB_ID.json" ]]
    cp "$state" "$ROOT/before.json"
    cp "$TRACE" "$ROOT/before.trace"
    bash "$SOURCE"
    cmp "$state" "$ROOT/before.json"
    cmp "$TRACE" "$ROOT/before.trace"
  elif [[ "$SCENARIO" == test-failure ]]; then
    [[ "$result" != 0 ]]
    grep -q '"status": "failed"' "$state"
    grep -q '"stage": "testing"' "$state"
    grep -q 'automatic recovery completed' "$FDH_UPDATE_STATE_DIR/update-$FDH_UPDATE_JOB_ID.log"
    [[ "$(grep -c 'npm ci --include=dev' "$TRACE")" == 2 ]]
    grep -q 'git reset --hard' "$TRACE"
    grep -q 'pm2 restart fdh-frontend' "$TRACE"
  else
    [[ "$result" != 0 ]]
    grep -q '"status": "failed"' "$state"
    grep -q '"stage": "restarting"' "$state"
    ! grep -q 'pm2 restart fdh-frontend' "$TRACE"
    ! grep -q 'git reset' "$TRACE"
    if [[ "$SCENARIO" == timeout ]]; then
      grep -q 'END pm2 restart fdh-backend exit=124' "$FDH_UPDATE_STATE_DIR/update-$FDH_UPDATE_JOB_ID.log"
    fi
  fi
  ! grep -q 'pm2 save\|pm2 update\|pm2 restart all' "$TRACE"
done
echo 'runner fixtures passed'
