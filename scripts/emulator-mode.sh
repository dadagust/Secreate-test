#!/usr/bin/env bash
set -euo pipefail

mode=${1:?Использование: emulator-mode.sh MODE [DELAY_MS]}
delay=${2:-1800}
base=${EMULATOR_BASE_URL:-http://127.0.0.1:9090}
base=${base%/}
case "$mode" in
  Reset) method=DELETE; path=/fault-modes ;;
  Unavailable) method=PUT; path=/fault-modes/unavailable ;;
  DropAfterSave) method=PUT; path=/fault-modes/drop-after-save ;;
  DuplicateResult) method=PUT; path=/fault-modes/duplicate-result ;;
  DelayedResult)
    if [[ ! $delay =~ ^[0-9]+$ ]] || (( delay < 1 || delay > 2500 )); then
      echo 'DELAY_MS должен быть целым числом от 1 до 2500.' >&2
      exit 2
    fi
    method=PUT; path="/fault-modes/delayed-result?delayMs=$delay" ;;
  *) echo "Неизвестный режим: $mode" >&2; exit 2 ;;
esac
status=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -X "$method" "$base$path")
if [[ $status != 204 ]]; then
  echo "Эмулятор вернул HTTP $status при установке режима $mode." >&2
  exit 1
fi
curl -fsS --max-time 5 "$base/fault-modes"
printf '\n'
