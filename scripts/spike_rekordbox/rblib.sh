#!/bin/zsh
# Rekordbox library slot manager for the performance-write spike
# (performance-data-sync/09). Swaps the live library dir between the real
# library and a minimal test library, with immutable snapshots.
#
#   rblib.sh status              which library is live; list slots/snapshots
#   rblib.sh snapshot <name>     APFS-clone live dir -> snapshots/<ts>-<name>
#   rblib.sh use-test            stash real -> slots/real, move slots/test in (if any)
#   rblib.sh use-real            stash test -> slots/test, restore slots/real
#   rblib.sh mark-test           write test-library marker into live dir
#
# The marker file (.manadj-test-library) is how every spike tool tells the
# test library from the real one. Write tools refuse to run without it.

set -euo pipefail

LIVE="$HOME/Library/Pioneer/rekordbox"
SLOTS="$HOME/Library/Pioneer/rekordbox-slots"
SNAPS="$HOME/Library/Pioneer/rekordbox-snapshots"
MARKER=".manadj-test-library"

die() { print -u2 "error: $*"; exit 1 }

require_rb_closed() {
  if pgrep -qif 'rekordbox'; then
    die "rekordbox is running — quit it first"
  fi
}

live_kind() {
  [[ -d "$LIVE" ]] || { print "absent"; return }
  [[ -f "$LIVE/$MARKER" ]] && print "test" || print "real"
}

cmd_status() {
  print "live:      $LIVE -> $(live_kind)"
  for slot in real test; do
    [[ -d "$SLOTS/$slot" ]] && print "slot:      $slot ($(du -sh "$SLOTS/$slot" | cut -f1))"
  done
  if [[ -d "$SNAPS" ]]; then
    for s in "$SNAPS"/*(N/); do print "snapshot:  ${s:t}"; done
  fi
}

cmd_snapshot() {
  local name="${1:?snapshot name required}"
  require_rb_closed
  [[ -d "$LIVE" ]] || die "no live library at $LIVE"
  mkdir -p "$SNAPS"
  local dest="$SNAPS/$(date +%Y%m%d-%H%M%S)-$name"
  # -c: APFS clonefile — instant, no extra space until divergence
  cp -Rc "$LIVE" "$dest"
  print "snapshot: $dest ($(live_kind) library)"
}

cmd_use_test() {
  require_rb_closed
  local kind=$(live_kind)
  [[ "$kind" == "test" ]] && { print "already on test library"; return }
  mkdir -p "$SLOTS"
  if [[ "$kind" == "real" ]]; then
    [[ -e "$SLOTS/real" ]] && die "slots/real already exists; refusing to clobber"
    mv "$LIVE" "$SLOTS/real"
    print "stashed real library -> $SLOTS/real"
  fi
  if [[ -d "$SLOTS/test" ]]; then
    mv "$SLOTS/test" "$LIVE"
    print "test library is live"
  else
    print "no test slot: live dir is absent — launch rekordbox to create a"
    print "fresh library, quit it, then run: rblib.sh mark-test"
  fi
}

cmd_use_real() {
  require_rb_closed
  [[ -d "$SLOTS/real" ]] || die "no stashed real library at $SLOTS/real"
  local kind=$(live_kind)
  if [[ "$kind" == "real" ]]; then print "already on real library"; return; fi
  if [[ "$kind" == "test" ]]; then
    [[ -e "$SLOTS/test" ]] && die "slots/test already exists; refusing to clobber"
    mv "$LIVE" "$SLOTS/test"
    print "stashed test library -> $SLOTS/test"
  elif [[ "$kind" == "absent" ]]; then
    : # nothing live to stash
  else
    die "live dir exists but is neither marked test nor absent — inspect manually"
  fi
  mv "$SLOTS/real" "$LIVE"
  print "real library is live"
}

cmd_mark_test() {
  [[ -d "$LIVE" ]] || die "no live library at $LIVE"
  [[ -d "$SLOTS/real" ]] || die "real library is not stashed — refusing to mark (is this the real one?)"
  date > "$LIVE/$MARKER"
  print "marked live library as test"
}

case "${1:-}" in
  status)    cmd_status ;;
  snapshot)  shift; cmd_snapshot "$@" ;;
  use-test)  cmd_use_test ;;
  use-real)  cmd_use_real ;;
  mark-test) cmd_mark_test ;;
  *)         die "usage: rblib.sh status|snapshot <name>|use-test|use-real|mark-test" ;;
esac
