/**
 * 결정 등록부 배치 2026-10-A (2026-10-01) — **환자 여정 모델 축**(기획 `docs/01-plan/features/patient-journey-model.plan.md` §7 D1~D12).
 *
 * 그 기획서의 사람 결정 표는 P0~P2 가 배포될 동안 "미등재"로 남아 있었다 — 문서에 있는 동안엔 아무도 못 고른다.
 * `statusQuo` 는 **배포된 코드를 다시 읽고** 적었다(P2 `f3097cd53`·`d430ec02e` 기준). 몇 항목은 코드가 이미 한쪽을
 * 사실상 고르고 있다(D7·D10·D12) — 그 사실을 statusQuo 에 밝힌다(결정한 것처럼 적지 않는다).
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다. 어느 항목도 `enactKind` 를 갖지 않는다 —
 *    어느 쪽을 골라도 코드 변경이 남는다(CODE_CHANGE).
 * 🔴 법령은 "적용 여부 검토"로만 적는다 — 조문·처리기한은 조사하지 않았으므로 적지 않는다(판정 규칙 §7).
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/patient-journey-model.plan.md` §7';
const SVC = '`apps/api/src/modules/journey/journey.service.ts`';

export const DECISION_BATCH_2026_10_A: DecisionDef[] = [
  {
    key: 'journey.backfillOccurredAt',
    track: 'QUALITY',
    title: '여정 과거 행의 발생 시각을 원 기록에서 채워 넣을 것인가(백필)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '여정 P1(2026-10-01) 이전 행은 발생 시각을 모른다(출처 UNKNOWN). 기간 보고서의 간격 지표는 발생 시각이 있는 행만 쓰므로 ' +
      '그 이전 기간은 "산출 불가"가 늘어난다. 원 기록(응급 방문·입원·수술)에 시각 필드가 있지만, 여정 행과 원 기록의 짝이 ' +
      'refId 로 확정되는 유형과 그렇지 않은 유형이 섞여 있다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: 'QI 위원회 · 의무기록위원회',
    options: [
      { value: 'NONE', label: '채우지 않는다', effect: '과거 행은 발생 시각 미상으로 남는다. 과거 기간의 간격 지표는 산출 불가와 제외 건수로 보인다.', enact: null },
      { value: 'REF_EXACT_ONLY', label: '원 기록과 1:1 로 확정되는 유형만 채운다', effect: 'refId 가 있는 행만 원 기록 시각으로 채운다(출처 DOMAIN_FIELD · 백필 표식). 과거 지표 일부가 생기고, 매핑이 틀리면 과거 수치가 바뀐다(소급).', enact: null },
      { value: 'ALL', label: '전 유형을 채운다', effect: 'refId 없는 행은 가장 가까운 원 기록과 짝을 추정해야 한다 — 추정값이 사실처럼 남는다.', enact: null },
    ],
    statusQuo: '운영 여정 2,390행 전부 발생 시각 미상(occurred_at_source=UNKNOWN). 보고서는 그 행을 간격에서 빼고 `excludedUnknownTime` 으로 센다. 채우는 코드 없음.',
    verifyHow: [`${SVC} getReport · journey-report.ts excludedUnknownTime`, PLAN],
    afterDecision: 'NONE 외에는 백필 스크립트(읽기→미리보기→적용)와 백필 표식 컬럼·되돌리기 경로 개발이 남는다.',
    owner: 'QI팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'journey.erToAdmissionBoundary',
    track: 'QUALITY',
    title: '응급실에서 입원으로 이어진 경우를 한 방문으로 볼 것인가, 두 방문으로 볼 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '응급 체류와 재원일수의 시작점이 이 선택으로 갈린다. FHIR 는 두 Encounter 를 잇고, OMOP 은 통합 방문 개념도 허용한다. ' +
      '같은 환자의 같은 날 기록이 지표마다 다른 경계를 쓰면 숫자가 서로 맞지 않는다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: 'QI 위원회',
    options: [
      { value: 'TWO_LINKED', label: '두 방문 + 연결(precededBy)', effect: '응급 체류와 재원일수가 따로 나온다. 재원일수에 응급 시간이 들어가지 않는다. 연결 관계 기록 개발이 남는다.', enact: null },
      { value: 'ONE', label: '한 방문(통합)', effect: '입원 재원 시작이 응급 도착으로 당겨진다. 청구·병상 기준 재원일과 다른 수가 된다.', enact: null },
      { value: 'BOTH_NAMED', label: '둘 다 산출하되 이름을 달리해 정의를 밝힌다', effect: '지표가 둘이 된다(같은 이름에 두 값은 두지 않는다). 화면마다 어느 정의인지 표기해야 한다.', enact: null },
    ],
    statusQuo: '응급 방문(EmergencyVisit)과 입원(Admission)은 각각 별도 방문 단위로 기록된다. 둘을 잇는 연결 관계는 여정 원장에 없다(처분 기록의 admissionId 에만 있다).',
    verifyHow: ['`patient_journey_event_objects` 에 qualifier `precededBy`·`partOf` 행 없음', PLAN],
    afterDecision: '어느 쪽이든 연결 관계 기록(또는 통합 지표) 개발이 남는다.',
    owner: 'QI팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'journey.unexposedRecording',
    track: 'PRIVACY',
    title: '환자 노출이 정해지지 않은 사건(간호 평가·낙상 위험·안전사건·감염)과 프로토콜 변이를 "기록만" 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '여정은 환자 포털 타임라인에 나간다. 그래서 노출 범위가 정해지지 않은 4종은 아예 기록하지 않고 있다 — 노출 결정과 분석이 묶여 있다. ' +
      '프로토콜 단계의 건너뜀·막힘도 기록하지 않아 경로 준수율·변이율을 잴 수 없다.',
    legalReview: ['환자안전 보고자 보호(환자안전법) — 안전사건을 기록하더라도 보고자 식별을 사건·객체 관계에 싣지 않는 조건 검토'],
    approvalPath: 'CODE_CHANGE',
    authority: '환자안전위원회 · 감염관리위원회 · 개인정보보호책임자',
    options: [
      { value: 'RECORD_HIDDEN', label: '기록하되 환자에게는 숨긴다', effect: '분석·완결성 측정에 들어간다. 포털에는 나가지 않는다(현행 숨김 목록 방식 유지). 안전사건은 보고자 식별을 싣지 않는다.', enact: null },
      { value: 'NOT_RECORDED', label: '계속 기록하지 않는다', effect: '노출 결정과 분석이 계속 묶인다. 경로 준수율·변이율은 산출하지 않는다.', enact: null },
    ],
    statusQuo: 'shared `JOURNEY_EVENT_NOT_EMITTED` 에 4종이 "사람 결정 필요"로 동결돼 발행되지 않는다. 프로토콜은 완료 단계(PROTOCOL_STEP)만 기록된다.',
    verifyHow: ['`packages/shared/src/journey-event-types.ts` JOURNEY_EVENT_NOT_EMITTED', PLAN],
    afterDecision: 'RECORD_HIDDEN 이면 발행 지점·숨김 목록·보고자 제외 가드 개발이 남는다.',
    owner: '적정진료팀 · 감염관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'journey.exportMode',
    track: 'PRIVACY',
    title: '환자 여정 기록을 연구·외부 분석용 표준 형식(XES·OCEL 2.0)으로 반출하는 것을 허용할 것인가',
    layer: 'LICENSE_HOLDER',
    why:
      '프로세스 마이닝 도구는 XES·OCEL 형식의 사건 기록을 읽는다. 반출은 환자 진료 경로가 시스템 밖으로 나가는 일이라 비식별화·승인 절차가 앞선다. ' +
      '원내에서만 쓰더라도 저장 위치와 열람 감사가 필요하다.',
    legalReview: ['개인정보 가명처리·반출 요건 적용 여부', '연구 목적 이용 시 기관 심의(IRB) 절차 적용 여부', '대외 발신 3조건(구현·설정 기본 OFF·승인)'],
    approvalPath: 'CODE_CHANGE',
    authority: '병원장 · 개인정보보호책임자 · 연구심의위원회',
    options: [
      { value: 'DENY', label: '허용하지 않는다', effect: '반출 경로를 만들지 않는다. 준비도 미리보기(집계만)는 원내 화면에 남는다.', enact: null },
      { value: 'INTERNAL_ONLY', label: '원내 분석 도구로만(파일이 원외로 안 나감)', effect: '원내 저장 위치·열람 감사·보존기간 정의 개발이 남는다. 내려받기는 원내 단말로 한정된다.', enact: null },
      { value: 'DEIDENTIFIED_EXTERNAL', label: '비식별 반출 허용', effect: '가명처리·승인 화면·발신 기록이 필요하다. 원내 절차(IRB 등)를 거친 건만 나간다.', enact: null },
    ],
    statusQuo: '반출 코드·변환 엔진 없음. 2026-10-01 관리자 전용 "여정 반출 준비도"(관제 화면 · 집계만 — 사건·환자 데이터를 내보내지 않는다)가 시각 미상·매핑 불가·평탄화(결핍/수렴) 건수를 보인다.',
    verifyHow: ['`GET /api/v1/journey/export-readiness` 는 건수·제외 수·평탄화 경고만 낸다', PLAN],
    afterDecision: 'DENY 외에는 저장·감사(INTERNAL_ONLY) 또는 승인·발신 기록(DEIDENTIFIED_EXTERNAL) 개발과 원내 절차 수립이 남는다.',
    owner: '정보보호팀 · 연구지원팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'journey.emitDurability',
    track: 'PLATFORM',
    title: '여정 기록이 저장에 실패하면 막을 것인가(아웃박스), 셀 것인가(계수)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '여정 발행은 업무 저장이 끝난 뒤 따로 쓴다. 그 쓰기가 실패하면 업무는 됐는데 여정에는 빠진다. 지금은 실패를 서버 로그와 ' +
      '프로세스 메모리 계수로만 남겨 재시작하면 사라진다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '전산팀장 · QI 위원회',
    options: [
      { value: 'COUNT_DURABLE', label: '계수만 — 실패를 원장에 남겨 분모로 드러낸다', effect: '구현이 작다. 유실은 남지만 몇 건인지는 재시작 뒤에도 보인다.', enact: null },
      { value: 'OUTBOX', label: '업무 커밋 후 아웃박스로 재시도', effect: '유실이 거의 없어진다. 임상 저장 경로에 쓰기가 하나 늘고, 재시도 중 이중 발행은 멱등 키로 막는다.', enact: null },
    ],
    statusQuo: '실패는 로그(warn)와 관제 "여정 기록 상태" 카드의 프로세스 시작 이후 계수로만 보인다(재시작하면 0). 상태–사건 불일치는 감시자 79·80 이 센다.',
    verifyHow: [`${SVC} emit()·emitStats()`, '`GET /api/v1/journey-console/recording-health`'],
    afterDecision: '어느 쪽이든 원장 테이블과 재시도/계수 경로 개발이 남는다.',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'journey.performerObjects',
    track: 'PRIVACY',
    title: '여정 사건에 "누가 했는가"(직원 개인)를 객체 관계로 실을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '수행자를 실으면 어느 단계에서 누가 병목인지 분석할 수 있다. 같은 자료가 직원 개인 성과 감시로 쓰일 수 있다.',
    legalReview: ['직원 개인정보 처리·근로 감시 해당 여부 검토'],
    approvalPath: 'CODE_CHANGE',
    authority: '인사위원회 · 개인정보보호책임자',
    options: [
      { value: 'PERSON', label: '직원 개인까지 싣는다', effect: '자원 관점 분석(누가 병목인가)이 가능하다. 열람 권한·목적 제한 정의가 필요하다.', enact: null },
      { value: 'ROLE_ONLY', label: '부서·역할까지만', effect: '개인 식별이 없다. 인수인계 지연 원인은 원 기록으로만 추적한다.', enact: null },
    ],
    statusQuo: '관계표에는 수행자(performer) 행을 쓰지 않는다. 다만 사건 행의 `doctorId` 칸에는 일부 유형(입원·수술·검진 판정 등)의 의사 id 가 종전부터 저장된다.',
    verifyHow: ['`patient_journey_event_objects` 에 qualifier performer 행 없음', '`patient_journey_events.doctor_id`'],
    afterDecision: 'PERSON 이면 관계 기록·열람 권한 개발, ROLE_ONLY 면 기존 doctorId 의 반출 제외 규칙 개발이 남는다.',
    owner: '인사팀 · 정보보호팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'journey.userClaimedInMetrics',
    track: 'QUALITY',
    title: '직원이 입력한 과거 시각(예: 응급 도착 시각)을 시간 지표에 넣을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '늦게 등록한 환자는 직원이 실제 도착 시각을 입력한다. 넣으면 늦은 등록이 지표를 왜곡하지 않지만 입력 오류·조정이 그대로 반영된다. ' +
      '빼면 그 건이 표본에서 빠져 분모가 줄어든다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: 'QI 위원회',
    options: [
      { value: 'INCLUDE', label: '넣는다', effect: '입력 시각을 관측 시각과 같이 쓴다.', enact: null },
      { value: 'EXCLUDE', label: '뺀다', effect: '입력 시각 건은 표본에서 빠지고 제외 수로 보인다.', enact: null },
      { value: 'INCLUDE_WITH_SHARE', label: '넣되 그 비율을 함께 보인다', effect: '지표 옆에 "입력 시각 N건/표본 M건"을 표기한다.', enact: null },
    ],
    statusQuo: '코드가 사실상 INCLUDE 다 — 기간 보고서 간격은 발생 시각 출처를 가리지 않는다(입력 시각도 쓴다). 화면 타임라인은 "입력된 시각" 표식을 단다.',
    verifyHow: ['`apps/api/src/modules/journey/journey-report.ts` firstInterval — 출처 미구분'],
    afterDecision: 'EXCLUDE·INCLUDE_WITH_SHARE 면 보고서·지표의 출처 분기 개발이 남는다.',
    owner: 'QI팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'journey.outpatientEnd',
    track: 'QUALITY',
    title: '외래 방문은 언제 끝난 것으로 볼 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why: '외래 체류 시간은 끝점에 따라 수치가 다르다. 진료 기록 완료·수납·조제 수령 중 무엇을 끝으로 볼지 정해지지 않았다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: 'QI 위원회 · 원무팀',
    options: [
      { value: 'NOTE_SIGNED', label: '진료 기록 완료(서명)', effect: '수납·조제 대기 시간은 외래 체류에 들어가지 않는다.', enact: null },
      { value: 'BILLING_PAID', label: '수납 완료', effect: '조제 대기는 빠진다. 수납이 여러 번이면 첫 수납/마지막 수납을 다시 정해야 한다.', enact: null },
      { value: 'DISPENSED', label: '조제·수령 완료', effect: '원내 조제가 없는 환자는 끝점이 없다 — 다른 끝점을 대신 써야 한다.', enact: null },
      { value: 'NO_SINGLE_END', label: '"외래 종료"를 정의하지 않고 지표마다 끝점을 밝힌다', effect: '외래 체류라는 이름의 지표는 만들지 않는다.', enact: null },
    ],
    statusQuo: '2026-10-03 사용자 결정 BILLING_PAID(마지막 수납)로 구현됨 — 외래 체류 = 접수 → 그 진료의 수납 완료 · 방문 묶음 끝 · 수납 시 위치 닫기. 등록부 결정 기록(근거·허가권)은 이 화면에서 사람이 남긴다.',
    verifyHow: [`${SVC} getMetrics`, PLAN],
    afterDecision: 'NO_SINGLE_END 외에는 지표 산출 개발이 남는다.',
    owner: 'QI팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'emergency.departureTimeSource',
    track: 'QUALITY',
    title: '응급실 퇴실 시각을 무엇으로 기록할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '응급 체류 시간(ED LOS)과 처분 후 대기(boarding)는 퇴실 시각이 있어야 잰다. 지금 퇴실 확정은 상태만 바꾸고 시각을 남기지 않는다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: 'QI 위원회 · 응급의학과',
    options: [
      { value: 'DEPARTED_AT_FIELD', label: '퇴실 시각 칸을 새로 두고 퇴실 화면에서 남긴다', effect: '응급 체류·boarding 산출이 가능해진다. 스키마 추가가 필요하다. 과거 시각 입력을 허용하면 입력 시각으로 표식한다.', enact: null },
      { value: 'BED_RELEASE', label: '응급 병상 해제 시각을 퇴실로 본다', effect: '추가가 없다. 병상 없이 진료한 방문은 산출할 수 없고, "병상 해제 = 퇴실" 가정이 지표에 박힌다.', enact: null },
      { value: 'UNDECIDED', label: '정하지 않는다', effect: '응급 체류 시간은 계속 산출 불가로 남는다.', enact: null },
    ],
    statusQuo: '2026-10-03 사용자 결정 DEPARTED_AT_FIELD 로 구현됨 — `EmergencyVisit.departedAt`(퇴실·입원 전환·사망 · 직원 입력은 USER_CLAIMED) · 응급 체류 산출 · 방문 묶음 끝 · 위치 닫기. 그 이전 방문·자동 종결은 퇴실 시각 없음. 등록부 결정 기록(근거·허가권)은 이 화면에서 사람이 남긴다.',
    verifyHow: [`${SVC} getMetrics erStayUnavailableReason`, '`apps/api/src/modules/emergency/emergency.service.ts` checkout()'],
    afterDecision: 'DEPARTED_AT_FIELD 면 스키마·화면·지표 개발, BED_RELEASE 면 지표 개발과 가정 표기가 남는다.',
    owner: '응급의학과 · QI팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'surgery.durationDefinition',
    track: 'QUALITY',
    title: '"수술 시간"을 무엇으로 정의할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why: '수술 시작·종료 버튼 시각과 기록지의 절개·봉합 시각이 둘 다 있다. 수술실 효율과 술기 시간은 다른 지표다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '수술실 운영위원회 · QI 위원회',
    options: [
      { value: 'OR_STAY', label: '수술실 체류(시작·종료 버튼)', effect: '현행 보고서와 같다. 기록 지연이 그대로 들어간다.', enact: null },
      { value: 'INCISION_CLOSURE', label: '절개~봉합(기록값)', effect: '기록값이 비면 표본이 준다(제외 수로 보인다).', enact: null },
      { value: 'BOTH_NAMED', label: '둘 다 이름을 달리해 제공', effect: '"수술실 체류"와 "술기 시간"이 따로 보인다.', enact: null },
    ],
    statusQuo: '코드가 사실상 OR_STAY 다 — 여정 보고서 `surgeryMinutes` 는 SURGERY_START→SURGERY_COMPLETE(버튼 시각)다. 절개·봉합 시각은 수술 기록에만 있다.',
    verifyHow: ['`apps/api/src/modules/journey/journey-report.ts` surgeryMinutes', '`surgeries.incision_time`·`closure_time`'],
    afterDecision: 'OR_STAY 외에는 지표 개발과 화면 이름 변경이 남는다.',
    owner: '수술실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'quality.readmission30Definition',
    track: 'QUALITY',
    title: '30일 재입원율의 분자·분모를 어떻게 정의할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '분모에서 사망·전원 퇴원을 뺄지, 분자에서 계획 재입원(항암 주기 등)을 뺄지, 같은 진료과만 볼지에 따라 수치가 달라진다. ' +
      '계획 재입원을 판별할 원천이 원장에 없으면 "뺀다"를 고를 때 판별 원천부터 필요하다 — 없는 판별을 추정으로 만들지 않는다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: 'QI 위원회',
    options: [
      { value: 'ALL_CAUSE', label: '전 원인 재입원(현행 범위)', effect: '계획 재입원도 센다. 수치가 높게 나온다.', enact: null },
      { value: 'UNPLANNED_ONLY', label: '비계획 재입원만', effect: '입원 시 계획 여부를 남기는 칸·화면 개발이 먼저다. 그 전 기간은 산출 불가.', enact: null },
      { value: 'SAME_DEPT', label: '같은 진료과 재입원만', effect: '진료과가 바뀐 재입원은 빠진다.', enact: null },
    ],
    statusQuo:
      '분모 = 기간 안 퇴원(DISCHARGED · 전원 TRANSFERRED 제외 · 사망 퇴원은 따로 가르지 않음). 분자 = 퇴원 후 30일 안 같은 환자의 입원(취소 입원 제외 — 2026-10-01 교정, 계획 여부 미구분).',
    verifyHow: [`${SVC} getMetrics readmissionRate30Days`],
    afterDecision: 'ALL_CAUSE 외에는 판별 원천·지표 개발이 남는다.',
    owner: 'QI팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'journey.demoSeparation',
    track: 'PLATFORM',
    title: '데모·시드 여정 사건을 실업무 사건과 같은 원장에 출처 표시로 둘 것인가, 따로 둘 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '같은 원장에 두면 조회마다 출처를 걸러야 하고, 빠뜨리면 섞인다. 따로 두면 실원장은 깨끗하지만 데모 화면이 두 곳을 읽어야 한다. ' +
      '실서비스 전환 때 시드를 걷어낼 기준이 된다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '전산팀장 · 운영 개시 책임자',
    options: [
      { value: 'SAME_TABLE_ORIGIN', label: '같은 원장 + 출처 컬럼', effect: '조회·지표마다 출처 필터가 필요하다(가드로 막는다).', enact: null },
      { value: 'SEPARATE_TABLE', label: '데모는 별도 원장', effect: '실원장은 깨끗하다. 데모 화면·감시자가 두 원천을 읽는 개발이 남는다.', enact: null },
    ],
    statusQuo:
      '코드가 사실상 SAME_TABLE_ORIGIN 이다 — P1 에서 `data_origin`(LIVE/SEED/DEMO/IMPORTED/UNKNOWN)을 넣었다. 과거 행은 UNKNOWN. ' +
      '지표·보고서는 아직 출처로 거르지 않는다.',
    verifyHow: ['`patient_journey_events.data_origin`', `${SVC} getMetrics·getReport`],
    afterDecision: 'SAME_TABLE_ORIGIN 이면 지표·보고서의 출처 필터와 가드, SEPARATE_TABLE 이면 원장 분리 개발이 남는다.',
    owner: '전산팀',
    // 실서비스 전환은 시드를 전량 제거·격리한다(`real-mode-cutover.md`) — 이 결정은 그 뒤의 데모 운영 방식이라 개시 전 필수가 아니다
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
