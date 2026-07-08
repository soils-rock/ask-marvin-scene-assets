# ask-marvin-scene-assets (CyanoVerse)

Authoring tools for **ask-marvin** scene art:

Workflow
1) image intake,
2) flat-archive ingest (PNG → WebP),
3) scene pair review - UI for pairing backgrounds + foregrounds + Marvin.

Finished scene WebPs, metadata CSVs, and the playable-pairs table live in the **ask-marvin** consumer repo, not here.

- **Consumer repo:** [ask-marvin](https://github.com/bcottraven/ask-marvin) (local clone at `~/ask-marvin`)
- **Playable pairs CSV:** `~/ask-marvin/data/scene_playable_pairs.csv`
- **Metadata CSVs:** `~/ask-marvin/data/scene_background_metadata.csv`, `scene_foreground_metadata.csv`

---

## Repo layout

Two git repos, expected as siblings:

```
~/ask-marvin                              ← consumer app (WebPs, CSVs, registry)
~/CyanoVerse/ask-marvin-scene-assets      ← this repo (authoring tools)
```

`ask-marvin-scene-assets` is a CyanoVerse submodule. Session end scripts (`~/CyanoVerse/macmini-end-session.sh`, `macbook-end-session.sh`) commit and push **ask-marvin-scene-assets**, **Ontology**, **ask-marvin**, and **CyanoVerse** when there are changes — you do not need a separate manual commit for the submodule unless you are working outside that flow.

Raw photo archive (external drive):

```
/Volumes/Marvin/CyanoVerse_Source_Files/
├── Backgrounds_Raw/     ← flat files (no subdirectories)
├── Foregrounds_Raw/     ← flat files; matched pair = same basename in both folders
└── Processed_images/    ← ingested PNGs moved here as {stem}__bg.png / {stem}__fg.png
```

Override paths with env vars if needed (`SCENE_PNG_ARCHIVE`, `ASK_MARVIN_ROOT`, `BACKGROUNDS_RAW_DIR`, `FOREGROUNDS_RAW_DIR`).

---

## First-time setup (Apple Silicon)

Terminal must be **arm64** (not Rosetta `i386`):

```bash
arch
```

If it prints `i386`, start an arm64 shell:

```bash
arch -arm64 zsh
```

Then:

```bash
cd ~/CyanoVerse/ask-marvin-scene-assets
npm install
arch -arm64 npm run reinstall:sharp
```

Run `reinstall:sharp` after every `npm install` on Apple Silicon. Without it, `sharp` may fail with a `darwin-x64` error.

For review/mirror/bake on Rosetta shells, `review:scenes:arm64`, `mirror:foreground:arm64`, and `bake:foreground:arm64` wrap the same scripts under `arch -arm64`.

---

## Image-processing pipeline

End-to-end flow for adding scenes:

### 1. Intake — `npm run intake:images`

Browser tool at **http://127.0.0.1:5175/** (port override: `IMAGE_INTAKE_PORT`).

- Paste a **source folder** path; tool scans images and bins them by capture time (EXIF when available, else file birth/mtime).
- Tag selections as background or foreground per bin; assign a **location name** (slugged for filenames).
- **Copy** (never overwrite) into flat archive folders:
  - Backgrounds → `Backgrounds_Raw/{location-slug}-{n}.jpg`
  - Foregrounds → `Foregrounds_Raw/{location-slug}-{cycleLetter}-{n}.jpg` (requires at least two foreground picks per save)

No subdirectories. Existing targets with the same name are skipped (collision-safe).

### 2. Photoshop — manual (required)

Not automated. In Photoshop (or equivalent):

- Process/stack images to **1920×1080 PNGs** in `Backgrounds_Raw` and `Foregrounds_Raw`.
- Background and foreground for a scene must share the **same basename** (e.g. `Atacama-1.png` in both folders).
- Replace or remove the intake `.jpg` files as you export PNGs.
- Clear source JPEGs from your working folders when done.

`ingest:matched-pairs` only ingests **`.png`** files at the roots of the raw folders.

### 3. Ingest — `npm run ingest:matched-pairs`

```bash
cd ~/CyanoVerse/ask-marvin-scene-assets
npm run ingest:matched-pairs
```

- Scans flat `Backgrounds_Raw` + `Foregrounds_Raw` for **same-basename** PNG pairs.
- If any PNG has no twin, opens a **browser orphan dialog** (port **5176**, `INGEST_ORPHAN_PORT`) listing unmatched files; click OK to proceed with matched pairs only.
- For each matched pair:
  - Converts PNG → WebP in `~/ask-marvin/public/images/background/` (same basename) and `.../foreground/` (**adds `_L`/`_R`** from `marvin_side`; default **right** → `_R`)
  - Upserts provisional rows in `scene_background_metadata.csv` (`status=ready`) and `scene_foreground_metadata.csv` (`status=draft`; empty lat/long OK)
  - On success, moves raw PNGs to `Processed_images/` as `{stem}__bg.png` and `{stem}__fg.png` (skipped on re-ingest if those already exist)

Does **not** rebuild the registry or review page — run step 4 next.

### 4. Rebuild — `npm run build:scene-registry` then `npm run build:scene-pair-review`

```bash
npm run build:scene-registry
npm run build:scene-pair-review
```

- `build:scene-registry` — runs `~/ask-marvin/scripts/build-scene-registry.mjs` (pairs metadata + playable CSV → `src/generated/sceneRegistry.js`).
- `build:scene-pair-review` — bakes the pair list into `dist/scene-pair-review/index.html`.

New ingested scenes appear as **metadata-only** candidates (`pairSource: metadata`) until Completed in review.

### 5. Review / pair — `npm run review:scenes`

```bash
npm run review:scenes
```

Runs **both rebuild scripts**, then serves **http://127.0.0.1:5174/scene-pair-review/** in Chrome (`SCENE_REVIEW_PORT` to override). Port in use:

```bash
kill $(lsof -ti:5174)
npm run review:scenes
```

- Pair list defaults to **newest background WebP first** (ingest date); use the **Sort** menu (right of Grid view) for **Ingest date** or **Alphabetical**. Preference is saved in browser localStorage.
- Adjust Marvin side, mirror/clone/bake foreground as needed.
- **Coordinates:** decimal degrees; enter **both** latitude and longitude, or leave **both** empty. Complete writes coords to `scene_background_metadata.csv` when both are valid.
- **Complete** commits the pair to `scene_playable_pairs.csv` and rebuilds registry + review HTML. If the foreground WebP lacks `_L`/`_R`, Complete renames it first (same rule as ingest).

Scenes already in the playable-pairs table show as committed; new ingest rows show as metadata-only until Completed.

### 6. Browser cache

The review server sends `Cache-Control: no-store` for the built review page, but Chrome can still show stale UI (especially `localStorage` staging). After rebuilds, **hard-refresh** (**Cmd+Shift+R**). If a scene is missing after ingest, confirm you ran step 4 (or use `review:scenes`, which rebuilds automatically).

---

## npm scripts (from `package.json`)

| Script | What it runs |
|--------|----------------|
| `intake:images` | `node scripts/serve-image-intake.mjs` |
| `ingest:matched-pairs` | `node scripts/ingest-matched-archive-pairs.mjs` |
| `build:scene-registry` | `node scripts/build-scene-registry.mjs` (delegates to ask-marvin) |
| `build:scene-pair-review` | `node scripts/build-scene-pair-review.mjs` |
| `review:scenes` | registry + review build, then `serve-scene-pair-review.mjs` |
| `review:scenes:arm64` | same under `arch -arm64` |
| `reinstall:sharp` | `npm install --include=optional sharp && npm rebuild sharp` |
| `prune:scene-webps` | Remove WebPs not referenced by CSVs or pending flat pairs |
| `apply:scene-png-edits` | PNG beside an existing WebP in `public/images` → re-encode WebP |
| `convert:scene-png` | alias of `apply:scene-png-edits` |
| `validate:assets` | Scene/character image dimension checks |
| `validate:scene-pairs` | Duplicate-row check on playable-pairs CSV |
| `mirror:foreground` | CLI flip `_L` ↔ `_R` foreground WebP |
| `mirror:foreground:arm64` | same under `arch -arm64` |
| `bake:foreground` | CLI bake scale % into foreground WebP |
| `bake:foreground:arm64` | same under `arch -arm64` |
| `test:scene-pair-review` | Integration tests (review server on test port) |
| `test:flat-archive-ingest` | Flat ingest unit tests |
| `audit:foreground-side-suffix` | Rename existing foreground WebPs missing `_L`/`_R` and patch CSVs |

---

## Troubleshooting

**New scene not in review UI**
Run `ingest:matched-pairs`, then rebuild (`build:scene-registry` + `build:scene-pair-review`, or `review:scenes`).

**sharp fails on Apple Silicon**
`arch -arm64 npm run reinstall:sharp` (after every `npm install`).

**Port 5174 in use**
`kill $(lsof -ti:5174)` then `npm run review:scenes`.

**Ingest skipped a pair**
`Processed_images/{stem}__bg.png` or `__fg.png` already exists from a prior ingest.

**Git**
Use session end scripts for routine commit/push across repos. Manual: commit in `~/ask-marvin` for WebP/CSV changes; commit in `~/CyanoVerse/ask-marvin-scene-assets` for tool changes; update CyanoVerse submodule pointer if needed.
