#!/bin/bash
set -euo pipefail
revision=${1:-e62aef037860a2ff393a6a131a226bd7c00b4114}
release=/opt/astforum-cal-diy/releases/$revision
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}}')" = healthy
docker compose --env-file /opt/astforum-cal-diy/.env \
  -f "$release/source/deployment/astforum/compose.yaml" -f "$release/web-command.override.yaml" \
  --profile reminders up -d --no-deps reminder-worker
docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}} {{.Config.Image}}'
