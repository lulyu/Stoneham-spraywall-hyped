# Polygon hold candidates

This directory contains an **experimental** polygon-native detection pass generated from Lu's manually adjusted 7292×5514 canonical wall image.

Important: these candidates are not yet wired into the current local prototype and their IDs are not stable. The existing circular dataset was generated from an earlier image, so do not treat matching numeric IDs as identity matches.

The intended v1 canonical representation is:

```ts
{
  id: string,
  center: [number, number],       // normalized [0, 1]
  polygon: [number, number][],    // normalized [0, 1], max 16 vertices
  kind: 'hold' | 'macro' | 'volume'
}
```

The automatic detector is only a bootstrap. Final hold geometry should be corrected in the wall-editor UI before the dataset becomes canonical.
