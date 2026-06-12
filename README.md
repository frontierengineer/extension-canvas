# Canvas — an infinite whiteboard for Frontier

Canvas is a zoomable, pannable whiteboard you open as a tab. You drop draggable post-its and colored areas anywhere on an unbounded plane and arrange them spatially — the way you'd lay cards out on a real wall — for planning, grouping, and freeform notes. A minimap tracks where you are in the larger space, you can keep several named canvases side by side, and the whole layout (positions, colors, zoom, pan) lives in the extension's own durable Store so it's there when you come back.

This is a browser-only extension: everything runs in the `ui/` half. There's no server, worker, MCP, or hooks component — the canvas reads and writes its layout through the host's `services.store`, and the host renders the tab and the sidebar around it. The sidebar lists your canvases and lets you create, rename, and delete them; the view is the canvas itself.

## What's in here

- `ui/index.tsx` — the entry: registers the Canvas view (the tab), the sidebar section, and the `canvas.new` command, and wires the per-tab label.
- `ui/components/` — the React surface: the canvas plane, post-its, colored areas, the minimap, and the sidebar list.
- `ui/useCanvasStore.ts` / `ui/data.ts` — a Zustand store over the host Store; `data.ts` is the thin read/write layer against `services.store`.
- `ui/types.ts` — canvas's OWN layout types (post-it/area/viewport shapes). Not to be confused with the host contract, which is `../../types`.
- `ui/styles.css` — the canvas's styles, layered over the host's theme tokens.
- `extension.json` — `displayName`, `defaultColor`, `description`. Canvas keeps no schema version because it has no server-side migration; the layout is self-describing and forward-tolerant.

## How types resolve (important for a standalone repo)

The ui imports the host contract as `import type … from '../../types'` — the exact specifier an installed extension uses. In production the host copies the extension into `<FRONTIER_DIR>/extensions/<id>/` and writes a `types.ts` shim one level up (a sibling of every extension), so `../../types` from `ui/index.tsx` resolves to `extensions/types.ts`, and `../../../types` from a file under `ui/components/` resolves to the same place. This repo is a flat, standalone extension (the `extension.json` is at the root), so there is no host beside it and `../../` from the ui would point above the repo. To stay byte-identical to an installed extension, the contract is vendored at the repo root — [`types.ts`](./types.ts) (a verbatim copy of the host's `backend/extensions/types.ts`, plus a one-block header) and [`workspaceTypes.ts`](./workspaceTypes.ts) (its one dependency). The imports are type-only, so esbuild erases them from the shipped bundle — nothing vendored ends up at runtime. To keep current with the host, re-copy those two files when the API moves.

The ui also imports `usePreviewClick` from `@frontierengineer/ui`, the host's shared UI primitives. The host bundler aliases that specifier to its own frontend tree at build time, so the bytes never ship here; for the local typecheck the surface this extension uses is declared in [`hostUi.d.ts`](./hostUi.d.ts), pointed at via `paths` in the verify mirror's ui tsconfig and marked external for esbuild.

Because TypeScript and esbuild won't remap a relative specifier, `npm run verify` reproduces the production directory nesting in a throwaway `.verify/` mirror (the vendored `types.ts` as a sibling of a `canvas` dir that symlinks this repo) and runs the checks from there — so `../../types` resolves exactly as the host resolves it, with no edits to the source.

## Verifying

```
npm install      # dev-only: TypeScript, esbuild, zustand, and @types for the local checks
npm run verify   # typecheck (ui) against the production-nested mirror, then esbuild the entry the way the host's bundler does
```

`npm run verify` is the full gate; `npm run build:check` runs just the esbuild pass. None of this is needed to use the extension — the Frontier host builds the real bundle itself when it loads the extension; these scripts only let you confirm it compiles and bundles before you publish.

## Installing from the marketplace

Open the Extensions view in Frontier, switch to the Marketplace tab, find **Canvas**, and install — the host fetches the published tarball, verifies its pinned hash, installs it under `extensions/canvas/`, and the Canvas tab and sidebar appear. No configuration needed.

## Publishing

Publishing is open and unreviewed-by-humans: tag a release and the marketplace indexer picks it up. See the registry's [`PUBLISHING.md`](https://github.com/frontierengineer/extensions/blob/main/PUBLISHING.md). [`.github/workflows/release.yml`](./.github/workflows/release.yml) packs the extension into `extension.tgz` (minus `.git`, `.github`, `node_modules`, `data`, and the local-only `.verify`) and attaches it to a GitHub release; the registry then scans that exact tarball, pins its sha256 into `index.json`, and it's installable from the Marketplace tab.

```
git tag v1.0.0 && git push origin v1.0.0
```
