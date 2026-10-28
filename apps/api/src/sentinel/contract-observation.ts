/**
 * 계약 드리프트 **관측점 등록부**.
 *
 * 🔴 "계약 드리프트 0건"은 두 가지 뜻이 될 수 있다 — ① 정말 어긋난 곳이 없다
 *    ② **그 자리를 관측하고 있지 않다.** 관측점을 밝히지 않으면 화면이 ②를 ①로 말한다.
 *    이 저장소가 "0행은 세 가지 뜻이 된다"로 이미 기록한 함정의 계약 축 버전이다.
 *
 * 여기 없는 롤업·화면은 **감시되고 있지 않다.** 이 목록이 늘어나는 것이 이 축의 진척이다.
 *
 * 🔴 등재 규약: `consumer` 는 신호를 적는 코드의 `consumer:` 문자열과 **글자까지 같아야** 하고,
 *    `sourceFile`(src 기준 상대경로)에 그 문자열이 실재해야 한다 — 가드가 양방향으로 기계 대조한다
 *    (등록부에만 있는 관측점 = 보지도 않으면서 본다고 말하는 것 · 코드에만 있는 consumer = 범위 고지 누락).
 */
export interface ContractObservationPoint {
  /** 신호의 consumer 값과 같아야 한다 — 여기서만 대조가 성립한다 */
  consumer: string;
  label: string;
  kinds: ('KEY_MISSING' | 'NULL_FOLDED')[];
  /** `record({ consumer })` 를 부르는 소스 파일 — apps/api/src 기준 상대경로 */
  sourceFile: string;
}

export const CONTRACT_OBSERVATION_POINTS: ContractObservationPoint[] = [
  {
    consumer: 'command-center.buildKpi',
    label: '통합 상황판 KPI — 하위 보드 요약 키 조회',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/command-center/command-center.service.ts',
  },
  {
    consumer: 'pacs-webhook.orderLookup',
    label: 'PACS 웹훅 — accession 이 어느 오더에도 매칭되지 않음(판독 미반영)',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/pacs-proxy/pacs-webhook.controller.ts',
  },
  {
    consumer: 'billing.getErpInvoice',
    label: 'ERP 진료비 계산결과 — snake_case 응답 키 조회(금액·사전심사)',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/billing/billing.service.ts',
  },
  {
    consumer: 'portal.imagingNotifications',
    label: '포털 판독완료 알림 — PACS studies 응답 모양',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/portal/portal.controller.ts',
  },
  {
    consumer: 'safety-gate.fromChecks',
    label: '안전게이트 롤업 — imaging/rehab safetyChecks JSON 모양',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/safety-gate/safety-gate.service.ts',
  },
  {
    consumer: 'integration-outbox.pseudonymize',
    label: 'ERP 가명화 게이트 — chartNo 아닌 별칭 키로 실린 환자식별자',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/integration/integration-outbox.service.ts',
  },
  {
    consumer: 'order-set.isContraindicated',
    label: '오더세트 금기 — 저장된 금기가 전부 note 형이라 자동 대조가 평가되지 않음',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/order-set/order-set.service.ts',
  },
  {
    consumer: 'erp-eapproval.recommendLine',
    label: '전자결재 결재선 추천 — 응답 키 부재로 빈 결재선 상신',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/clinic-integration/erp-eapproval.service.ts',
  },
  {
    consumer: 'clinic-api.fetchClinicStaff',
    label: '그룹웨어 직원 목록 — 200인데 staff 배열 부재(계정 동기화 무음 no-op)',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/clinic-integration/clinic-api.service.ts',
  },
  {
    consumer: 'hie.buildComposition',
    label: 'HIE 문서 LOINC — 미등재 문서 종류가 기본 코드로 반출',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/hie/hie.service.ts',
  },
  {
    consumer: 'medical-ai.sanitizeMeetingJob',
    label: 'WeRU.B 회의 큐 — 전문 탐지 목록 밖 미지 키(고지 누락 가능)',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/medical-ai/medical-ai.service.ts',
  },
  {
    consumer: 'vitals.mergeThresholds',
    label: '활력 임계 오버라이드 — 미상 키·역전 범위가 조용히 버려짐(환자안전위 개정 표면)',
    kinds: ['KEY_MISSING'],
    sourceFile: 'modules/vitals/vitals.service.ts',
  },
];

/** 화면이 그대로 쓸 한 줄 — 무엇까지 보고 있는지(어디를 보는지까지 이름으로 밝힌다) */
export function contractCoverageNote(): string {
  const n = CONTRACT_OBSERVATION_POINTS.length;
  const names = CONTRACT_OBSERVATION_POINTS.map((p) => p.label.split(' — ')[0]).join(' · ');
  return `관측점 ${n}곳(${names})에서만 감시 중입니다 — 여기 없는 롤업·화면의 드리프트는 보이지 않습니다(0건이 아닙니다).`;
}
