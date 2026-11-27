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
  const backgroundUploadScript = `window.__uploadBackground = async (file, inputId = "backgroundFile") => {
    await window.luckyDrawBackgroundSettingsReady;
    const input = document.getElementById(inputId);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
    while (input.value || document.getElementById("backgroundFile").disabled) await new Promise(resolve => setTimeout(resolve, 20));
    const video = document.getElementById("backgroundPreviewVideo");
    while (!video.hidden && video.readyState < 2 && !video.error) await new Promise(resolve => setTimeout(resolve, 20));
    const record = await LuckyDrawBackground.get();
    return { name: record?.name, type: record?.type, video: !video.hidden && !video.paused && video.muted && video.loop && video.videoWidth > 0,
      image: video.hidden && video.paused && !video.hasAttribute("src") && document.getElementById("backgroundPreview").style.backgroundImage !== "none",
      error: document.getElementById("feedbackModal").getAttribute("aria-hidden") === "false" };
  }; void 0;`;
  const imageUploadScript = `(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 18;
    const context = canvas.getContext("2d");
    context.fillStyle = "#123456";
    context.fillRect(0, 0, 32, 18);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    return __uploadBackground(new File([blob], "background.png", {type:"image/png"}));
  })()`;
  const fileScript = (bytes, name, type) => `new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}), c => c.charCodeAt(0))], ${JSON.stringify(name)}, {type:${JSON.stringify(type)}})`;
  const assertVideo = async (fit) => {
    assert.deepEqual(await evaluate(`(() => {
      const video = document.getElementById("backgroundVideo");
      const bounds = video.getBoundingClientRect();
      return {playing: !video.hidden && !video.paused && !video.ended && video.videoWidth > 0, muted: video.muted, loop: video.loop,
        controls: video.controls, fit: getComputedStyle(video).objectFit, fillsStage: bounds.width === innerWidth && bounds.height === innerHeight,
        digitsAbove: getComputedStyle(document.getElementById("winnerGrid")).zIndex === "1"};
    })()`), {playing:true, muted:true, loop:true, controls:false, fit, fillsStage:true, digitsAbove:true});
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
    // One-second generated clips with audio, embedded to keep this test self-contained.
    const mov = Buffer.from("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", "base64");
    const mp4 = Buffer.from("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bHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjIuMy4xMDAAAAAIZnJlZQAAEuJtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEyIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAADNmWIhAF/1FdsR9d3o0qTS8/jvcjk5Zq9VAm+CFAGBpvzjvjVksOHKvB/qisMH4VLVgk74yQ2C2hog5+/OYVueD6Mg655MuLECL2n486cPhCIl9KDAVNJV70SSGRXZxVLplO3tWvjApkhFHVt0RHO6lmTF4ju2TE8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", "base64");
    const webm = Buffer.from("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", "base64");
    await evaluate(backgroundUploadScript);
    assert.equal((await evaluate(imageUploadScript)).image, true, "image upload must still work");
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(${fileScript(sample, "luckydraw_sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")});
      document.getElementById("excelFile").files = transfer.files;
      document.getElementById("excelFile").dispatchEvent(new Event("change"));
    })()`);
    assert.equal(await evaluate('document.getElementById("excelFile").accept'), ".xlsx", "the participant picker must only offer Excel files");
    const beforeRejectedFiles = await evaluate(`(async () => ({background:(await LuckyDrawBackground.get()).updatedAt, drawState:localStorage.getItem(LuckyDrawStore.STATE_KEY)}))()`);
    for (const [name, type] of [["image.png", "image/png"], ["clip.mp4", "video/mp4"], ["recording.mov", "video/quicktime"], ["notes.txt", "text/plain"], ["legacy.xls", "application/vnd.ms-excel"]]) {
      const result = await evaluate(`__uploadBackground(new File(["not a participant workbook"], ${JSON.stringify(name)}, {type:${JSON.stringify(type)}}), "excelFile")`);
      assert.equal(result.error, true, `${name} must be rejected by the participant picker`);
      assert.equal(result.name, "background.png");
      assert.equal(result.image, true);
      assert.equal(await evaluate('document.getElementById("feedbackModalMessage").textContent'), "참가자 엑셀(.xlsx) 파일만 선택해주세요.");
      await evaluate('document.getElementById("feedbackModalButton").click()');
    }
    assert.deepEqual(await evaluate(`(async () => ({background:(await LuckyDrawBackground.get()).updatedAt, drawState:localStorage.getItem(LuckyDrawStore.STATE_KEY)}))()`), beforeRejectedFiles, "rejected participant files must preserve the background and draw data");
    for (const [bytes, name, type] of [[mov, "recording.mov", "video/quicktime"], [webm, "background.webm", "video/webm"], [mp4, "background.mp4", ""]]) {
      const result = await evaluate(`__uploadBackground(${fileScript(bytes, name, type)})`);
      assert.equal(result.name, name);
      assert.equal(result.video, true, `${name} must autoplay silently in the preview`);
      assert.equal(result.error, false);
      assert.equal(result.type, type || "video/mp4");
    }
    assert.equal(await evaluate('selectedExcelFile?.name === "luckydraw_sample.xlsx" && document.getElementById("fileMessage").textContent.includes("luckydraw_sample.xlsx")'), true, "rejected files and separate background uploads must preserve the participant Excel file");
    for (const [name, type] of [["broken.mp4", "video/mp4"], ["unsupported.txt", "text/plain"]]) {
      const result = await evaluate(`__uploadBackground(new File(["invalid media"], ${JSON.stringify(name)}, {type:${JSON.stringify(type)}}))`);
      assert.equal(result.error, true);
      assert.equal(result.name, "background.mp4", "rejected files must preserve the previous background");
      assert.equal(result.video, true);
      await evaluate('document.getElementById("feedbackModalButton").click()');
    }
    await evaluate(`document.getElementById("backgroundFit").value = "contain"; document.getElementById("backgroundFit").dispatchEvent(new Event("change"));`);
    await evaluate('document.getElementById("backgroundSettingsTitle").scrollIntoView({behavior:"instant", block:"center"})');
    await delay(150);
    await snapshot("upload-video.png");
    const registration = await evaluate(`(async () => {
      window.__saveRequests = 0;
      window.showSaveFilePicker = () => { window.__saveRequests++; throw new Error("Unexpected file permission request"); };
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
      document.getElementById("excelFile").dispatchEvent(new Event("change"));
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
    await assertVideo("contain");
    assert.deepEqual(await evaluate(`(async () => {
      const video = document.getElementById("backgroundVideo");
      const before = video.currentTime;
      await new Promise(resolve => setTimeout(resolve, 150));
      const moving = video.currentTime !== before;
      await new Promise(resolve => { video.addEventListener("seeked", resolve, {once:true}); video.currentTime = video.duration - .15; });
      while (video.currentTime > video.duration / 2) await new Promise(resolve => setTimeout(resolve, 20));
      return {moving, looped: !video.paused && !video.ended};
    })()`), {moving:true, looped:true}, "the background must advance frames and loop after the end");
    await snapshot("draw-video.png");
    assert.equal(await evaluate(`(() => {
      window.__saveRequests = 0;
      window.showSaveFilePicker = () => { window.__saveRequests++; throw new Error("Unexpected file permission request"); };
      return typeof LuckyDrawSave === "undefined" && typeof LuckyDrawExport === "undefined" && typeof finalizeWinnerSave === "undefined" && typeof XLSX === "undefined" &&
        !document.querySelector(".history-panel, .export-button, #saveStatus");
    })()`), true);
    assert.equal(await evaluate('fetch("/_save-winners", {method:"POST", body:"test"}).then(response => response.status)'), 404);

    for (const [width, height] of [[1280, 720], [2304, 640], [1920, 1080], [2816, 896], [5000, 1200], [3440, 1440], [3840, 2160], [5120, 1440], [1080, 1920]]) {
      window.setContentSize(width, height);
      const result = await evaluate(`(() => {
        const failures = [];
        const before = localStorage.getItem(LuckyDrawStore.STATE_KEY);
        for (const count of [1, 2, 3, 4]) {
          document.dispatchEvent(new KeyboardEvent("keydown", {key:String(count), code:"Digit" + count}));
          const panels = [...document.querySelectorAll(".digits-wrapper")].map(panel => panel.getBoundingClientRect());
          if (drawCount !== count || panels.length !== count || panels.some(panel => panel.left < 0 || panel.top < 0 || panel.right > innerWidth || panel.bottom > innerHeight) ||
              !stageStatus.hidden || before !== localStorage.getItem(LuckyDrawStore.STATE_KEY)) failures.push(count);
          if (innerWidth === 5000 && innerHeight === 1200 && panels.some(panel => Math.abs(innerHeight - panel.bottom - 515) > .1)) failures.push("LCD bottom gap " + count);
        }
        return failures;
      })()`);
      assert.deepEqual(result, [], `layout failed at ${width}x${height}`);
    }
    window.setContentSize(1280, 720);
    const fixedLcdBottom = await evaluate(`(() => {
      const previousSize = localStorage.getItem(LuckyDrawScreen.STORAGE_KEY);
      const before = localStorage.getItem(LuckyDrawStore.STATE_KEY);
      const failures = [];
      try {
        LuckyDrawScreen.save(localStorage, {width:5000, height:1200});
        for (const count of [1, 2, 3, 4]) {
          document.dispatchEvent(new KeyboardEvent("keydown", {key:String(count)}));
          const frame = stage.getBoundingClientRect();
          const previewScale = frame.height / 1200;
          for (const panel of grid.children) {
            const bounds = panel.getBoundingClientRect();
            const bottomGap = (frame.bottom - bounds.bottom) / previewScale;
            if (Math.abs(bottomGap - 515) > .1 || bounds.top < frame.top || bounds.bottom > frame.bottom) failures.push(count);
          }
        }
        if (before !== localStorage.getItem(LuckyDrawStore.STATE_KEY)) failures.push("draw state changed");
      } finally {
        if (previousSize === null) localStorage.removeItem(LuckyDrawScreen.STORAGE_KEY);
        else localStorage.setItem(LuckyDrawScreen.STORAGE_KEY, previousSize);
        updateStageScale();
      }
      return failures;
    })()`);
    assert.deepEqual(fixedLcdBottom, [], "LCD panels must remain 515px above the stage bottom when previewed in a smaller window");
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
    await assertVideo("contain");
    assert.deepEqual(await evaluate("store.load().history"), saved.history);
    assert.equal(await evaluate("drawCount"), 2);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".digits-wrapper")].map(panel => panel.textContent)'), saved.history.at(-1).winners);
    await evaluate(`(async () => {
      await LuckyDrawBackground.save(${fileScript(webm, "background.webm", "video/webm")});
      localStorage.setItem("luckydraw_background_fit", "cover");
      await loadEventBackground();
    })()`);
    await assertVideo("cover");
    await window.loadURL("luckydraw://app/upload.html");
    assert.equal(await evaluate("window.eventInitialization"), true);
    const reset = await evaluate("LuckyDrawStore.create(localStorage).load()");
    assert.deepEqual(reset.participants, []);
    assert.deepEqual(reset.history, []);
    assert.equal(await evaluate("localStorage.getItem('luckydraw_count')"), "4");
    await evaluate(backgroundUploadScript);
    assert.equal((await evaluate(imageUploadScript)).image, true, "switching from video to image must release the video");
    assert.equal(await evaluate(`(async () => {
      document.getElementById("removeBackgroundButton").click();
      while (!document.getElementById("removeBackgroundButton").disabled) await new Promise(resolve => setTimeout(resolve, 20));
      const video = document.getElementById("backgroundPreviewVideo");
      return !(await LuckyDrawBackground.get()) && video.hidden && video.paused && !video.hasAttribute("src") && !document.getElementById("backgroundPreviewEmpty").hidden;
    })()`), true, "deleting a background must clear its stored file and preview");
    assert.deepEqual(downloads, []);
    app.once("will-quit", (event) => {
      try {
        assert.deepEqual(readdirSync(desktop), ["existing.xlsx"]);
        assert.equal(readFileSync(marker, "utf8"), "preserve existing file");
        assert.deepEqual(downloads, []);
        clearTimeout(timeout);
        process.stdout.write("SELF_TEST_OK: Excel-only participant picker, separate image/MP4/WebM/MOV background uploads, participant file preservation, muted autoplay and looping, invalid-file recovery, background replacement/deletion, 100-person Excel upload, number keys and Enter, repeat draws, responsive layouts including LCD bottom gap 515px, reload recovery, and no winner files or permission requests\n");
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
