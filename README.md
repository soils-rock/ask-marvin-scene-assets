# Image Processing (CyanoVerse)

Authoring tools for **ask-marvin** scene art: CR2/RAW → PNG pipelines, PNG → WebP conversion, and the **scene pair review** UI for staging background + foreground + Marvin pairings.

Scene WebPs and the playable-pairs CSV live in the consumer app repo, not here:

- **Consumer:** [ask-marvin](https://github.com/bcottraven/ask-marvin) (or a local clone at `~/ask-marvin`)
- **Default pairs CSV:** `../ask-marvin/data/scene_playable_pairs.csv` (relative to sibling layout)

## Layout

```
Image_Processing/
├── Claude_cya/          # Python CR2/background/foreground processing (local HTML UIs)
├── scripts/             # Node scene tools (mirror, bake, review server, PNG→WebP)
├── scene-pair-review/   # Exported review bundle (CSS, sample CSVs, paths.json)
├── dist/                # Built review page (gitignored)
└── package.json         # npm scripts
```

## Environment

Default paths assume sibling repos:

```
~/ask-marvin
~/CyanoVerse/Image_Processing
```

Override when layouts differ:

```bash
export ASK_MARVIN_ROOT=/path/to/ask-marvin
export SCENE_PAIRS_CSV=/path/to/scene_playable_pairs.csv   # optional
export SCENE_REVIEW_PORT=5174                               # optional
export SCENE_PNG_ARCHIVE=/Volumes/Marvin/CyanoVerse_Source_Files  # PNG archive on apply
```

## Setup

```bash
cd ~/CyanoVerse/Image_Processing
npm install
```

For Apple Silicon sharp issues: `npm run reinstall:sharp` or use `:arm64` script variants.

Python tools in `Claude_cya/` typically use a local venv:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install rawpy pillow numpy  # as needed per script
```

## Scene pair review

Builds a static review page from ask-marvin’s scene registry, serves ask-marvin `public/` assets, and writes pairing commits back to ask-marvin:

```bash
npm run review:scenes
```

Opens `http://127.0.0.1:5174/scene-pair-review/`. **Complete** updates `scene_playable_pairs.csv` in ask-marvin and rebuilds its scene registry.

Other npm scripts:

| Script | Purpose |
|--------|---------|
| `npm run build:scene-pair-review` | Build `dist/scene-pair-review/index.html` only |
| `npm run build:scene-registry` | Rebuild registry in ask-marvin |
| `npm run mirror:foreground -- --from Foo_L.webp` | Flip _L ↔ _R WebP |
| `npm run bake:foreground -- --file Foo_L.webp --scale-x 110` | Bake scale into WebP |
| `npm run apply:scene-png-edits` | PNG edits → 1920×1080 WebP in ask-marvin |
| `npm run validate:assets` | Check scene/character dimensions |
| `npm run validate:scene-pairs` | Validate playable-pairs CSV |
| `npm run test:scene-pair-review` | Headless review flow smoke test |

## Image processing (Claude_cya)

Python/HTML tools for RAW (CR2) ingestion, background stacking, and foreground prep. Outputs are typically PNGs that you export into ask-marvin’s `public/images/` and convert with `npm run apply:scene-png-edits`.

Key entry points:

- `process_images.py` — batch CR2 processing; writes `processed_backgrounds/` and `processed_foregrounds/` under the working folder
- `background_processor_ui.py` / `foreground_processor_ui.py` — local review UIs
- `*.html` — standalone browser tools for specific locations

Processed output folders are gitignored; commit source scripts and small fixtures only.

## Workflow summary

1. Process RAW → PNG in `Claude_cya/` (or drop PNG edits beside WebPs in ask-marvin).
2. `npm run apply:scene-png-edits` — normalize to 1920×1080 WebP in ask-marvin.
3. `npm run review:scenes` — stage pairs, mirror/bake foregrounds, **Complete** to CSV.
4. Commit art + CSV changes in **ask-marvin**; commit tool changes here in **Image_Processing**.
