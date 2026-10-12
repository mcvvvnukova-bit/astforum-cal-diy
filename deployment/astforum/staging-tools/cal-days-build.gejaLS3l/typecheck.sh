#!/bin/bash
set -euo pipefail
stage=/home/testing-user/cal-days-build.gejaLS3l
swap_file="$stage/typecheck.swap"
cleanup() {
  result=$?
  sudo docker update --memory 2g --memory-swap 4g cal-days-tests-gejaLS3l >/dev/null || true
  if sudo swapon --show=NAME --noheadings | grep -Fxq "$swap_file"; then sudo swapoff "$swap_file"; fi
  if test -f "$swap_file"; then sudo rm -- "$swap_file"; fi
  printf '%s\n' "$result" > "$stage/typecheck.exit"
}
test ! -e "$swap_file"
trap cleanup EXIT
sudo fallocate -l 8G "$swap_file"
sudo chmod 600 "$swap_file"
sudo mkswap "$swap_file" >/dev/null
sudo swapon "$swap_file"
sudo docker update --memory 6g --memory-swap 10g cal-days-tests-gejaLS3l >/dev/null
sudo docker exec -w /calcom -e NODE_OPTIONS=--max-old-space-size=4096 cal-days-tests-gejaLS3l ./node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.days.json
