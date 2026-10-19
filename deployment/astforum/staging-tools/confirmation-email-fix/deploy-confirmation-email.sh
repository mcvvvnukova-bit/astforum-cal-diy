#!/bin/bash
set -euo pipefail
cd /home/testing-user/confirmation-email-fix
revision=91c17f5baad61d7f729a37dc437f00eb54628401
image=astforum/cal-diy:91c17f5baad6
root=/opt/astforum-cal-diy
base="$root/source/deployment/astforum/compose.yaml"
release="$root/releases/$revision"
previous=astforum/cal-diy:b40981cbcf6a
test "$(docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}}')" = "$previous"
test "$(cat build.exit)" = 0
test ! -e "$release"
umask 077
mkdir -p "$release"
backup="$root/backups/confirmation-email-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
cp "$root/.env" "$backup/runtime.env"
cp "$base" "$backup/compose.yaml"
cp "$root/releases/b40981cbcf6a091992a6777b8135ea2cbaf65c95/web-command.override.yaml" "$backup/previous.override.yaml"
python3 - "$backup" <<'PY'
import sys, json, pathlib, subprocess
ids = subprocess.check_output(['docker', 'ps', '-q'], text=True).split()
items = json.loads(subprocess.check_output(['docker', 'inspect', *ids], text=True))
safe = [{'name': c['Name'], 'id': c['Id'], 'image': c['Config']['Image'], 'startedAt': c['State']['StartedAt']} for c in items]
pathlib.Path(sys.argv[1], 'containers.before.json').write_text(json.dumps(safe, indent=2))
PY
cat > Dockerfile.pin <<'DOCKER'
FROM astforum/cal-diy:confirmation-email-candidate
LABEL org.opencontainers.image.revision=91c17f5baad61d7f729a37dc437f00eb54628401
DOCKER
docker build -f Dockerfile.pin -t "$image" .
cat > "$release/web-command.override.yaml" <<'YAML'
services:
  web:
    image: astforum/cal-diy:91c17f5baad6
    command: ["yarn", "start"]
YAML
python3 - "$root/.env" "$image" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
lines = p.read_text().splitlines()
assert sum(line.startswith('CALDIY_IMAGE=') for line in lines) == 1
p.write_text('\n'.join('CALDIY_IMAGE=' + sys.argv[2] if line.startswith('CALDIY_IMAGE=') else line for line in lines) + '\n')
PY
docker compose --env-file "$root/.env" -f "$base" -f "$release/web-command.override.yaml" config -q
docker compose --env-file "$root/.env" -f "$base" -f "$release/web-command.override.yaml" up -d --no-deps web
echo "Backup: $backup"
echo "Release: $release"
for attempt in {1..40}; do
  health=$(docker inspect astforum-cal-diy-web-1 --format '{{.State.Health.Status}}')
  if test "$health" = healthy; then
    docker inspect astforum-cal-diy-web-1 --format '{{.Config.Image}} {{.State.Health.Status}}'
    exit 0
  fi
  sleep 3
done
echo 'New web container did not become healthy' >&2
exit 1
