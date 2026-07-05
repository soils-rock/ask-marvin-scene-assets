/**
 * Inlined into public/scene-pair-review/index.html by build-scene-pair-review.mjs.
 * PAIR list is injected at build time (see build-scene-pair-review.mjs).
 */
(function () {
  const CANVAS_W = 1920;
  const CANVAS_H = 1080;
  const STAGING_KEY = "ask-marvin-scene-pair-staging";
  const BG_COORDS_STAGING_KEY = "ask-marvin-scene-background-coords-staging";
  const PAIRS = __PAIRS_JSON__;
  const DEFAULT_FG_ADJUST = { scaleX: 100, scaleY: 100 };
  const SCALE_PERCENT_MIN = 1;
  const SCALE_PERCENT_MAX = 999;

  function defaultFgAdjust() {
    return { scaleX: 100, scaleY: 100 };
  }

  /** Parses 1–999; "110" → 110 (see test-scene-pair-review-flow.mjs). */
  function parseScalePercent(raw, fallback) {
    if (fallback === undefined) fallback = 100;
    var s = String(raw == null ? "" : raw).trim();
    if (s === "") return fallback;
    var n = Number(s);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(
      SCALE_PERCENT_MAX,
      Math.max(SCALE_PERCENT_MIN, Math.round(n))
    );
  }

  function normalizeFgAdjust(raw) {
    if (!raw) return defaultFgAdjust();
    return {
      scaleX: parseScalePercent(raw.scaleX, 100),
      scaleY: parseScalePercent(raw.scaleY, 100),
    };
  }

  function isDefaultFgAdjust(adjust) {
    var a = normalizeFgAdjust(adjust);
    return a.scaleX === 100 && a.scaleY === 100;
  }

  function committedPairState(pair) {
    return {
      foregroundFile: pair.foregroundFile,
      marvinSide: marvinPlacementSide(pair),
      notes: String(pair.notes || "").trim(),
      fgAdjust: defaultFgAdjust(),
    };
  }

  function effectiveDraftState(pair, draft) {
    if (!draft) return null;
    return {
      foregroundFile: draft.foregroundFile || pair.foregroundFile,
      marvinSide: marvinPlacementSide(
        Object.assign({}, pair, {
          marvinSide: draft.marvinSide || pair.marvinSide,
        })
      ),
      notes: String(
        draft.notes !== undefined ? draft.notes : pair.notes || ""
      ).trim(),
      fgAdjust: normalizeFgAdjust(draft.fgAdjust),
    };
  }

  function draftHasEffectiveChanges(pair, draft) {
    if (!draft) return false;
    var effective = effectiveDraftState(pair, draft);
    var committed = committedPairState(pair);
    if (effective.foregroundFile !== committed.foregroundFile) return true;
    if (effective.marvinSide !== committed.marvinSide) return true;
    if (effective.notes !== committed.notes) return true;
    if (!isDefaultFgAdjust(effective.fgAdjust)) return true;
    return false;
  }

  function findPairForStagingKey(key, draft, pairs) {
    var exact = pairs.find(function (p) {
      return pairStagingKey(p) === key;
    });
    if (exact) return exact;
    var parts = key.split("|");
    if (parts.length >= 2) {
      var bg = parts[0];
      var fg = parts.slice(1).join("|");
      var byBgFg = pairs.find(function (p) {
        return p.backgroundId === bg && p.foregroundFile === fg;
      });
      if (byBgFg) return byBgFg;
    }
    if (draft && draft.backgroundId) {
      var fgFile =
        draft.foregroundFile ||
        (parts.length >= 2 ? parts.slice(1).join("|") : "");
      if (fgFile) {
        return pairs.find(function (p) {
          return p.backgroundId === draft.backgroundId && p.foregroundFile === fgFile;
        });
      }
    }
    return null;
  }

  function pruneNoopStaging(staging, pairs) {
    var next = Object.assign({}, staging);
    var changed = false;
    Object.keys(next).forEach(function (key) {
      var raw = findPairForStagingKey(key, next[key], pairs);
      if (raw && !draftHasEffectiveChanges(raw, next[key])) {
        delete next[key];
        changed = true;
      }
    });
    return changed ? next : staging;
  }

  function repairIncompleteFgAdjustDraft(draft) {
    if (!draft || !draft.fgAdjust || draft.fgAdjustTouched) return draft;
    var a = normalizeFgAdjust(draft.fgAdjust);
    if (isDefaultFgAdjust(a)) return draft;
    var suspiciousX = a.scaleX >= 1 && a.scaleX <= 9 && a.scaleY === 100;
    var suspiciousY = a.scaleY >= 1 && a.scaleY <= 9 && a.scaleX === 100;
    if (!suspiciousX && !suspiciousY) return draft;
    var next = Object.assign({}, draft);
    next.fgAdjust = defaultFgAdjust();
    delete next.fgAdjustTouched;
    return next;
  }

  function repairIncompleteFgAdjustStaging(staging) {
    var next = Object.assign({}, staging);
    var changed = false;
    Object.keys(next).forEach(function (key) {
      var repaired = repairIncompleteFgAdjustDraft(next[key]);
      if (repaired !== next[key]) {
        next[key] = repaired;
        changed = true;
      }
    });
    return changed ? next : staging;
  }

  function loadAndPruneStaging() {
    var staging = loadStaging();
    var repaired = repairIncompleteFgAdjustStaging(staging);
    var pruned = pruneNoopStaging(repaired, PAIRS);
    if (pruned !== staging) saveStaging(pruned);
    return pruned;
  }

  function fgAdjustFromStaging(draft) {
    return normalizeFgAdjust(draft && draft.fgAdjust ? draft.fgAdjust : DEFAULT_FG_ADJUST);
  }

  function previewFgStyle(adjust, anchorSide) {
    var a = normalizeFgAdjust(adjust);
    if (isDefaultFgAdjust(a)) return "";
    var sx = a.scaleX / 100;
    var sy = a.scaleY / 100;
    return (
      "transform-origin:" +
      (anchorSide === "left" ? "bottom left" : "bottom right") +
      ";transform:scale(" +
      sx +
      "," +
      sy +
      ");"
    );
  }

  function parseForegroundBasename(foregroundFile) {
    var file = (foregroundFile || "").split("/").pop();
    var base = file.replace(/\.webp$/i, "");
    var uniqueMatch = base.match(/^(.+)__(.+)$/);
    var pairSuffix = uniqueMatch ? uniqueMatch[2] : null;
    var stem = uniqueMatch ? uniqueMatch[1] : base;
    var isL = /_L$/i.test(stem);
    var isR = /_R$/i.test(stem);
    return { file: file, base: base, stem: stem, pairSuffix: pairSuffix, isL: isL, isR: isR };
  }

  function isUniqueForegroundName(foregroundFile, backgroundId) {
    return parseForegroundBasename(foregroundFile).pairSuffix === backgroundId;
  }

  function uniqueForegroundName(foregroundFile, backgroundId) {
    var parsed = parseForegroundBasename(foregroundFile);
    if (parsed.pairSuffix === backgroundId) return parsed.file;
    return parsed.stem + "__" + backgroundId + ".webp";
  }

  function flipTargetsToSide(foregroundFile, side) {
    var parsed = parseForegroundBasename(foregroundFile);
    if (!parsed.isL && !parsed.isR) return null;
    var wantLeft = side === "left";
    if ((wantLeft && parsed.isL) || (!wantLeft && parsed.isR)) return null;
    var suffix = parsed.pairSuffix ? "__" + parsed.pairSuffix : "";
    var toStem = parsed.isL
      ? parsed.stem.replace(/_L$/i, "_R")
      : parsed.stem.replace(/_R$/i, "_L");
    return { from: parsed.file, to: toStem + suffix + ".webp" };
  }

  function hasFlipSides(foregroundFile) {
    var parsed = parseForegroundBasename(foregroundFile);
    return parsed.isL || parsed.isR;
  }

  function isForegroundShared(foregroundFile, backgroundId) {
    var file = (foregroundFile || "").split("/").pop();
    if (isUniqueForegroundName(file, backgroundId)) return false;
    var matches = PAIRS.filter(function (p) {
      return p.foregroundFile === file;
    });
    if (matches.length > 1) return true;
    var backgrounds = {};
    matches.forEach(function (p) {
      backgrounds[p.backgroundId] = true;
    });
    return Object.keys(backgrounds).length > 1;
  }

  function foregroundAnchorSide(pair) {
    var fg = pair.foregroundFile || pair.foreground || "";
    var stem = parseForegroundBasename(fg).stem;
    return /_L$/i.test(stem) ? "left" : "right";
  }

  function marvinPlacementSide(pair) {
    if (pair.marvinSide === "left" || pair.marvinSide === "right") return pair.marvinSide;
    return foregroundAnchorSide(pair);
  }

  function mirrorTargets(foregroundFile) {
    return flipTargetsToSide(foregroundFile, "right");
  }

  function mirrorCommandFor(foregroundFile) {
    var left = flipTargetsToSide(foregroundFile, "left");
    var right = flipTargetsToSide(foregroundFile, "right");
    var parts = [];
    if (left) {
      parts.push(
        "npm run mirror:foreground -- " + left.from + " " + left.to + " --overwrite"
      );
    }
    if (right) {
      parts.push(
        "npm run mirror:foreground -- " + right.from + " " + right.to + " --overwrite"
      );
    }
    return parts.length ? parts.join("\n") : null;
  }

  var FLIP_RETRY_HINT =
    "Retry after restarting the review server. If it still fails, run: arch -arm64 npm run review:scenes";

  const MARVIN_FULL = "/images/marvin/full.png";

  function loadStaging() {
    try {
      return JSON.parse(localStorage.getItem(STAGING_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function loadBackgroundCoordsStaging() {
    try {
      return JSON.parse(localStorage.getItem(BG_COORDS_STAGING_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveBackgroundCoordsStaging(coordsStaging) {
    localStorage.setItem(BG_COORDS_STAGING_KEY, JSON.stringify(coordsStaging));
  }

  var backgroundCoordsById = {};
  PAIRS.forEach(function (pair) {
    if (!backgroundCoordsById[pair.backgroundId]) {
      backgroundCoordsById[pair.backgroundId] = {
        lat: String(pair.backgroundLat || ""),
        long: String(pair.backgroundLong || ""),
      };
    }
  });

  function storedBackgroundCoords(backgroundId) {
    return (
      backgroundCoordsById[backgroundId] || {
        lat: "",
        long: "",
      }
    );
  }

  function effectiveBackgroundCoords(backgroundId) {
    var base = storedBackgroundCoords(backgroundId);
    var staged = bgCoordsStaging[backgroundId];
    return {
      lat: staged && staged.lat !== undefined ? staged.lat : base.lat,
      long: staged && staged.long !== undefined ? staged.long : base.long,
    };
  }

  function backgroundCoordsAreStored(backgroundId) {
    var coords = effectiveBackgroundCoords(backgroundId);
    var lat = String(coords.lat || "").trim();
    var long = String(coords.long || "").trim();
    if (!lat || !long) return false;
    var latN = Number(lat);
    var longN = Number(long);
    return (
      Number.isFinite(latN) &&
      Number.isFinite(longN) &&
      latN >= -90 &&
      latN <= 90 &&
      longN >= -180 &&
      longN <= 180
    );
  }

  function stageBackgroundCoords(backgroundId, updates) {
    var base = storedBackgroundCoords(backgroundId);
    var prev = bgCoordsStaging[backgroundId] || {};
    var merged = {
      lat:
        updates.lat !== undefined
          ? updates.lat
          : prev.lat !== undefined
            ? prev.lat
            : base.lat,
      long:
        updates.long !== undefined
          ? updates.long
          : prev.long !== undefined
            ? prev.long
            : base.long,
    };
    bgCoordsStaging = Object.assign({}, bgCoordsStaging);
    if (merged.lat === base.lat && merged.long === base.long) {
      delete bgCoordsStaging[backgroundId];
    } else {
      bgCoordsStaging[backgroundId] = merged;
    }
    saveBackgroundCoordsStaging(bgCoordsStaging);
  }

  function clearBackgroundCoordsStagingFor(backgroundId) {
    if (!bgCoordsStaging[backgroundId]) return;
    bgCoordsStaging = Object.assign({}, bgCoordsStaging);
    delete bgCoordsStaging[backgroundId];
    saveBackgroundCoordsStaging(bgCoordsStaging);
  }

  function setCommittedBackgroundCoords(backgroundId, lat, long) {
    backgroundCoordsById[backgroundId] = {
      lat: String(lat || ""),
      long: String(long || ""),
    };
    PAIRS.forEach(function (pair) {
      if (pair.backgroundId === backgroundId) {
        pair.backgroundLat = String(lat || "");
        pair.backgroundLong = String(long || "");
      }
    });
  }

  function saveStaging(staging) {
    localStorage.setItem(STAGING_KEY, JSON.stringify(staging));
  }

  function pairStagingKey(pair) {
    return pair.id || pair.backgroundId + "|" + (pair.foregroundFile || "");
  }

  function mergePair(pair, staging) {
    var key = pairStagingKey(pair);
    var draft = staging[key];
    var fgFile = draft && draft.foregroundFile ? draft.foregroundFile : pair.foregroundFile;
    var fgPath = "/images/foreground/" + fgFile;
    var committed = pair.pairSource === "csv";
    var isStaged = draftHasEffectiveChanges(pair, draft);
    var effective = Object.assign({}, pair, {
      foregroundFile: fgFile,
      foreground: fgPath,
      marvinSide: draft && draft.marvinSide ? draft.marvinSide : pair.marvinSide,
      notes: draft && draft.notes !== undefined ? draft.notes : pair.notes,
      fgAdjust: fgAdjustFromStaging(draft),
      missingFile: pair.missingFile && !(draft && draft.foregroundFile),
      committed: committed && !isStaged,
      isStaged: isStaged,
      isDraft: !committed || isStaged,
      stagingKey: key,
    });
    if (draft && draft.foregroundFile) {
      effective.id = pair.backgroundId + "|" + draft.foregroundFile;
    }
    return effective;
  }

  function layerStackHtml(pair, sceneClass, imageEpoch) {
    var marvinSide = marvinPlacementSide(pair);
    var anchorSide = foregroundAnchorSide(pair);
    var cls = sceneClass ? " scene-pair-review__scene " + sceneClass : " scene-pair-review__scene";
    var fgFile = pair.foregroundFile || pair.foreground.split("/").pop();
    var fgSrc = pair.foreground;
    if (!pair.missingFile && imageEpoch) {
      fgSrc = pair.foreground.split("?")[0] + "?t=" + imageEpoch;
    }
    var previewStyle = previewFgStyle(pair.fgAdjust, anchorSide);
    var fgClasses = "foreground " + anchorSide;
    if (previewStyle) fgClasses += " foreground--preview-adjust";
    var fgHtml;
    if (!pair.missingFile) {
      fgHtml =
        '<img src="' +
        fgSrc +
        '" class="' +
        fgClasses +
        '"' +
        (previewStyle ? ' style="' + previewStyle + '"' : "") +
        ' alt="" />';
    } else {
      fgHtml =
        '<div class="foreground ' +
        anchorSide +
        '" aria-hidden="true">' +
        '<div class="scene-pair-review__missing">Missing: ' +
        fgFile +
        "</div></div>";
    }
    return (
      '<div class="' +
      cls.trim() +
      '">' +
      '<img src="' +
      pair.background +
      '" class="background" alt="" />' +
      '<div class="marvin-box ' +
      marvinSide +
      '">' +
      '<div class="marvin-assembly-shell">' +
      '<img src="' +
      MARVIN_FULL +
      '" class="marvin-sprite" alt="" />' +
      "</div></div>" +
      fgHtml +
      "</div>"
    );
  }

  function fitCardThumb(thumbEl) {
    const scene = thumbEl.querySelector(".scene-pair-review__scene");
    if (!scene) return;
    const w = thumbEl.clientWidth;
    if (w > 0) scene.style.transform = "scale(" + w / CANVAS_W + ")";
  }

  function sizeBadge(src, label) {
    const span = document.createElement("span");
    span.className = "scene-pair-review__badge";
    span.textContent = label + ": …";
    const img = new Image();
    img.onload = function () {
      const ok = img.naturalWidth === CANVAS_W && img.naturalHeight === CANVAS_H;
      span.classList.toggle("ok", ok);
      span.textContent =
        label +
        ": " +
        img.naturalWidth +
        "×" +
        img.naturalHeight +
        (ok ? "" : " (expected 1920×1080)");
    };
    img.onerror = function () {
      span.textContent = label + ": failed to load";
    };
    img.src = src;
    return span;
  }

  let index = 0;
  let mode = "single";
  let staging = loadAndPruneStaging();
  let bgCoordsStaging = loadBackgroundCoordsStaging();

  const elMeta = document.getElementById("meta");
  const elSingle = document.getElementById("single");
  const elGrid = document.getElementById("grid");
  const elViewport = document.getElementById("viewport");
  const elPreviewStage = document.getElementById("preview-stage");
  const elPreviewFrame = document.getElementById("preview-frame");
  const elHint = document.getElementById("hint");
  const elBtnMode = document.getElementById("btn-mode");
  const elMetaNote = document.getElementById("meta-note");
  const elCopyHelper = document.getElementById("copy-helper");
  const elToast = document.getElementById("toast");
  let showMirrorCmd = false;
  let flipping = false;
  let cloning = false;
  let baking = false;
  let completing = false;
  let imageEpoch = 0;
  let toastTimer = null;

  function pairRaw() {
    return PAIRS[index];
  }

  function pair() {
    return mergePair(pairRaw(), staging);
  }

  function showToast(message, ok) {
    if (!elToast) return;
    elToast.textContent = message;
    elToast.className = "scene-pair-review__toast " + (ok ? "is-ok" : "is-err");
    elToast.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      elToast.hidden = true;
    }, 6000);
  }

  function applyPairsUpdate(data) {
    if (data.pairs && data.pairs.length) {
      PAIRS.length = 0;
      data.pairs.forEach(function (p) {
        PAIRS.push(p);
      });
    }
  }

  function stageCurrent(updates) {
    var raw = pairRaw();
    if (!raw) return;
    var key = pairStagingKey(raw);
    var prev = staging[key] || {};
    var merged = Object.assign(
      {
        backgroundId: raw.backgroundId,
        foregroundFile: prev.foregroundFile || raw.foregroundFile,
        marvinSide: prev.marvinSide || raw.marvinSide,
        notes: prev.notes !== undefined ? prev.notes : raw.notes || "",
        fgAdjust: prev.fgAdjust ? normalizeFgAdjust(prev.fgAdjust) : defaultFgAdjust(),
      },
      updates
    );
    staging = Object.assign({}, staging);
    if (draftHasEffectiveChanges(raw, merged)) {
      staging[key] = merged;
    } else {
      delete staging[key];
    }
    saveStaging(staging);
  }

  function clearStagingForPair(raw) {
    staging = Object.assign({}, staging);
    var changed = false;
    Object.keys(staging).forEach(function (key) {
      var draft = staging[key];
      if (key === pairStagingKey(raw)) {
        delete staging[key];
        changed = true;
        return;
      }
      if (
        draft &&
        draft.backgroundId === raw.backgroundId &&
        (draft.foregroundFile || key.split("|").slice(1).join("|")) === raw.foregroundFile
      ) {
        delete staging[key];
        changed = true;
      }
    });
    if (changed) saveStaging(staging);
  }

  function discardStagingForCurrent() {
    var raw = pairRaw();
    if (!raw) return;
    clearStagingForPair(raw);
    showToast("Discarded local staging — showing CSV pairing.", true);
    render();
  }

  function stageMarvinSide(payload) {
    if (payload.action === "opposite") {
      var p = pair();
      var anchor = foregroundAnchorSide(p);
      stageCurrent({ marvinSide: anchor === "left" ? "right" : "left" });
      showToast("Staged opposite sides (not saved to CSV until Complete).", true);
    } else {
      stageCurrent({ marvinSide: payload.marvinSide });
      showToast("Staged Marvin " + payload.marvinSide + " (Complete to save).", true);
    }
    render();
  }

  function applyCloneSuccess(from, to, data, existed) {
    stageCurrent({ foregroundFile: to });
    if (data && data.pairs) applyPairsUpdate(data);
    imageEpoch = Date.now();
    var msg = existed
      ? "Using pair-unique copy " + to + " (already on disk)."
      : "Created pair-unique copy " + to + " from " + from + ".";
    showToast(msg, true);
  }

  function runClone(overwrite) {
    if (cloning) return;
    var p = pair();
    if (!p) return;
    cloning = true;
    renderCopyHelper(p);
    fetch("/api/clone-foreground", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: p.foregroundFile || p.foreground.split("/").pop(),
        backgroundId: p.backgroundId,
        overwrite: Boolean(overwrite),
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (_ref) {
        var res = _ref.res;
        var data = _ref.data;
        if (!res.ok || !data.ok) throw new Error(data.error || "Clone failed");
        applyCloneSuccess(data.from, data.to, data, data.existed);
      })
      .catch(function (err) {
        showToast(err.message || String(err), false);
      })
      .finally(function () {
        cloning = false;
        render();
      });
  }

  function applyFlipSuccess(from, to, sizeWarning, data) {
    stageCurrent({ foregroundFile: to });
    if (data && data.pairs) applyPairsUpdate(data);
    imageEpoch = Date.now();
    var extra = sizeWarning ? " (" + sizeWarning + ")" : "";
    showToast(
      "Mirrored " + from + " → " + to + ". Staged — click Complete to save CSV." + extra,
      true
    );
  }

  function runFlip(targets, overwrite) {
    if (flipping || !targets) return;
    var p = pair();
    if (!p) return;
    if (p.foregroundFile === targets.to) {
      showToast("Already using " + targets.to + ".", true);
      return;
    }
    flipping = true;
    renderCopyHelper(p);
    fetch("/api/mirror-foreground", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: targets.from,
        to: targets.to,
        overwrite: overwrite !== false,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (_ref) {
        var res = _ref.res;
        var data = _ref.data;
        if (!res.ok || !data.ok) {
          var msg = data.hint
            ? data.error + " — " + data.hint
            : (data.error || "Flip failed") + " — " + FLIP_RETRY_HINT;
          throw new Error(msg);
        }
        applyFlipSuccess(data.from, data.to, data.sizeWarning, data);
      })
      .catch(function (err) {
        showToast(err.message || String(err), false);
      })
      .finally(function () {
        flipping = false;
        render();
      });
  }

  function runBake(onCompleteAfter) {
    var p = pair();
    if (!p || p.missingFile || baking) return;
    var adjust = normalizeFgAdjust(p.fgAdjust);
    if (isDefaultFgAdjust(adjust)) {
      showToast("No foreground adjustments to apply (defaults).", true);
      if (onCompleteAfter) onCompleteAfter();
      return;
    }
    var fgName = p.foregroundFile || p.foreground.split("/").pop();
    if (isForegroundShared(fgName, p.backgroundId)) {
      showToast(
        "Shared foreground — use Give unique copy or Complete first (auto-clones on save).",
        false
      );
      return;
    }
    baking = true;
    renderCopyHelper(p);
    fetch("/api/bake-foreground", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: p.foregroundFile || p.foreground.split("/").pop(),
        scaleX: adjust.scaleX,
        scaleY: adjust.scaleY,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (_ref) {
        var res = _ref.res;
        var data = _ref.data;
        if (!res.ok || !data.ok) {
          var msg = data.hint
            ? data.error + " — " + data.hint
            : data.error || "Bake failed";
          throw new Error(msg);
        }
        stageCurrent({ fgAdjust: defaultFgAdjust() });
        imageEpoch = Date.now();
        var extra = data.sizeWarning ? " (" + data.sizeWarning + ")" : "";
        showToast("Baked adjustments into " + data.file + "." + extra, true);
        if (onCompleteAfter) onCompleteAfter();
      })
      .catch(function (err) {
        showToast(err.message || String(err), false);
      })
      .finally(function () {
        baking = false;
        render();
      });
  }

  function runComplete() {
    var raw = pairRaw();
    var p = pair();
    if (!raw || !p || completing) return;
    if (!isDefaultFgAdjust(p.fgAdjust)) {
      runBake(function () {
        runComplete();
      });
      return;
    }
    completing = true;
    renderCopyHelper(p);
    var coords = effectiveBackgroundCoords(p.backgroundId);
    fetch("/api/complete-pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backgroundId: p.backgroundId,
        foregroundFile: p.foregroundFile,
        previousForegroundFile:
          raw.foregroundFile !== p.foregroundFile ? raw.foregroundFile : undefined,
        marvinSide: marvinPlacementSide(p),
        notes: p.notes || "",
        backgroundLat: coords.lat,
        backgroundLong: coords.long,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (_ref) {
        var res = _ref.res;
        var data = _ref.data;
        if (!res.ok || !data.ok) throw new Error(data.error || "Complete failed");
        clearStagingForPair(raw);
        staging = loadStaging();
        applyPairsUpdate(data);
        if (data.backgroundLat !== undefined || data.backgroundLong !== undefined) {
          setCommittedBackgroundCoords(
            p.backgroundId,
            data.backgroundLat,
            data.backgroundLong
          );
          clearBackgroundCoordsStagingFor(p.backgroundId);
        }
        var completeMsg = "Committed to scene_playable_pairs.csv and rebuilt registry.";
        if (data.backgroundMetaUpdated) {
          completeMsg += " Background coordinates saved.";
        }
        if (data.cloned && data.cloneFrom) {
          completeMsg =
            "Cloned " +
            data.cloneFrom +
            " → " +
            data.foregroundFile +
            " and committed to CSV.";
        }
        if (data.archiveSealed && data.archiveFolder) {
          completeMsg +=
            " Archive sealed as " + data.archiveFolder + " (skipped on future ingest).";
        }
        showToast(completeMsg, true);
      })
      .catch(function (err) {
        showToast(err.message || String(err), false);
      })
      .finally(function () {
        completing = false;
        render();
      });
  }

  function pairingStatusHtml(p) {
    if (p.isStaged) {
      var stagedLabel =
        p.pairSource === "csv"
          ? "staged (unsaved changes)"
          : "staged — Complete to add";
      return (
        ' · <span class="scene-pair-review__status scene-pair-review__status--staged">' +
        stagedLabel +
        "</span>"
      );
    }
    if (p.committed) {
      return ' · <span class="scene-pair-review__status scene-pair-review__status--committed">in pairing table</span>';
    }
    return ' · <span class="scene-pair-review__status scene-pair-review__status--draft">metadata only — Complete to add</span>';
  }

  function renderCopyHelper(p) {
    if (!elCopyHelper) return;
    var fgName = p.foregroundFile || p.foreground.split("/").pop();
    var flipLeft = flipTargetsToSide(fgName, "left");
    var flipRight = flipTargetsToSide(fgName, "right");
    var cmd = mirrorCommandFor(fgName);
    var marvinSide = marvinPlacementSide(p);
    var anchorSide = foregroundAnchorSide(p);
    var oppositeSides = marvinSide !== anchorSide;
    var sharedFg = isForegroundShared(fgName, p.backgroundId);
    elCopyHelper.hidden = false;
    var html =
      '<p class="scene-pair-review__side-summary">Marvin <code>' +
      marvinSide +
      "</code> · fg anchor <code>" +
      anchorSide +
      "</code>" +
      (oppositeSides ? " · opposite sides" : " · same side") +
      pairingStatusHtml(p) +
      (sharedFg
        ? ' · <span class="scene-pair-review__status scene-pair-review__status--staged">shared foreground</span>'
        : "") +
      "</p>" +
      '<div class="scene-pair-review__side-actions">' +
      '<button type="button" id="btn-opposite">Use opposite sides</button>' +
      '<button type="button" id="btn-marvin-left"' +
      (marvinSide === "left" ? " disabled" : "") +
      ">Marvin left</button>" +
      '<button type="button" id="btn-marvin-right"' +
      (marvinSide === "right" ? " disabled" : "") +
      ">Marvin right</button>";
    if (hasFlipSides(fgName)) {
      html +=
        '<button type="button" class="is-primary" id="btn-flip-l"' +
        (flipping ? " disabled" : "") +
        ">" +
        (flipping ? "Flipping…" : "Flip to L side") +
        "</button>" +
        '<button type="button" class="is-primary" id="btn-flip-r"' +
        (flipping ? " disabled" : "") +
        ">" +
        (flipping ? "Flipping…" : "Flip to R side") +
        "</button>" +
        '<button type="button" id="btn-flip-overwrite-l"' +
        (flipping ? " disabled" : "") +
        ' title="Re-mirror to L even if file exists">Overwrite → L</button>' +
        '<button type="button" id="btn-flip-overwrite-r"' +
        (flipping ? " disabled" : "") +
        ' title="Re-mirror to R even if file exists">Overwrite → R</button>';
    }
    if (sharedFg) {
      html +=
        '<button type="button" id="btn-clone-fg"' +
        (cloning ? " disabled" : "") +
        ">" +
        (cloning ? "Cloning…" : "Give unique foreground copy") +
        "</button>";
    }
    html +=
      '<button type="button" class="is-complete" id="btn-complete"' +
      (completing ? " disabled" : "") +
      ">" +
      (completing ? "Saving…" : "Complete — add to pairing table") +
      "</button>";
    if (p.isStaged && p.pairSource === "csv") {
      html +=
        '<button type="button" id="btn-match-csv" title="Clear browser staging and show the committed CSV row">Match CSV</button>';
    }
    if (cmd) {
      html += '<button type="button" id="btn-mirror-cmd">Show mirror command</button>';
    }
    html += "</div>";
    html +=
      '<label class="scene-pair-review__notes-label">Notes (staging)<textarea id="staging-notes" rows="2">' +
      (p.notes || "").replace(/</g, "&lt;") +
      "</textarea></label>";
    var bgCoords = effectiveBackgroundCoords(p.backgroundId);
    html +=
      '<fieldset class="scene-pair-review__bg-coords">' +
      "<legend>" +
      "Background coordinates (optional)" +
      "</legend>" +
      '<p class="scene-pair-review__bg-coords-hint">Shared across all foreground pairs for <code>' +
      p.backgroundId +
      "</code>. Optional — if you enter coordinates, fill in both latitude and longitude; saved to background metadata on <strong>Complete</strong>.</p>" +
      '<div class="scene-pair-review__bg-coords-fields">' +
      '<label>Latitude<input type="text" id="bg-lat" inputmode="decimal" autocomplete="off" value="' +
      String(bgCoords.lat || "").replace(/"/g, "&quot;") +
      '" /></label>' +
      '<label>Longitude<input type="text" id="bg-long" inputmode="decimal" autocomplete="off" value="' +
      String(bgCoords.long || "").replace(/"/g, "&quot;") +
      '" /></label>' +
      "</div></fieldset>";
    if (!p.missingFile) {
      var adj = normalizeFgAdjust(p.fgAdjust);
      html +=
        '<fieldset class="scene-pair-review__fg-adjust">' +
        "<legend>Foreground adjust (preview until Apply)</legend>" +
        '<p class="scene-pair-review__fg-adjust-hint">Anchor: bottom-' +
        (anchorSide === "left" ? "left" : "right") +
        " for <code>" +
        fgName +
        "</code>. Staged in browser until <strong>Apply to image</strong>." +
        (sharedFg
          ? " Shared file — clone before baking (or Complete to auto-clone)."
          : "") +
        "</p>" +
        '<div class="scene-pair-review__fg-adjust-fields">' +
        '<label>Scale X (%)<input type="number" id="fg-scale-x" step="1" min="' +
        SCALE_PERCENT_MIN +
        '" max="' +
        SCALE_PERCENT_MAX +
        '" value="' +
        adj.scaleX +
        '" /></label>' +
        '<label>Scale Y (%)<input type="number" id="fg-scale-y" step="1" min="' +
        SCALE_PERCENT_MIN +
        '" max="' +
        SCALE_PERCENT_MAX +
        '" value="' +
        adj.scaleY +
        '" /></label>' +
        "</div>" +
        '<div class="scene-pair-review__fg-adjust-actions">' +
        '<button type="button" id="btn-fg-reset">Reset</button>' +
        '<button type="button" class="is-primary" id="btn-fg-apply"' +
        (baking ? " disabled" : "") +
        ">" +
        (baking ? "Applying…" : "Apply to image") +
        "</button>" +
        "</div>" +
        "</fieldset>";
    }
    if (showMirrorCmd && cmd) html += "<code>" + cmd + "</code>";
    elCopyHelper.innerHTML = html;
    document.getElementById("btn-opposite").onclick = function () {
      stageMarvinSide({ action: "opposite" });
    };
    document.getElementById("btn-marvin-left").onclick = function () {
      stageMarvinSide({ marvinSide: "left" });
    };
    document.getElementById("btn-marvin-right").onclick = function () {
      stageMarvinSide({ marvinSide: "right" });
    };
    var flipL = document.getElementById("btn-flip-l");
    if (flipL) flipL.onclick = function () {
      runFlip(flipLeft);
    };
    var flipR = document.getElementById("btn-flip-r");
    if (flipR) flipR.onclick = function () {
      runFlip(flipRight);
    };
    var owL = document.getElementById("btn-flip-overwrite-l");
    if (owL) owL.onclick = function () {
      runFlip(flipLeft);
    };
    var owR = document.getElementById("btn-flip-overwrite-r");
    if (owR) owR.onclick = function () {
      runFlip(flipRight);
    };
    var cloneBtn = document.getElementById("btn-clone-fg");
    if (cloneBtn) cloneBtn.onclick = function () {
      runClone(false);
    };
    document.getElementById("btn-complete").onclick = runComplete;
    var matchCsvBtn = document.getElementById("btn-match-csv");
    if (matchCsvBtn) matchCsvBtn.onclick = discardStagingForCurrent;
    var notesEl = document.getElementById("staging-notes");
    if (notesEl) {
      notesEl.oninput = function () {
        stageCurrent({ notes: notesEl.value });
      };
    }
    var bgLatEl = document.getElementById("bg-lat");
    var bgLongEl = document.getElementById("bg-long");
    if (bgLatEl) {
      bgLatEl.oninput = function () {
        stageBackgroundCoords(p.backgroundId, { lat: bgLatEl.value });
      };
    }
    if (bgLongEl) {
      bgLongEl.oninput = function () {
        stageBackgroundCoords(p.backgroundId, { long: bgLongEl.value });
      };
    }
    var btn = document.getElementById("btn-mirror-cmd");
    if (btn) {
      btn.onclick = function () {
        showMirrorCmd = !showMirrorCmd;
        renderCopyHelper(pair());
      };
    }
    function readFgAdjustFromFields() {
      var scaleXEl = document.getElementById("fg-scale-x");
      if (!scaleXEl) return null;
      return normalizeFgAdjust({
        scaleX: scaleXEl.value,
        scaleY: document.getElementById("fg-scale-y").value,
      });
    }
    function updateFgPreviewOnly() {
      var current = pair();
      if (!current) return;
      var anchorSide = foregroundAnchorSide(current);
      var style = previewFgStyle(current.fgAdjust, anchorSide);
      var fgImg = elViewport.querySelector(".foreground");
      if (fgImg && fgImg.tagName === "IMG") {
        if (style) {
          fgImg.style.cssText = style;
          fgImg.classList.add("foreground--preview-adjust");
        } else {
          fgImg.style.cssText = "";
          fgImg.classList.remove("foreground--preview-adjust");
        }
      }
    }
    function onFgFieldInput() {
      var next = readFgAdjustFromFields();
      if (!next) return;
      stageCurrent({ fgAdjust: next });
      updateFgPreviewOnly();
    }
    function onFgFieldBlur() {
      var next = readFgAdjustFromFields();
      if (!next) return;
      stageCurrent({ fgAdjust: next, fgAdjustTouched: true });
    }
    ["fg-scale-x", "fg-scale-y"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.oninput = onFgFieldInput;
        el.onchange = onFgFieldBlur;
        el.onblur = onFgFieldBlur;
      }
    });
    var resetFg = document.getElementById("btn-fg-reset");
    if (resetFg) {
      resetFg.onclick = function () {
        stageCurrent({ fgAdjust: defaultFgAdjust(), fgAdjustTouched: false });
        render();
      };
    }
    var applyFg = document.getElementById("btn-fg-apply");
    if (applyFg) {
      applyFg.onclick = function () {
        runBake();
      };
    }
  }

  function updateScale() {
    if (!elPreviewStage || !elPreviewFrame || !elViewport) return;
    var pad = 12;
    var availW = Math.max(0, elPreviewStage.clientWidth - pad);
    var availH = Math.max(0, elPreviewStage.clientHeight - pad);
    if (availW <= 0 || availH <= 0) return;
    var s = Math.min(availW / CANVAS_W, availH / CANVAS_H, 1);
    s = Math.max(0.12, s);
    elPreviewFrame.style.width = Math.round(CANVAS_W * s) + "px";
    elPreviewFrame.style.height = Math.round(CANVAS_H * s) + "px";
    elViewport.style.transform = "scale(" + s + ")";
    elViewport.style.transformOrigin = "top left";
  }

  function renderMeta() {
    const p = pair();
    if (!p) {
      elMeta.textContent = "No scene pairs. Run npm run build:scene-registry.";
      if (elMetaNote) elMetaNote.hidden = true;
      if (elCopyHelper) elCopyHelper.hidden = true;
      return;
    }
    const fgName = p.foregroundFile || p.foreground.split("/").pop();
    const marvinSide = marvinPlacementSide(p);
    const anchorSide = foregroundAnchorSide(p);
    let html =
      "Pair <strong>" +
      (index + 1) +
      "</strong> / " +
      PAIRS.length +
      " — <code>" +
      p.backgroundId +
      "</code> + <code>" +
      fgName +
      "</code> · Marvin <code>" +
      marvinSide +
      "</code>";
    if (marvinSide !== anchorSide) html += " · fg anchor <code>" + anchorSide + "</code>";
    if (p.missingFile)
      html += ' · <strong style="color:#faa">missing foreground file</strong>';
    html += pairingStatusHtml(p);
    elMeta.innerHTML = html;
    if (elMetaNote) {
      if (p.notes && !p.isStaged) {
        elMetaNote.hidden = false;
        elMetaNote.textContent = p.notes;
      } else {
        elMetaNote.hidden = true;
        elMetaNote.textContent = "";
      }
    }
    showMirrorCmd = false;
    renderCopyHelper(p);
  }

  function renderSingle() {
    const p = pair();
    if (!p) return;
    elViewport.innerHTML = layerStackHtml(p, "", imageEpoch);
    renderMeta();
    updateScale();
    window.requestAnimationFrame(updateScale);
  }

  function renderGrid() {
    elGrid.innerHTML = "";
    PAIRS.forEach(function (raw, i) {
      const p = mergePair(raw, staging);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scene-pair-review__card";
      if (p.isDraft) btn.classList.add("is-draft");
      if (p.isStaged) btn.classList.add("is-staged");
      if (p.missingFile) btn.classList.add("is-missing");
      if (i === index) btn.classList.add("is-selected");
      const thumb = document.createElement("div");
      thumb.className = "scene-pair-review__card-thumb";
      thumb.innerHTML = layerStackHtml(p, "", imageEpoch);
      const label = document.createElement("div");
      label.className = "scene-pair-review__card-label";
      const title = document.createElement("div");
      title.innerHTML = "<strong>" + p.backgroundId + "</strong>";
      const file = document.createElement("div");
      file.textContent = p.foregroundFile || p.foreground.split("/").pop();
      label.appendChild(title);
      label.appendChild(file);
      label.appendChild(sizeBadge(p.background, "bg"));
      if (!p.missingFile) label.appendChild(sizeBadge(p.foreground, "fg"));
      btn.appendChild(thumb);
      btn.appendChild(label);
      btn.addEventListener("click", function () {
        index = i;
        mode = "single";
        render();
      });
      elGrid.appendChild(btn);
    });
    elGrid.querySelectorAll(".scene-pair-review__card-thumb").forEach(fitCardThumb);
    renderMeta();
  }

  function render() {
    const isSingle = mode === "single";
    elSingle.hidden = !isSingle;
    elGrid.hidden = isSingle;
    elHint.hidden = !isSingle;
    elBtnMode.textContent = isSingle ? "Grid view (G)" : "Single view (G)";
    if (isSingle) renderSingle();
    else renderGrid();
  }

  function go(delta) {
    if (!PAIRS.length) return;
    index = (index + delta + PAIRS.length) % PAIRS.length;
    render();
  }

  document.getElementById("btn-prev").addEventListener("click", function () {
    go(-1);
  });
  document.getElementById("btn-next").addEventListener("click", function () {
    go(1);
  });
  elBtnMode.addEventListener("click", function () {
    mode = mode === "single" ? "grid" : "single";
    render();
  });

  window.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
    if (e.key === "g" || e.key === "G") {
      mode = mode === "single" ? "grid" : "single";
      render();
    }
  });

  window.addEventListener("resize", function () {
    if (mode === "single") updateScale();
    else elGrid.querySelectorAll(".scene-pair-review__card-thumb").forEach(fitCardThumb);
  });

  if (typeof ResizeObserver !== "undefined" && elPreviewStage) {
    var previewResizeObserver = new ResizeObserver(function () {
      if (mode === "single") updateScale();
    });
    previewResizeObserver.observe(elPreviewStage);
  }

  render();
})();
