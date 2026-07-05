/**
 * Image intake — mark BG/FG; save walkthroughs to Backgrounds_Raw / Foregrounds_Raw.
 */
(function () {
  const DEFAULT_GAP_MINUTES = 30;
  const $ = (id) => document.getElementById(id);

  const sourceInput = $("source-path");
  const gapInput = $("gap-minutes");
  const btnLoad = $("btn-load");
  const btnSaveBg = $("btn-save-bg");
  const btnSaveFg = $("btn-save-fg");
  const btnRebin = $("btn-rebin");
  const errorEl = $("error");
  const summaryEl = $("summary");
  const binsEl = $("bins");
  const selectionPanel = $("selection-panel");
  const selectionList = $("selection-list");

  const saveModal = $("save-modal");
  const saveModalTitle = $("save-modal-title");
  const saveModalBody = $("save-modal-body");
  const saveModalStep = $("save-modal-step");
  const saveModalNotice = $("save-modal-notice");
  const saveModalConfirm = $("save-modal-confirm");
  const saveModalSkip = $("save-modal-skip");
  const saveModalLocationWrap = $("save-modal-location-wrap");
  const saveModalLocation = $("save-modal-location");

  /** @type {{ bins: object[], sourcePath: string } | null} */
  let scanData = null;

  const state = new Map();
  const bgOrder = new Map();
  const fgOrder = new Map();
  let bgOrderCounter = 0;
  let fgOrderCounter = 0;
  const binLocationNames = new Map();
  let namedBinsView = false;
  let bgSaveCompleted = false;
  const removedFromDisplay = new Set();
  /** @type {string[]} FG files confirmed during current Save FG walkthrough */
  let fgWalkthroughProcessed = [];
  /** Next FG cycle letter index (0=A, 1=B, …); advances on each confirmed fg-batch */
  let fgCycleCounter = 0;

  /** @type {'bg' | 'fg'} */
  let saveMode = "bg";
  /** @type {object[]} */
  let saveQueue = [];
  let saveStepIndex = 0;
  /** @type {{ copied: number, skipped: number, collision: number, error: number }} */
  let saveStats = { copied: 0, skipped: 0, collision: 0, error: 0 };
  /** @type {object | null} */
  let currentStepPreview = null;

  function showError(msg) {
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function showModalNotice(msg, isError) {
    if (!msg) {
      saveModalNotice.hidden = true;
      saveModalNotice.textContent = "";
      saveModalNotice.classList.remove("image-intake__modal-notice--error");
      return;
    }
    saveModalNotice.hidden = false;
    saveModalNotice.textContent = msg;
    saveModalNotice.classList.toggle("image-intake__modal-notice--error", !!isError);
  }

  function showSuccess(msg) {
    showError("");
    summaryEl.textContent = msg;
    setTimeout(updateSummary, 6000);
  }

  function formatLocal(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function imageUrl(name) {
    return `/api/image?file=${encodeURIComponent(name)}`;
  }

  function getEntry(name) {
    if (!state.has(name)) {
      state.set(name, { bg: false, fg: false });
    }
    return state.get(name);
  }

  function syncBgOrder(name) {
    const e = getEntry(name);
    if (!e.bg) {
      bgOrder.delete(name);
      return;
    }
    if (!bgOrder.has(name)) {
      bgOrderCounter += 1;
      bgOrder.set(name, bgOrderCounter);
    }
  }

  function syncFgOrder(name) {
    const e = getEntry(name);
    if (!e.fg) {
      fgOrder.delete(name);
      return;
    }
    if (!fgOrder.has(name)) {
      fgOrderCounter += 1;
      fgOrder.set(name, fgOrderCounter);
    }
  }

  function countMarked() {
    let bg = 0;
    let fg = 0;
    for (const [, e] of state) {
      if (e.bg) bg += 1;
      if (e.fg) fg += 1;
    }
    return { bg, fg };
  }

  function getBinBackgroundFiles(bin) {
    return bin.images
      .filter((img) => getEntry(img.name).bg)
      .sort(
        (a, b) =>
          (bgOrder.get(a.name) ?? 999999) - (bgOrder.get(b.name) ?? 999999)
      )
      .map((img) => img.name);
  }

  function getBinForegroundFiles(bin) {
    return bin.images
      .filter((img) => getEntry(img.name).fg)
      .sort(
        (a, b) =>
          (fgOrder.get(a.name) ?? 999999) - (fgOrder.get(b.name) ?? 999999)
      )
      .map((img) => img.name);
  }

  function stepNeedsLocation(step) {
    return step && (step.type === "image" || step.type === "fg-batch");
  }

  function getBinLocationName(binIndex) {
    return (binLocationNames.get(binIndex) || "").trim();
  }

  function locationNameForStep(step) {
    if (!step) return "";
    const stored = getBinLocationName(step.binIndex);
    const current = saveQueue[saveStepIndex];
    if (
      current === step &&
      !saveModal.hidden &&
      saveModalLocation &&
      stepNeedsLocation(step)
    ) {
      const live = saveModalLocation.value.trim();
      return live || stored;
    }
    return stored;
  }

  function persistCurrentStepLocation() {
    const step = saveQueue[saveStepIndex];
    if (!step || !stepNeedsLocation(step) || !saveModalLocation) return;
    const val = saveModalLocation.value.trim();
    if (val) binLocationNames.set(step.binIndex, val);
    else binLocationNames.delete(step.binIndex);
  }

  function setModalLocationForStep(step) {
    if (!stepNeedsLocation(step)) {
      saveModalLocationWrap.hidden = true;
      return;
    }
    saveModalLocationWrap.hidden = false;
    saveModalLocation.value = getBinLocationName(step.binIndex);
    if (!saveModalLocation.value.trim()) {
      saveModalLocation.focus();
    }
  }

  function binHasLocation(binIndex) {
    return !!(binLocationNames.get(binIndex) || "").trim();
  }

  function getBinDisplayTitle(bin) {
    const loc = (binLocationNames.get(bin.index) || "").trim();
    if (namedBinsView && loc) return loc;
    return `Bin ${bin.index}`;
  }

  function visibleImagesForBin(bin) {
    return bin.images.filter((img) => !removedFromDisplay.has(img.name));
  }

  function shouldShowBin(bin) {
    if (!namedBinsView) return true;
    if (!binHasLocation(bin.index)) return false;
    if (visibleImagesForBin(bin).length === 0) return false;
    return true;
  }

  function removeProcessedFgFromDisplay(fileNames) {
    for (const name of fileNames) {
      removedFromDisplay.add(name);
      const e = getEntry(name);
      e.fg = false;
      e.bg = false;
      syncBgOrder(name);
      syncFgOrder(name);
    }
  }

  function applyNamedBinsView() {
    const hasNamed = [...binLocationNames.values()].some((v) => v.trim());
    if (!hasNamed) return;
    namedBinsView = true;
    document.body.classList.add("image-intake--named");
    renderBins();
    updateSelectionPanel();
    updateSummary();
  }

  function updateSummary() {
    if (!scanData) {
      summaryEl.textContent = "Paste a folder path and load to begin.";
      return;
    }
    const { bg, fg } = countMarked();
    const visibleBins = scanData.bins.filter(shouldShowBin);
    const binPart = namedBinsView
      ? `${visibleBins.length} location(s)`
      : `${scanData.binCount} bin(s)`;
    summaryEl.textContent =
      `${binPart} · ${scanData.imageCount} image(s) · ` +
      `gap ${scanData.gapMinutes} min (max consecutive gap ${scanData.maxGapMinutes ?? "?"} min) · ` +
      `${bg} BG, ${fg} FG marked`;
  }

  function updateSelectionPanel() {
    const rows = [];
    if (scanData) {
      for (const bin of scanData.bins) {
        if (!shouldShowBin(bin)) continue;
        const binLabel = getBinDisplayTitle(bin);
        for (const img of bin.images) {
          if (removedFromDisplay.has(img.name)) continue;
          const e = getEntry(img.name);
          if (!e.bg && !e.fg) continue;
          const marks = [e.bg && "BG", e.fg && "FG"].filter(Boolean).join(", ");
          rows.push(`<li>${binLabel}: <strong>${img.name}</strong> (${marks})</li>`);
        }
      }
    }
    if (!rows.length) {
      selectionPanel.hidden = true;
      selectionList.innerHTML = "";
      return;
    }
    selectionPanel.hidden = false;
    selectionList.innerHTML = rows.join("");
  }

  function onSelectionChanged() {
    syncOrdersForAll();
    updateSummary();
    updateSelectionPanel();
  }

  function syncOrdersForAll() {
    for (const name of [...bgOrder.keys()]) syncBgOrder(name);
    for (const name of [...fgOrder.keys()]) syncFgOrder(name);
    for (const [name] of state) {
      syncBgOrder(name);
      syncFgOrder(name);
    }
  }

  function buildBgSaveQueue() {
    const steps = [];
    if (!scanData) return steps;
    for (const bin of scanData.bins) {
      const files = getBinBackgroundFiles(bin);
      if (!files.length) {
        steps.push({ type: "empty", binIndex: bin.index });
        continue;
      }
      files.forEach((file, i) => {
        steps.push({
          type: "image",
          binIndex: bin.index,
          file,
          suffixIndex: i + 1,
          imageNum: i + 1,
          imageTotal: files.length,
        });
      });
    }
    return steps;
  }

  function buildFgSaveQueue() {
    const steps = [];
    if (!scanData) return steps;
    let letterIndex = fgCycleCounter;
    for (const bin of scanData.bins) {
      if (!binHasLocation(bin.index)) continue;

      const files = getBinForegroundFiles(bin);
      if (!files.length) {
        steps.push({ type: "fg-empty", binIndex: bin.index });
      } else if (files.length < 2) {
        steps.push({
          type: "fg-insufficient",
          binIndex: bin.index,
          count: files.length,
        });
      } else {
        const cycleLetter = String.fromCharCode(65 + letterIndex);
        letterIndex += 1;
        steps.push({
          type: "fg-batch",
          binIndex: bin.index,
          files,
          cycleLetter,
        });
      }
    }
    return steps;
  }

  function binLabelForStep(step) {
    if (!scanData) return "";
    const loc = getBinLocationName(step.binIndex);
    if (namedBinsView && loc) return loc;
    const bins = scanData.bins;
    return `Bin ${step.binIndex} of ${bins.length}`;
  }

  function closeSaveModal() {
    saveModal.hidden = true;
    saveModalLocationWrap.hidden = true;
    saveQueue = [];
    saveStepIndex = 0;
    currentStepPreview = null;
    saveMode = "bg";
    showModalNotice("");
    saveModalConfirm.disabled = false;
    saveModalSkip.disabled = false;
  }

  function finishSaveWalkthrough() {
    const completedMode = saveMode;
    const parts = [];
    if (saveStats.copied) parts.push(`${saveStats.copied} copied`);
    if (saveStats.skipped) parts.push(`${saveStats.skipped} skipped`);
    if (saveStats.collision) parts.push(`${saveStats.collision} collision(s)`);
    if (saveStats.error) parts.push(`${saveStats.error} error(s)`);
    const label = completedMode === "fg" ? "Save FG" : "Save BG";
    closeSaveModal();
    if (completedMode === "bg") {
      bgSaveCompleted = true;
      btnSaveFg.disabled = false;
    }
    if (completedMode === "fg") {
      removeProcessedFgFromDisplay(fgWalkthroughProcessed);
      fgWalkthroughProcessed = [];
    }
    applyNamedBinsView();
    updateSelectionPanel();
    updateSummary();
    if (parts.length) {
      showSuccess(`${label} complete: ${parts.join(", ")}`);
    } else {
      showSuccess(`${label} complete — nothing copied.`);
    }
  }

  function advanceSaveStep() {
    showModalNotice("");
    persistCurrentStepLocation();
    saveStepIndex += 1;
    if (saveStepIndex >= saveQueue.length) {
      finishSaveWalkthrough();
      return;
    }
    renderSaveStep();
  }

  async function fetchBgStepPreview(step) {
    const locationName = locationNameForStep(step);
    if (!locationName) {
      return { ok: false, error: `Enter a location name for Bin ${step.binIndex}.` };
    }
    const res = await fetch("/api/preview-save-backgrounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        binIndex: step.binIndex,
        locationName,
        files: [step.file],
        suffixIndex: step.suffixIndex,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `Preview failed (${res.status})` };
    }
    return { ok: true, data, locationName, destFolder: "Backgrounds_Raw" };
  }

  async function fetchFgStepPreview(step) {
    const locationName = locationNameForStep(step);
    if (!locationName) {
      return { ok: false, error: `Enter a location name for Bin ${step.binIndex}.` };
    }
    const res = await fetch("/api/preview-save-foregrounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        binIndex: step.binIndex,
        locationName,
        files: step.files,
        cycleLetter: step.cycleLetter,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `Preview failed (${res.status})` };
    }
    return { ok: true, data, locationName, destFolder: "Foregrounds_Raw" };
  }

  function renderDestPlans(plans, destFolder) {
    let html = '<ul class="image-intake__modal-dest-list">';
    let anyCollision = false;
    for (const plan of plans) {
      html += `<li><strong>${plan.from}</strong> → ${destFolder}/${plan.to}`;
      if (plan.status === "collision") {
        html += " (exists)";
        anyCollision = true;
      }
      html += "</li>";
    }
    html += "</ul>";
    if (anyCollision) {
      html +=
        '<p class="image-intake__modal-collision">Some targets already exist — Confirm will skip those (no overwrite).</p>';
    }
    return html;
  }

  async function renderBgSaveStep(step) {
    setModalLocationForStep(step);

    let html = `<div class="image-intake__modal-image-wrap">`;
    html += `<img class="image-intake__modal-image" src="${imageUrl(step.file)}" alt="${step.file}" />`;
    html += `</div>`;
    html += `<p class="image-intake__modal-filename"><strong>${step.file}</strong></p>`;
    saveModalBody.innerHTML = html;
    saveModalStep.textContent =
      `Step ${saveStepIndex + 1} of ${saveQueue.length} · image ${step.imageNum} of ${step.imageTotal}`;

    const locationName = locationNameForStep(step);
    if (!locationName) {
      saveModalBody.insertAdjacentHTML(
        "beforeend",
        '<p class="image-intake__modal-dest">Enter a location name above to see the save path.</p>'
      );
      return;
    }

    saveModalBody.insertAdjacentHTML(
      "beforeend",
      '<p class="image-intake__modal-loading">Loading save path…</p>'
    );

    const preview = await fetchBgStepPreview(step);
    const loadingEl = saveModalBody.querySelector(".image-intake__modal-loading");
    if (loadingEl) loadingEl.remove();

    if (!preview.ok) {
      saveModalBody.insertAdjacentHTML(
        "beforeend",
        `<p class="image-intake__modal-dest">${preview.error}</p>`
      );
      showModalNotice(preview.error, true);
      return;
    }

    currentStepPreview = { step, ...preview };
    const plan = preview.data.plans[0];
    saveModalBody.insertAdjacentHTML(
      "beforeend",
      `<p class="image-intake__modal-dest">→ <strong>${preview.destFolder}/${plan.to}</strong></p>` +
        (plan.status === "collision"
          ? '<p class="image-intake__modal-collision">Target already exists — Confirm will skip (no overwrite).</p>'
          : "")
    );
  }

  async function renderFgSaveStep(step) {
    setModalLocationForStep(step);

    let html = `<p class="image-intake__modal-cycle">Cycle <strong>${step.cycleLetter}</strong> · ${step.files.length} image(s)</p>`;
    html += '<div class="image-intake__modal-grid">';
    for (const file of step.files) {
      html += `<div class="image-intake__modal-grid-item">`;
      html += `<img src="${imageUrl(file)}" alt="${file}" />`;
      html += `<p>${file}</p>`;
      html += `</div>`;
    }
    html += "</div>";
    saveModalBody.innerHTML = html;
    saveModalStep.textContent = `Step ${saveStepIndex + 1} of ${saveQueue.length}`;

    const locationName = locationNameForStep(step);
    if (!locationName) {
      saveModalBody.insertAdjacentHTML(
        "beforeend",
        '<p class="image-intake__modal-dest">Enter a location name above to see save paths.</p>'
      );
      return;
    }

    saveModalBody.insertAdjacentHTML(
      "beforeend",
      '<p class="image-intake__modal-loading">Loading save paths…</p>'
    );

    const preview = await fetchFgStepPreview(step);
    const loadingEl = saveModalBody.querySelector(".image-intake__modal-loading");
    if (loadingEl) loadingEl.remove();

    if (!preview.ok) {
      saveModalBody.insertAdjacentHTML(
        "beforeend",
        `<p class="image-intake__modal-dest">${preview.error}</p>`
      );
      showModalNotice(preview.error, true);
      return;
    }

    currentStepPreview = { step, ...preview };
    saveModalBody.insertAdjacentHTML(
      "beforeend",
      renderDestPlans(preview.data.plans, preview.destFolder)
    );
  }

  async function renderSaveStep() {
    const step = saveQueue[saveStepIndex];
    if (!step) {
      finishSaveWalkthrough();
      return;
    }

    saveModal.hidden = false;
    saveModalConfirm.disabled = false;
    saveModalSkip.disabled = false;
    currentStepPreview = null;
    showModalNotice("");

    const binLabel = binLabelForStep(step);
    saveModalTitle.textContent =
      saveMode === "fg"
        ? `Save foregrounds — ${binLabel}`
        : `Save backgrounds — ${binLabel}`;

    if (step.type === "empty") {
      saveModalLocationWrap.hidden = true;
      saveModalBody.innerHTML =
        '<p class="image-intake__modal-empty">No background selected</p>';
      saveModalStep.textContent = `Step ${saveStepIndex + 1} of ${saveQueue.length}`;
      return;
    }

    if (step.type === "fg-empty") {
      saveModalLocationWrap.hidden = true;
      saveModalBody.innerHTML =
        '<p class="image-intake__modal-empty">No foreground selected</p>';
      saveModalStep.textContent = `Step ${saveStepIndex + 1} of ${saveQueue.length}`;
      return;
    }

    if (step.type === "fg-insufficient") {
      saveModalLocationWrap.hidden = true;
      saveModalBody.innerHTML =
        `<p class="image-intake__modal-empty">Select at least 2 foreground images (this bin has ${step.count})</p>`;
      saveModalStep.textContent = `Step ${saveStepIndex + 1} of ${saveQueue.length}`;
      return;
    }

    try {
      if (saveMode === "fg" && step.type === "fg-batch") {
        await renderFgSaveStep(step);
      } else if (step.type === "image") {
        await renderBgSaveStep(step);
      }
    } catch (err) {
      saveModalBody.innerHTML = "";
      showModalNotice(err.message || String(err), true);
    }
  }

  function startSaveWalkthrough(mode) {
    if (!scanData) return;
    showError("");
    saveMode = mode;
    saveQueue = mode === "fg" ? buildFgSaveQueue() : buildBgSaveQueue();
    if (mode === "fg") fgWalkthroughProcessed = [];
    saveStepIndex = 0;
    saveStats = { copied: 0, skipped: 0, collision: 0, error: 0 };
    if (!saveQueue.length) {
      showError("No bins to process.");
      return;
    }
    renderSaveStep();
  }

  function tallySavePlans(plans) {
    for (const plan of plans) {
      if (plan.status === "copied") {
        saveStats.copied += 1;
      } else if (plan.status === "collision") {
        saveStats.collision += 1;
        saveStats.skipped += 1;
      } else {
        saveStats.error += 1;
        saveStats.skipped += 1;
      }
    }
  }

  async function onSaveConfirm() {
    const step = saveQueue[saveStepIndex];
    if (!step) return;

    if (
      step.type === "empty" ||
      step.type === "fg-empty" ||
      step.type === "fg-insufficient"
    ) {
      saveStats.skipped += 1;
      advanceSaveStep();
      return;
    }

    const locationName = locationNameForStep(step);
    if (!locationName) {
      showModalNotice(`Enter a location name for Bin ${step.binIndex}.`, true);
      return;
    }

    persistCurrentStepLocation();

    if (!currentStepPreview?.step) {
      const preview =
        saveMode === "fg"
          ? await fetchFgStepPreview(step)
          : await fetchBgStepPreview(step);
      if (!preview.ok) {
        showModalNotice(preview.error, true);
        return;
      }
      currentStepPreview = { step, ...preview };
    }

    saveModalConfirm.disabled = true;
    saveModalSkip.disabled = true;

    try {
      const isFg = saveMode === "fg" && step.type === "fg-batch";
      const res = await fetch(
        isFg ? "/api/save-foregrounds" : "/api/save-backgrounds",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isFg
              ? {
                  binIndex: step.binIndex,
                  locationName,
                  files: step.files,
                  cycleLetter: step.cycleLetter,
                  confirm: true,
                }
              : {
                  binIndex: step.binIndex,
                  locationName,
                  files: [step.file],
                  suffixIndex: step.suffixIndex,
                  confirm: true,
                }
          ),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showModalNotice(data.error || `Save failed (${res.status})`, true);
        saveModalConfirm.disabled = false;
        saveModalSkip.disabled = false;
        return;
      }

      tallySavePlans(data.plans);
      if (isFg) {
        fgWalkthroughProcessed.push(...step.files);
        fgCycleCounter += 1;
      }
      const copied = data.plans.filter((p) => p.status === "copied");
      if (copied.length) {
        showModalNotice(
          copied.length === 1
            ? `Copied → ${copied[0].to}`
            : `Copied ${copied.length} file(s)`
        );
      } else {
        const first = data.plans[0];
        showModalNotice(first?.error || `Skipped: ${first?.to}`, true);
      }

      setTimeout(advanceSaveStep, copied.length ? 500 : 700);
    } catch (err) {
      showModalNotice(err.message || String(err), true);
      saveModalConfirm.disabled = false;
      saveModalSkip.disabled = false;
    }
  }

  function onSaveSkip() {
    saveStats.skipped += 1;
    advanceSaveStep();
  }

  function refreshCard(cardEl, name) {
    const e = getEntry(name);
    const bgCb = cardEl.querySelector(".image-intake__card-checkbox--bg");
    const fgCb = cardEl.querySelector(".image-intake__card-checkbox--fg");
    if (bgCb) bgCb.checked = e.bg;
    if (fgCb) fgCb.checked = e.fg;
    cardEl.classList.toggle("image-intake__card--bg", e.bg);
    cardEl.classList.toggle("image-intake__card--fg", e.fg);
  }

  function addCardCheckbox(parent, card, img, kind, label) {
    const checkRow = document.createElement("label");
    checkRow.className = `image-intake__card-check image-intake__card-check--${kind}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = `image-intake__card-checkbox image-intake__card-checkbox--${kind}`;
    checkbox.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const e = getEntry(img.name);
      e[kind] = checkbox.checked;
      if (checkbox.checked) {
        const other = kind === "bg" ? "fg" : "bg";
        e[other] = false;
      }
      syncBgOrder(img.name);
      syncFgOrder(img.name);
      refreshCard(card, img.name);
      onSelectionChanged();
    });

    const checkLabel = document.createElement("span");
    checkLabel.textContent = label;

    checkRow.appendChild(checkbox);
    checkRow.appendChild(checkLabel);
    parent.appendChild(checkRow);
  }

  function renderBins() {
    binsEl.innerHTML = "";
    if (!scanData || !scanData.bins.length) {
      binsEl.innerHTML =
        '<p class="image-intake__summary">No images found in this folder.</p>';
      return;
    }

    for (const bin of scanData.bins) {
      if (!shouldShowBin(bin)) continue;

      const visibleImages = visibleImagesForBin(bin);
      if (!visibleImages.length) continue;

      const section = document.createElement("section");
      section.className = "image-intake__bin";
      section.dataset.binIndex = String(bin.index);

      const header = document.createElement("div");
      header.className = "image-intake__bin-header";
      header.innerHTML =
        `${getBinDisplayTitle(bin)}` +
        `<span>${formatLocal(bin.start)} – ${formatLocal(bin.end)} · ${visibleImages.length} image(s)</span>`;
      section.appendChild(header);

      const row = document.createElement("div");
      row.className = "image-intake__thumbs";

      for (const img of visibleImages) {
        getEntry(img.name);

        const card = document.createElement("article");
        card.className = "image-intake__card";
        card.dataset.name = img.name;

        const thumb = document.createElement("img");
        thumb.className = "image-intake__card-thumb";
        thumb.src = imageUrl(img.name);
        thumb.alt = img.name;
        thumb.loading = "lazy";
        card.appendChild(thumb);

        const meta = document.createElement("div");
        meta.className = "image-intake__card-meta";
        meta.innerHTML =
          `<div class="image-intake__card-name">${img.name}</div>` +
          `<div class="image-intake__card-time">${formatLocal(img.captureAt)}</div>`;
        card.appendChild(meta);

        const checks = document.createElement("div");
        checks.className = "image-intake__card-checks";
        addCardCheckbox(checks, card, img, "bg", "BG");
        addCardCheckbox(checks, card, img, "fg", "FG");
        card.appendChild(checks);

        refreshCard(card, img.name);
        row.appendChild(card);
      }

      section.appendChild(row);
      binsEl.appendChild(section);
    }
  }

  async function runScan() {
    showError("");
    const sourcePath = sourceInput.value.trim();
    if (!sourcePath) {
      showError("Enter an absolute source folder path.");
      return;
    }

    const gapMinutes = Number(gapInput.value);
    const appliedGap =
      Number.isFinite(gapMinutes) && gapMinutes > 0
        ? gapMinutes
        : DEFAULT_GAP_MINUTES;
    btnLoad.disabled = true;
    btnRebin.disabled = true;
    btnSaveBg.disabled = true;
    btnSaveFg.disabled = true;

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, gapMinutes: appliedGap }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.error || `Load failed (${res.status})`);
        return;
      }

      closeSaveModal();
      state.clear();
      bgOrder.clear();
      fgOrder.clear();
      bgOrderCounter = 0;
      fgOrderCounter = 0;
      binLocationNames.clear();
      namedBinsView = false;
      bgSaveCompleted = false;
      removedFromDisplay.clear();
      fgWalkthroughProcessed = [];
      fgCycleCounter = 0;
      document.body.classList.remove("image-intake--named");
      scanData = data;
      sourceInput.value = data.sourcePath;
      gapInput.value = String(data.gapMinutes);
      btnRebin.disabled = false;
      btnSaveBg.disabled = false;
      btnSaveFg.disabled = true;
      renderBins();
      updateSummary();
      updateSelectionPanel();
    } catch (err) {
      const msg = err.message || String(err);
      if (msg === "Failed to fetch" || err.name === "TypeError") {
        showError(
          "Could not reach the intake server. Run: " +
            "cd ~/CyanoVerse/ask-marvin-scene-assets && npm run intake:images"
        );
      } else {
        showError(msg);
      }
    } finally {
      btnLoad.disabled = false;
    }
  }

  btnLoad.addEventListener("click", runScan);
  btnRebin.addEventListener("click", runScan);
  btnSaveBg.addEventListener("click", () => startSaveWalkthrough("bg"));
  btnSaveFg.addEventListener("click", () => startSaveWalkthrough("fg"));
  saveModalConfirm.addEventListener("click", onSaveConfirm);
  saveModalSkip.addEventListener("click", onSaveSkip);

  saveModal.querySelectorAll("[data-action=close-modal]").forEach((el) => {
    el.addEventListener("click", closeSaveModal);
  });

  let locationPreviewTimer = null;
  saveModalLocation.addEventListener("input", () => {
    const step = saveQueue[saveStepIndex];
    if (!stepNeedsLocation(step)) return;
    const val = saveModalLocation.value.trim();
    if (val) binLocationNames.set(step.binIndex, val);
    else binLocationNames.delete(step.binIndex);
    clearTimeout(locationPreviewTimer);
    locationPreviewTimer = setTimeout(() => {
      if (!saveModal.hidden && saveQueue[saveStepIndex] === step) {
        renderSaveStep();
      }
    }, 350);
  });

  sourceInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") runScan();
  });

  gapInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") runScan();
  });

  gapInput.value = String(DEFAULT_GAP_MINUTES);
})();
