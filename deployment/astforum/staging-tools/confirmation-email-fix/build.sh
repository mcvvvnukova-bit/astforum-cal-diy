#!/bin/bash
set -euo pipefail
cd /home/testing-user/confirmation-email-fix
parent=astforum/cal-diy:b40981cbcf6a
test "$(docker image inspect "$parent" --format '{{.Id}}')" = sha256:2e88994648514deadb588b0b141c471b4521b32fb6925c2ef5f7fc30673e4b57
name=cal-confirmation-build-db
swap_file="$PWD/build.swap"
created=false
cleanup() {
  result=$?
  if test "$created" = true; then docker rm -fv "$name" >/dev/null 2>&1 || true; fi
  if swapon --show=NAME --noheadings | grep -Fxq "$swap_file"; then swapoff "$swap_file"; fi
  if test -f "$swap_file"; then rm -- "$swap_file"; fi
  echo "$result" > build.exit
}
trap cleanup EXIT
test ! -e "$swap_file"
fallocate -l 8G "$swap_file"
chmod 600 "$swap_file"
mkswap "$swap_file" >/dev/null
swapon "$swap_file"
docker run -d --name "$name" --memory 384m --cpus 1 -e POSTGRES_USER=build -e POSTGRES_DB=build -e POSTGRES_PASSWORD=disposable-build-only -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
created=true
for attempt in {1..30}; do
  if docker exec "$name" pg_isready -U build -d build >/dev/null; then break; fi
  sleep 1
done
docker exec "$name" pg_isready -U build -d build >/dev/null
port=$(docker port "$name" 5432/tcp | cut -d: -f2)
url="postgresql://build:disposable-build-only@127.0.0.1:$port/build"
docker run --rm --network host --memory 768m --cpus 1 -e "DATABASE_URL=$url" -e "DATABASE_DIRECT_URL=$url" --entrypoint /calcom/node_modules/.bin/prisma "$parent" migrate deploy --schema /calcom/packages/prisma/schema.prisma
docker build --network host --progress plain -f Dockerfile.release --build-arg "BUILD_DATABASE_URL=$url" -t astforum/cal-diy:confirmation-email-candidate .
