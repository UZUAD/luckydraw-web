const { test } = require("node:test");
const assert = require("node:assert/strict");
const { create, STATE_KEY } = require("../vendor/draw-store.js");

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
const participants = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(6, "0"));

test("한 상품에 네 명을 뽑고 상품별 기록과 남은 참가자를 함께 저장한다", () => {
  const storage = memoryStorage();
  const store = create(storage, () => 0);
  store.register(participants);
  const { state, round } = store.draw(4, "무선 키보드");
  assert.deepEqual(round.winners, participants.slice(0, 4));
  assert.equal(round.prize, "무선 키보드");
  assert.equal(state.remaining.length, 8);
  assert.deepEqual(create(storage).load(), state);
  assert.deepEqual(JSON.parse(storage.getItem("luckydraw_numbers")), state.remaining);
});

test("상품을 바꿔 연속 추첨해도 중복 당첨이 없고 이전 상품 기록을 유지한다", () => {
  const store = create(memoryStorage(), () => 0);
  store.register(participants);
  store.draw(4, "키보드");
  const { state } = store.draw(4, "마우스");
  assert.deepEqual(state.history.map((round) => round.prize), ["키보드", "마우스"]);
  assert.equal(new Set(state.history.flatMap((round) => round.winners)).size, 8);
  assert.deepEqual(state.remaining, participants.slice(8));
});

test("개수 변경 뒤의 구분선은 당첨 기록에 보존하고 중복 당첨을 막는다", () => {
  const storage = memoryStorage();
  const store = create(storage, () => 0);
  store.register(participants);
  store.draw(4, "키보드", { separateBefore: true });
  store.draw(1, "마우스", { separateBefore: true });
  store.draw(1, "마우스");
  const state = create(storage).load();
  assert.equal(state.history[0].separateBefore, undefined);
  assert.equal(state.history[1].separateBefore, true);
  assert.equal(state.history[2].separateBefore, undefined);
  assert.equal(new Set(state.history.flatMap((round) => round.winners)).size, 6);
  assert.deepEqual(state.remaining, participants.slice(6));
});

test("참가자가 부족하면 일부 인원만 뽑지 않고 상태를 보존한다", () => {
  const storage = memoryStorage();
  const store = create(storage);
  store.register(participants.slice(0, 3));
  const before = storage.getItem(STATE_KEY);
  assert.throws(() => store.draw(4, "상품"), /남은 참가자는 3명/);
  assert.equal(storage.getItem(STATE_KEY), before);
  assert.equal(store.draw(3, "상품").state.remaining.length, 0);
  assert.throws(() => store.draw(1, "상품"), /남은 참가자는 0명/);
});

test("기존 참가자를 가져올 때 앞자리 0을 유지하고 중복 사번을 제거한다", () => {
  const storage = memoryStorage();
  storage.setItem("luckydraw_numbers", JSON.stringify(["7", "000007", "012345", "12345", "abc", "1234567"]));
  const store = create(storage, () => 0);
  assert.deepEqual(store.load().remaining, ["000007", "012345"]);
  assert.deepEqual(store.draw(2, "상품").round.winners, ["000007", "012345"]);
});

test("저장 실패 시 당첨 기록과 참가자를 변경하지 않는다", () => {
  const storage = memoryStorage();
  const store = create(storage, () => 0);
  store.register(participants);
  const before = storage.getItem(STATE_KEY);
  const write = storage.setItem;
  storage.setItem = (key, value) => { if (key === STATE_KEY) throw new Error("저장 공간 부족"); write(key, value); };
  assert.throws(() => store.draw(4, "상품"), /저장 공간 부족/);
  assert.equal(storage.getItem(STATE_KEY), before);
});

test("연출 중 새로고침해도 이미 선택한 네 명의 결과가 복구된다", () => {
  const storage = memoryStorage();
  const store = create(storage, () => 0);
  store.register(participants);
  const { round } = store.draw(4, "상품");
  const recovered = create(storage).load();
  assert.deepEqual(recovered.history[0], round);
  assert.ok(round.winners.every((winner) => !recovered.remaining.includes(winner)));
});

test("새 참가자 등록은 새 행사로 시작하고 기존 기록을 초기화한다", () => {
  const store = create(memoryStorage(), () => 0);
  store.register(participants);
  store.draw(4, "이전 행사");
  const reset = store.register(["5", "6", "6"]);
  assert.deepEqual(reset.remaining, ["000005", "000006"]);
  assert.deepEqual(reset.history, []);
});

test("잘못된 인원과 손상된 기록은 추첨 전에 거부한다", () => {
  const storage = memoryStorage();
  const store = create(storage);
  store.register(participants);
  for (const count of [0, 5, 1.5, NaN]) assert.throws(() => store.draw(count, "상품"), /추첨 인원/);
  storage.setItem(STATE_KEY, JSON.stringify({ version: 1, remaining: participants, history: [{ round: 1, prize: "상품", winners: ["000001", "000001"], drawnAt: new Date().toISOString() }] }));
  assert.throws(() => store.load(), /당첨 기록/);
});
