const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STORAGE_KEY, parse, load, save } = require("../vendor/screen-settings.js");

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("LED와 LCD 해상도를 저장하고 재접속 시 같은 크기를 사용한다", () => {
  const storage = memoryStorage();
  for (const size of [{ width: 2816, height: 896 }, { width: 5000, height: 1200 }]) {
    save(storage, parse(String(size.width), String(size.height)));
    assert.deepEqual(load(storage), size);
  }
  save(storage, null);
  assert.equal(load(storage), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(parse("", "  "), null);
});

test("한쪽만 입력하거나 잘못된 크기를 입력하면 기존 화면 설정을 보존한다", () => {
  const storage = memoryStorage();
  const original = { width: 2816, height: 896 };
  save(storage, original);
  for (const [width, height] of [["5000", ""], ["", "1200"], [0, 896], [2816, -1], [2816.5, 896], [Infinity, 896], [2816, NaN], [16385, 896], [2816, 16385], ["bad", 896]]) {
    assert.throws(() => save(storage, { width, height }), /화면 크기/);
    assert.deepEqual(load(storage), original);
  }
});

test("손상되거나 사용할 수 없는 저장값은 자동 맞춤으로 복구한다", () => {
  const storage = memoryStorage();
  for (const value of ["bad json", "null", "false", "[]", '{"width":0,"height":896}', '{"width":2816}', '{"width":2816,"height":-1}']) {
    storage.setItem(STORAGE_KEY, value);
    assert.equal(load(storage), null);
  }
  assert.equal(load({ getItem() { throw new Error("storage unavailable"); } }), null);
});

test("저장 공간 오류를 호출자에게 전달하고 이전 화면 크기를 유지한다", () => {
  const storage = memoryStorage();
  save(storage, { width: 2816, height: 896 });
  storage.setItem = () => { throw new Error("storage full"); };
  assert.throws(() => save(storage, { width: 5000, height: 1200 }), /storage full/);
  assert.deepEqual(load(storage), { width: 2816, height: 896 });
});
