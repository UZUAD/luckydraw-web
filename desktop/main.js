const { app, BrowserWindow, Menu, net, protocol, session, shell } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const APP_SCHEME = "luckydraw";
const APP_HOST = "app";
const SELF_TEST = process.argv.includes("--self-test");
const CAPTURE_DIR = process.env.LUCKYDRAW_CAPTURE_DIR;

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

async function openBundledFile(requestUrl) {
  const sourcePath = resourcePathFromUrl(requestUrl);
  if (!sourcePath) return;

  const destinationPath = path.join(app.getPath("temp"), path.basename(sourcePath));
  await fs.copyFile(sourcePath, destinationPath);
  await shell.openPath(destinationPath);
}

function configureOfflineProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const resourcePath = resourcePathFromUrl(request.url);
    if (!resourcePath) return new Response("Not found", { status: 404 });

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
}

function configureWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${APP_SCHEME}://${APP_HOST}/`) && url.toLowerCase().endsWith(".xlsx")) {
      openBundledFile(url).catch(() => {});
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://${APP_HOST}/`)) event.preventDefault();
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
}

function installSelfTest(window) {
  let stage = 0;
  const timeout = setTimeout(() => {
    process.stdout.write("SELF_TEST_FAILED: timed out\n");
    app.exit(1);
  }, 30000);

  window.webContents.on("did-finish-load", async () => {
    const url = window.webContents.getURL();

    try {
      if (stage === 0 && url.endsWith("/upload.html")) {
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
            start.value = "12";
            end.value = "14";
            excluded.value = "13";
            start.dispatchEvent(new Event("input", { bubbles: true }));
            end.dispatchEvent(new Event("input", { bubbles: true }));
            document.getElementById("submitButton").click();
            return document.getElementById("feedbackModalMessage").textContent;
          })()
        `);

        if (result !== "2명의 참가자를 저장했습니다!") {
          throw new Error(`range registration failed: ${result}`);
        }

        if (CAPTURE_DIR) {
          const image = await window.webContents.capturePage();
          await fs.writeFile(path.join(CAPTURE_DIR, "range-ui.png"), image.toPNG());
        }

        stage = 1;
        await window.webContents.executeJavaScript(
          `document.getElementById("feedbackModalButton").click()`
        );
        return;
      }

      if (stage === 1 && url.endsWith("/index.html")) {
        if (CAPTURE_DIR) {
          const image = await window.webContents.capturePage();
          await fs.writeFile(path.join(CAPTURE_DIR, "draw-ui.png"), image.toPNG());
        }

        const layoutResults = [];
        for (const [width, height] of [[1920, 1080], [3840, 2160], [5120, 1440]]) {
          window.setContentSize(width, height);
          await new Promise((resolve) => setTimeout(resolve, 120));
          layoutResults.push(await window.webContents.executeJavaScript(`
            (() => {
              const stageBounds = document.querySelector(".stage").getBoundingClientRect();
              const digitsBounds = document.querySelector(".digits-wrapper").getBoundingClientRect();
              return {
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                stageWidth: stageBounds.width,
                stageHeight: stageBounds.height,
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
            return ({
            numbers: JSON.parse(localStorage.getItem("luckydraw_numbers") || "[]"),
            digitCount: document.querySelectorAll(".digit-box").length,
            background: getComputedStyle(document.querySelector(".stage")).backgroundColor,
            backgroundImage: getComputedStyle(document.querySelector(".stage")).backgroundImage,
            stageWidth: document.querySelector(".stage").getBoundingClientRect().width,
            viewportWidth: window.innerWidth,
            confettiType: typeof confetti
            });
          })()
        `);

        const passed =
          JSON.stringify(result.numbers) === JSON.stringify(["00012", "00014"]) &&
          result.digitCount === 5 &&
          result.background === "rgb(0, 0, 0)" &&
          result.backgroundImage !== "none" &&
          Math.abs(result.stageWidth - result.viewportWidth) < 1 &&
          layoutResults.every((layout) =>
            Math.abs(layout.stageWidth - layout.viewportWidth) < 1 &&
            Math.abs(layout.stageHeight - layout.viewportHeight) < 1 &&
            layout.digitsLeft >= 0 &&
            layout.digitsTop >= 0 &&
            layout.digitsRight <= layout.viewportWidth &&
            layout.digitsBottom <= layout.viewportHeight
          ) &&
          result.confettiType === "function";

        await window.webContents.executeJavaScript(
          `Promise.all([
            LuckyDrawBackground.remove(),
            Promise.resolve(localStorage.removeItem("luckydraw_numbers"))
          ])`
        );
        clearTimeout(timeout);

        if (!passed) throw new Error(`draw screen validation failed: ${JSON.stringify(result)}`);
        process.stdout.write("SELF_TEST_OK: shared UI, offline assets, range data, responsive stage, and local background loaded\n");
        app.exit(0);
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

app.on("window-all-closed", () => {
  app.quit();
});
