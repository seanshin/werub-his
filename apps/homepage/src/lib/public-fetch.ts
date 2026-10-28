/* eslint-disable */
// 🔴 이 파일은 `apps/web/src/lib/public-fetch.ts` 의 **기계 대조 사본**이다.
//    `apps/homepage` 는 격리 빌드(자체 npm install)라 web 을 참조할 수 없어 사본을 둔다.
//    정본은 apps/web 이며, 갈라지면 `apps/web/test/architecture/homepage-lib-copy-parity.spec.ts` 가 실패한다.
//    **여기를 직접 고치지 말 것** — 정본을 고치고 이 파일에 그대로 복사한다.
/**
 * 서버 컴포넌트용 공개 API fetch 유틸리티
 * ISR revalidate 옵션 지원
 *
 * API URL 우선순위:
 * 1. INTERNAL_API_URL — Docker 내부 통신용 (예: http://api:4000)
 * 2. NEXT_PUBLIC_API_URL — 클라이언트/서버 공용 (예: https://his.example.org)
 * 3. http://localhost:4000 — 로컬 개발 기본값
 */
const API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

/**
 * 🔴 (2026-09-14) 3상태 결과 — 종전 `publicFetch` 는 네트워크 실패·5xx·404·`data:null` 을 전부 `null` 로 돌려줘,
 *    소비처가 `?? []` 로 받으면 **API 가 죽은 순간이 "등록된 채용 공고가 없습니다"·"의료진 정보를 찾을 수 없습니다"**로 그려졌다
 *    (실패를 없음으로 번역). ISR 이라 그 거짓 페이지가 revalidate 창 동안 캐시된다.
 *  - `{ ok: true, data }` — 서버가 답했다(`data` 가 `null` 이면 서버가 "없음"이라고 말한 것)
 *  - `{ ok: false, reason: 'NOT_FOUND' }` — 404(대상 없음 — 상세 화면의 "찾을 수 없음"이 사실인 경우)
 *  - `{ ok: false, reason: 'UNAVAILABLE' }` — 네트워크 실패·그 밖 비정상 응답·본문 해석 실패(모름)
 */
export type PublicFetchResult<T> =
  | { ok: true; data: T | null }
  | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE'; status?: number };

export async function publicFetchResult<T>(path: string, revalidate = 3600): Promise<PublicFetchResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { next: { revalidate } });
  } catch {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
  if (res.status === 404) return { ok: false, reason: 'NOT_FOUND', status: 404 };
  if (!res.ok) return { ok: false, reason: 'UNAVAILABLE', status: res.status };
  try {
    const json = await res.json();
    return { ok: true, data: (json?.data ?? null) as T | null };
  } catch {
    return { ok: false, reason: 'UNAVAILABLE', status: res.status };
  }
}

/**
 * 종전 모양(실패·없음 모두 `null`) — **표시가 "없음"을 주장하지 않는 자리만** 쓴다
 * (SEO 메타 폴백·JSON-LD·수치 카드를 빼는 자리 등). 목록·상세 본문은 `publicFetchResult` 로 실패를 따로 그린다.
 */
export async function publicFetch<T>(path: string, revalidate = 3600): Promise<T | null> {
  const r = await publicFetchResult<T>(path, revalidate);
  return r.ok ? r.data : null;
}
