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

test("참가자가 부족하면 일부 인원만 뽑지 않고 상태를 보존한다", () => {
  const storage = memoryStorage();
  const store = create(storage);
  store.register(participants.slice(0, 3));
  const before = storage.getItem(STATE_KEY);
  assert.throws(() => store.draw(4, "상품"), /등록된 참가자는 3명/);
  assert.equal(storage.getItem(STATE_KEY), before);
  assert.equal(store.draw(3, "상품").state.remaining.length, 0);
  assert.equal(store.draw(1, "상품").round.winners.length, 1);
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

test("100명을 모두 뽑은 뒤에도 계속 추첨하고 기록을 누적한다", () => {
  const storage = memoryStorage();
  const store = create(storage, () => 0);
  const full = Array.from({ length: 100 }, (_, index) => String(index + 1).padStart(6, "0"));
  store.register(full);
  for (let index = 0; index < 25; index++) store.draw(4, "상품");
  assert.equal(store.load().remaining.length, 0);
  for (let index = 0; index < 30; index++) {
    const { round } = store.draw(4, "상품");
    assert.equal(new Set(round.winners).size, 4);
  }
  const saved = create(storage).load();
  assert.equal(saved.history.length, 55);
  assert.equal(saved.history.flatMap((round) => round.winners).length, 220);
  assert.equal(saved.participants.length, 100);
});

test("남은 인원이 1명이어도 다음 순환을 이어 4명을 중복 없이 뽑는다", () => {
  const store = create(memoryStorage(), () => 0);
  store.register(["1", "2", "3", "4", "5"]);
  store.draw(4, "상품");
  assert.equal(store.load().remaining.length, 1);
  const { round, state } = store.draw(4, "상품");
  assert.deepEqual(round.winners, ["000005", "000001", "000002", "000003"]);
  assert.equal(new Set(round.winners).size, 4);
  assert.deepEqual(state.remaining, ["000004", "000005"]);
});

test("이미 남은 참가자가 0명인 이전 버전 데이터도 다시 업로드하지 않고 복구한다", () => {
  const storage = memoryStorage();
  const history = [{ round: 1, prize: "기존 상품", winners: ["000001", "000002", "000003", "000004"], drawnAt: new Date().toISOString() }];
  storage.setItem(STATE_KEY, JSON.stringify({ version: 1, remaining: [], history }));
  const store = create(storage, () => 0);
  const { state, round } = store.draw(4, "새 상품");
  assert.equal(state.version, 2);
  assert.equal(state.participants.length, 4);
  assert.deepEqual(state.history[0], history[0]);
  assert.equal(state.history.length, 2);
  assert.deepEqual(round.winners, history[0].winners);
});
