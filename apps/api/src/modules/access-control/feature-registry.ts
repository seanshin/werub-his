// 기능별 접근 권한 매트릭스 — 기능 카탈로그 (코드 SoT)
// 자체 가드로 진입을 통제하는 기능들의 중앙 레지스트리.
// 가드/컨트롤러는 동일한 key 를 사용하고, 오버라이드만 SystemConfig(category='feature-access')에 저장한다.

export interface FeatureDef {
  /** 고유 키 (가드·데코레이터와 공유) */
  key: string;
  /** 화면 표기명 */
  label: string;
  /** 묶음 그룹 */
  group: '상담' | '보안' | '경영' | '검진';
  /** 오버라이드 미설정 시 허용 역할 기준선 (현행 @Roles 와 일치 → 무중단) */
  defaultRoles: string[];
  /** 보조 설명 */
  description?: string;
}

export const FEATURE_REGISTRY: FeatureDef[] = [
  { key: 'consult.desk',      label: '상담 데스크',     group: '상담', defaultRoles: ['CRM_STAFF', 'CRM_MANAGER', 'ADMIN'], description: '상담 데스크 진입 (상담원)' },
  { key: 'consult.lead',      label: '상담 팀장 콘솔',  group: '상담', defaultRoles: ['CRM_MANAGER', 'ADMIN'], description: '팀장 큐/배정 콘솔' },
  { key: 'consult.admin',     label: '상담 팀 관리',    group: '상담', defaultRoles: ['ADMIN'], description: '상담 팀 구성·멤버 관리' },
  { key: 'credential.admin',  label: '직원 인증 콘솔',  group: '보안', defaultRoles: ['ADMIN'], description: '직원 자격/권한 부여 콘솔 (4-eyes 유지)' },
  { key: 'terminal.admin',    label: '단말 관리',       group: '보안', defaultRoles: ['ADMIN'], description: '단말 등록·정책 관리. 이미 @RequirePermission/일일PIN 으로 세밀통제 — 매트릭스는 가시화(강제위임 후속)' },
  { key: 'audit.btg',         label: '감사 BTG 열람',   group: '보안', defaultRoles: ['ADMIN'], description: 'Break-the-glass 감사 열람. 이미 BtgGuard 로 세밀통제 — 매트릭스는 가시화(강제위임 후속)' },
  { key: 'executive.console', label: '경영진 관제',     group: '경영', defaultRoles: ['ADMIN', 'EXECUTIVE'], description: '경영진 관제 콘솔(ADMIN·경영진). 매트릭스에서 추가 허용/특정 사용자 grant·deny 가능' },
  { key: 'voucher.admin',     label: '검진권 관리',     group: '검진', defaultRoles: ['ADMIN'], description: '건강검진권 발행·활성화·상환·검증' },
  { key: 'voucher.policy',    label: '검진권 정책',     group: '검진', defaultRoles: ['ADMIN'], description: '검진권 정책 설정·활성화(4-eyes·법정 클램프)' },
];

export const FEATURE_MAP = new Map<string, FeatureDef>(FEATURE_REGISTRY.map((f) => [f.key, f]));
