/**
 * 감염관리 화면의 라벨 정본 — 화면 실사용 점검 W7(2026-08-14).
 *
 * 🔴 종전에는 같은 화면 안에 라벨표가 **2벌**이었다.
 *  - 감염유형: 상단 감염감시 표는 `SSI`/`HAP`/`CAUTI` 영문 raw(맵 자체가 없었다),
 *    바로 아래 HAI 탭은 같은 코드를 "수술부위감염"/"요로감염" 한글로 보여줬다.
 *  - WHO Moment: 입력 드롭다운 "3. 체액 노출 후" vs 통계 "3. 체액 노출 위험 후"
 *    (FE 상수와 BE 상수가 각각 정의돼 있었다).
 * → 이 파일 하나로 수렴한다. WHO Moment 문구는 **BE 정본**
 *   (`InfectionControlService.HH_MOMENTS`)과 글자까지 동일하게 맞췄고, 화면은 가능하면
 *   서버 응답의 label 을 그대로 쓴다(여기 상수는 응답이 없을 때의 폴백).
 *
 * ⬆ shared 정본 승격 후보: `packages/shared` 로 올려 BE `HH_MOMENTS`·감염유형 라벨과
 *   한 벌로 묶어야 한다(이번 배치는 shared 수정 금지라 모듈 로컬에 둔다).
 */

import { RATIO_UNAVAILABLE } from '@hospital-run/shared';

/** 감염유형/HAI 유형 라벨 — 감염감시 표와 HAI 레지스트리가 함께 쓴다 */
export const INFECTION_TYPE_LABEL: Record<string, string> = {
  CLABSI: '중심정맥관 혈류감염',
  CAUTI: '요로감염',
  VAP: '인공호흡기 폐렴',
  HAP: '병원획득 폐렴',
  SSI: '수술부위감염',
  CDI: 'C.difficile 장염',
  BSI: '혈류감염',
  UTI: '요로감염',
  PNEUMONIA: '폐렴',
  GI: '위장관감염',
  RESPIRATORY: '호흡기감염',
  SKIN: '피부·연조직감염',
  MDRO: '다제내성균',
  OTHER: '기타',
};

/** 코드면 한글 라벨로, 아니면(자유 입력 질병명) 원문 그대로 */
export function infectionTypeLabel(code?: string | null): string {
  if (!code) return '-';
  return INFECTION_TYPE_LABEL[code] ?? INFECTION_TYPE_LABEL[code.toUpperCase()] ?? code;
}

/** 격리 유형 라벨/색 — 감염감시 표·MDRO 레지스트리 공통 */
export const ISOLATION_LABEL: Record<string, string> = {
  CONTACT: '접촉격리',
  DROPLET: '비말격리',
  AIRBORNE: '공기격리',
  PROTECTIVE: '보호격리',
  STRICT: '엄격격리',
  STANDARD: '표준주의',
};

export const ISOLATION_TONE: Record<string, string> = {
  CONTACT: 'bg-amber-50 text-amber-700',
  DROPLET: 'bg-orange-50 text-orange-700',
  AIRBORNE: 'bg-red-50 text-red-700',
  PROTECTIVE: 'bg-blue-50 text-blue-700',
  STRICT: 'bg-red-50 text-red-700',
  STANDARD: 'bg-gray-100 text-gray-600',
};

export function isolationLabel(type?: string | null): string {
  if (!type) return '-';
  return ISOLATION_LABEL[type] ?? type;
}

export function isolationTone(type?: string | null): string {
  return (type && ISOLATION_TONE[type]) || 'bg-gray-100 text-gray-500';
}

/** WHO 5 Moments — BE `InfectionControlService.HH_MOMENTS` 와 동일 문구(폴백용) */
export const HH_MOMENTS: readonly string[] = [
  '환자 접촉 전',
  '청결·무균처치 전',
  '체액 노출 위험 후',
  '환자 접촉 후',
  '환자 주변환경 접촉 후',
];

/**
 * 준수율 표시 — 🔴 표본이 없으면 0% 가 아니라 '산출 불가'.
 * (종전: `rate = c?.overall.complianceRate ?? 0` → 관측 0건인데 목표 90% 대비 빨간 0%)
 */
export function complianceDisplay(rate: number | null | undefined, total: number | null | undefined) {
  const n = total ?? 0;
  if (rate == null || n <= 0) {
    // 🔴 문구는 shared 정본(`RATIO_UNAVAILABLE`) — 화면마다 손으로 적으면 어휘가 갈라진다(v4.4 교훈)
    return { available: false as const, text: RATIO_UNAVAILABLE, tone: 'text-gray-400', barPct: 0 };
  }
  return {
    available: true as const,
    text: `${rate}`,
    tone: rate >= 90 ? 'text-emerald-600' : rate >= 80 ? 'text-amber-600' : 'text-red-600',
    barPct: Math.max(0, Math.min(100, rate)),
  };
}

/** 준수율 막대 색 — 표본 없으면 회색(목표 대비 색칠하지 않는다) */
export function complianceBarTone(rate: number | null | undefined, total: number | null | undefined) {
  if (rate == null || (total ?? 0) <= 0) return 'bg-gray-200';
  return rate >= 90 ? 'bg-emerald-500' : rate >= 80 ? 'bg-amber-500' : 'bg-red-500';
}
