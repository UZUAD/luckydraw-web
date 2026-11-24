(function (root) {
  "use strict";

  function create({ storage = root.localStorage, xlsx = root.XLSX, exporter = root.LuckyDrawExport, environment = root } = {}) {
    const desktop = environment.location.protocol === "luckydraw:";
    const handles = new Map();
    let queue = Promise.resolve();
    let lastSaved = "";

    function eventId() {
      let id = storage.getItem("luckydraw_event_id");
      if (!id) { id = environment.crypto.randomUUID(); storage.setItem("luckydraw_event_id", id); }
      return id;
    }

    function eventFileName() {
      let number = Number(storage.getItem("luckydraw_event_file_number"));
      if (!Number.isSafeInteger(number) || number < 1) {
        const previous = Number(storage.getItem("luckydraw_file_sequence")) || 0;
        number = previous + 1;
        storage.setItem("luckydraw_file_sequence", String(number));
        storage.setItem("luckydraw_event_file_number", String(number));
      }
      return exporter.eventFileName(number);
    }

    async function handleTransaction(mode, operation) {
      return new Promise((resolve, reject) => {
        const opened = environment.indexedDB.open("luckydraw_exports", 1);
        opened.onupgradeneeded = () => opened.result.createObjectStore("handles");
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const database = opened.result;
          const transaction = database.transaction("handles", mode);
          const request = operation(transaction.objectStore("handles"));
          transaction.oncomplete = () => { database.close(); resolve(request.result); };
          transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error || new Error("저장 위치를 불러오지 못했습니다.")); };
        };
      });
    }

    async function existingHandle(id) {
      if (handles.has(id)) return handles.get(id);
      let handle = null;
      try { handle = await handleTransaction("readonly", (store) => store.get(id)); } catch { /* 저장 위치를 새로 선택할 수 있다. */ }
      handles.set(id, handle);
      return handle;
    }

    async function prepare({ persist = false } = {}) {
      if (desktop || typeof environment.showSaveFilePicker !== "function") return true;
      const id = eventId();
      const existing = await existingHandle(id);
      if (existing && await existing.queryPermission({ mode: "readwrite" }) === "granted") return true;
      try {
        const handle = await environment.showSaveFilePicker({
          suggestedName: eventFileName(),
          startIn: "desktop",
          types: [{ description: "당첨자명단 엑셀", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }]
        });
        handles.set(id, handle);
        try { await handleTransaction("readwrite", (store) => store.put(handle, id)); } catch {
          if (persist) {
            handles.delete(id);
            throw new Error("자동 저장 위치를 기억하지 못했습니다. 브라우저의 사이트 저장 공간을 확인한 뒤 다시 선택해주세요.");
          }
        }
        return true;
      } catch (error) {
        if (error.name === "AbortError") return false;
        throw error;
      }
    }

    function save(history, { force = false } = {}) {
      if (!history.length) return Promise.resolve(null);
      const id = eventId();
      const snapshot = history.map((round) => ({ ...round, winners: [...round.winners] }));
      const signature = `${id}:${snapshot.length}:${snapshot.at(-1).drawnAt}`;
      const task = queue.then(async () => {
        if (!force && signature === lastSaved) return null;
        const workbook = exporter.createWorkbook(snapshot, xlsx);
        const bytes = xlsx.write(workbook, { type: "array", bookType: "xlsx", compression: true });
        let result;
        if (desktop) {
          const response = await environment.fetch("/_save-winners", { method: "POST", headers: { "X-LuckyDraw-Event": id }, body: bytes });
          result = await response.json();
          if (!response.ok) throw new Error(result.error || "바탕화면에 당첨자명단을 저장하지 못했습니다.");
        } else {
          const handle = await existingHandle(id);
          if (handle) {
            const writable = await handle.createWritable();
            try { await writable.write(bytes); await writable.close(); }
            catch (error) { try { await writable.abort(); } catch { /* 기존 파일은 유지한다. */ } throw error; }
            result = { fileName: handle.name };
          } else {
            const fileName = eventFileName();
            xlsx.writeFile(workbook, fileName, { compression: true });
            result = { fileName, downloaded: true };
          }
        }
        lastSaved = signature;
        return result;
      });
      queue = task.catch(() => {});
      return task;
    }

    function newEvent() {
      storage.setItem("luckydraw_event_id", environment.crypto.randomUUID());
      storage.setItem("luckydraw_event_file_number", "");
      lastSaved = "";
    }

    return { prepare, save, newEvent, flush: () => queue };
  }

  const api = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LuckyDrawSave = api;
})(globalThis);
