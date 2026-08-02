---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "scripts/tune-ollama-macos.sh"
source_hash: "20ecee4fa73a1360006a660270e06aa217ebbb61044f2c461ff0b99d21795899"
managed_by: "sync-ksp-vault"
---
# tune-ollama-macos.sh

> Source: `scripts/tune-ollama-macos.sh`
> SHA-256: `20ecee4fa73a1360006a660270e06aa217ebbb61044f2c461ff0b99d21795899`

````bash
#!/bin/sh
set -eu

launchctl setenv OLLAMA_NUM_PARALLEL 2
launchctl setenv OLLAMA_MAX_LOADED_MODELS 1
launchctl setenv OLLAMA_MAX_QUEUE 512
launchctl setenv OLLAMA_FLASH_ATTENTION 1
launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0
launchctl setenv OLLAMA_CONTEXT_LENGTH 8192
launchctl setenv OLLAMA_KEEP_ALIVE 30m
launchctl setenv OLLAMA_HOST 127.0.0.1:11434

if command -v brew >/dev/null 2>&1 && brew services list | awk '$1 == "ollama" { found = 1 } END { exit !found }'; then
  brew services restart ollama
elif [ -d /Applications/Ollama.app ]; then
  osascript -e 'tell application "Ollama" to quit' >/dev/null 2>&1 || true
  open -a Ollama
else
  echo 'Ollama settings applied. Restart the Ollama server process manually to activate them.'
fi

echo 'Ollama tuned for a 16 GB Apple Silicon Mac: parallel=2, flash attention=on, KV cache=q8_0, context=8192.'

````
