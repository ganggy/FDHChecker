#!/usr/bin/env bash
set -euo pipefail

project_dir="${FDH_PROJECT_DIR:-/opt/FDHChecker}"
env_file="${FDH_ENV_FILE:-${project_dir}/.env}"
backup_root="${FDH_BACKUP_DIR:-${project_dir}/backups}"

if [[ ! -r "${env_file}" ]]; then
  echo "Environment file is not readable: ${env_file}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${backup_root}/${stamp}"
mkdir -p "${destination}"
chmod 700 "${backup_root}" "${destination}"

dump_database() {
  local label="$1" host="$2" user="$3" password="$4" database="$5"
  local target="${destination}/${label}.sql.gz"
  MYSQL_PWD="${password}" mysqldump \
    --host="${host}" --user="${user}" \
    --single-transaction --quick --routines --triggers \
    --default-character-set=utf8mb4 "${database}" | gzip -9 > "${target}"
  gzip -t "${target}"
  chmod 600 "${target}"
}

dump_database "repstm" "${REPSTM_HOST:-${HOSXP_HOST}}" "${REPSTM_BACKUP_USER:-${REPSTM_USER:-${HOSXP_USER}}}" "${REPSTM_BACKUP_PASSWORD:-${REPSTM_PASSWORD:-${HOSXP_PASSWORD}}}" "${REPSTM_DB:-repstminv}"

if [[ "${FDH_BACKUP_HOSXP:-0}" == "1" ]]; then
  dump_database "hosxp" "${HOSXP_HOST:?}" "${HOSXP_BACKUP_USER:-${HOSXP_USER:?}}" "${HOSXP_BACKUP_PASSWORD:-${HOSXP_PASSWORD:?}}" "${HOSXP_DB:?}"
fi

echo "Backup complete: ${destination}"
