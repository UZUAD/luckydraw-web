(function (root) {
  "use strict";
  const STATE_KEY = "luckydraw_draw_state";

  function normalizeNumbers(numbers) {
    if (!Array.isArray(numbers)) throw new Error("참가자 데이터 형식을 확인해주세요.");
    return [...new Set(numbers.map((number) => String(number).trim())
      .filter((number) => /^\d{1,6}$/.test(number)).map((number) => number.padStart(6, "0")))];
  }

  function randomIndex(length) {
    const value = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / length) * length;
    do { root.crypto.getRandomValues(value); } while (value[0] >= limit);
    return value[0] % length;
  }

  function create(storage, chooseIndex = randomIndex) {
    function load() {
      const saved = storage.getItem(STATE_KEY);
      if (saved === null) return {
        version: 1,
        remaining: normalizeNumbers(JSON.parse(storage.getItem("luckydraw_numbers") || "[]")),
        history: []
      };
      const state = JSON.parse(saved);
      if (state.version !== 1 || !Array.isArray(state.history) || !Array.isArray(state.remaining)) {
        throw new Error("저장된 추첨 데이터를 읽을 수 없습니다.");
      }
      const allWinners = new Set();
      state.history.forEach((round, index) => {
        if (round.round !== index + 1 || typeof round.prize !== "string" ||
            (round.separateBefore !== undefined && typeof round.separateBefore !== "boolean") ||
            !Array.isArray(round.winners) || round.winners.length < 1 || round.winners.length > 4 ||
            round.winners.some((number) => typeof number !== "string" || !/^\d{6}$/.test(number) || allWinners.has(number)) ||
            new Set(round.winners).size !== round.winners.length || !Number.isFinite(Date.parse(round.drawnAt))) {
          throw new Error("저장된 당첨 기록을 읽을 수 없습니다.");
        }
        round.winners.forEach((number) => allWinners.add(number));
      });
      state.remaining = normalizeNumbers(state.remaining).filter((number) => !allWinners.has(number));
      return state;
    }

    function save(state) {
      // 남은 참가자와 당첨 기록을 함께 저장해 새로고침 중에도 결과를 보존한다.
      storage.setItem(STATE_KEY, JSON.stringify(state));
      try { storage.setItem("luckydraw_numbers", JSON.stringify(state.remaining)); } catch {
        // 이전 버전용 복사본보다 위의 단일 상태 저장을 우선한다.
      }
      return state;
    }

    function register(numbers) {
      return save({ version: 1, remaining: normalizeNumbers(numbers), history: [] });
    }

    function draw(count, prize, options = {}) {
      if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("추첨 인원은 1명부터 4명까지 선택해주세요.");
      const state = load();
      if (state.remaining.length < count) throw new Error(`남은 참가자는 ${state.remaining.length}명입니다. 추첨 인원을 줄여주세요.`);
      const winners = [];
      for (let index = 0; index < count; index++) winners.push(state.remaining.splice(chooseIndex(state.remaining.length), 1)[0]);
      const round = { round: state.history.length + 1, prize: String(prize).trim().slice(0, 80) || "럭키드로우", winners, drawnAt: new Date().toISOString() };
      if (state.history.length && options.separateBefore) round.separateBefore = true;
      state.history.push(round);
      save(state);
      return { state, round };
    }
    return { load, register, draw };
  }

  const api = { create, normalizeNumbers, STATE_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LuckyDrawStore = api;
})(globalThis);
