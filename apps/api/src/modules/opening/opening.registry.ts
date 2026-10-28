/**
 * 의료기관 **개원·운영 단계** 항목 정본 — 2026-08-28.
 * 계획서: `docs/01-plan/features/hospital-opening-operations.plan.md`
 *
 * 사람 지시: *"병원 개원 전, 개원 후 운영 단계의 흐름을 **실제 업무에서 사용되는
 * 이름과 흐름**으로 정리된 기능이 필요함."*
 *
 * 🔴 이 파일이 **하지 않는 것** 넷 — 어기면 화면이 거짓말을 한다.
 *
 * ① **상태를 갖지 않는다.** 항목이 기존 정본(go-live·결정 등록부·위원회 대장)에
 *    연결돼 있으면 상태는 **거기서 파생**한다. 여기 적으면 정본이 둘이 된다.
 *
 * ② **법령 조문·처리기한을 적지 않는다.** 항목의 *실무 명칭*(개설신고·요양기관 기호
 *    지정·마약류취급자 허가)은 업무에서 쓰는 말이라 안전하지만, "의료법 제OO조" 나
 *    "처리기한 O일" 은 내가 검증할 수 없다 — 지어내면 그것이 정책이 된다.
 *    근거는 **미기재가 기본**이고, 사람이 채운다(shared `decision-basis.ts` 3상).
 *
 * ③ **절대 날짜를 박지 않는다.** 개원일이 아직 없다. `dueBy` 는 상대 표현뿐이다.
 *
 * ④ 🔴 **이 목록은 전수가 아니다.** 기관 종별·지역·특례에 따라 달라진다
 *    (이 기관은 가상 국제병원이라 특례 적용 여부 자체가 사람 확인 사항이다).
 *    화면이 이 사실을 상시 표시한다 — 안 말하면 "이것만 하면 된다"로 읽힌다.
 */

/**
 * 🔴 **국가 축** — 개원 절차는 나라마다 다르다. 항목을 한 목록에 섞으면
 *    한국에서 UAE 항목이, UAE 에서 한국 항목이 "안 한 일"로 보인다.
 *
 * 🔴 **UAE 는 관할이 연방 하나가 아니다.** 두바이=DHA · 아부다비=DoH(TAMM) ·
 *    북부 에미리트(샤르자·아즈만·RAK·후자이라·UAQ)=MOHAP 로 갈린다.
 *    그래서 항목의 `authority` 를 하나로 못 박지 않고 **관할에 따라 다르다**고 적는다 —
 *    한 곳으로 단정하면 다른 에미리트에서 그대로 틀린 말이 된다.
 *
 * 🔴 **여기 적힌 것은 조사해서 확인한 항목 이름과 관할뿐이다.** 조문·수수료·처리기한은
 *    적지 않는다(내가 검증할 수 없고, 자주 바뀐다). 출처는 계획서에 URL 로 남긴다.
 */
export type CountryCode = 'KR' | 'AE';

export const COUNTRY_META: Record<CountryCode, { label: string; note: string }> = {
  KR: {
    label: '대한민국',
    note: '개설 신고·허가는 관할 보건소·시도, 청구 자격은 건보공단·심평원.',
  },
  AE: {
    label: 'UAE(아랍에미리트)',
    note: '🔴 관할이 에미리트별로 다르다 — 두바이 DHA · 아부다비 DoH(TAMM) · '
      + '북부 에미리트 MOHAP. 어느 관할인지 먼저 확정해야 아래 항목의 제출처가 정해진다.',
  },
};

export const COUNTRY_ORDER: CountryCode[] = ['KR', 'AE'];

/** 기본 국가 — 설정(`hospital.country`)이 없을 때. 🔴 지어내지 않고 명시한다 */
export const DEFAULT_COUNTRY: CountryCode = 'KR';

export function isCountryCode(v: unknown): v is CountryCode {
  return typeof v === 'string' && (COUNTRY_ORDER as string[]).includes(v);
}

export type OpeningPhase =
  | 'O1_FACILITY' | 'O2_LICENSE' | 'O3_INSURANCE' | 'O4_WORKFORCE'
  | 'O5_GOVERNANCE' | 'O6_SYSTEM' | 'O7_REHEARSAL'
  | 'O8_OPENING'
  | 'O9_POST' | 'O10_RECURRING' | 'O11_ACCREDITATION';

export const PHASE_ORDER: OpeningPhase[] = [
  'O1_FACILITY', 'O2_LICENSE', 'O3_INSURANCE', 'O4_WORKFORCE',
  'O5_GOVERNANCE', 'O6_SYSTEM', 'O7_REHEARSAL',
  'O8_OPENING',
  'O9_POST', 'O10_RECURRING', 'O11_ACCREDITATION',
];

/** 🔴 단계 묶음 — 개원 전/개원/개원 후. 화면이 이 순서로 읽힌다 */
export const PHASE_STAGE: Record<OpeningPhase, 'BEFORE' | 'AT' | 'AFTER'> = {
  O1_FACILITY: 'BEFORE', O2_LICENSE: 'BEFORE', O3_INSURANCE: 'BEFORE',
  O4_WORKFORCE: 'BEFORE', O5_GOVERNANCE: 'BEFORE', O6_SYSTEM: 'BEFORE',
  O7_REHEARSAL: 'BEFORE',
  O8_OPENING: 'AT',
  O9_POST: 'AFTER', O10_RECURRING: 'AFTER', O11_ACCREDITATION: 'AFTER',
};

export const PHASE_LABEL: Record<OpeningPhase, string> = {
  O1_FACILITY: '설립·시설',
  O2_LICENSE: '인허가',
  O3_INSURANCE: '보험·청구 자격',
  O4_WORKFORCE: '인력·조직',
  O5_GOVERNANCE: '위원회·규정',
  O6_SYSTEM: '정보시스템 개시',
  O7_REHEARSAL: '시험운영',
  O8_OPENING: '개원',
  O9_POST: '개원 직후',
  O10_RECURRING: '정기 운영',
  O11_ACCREDITATION: '인증 준비',
};

export const PHASE_NOTE: Record<OpeningPhase, string> = {
  O1_FACILITY: '건물·시설 기준과 위탁 계약 — 개설 신고의 전제가 되는 것들',
  O2_LICENSE: '관청에 내는 신고·허가. 🔴 시스템이 대신 내지 않는다 — 사람이 내고 여기 기록한다',
  O3_INSURANCE: '청구할 수 있는 자격. 기호가 없으면 진료해도 청구가 안 된다',
  O4_WORKFORCE: '면허 확인과 법정 담당자 지정',
  O5_GOVERNANCE: '위원회를 만드는 것과 규정을 정하는 것',
  O6_SYSTEM: 'HIS 개시 준비 — 상세는 운영 전환 관제(/admin/go-live)가 정본이다',
  O7_REHEARSAL: '리허설 모드로 실제와 같이 돌려보는 단계',
  O8_OPENING: '개원일과 개시 확인',
  O9_POST: '개시 직후 확인 항목 — 🔴 기관이 정한다(기본 목록 없음)',
  O10_RECURRING: '주기로 반복되는 운영 의무',
  O11_ACCREDITATION: '의료기관 인증 — 시기는 기관이 정한다',
};

/** 언제까지 — 🔴 개원일이 없으므로 상대 표현만 */
export type OpeningDue = 'BEFORE_OPENING' | 'AT_OPENING' | 'AFTER_OPENING' | 'RECURRING';

export const DUE_LABEL: Record<OpeningDue, string> = {
  BEFORE_OPENING: '개원 전',
  AT_OPENING: '개원 시',
  AFTER_OPENING: '개원 후',
  RECURRING: '주기 반복',
};

export type OpeningCycle = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';

export const CYCLE_LABEL: Record<OpeningCycle, string> = {
  MONTHLY: '매월', QUARTERLY: '분기', SEMIANNUAL: '반기', ANNUAL: '매년',
};

/**
 * 🔴 **기관이 추가한 항목의 키 접두어.** 코드 레지스트리는 이 접두어를 쓰지 못한다
 *    (가드가 강제). 네임스페이스를 갈라 두어야 `OpeningTaskRecord` 하나에 둘을 담아도
 *    어느 쪽 항목인지 키만 보고 알 수 있다.
 */
export const INSTITUTION_KEY_PREFIX = 'inst.';

export function isOpeningPhase(v: unknown): v is OpeningPhase {
  return typeof v === 'string' && (PHASE_ORDER as string[]).includes(v);
}
export function isOpeningDue(v: unknown): v is OpeningDue {
  return typeof v === 'string' && ['BEFORE_OPENING', 'AT_OPENING', 'AFTER_OPENING', 'RECURRING'].includes(v);
}
export function isOpeningCycle(v: unknown): v is OpeningCycle {
  return typeof v === 'string' && ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].includes(v);
}

export interface OpeningTaskDef {
  phase: OpeningPhase;
  key: string;
  /**
   * 🔴 이 항목이 **어느 나라에서 필요한가.** 비워두지 않는다 —
   *    비면 "모든 나라"인지 "아직 안 정했는지" 구분되지 않는다(가드가 강제한다).
   */
  countries: CountryCode[];
  /** 🔴 **실무 명칭 그대로** — 전산 용어로 바꾸지 않는다 */
  title: string;
  /** 역할·부서(사람 이름 아님) */
  owner: string;
  /** 어디에 내는가 — 🔴 모르면 생략한다(빈 문자열로 아는 척하지 않는다) */
  authority?: string;
  /**
   * 기존 정본 연결 — 🔴 **최대 하나.** 있으면 상태를 여기서 파생하고 사람 기록을 받지 않는다.
   * 둘을 동시에 들면 어느 쪽이 정본인지 모른다(가드가 막는다).
   */
  goLiveKey?: string;
  decisionKey?: string;
  committeeCode?: string;
  /** 선행 관계 — 🔴 **막지 않는다.** 순서를 보여줄 뿐이다(막으면 사람이 우회한다) */
  dependsOn?: string[];
  dueBy: OpeningDue;
  /** 주기 항목만 */
  cycle?: OpeningCycle;
  note?: string;
}

/**
 * 🔴 **기본 목록**이다. 전수가 아니다.
 *    근거(법령 조문)는 **일부러 비워 뒀다** — 미기재는 미기재로 남기고 사람이 채운다.
 */
export const OPENING_REGISTRY: OpeningTaskDef[] = [
  // ── O1 설립·시설 ────────────────────────────────────────────
  { phase: 'O1_FACILITY', key: 'open.facility.standards', countries: ['KR', 'AE'], title: '시설 기준 적합 확인(병상·면적·필수 시설)', owner: '행정·시설', dueBy: 'BEFORE_OPENING' },
  { phase: 'O1_FACILITY', key: 'open.facility.fire', countries: ['KR', 'AE'], title: '소방시설 완비·완공검사', owner: '행정·시설', authority: '관할 소방서', dueBy: 'BEFORE_OPENING' },
  { phase: 'O1_FACILITY', key: 'open.facility.medwaste', countries: ['KR', 'AE'], title: '의료폐기물 처리 위탁계약', owner: '행정', dueBy: 'BEFORE_OPENING' },
  { phase: 'O1_FACILITY', key: 'open.facility.laundry', countries: ['KR', 'AE'], title: '세탁물 처리 위탁계약(또는 자체 처리 신고)', owner: '행정', dueBy: 'BEFORE_OPENING' },
  { phase: 'O1_FACILITY', key: 'open.facility.foodservice', countries: ['KR', 'AE'], title: '급식 운영 형태 확정(직영·위탁)', owner: '영양팀·행정', dueBy: 'BEFORE_OPENING', note: '확정 후 급양 모듈 운영 설정과 이어진다' },

  // ── O2 인허가 ──────────────────────────────────────────────
  { phase: 'O2_LICENSE', key: 'open.license.establish', countries: ['KR'], title: '의료기관 개설 신고·허가', owner: '행정', authority: '관할 보건소·시도', dependsOn: ['open.facility.standards'], dueBy: 'BEFORE_OPENING', note: '🔴 이 항목이 대부분의 후속을 연다 — 기호 지정·마약류·방사선이 모두 개설 완료를 전제한다' },
  { phase: 'O2_LICENSE', key: 'open.license.bizreg', countries: ['KR'], title: '사업자등록', owner: '재무·행정', authority: '관할 세무서', dueBy: 'BEFORE_OPENING' },
  { phase: 'O2_LICENSE', key: 'open.license.narcotics', countries: ['KR'], title: '마약류취급자 허가', owner: '약제', dependsOn: ['open.license.establish'], dueBy: 'BEFORE_OPENING', note: '마약류 통합관리시스템(NIMS) 보고와 이어진다 — 시스템 연동은 운영 전환 관제 integ.nimsKids' },
  { phase: 'O2_LICENSE', key: 'open.license.radiation', countries: ['KR'], title: '진단용 방사선 발생장치 신고·검사', owner: '영상의학과·행정', dependsOn: ['open.license.establish'], dueBy: 'BEFORE_OPENING' },

  // ── O3 보험·청구 자격 ───────────────────────────────────────
  { phase: 'O3_INSURANCE', key: 'open.insurance.nhisCode', countries: ['KR'], title: '요양기관 기호 지정(건강보험)', owner: '원무·보험', dependsOn: ['open.license.establish'], dueBy: 'BEFORE_OPENING', note: '🔴 기호가 없으면 진료해도 청구가 안 된다' },
  // 🔴 종별 확정 결정 하나가 기관 등급(`billing.institution.grade`)까지 정한다 —
  //    등급을 별도 항목으로 두면 같은 결정을 두 번 세게 된다.
  { phase: 'O3_INSURANCE', key: 'open.insurance.institutionType', countries: ['KR'], title: '요양기관 종별 확정(개설 허가와 일치 · 청구 단가 기준이 된다)', owner: '원무·보험', decisionKey: 'billing.institutionType', dueBy: 'BEFORE_OPENING' },
  { phase: 'O3_INSURANCE', key: 'open.insurance.medicaid', countries: ['KR'], title: '의료급여기관 지정', owner: '원무·보험', dependsOn: ['open.license.establish'], dueBy: 'BEFORE_OPENING' },
  { phase: 'O3_INSURANCE', key: 'open.insurance.autoIns', countries: ['KR'], title: '자동차보험 진료수가 청구 자격', owner: '원무·보험', dueBy: 'BEFORE_OPENING' },
  { phase: 'O3_INSURANCE', key: 'open.insurance.workComp', countries: ['KR'], title: '산재보험 의료기관 지정', owner: '원무·보험', dueBy: 'BEFORE_OPENING' },
  { phase: 'O3_INSURANCE', key: 'open.insurance.hiraEdi', countries: ['KR'], title: '심평원 EDI 청구 개통', owner: '원무·심사', goLiveKey: 'integ.hiraSubmit', dependsOn: ['open.insurance.nhisCode'], dueBy: 'BEFORE_OPENING' },

  // ── O4 인력·조직 ───────────────────────────────────────────
  { phase: 'O4_WORKFORCE', key: 'open.workforce.licenses', countries: ['KR', 'AE'], title: '의료인·의료기사 면허 확인', owner: '인사', dueBy: 'BEFORE_OPENING' },
  { phase: 'O4_WORKFORCE', key: 'open.workforce.infectionOfficer', countries: ['KR', 'AE'], title: '감염관리 담당자 지정', owner: '간호부·감염관리실', dueBy: 'BEFORE_OPENING' },
  { phase: 'O4_WORKFORCE', key: 'open.workforce.cpo', countries: ['KR', 'AE'], title: '개인정보보호책임자(CPO) 지정', owner: '경영진', dueBy: 'BEFORE_OPENING' },
  { phase: 'O4_WORKFORCE', key: 'open.workforce.safetyOfficer', countries: ['KR', 'AE'], title: '안전보건 관리책임자 지정', owner: '행정', dueBy: 'BEFORE_OPENING' },
  { phase: 'O4_WORKFORCE', key: 'open.workforce.patientSafety', countries: ['KR', 'AE'], title: '환자안전 전담인력 지정', owner: '질향상팀', dueBy: 'BEFORE_OPENING' },

  // ── O5 위원회·규정 ─────────────────────────────────────────
  { phase: 'O5_GOVERNANCE', key: 'open.gov.committee.IC', countries: ['KR', 'AE'], title: '감염관리위원회 구성', owner: '감염관리실', committeeCode: 'IC', dueBy: 'BEFORE_OPENING' },
  { phase: 'O5_GOVERNANCE', key: 'open.gov.committee.QPS', countries: ['KR', 'AE'], title: '질향상·환자안전위원회 구성', owner: '질향상팀', committeeCode: 'QPS', dueBy: 'BEFORE_OPENING' },
  { phase: 'O5_GOVERNANCE', key: 'open.gov.committee.DTC', countries: ['KR', 'AE'], title: '약사위원회 구성', owner: '약제', committeeCode: 'DTC', dueBy: 'BEFORE_OPENING' },
  { phase: 'O5_GOVERNANCE', key: 'open.gov.committee.TRF', countries: ['KR', 'AE'], title: '수혈위원회 구성', owner: '진단검사의학과', committeeCode: 'TRF', dueBy: 'BEFORE_OPENING' },
  { phase: 'O5_GOVERNANCE', key: 'open.gov.committee.MRC', countries: ['KR', 'AE'], title: '의무기록위원회 구성', owner: '의무기록팀', committeeCode: 'MRC', dueBy: 'BEFORE_OPENING' },
  { phase: 'O5_GOVERNANCE', key: 'open.gov.committee.ETH', countries: ['KR', 'AE'], title: '병원윤리위원회 구성', owner: '경영진', committeeCode: 'ETH', dueBy: 'BEFORE_OPENING' },
  { phase: 'O5_GOVERNANCE', key: 'open.gov.committee.OPS', countries: ['KR', 'AE'], title: '운영위원회 구성', owner: '경영진', committeeCode: 'OPS', dueBy: 'BEFORE_OPENING' },
  { phase: 'O5_GOVERNANCE', key: 'open.gov.charter', countries: ['KR', 'AE'], title: '위원회 규정(charter) 제정', owner: '경영진', dueBy: 'BEFORE_OPENING', note: '위원회 관리 화면(/admin/governance)에서 위원회별로 등록한다' },
  { phase: 'O5_GOVERNANCE', key: 'open.gov.policies', countries: ['KR', 'AE'], title: '원내 규정·지침 제정', owner: '경영진·각 부서', dueBy: 'BEFORE_OPENING' },

  // ── O6 정보시스템 개시 (🔴 연결만 — Go-Live 항목을 복제하지 않고 수도 적지 않는다 · 가드 test/opening/golive-count-single-canon.spec.ts) ──
  { phase: 'O6_SYSTEM', key: 'open.system.hospitalInfo', countries: ['KR'], title: '기관 기본정보 확정(기호·사업자번호·대표자·주소)', owner: '원무', goLiveKey: 'data.hospitalInfo', dependsOn: ['open.insurance.nhisCode', 'open.license.bizreg'], dueBy: 'BEFORE_OPENING' },
  { phase: 'O6_SYSTEM', key: 'open.system.goLive', countries: ['KR', 'AE'], title: '정보시스템 개시 준비 전체', owner: '전산', dueBy: 'BEFORE_OPENING', note: '🔴 상세 항목과 그 수는 운영 전환 관제(/admin/go-live · GO_LIVE_REGISTRY)가 정본이다 — 여기서는 세지 않는다' },
  { phase: 'O6_SYSTEM', key: 'open.system.realMode', countries: ['KR', 'AE'], title: '운영 모드 REAL 전환(시드 로그인 노출 종료)', owner: '전산', goLiveKey: 'security.hisMode', dueBy: 'AT_OPENING' },
  { phase: 'O6_SYSTEM', key: 'open.system.seedPurge', countries: ['KR', 'AE'], title: '데모·시드 데이터 정리', owner: '전산', goLiveKey: 'flag.demoSeedPurge', dueBy: 'AT_OPENING', note: '🔴 실환자 이관 전에 가상 병원 시드를 제거하거나 격리한다' },
  { phase: 'O6_SYSTEM', key: 'open.system.backup', countries: ['KR', 'AE'], title: '정기 DB 백업 실행 확인', owner: '전산', goLiveKey: 'security.dbBackup', dueBy: 'BEFORE_OPENING' },

  // ── O7 시험운영 ────────────────────────────────────────────
  { phase: 'O7_REHEARSAL', key: 'open.rehearsal.run', countries: ['KR', 'AE'], title: '리허설 운영(실제와 같은 흐름으로 돌려본다)', owner: '전 부서', dueBy: 'BEFORE_OPENING', note: '운영 모드 정본: docs/05-reference/operating-modes.md' },
  { phase: 'O7_REHEARSAL', key: 'open.rehearsal.review', countries: ['KR', 'AE'], title: '리허설 결과 검토·보완 사항 확정', owner: '운영위원회', committeeCode: 'OPS', dueBy: 'BEFORE_OPENING' },

  // ── O8 개원 ───────────────────────────────────────────────
  { phase: 'O8_OPENING', key: 'open.opening.date', countries: ['KR', 'AE'], title: '개원일 확정', owner: '경영진', dueBy: 'AT_OPENING', note: '🔴 확정 전까지 이 시스템은 어떤 절대 날짜도 계산에 쓰지 않는다' },
  { phase: 'O8_OPENING', key: 'open.opening.confirm', countries: ['KR', 'AE'], title: '개원 개시 확인(진료·청구 실왕복 1건)', owner: '원무·진료부', dueBy: 'AT_OPENING', note: '🔴 "설정을 켰다"가 아니라 "실제로 한 바퀴 돌았다"를 확인한다' },

  // ── O10 정기 운영 (O9 는 기본 목록 없음 — 기관이 정한다) ──────
  { phase: 'O10_RECURRING', key: 'open.recurring.committeeMeetings', countries: ['KR', 'AE'], title: '위원회 정기 회의 개최', owner: '각 위원회 간사', dueBy: 'RECURRING', cycle: 'MONTHLY', note: '위원회마다 주기가 다르다 — 준수는 위원회 대장에서 파생한다' },
  { phase: 'O10_RECURRING', key: 'open.recurring.qiReport', countries: ['KR', 'AE'], title: '질 향상·환자안전 활동 보고', owner: '질향상팀', committeeCode: 'QPS', dueBy: 'RECURRING', cycle: 'QUARTERLY' },
  { phase: 'O10_RECURRING', key: 'open.recurring.infectionReport', countries: ['KR', 'AE'], title: '감염관리 활동 보고', owner: '감염관리실', committeeCode: 'IC', dueBy: 'RECURRING', cycle: 'QUARTERLY' },
  { phase: 'O10_RECURRING', key: 'open.recurring.radiationCheck', countries: ['KR'], title: '진단용 방사선 발생장치 정기 검사', owner: '영상의학과', dueBy: 'RECURRING', cycle: 'ANNUAL', dependsOn: ['open.license.radiation'] },
  { phase: 'O10_RECURRING', key: 'open.recurring.staffEducation', countries: ['KR', 'AE'], title: '직원 법정 교육 실시', owner: '인사·교육', dueBy: 'RECURRING', cycle: 'ANNUAL', note: '교육 종류·주기는 기관이 확정한다 — 여기서 목록을 지어내지 않는다' },

  // ── O11 인증 준비 ──────────────────────────────────────────
  { phase: 'O11_ACCREDITATION', key: 'open.accred.plan', countries: ['KR', 'AE'], title: '의료기관 인증 신청 시기 결정', owner: '경영진·질향상팀', dueBy: 'AFTER_OPENING', note: '시기는 기관이 정한다 — 시스템이 기한을 만들지 않는다' },
  { phase: 'O11_ACCREDITATION', key: 'open.accred.selfCheck', countries: ['KR', 'AE'], title: '인증 기준 자체 점검', owner: '질향상팀', committeeCode: 'QPS', dueBy: 'AFTER_OPENING' },
  // ══════════════════════════════════════════════════════════════════
  //  UAE — 2026-08-28 조사 반영. 출처 URL 은 계획서
  //  `docs/01-plan/features/hospital-opening-operations.plan.md` §7 에 있다.
  //
  //  🔴 **관할부터 정한다.** 두바이 DHA · 아부다비 DoH(TAMM) · 북부 MOHAP 로 갈리고,
  //     제출처·연동 대상(HIE·청구)이 관할에 따라 **다른 시스템**이다.
  //  🔴 여기 없는 것이 없는 게 아니다 — 확인한 것만 적었다(의료폐기물·세탁물 등
  //     한국 항목과 대응하는 UAE 규정은 확인하지 못해 적지 않았다).
  // ══════════════════════════════════════════════════════════════════
  { phase: 'O1_FACILITY', key: 'open.ae.jurisdiction', countries: ['AE'], title: '관할 보건당국 확정(DHA · DoH · MOHAP)', owner: '경영진·행정', dueBy: 'BEFORE_OPENING', note: '🔴 이것이 먼저다 — 소재 에미리트에 따라 면허 발급처·HIE·청구 시스템이 전부 달라진다.' },
  { phase: 'O1_FACILITY', key: 'open.ae.tradeLicense', countries: ['AE'], title: '상업 면허(trade license)·소유/임대 서류', owner: '행정', dueBy: 'BEFORE_OPENING' },
  { phase: 'O1_FACILITY', key: 'open.ae.drawings', countries: ['AE'], title: '시설 도면 사전 승인', owner: '행정·시설', authority: '관할 보건당국', dependsOn: ['open.ae.jurisdiction'], dueBy: 'BEFORE_OPENING' },

  { phase: 'O2_LICENSE', key: 'open.ae.facilityLicense', countries: ['AE'], title: '보건의료시설 면허(health facility licence)', owner: '행정', authority: '관할 보건당국(DHA · DoH · MOHAP)', dependsOn: ['open.ae.jurisdiction', 'open.ae.drawings'], dueBy: 'BEFORE_OPENING' },
  { phase: 'O2_LICENSE', key: 'open.ae.inspections', countries: ['AE'], title: '초기·최종 실사 통과', owner: '행정·시설', authority: '관할 보건당국', dependsOn: ['open.ae.facilityLicense'], dueBy: 'BEFORE_OPENING', note: '면허 절차에 실사가 두 번 있다 — 도면 승인 뒤 초기, 개원 직전 최종.' },
  { phase: 'O2_LICENSE', key: 'open.ae.fanr', countries: ['AE'], title: 'FANR 방사선 취급 면허(Practice Licence)', owner: '영상의학과·행정', authority: 'FANR(연방원자력규제청)', dueBy: 'BEFORE_OPENING', note: '🔴 관할 보건당국이 아니라 **연방 FANR** 소관이다 — 에미리트와 무관하게 별도로 받는다.' },
  { phase: 'O2_LICENSE', key: 'open.ae.rpo', countries: ['AE'], title: '방사선방호책임자(RPO) 지정·방사선방호프로그램(RPP)', owner: '영상의학과', dependsOn: ['open.ae.fanr'], dueBy: 'BEFORE_OPENING' },

  { phase: 'O3_INSURANCE', key: 'open.ae.eclaim', countries: ['AE'], title: '보험 청구 개통(e-Claim)', owner: '원무·보험', authority: '관할에 따라 다름 — 두바이 e-Claim(DHPO) · 아부다비 Shafafiya', dependsOn: ['open.ae.jurisdiction', 'open.ae.facilityLicense'], dueBy: 'BEFORE_OPENING', note: '🔴 청구 채널이 관할마다 다른 시스템이다. 하나로 묶어 생각하면 개통이 안 된다.' },

  { phase: 'O4_WORKFORCE', key: 'open.ae.staffLicenses', countries: ['AE'], title: '의료인·의료기사 관할 면허 취득', owner: '인사', authority: '관할 보건당국(DHA · DoH · MOHAP)', dependsOn: ['open.ae.jurisdiction'], dueBy: 'BEFORE_OPENING', note: '기관 면허와 별개로 **개인 면허**가 관할청에서 나온다.' },
  { phase: 'O4_WORKFORCE', key: 'open.ae.narcoticInCharge', countries: ['AE'], title: '마약류 담당자(Narcotic in-charge) 지정', owner: '약제', dueBy: 'BEFORE_OPENING', note: '정기 소비 보고의 제출 주체다(O10 참조).' },

  { phase: 'O6_SYSTEM', key: 'open.ae.hospitalInfo', countries: ['AE'], title: '기관 기본정보 확정(면허번호·상업면허·대표자·주소)', owner: '행정', goLiveKey: 'data.hospitalInfo', dependsOn: ['open.ae.facilityLicense', 'open.ae.tradeLicense'], dueBy: 'BEFORE_OPENING', note: '🔴 한국 항목과 **다른 값**이 들어간다 — 요양기관 기호·사업자등록번호가 아니라 보건당국 면허번호·상업 면허다.' },
  { phase: 'O6_SYSTEM', key: 'open.ae.hie', countries: ['AE'], title: '보건정보교류(HIE) 연동 — NABIDH · Malaffi · Riayati', owner: '전산', authority: '관할에 따라 다름 — 두바이 NABIDH · 아부다비 Malaffi · 북부/연방 Riayati', dependsOn: ['open.ae.jurisdiction'], dueBy: 'BEFORE_OPENING', note: '🔴 EMR 연동이 **면허 조건**으로 요구된다 — 개원 후 과제가 아니다.' },
  { phase: 'O6_SYSTEM', key: 'open.ae.tatmeen', countries: ['AE'], title: '의약품 추적(Tatmeen) 연동', owner: '약제·전산', authority: 'MOHAP', dueBy: 'BEFORE_OPENING', note: '의약품 공급망 추적 국가 플랫폼.' },

  { phase: 'O10_RECURRING', key: 'open.ae.narcoticReport', countries: ['AE'], title: '통제약 소비 보고(월간)', owner: '약제', dueBy: 'RECURRING', cycle: 'MONTHLY', dependsOn: ['open.ae.narcoticInCharge'] },
  { phase: 'O10_RECURRING', key: 'open.ae.narcoticReportQ', countries: ['AE'], title: '마약류 소비 보고(분기)', owner: '약제', dueBy: 'RECURRING', cycle: 'QUARTERLY', dependsOn: ['open.ae.narcoticInCharge'], note: '🔴 통제약은 월간, 마약류는 분기 — 주기가 다르다.' },
];

/** 🔴 화면이 상시 보여줘야 하는 사실 — 안 말하면 "이것만 하면 된다"로 읽힌다 */
export const REGISTRY_CAVEAT =
  '이 목록은 기본 목록이며 전수가 아니다. 기관 종별·지역·특례에 따라 달라지므로 '
  + '기관이 확정해야 하고, 법령 근거는 비어 있다(사람이 확인해 채운다).';
