const { app, BrowserWindow, Menu, net, protocol, session, shell } = require("electron");
const fs = require("node:fs/promises");
const { existsSync, mkdirSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_SCHEME = "luckydraw";
const APP_HOST = "app";
const SELF_TEST = process.argv.includes("--self-test");
const CAPTURE_DIR = process.env.LUCKYDRAW_CAPTURE_DIR;
const ALWAYS_FULLSCREEN = !SELF_TEST;
const pendingDownloadPaths = new Set();
const winnerSavePaths = new Map();
let winnerPathsReady;
let winnerWriteQueue = Promise.resolve();
let isQuitting = false;
let quitApproved = false;
let quitSaving = false;

if (SELF_TEST) {
  app.setPath("userData", path.join(os.tmpdir(), `luckydraw-self-test-${process.pid}`));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }[extension] || "application/octet-stream";
}

function resourcePathFromUrl(requestUrl) {
  const parsed = new URL(requestUrl);
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST) return null;

  const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "") || "upload.html";
  const normalizedPath = path.normalize(relativePath);
  if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) return null;

  const appRoot = app.getAppPath();
  const resourcePath = path.join(appRoot, normalizedPath);
  if (!resourcePath.startsWith(appRoot + path.sep)) return null;
  return resourcePath;
}

async function nextAvailablePath(directoryPath, fileName) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidatePath = path.join(directoryPath, fileName);
  let suffix = 2;

  while (true) {
    try {
      await fs.access(candidatePath);
      candidatePath = path.join(directoryPath, `${baseName} (${suffix})${extension}`);
      suffix += 1;
    } catch (error) {
      if (error.code === "ENOENT") return candidatePath;
      throw error;
    }
  }
}

async function saveBundledFileToDownloads(requestUrl) {
  const sourcePath = resourcePathFromUrl(requestUrl);
  if (!sourcePath) return;

  const downloadsPath = SELF_TEST
    ? path.join(app.getPath("userData"), "Downloads")
    : app.getPath("downloads");
  await fs.mkdir(downloadsPath, { recursive: true });
  const destinationPath = await nextAvailablePath(downloadsPath, path.basename(sourcePath));
  await fs.copyFile(sourcePath, destinationPath);
  if (!SELF_TEST) shell.showItemInFolder(destinationPath);
  return destinationPath;
}

function winnerDirectory() {
  return SELF_TEST ? path.join(app.getPath("userData"), "Desktop") : app.getPath("desktop");
}

function loadWinnerSavePaths() {
  if (!winnerPathsReady) winnerPathsReady = (async () => {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "winner-save-paths.json"), "utf8"));
      for (const [id, fileName] of Object.entries(saved)) {
        if (/^[a-zA-Z0-9-]{1,100}$/.test(id) && /^당첨자명단_\d+\.xlsx$/.test(fileName)) {
          winnerSavePaths.set(id, path.join(winnerDirectory(), fileName));
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  })();
  return winnerPathsReady;
}

function saveWinnerWorkbook(eventId, bytes) {
  const task = winnerWriteQueue.then(async () => {
    await loadWinnerSavePaths();
    const directory = winnerDirectory();
    await fs.mkdir(directory, { recursive: true });
    let destination = winnerSavePaths.get(eventId);
    if (!destination) {
      const names = [...await fs.readdir(directory), ...[...winnerSavePaths.values()].map((filePath) => path.basename(filePath))];
      const highest = names.reduce((maximum, name) => {
        const match = /^당첨자명단_(\d+)\.xlsx$/.exec(name);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
      }, 0);
      destination = path.join(directory, `당첨자명단_${highest + 1}.xlsx`);
      winnerSavePaths.set(eventId, destination);
    }
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    const metadata = path.join(app.getPath("userData"), "winner-save-paths.json");
    const metadataTemporary = `${metadata}.${process.pid}.tmp`;
    await fs.writeFile(metadataTemporary, JSON.stringify(Object.fromEntries([...winnerSavePaths].map(([id, filePath]) => [id, path.basename(filePath)]))));
    await fs.rename(metadataTemporary, metadata);
    return { fileName: path.basename(destination) };
  });
  winnerWriteQueue = task.catch(() => {});
  return task;
}

async function finalizeWindows() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const saved = await window.webContents.executeJavaScript("window.finalizeWinnerSave ? window.finalizeWinnerSave() : true");
    if (saved === false) throw new Error("final winner save failed");
  }
  await winnerWriteQueue;
}

function configureOfflineProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const resourcePath = resourcePathFromUrl(request.url);
    if (!resourcePath) return new Response("Not found", { status: 404 });

    if (new URL(request.url).pathname === "/_save-winners") {
      const eventId = request.headers.get("X-LuckyDraw-Event") || "";
      if (request.method !== "POST" || !/^[a-zA-Z0-9-]{1,100}$/.test(eventId)) return new Response("Invalid save request", { status: 400 });
      try {
        const bytes = Buffer.from(await request.arrayBuffer());
        if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return new Response("Invalid workbook", { status: 400 });
        return new Response(JSON.stringify(await saveWinnerWorkbook(eventId, bytes)), { headers: { "Content-Type": "application/json" } });
      } catch {
        return new Response(JSON.stringify({ error: "바탕화면에 엑셀을 저장하지 못했습니다. 파일이 열려 있으면 닫고 다시 저장해주세요." }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }

    try {
      const data = await fs.readFile(resourcePath);
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": mimeType(resourcePath) }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true })
  );

  session.defaultSession.on("will-download", (event, item, contents) => {
    if (!contents?.getURL().startsWith(`${APP_SCHEME}://${APP_HOST}/`) || item.getFilename() !== "당첨자명단.xlsx") return;
    try {
      const directory = winnerDirectory();
      mkdirSync(directory, { recursive: true });
      let destination = path.join(directory, "당첨자명단.xlsx");
      let suffix = 2;
      while (existsSync(destination) || pendingDownloadPaths.has(destination) || [...winnerSavePaths.values()].includes(destination)) destination = path.join(directory, `당첨자명단 (${suffix++}).xlsx`);
      item.setSavePath(destination);
      pendingDownloadPaths.add(destination);
      item.once("done", (_event, downloadState) => {
        pendingDownloadPaths.delete(destination);
        if (downloadState === "completed") {
          if (!SELF_TEST) shell.showItemInFolder(destination);
        } else if (!contents.isDestroyed()) {
          contents.executeJavaScript('showStageStatus("당첨자명단을 저장하지 못했습니다. 다시 시도해주세요.")').catch(() => {});
        }
      });
    } catch {
      event.preventDefault();
      if (!contents.isDestroyed()) contents.executeJavaScript('showStageStatus("당첨자명단을 저장하지 못했습니다. 바탕화면 폴더를 확인해주세요.")').catch(() => {});
    }
  });
}

function configureWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${APP_SCHEME}://${APP_HOST}/`) && url.toLowerCase().endsWith(".xlsx")) {
      saveBundledFileToDownloads(url).catch(() => {});
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://${APP_HOST}/`)) event.preventDefault();
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    if (input.key === "Escape") {
      event.preventDefault();
      window.webContents.executeJavaScript(`(() => {
        const dialog = document.getElementById("settingsDialog");
        if (!dialog?.open) return false;
        dialog.close();
        return true;
      })()`).then((closedSettings) => {
        if (!closedSettings) { isQuitting = true; app.quit(); }
      }).catch(() => {});
      return;
    }

    if (input.key === "F11") {
      event.preventDefault();
    }
  });

  window.on("leave-full-screen", () => {
    if (!ALWAYS_FULLSCREEN || isQuitting) return;
    window.setFullScreen(true);
  });
  window.on("close", (event) => {
    if (quitApproved) return;
    event.preventDefault();
    if (!quitSaving) app.quit();
  });
}

async function testBatchDraw(window) {
  await window.webContents.executeJavaScript(`
    state = store.register(Array.from({ length: 15 }, (_, index) => String(12301 + index).padStart(6, "0")));
    drawCount = 4;
    prizeName = "무선 키보드";
    localStorage.setItem("luckydraw_count", "4");
    renderCards(drawCount);
    renderHistory();
    if (fireConfetti) fireConfetti.reset();
  `);
  const layouts = [];
  for (const [width, height] of [[1280, 720], [2304, 640], [1920, 1080], [3440, 1440], [3840, 2160], [5120, 1440], [1080, 1920]]) {
    window.setContentSize(width, height);
    {
      await window.webContents.executeJavaScript("updateStageScale()");
      await new Promise((resolve) => setTimeout(resolve, 100));
      layouts.push(await window.webContents.executeJavaScript(`
        (() => {
          const panels = [...document.querySelectorAll(".digits-wrapper")].map((panel) => panel.getBoundingClientRect());
          return { width: innerWidth, height: innerHeight, direction: drawLayout,
            fits: panels.every((panel) => panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight),
            directionCorrect: panels.slice(1).every((panel, index) => Math.abs(panel.top - panels[0].top) < 1 && panel.left >= panels[index].right),
            panels: panels.length,
            onlyNumbers: /^\\d{24}$/.test(document.body.innerText.replace(/\\s/g, "")),
            settingsHidden: !settingsDialog.open,
            historyHidden: historyPanel.hidden };
        })()
      `));
    }
  }
  if (layouts.some((layout) => !layout.fits || !layout.directionCorrect || !layout.onlyNumbers || !layout.settingsHidden || !layout.historyHidden || layout.panels !== 4)) {
    throw new Error(`stage layout failed: ${JSON.stringify(layouts)}`);
  }
  window.setContentSize(2304, 640);
  await window.webContents.executeJavaScript("renderCards(drawCount)");
  if (CAPTURE_DIR) {
    const bytes = await fs.readFile(path.join(app.getAppPath(), "images/logitech-lucky-draw-bg.png"));
    await window.webContents.executeJavaScript(`
      (async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}), (c) => c.charCodeAt(0));
        await LuckyDrawBackground.save(new File([bytes], "event-background.png", { type: "image/png" }));
        await loadEventBackground();
      })()
    `);
  }
  await window.webContents.executeJavaScript(`
    (async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true }));
      if (isPlaying || store.load().history.length) throw new Error("held Enter started a draw");
      const drawing = startDraw();
      startDraw();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      if (!isPlaying || store.load().history.length !== 1) throw new Error("draw reentry guard failed");
      await drawing;
      prizeName = "무선 마우스";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      while (isPlaying) await wait(80);
    })()
  `);
  const result = await window.webContents.executeJavaScript(`
    (() => {
      const saved = store.load();
      const displayed = [...document.querySelectorAll(".digits-wrapper")].map((row) => row.textContent);
      return { history: saved.history, remaining: saved.remaining, displayed, isPlaying,
        historyVisible: !historyPanel.hidden,
        recorded: [...document.querySelectorAll(".history-number")].map((number) => number.textContent),
        settingsHidden: !settingsDialog.open };
    })()
  `);
  if (result.history.length !== 2 || result.history[0].prize !== "무선 키보드" || result.history[1].prize !== "무선 마우스" ||
      result.history.some((round) => round.winners.length !== 4) || new Set(result.history.flatMap((round) => round.winners)).size !== 8 ||
      result.remaining.length !== 7 || !result.historyVisible || !result.settingsHidden || result.recorded.length !== 8 || result.isPlaying ||
      JSON.stringify(result.displayed) !== JSON.stringify(result.history[1].winners)) {
    throw new Error(`batch draw failed: ${JSON.stringify(result)}`);
  }
  if (CAPTURE_DIR) {
      await window.webContents.executeJavaScript(`
        updateStageScale();
        if (fireConfetti) fireConfetti.reset();
      `);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await fs.writeFile(path.join(CAPTURE_DIR, "horizontal-stage.png"), (await window.webContents.capturePage()).toPNG());
  }
  return result;
}

async function testLiveSettings(window) {
  await window.webContents.executeJavaScript(`
    (async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", repeat: true }));
      if (settingsDialog.open) throw new Error("held F2 opened settings");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "F2" }));
      if (!settingsDialog.open) throw new Error("F2 did not open settings");
      const before = localStorage.getItem(LuckyDrawStore.STATE_KEY);
      await startDraw();
      settingsPrize.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      settingsPrize.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true }));
      if (drawCount !== 4) throw new Error("number shortcut changed count inside settings");
      if (isPlaying || before !== localStorage.getItem(LuckyDrawStore.STATE_KEY)) throw new Error("settings started a draw");
    })()
  `);
  if (CAPTURE_DIR) await fs.writeFile(path.join(CAPTURE_DIR, "settings-ui.png"), (await window.webContents.capturePage()).toPNG());
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ESC" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ESC" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (await window.webContents.executeJavaScript("settingsDialog.open")) throw new Error("Escape did not close settings");

  await window.webContents.executeJavaScript(`
    (async () => {
      for (const count of [1, 2, 3]) {
        const before = localStorage.getItem(LuckyDrawStore.STATE_KEY);
        const previousExport = JSON.stringify(XLSX.utils.sheet_to_json(LuckyDrawExport.createWorkbook(store.load().history, XLSX).Sheets["당첨자명단"], { header: 1, raw: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: String(count), code: count === 2 ? "Numpad2" : "Digit" + count }));
        if (settingsDialog.open || drawCount !== count || localStorage.getItem("luckydraw_count") !== String(count) ||
            document.querySelectorAll(".digits-wrapper").length !== count || before !== localStorage.getItem(LuckyDrawStore.STATE_KEY)) {
          throw new Error("count change did not preserve existing draw state: " + count);
        }
        if (previousExport !== JSON.stringify(XLSX.utils.sheet_to_json(LuckyDrawExport.createWorkbook(store.load().history, XLSX).Sheets["당첨자명단"], { header: 1, raw: true }))) throw new Error("number shortcut changed existing Excel data");
        const previousTotal = document.querySelectorAll(".history-number").length;
        const drawing = startDraw();
        if (!isPlaying || grid.getAttribute("aria-busy") !== "true" || document.querySelectorAll(".digit-box.reveal").length) throw new Error("panels did not spin together");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "F2" }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "4", code: "Digit4" }));
        if (settingsDialog.open || drawCount !== count) throw new Error("settings opened during a draw");
        if (!exportButton.disabled) throw new Error("export allowed unrevealed results");
        if (document.querySelectorAll(".history-number").length !== previousTotal) throw new Error("history disclosed winners before reveal");
        await drawing;
        const saved = store.load();
        if (!saved.history.at(-1).separateBefore) throw new Error("count change did not separate the next Excel group");
        const recorded = [...document.querySelectorAll(".history-number")].map((number) => number.textContent);
        if (recorded.length !== previousTotal + count || JSON.stringify(recorded) !== JSON.stringify([...saved.history].reverse().flatMap((round) => round.winners))) {
          throw new Error("automatic winner history does not match saved results");
        }
      }
      const before = localStorage.getItem(LuckyDrawStore.STATE_KEY);
      await startDraw();
      if (before !== localStorage.getItem(LuckyDrawStore.STATE_KEY) || stageStatus.hidden || isPlaying) throw new Error("insufficient participants changed state");
      stageStatus.hidden = true;
    })()
  `);

  const layouts = [];
  for (const [width, height] of [[1280, 720], [2304, 640], [1080, 1920], [3840, 2160]]) {
    window.setContentSize(width, height);
    layouts.push(await window.webContents.executeJavaScript(`
      (() => {
        const failures = [];
        const before = localStorage.getItem(LuckyDrawStore.STATE_KEY);
        for (const count of [1, 2, 3, 4]) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: String(count), code: "Digit" + count }));
          const history = historyPanel.getBoundingClientRect();
          const panels = [...document.querySelectorAll(".digits-wrapper")].map((panel) => panel.getBoundingClientRect());
          const fits = panels.every((panel) => panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight);
          const separate = panels.every((panel) => panel.bottom <= history.top);
          const horizontal = panels.every((panel) => Math.abs(panel.top - panels[0].top) < 1);
          const historyFits = history.left >= 0 && history.right <= innerWidth && history.top >= 0 && history.bottom <= innerHeight;
          if (!fits || !separate || !historyFits || !horizontal || drawCount !== count || before !== localStorage.getItem(LuckyDrawStore.STATE_KEY)) failures.push({ count, fits, separate, historyFits, horizontal });
        }
        return { width: innerWidth, height: innerHeight, failures };
      })()
    `));
  }
  if (layouts.some((layout) => layout.failures.length)) throw new Error(`history layout failed: ${JSON.stringify(layouts)}`);

  window.setContentSize(2304, 640);
  await window.webContents.executeJavaScript(`
    toggleSettings();
    settingsCount.value = "3";
    document.getElementById("settingsForm").requestSubmit();
    if (fireConfetti) fireConfetti.reset();
  `);
  if (CAPTURE_DIR) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await fs.writeFile(path.join(CAPTURE_DIR, "winner-history-ui.png"), (await window.webContents.capturePage()).toPNG());
  }
  return window.webContents.executeJavaScript(`(() => {
    const saved = store.load();
    if (new Set(saved.history.flatMap((round) => round.winners)).size !== 14 || saved.remaining.length !== 1 ||
        JSON.stringify(saved.history.map((round) => round.winners.length)) !== JSON.stringify([4, 4, 1, 2, 3])) throw new Error("mixed counts lost results or repeated a winner");
    return saved;
  })()`);
}

async function testWinnerExport(window) {
  async function download(trigger) {
    let onDownload;
    let timer;
    const completed = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("winner export download timed out")), 10000);
      onDownload = (_event, item) => item.once("done", (_doneEvent, state) => {
        if (state === "completed") resolve(item.getSavePath());
        else reject(new Error("winner export download failed: " + state));
      });
      session.defaultSession.once("will-download", onDownload);
    });
    try {
      await window.webContents.executeJavaScript(trigger);
      return await completed;
    } finally {
      clearTimeout(timer);
      session.defaultSession.removeListener("will-download", onDownload);
    }
  }
  const before = await window.webContents.executeJavaScript("localStorage.getItem(LuckyDrawStore.STATE_KEY)");
  const firstPath = await download('exportButton.click()');
  const firstBytes = await fs.readFile(firstPath);
  await window.webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1" }))');
  if (!firstBytes.equals(await fs.readFile(firstPath))) throw new Error("count shortcut changed the saved Excel file");
  const secondPath = await download('document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }))');
  if (path.basename(firstPath) !== "당첨자명단 (2).xlsx" || path.basename(secondPath) !== "당첨자명단 (3).xlsx" ||
      path.dirname(firstPath) !== winnerDirectory() ||
      !firstBytes.equals(await fs.readFile(firstPath))) throw new Error("winner export overwrote an existing file");
  const xlsx = require("../vendor/xlsx.full.min.js");
  for (const filePath of [firstPath, secondPath]) {
    const workbook = xlsx.read(await fs.readFile(filePath), { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets["당첨자명단"];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: null });
    const expected = JSON.parse(before).history.flatMap((round) => round.winners);
    const winners = rows.slice(1).filter((row) => row[0] !== null);
    if (JSON.stringify(winners.map((row) => row[3])) !== JSON.stringify(expected) ||
        winners.some((row, index) => row[0] !== index + 1) ||
        rows.filter((row) => row.every((cell) => cell === null)).length !== 3) throw new Error("downloaded Excel lost winners or count-change separators");
  }
  const after = await window.webContents.executeJavaScript(`
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Numpad3" }));
    stageStatus.hidden = true;
    localStorage.getItem(LuckyDrawStore.STATE_KEY);
  `);
  if (before !== after) throw new Error("export or number shortcut changed winner history");
  return { firstPath, firstBytes };
}

async function testAutomaticWorkbook(window, expectedCount) {
  await window.webContents.executeJavaScript("winnerSaver.flush()");
  const saved = await window.webContents.executeJavaScript("({ id: localStorage.getItem('luckydraw_event_id'), history: store.load().history, status: saveStatus.dataset.state })");
  const destination = winnerSavePaths.get(saved.id);
  if (!destination || path.dirname(destination) !== winnerDirectory() || saved.status !== "saved") throw new Error("desktop automatic save did not complete");
  const xlsx = require("../vendor/xlsx.full.min.js");
  const bytes = await fs.readFile(destination);
  const workbook = xlsx.read(bytes, { type: "buffer" });
  const actual = xlsx.utils.sheet_to_json(workbook.Sheets["당첨자명단"], { header: 1 }).slice(1).filter((row) => row[0]).map((row) => row[3]);
  if (actual.length !== expectedCount || JSON.stringify(actual) !== JSON.stringify(saved.history.flatMap((round) => round.winners))) throw new Error("automatic workbook does not contain the latest cumulative winners");
  return { destination, bytes };
}

function installSelfTest(window) {
  let stage = 0;
  const timeout = setTimeout(() => {
    process.stdout.write("SELF_TEST_FAILED: timed out\n");
    app.exit(1);
  }, 90000);

  window.webContents.on("did-finish-load", async () => {
    const url = window.webContents.getURL();

    try {
      if (stage === 0 && url.endsWith("/upload.html")) {
        if (!await window.webContents.executeJavaScript("window.eventInitialization")) throw new Error("new event initialization failed");
        const firstDownload = await saveBundledFileToDownloads(
          `${APP_SCHEME}://${APP_HOST}/files/luckydraw_sample.xlsx`
        );
        const secondDownload = await saveBundledFileToDownloads(
          `${APP_SCHEME}://${APP_HOST}/files/luckydraw_sample.xlsx`
        );
        const downloadsPath = path.join(app.getPath("userData"), "Downloads");
        if (
          path.dirname(firstDownload) !== downloadsPath ||
          path.basename(firstDownload) !== "luckydraw_sample.xlsx" ||
          path.basename(secondDownload) !== "luckydraw_sample (2).xlsx"
        ) {
          throw new Error("download folder or duplicate file naming validation failed");
        }

        if (CAPTURE_DIR) {
          await fs.mkdir(CAPTURE_DIR, { recursive: true });
          const image = await window.webContents.capturePage();
          await fs.writeFile(path.join(CAPTURE_DIR, "upload-ui.png"), image.toPNG());
        }

        const result = await window.webContents.executeJavaScript(`
          (async () => {
            if (typeof XLSX === "undefined") return "XLSX_MISSING";
            if (typeof LuckyDrawBackground === "undefined") return "BACKGROUND_STORE_MISSING";
            const canvas = document.createElement("canvas");
            canvas.width = 32;
            canvas.height = 18;
            const context = canvas.getContext("2d");
            context.fillStyle = "#123456";
            context.fillRect(0, 0, canvas.width, canvas.height);
            const backgroundBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
            await LuckyDrawBackground.save(new File([backgroundBlob], "self-test.png", { type: "image/png" }));
            document.getElementById("rangeTab").click();
            const start = document.getElementById("startNumber");
            const end = document.getElementById("endNumber");
            const excluded = document.getElementById("excludeNumbers");
            start.value = "99999";
            end.value = "100001";
            excluded.value = "100000";
            start.dispatchEvent(new Event("input", { bubbles: true }));
            end.dispatchEvent(new Event("input", { bubbles: true }));
            const submit = document.getElementById("submitButton");
            submit.click();
            const range = localStorage.getItem("luckydraw_numbers");

            document.getElementById("excelTab").click();
            const sheet = XLSX.utils.aoa_to_sheet([
              ["연번", "사원번호"], [1], [], [2, 12345], [3, 7],
              [4, 123456], [5, "012346"], [6, 1234567], [7, "ABC123"]
            ]);
            sheet.B4.z = "000000";
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, sheet, "참가자");
            const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], "self-test.xlsx");
            const transfer = new DataTransfer();
            transfer.items.add(file);
            document.getElementById("excelFile").files = transfer.files;
            excluded.value = "12346";
            const message = document.getElementById("feedbackModalMessage");
            const uploadFinished = new Promise((resolve) => {
              const observer = new MutationObserver(() => {
                observer.disconnect();
                resolve();
              });
              observer.observe(message, { childList: true });
            });
            submit.click();
            await uploadFinished;
            return { range, message: message.textContent };
          })()
        `);

        if (result.range !== JSON.stringify(["099999", "100001"]) || result.message !== "3명의 참가자를 저장했습니다!") {
          throw new Error(`range or Excel registration failed: ${JSON.stringify(result)}`);
        }

        if (CAPTURE_DIR) {
          const image = await window.webContents.capturePage();
          await fs.writeFile(path.join(CAPTURE_DIR, "registration-ui.png"), image.toPNG());
        }

        stage = 1;
        await window.webContents.executeJavaScript(
          `document.getElementById("feedbackModalButton").click()`
        );
        return;
      }

      if (stage === 1 && url.endsWith("/index.html")) {
        await window.webContents.executeJavaScript(`drawCount = 1; renderCards(1)`);
        if (CAPTURE_DIR) {
          const image = await window.webContents.capturePage();
          await fs.writeFile(path.join(CAPTURE_DIR, "draw-ui.png"), image.toPNG());
        }

        const layoutResults = [];
        for (const [width, height] of [
          [1280, 720],
          [1920, 1080],
          [2560, 1440],
          [3440, 1440],
          [3840, 2160],
          [5120, 1440],
          [1080, 1920]
        ]) {
          window.setContentSize(width, height);
          await new Promise((resolve) => setTimeout(resolve, 120));
          layoutResults.push(await window.webContents.executeJavaScript(`
            (() => {
              const stageBounds = document.querySelector(".stage").getBoundingClientRect();
              const confetti = document.getElementById("confettiLayer");
              const confettiBounds = confetti.getBoundingClientRect();
              const digitsBounds = document.querySelector(".digits-wrapper").getBoundingClientRect();
              return {
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                stageWidth: stageBounds.width,
                stageHeight: stageBounds.height,
                confettiLeft: confettiBounds.left,
                confettiTop: confettiBounds.top,
                confettiWidth: confettiBounds.width,
                confettiHeight: confettiBounds.height,
                digitsLeft: digitsBounds.left,
                digitsTop: digitsBounds.top,
                digitsRight: digitsBounds.right,
                digitsBottom: digitsBounds.bottom
              };
            })()
          `));
        }

        const result = await window.webContents.executeJavaScript(`
          (async () => {
            await window.luckyDrawBackgroundReady;
            playConfetti();
            await new Promise((resolve) => setTimeout(resolve, 50));
            const confettiCanvas = document.getElementById("confettiLayer");
            return ({
            numbers: JSON.parse(localStorage.getItem("luckydraw_numbers") || "[]"),
            digitCount: document.querySelectorAll(".digit-box").length,
            background: getComputedStyle(document.querySelector(".stage")).backgroundColor,
            backgroundImage: getComputedStyle(document.querySelector(".stage")).backgroundImage,
            stageWidth: document.querySelector(".stage").getBoundingClientRect().width,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            confettiType: typeof confetti,
            confettiInstanceType: typeof fireConfetti,
            confettiCanvasWidth: confettiCanvas.width,
            confettiCanvasHeight: confettiCanvas.height
            });
          })()
        `);

        if (CAPTURE_DIR) {
          const image = await window.webContents.capturePage();
          await fs.writeFile(path.join(CAPTURE_DIR, "confetti-ui.png"), image.toPNG());
        }

        const passed =
          JSON.stringify(result.numbers) === JSON.stringify(["012345", "000007", "123456"]) &&
          result.digitCount === 6 &&
          result.background === "rgb(0, 0, 0)" &&
          result.backgroundImage !== "none" &&
          Math.abs(result.stageWidth - result.viewportWidth) < 1 &&
          result.confettiInstanceType === "function" &&
          Math.abs(result.confettiCanvasWidth - result.viewportWidth) < 1 &&
          Math.abs(result.confettiCanvasHeight - result.viewportHeight) < 1 &&
          layoutResults.every((layout) =>
            Math.abs(layout.stageWidth - layout.viewportWidth) < 1 &&
            Math.abs(layout.stageHeight - layout.viewportHeight) < 1 &&
            Math.abs(layout.confettiLeft) < 1 &&
            Math.abs(layout.confettiTop) < 1 &&
            Math.abs(layout.confettiWidth - layout.viewportWidth) < 1 &&
            Math.abs(layout.confettiHeight - layout.viewportHeight) < 1 &&
            layout.digitsLeft >= 0 &&
            layout.digitsTop >= 0 &&
            layout.digitsRight <= layout.viewportWidth &&
            layout.digitsBottom <= layout.viewportHeight
          ) &&
          result.confettiType === "function";

        if (!passed) throw new Error(`draw screen validation failed: ${JSON.stringify(result)}`);

        const winners = await window.webContents.executeJavaScript(`
          (async () => {
            async function drawFirst() {
              await startDraw();
              return Array.from(document.querySelectorAll(".digit-box span"), (digit) => digit.textContent).join("");
            }
            return [await drawFirst(), await drawFirst()];
          })()
        `);
        if (new Set(winners).size !== 2 || winners.some((number) => !["012345", "000007", "123456"].includes(number))) {
          throw new Error(`winning number display failed: ${JSON.stringify(winners)}`);
        }

        await testBatchDraw(window);
        const automatic = await testAutomaticWorkbook(window, 8);
        const batchResult = await testLiveSettings(window);
        const updated = await testAutomaticWorkbook(window, 14);
        if (automatic.destination !== updated.destination) throw new Error("each draw created another automatic workbook instead of updating the same file");
        const exported = await testWinnerExport(window);
        if (!updated.bytes.equals(await fs.readFile(updated.destination))) throw new Error("count shortcuts changed the automatically saved workbook");
        stage = 2;
        await new Promise((resolve) => {
          window.webContents.once("did-finish-load", resolve);
          window.webContents.reload();
        });
        const recovered = await window.webContents.executeJavaScript(`({
          history: store.load().history,
          recorded: [...document.querySelectorAll(".history-number")].map((number) => number.textContent),
          settingsHidden: !settingsDialog.open,
          count: drawCount,
          layout: drawLayout,
          displayed: [...document.querySelectorAll(".digits-wrapper")].map((row) => row.textContent),
          remaining: store.load().remaining
        })`);
        if (JSON.stringify(recovered.history) !== JSON.stringify(batchResult.history) || !recovered.settingsHidden || recovered.count !== 3 ||
            JSON.stringify(recovered.recorded) !== JSON.stringify([...batchResult.history].reverse().flatMap((round) => round.winners)) ||
            recovered.layout !== "horizontal" ||
            JSON.stringify(recovered.displayed) !== JSON.stringify(batchResult.history.at(-1).winners) || recovered.remaining.length !== 1) {
          throw new Error(`reload recovery failed: ${JSON.stringify(recovered)}`);
        }

        // 저장됐지만 연출이 끝나지 않은 마지막 한 명도 업로드 화면에서 저장한다.
        await window.webContents.executeJavaScript('state = store.draw(1, "이동 직전 당첨자").state');
        stage = 3;
        await window.loadURL(`${APP_SCHEME}://${APP_HOST}/upload.html`);
        if (!await window.webContents.executeJavaScript("window.eventInitialization")) throw new Error("upload transition failed to finalize the workbook");
        const reset = await window.webContents.executeJavaScript(`({
          saved: LuckyDrawStore.create(localStorage).load(),
          numbers: JSON.parse(localStorage.getItem("luckydraw_numbers")),
          count: localStorage.getItem("luckydraw_count"),
          pendingBreak: localStorage.getItem("luckydraw_export_break_after"),
          noDrawSettings: !document.getElementById("drawSettingsTitle")
        })`);
        if (reset.saved.history.length || reset.saved.remaining.length || reset.numbers.length || reset.count !== "4" || reset.pendingBreak !== null || !reset.noDrawSettings ||
            !exported.firstBytes.equals(await fs.readFile(exported.firstPath))) throw new Error("upload reentry did not start a new event or changed the exported archive");
        const xlsx = require("../vendor/xlsx.full.min.js");
        const finalizedBytes = await fs.readFile(updated.destination);
        const finalizedBook = xlsx.read(finalizedBytes, { type: "buffer" });
        const finalizedWinners = xlsx.utils.sheet_to_json(finalizedBook.Sheets["당첨자명단"], { header: 1 }).slice(1).filter((row) => row[0]);
        if (finalizedWinners.length !== 15) throw new Error("upload transition lost the last unanimated winner");

        await window.webContents.executeJavaScript(
          `Promise.all([
            LuckyDrawBackground.remove(),
            Promise.resolve(localStorage.removeItem("luckydraw_numbers"))
          ])`
        );
        // 새 행사의 미공개 결과를 남기고 실제 창을 닫아 종료 직전 저장을 검증한다.
        await window.webContents.executeJavaScript('LuckyDrawStore.create(localStorage).register(["999999"]); localStorage.setItem("luckydraw_count", "1")');
        stage = 4;
        await window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
        const closingEvent = await window.webContents.executeJavaScript('state = store.draw(1, "종료 직전 당첨자").state; isPlaying = true; localStorage.getItem("luckydraw_event_id")');
        app.once("will-quit", (event) => {
          try {
            const destination = winnerSavePaths.get(closingEvent);
            const { readFileSync } = require("node:fs");
            const book = xlsx.read(readFileSync(destination), { type: "buffer" });
            const winners = xlsx.utils.sheet_to_json(book.Sheets["당첨자명단"], { header: 1 }).slice(1).filter((row) => row[0]).map((row) => row[3]);
            if (destination === updated.destination || JSON.stringify(winners) !== JSON.stringify(["999999"]) || !finalizedBytes.equals(readFileSync(updated.destination))) throw new Error("shutdown did not save the last result or overwrote the previous event");
            clearTimeout(timeout);
            process.stdout.write("SELF_TEST_OK: number keys, unique winners, blank group separators, same-file desktop autosave after every draw, count changes leave Excel untouched, upload transition saves before reset, and actual window close saves pending results while preserving the previous event\n");
          } catch (error) {
            event.preventDefault();
            process.stdout.write(`SELF_TEST_FAILED: ${error.message}\n`);
            app.exit(1);
          }
        });
        window.close();
      }
    } catch (error) {
      clearTimeout(timeout);
      process.stdout.write(`SELF_TEST_FAILED: ${error.message}\n`);
      app.exit(1);
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: !SELF_TEST,
    fullscreen: ALWAYS_FULLSCREEN,
    backgroundColor: "#000000",
    title: "럭키드로우",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  configureWindowNavigation(window);
  if (SELF_TEST) installSelfTest(window);
  window.loadURL(`${APP_SCHEME}://${APP_HOST}/upload.html`);
  return window;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  configureOfflineProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", (event) => {
  if (quitApproved) return;
  event.preventDefault();
  if (quitSaving) return;
  quitSaving = true;
  isQuitting = true;
  finalizeWindows().then(() => {
    quitApproved = true;
    app.quit();
  }).catch(() => {
    quitSaving = false;
    isQuitting = false;
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.executeJavaScript('typeof showStageStatus === "function" && showStageStatus("엑셀 저장에 실패해 종료하지 않았습니다. 파일을 확인한 뒤 다시 종료해주세요.")').catch(() => {});
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
