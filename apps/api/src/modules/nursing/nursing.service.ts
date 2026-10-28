import { BRADEN_RISK_BOUNDS } from '@hospital-run/shared';
import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, Optional, OnModuleInit } from '@nestjs/common';
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { CRITICAL_ALERT_OPEN_STATUSES } from '../lab/critical-value-alert-states';
import { maskPublicName } from '../emergency/er-flow-display.service';
import {
  ageOf,
  stayDays,
  parsePatientQr,
  requiresIndependentDoubleCheck,
  buildDoubleCheckBypassMarker,
  BYPASS_REASON_UNSTATED,
  canScoreNews2,
  normalizeAcvpu,
  normalizeShiftBoundaries,
  isLateNursingEntry,
  normalizeLateEntryGraceMinutes,
  shiftWindowAt,
  handoffActionsOf,
  HOSPITAL_TZ_OFFSET_MIN,
  normalizeRosterWardDepartments,
  ROSTER_WARD_DEPARTMENTS_KEY, joinPatientName, news2MonitoringReference, NEWS2_MONITORING_SOURCE, evaluateBradenRecord, BRADEN_REASSESSMENT_TOOL_VERSION,
  BRADEN_INITIAL_TOOL_VERSION, BRADEN_INPUT_CONFIG_KEY, bradenInputModeOf, bradenTotalOf, readBradenSubscores } from '@hospital-run/shared';
import { createHmac, createHash } from 'crypto';
import { Prisma, MedAdminStatus, ShiftType, IntakeType, OutputType, type FlowSheetEntry } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFlowSheetEntryDto } from './dto/create-flowsheet-entry.dto';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { localDateKey, parseLocalDate } from '../../common/day-range';
import { levenshteinCapped } from '../../common/util/edit-distance';
import { PatientSafetyService } from '../patient-safety/patient-safety.service';
import { JourneyService } from '../journey/journey.service';
import { VitalsIngestService } from '../vitals/vitals-ingest.service';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
import { AdmissionIoReader, FLOWSHEET_IO_FIELDS, summarizeIo } from './admission-io.reader';
import { AiProposalService } from '../ai-proposal/ai-proposal.service';
import { readRiskReassessIntervals } from '../nursing-rules/nursing-rules.read';
import { AUTO_SCHEDULE_ON_ASSESSMENT_KEY, DEFAULT_TOOL_BY_TYPE, scheduleFromInitialScore, type AssessmentType } from '../risk-reassessment/risk-reassessment.policy';
import {
  AdmissionNotFoundError, NursingAssessmentExistsError,
  MedAdminNotFoundError, MedAdminNotScheduledError,
} from '../../domain/errors/domain-error';
import { CreateNursingAssessmentDto } from './dto/create-nursing-assessment.dto';
import { CreateNursingNoteDto } from './dto/create-nursing-note.dto';
import { CreateIntakeOutputDto } from './dto/create-intake-output.dto';
import { recordGateViolation } from '../../common/gate-enforce';
import { assertEnumParam } from '../../common/enum-param';

import { DEV_SECRET_LITERALS } from '../../common/release-security';
/**
 * 투약 기록의 용량 자리표시 문자열 — **투여량이 아니다.**
 * 🔴 MAR 화면 3곳이 `dose: item.dose ?? '처방 용량'` 으로 보내고 있었다.
 *    처방에 용량이 없으면 이 문자열이 그대로 임상기록에 저장된다(모르는 것을 아는 것처럼 기록 = P15).
 */
export const DOSE_PLACEHOLDERS = ['처방 용량', '처방용량', '-', 'N/A'];

/**
 * 🔴 병동 하루의 경계 정본 — 이 파일 안에 **경계가 둘**이었다(시드 흐름 검토 9단계·2026-08-24).
 *
 *   · `getTimeline`·`getFlowSheet` : `new Date(\`${d}T00:00:00+09:00\`)` → **KST 하루**
 *   · `getNotes`·`getIntakeOutputs`·`getIntakeOutputSummary`·`getMedicationSchedule`
 *     : `new Date('YYYY-MM-DD')` → **UTC 자정**(= KST 09:00). 그래서 같은 입원·같은 날짜인데
 *       탭마다 다른 하루를 보여줬다.
 *
 *   운영 실측(2026-08-24 · 입원 `2c993518…` · `GET /intake-outputs/summary?date=2026-05-16`):
 *     화면 `섭취 850 / 배출 1,059 / 균형 -209`  ↔  실제 05-16(KST) `850 / 963 / -113`
 *     — **05-17 08:00 기록이 05-16 칸에 들어가 있었다.** 시간대별 그래프의 `hour 8` 도 그 기록이다.
 *   같은 밴드(KST 00:00~08:59)에 놓인 기록: 간호기록 **171/706** · I/O **40/92** · MAR **61/365**.
 *
 * 🔴 수분 출납은 임상 판단의 입력이다(신장·심부전·수술 후). 하루가 밀리면 균형이 다른 수가 된다.
 * 정본은 `common/day-range.ts`(`parseLocalDate` = 서버 로컬 KST 자정). 여기서만 만든다.
 */
export function nursingDayWindow(date: string): { gte: Date; lt: Date } {
  const gte = parseLocalDate(date);
  // 🔴 파싱 실패는 500 이 아니라 400 — 사용자가 자기 입력 문제인 줄 알아야 한다(급양 축 교훈).
  if (!gte) throw new BadRequestException({ code: 'INVALID_DATE', message: `날짜 형식이 올바르지 않습니다: ${date}` });
  // 🔴 `parseLocalDate` 는 `new Date(y, m-1, d)` 라 범위 밖 값을 **조용히 굴린다**
  //    (`2026-13-99` → 2027-04-08). 조용히 다른 날을 조회하느니 거절한다.
  const raw = String(date).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && localDateKey(gte) !== raw) {
    throw new BadRequestException({ code: 'INVALID_DATE', message: `존재하지 않는 날짜입니다: ${date}` });
  }
  const lt = new Date(gte);
  lt.setDate(lt.getDate() + 1);
  return { gte, lt };
}

/** 날짜 미지정이면 오늘(KST) — 화면이 날짜를 안 보내는 경로도 같은 경계를 쓴다. */
export function nursingDayWindowOrToday(date?: string): { gte: Date; lt: Date } {
  return nursingDayWindow(date ?? localDateKey(new Date()));
}

/**
 * 간호기록 AI 초안 프롬프트 버전 — 제안 원장(`AiProposal.promptVersion`)과 노트 프로비넌스가 **같은 상수**를 쓴다.
 * 🔴 두 곳에 문자열을 따로 적으면 갈라진다(P12).
 */
export const NURSING_AI_PROMPT_VERSION = 'nursing-soap-v1';

/**
 * 상류(WeRU.B)가 **실제로 돌려준** 모델 태그만 꺼낸다 — 없으면 `null`.
 *
 * 🔴 `aiModel: 'weru-b'` 는 **공급자 이름이지 모델 태그가 아니다.** 노트 프로비넌스(`aiModel`)에는
 *    종전 호환을 위해 그대로 남기되, 제안 원장의 `modelRef` 에는 넣지 않는다 — 지어낸 모델 태그가
 *    감독 지표에서 "이 모델이 낸 초안"으로 집계되면 그때부터 그 숫자는 거짓이다.
 * 🔴 스키마 `model_ref` 는 VarChar(64) — 넘치면 저장이 깨지므로 앞 64자만.
 *    (같은 규칙이 `scribe.service.ts pickAiModelName` 에도 있다. 공용 유틸로의 수렴은 이 축의 소유 밖이라 이연.)
 */
export function pickUpstreamModelTag(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const v = o.model_used ?? o.model;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, 64) : null;
}

/** #5 무결성 — AI 초안 draftText 서버 서명(HMAC). ai-draft가 부착, createNote가 검증해 위조(수정량 0 스푸핑) 차단. */
export function signDraftText(draftText: string): string {
  // 🔴 개발 비밀 폴백은 정본 상수 하나로 — REAL 빌드는 이 값으로 떨어지기 전에 부팅을 거부한다(T4-1).
  const secret = process.env.AI_PROVENANCE_SECRET || process.env.PDF_RENDER_SECRET || DEV_SECRET_LITERALS.AI_PROVENANCE_SECRET;
  return createHmac('sha256', secret).update(draftText ?? '').digest('hex').slice(0, 32);
}

/** 간호기록 본문 텍스트 합치기(수정량 비교용). */
export function nursingNoteText(n: {
  subjective?: string | null; objective?: string | null; assessment?: string | null; plan?: string | null;
  focus?: string | null; data?: string | null; action?: string | null; response?: string | null;
  education?: string | null; content?: string | null;
}): string {
  return [n.subjective, n.objective, n.assessment, n.plan, n.focus, n.data, n.action, n.response, n.education, n.content]
    .filter(Boolean).join(' \n ');
}

/**
 * Levenshtein 거리 정본은 `common/util/edit-distance.ts` 로 옮겼다(진료 보조 무수정 승인율도 같은 수를 쓴다).
 * 종전 소비처(테스트 포함)가 그대로 쓰도록 여기서 재수출한다 — 구현·동작 무변경.
 */
export { levenshteinCapped } from '../../common/util/edit-distance';

export interface NursingQaIssue {
  level: 'WARNING' | 'INFO';
  code: string;
  field?: string;
  message: string;
}

// ── F-2 간호과정 제안(규칙기반) ──
export interface CarePlanContext {
  painScore: number | null; mobility: string | null; skinIntegrity: string | null; bradenScore: number | null;
  nutritionStatus: string | null; consciousness: string | null; fallRisk: string | null; ewsRisk: string | null;
  temperature: number | null; spO2: number | null;
}
export interface CarePlanNeed { key: string; nandaKw: string; nicKw: string; nocKw: string; reason: string; confidence: number }
export interface CarePlanDiagnosisSuggestion {
  nandaCode: string; nandaName: string; relatedFactors: string; confidence: number;
  interventions: { nicCode: string; name: string }[]; outcomes: { nocCode?: string; name: string }[];
}

// ── F-3 교대 인수인계 SBAR ──
export interface HandoffSbarResult {
  /** 🔴 감사 귀속용 — 열람 기록의 resourceId 는 환자다(§ai-phi-audit-coverage) */
  patientId: string;
  enabled: boolean; source: string;
  sbar: { situation: string; background: string; assessment: string; recommendation: string };
  items: { unsignedNotes: number; overdueMeds: number; activeDiagnoses: number; hasAssessment?: boolean };
}

/** 평가·EWS·낙상에서 care-plan 매칭 컨텍스트 추출(순수). */
export function buildCarePlanContext(
  a: { painScore?: number | null; mobility?: string | null; skinIntegrity?: string | null; bradenScore?: number | null; nutritionStatus?: string | null; consciousness?: string | null } | null,
  ews: { riskLevel?: string | null; temperature?: unknown; spO2?: number | null } | null,
  fall: { riskLevel?: string | null } | null,
): CarePlanContext {
  return {
    painScore: a?.painScore ?? null,
    mobility: a?.mobility ?? null,
    skinIntegrity: a?.skinIntegrity ?? null,
    bradenScore: a?.bradenScore ?? null,
    nutritionStatus: a?.nutritionStatus ?? null,
    consciousness: a?.consciousness ?? null,
    fallRisk: fall?.riskLevel ?? null,
    ewsRisk: ews?.riskLevel ?? null,
    temperature: ews?.temperature != null ? Number(ews.temperature) : null,
    spO2: ews?.spO2 ?? null,
  };
}

/**
 * 🔴 판정을 켜고 끄는 어휘 집합 — **저장된 값이 집합 밖이면 그 규칙은 조용히 죽는다**
 *    (v4.1.0 누적선량 무력화 · 6단계 `IONIZING_MODALITIES` 와 같은 자리).
 *
 * 이 도메인은 생산자가 둘이고 어휘가 서로 다르다(시드 흐름 검토 9단계 · 2026-08-24 실측):
 *   · 화면 `/inpatient/[admissionId]/nursing/assessment` → 한글
 *     (`독립보행·보조기구 사용·부분 도움·전적 도움·침상안정` / `Alert·Verbal·Pain·Unresponsive` /
 *      `정상·건조·부종·발적·욕창 위험·욕창 있음`)
 *   · 시드 생성기 + 운영 원장 → 영문 enum 표기
 *     (`AMBULATORY·AMBULATORY_ASSIST·BED_REST` 41행 · `INTACT·AT_RISK` · `ALERT`)
 *
 * 종전 정규식은 한글 쪽만 보고 있어 **운영에 저장된 `BED_REST` 11건 · `AMBULATORY_ASSIST` 8건 ·
 * `AT_RISK` 6건이 판정에서 통째로 빠졌고**, 화면이 만드는 `Verbal`(음성에만 반응 = 의식 저하)도
 * 집합 밖이라 정상으로 읽혔다.
 * 🔴 어휘를 지어내 강제하지 않는다 — **이미 생산·저장되는 값을 판정에 넣을 뿐**이다.
 */
export const MOBILITY_IMPAIRED_RE = /제한|침상|도움|의존|보조기구|dependent|불능|BED_?REST|ASSIST|IMMOBIL/i;
export const SKIN_AT_RISK_RE = /손상|발적|욕창|궤양|impair|AT_?RISK|BREAK/i;
export const CONSCIOUSNESS_ALTERED_RE = /CONFUS|VOICE|VERBAL|PAIN|UNRESP|혼동|기면|졸림|반혼수|혼수/i;

/** 컨텍스트 → 간호 요구(need) 규칙 매칭(순수·결정적). 각 need는 NANDA/NIC 키워드 + 근거 + 신뢰도. */
export function matchCarePlanNeeds(ctx: CarePlanContext): CarePlanNeed[] {
  const needs: CarePlanNeed[] = [];
  const bad = (v: string | null, re: RegExp) => !!(v && re.test(v));
  if (ctx.painScore != null && ctx.painScore >= 4) {
    needs.push({ key: 'pain', nandaKw: '통증', nicKw: '통증|진통', nocKw: '통증', reason: `통증 NRS ${ctx.painScore}`, confidence: ctx.painScore >= 7 ? 0.9 : 0.72 });
  }
  // 🔴 (2026-10-07) 종전 셋째 항 `(braden ≤14 && ctx.fallRisk)` 은 fallRisk 가 'LOW' 여도 참 — 낙상 저위험 환자에게 "낙상 위험 LOW" 진단이 제안됐다
  if (ctx.fallRisk === 'HIGH' || ctx.fallRisk === 'MODERATE') {
    needs.push({ key: 'fall', nandaKw: '낙상', nicKw: '낙상|안전|환경', nocKw: '낙상', reason: `낙상 위험 ${ctx.fallRisk}`, confidence: ctx.fallRisk === 'HIGH' ? 0.9 : 0.62 });
  }
  if ((ctx.bradenScore != null && ctx.bradenScore <= BRADEN_RISK_BOUNDS.moderateMax) || bad(ctx.skinIntegrity, SKIN_AT_RISK_RE)) {
    needs.push({ key: 'skin', nandaKw: '피부|조직', nicKw: '피부|욕창|체위', nocKw: '피부|조직', reason: ctx.bradenScore != null ? `Braden ${ctx.bradenScore}(피부손상 위험)` : `피부상태 ${ctx.skinIntegrity}`, confidence: ctx.bradenScore != null && ctx.bradenScore <= BRADEN_RISK_BOUNDS.highMax ? 0.85 : 0.65 });
  }
  if (bad(ctx.mobility, MOBILITY_IMPAIRED_RE)) {
    needs.push({ key: 'mobility', nandaKw: '기동|운동|활동|보행', nicKw: '운동|관절|체위|활동', nocKw: '기동|보행', reason: `기동성 ${ctx.mobility}`, confidence: 0.7 });
  }
  if (bad(ctx.nutritionStatus, /불량|부족|결핍|poor|risk/i)) {
    needs.push({ key: 'nutrition', nandaKw: '영양', nicKw: '영양|식이|섭취', nocKw: '영양', reason: `영양상태 ${ctx.nutritionStatus}`, confidence: 0.68 });
  }
  if (ctx.ewsRisk === 'HIGH' || (ctx.spO2 != null && ctx.spO2 < 92)) {
    needs.push({ key: 'gas', nandaKw: '호흡|가스교환|기도', nicKw: '호흡|산소|기도', nocKw: '호흡|가스교환', reason: ctx.spO2 != null ? `SpO2 ${ctx.spO2}%` : `조기경보 ${ctx.ewsRisk}`, confidence: ctx.ewsRisk === 'HIGH' ? 0.85 : 0.7 });
  }
  if (ctx.temperature != null && ctx.temperature >= 38) {
    needs.push({ key: 'temp', nandaKw: '체온|고체온|감염', nicKw: '체온|발열|감염', nocKw: '체온', reason: `체온 ${ctx.temperature}℃`, confidence: 0.7 });
  }
  if (bad(ctx.consciousness, CONSCIOUSNESS_ALTERED_RE)) {
    needs.push({ key: 'consciousness', nandaKw: '혼동|의식|인지', nicKw: '안전|관찰|신경', nocKw: '의식|신경', reason: `의식 ${ctx.consciousness}`, confidence: 0.6 });
  }
  return needs;
}

export interface NursingDraftCitation {
  field: string; source: string; refId: string; text: string; at?: Date | null;
}
export interface NursingDraftResult {
  source: 'AI' | 'FALLBACK';
  noteType: string;
  draft: Record<string, string | null>;
  citations: NursingDraftCitation[];
  confidence: number;
  provenance: { aiModel: string; aiPromptVersion: string; aiSourceSnapshot: Record<string, unknown> };
}

/**
 * 제안 원장에 사람 결정을 남긴 결과 — 🔴 **기록 실패가 서명을 막지 않는다.**
 * 대신 `recorded:false` + 사유로 그 사실을 말한다(성공처럼 말하지 않는다).
 */
export interface NursingAiProposalDecisionResult {
  proposalId: string;
  recorded: boolean;
  decision?: 'ACCEPTED' | 'EDITED';
  reason?: string;
}

/** 스테이션 보드 인계 피드 상한 — 넘으면 truncated + 전체 수(자르면 잘랐다고 말한다) */
export const STATION_HANDOFF_FEED_LIMIT = 60;

@Injectable()
export class NursingService implements OnModuleInit {
  private readonly logger = new Logger(NursingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly medicalAi?: MedicalAiService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly patientSafety?: PatientSafetyService,
    @Optional() private readonly journey?: JourneyService,
    /** 활력 수집 포트 — 미주입(단위 테스트)이면 아래 `vitalsPort` 가 같은 prisma 로 구성한다 */
    @Optional() private readonly vitalsIngest?: VitalsIngestService,
    /** 🔴 안전 게이트 위반 원장 — 우회를 원장에 남기지 않으면 관제가 "위반 0"으로 보인다 */
    @Optional() private readonly safetyGate?: SafetyGateService,
    /**
     * AI 제안 원장(기획서 §2.1). 🔴 미주입이면 **초안은 나가되 제안은 기록되지 않는다** —
     * 그 사실을 `aiProposalId: null` 로 응답에 말하고 로그를 남긴다(조용히 성공한 척하지 않는다).
     */
    @Optional() private readonly aiProposal?: AiProposalService,
    /** 입원 활력 읽기 정본(플로시트 + 재원 중 외래 원장 · 2026-10-10) — 미주입(단위 테스트)이면 같은 prisma 로 구성 */
    @Optional() private readonly admissionVitalsInjected?: AdmissionVitalsReader,
  ) {}

  /** 입원 I/O 읽기 정본(두 원장 · 2026-10-10) — prisma 만 쓴다 */
  private _ioReader?: AdmissionIoReader;
  private get ioReader(): AdmissionIoReader {
    return (this._ioReader ??= new AdmissionIoReader(this.prisma));
  }

  private _admissionVitalsFallback?: AdmissionVitalsReader;
  private get admissionVitals(): AdmissionVitalsReader {
    return this.admissionVitalsInjected ?? (this._admissionVitalsFallback ??= new AdmissionVitalsReader(this.prisma));
  }

  private _vitalsPortFallback?: VitalsIngestService;
  /**
   * 🔴 포트 우회 경로를 만들지 않기 위한 폴백. DI 로 못 받았다고 해서 `prisma.flowSheetEntry.create` 를
   *    직접 부르면 그 순간 활력 쓰기가 다시 두 벌이 된다(이 축이 정확히 그 결함의 회수다).
   *    포트는 prisma 외에 상태가 없으므로 같은 prisma 로 구성해도 동작이 같다
   *    (이벤트 발행은 입원 라우트에서 애초에 없다 — `EMIT_RECORDED_ROUTES` 참조).
   */
  private get vitalsPort(): VitalsIngestService {
    return this.vitalsIngest ?? (this._vitalsPortFallback ??= new VitalsIngestService(this.prisma));
  }

  async onModuleInit() {
    // 체크리스트 템플릿 시드 — 비차단(실패해도 코드 폴백으로 생성은 산다)
    void this.ensureChecklistTemplatesSeeded().catch((e) =>
      this.logger.warn(`체크리스트 템플릿 시드 실패(폴백 유지): ${e instanceof Error ? e.message : e}`));
  }

  /**
   * 간호기록 AI 보조 게이트(기획 P0·P5 옵트인) — config `nursing.aiAssist.enabled`(기본 OFF).
   * AI 보조 엔드포인트(품질검사·초안 등)는 이 게이트가 ON일 때만 동작. OFF면 기존 흐름 무변경.
   */
  async isAiAssistEnabled(): Promise<boolean> {
    const v = await this.config?.get('nursing.aiAssist.enabled');
    return v === true || v === 'true';
  }

  /**
   * 병동 단위 게이트(파일럿 스코프) — 전역 enabled 이면서, config `nursing.aiAssist.wards`(병동명 배열)가
   * 설정된 경우 해당 병동만 ON. 미설정/빈 배열이면 전역 적용(전 병동). 환자 단위 AI(초안·간호과정·SBAR)에 사용.
   */
  /**
   * 🔴 입원 → 환자 귀속(감사 전용). 열람 기록의 `resourceId` 는 환자이므로 AI 조회 응답은
   * patientId 를 들고 나가야 한다(§ai-phi-audit-coverage). **없으면 `null` 을 돌려준다** —
   * 못 찾은 것을 찾은 척해 다른 ID 를 patientId 자리에 넣지 않는다.
   */
  private async patientIdOfAdmission(admissionId: string): Promise<string | null> {
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true } });
    return adm?.patientId ?? null;
  }

  async isAiAssistEnabledForAdmission(admissionId: string): Promise<boolean> {
    if (!(await this.isAiAssistEnabled())) return false;
    const wards = await this.config?.get('nursing.aiAssist.wards');
    if (!Array.isArray(wards) || wards.length === 0) return true;
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { bed: { select: { ward: { select: { name: true } } } } } });
    const wardName = adm?.bed?.ward?.name;
    return !!wardName && (wards as string[]).includes(wardName);
  }

  /**
   * AI NANDA 간호진단 추천(레거시 ai-nanda) — F-1 모범 패턴 적용:
   * config `nursing.aiAssist.enabled`(+병동 스코프) 게이트. OFF면 기존 응답 형태 그대로 FALLBACK(무동작·FE 비파괴).
   * 평가 JSON은 식별자 필드(id/각종 *Id) 제거 후 전송(PHI 최소화).
   */
  async suggestNandaDiagnosis(admissionId: string) {
    // 🔴 감사 귀속(§ai-phi-audit-coverage) — 이 조회는 이 환자의 기록을 본 것이다.
    //    응답이 patientId 를 들고 있지 않으면 인터셉터가 환자를 못 찾아 열람이 환자별 접근이력에서 빠진다.
    const patientId = await this.patientIdOfAdmission(admissionId);
    if (!this.medicalAi || !(await this.isAiAssistEnabledForAdmission(admissionId))) {
      return { admissionId, patientId, suggestions: null, source: 'FALLBACK' };
    }
    const assessment = await this.prisma.nursingAssessment.findFirst({ where: { admissionId }, orderBy: { createdAt: 'desc' } });
    try {
      const context = assessment ? JSON.stringify(this.stripAiIdentifiers(assessment as unknown as Record<string, unknown>)) : '간호 초기평가 미완료';
      const result = await this.medicalAi.clinicalQa({
        question: `다음 간호평가를 바탕으로 NANDA-I 간호진단 3개를 추천하세요. 진단명(한글), NANDA 코드, 근거를 알려주세요.\n${context}`,
        specialty: 'nursing',
      });
      return { admissionId, patientId, suggestions: result, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI NANDA 추천 실패: ${e}`);
      return { admissionId, patientId, suggestions: null, source: 'FALLBACK' };
    }
  }

  /** AI 전송 전 식별자 필드 제거 — id 및 *Id(admissionId·nurseId·patientId 등) 컬럼 일괄 배제(PHI 최소화). */
  private stripAiIdentifiers(record: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (k === 'id' || /Id$/.test(k)) continue;
      out[k] = v;
    }
    return out;
  }

  /** AI 인수인계 요약 */
  async summarizeHandoff(admissionId: string) {
    const patientId = await this.patientIdOfAdmission(admissionId);
    if (!this.medicalAi) return { admissionId, patientId, summary: null, source: 'FALLBACK' };
    try {
      const notes = await this.prisma.nursingNote.findMany({
        where: { admissionId }, orderBy: { createdAt: 'desc' }, take: 10,
        select: { subjective: true, objective: true, assessment: true, createdAt: true },
      });
      if (!notes.length) return { admissionId, patientId, summary: '간호 기록 없음', source: 'AI' };
      // 입원을 못 찾으면 AI 를 부르지 않는다 — 모르는 환자로 맥락을 만들지 않는다(FK 상 정상 경로에서는 도달하지 않음).
      if (!patientId) return { admissionId, patientId, summary: null, source: 'FALLBACK' };
      const notesText = notes.map(n => `S:${n.subjective ?? ''} O:${n.objective ?? ''} A:${n.assessment ?? ''}`).join('\n');
      const result = await this.medicalAi.autoSoap({
        // 🔴 종전에는 admissionId 를 patientId 자리에 보냈다 — AI 서버의 환자 맥락이 잘못된 키로 쌓인다.
        patientId,
        subjective: notesText,
        deidentify: true, // PHI 최소화(D-2) — 간호 인수인계 요약도 성명 미전송
      });
      return { admissionId, patientId, summary: result, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 인수인계 요약 실패: ${e}`);
      return { admissionId, patientId, summary: null, source: 'FALLBACK' };
    }
  }

  // ── 간호과정 AI 제안(F-2·기획 P2) — NANDA-NIC 마스터 기반(결정적·grounded·환각 0) ──

  /**
   * NursingCode 마스터 검색(참조·ungated) — FE 코드 피커 backbone. codeSystem 정규화(NANDA→NANDA_I).
   * 운영 시드 실측(2026-08-14 · nursing_codes GROUP BY code_system):
   *   NANDA_I 58 · NIC 50 · NOC 12 · ICF 13 · MedDRA 34.
   * 🔴 W8-R3 — 종전 주석은 "NOC 미시드"였다. NOC 는 fbee3524 에서 시드됐는데 주석만 남아,
   *   그 잘못된 전제가 아래 suggestCarePlan 설명까지 "outcomes 는 비움"으로 오도하고 있었다.
   *   (코드 자체는 이미 NOC 를 조회·매칭하고 있었다 — 틀린 것은 주석뿐이다.)
   */
  async searchNursingCodes(system?: string, q?: string, limit = 30) {
    const sysMap: Record<string, string> = { NANDA: 'NANDA_I', 'NANDA-I': 'NANDA_I', NANDA_I: 'NANDA_I', NIC: 'NIC', NOC: 'NOC', ICF: 'ICF' };
    const where: Prisma.NursingCodeWhereInput = {};
    if (system) where.codeSystem = sysMap[system.toUpperCase()] ?? system;
    if (q?.trim()) where.OR = [{ nameKo: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { nameEn: { contains: q, mode: 'insensitive' } }];
    const rows = await this.prisma.nursingCode.findMany({ where, orderBy: [{ codeSystem: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }], take: Math.min(100, Math.max(1, limit)), select: { codeSystem: true, code: true, nameKo: true, nameEn: true, domain: true, class: true, definition: true } });
    return { data: rows };
  }

  /**
   * F-2 간호과정 제안(게이트) — 간호초기평가·EWS·낙상 데이터를 **결정적 규칙**으로 NANDA-NIC 마스터에
   * 매칭(코드는 마스터에서만·환각 0). 신뢰도·관련요인 동봉. 간호사가 선택해 createDiagnosis/addIntervention 으로 확정.
   * 🔴 W8-R3(2026-08-14) — 종전 주석은 "NOC 미시드라 outcomes 는 비움"이었다. 실측상 NOC 12건이
   *   DB 에 실재하고(0200 보행·0208 기동성·0402/0415 호흡·0800 체온조절·0912 의식·1004 영양·
   *   1101 조직통합성·1605/2102 통증·1909/1912 낙상) 코드도 이미 그 12건을 매칭해 outcomes 를 채운다.
   *   NOC 연결의 근거는 임의 매핑이 아니라 needs 규칙표의 `nocKw`(matchCarePlanNeeds) 하나이며,
   *   NANDA·NIC 과 완전히 같은 방식(마스터 nameKo/domain 키워드 대조)이다 — 코드는 마스터에서만 나온다.
   *   매칭되는 NOC 가 없는 need 는 **비운 채로 둔다**(임상 매핑 날조 금지 — 없는 연결을 지어내지 않는다).
   * AI 미사용(P2 규칙기반·견고). source='RULE'.
   */
  async suggestCarePlan(admissionId: string) {
    if (!(await this.isAiAssistEnabledForAdmission(admissionId))) {
      throw new BadRequestException({ code: 'AI_ASSIST_DISABLED', message: '간호기록 AI 보조가 비활성 상태입니다.' });
    }
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, patientId: true } });
    if (!admission) throw new AdmissionNotFoundError(admissionId);
    const [assessment, ews, fall, nanda, nic, noc] = await Promise.all([
      this.prisma.nursingAssessment.findFirst({ where: { admissionId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.earlyWarningScore.findFirst({ where: { patientId: admission.patientId }, orderBy: { recordedAt: 'desc' } }),
      this.prisma.fallRiskAssessment.findFirst({ where: { patientId: admission.patientId }, orderBy: { assessedAt: 'desc' } }),
      this.prisma.nursingCode.findMany({ where: { codeSystem: 'NANDA_I' }, select: { code: true, nameKo: true, domain: true } }),
      this.prisma.nursingCode.findMany({ where: { codeSystem: 'NIC' }, select: { code: true, nameKo: true, domain: true } }),
      this.prisma.nursingCode.findMany({ where: { codeSystem: 'NOC' }, select: { code: true, nameKo: true, domain: true } }),
    ]);

    const ctx = buildCarePlanContext(assessment, ews, fall);
    const needs = matchCarePlanNeeds(ctx);
    const seen = new Set<string>();
    const diagnoses: CarePlanDiagnosisSuggestion[] = [];
    for (const need of needs) {
      const re = new RegExp(need.nandaKw);
      const match = nanda.find((c) => re.test(c.nameKo) || (c.domain ? re.test(c.domain) : false));
      if (!match || seen.has(match.code)) continue;
      seen.add(match.code);
      const nicRe = new RegExp(need.nicKw);
      const interventions = nic.filter((c) => nicRe.test(c.nameKo) || (c.domain ? nicRe.test(c.domain) : false)).slice(0, 3)
        .map((c) => ({ nicCode: c.code, name: c.nameKo }));
      const nocRe = new RegExp(need.nocKw);
      const outcomes = noc.filter((c) => nocRe.test(c.nameKo) || (c.domain ? nocRe.test(c.domain) : false)).slice(0, 2)
        .map((c) => ({ nocCode: c.code, name: c.nameKo }));
      diagnoses.push({ nandaCode: match.code, nandaName: match.nameKo, relatedFactors: need.reason, confidence: need.confidence, interventions, outcomes });
    }
    diagnoses.sort((a, b) => b.confidence - a.confidence);
    return { patientId: admission.patientId, enabled: true, source: 'RULE', hasAssessment: !!assessment, diagnoses };
  }

  /**
   * F-3 교대 인수인계 SBAR(게이트) — 입원·EWS·낙상·활성 간호진단·미서명 기록·투약 지연을 **결정적**으로
   * SBAR(Situation/Background/Assessment/Recommendation)로 구성(데이터 근거·환각 0). 간호사 검토용 읽기 보조.
   * 법적 NursingNote 와 분리(인계 브리핑). 저장은 간호사 판단(미저장·복사/확인).
   */
  async generateHandoffSbar(admissionId: string): Promise<HandoffSbarResult> {
    if (!(await this.isAiAssistEnabledForAdmission(admissionId))) {
      throw new BadRequestException({ code: 'AI_ASSIST_DISABLED', message: '간호기록 AI 보조가 비활성 상태입니다.' });
    }
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      include: {
        patient: { select: { familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } },
      },
    });
    if (!admission) throw new AdmissionNotFoundError(admissionId);
    const now = new Date();
    const [ews, fall, assessments, unsignedNotes, pendingMar, overdueTotal] = await Promise.all([
      this.prisma.earlyWarningScore.findFirst({ where: { patientId: admission.patientId }, orderBy: { recordedAt: 'desc' } }),
      this.prisma.fallRiskAssessment.findFirst({ where: { patientId: admission.patientId }, orderBy: { assessedAt: 'desc' } }),
      this.prisma.nursingAssessment.findMany({ where: { admissionId }, select: { diagnoses: { where: { status: 'ACTIVE' }, select: { nandaName: true } } } }),
      this.prisma.nursingNote.count({ where: { admissionId, status: 'DRAFT' } }),
      this.prisma.medicationAdministration.findMany({
        where: { patientId: admission.patientId, status: 'SCHEDULED', scheduledAt: { lt: now } },
        orderBy: { scheduledAt: 'asc' }, take: 10,
        include: { prescription: { select: { medicationCode: { select: { nameKo: true } } } } },
      }),
      // 이름은 10건까지만 싣는다 — 건수는 전체로(잘린 수를 전체로 말하지 않는다)
      this.prisma.medicationAdministration.count({ where: { patientId: admission.patientId, status: 'SCHEDULED', scheduledAt: { lt: now } } }),
    ]);

    const activeDx = assessments.flatMap((a) => a.diagnoses).map((d) => d.nandaName);
    const days = stayDays(admission.admitDate, admission.dischargeDate) ?? 1;
    const p = admission.patient;
    const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim() || '환자';
    const age = p?.dateOfBirth ? ageOf(p.dateOfBirth, now) : null;
    const sex = p?.gender === 'MALE' ? '남' : p?.gender === 'FEMALE' ? '여' : '';
    const loc = [admission.bed?.ward?.name, admission.bed ? `${admission.bed.roomNumber}-${admission.bed.bedNumber}` : null].filter(Boolean).join(' ');
    const fmt = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const situation = `${loc ? loc + ' · ' : ''}${name}(${[age ? `${age}세` : '', sex].filter(Boolean).join('/')}) · 재원 ${days}일${admission.admitReason ? ` · 입원사유: ${admission.admitReason}` : ''}`;
    // 🔴 (2026-10-07) 초기평가가 없을 때도 "활성 간호진단 없음"이라 했다 — 없음과 기록 없음을 가른다
    const background = activeDx.length ? `활성 간호진단: ${activeDx.join(', ')}`
      : assessments.length ? '활성 간호진단 없음(간호사정 기록 있음)' : '간호사정 기록 없음 — 간호진단을 확인할 수 없음';

    const aLines: string[] = [];
    if (ews) aLines.push(`V/S ${fmt(ews.recordedAt)} BP ${ews.systolicBp} HR ${ews.heartRate} SpO2 ${ews.spO2}% BT ${ews.temperature}℃ 의식 ${ews.consciousness}; NEWS2 ${ews.totalScore}(${ews.riskLevel})`);
    if (fall) aLines.push(`낙상 위험 ${fall.riskLevel}(${fall.score})`);
    // 🔴 (2026-10-07) "특이 활력징후·위험 데이터 없음" 은 '데이터 없음'과 '이상 없음'을 한 문장에 섞었다 — 빠진 것을 항목별로
    if (!ews) aLines.push('활력·NEWS2 기록 없음');
    if (!fall) aLines.push('낙상 평가 기록 없음');
    const assessment = aLines.join(' / ');

    const recItems: string[] = [];
    if (unsignedNotes > 0) recItems.push(`미서명 간호기록 ${unsignedNotes}건 — 교대 전 서명 확인`);
    if (overdueTotal > 0) {
      const meds = pendingMar.map((m) => m.prescription?.medicationCode?.nameKo).filter(Boolean);
      recItems.push(`투약 지연 ${overdueTotal}건${meds.length ? `: ${meds.join(', ')}${overdueTotal > pendingMar.length ? ` 외 ${overdueTotal - pendingMar.length}건` : ''}` : ''}`);
    }
    if (ews && (ews.riskLevel === 'HIGH' || ews.riskLevel === 'MEDIUM')) recItems.push(`조기경보 ${ews.riskLevel} — 모니터링 강화`);
    if (fall && fall.riskLevel === 'HIGH') recItems.push('낙상 고위험 — 예방중재 유지');
    // 🔴 (2026-10-07) "특이 인계사항 없음"은 이 초안이 보지 않은 항목(위급값·격리·금식·수술)까지 없다고 말했다(P17) — 본 범위를 밝힌다
    const scopeNote = '※ 이 초안은 미서명 기록·투약 지연·조기경보·낙상만 봅니다 — 위급값·격리·금식·수술 일정은 간호 스테이션 보드에서 확인';
    const recommendation = (recItems.length ? recItems.map((r, i) => `${i + 1}. ${r}`).join('\n') : '본 항목에서 나온 인계 사항 없음') + '\n' + scopeNote;

    return { patientId: admission.patientId, enabled: true, source: 'DATA', sbar: { situation, background, assessment, recommendation }, items: { unsignedNotes, overdueMeds: overdueTotal, activeDiagnoses: activeDx.length, hasAssessment: assessments.length > 0 } };
  }

  // ── 간호초기평가 ──

  async createAssessment(admissionId: string, dto: CreateNursingAssessmentDto, nurseId: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new AdmissionNotFoundError(admissionId);

    const existing = await this.prisma.nursingAssessment.findFirst({ where: { admissionId } });
    if (existing) throw new NursingAssessmentExistsError(admissionId);

    // 원내 결정 두 가지(2026-10-10) — 설정 미주입(단위 테스트·부분 부트)이면 현행(총점만 · 자동 일정 없음)으로 접는다
    const [inputRaw, autoRaw] = await Promise.all([
      this.config ? this.config.get(BRADEN_INPUT_CONFIG_KEY) : null,
      this.config ? this.config.get(AUTO_SCHEDULE_ON_ASSESSMENT_KEY) : null,
    ]);
    const bradenInput = bradenInputModeOf(inputRaw);
    const autoSchedule = autoRaw === true;

    // ── Braden 하위 항목 ──
    //  · SUBSCORES: 총점만 보내면 거부(하위 항목이 결정의 내용이다) · 6항목 전부 · 총점은 합
    //  · TOTAL(현행): 총점 칸 그대로 — 하위 항목을 보냈으면 같은 규칙으로 검사해 함께 남긴다(받은 근거를 버리지 않는다)
    let bradenScore = dto.bradenScore;
    let subscores: Record<string, number> | null = null;
    if (dto.bradenSubscores != null) {
      const { scores, invalid } = readBradenSubscores(dto.bradenSubscores);
      if (invalid.length) throw new BadRequestException({ code: 'BRADEN_SUBSCORE_RANGE', message: 'Braden 항목 점수가 범위를 벗어났습니다.', details: { items: invalid } });
      const sum = bradenTotalOf(scores);
      if (sum == null) throw new BadRequestException({ code: 'BRADEN_INCOMPLETE', message: 'Braden 은 6항목을 모두 골라야 저장됩니다.' });
      if (bradenScore != null && bradenScore !== sum) throw new BadRequestException({ code: 'BRADEN_SUM_MISMATCH', message: 'Braden 항목 합이 총점과 다릅니다.', details: { sum, total: bradenScore } });
      bradenScore = sum;
      subscores = scores as Record<string, number>;
    } else if (bradenInput === 'SUBSCORES' && bradenScore != null) {
      throw new BadRequestException({ code: 'BRADEN_SUBSCORES_REQUIRED', message: '원내 결정에 따라 Braden 은 6항목을 골라 입력합니다(총점만은 받지 않습니다).' });
    }

    // 낙상 점수 — 초기평가가 가리키는 낙상 평가 행(Morse · 서버가 재산정한 점수)
    const fall = autoSchedule && dto.fallRiskAssessmentId
      ? await this.prisma.fallRiskAssessment.findUnique({ where: { id: dto.fallRiskAssessmentId }, select: { score: true, patientId: true } })
      : null;
    const assessedAt = dto.assessedAt ? new Date(dto.assessedAt) : new Date();
    const nurseName = subscores ? await this.prisma.user.findUnique({ where: { id: nurseId }, select: { familyName: true, givenName: true } }) : null;

    // 초기평가·Braden 이력 행·재평가 일정을 한 트랜잭션으로 — 하나가 실패하면 초기평가도 남기지 않는다(반쪽 기록 없음)
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.nursingAssessment.create({
        data: {
          admissionId,
          nurseId,
          consciousness: dto.consciousness,
          mobility: dto.mobility,
          painScore: dto.painScore,
          painLocation: dto.painLocation,
          nutritionStatus: dto.nutritionStatus,
          skinIntegrity: dto.skinIntegrity,
          fallRiskAssessmentId: dto.fallRiskAssessmentId,
          bradenScore,
          allergyConfirmed: dto.allergyConfirmed ?? false,
          additionalData: dto.additionalData as unknown as Prisma.InputJsonValue,
          assessedAt,
        },
        include: {
          nurse: { select: { id: true, familyName: true, givenName: true } },
          fallRiskAssessment: true,
          diagnoses: true,
        },
      });

      // 하위 항목은 Braden 이력 원장(임상 도구 결과 BRADEN)에 — 초기평가와 잇는 표식(nursingAssessmentId)·출처 버전
      if (subscores) {
        await tx.clinicalChartResult.create({
          data: {
            patientId: admission.patientId,
            chartId: 'BRADEN',
            chartName: 'Braden Scale',
            archetype: 'scoring',
            sourceVersion: null,
            inputs: { scores: subscores, nursingAssessmentId: created.id } as Prisma.InputJsonValue,
            resultValue: bradenScore,
            resultLevel: scheduleFromInitialScore('PRESSURE_ULCER', bradenScore, assessedAt)?.lastRiskLevel ?? null,
            performedBy: nurseId,
            performedByName: (nurseName ? joinPatientName(nurseName.familyName, nurseName.givenName) : '') || '미상',
            usedToolVersion: BRADEN_INITIAL_TOOL_VERSION,
            performedAt: assessedAt,
          },
        });
      }

      // ── 재평가 일정 자동 생성(결정 켜짐일 때만) ──
      //  · 점수가 있는 유형만 · 이미 열린 같은 유형 일정이 있으면 만들지 않는다(멱등 — 입원 시 자동 생성분·수동 생성분 포함)
      const autoSchedules: { enabled: boolean; created: AssessmentType[]; skipped: Array<{ type: AssessmentType; reason: 'NO_SCORE' | 'EXISTS' }> } = { enabled: autoSchedule, created: [], skipped: [] };
      if (autoSchedule) {
        const scores: Record<AssessmentType, number | null | undefined> = {
          FALL_RISK: fall && fall.patientId === admission.patientId ? fall.score : null,
          PRESSURE_ULCER: bradenScore,
        };
        const open = await tx.riskReassessmentSchedule.findMany({
          where: { patientId: admission.patientId, isActive: true, OR: [{ admissionId }, { admissionId: null }] },
          select: { assessmentType: true },
        });
        const have = new Set(open.map((o) => o.assessmentType));
        // 주기 = 원내 규정(비면 코드 기본값) · 2026-10-27
        const { table: intervals } = await readRiskReassessIntervals(this.config);
        for (const type of ['FALL_RISK', 'PRESSURE_ULCER'] as AssessmentType[]) {
          if (have.has(type)) { autoSchedules.skipped.push({ type, reason: 'EXISTS' }); continue; }
          const v = scheduleFromInitialScore(type, scores[type], assessedAt, intervals);
          if (!v) { autoSchedules.skipped.push({ type, reason: 'NO_SCORE' }); continue; }
          await tx.riskReassessmentSchedule.create({
            data: {
              patientId: admission.patientId, admissionId, assessmentType: type, toolName: DEFAULT_TOOL_BY_TYPE[type],
              intervalHours: v.intervalHours, nextDueAt: v.nextDueAt,
              lastScore: v.lastScore, lastRiskLevel: v.lastRiskLevel, lastAssessedAt: assessedAt, lastAssessedBy: nurseId,
              isActive: true,
            },
          });
          autoSchedules.created.push(type);
        }
      }
      return { ...created, bradenInput, autoSchedules };
    });
  }

  async getAssessment(admissionId: string) {
    const assessment = await this.prisma.nursingAssessment.findFirst({
      where: { admissionId },
      include: {
        nurse: { select: { id: true, familyName: true, givenName: true } },
        fallRiskAssessment: true,
        diagnoses: { include: { nurse: { select: { id: true, familyName: true, givenName: true } } } },
      },
    });
    if (!assessment) throw new NotFoundException('Nursing assessment not found');
    return assessment;
  }

  // ── 간호진단 ──

  async createDiagnosis(assessmentId: string, data: {
    nandaCode: string; nandaName: string; relatedFactors?: string;
    definingCharacteristics?: string; expectedOutcome: string;
  }, nurseId: string) {
    const assessment = await this.prisma.nursingAssessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) throw new NotFoundException('Nursing assessment not found');

    return this.prisma.nursingDiagnosis.create({
      data: {
        assessmentId,
        nurseId,
        nandaCode: data.nandaCode,
        nandaName: data.nandaName,
        relatedFactors: data.relatedFactors,
        definingCharacteristics: data.definingCharacteristics,
        expectedOutcome: data.expectedOutcome,
      },
      include: { nurse: { select: { id: true, familyName: true, givenName: true } } },
    });
  }

  /**
   * 🔴 없는 평가의 진단 목록은 **빈 목록이 아니라 404** — 같은 `assessmentId` 에 POST 는 404 를 내는데
   *    GET 만 `[]` 를 돌려주면 화면은 "그런 평가 없음"을 "진단 0건"으로 그린다(§1 표본 부재 ≠ 진짜 0).
   */
  async getDiagnoses(assessmentId: string) {
    const assessment = await this.prisma.nursingAssessment.findUnique({ where: { id: assessmentId }, select: { id: true } });
    if (!assessment) throw new NotFoundException('Nursing assessment not found');

    return this.prisma.nursingDiagnosis.findMany({
      where: { assessmentId },
      orderBy: { createdAt: 'desc' },
      include: {
        nurse: { select: { id: true, familyName: true, givenName: true } },
        interventions: { orderBy: { createdAt: 'asc' } }, // NIC(다)
        outcomes: { orderBy: { createdAt: 'asc' } }, // NOC(다)
      },
    });
  }

  async resolveDiagnosis(id: string) {
    const diagnosis = await this.prisma.nursingDiagnosis.findUnique({ where: { id } });
    if (!diagnosis) throw new NotFoundException('Nursing diagnosis not found');
    if (diagnosis.status === 'RESOLVED') {
      throw new BadRequestException('Nursing diagnosis is already resolved');
    }

    return this.prisma.nursingDiagnosis.update({
      where: { id },
      data: { status: 'RESOLVED' },
      include: { nurse: { select: { id: true, familyName: true, givenName: true } } },
    });
  }

  // ── 간호과정 NIC/NOC(다) — 진단→중재→결과(ADPIE) ──

  /** 간호중재(NIC) 추가 */
  async addIntervention(diagnosisId: string, dto: { nicCode?: string; name: string; detail?: string; frequency?: string }, nurseId: string) {
    const dx = await this.prisma.nursingDiagnosis.findUnique({ where: { id: diagnosisId } });
    if (!dx) throw new NotFoundException('간호진단을 찾을 수 없습니다');
    return this.prisma.nursingIntervention.create({
      data: { nursingDiagnosisId: diagnosisId, nicCode: dto.nicCode ?? null, name: dto.name, detail: dto.detail ?? null, frequency: dto.frequency ?? null, createdBy: nurseId },
    });
  }

  /** 간호중재 상태 변경(PLANNED/ACTIVE/COMPLETED/DISCONTINUED) */
  /**
   * 간호중재 상태 변경 — 🔴 **이행은 상태가 아니라 기록이다.**
   *
   * 종전에는 `status` 만 바꿨다. 그래서 "COMPLETED" 로 되어 있어도 **누가 언제 했는지 알 수 없었고**,
   * 낙상 예방 중재처럼 그 자체가 안전 지표의 분자인 항목이 원장에서 증명되지 않았다
   * (계획서 1단계 1-7 "계획만 있고 이행이 없다").
   *
   * 🔴 COMPLETED 로 옮기는 순간 **수행자·수행시각을 함께 적는다** — 나중에 채우게 두면 영영 비어 있다.
   *    되돌릴 때(PLANNED/ACTIVE)는 수행 기록을 지우지 않는다(했던 사실은 사실이다).
   */
  async updateIntervention(id: string, status: string, nurseId?: string, note?: string) {
    if (!['PLANNED', 'ACTIVE', 'COMPLETED', 'DISCONTINUED'].includes(status)) throw new BadRequestException('잘못된 상태');
    const current = await this.prisma.nursingIntervention.findUnique({ where: { id }, select: { performedAt: true } });
    if (!current) throw new NotFoundException('간호중재를 찾을 수 없습니다');

    const marksPerformed = status === 'COMPLETED' && !current.performedAt;
    if (status === 'COMPLETED' && !nurseId && !current.performedAt) {
      // 🔴 수행자를 모르면 "수행했다"고 적지 않는다(모르는 것을 원장에 박지 않는다)
      throw new BadRequestException('수행자를 알 수 없어 이행으로 기록할 수 없습니다.');
    }
    return this.prisma.nursingIntervention.update({
      where: { id },
      data: {
        status,
        ...(marksPerformed ? { performedBy: nurseId, performedAt: new Date() } : {}),
        ...(note !== undefined ? { performedNote: note || null } : {}),
      },
    });
  }

  /** 간호결과(NOC) 추가 — 기대결과/목표 */
  async addOutcome(diagnosisId: string, dto: { nocCode?: string; name: string; baselineScore?: number; targetScore?: number }, nurseId: string) {
    const dx = await this.prisma.nursingDiagnosis.findUnique({ where: { id: diagnosisId } });
    if (!dx) throw new NotFoundException('간호진단을 찾을 수 없습니다');
    return this.prisma.nursingOutcome.create({
      data: { nursingDiagnosisId: diagnosisId, nocCode: dto.nocCode ?? null, name: dto.name, baselineScore: dto.baselineScore ?? null, targetScore: dto.targetScore ?? null, createdBy: nurseId },
    });
  }

  /** 간호결과 평가 — 현재 점수 기록 + 달성 상태 산정 */
  async evaluateOutcome(id: string, currentScore: number, nurseId: string) {
    // 🔴 인라인 @Body('currentScore') 는 ValidationPipe 를 건너뛴다 → 비수치면 @db.Int 가 500,
    //    NaN 비교는 달성도를 늘 NOT_MET 으로 만든다. 수치·범위를 서비스가 지킨다(Likert 척도).
    if (!Number.isInteger(currentScore) || currentScore < 0 || currentScore > 100) {
      throw new BadRequestException('현재 점수는 0~100 사이의 정수여야 합니다.');
    }
    const oc = await this.prisma.nursingOutcome.findUnique({ where: { id } });
    if (!oc) throw new NotFoundException('간호결과를 찾을 수 없습니다');
    const target = oc.targetScore ?? currentScore;
    const status = currentScore >= target ? 'MET' : (oc.baselineScore != null && currentScore > oc.baselineScore ? 'PARTIALLY_MET' : 'NOT_MET');
    return this.prisma.nursingOutcome.update({
      where: { id },
      data: { currentScore, status, evaluatedAt: new Date(), evaluatedBy: nurseId },
    });
  }

  /** 간호계획서(care plan) — 입원 건의 ADPIE 전체: 사정→진단(NANDA)→중재(NIC)→결과(NOC). */
  async getCarePlan(admissionId: string) {
    const assessments = await this.prisma.nursingAssessment.findMany({
      where: { admissionId },
      orderBy: { assessedAt: 'desc' },
      include: {
        diagnoses: {
          orderBy: { createdAt: 'desc' },
          include: { interventions: { orderBy: { createdAt: 'asc' } }, outcomes: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    const diagnoses = assessments.flatMap((a) => a.diagnoses);
    return {
      admissionId,
      assessmentCount: assessments.length,
      // FE care-plan 화면이 사정 기준으로 진단/제안을 게이팅 → 사정 배열(진단 포함) 반환 필수.
      assessments: assessments.map((a) => ({ id: a.id, assessedAt: a.assessedAt, diagnoses: a.diagnoses })),
      diagnoses,
      summary: {
        total: diagnoses.length,
        active: diagnoses.filter((d) => d.status === 'ACTIVE').length,
        resolved: diagnoses.filter((d) => d.status === 'RESOLVED').length,
        interventions: diagnoses.reduce((s, d) => s + d.interventions.length, 0),
        outcomes: diagnoses.reduce((s, d) => s + d.outcomes.length, 0),
        outcomesMet: diagnoses.reduce((s, d) => s + d.outcomes.filter((o) => o.status === 'MET').length, 0),
      },
    };
  }

  // ── 간호일지 ──

  async createNote(admissionId: string, dto: CreateNursingNoteDto, nurseId: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new AdmissionNotFoundError(admissionId);
    // #5 무결성 — aiProvenance 동봉 시 snapshot 서명 검증(위조 draftText로 수정량 0 스푸핑 차단).
    if (dto.aiProvenance) {
      const snap = dto.aiProvenance.aiSourceSnapshot as { draftText?: unknown; sig?: unknown } | undefined;
      if (!snap || typeof snap.draftText !== 'string' || snap.sig !== signDraftText(snap.draftText)) {
        throw new BadRequestException({ code: 'AI_PROVENANCE_INVALID', message: 'AI 초안 서명 검증 실패(변조). 초안을 다시 생성하세요.' });
      }
    }

    // 🔴 작성=서명 경로(dto.draft 미지정)는 `signNote` 를 지나지 않는다 — 제안 원장의 결정도 **여기서** 남겨야 한다.
    //    이 경로를 빼면 실제 주 경로의 제안이 영원히 PRESENTED 로 남아 감독 지표가 "아무도 결정하지 않았다"고 말한다.
    const snapshot = dto.aiProvenance?.aiSourceSnapshot as Record<string, unknown> | undefined;
    const immediateFinalText = nursingNoteText(dto);
    let immediateEditDistance: number | null = null;
    if (dto.aiProvenance && !dto.draft) {
      const dt = snapshot?.draftText;
      if (typeof dt === 'string') immediateEditDistance = levenshteinCapped(dt, immediateFinalText);
    }

    // 기록 시각은 과거로만(늦게 적는 것은 허용·표식) — 미래 시각은 아직 일어나지 않은 관찰이다
    if (dto.recordedAt && new Date(dto.recordedAt).getTime() > Date.now() + NursingService.RECORDED_AT_FUTURE_GRACE_MS) {
      throw new BadRequestException({ code: 'NOTE_RECORDED_AT_FUTURE', message: 'The observation time cannot be in the future' });
    }

    const note = await this.prisma.nursingNote.create({
      data: {
        admissionId,
        nurseId,
        noteType: dto.noteType,
        focus: dto.focus,
        data: dto.data,
        action: dto.action,
        response: dto.response,
        content: dto.content,
        // SOAP(S/O/A/P)·교육·우선순위 영속화(종전 누락 복구)
        subjective: dto.subjective,
        objective: dto.objective,
        assessment: dto.assessment,
        plan: dto.plan,
        education: dto.education,
        priority: dto.priority,
        shiftType: dto.shiftType,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        // 무결성(가): 작성=서명(append-only). 명시적 draft=true면 미서명 상태로 보관.
        status: dto.draft ? 'DRAFT' : 'SIGNED',
        signedBy: dto.draft ? null : nurseId,
        signedAt: dto.draft ? null : new Date(),
        // AI 보조 프로비넌스(F-1) — AI는 저자 아님. 책임=signedBy 간호사 불변.
        ...(dto.aiProvenance
          ? {
              aiAssisted: true,
              aiModel: dto.aiProvenance.aiModel ?? null,
              aiPromptVersion: dto.aiProvenance.aiPromptVersion ?? null,
              // 🔴 `aiProposalId` 를 포함한 스냅샷을 **그대로** 보존한다(새 컬럼 없이 제안 원장과 이어지는 유일한 실).
              aiSourceSnapshot: (dto.aiProvenance.aiSourceSnapshot ?? null) as Prisma.InputJsonValue,
              // 즉시 서명(draft 미지정·작성=서명) 경로는 signNote 미경유 → 여기서 수정량 계산(과신 모니터·MOI.11.1.1)
              ...(immediateEditDistance != null ? { aiEditDistance: immediateEditDistance } : {}),
            }
          : {}),
      },
      include: { nurse: { select: { id: true, familyName: true, givenName: true } } },
    });

    // 저장 **직후** 제안 원장 결정 — 실패해도 기록은 되돌리지 않고 반환값으로만 말한다(§2.1 · 판정규칙 §6 기록≠적용)
    const aiProposalDecision = dto.draft
      ? null // DRAFT 로 보관 → 아직 사람이 결정한 것이 아니다. 결정은 `signNote` 에서.
      : await this.decideNursingProposal(snapshot, immediateEditDistance, immediateFinalText, nurseId, 'nursing-createNote');
    return aiProposalDecision ? { ...note, aiProposalDecision } : note;
  }

  /** 간호기록 서명(가) — DRAFT를 본인이 서명해 확정(SIGNED). 작성자만. */
  /**
   * 🔴 (2026-09-16) 간호기록 경로는 `admissions/:admissionId/nursing-notes/:noteId/...` 인데 입원 id 를 버리고
   *    기록 id 만으로 서명·정정·품질검사를 했다 — 다른 입원(다른 환자)의 간호기록을 이 경로로 정정하고 읽을 수 있었다.
   *    체크리스트(2026-09-15)와 같은 결함이다. 소속이 다르면 존재를 알려주지 않는다(404).
   */
  private async nursingNoteInAdmission(admissionId: string, noteId: string) {
    const note = await this.prisma.nursingNote.findFirst({ where: { id: noteId, admissionId } });
    if (!note) throw new NotFoundException('간호기록을 찾을 수 없습니다');
    return note;
  }

  async signNote(admissionId: string, noteId: string, nurseId: string) {
    const note = await this.nursingNoteInAdmission(admissionId, noteId);
    if (note.status === 'SIGNED') return note; // 이미 서명됨(멱등)
    if (note.nurseId !== nurseId) throw new BadRequestException('작성 간호사만 서명할 수 있습니다');
    // AI 보조 노트: 서명 시점에 수정량(aiEditDistance) 1회 계산(과신 모니터·JCI MOI.11.1.1).
    let aiEditDistance: number | undefined;
    if (note.aiAssisted && note.aiEditDistance == null) {
      const draftText = (note.aiSourceSnapshot as { draftText?: unknown } | null)?.draftText;
      if (typeof draftText === 'string') aiEditDistance = levenshteinCapped(draftText, nursingNoteText(note));
    }
    const signed = await this.prisma.nursingNote.update({
      where: { id: noteId },
      data: { status: 'SIGNED', signedBy: nurseId, signedAt: new Date(), ...(aiEditDistance != null ? { aiEditDistance } : {}) },
      include: { nurse: { select: { id: true, familyName: true, givenName: true } } },
    });

    // 🔴 서명은 이미 끝났다. 제안 원장 기록이 실패해도 **되돌리지 않는다** — 실패는 반환값으로 말한다.
    const aiProposalDecision = await this.decideNursingProposal(
      note.aiSourceSnapshot as Record<string, unknown> | null,
      aiEditDistance ?? note.aiEditDistance ?? null,
      nursingNoteText(note),
      nurseId,
      'nursing-signNote',
    );
    return aiProposalDecision ? { ...signed, aiProposalDecision } : signed;
  }

  /**
   * 간호기록 초안의 제안 원장 결정(`ACCEPTED`/`EDITED`) — 스냅샷의 `aiProposalId` 가 있을 때만.
   *
   * 🔴 **결정은 사실이어야 한다.** 수정량을 재지 못했으면(초안 원문 없음) 아무 쪽으로도 단정하지 않고
   *    `recorded:false` + 사유로 남긴다 — 0 으로 접어 `ACCEPTED` 라 부르면 "무수정 승인"이 부풀려진다.
   * 🔴 `aiProposalId` 가 없는 스냅샷(제안 원장 도입 이전 초안)은 결정할 대상이 없다 → `null`(무언).
   */
  private async decideNursingProposal(
    snapshot: Record<string, unknown> | null | undefined,
    editDistance: number | null,
    finalText: string,
    actorId: string,
    clientContext: string,
  ): Promise<NursingAiProposalDecisionResult | null> {
    const raw = snapshot?.aiProposalId;
    if (typeof raw !== 'string' || raw.length === 0) return null;
    if (!this.aiProposal) {
      this.logger.warn(`간호 초안 제안 결정 미기록(AiProposalService 미주입): ${raw}`);
      return { proposalId: raw, recorded: false, reason: 'AI_PROPOSAL_SERVICE_UNAVAILABLE' };
    }
    if (editDistance == null) {
      return { proposalId: raw, recorded: false, reason: 'EDIT_DISTANCE_UNMEASURED' };
    }
    const decision = editDistance === 0 ? ('ACCEPTED' as const) : ('EDITED' as const);
    try {
      await this.aiProposal.decide(raw, { decision, actorId, finalText, clientContext });
      return { proposalId: raw, recorded: true, decision };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.warn(`간호 초안 제안 결정 기록 실패(서명은 유지): ${raw} · ${reason}`);
      return { proposalId: raw, recorded: false, decision, reason };
    }
  }

  /** 간호기록 정정(가) — 서명된 기록은 직접 수정 불가. 정정문(addendum)을 새 기록으로 남기고 원본은 AMENDED 표시. */
  async amendNote(admissionId: string, noteId: string, dto: CreateNursingNoteDto, nurseId: string) {
    const orig = await this.nursingNoteInAdmission(admissionId, noteId);
    // 정정은 서명완료(SIGNED) 기록만 — DRAFT는 서명 후, AMENDED(이전본)는 재정정 불가.
    if (orig.status !== 'SIGNED') throw new BadRequestException('서명완료(SIGNED) 기록만 정정할 수 있습니다.');
    return this.prisma.$transaction(async (tx) => {
      await tx.nursingNote.update({ where: { id: noteId }, data: { status: 'AMENDED' } });
      return tx.nursingNote.create({
        data: {
          admissionId: orig.admissionId, nurseId,
          noteType: dto.noteType, focus: dto.focus, data: dto.data, action: dto.action,
          response: dto.response,
          content: `[정정 addendum of ${noteId}] ${dto.content ?? ''}`,
          subjective: dto.subjective, objective: dto.objective, assessment: dto.assessment,
          plan: dto.plan, education: dto.education, priority: dto.priority,
          shiftType: dto.shiftType,
          recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
          status: 'SIGNED', signedBy: nurseId, signedAt: new Date(),
        },
        include: { nurse: { select: { id: true, familyName: true, givenName: true } } },
      });
    });
  }

  /**
   * F-4 간호기록 품질검사(기획 P0·룰기반·읽기전용 advisory) — 서명 전 권고. **차단 아님**.
   * 게이트 `nursing.aiAssist.enabled` OFF면 `{enabled:false}`(무동작). JCI 정합: 필수요소(MOI.11)·
   * 통증 재평가(AOP.2)·낙상 예방중재(IPSG.6)·긴급 계획.
   */
  async nursingNoteQa(admissionId: string, noteId: string): Promise<{ enabled: boolean; score?: number; grade?: string; issues?: NursingQaIssue[] }> {
    if (!(await this.isAiAssistEnabled())) return { enabled: false };
    const note = await this.nursingNoteInAdmission(admissionId, noteId);
    return this.scoreNursingNote(note);
  }

  /** F-4 작성 중 품질검사(저장 전·form 콘텐츠 직접) — 작성기 인라인 경고용. 게이트·차단 아님. */
  async nursingNoteQaContent(note: Parameters<NursingService['evaluateNursingNoteRules']>[0]): Promise<{ enabled: boolean; score?: number; grade?: string; issues?: NursingQaIssue[] }> {
    if (!(await this.isAiAssistEnabled())) return { enabled: false };
    return this.scoreNursingNote(note);
  }

  private scoreNursingNote(note: Parameters<NursingService['evaluateNursingNoteRules']>[0]) {
    const issues = this.evaluateNursingNoteRules(note);
    const penalty = issues.reduce((s, i) => s + (i.level === 'WARNING' ? 15 : i.level === 'INFO' ? 5 : 0), 0);
    const score = Math.max(0, 100 - penalty);
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
    return { enabled: true, score, grade, issues };
  }

  /** 룰기반 간호기록 점검(순수·테스트 가능). 결정적·LLM 미사용(P0). */
  evaluateNursingNoteRules(note: {
    noteType: string; subjective?: string | null; objective?: string | null; assessment?: string | null;
    plan?: string | null; focus?: string | null; data?: string | null; action?: string | null;
    response?: string | null; education?: string | null; content?: string | null; priority?: string | null;
  }): NursingQaIssue[] {
    const issues: NursingQaIssue[] = [];
    const has = (v?: string | null) => !!(v && v.trim());
    const text = [note.subjective, note.objective, note.assessment, note.plan, note.focus, note.data, note.action, note.response, note.education, note.content]
      .filter(Boolean).join(' ');

    // 1) 노트타입별 필수요소(MOI.11 완전성)
    if (note.noteType === 'SOAP') {
      if (!has(note.objective)) issues.push({ level: 'WARNING', code: 'MISSING_O', field: 'objective', message: '객관적 소견(O) 미기재' });
      if (!has(note.assessment)) issues.push({ level: 'WARNING', code: 'MISSING_A', field: 'assessment', message: '간호판단(A) 미기재' });
    } else if (note.noteType === 'DAR' || note.noteType === 'DARE' || note.noteType === 'SBAR') {
      if (!has(note.data)) issues.push({ level: 'WARNING', code: 'MISSING_D', field: 'data', message: '자료(D/B) 미기재' });
      if (!has(note.action)) issues.push({ level: 'WARNING', code: 'MISSING_ACTION', field: 'action', message: '간호중재/평가(A) 미기재' });
      if (!has(note.response)) issues.push({ level: 'INFO', code: 'MISSING_R', field: 'response', message: '반응/권고(R) 미기재' });
      if (note.noteType === 'DARE' && !has(note.education)) issues.push({ level: 'INFO', code: 'MISSING_E', field: 'education', message: '환자교육(E) 미기재' });
    } else if (note.noteType === 'NARRATIVE') {
      if (!has(note.content)) issues.push({ level: 'WARNING', code: 'MISSING_CONTENT', field: 'content', message: '서술 본문 미기재' });
    }

    // 2) 통증 기록 → 재평가 계획(AOP.2 재평가)
    if (/통증|pain|NRS|동통/i.test(text) && !/재평가|재사정|reassess|추후\s*평가|f\/u|모니터/i.test(text)) {
      issues.push({ level: 'INFO', code: 'PAIN_NO_REASSESS', message: '통증 기록 있으나 재평가 계획 미기재(권고)' });
    }
    // 3) 낙상 위험 → 예방중재(IPSG.6)
    if (/낙상|fall|morse|braden/i.test(text) && !/예방|중재|intervention|보호자|침상\s*난간|side\s*rail|호출벨/i.test(text)) {
      issues.push({ level: 'INFO', code: 'FALL_NO_INTERVENTION', message: '낙상 위험 언급, 예방중재 미기재(권고)' });
    }
    // 4) 긴급(CRITICAL) → 계획/중재 필수
    if (note.priority === 'CRITICAL' && !has(note.plan) && !has(note.action)) {
      issues.push({ level: 'WARNING', code: 'CRITICAL_NO_PLAN', message: '긴급(CRITICAL) 기록에 계획/중재 미기재' });
    }
    return issues;
  }

  /**
   * F-1 근거 기반 간호기록 초안(기획 P1) — 구조화 데이터(EWS·낙상·MAR·직전노트)를 근거로 초안 생성.
   * **보조 우선**: DRAFT를 만들지 않고 초안 콘텐츠+근거(citations)+프로비넌스를 **반환**한다.
   * 간호사가 작성기에서 검토·수정 후 createNote(아래 aiProvenance 동봉)로 저장·서명한다.
   * 환각 차단: **객관(O)은 데이터에서 결정적으로 서술**(LLM 미사용), A/P만 AI(grounded). 근거 없으면 FALLBACK.
   * 게이트: nursing.aiAssist.enabled OFF면 거부(엔드포인트에서 차단).
   */
  async generateNursingDraft(admissionId: string, noteType: string, actorId?: string | null): Promise<NursingDraftResult> {
    if (!(await this.isAiAssistEnabledForAdmission(admissionId))) {
      throw new BadRequestException({ code: 'AI_ASSIST_DISABLED', message: '간호기록 AI 보조가 비활성 상태입니다.' });
    }
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, patientId: true } });
    if (!admission) throw new AdmissionNotFoundError(admissionId);
    const patientId = admission.patientId;
    const since = new Date(Date.now() - 24 * 3600 * 1000);

    const [ews, fall, recentMar] = await Promise.all([
      this.prisma.earlyWarningScore.findFirst({ where: { patientId }, orderBy: { recordedAt: 'desc' } }),
      this.prisma.fallRiskAssessment.findFirst({ where: { patientId }, orderBy: { assessedAt: 'desc' } }),
      this.prisma.medicationAdministration.findMany({
        where: { patientId, status: 'ADMINISTERED', administeredAt: { gte: since } },
        orderBy: { administeredAt: 'desc' }, take: 5,
        include: { prescription: { select: { medicationCode: { select: { nameKo: true } } } } },
      }),
    ]);

    const citations: NursingDraftCitation[] = [];
    const objLines: string[] = [];
    const assessmentEvidence: string[] = [];
    const fmt = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    if (ews) {
      objLines.push(`[V/S ${fmt(ews.recordedAt)}] RR ${ews.respiratoryRate}, SpO2 ${ews.spO2}%, BP ${ews.systolicBp}, HR ${ews.heartRate}, BT ${ews.temperature}℃, 의식 ${ews.consciousness}; NEWS2 ${ews.totalScore}(${ews.riskLevel})`);
      citations.push({ field: 'objective', source: 'EarlyWarningScore', refId: ews.id, text: `NEWS2 ${ews.totalScore}(${ews.riskLevel})`, at: ews.recordedAt });
      if (ews.riskLevel === 'HIGH' || ews.riskLevel === 'MEDIUM') assessmentEvidence.push(`조기경보 ${ews.riskLevel}`);
    }
    if (recentMar.length) {
      const meds = recentMar.map((m) => m.prescription?.medicationCode?.nameKo).filter(Boolean);
      if (meds.length) {
        objLines.push(`[투약] ${meds.join(', ')} 투여 완료`);
        citations.push({ field: 'objective', source: 'MedicationAdministration', refId: recentMar[0].id, text: `투약 ${meds.length}건` });
      }
    }
    if (fall) {
      assessmentEvidence.push(`낙상 위험 ${fall.riskLevel}(점수 ${fall.score})`);
      citations.push({ field: 'assessment', source: 'FallRiskAssessment', refId: fall.id, text: `낙상 ${fall.riskLevel}`, at: fall.assessedAt });
    }

    const objective = objLines.length ? objLines.join('\n') : null;
    const haveEvidence = objLines.length > 0 || assessmentEvidence.length > 0;

    // A/P 초안 — 근거 있을 때만 AI 호출. 객관(O)은 위에서 결정적 생성(환각 0).
    let assessment: string | null = assessmentEvidence.length ? assessmentEvidence.join('; ') : null;
    let plan: string | null = null;
    let confidence = 0;
    /**
     * 🔴 제안 원장에 들어가는 신뢰도는 **모델이 자기보고한 값만**이다.
     *    아래 `confidence` 는 화면 문구용으로 0.5 를 기본값으로 쓰지만(종전 동작 유지),
     *    그 0.5 는 모델이 말한 값이 아니므로 원장에는 넣지 않는다 — 미보고는 `null`.
     */
    let reportedConfidence: number | null = null;
    let upstreamModel: string | null = null;
    let source: 'AI' | 'FALLBACK' = 'FALLBACK';
    if (this.medicalAi && haveEvidence) {
      try {
        const ai = await this.medicalAi.autoSoap({
          patientId,
          subjective: '(간호 객관 데이터 기반 초안 — 제공 근거 외 임상사실 생성 금지)',
          objective: [objective, ...assessmentEvidence].filter(Boolean).join('\n'),
          deidentify: true, // PHI 최소화(D-2) — 간호 초안은 성명 미전송(연령/성별만)
        });
        if (ai?.assessment) assessment = ai.assessment;
        if (ai?.plan) plan = ai.plan;
        confidence = typeof ai?.confidence === 'number' ? ai.confidence : 0.5;
        reportedConfidence = typeof ai?.confidence === 'number' ? ai.confidence : null;
        upstreamModel = pickUpstreamModelTag(ai);
        source = 'AI';
      } catch (e) {
        this.logger.warn(`간호 초안 AI 실패(FALLBACK): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const draft = this.mapDraftByNoteType(noteType, { objective, assessment, plan });
    const draftText = Object.values(draft).filter(Boolean).join(' \n ');
    const evidence = { ewsId: ews?.id ?? null, fallId: fall?.id ?? null, marIds: recentMar.map((m) => m.id) };
    // 입력 스냅샷 해시 — 승인 시점에 근거가 달라졌는지 대조하는 유일한 실(`AiProposalService.inputChangeState`)
    const inputSnapshotHash = createHash('sha256').update(JSON.stringify(evidence), 'utf8').digest('hex');

    const aiProposalId = await this.createNursingProposal({
      admissionId,
      patientId,
      draftText,
      inputSnapshotHash,
      modelRef: upstreamModel,
      confidence: reportedConfidence,
      source,
      actorId: actorId ?? null,
    });

    const aiSourceSnapshot = {
      generatedAt: new Date().toISOString(),
      evidence,
      draftText,
      sig: signDraftText(draftText), // #5 무결성 — createNote 가 검증(draftText 위조 차단)
      // 🔴 null 이면 "제안 원장에 남지 않았다" 는 뜻이다(기록된 척하지 않는다). 화면은 이 값이 있을 때만 노출을 보고한다.
      aiProposalId,
    };
    return { source, noteType, draft, citations, confidence, provenance: { aiModel: 'weru-b', aiPromptVersion: NURSING_AI_PROMPT_VERSION, aiSourceSnapshot } };
  }

  /**
   * 간호 초안 제안 생성 — 기획서 §2.1. 🔴 **초안 생성을 막지 않는다**(원장 실패로 간호사 일을 세우지 않는다).
   * 실패하면 `null` 을 돌려 응답이 "제안이 없다"고 말하게 한다 — 지어낸 id 를 내지 않는다.
   */
  private async createNursingProposal(input: {
    admissionId: string;
    patientId: string;
    draftText: string;
    inputSnapshotHash: string;
    modelRef: string | null;
    confidence: number | null;
    source: 'AI' | 'FALLBACK';
    actorId: string | null;
  }): Promise<string | null> {
    if (!this.aiProposal) {
      this.logger.warn('간호 초안 제안 미기록 — AiProposalService 미주입');
      return null;
    }
    try {
      const proposal = await this.aiProposal.create({
        kind: 'NURSING_DRAFT',
        // 초안 시점에 NursingNote 는 아직 없다 — 대상을 지어내지 않고 그 초안이 붙는 입원을 가리킨다
        targetType: 'Admission',
        targetId: input.admissionId,
        patientId: input.patientId,
        content: input.draftText,
        modelRef: input.modelRef, // 🔴 상류 보고값만('weru-b' 는 공급자명이라 넣지 않는다)
        promptVersion: NURSING_AI_PROMPT_VERSION,
        inputSnapshotHash: input.inputSnapshotHash,
        confidence: input.confidence, // 🔴 모델 자기보고만(미보고=null)
        source: input.source,
        createdBy: input.actorId,
      });
      return proposal.id;
    } catch (e) {
      this.logger.warn(`간호 초안 제안 생성 실패(초안은 그대로 반환): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** noteType 별 초안 필드 매핑(순수). 객관=O, A=간호판단, P=계획. */
  mapDraftByNoteType(noteType: string, parts: { objective: string | null; assessment: string | null; plan: string | null }): Record<string, string | null> {
    const { objective, assessment, plan } = parts;
    switch (noteType) {
      case 'SOAP':
        return { subjective: null, objective, assessment, plan };
      case 'DAR':
      case 'DARE':
        return { focus: null, data: [objective, assessment].filter(Boolean).join('\n') || null, action: plan, response: null };
      case 'SBAR':
        // SBAR 폼: focus=S · data=B(객관) · action=A(판단) · response=R(권고/계획)
        return { focus: null, data: objective, action: assessment, response: plan };
      case 'NARRATIVE':
        return { content: [objective, assessment, plan].filter(Boolean).join('\n') || null };
      default:
        return { objective, assessment, plan };
    }
  }

  async getNotes(admissionId: string, filters: { shiftType?: string; date?: string }) {
    const where: Prisma.NursingNoteWhereInput = { admissionId };
    if (filters.shiftType) { assertEnumParam(filters.shiftType, ShiftType, '근무 유형'); where.shiftType = filters.shiftType as Prisma.EnumShiftTypeFilter; }
    if (filters.date) where.recordedAt = nursingDayWindow(filters.date);

    const [notes, b, rule] = await Promise.all([
      this.prisma.nursingNote.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        include: { nurse: { select: { id: true, familyName: true, givenName: true } } },
      }),
      this.shiftBoundaries(),
      this.lateEntryRule(),
    ]);
    // 늦은 기록 = 기록 시각이 속한 근무조가 **끝난 뒤에** 작성된 것(2026-09-30). 저장하지 않고 두 시각에서 파생한다 —
    // 파생값을 컬럼에 박으면 교대 경계 설정이 바뀔 때 과거 판정과 갈라진다. 숨기지 않고 표식만(막지 않는다).
    return notes.map((n) => ({ ...n, lateEntry: isLateNursingEntry(n.recordedAt, n.createdAt, b, rule.graceMinutes) }));
  }

  /**
   * 늦은 기록 판정 규칙(2026-10-01) — 유예(분)는 원내 기록 규정 config `nursing.lateEntry.graceMinutes`.
   * 미설정(`configured: false`)이면 유예 0 으로 판정하되 화면이 "원내 규정 미설정"이라 밝힌다(0 을 정책인 척하지 않는다).
   * 조회 실패는 전파한다.
   */
  async lateEntryRule(): Promise<{ graceMinutes: number | null; configured: boolean }> {
    const raw = this.config ? await this.config.get('nursing.lateEntry.graceMinutes') : null;
    const graceMinutes = normalizeLateEntryGraceMinutes(raw);
    return { graceMinutes, configured: graceMinutes !== null };
  }

  /** 교대 경계 — config `nursing.shift.boundaries`(형식이 어긋나면 기본 7/15/23) */
  async shiftBoundaries() {
    // 조회 실패는 전파한다(실패를 "기본 경계"로 번역하지 않는다) · 값이 없거나 형식이 어긋난 것만 기본값
    const raw = await this.config?.get('nursing.shift.boundaries');
    return normalizeShiftBoundaries(raw);
  }

  // ── I/O 기록 ──

  async createIntakeOutput(admissionId: string, dto: CreateIntakeOutputDto, nurseId: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new AdmissionNotFoundError(admissionId);
    // 🔴 (2026-10-10) 유형만·양만·둘 다 빈 행을 받던 것 — 합계에 0 으로 들어가거나 유형 없는 양이 생긴다
    const hasIn = dto.intakeType != null || dto.intakeAmount != null;
    const hasOut = dto.outputType != null || dto.outputAmount != null;
    if (!hasIn && !hasOut) throw new BadRequestException({ code: 'IO_EMPTY', message: '섭취 또는 배설 중 하나는 유형과 양을 함께 넣어야 합니다.' });
    if ((hasIn && (dto.intakeType == null || dto.intakeAmount == null)) || (hasOut && (dto.outputType == null || dto.outputAmount == null))) {
      throw new BadRequestException({ code: 'IO_PAIR_INCOMPLETE', message: '유형과 양(mL)은 함께 넣습니다.' });
    }
    if (dto.recordedAt && new Date(dto.recordedAt).getTime() > Date.now() + NursingService.RECORDED_AT_FUTURE_GRACE_MS) {
      throw new BadRequestException({ code: 'IO_RECORDED_AT_FUTURE', message: '기록 시각이 미래입니다.' });
    }

    return this.prisma.intakeOutput.create({
      data: {
        admissionId,
        nurseId,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        intakeType: dto.intakeType,
        intakeAmount: dto.intakeAmount,
        intakeDetail: dto.intakeDetail,
        outputType: dto.outputType,
        outputAmount: dto.outputAmount,
        outputDetail: dto.outputDetail,
      },
      include: { nurse: { select: { id: true, familyName: true, givenName: true } } },
    });
  }

  /** I/O 목록 — 두 원장 정본(2026-10-10 · 플로시트 I/O 칸도 행으로 · 행마다 ledger) */
  async getIntakeOutputs(admissionId: string, date?: string) {
    return this.ioReader.rows([admissionId], date ? nursingDayWindow(date) : undefined);
  }

  async getIntakeOutputSummary(admissionId: string, date: string) {
    // 🔴 시간대별 막대(byHour)는 `getHours()`(서버 로컬=KST)로 나눈다. 창이 UTC 하루면
    //    창과 눈금이 서로 다른 하루를 가리켜 **다음 날 08시 기록이 오늘 08시 칸**에 섰다.
    // 두 원장 정본(2026-10-10) — 종전 I/O 원장만 세어 플로시트에 적은 I/O 가 합계에서 빠졌다
    const records = await this.ioReader.rows([admissionId], nursingDayWindow(date));
    const sum = summarizeIo(records);
    const { totalIntake, totalOutput } = sum;

    const byHour: { hour: number; intake: number; output: number }[] = [];
    for (let h = 0; h < 24; h++) {
      const hourRecords = records.filter(r => new Date(r.recordedAt).getHours() === h);
      byHour.push({
        hour: h,
        intake: hourRecords.reduce((s, r) => s + (r.intakeAmount ?? 0), 0),
        output: hourRecords.reduce((s, r) => s + (r.outputAmount ?? 0), 0),
      });
    }

    return { date, totalIntake, totalOutput, balance: totalIntake - totalOutput, byHour, byLedger: sum.byLedger };
  }

  /**
   * I/O 수지(2026-10-10) — 이번 근무조·직전 근무조·최근 24시간(지금부터 거꾸로) 합계(두 원장 정본) + 배설 기록 공백.
   *  · 근무조 창 = 교대 경계 설정(병원 표준시) · 합계는 원장별을 함께(같은 사건이 두 원장에 적혔을 수 있다)
   *  · 배설 공백: 마지막 배설(양 > 0) 기록 시각과 경과 시간 — 🔴 기준(`nursing.io.noOutputAlertHours`)이 미설정이면 강조하지 않는다(null)
   *    0 mL 배설 기록(무뇨 측정)은 "배설 있음"이 아니라 그대로 센다(zeroOutputRecords)
   *  · 기록이 하나도 없으면 공백을 지어내지 않는다(lastOutputAt null)
   */
  async getIoBalance(admissionId: string, now: Date = new Date()) {
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, admitDate: true } });
    if (!adm) throw new NotFoundException('입원을 찾을 수 없습니다.');
    const b = await this.shiftBoundaries();
    const cur = shiftWindowAt(now, b);
    const prev = shiftWindowAt(new Date(cur.start.getTime() - 1), b);
    const day = { gte: new Date(now.getTime() - 24 * 3_600_000), lt: now };
    const [rowsAll, alertRaw] = await Promise.all([
      this.ioReader.rows([admissionId], { gte: new Date(Math.min(prev.start.getTime(), day.gte.getTime())), lt: now }),
      this.config?.get('nursing.io.noOutputAlertHours') ?? null,
    ]);
    const within = (w: { gte: Date; lt: Date }) => rowsAll.filter((r) => r.recordedAt >= w.gte && r.recordedAt < w.lt);
    const block = (w: { gte: Date; lt: Date }) => { const rs = within(w); return { from: w.gte, to: w.lt, rows: rs.length, ...summarizeIo(rs) }; };
    const lastPositive = await this.ioReader.rows([admissionId], { lt: now }).then((rs) => [...rs].reverse().find((r) => (r.outputAmount ?? 0) > 0) ?? null);
    const n = Number(alertRaw);
    const alertHours = Number.isInteger(n) && n >= 1 && n <= 48 ? n : null;
    const hoursSince = lastPositive ? (now.getTime() - lastPositive.recordedAt.getTime()) / 3_600_000 : null;
    return {
      shift: { name: cur.shift, ...block({ gte: cur.start, lt: now < cur.end ? now : cur.end }) },
      previousShift: { name: prev.shift, ...block({ gte: prev.start, lt: prev.end }) },
      last24h: block(day),
      output: {
        lastOutputAt: lastPositive?.recordedAt ?? null,
        hoursSinceLastOutput: hoursSince,
        zeroOutputRecords24h: within(day).filter((r) => r.outputType != null && r.outputAmount === 0).length,
        alertHours,
        // 기준 미설정·기록 없음이면 판정하지 않는다(null) — 거짓 경보를 만들지 않는다
        overdue: alertHours == null || hoursSince == null ? null : hoursSince > alertHours,
      },
    };
  }

  /**
   * 이 재원의 위험 평가 추이(2026-10-10) — NEWS2·낙상(Morse 등)·욕창(Braden — 초기평가 칸) 이력과 다음 재평가 예정.
   *  · 재원 기간 안만 · 상한(NEWS2 100·낙상 50) + 전체 수 · 최신 NEWS2 의 재측정 참고(RCP · 원내 규정 아님)
   *  · 재평가 일정이 없으면 없다고(자동 생성 설정·위원회 몫) — 지어내지 않는다
   */
  async getRiskHistory(admissionId: string) {
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, patientId: true, admitDate: true, dischargeDate: true } });
    if (!adm) throw new NotFoundException('입원을 찾을 수 없습니다.');
    const win = { gte: adm.admitDate, ...(adm.dischargeDate ? { lte: adm.dischargeDate } : {}) };
    const [ews, ewsTotal, falls, fallTotal, braden, bradenTotal, bradenTool, bradenToolTotal, schedules] = await Promise.all([
      this.prisma.earlyWarningScore.findMany({
        where: { patientId: adm.patientId, recordedAt: win }, orderBy: { recordedAt: 'desc' }, take: 100,
        select: { id: true, recordedAt: true, totalScore: true, riskLevel: true, escalationRequired: true, scoreBreakdown: true, supplementalO2: true, consciousness: true },
      }),
      this.prisma.earlyWarningScore.count({ where: { patientId: adm.patientId, recordedAt: win } }),
      this.prisma.fallRiskAssessment.findMany({
        where: { patientId: adm.patientId, assessedAt: win }, orderBy: { assessedAt: 'desc' }, take: 50,
        select: { id: true, assessedAt: true, score: true, riskLevel: true, assessorId: true },
      }),
      this.prisma.fallRiskAssessment.count({ where: { patientId: adm.patientId, assessedAt: win } }),
      this.prisma.nursingAssessment.findMany({
        where: { admissionId, bradenScore: { not: null } }, orderBy: { assessedAt: 'desc' }, take: 50,
        select: { id: true, assessedAt: true, bradenScore: true, nurseId: true, nurse: { select: { familyName: true, givenName: true } } },
      }),
      this.prisma.nursingAssessment.count({ where: { admissionId, bradenScore: { not: null } } }),
      // Braden 하위 항목이 남는 원장 — 임상 도구 결과(chartId BRADEN · 재평가 기록도 여기에 남는다)
      this.prisma.clinicalChartResult.findMany({
        where: { patientId: adm.patientId, chartId: 'BRADEN', performedAt: win }, orderBy: { performedAt: 'desc' }, take: 50,
        select: { id: true, performedAt: true, inputs: true, resultValue: true, performedBy: true, performedByName: true, usedToolVersion: true },
      }),
      this.prisma.clinicalChartResult.count({ where: { patientId: adm.patientId, chartId: 'BRADEN', performedAt: win } }),
      this.prisma.riskReassessmentSchedule.findMany({
        where: { patientId: adm.patientId, isActive: true, OR: [{ admissionId }, { admissionId: null }] },
        select: { assessmentType: true, toolName: true, intervalHours: true, nextDueAt: true, lastScore: true, lastRiskLevel: true, lastAssessedAt: true },
      }),
    ]);
    const latest = ews[0] ?? null;
    return {
      patientId: adm.patientId,
      news2: {
        items: ews, total: ewsTotal, truncated: ewsTotal > ews.length,
        monitoringReference: latest ? news2MonitoringReference({ totalScore: latest.totalScore, hasIndividual3: (latest.riskLevel === 'LOW_MEDIUM') }) : null,
        monitoringSource: NEWS2_MONITORING_SOURCE,
      },
      fall: { items: falls, total: fallTotal, truncated: fallTotal > falls.length },
      braden: this.bradenHistory(braden, bradenTotal, bradenTool, bradenToolTotal),
      schedules,
    };
  }

  /**
   * Braden 이력(2026-10-10) — 초기평가(총점만 받는 경로)와 하위 항목이 남는 임상 도구 결과 원장을 합쳐 최근 순.
   *  · 행마다 출처·평가자 · 하위 6항목(없으면 null) · 등급(범위 안 총점에만 · shared 정본)
   *  · 🔴 점수 범위 밖·하위 항목 누락·합 불일치는 `checks` 로 — 기록을 고치지 않고 "확인 필요"로 보인다
   *  · 총점만 받는 경로(초기평가)는 하위 항목이 없는 것이 결함이 아니다 → subscores null · 점검 아님
   *  · 이 변경 전 재평가는 일정의 마지막 점수만 남아 이력에 없다(되살릴 원장이 없다)
   */
  private bradenHistory(
    initial: Array<{ id: string; assessedAt: Date; bradenScore: number | null; nurseId: string; nurse?: { familyName: string | null; givenName: string | null } | null }>,
    initialTotal: number,
    tool: Array<{ id: string; performedAt: Date; inputs: Prisma.JsonValue; resultValue: Prisma.Decimal | number | null; performedBy: string; performedByName: string; usedToolVersion: string }>,
    toolTotal: number,
  ) {
    // 2026-10-10 초기평가를 하위 항목으로 받은 경우(결정 bradenInput = SUBSCORES) 그 6항목은 같은 원장에 nursingAssessmentId 로 묶여 있다 —
    //    초기평가 행에 하위 항목을 붙이고 그 원장 행은 따로 세우지 않는다(같은 평가가 두 줄로 보이지 않게)
    const linked = new Map<string, Prisma.JsonValue>();
    for (const r of tool) {
      if (r.usedToolVersion !== BRADEN_INITIAL_TOOL_VERSION) continue;
      const naId = r.inputs && typeof r.inputs === 'object' && !Array.isArray(r.inputs) ? (r.inputs as Record<string, unknown>).nursingAssessmentId : null;
      if (typeof naId === 'string' && initial.some((i) => i.id === naId)) linked.set(naId, r.inputs);
    }
    const folded = new Set([...linked.keys()]);
    const items = [
      ...initial.map((r) => ({
        id: r.id, source: 'NURSING_ASSESSMENT' as const, assessedAt: r.assessedAt,
        ...evaluateBradenRecord(r.bradenScore, linked.get(r.id) ?? null),
        assessor: { id: r.nurseId, name: r.nurse ? joinPatientName(r.nurse.familyName, r.nurse.givenName) || null : null },
      })),
      ...tool.filter((r) => !(r.usedToolVersion === BRADEN_INITIAL_TOOL_VERSION && folded.has(String((r.inputs as Record<string, unknown> | null)?.nursingAssessmentId)))).map((r) => ({
        id: r.id,
        source: (r.usedToolVersion === BRADEN_REASSESSMENT_TOOL_VERSION ? 'REASSESSMENT' : 'CHART_TOOL') as 'REASSESSMENT' | 'CHART_TOOL',
        assessedAt: r.performedAt,
        ...evaluateBradenRecord(r.resultValue == null ? null : Number(r.resultValue), r.inputs ?? {}),
        assessor: { id: r.performedBy, name: r.performedByName || null },
      })),
    ].sort((a, b) => b.assessedAt.getTime() - a.assessedAt.getTime());
    return {
      items,
      total: initialTotal + toolTotal - folded.size,
      truncated: tool.length < toolTotal || initial.length < initialTotal,
      needsReview: items.filter((i) => i.checks.length > 0).length,
    };
  }

  // ── 투약확인 (MAR) ──

  /** 기록 시각 미래 허용 오차(기기 시계 차) */
  static readonly RECORDED_AT_FUTURE_GRACE_MS = 5 * 60_000;
  /** 지난 날짜에서 넘어온 미처리(SCHEDULED) 투약을 거슬러 보는 한도 — 그보다 오래된 것은 목록 밖(누락 처리는 MAR 화면) */
  static readonly CARRY_OVER_DAYS = 7;

  /**
   * 🔴 (2026-09-30) 종전엔 입원도 날짜도 보지 않고 **환자 전 기간**을 돌려줬다 — 간호 워크스테이션이 날짜 없이 불러
   *    어제 08:00 미투약분이 시각만 찍혀 **오늘 예정처럼** 보였다(누락을 MISSED 로 바꾸는 크론은 없다).
   *  · 이 입원 기간만 · 날짜를 주면 그 간호일 · `includeOverdue` 면 그 날 이전 미처리분(최근 7일)을 `carriedOver: true` 로 함께
   */
  async getMedicationSchedule(admissionId: string, date?: string, includeOverdue = false) {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      select: { patientId: true, admitDate: true },
    });
    if (!admission) throw new AdmissionNotFoundError(admissionId);

    const include = {
      prescription: { include: { medicationCode: { select: { code: true, nameKo: true, highAlertFlag: true, highAlertCategory: true } } } },
      nurse: { select: { id: true, familyName: true, givenName: true } },
    } as const;
    if (!date) {
      return this.prisma.medicationAdministration.findMany({ where: { patientId: admission.patientId }, orderBy: { scheduledAt: 'asc' }, include });
    }
    const win = nursingDayWindow(date);
    // 지난 날짜 미처리분(carriedOver) — 🔴 종전 화면은 "오늘"만 봐서 어제 기록하지 않은 투약이 어디에도 안 보였다.
    // 이번 입원 안으로만(입원일 이전 = 지난 입원의 미처리분을 이 입원에 끌어오지 않는다) · 상한 CARRY_OVER_DAYS.
    const [day, carried] = await Promise.all([
      this.prisma.medicationAdministration.findMany({
        where: { patientId: admission.patientId, scheduledAt: win },
        orderBy: { scheduledAt: 'asc' }, include,
      }),
      includeOverdue
        ? this.prisma.medicationAdministration.findMany({
            where: {
              patientId: admission.patientId, status: 'SCHEDULED',
              scheduledAt: { gte: new Date(Math.max(admission.admitDate.getTime(), win.gte.getTime() - NursingService.CARRY_OVER_DAYS * 86_400_000)), lt: win.gte },
            },
            orderBy: { scheduledAt: 'asc' }, include, take: 200,
          })
        : Promise.resolve([]),
    ]);
    return [...carried.map((m) => ({ ...m, carriedOver: true })), ...day.map((m) => ({ ...m, carriedOver: false }))];
  }

  /**
   * 처방 기반 투약 스케줄 자동 생성
   * frequency 파싱: "1일 3회" → [08:00, 13:00, 18:00]
   */
  async generateSchedule(prescriptionId: string) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        medicationCode: { select: { nameKo: true } },
        encounter: { select: { patientId: true } },
      },
    });
    if (!prescription) throw new NotFoundException('Prescription not found');
    if (prescription.type !== 'MEDICATION') return [];
    // 🔴 (2026-09-30) 취소·중단된 처방에 투약 예정을 만들지 않는다 — 종전엔 상태 검사가 없어 멈춘 약의 예정이 새로 생길 수 있었다
    if (prescription.status !== 'ACTIVE') {
      throw new ConflictException({ code: 'PRESCRIPTION_NOT_ACTIVE', message: 'Cannot schedule administrations for a non-active prescription' });
    }
    // 퇴원약(2026-09-30)은 퇴원 때 가져갈 약이다 — 병동 투약 예정을 만들면 같은 약이 입원 중에 한 번 더 투약된다
    if (prescription.dischargeMed) {
      throw new ConflictException({ code: 'DISCHARGE_MED_NO_MAR', message: 'Discharge medications are not scheduled for inpatient administration' });
    }

    const times = this.parseFrequency(prescription.frequency);
    const days = prescription.duration ?? 1;
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const schedules: Array<{ prescriptionId: string; patientId: string; scheduledAt: Date; dose: string; route: string; status: 'SCHEDULED' }> = [];
    for (let day = 0; day < days; day++) {
      for (const [hour, minute] of times) {
        const scheduledAt = new Date(startDate);
        scheduledAt.setDate(scheduledAt.getDate() + day);
        scheduledAt.setHours(hour, minute, 0, 0);

        schedules.push({
          prescriptionId,
          patientId: prescription.encounter.patientId,
          scheduledAt,
          route: prescription.route ?? 'PO',
          dose: prescription.dosage ?? '',
          status: 'SCHEDULED',
        });
      }
    }

    if (schedules.length === 0) return [];

    await this.prisma.medicationAdministration.createMany({ data: schedules });

    return this.prisma.medicationAdministration.findMany({
      where: { prescriptionId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  private parseFrequency(frequency: string | null): [number, number][] {
    if (!frequency) return [[8, 0]];

    // "1일 3회" → 3
    const match3 = frequency.match(/(\d+)\s*회/);
    const timesPerDay = match3 ? parseInt(match3[1]) : 1;

    // 시간 매핑
    const timeMap: Record<number, [number, number][]> = {
      1: [[8, 0]],
      2: [[8, 0], [20, 0]],
      3: [[8, 0], [13, 0], [18, 0]],
      4: [[8, 0], [12, 0], [18, 0], [22, 0]],
      6: [[6, 0], [10, 0], [14, 0], [18, 0], [22, 0], [2, 0]],
    };

    // 특수 키워드
    if (frequency.includes('취침') || frequency.includes('HS')) return [[22, 0]];
    if (frequency.includes('식전')) return [[7, 30], [11, 30], [17, 30]].slice(0, timesPerDay) as [number, number][];
    if (frequency.includes('식후')) return [[8, 30], [12, 30], [18, 30]].slice(0, timesPerDay) as [number, number][];

    return timeMap[timesPerDay] ?? [[8, 0]];
  }

  async administerMed(
    id: string,
    data: {
      dose: string;
      route: string;
      verifiedBy?: string;
      notes?: string;
      patientBandScan?: string;
      medScan?: string;
      /** 독립 이중확인을 우회하는 사유(야간 단독근무 등). 막지 않되 기록·표시한다. */
      doubleCheckBypassReason?: string;
    },
    nurseId: string,
  ) {
    const med = await this.prisma.medicationAdministration.findUnique({
      where: { id },
      include: {
        patient: { select: { mrn: true } },
        prescription: {
          select: {
            status: true,
            route: true,
            medicationCode: {
              select: { highAlertFlag: true, highAlertCategory: true, nameKo: true, barcode: true, code: true },
            },
          },
        },
      },
    });
    if (!med) throw new MedAdminNotFoundError(id);
    if (med.status !== 'SCHEDULED') {
      throw new MedAdminNotScheduledError(id, med.status);
    }
    // 심층방어 — 중단/취소(비ACTIVE) 처방에는 투약 금지. 취소 시 SCHEDULED 삭제 경로 단일 의존 제거.
    // 중단(2026-09-30)은 이후 투약만 멈춘다 — 중단 전 예정분이 남아 있으면 '보류/미투여'로 기록하게 안내한다(투여는 여전히 막는다)
    if (med.prescription?.status === 'DISCONTINUED') {
      throw new BadRequestException({ code: 'PRESCRIPTION_DISCONTINUED', message: '처방이 중단되었습니다 — 투여할 수 없습니다. 중단 전 예정분은 보류(미투여) 사유로 기록하세요.' });
    }
    if (med.prescription?.status && med.prescription.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'PRESCRIPTION_NOT_ACTIVE', message: `처방이 활성 상태가 아닙니다(현재 ${med.prescription.status}) — 투약 불가.` });
    }

    const warnings: string[] = [];

    // 5-Rights ③ Right dose — 화면이 실제 용량 대신 자리표시 문자열을 보내던 것을 차단.
    // (`item.dose ?? '처방 용량'` 이 그대로 저장되면 투약 기록이 용량을 말하지 않는다 = 임상기록 날조)
    if (DOSE_PLACEHOLDERS.includes(String(data.dose ?? '').trim())) {
      throw new BadRequestException({
        code: 'DOSE_PLACEHOLDER',
        message: '실제 투여량을 입력하세요 — 자리표시 문자열은 투약 기록으로 저장할 수 없습니다.',
      });
    }

    // 5-Rights ③ Right route — 처방 경로와 실제 투여 경로가 **기계로 확정 가능하게** 다를 때만 경고.
    // 🔴 모르면 침묵한다(처방 경로 미기재가 1,365건 — 거짓 경보는 진짜 경보를 죽인다).
    const rxRoute = String(med.prescription?.route ?? '').trim();
    const givenRoute = String(data.route ?? '').trim();
    if (rxRoute && givenRoute && rxRoute.toUpperCase() !== givenRoute.toUpperCase()) {
      warnings.push(`투여 경로가 처방과 다릅니다(처방 ${rxRoute} → 투여 ${givenRoute}). 처방 변경 여부를 확인하세요.`);
    }

    // 고위험약(high-alert) 독립 이중확인 — IPSG.3. 두 번째 간호사(verifiedBy)가 최초 투약자(nurseId)와 달라야 함.
    // 🔴 적용 범위는 shared 정본(`requiresIndependentDoubleCheck`) — **모든 고위험약이 아니다.**
    //    ISMP 는 전 고위험약 일괄 적용을 권고하지 않는다(형식화되면 검출력이 사라진다).
    // 게이트: nursing.highAlertDoubleCheck (OFF|WARN|BLOCK·기본 WARN). BLOCK=미충족 시 400, WARN=경고·감사표식.
    const mcode = med.prescription?.medicationCode;
    const scope = requiresIndependentDoubleCheck({
      highAlertFlag: mcode?.highAlertFlag,
      highAlertCategory: mcode?.highAlertCategory,
      route: givenRoute || med.route || rxRoute,
    });
    let bypassMarker = '';
    let verifierValid = false;
    let bypassReason: string | null = null;
    if (scope.required) {
      const mode = gateMode(await this.config?.get('nursing.highAlertDoubleCheck'), 'WARN');
      // verifiedBy 실재·활성·간호역할 검증 — 자가서명(off-duty/타역할/허위 UUID) 우회 차단.
      if (data.verifiedBy && data.verifiedBy !== nurseId) {
        const verifier = await this.prisma.user.findUnique({
          where: { id: data.verifiedBy },
          select: { id: true, isActive: true, accountStage: true, role: true },
        });
        verifierValid = !!verifier && verifier.isActive && verifier.accountStage === 'ACTIVE'
          && (verifier.role === 'NURSE' || verifier.role === 'ADMIN');
      }
      if (!verifierValid && mode !== 'OFF') {
        const msg = !data.verifiedBy
          ? `${scope.reason} 독립 이중확인(2인 서명)이 필요합니다 — 확인 간호사를 지정하세요.`
          : data.verifiedBy === nurseId
            ? '이중확인 간호사는 투약 간호사와 달라야 합니다(독립 확인).'
            : '이중확인 간호사가 유효한 활성 간호(또는 관리자) 계정이 아닙니다.';
        if (mode === 'BLOCK') throw new BadRequestException({ code: 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED', message: msg });
        warnings.push(msg);
      }
      // WARN 우회 감사추적 — 유효한 독립확인 없이 투약된 고위험약을 기록에 표식(사후검토 식별).
      // 🔴 우회는 허용하되(야간 단독근무가 실재한다) **사유까지 남긴다.** 사유 미기재는 '미기재'로 남기고
      //    "사유 있음"으로 위장하지 않는다. 표시는 응답 `doubleCheck` + MAR 목록이 담당한다.
      if (!verifierValid) {
        bypassReason = String(data.doubleCheckBypassReason ?? '').trim() || BYPASS_REASON_UNSTATED;
        bypassMarker = buildDoubleCheckBypassMarker({ nurseId, reason: bypassReason });
        if (mode !== 'OFF' && bypassReason === BYPASS_REASON_UNSTATED) {
          warnings.push('이중확인 우회 사유가 기재되지 않았습니다 — 기록에 "미기재"로 남습니다.');
        }
      }
    }

    // BCMA bedside 스캔 대조(R2-3) — 5-Rights 중 환자·약품을 기계 대조.
    // 스캔 제공 시 불일치는 **모드 무관 항상 차단**(오투약 방지 — 완화 불가).
    // config nursing.bcma.enforce(OFF|WARN|BLOCK·기본 OFF): 미스캔 자체를 WARN=경고·표식 / BLOCK=차단.
    // 🔴 스캔 원문 해석은 발급 정본과 같은 파서를 쓴다(`parsePatientQr`).
    //    MRN 완전일치만 통과시키던 종전 코드는 이미 인쇄되어 병동에 도는 **구 형식 팔찌**
    //    (`{"t":"PATIENT","mrn":…}` · `HRPT:<MRN>`)를 전부 `BCMA_PATIENT_MISMATCH` 로 떨궜다.
    //    파서가 인식하지 못하면 원문 그대로 비교한다(관대하게 받되 대조는 그대로 엄격).
    const band = parsePatientQr(data.patientBandScan) ?? data.patientBandScan?.trim();
    const medScan = data.medScan?.trim();
    if (band && band.toUpperCase() !== String(med.patient?.mrn ?? '').toUpperCase()) {
      throw new BadRequestException({
        code: 'BCMA_PATIENT_MISMATCH',
        message: `환자 불일치: 스캔(${band}) ≠ 투약 대상(${med.patient?.mrn}) — 투약 중단·재확인`,
      });
    }
    const mc = med.prescription?.medicationCode;
    if (medScan && mc) {
      const candidates = [mc.barcode, mc.code].filter(Boolean).map((v) => String(v).toUpperCase());
      if (!candidates.includes(medScan.toUpperCase())) {
        throw new BadRequestException({
          code: 'BCMA_MED_MISMATCH',
          message: `약품 불일치: 스캔(${medScan}) ≠ 처방약(${mc.nameKo}) — 투약 중단·약국 확인`,
        });
      }
    }
    const bcmaMode = gateMode(await this.config?.get('nursing.bcma.enforce'), 'OFF');
    const scanned = !!(band && medScan);
    if (!scanned && bcmaMode === 'BLOCK') {
      throw new BadRequestException({
        code: 'BCMA_SCAN_REQUIRED',
        message: '환자 손목밴드와 약품 바코드를 모두 스캔해야 투약할 수 있습니다(BCMA 필수)',
      });
    }
    let bcmaMarker = '';
    if (!scanned && bcmaMode === 'WARN') {
      warnings.push('BCMA 스캔 없이 투약 — 수기 5-Rights 확인을 기록하세요.');
      bcmaMarker = `[BCMA-BYPASS ${new Date().toISOString()} nurse=${nurseId}]`;
      /**
       * 🔴 2026-08-21: 우회 흔적이 `notes` 문자열에만 남아 **안전 게이트 관제가 BCMA 위반을 0으로**
       *    보여줬다. 운영 게이트는 `WARN` 으로 켜져 있는데 `gate_violation_logs` 에 BCMA 행이 하나도
       *    없었다 — v4.4.0 "게이트가 BLOCK 인데 위반 0행이 곧 탐지기가 죽음이었다"와 같은 유형이다.
       *    스캔율은 문자열 검색으로 셀 것이 아니라 원장에서 세야 한다.
       */
      await recordGateViolation({ gateKey: 'nursing.bcma.enforce', recorder: this.safetyGate, logger: this.logger, refType: 'MedicationAdministration', refId: id }, 'WARN', `BCMA 스캔 없이 투약(손목밴드=${band ? '있음' : '없음'}·약품=${medScan ? '있음' : '없음'})`);
    }

    // 원자적 전이 — SCHEDULED 조건부 updateMany로 동시 투약(이중 투약) 직렬화. count===0=이미 처리됨(409).
    const claimed = await this.prisma.medicationAdministration.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: {
        status: 'ADMINISTERED',
        administeredAt: new Date(),
        nurseId,
        dose: data.dose,
        route: data.route,
        // 유효 독립확인이 아니면 verifiedBy를 저장하지 않음(허위 검증자 FK 기록 방지). BCMA 마커와는 독립.
        verifiedBy: bypassMarker ? null : data.verifiedBy,
        notes: [data.notes, bypassMarker, bcmaMarker].filter(Boolean).join(' ') || null,
        // BCMA 스캔 기록(원본 보존)
        ...(band || medScan ? { patientBandScan: band ?? null, medScan: medScan ?? null, bcmaScanAt: new Date() } : {}),
      },
    });
    if (claimed.count === 0) throw new ConflictException('이미 투약 처리되었거나 예정 상태가 아닙니다');
    const updated = await this.prisma.medicationAdministration.findUnique({ where: { id } });

    // 환자 여정 — 투약 시행(fire-and-forget). BCMA 우회분은 경고로 구분.
    if (updated?.patientId) {
      this.journey?.emit({
        patientId: updated.patientId,
        eventType: 'MEDICATION_ADMINISTERED',
        title: '투약 시행',
        description: [data.dose, data.route].filter(Boolean).join(' · ').slice(0, 200) || undefined,
        department: '간호부',
        refType: 'MedicationAdministration',
        refId: id,
        severity: bcmaMarker ? 'WARNING' : undefined,
        occurredAt: updated.administeredAt ?? null, // 여정 P1: 투약 원장 시각
      });
    }

    // 🔴 이중확인의 사실을 **호출한 화면이 볼 수 있게** 돌려준다.
    //    (종전에는 우회 표식이 notes 에만 박혀 어느 화면에도 뜨지 않았다 — 그래서 100% 우회가 보이지 않았다.)
    const doubleCheck = {
      required: scope.required,
      category: scope.category,
      reason: scope.reason,
      satisfied: scope.required ? verifierValid : null,
      verifiedBy: verifierValid ? (data.verifiedBy ?? null) : null,
      bypassed: !!bypassMarker,
      bypassReason,
    };

    return { ...updated, doubleCheck, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  /** 투약 거부 — 환자가 투약을 거부한 경우(SCHEDULED → REFUSED). HELD(임상적 보류)와 구분되는 별도 결과. */
  async refuseMed(id: string, reason: string, nurseId: string) {
    const med = await this.prisma.medicationAdministration.findUnique({ where: { id } });
    if (!med) throw new MedAdminNotFoundError(id);
    if (med.status !== 'SCHEDULED') {
      throw new MedAdminNotScheduledError(id, med.status);
    }
    return this.prisma.medicationAdministration.update({
      where: { id },
      data: { status: 'REFUSED', holdReason: reason, nurseId },
    });
  }

  async holdMed(id: string, reason: string, nurseId: string) {
    const med = await this.prisma.medicationAdministration.findUnique({ where: { id } });
    if (!med) throw new MedAdminNotFoundError(id);
    if (med.status !== 'SCHEDULED') {
      throw new MedAdminNotScheduledError(id, med.status);
    }

    return this.prisma.medicationAdministration.update({
      where: { id },
      data: { status: 'HELD', holdReason: reason, nurseId },
    });
  }

  // ══════════════════════════════════
  // 타임라인 통합
  // ══════════════════════════════════

  async getTimeline(admissionId: string, opts: { shift?: string; date?: string }) {
    // KST 기준 하루 범위 (UTC+9)
    // 하루 경계는 이 파일에 하나뿐이다(nursingDayWindow) — 종전엔 여기만 KST, 목록 4곳은 UTC 였다.
    const dateStr = opts.date ?? localDateKey(new Date());
    const { gte: dayStart, lt: dayEnd } = nursingDayWindow(dateStr);

    // 보안: MedicationAdministration 은 admissionId 가 없어 patientId 로 격리(미설정 시 전 환자 노출 차단).
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true, admitDate: true, dischargeDate: true } });
    const patientId = adm?.patientId ?? '00000000-0000-0000-0000-000000000000';
    // 🔴 (2026-10-10) 간호 스테이션 'VS 일괄'·차트 빠른 입력이 외래 원장에 쌓은 재원 중 활력 — 플로시트만 보면 타임라인에서 빠졌다
    const otherLedgerVitals = adm
      ? (await this.admissionVitals.rows([{ id: admissionId, patientId: adm.patientId, admitDate: adm.admitDate, dischargeDate: adm.dischargeDate }], { gte: dayStart, lt: dayEnd }))
          .filter((r) => r.ledger === 'PREVISIT')
      : [];
    const otherNurses = otherLedgerVitals.length
      ? new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(otherLedgerVitals.map((r) => r.nurseId))] } }, select: { id: true, familyName: true, givenName: true } })).map((u) => [u.id, joinPatientName(u.familyName, u.givenName)]))
      : new Map<string, string>();

    const [notes, ios, mars, vitals, checklists, flowsheet] = await Promise.all([
      this.prisma.nursingNote.findMany({
        where: { admissionId, recordedAt: { gte: dayStart, lt: dayEnd }, ...(opts.shift ? { shiftType: opts.shift as any } : {}) },
        include: { nurse: { select: { familyName: true, givenName: true } } },
        orderBy: { recordedAt: 'desc' },
      }),
      this.ioReader.rows([admissionId], { gte: dayStart, lt: dayEnd }),
      this.prisma.medicationAdministration.findMany({
        where: { patientId, scheduledAt: { gte: dayStart, lt: dayEnd } },
        include: { prescription: { include: { medicationCode: { select: { nameKo: true, code: true } } } }, nurse: { select: { familyName: true, givenName: true } } },
        orderBy: { scheduledAt: 'desc' },
      }),
      this.prisma.flowSheetEntry.findMany({
        where: { admissionId, recordedAt: { gte: dayStart, lt: dayEnd } },
        include: { nurse: { select: { familyName: true, givenName: true } } },
        orderBy: { recordedAt: 'desc' },
      }),
      this.prisma.nursingChecklist.findMany({
        where: { admissionId, createdAt: { gte: dayStart, lt: dayEnd } },
        include: { nurse: { select: { familyName: true, givenName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.flowSheetEntry.findMany({
        where: { admissionId, recordedAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { recordedAt: 'asc' },
      }),
    ]);

    // 통합 타임라인 구성
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timeline: { time: string; type: string; data: any; nurse?: string }[] = [];

    for (const n of notes as any[]) {
      timeline.push({ time: n.recordedAt.toISOString(), type: n.noteType === 'SOAP' ? 'SOAP' : n.noteType === 'DARE' ? 'DARE' : 'NOTE', data: n, nurse: `${n.nurse?.familyName ?? ''}${n.nurse?.givenName ?? ''}` });
    }
    for (const io of ios) {
      timeline.push({ time: io.recordedAt.toISOString(), type: 'IO', data: io, nurse: `${io.nurse?.familyName ?? ''}${io.nurse?.givenName ?? ''}` });
    }
    for (const m of mars as any[]) {
      timeline.push({ time: m.scheduledAt.toISOString(), type: 'MAR', data: m, nurse: m.nurse ? `${m.nurse.familyName ?? ''}${m.nurse.givenName ?? ''}` : undefined });
    }
    for (const v of vitals) {
      timeline.push({ time: v.recordedAt.toISOString(), type: 'VITAL', data: { ...v, ledger: 'FLOWSHEET' }, nurse: `${v.nurse.familyName}${v.nurse.givenName}` });
    }
    for (const v of otherLedgerVitals) {
      timeline.push({ time: v.at.toISOString(), type: 'VITAL', data: { ...v, recordedAt: v.at }, nurse: otherNurses.get(v.nurseId) });
    }
    for (const c of checklists) {
      timeline.push({ time: c.createdAt.toISOString(), type: 'CHECKLIST', data: c, nurse: `${c.nurse.familyName}${c.nurse.givenName}` });
    }

    timeline.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    // I/O 합계
    let totalIntake = 0, totalOutput = 0;
    for (const io of ios) {
      totalIntake += (io.intakeAmount ?? 0);
      totalOutput += (io.outputAmount ?? 0);
    }

    return {
      timeline,
      summary: { totalIntake, totalOutput, balance: totalIntake - totalOutput, noteCount: notes.length, marCount: mars.length, checklistCount: checklists.length },
      flowsheet,
    };
  }

  // ══════════════════════════════════
  // Flow Sheet
  // ══════════════════════════════════

  async getFlowSheet(admissionId: string, date?: string) {
    const dateStr = date ?? localDateKey(new Date());
    const { gte: dayStart, lt: dayEnd } = nursingDayWindow(dateStr);

    const flowRows = await this.prisma.flowSheetEntry.findMany({
      where: { admissionId, recordedAt: { gte: dayStart, lt: dayEnd } },
      include: { nurse: { select: { familyName: true, givenName: true } } },
      orderBy: { recordedAt: 'asc' },
    });
    // 🔴 (2026-10-10) 재원 중 외래 원장에 쌓인 활력(간호 스테이션 'VS 일괄'·차트 빠른 입력 — 종전 쓰기 경로)도 같은 칸에 —
    //   플로시트만 그려 그 시각 칸이 비어 "안 쟀다"로 보였다. 행마다 ledger · 섭취/배설 칸은 없다(null).
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true, admitDate: true, dischargeDate: true } });
    const other = adm
      ? (await this.admissionVitals.rows([{ id: admissionId, patientId: adm.patientId, admitDate: adm.admitDate, dischargeDate: adm.dischargeDate }], { gte: dayStart, lt: dayEnd })).filter((r) => r.ledger === 'PREVISIT')
      : [];
    const otherNurses = other.length
      ? new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(other.map((r) => r.nurseId))] } }, select: { id: true, familyName: true, givenName: true } })).map((u) => [u.id, u]))
      : new Map<string, { familyName: string | null; givenName: string | null }>();
    const entries = [
      ...flowRows.map((e) => ({ ...e, ledger: 'FLOWSHEET' as const })),
      ...other.map((r) => ({
        ...r, recordedAt: r.at, ledger: 'PREVISIT' as const,
        intakeOral: null, intakeIv: null, intakeOther: null, outputUrine: null, outputDrain: null, outputOther: null,
        nurse: { familyName: otherNurses.get(r.nurseId)?.familyName ?? '', givenName: otherNurses.get(r.nurseId)?.givenName ?? '' },
      })),
    ].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

    // I/O — 두 원장 정본(2026-10-10). 🔴 종전 합계는 플로시트 칸만 세어 I/O 화면·스테이션에서 적은 섭취·배설이 빠졌다.
    const ioRows = await this.ioReader.rows([admissionId], { gte: dayStart, lt: dayEnd });
    const slotOf = (d: Date) => Math.floor(new Date(d).getHours() / 2);

    // 시간별 그리드 (2시간 간격) — 활력은 그 칸의 첫 측정 · I/O 는 그 칸의 합(두 원장)
    const grid = Array.from({ length: 12 }, (_, i) => {
      const hour = i * 2;
      const entry = entries.find(e => new Date(e.recordedAt).getHours() >= hour && new Date(e.recordedAt).getHours() < hour + 2);
      const inSlot = ioRows.filter((r) => slotOf(r.recordedAt) === i);
      const io = inSlot.length
        ? { intake: inSlot.reduce((a, r) => a + (r.intakeAmount ?? 0), 0), output: inSlot.reduce((a, r) => a + (r.outputAmount ?? 0), 0), rows: inSlot.length }
        : null;
      return { hour: `${String(hour).padStart(2, '0')}:00`, entry: entry ?? null, io };
    });

    // 24시간 합계 — 유형별(플로시트 칸 이름 유지) + 원장별
    const byType = (kind: 'intake' | 'output', type: string) => ioRows.reduce((a, r) => a + (kind === 'intake' ? (r.intakeType === type ? r.intakeAmount ?? 0 : 0) : (r.outputType === type ? r.outputAmount ?? 0 : 0)), 0);
    const totals = Object.fromEntries(FLOWSHEET_IO_FIELDS.map((f) => [f.field, byType(f.kind, f.type)])) as Record<(typeof FLOWSHEET_IO_FIELDS)[number]['field'], number>;
    const sum = summarizeIo(ioRows);
    // 배설 EMESIS 는 플로시트 칸이 없다 — 합계(totalOutput)에는 들어간다
    return { entries, grid, totals: { ...totals, totalIntake: sum.totalIntake, totalOutput: sum.totalOutput, balance: sum.balance, byLedger: sum.byLedger } };
  }

  /**
   * 입원 플로우시트 기록 — 🔴 저장은 **활력 수집 포트**(`VitalsIngestService`)를 지난다.
   * 종전엔 여기서 prisma 로 직접 썼고, 그래서 외래 경로에 있던 것(수치 정책 반올림·중복 검사·시각 검사)이
   * 이 경로에는 하나도 없었다(같은 개념이 경로마다 다르게 처리됨 = 이 축이 회수하는 결함).
   */
  async addFlowSheetEntry(admissionId: string, nurseId: string, body: CreateFlowSheetEntryDto) {
    const VITAL_KEYS = ['systolicBp', 'diastolicBp', 'heartRate', 'temperature', 'spo2', 'respiratoryRate', 'consciousness', 'painScore', 'painLocation', 'gcsScore', 'supplementalO2'] as const;
    const b = body as unknown as Record<string, unknown>;
    const hasVitals = VITAL_KEYS.some((k) => b[k] != null && b[k] !== '');
    const ioFields = FLOWSHEET_IO_FIELDS.filter((f) => typeof b[f.field] === 'number');
    if (!hasVitals && !ioFields.length) {
      throw new BadRequestException({ code: 'FLOWSHEET_EMPTY', message: '기록할 활력 또는 섭취·배설 값을 하나 이상 넣으세요.' });
    }
    // 근무조 — 보내지 않으면 측정 시각(모르면 지금)이 든 교대(교대 경계 설정 정본). 🔴 종전엔 수집 포트가 'DAY' 로 접었다.
    const shiftType = body.shiftType ?? shiftWindowAt(body.recordedAt ?? new Date(), await this.shiftBoundaries()).shift;

    // 🔴 (2026-10-10) I/O 는 I/O 원장(IntakeOutput)에 쓴다 — 종전엔 플로시트 칸에만 남아 I/O 화면·근무조 마감·병동 보드가 "I/O 없음"이었다.
    //    시각은 측정 시각(모르면 지금 — I/O 원장은 시각 칸이 필수다).
    let ioRecorded = 0;
    if (ioFields.length) {
      const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true } });
      if (!admission) throw new AdmissionNotFoundError(admissionId);
      const recordedAt = body.recordedAt ? new Date(body.recordedAt) : new Date();
      const created = await this.prisma.$transaction(ioFields.map((f) => this.prisma.intakeOutput.create({
        data: {
          admissionId, nurseId, recordedAt,
          ...(f.kind === 'intake'
            ? { intakeType: f.type as IntakeType, intakeAmount: b[f.field] as number, intakeDetail: '플로시트 입력' }
            : { outputType: f.type as OutputType, outputAmount: b[f.field] as number, outputDetail: '플로시트 입력' }),
        },
      })));
      ioRecorded = created.length;
    }
    if (!hasVitals) return { ioRecorded, vitals: null };

    const ingest = await this.vitalsPort.ingest<FlowSheetEntry>({
      route: 'INPATIENT',
      admissionId,
      recordedBy: nurseId,
      // 🔴 body.recordedAt 이 없으면 넘기지 않는다 — 포트가 "측정 시각 미상"으로 표시한다.
      //    종전엔 여기서 `new Date()` 로 채워, 모르는 시각을 관측 시각처럼 원장에 박았다.
      measuredAt: body.recordedAt,
      values: {
        systolicBp: body.systolicBp,
        diastolicBp: body.diastolicBp,
        heartRate: body.heartRate,
        temperature: body.temperature,
        spo2: body.spo2,
        respiratoryRate: body.respiratoryRate,
        consciousness: body.consciousness,
        painScore: body.painScore,
        supplementalO2: body.supplementalO2,
      },
      extras: {
        painLocation: body.painLocation,
        gcsScore: body.gcsScore,
        shiftType,
        notes: body.notes,
      },
    });
    if (ingest.status !== 'STORED' || !ingest.stored) {
      // 중복 재수신·미결속. 🔴 저장한 척하지 않는다 — NEWS2 도 돌리지 않는다.
      this.logger.warn(`플로우시트 미저장(${ingest.status}${ingest.pendingReason ? `/${ingest.pendingReason}` : ''}) 재원 ${admissionId}`);
      return ioRecorded ? { ioRecorded, vitals: null, vitalsStatus: ingest.status } : ingest.stored;
    }
    const entry = ingest.stored;

    // NEWS2 자동 산출 — **7요소가 전부 관측된 경우에만** EarlyWarningScore 생성(escalation·타임라인 연동).
    //  (이전: 입원 바이탈 기록만 되고 EWS는 아무도 계산하지 않아 조기경보/에스컬레이션이 동작하지 않던 결함)
    //
    // 🔴 2026-08-19: 여기 게이트가 6요소만 보고 `supplementalO2: body.supplementalO2 === true` 로
    //    **미관측을 false 로 접고 있었다.** 산소를 투여 중인 환자의 NEWS2 가 2점 낮게 법정기록에 박힌다 —
    //    2026-08-18 에 vitals 경로에서 봉합한 것과 **같은 결함이 이 경로에 남아 있었다**(한 곳만 고치면 갈라진다).
    //    관측되지 않았으면 산출하지 않는다. 산출 불가는 0점이 아니다.
    const newsInput = {
      respiratoryRate: body.respiratoryRate as number | undefined,
      spO2: body.spo2 as number | undefined,
      supplementalO2: body.supplementalO2 as boolean | undefined,
      spO2Scale: ((body.spO2Scale as number) === 2 ? 2 : 1) as 1 | 2,
      systolicBp: body.systolicBp as number | undefined,
      heartRate: body.heartRate as number | undefined,
      temperature: body.temperature as number | undefined,
      consciousness: normalizeAcvpu(body.consciousness) ?? undefined,
    };
    if (this.patientSafety && canScoreNews2(newsInput)) {
      try {
        const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true } });
        if (adm) {
          await this.patientSafety.calculateAndSaveEws(adm.patientId, nurseId, {
            respiratoryRate: newsInput.respiratoryRate!, spO2: newsInput.spO2!,
            supplementalO2: newsInput.supplementalO2!, spO2Scale: newsInput.spO2Scale,
            systolicBp: newsInput.systolicBp!, heartRate: newsInput.heartRate!,
            consciousness: newsInput.consciousness!, temperature: newsInput.temperature!,
          });
        }
      } catch (e) {
        this.logger.warn(`EWS 자동 산출 실패(비차단): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // I/O 를 함께 적었으면 몇 건을 I/O 원장에 남겼는지 함께(없으면 저장된 행 그대로 — 응답 모양 불변)
    return ioRecorded ? { ...entry, ioRecorded } : entry;
  }

  // ══════════════════════════════════
  // 체크리스트
  // ══════════════════════════════════

  // 코드 폴백 정본 — 테이블(NursingChecklistTemplate)이 개정 표면(§7 P2)·이 상수는 시드 원본이자 fail-safe.
  // TRANSFUSION: 수혈 체크리스트 — 종전 FE(workstation/blood-bank)에만 하드코딩되어 있던 것 마스터 편입.
  private static readonly CHECKLIST_TEMPLATES: Record<string, { name: string; items: string[] }> = {
    SHIFT_HANDOFF: { name: '근무교대 체크리스트', items: ['환자 확인 (이름+MRN)', '활력징후 확인', '수액/약물 주입 속도 확인', '배액관/카테터 상태', '낙상예방 조치 (침대 난간, 콜벨)', '피부 상태 확인', 'I/O 인계', '특이사항 인계'] },
    SAFETY_IPSG: { name: '환자안전 체크리스트 (IPSG)', items: ['환자 식별 (손목밴드)', '낙상위험 재평가 (Morse)', '욕창위험 재평가 (Braden)', '약물 5 Right 확인', '손위생 실시', '격리 주의사항'] },
    PRE_OP: { name: '수술 전 체크리스트', items: ['금식 확인', '동의서 서명 완료', '수술부위 마킹', '알레르기 확인', '의치/보석 제거', '혈액형/교차시험 확인', '수술 전 투약 완료'] },
    POST_OP: { name: '수술 후 체크리스트', items: ['의식수준 확인', '바이탈 15분 간격', '수술부위 출혈/삼출물', '통증 사정 (NRS)', '체위 변경', '수액 속도 확인', '배액관 상태', '소변량 확인'] },
    FALL_PREVENTION: { name: '낙상예방 체크리스트', items: ['침대 난간 올림', '콜벨 접근 가능', '미끄럼 방지 양말', '보행 보조기 접근', '조명 확인', '바닥 장애물 제거'] },
    PRESSURE_ULCER: { name: '욕창예방 체크리스트', items: ['체위 변경 (2시간)', '피부 상태 관찰', '영양 상태 확인', '습기 관리', '압력 분산 매트', '마찰/전단력 예방'] },
    TRANSFUSION: { name: '수혈 체크리스트', items: ['환자 확인 (이름/생년월일)', '혈액형 확인 (ABO/Rh)', '교차시험 결과 확인', '라벨 정보 확인', '수혈 동의서 확인'] },
  };

  /** 템플릿 시드 — advisory lock 직렬화(다중 부팅 레이스 예방·DUR 사고 교훈). 기존 행은 존중(update 없음) */
  async ensureChecklistTemplatesSeeded() {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nursing-checklist-template-seed'))`;
      for (const [code, t] of Object.entries(NursingService.CHECKLIST_TEMPLATES)) {
        await tx.nursingChecklistTemplate.upsert({
          where: { code },
          create: { code, name: t.name, items: t.items, source: 'SEED' },
          update: {}, // 운영 개정 존중
        });
      }
    });
  }

  async getChecklistTemplates(includeInactive = false) {
    return this.prisma.nursingChecklistTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  /** 템플릿 개정 정본 — 관리 EP·거버넌스 MASTER_DATA 바인딩(P3)이 같은 경로를 쓴다 */
  async upsertChecklistTemplate(code: string, body: { name?: string; items?: unknown; isActive?: boolean; source?: string }, updatedBy?: string) {
    if (body.items !== undefined) {
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.some((i) => typeof i !== 'string' || !i.trim())) {
        throw new BadRequestException('items 는 비어있지 않은 문자열 배열이어야 합니다');
      }
    }
    const fallback = NursingService.CHECKLIST_TEMPLATES[code];
    return this.prisma.nursingChecklistTemplate.upsert({
      where: { code },
      create: {
        code,
        name: body.name ?? fallback?.name ?? code,
        items: (body.items ?? fallback?.items ?? []) as string[],
        isActive: body.isActive ?? true,
        source: body.source,
        updatedBy,
      },
      update: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.items !== undefined ? { items: body.items as string[] } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.source !== undefined ? { source: body.source } : {}),
        updatedBy,
      },
    });
  }

  async getChecklists(admissionId: string, templateType?: string) {
    return this.prisma.nursingChecklist.findMany({
      where: { admissionId, ...(templateType ? { templateType } : {}) },
      include: { nurse: { select: { familyName: true, givenName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createChecklist(admissionId: string, nurseId: string, body: { templateType: string; shiftType?: string }) {
    // 테이블 정본 우선(§7 P2) — 미등재/비활성/형식 이상이면 코드 폴백(fail-safe)
    const dbTpl = await this.prisma.nursingChecklistTemplate.findUnique({ where: { code: body.templateType } }).catch(() => null);
    const dbItems = dbTpl && dbTpl.isActive && Array.isArray(dbTpl.items) && (dbTpl.items as unknown[]).every((i) => typeof i === 'string')
      ? (dbTpl.items as string[]) : null;
    const template = dbItems ? { name: dbTpl!.name, items: dbItems } : NursingService.CHECKLIST_TEMPLATES[body.templateType];
    if (!template) throw new Error(`Unknown template: ${body.templateType}`);

    const items = template.items.map(item => ({ item, checked: false, checkedAt: null, note: null }));

    return this.prisma.nursingChecklist.create({
      data: {
        admissionId, nurseId,
        templateType: body.templateType,
        shiftType: body.shiftType as any,
        items,
        totalItems: items.length,
        checkedItems: 0,
      },
    });
  }

  async toggleChecklistItem(admissionId: string, checklistId: string, index: number, body: { checked: boolean; note?: string }, userId: string) {
    // 🔴 (2026-09-15) 항목은 JSON 배열 통째로 읽고 통째로 다시 쓴다 — 두 간호사가 동시에 다른 항목을 체크하면
    //    나중에 쓴 쪽이 먼저 쓴 쪽의 체크를 **덮어 지웠다**(둘 다 성공 응답). 스키마 변경 없이 행 잠금으로 직렬화한다
    //    (저장소 관례: 트랜잭션 안 `SELECT … FOR UPDATE` — obgyn·radiation 등). 잠근 **뒤에** 읽어야 최신 항목을 본다.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM nursing_checklists WHERE id = ${checklistId}::uuid FOR UPDATE`;
      // 소속 대조 — 경로의 입원에 속하지 않는 체크리스트는 없는 것과 같다(존재 여부를 흘리지 않게 404 하나로)
      const checklist = await tx.nursingChecklist.findFirst({ where: { id: checklistId, admissionId } });
      if (!checklist) throw new NotFoundException({ code: 'NURSING_CHECKLIST_NOT_FOUND', message: '체크리스트를 찾을 수 없습니다' });
      const items = Array.isArray(checklist.items) ? (checklist.items as any[]) : [];
      // 종전 `throw new Error` 는 500 이었다 — 사용자 입력(경로 index) 문제는 400
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        throw new BadRequestException({ code: 'NURSING_CHECKLIST_ITEM_INDEX', message: '체크리스트 항목 번호가 범위를 벗어났습니다' });
      }

      items[index].checked = body.checked;
      items[index].checkedAt = body.checked ? new Date().toISOString() : null;
      // 누가 체크했는가 — 항목 JSON 에 남긴다(스키마 변경 없음). 해제 시 null · 해제한 사람은 감사 로그(변이 기본 감사)가 남긴다.
      items[index].checkedBy = body.checked ? userId : null;
      if (body.note) items[index].note = body.note;

      const checkedItems = items.filter(i => i.checked).length;
      const completedAt = checkedItems === items.length ? new Date() : null;

      return tx.nursingChecklist.update({
        where: { id: checklistId },
        data: { items, checkedItems, completedAt },
      });
    });
  }

  /**
   * 근무조 마감(하번) — 내 담당 환자별로 **이번 근무조에 남긴 것**을 모은다(2026-09-30).
   * 🔴 종전엔 "내가 이번 근무에 무엇을 안 적었는가"를 볼 곳이 없어 교대 직전 기억으로 확인했다.
   *  · 근무조 창 = 교대 경계 설정(`nursing.shift.boundaries`)·병원 표준시 — 서버 OS 시간대(UTC)에 기대지 않는다
   *  · 기록 **유무만** 센다 — 충분한지는 판정하지 않는다(화면도 그렇게 말한다) · 막지 않는다(워크리스트)
   *  · 투약은 이번 근무조 시작~지금 사이 예정분만(아직 오지 않은 시각은 미처리가 아니다)
   *  · 담당 배정이 0이면 빈 목록 + assignments 0 — "모두 완료"로 그리지 않게
   */
  async getShiftCloseout(nurseId: string, now: Date = new Date()) {
    const b = await this.shiftBoundaries();
    const w = shiftWindowAt(now, b);
    const assigns = await this.prisma.nursePatientAssignment.findMany({
      where: { nurseId, releasedAt: null, admission: { status: 'ADMITTED' } },
      select: {
        id: true, admissionId: true, shiftType: true, assignedAt: true,
        admission: {
          select: {
            patientId: true, admitDate: true, dischargeDate: true,
            patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
            bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } },
          },
        },
      },
      orderBy: { assignedAt: 'asc' },
    });
    const head = { shift: w.shift, start: w.start, end: w.end, now, assignments: assigns.length };
    if (!assigns.length) return { ...head, items: [], summary: { withoutMyNote: 0, withoutVitals: 0, pendingMeds: 0, withoutHandoff: 0 } };

    const admissionIds = [...new Set(assigns.map((a) => a.admissionId))];
    const patientIds = [...new Set(assigns.map((a) => a.admission.patientId))];
    const inShift = { gte: w.start, lt: w.end };
    const soFar = { gte: w.start, lt: now < w.end ? now : w.end };
    const [notes, vitals, ios, meds, handoffs] = await Promise.all([
      this.prisma.nursingNote.findMany({ where: { admissionId: { in: admissionIds }, recordedAt: inShift }, select: { admissionId: true, nurseId: true, status: true } }),
      // 두 원장 정본(2026-10-10) — 간호 스테이션에서 잰 활력도 '기록 있음'
      this.admissionVitals.rows([...new Map(assigns.map((a) => [a.admissionId, { id: a.admissionId, patientId: a.admission.patientId, admitDate: a.admission.admitDate, dischargeDate: a.admission.dischargeDate }])).values()], inShift),
      // 두 원장 정본(2026-10-10) — 플로시트에 적은 I/O 도 '기록 있음'
      this.ioReader.rows(admissionIds, inShift),
      this.prisma.medicationAdministration.findMany({ where: { patientId: { in: patientIds }, scheduledAt: soFar }, select: { patientId: true, status: true } }),
      this.prisma.clinicalHandoff.findMany({
        where: { admissionId: { in: admissionIds }, fromDoctorId: nurseId, createdAt: { gte: w.start } },
        select: { admissionId: true, createdAt: true, acknowledgedAt: true, toDoctor: { select: { id: true, familyName: true, givenName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const countBy = <T>(rows: T[], key: (r: T) => string | null) => {
      const m = new Map<string, number>();
      for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    const myNotes = countBy(notes.filter((n) => n.nurseId === nurseId), (n) => n.admissionId);
    const myDrafts = countBy(notes.filter((n) => n.nurseId === nurseId && n.status === 'DRAFT'), (n) => n.admissionId);
    const allNotes = countBy(notes, (n) => n.admissionId);
    const vitalsBy = countBy(vitals, (v) => v.admissionId);
    const ioBy = countBy(ios, (v) => v.admissionId);
    const medDue = countBy(meds, (m) => m.patientId);
    const medPending = countBy(meds.filter((m) => m.status === 'SCHEDULED'), (m) => m.patientId);
    const handoffBy = new Map<string, (typeof handoffs)[number]>();
    for (const h of handoffs) if (h.admissionId && !handoffBy.has(h.admissionId)) handoffBy.set(h.admissionId, h);

    const items = assigns.map((a) => {
      const h = handoffBy.get(a.admissionId);
      return {
        assignmentId: a.id,
        admissionId: a.admissionId,
        patient: a.admission.patient,
        bed: a.admission.bed,
        notes: { mine: myNotes.get(a.admissionId) ?? 0, total: allNotes.get(a.admissionId) ?? 0, myDrafts: myDrafts.get(a.admissionId) ?? 0 },
        vitals: vitalsBy.get(a.admissionId) ?? 0,
        io: ioBy.get(a.admissionId) ?? 0,
        meds: { dueSoFar: medDue.get(a.admission.patientId) ?? 0, pending: medPending.get(a.admission.patientId) ?? 0 },
        handoff: h ? { at: h.createdAt, acknowledgedAt: h.acknowledgedAt, to: h.toDoctor } : null,
      };
    });
    return {
      ...head,
      items,
      summary: {
        withoutMyNote: items.filter((i) => i.notes.mine === 0).length,
        withoutVitals: items.filter((i) => i.vitals === 0).length,
        pendingMeds: items.reduce((s, i) => s + i.meds.pending, 0),
        withoutHandoff: items.filter((i) => !i.handoff).length,
      },
    };
  }

  /**
   * 간호 스테이션 보드 — 병동별 재원 환자 실시간 현황.
   * EWS(조기경보)·투약 지연/예정·낙상위험·최근 간호기록(미서명)을 환자별로 집계.
   */
  async getStationBoard(wardId?: string, now: Date = new Date()) {
    // 근무조 창 — 이번 근무조와 직전 근무조(상·하번 인계가 오가는 구간) · 경계는 config·병원 표준시
    const b = await this.shiftBoundaries();
    const cur = shiftWindowAt(now, b);
    const prev = shiftWindowAt(new Date(cur.start.getTime() - 1), b);
    const shift = { current: cur.shift, start: cur.start, end: cur.end, previous: prev.shift, previousStart: prev.start, now };
    const emptyHandoffs = { items: [] as unknown[], total: 0, truncated: false, since: prev.start, limit: STATION_HANDOFF_FEED_LIMIT };
    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED', ...(wardId ? { bed: { wardId } } : {}) },
      select: {
        id: true, admitDate: true, patientId: true, expectedDischargeDate: true,
        patient: { select: { familyName: true, givenName: true, koreanName: true, mrn: true } },
        bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { id: true, name: true } } } },
      },
      orderBy: { admitDate: 'asc' },
    });
    const emptySummary = { total: 0, highRisk: 0, medsOverdue: 0, unsignedNotes: 0, isolated: 0, handoffPending: 0, handoffsInWindow: 0, handoffsInWindowPending: 0, shiftWithoutNote: 0, shiftWithoutVitals: 0, shiftWithoutHandoff: 0, shiftMedsPending: 0, vitalsStaleHours: null as number | null, vitalsStale: null as number | null, vitalsNever: 0, criticalOpenPatients: 0, surgeryUpcoming: 0, npo: 0, dischargeToday: 0, transferPending: 0 };
    const next = shiftWindowAt(cur.end, b);
    const staffing = await this.stationStaffing(cur, next, wardId);
    if (!admissions.length) return { wards: [], patients: [], summary: emptySummary, shift, handoffs: emptyHandoffs, staffing: { ...staffing, assignees: [] } };

    const patientIds = [...new Set(admissions.map((a) => a.patientId))];
    const admissionIds = admissions.map((a) => a.id);

    // 환자별 최신 EWS / 낙상위험 (DISTINCT ON)
    const ewsRows = await this.prisma.$queryRaw<Array<{ patient_id: string; total_score: number; risk_level: string; escalation_required: boolean; recorded_at: Date }>>`
      SELECT DISTINCT ON (patient_id) patient_id, total_score, risk_level, escalation_required, recorded_at
      FROM early_warning_scores WHERE patient_id::text IN (${Prisma.join(patientIds)})
      ORDER BY patient_id, recorded_at DESC`;
    // assessed_at 동봉 — 평가 시각이 없으면 화면이 오래된 낙상 위험을 최신처럼 보여준다
    const fallRows = await this.prisma.$queryRaw<Array<{ patient_id: string; risk_level: string; score: number; assessed_at: Date }>>`
      SELECT DISTINCT ON (patient_id) patient_id, risk_level, score, assessed_at
      FROM fall_risk_assessments WHERE patient_id::text IN (${Prisma.join(patientIds)})
      ORDER BY patient_id, assessed_at DESC`;
    const ewsBy = new Map(ewsRows.map((r) => [r.patient_id, r]));
    const fallBy = new Map(fallRows.map((r) => [r.patient_id, r]));

    // 투약(MAR) — 오늘 예정 + 지연
    // 🔴 (2026-10-07) 종전엔 "오늘 0시 이후 예정"만 봐서 **22시 투약을 놓치면 자정에 지연에서 사라졌다** — 야간조 인계 직전에 지연 0.
    //    지연은 날짜와 무관하게 "예정 시각이 지났는데 아직 SCHEDULED" 다. 되돌아보는 창은 24시간(그보다 오래된 미투약은 MAR 화면에서).
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const lookback = new Date(now.getTime() - 24 * 3_600_000);
    const meds = await this.prisma.medicationAdministration.findMany({
      where: { patientId: { in: patientIds }, scheduledAt: { gte: lookback < dayStart ? lookback : dayStart, lt: dayEnd }, status: MedAdminStatus.SCHEDULED },
      select: { patientId: true, scheduledAt: true },
    });
    const medsBy = new Map<string, { due: number; overdue: number }>();
    for (const m of meds) {
      const e = medsBy.get(m.patientId) ?? { due: 0, overdue: 0 };
      if (m.scheduledAt >= dayStart) e.due += 1; // 오늘 예정
      if (m.scheduledAt < now) e.overdue += 1; // 어제 넘어온 미투약 포함
      medsBy.set(m.patientId, e);
    }

    // 입원별 최신 간호기록 + 미서명(DRAFT) 수
    const notes = await this.prisma.nursingNote.findMany({
      where: { admissionId: { in: admissionIds } },
      select: { admissionId: true, recordedAt: true, status: true },
      orderBy: { recordedAt: 'desc' },
    });
    const noteBy = new Map<string, { lastAt: Date | null; unsigned: number }>();
    for (const n of notes) {
      const e = noteBy.get(n.admissionId) ?? { lastAt: null, unsigned: 0 };
      if (!e.lastAt) e.lastAt = n.recordedAt;
      if (n.status === 'DRAFT') e.unsigned += 1;
      noteBy.set(n.admissionId, e);
    }

    // 미확인 인수인계 — 수간호사 관제(인계가 확인 없이 쌓이면 보드에서 보인다·P1-2)
    const handoffPending = await this.prisma.clinicalHandoff.count({
      where: { acknowledgedAt: null, patientId: { in: patientIds } },
    });

    // 상·하번 인계 메모 — 이번·직전 근무조에 이 보드의 입원에 남긴 인계(I-PASS 전체) + 입원별 마지막 인계(창 밖이어도 · 경과를 함께)
    const handoffWhere = { admissionId: { in: admissionIds }, createdAt: { gte: prev.start } };
    const userBrief = { select: { id: true, familyName: true, givenName: true } } as const;
    const [feedRows, feedTotal, feedPending, lastHandoffs, assigns] = await Promise.all([
      this.prisma.clinicalHandoff.findMany({
        where: handoffWhere,
        select: {
          id: true, type: true, admissionId: true, patientId: true, illness: true, summary: true, patientSummary: true,
          actionList: true, situationAwareness: true, synthesis: true, pendingItems: true, acknowledgedAt: true, createdAt: true,
          fromDoctor: userBrief, toDoctor: userBrief,
        },
        orderBy: { createdAt: 'desc' },
        take: STATION_HANDOFF_FEED_LIMIT,
      }),
      this.prisma.clinicalHandoff.count({ where: handoffWhere }),
      this.prisma.clinicalHandoff.count({ where: { ...handoffWhere, acknowledgedAt: null } }),
      this.prisma.clinicalHandoff.findMany({
        where: { admissionId: { in: admissionIds } },
        distinct: ['admissionId'],
        orderBy: [{ admissionId: 'asc' }, { createdAt: 'desc' }],
        select: { id: true, admissionId: true, illness: true, summary: true, patientSummary: true, actionList: true, acknowledgedAt: true, createdAt: true },
      }),
      // 지금 담당(해제 안 된 배정) — 주 담당 먼저 · 최근 배정 먼저
      this.prisma.nursePatientAssignment.findMany({
        where: { admissionId: { in: admissionIds }, releasedAt: null },
        select: { admissionId: true, shiftType: true, isPrimary: true, assignedAt: true, nurse: userBrief },
        orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'desc' }],
      }),
    ]);
    const nurseBy = new Map<string, (typeof assigns)[number]>();
    for (const a of assigns) if (!nurseBy.has(a.admissionId)) nurseBy.set(a.admissionId, a);
    const lastHandoffBy = new Map(lastHandoffs.map((h) => [h.admissionId as string, h]));

    // 활성 감염 격리(PPE) — 병동 간호가 접촉 전 즉시 인지(직원·교차감염 안전)
    const isoRows = await this.prisma.isolationPrecaution.findMany({
      where: { patientId: { in: patientIds }, status: 'ACTIVE' },
      select: { patientId: true, type: true },
    });
    const isoBy = new Map<string, string[]>();
    for (const i of isoRows) {
      const arr = isoBy.get(i.patientId) ?? [];
      arr.push(i.type);
      isoBy.set(i.patientId, arr);
    }

    // 이번 근무조 기록 유무(병동 단위 근무조 마감 · 2026-10-04) — `getShiftCloseout`(내 담당)과 같은 규칙:
    //  기록 **유무만** 센다(충분한지 판정 아님) · 투약은 근무조 시작~지금 예정분만(아직 오지 않은 시각은 미처리가 아니다)
    const inShift = { gte: cur.start, lt: cur.end };
    const soFar = { gte: cur.start, lt: now < cur.end ? now : cur.end };
    const [shiftNotes, shiftVitals, shiftIo, shiftMeds, shiftHandoffs, lastVitals, staleRaw] = await Promise.all([
      this.prisma.nursingNote.groupBy({ by: ['admissionId'], where: { admissionId: { in: admissionIds }, recordedAt: inShift }, _count: { _all: true } }),
      // 두 원장 정본(2026-10-10) — 종전 플로시트만 세어 간호 스테이션 'VS 일괄' 입력이 '활력 없음'이었다
      this.admissionVitals.rows(admissions, inShift).then((rows) => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(r.admissionId, (m.get(r.admissionId) ?? 0) + 1);
        return [...m].map(([admissionId, n]) => ({ admissionId, _count: { _all: n } }));
      }),
      this.ioReader.countByAdmission(admissionIds, inShift).then((m) => [...m].map(([admissionId, n]) => ({ admissionId, _count: { _all: n } }))),
      this.prisma.medicationAdministration.findMany({ where: { patientId: { in: patientIds }, scheduledAt: soFar }, select: { patientId: true, status: true } }),
      this.prisma.clinicalHandoff.groupBy({ by: ['admissionId'], where: { admissionId: { in: admissionIds }, createdAt: inShift }, _count: { _all: true } }),
      // 마지막 활력 — 두 원장 정본(입원 활력 읽기 정본) · 측정이 없으면 null(지어내지 않는다)
      this.admissionVitals.latestByAdmission(admissions).then((m) => [...m.values()].map((v) => ({ admissionId: v.admissionId, _max: { recordedAt: v.at } }))),
      this.config?.get('nursing.vitals.boardStaleHours') ?? null,
    ]);
    const lastVitalsBy = new Map(lastVitals.map((r) => [r.admissionId as string, r._max.recordedAt]));

    // ④~⑦ 안전·일정 신호(2026-10-04) — 이미 있는 원장에서만 · 없으면 빈 값(지어내지 않는다)
    //  · 위급값: 미확인(정본 열린 상태 PENDING·ESCALATED) — 환자 단위 원장이라 입원 전 경보도 열려 있으면 보인다(통보 시각 함께)
    //  · 수술: 오늘(병원 표준시)~내일 끝까지 예정·진행 중 가장 이른 것 · 금식: 활성 식이 오더 NPO
    //  · 퇴원 예정일 · 열린 전동 요청(보내는 쪽) — 받는 병동 이름은 병동 원장에서
    const kstDay0 = (() => { const k = new Date(now.getTime() + HOSPITAL_TZ_OFFSET_MIN * 60_000); return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - HOSPITAL_TZ_OFFSET_MIN * 60_000); })();
    const surgeryUntil = new Date(kstDay0.getTime() + 2 * 86_400_000);
    const [critRows, surgRows, npoRows, transferRows] = await Promise.all([
      this.prisma.criticalValueAlert.findMany({
        where: { patientId: { in: patientIds }, status: { in: [...CRITICAL_ALERT_OPEN_STATUSES] } },
        select: { id: true, patientId: true, testName: true, value: true, unit: true, status: true, notifiedAt: true },
        orderBy: { notifiedAt: 'desc' },
      }),
      this.prisma.surgery.findMany({
        where: { patientId: { in: patientIds }, status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, scheduledAt: { gte: new Date(kstDay0.getTime() - 12 * 3_600_000), lt: surgeryUntil } },
        select: { id: true, patientId: true, scheduledAt: true, procedureName: true, status: true },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.dietOrder.findMany({ where: { admissionId: { in: admissionIds }, isActive: true, dietType: 'NPO' }, select: { admissionId: true, startDate: true } }),
      this.prisma.bedTransferRequest.findMany({ where: { admissionId: { in: admissionIds }, status: 'REQUESTED' }, select: { id: true, admissionId: true, targetWardId: true, requestedAt: true } }),
    ]);
    const critBy = new Map<string, typeof critRows>();
    for (const c of critRows) critBy.set(c.patientId, [...(critBy.get(c.patientId) ?? []), c]);
    const surgBy = new Map<string, (typeof surgRows)[number]>();
    for (const x of surgRows) if (!surgBy.has(x.patientId)) surgBy.set(x.patientId, x);
    const npoBy = new Map(npoRows.map((n) => [n.admissionId, n.startDate]));
    const targetWards = transferRows.length
      ? new Map((await this.prisma.ward.findMany({ where: { id: { in: [...new Set(transferRows.map((t) => t.targetWardId))] } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]))
      : new Map<string, string>();
    const transferBy = new Map(transferRows.map((t) => [t.admissionId, { id: t.id, targetWard: targetWards.get(t.targetWardId) ?? null, requestedAt: t.requestedAt }]));
    // 강조 기준은 원내 정책 — 미설정이면 null(보드가 '기준 미설정'이라 말하고 지연을 판정하지 않는다)
    const staleHours = (() => { const n = Number(staleRaw); return Number.isInteger(n) && n >= 1 && n <= 72 ? n : null; })();
    const cnt = (rows: Array<{ admissionId: string | null; _count: { _all: number } }>) => new Map(rows.map((r) => [r.admissionId as string, r._count._all]));
    const notesIn = cnt(shiftNotes); const vitalsIn = cnt(shiftVitals); const ioIn = cnt(shiftIo); const handoffsIn = cnt(shiftHandoffs);
    const medsSoFar = new Map<string, { due: number; pending: number }>();
    for (const m of shiftMeds) {
      const e = medsSoFar.get(m.patientId) ?? { due: 0, pending: 0 };
      e.due += 1; if (m.status === MedAdminStatus.SCHEDULED) e.pending += 1;
      medsSoFar.set(m.patientId, e);
    }

    const RISK_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW_MEDIUM: 1, LOW: 0 };
    const rows = admissions.map((a) => {
      const ews = ewsBy.get(a.patientId);
      const fall = fallBy.get(a.patientId);
      const med = medsBy.get(a.patientId) ?? { due: 0, overdue: 0 };
      const note = noteBy.get(a.id) ?? { lastAt: null, unsigned: 0 };
      // 재원일수 정본 — 입원료 청구(createInpatientStayBilling)와 같은 산식(ceil·당일=1일).
      // 종전 floor 는 청구서(3일)보다 하루 적게(2일) 보였다.
      const losDays = stayDays(a.admitDate) ?? 1;
      const highRisk = !!ews && (ews.risk_level === 'HIGH' || ews.escalation_required);
      return {
        admissionId: a.id, patientId: a.patientId,
        // 성+이름은 정본(외국 이름 띄어쓰기) · 외국인은 한국식 호칭을 함께
        name: joinPatientName(a.patient.familyName, a.patient.givenName), koreanName: a.patient.koreanName ?? null, mrn: a.patient.mrn,
        ward: a.bed?.ward?.name ?? '-', wardId: a.bed?.ward?.id ?? null,
        room: a.bed?.roomNumber ?? '-', bed: a.bed?.bedNumber ?? '-',
        losDays,
        ews: ews ? { score: ews.total_score, risk: ews.risk_level, escalation: ews.escalation_required, at: ews.recorded_at } : null,
        fall: fall ? { risk: fall.risk_level, score: fall.score, at: fall.assessed_at } : null,
        meds: med,
        lastNoteAt: note.lastAt, unsignedNotes: note.unsigned,
        isolation: isoBy.get(a.patientId) ?? [],
        highRisk,
        lastVitalsAt: lastVitalsBy.get(a.id) ?? null,
        criticalOpen: (critBy.get(a.patientId) ?? []).map(({ patientId: _p, ...c }) => c),
        surgery: (() => { const x = surgBy.get(a.patientId); return x ? { id: x.id, scheduledAt: x.scheduledAt, procedureName: x.procedureName, status: x.status } : null; })(),
        npo: npoBy.has(a.id) ? { since: npoBy.get(a.id) ?? null } : null,
        expectedDischargeAt: a.expectedDischargeDate ?? null,
        transferPending: transferBy.get(a.id) ?? null,
        // 이번 근무조 기록 유무 — 수만(충분성 판정 없음) · 투약은 지금까지 예정분 중 미처리
        shiftRecord: {
          notes: notesIn.get(a.id) ?? 0, vitals: vitalsIn.get(a.id) ?? 0, io: ioIn.get(a.id) ?? 0,
          medsDue: medsSoFar.get(a.patientId)?.due ?? 0, medsPending: medsSoFar.get(a.patientId)?.pending ?? 0,
          handoffs: handoffsIn.get(a.id) ?? 0,
        },
        // 지금 담당 간호사 — 배정이 없으면 null(지어내지 않는다 · 화면이 "담당 배정 없음")
        nurse: (() => {
          const n = nurseBy.get(a.id);
          return n ? { id: n.nurse.id, name: `${n.nurse.familyName ?? ''}${n.nurse.givenName ?? ''}`.trim(), shiftType: n.shiftType, assignedAt: n.assignedAt, isPrimary: n.isPrimary } : null;
        })(),
        handoff: (() => {
          const h = lastHandoffBy.get(a.id);
          if (!h) return null;
          const acts = handoffActionsOf(h.actionList);
          // 메모 본문은 자르지 않는다(화면이 줄 수를 정하고 잘렸음을 보인다) · 조치 목록 모양을 모르면 null
          return {
            id: h.id, at: h.createdAt, acknowledgedAt: h.acknowledgedAt, illness: h.illness,
            memo: h.patientSummary ?? h.summary, openActions: acts ? acts.open : null,
            inWindow: h.createdAt.getTime() >= prev.start.getTime(),
          };
        })(),
      };
    });

    // 위험 우선 정렬: 고위험 → EWS 점수 → 투약지연 → 병실
    rows.sort((a, b) =>
      Number(b.highRisk) - Number(a.highRisk)
      || (b.ews?.score ?? -1) - (a.ews?.score ?? -1)
      || b.meds.overdue - a.meds.overdue
      || (RISK_RANK[b.fall?.risk ?? ''] ?? -1) - (RISK_RANK[a.fall?.risk ?? ''] ?? -1)
      || a.room.localeCompare(b.room));

    const wards = Array.from(new Map(rows.filter((r) => r.wardId).map((r) => [r.wardId, { id: r.wardId as string, name: r.ward }])).values());
    const summary = {
      total: rows.length,
      highRisk: rows.filter((r) => r.highRisk).length,
      medsOverdue: rows.filter((r) => r.meds.overdue > 0).length,
      unsignedNotes: rows.reduce((s, r) => s + r.unsignedNotes, 0),
      isolated: rows.filter((r) => r.isolation.length > 0).length,
      handoffPending,
      handoffsInWindow: feedTotal,
      handoffsInWindowPending: feedPending,
      // 이번 근무조 마감 — 기록이 하나도 없는 환자 수(병동 단위 · 유무만)
      shiftWithoutNote: rows.filter((r) => r.shiftRecord.notes === 0).length,
      shiftWithoutVitals: rows.filter((r) => r.shiftRecord.vitals === 0).length,
      shiftWithoutHandoff: rows.filter((r) => r.shiftRecord.handoffs === 0).length,
      shiftMedsPending: rows.reduce((n, r) => n + r.shiftRecord.medsPending, 0),
      // 활력 경과 — 기준 미설정이면 수도 null(0 으로 접지 않는다) · 측정 기록이 아예 없는 환자는 따로
      vitalsStaleHours: staleHours,
      vitalsStale: staleHours == null ? null : rows.filter((r) => r.lastVitalsAt && now.getTime() - r.lastVitalsAt.getTime() > staleHours * 3_600_000).length,
      vitalsNever: rows.filter((r) => !r.lastVitalsAt).length,
      criticalOpenPatients: rows.filter((r) => r.criticalOpen.length > 0).length,
      surgeryUpcoming: rows.filter((r) => r.surgery).length,
      npo: rows.filter((r) => r.npo).length,
      // 퇴원 예정 오늘(병원 표준시) · 열린 전동 요청
      dischargeToday: rows.filter((r) => r.expectedDischargeAt && r.expectedDischargeAt >= kstDay0 && r.expectedDischargeAt.getTime() < kstDay0.getTime() + 86_400_000).length,
      transferPending: rows.filter((r) => r.transferPending).length,
    };
    const placeBy = new Map(rows.map((r) => [r.admissionId, r]));
    const handoffs = {
      items: feedRows.map((h) => {
        const r = placeBy.get(h.admissionId as string);
        return {
          ...h,
          shift: h.createdAt.getTime() >= cur.start.getTime() ? cur.shift : prev.shift,
          room: r?.room ?? null, bed: r?.bed ?? null, ward: r?.ward ?? null, patientName: r?.name ?? null, patientKoreanName: r?.koreanName ?? null, mrn: r?.mrn ?? null,
        };
      }),
      total: feedTotal,
      truncated: feedTotal > feedRows.length,
      since: prev.start,
      limit: STATION_HANDOFF_FEED_LIMIT,
    };
    // 하번(이번 근무조) 담당자별 — 담당 환자 수 · 이 창에서 남긴 인계 · 받는 사람이 아직 확인 안 한 인계
    const byNurse = new Map<string, { userId: string; name: string; patients: number; handoffsWritten: number; handoffsUnacked: number; handoffsToAck: number }>();
    const ensure = (u: { id: string; familyName?: string | null; givenName?: string | null }) => {
      let e = byNurse.get(u.id);
      if (!e) { e = { userId: u.id, name: `${u.familyName ?? ''}${u.givenName ?? ''}`.trim(), patients: 0, handoffsWritten: 0, handoffsUnacked: 0, handoffsToAck: 0 }; byNurse.set(u.id, e); }
      return e;
    };
    for (const n of nurseBy.values()) ensure(n.nurse).patients += 1;
    // 피드가 잘렸으면 인계 수도 잘린 범위의 수다 — 화면이 truncated 를 함께 말한다
    for (const h of feedRows) {
      if (h.fromDoctor && byNurse.has(h.fromDoctor.id)) {
        const e = byNurse.get(h.fromDoctor.id)!; e.handoffsWritten += 1; if (!h.acknowledgedAt) e.handoffsUnacked += 1;
      }
    }
    const toAckBy = new Map<string, number>();
    for (const h of feedRows) if (h.toDoctor && !h.acknowledgedAt) toAckBy.set(h.toDoctor.id, (toAckBy.get(h.toDoctor.id) ?? 0) + 1);
    const withAck = <T extends { userId: string }>(xs: T[]) => xs.map((x) => ({ ...x, handoffsToAck: toAckBy.get(x.userId) ?? 0 }));
    return {
      wards, patients: rows, summary, shift, handoffs,
      staffing: {
        ...staffing,
        current: { ...staffing.current, roster: withAck(staffing.current.roster) },
        next: { ...staffing.next, roster: withAck(staffing.next.roster) },
        assignees: withAck([...byNurse.values()].sort((x, y) => y.patients - x.patients || x.name.localeCompare(y.name))),
      },
    };
  }

  /**
   * ⑩ 벽걸이(TV) 화면 응답 — 보드 정본(getStationBoard)에서 **허용 목록만** 골라 만든다(지울 것을 고르는 방식이 아니라 남길 것을 고른다 —
   *    보드에 새 필드가 생겨도 벽걸이로 새지 않게).
   */
  async getStationWall(wardId?: string, now: Date = new Date()) {
    const b = await this.getStationBoard(wardId, now);
    const mask = (full: string | null | undefined) => {
      const f = (full ?? '').trim();
      return f ? maskPublicName(f.slice(0, 1), f.slice(1)) : null;
    };
    const fresh = (at: Date | null | undefined) => !!at && now.getTime() - at.getTime() <= 24 * 3_600_000;
    return {
      shift: b.shift ? { current: b.shift.current, start: b.shift.start, end: b.shift.end } : null,
      wardName: wardId ? (b.wards.find((w) => w.id === wardId)?.name ?? null) : null,
      generatedAt: now,
      patients: b.patients.map((r) => ({
        room: r.room, bed: r.bed, ward: r.ward,
        name: mask(r.name),
        highRisk: r.highRisk,
        // 24시간 넘은 평가는 위험 등급을 보이지 않는다(오래된 값이 지금처럼 읽히지 않게) — 있음만
        ewsRisk: r.ews && fresh(r.ews.at) ? r.ews.risk : null,
        ewsStale: !!r.ews && !fresh(r.ews.at),
        fallRisk: r.fall && fresh(r.fall.at) ? r.fall.risk : null,
        isolation: r.isolation,
        medsOverdue: r.meds.overdue,
        criticalOpen: r.criticalOpen.length,
        surgeryAt: r.surgery?.scheduledAt ?? null,
        surgeryInProgress: r.surgery?.status === 'IN_PROGRESS',
        npo: !!r.npo,
        expectedDischargeAt: r.expectedDischargeAt,
        transferPending: !!r.transferPending,
        nurse: r.nurse ? mask(r.nurse.name) : null,
        handoffUnacked: !!r.handoff && !r.handoff.acknowledgedAt,
      })),
      summary: {
        total: b.summary.total, highRisk: b.summary.highRisk, isolated: b.summary.isolated,
        medsOverdue: b.summary.medsOverdue, criticalOpenPatients: b.summary.criticalOpenPatients,
        npo: b.summary.npo, surgeryUpcoming: b.summary.surgeryUpcoming, dischargeToday: b.summary.dischargeToday,
      },
    };
  }

  /**
   * 근무표(DutyEntry · role nurse) — 이번 근무조(하번)·다음 근무조(상번).
   * 🔴 근무표 부서(예: '간호부 (내과병동)')와 병동 이름을 잇는 정본이 없다 — 병동으로 거르지 않고 **병원 전체**를 부서와 함께 준다
   *    (이름이 비슷해 보인다고 짝지으면 다른 병동 간호사를 우리 병동 상번으로 말한다). 화면이 그 사실을 말한다.
   * 날짜 = 그 근무조가 **시작하는** 병원 표준시 날짜(야간 23시 시작은 그날) — `getNextShiftNurses` 와 같은 규칙.
   * 근무표가 비면 빈 목록 + 근무표 최신일(낡았는지 화면이 판단할 수 있게) — "근무자 없음"으로 단정하지 않는다.
   */
  private async stationStaffing(cur: { shift: string; start: Date }, next: { shift: string; start: Date }, wardId?: string) {
    const dateOf = (t: Date) => {
      const k = new Date(t.getTime() + HOSPITAL_TZ_OFFSET_MIN * 60_000);
      return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate())); // @db.Date = UTC 자정 표현
    };
    const sel = { staffId: true, staffName: true, department: true } as const;
    // 병동을 골랐고 그 병동에 사람이 연결한 근무표 부서가 있으면 그 부서만 — 없으면 병원 전체(그 사실을 rosterScope 로)
    const mapping = normalizeRosterWardDepartments(await this.config?.get(ROSTER_WARD_DEPARTMENTS_KEY) ?? null);
    const wardDepartments = wardId ? (mapping?.[wardId] ?? null) : null;
    const deptWhere = wardDepartments ? { department: { in: wardDepartments } } : {};
    const [curRows, nextRows, latest, deptRows] = await Promise.all([
      this.prisma.dutyEntry.findMany({ where: { date: dateOf(cur.start), shift: cur.shift, role: 'nurse', ...deptWhere }, select: sel, orderBy: { staffName: 'asc' } }),
      this.prisma.dutyEntry.findMany({ where: { date: dateOf(next.start), shift: next.shift, role: 'nurse', ...deptWhere }, select: sel, orderBy: { staffName: 'asc' } }),
      this.prisma.dutyEntry.findFirst({ where: { role: 'nurse' }, orderBy: { date: 'desc' }, select: { date: true } }),
      // 연결 편집용 — 근무표에 나온 적 있는 간호 부서(관리자가 고르는 선택지)
      this.prisma.dutyEntry.findMany({ where: { role: 'nurse' }, distinct: ['department'], select: { department: true }, orderBy: { department: 'asc' } }),
    ]);
    const roster = (rows: typeof curRows) => rows.map((r) => ({ userId: r.staffId, name: r.staffName, department: r.department }));
    return {
      current: { shift: cur.shift, date: dateOf(cur.start), roster: roster(curRows) },
      next: { shift: next.shift, date: dateOf(next.start), roster: roster(nextRows) },
      rosterLatestDate: latest?.date ?? null,
      // WARD = 연결된 부서로 거름 · HOSPITAL = 전체(병동을 안 골랐거나 그 병동이 연결 안 됨 — wardUnmapped 로 구분)
      rosterScope: (wardDepartments ? 'WARD' : 'HOSPITAL') as 'WARD' | 'HOSPITAL',
      wardDepartments,
      wardUnmapped: !!wardId && !wardDepartments,
      rosterDepartments: deptRows.map((d) => d.department),
    };
  }

  /**
   * 간호사 타블렛 — 환자식별 QR/코드 해석(IPSG.1). 손목밴드 QR 페이로드(MRN 또는 patientId)를
   * 활성 입원·환자명·MRN·병상으로 해석해 타블렛이 즉시 차트 진입. NURSE 가드(컨트롤러)·AI 게이트 무관(조회).
   */
  async resolvePatientByCode(code: string): Promise<{ admissionId: string | null; patientId: string; name: string; mrn: string; ward: string | null; bed: string | null }> {
    const c = (code ?? '').trim();
    if (!c) throw new BadRequestException({ code: 'QR_CODE_EMPTY', message: '식별 코드가 없습니다.' });
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c);
    const patient = await this.prisma.patient.findFirst({
      where: isUuid ? { OR: [{ id: c }, { mrn: c }] } : { mrn: c },
      select: { id: true, mrn: true, familyName: true, givenName: true },
    });
    if (!patient) throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: '환자를 찾을 수 없습니다(QR·식별자 재확인).' });
    const adm = await this.prisma.admission.findFirst({
      where: { patientId: patient.id, status: 'ADMITTED' },
      orderBy: { admitDate: 'desc' },
      select: { id: true, bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } } },
    });
    return {
      admissionId: adm?.id ?? null,
      patientId: patient.id,
      name: `${patient.familyName ?? ''}${patient.givenName ?? ''}`.trim() || '환자',
      mrn: patient.mrn,
      ward: adm?.bed?.ward?.name ?? null,
      bed: adm?.bed ? `${adm.bed.roomNumber}-${adm.bed.bedNumber}` : null,
    };
  }

  /**
   * F-5 스테이션 브리핑(게이트·기획 P3) — getStationBoard 집계를 **한 문단**으로 요약(결정적·읽기 보조).
   * 고위험·투약지연·미서명을 인계/라운드 우선순위로 제시. 행동은 기존 보드 링크(저장 없음).
   */
  async getStationBriefing(wardId?: string): Promise<{ enabled: boolean; source: string; briefing: string; summary: { total: number; highRisk: number; medsOverdue: number; unsignedNotes: number } }> {
    if (!(await this.isAiAssistEnabled())) {
      throw new BadRequestException({ code: 'AI_ASSIST_DISABLED', message: '간호기록 AI 보조가 비활성 상태입니다.' });
    }
    const board = await this.getStationBoard(wardId);
    const s = board.summary;
    if (s.total === 0) return { enabled: true, source: 'DATA', briefing: '현재 재원 환자가 없습니다.', summary: s };
    const highNames = board.patients.filter((p) => p.highRisk).slice(0, 5).map((p) => `${p.name}(${p.room})`);
    const parts: string[] = [`재원 ${s.total}명`];
    parts.push(s.highRisk > 0 ? `고위험(EWS) ${s.highRisk}명: ${highNames.join(', ')}` : '고위험 환자 없음');
    if (s.medsOverdue > 0) parts.push(`투약 지연 ${s.medsOverdue}명`);
    if (s.unsignedNotes > 0) parts.push(`미서명 기록 ${s.unsignedNotes}건`);
    const action = s.highRisk > 0 ? ' 고위험 환자 우선 라운드를 권고합니다.' : s.unsignedNotes > 0 ? ' 교대 전 미서명 기록 확인을 권고합니다.' : '';
    return { enabled: true, source: 'DATA', briefing: parts.join(' · ') + '.' + action, summary: s };
  }
}