import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { configEnvOverride } from '../../common/config-env-overrides';
import { DECISION_REGISTRY } from '../decision-registry/decision.registry';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AUTO_ENACT_KINDS, GovernanceEnactmentService, surfaceKeyOf } from './governance-enactment.service';
import {
  checkChosenOption, readOptions, isSpecialChoice, readBasis,
  type ChosenOption, type BasisState,
  COMMITTEE_AUTHORITIES, committeeMayDecide, decisionCommitteeOf,
  OPEN_AGENDA_STATUSES,
} from '@hospital-run/shared';
import { committeeResolutionRecord } from '../decision-registry/committee-resolution-record';
import { COMMITTEE_RECORDED_EVENT } from '../decision-registry/decision-engine.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * 🔴 선택 검증 실패 사유 — 어휘는 shared 정본이 정하고, 여기서는 **사람 말로 옮기기만** 한다.
 *    (미등재 코드는 그대로 노출한다 — 사유를 지어내지 않는다)
 */
const CHOICE_ERROR_TEXT: Record<string, string> = {
  CHOICE_REQUIRED: '이 안건은 선택지가 있습니다 — 어느 안으로 의결했는지 고르세요(산문만으로는 어느 안인지 남지 않습니다).',
  UNKNOWN_CHOICE: '안건 선택지에 없는 값입니다.',
  SNAPSHOT_REQUIRED: '고른 시점의 선택지 전문(스냅샷)이 필요합니다 — 안건이 나중에 개정되어도 무엇을 보고 골랐는지가 근거입니다.',
  SNAPSHOT_MISMATCH: '보낸 선택지 스냅샷이 안건의 선택지와 다릅니다 — 안건을 다시 불러오세요.',
  NOTE_REQUIRED: '원안 수정·선택지 밖 의결은 무엇을 어떻게 정했는지 사유가 필요합니다.',
};
import { NotificationService } from '../notification/notification.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { classifyGateEntry, gateMode } from '../../common/gate-mode';
import { enforceGate } from '../../common/gate-enforce';
import { SignIntegrationService } from '../sign-integration/sign-integration.service';
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { GOVERNANCE_STREAM } from './gld.service';
import { createHash } from 'crypto';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';
import { aiDisabledException, isAiServerEnabled } from '../../common/util/ai-kill-switch';

/**
 * 위원회 거버넌스 엔진 P0-b — 대장(기록) 층 (2026-08-04).
 * 기획 정본: docs/01-plan/features/committee-governance-engine.plan.md
 *
 * 이 단계의 범위는 **기록**이다: 안건 파이프라인 → 의결(정족수·표결·GOV-번호) → 집행 항목(MANUAL 만).
 * 자동 집행(CONFIG/GATE …)은 P1 엔진 — 여기서는 절대 시스템 값을 바꾸지 않는다(D2 준비 단계).
 */

/** 위원회 시드 9종(D9 — 기존 Committee 확장·code upsert) */
const COMMITTEE_SEED: { code: string; name: string; type: string; quorum: number; meetingCycle: string }[] = [
  { code: 'DTC', name: '약사위원회', type: 'PHARMACY', quorum: 5, meetingCycle: 'MONTHLY' },
  { code: 'IC', name: '감염관리위원회', type: 'INFECTION', quorum: 5, meetingCycle: 'MONTHLY' },
  { code: 'MRC', name: '의무기록위원회', type: 'MEDICAL', quorum: 4, meetingCycle: 'QUARTERLY' },
  { code: 'QPS', name: '질향상·환자안전위원회', type: 'QUALITY', quorum: 5, meetingCycle: 'MONTHLY' },
  { code: 'TRF', name: '수혈위원회', type: 'SAFETY', quorum: 4, meetingCycle: 'QUARTERLY' },
  { code: 'ETH', name: '병원윤리위원회', type: 'ETHICS', quorum: 5, meetingCycle: 'AD_HOC' },
  { code: 'NUT', name: '영양위원회', type: 'MEDICAL', quorum: 3, meetingCycle: 'QUARTERLY' },
  { code: 'SAFE', name: '안전관리위원회', type: 'SAFETY', quorum: 4, meetingCycle: 'QUARTERLY' },
  { code: 'OPS', name: '운영위원회', type: 'ADMIN', quorum: 4, meetingCycle: 'MONTHLY' },
];

/**
 * 표면 담당 매핑 시드(D14) — go-live.registry 의 owner 선언을 위원회 code 로 이관.
 * registry 원 표기는 note 에 보존. 등재 안 된 표면은 매핑 없음(강제 아님).
 */
const SURFACE_SEED: { surfaceKey: string; committee: string; note: string }[] = [
  /**
   * 🔴 P1-b (2026-08-28) — **근거 없이 동작 중이던 정책성 설정 21건의 담당을 등재한다.**
   *
   * 실측: 정책성(게이트형) 키 36개 중 27개가 담당도 결정 근거도 없었다. 소비처를 하나씩 읽어
   * 성격을 가르니 **21개가 결정 사안**이고 6개는 아니었다(보안 강제 3 · 운영 편의 3).
   *
   * 🔴 담당 등재는 **결정이 아니다.** 등재하면 그 표면이 `거버넌스 미등재` 에서
   *    **`의결 근거 없음`** 으로 바뀌어 화면에 드러난다 — 그것이 목적이다.
   *    (누가 정할 것인지가 정해져야 위원회가 안건으로 올릴 수 있다)
   */
  // ── 임상 안전 게이트 4 — 게이트 모드가 환자 안전을 직접 정한다
  { surfaceKey: 'config:nursing.bcma.enforce', committee: 'QPS', note: 'P1-b 판정 — 투약 바코드 확인(현재 WARN). 승격 여부는 환자안전위원회' },
  { surfaceKey: 'config:bloodBank.bedsideScan.enforce', committee: 'TRF', note: 'P1-b 판정 — 수혈 전 베드사이드 확인(IPSG.1)' },
  { surfaceKey: 'config:surgery.preAnesthesiaGate', committee: 'QPS', note: 'P1-b 판정 — 마취 전 평가 게이트' },
  { surfaceKey: 'config:inpatient.dischargeGate', committee: 'QPS', note: 'P1-b 판정 — 퇴원 게이트' },
  // ── AI 임상 기능 6 — 🔴 허가권자 선행 결정(legal.ai.deviceClassification·legal.phiBoundary.gpuTier)에 종속
  { surfaceKey: 'config:ai.server.enabled', committee: 'QPS', note: 'P1-b 판정 — AI 서버 사용 마스터. 🔴 AI 의료기기 해당 여부(허가권자)에 종속' },
  { surfaceKey: 'config:scribe.enabled', committee: 'QPS', note: 'P1-b 판정 — 앰비언트 스크라이브' },
  { surfaceKey: 'config:voiceEmr.enabled', committee: 'QPS', note: 'P1-b 판정 — 음성 EMR' },
  { surfaceKey: 'config:voiceEmr.ambient.enabled', committee: 'QPS', note: '🔴 P1-b 판정 — **진료 원음 수집**. 기관 차원 적법근거(legal.voiceRecording.basis)가 선행' },
  { surfaceKey: 'config:voiceEmr.ambient.aiDraft.enabled', committee: 'QPS', note: 'P1-b 판정 — 원음에서 AI 초안 생성' },
  { surfaceKey: 'config:nursing.aiAssist.enabled', committee: 'QPS', note: 'P1-b 판정 — 간호 AI 보조(임상 초안)' },
  // ── 기록 문서 전자결재 4 (전부 OFF)
  { surfaceKey: 'config:approval.clinicalNote.enabled', committee: 'MRC', note: 'P1-b 판정 — 기록지 결재 게이트' },
  { surfaceKey: 'config:approval.clinicalCertificate.enabled', committee: 'MRC', note: 'P1-b 판정 — 진단서 결재' },
  { surfaceKey: 'config:approval.consent.enabled', committee: 'MRC', note: 'P1-b 판정 — 동의서 결재(template:consent 와 같은 축)' },
  { surfaceKey: 'config:approval.recordCopy.enabled', committee: 'MRC', note: 'P1-b 판정 — 기록 사본 발급 결재' },
  // ── 대외 전송 3 + 수신 1 — 대외 발신 3조건 축
  { surfaceKey: 'config:pacs.exportEnabled', committee: 'OPS', note: '🔴 P1-b 판정 — 영상 반출(개인정보 제3자 제공 성격)' },
  { surfaceKey: 'config:erp.webhookEnabled', committee: 'OPS', note: 'P1-b 판정 — 재무 데이터 외부 전송' },
  { surfaceKey: 'config:ess.payrollRelay.enabled', committee: 'OPS', note: 'P1-b 판정 — 급여 중계(인사·재무)' },
  { surfaceKey: 'config:fhir.serviceRequestInbound.enabled', committee: 'OPS', note: 'P1-b 판정 — 외부 기관 오더 수신' },
  // ── 청구 2 · 사업 1
  { surfaceKey: 'config:billing.copayCap.preCoverageEnabled', committee: 'OPS', note: 'P1-b 판정 — 본인부담상한 사전급여 적용' },
  { surfaceKey: 'config:inpatient.stayBilling.enabled', committee: 'OPS', note: 'P1-b 판정 — 입원료 자동 청구' },
  { surfaceKey: 'config:blockchain.selfIssuanceEnabled', committee: 'OPS', note: 'P1-b 판정 — 검진권 자체 발행(사업 정책)' },

  { surfaceKey: 'config:dur.enforce', committee: 'DTC', note: 'go-live owner: 진료부·약제' },
  { surfaceKey: 'config:pharmacy.durGate.enforce', committee: 'DTC', note: 'go-live owner: 약제' },
  { surfaceKey: 'config:formulary.enforce', committee: 'DTC', note: 'go-live owner: 약제위' },
  { surfaceKey: 'master:dur-rules', committee: 'DTC', note: 'P0-a① DurRule 테이블 — /api/v1/dur/rules' },
  { surfaceKey: 'config:cdss.enforce', committee: 'QPS', note: 'go-live owner: 진료부' },
  { surfaceKey: 'config:clinical.vitals.thresholds', committee: 'QPS', note: 'P0-a③ 활력 임계 오버라이드' },
  { surfaceKey: 'master:reference-range', committee: 'QPS', note: 'P0-a② 위급값 포함 기준치 — 진단검사 협의' },
  { surfaceKey: 'master:isolation-protocol', committee: 'IC', note: 'P0-a④ 격리 프로토콜 — PUT /infection-control/protocols/:type' },
  { surfaceKey: 'config:imaging.contrastEnforce', committee: 'SAFE', note: 'go-live owner: 영상의학과' },
  { surfaceKey: 'config:imaging.pregnancyEnforce', committee: 'SAFE', note: 'go-live owner: 영상의학과' },
  { surfaceKey: 'config:bloodbank.issueEnforce', committee: 'TRF', note: '수혈 출고 게이트' },
  { surfaceKey: 'config:bloodbank.inventoryMin', committee: 'TRF', note: '혈액 재고 임계' },
  { surfaceKey: 'config:psychiatry.ectConsentEnforce', committee: 'ETH', note: 'go-live owner: 정신과 — 동의 게이트' },
  { surfaceKey: 'config:inventory.expiryIssueEnforce', committee: 'OPS', note: 'go-live owner: 물류' },
  { surfaceKey: 'template:consent', committee: 'MRC', note: '동의서 템플릿 개정' },
  { surfaceKey: 'config:encounter.requireDiagnosisOnSign', committee: 'MRC', note: '서명 시 상병 필수' },
  // P3 §7 P1 표면화 — qi.targets 그룹(QPS 재량 목표값)
  { surfaceKey: 'config:qi.targets.doorToTriage', committee: 'QPS', note: 'KTAS 도착→트리아지 목표(흐름 분석 위반율 기준)' },
  { surfaceKey: 'config:qi.targets.ktasReassessMin', committee: 'QPS', note: 'KTAS 재평가 목표 간격(응급 관제·베드 보드 지연 판정 공유)' },
  // ER 베드 보드 P1(2026-08-05) — 운영 정책 표면
  { surfaceKey: 'config:er.cleaning.slaMinutes', committee: 'OPS', note: 'ER 베드 청소 SLA(분) — 초과 시 보드 지연 표시' },
  { surfaceKey: 'config:er.boarding.warnMinutes', committee: 'OPS', note: 'ER 입원대기(boarding) 경고 기준(분)' },
  { surfaceKey: 'config:er.reception.separated', committee: 'OPS', note: '응급 원무(접수 전용) 분리 운영 여부(D10)' },
  { surfaceKey: 'config:er.registration.guardianGate', committee: 'SAFE', note: '응급 접수 보호자 등록 게이트(WARN/OFF — BLOCK 없음·진료 우선)' },
  { surfaceKey: 'config:er.bedDisplay.nameMasking', committee: 'SAFE', note: 'ER 베드사이드 디스플레이 환자명 마스킹(개인정보 정책)' },
  { surfaceKey: 'config:er.bedDisplay.fields', committee: 'OPS', note: 'ER 베드사이드 디스플레이 표시 필드(MAP)' },
  { surfaceKey: 'config:er.reassessNotify.enabled', committee: 'QPS', note: 'ER 재평가 지연 담당의 알림 크론(기본 OFF)' },
  { surfaceKey: 'config:qi.targets.nedocsBounds', committee: 'QPS', note: 'NEDOCS 과밀 등급 경계(산식 계수는 Weiss 표준·불변)' },
  { surfaceKey: 'config:qi.targets.opdWaitMinutes', committee: 'QPS', note: '외래 접수→진료 대기 목표' },
  { surfaceKey: 'config:qi.targets.cashierWaitMinutes', committee: 'QPS', note: '접수→호출 대기 목표' },
  // 의료질관리 흐름(QI-FLOW-001 · 2026-10-08) — 화면은 값을 바꾸지 않고 안건으로 올린다
  { surfaceKey: 'config:qi.autoMeasure.enabled', committee: 'QPS', note: '질 지표 월 마감 자동 산출 ON/OFF' },
  { surfaceKey: 'config:qi.autoMeasure.incidentDenominator', committee: 'QPS', note: '사고율 분모(재원일수·입원 건수)' },
  { surfaceKey: 'config:qi.deviceDays.source', committee: 'IC', note: '기구일수 원천(수기·원장·산출 안 함)' },
  { surfaceKey: 'config:safety.poa.required', committee: 'MRC', note: '퇴원요약 서명 전 진단별 POA 필수 여부(결정 safety.poaFlag)' },
  // 결정 등록부 배치 10-F(2026-10-10) — 위원회 몫 설정
  { surfaceKey: 'config:qi.docIssuance.slaHours', committee: 'MRC', note: '서류 발급 처리 기한(시간) — 처리 기한 준수율 산출 기준' },
  { surfaceKey: 'config:nursing.reassessment.autoScheduleOnAdmission', committee: 'SAFE', note: '간호초기평가 점수로 낙상·욕창 재평가 일정 자동 생성' },
  { surfaceKey: 'config:qi.deviceLedger.coverageFrom', committee: 'IC', note: '기구 원장 전수 기록 시작일 — 이 날 이후 달만 원장 기구일수를 낸다' },
  { surfaceKey: 'config:qi.autoManual.precedence', committee: 'QPS', note: '수기·자동 값이 다를 때 정본' },
  { surfaceKey: 'config:qi.indicator.directEdit', committee: 'QPS', note: '지표 정의·목표 직접 수정 허용 범위' },
  { surfaceKey: 'config:safety.incident.anonymous', committee: 'SAFE', note: '환자안전사고 익명 보고' },
  { surfaceKey: 'config:safety.harmLevelScale', committee: 'SAFE', note: '사고 위해 정도 척도' },
  { surfaceKey: 'config:accreditation.framework', committee: 'QPS', note: '인증 체계(기준 카탈로그 적재 범위)' },
  { surfaceKey: 'review:safety-incident', committee: 'SAFE', note: '환자안전사고 검토(사고 화면에서 안건으로 — 조치 계획·RCA 요구)' },
  { surfaceKey: 'review:qi-report', committee: 'QPS', note: 'QI 보고서 보고·환류(보고서 화면에서 안건으로)' },
  { surfaceKey: 'master:quality-indicator', committee: 'QPS', note: '질 지표 원장 등록·목표(CPOE 지표 포함 · 2026-10-07 — 화면은 안건으로만 올린다)' },
  { surfaceKey: 'config:orders.tracking.attentionMin', committee: 'QPS', note: '오더 처리 주의 기준(긴급도별 분) — 오더 실시간 추적·위원회 기준 점검(2026-10-06 · 다른 대기 목표와 같은 담당)' },
  // P3 §7 P1 후반 — 게이트 판정 기준(모드 키는 기존 게이트·수치가 이 표면)
  { surfaceKey: 'config:rehab.holdCriteria', committee: 'QPS', note: '재활 세션 hold 판정 기준(Berg 낙상·활력 임계)' },
  { surfaceKey: 'config:imaging.contrastEgfr', committee: 'SAFE', note: '조영제 신기능 eGFR 경계(MDRD 계수는 표준·불변)' },
  { surfaceKey: 'config:radiation.doseTolerance', committee: 'SAFE', note: '방사선 선량 허용 오차(분할 편차·누적 초과·처방 정합)' },
  { surfaceKey: 'config:dialysis.ufLimits', committee: 'QPS', note: '투석 UF 안전 기준(제수율 상한·건체중 하회 오차)' },
  { surfaceKey: 'config:bloodbank.crossmatchValidHours', committee: 'TRF', note: '교차시험 유효시간(신규 검사부터 적용)' },
  { surfaceKey: 'config:surgery.lateralityKeywords', committee: 'SAFE', note: '오부위수술 방지 좌우구분 키워드(IPSG.4)' },
  { surfaceKey: 'config:notification.policy', committee: 'QPS', note: '직원 알림 정책(대상 역할·중복 억제) — 안전사건·RCA·마약류 브로드캐스트' },
  { surfaceKey: 'config:notification.retentionDays', committee: 'OPS', note: '알림 보존일(읽음/미읽음)' },
  // P3 §7 P2 — 위생 수렴 표면
  { surfaceKey: 'master:nursing-checklist', committee: 'QPS', note: '간호 체크리스트 템플릿(수혈 포함 7종) — PATCH /nursing/checklist-templates/:code' },
  { surfaceKey: 'config:chemo.cycleGate', committee: 'DTC', note: '항암 사이클 nadir 랩 게이트(+ancMin/pltMin 기준 — 2026-08-05 등재·잠긴 게이트 해소)' },
  { surfaceKey: 'config:consent.doctorSignRequiredTypes', committee: 'MRC', note: '의사 확약 필요 동의서 유형(ess·품질지표 공용 정본)' },
  { surfaceKey: 'config:security.btg.enabled', committee: 'OPS', note: '직원 응급접근(Break-glass) 게이트 — §7 P2 실배선' },
];

/** 등록부 선택지 집행 대상 → 의결 경로 모양(`{kind,target}`) · null 은 그대로(바꾸지 않는다는 명시) */
export function normalizeRegistryEnact(enact: unknown): Record<string, unknown> | null {
  if (enact == null || typeof enact !== 'object') return null;
  const e = enact as Record<string, unknown>;
  if ('kind' in e) return e;
  if (typeof e.key === 'string' && 'newValue' in e) return { kind: 'CONFIG_CHANGE', target: { key: e.key, newValue: e.newValue } };
  return e;
}

/** UUID 모양인가 — 이름 문자열과 계정 id 를 가른다(정확히 이 둘이 섞여 저장돼 있다) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttendanceMatch {
  /** 전원을 계정으로 읽을 수 있는가 — 아니면 **대조하지 않는다** */
  identifiable: boolean;
  /** 계정으로 읽힌 사람 수 */
  identified: number;
  /** 그중 명부 위원 수 */
  onRoster: number;
}

/**
 * 참석자 ↔ 위원 명부 대조.
 *
 * 🔴 참석자는 세 가지 모양으로 저장돼 있다: `"<uuid>"` · `{ userId }` · `"홍길동"`(이름 문자열).
 *    셋을 같게 취급하면 이름이 명부에 없다는 이유로 **없는 위반**이 만들어진다.
 */
export function matchAttendance(attendees: unknown[], rosterSet: Set<string>): AttendanceMatch {
  const ids: string[] = [];
  for (const a of attendees) {
    if (typeof a === 'string') { if (UUID_RE.test(a)) ids.push(a); continue; }
    const uid = (a as { userId?: unknown } | null)?.userId;
    if (typeof uid === 'string' && UUID_RE.test(uid)) ids.push(uid);
  }
  const uniq = [...new Set(ids)];
  return {
    identifiable: attendees.length > 0 && uniq.length === attendees.length,
    identified: uniq.length,
    onRoster: uniq.filter((id) => rosterSet.has(id)).length,
  };
}

@Injectable()
export class GovernanceService implements OnModuleInit {
  private readonly logger = new Logger(GovernanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly enactment?: GovernanceEnactmentService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly sign?: SignIntegrationService,
    /**
     * 🔴 위반 원장. **모듈이 `SafetyGateModule` 을 import 하지 않으면 조용히 `undefined`** 가 되고
     *    그러면 집행은 되는데 기록만 통째로 사라진다(관제에는 "위반 0건"으로 보인다).
     *    `GldModule` 에 import 를 넣어 뒀고, 없으면 `gate-enforce` 가 로거로 그 사실을 남긴다.
     */
    @Optional() private readonly gates?: SafetyGateService,
    /** 결정 엔진으로 의결 기록을 보낸다(결정 모듈을 import 하면 순환) — 없으면 이력이 안 남는다는 사실을 응답이 말한다 */
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async onModuleInit() {
    void this.ensureSeeded().catch((e) => this.logger.warn(`거버넌스 시드 실패(무중단): ${e instanceof Error ? e.message : e}`));
  }

  /** 위원회 9종 + 표면 매핑 시드 — advisory lock 직렬화(다중 부팅 레이스 예방·DUR 사고 교훈) */
  async ensureSeeded() {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('governance-seed'))`;
      for (const c of COMMITTEE_SEED) {
        await tx.committee.upsert({
          where: { code: c.code },
          create: { code: c.code, name: c.name, type: c.type, quorum: c.quorum, meetingCycle: c.meetingCycle },
          update: {}, // 기존 값 존중 — 시드는 최초 1회만 채운다
        });
      }
      const committees = await tx.committee.findMany({ where: { code: { not: null } }, select: { id: true, code: true } });
      const byCode = new Map(committees.map((c) => [c.code!, c.id]));
      for (const m of SURFACE_SEED) {
        const committeeId = byCode.get(m.committee);
        if (!committeeId) continue;
        // 🔴 복합키(표면+위원회) — 한 표면에 여러 위원회(합동 의결)를 담을 수 있게 바뀌었다
        await tx.committeeSurfaceMap.upsert({
          where: { surfaceKey_committeeId: { surfaceKey: m.surfaceKey, committeeId } },
          create: { surfaceKey: m.surfaceKey, committeeId, note: m.note },
          update: {}, // 운영에서 재지정했으면 존중
        });
      }
    });
  }

  // ── 안건 파이프라인 ──

  async submitAgenda(proposerId: string, dto: {
    committeeId: string; title: string; body?: string;
    sourceRef?: Record<string, unknown>; options?: Record<string, unknown>[];
  }) {
    /**
     * 🔴 **등록부에서 올라온 안건은 선택지를 그대로 물려받는다** — `enact` 까지.
     *
     * 종전에는 등록부 `options` 가 AI 영향평가 프롬프트 안에서 `{label, effect}` 로만 인용되고
     * `enact`(무엇을 바꾸는가)는 빠졌다. 그래서 위원이 안건에서 고를 수 있는 것이 없었다.
     * 여기서 인용하면 **정본은 여전히 등록부 하나**이고 안건은 그 시점 사본을 든다
     * (안건은 의결의 근거라 시점 고정이 필요하다 — 등록부가 나중에 바뀌어도 과거 의결은 그대로).
     */
    /**
     * 🔴 등록부 결정은 **정해진 위원회에만** 올린다(2026-10-11) — 결정권한자는 shared `decision-committees` 정본.
     *    종전에는 어느 위원회에든 올라갔다: 의무기록 결정을 영양위원회가 의결해도 막을 것이 없었다.
     *    허가권자·직원 층 결정은 위원회 안건이 아니다(위원회가 그 층을 대신 정하지 못한다).
     */
    const srcRef = dto.sourceRef as { type?: string; key?: string } | undefined;
    if (srcRef?.type === 'DECISION' && srcRef.key) {
      const def = DECISION_REGISTRY.find((d) => d.key === srcRef.key);
      if (def && def.layer !== 'INTERNAL_COMMITTEE') {
        throw new BadRequestException({
          code: 'DECISION_NOT_COMMITTEE_LAYER',
          message: '이 결정은 위원회가 정하는 층이 아닙니다 — 허가권자·직원 결정은 결정 화면에서 해당 권한자가 기록합니다.',
        });
      }
      const ref = def ? decisionCommitteeOf(def.key) : null;
      if (ref) {
        const c = await this.prisma.committee.findUnique({ where: { id: dto.committeeId }, select: { code: true } });
        if (!committeeMayDecide(def!.key, c?.code)) {
          // 문장을 조립하지 않는다 — 주관·합동은 값으로 내려보낸다(화면 언어가 바뀌어도 이름은 정본에서)
          throw new BadRequestException({
            code: 'DECISION_COMMITTEE_NOT_ASSIGNED',
            message: '이 결정을 정할 수 있는 위원회가 아닙니다 — 등록부가 정한 주관·합동 위원회에 올리세요.',
            details: { lead: ref.lead, joint: ref.joint, names: [ref.lead, ...ref.joint].map((x) => COMMITTEE_AUTHORITIES[x].name) },
          });
        }
      }
    }
    // 🔴 같은 결정의 열린 안건(접수·상정·보류)이 있으면 또 올리지 않는다(2026-10-21) — 종전엔 같은 결정이 여러 위원회·여러 번 접수돼
    //    어느 안건의 의결이 그 결정인지가 흐려졌다. 열린 안건을 처리(의결·부결·철회)한 뒤 다시 올린다.
    if (srcRef?.type === 'DECISION' && srcRef.key) {
      const open = await this.openDecisionAgenda(srcRef.key);
      if (open) {
        throw new ConflictException({
          code: 'DECISION_AGENDA_OPEN',
          message: '이 결정은 이미 위원회 안건으로 올라가 있습니다 — 그 안건을 처리(의결·부결·철회)한 뒤 다시 올리세요.',
          details: { agendaId: open.id, status: open.status, committee: open.committee?.code ?? null, meetingId: open.meetingId },
        });
      }
    }
    let options = readOptions(dto.options);
    if (options.length === 0) {
      const src = srcRef;
      if (src?.type === 'DECISION' && src.key) {
        const def = DECISION_REGISTRY.find((d) => d.key === src.key);
        if (def?.options?.length) {
          options = def.options.map((o) => ({
            value: o.value, label: o.label, effect: o.effect,
            // 🔴 `enact` 가 선언된 선택지만 그 값을 싣는다 — 없는 것을 `null` 로 만들지 않는다
            //    (`null`=바꾸지 않음 · 부재=자동 반영 대상 아님 — 다른 사실이다)
            // 🔴 등록부 집행 대상은 두 모양이다 — 권한자 경로의 `{key,newValue}` 를 의결 경로 모양 `{kind,target}` 으로 맞춘다
            //    (맞추지 않으면 그 선택지를 의결할 때 "집행 대상 모양 오류"로 거부된다 — 코드 변경 경로 결정이 안건으로 올라가면서 드러났다 2026-10-11)
            ...('enact' in o ? { enact: normalizeRegistryEnact(o.enact) } : {}),
          }));
        }
      }
    }
    return this.prisma.committeeAgenda.create({
      data: {
        committeeId: dto.committeeId, title: dto.title, body: dto.body, proposerId,
        sourceRef: (dto.sourceRef ?? undefined) as never,
        options: (options.length ? options : undefined) as never,
      },
    });
  }

  /** 결정의 열린 안건(접수·상정·보류) — 최신 1건 · 없으면 null */
  async openDecisionAgenda(key: string) {
    return this.prisma.committeeAgenda.findFirst({
      where: {
        status: { in: [...OPEN_AGENDA_STATUSES] },
        AND: [{ sourceRef: { path: ['type'], equals: 'DECISION' } }, { sourceRef: { path: ['key'], equals: key } }],
      },
      select: { id: true, status: true, committeeId: true, meetingId: true, committee: { select: { code: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listAgendas(committeeId?: string, status?: string) {
    const rows = await this.prisma.committeeAgenda.findMany({
      where: { ...(committeeId ? { committeeId } : {}), ...(status ? { status } : {}) },
      include: { committee: { select: { code: true, name: true } }, decision: { select: { decisionNo: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    // 제안자 이름 조인(드로어 P1) — CommitteeAgenda 는 User 관계 미보유(proposerId 만)
    const ids = [...new Set(rows.map((r) => r.proposerId))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName}${u.givenName}`]));
    return rows.map((r) => ({ ...r, proposerName: nameOf.get(r.proposerId) ?? null }));
  }

  /** 회의 배정(SCHEDULED) / 보류·철회 등 상태 전이 / 제목·본문 정정. 의결(RESOLVED)은 resolveAgenda 전용 — 여기로 못 간다 */
  async updateAgenda(id: string, dto: { meetingId?: string; seq?: number; status?: string; title?: string; body?: string; options?: Record<string, unknown>[] }) {
    if (dto.status && !['SUBMITTED', 'SCHEDULED', 'REJECTED', 'DEFERRED', 'WITHDRAWN'].includes(dto.status)) {
      throw new BadRequestException('RESOLVED 전이는 의결 EP(resolve)로만 가능합니다');
    }
    // 🔴 의결된 안건의 선택지도 불변이다 — 바꾸면 과거 의결이 "무엇을 보고 고른 것"인지가 달라진다
    //    (의결 쪽 `chosenOption.snapshot` 이 그 시점을 들고 있지만, 안건까지 바뀌면 대조가 어긋난다)
    if (dto.options !== undefined) {
      const cur = await this.prisma.committeeAgenda.findUnique({ where: { id }, select: { status: true } });
      if (cur?.status === 'RESOLVED') throw new BadRequestException('의결된 안건의 선택지는 수정할 수 없습니다');
    }
    // 의결된 안건의 제목·본문은 불변(의결 근거 감사 가능성 — aiAssessment 동결과 같은 원칙)
    if (dto.title !== undefined || dto.body !== undefined) {
      const cur = await this.prisma.committeeAgenda.findUnique({ where: { id }, select: { status: true } });
      if (cur?.status === 'RESOLVED') throw new BadRequestException('의결된 안건의 제목·본문은 수정할 수 없습니다');
    }
    // 🔴 회의 배정은 그 안건의 위원회 회의에만 · 취소·봉인된 회의에는 올리지 않는다 · 의결된 안건은 옮기지 않는다(2026-10-21)
    //    종전엔 아무 위원회의 회의에나 배정됐다 — 의무기록 안건이 영양위원회 회의에서 의결될 수 있었다.
    if (dto.meetingId) {
      const [ag, mt] = await Promise.all([
        this.prisma.committeeAgenda.findUnique({ where: { id }, select: { committeeId: true, status: true } }),
        this.prisma.committeeMeeting.findUnique({ where: { id: dto.meetingId }, select: { committeeId: true, status: true, minutesSignedAt: true } }),
      ]);
      if (!ag) throw new NotFoundException('안건을 찾을 수 없습니다');
      if (!mt) throw new NotFoundException('회의를 찾을 수 없습니다');
      if (ag.status === 'RESOLVED') throw new BadRequestException({ code: 'AGENDA_RESOLVED', message: '의결된 안건은 다른 회의로 옮길 수 없습니다' });
      if (mt.committeeId !== ag.committeeId) throw new BadRequestException({ code: 'AGENDA_MEETING_COMMITTEE', message: '이 안건의 위원회 회의가 아닙니다 — 같은 위원회 회의에만 상정합니다' });
      if (mt.status === 'CANCELLED' || mt.minutesSignedAt) throw new BadRequestException({ code: 'AGENDA_MEETING_CLOSED', message: '취소됐거나 회의록이 봉인된 회의에는 상정할 수 없습니다' });
    }
    if (dto.meetingId && !dto.status) dto.status = 'SCHEDULED';
    const { options, ...rest } = dto;
    return this.prisma.committeeAgenda.update({
      where: { id },
      data: { ...rest, ...(options !== undefined ? { options: readOptions(options) as never } : {}) },
    });
  }

  // ── 의결 ──

  /**
   * 의결 — 정족수 검증(회의 참석자 ≥ quorum) + GOV-YYYY-NNN 발번(advisory lock — 번호 경쟁 방지).
   * P0-b: 액션은 MANUAL 만 허용(자동 집행은 P1 — 여기서 시스템 값 변경 없음).
   */
  async resolveAgenda(agendaId: string, dto: {
    resolution: string;
    voteFor?: number; voteAgainst?: number; voteAbstain?: number;
    effectiveFrom?: string; effectiveUntil?: string; reviewDue?: string;
    supersedesId?: string; policyId?: string;
    /** 🔴 화면에서 오는 값이라 느슨하게 받고 **여기서 정본 함수로 정규화**한다(경계에서 거른다) */
    chosenOption?: { value: string; snapshot: unknown[]; note?: string };
    basis?: Record<string, unknown>;
    actions?: { kind: string; target: Record<string, unknown>; manualNote?: string }[];
  }, recorderId?: string) {
    const agenda = await this.prisma.committeeAgenda.findUnique({
      where: { id: agendaId },
      include: { committee: { select: { id: true, quorum: true, code: true, name: true } } },
    });
    if (!agenda) throw new NotFoundException('안건이 없습니다');
    if (agenda.status === 'RESOLVED') throw new BadRequestException('이미 의결된 안건입니다');
    if (!agenda.meetingId) throw new BadRequestException('회의에 배정되지 않은 안건은 의결할 수 없습니다');

    // 정족수 — 회의 attendees(참석 표기) 기준. 미기록이면 의결 차단(참석 없이 의결 금지)
    const meeting = await this.prisma.committeeMeeting.findUnique({ where: { id: agenda.meetingId }, select: { attendees: true } });
    const attendees = Array.isArray(meeting?.attendees) ? (meeting!.attendees as unknown[]) : [];
    const attendeeCount = attendees.length;
    const quorum = agenda.committee.quorum || 0;
    if (attendeeCount === 0) throw new BadRequestException('참석자가 기록되지 않은 회의입니다 — 참석 체크 후 의결하세요');
    if (quorum > 0 && attendeeCount < quorum) {
      throw new BadRequestException({ code: 'QUORUM_NOT_MET', message: `정족수 미달: 참석 ${attendeeCount} < 정족수 ${quorum}` });
    }

    /**
     * 🔴 **명부 대조** — 정족수는 지금까지 `attendees` **배열 길이**만 셌다.
     *    명부(`CommitteeMember`)를 아무도 보지 않았으므로, **위원이 한 명도 없는 위원회**가
     *    참석자를 적어 넣는 것만으로 의결할 수 있었다. 실측(2026-08-28): 정본 위원회 9개가
     *    전부 **위원 0명**인데 의결이 누적돼 있었다(DTC 5·QPS 5·SAFE 4·OPS 3…).
     *
     *    결정은 **중첩**이다 — 위원 임명이 먼저 있고 그 위에 의결이 얹힌다.
     *    아래가 그 순서를 강제하는 자리다.
     *
     * 🔴 다만 **바로 막지 않는다.** 지금 막으면 명부가 비어 있는 전 위원회가 즉시 의결
     *    불능이 되고, 그러면 사람은 회의록을 시스템 밖에서 쓴다(막으면 방치된다).
     *    정본 3상 게이트로 두고 기본은 WARN — **기록을 모아 BLOCK 으로 승격**한다.
     */
    const rosterMode = gateMode(await this.config?.get('governance.quorumRosterGate'), 'WARN');
    const roster = await this.prisma.committeeMember.findMany({
      where: { committeeId: agenda.committee.id, isActive: true },
      select: { userId: true },
    });
    const rosterSet = new Set(roster.map((m) => m.userId));
    const attendance = matchAttendance(attendees, rosterSet);

    /**
     * 🔴 판정을 **두 갈래로 가른다** — 섞으면 없는 위반을 만들거나 있는 위반을 놓친다.
     *
     *  ① **명부가 비어 있다** — 참석자 형태와 **무관한 사실**이다. 위원이 0명인 위원회는
     *     누가 참석했든 의결 주체가 없다. 이건 언제나 위반이다.
     *  ② **명부는 있는데 참석 위원이 정족수 미만** — 이건 참석자 신원을 읽을 수 있을 때만
     *     말할 수 있다. 🔴 실측(2026-08-28): 운영 참석자가 `["a","b","c","d","e"]` —
     *     화면이 **이름을 콤마로 타이핑**받아 문자열로 저장해 왔다. 계정과 연결이 없다.
     *     이런 회의는 **대조할 수 없다** — 0명으로 세면 없는 위반을 만든다.
     */
    const rosterEmpty = roster.length === 0;
    const shortOfRoster = !rosterEmpty && attendance.identifiable
      && quorum > 0 && attendance.onRoster < quorum;
    const rosterWarning = await enforceGate({
      gateKey: 'governance.quorumRosterGate',
      mode: rosterMode,
      violated: rosterEmpty || shortOfRoster,
      code: 'QUORUM_ROSTER_NOT_MET',
      message: rosterEmpty
        ? `위원 명부가 비어 있는 위원회의 의결입니다(참석 ${attendeeCount}명 · 명부 0명) — 위원 임명이 선행되어야 합니다.`
        : `참석자 중 명부 위원이 정족수에 못 미칩니다: 명부 위원 ${attendance.onRoster} < 정족수 ${quorum} (참석 ${attendeeCount}명).`,
      refType: 'CommitteeAgenda', refId: agendaId,
      recorder: this.gates, logger: this.logger,
    });
    // 🔴 대조 자체가 불가능했다는 사실도 남긴다 — 조용하면 "대조했고 문제없음"으로 읽힌다
    if (!rosterEmpty && !attendance.identifiable) {
      this.logger.warn(
        `[정족수 명부] 안건 ${agendaId} — 참석자 ${attendeeCount}명 중 계정으로 식별 가능한 사람 `
        + `${attendance.identified}명. 대조하지 않았다(참석자를 이름 문자열로 기록한 회의).`,
      );
    }

    /**
     * 🔴 **무엇을 골랐는가** — 선택지가 있는 안건은 고르지 않고 의결할 수 없다.
     *
     * 종전에는 `resolution` 산문만 남아 "B안으로 의결"이 구조로 남지 않았고, 집행하려면
     * 위원이 `kind`/`target` 을 **다시 타이핑**해야 했다(그 순간 정본이 둘이 된다).
     * 이제 고른 선택지의 `enact` 가 **그대로** 집행 대상이 된다.
     *
     * 🔴 `MODIFIED`/`NONE_OF_ABOVE`(원안 수정·선택지 밖 의결)는 **자동 집행하지 않는다** —
     *    원안의 `enact` 를 그대로 집행하면 위원회가 의결하지 않은 것을 하는 셈이다.
     */
    const agendaOptions = readOptions(agenda.options);
    const chosen: ChosenOption | undefined = dto.chosenOption
      ? { value: dto.chosenOption.value, snapshot: readOptions(dto.chosenOption.snapshot), note: dto.chosenOption.note }
      : undefined;
    const choice = checkChosenOption(agendaOptions, chosen);
    if (!choice.ok) {
      throw new BadRequestException({
        code: `AGENDA_CHOICE_${choice.code}`,
        message: CHOICE_ERROR_TEXT[choice.code!] ?? '의결 선택을 확인하세요',
      });
    }

    /**
     * 고른 선택지의 `enact` → 집행 액션. 사람이 보낸 `actions` 와 **합치지 않는다** —
     * 선택지가 있는 안건에서 액션을 손으로 보내면 정본이 둘이 되므로 거부한다.
     */
    let effectiveActions = dto.actions ?? [];
    if (agendaOptions.length > 0) {
      if (effectiveActions.length > 0 && !isSpecialChoice(dto.chosenOption?.value)) {
        throw new BadRequestException({
          code: 'AGENDA_CHOICE_ACTIONS_CONFLICT',
          message: '선택지가 있는 안건은 고른 선택지의 집행 대상을 씁니다 — 액션을 따로 보내지 마세요(수정 의결은 예외).',
        });
      }
      if (choice.enact) {
        const kind = String((choice.enact as { kind?: unknown }).kind ?? '');
        const target = (choice.enact as { target?: unknown }).target;
        if (!kind || !target || typeof target !== 'object') {
          throw new BadRequestException({
            code: 'AGENDA_CHOICE_ENACT_MALFORMED',
            message: '고른 선택지의 집행 대상이 `{ kind, target }` 모양이 아닙니다 — 안건 선택지를 고치세요.',
          });
        }
        effectiveActions = [{ kind, target: target as Record<string, unknown> }];
      }
    }

    // 액션 바인딩 검증(P1) — 개방 kind·카탈로그 등재·보호 키를 의결 시점에 거른다(잘못된 바인딩이 대장에 박히기 전)
    for (const a of effectiveActions) {
      this.enactment?.validateAction(a.kind, a.target);
    }

    const decision = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('governance-decision-no'))`;
      const year = new Date().getFullYear();
      const count = await tx.committeeDecision.count({ where: { decisionNo: { startsWith: `GOV-${year}-` } } });
      const decisionNo = `GOV-${year}-${String(count + 1).padStart(3, '0')}`;

      const created = await tx.committeeDecision.create({
        data: {
          committeeId: agenda.committeeId,
          agendaId,
          decisionNo,
          resolution: dto.resolution,
          chosenOption: (chosen ?? undefined) as never,
          voteFor: dto.voteFor, voteAgainst: dto.voteAgainst, voteAbstain: dto.voteAbstain,
          resolvedAt: new Date(),
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
          effectiveUntil: dto.effectiveUntil ? new Date(dto.effectiveUntil) : null,
          reviewDue: dto.reviewDue ? new Date(dto.reviewDue) : null,
          supersedesId: dto.supersedesId,
          policyId: dto.policyId,
          actions: effectiveActions.length
            ? { create: effectiveActions.map((a) => ({
                kind: a.kind, target: a.target as never, manualNote: a.manualNote,
                // 🔴 근거는 집행 원장에 남는다 — "이 값이 왜 이 값인가" 를 나중에 표면에서 되짚는 자리
                basis: (readBasis(dto.basis) ?? undefined) as never,
              })) }
            : undefined,
        },
        include: { actions: true },
      });
      await tx.committeeAgenda.update({ where: { id: agendaId }, data: { status: 'RESOLVED' } });
      // supersede 체인(D4) — 이전 결정을 SUPERSEDED 로
      //
      // 🔴 (2026-09-17 L2) 종전 `.catch(() => undefined)` 는 **트랜잭션 안에서** 실패를 삼켰다 —
      //    새 결정은 "이것을 대체한다"고 적혀 커밋되는데 대체 대상은 유효한 채 남아, **같은 표면에 유효한 결정이 둘**이 된다.
      //    대상이 없는 경우는 위 `supersedesId` FK 가 이미 막으므로 이 catch 가 삼킨 것은 실제 실패뿐이다 — 전파해 함께 되돌린다.
      if (dto.supersedesId) {
        await tx.committeeDecision.update({ where: { id: dto.supersedesId }, data: { status: 'SUPERSEDED' } });
      }
      return created;
    });

    // 의결 봉인(D5) — 로컬 기록이 정본·봉인은 best-effort(sign 장애가 의결을 막지 않는다).
    // 체인에는 주문 sha256 만(자유 텍스트에 실릴 수 있는 PHI 미전송). 영수증은 signRef 에 보관.
    void this.sealDecision(decision.id, decision.decisionNo, decision.resolution, agenda.committeeId)
      .catch((e) => this.logger.warn(`의결 봉인 실패(비차단) ${decision.decisionNo}: ${e instanceof Error ? e.message : e}`));

    /**
     * 🔴 WARN 으로 통과한 명부 위반을 **응답에 실어 보낸다.** 원장에만 남기면 의결한 사람은
     *    모른 채 지나간다 — 승격 근거는 쌓이지만 그 자리에서 고쳐지지 않는다.
     */
    const registryRecord = await this.recordRegistryDecision(agenda, decision, chosen, recorderId);
    const out = registryRecord ? { ...decision, registryRecord } : decision;
    return rosterWarning ? { ...out, gateWarnings: [rosterWarning] } : out;
  }

  /**
   * 🔴 등록부에서 올라온 안건의 의결 → 결정 등록부 기록(2026-10-11). 의결이 곧 기록이다 — 사람이 다시 입력하지 않는다.
   *    의결은 이미 커밋된 사실이라 기록 실패로 되돌리지 않는다 — 대신 응답에 `written:false` 와 이유를 싣는다
   *    (결정 화면은 그 결정을 "④ 의결 — 등록부 기록 전"으로 계속 보여 준다).
   */
  private async recordRegistryDecision(
    agenda: { sourceRef: unknown; committee: { code: string | null; name: string } },
    decision: { id: string; decisionNo: string },
    chosen: ChosenOption | undefined,
    recorderId: string | undefined,
  ): Promise<{ key: string; written: boolean; reason?: string; engine?: unknown } | null> {
    const src = agenda.sourceRef as { type?: string; key?: string } | null;
    if (src?.type !== 'DECISION' || !src.key) return null;
    const def = DECISION_REGISTRY.find((d) => d.key === src.key);
    if (!def) return { key: src.key, written: false, reason: '등록부에 없는 결정 키' };
    const r = committeeResolutionRecord({
      def, chosenValue: chosen?.value, note: chosen?.note,
      decision: { id: decision.id, decisionNo: decision.decisionNo, committeeCode: agenda.committee.code, committeeName: agenda.committee.name },
      recorderId: recorderId ?? null, at: new Date(),
    });
    if (!r.ok) {
      const reason = r.reason === 'SPECIAL_CHOICE' ? '원안 수정·선택지 밖 의결 — 등록부 선택지가 아니라 사람이 결정 화면에서 기록한다'
        : r.reason === 'NO_CHOICE' ? '선택지를 고르지 않은 의결 — 등록부에 옮길 선택이 없다'
        : '등록부 선택지에 없는 값';
      return { key: def.key, written: false, reason };
    }
    if (!this.config) return { key: def.key, written: false, reason: '설정 저장소 미주입 — 결정 화면에서 의결 번호로 기록해야 한다' };
    try {
      const prev = await this.config.get(`decision.${def.key}`);
      // `updatedBy` 는 uuid 칸이다 — 계정이 없으면 비워 둔다(문자열 표식을 넣으면 저장이 실패한다)
      await this.config.set(`decision.${def.key}`, r.record, recorderId);
      // 🔴 엔진 — 이력 원장·후행 결정 전파. 수신자가 없으면 "이력 미기록"을 말한다(조용히 넘기지 않는다)
      const results = this.events
        ? await this.events.emitAsync(COMMITTEE_RECORDED_EVENT, { key: def.key, prev: prev && typeof prev === 'object' ? prev : null, next: r.record, actorUserId: recorderId ?? null })
        : [];
      const engine = results[0] ?? { logged: false, propagatedTo: [], error: '결정 엔진 미연결 — 이력이 남지 않았다' };
      return { key: def.key, written: true, engine };
    } catch (e) {
      this.logger.error(`의결 ${decision.decisionNo} → 등록부 기록 실패(key=${def.key}): ${e instanceof Error ? e.message : String(e)}`);
      return { key: def.key, written: false, reason: '등록부 기록 실패 — 결정 화면에서 의결 번호로 기록해야 한다' };
    }
  }

  private async sealDecision(decisionId: string, decisionNo: string, resolution: string, committeeId: string) {
    if (!this.sign) return;
    const committee = await this.prisma.committee.findUnique({ where: { id: committeeId }, select: { code: true } });
    const receipt = await this.sign.recordSignAuditEvent({
      userId: 'system:hospitalrun',
      action: 'GOVERNANCE_DECISION_SEALED',
      targetType: 'CommitteeDecision',
      targetRef: decisionId,
      stream: GOVERNANCE_STREAM,
      occurredAt: new Date().toISOString(),
      data: {
        decisionNo,
        committee: committee?.code ?? '',
        resolutionSha256: createHash('sha256').update(resolution, 'utf8').digest('hex'),
      },
    });
    if (receipt.ok && receipt.entryHash) {
      // 🔴 (2026-09-17 L2) 봉인은 **외부 체인에 이미 들어갔다** — 이 쓰기가 실패하면 우리 원장만 그 사실을 모른다
      //    (결정이 "미봉인"으로 보이고 영수증 해시를 되짚을 길이 없다). 의결을 되돌릴 수는 없으니 유실을 남긴다.
      // 🔴 호출은 **한 줄로** — 줄바꿈하면 트랜잭션·상태 쓰기 스캐너가 이 쓰기를 못 본다(K4 실측)
      await this.prisma.committeeDecision.update({ where: { id: decisionId }, data: { signRef: receipt.entryHash } })
        .catch((e) => this.logger.error(`의결 봉인 해시 기록 실패 — 외부 체인에는 봉인됐으나 원장에 연결되지 않았다(decision=${decisionId} entryHash=${receipt.entryHash}): ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  /** his-governance 체인 무결성 검증 — 외부 sign 의 verify 를 그대로 노출(ADMIN) */
  async verifySignChain() {
    if (!this.sign) throw new BadRequestException('sign 연동 모듈 미주입');
    return this.sign.verifySignAuditChain(GOVERNANCE_STREAM);
  }

  async listDecisions(committeeId?: string) {
    return this.prisma.committeeDecision.findMany({
      where: committeeId ? { committeeId } : undefined,
      include: {
        committee: { select: { code: true, name: true } },
        agenda: { select: { title: true } },
        actions: true,
      },
      orderBy: { resolvedAt: 'desc' },
      take: 100,
    });
  }

  async getDecision(id: string) {
    const d = await this.prisma.committeeDecision.findUnique({
      where: { id },
      include: { committee: { select: { code: true, name: true } }, agenda: true, actions: true },
    });
    if (!d) throw new NotFoundException('결정이 없습니다');
    // supersede 체인 — 위로(대체한 것)·아래로(대체된 것)
    const supersededBy = await this.prisma.committeeDecision.findFirst({ where: { supersedesId: id }, select: { id: true, decisionNo: true } });
    return { ...d, supersededBy };
  }

  /** MANUAL 액션 이행 확인(간사) — SKIPPED/PENDING → ENACTED */
  async confirmManualAction(actionId: string, userId: string, manualNote?: string) {
    const action = await this.prisma.decisionAction.findUnique({ where: { id: actionId }, select: { kind: true, decisionId: true } });
    if (!action) throw new NotFoundException('집행 항목이 없습니다');
    if (action.kind !== 'MANUAL') throw new BadRequestException('MANUAL 항목만 수동 확인 대상입니다');
    const updated = await this.prisma.decisionAction.update({
      where: { id: actionId },
      data: { status: 'ENACTED', enactedAt: new Date(), enactedBy: userId, ...(manualNote ? { manualNote } : {}) },
    });
    // 전 액션 종결 시 결정 상태 승격 —
    // 🔴 등록부(허가권자·코드변경) 출처 액션에는 승격시킬 **위원회 결정이 없다**.
    //    없는 것을 만들어 승격시키면 원장이 "위원회가 의결했다"고 말하게 된다(2026-08-27).
    if (action.decisionId) {
      const remaining = await this.prisma.decisionAction.count({ where: { decisionId: action.decisionId, status: { in: ['PENDING', 'SKIPPED'] } } });
      if (remaining === 0) {
        // 🔴 (2026-09-17 L2) 승격 실패를 삼키면 **전 액션이 끝났는데 결정은 영구히 PARTIALLY_ENACTED** 로 남는다
        //    (남은 액션이 없어 되돌아올 계기도 없다). 이행 화면이 "아직 반영 중"으로 그린다 — 유실을 남긴다.
        await this.prisma.committeeDecision.update({ where: { id: action.decisionId }, data: { status: 'ENACTED' } })
          .catch((e) => this.logger.error(`결정 상태 승격(ENACTED) 실패 — 전 액션 종결인데 결정이 PARTIALLY_ENACTED 로 남는다(decision=${action.decisionId}): ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    return updated;
  }

  /** 재검토 임박 알림(P2) — 매일 09:30 KST·30일 전·결정당 1회(dedupe: 동일 refId+type 24h) */
  @Cron('0 30 9 * * *', { name: 'governance-review-due', timeZone: 'Asia/Seoul' })
  async remindReviewDue() {
    const soon = await this.prisma.committeeDecision.findMany({
      where: { reviewDue: { not: null, lte: new Date(Date.now() + 30 * 86400_000) }, status: { in: ['RESOLVED', 'ENACTED', 'PARTIALLY_ENACTED'] } },
      select: { id: true, decisionNo: true, reviewDue: true },
      take: 20,
    });
    if (!soon.length) return;
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true }, take: 5 });
    for (const d of soon) {
      for (const a of admins) {
        const dup = await this.prisma.notification.findFirst({
          where: { userId: a.id, type: 'GOVERNANCE_REVIEW_DUE', refId: d.id, createdAt: { gte: new Date(Date.now() - 20 * 86400_000) } },
          select: { id: true },
        });
        if (dup) continue;
        await this.notifications?.notify(a.id, {
          type: 'GOVERNANCE_REVIEW_DUE', severity: 'INFO',
          title: `위원회 결정 재검토 임박 — ${d.decisionNo}`,
          message: `재검토 기한 ${d.reviewDue?.toISOString().slice(0, 10)} — 재심의 안건 상정을 검토하세요.`,
          refType: 'GOVERNANCE_DECISION', refId: d.id,
          // 🔴 (2026-09-16 E4) 종전 `.catch(() => undefined)` — 재검토 기한 알림이 실패해도 아무 데도 안 남았다.
          //    dedupe 가 "알림 행이 있는가"라서 다음 날 다시 시도되지만, 기한이 지나 있으면 그때는 늦는다.
        }).catch((e) => this.logger.warn(`위원회 재검토 임박 알림 실패 decision=${d.decisionNo} user=${a.id}: ${(e as Error).message}`));
      }
    }
  }

  // ── 관제 요약 ──

  async summary() {
    const [committees, pendingAgendas, recentDecisions, pendingActions, reviewSoon] = await Promise.all([
      this.prisma.committee.findMany({
        where: { isActive: true, code: { not: null } },
        select: {
          id: true, code: true, name: true, quorum: true, meetingCycle: true,
          _count: { select: { agendas: { where: { status: { in: ['SUBMITTED', 'SCHEDULED'] } } }, govDecisions: true } },
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.committeeAgenda.count({ where: { status: { in: ['SUBMITTED', 'SCHEDULED'] } } }),
      this.prisma.committeeDecision.findMany({
        take: 8, orderBy: { resolvedAt: 'desc' },
        select: { id: true, decisionNo: true, resolution: true, status: true, resolvedAt: true, committee: { select: { code: true } } },
      }),
      this.prisma.decisionAction.count({ where: { status: 'PENDING' } }),
      this.prisma.committeeDecision.findMany({
        where: { reviewDue: { not: null, lte: new Date(Date.now() + 30 * 86400_000) }, status: { in: ['RESOLVED', 'ENACTED', 'PARTIALLY_ENACTED'] } },
        select: { id: true, decisionNo: true, reviewDue: true, committee: { select: { code: true } } },
        orderBy: { reviewDue: 'asc' }, take: 10,
      }),
    ]);
    return { committees, pendingAgendas, recentDecisions, pendingActions, reviewSoon };
  }

  // ── P2: 역추적·시계열 ──

  /**
   * 표면 provenance — 이 표면을 건드린 결정 체인(최신순). 배지(⚖)의 데이터 소스.
   * 매칭 = surfaceKeyOf(kind, target) 단일 규칙(P3 — 전 kind 일반화).
   * config/gate 는 bare 키·`config:`/`gate:` 프리픽스 둘 다 받는다(하위호환).
   */
  async provenance(surfaceKey: string) {
    const bare = surfaceKey.replace(/^(config|gate):/, '');
    const actions = await this.prisma.decisionAction.findMany({
      where: { kind: { in: AUTO_ENACT_KINDS } },
      include: { decision: { select: { id: true, decisionNo: true, status: true, resolvedAt: true, resolution: true, supersedesId: true, committee: { select: { code: true, name: true } } } } },
      // registryKey 는 스칼라라 include 불필요(select 미사용 쿼리이므로 자동 포함)
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const chain = actions
      .filter((a) => {
        const sk = surfaceKeyOf(a.kind, (a.target ?? {}) as Record<string, unknown>);
        return sk !== null && (sk === surfaceKey || sk === bare);
      })
      .slice(0, 30)
      .map((a) => ({
        action: { id: a.id, kind: a.kind, status: a.status, enactedAt: a.enactedAt },
        // 🔴 등록부 출처는 `decision` 이 null 이다 — 소비처가 그것을 "근거 없음"으로 읽지 않도록 출처를 함께 낸다
        source: a.decision ? ('COMMITTEE' as const) : ('REGISTRY' as const),
        registryKey: a.registryKey,
        decision: a.decision,
      }));
    const mapKey = surfaceKey.includes(':') ? surfaceKey : `config:${bare}`;
    // 🔴 담당이 **복수**일 수 있다(합동 의결) — 하나만 읽으면 나머지가 조용히 사라진다
    //
    // 🔴 (2026-09-17 L2) 종전 `.catch(() => [])` 은 조회 실패를 **"담당 위원회 없음"** 으로 번역했다.
    //    바로 아래 주석이 "①아무도 정하지 않았다 ②애초에 결정 대상이 아니다 를 구분해 말한다"고 선언하는데,
    //    실패는 그 3상태 어디에도 없는 네 번째 사실이라 ①로 접혀 **거버넌스 대상이 아닌 것처럼** 보였다.
    const maps = await this.prisma.committeeSurfaceMap.findMany({ where: { surfaceKey: mapKey } });
    const owners = maps.length
      ? await this.prisma.committee.findMany({
          where: { id: { in: maps.map((m) => m.committeeId) } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const map = maps[0] ?? null;

    /**
     * 🔴 **3상태로 말한다** (2026-08-27 · 계획서 §3.3).
     *
     * 종전 응답은 체인이 비면 `chain: []` 뿐이라, 소비처가
     *   ① "거버넌스 대상인데 아무도 정하지 않았다"  ② "애초에 결정 대상이 아니다"
     * 를 **구분할 수 없었다.** 구분하지 못하면 화면은 둘 다 똑같이 조용히 그리고,
     * 그것이 기본값을 정책처럼 보이게 하는 경로다.
     *
     * 🔴 `NO_DECISION` 은 **결함이 아니다** — 개시 전 정상 상태일 수 있다.
     *    다만 "정해진 값"과 같은 얼굴을 하면 안 된다.
     */
    const basisState: BasisState = chain.length > 0
      ? 'DECIDED'
      : (map ? 'NO_DECISION' : 'NOT_GOVERNED');

    // 최신 유효 결정의 고른 선택·근거 — 없으면 없다고 말한다(지어내지 않는다)
    const latest = chain[0] ?? null;
    const latestDecisionId = latest?.decision?.id ?? null;
    const chosenOption = latestDecisionId
      ? await this.prisma.committeeDecision
          .findUnique({ where: { id: latestDecisionId }, select: { chosenOption: true } })
          .then((d) => d?.chosenOption ?? null)
          .catch(() => null)
      : null;
    const basis = latest
      ? await this.prisma.decisionAction
          .findUnique({ where: { id: latest.action.id }, select: { basis: true } })
          .then((a) => readBasis(a?.basis) ?? null)
          .catch(() => null)
      : null;

    return {
      surfaceKey,
      basisState,
      ownerCommittee: map?.committeeId ?? null,
      // 🔴 코드·이름을 함께 낸다 — 종전엔 id 만 나와 화면이 다시 조회해야 했다
      owner: owners[0] ?? null,
      /** 합동 의결이면 둘 이상이다 — 하나만 보여주면 나머지가 사라진다 */
      owners,
      chosenOption,
      basis,
      chain,
    };
  }

  /** 표면→최신 유효 결정 맵 — 관리 화면 배지 일괄 조회(키별 개별 호출 방지). 키 = surfaceKeyOf 규칙 */
  async activeDecisionBadges() {
    const actions = await this.prisma.decisionAction.findMany({
      // 🔴 종전 where 는 `decision.status` 를 요구했다 — 등록부 출처 액션은 위원회 결정이 없어
      //    그 조건에 **영원히 걸리지 않는다**(배지가 조용히 안 뜬다). 출처별로 나눠 받는다.
      where: {
        kind: { in: AUTO_ENACT_KINDS }, status: 'ENACTED',
        OR: [
          { decision: { status: { in: ['ENACTED', 'PARTIALLY_ENACTED', 'RESOLVED'] } } },
          { decisionId: null, registryKey: { not: null } },
        ],
      },
      include: { decision: { select: { id: true, decisionNo: true, resolvedAt: true } } },
      orderBy: { enactedAt: 'desc' },
    });
    /**
     * 🔴 출처를 **구분해서** 말한다(2026-08-27). 등록부(허가권자) 결정으로 바뀐 값에
     *    "위원회 <결정번호>" 배지를 달면 그 화면이 거짓말을 한다 —
     *    위원회는 그것을 의결한 적이 없다.
     */
    const badges: Record<string, {
      source: 'COMMITTEE' | 'REGISTRY';
      decisionId: string | null; decisionNo: string | null;
      registryKey: string | null; enactedAt: Date | null;
    }> = {};
    for (const a of actions) {
      const key = surfaceKeyOf(a.kind, (a.target ?? {}) as Record<string, unknown>);
      if (!key || badges[key]) continue; // 최신 우선(정렬 desc)
      badges[key] = a.decision
        ? { source: 'COMMITTEE', decisionId: a.decision.id, decisionNo: a.decision.decisionNo, registryKey: null, enactedAt: a.enactedAt }
        : { source: 'REGISTRY', decisionId: null, decisionNo: null, registryKey: a.registryKey, enactedAt: a.enactedAt };
    }
    return badges;
  }

  /**
   * 동적/키자재 네임스페이스 — 설계상 DB 전용이라 DEFAULTS 등재 대상이 아니다(드리프트 오탐 방지).
   * 부서·역할·기능별 인스턴스 키(access-control 계열)와 key-custody 가 systemConfig 에 보관하는
   * JWKS 3벌·파트너별 대상결속 시크릿(`${scope}.targetTokenSecret` 동적 조립). 2026-08-05 전수 재분류 실측.
   */
  private static isDynamicConfigKey(key: string): boolean {
    const prefixes = ['access.dept.', 'access.role.', 'access.custom-page.', 'access.menu', 'feature-access.config.', 'pacs.access.', 'pacs.user.', 'sign.jwks', 'smart.idToken.jwks'];
    if (prefixes.some((p) => key.startsWith(p))) return true;
    if (key.endsWith('.targetTokenSecret')) return true;
    if (key === 'rbac.roleOverrides') return true; // 관리 화면 정책 오버라이드(access 동류)
    return false;
  }

  /**
   * 거버넌스 헬스체크(D13) — 상시 드리프트 검출.
   * ①DB systemConfig 에 있는데 DEFAULTS 카탈로그에 없는 키(관리 화면 비노출 갭의 재발 신호).
   *   동적/키자재 네임스페이스는 제외(isDynamicConfigKey — 종전 31건 중 20건이 이 오탐이었음·2026-08-05).
   * ②관제 수집 누락 — 설명이 3상(OFF|WARN|BLOCK)을 말하는데 분류기(classifyGateEntry)가 판정 못 하는
   *   엔트리(값 타입 이상 등). 수집 자체가 P3 에서 Map/Boolean 까지 넓어져 종전 알려진 3종은 소진됨.
   * (코드 정적 스캔·바인딩 생존성은 계약 테스트 몫 — 기획 §5.4. 래퍼 헬퍼(this.cfg 류) 경유 소비는
   *  가드 정규식 사각 — chemo 3키가 그렇게 잠겨 있었다·수동 등재로 해소)
   */
  async healthCheck() {
    const dbKeys = await this.prisma.systemConfig.findMany({ select: { key: true } });
    const nonDynamic = dbKeys.map((k) => k.key).filter((k) => !GovernanceService.isDynamicConfigKey(k));
    const orphanKeys = this.enactment
      ? nonDynamic.filter((k) => !this.enactment!.hasDefaultKey(k))
      : [];
    const ignoredDynamic = dbKeys.length - nonDynamic.length;
    const all = ((await this.config?.getAll().catch(() => [])) ?? []) as { key: string; value: unknown; description?: string }[];
    const gateCollectionGaps = all
      .filter((e) => /OFF\s*[|/·]\s*WARN\s*[|/·]\s*BLOCK/i.test(e.description ?? '') && classifyGateEntry(e) === null)
      .map((e) => e.key);
    /**
     * 🔴 **코드 없는 위원회** — 지우지 않고 드러낸다(2026-08-27).
     *
     *    `code` 는 집행 컨텍스트(`committee.code`)와 표면 맵이 쓰는 식별자다.
     *    코드가 없으면 그 위원회는 표면을 소유할 수 없고, 안건 상신 목록에서는
     *    **정본과 이름이 비슷한 채로 섞여** 사람이 잘못 고르게 만든다.
     *    실측(2026-08-27): 16건 중 **6건이 코드 없음**(안건 0·의결 0·표면 0) —
     *    `prisma/seed-gld-samples.ts` 가 만든 잔재였다(생성기는 교정했다).
     *
     *    🔴 여기서 자동으로 지우지 않는다 — 위원회는 원내 조직이고, 지우는 것은 사람 결정이다.
     */
    const codeless = await this.prisma.committee.findMany({
      where: { OR: [{ code: null }, { code: '' }] },
      select: { id: true, name: true, isActive: true, _count: { select: { agendas: true, govDecisions: true } } },
    }).catch(() => null);
    return {
      configDrift: { count: orphanKeys.length, keys: orphanKeys.slice(0, 20), ignoredDynamic },
      // 🔴 조회 실패를 "없음"으로 번역하지 않는다(null = 판정 불가)
      codelessCommittees: codeless === null ? null : {
        count: codeless.length,
        items: codeless.map((c) => ({
          name: c.name, isActive: c.isActive,
          agendas: c._count.agendas, decisions: c._count.govDecisions,
          note: c._count.agendas === 0 && c._count.govDecisions === 0
            ? '사용 이력이 없다 — 정리 대상 후보(사람 확인)'
            : '🔴 사용 이력이 있다 — 코드를 부여해야 한다(지우면 이력이 끊긴다)',
        })),
      },
      gateCollectionGaps,
      checkedAt: new Date().toISOString(),
    };
  }

  /** 표면 담당 조회 — 역추적(P2 배지)의 데이터 기반 */
  async surfaceMap() {
    return this.prisma.committeeSurfaceMap.findMany({ orderBy: { surfaceKey: 'asc' } });
  }

  // ── 워크벤치 P3: 제안 사전 검토 (TipTap 개편 동반 — 유사/중복 탐지·검토 질의) ──

  /** HTML 본문 → 평문(LLM/유사도용) — TipTap 저장 body 대응 */
  private static stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private static titleTokens(s: string): Set<string> {
    return new Set(s.split(/[^가-힣a-zA-Z0-9.]+/).filter((t) => t.length >= 2));
  }

  /**
   * 안건 제안 사전 검토 — 상정 전에 ①유사/중복 안건 ②관련 기능·표면 ③보완 질의를 브리핑.
   * 비차단(상정 여부는 제안자 판단)·게이트 governance.ai.enabled·전 직원(제안권과 동일).
   * 유사 후보는 서버가 결정적으로 선별(제목 토큰 겹침)해 컨텍스트에 동봉하고, LLM 지목분은
   * 실제 안건에 재매칭해서만 반환한다(환각 제목 차단).
   */
  async precheckAgenda(dto: { committeeId?: string; title: string; body?: string }) {
    const enabled = await this.config?.get('governance.ai.enabled').catch(() => false);
    if (!(enabled === true || enabled === 'true')) {
      throw new BadRequestException({ code: 'GOVERNANCE_AI_OFF', message: 'AI 사전 검토가 비활성 상태입니다(governance.ai.enabled)' });
    }
    const title = (dto.title ?? '').trim();
    if (!title) throw new BadRequestException('제목이 필요합니다');
    const plainBody = GovernanceService.stripHtml(dto.body ?? '');

    const agendas = await this.prisma.committeeAgenda.findMany({
      include: { committee: { select: { code: true, name: true } }, decision: { select: { decisionNo: true, status: true } } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    // 결정적 유사 후보 — 제목 토큰 겹침 상위(LLM 은 이 후보 안에서 판단)
    const qTokens = GovernanceService.titleTokens(`${title} ${plainBody.slice(0, 200)}`);
    const scored = agendas
      .map((a) => {
        const at = GovernanceService.titleTokens(a.title);
        const overlap = [...at].filter((t) => qTokens.has(t)).length;
        return { a, overlap };
      })
      .filter((x) => x.overlap > 0)
      .sort((x, y) => y.overlap - x.overlap)
      .slice(0, 6);

    let surfaces: { surfaceKey: string; note: string | null }[] = [];
    if (dto.committeeId) {
      surfaces = await this.prisma.committeeSurfaceMap.findMany({
        where: { committeeId: dto.committeeId }, select: { surfaceKey: true, note: true }, orderBy: { surfaceKey: 'asc' },
      });
    }

    const context = {
      draft: { title, body: plainBody.slice(0, 2000) },
      existingAgendas: scored.map(({ a }) => ({
        title: a.title, status: a.status, decisionNo: a.decision?.decisionNo ?? null, committee: a.committee?.code ?? null,
      })),
      committeeSurfaces: surfaces,
      openBindingKinds: AUTO_ENACT_KINDS,
    };
    const prompt = [
      '당신은 병원 위원회 안건 상정을 돕는 사전 검토 도우미다. 아래 안건 초안과 컨텍스트를 읽고 한국어 JSON 만 출력하라.',
      '규칙: 판단·권고 아님(브리핑) · similarTitles 의 title 은 existingAgendas 목록의 제목을 그대로 복사(새 제목 창작 금지·유사한 것 없으면 빈 배열).',
      '스키마: {"similarTitles":[{"title":"기존 안건 제목 그대로","reason":"유사/중복 사유 1문장"}],',
      '"relatedFeatures":["이 안건과 연관된 시스템 기능·표면·화면 (컨텍스트의 committeeSurfaces·openBindingKinds 근거)"],',
      '"questions":["상정 전 보완하면 좋을 검토 질의 — 근거 수치 유무·영향 범위·재량 밖(법정 기준) 여부·집행 수단 명확성 등 3~6개"],',
      '"scopeNote":"이 안건이 가결되면 어떤 집행 경로(바인딩 kind)를 쓸 수 있는지 1~2문장(불명확하면 null)"}',
      '컨텍스트:', JSON.stringify(context, null, 1),
    ].join('\n');

    let parsed: { similarTitles?: { title?: string; reason?: string }[]; relatedFeatures?: string[]; questions?: string[]; scopeNote?: string | null };
    // 🔴 호출 실패(kill switch 꺼짐·미설정·상류 오류)는 "파싱 실패"가 아니다 — 전파한다(r3 B6).
    //    이 catch 는 **응답을 받은 뒤의 파싱**만 감싼다.
    const precheckText = await this.llmGenerate(prompt, 60_000);
    try {
      parsed = this.extractJson(precheckText);
    } catch {
      parsed = { similarTitles: [], relatedFeatures: [], questions: ['AI 응답 파싱 실패 — 재시도하거나 수동 검토하세요'], scopeNote: null };
    }
    // LLM 지목 제목 → 실제 안건 재매칭(정확 일치 우선·부분 포함 보조) — 환각 제목 차단
    const similar = (parsed.similarTitles ?? [])
      .map((s) => {
        const t = (s.title ?? '').trim();
        const hit = agendas.find((a) => a.title === t) ?? agendas.find((a) => t && (a.title.includes(t) || t.includes(a.title)));
        return hit ? {
          agendaId: hit.id, title: hit.title, status: hit.status,
          decisionNo: hit.decision?.decisionNo ?? null, committee: hit.committee?.code ?? null,
          reason: s.reason ?? '',
        } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .filter((x, i, arr) => arr.findIndex((y) => y.agendaId === x.agendaId) === i);

    return {
      similar,
      relatedFeatures: (parsed.relatedFeatures ?? []).slice(0, 8),
      questions: (parsed.questions ?? []).slice(0, 6),
      scopeNote: parsed.scopeNote ?? null,
      disclaimer: 'AI 사전 검토 브리핑입니다 — 상정 여부는 제안자 판단이며, 유사 안건이 있어도 상정을 막지 않습니다.',
      checkedAt: new Date().toISOString(),
    };
  }

  // ── 워크벤치 P2: AI 영향 평가 (governance-agenda-workbench.plan.md §5) ──

  /**
   * 컨텍스트는 서버가 결정적으로 조립(D6) — 표면 매핑·현재값·개방 바인딩·출처 실데이터·드리프트.
   * 정책 메타데이터만 다룬다(환자 데이터 접근 경로 없음 — 계약 테스트로 고정).
   */
  async buildAssessContext(agenda: {
    id: string; committeeId: string; title: string; body: string | null;
    sourceRef: unknown; committee?: { code?: string | null; name?: string } | null;
  }) {
    const surfaces = await this.prisma.committeeSurfaceMap.findMany({ where: { committeeId: agenda.committeeId }, orderBy: { surfaceKey: 'asc' } });
    // 🔴 표면값 조회 실패를 `null` 로 접으면 **'미설정'과 '조회 실패'가 같은 모양**이 된다 —
    //    이 값은 위원회 안건 브리핑과 LLM 프롬프트에 그대로 들어간다(위반 집계와 같은 축).
    //    실패는 `valueUnavailable` 로 따로 말하고, currentValue 는 넣지 않는다(모르는 값을 적지 않는다).
    const surfaceValues: { surfaceKey: string; note: string | null; currentValue?: string; valueUnavailable?: true }[] = [];
    for (const s of surfaces) {
      const entry: { surfaceKey: string; note: string | null; currentValue?: string; valueUnavailable?: true } = { surfaceKey: s.surfaceKey, note: s.note };
      if (s.surfaceKey.startsWith('config:')) {
        try {
          const v = await this.config?.get(s.surfaceKey.slice(7));
          entry.currentValue = JSON.stringify(v ?? null).slice(0, 300);
        } catch (e) {
          entry.valueUnavailable = true;
          this.logger.error(`위원회 표면값 조회 실패(${s.surfaceKey}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      surfaceValues.push(entry);
    }

    const src = (agenda.sourceRef ?? null) as { type?: string; key?: string } | null;
    let sourceRefData: Record<string, unknown> | null = null;
    if (src?.type === 'SAFETY_GATE' && src.key) {
      /**
       * 🔴 위반 집계 실패를 `0` 으로 접지 않는다(2026-08-21).
       *    이 수는 위원회가 **게이트를 OFF→WARN→BLOCK 으로 올릴지** 판단할 때 읽는 근거이고,
       *    AI 브리핑 프롬프트에도 그대로 들어간다. 이 저장소에서 이미
       *    `gate_violation_logs` 0행을 "위반 없음"으로 읽었다가 **탐지기가 죽어 있던 것**을
       *    놓친 적이 있다(v4.4.0 DUR 43룰). 못 세었으면 `null`(산출 불가)이라고 말한다.
       */
      const [mode, v30] = await Promise.all([
        this.config?.get(src.key).catch(() => null),
        this.prisma.gateViolationLog
          .count({ where: { gateKey: src.key, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } })
          .catch((e) => {
            this.logger.warn(`게이트 위반 집계 실패 gate=${src.key}: ${(e as Error).message}`);
            return null;
          }),
      ]);
      sourceRefData = {
        type: src.type, key: src.key, currentMode: mode ?? null,
        // null = 산출 불가(0건과 다른 사실) — 소비처는 아래 note 를 함께 읽는다
        violations30d: v30,
        ...(v30 === null ? { violations30dNote: '집계 실패 — 산출 불가(0건이 아님)' } : {}),
      };
    } else if (src?.type === 'FORMULARY_REQUEST' && src.key) {
      const req = await this.prisma.formularyRequest.findUnique({ where: { id: src.key }, select: { domain: true, codeLabel: true, freeText: true, reason: true, urgency: true, status: true } }).catch(() => null);
      sourceRefData = { type: src.type, key: src.key, request: req };
    } else if (src?.type === 'DECISION' && src.key) {
      /**
       * 🔴 결정 등록부에서 올라온 안건 — 위원이 **무엇을 의결하는지**를 안건에서 바로 읽을 수 있어야 한다.
       *    등록부 정본을 그대로 인용한다(여기서 다시 적으면 갈라진다).
       *    선행 조건이 미결이면 **의결해도 적용되지 않는다**는 사실을 함께 싣는다 —
       *    그 사실을 모른 채 의결하면 위원회가 "정했다"고 믿는데 아무 일도 일어나지 않는다.
       */
      const def = DECISION_REGISTRY.find((d) => d.key === src.key);
      sourceRefData = def
        ? {
            type: src.type, key: src.key,
            decision: {
              title: def.title, layer: def.layer, authority: def.authority,
              statusQuo: def.statusQuo, why: def.why,
              options: def.options.map((o) => ({ label: o.label, effect: o.effect })),
              afterDecision: def.afterDecision ?? null,
              approvalPath: def.approvalPath,
              dependsOn: def.dependsOn ?? [],
            },
          }
        : { type: src.type, key: src.key, decisionNote: '🔴 등록부에 없는 결정 키 — 안건 본문만으로 판단해야 한다' };
    } else if (src?.type) {
      sourceRefData = { type: src.type, key: src.key ?? null }; // DATA_QUALITY/GO_LIVE — 근거 수치는 body 인용이 정본
    }

    const health = await this.healthCheck().catch(() => null);
    return {
      agenda: { title: agenda.title, body: GovernanceService.stripHtml(agenda.body ?? '') }, // TipTap HTML 대응
      committee: { code: agenda.committee?.code ?? null, name: agenda.committee?.name ?? null },
      surfaces: surfaceValues,
      openBindingKinds: AUTO_ENACT_KINDS,
      sourceRefData,
      configDriftCount: health?.configDrift.count ?? null,
    };
  }

  /**
   * AI 영향 평가(P2) — 게이트 `governance.ai.enabled`(기본 OFF)·RESOLVED 후 동결(D7)·재생성=교체.
   * 출력은 브리핑이며 위원회 판단을 대체하지 않는다(disclaimer 고정 동봉).
   */
  async assessAgenda(agendaId: string) {
    const enabled = await this.config?.get('governance.ai.enabled').catch(() => false);
    if (!(enabled === true || enabled === 'true')) {
      throw new BadRequestException({ code: 'GOVERNANCE_AI_OFF', message: 'AI 영향 평가가 비활성 상태입니다(governance.ai.enabled)' });
    }
    const agenda = await this.prisma.committeeAgenda.findUnique({
      where: { id: agendaId },
      include: { committee: { select: { code: true, name: true } } },
    });
    if (!agenda) throw new NotFoundException('안건이 없습니다');
    if (agenda.status === 'RESOLVED') {
      throw new ConflictException({ code: 'ASSESS_FROZEN', message: '의결된 안건의 AI 평가는 동결됩니다(의결 근거 감사 가능성)' });
    }

    const context = await this.buildAssessContext(agenda);
    const prompt = [
      '당신은 병원 정보시스템(HIS) 거버넌스 담당자를 돕는 브리핑 도우미다. 아래 위원회 안건과 시스템 실측 컨텍스트를 읽고,',
      '의결 전 검토용 영향 브리핑을 한국어 JSON 으로만 출력하라. 판단·권고 문구는 금지 — 사실 서술과 확인 항목만.',
      '스키마: {"scope":"영향 범위(어떤 표면·화면·역할에 닿는지 2~3문장)","currentState":"현재 상태 요약(컨텍스트 수치 인용)",',
      '"risks":["전환/변경 시 유의점 …"],"checklist":["의결 전 확인 항목 …"],',
      '"bindingSuggestion":"가결 시 쓸 수 있는 집행 바인딩 JSON 예시 1개(개방 kind 안에서·없으면 null)"}',
      '컨텍스트(실측):',
      JSON.stringify(context, null, 1),
    ].join('\n');

    const text = await this.llmGenerate(prompt, 90_000);
    let parsed: Record<string, unknown>;
    try {
      parsed = this.extractJson<Record<string, unknown>>(text);
    } catch {
      parsed = { scope: text.slice(0, 1500), currentState: null, risks: [], checklist: [], bindingSuggestion: null, parseFallback: true };
    }
    const assessment = {
      ...parsed,
      disclaimer: 'AI 브리핑입니다 — 판단·의결은 위원회 몫이며, 이 내용은 근거 검토 보조 자료입니다.',
      model: 'werub/qwen2.5:14b',
      assessedAt: new Date().toISOString(),
      contextDigest: { surfaces: context.surfaces.length, sourceRef: context.sourceRefData?.type ?? null },
    };
    await this.prisma.committeeAgenda.update({ where: { id: agendaId }, data: { aiAssessment: assessment as never, aiAssessedAt: new Date() } });
    return assessment;
  }

  /** WeRU.B ollama generate — formulary.llmGenerate 선례(NDJSON 라인 병합) */
  private async llmGenerate(prompt: string, timeoutMs = 90_000): Promise<string> {
    const cfgs = await this.prisma.systemConfig.findMany({ where: { key: { in: ['ai.server.url', 'ai.server.gpuKey', 'ai.server.enabled'] } } });
    const cfg = new Map(cfgs.map((c) => [c.key, c.value as string]));
    // 🔴 kill switch — 꺼져 있으면 보내지 않는다(r3 B6 · 정본 common/util/ai-kill-switch)
    if (!isAiServerEnabled(cfg.get('ai.server.enabled'))) throw aiDisabledException();
    // 🔴 배포 환경변수가 DB 설정을 이긴다 — 정본 `common/config-env-overrides`
    const url = configEnvOverride('ai.server.url') ?? (cfg.get('ai.server.url') ?? '');
    const key = cfg.get('ai.server.gpuKey') ?? '';
    if (!url) throw new BadRequestException('AI 서버 미설정(ai.server.url)');
    // G3: 목적지 검증 + 경계 통과 감사(정본 common/util/ai-egress-fetch).
    const res = await aiEgressFetch(url, '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt, stream: false, options: { temperature: 0.1 } }),
      signal: AbortSignal.timeout(timeoutMs),
    }, { client: 'gld/governance' });
    if (!res.ok) throw new BadRequestException(`AI 서버 오류: ${res.status}`);
    const raw = await res.text();
    let full = '';
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { full += (JSON.parse(t) as { response?: string }).response ?? ''; } catch { /* skip */ }
    }
    return full;
  }

  /** LLM 출력 JSON 추출 — 중괄호 짝 맞춤(코드펜스·후행 잡음 방어·formulary 선례) */
  private extractJson<T>(text: string): T {
    const start = text.indexOf('{');
    if (start < 0) throw new BadRequestException('AI 응답 파싱 실패');
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)) as T; }
    }
    throw new BadRequestException('AI 응답 파싱 실패(불완전 JSON)');
  }
}
