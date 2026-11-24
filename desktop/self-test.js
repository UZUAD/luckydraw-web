const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

module.exports = async function runSelfTest({ window, app, session, saveBundledFileToDownloads, captureDir }) {
  const timeout = setTimeout(() => {
    process.stdout.write("SELF_TEST_FAILED: timed out\n");
    app.exit(1);
  }, 60000);
  const evaluate = (script) => window.webContents.executeJavaScript(script);
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const downloads = [];
  session.defaultSession.on("will-download", (event, item) => {
    downloads.push(item.getFilename());
    event.preventDefault();
  });
  const desktop = path.join(app.getPath("userData"), "Desktop");
  const marker = path.join(desktop, "existing.xlsx");
  const snapshot = async (name) => {
    if (!captureDir) return;
    await fs.mkdir(captureDir, { recursive: true });
    await fs.writeFile(path.join(captureDir, name), (await window.webContents.capturePage()).toPNG());
  };

  try {
    await fs.mkdir(desktop, { recursive: true });
    await fs.writeFile(marker, "preserve existing file");
    assert.equal(await evaluate("window.eventInitialization"), true);
    const first = await saveBundledFileToDownloads("luckydraw://app/files/luckydraw_sample.xlsx");
    const second = await saveBundledFileToDownloads("luckydraw://app/files/luckydraw_sample.xlsx");
    assert.equal(path.dirname(first), path.join(app.getPath("userData"), "Downloads"));
    assert.equal(path.basename(first), "luckydraw_sample.xlsx");
    assert.equal(path.basename(second), "luckydraw_sample (2).xlsx");
    const sample = await fs.readFile(first);
    const registration = await evaluate(`(async () => {
      window.__saveRequests = 0;
      window.showSaveFilePicker = () => { window.__saveRequests++; throw new Error("Unexpected file permission request"); };
      const canvas = document.createElement("canvas");
      canvas.width = 32; canvas.height = 18;
      const context = canvas.getContext("2d");
      context.fillStyle = "#123456";
      context.fillRect(0, 0, 32, 18);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      await LuckyDrawBackground.save(new File([blob], "background.png", {type:"image/png"}));
      document.getElementById("rangeTab").click();
      document.getElementById("startNumber").value = "99999";
      document.getElementById("endNumber").value = "100001";
      document.getElementById("excludeNumbers").value = "100000";
      document.getElementById("submitButton").click();
      const range = LuckyDrawStore.create(localStorage).load().remaining;
      document.getElementById("excelTab").click();
      document.getElementById("excludeNumbers").value = "";
      const bytes = Uint8Array.from(atob(${JSON.stringify(sample.toString("base64"))}), c => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "luckydraw_sample.xlsx"));
      document.getElementById("excelFile").files = transfer.files;
      const message = document.getElementById("feedbackModalMessage");
      const completed = new Promise(resolve => {
        const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
        observer.observe(message, {childList:true});
      });
      document.getElementById("submitButton").click();
      await completed;
      const saved = LuckyDrawStore.create(localStorage).load();
      return { range, participants: saved.participants, message: message.textContent, saveRequests: window.__saveRequests,
        noSaver: typeof LuckyDrawSave === "undefined" && typeof finalizeWinnerSave === "undefined" };
    })()`);
    assert.deepEqual(registration.range, ["099999", "100001"]);
    assert.deepEqual(registration.participants, Array.from({ length: 100 }, (_, index) => String(index + 1).padStart(6, "0")));
    assert.equal(registration.message, "100명의 참가자를 저장했습니다!");
    assert.equal(registration.saveRequests, 0);
    assert.equal(registration.noSaver, true);
    const drawLoaded = new Promise(resolve => window.webContents.once("did-finish-load", resolve));
    await evaluate('document.getElementById("feedbackModalButton").click()');
    await drawLoaded;
    await evaluate("window.luckyDrawBackgroundReady");
    assert.equal(await evaluate(`(() => {
      window.__saveRequests = 0;
      window.showSaveFilePicker = () => { window.__saveRequests++; throw new Error("Unexpected file permission request"); };
      return typeof LuckyDrawSave === "undefined" && typeof LuckyDrawExport === "undefined" && typeof finalizeWinnerSave === "undefined" && typeof XLSX === "undefined" &&
        !document.querySelector(".history-panel, .export-button, #saveStatus");
    })()`), true);
    assert.equal(await evaluate('fetch("/_save-winners", {method:"POST", body:"test"}).then(response => response.status)'), 404);

    for (const [width, height] of [[1280, 720], [2304, 640], [1920, 1080], [3440, 1440], [3840, 2160], [5120, 1440], [1080, 1920]]) {
      window.setContentSize(width, height);
      const result = await evaluate(`(() => {
        const failures = [];
        const before = localStorage.getItem(LuckyDrawStore.STATE_KEY);
        for (const count of [1, 2, 3, 4]) {
          document.dispatchEvent(new KeyboardEvent("keydown", {key:String(count), code:"Digit" + count}));
          const panels = [...document.querySelectorAll(".digits-wrapper")].map(panel => panel.getBoundingClientRect());
          if (drawCount !== count || panels.length !== count || panels.some(panel => panel.left < 0 || panel.top < 0 || panel.right > innerWidth || panel.bottom > innerHeight) ||
              !stageStatus.hidden || before !== localStorage.getItem(LuckyDrawStore.STATE_KEY)) failures.push(count);
        }
        return failures;
      })()`);
      assert.deepEqual(result, [], `layout failed at ${width}x${height}`);
    }
    window.setContentSize(2304, 640);
    const pressEnter = async (expectedTotal) => {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await delay(100);
      assert.equal(await evaluate("isPlaying"), true, "Enter must start the roulette");
      await evaluate(`(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", repeat:true}));
        document.dispatchEvent(new KeyboardEvent("keydown", {key:"1"}));
        while (isPlaying) await wait(80);
      })()`);
      const total = await evaluate("store.load().history.reduce((sum, round) => sum + round.winners.length, 0)");
      assert.equal(total, expectedTotal);
    };
    await pressEnter(4);
    await evaluate(`
      while (state.remaining.length) state = store.draw(4, prizeName).state;
      renderCards(4, state.history.at(-1).winners);
    `);
    assert.equal(await evaluate("state.remaining.length"), 0);
    await pressEnter(104);
    await evaluate(`
      document.dispatchEvent(new KeyboardEvent("keydown", {key:"F2"}));
      if (!settingsDialog.open || !document.getElementById("settingsRemaining").textContent.includes("100명")) throw new Error("F2 did not show the registered participant count");
      const before = localStorage.getItem(LuckyDrawStore.STATE_KEY);
      settingsPrize.dispatchEvent(new KeyboardEvent("keydown", {key:"1", bubbles:true}));
      if (drawCount !== 4 || before !== localStorage.getItem(LuckyDrawStore.STATE_KEY)) throw new Error("settings input triggered a draw");
      settingsCount.value = "2";
      settingsPrize.value = "다음 상품";
      document.getElementById("settingsForm").requestSubmit();
    `);
    await pressEnter(106);
    const saved = await evaluate("store.load()");
    assert.equal(saved.history.length, 27);
    assert.ok(saved.history.every(round => new Set(round.winners).size === round.winners.length));
    await evaluate(`
      document.dispatchEvent(new KeyboardEvent("keydown", {key:"s", ctrlKey:true}));
      if (fireConfetti) fireConfetti.reset();
    `);
    assert.equal(await evaluate("window.__saveRequests"), 0);
    await snapshot("draw-without-export.png");
    const reloaded = new Promise(resolve => window.webContents.once("did-finish-load", resolve));
    window.webContents.reload();
    await reloaded;
    await evaluate("window.luckyDrawBackgroundReady");
    assert.deepEqual(await evaluate("store.load().history"), saved.history);
    assert.equal(await evaluate("drawCount"), 2);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".digits-wrapper")].map(panel => panel.textContent)'), saved.history.at(-1).winners);
    await window.loadURL("luckydraw://app/upload.html");
    assert.equal(await evaluate("window.eventInitialization"), true);
    const reset = await evaluate("LuckyDrawStore.create(localStorage).load()");
    assert.deepEqual(reset.participants, []);
    assert.deepEqual(reset.history, []);
    assert.equal(await evaluate("localStorage.getItem('luckydraw_count')"), "4");
    assert.deepEqual(downloads, []);
    app.once("will-quit", (event) => {
      try {
        assert.deepEqual(readdirSync(desktop), ["existing.xlsx"]);
        assert.equal(readFileSync(marker, "utf8"), "preserve existing file");
        assert.deepEqual(downloads, []);
        clearTimeout(timeout);
        process.stdout.write("SELF_TEST_OK: 100-person Excel upload, number keys and Enter, repeat draws beyond exhaustion, responsive layouts, reload recovery, no export UI or permission requests, and no winner files on navigation or shutdown\n");
      } catch (error) {
        event.preventDefault();
        process.stdout.write(`SELF_TEST_FAILED: ${error.message}\n`);
        app.exit(1);
      }
    });
    window.close();
  } catch (error) {
    clearTimeout(timeout);
    process.stdout.write(`SELF_TEST_FAILED: ${error.stack}\n`);
    app.exit(1);
  }
};
