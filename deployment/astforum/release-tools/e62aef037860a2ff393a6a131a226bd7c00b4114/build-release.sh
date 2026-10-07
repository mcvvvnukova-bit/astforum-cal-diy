#!/bin/bash
set -euo pipefail
release_dir=${1:?Release directory required}
revision=${2:?Commit required}
[[ "$release_dir" =~ ^/home/testing-user/cal-reminders-build\.[A-Za-z0-9]+$ ]] || exit 2
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
cd "$release_dir"
parent=astforum/cal-diy:91c17f5baad6
test "$(sudo -n docker image inspect "$parent" --format '{{.Id}}')" = 'sha256:5ddaf76713b3a82054f63529f6c4319b6ced8c57bef54c92c53fd45ef4841137'
build_name="$(basename "$release_dir")"
swap_file="$release_dir/build.swap"
db_created=false
cleanup() {
  outcome=$?
  if test "$db_created" = true; then sudo -n docker rm -fv "$build_name" >/dev/null 2>&1 || true; fi
  if sudo -n swapon --show=NAME --noheadings | grep -Fxq "$swap_file"; then sudo -n swapoff "$swap_file"; fi
  if test -f "$swap_file"; then sudo -n rm -- "$swap_file"; fi
  printf '%s\n' "$outcome" > "$release_dir/build.exit"
}
trap cleanup EXIT
sudo -n fallocate -l 8G "$swap_file"
sudo -n chmod 600 "$swap_file"
sudo -n mkswap "$swap_file" >/dev/null
sudo -n swapon "$swap_file"
sudo -n docker run -d --name "$build_name" --memory 384m --cpus 1 \
  -e POSTGRES_USER=build -e POSTGRES_DB=build -e POSTGRES_PASSWORD=disposable-build-only \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
db_created=true
for attempt in {1..30}; do
  if sudo -n docker exec "$build_name" pg_isready -U build -d build >/dev/null; then break; fi
  sleep 1
done
sudo -n docker exec "$build_name" pg_isready -U build -d build >/dev/null
port=$(sudo -n docker port "$build_name" 5432/tcp | cut -d: -f2)
[[ "$port" =~ ^[0-9]+$ ]] || exit 2
build_database_url="postgresql://build:disposable-build-only@127.0.0.1:$port/build"
sudo -n docker run --rm --network host --memory 768m --cpus 1 \
  -e "DATABASE_URL=$build_database_url" -e "DATABASE_DIRECT_URL=$build_database_url" \
  --entrypoint /calcom/node_modules/.bin/prisma "$parent" \
  migrate deploy --schema /calcom/packages/prisma/schema.prisma
sudo -n docker build --network host --progress plain -f Dockerfile.release \
  --build-arg "BUILD_DATABASE_URL=$build_database_url" --build-arg "VCS_REF=$revision" \
  -t "astforum/cal-diy:${revision:0:12}" .
sudo -n docker image inspect "astforum/cal-diy:${revision:0:12}" --format '{{.Id}} {{json .Config.Cmd}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
