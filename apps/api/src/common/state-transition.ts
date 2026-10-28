import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * 상태 전이 강제 — **기계 도구**다. 전이 규칙(어휘·허용 표)은 각 모듈이 자기 정본에 선언한다.
 *
 * 🔴 이 저장소에서 같은 결함이 반복해서 나왔다(2026-09-15 전수):
 *  · 취소된 치료 오더가 COMPLETED 로 뒤집혀 **취소한 치료가 청구**됐다(P3)
 *  · 거절된 당직 교대가 다시 승인돼 두 사람 근무가 원복됐다(N3)
 *  · 확정된 코드 매핑이 REJECTED 로 뒤집혀 **살아 있는 매핑이 "거부됨"**이 됐다(B10)
 *  · 종결된 협진에 회신이 덮어써졌다 · 사망 등록이 ACTIVE 로 되돌아갔다(D1)
 * 공통 기전은 하나다 — **읽지 않고 쓴다**. 그래서 도구도 하나로 둔다.
 *
 * 규칙:
 *  · 전이 표에 없는 전이는 400(`assertStateTransition`) — 사용자 입력 문제이지 서버 오류가 아니다.
 *  · 값은 문장에 녹이지 않고 `details` 로 내려보낸다(서버가 한국어 문장을 조립하지 않는다).
 *  · 이미 목표 상태면 호출부가 **쓰기 없이 멱등**으로 끝낸다(일어난 사실의 시각·행위자를 덮어쓰지 않는다).
 *  · 읽은 뒤 상태가 바뀌었으면(동시 처리) 조건부 갱신이 0건 → `stateChangedConflict` 로 409.
 *    (`updateMany({ where: { id, status: current } })` — 읽고-쓰기 사이의 경합을 DB 가 판정하게 한다)
 */
export type TransitionMap<S extends string> = Readonly<Partial<Record<S, readonly S[]>>>;

export interface TransitionContext {
  /** 오류 코드 접두 — 예: 'TRANSFER' → TRANSFER_INVALID_TRANSITION · TRANSFER_STATE_CHANGED */
  code: string;
  /** 사용자에게 보일 고정 문구(값은 details 로) */
  message: string;
}

/** 전이 표에 없으면 400 — 허용 목록을 details 에 실어 화면이 "무엇이 가능한가"를 말할 수 있게 한다 */
export function assertStateTransition<S extends string>(
  map: TransitionMap<S>,
  current: S,
  next: S,
  ctx: TransitionContext,
): void {
  const allowed = map[current] ?? [];
  if (allowed.includes(next)) return;
  throw new BadRequestException({
    code: `${ctx.code}_INVALID_TRANSITION`,
    message: ctx.message,
    details: { from: current, to: next, allowed },
  });
}

/** 조건부 갱신 0건(동시 처리) — 409. 사용자는 새로 고친 뒤 다시 시도한다 */
export function stateChangedConflict(ctx: TransitionContext, from: string): never {
  throw new ConflictException({
    code: `${ctx.code}_STATE_CHANGED`,
    message: '다른 처리로 상태가 이미 바뀌었습니다 — 새로 고친 뒤 다시 확인하세요',
    details: { from },
  });
}
