#!/bin/bash
set -euo pipefail
stage=${1:?Stage required}
revision=${2:?Revision required}
case "$stage" in /home/testing-user/cal-display-build.*) ;; *) exit 2 ;; esac
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/astforum-cal-diy
release="$root/releases/$revision"
image="astforum/cal-diy:${revision:0:12}"
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision"
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}}')" = 'astforum/cal-diy:1cc628cb98e5'
test ! -e "$release"
mkdir -p "$release"
chmod 700 "$release"
cp -p "$root/.env" "$release/env.before"
cp "$stage/Dockerfile.release" "$stage/.dockerignore" "$stage/build.log" "$stage/publish-release.sh" "$stage/web-command.override.yaml" "$release/"
cp "$stage/overlay.tar.gz" "$release/"
cp "$stage/revision.txt" "$release/"
compose=(docker compose --env-file "$root/.env" -f "$root/source/deployment/astforum/compose.yaml" -f "$release/web-command.override.yaml")
event_snapshot() {
  docker exec astforum-cal-diy-database-1 psql -U caldiy -d caldiy -X -At -c 'BEGIN READ ONLY; SELECT id, slug, "requiresConfirmation", locations::text FROM "EventType" WHERE id=3; COMMIT;'
}
event_snapshot > "$release/event.before"
test "$(grep -c '^CALDIY_IMAGE=' "$root/.env")" -eq 1
sed -i "s|^CALDIY_IMAGE=.*$|CALDIY_IMAGE=$image|" "$root/.env"
rollback() {
  cp -p "$release/env.before" "$root/.env"
  "${compose[@]}" up -d --no-deps --force-recreate web
}
if ! "${compose[@]}" config -q || ! "${compose[@]}" up -d --no-deps --force-recreate web; then
  rollback
  exit 1
fi
healthy=false
for attempt in {1..90}; do
  if test "$(docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}}')" = healthy; then healthy=true; break; fi
  sleep 2
done
if test "$healthy" != true; then rollback; exit 1; fi
event_snapshot > "$release/event.after"
if ! cmp -s "$release/event.before" "$release/event.after"; then
  echo 'Event settings changed unexpectedly; rolling web back for investigation' >&2
  rollback
  exit 1
fi
mapfile -t changed < <(tar -tzf "$stage/overlay.tar.gz" | grep -v '/$')
for path in "${changed[@]}"; do
  case "$path" in packages/features/bookings/*|apps/web/modules/bookings/*) ;; *) exit 2 ;; esac
  case "$path" in *..*) exit 2 ;; esac
done
original=()
for path in "${changed[@]}"; do if test -f "$root/source/$path"; then original+=("$path"); fi; done
tar -czf "$release/source.before.tar.gz" -C "$root/source" "${original[@]}"
tar --no-overwrite-dir -xzf "$stage/overlay.tar.gz" -C "$root/source"
printf '%s\n' "$revision" > "$root/source/DEPLOYED_REVISION"
docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}} {{.State.Health.Status}}'
echo 'Manual confirmation and location settings unchanged'
