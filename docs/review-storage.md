# Browser checkpoint storage

Review checkpoints now use IndexedDB (`stoneham-wall-reviews`, `checkpoints`)
instead of writing the complete history to localStorage. This fixes batch
confirmation failing when several review sessions exhaust the browser's small
localStorage quota. The quota belongs to the browser origin, independently of
the Vercel account or Sandbox plan.

On opening a scan, the editor validates and copies its existing localStorage
checkpoint into IndexedDB. It leaves the original bytes and other scan sessions
untouched. Later saves go to IndexedDB, after checking the session and current
stored state inside a single read/write transaction. The UI reports success
only after that transaction commits. A failed save leaves the previous state
and the on-screen review revision unchanged, so the operation can be retried.

Web Locks still serialize review operations across tabs. The migration also
records a fingerprint of the legacy checkpoint: if an older build changes
localStorage afterward, saving is blocked until the scan is reopened. Only a
validated forward continuation can migrate; conflicting histories are never
silently merged or overwritten. Unchanged IndexedDB checkpoints can be reopened
without rewriting them. Exports retain the existing review JSON format and
full decision history.

Users should refresh the preview, open the same server scan and retry the failed
batch. They should not clear browser/site data. Export progress remains the
portable backup; browser storage does not synchronize between devices.

Verification passed locally and against the authenticated Vercel preview in
isolated mobile browser contexts. `scripts/review-storage-smoke.cjs` fills
localStorage until it genuinely throws `QuotaExceededError`, seeds a valid
legacy checkpoint, migrates it, confirms a batch, reloads, and exports. It checks
that legacy bytes and the full-storage filler stay unchanged. It also injects
an IndexedDB save failure, verifies rollback/retry, and verifies that a stale
second tab cannot overwrite a newer save. Existing quick review actions also
passed against IndexedDB. The build and frontend tests passed.

To run against a matching review server, provide a valid legacy export for that
exact session (test contexts are isolated from the user's browser):

```sh
APP_URL=http://127.0.0.1:8793 \
LEGACY_CHECKPOINT=/path/to/matching-review-progress.json \
node scripts/review-storage-smoke.cjs
```

The test needs at least one prior decision and multiple eligible pending model
suggestions. It deliberately exercises quota and storage failures only inside
its own temporary browser context.
