STANDING POLICY (human: "expedite getting stuff onto the phone as soon as it's ready"):
- Each Android lane owns one bookmark marking its phone-ready head: engine lane -> android-engine, UI lane -> android-ui, library lane -> android-library. (Orchestrator bootstrapped them at mnkoz / qyorx / nkzqp.)
- As soon as ANY change is phone-visible and builds+passes your quick checks, move your bookmark (`jj bookmark set android-<x> -r <change>`) and run `/Users/murtaza/manadj/.editspace/bin/phone-build "<short note>"`. It merges all three bookmarks in a dedicated build workspace, builds dev.murt.manadj with the shared key, installs on the human's phone (auto-reconnects via mdns) and launches it. Don't wait for full milestones or parking; small increments are wanted.
- Exit 2 = merge conflict between lanes' heads: the lane that just moved rebases onto the other lane's bookmark and retries. Exit 4 = phone offline: mail orchestrator.
- After installing, mail orchestrator a one-line "on phone: <what to try>" so the human hears about it.
- Do not install anything else on the phone. Never rewrite another lane's bookmark.

## 2026-10-15 updates
- phone-build now installs the optimized `phone` variant (`:app:assemblePhone`, R8, not debuggable, baseline profile; same app id + shared key). `run-as` no longer works on the phone — install a debug APK yourself only if you truly need phone files, then re-run phone-build.
- Install hold: while `.editspace/android/phone-install.hold` exists, phone-build only builds (log `HELD`), never installs. Only the orchestrator lifts it.
