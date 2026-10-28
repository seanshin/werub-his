/**
 * 화면 단위 작성 가능성(capability) 정본 — 2026-08-03 결정
 * "역할별로 입력 가능한 부분과 불가능한 부분을 세련되게 구분한다."
 *
 * 의미는 **이 화면(탭)에서 지금 작성할 수 있는가**다 — 추상적 권한이 아니라.
 * (예: 검사 결과 입력은 서버상 4역할 허용이지만 환자 상세에는 폼이 없고 오더 단위
 * 워크스테이션에서 한다 → 이 화면에선 '열람'이 정직한 표시)
 *
 * 근거는 전부 서버 실측(각 항목 주석) — 화면 배지가 서버와 다르게 말하면 안 된다.
 */

export type CapabilityMode =
  /** 이 화면에서 바로 작성 */
  | 'write'
  /** 입력은 열리되 책임자 승인 경유(위임) */
  | 'delegated'
  /** 이 화면에선 열람 — 작성은 다른 곳/다른 역할 */
  | 'readonly';

export interface TabCapability {
  mode: CapabilityMode;
  /** 배지 문구(짧게) */
  label: string;
  /** 툴팁 — 왜 이 상태인지·작성은 어디서 하는지 */
  reason: string;
}

const W = (label: string, reason: string): TabCapability => ({ mode: 'write', label, reason });
const D = (label: string, reason: string): TabCapability => ({ mode: 'delegated', label, reason });
const R = (reason: string): TabCapability => ({ mode: 'readonly', label: '열람', reason });

/**
 * 환자 상세 탭 × 역할 → 작성 가능성.
 * 서버 근거: encounters=POST /encounters(DOCTOR/ADMIN) · vitals=POST /vitals(DOCTOR/NURSE/ADMIN) ·
 * nursing=POST /nursing-notes(NURSE/ADMIN·외래 universal — 재원 정본은 워크스테이션) ·
 * medications=POST /encounters/:id/prescriptions(DOCTOR/ADMIN 직접·NURSE/LAB_TECH 는 지정 처방의
 * 승인 위임 fail-closed) · labresults=결과 입력은 오더 단위(검사실 워크스테이션).
 */
export function tabCapability(tab: string, role?: string): TabCapability | null {
  const r = role ?? '';
  switch (tab) {
    case 'encounters':
      return r === 'DOCTOR' || r === 'ADMIN'
        ? W('작성 가능', '진료 기록 작성·서명(의사)')
        : R('진료 기록 열람 — 작성은 의사. 열람은 감사에 기록됩니다');
    case 'vitals':
      return r === 'DOCTOR' || r === 'NURSE' || r === 'ADMIN'
        ? W('작성 가능', '상단 [활력 입력]으로 바로 기록')
        : R('활력 열람 — 기록은 의사·간호사');
    case 'nursing':
      return r === 'NURSE' || r === 'ADMIN'
        ? W('작성 가능', '외래 간호기록은 상단 [간호기록]·재원 환자는 간호 워크스테이션(정본)')
        : R('간호기록 열람 — 작성은 간호사');
    case 'medications':
      if (r === 'DOCTOR' || r === 'ADMIN') return W('작성 가능', '처방 입력·DUR 점검');
      if (r === 'NURSE' || r === 'LAB_TECH') return D('승인 후 작성', '구두처방 대리입력 — 지정 처방의 승인(폰) 후 발행됩니다');
      if (r === 'PHARMACIST') return R('처방 검토·DUR — 복약지도 기록은 조제 단위(약국 워크스테이션)');
      return R('처방 열람 — 작성은 의사');
    case 'labresults':
      return R('결과 열람 — 입력·검증은 오더 단위(검사실 워크스테이션)');
    default:
      return null; // 배지 없는 탭 — 없는 곳에 억지로 붙이지 않는다
  }
}
