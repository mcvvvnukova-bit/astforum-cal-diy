#!/bin/bash
set -euo pipefail
revision=${1:?Revision required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/astforum-cal-diy
release="$root/releases/$revision"
test -f "$release/env.before"
test -f "$release/web-command.override.yaml"
mapfile -t expected_images < <(sed -n 's/^CALDIY_IMAGE=//p' "$release/env.before")
test "${#expected_images[@]}" -eq 1
expected_image=${expected_images[0]}
test -n "$expected_image"
cp -p "$release/env.before" "$root/.env"
if test -f "$release/source.before.tar.gz"; then
  tar --no-overwrite-dir -xzf "$release/source.before.tar.gz" -C "$root/source"
fi
while IFS= read -r item; do
  test -n "$item" || continue
  case "$item" in packages/i18n/locales/ru/common.json|apps/web/modules/bookings/components/DemoSlotPresentation.test.tsx|apps/web/modules/bookings/components/EventMeta.demo.test.tsx) ;; *) exit 2 ;; esac
  case "$item" in *..*) exit 2 ;; esac
  if test -f "$root/source/$item"; then
    mkdir -p "$release/rolled-back-source/$(dirname "$item")"
    mv -- "$root/source/$item" "$release/rolled-back-source/$item"
  fi
done < "$release/source.new-files"
if test -f "$release/revision.before"; then cp -p "$release/revision.before" "$root/source/DEPLOYED_REVISION"; fi
docker compose --env-file "$root/.env" -f "$root/source/deployment/astforum/compose.yaml" \
  -f "$release/web-command.override.yaml" up -d --no-deps --force-recreate web
restored=false
for attempt in {1..90}; do
  current_image=$(docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}}' 2>/dev/null || true)
  current_health=$(docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}}' 2>/dev/null || true)
  current_id=$(docker inspect astforum-cal-diy-web-1 --format '{{.Image}}' 2>/dev/null || true)
  if test "$current_image" = "$expected_image" && test "$current_id" = "$(docker image inspect "$expected_image" --format '{{.Id}}')" && test "$current_health" = healthy; then
    restored=true
    break
  fi
  sleep 2
done
if test "$restored" != true; then
  printf 'Rollback verification failed: expected image %s to become healthy.\n' "$expected_image" >&2
  exit 1
fi
printf 'Restored prior web image; no database bootstrap executed.\n'
