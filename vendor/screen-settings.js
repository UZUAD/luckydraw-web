(function (root) {
  "use strict";

  const STORAGE_KEY = "luckydraw_screen_size";

  function parse(width, height) {
    const widthText = String(width ?? "").trim();
    const heightText = String(height ?? "").trim();
    if (!widthText && !heightText) return null;
    const size = { width: Number(widthText), height: Number(heightText) };
    if (!widthText || !heightText || !Number.isInteger(size.width) || !Number.isInteger(size.height) ||
        size.width < 320 || size.height < 180 || size.width > 16384 || size.height > 16384) {
      throw new Error("화면 크기를 가로 320~16384px, 세로 180~16384px 범위의 정수로 모두 입력해주세요.");
    }
    return size;
  }

  function load(storage) {
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY));
      return saved && typeof saved === "object" ? parse(saved.width, saved.height) : null;
    } catch {
      return null;
    }
  }

  function save(storage, size) {
    const valid = size === null ? null : parse(size.width, size.height);
    if (valid) storage.setItem(STORAGE_KEY, JSON.stringify(valid));
    else storage.removeItem(STORAGE_KEY);
    return valid;
  }

  const api = { STORAGE_KEY, parse, load, save };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LuckyDrawScreen = api;
})(globalThis);
