const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const XLSX = require("../vendor/xlsx.full.min.js");
const exporter = require("../vendor/winner-export.js");
const { create } = require("../vendor/winner-save.js");

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const rounds = [
  { round: 1, prize: "상품", winners: ["000001"], drawnAt: "2026-11-24T06:00:00Z" },
  { round: 2, prize: "상품", winners: ["000002", "000003"], drawnAt: "2026-11-24T06:01:00Z", separateBefore: true }
];
function numbers(bytes) {
  const book = XLSX.read(bytes, { type: "array" });
  return XLSX.utils.sheet_to_json(book.Sheets["당첨자명단"], { header: 1 }).slice(1).filter((row) => row[0]).map((row) => row[3]);
}

test("자동 저장은 실행 순서대로 누적 명단을 기록하고 같은 명단은 중복 저장하지 않는다", async () => {
  const writes = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const saver = create({ storage: memoryStorage(), xlsx: XLSX, exporter, environment: {
    location: { protocol: "luckydraw:" }, crypto: { randomUUID },
    fetch: async (_url, options) => {
      if (!writes.length) await blocked;
      writes.push({ eventId: options.headers["X-LuckyDraw-Event"], winners: numbers(options.body) });
      return { ok: true, json: async () => ({ fileName: "당첨자명단.xlsx" }) };
    }
  } });
  const first = saver.save(rounds.slice(0, 1));
  const second = saver.save(rounds);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(writes.map((entry) => entry.winners), [["000001"], ["000001", "000002", "000003"]]);
  assert.equal(writes[0].eventId, writes[1].eventId);
  await saver.save(rounds);
  assert.equal(writes.length, 2);
  await saver.save(rounds, { force: true });
  assert.equal(writes.length, 3);
  saver.newEvent();
  await saver.save(rounds.slice(0, 1));
  assert.notEqual(writes[3].eventId, writes[0].eventId);
});

test("자동 저장 실패 후에도 기록을 바꾸지 않고 다음 저장으로 복구한다", async () => {
  let fail = true;
  const before = JSON.stringify(rounds);
  const saver = create({ storage: memoryStorage(), xlsx: XLSX, exporter, environment: {
    location: { protocol: "luckydraw:" }, crypto: { randomUUID },
    fetch: async () => ({ ok: !fail, json: async () => fail ? { error: "파일이 열려 있습니다." } : { fileName: "당첨자명단.xlsx" } })
  } });
  await assert.rejects(saver.save(rounds), /파일이 열려/);
  fail = false;
  assert.equal((await saver.save(rounds)).fileName, "당첨자명단.xlsx");
  assert.equal(JSON.stringify(rounds), before);
});

test("브라우저는 바탕화면 저장 위치를 한 번 선택하고 같은 파일에 누적 저장한다", async () => {
  let choices = 0;
  const writes = [];
  const handle = {
    name: "당첨자명단.xlsx",
    queryPermission: async () => "granted",
    createWritable: async () => {
      let pending;
      return { write: async (bytes) => { pending = bytes; }, close: async () => writes.push(numbers(pending)) };
    }
  };
  const saver = create({ storage: memoryStorage(), xlsx: XLSX, exporter, environment: {
    location: { protocol: "file:" }, crypto: { randomUUID },
    showSaveFilePicker: async (options) => {
      choices++;
      assert.equal(options.startIn, "desktop");
      assert.equal(options.suggestedName, "당첨자명단.xlsx");
      return handle;
    }
  } });
  assert.equal(await saver.prepare(), true);
  await saver.save(rounds.slice(0, 1));
  assert.equal(await saver.prepare(), true);
  await saver.save(rounds);
  assert.equal(choices, 1);
  assert.deepEqual(writes, [["000001"], ["000001", "000002", "000003"]]);
});

test("브라우저에서 저장 위치 선택을 취소하면 추첨 준비를 중단한다", async () => {
  const saver = create({ storage: memoryStorage(), xlsx: XLSX, exporter, environment: {
    location: { protocol: "file:" }, crypto: { randomUUID },
    showSaveFilePicker: async () => { const error = new Error("취소"); error.name = "AbortError"; throw error; }
  } });
  assert.equal(await saver.prepare(), false);
});
