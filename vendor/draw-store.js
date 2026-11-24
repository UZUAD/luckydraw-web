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
      if (saved === null) {
        const participants = normalizeNumbers(JSON.parse(storage.getItem("luckydraw_numbers") || "[]"));
        return { version: 2, participants, remaining: [...participants], history: [] };
      }
      const state = JSON.parse(saved);
      if (![1, 2].includes(state.version) || !Array.isArray(state.history) || !Array.isArray(state.remaining)) {
        throw new Error("저장된 추첨 데이터를 읽을 수 없습니다.");
      }
      const allWinners = new Set();
      state.history.forEach((round, index) => {
        if (round.round !== index + 1 || typeof round.prize !== "string" ||
            (round.separateBefore !== undefined && typeof round.separateBefore !== "boolean") ||
            !Array.isArray(round.winners) || round.winners.length < 1 || round.winners.length > 4 ||
            round.winners.some((number) => typeof number !== "string" || !/^\d{6}$/.test(number)) ||
            new Set(round.winners).size !== round.winners.length || !Number.isFinite(Date.parse(round.drawnAt))) {
          throw new Error("저장된 당첨 기록을 읽을 수 없습니다.");
        }
        round.winners.forEach((number) => allWinners.add(number));
      });
      state.remaining = normalizeNumbers(state.remaining);
      if (state.version === 1) {
        // 이전 데이터에서 남은 인원이 0명이어도 기록으로 전체 참가자를 복구한다.
        state.participants = normalizeNumbers([...state.remaining, ...allWinners]);
        state.remaining = state.remaining.filter((number) => !allWinners.has(number));
        state.version = 2;
      } else {
        state.participants = normalizeNumbers(state.participants);
      }
      const participants = new Set(state.participants);
      if ([...state.remaining, ...allWinners].some((number) => !participants.has(number))) {
        throw new Error("저장된 참가자와 당첨 기록이 일치하지 않습니다.");
      }
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
      const participants = normalizeNumbers(numbers);
      return save({ version: 2, participants, remaining: [...participants], history: [] });
    }

    function draw(count, prize) {
      if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("추첨 인원은 1명부터 4명까지 선택해주세요.");
      const state = load();
      if (state.participants.length < count) throw new Error(`등록된 참가자는 ${state.participants.length}명입니다. 추첨 인원을 줄여주세요.`);
      const winners = [];
      while (winners.length < count) {
        if (!state.remaining.length) state.remaining = [...state.participants];
        const eligible = state.remaining.map((number, index) => winners.includes(number) ? -1 : index).filter((index) => index >= 0);
        winners.push(state.remaining.splice(eligible[chooseIndex(eligible.length)], 1)[0]);
      }
      const round = { round: state.history.length + 1, prize: String(prize).trim().slice(0, 80) || "럭키드로우", winners, drawnAt: new Date().toISOString() };
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
