(function () {
  "use strict";

  const DATABASE_NAME = "luckydraw_settings";
  const STORE_NAME = "assets";
  const BACKGROUND_KEY = "event_background";
  const MEDIA_TYPES = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4"
  };

  function mediaType(file) {
    const type = file.type || file.blob?.type || "";
    if (type && type !== "application/octet-stream") {
      return Object.values(MEDIA_TYPES).includes(type) || /^video\//.test(type) ? type : "";
    }
    return MEDIA_TYPES[(file.name || "").split(".").pop().toLowerCase()] || "";
  }

  function validateVideo(blob) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(blob);
      const finish = (error) => {
        clearTimeout(timeout);
        video.onloadeddata = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
        if (error) reject(error); else resolve();
      };
      const unsupported = () => finish(new DOMException("재생할 수 없는 영상입니다. MP4(H.264) 또는 WebM 영상을 선택해주세요.", "NotSupportedError"));
      const timeout = setTimeout(unsupported, 15000);
      video.muted = true;
      video.preload = "auto";
      video.onloadeddata = () => finish();
      video.onerror = unsupported;
      video.src = url;
      video.load();
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function runTransaction(mode, operation) {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = operation(store);

      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    });
  }

  function getBackground() {
    return runTransaction("readonly", (store) => store.get(BACKGROUND_KEY));
  }

  async function saveBackground(file) {
    const type = mediaType(file);
    if (!type) throw new DOMException("PNG, JPG, WebP 이미지 또는 영상 파일을 선택해주세요.", "NotSupportedError");
    const blob = file.type === type ? file : file.slice(0, file.size, type);
    if (type.startsWith("video/")) await validateVideo(blob);
    const record = {
      blob,
      name: file.name || "행사 배경",
      type,
      size: file.size,
      updatedAt: Date.now()
    };

    return runTransaction("readwrite", (store) => store.put(record, BACKGROUND_KEY));
  }

  function removeBackground() {
    return runTransaction("readwrite", (store) => store.delete(BACKGROUND_KEY));
  }

  window.LuckyDrawBackground = {
    mediaType,
    get: getBackground,
    save: saveBackground,
    remove: removeBackground
  };
})();
