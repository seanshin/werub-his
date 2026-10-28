import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

/** PACS 임상 API 기본 주소 — 서버에서만 부른다(브라우저에 노출하지 않는다). */
export function pacsApiBase(): string {
  return (process.env.PACS_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
}

/**
 * 🔴 포털 본인 검사 소유 검증 정본 — **fail-closed** · 403 과 503 을 가른다.
 *
 * PACS 조회가 실패하면 '남의 것이다'가 아니라 '확인할 수 없다'(503)이다 — 통과시키지도, "본인 검사가 아니다"(403)라고
 * 말하지도 않는다. (판독 PDF 에서 조회 실패 시 소유권 확인 없이 임의 studyUID 를 내주던 IDOR 이 있었다 — 2026-08-18.)
 *
 * 2026-09-28 r1 #15-2: 선택 내보내기(`pacs-export.service`)만 옛 모양이었다 — export 토큰으로 PACS 를 불러
 * (PACS 는 임상 인증만 받는다) 실패하면 빈 집합 → 환자에게 **"본인의 검사가 아닌 항목이 포함되었습니다"** 라는 거짓 사실.
 * 소유 확인 정본이 둘이던 자리(P12)를 이 함수 하나로 모았다(썸네일·판독 PDF·선택 내보내기).
 *
 * ⚠️ `limit=200` — 검사 200건을 넘는 환자는 목록 밖 검사가 403 이 된다(종전과 같은 한계 · 페이지네이션 미구현).
 */
export async function assertPatientOwnsStudies(opts: {
  mrn: string;
  studyUids: string[];
  headers: Record<string, string>;
  /** 403 문구 — 호출 맥락(단건/선택 목록)에 맞춘다 */
  forbiddenMessage: string;
  unavailableMessage?: string;
}): Promise<void> {
  const res = await fetch(`${pacsApiBase()}/api/v1/patients/${encodeURIComponent(opts.mrn)}/studies?limit=200`, {
    headers: opts.headers,
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!res || !res.ok) {
    throw new ServiceUnavailableException({
      error: 'PACS_UNAVAILABLE',
      message: opts.unavailableMessage ?? '영상 보관 시스템에 연결하지 못해 검사 소유권을 확인할 수 없습니다.',
    });
  }
  const data = (await res.json()) as { studies?: { study_instance_uid?: string }[] };
  const owned = new Set((data.studies ?? []).map((s) => s.study_instance_uid).filter((u): u is string => !!u));
  if (opts.studyUids.some((u) => !owned.has(u))) {
    throw new ForbiddenException({ error: 'FORBIDDEN', message: opts.forbiddenMessage });
  }
}
