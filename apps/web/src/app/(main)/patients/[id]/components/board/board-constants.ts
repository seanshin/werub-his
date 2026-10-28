// 큰 화면 보기(멀티패널 board) P0 상수 — 프리셋·그리드·staleTime 정책
// 설계: docs/02-design/features/patient-chart-large-screen-view.design.md

/** 레지스트리에 등록 가능한 패널 키(프리셋·사용자 레이아웃은 이 중 부분집합·순서) */
export type BoardPanelKey =
  | 'overview' | 'vitals' | 'labresults' | 'medications' | 'problems' | 'allergies' | 'orders'
  | 'nursing' | 'surgeries' | 'admissions' | 'referrals' | 'checkup' | 'therapy' | 'schedule';

/** 역할별 기본 프리셋(사용자 커스텀이 없을 때 적용) */
export const BOARD_PRESET_DOCTOR: BoardPanelKey[] = ['vitals', 'labresults', 'medications', 'orders', 'problems', 'allergies'];
export const BOARD_PRESET_NURSE: BoardPanelKey[] = ['vitals', 'medications', 'nursing', 'orders', 'problems', 'allergies'];

/** 역할 → 기본 프리셋 */
export function getDefaultPreset(role?: string): BoardPanelKey[] {
  return role === 'NURSE' ? BOARD_PRESET_NURSE : BOARD_PRESET_DOCTOR;
}

/** 편집기 팔레트 — 선택 가능한 전체 패널(라벨·적합도는 registry에서) */
export const BOARD_ALL_PANELS: BoardPanelKey[] = [
  'vitals', 'labresults', 'medications', 'orders', 'problems', 'allergies',
  'nursing', 'surgeries', 'admissions', 'referrals', 'checkup', 'therapy', 'schedule', 'overview',
];

/**
 * 반응형 컬럼(§4): xl→2, 2xl→3, ≥2560px→4. 초광폭 가독 위해 4열 상한(D8).
 * grid-cols-1 기본(좁은 화면 폴백) — 단 board는 < xl에서 미적용(page.tsx 가드).
 */
export const BOARD_GRID_CLASS =
  'grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 min-[2560px]:grid-cols-4 gap-4 items-start';

/**
 * 패널 staleTime 정책(P-3·§6.2) — 문서/향후 적용용.
 * P0에선 각 패널이 자체 useQuery staleTime을 가지므로 참고값(패널 개별 적용은 P1).
 */
export const BOARD_STALE_MS: Partial<Record<BoardPanelKey, number>> = {
  vitals: 60_000,
  labresults: 120_000,
  medications: 120_000,
  orders: 120_000,
  problems: 300_000,
  allergies: 300_000,
};
