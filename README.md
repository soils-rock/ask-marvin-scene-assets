# ask-marvin-scene-assets (CyanoVerse)

Authoring tools for **ask-marvin** scene art: PNG → WebP conversion and the **scene pair review** UI for staging background + foreground + Marvin pairings.

Finished scene WebPs and the playable-pairs CSV live in the **ask-marvin** consumer repo, not here.

- **Consumer repo:** [ask-marvin](https://github.com/bcottraven/ask-marvin) (local clone at `~/ask-marvin`)
- **Playable pairs CSV:** `~/ask-marvin/data/scene_playable_pairs.csv`

---

## Machine & folder layout

This tooling runs on the **Mac Mini**. The two repos are expected as siblings:

```
~/ask-marvin                        ← consumer app (git repo)
~/CyanoVerse/ask-marvin-scene-assets       ← this repo (git repo)
```

Raw photo archive (external drive):

```
/Volumes/Marvin/CyanoVerse_Source_Files/
├── Backgrounds_Raw/    ← one folder per scene, named e.g. "Utting"
└── Foregrounds_Raw/    ← matching folder, same name e.g. "Utting"
```

A folder pair is **active** if neither folder has an `x` prefix. After a scene is completed, both folders are renamed to `xUtting` and skipped on future ingests.

---

## First-time setup

**Important:** The Mac Mini terminal must be running in arm64 mode (not Rosetta/x64). Check before doing anything:

```bash
arch
```

If it prints `i386`, open a new terminal and run:

```bash
arch -arm64 zsh
```

Then proceed:

```bash
cd ~/CyanoVerse/ask-marvin-scene-assets
npm install
arch -arm64 npm run reinstall:sharp
```

The `reinstall:sharp` step is required on Apple Silicon and must be run after every `npm install`. If you skip it or run it without `arch -arm64`, sharp will fail with a `darwin-x64` error even on arm64 hardware.

---

## Adding a new scene — step by step

### Step 1 — Prepare the archive folders

Make sure matching background and foreground folders exist on the archive drive for your new scene. Folders with an `x` prefix are treated as sealed and will be skipped — do not add the prefix until the scene is complete.

```
/Volumes/Marvin/CyanoVerse_Source_Files/Backgrounds_Raw/<SceneName>/
/Volumes/Marvin/CyanoVerse_Source_Files/Foregrounds_Raw/<SceneName>/
```

All active folders (no `x` prefix) will be picked up automatically in Step 2.

### Step 2 — Ingest and convert

This ingests new matched pairs from the archive, converts PNGs to WebP, and rebuilds the scene registry and review page:

```bash
cd ~/CyanoVerse/ask-marvin-scene-assets
npm run refresh:matched-pairs
```

If a scene is skipped with `SKIP <SceneName>: no scene_background_metadata row`, add a row for it in:

```
~/ask-marvin/data/scene_background_metadata.csv
```

At minimum add: `background_id,file,lat,long` — then re-run `npm run refresh:matched-pairs`.

### Step 3 — Review and stage the scene

```bash
npm run review:scenes
```

This opens `http://127.0.0.1:5174/scene-pair-review/` in Chrome. If the port is already in use:

```bash
kill $(lsof -ti:5174)
npm run review:scenes
```

In the review UI you can:

- **Mirror** the foreground (_L ↔ _R)
- **Bake** scale adjustments into the WebP
- **Complete** the pair → writes to `scene_playable_pairs.csv`, rebuilds the registry, and seals the archive folders

### Step 4 — Commit and push

```bash
cd ~/ask-marvin
git add .
git commit -m "Add <scene name> scene"
git pull --rebase
git push
```

If the rebase pauses for a commit message, type `:wq` and press Enter (or save and close if using VS Code as your git editor).

---

## Other useful scripts

| Script | Purpose |
|--------|---------|
| `npm run build:scene-registry` | Rebuild the scene registry in ask-marvin only |
| `npm run build:scene-pair-review` | Rebuild the review page only |
| `npm run mirror:foreground -- --from Foo_L.webp` | Flip a foreground _L ↔ _R |
| `npm run bake:foreground -- --file Foo_L.webp --scale-x 110` | Bake a scale adjustment into a WebP |
| `npm run validate:assets` | Check scene and character image dimensions |
| `npm run validate:scene-pairs` | Validate the playable-pairs CSV |
| `npm run apply:scene-png-edits` | Apply PNG edits → 1920×1080 WebP in ask-marvin |

---

## Troubleshooting

**New scene not appearing in review UI**
Run `npm run refresh:matched-pairs` first. `npm run review:scenes` alone does not ingest new images.

**SKIP: no scene_background_metadata row**
Add a row to `~/ask-marvin/data/scene_background_metadata.csv` then re-run `npm run refresh:matched-pairs`.

**sharp module error on Apple Silicon**

This must be run after every `npm install`:

```bash
arch -arm64 npm run reinstall:sharp
```

**Port 5174 already in use**
```bash
kill $(lsof -ti:5174)
```

**Git push rejected (remote has new commits)**
```bash
git pull --rebase
git push
```
