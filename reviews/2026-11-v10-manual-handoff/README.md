# v10 manual review handoff

The user accepted the added holds but noticed possible omissions and requested an
editable review page before publication. The assistant-reviewed candidate archive
remains immutable; the human review starts from its complete checkpoint, not the
pending baseline or raw SAM2 proposals.

- Candidate: `2026-11-v10`, 858 active holds, review revision 861.
- Session: `cd90c58363c97e04fb4fb0a1143ae842b8c850fd6661149109a465ab8283e2b3`.
- Exact image SHA-256: `ab074cd9e5d0b20c9e6ecb7bf77a005f845c216623197e23ce9d3ab9300165af`.
- Starting checkpoint SHA-256: `c197c9d2cdc3e40ccfd4cf3ac3e142e58543d2f1bda240f628a55155caeaff0f`.

The annotation server and server-file loader now include an optional
`review-progress.json`. The browser validates and replays it against the exact
baseline. Existing newer browser progress is preserved. A human continuing an
assistant checkpoint must enter their own reviewer name; the UI no longer fills
in the assistant's name for them.

The temporary Vercel Sandbox uses the existing verified SAM2 environment and a
private, same-origin access cookie. Its access key is kept outside the repository.
The server exposes only the immutable starting checkpoint. Human edits stay in
browser IndexedDB and must be exported before archiving or publication.

## Continue annotating

1. Open the private session link, then choose **Open local server scan**.
2. Wait for the full checkpoint to load and enter your reviewer name.
3. To add a missed hold, choose **New hold / Clear**, then either **Draw polygon**
   and **Finish polygon**, or add positive/negative prompts and use **Generate mask**.
   **Confirm** / **Confirm new hold** saves the draft decision in this browser.
4. To correct an existing outline, choose the saved hold and **Edit selected**.
5. Export through **Session, reviewer & backups → Export progress** periodically
   and at completion. Keep the original browser data until the export is verified.

Production remains v9. No route migration or database writes are part of this
handoff. Validation uses an isolated browser profile; test decisions are never
part of the user's session or the server checkpoint.
