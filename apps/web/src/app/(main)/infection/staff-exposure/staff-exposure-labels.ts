/**
 * 직원 혈액·체액 노출 사고 화면의 표현 규칙 — 2026-08-18.
 *
 * 🔴 어휘·3상 판정의 **정본은 서버**다(`apps/api/src/modules/infection-control/staff-exposure.ts`).
 *    서버는 행마다 `exposureTypeLabel`·`followUpStatusLabel`·`sourceStatus` 를 함께 내려주므로
 *    화면은 그것을 그대로 쓴다. 여기 상수는 **응답에 label 이 없을 때의 폴백**과 **색**뿐이고,
 *    폴백 문구가 서버 정본과 갈라지지 않는지는 `staff-exposure-labels.spec.ts` 가 파일을 직접
 *    읽어 대조한다(한 곳만 고치면 갈라진다).
 *
 * 🔴 이 화면에서 절대 하지 않는 것:
 *    ① 원환자 감염상태의 **미상(UNKNOWN)을 음성처럼 보이게 하는 것.** 노출자는 그걸 보고
 *       "안전하다"고 읽고 PEP(노출 후 예방요법) 시점을 놓친다. 미상은 초록이 아니다.
 *    ② boolean 을 화면에서 직접 3상으로 접는 것(정본이 둘이 된다) — 서버의 `sourceStatus` 만 읽는다.
 */

import type { StatusBadgeProps } from '@/components/ui/StatusBadge';

/** 노출 유형 폴백 라벨 — 서버 `STAFF_EXPOSURE_TYPE_LABELS` 와 글자까지 동일해야 한다 */
export const EXPOSURE_TYPE_LABEL: Record<string, string> = {
  NEEDLESTICK: '주사침 자상',
  SHARPS: '예리물 손상',
  SPLASH_MUCOSA: '점막 노출',
  SKIN_CONTACT: '손상피부 접촉',
  OTHER: '기타',
};

/** 노출 유형 코드 순서 — 서버 `STAFF_EXPOSURE_TYPES` 와 동일(신고 폼 드롭다운) */
export const EXPOSURE_TYPES = ['NEEDLESTICK', 'SHARPS', 'SPLASH_MUCOSA', 'SKIN_CONTACT', 'OTHER'] as const;

/** 추적관찰 상태 폴백 라벨 — 서버 `STAFF_EXPOSURE_FOLLOW_UP_LABELS` 와 동일 */
export const FOLLOW_UP_LABEL: Record<string, string> = {
  OPEN: '접수(추적 미개시)',
  IN_FOLLOW_UP: '추적관찰 중',
  CLOSED: '종결',
};

export const FOLLOW_UP_STATUSES = ['OPEN', 'IN_FOLLOW_UP', 'CLOSED'] as const;

/**
 * 추적관찰 배지 색 — `<StatusBadge status config={...} />` 에 그대로 넘긴다.
 * 🔴 로컬에 새 배지 컴포넌트를 만들지 않는다(색 규약이 화면마다 갈라진다).
 *    종결(CLOSED)은 **초록이 아니라 회색**이다 — "닫혔다"는 것이지 "안전하다"는 뜻이 아니다.
 */
export const FOLLOW_UP_BADGE: NonNullable<StatusBadgeProps['config']> = {
  OPEN: { label: FOLLOW_UP_LABEL.OPEN, bg: 'bg-amber-100', text: 'text-amber-700' },
  IN_FOLLOW_UP: { label: FOLLOW_UP_LABEL.IN_FOLLOW_UP, bg: 'bg-blue-100', text: 'text-blue-700' },
  CLOSED: { label: FOLLOW_UP_LABEL.CLOSED, bg: 'bg-gray-100', text: 'text-gray-600' },
};

/** 서버가 준 3상 — 화면이 boolean 을 직접 접지 않는다 */
export type SourceSerology = 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';

export interface SourceStatusView {
  hbv: SourceSerology;
  hcv: SourceSerology;
  hiv: SourceSerology;
  anyUnknown: boolean;
  anyPositive: boolean;
  sourceIdentified: boolean;
}

/**
 * 혈청 3상의 표시 — **미상은 음성과 다른 색·다른 글자**다.
 * 미상을 회색으로 흘리면 눈에 안 들어와 '문제 없음'으로 읽히므로 주의색(amber)을 쓴다.
 */
export function serologyView(s: SourceSerology | undefined | null): {
  label: string;
  tone: string;
  title: string;
} {
  switch (s) {
    case 'POSITIVE':
      return {
        label: '양성',
        tone: 'bg-red-100 text-red-700',
        title: '원환자 양성 — 노출 후 예방요법(PEP) 대상 여부를 즉시 판단하십시오',
      };
    case 'NEGATIVE':
      return { label: '음성', tone: 'bg-emerald-100 text-emerald-700', title: '검사 결과 음성' };
    case 'UNKNOWN':
      return {
        label: '미상',
        tone: 'bg-amber-100 text-amber-800',
        title: '검사 전이거나 결과를 모릅니다 — 음성이 아닙니다',
      };
    default:
      // 서버가 3상을 주지 않은 응답 — 여기서 추측하지 않는다(정본은 서버 하나뿐)
      return { label: '확인 불가', tone: 'bg-gray-100 text-gray-500', title: '서버가 감염상태를 내려주지 않았습니다' };
  }
}

/**
 * 신고 폼의 3상 입력값 ↔ 전송 payload.
 * 🔴 '미상'은 **필드를 보내지 않는 것**이다. `false` 를 보내면 원장에 '음성'이 박힌다.
 */
export type SerologyInput = 'UNKNOWN' | 'NEGATIVE' | 'POSITIVE';

export function serologyToPayload(v: SerologyInput): boolean | undefined {
  if (v === 'POSITIVE') return true;
  if (v === 'NEGATIVE') return false;
  return undefined; // 미상 — 전송하지 않는다
}

export const SEROLOGY_INPUTS: { value: SerologyInput; label: string }[] = [
  { value: 'UNKNOWN', label: '미상' },
  { value: 'NEGATIVE', label: '음성' },
  { value: 'POSITIVE', label: '양성' },
];

/** 폴백 라벨 — 서버가 label 을 줬으면 그것을 우선한다 */
export function exposureTypeLabel(code: string, serverLabel?: string | null): string {
  return serverLabel || EXPOSURE_TYPE_LABEL[code] || code;
}

export function followUpLabel(code: string, serverLabel?: string | null): string {
  return serverLabel || FOLLOW_UP_LABEL[code] || code;
}
