#!/bin/bash
set -euo pipefail
release_dir=${1:?Release directory required}
revision=${2:?Commit required}
case "$release_dir" in /home/testing-user/cal-display-build.*) ;; *) exit 2 ;; esac
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
cd "$release_dir"
expected_parent='sha256:9ac505d613f0864ef9338f3b88d27a6502b0125e9fcb3f019bef440640646365'
test "$(sudo docker image inspect astforum/cal-diy:1cc628cb98e5 --format '{{.Id}}')" = "$expected_parent"
build_name="$(basename "$release_dir")"
swap_file="$release_dir/build.swap"
cleanup() {
  outcome=$?
  sudo docker rm -f "$build_name" >/dev/null 2>&1 || true
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
for attempt in {1..30}; do
  if sudo docker exec "$build_name" pg_isready -U build -d build >/dev/null; then break; fi
  sleep 1
done
sudo docker exec "$build_name" pg_isready -U build -d build >/dev/null
port=$(sudo docker port "$build_name" 5432/tcp | cut -d: -f2)
[[ "$port" =~ ^[0-9]+$ ]] || exit 2
build_database_url="postgresql://build:disposable-build-only@127.0.0.1:$port/build"
# Initialize this throwaway DB on every invocation, outside Docker's layer cache.
sudo docker run --rm --network host --memory 768m --cpus 1 \
  -e "DATABASE_URL=$build_database_url" -e "DATABASE_DIRECT_URL=$build_database_url" \
  --entrypoint /calcom/node_modules/.bin/prisma astforum/cal-diy:1cc628cb98e5 \
  migrate deploy --schema /calcom/packages/prisma/schema.prisma
sudo docker build --network host --progress plain -f Dockerfile.release \
  --build-arg "BUILD_DATABASE_URL=$build_database_url" \
  --build-arg "VCS_REF=$revision" -t "astforum/cal-diy:${revision:0:12}" .
sudo docker image inspect "astforum/cal-diy:${revision:0:12}" --format '{{.Id}} {{json .Config.Labels}}'
