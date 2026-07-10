#!/bin/zsh
# Engine DJ library slot manager for the write-path spike
# (library-sync-button/08). Mirrors scripts/spike_rekordbox/rblib.sh:
# swaps the live library dir between the real library and a test library,
# with immutable APFS-clone snapshots.
#
#   enginelib.sh status              which library is live; list slots/snapshots
#   enginelib.sh snapshot <name>     APFS-clone live dir -> snapshots/<ts>-<name>
#   enginelib.sh use-test            stash real -> slots/real, move slots/test in (if any)
#   enginelib.sh use-real            stash test -> slots/test, restore slots/real
#   enginelib.sh mark-test           write test-library marker into live dir
#
# The marker file (.manadj-test-library) is how every spike tool tells the
# test library from the real one. Write tools refuse to run without it.
#
# SYNCTHING: the real Engine Library is a Syncthing folder (.stfolder).
# Pause it in the Syncthing UI before swapping. Moving the dir makes the
# folder marker vanish (Syncthing halts the folder rather than propagating
# deletes — protective, but pausing first is cleaner). The test library
# must NOT contain a .stfolder.

set -euo pipefail

LIVE="$HOME/Music/Engine Library"
SLOTS="$HOME/Music/Engine Library-slots"
SNAPS="$HOME/Music/Engine Library-snapshots"
MARKER=".manadj-test-library"

die() { print -u2 "error: $*"; exit 1 }

require_engine_closed() {
  # Match the app binary only — crashpad_handler processes under
  # Contents/Resources linger after Engine quits and must not count.
  if pgrep -qf 'Engine DJ\.app/Contents/MacOS/Engine DJ'; then
    die "Engine DJ is running — quit it first"
  fi
}

warn_syncthing() {
  if [[ -d "$LIVE/.stfolder" ]] && pgrep -qx syncthing; then
    print -u2 "WARNING: live library is a Syncthing folder and syncthing is running."
    print -u2 "         Pause the folder in the Syncthing UI before swapping."
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
  warn_syncthing
}

cmd_snapshot() {
  local name="${1:?snapshot name required}"
  require_engine_closed
  [[ -d "$LIVE" ]] || die "no live library at $LIVE"
  mkdir -p "$SNAPS"
  local dest="$SNAPS/$(date +%Y%m%d-%H%M%S)-$name"
  # -c: APFS clonefile — instant, no extra space until divergence
  cp -Rc "$LIVE" "$dest"
  print "snapshot: $dest ($(live_kind) library)"
}

cmd_use_test() {
  require_engine_closed
  warn_syncthing
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
    print "no test slot: live dir is absent — launch Engine DJ to create a"
    print "fresh library, quit it, then run: enginelib.sh mark-test"
  fi
}

cmd_use_real() {
  require_engine_closed
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
  [[ -d "$LIVE/.stfolder" ]] && die "live dir has a .stfolder — this looks like the Syncthing-synced real library; refusing"
  date > "$LIVE/$MARKER"
  print "marked live library as test"
}

case "${1:-}" in
  status)    cmd_status ;;
  snapshot)  shift; cmd_snapshot "$@" ;;
  use-test)  cmd_use_test ;;
  use-real)  cmd_use_real ;;
  mark-test) cmd_mark_test ;;
  *)         die "usage: enginelib.sh status|snapshot <name>|use-test|use-real|mark-test" ;;
esac
