/**
 * 임상 규칙 대장(화면 3417) 정의 정본 — 2026-10-21 임상 규칙·템플릿 P4(`clinical-rules-templates-review-2026-10.plan.md` B1).
 *
 * 「임상 규칙·템플릿」 10개 화면의 카탈로그를 한 장에 모은다. 서버는 지표 **코드와 값**만 내고, 라벨·이동 경로는 이 정본에서만 온다
 * (서버가 문장을 조립하지 않는다). 가드가 서버 응답의 지표 코드 = 이 정의를 기계 대조한다.
 *  · 값 `null` = 확인 불가(조회 실패·계측 전) — 0 이 아니다
 *  · warnWhenPositive — 0 보다 크면 주의 색(승인 기록 없음·코드 기본값 대체 등)
 */
export interface LedgerMetricDef { code: string; label: string; kind?: 'count' | 'bool'; warnWhenPositive?: boolean }
export interface LedgerCatalogDef { key: string; label: string; href: string; metrics: readonly LedgerMetricDef[] }

export const CLINICAL_RULES_LEDGER: readonly LedgerCatalogDef[] = [
  { key: 'ORDER_SET', label: '약속처방(CP)', href: '/admin/order-sets', metrics: [
    { code: 'active', label: '사용 중' }, { code: 'draft', label: '초안' },
    { code: 'activeNoApprover', label: '사용 중 · 승인 기록 없음', warnWhenPositive: true },
    { code: 'activeNoDiagnosis', label: '사용 중 · 진단 연결 없음', warnWhenPositive: true },
    { code: 'usage90d', label: '최근 90일 사용' },
  ] },
  { key: 'TREATMENT_TEMPLATE', label: '치료일정 템플릿', href: '/admin/treatment-templates', metrics: [
    { code: 'active', label: '사용 중' }, { code: 'draft', label: '초안' },
    { code: 'activeNoApprover', label: '사용 중 · 승인 기록 없음', warnWhenPositive: true },
    { code: 'schedulesActive', label: '진행 중 환자 일정' },
  ] },
  { key: 'FORMULARY', label: '원내 처방집(위원회)', href: '/admin/formulary', metrics: [
    { code: 'itemsActive', label: '등재 품목' }, { code: 'itemsSuspended', label: '사용중지 품목' },
    { code: 'requestsPending', label: '처리 대기 요청', warnWhenPositive: true },
    { code: 'enforcedDomains', label: '시행 중인 영역(경고·차단)' },
  ] },
  { key: 'DUR', label: 'CDSS 규칙(DUR 룰)', href: '/admin/cdss-rules', metrics: [
    { code: 'rulesActive', label: '활성 룰' },
    { code: 'fallbackTypes', label: '코드 기본값으로 판정하는 유형', warnWhenPositive: true },
    { code: 'hits90d', label: '최근 90일 적중' },
    { code: 'legacyUnused', label: '판정 미사용 옛 규칙', warnWhenPositive: true },
  ] },
  { key: 'PROTOCOL', label: '여정 프로토콜', href: '/admin/protocols', metrics: [
    { code: 'templatesActive', label: '사용 중 프로토콜' }, { code: 'instancesActive', label: '진행 중 인스턴스' },
  ] },
  { key: 'PRESCRIBER', label: '처방의 지정 규칙', href: '/admin/prescriber-rules', metrics: [
    { code: 'enabled', label: '기능 켜짐', kind: 'bool' }, { code: 'allowDelegate', label: '위임 처방 허용', kind: 'bool' },
  ] },
  { key: 'CHART_TEMPLATE', label: '차트 에디터', href: '/admin/chart-editor', metrics: [
    { code: 'templates', label: '서식' }, { code: 'versions', label: '이전 판 기록' },
  ] },
  { key: 'FORM', label: '폼 빌더', href: '/admin/forms', metrics: [
    { code: 'schemas', label: '폼 정의' }, { code: 'submissions', label: '제출' },
  ] },
  { key: 'CHART_VERIFY', label: '임상도구 검수', href: '/admin/clinical-chart-verification', metrics: [
    { code: 'verifiedCharts', label: '검증된 도구' }, { code: 'records', label: '검수 기록' },
  ] },
  { key: 'TRIAGE', label: '트리아지 관리', href: '/admin/triage', metrics: [
    { code: 'rulesActive', label: '활성 규칙' }, { code: 'symptoms', label: '증상' }, { code: 'aliases', label: '별칭' },
    { code: 'hits', label: '누적 적중' },
  ] },
];

export type LedgerCardValue = { key: string; metrics: Record<string, number | boolean | null> | null; lastChangedAt: string | null };
