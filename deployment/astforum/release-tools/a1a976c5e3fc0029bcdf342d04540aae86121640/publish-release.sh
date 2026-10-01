#!/bin/bash
set -euo pipefail
umask 077
stage=${1:?Stage required}
revision=${2:?Revision required}
[[ "$stage" =~ ^/home/testing-user/cal-actions-build\.[A-Za-z0-9]+$ ]] || exit 2
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/astforum-cal-diy
release="$root/releases/$revision"
image="astforum/cal-diy:${revision:0:12}"
parent=astforum/cal-diy:42d0fbb05f0b
test "$(cat "$stage/build.exit")" = 0
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision"
test "$(docker image inspect "$image" --format '{{json .Config.Cmd}}')" = '["yarn","start"]'
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}}')" = "$parent"
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.Image}}')" = 'sha256:8175a548d2dbd9e773decb574a08ae64d2ece11baaf49d685199dc6aa64f55c7'
mapfile -t changed < <(tar -tzf "$stage/overlay.tar.gz" | grep -v '/$')
test "${#changed[@]}" -eq 5
for item in "${changed[@]}"; do
  case "$item" in apps/web/modules/bookings/components/AvailableTimes.tsx|apps/web/modules/bookings/components/AvailableTimes.demo.test.tsx|apps/web/modules/bookings/components/DemoWidgetActions.module.css|apps/web/modules/bookings/components/BookEventForm/BookEventForm.tsx|apps/web/modules/bookings/components/BookEventForm/BookEventForm.demo.test.tsx) ;; *) exit 2 ;; esac
done
for item in apps/web/modules/bookings/components/AvailableTimes.tsx apps/web/modules/bookings/components/BookEventForm/BookEventForm.tsx apps/web/modules/bookings/components/BookEventForm/BookEventForm.demo.test.tsx; do
  test -f "$root/source/$item"
done
for item in "${changed[@]}"; do
  if ! test -e "$root/source/$item"; then
    case "$item" in apps/web/modules/bookings/components/DemoWidgetActions.module.css|apps/web/modules/bookings/components/AvailableTimes.demo.test.tsx) ;; *) exit 2 ;; esac
  fi
done
test ! -e "$release"
mkdir -p "$release"
chmod 700 "$release"
cp "$stage/"{Dockerfile.release,.dockerignore,build-release.sh,build.log,build.exit,publish-release.sh,rollback-release.sh,web-command.override.yaml,previous-web.override.yaml,overlay.tar.gz,revision.txt} "$release/"
test ! -f "$root/source/DEPLOYED_REVISION" || cp -p "$root/source/DEPLOYED_REVISION" "$release/revision.before"
original=()
: > "$release/source.new-files"
for item in "${changed[@]}"; do
  if test -f "$root/source/$item"; then original+=("$item"); else printf '%s\n' "$item" >> "$release/source.new-files"; fi
done
tar -czf "$release/source.before.tar.gz" -C "$root/source" "${original[@]}"
event_snapshot() {
  docker exec astforum-cal-diy-database-1 psql -U caldiy -d caldiy -X -At -c 'BEGIN READ ONLY; SELECT id, slug, "requiresConfirmation", "lockTimeZoneToggleOnBookingPage", "lockedTimeZone", locations::text FROM "EventType" WHERE id=3; SELECT id, username, "avatarUrl", "brandColor" FROM users WHERE id=1; COMMIT;'
}
neighbors() {
  docker inspect astforum-cal-diy-database-1 astforum-cal-diy-redis-1 outline-caddy-1 outline-dev_landing_auth-1 outline-outline-1 outline-postgres-1 outline-redis-1 pgadmin-pgadmin-1 --format '{{.Name}} {{.Id}} {{.State.StartedAt}}'
}
event_snapshot > "$release/event.before"
neighbors > "$release/neighbors.before"
sha256sum "$root/source/deployment/astforum/compose.yaml" /opt/outline/Caddyfile /opt/outline/docker-compose.yml > "$release/configs.before"
docker run --rm --network none --entrypoint sha256sum "$parent" /calcom/packages/prisma/schema.prisma > "$release/schema.before"
docker run --rm --network none --entrypoint sha256sum "$image" /calcom/packages/prisma/schema.prisma > "$release/schema.after"
cmp "$release/schema.before" "$release/schema.after"
compose=(docker compose --env-file "$root/.env" -f "$root/source/deployment/astforum/compose.yaml" -f "$release/web-command.override.yaml")
"${compose[@]}" config -q
on_error() {
  trap - ERR
  /bin/bash "$release/rollback-release.sh" "$revision"
  exit 1
}
trap on_error ERR
"${compose[@]}" up -d --no-deps --force-recreate web
healthy=false
for attempt in {1..90}; do
  actual_health=$(docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}}')
  actual_id=$(docker inspect astforum-cal-diy-web-1 --format '{{.Image}}')
  if test "$actual_id" = "$(docker image inspect "$image" --format '{{.Id}}')" && test "$actual_health" = healthy; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
event_snapshot > "$release/event.after"
neighbors > "$release/neighbors.after"
sha256sum "$root/source/deployment/astforum/compose.yaml" /opt/outline/Caddyfile /opt/outline/docker-compose.yml > "$release/configs.after"
cmp "$release/event.before" "$release/event.after"
cmp "$release/neighbors.before" "$release/neighbors.after"
cmp "$release/configs.before" "$release/configs.after"
tar --no-overwrite-dir -xzf "$stage/overlay.tar.gz" -C "$root/source"
printf '%s\n' "$revision" > "$root/source/DEPLOYED_REVISION"
trap - ERR
docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}} {{.Image}} {{.State.Health.Status}}'
printf 'Event, avatar, schema, Compose, proxy and neighboring services unchanged.\n'
printf 'Future Compose commands must include %s/web-command.override.yaml (pinned image and yarn start); .env untouched.\n' "$release"
