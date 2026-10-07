#!/bin/bash
set -euo pipefail
umask 077
release=/opt/astforum-cal-diy/releases/c89060d65af82200140de1451867d21f8fb22160
stage=/home/testing-user/cal-slots-build.k8jLNoJS
checks=(
  /home/testing-user/cal-slots-check.bmrKDoY4
  /home/testing-user/cal-slots-check.Ue9jIPu2
  /home/testing-user/cal-slots-check.Hm6Ztnvk
  /home/testing-user/cal-slots-check.WpyEbOyW
  /home/testing-user/cal-slots-check.e2jIuO5J
  /home/testing-user/cal-slots-check.lqUVM8ZG
  /home/testing-user/cal-slots-check.sUA2Je3O
  /home/testing-user/cal-slots-check.CEGOz7In
  /home/testing-user/cal-slots-check.9eWEKT02
  /home/testing-user/cal-slots-check.McGvqwju
  /home/testing-user/cal-slots-check.si4tTwIw
  /home/testing-user/cal-slots-check.om5IOvCo
  /home/testing-user/cal-slots-check.TrAjH9Fn
  /home/testing-user/cal-slots-check.zFpcHnI8
  /home/testing-user/cal-slots-check.M348gK6u
)
test -d "$release" && test ! -L "$release"
test -d "$stage" && test ! -L "$stage"
test "$(cat "$stage/build.exit")" = 0
test ! -e "$stage/build.swap"
test -z "$(docker ps -aq --filter name=cal-slots)"
test ! -e "$release/build-stage"
test ! -e "$release/disposable-check-stages"
for check in "${checks[@]}"; do
  test -d "$check" && test ! -L "$check"
  test "$(find "$check" -mindepth 1 -maxdepth 1 -printf '%f\n')" = overlay.tar.gz
  test -f "$check/overlay.tar.gz" && test ! -L "$check/overlay.tar.gz"
done
mkdir -m 700 "$release/disposable-check-stages"
for check in "${checks[@]}"; do
  mv -T -- "$check" "$release/disposable-check-stages/$(basename "$check")"
done
mv -T -- "$stage" "$release/build-stage"
printf 'Archived build stage and %s owned check stages recoverably under %s.\n' "${#checks[@]}" "$release"
