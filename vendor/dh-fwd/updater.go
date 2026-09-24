package main

// NOTE (SENTINEL vendor patch) — the upstream auto-updater has been removed.
//
// Upstream dh-fwd contacts api.github.com on every start to offer a
// self-update (prompting the user, downloading and overwriting its own
// binary). Inside SENTINEL the binary is built once into the Docker image
// and must never phone home or rewrite itself: a self-update would replace
// an audited, pinned binary with unreviewed code at runtime.
//
// checkUpdate is therefore a no-op that always lets the connection proceed.
// The GitHub client, prompt and selfUpdate logic (updater.go in upstream)
// are intentionally not vendored. Version is kept because logger.go stamps
// it into the debug log header.

var Version = "v2.3.1-sentinel"

// checkUpdate is neutralized: no network call, always proceed.
func checkUpdate() bool { return true }
