#!/bin/bash
set -euo pipefail
revision=${1:?Exact revision required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/astforum-cal-diy
release="$root/releases/$revision"
image="astforum/cal-diy:${revision:0:12}"
built_id=$(docker image inspect "$image" --format '{{.Id}}')
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.Image}}')" = "$built_id"
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}}')" = "$image"
test "$(docker inspect astforum-cal-diy-web-1 --format '{{json .Config.Cmd}}')" = '["yarn","start"]'
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}}')" = healthy
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision"
test "$(docker image inspect astforum/cal-diy:c1f8e3e00ad5 --format '{{.Id}}')" = 'sha256:09581c294d9b3ad5f079a63f4a6982adfa38d623397a0356db3dd56928fd3c98'
test "$(cat "$root/source/DEPLOYED_REVISION")" = "$revision"
docker exec astforum-cal-diy-database-1 psql -U caldiy -d caldiy -X -At -c 'BEGIN READ ONLY; SELECT id, slug, "requiresConfirmation", "lockTimeZoneToggleOnBookingPage", "lockedTimeZone", locations::text FROM "EventType" WHERE id=3; COMMIT;' | cmp - "$release/event.before"
docker inspect astforum-cal-diy-database-1 astforum-cal-diy-redis-1 outline-caddy-1 outline-dev_landing_auth-1 outline-outline-1 outline-postgres-1 outline-redis-1 pgadmin-pgadmin-1 --format '{{.Name}} {{.Id}} {{.State.StartedAt}}' | cmp - "$release/neighbors.before"
sed '/^CALDIY_IMAGE=/d' "$root/.env" | sha256sum | cmp - "$release/env-content.before.sha256"
sha256sum "$root/source/deployment/astforum/compose.yaml" /opt/outline/Caddyfile /opt/outline/docker-compose.yml | cmp - "$release/configs.before"
cmp "$release/schema.before" "$release/schema.after"
docker exec astforum-cal-diy-web-1 sha256sum /calcom/packages/prisma/schema.prisma | cmp - "$release/schema.before"
docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}} {{.Image}} {{json .Config.Cmd}} {{.State.Health.Status}}'
printf 'Revision, immutable image, health, rollback image, event, schema, environment, neighbors and configs verified.\n'
