# Repository language

Write repository documentation and new code comments in English, even when the
conversation with the user is in Chinese.

# Stoneham wall updates

When the user supplies a new set of wall photographs, use their preferred
[wall-update workflow](docs/wall-update-workflow.md). Register and stitch into the
previous accepted wall's frame, provide aligned image/GIF comparisons, prompt
SAM2 for every previous hold from a 20%-contracted polygon, supplement new holds,
and prepare human review and a final missing-hold check.

Review decisions currently live in the reviewer's browser (IndexedDB), not on
the SAM2 server. Obtain and validate the final exported checkpoint before claiming
that completed annotations are archived or using them as the next accepted map.
Keep candidate suggestions separate from accepted geometry and publication.
