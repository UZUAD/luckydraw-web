const { test } = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("../vendor/xlsx.full.min.js");
const { FILE_NAME, createWorkbook } = require("../vendor/winner-export.js");

const history = [
  { round: 1, prize: "키보드", winners: ["000007", "012345", "123456", "000001"], drawnAt: "2026-11-24T06:00:00.000Z" },
  { round: 2, prize: "마우스", winners: ["000002"], drawnAt: "2026-11-24T06:01:00.000Z", separateBefore: true },
  { round: 3, prize: "=상품명", winners: ["000003"], drawnAt: "2026-11-24T06:02:00.000Z" }
];

test("당첨자명단 엑셀은 번호의 앞자리 0과 누적 순서를 보존하고 개수 변경 지점만 한 줄 띄운다", () => {
  const before = JSON.stringify(history);
  const workbook = createWorkbook(history, XLSX);
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
  const saved = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sheet = saved.Sheets["당첨자명단"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: null });
  assert.equal(FILE_NAME, "당첨자명단.xlsx");
  assert.deepEqual(saved.SheetNames, ["당첨자명단"]);
  assert.deepEqual(rows[0], ["순번", "추첨 회차", "상품명", "당첨 번호", "추첨 일시"]);
  assert.deepEqual(rows[5], [null, null, null, null, null]);
  assert.equal(rows.filter((row) => row.every((value) => value === null)).length, 1);
  assert.deepEqual(rows.slice(1).filter((row) => row[0] !== null).map((row) => row.slice(0, 4)), [
    [1, 1, "키보드", "000007"], [2, 1, "키보드", "012345"], [3, 1, "키보드", "123456"], [4, 1, "키보드", "000001"],
    [5, 2, "마우스", "000002"], [6, 3, "=상품명", "000003"]
  ]);
  assert.equal(sheet.D2.t, "s");
  assert.equal(sheet.E2.t, "d");
  assert.equal(sheet.C8.f, undefined);
  assert.equal(sheet["!autofilter"].ref, "A1:E8");
  assert.equal(JSON.stringify(history), before);
});

test("당첨자 없는 명단은 내보내지 않는다", () => {
  assert.throws(() => createWorkbook([], XLSX), /아직 저장할 당첨자/);
});
