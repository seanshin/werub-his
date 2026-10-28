/**
 * 결정 등록부 배치 10-D (2026-10-08) — **의료질관리 흐름**(PLAN-QI-FLOW-001 · `docs/01-plan/features/qi-flow-review-2026-10.plan.md` §6).
 *
 * 종단 실측: 질 지표 고리(정의→목표→측정→분석→판정→경보→개선→보고)가 CPOE 지표만 이어져 있고 일반 25지표는 수기 표였다.
 * 고리를 잇는 기능은 개발했고(공급원·월 마감·관리도·PDCA·보고서·사고 상태기계), **정의가 필요한 자리는 사람 결정으로 남겼다** —
 * 기준 없이 자동화하면 지금보다 더 그럴듯한 거짓이 된다.
 *
 * 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음. 위원회 몫(COMMITTEE)은 등록부가 집행하지 않는다(결정에 enactKind 없음).
 *    선택지의 `enact: { kind, target }` 은 **안건이 물려받는 집행 대상**이다 — 위원회가 그 선택지를 의결하면 집행 엔진이 반영한다.
 *    설정 키가 위원회 표면(QPS·SAFE·IC)에 매핑돼 있어 **안건 → 의결 → 집행 엔진** 경로로만 바뀐다.
 * 🔴 조문·평가 기준표·서식은 옮겨 적지 않았다(원문 대조 안 함).
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/qi-flow-review-2026-10.plan.md`';

export const DECISION_BATCH_2026_10_D: DecisionDef[] = [
  {
    key: 'qi.autoMeasure.denominator',
    track: 'QUALITY',
    title: '낙상·욕창·투약오류 발생률의 분모를 무엇으로 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '사고 원장(SafetyIncident)은 있는데 측정 원장으로 이어지는 코드가 없어 발생률은 전부 수기 입력이었다. 자동 산출 공급원을 만들었지만 ' +
      '분모가 정해지지 않으면 비율을 낼 수 없다 — 재원일수냐 입원 건수냐에 따라 같은 사고가 전혀 다른 수치가 된다.',
    legalReview: ['의료기관 인증 환자안전 지표 산출 기준(원문 확인 필요 — 이 등재에 산식을 옮겨 적지 않았다)'],
    approvalPath: 'COMMITTEE',
    authority: '질향상·환자안전위원회(QPS) · 간호부',
    options: [
      { value: 'PATIENT_DAYS', label: '재원일수(1,000재원일당)', effect: '매일 자정 병동별 재원일수 스냅샷을 분모로 쓴다. 외래·응급 사고는 이 지표에서 빠진다(별도 지표).', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.autoMeasure.incidentDenominator', newValue: 'PATIENT_DAYS' } } },
      { value: 'ADMISSIONS', label: '입원 건수(입원 100건당)', effect: '그 달 입원 건수를 분모로 쓴다. 재원 기간이 긴 환자의 노출이 반영되지 않는다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.autoMeasure.incidentDenominator', newValue: 'ADMISSIONS' } } },
      { value: 'UNSET', label: '정하지 않음(현행)', effect: '사고율 지표는 자동 산출되지 않는다 — 공급원은 건수만 대조 근거로 보여 준다.', enact: null },
    ],
    statusQuo: '설정 `qi.autoMeasure.incidentDenominator` 미설정 — 사고율 자동 산출 불가(건수만). 재원일수 스냅샷은 매일 기록된다(값을 쓰는 지표는 결정 후).',
    verifyHow: [PLAN + ' §3.3 B1·B2', '/quality 지표 상세 "공급원" 칸'],
    afterDecision: '의결 후 집행 엔진이 설정을 바꾸면 다음 월 마감부터 해당 지표가 자동 산출된다(월 마감 자체는 qi.autoMeasure.enable 결정).',
    owner: '의료질관리실 · 간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'qi.autoMeasure.enable',
    track: 'QUALITY',
    title: '질 지표 월 마감 자동 산출을 켤 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '공급원이 있는 지표(사고율·손위생·필수교육·불만·만족도·CPOE)는 매월 1일 전월분을 원장에 AUTO 로 기록할 수 있다. ' +
      '켜면 수기 입력과 같은 달에 값이 둘 생길 수 있고, 분모가 정해지지 않은 지표는 기록되지 않는다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '질향상·환자안전위원회(QPS)',
    dependsOn: ['qi.autoMeasure.denominator'],
    options: [
      { value: 'ON', label: '켠다', effect: '매월 1일 06:30 전월분 자동 기록. 분모 0·미설정 지표는 기록하지 않고 운영자에게 "산출 불가 n지표"를 알린다. 수기 값은 덮지 않는다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.autoMeasure.enabled', newValue: true } } },
      { value: 'OFF', label: '끈다(현행)', effect: '자동 기록 없음. 화면의 "지금 계산" 미리보기와 수기 입력은 그대로.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.autoMeasure.enabled', newValue: false } } },
    ],
    statusQuo: '설정 `qi.autoMeasure.enabled` = false(기본).',
    verifyHow: [PLAN + ' §3.3 B3'],
    afterDecision: '켠 다음 달부터 원장에 출처 AUTO 행이 생긴다. 끄면 이미 기록된 행은 남는다(무효화는 사람이 사유와 함께).',
    owner: '의료질관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'qi.deviceDays.source',
    track: 'QUALITY',
    title: 'CLABSI·CAUTI·VAP 의 분모(기구일수)를 어디서 얻을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '감염 통계(KONIS)는 건수만 있고 기구일수가 없어 발생률이 늘 `rate: null`(분모 미집계)이다. 기구 삽입·제거 원장은 2026-10-09 입원 화면에 생겼다 — 분모를 수기로 받을지 원장에서 셀지가 이 결정이다.',
    legalReview: ['KONIS 감시 기준(원문 확인 필요)'],
    approvalPath: 'COMMITTEE',
    authority: '감염관리위원회(IC)',
    options: [
      { value: 'MANUAL', label: '병동이 월별 기구일수를 수기 입력', effect: '감염관리 화면에 병동×월×기구 입력 칸이 열린다(출처 MANUAL). 입력된 달만 발생률을 낸다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.deviceDays.source', newValue: 'MANUAL' } } },
      { value: 'NONE', label: '산출 안 함 — 건수만', effect: '발생률은 계속 산출 불가로 남는다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.deviceDays.source', newValue: 'NONE' } } },
      { value: 'DEVICE_LEDGER', label: '기구 삽입·제거 원장으로 자동 산출', effect: '입원 화면의 기구 원장(삽입·제거 시각)에서 자정 기준 기구일수를 센다. 🔴 원장이 전 기구를 빠짐없이 기록하기 시작한 날(설정 qi.deviceLedger.coverageFrom)을 감염관리실이 정하기 전과 그 이전 달은 산출 불가로 남는다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.deviceDays.source', newValue: 'DEVICE_LEDGER' } } },
    ],
    statusQuo: '설정 `qi.deviceDays.source` 미설정 — 기구일수 입력 칸은 미결정임을 밝히고 저장을 받지 않는다.',
    verifyHow: ['`apps/api/src/modules/infection-control/infection-control.service.ts` getKonisStats(rate:null)', PLAN + ' §3.3 B1'],
    afterDecision: 'MANUAL 이면 설정 집행만으로 입력 칸이 열린다. DEVICE_LEDGER 면 원장 전수 기록 시작일(qi.deviceLedger.coverageFrom)을 함께 정해야 그 날 이후 달부터 값이 나온다(2026-10-09 원장 구현).',
    owner: '감염관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'qi.autoManual.precedence',
    track: 'QUALITY',
    title: '같은 달 수기 값과 자동 값이 다를 때 무엇을 정본으로 볼 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '자동 산출을 켜면 수기 입력과 같은 지표·달에 값이 둘 생긴다. 어느 쪽이 맞는지 시스템이 판단하면 안 된다(종이 관찰 후 입력은 정상 운영이다).',
    legalReview: ['인증·대외 보고 제출값의 근거 보존'],
    approvalPath: 'COMMITTEE',
    authority: '질향상·환자안전위원회(QPS)',
    options: [
      { value: 'BOTH', label: '둘 다 병기 — 판정은 수기(현행 기본)', effect: '보고서·화면에 두 값과 차이를 함께 보인다. 목표 판정은 수기 값으로.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.autoManual.precedence', newValue: 'BOTH' } } },
      { value: 'AUTO', label: '자동 값 우선', effect: '판정·보고서 정본은 자동 값. 수기 값은 주석으로 남는다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.autoManual.precedence', newValue: 'AUTO' } } },
      { value: 'MANUAL', label: '수기 값 우선', effect: '판정·보고서 정본은 수기 값. 자동 값은 대조 근거로만.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.autoManual.precedence', newValue: 'MANUAL' } } },
    ],
    statusQuo: '설정 `qi.autoManual.precedence` = BOTH(기본).',
    verifyHow: [PLAN + ' §3.3 B3 · §3.5 D2'],
    afterDecision: '의결 후 집행 엔진이 설정을 바꾸면 보고서·판정이 다음 조회부터 그 정본을 쓴다. 이미 기록된 값은 바뀌지 않는다.',
    owner: '의료질관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'qi.indicator.directEdit',
    track: 'QUALITY',
    title: '질 지표 정의·목표를 관리자가 화면에서 직접 바꾸는 것을 허용할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '목표는 QPS 의결 사항인데 관리자는 `/quality` 에서 바로 바꿀 수 있었다(위원회 우회). 막으면 위원회가 열리지 않는 달에 수기 운영이 멈출 수 있다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '질향상·환자안전위원회(QPS)',
    options: [
      { value: 'ALLOW_WITH_REASON', label: '허용 — 사유 필수·QPS 통지(현행 기본)', effect: '직접 수정 시 사유를 받고 변경 이력과 함께 QPS 위원에게 알린다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.indicator.directEdit', newValue: 'ALLOW_WITH_REASON' } } },
      { value: 'AGENDA_ONLY', label: '안건 경로만', effect: '신규 지표 등재와 정의·목표 직접 수정이 거부된다(409). 목표는 "위원회에 목표 안건 올리기"로만 바뀐다 — 이름·산식 문구 같은 정의 밖 항목은 그대로 고칠 수 있다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'qi.indicator.directEdit', newValue: 'AGENDA_ONLY' } } },
    ],
    statusQuo: '설정 `qi.indicator.directEdit` = ALLOW_WITH_REASON(기본).',
    verifyHow: ['`apps/api/src/modules/quality/quality.controller.ts` POST/PATCH indicators', PLAN + ' §3.1 원칙 4'],
    afterDecision: 'AGENDA_ONLY 로 의결되면 집행 즉시 직접 수정이 거부된다. 어느 쪽이든 변경 이력은 남는다.',
    owner: '의료질관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'safety.anonymousReport',
    track: 'QUALITY',
    title: '환자안전사고를 보고자 없이(익명) 받을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '보고자 신원은 읽기 경로에서 전부 가려지지만 원장에는 남는다(reporterId 필수). 완전 익명 보고는 불가능했다. ' +
      '익명을 허용하면 보고는 늘 수 있지만 추가 확인·피드백 경로가 사라진다.',
    legalReview: ['환자안전법 자율보고·보고자 보호 조항(원문 확인 필요)'],
    approvalPath: 'COMMITTEE',
    authority: '환자안전위원회(SAFE)',
    options: [
      { value: 'ALLOW', label: '익명 허용', effect: '보고 화면에 "익명으로 보고" 선택이 생긴다. 익명 보고는 본인도 다시 조회할 수 없다고 고지한다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'safety.incident.anonymous', newValue: true } } },
      { value: 'CONFIDENTIAL_ONLY', label: '비공개 보고만(현행)', effect: '보고자는 기록되되 전담인력 외에는 볼 수 없다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'safety.incident.anonymous', newValue: false } } },
    ],
    statusQuo: '설정 `safety.incident.anonymous` = false(기본) — 보고자 기록·비공개.',
    verifyHow: ['`apps/api/src/modules/patient-safety/patient-safety.select.ts`(보고자 차단)', PLAN + ' §3.6 E4'],
    afterDecision: '의결 후 집행되면 보고 화면에 익명 선택이 열린다(또는 닫힌다). 기존 보고의 보고자 기록은 바뀌지 않는다.',
    owner: '환자안전팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'safety.harmLevelScale',
    track: 'QUALITY',
    title: '환자안전사고 위해 정도를 어떤 척도로 기록할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '사고 원장에는 중증도(severity)만 있고 위해 정도(harm level)가 없어 "위해 사고율"을 낼 수 없다. 척도는 원내에서 정해야 한다(어휘를 지어내 강제하지 않는다).',
    legalReview: ['KOPS 보고 서식의 위해 정도 구분(원문 확인 필요)'],
    approvalPath: 'COMMITTEE',
    authority: '환자안전위원회(SAFE)',
    options: [
      { value: 'KOPS', label: 'KOPS 보고 서식의 단계', effect: '보고 화면에 해당 단계 선택이 생긴다(초기값 미선택 · 비워도 저장된다).', enact: { kind: 'CONFIG_CHANGE', target: { key: 'safety.harmLevelScale', newValue: 'KOPS' } } },
      { value: 'NCC_MERP', label: 'NCC MERP A~I(투약 오류 분류)', effect: '투약오류 외 사고에도 같은 척도를 쓴다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'safety.harmLevelScale', newValue: 'NCC_MERP' } } },
      { value: 'INTERNAL4', label: '원내 4단계', effect: '단계 문구는 위원회가 정한다(입력 보조 문구 등록 필요).', enact: { kind: 'CONFIG_CHANGE', target: { key: 'safety.harmLevelScale', newValue: 'INTERNAL4' } } },
      { value: 'UNSET', label: '정하지 않음(현행)', effect: '위해 정도 칸을 받지 않는다.', enact: null },
    ],
    statusQuo: '설정 `safety.harmLevelScale` 미설정 — 위해 정도 칸 없음.',
    verifyHow: [PLAN + ' §3.6 E2'],
    afterDecision: '척도가 정해지면 보고·검토 화면에 위해 정도 칸이 열린다. INTERNAL4 는 단계 문구 등록이 남는다. 과거 사고는 미기록으로 남는다(소급하지 않는다).',
    owner: '환자안전팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'safety.poaFlag',
    track: 'QUALITY',
    title: '진단별 입원 시 존재(POA) 여부를 기록할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      'PSI(환자안전지표)는 POA 플래그가 있어야 병원 발생과 입원 전 질환을 가를 수 있다. 없으면 산출하지 않는 것이 정직하다(현행 `available:false`).',
    legalReview: ['진단 코딩 지침(원문 확인 필요)'],
    approvalPath: 'COMMITTEE',
    authority: '의무기록위원회(MRC) · 질향상위원회',
    options: [
      { value: 'REQUIRE', label: '퇴원 시 진단별 POA 입력 필수', effect: '퇴원요약 서명 전에 입원 기간 모든 진단에 POA 값(입원 시 있었음·입원 후 발생·판단 불가)이 있어야 서명된다(설정 safety.poa.required). 🔴 PSI 는 이것만으로 산출되지 않는다 — 지표별 코드셋·제외 기준 등재가 남는다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'safety.poa.required', newValue: true } } },
      { value: 'NOT_ADOPT', label: '필수로 하지 않음(현행)', effect: 'POA 입력 칸은 열려 있으나 비어도 서명된다. PSI 는 계속 산출 불가로 표시된다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'safety.poa.required', newValue: false } } },
    ],
    statusQuo: '2026-10-09 퇴원요약 화면에 진단별 POA 입력 칸(원장 `diagnosis_poa`)이 생겼다 — 필수 아님(설정 safety.poa.required=false) · `/admin/qi` PSI 는 available:false(코드셋 미등재).',
    verifyHow: ['`apps/api/src/modules/qi/qi.service.ts` calculatePsi'],
    afterDecision: 'REQUIRE 면 집행 즉시 퇴원요약 서명이 POA 빈 진단을 거부한다. PSI 산출은 지표별 코드셋·제외 기준(원문)을 등재한 뒤에 연다.',
    owner: '의무기록실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'accreditation.framework',
    track: 'QUALITY',
    title: '어떤 인증 체계의 기준으로 자체 평가를 운영할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '인증 체크리스트는 코드에 박힌 8항목·자유 텍스트였다. 기준·측정 요소(ME)·평가 이력·근거 첨부 원장을 만들었지만, ' +
      '어느 체계의 기준을 적재할지는 병원이 정한다(조문·점수표를 코드가 지어내지 않는다).',
    legalReview: ['의료법상 인증 대상·주기(원문 확인 필요)'],
    approvalPath: 'COMMITTEE',
    authority: '질향상위원회(QPS) · 원장',
    options: [
      { value: 'KOIHA', label: '의료기관평가인증원(급성기)', effect: '인증 화면에서 KOIHA 기준을 등록·평가한다. 기준 문구는 담당자가 원문을 보고 입력한다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'accreditation.framework', newValue: 'KOIHA' } } },
      { value: 'JCI', label: 'JCI', effect: 'JCI 기준(장·표준·ME)을 등록·평가한다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'accreditation.framework', newValue: 'JCI' } } },
      { value: 'BOTH', label: '둘 다', effect: '두 체계 기준을 나란히 관리한다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'accreditation.framework', newValue: 'BOTH' } } },
      { value: 'UNSET', label: '정하지 않음(현행)', effect: '기준 등록을 받지 않는다 — 기존 8항목 체크리스트만 남는다.', enact: null },
    ],
    statusQuo: '설정 `accreditation.framework` 미설정.',
    verifyHow: ['/admin/qi 인증 탭', PLAN + ' §3.7 F1'],
    afterDecision: '체계가 정해지면 인증 화면에서 기준 등록이 열린다. 기준 문구 입력은 담당자 몫(원문 대조).',
    owner: '의료질관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'qi.staffRoleModel',
    track: 'QUALITY',
    title: '질관리 전담 인력을 역할로 둘 것인가, 권한으로 줄 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      'QI 전담 역할이 없어 측정 입력은 관리자·간호사, 지표 정의는 관리자만 할 수 있다. 질관리실 직원은 지금 간호사나 관리자 계정을 빌려 쓴다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '원장 · 의료질관리실',
    options: [
      { value: 'NEW_ROLE', label: '역할 QI_STAFF 신설', effect: '코드 변경 — 역할 추가·메뉴·API 역할 전수 배선(15번째 역할).', enact: null },
      { value: 'PERMISSION_KEYS', label: '기존 역할에 질관리 권한 키를 부여', effect: '권한 관리 화면에서 사람별로 qi:* 권한을 준다(역할은 그대로).', enact: null },
    ],
    statusQuo: 'QI 전담 역할 없음 · qi:measure:write = 관리자·간호사 · 지표 정의 = 관리자.',
    verifyHow: ['`apps/api/src/modules/auth/rbac/permission.types.ts`'],
    afterDecision: 'NEW_ROLE 이면 역할 추가 개발·전수 배선, PERMISSION_KEYS 면 권한 부여 작업이 남는다.',
    owner: '의료질관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'safety.kopsTransmit',
    track: 'QUALITY',
    title: '환자안전보고학습시스템(KOPS)에 HIS 가 직접 보고할 것인가',
    layer: 'LICENSE_HOLDER',
    why:
      'HIS 에 KOPS 송신 코드가 없다. 화면은 "미구축 — 원내 기록만"을 말한다. 송신은 대외 발신이라 구현 + 설정(기본 OFF) + 승인 3조건이 필요하다.',
    legalReview: ['환자안전법 보고 의무·자율보고 범위(원문 확인 필요)', '보고 시 개인정보 비식별'],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 환자안전전담인력',
    options: [
      { value: 'MANUAL_EXTERNAL', label: 'KOPS 에 사람이 직접 보고(현행)', effect: 'HIS 는 원내 기록만. 보고 여부·일자는 사고 조치 내역에 사람이 적는다.', enact: null },
      { value: 'HIS_CHANNEL', label: 'HIS 송신 채널 구축', effect: '코드 변경 — 채널·비식별·승인 송신 개발 후 설정으로 켠다(그 전엔 LOCAL_RECORDED).', enact: null },
    ],
    statusQuo: 'KOPS 송신 없음 — 사고 상세가 "미구축 — 원내 기록만"을 표시. 2026-10-09 부터 전담인력이 KOPS 웹에 직접 보고한 접수번호·시각을 사고 건에 기록할 수 있다(MANUAL_REPORTED · 기관 접수는 시스템이 확인하지 않음). 자동 송신은 이 결정과 채널 구축 뒤.',
    verifyHow: ['/safety 사고 상세 KOPS 줄', 'shared `KOPS_REPORT_STATUS`'],
    afterDecision: 'HIS_CHANNEL 이면 채널 개발·설정 ON·승인 송신 절차가 남는다. 그 전엔 원내 기록만.',
    owner: '환자안전팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'qi.hiraIndicatorSet',
    track: 'QUALITY',
    title: '심평원 적정성 평가 중 어떤 항목을 원내에서 미리 산출할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '적정성 평가는 결과 원천이 등록되지 않아 화면이 산출 불가(available:false)로 말한다. 항목마다 자료 원천·산식이 다르고, 산식을 코드가 지어내면 안 된다.',
    legalReview: ['평가 항목별 세부 시행계획(원문 확인 필요)'],
    approvalPath: 'COMMITTEE',
    authority: '질향상위원회(QPS) · 보험심사',
    options: [
      { value: 'SELECT_ITEMS', label: '항목을 골라 지표 원장에 등록', effect: '고른 항목을 질 지표로 등록하고 산식 근거 문서를 첨부한다. 공급원은 항목별로 개발.', enact: null },
      { value: 'RESULT_ONLY', label: '공표 결과만 기록', effect: '심평원 결과 통보값을 측정 원장에 수기(출처 EXTERNAL)로 넣는다.', enact: null },
      { value: 'NONE', label: '다루지 않음(현행)', effect: '산출 불가 표시 유지.', enact: null },
    ],
    statusQuo: '2026-10-09 — `/qi/adequacy` 는 질 지표 원장에서 분류가 \'적정성 평가\'인 지표와 최신 측정(출처 함께)을 보인다 · 등재 0 이면 available:false. 측정 입력에서 \'외부 기관 통보 결과\'(출처 EXTERNAL · 통보 문서·번호 필수)를 고를 수 있다 — 두 선택지의 운영 경로가 열려 있고 어느 것을 할지가 이 결정이다.',
    verifyHow: ['`apps/api/src/modules/qi/qi.service.ts` getAdequacyIndicators'],
    afterDecision: 'SELECT_ITEMS 면 질 지표 화면에서 \'적정성 평가\' 분류로 항목을 등록(산식 근거 문서)하고 공급원은 항목별로 개발, RESULT_ONLY 면 통보 결과를 출처 \'외부 결과\'로 입력하는 운영이 남는다.',
    owner: '보험심사 · 의료질관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
