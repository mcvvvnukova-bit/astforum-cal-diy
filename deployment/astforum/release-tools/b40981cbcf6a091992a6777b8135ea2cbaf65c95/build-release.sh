#!/bin/bash
set -euo pipefail
release_dir=${1:?Release directory required}
revision=${2:?Commit required}
[[ "$release_dir" =~ ^/home/testing-user/cal-days-build\.[A-Za-z0-9]+$ ]] || exit 2
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
cd "$release_dir"
parent=astforum/cal-diy:a1a976c5e3fc
test "$(sudo docker image inspect "$parent" --format '{{.Id}}')" = 'sha256:ae6994656ae304cff864c4e4c92ba1067da44e6617dfa2b0e483d654314354d3'
build_name="$(basename "$release_dir")"
swap_file="$release_dir/build.swap"
db_created=false
cleanup() {
  outcome=$?
  if test "$db_created" = true; then sudo docker rm -fv "$build_name" >/dev/null 2>&1 || true; fi
  if sudo swapon --show=NAME --noheadings | grep -Fxq "$swap_file"; then sudo swapoff "$swap_file"; fi
  if test -f "$swap_file"; then sudo rm -- "$swap_file"; fi
  printf '%s\n' "$outcome" > "$release_dir/build.exit"
}
trap cleanup EXIT
test ! -e "$swap_file"
sudo fallocate -l 8G "$swap_file"
sudo chmod 600 "$swap_file"
sudo mkswap "$swap_file" >/dev/null
sudo swapon "$swap_file"
sudo docker run -d --name "$build_name" --memory 384m --cpus 1 \
  -e POSTGRES_USER=build -e POSTGRES_DB=build -e POSTGRES_PASSWORD=disposable-build-only \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
db_created=true
for attempt in {1..30}; do
  if sudo docker exec "$build_name" pg_isready -U build -d build >/dev/null; then break; fi
  sleep 1
done
sudo docker exec "$build_name" pg_isready -U build -d build >/dev/null
port=$(sudo docker port "$build_name" 5432/tcp | cut -d: -f2)
[[ "$port" =~ ^[0-9]+$ ]] || exit 2
build_database_url="postgresql://build:disposable-build-only@127.0.0.1:$port/build"
sudo docker run --rm --network host --memory 768m --cpus 1 \
  -e "DATABASE_URL=$build_database_url" -e "DATABASE_DIRECT_URL=$build_database_url" \
  --entrypoint /calcom/node_modules/.bin/prisma "$parent" \
  migrate deploy --schema /calcom/packages/prisma/schema.prisma
sudo docker build --network host --progress plain -f Dockerfile.release \
  --build-arg "BUILD_DATABASE_URL=$build_database_url" --build-arg "VCS_REF=$revision" \
  -t "astforum/cal-diy:${revision:0:12}" .
sudo docker image inspect "astforum/cal-diy:${revision:0:12}" --format '{{.Id}} {{json .Config.Cmd}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
