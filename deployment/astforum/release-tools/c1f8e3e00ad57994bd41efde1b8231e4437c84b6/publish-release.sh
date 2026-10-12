#!/bin/bash
set -euo pipefail
umask 077
stage=${1:?Stage required}
revision=${2:?Revision required}
case "$stage" in /home/testing-user/cal-form-build.*) ;; *) exit 2 ;; esac
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/astforum-cal-diy
release="$root/releases/$revision"
image="astforum/cal-diy:${revision:0:12}"
parent=astforum/cal-diy:4b68c798f285
test "$(cat "$stage/build.exit")" = 0
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision"
test "$(docker image inspect "$image" --format '{{json .Config.Cmd}}')" = '["yarn","start"]'
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}}')" = "$parent"
test "$(docker image inspect "$parent" --format '{{.Id}}')" = 'sha256:9136c2a7263e1777483a0b62af399be80c513700b5d9fd92ad421b0a88e4caa3'
mapfile -t changed < <(tar -tzf "$stage/overlay.tar.gz" | grep -v '/$')
test "${#changed[@]}" -gt 0
for item in "${changed[@]}"; do
  case "$item" in apps/web/*|packages/i18n/locales/*) ;; *) exit 2 ;; esac
  case "$item" in *..*|*.env*) exit 2 ;; esac
done
test ! -e "$release"
mkdir -p "$release"
chmod 700 "$release"
cp -p "$root/.env" "$release/env.before"
cp "$stage/"{Dockerfile.release,.dockerignore,build-release.sh,build.log,build.exit,publish-release.sh,rollback-release.sh,web-command.override.yaml,overlay.tar.gz,revision.txt} "$release/"
test ! -f "$root/source/DEPLOYED_REVISION" || cp -p "$root/source/DEPLOYED_REVISION" "$release/revision.before"
original=()
: > "$release/source.new-files"
for item in "${changed[@]}"; do
  if test -f "$root/source/$item"; then original+=("$item"); else printf '%s\n' "$item" >> "$release/source.new-files"; fi
done
tar -czf "$release/source.before.tar.gz" -C "$root/source" "${original[@]}"
event_snapshot() {
  docker exec astforum-cal-diy-database-1 psql -U caldiy -d caldiy -X -At -c 'BEGIN READ ONLY; SELECT id, slug, "requiresConfirmation", "lockTimeZoneToggleOnBookingPage", "lockedTimeZone", locations::text FROM "EventType" WHERE id=3; COMMIT;'
}
neighbors() {
  docker inspect astforum-cal-diy-database-1 astforum-cal-diy-redis-1 outline-caddy-1 outline-dev_landing_auth-1 outline-outline-1 outline-postgres-1 outline-redis-1 pgadmin-pgadmin-1 --format '{{.Name}} {{.Id}} {{.State.StartedAt}}'
}
event_snapshot > "$release/event.before"
neighbors > "$release/neighbors.before"
sed '/^CALDIY_IMAGE=/d' "$root/.env" | sha256sum > "$release/env-content.before.sha256"
docker run --rm --network none --entrypoint sha256sum "$parent" /calcom/packages/prisma/schema.prisma > "$release/schema.before"
docker run --rm --network none --entrypoint sha256sum "$image" /calcom/packages/prisma/schema.prisma > "$release/schema.after"
cmp "$release/schema.before" "$release/schema.after"
compose=(docker compose --env-file "$root/.env" -f "$root/source/deployment/astforum/compose.yaml" -f "$release/web-command.override.yaml")
CALDIY_IMAGE="$image" "${compose[@]}" config -q
test "$(grep -c '^CALDIY_IMAGE=' "$root/.env")" -eq 1
on_error() {
  trap - ERR
  /bin/bash "$release/rollback-release.sh" "$revision"
  exit 1
}
trap on_error ERR
sed -i "s|^CALDIY_IMAGE=.*$|CALDIY_IMAGE=$image|" "$root/.env"
"${compose[@]}" up -d --no-deps --force-recreate web
healthy=false
for attempt in {1..90}; do
  if test "$(docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}}')" = healthy; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
event_snapshot > "$release/event.after"
neighbors > "$release/neighbors.after"
sed '/^CALDIY_IMAGE=/d' "$root/.env" | sha256sum > "$release/env-content.after.sha256"
cmp "$release/event.before" "$release/event.after"
cmp "$release/neighbors.before" "$release/neighbors.after"
cmp "$release/env-content.before.sha256" "$release/env-content.after.sha256"
tar --no-overwrite-dir -xzf "$stage/overlay.tar.gz" -C "$root/source"
printf '%s\n' "$revision" > "$root/source/DEPLOYED_REVISION"
trap - ERR
docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}} {{.State.Health.Status}}'
printf 'Manual confirmation, provider, schema, other secrets and neighboring services unchanged.\n'
