#!/bin/bash
set -euo pipefail
revision=${1:?Revision required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/astforum-cal-diy
release="$root/releases/$revision"
test -f "$release/previous-web.override.yaml"
if test -f "$release/source.before.tar.gz"; then
  tar --no-overwrite-dir -xzf "$release/source.before.tar.gz" -C "$root/source"
fi
while IFS= read -r item; do
  test -n "$item" || continue
  case "$item" in apps/web/modules/bookings/components/DatePicker.demo.test.tsx) ;; *) exit 2 ;; esac
  if test -f "$root/source/$item"; then
    mkdir -p "$release/rolled-back-source/$(dirname "$item")"
    mv -- "$root/source/$item" "$release/rolled-back-source/$item"
  fi
done < "$release/source.new-files"
if test -f "$release/revision.before"; then cp -p "$release/revision.before" "$root/source/DEPLOYED_REVISION"; fi
docker compose --env-file "$root/.env" -f "$root/source/deployment/astforum/compose.yaml" \
  -f "$release/previous-web.override.yaml" up -d --no-deps --force-recreate web
restored=false
for attempt in {1..90}; do
  current_health=$(docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}}' 2>/dev/null || true)
  current_id=$(docker inspect astforum-cal-diy-web-1 --format '{{.Image}}' 2>/dev/null || true)
  if test "$current_id" = 'sha256:ae6994656ae304cff864c4e4c92ba1067da44e6617dfa2b0e483d654314354d3' && test "$current_health" = healthy; then restored=true; break; fi
  sleep 2
done
test "$restored" = true
printf 'Restored prior web image; no .env edit or database bootstrap executed.\n'
