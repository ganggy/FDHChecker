#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chat_base="qwen3:4b-instruct"
chat_model="${OLLAMA_MODEL:-fdh-qwen3:4b}"
embed_model="${OLLAMA_EMBED_MODEL:-bge-m3}"

command -v ollama >/dev/null 2>&1 || { echo "[local-ai] ไม่พบคำสั่ง ollama" >&2; exit 1; }
curl --fail --silent --show-error --max-time 5 "${OLLAMA_BASE_URL:-http://127.0.0.1:11434}/api/version" >/dev/null \
  || { echo "[local-ai] เชื่อมต่อ Ollama ไม่ได้" >&2; exit 1; }

has_model() {
  ollama list | awk 'NR > 1 { print $1 }' | grep -Eq "^${1}(:latest)?$"
}

if ! has_model "$chat_base"; then
  echo "[local-ai] pull $chat_base"
  ollama pull "$chat_base"
fi

if ! has_model "$embed_model"; then
  echo "[local-ai] pull $embed_model"
  ollama pull "$embed_model"
fi

echo "[local-ai] create $chat_model from $chat_base"
ollama create "$chat_model" -f "$project_dir/deploy/ollama/Modelfile.fdh-qwen3"

echo "[local-ai] พร้อมใช้งาน: chat=$chat_model embedding=$embed_model"
