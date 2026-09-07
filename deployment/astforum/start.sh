#!/bin/sh
set -eu

cd /calcom
scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"
scripts/wait-for-it.sh "$DATABASE_HOST" -- echo "Database is ready"
./node_modules/.bin/prisma migrate deploy --schema packages/prisma/schema.prisma
./node_modules/.bin/ts-node --transpile-only scripts/seed-app-store.ts
exec yarn start
