/**
 * 특이사항에서 먹/못먹 정보 파싱
 * 사이트 칩실수, 바때기 등 → 정산관리 사이트/내용 표시용
 */
function parseNotesForFinish(notes) {
  if (!notes) return [];

  const result = [];
  const parts = notes.split('/');

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    // 패턴 1: 사이트명 + (칩실수|칩팅|배거) + 숫자 + (먹|못먹)
    const match1 = trimmedPart.match(/^(.+?)(칩실수|칩팅|배거)(\d+)(먹|못먹)/);

    // 패턴 2: (칩실수|칩팅|배거) + 사이트명 + 숫자 + (먹|못먹)
    const match2 = trimmedPart.match(/^(칩실수|칩팅|배거)(.+?)(\d+)(먹|못먹)/);

    // 패턴 3: 바때기 + 숫자 + (먹|못먹|충|환)
    const match3 = trimmedPart.match(/^바때기([\d.]+)(먹|못먹|충|환)$/);
    // 패턴 4: 바때기 + (칩실수|배거|칩팅) + 숫자 + (먹|못먹)
    const match4 = trimmedPart.match(/^바때기(칩실수|배거|칩팅)([\d.]+)(먹|못먹)$/);

    if (match1 || match2) {
      const siteName = match1 ? match1[1] : match2[2];
      result.push({ site: siteName, content: trimmedPart });
    } else if (match3 || match4) {
      result.push({ site: '바때기', content: trimmedPart });
    }
  }

  return result;
}

/**
 * parseNotesForFinish 결과를 site_content 문자열로 변환
 */
function notesListToSiteContent(notesList) {
  if (!Array.isArray(notesList) || notesList.length === 0) return '';
  return notesList.map((item) => item.content).join('/');
}

module.exports = {
  parseNotesForFinish,
  notesListToSiteContent
};
