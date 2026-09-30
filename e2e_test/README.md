# e2e_test

Rough Playwright + relay scripts used while fixing sync (2026-09). Not a test suite, just scripts to rerun.

Setup once: `pnpm exec playwright install chromium`

Run against a served build (`pnpm build && pnpm preview --port 5391`, or `pnpm dev --port 5391`):

- `node e2e_test/e2e-sync.mjs` – create board, +1, offline taps, back online, sync sheet
- `node e2e_test/e2e-pending.mjs` – relays unreachable while online -> "Not sent", auto-retry recovers
- `node e2e_test/e2e-2g.mjs` – publish under emulated GPRS (CDP throttling)
- `node e2e_test/e2e-two.mjs` – two phones: invite, join, approve, sync both ways, phone B reopened later
- `node e2e_test/shots.mjs e2e_test/out/before` then `.../after`, compare with `e2e_test/cmp.sh e2e_test/out/before e2e_test/out/after e2e_test/out/diff` (ImageMagick)

Relays (no browser needed):

- `node e2e_test/probe.mjs [wss://relay ...]` – NIP-11, publish kinds 30078/1/0, same-second replacement, fresh-connection read-back, retention hints
- `node e2e_test/burst.mjs wss://relay ...` – 3 rounds of 8 rapid snapshot publishes + read-back (rate limits, web-of-trust rejects)

`BASE` and `OUT` env vars override the app URL and output folder.
