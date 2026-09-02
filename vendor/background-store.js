(function () {
  "use strict";

  const DATABASE_NAME = "luckydraw_settings";
  const STORE_NAME = "assets";
  const BACKGROUND_KEY = "event_background";

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

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function getBackground() {
    return runTransaction("readonly", (store) => store.get(BACKGROUND_KEY));
  }

  function saveBackground(file) {
    const record = {
      blob: file,
      name: file.name || "행사 배경 이미지",
      type: file.type,
      size: file.size,
      updatedAt: Date.now()
    };

    return runTransaction("readwrite", (store) => store.put(record, BACKGROUND_KEY));
  }

  function removeBackground() {
    return runTransaction("readwrite", (store) => store.delete(BACKGROUND_KEY));
  }

  window.LuckyDrawBackground = {
    get: getBackground,
    save: saveBackground,
    remove: removeBackground
  };
})();
