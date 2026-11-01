# Backend

Small TypeScript Lambda used by the shared spray-wall API.

`walls.json` is the source-of-truth registry for backend-visible wall versions.
`npm run build` reads each wall's canonical frontend hold JSON, validates unique
hold IDs, generates `src/generated/wallCatalog.ts`, and bundles `src/handler.ts`
to `dist/index.js`.

The generated catalog is intentionally ignored by git; it is a build artifact and
must always be reproducible from committed wall data.
