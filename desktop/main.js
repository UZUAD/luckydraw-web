const { app, BrowserWindow, Menu, protocol, session, shell } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const APP_SCHEME = "luckydraw";
const APP_HOST = "app";
const SELF_TEST = process.argv.includes("--self-test");
const CAPTURE_DIR = process.env.LUCKYDRAW_CAPTURE_DIR;
const ALWAYS_FULLSCREEN = !SELF_TEST;
let isQuitting = false;

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
  const loaded = window.loadURL(`${APP_SCHEME}://${APP_HOST}/upload.html`);
  if (SELF_TEST) loaded.then(() => require("./self-test.js")({
    window, app, session, saveBundledFileToDownloads, captureDir: CAPTURE_DIR
  })).catch((error) => {
    process.stdout.write(`SELF_TEST_FAILED: ${error.message}\n`);
    app.exit(1);
  });
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

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  app.quit();
});
