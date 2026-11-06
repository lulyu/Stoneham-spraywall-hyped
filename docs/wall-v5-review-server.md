# Review v5 suggestions with live SAM2

The archived v5 JPEG and its 639 SAM2 proposals now open in the existing review
workspace. The candidate and all inherited v4 entries remain unapproved until a
reviewer explicitly records a decision. This does not publish v5 or migrate routes.

## Prepare and serve

Install the SAM2 CPU environment and the verified SAM2.1 Small checkpoint using
[the existing setup](sam2-top-left-experiment.md#reproduce-python-312-tested).
The checkpoint SHA-256 must be
`6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38`.
From the repository root:

```sh
npm ci
npm run build
python -m tools.wall_rescan.candidate_review \
  --output artifacts/wall-rescans/v5-review-session
python tools/sam2_annotation_server.py \
  --rescan-session artifacts/wall-rescans/v5-review-session \
  --checkpoint /path/to/sam2.1_hiera_small.pt --port 8790
```

Use the Python environment containing SAM2 for both Python commands. Choose an
empty output folder; an existing review bundle is never overwritten. To use
manual editing without model inference, substitute `--review-only` for the
checkpoint argument. Raw captures and the original Phase B output are not needed
to open this archived candidate.

Open `http://127.0.0.1:8790/?review=1`, then **Open local server scan**. This
server hosts the built frontend and SAM2 on the same origin. It checks CUDA and
falls back to CPU, with cached regional embeddings. Browser-only use is also
supported by selecting all files from the prepared review folder.

For an explicitly authorized temporary HTTPS proxy, add `--access-key-file` with
a private file containing at least 32 random URL-safe characters. Enter via
`https://HOST/auth?key=KEY`. Authentication sets a Secure, HttpOnly cookie; all
assets and API endpoints require it. Keep the private link private. Authentication
links are excluded from server logs. Stop the server and proxy when finished;
this is a temporary process, not durable hosting.

## Review workflow

1. Enter your reviewer name in the always-visible field above the wall. If it
   is missing, confirmation buttons focus that field and explain what is needed,
   rather than silently disabling. Reopening saved progress restores the latest
   reviewer name; it remains an editable local history label.
2. Choose **Next pending hold**, or select an entry and **Edit selected**.
   The primary **Next pending hold** and **Confirm** buttons sit side by side
   directly below the wall. Next immediately loads the saved SAM2 suggestion,
   without an inference request or approval. Confirm explicitly saves that outline.
   Editing and rerun controls follow below. **Auto-run SAM2 on next hold** is
   optional and defaults off for v5 bundles; enable it to request fresh masks.
   Prediction never records an approval.
3. Compare **Old wall**, **New scan** and **Overlay**. Decisions are disabled in
   comparison modes; return to New scan to edit.
4. **Load SAM2 suggestion** copies its outline into the editable draft. Loading
   alone records no decision. Inspect shared-proposal warnings: one mask can be
   associated with multiple old holds. Toggle **Show SAM2 suggestions** to inspect
   all still-pending proposals; **Restore saved outline** discards the draft.
5. Adjust vertices, or use positive/negative points and a box, then **Generate
   mask** for a fresh prediction against this exact v5 image. Model unavailability
   leaves manual drawing and saved proposals usable.
6. **Confirm corrected outline** retains the old identity. If it is a physically
   different/moved hold, use **Different / moved hold?** and confirm replacement
   to assign a fresh ID. **Confirm unchanged** preserves the original geometry.
7. Export progress regularly. Decisions are stored in this browser, not on the
   Python server. Reload and reopen the bundle to restore local history; to move
   devices or temporary hostnames, explicitly resume the exported checkpoint.

### Bulk confirmation

Set **Minimum SAM2 score** (default 0.95), enter your reviewer name, then click
**Confirm eligible SAM2 outlines (N)**. The count updates with the threshold and
existing decisions. This explicitly adopts the saved SAM2 contours as refinements
with the original inherited IDs; it does not confirm the old outline unchanged.
Batch scoring uses the archived, hash-bound proposals, not the latest interactive
mask score. Only still-pending, fully observed, unambiguous proposals with no
uncertainty pixels and a possible-unchanged/suggested-refinement recommendation
qualify. Shared masks, duplicate associations and alignment/change warnings stay
pending even at a high model score.

The user-requested bulk action checks actual polygon coverage for every candidate
before saving anything, records ordinary per-entry reviewer/history decisions,
then performs one guarded storage write. Coverage, quota or stale-tab failures
leave the whole batch unsaved and available for retry. Checkpoints replay the
individual decisions normally; use Reset decision to undo individual entries.
All results remain non-publishable.

The session binds the exact JPEG, reference/map, coverage, uncertainty, proposal
file and candidate manifest hashes. The original Phase B session is deliberately
distinct: its checkpoints cannot approve this reference-filled JPEG. Tampered
proposal files, inherited geometry and unknown associations are rejected.

New-photo coverage is still 92.0973%; reference-filled gaps remain unobserved.
Existing coverage restrictions block confirmations/removals in insufficiently
observed regions and reject corrected/new outlines crossing gaps. No usable model
mask means no suggestion, not proof of removal. Alignment QA remains unresolved;
these proposals do not search entirely new positions or resolve physical identity.
Review checkpoints remain `publishable: false`.

## Verification

```sh
npm test
npm run build
python -m unittest discover -s tests/wall_rescan -v
PLAYWRIGHT_MODULE_PATH=/path/to/playwright CHROMIUM_PATH=/path/to/chromium \
  APP_URL=http://127.0.0.1:8790 node scripts/v5-review-smoke.cjs
```

For a protected local server, set `AUTH_KEY_FILE` to the private key file. The
browser test uses isolated storage and real SAM2 inference. It checks all 639
proposals load, loading does not approve, explicit correction retains the old ID,
comparison locks, image/session mismatch rejection, checkpoint export/reload,
mobile layout and absence of legacy annotation writes. It writes
`artifacts/v5-review-mobile.png`; test review decisions do not modify production.

For a remote Sandbox URL, set `APP_URL` to its HTTPS origin. In a managed test
environment with an outbound proxy, set `BROWSER_PROXY` to that proxy. If its CA
is trusted by Node via `NODE_EXTRA_CA_CERTS` but not by Chromium, also set
`BROWSER_FETCH_PROXY=1`; Playwright then fetches HTTPS resources through its Node
transport with certificate validation still enabled. Access keys are redacted
from test failure output. These settings affect the test harness only.

Quick-review mobile regression: run `node scripts/v5-quick-review-smoke.cjs` with
the same APP_URL, AUTH_KEY_FILE and optional proxy variables. It checks adjacent
buttons directly below the wall, immediate cached suggestions without inference,
missing-name focus/explanation, confirmation, name/history restore and layout.
