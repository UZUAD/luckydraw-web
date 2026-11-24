(function (root) {
  "use strict";
  const FILE_NAME = "당첨자명단.xlsx";
  function eventFileName(number) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("올바른 행사 파일 번호가 필요합니다.");
    return `당첨자명단_${number}.xlsx`;
  }

  function createWorkbook(history, xlsx) {
    if (!history.length) throw new Error("아직 저장할 당첨자가 없습니다.");
    const rows = [["순번", "추첨 회차", "상품명", "당첨 번호", "추첨 일시"]];
    let sequence = 1;
    history.forEach((round, index) => {
      if (index > 0 && round.separateBefore) rows.push([]);
      for (const winner of round.winners) {
        rows.push([sequence++, round.round, round.prize, winner, new Date(round.drawnAt)]);
      }
    });
    const sheet = xlsx.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: "yyyy-mm-dd hh:mm:ss" });
    sheet["!cols"] = [{ wch: 8 }, { wch: 12 }, { wch: 32 }, { wch: 14 }, { wch: 23 }];
    sheet["!rows"] = rows.map((_, index) => ({ hpt: index === 0 ? 26 : 22 }));
    sheet["!autofilter"] = { ref: sheet["!ref"] };
    const workbook = xlsx.utils.book_new();
    workbook.Props = { Title: "당첨자명단" };
    xlsx.utils.book_append_sheet(workbook, sheet, "당첨자명단");
    return workbook;
  }

  const api = { FILE_NAME, eventFileName, createWorkbook };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LuckyDrawExport = api;
})(globalThis);
