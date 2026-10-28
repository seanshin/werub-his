import { BadRequestException } from '@nestjs/common';

/**
 * 목록 EP 가 **모르는 필터를 조용히 버리지 않게** 하는 검사.
 *
 * 🔴 개별 `@Query('x')` 로 받는 EP 는 선언하지 않은 키를 **아무 말 없이 무시**한다.
 *    그래서 주치의 워크스테이션이 `prescribedBy`(오더)·`doctorId`(인수인계)를 보내도 서버는 몰랐고,
 *    "내 대기 오더"가 **병원 전체의 ORDERED 오더**, "인수인계"가 **전 병원 최근 인계**였다.
 *    필터가 무시된 응답은 성공(200)이라 화면은 그것을 "내 것"이라고 그렸다.
 *    → 모르는 필터는 400 으로 **크게 실패**시킨다(틀린 목록은 빈 목록보다 나쁘다 — 그 목록을 보고 조치한다).
 *
 * 🔴 `query` 가 없으면(컨트롤러를 직접 부르는 단위 테스트·내부 호출) 검사하지 않는다 —
 *    HTTP 경로에서는 Nest 가 항상 객체를 넘긴다.
 * 🔴 예외 문장에 한국어를 끼워 넣지 않는다(서버 메시지 규약) — 키 목록은 details 로.
 */
export function assertKnownQueryKeys(
  query: Record<string, unknown> | null | undefined,
  allowed: readonly string[],
): void {
  if (!query || typeof query !== 'object') return;
  const unknown = Object.keys(query).filter((k) => !allowed.includes(k));
  if (unknown.length === 0) return;
  throw new BadRequestException({
    code: 'UNKNOWN_QUERY_PARAM',
    message: `Unknown query parameter(s): ${unknown.join(', ')}`,
    details: { unknown, allowed: [...allowed] },
  });
}
