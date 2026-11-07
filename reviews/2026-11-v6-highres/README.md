# Completed v6 review backup

`review-progress-r826.json` is a byte-for-byte copy of the user's completed
export, SHA-256:
`89db8e592a33780b18099f80912ae9b9564abacdfa294093c44d38ba5a6adbb5`.

The checkpoint was replay-validated against the exact immutable v6 baseline,
including manual partial-coverage confirmations. It contains 826 revisions,
837 history events, zero pending entries, 651 refined inherited holds, 26 removed
inherited holds and 146 new holds: **797 active confirmed geometries**.

`confirmed-geometry.json` is a derived geometry snapshot for the same image;
`summary.json` records counts and identity. The full checkpoint retains reviewer,
lineage, observation evidence and before/after history. Source image SHA-256:
`d77c50fc3856998546edcb56645d71183f8942294c4c2653154d3d7c6facc396`.

This backup does not change the production wall/catalog. Any seam experiment is
a separate image; these saved approvals remain tied to the reviewed v6 image.
