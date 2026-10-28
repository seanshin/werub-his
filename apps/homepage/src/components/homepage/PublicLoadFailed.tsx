/**
 * 공개 홈페이지 목록·상세의 "불러오지 못함" 표시 — `publicFetchResult` 가 `UNAVAILABLE` 일 때.
 * 🔴 (2026-09-14) 종전엔 조회 실패가 `?? []` 로 빈 목록이 되어 "등록된 채용 공고가 없습니다"·"검색 결과가 없습니다"로 그려졌다
 *    (실패를 없음으로 번역). 없음과 모름은 다른 사실이다.
 */
export function PublicLoadFailed({ what }: { what: string }) {
  return (
    <div className="text-center py-16" role="status">
      <p className="text-gray-500">{what}을(를) 지금 불러오지 못했습니다</p>
      <p className="text-gray-400 text-sm mt-1">잠시 후 다시 확인해 주세요</p>
    </div>
  );
}
