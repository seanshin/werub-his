/**
 * 검체 채취 기록 규칙(2026-10-01) — 순수 함수(테스트가 직접 부른다).
 *
 * 🔴 종전: 채취 시각을 따로 남기는 단계가 없었다. 검사실 접수(`receiveOrder`)·채혈 접수(`lab.collect`)가
 *    접수 순간을 `labResult.collectedAt` 으로 **찍었다** — 병동에서 2시간 전에 채혈한 검체도 "접수 = 채취"로 기록돼
 *    채취→접수 운반 시간이 언제나 0 이었고, 검체 안정성(채취 후 경과)을 판단할 근거가 없었다.
 * 이제: 채취는 오더의 별도 사건(`specimenCollectedAt`·누가·언제 남겼나·출처). 모르면 null — 접수 시각으로 채우지 않는다.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';

export type SpecimenCollectionSource = 'POINT_OF_CARE' | 'ENTERED_LATER';

/** 미래 허용 오차 — 단말 시계 차이(1분). 그보다 미래면 사실이 아니다 */
const FUTURE_SKEW_MS = 60_000;

export interface CollectionOrderState {
  department: string;
  status: string;
  createdAt: Date;
  receivedAt: Date | null;
  specimenCollectedAt: Date | null;
}

/**
 * 채취 시각을 정한다 — 입력이 없으면 지금(채취하며 누름), 있으면 그 시각(나중 입력 · 출처를 남긴다).
 *  · 검사 오더만 · 취소된 오더 불가 · 이미 기록됐으면 409(덮어쓰지 않는다 — 정정은 별도 절차)
 *  · 미래 불가 · 오더 발행 전 불가 · 검사실 접수 뒤 불가(채취가 접수보다 먼저다)
 */
export function resolveCollectionTime(
  order: CollectionOrderState,
  input: { collectedAt?: string | null },
  now: Date = new Date(),
): { at: Date; source: SpecimenCollectionSource } {
  if (order.department !== 'LAB') throw new BadRequestException({ code: 'NOT_LAB_ORDER', message: '검사 오더만 검체 채취를 기록합니다' });
  if (order.status === 'CANCELLED') throw new ConflictException({ code: 'ORDER_CANCELLED', message: '취소된 오더입니다' });
  if (order.specimenCollectedAt) {
    throw new ConflictException({ code: 'SPECIMEN_ALREADY_RECORDED', message: '이미 채취가 기록된 오더입니다', details: { specimenCollectedAt: order.specimenCollectedAt.toISOString() } });
  }
  let at = now;
  let source: SpecimenCollectionSource = 'POINT_OF_CARE';
  if (input.collectedAt != null && input.collectedAt !== '') {
    const t = new Date(input.collectedAt);
    if (Number.isNaN(t.getTime())) throw new BadRequestException({ code: 'INVALID_TIME', message: '채취 시각 형식이 올바르지 않습니다' });
    at = t;
    source = 'ENTERED_LATER';
  }
  if (at.getTime() > now.getTime() + FUTURE_SKEW_MS) throw new BadRequestException({ code: 'FUTURE_TIME', message: '채취 시각이 지금보다 미래일 수 없습니다' });
  if (at.getTime() < order.createdAt.getTime()) throw new BadRequestException({ code: 'BEFORE_ORDER', message: '채취 시각이 오더 발행보다 이를 수 없습니다' });
  if (order.receivedAt && at.getTime() > order.receivedAt.getTime()) {
    throw new BadRequestException({ code: 'AFTER_RECEIPT', message: '채취 시각이 검사실 접수보다 늦을 수 없습니다' });
  }
  return { at, source };
}
