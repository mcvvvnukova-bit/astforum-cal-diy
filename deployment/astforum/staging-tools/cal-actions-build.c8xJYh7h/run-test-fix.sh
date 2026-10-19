#!/bin/bash
set -uo pipefail
stage=/home/testing-user/cal-actions-build.c8xJYh7h
container=cal-actions-tests-c8xJYh7h
sudo docker cp "$stage/test-fix.tar.gz" "$container:/tmp/test-fix.tar.gz" || exit 1
sudo docker exec "$container" tar -xzf /tmp/test-fix.tar.gz -C /calcom || exit 1
sudo docker exec -w /calcom -e TZ=UTC -e NODE_ENV=test "$container" ./node_modules/.bin/vitest run --config vitest-actions.mts apps/web/modules/bookings/components/BookEventForm/BookEventForm.demo.test.tsx apps/web/modules/bookings/components/AvailableTimes.demo.test.tsx apps/web/modules/bookings/components/DemoSlotPresentation.test.tsx apps/web/modules/bookings/components/EventMeta.demo.test.tsx
tests=$?
sudo docker exec -w /calcom "$container" ./node_modules/.bin/biome check --diagnostic-level=error apps/web/modules/bookings/components/BookEventForm/BookEventForm.demo.test.tsx apps/web/modules/bookings/components/AvailableTimes.demo.test.tsx
lint=$?
printf 'Tests exit: %s; Biome exit: %s\n' "$tests" "$lint"
if test "$tests" = 0 && test "$lint" = 0; then outcome=0; else outcome=1; fi
printf '%s\n' "$outcome" > "$stage/test-fix.exit"
exit "$outcome"
