#!/bin/bash
set -euo pipefail
sudo -n docker rm -f goofy_swanson >/dev/null
db_name=forum-reminder-test-pg-20260930
sudo -n docker exec "$db_name" pg_isready -U build -d build >/dev/null
port=$(sudo -n docker port "$db_name" 5432/tcp | cut -d: -f2)
[[ "$port" =~ ^[0-9]+$ ]] || exit 2
database_url="postgresql://build:disposable-build-only@127.0.0.1:$port/build"
sudo -n docker run --rm --network host --memory 768m --cpus 1 \
  -e "DATABASE_URL=$database_url" -e "DATABASE_DIRECT_URL=$database_url" \
  --entrypoint /calcom/node_modules/.bin/prisma astforum/cal-diy:91c17f5baad6 \
  migrate deploy --schema /calcom/packages/prisma/schema.prisma >/home/testing-user/cal-reminders-build.DIBF4g/test-migrations.log 2>&1
sudo -n docker run --rm --name forum-reminder-concurrency-check-20260930 \
  --network host --memory 384m --cpus 1 -e "DATABASE_URL=$database_url" \
  -v /home/testing-user/cal-reminders-build.DIBF4g/postgres-concurrency.cjs:/calcom/postgres-concurrency.cjs:ro \
  --entrypoint node astforum/cal-diy:91c17f5baad6 /calcom/postgres-concurrency.cjs
