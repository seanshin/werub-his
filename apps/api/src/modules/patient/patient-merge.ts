/**
 * 🔴 환자 병합 — 모델마다 무엇을 하는가(2026-10-20 환자 목록 P2·P2b · `patients-list-refinement-2026-10.plan.md` §2.3·§2.4).
 *
 * 종전: 환자에 딸린 190 모델 중 6개만 옮겼다(진료·예약·입원·수납·조제·검사 결과) — 운영 중복 의심 175명 기준
 * 옮겨지는 560건 · 남는 약 19,000건(수술·영상·응급 내원·혈액형·항체·다제내성균·중환자실…). 병합 창은 "모든 진료기록 이관"이라 말했다.
 *
 * 이제 모델마다 정책을 정한다 — 명시 목록에 없는 모델은 MOVE 이고, **명시 목록이 데이터 모델과 어긋나면 가드가 실패한다**:
 *  - MOVE   : 대상 환자로 옮긴다(임상·업무 기록).
 *  - UNIQUE : 고유 제약이 있다 — 대상에 같은 키가 없을 때만 옮기고, 겹치면 원 기록에 남기고 건수를 말한다.
 *  - STAY   : 원 환자에 그대로 둔다 — 감사·열람 원장 · 서명본·발급본 · 덧붙이기 원장(여정·위치) · 해시 사슬 ·
 *             외부에 제출·보고된 것(청구·신고) · 마약류 원장. "그때 누구의 기록이었나"가 사실이고, 바꾸면 그 사실이 사라진다.
 *  - MANUAL : 자동으로 옮기지 않는다(포털 계정 — 로그인 신원이라 사람이 정한다). 원 기록에 남는다고 말한다.
 *  - BLOCK  : 활성인 것이 있으면 병합하지 않는다(법적 보존명령 — 옮긴 기록이 보존 범위 밖으로 빠진다 · append-only 트리거).
 *
 * 모델 목록은 Prisma 데이터 모델(`patientId` 스칼라 칸)에서 읽는다 — 손으로 적은 목록은 새 모델을 놓친다.
 * 고유 키는 데이터 모델의 unique 정의에서 읽는다(운영 실측 2026-10-20: 부분 유니크 인덱스 없음 · 환자 연결 UPDATE 트리거는 legal_holds 뿐).
 */
import { Prisma } from '@prisma/client';

export type MergePolicy = 'MOVE' | 'UNIQUE' | 'STAY' | 'MANUAL' | 'BLOCK';

const STAY = [
  // 감사·열람·접근 원장
  'PatientHistory', 'BreakTheGlassAccess', 'PortalAuditLog', 'PortalSession', 'PublicAccessLog', 'SmartAccessLog',
  'CertificateAuditLog', 'MedicationCheckLog', 'CdssLog', 'PatientIdentificationCheck', 'EligibilityCheck',
  // 서명본·발급본·해시 사슬
  'OrderSignLog', 'SignedDocument', 'SignedRecordVersion', 'BlockchainCertificate', 'IssuedDocument', 'Certificate',
  'MedicalRecordCopy', 'AiProposal',
  // 덧붙이기 원장(여정·위치·무선)
  'PatientJourneyEvent', 'PatientLocation', 'PatientLocToken', 'WifiPositionFix', 'WifiDeviceBinding',
  // 외부 제출·보고·발송
  'Claim', 'HiraClaimDocument', 'NotifiableDiseaseReport', 'AdverseReactionReport', 'HieExchange',
  'PatientMessage', 'PatientCommunicationLog', 'CrmCampaignLog', 'SurveyDispatch', 'QuestionnaireToken',
  // 법정·안전 원장
  'ControlledSubstanceLog', 'SafetyIncident',
  // 대화·음성 세션 원장
  'AgentSession', 'VoiceCommandSession',
] as const;

const UNIQUE = [
  'PatientRelation', 'PatientBloodTyping', 'VipPatient', 'PatientAiConsent', 'PediatricImmunization',
  'PatientFlag', 'ResearchSubject', 'PatientConsentCrm', 'RegistrationConsent',
] as const;

const MANUAL = ['PatientAccount'] as const;
const BLOCK = ['LegalHold'] as const;

/** 정책 — STAY·UNIQUE·MANUAL·BLOCK 은 명시 · 나머지 환자 연결 모델은 MOVE */
export function mergePolicyOf(model: string): MergePolicy {
  if ((BLOCK as readonly string[]).includes(model)) return 'BLOCK';
  if ((MANUAL as readonly string[]).includes(model)) return 'MANUAL';
  if ((UNIQUE as readonly string[]).includes(model)) return 'UNIQUE';
  if ((STAY as readonly string[]).includes(model)) return 'STAY';
  return 'MOVE';
}
export const MERGE_EXPLICIT_MODELS: readonly string[] = [...STAY, ...UNIQUE, ...MANUAL, ...BLOCK];

/** 남으면 차트에서 사라져 안전에 걸리는 기록 — 화면이 먼저 보이고 이름을 붙인다 */
export const MERGE_SAFETY_MODELS: Readonly<Record<string, string>> = {
  Allergy: '알레르기',
  AllergyAssessment: '알레르기 평가',
  ProblemList: '문제 목록',
  MedicationAdministration: '투약 기록',
  ConsentForm: '동의서',
  RegistrationConsent: '초진 동의',
  AdvanceDirective: '사전연명의료',
  PatientFlag: '환자 표식',
  IsolationPrecaution: '격리 지시',
  PatientBloodTyping: '혈액형',
  PatientAntibody: '항체',
  Vaccination: '예방접종',
  Surgery: '수술',
  ImagingResult: '영상 결과',
  EmergencyVisit: '응급 내원',
  IcuAdmission: '중환자실 입실',
  MdroRegistry: '다제내성균 등록',
  HaiCase: '의료관련감염',
  PediatricImmunization: '소아 예방접종',
  UniversalNursingNote: '간호기록',
  PreVisitVitals: '활력징후',
  LegalHold: '법적 보존명령',
  PatientAccount: '포털 계정',
};

/** `patientId` 스칼라 칸을 가진 모델 이름(데이터 모델에서 읽음) */
export function patientLinkedModels(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'patientId' && f.kind === 'scalar'))
    .map((m) => m.name);
}

/** UNIQUE 모델의 고유 키 중 patientId 가 든 것(데이터 모델 정의) */
export function uniqueKeyOf(model: string): string[] {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
  if (!m) return ['patientId'];
  if (m.fields.some((f) => f.name === 'patientId' && f.isUnique)) return ['patientId'];
  const k = (m.uniqueFields as string[][]).find((u) => u.includes('patientId'));
  return k ?? ['patientId'];
}

export const delegateOf = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

export interface MergeRecordCount {
  model: string;
  policy: MergePolicy;
  count: number;
  safetyLabel: string | null;
}
export interface MergeRecordSummary {
  /** 대상으로 옮겨지는 것(MOVE + UNIQUE 중 겹치지 않는 것) */
  moved: MergeRecordCount[];
  /** 원 기록에 남는 것(STAY·MANUAL·UNIQUE 겹침) */
  unmoved: MergeRecordCount[];
  /** 활성이라 병합을 막는 것(BLOCK) */
  blocking: MergeRecordCount[];
  /** 세다가 실패한 모델 — 모르는 것을 0 으로 말하지 않는다 */
  uncounted: string[];
  movedTotal: number;
  unmovedTotal: number;
}

type Delegate = {
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
  findMany?: (args: { where: Record<string, unknown>; select: Record<string, true> }) => Promise<Array<Record<string, unknown>>>;
  findFirst?: (args: { where: Record<string, unknown>; select: { id: true } }) => Promise<unknown>;
};
const delegate = (db: unknown, model: string) => (db as Record<string, Delegate | undefined>)[delegateOf(model)];

/** UNIQUE — 원 환자 행 중 대상에 같은 키가 있는 행(겹침)과 없는 행 */
export async function splitUniqueRows(db: unknown, model: string, sourceId: string, targetId: string): Promise<{ movable: string[]; colliding: string[] }> {
  const d = delegate(db, model);
  if (!d?.findMany || !d.findFirst) throw new Error(`no delegate ${model}`);
  const key = uniqueKeyOf(model).filter((k) => k !== 'patientId');
  const select: Record<string, true> = { id: true };
  for (const k of key) select[k] = true;
  const rows = await d.findMany({ where: { patientId: sourceId }, select });
  const movable: string[] = [];
  const colliding: string[] = [];
  for (const r of rows) {
    const where: Record<string, unknown> = { patientId: targetId };
    for (const k of key) where[k] = r[k];
    const hit = await d.findFirst({ where, select: { id: true } });
    (hit ? colliding : movable).push(r.id as string);
  }
  return { movable, colliding };
}

/** 원 환자(source)에 딸린 기록을 정책별로 센다 — 0 건은 뺀다 · 한 번에 15개씩 */
export async function countSourceRecords(db: unknown, sourceId: string, targetId: string): Promise<MergeRecordSummary> {
  const models = patientLinkedModels();
  const moved: MergeRecordCount[] = [];
  const unmoved: MergeRecordCount[] = [];
  const blocking: MergeRecordCount[] = [];
  const uncounted: string[] = [];
  for (let i = 0; i < models.length; i += 15) {
    const chunk = models.slice(i, i + 15);
    await Promise.all(chunk.map(async (model) => {
      const d = delegate(db, model);
      if (!d?.count) { uncounted.push(model); return; }
      const policy = mergePolicyOf(model);
      const safetyLabel = MERGE_SAFETY_MODELS[model] ?? null;
      try {
        if (policy === 'BLOCK') {
          // 활성 보존명령 = 해제 기록이 없는 것
          const c = await d.count({ where: { patientId: sourceId, release: { is: null } } });
          if (c > 0) blocking.push({ model, policy, count: c, safetyLabel });
          return;
        }
        const c = await d.count({ where: { patientId: sourceId } });
        if (!c) return;
        if (policy === 'MOVE') moved.push({ model, policy, count: c, safetyLabel });
        else if (policy === 'UNIQUE') {
          const { movable, colliding } = await splitUniqueRows(db, model, sourceId, targetId);
          if (movable.length) moved.push({ model, policy, count: movable.length, safetyLabel });
          if (colliding.length) unmoved.push({ model, policy, count: colliding.length, safetyLabel });
        } else unmoved.push({ model, policy, count: c, safetyLabel });
      } catch {
        uncounted.push(model);
      }
    }));
  }
  const order = (a: MergeRecordCount, b: MergeRecordCount) =>
    (b.safetyLabel ? 1 : 0) - (a.safetyLabel ? 1 : 0) || b.count - a.count || a.model.localeCompare(b.model);
  moved.sort(order); unmoved.sort(order); blocking.sort(order);
  return {
    moved, unmoved, blocking,
    uncounted: uncounted.sort(),
    movedTotal: moved.reduce((s, r) => s + r.count, 0),
    unmovedTotal: unmoved.reduce((s, r) => s + r.count, 0),
  };
}
