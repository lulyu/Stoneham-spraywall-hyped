# Canonical production hold geometry

`holds.json` is the app's authoritative 677-hold dataset, promoted from the user's
`full_wall_manual_v4.json` accepted export. IDs, centers, kinds and polygon vertices
are preserved exactly. Coordinates are normalized against the 7292×5514 canonical
wall image. The index exports typed polygons for the app.

Old circular maps, partial polygon samples and packed automatic candidates were
removed. Earlier versions remain accessible through Git history; there are no
old production hold files or backups in this directory. Annotation checkpoints,
ground truth and experimental suggestions remain separately documented.

The build validates unique IDs, count, kinds, finite coordinate bounds and polygon
vertex limits. Edit existing holds while preserving their IDs.

The app now uses local route storage `stoneham-spraywall:problems:v3` because the
old `h001`-style IDs do not identify these confirmed holds. Previous v2 routes are
left under their original browser key and are not automatically remapped.

SAM2 experiment scripts seed prompts from this JSON by default. Historical run
counts in experiment documentation refer to the old automatic input; reproduce
those exact runs from the corresponding historical Git commit.
