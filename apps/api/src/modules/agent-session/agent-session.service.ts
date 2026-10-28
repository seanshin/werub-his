import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PublicAccessLogService } from '../public-access/public-access-log.service';
import { ageOf, localeTimeText } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildMedicationSearchWhere, MEDICATION_SEARCH_ORDER } from '../../common/medication-search';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { TriageService, TriageResult, ExtractedSymptoms } from '../triage/triage.service';
import { TRIAGE_EXAMPLE_PHRASES, PATIENT_EMERGENCY_ACTION, PATIENT_EMERGENCY_UNDETERMINED, normalizeSymptomText } from '../triage/symptom-match';
import { HolidayService } from '../holiday/holiday.service';
import { QuestionnaireService } from '../questionnaire/questionnaire.service';
import { PATIENT_NAME_PLACEHOLDER, aiPseudonymousId, redactForAiEgress } from '../../common/util/ai-phi-redact';
// 병원 정체 정본 — system_configs `hospital.*` 의 DB 행만(DEFAULTS 플레이스홀더로 떨어지지 않는다). 모듈 함수라 DI 변경 없음
import { readHospitalFacts, formatHospitalContext, hospitalHoursLines, type HospitalFacts } from '../config/config-runtime.service';
import { HospitalInfoService } from '../hospital-info/hospital-info.service';

/**
 * 🔴 원 결함 T4/T5 — 여기에 컴파일 타임 `SYMPTOM_DEPT_MAP` / `SYMPTOM_ALIAS` 사본이 있었다.
 *    타입이 `{ depts, reasons }` 뿐이라 **응급 개념 자체가 없었고**, `recommendDepartments()` 가
 *    MRN+증상 경로와 원무 데스크 경로에서 이 맵을 써서
 *      · 관리 화면(/admin/triage)에서 규칙을 고쳐도 반영되지 않았고
 *      · 응급 경고가 아예 나가지 않았다(흉통 → 내과 1순위).
 *    같은 흉통에 답이 셋이던 원인(하드코딩 맵 / DB 점수식 / migrate 맵)이기도 하다.
 *    → 두 사본을 지우고 **DB 규칙(TriageService) 하나**만 쓴다. 증상 매칭도 같은 함수를 쓴다.
 *
 * 🔴 자주 묻는 증상 목록(구 `COMMON_SYMPTOMS`)도 여기 사본이 있었으나(정본이 둘·P12)
 *    트리아지 정본(`symptom-match.ts`)으로 옮겼다 — 자가 점검이 같은 목록을 검사해야 하기 때문이다.
 */
const COMMON_SYMPTOMS = TRIAGE_EXAMPLE_PHRASES.map(p => ({ label: p.label, icon: p.icon, value: p.value }));

@Injectable()
export class AgentSessionService {
  private readonly logger = new Logger(AgentSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicalAi: MedicalAiService,
    private readonly triageService: TriageService,
    private readonly holidayService: HolidayService,
    private readonly questionnaireService: QuestionnaireService,
    @Optional() private readonly accessLog?: PublicAccessLogService,
  ) {}

  /** 자주 묻는 증상 목록 (AI API → 폴백) */
  async getCommonSymptoms(): Promise<{ label: string; icon: string; value: string }[]> {
    try {
      const result = await this.medicalAi.triageDepartments();
      if (result?.common_symptoms?.length) {
        return result.common_symptoms.map((s: any) => ({
          label: s.name ?? s,
          icon: s.icon ?? '🏥',
          value: s.description ?? `${s.name ?? s} 증상이 있어요`,
        }));
      }
    } catch {}
    return COMMON_SYMPTOMS;
  }

  async createSession(channel: string, operatorId?: string) {
    const session = await this.prisma.agentSession.create({
      data: {
        channel,
        operatorId,
        state: 'IDLE',
        context: { patient: {}, reception: {}, recommendations: {}, aiSessionId: null },
        messages: [{ role: 'agent', content: '안녕하세요! 환자 정보를 입력해주세요. (이름, 전화번호, 또는 등록번호)', timestamp: new Date() }],
      },
    });
    return session;
  }

  async processMessage(sessionId: string, message: string) {
    const session = await this.prisma.agentSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    const ctx = session.context as any;
    const msgs = session.messages as any[];
    const input = message.trim();
    // 🔴 공개(무인증) 세션인지 먼저 정한다 — 아래 신원 조회 분기가 전부 이 값에 걸린다
    const isPublic = this.isPublicSession(session);

    msgs.push({ role: 'user', content: input, timestamp: new Date() });

    let response = '';
    let skipOrchestrator = false;
    let newState = session.state;
    let uiDirective: any = null;
    const patientName = ctx.patient ? `${ctx.patient.familyName}${ctx.patient.givenName}` : '';

    // ═══════════════════════════════════════
    // STEP 0: 응급 감지 (모든 처리보다 먼저, LLM 호출 전)
    // ═══════════════════════════════════════
    const EMERGENCY = /흉통|가슴.*통증|가슴.*아파|심장.*아파|호흡.*곤란|숨.*못.*쉬|숨이.*안|의식.*잃|기절|쓰러|실신|대량.*출혈|피.*많이|피.*멈추지.*않|자살|죽고.*싶|목.*매|자해|경련|발작|얼굴.*마비|말.*어눌|팔.*못.*움직|반쪽.*마비|골절.*의심|심한.*화상/;
    if (EMERGENCY.test(input)) {
      response = `🚨 응급 상황이 의심됩니다.\n\n지금 바로 아래로 연락해주세요:\n- 119 (응급전화)\n- 02-000-0119 (병원 응급실 직통)\n\n응급실은 24시간 운영됩니다.`;
      msgs.push({ role: 'agent', content: response, timestamp: new Date() });
      await this.prisma.agentSession.update({ where: { id: sessionId }, data: { state: newState, context: ctx as any, messages: msgs as any } });
      return { response, state: newState, uiDirective: { type: 'QUICK_REPLIES', payload: [{ label: '119 응급전화', value: '119', icon: '🚨' }] } };
    }

    // ═══════════════════════════════════════
    // STEP 1: 에스컬레이션 (상담원 연결 요청)
    // ═══════════════════════════════════════
    if (/상담원|사람.*연결|전화.*연결|직원.*연결|직접.*상담|전화.*해줘|콜백/.test(input)) {
      // 🔴 대표전화·평일 진료시간은 정본(hospital.*) — 종전 '(평일 09:00~18:00)' 은 CMS 정본과 어긋난 상수였다.
      //    진료시간 미설정이면 괄호째 싣지 않는다. 응급실 직통은 API 정본 키가 없어 상수로 남는다(보고 목록).
      const hf = await this.hospitalFacts();
      const phone = hf['hospital.phone'];
      const weekday = hf['hospital.hours.weekday'];
      response = `${patientName ? patientName + '님, ' : ''}상담원 연결을 도와드릴게요.\n\n- 대표전화: ${phone ?? '확인되지 않음(기관 설정 없음)'}${phone && weekday ? ` (평일 ${weekday})` : ''}\n- 응급: 24시간 02-000-0119\n\n전화 연결이 어려우시면 다시 말씀해주세요.`;
      msgs.push({ role: 'agent', content: response, timestamp: new Date() });
      await this.prisma.agentSession.update({ where: { id: sessionId }, data: { state: newState, context: ctx as any, messages: msgs as any } });
      return { response, state: newState, uiDirective: { type: 'QUICK_REPLIES', payload: [{ label: phone ? `전화 ${phone}` : '전화 문의', value: '전화', icon: '📞' }] } };
    }

    // ═══════════════════════════════════════
    // ═══════════════════════════════════════
    // STEP 1-b: 공개 채널 본인확인 — **모든 응답 경로보다 먼저** (입구를 하나로)
    // ═══════════════════════════════════════
    // 🔴 2026-08-19 실측: 게이트를 `case 'IDLE'` 안에만 두었더니, 등록번호와 생년월일을 **한 줄로**
    //    보낸 메시지가 그 분기에 닿지 않고 LLM 오케스트레이터가 먼저 답했다(state 는 IDLE 그대로).
    //    두 번째 시도에서 상태 분기 앞으로 올렸는데도 안 걸렸다 — `llmFirst` 경로가
    //    그보다 더 앞에서 직접 return 하고 있었다(**세 번째 입구**).
    //    워크스테이션에서 본 것과 같은 형태다:
    //    **한 행위에 진입로가 둘이면 게이트도 둘이어야 한다.**
    //    그래서 공개 세션에서 등록번호가 보이면 어떤 상태에서든 여기서 먼저 처리한다.
    if (isPublic) {
      const pre = this.parseInput(input);
      const preDob = this.parseBirthDate8(input);
      const pendingMrn = (ctx.verify?.pendingMrn as string | undefined) ?? null;
      const mrnForVerify = pre.mrn ?? (preDob && pendingMrn ? pendingMrn : null);
      if (mrnForVerify && !ctx.patient?.verified) {
        const verified = await this.verifyPublicIdentity(session, ctx, mrnForVerify, preDob);
        msgs.push({ role: 'agent', content: verified.response, timestamp: new Date() });
        await this.prisma.agentSession.update({
          where: { id: sessionId },
          data: { state: verified.newState, context: ctx as any, messages: msgs as any },
        });
        return { response: verified.response, state: verified.newState, uiDirective: verified.uiDirective ?? null };
      }
    }

    // STEP 2: 입력 분류
    // ═══════════════════════════════════════
    const isFlowControl = /^(\d+)$/.test(input) // 번호 선택 (1, 2, 3)
      || /^(네|아니|아니요|응|ㅇ|확인|취소|진행|고고)$/i.test(input) // 단순 확인/취소
      || /^01[016789]\d{7,8}$/.test(input.replace(/-/g, '')) // 전화번호
      || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(input) // 생년월일
      || /^P\d{4}-\d{4}$/.test(input); // MRN
    // 예약 요청은 상태 머신으로 보내야 예약 흐름 진입
    const isBookingRequest = /예약.*해|예약.*하고|예약.*싶|예약.*잡아|예약.*진행|예약.*할|예약.*할게|예약.*할께|예약.*해줘|접수/.test(input);
    // "아니, 소화기내과" 같은 진료과 변경 요청도 예약 흐름으로
    const isDeptCorrection = /^(아니|아뇨|다른|바꿔|변경).*?(내과|외과|정형외과|산부인과|소아|이비인후|안과|피부과|비뇨|재활|가정의학|치과|소화기|순환기|호흡기|신경과)/.test(input);
    // 진입로 구분: 원무 데스크(HIS_RECEPTION)는 담당자가 환자를 식별·접수하는 도구 →
    // 환자 대면 대화(LLM-first)로 빠지지 않고 환자 조회/신환 인지 상태머신을 우선한다.
    // (온라인 예약 WEB_BOOKING 등은 환자 대면이므로 기존 대화 흐름 유지)
    const isReceptionDesk = session.channel === 'HIS_RECEPTION';

    // 예약 요청 시 이전 대화에서 언급된 진료과/증상을 ctx에 자동 주입
    // 진료과가 확인되면 상태 머신을 건너뛰고 바로 예약 확인으로 전환
    if (isBookingRequest || isDeptCorrection) {
      const recentMsgs = msgs.slice(-8);
      const DEPTS = ['내과', '외과', '정형외과', '신경외과', '산부인과', '소아청소년과', '이비인후과', '안과', '피부과', '비뇨의학과', '재활의학과', '가정의학과', '응급의학과', '정신건강의학과', '치과'];
      // 세부진료과 → 실제 진료과 매핑
      const SUBDEPT_MAP: Record<string, { dept: string; explain: string }> = {
        '소화기내과': { dept: '내과', explain: '소화기 진료는 내과에서 담당하고 있습니다' },
        '순환기내과': { dept: '내과', explain: '순환기(심장) 진료는 내과에서 담당하고 있습니다' },
        '호흡기내과': { dept: '내과', explain: '호흡기 진료는 내과에서 담당하고 있습니다' },
        '내분비내과': { dept: '내과', explain: '내분비(당뇨/갑상선) 진료는 내과에서 담당하고 있습니다' },
        '신장내과': { dept: '내과', explain: '신장 진료는 내과에서 담당하고 있습니다' },
        '혈액종양내과': { dept: '내과', explain: '혈액종양 진료는 내과에서 담당하고 있습니다' },
        '감염내과': { dept: '내과', explain: '감염 진료는 내과에서 담당하고 있습니다' },
        '류마티스내과': { dept: '내과', explain: '류마티스 진료는 내과에서 담당하고 있습니다' },
        '일반외과': { dept: '외과', explain: '일반외과 진료는 외과에서 담당하고 있습니다' },
        '흉부외과': { dept: '외과', explain: '흉부외과 진료는 외과에서 담당하고 있습니다' },
        '신경과': { dept: '내과', explain: '신경과 진료는 내과에서 담당하고 있습니다' },
      };
      let extractedDept: string | null = null;
      let extractedReason: string | null = null;
      let subdeptExplain: string | null = null;

      // 1. 현재 입력에서 세부진료과 직접 언급 확인 (최우선)
      for (const [sub, map] of Object.entries(SUBDEPT_MAP)) {
        if (input.includes(sub)) { extractedDept = map.dept; subdeptExplain = `${sub}를 원하시는군요. 저희 병원에서는 ${map.explain}.`; break; }
      }
      // 현재 입력에서 정규 진료과 직접 언급
      if (!extractedDept) {
        const inputDept = DEPTS.find(d => input.includes(d));
        if (inputDept) extractedDept = inputDept;
      }

      // 2. 이전 AI 응답에서 추천된 진료과 추출 (현재 입력에서 못 찾으면)
      if (!extractedDept) {
        for (const m of [...recentMsgs].reverse()) {
          if (m.role !== 'agent') continue;
          const content = String(m.content);
          const dept = DEPTS.find(d => content.includes(d));
          if (dept) { extractedDept = dept; break; }
        }
      }
      // 이전 환자 메시지에서 증상 추출
      for (const m of [...recentMsgs].reverse()) {
        if (m.role !== 'user') continue;
        const content = String(m.content);
        if (/아프|아파|통증|열|기침|두통|복통|불편|쑤시/.test(content)) { extractedReason = content; break; }
      }

      // 진료과가 확인되면 → 상태 머신 건너뛰고 바로 예약 흐름
      if (extractedDept) {
        ctx.reception = { ...(ctx.reception ?? {}), department: extractedDept, reason: extractedReason ?? input, visitType: 'INITIAL' };
        ctx.recommendations = { departments: [{ name: extractedDept, reason: '이전 대화에서 추천', priority: 1, confidence: 90 }] };
        const patientName = ctx.patient ? `${ctx.patient.familyName}${ctx.patient.givenName}` : '';
        const subdeptNote = subdeptExplain ? `${subdeptExplain}\n\n` : '';
        response = `${patientName ? patientName + '님, ' : ''}${subdeptNote}${subdeptExplain ? '' : '이전 상담 내용을 바탕으로 '}${extractedDept} 예약을 진행할게요.\n\n접수를 진행하시겠어요?`;
        newState = 'CONFIRMING';
        uiDirective = {
          type: 'QUICK_REPLIES',
          payload: [
            { label: `${extractedDept} 예약 진행`, value: '네', icon: '📅' },
            { label: '다른 진료과', value: '다른 진료과 보여주세요', icon: '🏥' },
          ],
        };
        skipOrchestrator = true;
        this.logger.log(`[Context] Booking with dept=${extractedDept} from conversation, skipping state machine`);

        msgs.push({ role: 'agent', content: response, timestamp: new Date() });
        await this.prisma.agentSession.update({
          where: { id: sessionId },
          data: { state: newState, context: ctx as any, messages: msgs as any },
        });
        return { response, state: newState, uiDirective };
      }
    }

    // 원무 데스크는 이름/식별 우선(신환 인지) → LLM-first 대화 경로를 건너뛴다.
    if (!isFlowControl && !isBookingRequest && !isDeptCorrection && input.length >= 3 && !isReceptionDesk) {
      // 증상 키워드 감지 → triage 점수 병렬 호출
      const hasSymptom = /아프|아파|아픈|통증|열이|열나|기침|두통|복통|어지|구토|설사|발열|쑤시|찌릿|욱신|뻐근|쓰리|답답|진물|붓|가려|출혈|피나|멍|부어|저림|마비/.test(input);

      // Enhanced Chat + Triage 병렬 호출
      /**
       * 🔴 트리아지 **실패**를 `null` 로 접으면 '응급 아님'과 구분되지 않는다(2026-08-21).
       *    이 경로는 응급이면 응답 맨 앞에 119 지시를 올리는 자리다. 종전 `.catch(() => null)` 은
       *    평가가 죽었을 때 그 안내를 **조용히 없앴다** — 환자에게는 아무 일도 없던 것처럼 보인다.
       *    (`evaluate` 는 내부에 DB→AI→FALLBACK 폴백이 있어, 여기까지 오는 예외는 진짜 장애다.)
       *    실패는 '아님'이 아니라 **모름**이다 — UNDETERMINED 와 같은 안전측 안내를 남긴다.
       */
      let triageFailed = false;
      const [llmFirst, triageResult] = await Promise.all([
        this.handleGeneralQuestion(input, ctx, msgs),
        hasSymptom ? this.triageService.evaluate(input, {
          age: ageOf(ctx.patient.birthDate) ?? undefined,
          sex: ctx.patient?.gender === 'MALE' ? 'M' : ctx.patient?.gender === 'FEMALE' ? 'F' : undefined,
        }).catch((e) => {
          triageFailed = true;
          this.logger.error(`증상 평가 실패 — 응급 판정 없이 응답한다(안전측 안내 첨부): ${(e as Error).message}`);
          return null;
        }) : Promise.resolve(null),
      ]);

      if (llmFirst) {
        // 태그 제거 + 일본어/중국어 제거
        response = this.cleanLlmResponse(llmFirst.response);
        if (llmFirst.uiDirective) uiDirective = llmFirst.uiDirective;
        skipOrchestrator = true;

        // 🔴 T3/T6 — 응급이면 추천보다 먼저, 응답 맨 앞에 '환자용 행동 지시'를 올린다.
        if (triageResult && triageResult.emergencyAssessment === 'EMERGENCY') {
          const notice = this.emergencyNotice(triageResult, session.channel);
          if (notice) response = `${notice}\n\n${response}`;
        } else if (triageFailed) {
          // 평가가 죽었다는 사실을 밝히고, 판단 불가일 때와 같은 안전측 안내를 붙인다(정본 문구).
          response = `⚠️ 증상 확인이 일시적으로 되지 않았습니다. ${PATIENT_EMERGENCY_UNDETERMINED}\n\n${response}`;
        }

        // 증상 + Triage 결과가 있으면 예약 권고 추가
        if (triageResult && triageResult.recommendations?.length > 0) {
          const topDept = triageResult.recommendations[0];
          const confidence = topDept.confidence ?? 0;
          const isUrgent = triageResult.emergencyAssessment === 'EMERGENCY' || confidence >= 80;

          if (isUrgent) {
            response += `\n\n⚠️ 증상 분석 결과, ${topDept.department} 진료를 권장합니다.`;
            uiDirective = {
              type: 'QUICK_REPLIES',
              payload: [
                { label: `${topDept.department} 예약`, value: `${topDept.department} 예약하고 싶어요`, icon: '📅' },
                { label: '응급실 안내', value: '응급실 어디인가요?', icon: '🚑' },
              ],
            };
          } else if (confidence >= 50) {
            response += `\n\n💡 관련 진료과: ${triageResult.recommendations.slice(0, 2).map((r: any) => r.department).join(', ')}`;
            response += '\n예약이 필요하시면 말씀해주세요.';
            uiDirective = {
              type: 'QUICK_REPLIES',
              payload: [
                { label: `${topDept.department} 예약`, value: `${topDept.department} 예약하고 싶어요`, icon: '📅' },
                { label: '더 알아보기', value: '더 자세히 알려주세요', icon: '💬' },
              ],
            };
          }
        }

        msgs.push({ role: 'agent', content: response, timestamp: new Date() });
        await this.prisma.agentSession.update({
          where: { id: sessionId },
          data: { state: newState, context: ctx as any, messages: msgs as any },
        });
        return { response, state: newState, uiDirective };
      }
    }

    switch (session.state) {
      case 'IDLE':
      case 'IDENTIFYING_PATIENT': {
        // ── 시설·안내 질문 우선 체크 (환자 식별 전) ──
        const facilityResult = await this.handleFacilityQuestion(input, ctx);
        if (facilityResult) {
          response = facilityResult.response;
          if (facilityResult.uiDirective) uiDirective = facilityResult.uiDirective;
          skipOrchestrator = facilityResult.skipOrchestrator ?? true;
          break;
        }

        // 입력에서 정보 추출 — 증상은 DB 정본(TriageService)이 뽑는다(하드코딩 맵 제거·T4)
        const extracted = await this.triageService.extractSymptoms(input).catch(() => undefined);
        const parsed = this.parseInput(input, extracted);

        // 공개 채널: 앞서 등록번호를 받아 두고 생년월일만 들어온 경우 이어서 확인한다
        if (isPublic && !parsed.mrn && ctx.verify?.pendingMrn) {
          const dob = this.parseBirthDate8(input);
          if (dob) {
            const verified = await this.verifyPublicIdentity(session, ctx, ctx.verify.pendingMrn, dob);
            response = verified.response;
            newState = verified.newState;
            uiDirective = verified.uiDirective ?? null;
            break;
          }
        }

        // MRN 직접 검색
        if (parsed.mrn) {
          // 🔴 공개 채널은 MRN 만으로 신원을 확정하지 않는다 — 생년월일을 함께 받아 2요소로 확인한다.
          //    MRN 은 `P2026-****` 형태라 순차 추정이 가능하다(한 줄이면 남의 기록이 열렸다).
          if (isPublic) {
            const verified = await this.verifyPublicIdentity(session, ctx, parsed.mrn, this.parseBirthDate8(input));
            response = verified.response;
            newState = verified.newState;
            uiDirective = verified.uiDirective ?? null;
            break;
          }
          const patient = await this.prisma.patient.findFirst({ where: { mrn: parsed.mrn } });
          if (patient) {
            ctx.patient = { resolved: true, id: patient.id, mrn: patient.mrn, familyName: patient.familyName, givenName: patient.givenName, birthDate: patient.dateOfBirth, gender: patient.gender };
            const lastEnc = await this.getLastEncounter(patient.id);
            const allergies = await this.prisma.allergy.findMany({ where: { patientId: patient.id, isActive: true }, select: { allergen: true, severity: true } });
            const problems = await this.prisma.problemList.findMany({ where: { patientId: patient.id, status: { in: ['ACTIVE', 'CHRONIC'] } }, select: { description: true, status: true } });

            ctx.patient.allergies = allergies.map((a: any) => a.allergen);
            ctx.patient.problemList = problems.map((p: any) => `${p.description}(${p.status})`);
            ctx.patient.lastEncounter = lastEnc;
            if (lastEnc) { ctx.reception.department = lastEnc.department; ctx.reception.doctorName = lastEnc.doctor; }

            response = this.formatPatientCard(ctx.patient, allergies, problems, lastEnc);
            response += '\n\n어떤 증상으로 내원하셨나요?';
            newState = 'COLLECTING_SYMPTOMS';
            uiDirective = { type: 'SHOW_PATIENT_CARD', payload: ctx.patient };
          } else {
            response = `🔍 ${parsed.mrn} 검색 결과가 없습니다.\n환자 이름을 입력해주세요.`;
            newState = 'IDENTIFYING_PATIENT';
          }
          break;
        }

        // 이름 검색
        if (parsed.name) {
          // 🔴 공개 채널에서는 이름으로 환자를 **조회하지 않는다.**
          //    단일 매치면 임상정보까지, 복수 매치면 최대 5명의 `이름(MRN) 생년 성별` 목록이 나갔다 —
          //    흔한 이름 하나로 남의 등록번호를 수집할 수 있는 경로였다.
          //    기존 환자는 등록번호+생년월일로, 등록번호를 모르면 창구로 안내한다.
          if (isPublic) {
            ctx.patient = ctx.patient ?? {};
            ctx.patient.pendingName = parsed.name;
            const deskPhone = (await this.hospitalFacts())['hospital.phone']; // 정본 대표전화(미설정이면 번호 없이)
            response = `${parsed.name}님, 안녕하세요.\n\n기존에 진료받으신 적이 있으시면 **등록번호(예: P2026-****)와 생년월일 8자리**를 함께 입력해주세요.\n처음이시면 "신규"라고 입력해주시면 등록을 도와드립니다.\n\n등록번호를 모르시면 접수 창구${deskPhone ? `(${deskPhone})` : ''}로 문의해주세요.`;
            newState = 'IDENTIFYING_PATIENT';
            break;
          }
          const patients = await this.prisma.patient.findMany({
            where: { OR: [{ familyName: { contains: parsed.name } }, { givenName: { contains: parsed.name } }] },
            select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true },
            take: 5,
          });

          // 전체 이름으로도 검색
          if (patients.length === 0 && parsed.name.length >= 2) {
            const fn = parsed.name.substring(0, 1);
            const gn = parsed.name.substring(1);
            const fullNameSearch = await this.prisma.patient.findMany({
              where: { familyName: fn, givenName: gn },
              select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true },
              take: 5,
            });
            patients.push(...fullNameSearch);
          }

          if (patients.length === 1) {
            const p = patients[0];
            ctx.patient = { resolved: true, id: p.id, mrn: p.mrn, familyName: p.familyName, givenName: p.givenName, birthDate: p.dateOfBirth, gender: p.gender };
            const lastEnc = await this.getLastEncounter(p.id);
            const allergies = await this.prisma.allergy.findMany({ where: { patientId: p.id, isActive: true }, select: { allergen: true, severity: true } });
            const problems = await this.prisma.problemList.findMany({ where: { patientId: p.id, status: { in: ['ACTIVE', 'CHRONIC'] } }, select: { description: true, status: true } });
            ctx.patient.allergies = allergies.map((a: any) => a.allergen);
            ctx.patient.problemList = problems.map((p: any) => `${p.description}(${p.status})`);
            ctx.patient.lastEncounter = lastEnc;
            if (lastEnc) { ctx.reception.department = lastEnc.department; ctx.reception.doctorName = lastEnc.doctor; }

            response = this.formatPatientCard(ctx.patient, allergies, problems, lastEnc);

            // 증상도 같이 입력된 경우
            if (parsed.symptoms.length > 0) {
              ctx.reception.symptoms = parsed.symptoms;
              ctx.reception.reason = parsed.symptoms.join(', ');
              const { deptRecs, triage } = await this.recommendDepartments(input, ctx, extracted);
              ctx.recommendations.departments = deptRecs;
              // 🔴 T4 — 예전 하드코딩 경로에는 응급 개념이 없어 여기서 경고가 나가지 않았다.
              const notice = this.emergencyNotice(triage, session.channel);
              if (notice) response = `${notice}\n\n${response}`;
              response += deptRecs.length > 0
                ? `\n\n🏥 추천 진료과:\n${deptRecs.map((d, i) => `${i + 1}순위: ${d.name} (${d.reason})`).join('\n')}`
                : '\n\n🏥 증상에 맞는 진료과 규칙을 찾지 못했습니다. 증상을 조금 더 구체적으로 알려주세요.';
              if (parsed.visitType) ctx.reception.visitType = parsed.visitType;
              response += '\n\n접수를 진행할까요?';
              newState = 'CONFIRMING';
              uiDirective = { type: 'SHOW_DEPT_RECOMMENDATION', payload: { departments: deptRecs, patient: ctx.patient, emergency: triage.emergencyAssessment } };
            } else {
              response += '\n\n어떤 증상으로 내원하셨나요?';
              newState = 'COLLECTING_SYMPTOMS';
            }
          } else if (patients.length > 1) {
            ctx.recommendations.searchResults = patients;
            response = `🔍 '${parsed.name}' 검색 → ${patients.length}명 발견\n`;
            response += patients.map((p, i) => `${i + 1}. ${p.familyName}${p.givenName} (${p.mrn}) ${new Date(p.dateOfBirth).getFullYear()}년생 ${p.gender === 'MALE' ? '남' : '여'}`).join('\n');
            response += '\n\n몇 번 환자인가요?';
            newState = 'SEARCH_RESULTS';
            uiDirective = { type: 'SHOW_SEARCH_RESULTS', payload: { patients } };
          } else {
            ctx.patient.familyName = parsed.name.length >= 2 ? parsed.name[0] : parsed.name;
            ctx.patient.givenName = parsed.name.length >= 2 ? parsed.name.substring(1) : '';
            if (parsed.birthYear) ctx.patient.birthDate = `${parsed.birthYear}-01-01`;
            if (parsed.gender) ctx.patient.gender = parsed.gender;

            response = `🔍 '${parsed.name}' 검색 결과 없음\n\n📝 신규 환자로 등록합니다.\n`;
            response += `이름: ${ctx.patient.familyName}${ctx.patient.givenName}\n`;
            if (parsed.birthYear) response += `출생년도: ${parsed.birthYear}\n`;
            if (parsed.gender) response += `성별: ${parsed.gender === 'MALE' ? '남' : '여'}\n`;
            response += '\n생년월일과 전화번호를 알려주세요.';
            newState = 'COLLECTING_PATIENT_INFO';
          }

          if (parsed.visitType) ctx.reception.visitType = parsed.visitType;
        } else if (isReceptionDesk) {
          // 원무 데스크: 환자 대면 대화 대신 담당자용 응답 — 증상이면 진료과 추천, 아니면 사용법 안내
          if (parsed.symptoms.length > 0) {
            const { deptRecs, triage } = await this.recommendDepartments(input, ctx, extracted);
            ctx.reception.symptoms = parsed.symptoms;
            ctx.reception.reason = parsed.symptoms.join(', ');
            ctx.recommendations.departments = deptRecs;
            // 🔴 T4 — 원무 데스크도 같은 하드코딩 맵을 써서 응급 표시가 없었다.
            const notice = this.emergencyNotice(triage, session.channel);
            const recLines = deptRecs.length > 0
              ? deptRecs.map((d, i) => `${i + 1}순위: ${d.name} (${d.reason})`).join('\n')
              : '(해당 증상의 진료과 규칙 없음 — /admin/triage 에서 규칙을 등록하세요)';
            response = `${notice ? `${notice}\n\n` : ''}🏥 증상(${parsed.symptoms.join(', ')}) 기준 추천 진료과:\n${recLines}\n\n환자 이름·전화번호·등록번호를 입력하면 접수를 진행합니다.`;
            uiDirective = { type: 'SHOW_DEPT_RECOMMENDATION', payload: { departments: deptRecs, emergency: triage.emergencyAssessment } };
          } else {
            response = `환자 이름, 전화번호 또는 등록번호(P0000-0000)를 입력해 주세요.\n증상을 함께 입력하면 진료과를 추천합니다. (예: 김영수 두통)`;
          }
          newState = 'IDENTIFYING_PATIENT';
        } else {
          // LLM-First: 이름/MRN이 아닌 일반 질문 → AI가 직접 응답
          const llmResult = await this.handleGeneralQuestion(input, ctx, msgs);
          if (llmResult) {
            response = llmResult.response;
            if (llmResult.uiDirective) uiDirective = llmResult.uiDirective;
            skipOrchestrator = true;
          } else {
            response = `${ctx.patient?.givenName ? ctx.patient.familyName + ctx.patient.givenName + '님, ' : ''}네, 알겠습니다! 증상이 있으시면 편하게 말씀해주세요. 예약 확인이나 병원 안내도 도와드릴 수 있어요.`;
            newState = 'IDENTIFYING_PATIENT';
          }
        }
        break;
      }

      case 'SEARCH_RESULTS': {
        const num = parseInt(input);
        const results = ctx.recommendations?.searchResults ?? [];
        if (num >= 1 && num <= results.length) {
          const p = results[num - 1];
          ctx.patient = { resolved: true, id: p.id, mrn: p.mrn, familyName: p.familyName, givenName: p.givenName };
          const lastEnc = await this.getLastEncounter(p.id);
          const allergies = await this.prisma.allergy.findMany({ where: { patientId: p.id, isActive: true }, select: { allergen: true, severity: true } });
          ctx.patient.lastEncounter = lastEnc;
          if (lastEnc) { ctx.reception.department = lastEnc.department; }
          response = `✅ ${p.familyName}${p.givenName} (${p.mrn}) 선택\n`;
          if (allergies.length) response += `⚠️ 알레르기: ${allergies.map((a: any) => a.allergen).join(', ')}\n`;
          response += '\n어떤 증상으로 내원하셨나요?';
          newState = 'COLLECTING_SYMPTOMS';
        } else {
          response = `1~${results.length} 번호를 입력해주세요.`;
        }
        break;
      }

      case 'COLLECTING_PATIENT_INFO': {
        // 신규 등록의 작성자 — 담당자(로그인 직원)가 없으면 등록하지 않는다(아래 분기)
        const operatorId = session.operatorId;
        const parsed = this.parseInput(input);
        if (parsed.birthDate) ctx.patient.birthDate = parsed.birthDate;
        if (parsed.birthYear && !ctx.patient.birthDate) ctx.patient.birthDate = `${parsed.birthYear}-01-01`;
        if (parsed.gender) ctx.patient.gender = parsed.gender;
        if (parsed.phone) ctx.patient.phone = parsed.phone;

        // 날짜 패턴 추가 파싱
        const dateMatch = input.match(/(\d{1,2})월\s*(\d{1,2})일/);
        if (dateMatch && ctx.patient.birthDate) {
          const year = ctx.patient.birthDate.substring(0, 4);
          ctx.patient.birthDate = `${year}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
        }

        const phoneMatch = input.match(/01[016789]-?\d{3,4}-?\d{4}/);
        if (phoneMatch) ctx.patient.phone = phoneMatch[0];

        // 주소 입력 대기 중이면 이번 입력을 주소로 저장 (신환 주소, FR)
        if (ctx.patient.awaitingAddress && !parsed.birthDate && !phoneMatch) {
          ctx.patient.address = input.trim();
          ctx.patient.awaitingAddress = false;
        }
        // 주소 직접 감지(시/도/구/동/로/길/번지)
        if (!ctx.patient.address && /(시|도|구|군|동|읍|면|로|길|번지|아파트|빌라)/.test(input) && !parsed.name && !parsed.birthDate) {
          ctx.patient.address = input.trim();
        }

        if (ctx.patient.birthDate && ctx.patient.phone && !ctx.patient.address) {
          // 신환 주소 수집
          ctx.patient.awaitingAddress = true;
          response = `신규 환자 등록을 위해 주소를 알려주세요. (도로명/지번 주소)`;
        } else if (!operatorId && ctx.patient.birthDate && ctx.patient.phone) {
          /**
           * 🔴 (2026-09-15 D3) 담당자 없는 세션은 환자를 등록하지 않는다.
           *    종전엔 `createdBy/updatedBy` 를 고정 UUID(`…a00001`)로 채웠다 — 그 계정은 이 저장소 어디에도
           *    정의돼 있지 않아 ① 깨끗한 설치에서는 FK 위반 500 ② 시드 DB 에서는 **아무 관계 없는 계정이
           *    등록자로 남는** 기록 날조였다. 공개(무인증) 채팅도 이 분기로 들어온다(`isPublicSession`).
           *    법정기록의 작성자는 지어내지 않는다 — 창구 접수로 넘긴다.
           */
          response = '온라인 대화로는 신규 환자 등록을 마칠 수 없습니다.\n접수 창구에서 등록을 도와드리겠습니다.';
          newState = 'COLLECTING_PATIENT_INFO';
        } else if (operatorId && ctx.patient.birthDate && ctx.patient.phone) {
          // 환자 등록
          const newPatient = await this.prisma.patient.create({
            data: {
              mrn: `HR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
              familyName: ctx.patient.familyName ?? '',
              givenName: ctx.patient.givenName ?? '',
              dateOfBirth: new Date(ctx.patient.birthDate),
              // 🔴 성별을 지어내지 않는다 — 종전 기본값 'MALE' 은 검사 기준치·수가 판정이 읽는 임상 사실이다(Gender.UNKNOWN 존재)
              gender: ctx.patient.gender ?? 'UNKNOWN',
              phone: ctx.patient.phone,
              address: ctx.patient.address ? { full: ctx.patient.address } : undefined,
              allergies: JSON.stringify([]),
              createdBy: operatorId,
              updatedBy: operatorId,
            },
          });
          ctx.patient.resolved = true;
          ctx.patient.id = newPatient.id;
          ctx.patient.mrn = newPatient.mrn;

          response = `✅ 환자 등록 완료!\n${newPatient.familyName}${newPatient.givenName} | ${newPatient.mrn}\n${ctx.patient.birthDate} | ${ctx.patient.phone}${ctx.patient.address ? `\n${ctx.patient.address}` : ''}\n\n어떤 증상으로 내원하셨나요?`;
          newState = 'COLLECTING_SYMPTOMS';
        } else {
          const missing = [];
          if (!ctx.patient.birthDate) missing.push('생년월일');
          if (!ctx.patient.phone) missing.push('전화번호');
          response = `${missing.join(', ')}을(를) 알려주세요. (생년월일은 8자리 전체로 입력해 주세요, 예: 19900101)`;
        }
        break;
      }

      case 'COLLECTING_SYMPTOMS': {
        // ── 증상이 아닌 입력 감지: 인사/잡담/질문 → 오케스트레이터 or 직접 처리 ──
        const nonSymptomResult = await this.handleNonSymptomInput(input, ctx, session, msgs);
        if (nonSymptomResult) {
          response = nonSymptomResult.response;
          skipOrchestrator = nonSymptomResult.skipOrchestrator;
          newState = nonSymptomResult.newState ?? 'COLLECTING_SYMPTOMS';
          if (nonSymptomResult.uiDirective) uiDirective = nonSymptomResult.uiDirective;
          break;
        }

        // ── LLM-First: 일반 질문이면 AI가 직접 응답 (트리아지 전) ──
        // 증상 키워드가 아니거나, 지식/정보 질문인 경우
        const hasSymptomKeyword = /아프|아파|아픈|통증|열이|열나|기침|두통|복통|어지|구토|설사|호흡곤란|발열|쑤시|찌릿|욱신|뻐근|쓰리|답답/.test(input);
        const isKnowledgeQuery = /알고\s*싶|궁금|대해서|뭐야|뭔가요|어떤\s*건|관리법|예방|치료법|원인|어떻게|어디.*가야|뭘\s*해야|어떡/.test(input);
        if (isKnowledgeQuery || !hasSymptomKeyword) {
          this.logger.log(`[LLM-First] Attempting for: "${input}" (knowledge=${isKnowledgeQuery}, noSymptom=${!hasSymptomKeyword})`);
          const llmResult = await this.handleGeneralQuestion(input, ctx, msgs);
          if (llmResult) {
            this.logger.log(`[LLM-First] Success: ${llmResult.response.slice(0, 50)}...`);
            response = llmResult.response;
            if (llmResult.uiDirective) uiDirective = llmResult.uiDirective;
            skipOrchestrator = true;
            break;
          }
          this.logger.warn(`[LLM-First] Failed for: "${input}"`);
        }

        const parsed = this.parseInput(input);
        ctx.reception.reason = input;
        if (parsed.visitType) ctx.reception.visitType = parsed.visitType;

        // TriageService로 통합 평가 (DB → AI → fallback) — 환자 정보 전달
        const patientAge = ageOf(ctx.patient.birthDate) ?? undefined;
        const patientSex = ctx.patient?.gender === 'MALE' ? 'M' : ctx.patient?.gender === 'FEMALE' ? 'F' : undefined;
        const triageResult = await this.triageService.evaluate(input, { age: patientAge, sex: patientSex });
        this.logger.log(`Triage [${triageResult.source}]: ${triageResult.symptoms.join(',')} → ${triageResult.recommendations.map(r => r.department).join(',')}`);

        ctx.reception.symptoms = triageResult.symptoms;
        // 🔴 T3/T6 — 예전엔 `emergency ? emergencyMsg : null` 이라
        //    ① 못 알아들은 FALLBACK 을 '응급 아님'으로 단정했고
        //    ② 응급일 땐 DB 감별진단 메모를 환자 응답 맨 앞에 그대로 붙였다.
        //    응급/판단불가를 갈라, 응급만 대화를 멈추는 경고로 취급한다.
        const emergencyAlert: string | null = triageResult.emergencyAssessment === 'EMERGENCY'
          ? this.emergencyNotice(triageResult, session.channel)
          : null;
        const undeterminedNotice: string | null = triageResult.emergencyAssessment === 'UNDETERMINED'
          ? triageResult.patientEmergencyAction
          : null;
        const deptRecs = this.toDeptRecs(triageResult);
        ctx.recommendations.departments = deptRecs;

        // 이전 진료 기반 재진 판단
        if (!ctx.reception.visitType && ctx.patient.lastEncounter) {
          ctx.reception.visitType = 'FOLLOW_UP';
        }
        if (!ctx.reception.visitType) ctx.reception.visitType = 'INITIAL';

        // ── 대화형 추가 질문: 확신도 낮거나 증상이 모호하면 follow-up ──
        const topConfidence = deptRecs[0]?.confidence ?? 0;
        // DB에서 증상을 찾았으면 follow-up 불필요 (정확한 규칙 기반 매칭)
        const isVague = triageResult.source === 'FALLBACK' || (triageResult.symptoms.length === 0 && topConfidence < 75);

        if (isVague && !emergencyAlert && !ctx.followUpAsked) {
          // AI follow-up 질문 요청
          try {
            const followUp = await this.medicalAi.triageFollowUp(input, msgs.slice(-4).map((m: any) => ({ role: m.role, content: m.content })));
            if (followUp?.questions?.length > 0) {
              ctx.followUpAsked = true;
              ctx.pendingTriageResult = { triageResult, deptRecs };
              const questions = followUp.questions.slice(0, 3);
              response = followUp.intro ?? '증상을 더 정확히 파악하기 위해 몇 가지 여쭤볼게요.';
              response += `\n\n${questions.map((q: any, i: number) => `${i + 1}. ${q.question ?? q}`).join('\n')}`;
              // 🔴 T3 — 판단 불가일 때 침묵하지 않는다(공개 채널 안전측 안내).
              if (undeterminedNotice) response += `\n\n${undeterminedNotice}`;
              newState = 'FOLLOW_UP';
              uiDirective = {
                type: 'FOLLOW_UP_QUESTIONS',
                payload: {
                  questions: questions.map((q: any) => ({
                    question: q.question ?? q,
                    options: q.options ?? null,
                  })),
                },
              };
              break;
            }
          } catch (e) {
            this.logger.warn(`Follow-up API fallback: ${e}`);
          }
          // 폴백: 직접 추가 질문 (증상 미추출 또는 FALLBACK 소스)
          if (triageResult.symptoms.length === 0 || triageResult.source === 'FALLBACK' || topConfidence < 60) {
            ctx.followUpAsked = true;
            response = '증상을 조금 더 구체적으로 말씀해주시겠어요?';
            response += '\n\n예를 들어:';
            response += '\n• 어디가 아프신지 (머리, 배, 허리 등)';
            response += '\n• 언제부터 아프셨는지';
            response += '\n• 어떤 느낌인지 (찌릿, 욱신, 답답 등)';
            if (undeterminedNotice) response += `\n\n${undeterminedNotice}`;
            newState = 'FOLLOW_UP';
            uiDirective = {
              type: 'QUICK_REPLIES',
              payload: [
                { label: '머리가 아파요', value: '머리가 아파요' },
                { label: '배가 아파요', value: '배가 아파요' },
                { label: '열이 나요', value: '열이 나요' },
                { label: '다시 입력할게요', value: '' },
              ],
            };
            break;
          }
        }

        // ── 구조화 의료 질의 (medicalAsk) — 트리아지와 병렬 불가이므로 후처리 ──
        //
        // 🔴 (2026-09-21) 종전엔 실패를 `null` 로 받아 '참고 안내' 블록을 **통째로 생략**했다 — 상류가 401/404 로
        //    늘 실패해도 화면에는 "못 얻었다"가 한 글자도 없었다. 정본이 3상태로 말하므로 그대로 싣는다
        //    (`source: 'UNAVAILABLE'` + 사유 코드). 🔴 답을 지어내지 않는다 — UNAVAILABLE 에는 `answer` 가 없다.
        //    🔴 서버는 여기서 문장을 붙이지 않는다 — 화면(booking `MedicalInsightCard`)이 출처를 읽고 말한다.
        let medicalInsight:
          | { source: 'AI'; answer: string; category?: string; disclaimer?: string }
          | { source: 'UNAVAILABLE'; reason: string }
          | null = null;
        if (triageResult.symptoms.length > 0 && triageResult.source !== 'FALLBACK') {
          try {
            const askResult = await this.medicalAi.medicalAsk({
              symptoms: triageResult.symptoms,
              patient_age: patientAge,
              context: ctx.patient?.problemList?.length ? `기존 병력: ${ctx.patient.problemList.join(', ')}` : undefined,
            });
            if (askResult?.source === 'AI' && askResult.data?.answer) {
              medicalInsight = {
                source: 'AI',
                answer: askResult.data.answer,
                category: askResult.data.category,
                disclaimer: askResult.data.disclaimer,
              };
            } else {
              // 상류가 답했어도 answer 가 비었으면 못 얻은 것이다(200 이라고 답이 있는 것은 아니다)
              medicalInsight = { source: 'UNAVAILABLE', reason: askResult?.source === 'UNAVAILABLE' ? askResult.reason : 'EMPTY_ANSWER' };
            }
          } catch (e) {
            // 정본이 이미 3상태로 말하므로 여기 도달은 예상 밖(미주입·목)이다 — 그래도 '없음'으로 번역하지 않는다
            this.logger.warn(`medicalAsk error: ${e}`);
            medicalInsight = { source: 'UNAVAILABLE', reason: 'CALL_FAILED' };
          }
          ctx.recommendations.medicalInsight = medicalInsight;
        }

        // ── 진료과 추천 (친근한 문장) ──
        const patName = ctx.patient ? `${ctx.patient.familyName}${ctx.patient.givenName}님` : '';
        response = emergencyAlert ? `${emergencyAlert}\n\n` : '';
        // 🔴 추천이 없는데도 "아래 진료과를 추천드려요" 라고 말하고 빈 목록을 붙이던 것 — 문장을 갈랐다.
        //    (신뢰도는 reason 에 이미 붙어 있어 "(80%) (80%)" 로 두 번 찍히던 것도 정리)
        if (deptRecs.length > 0) {
          response += `${patName ? `${patName}, ` : ''}말씀하신 증상을 분석한 결과, 아래 진료과를 추천드려요.\n\n🏥 추천 진료과:\n${deptRecs.map((d, i) => `${i + 1}순위: ${d.name} (${d.reason})`).join('\n')}`;
        } else {
          response += `${patName ? `${patName}, ` : ''}말씀하신 내용만으로는 어느 진료과인지 판단하지 못했습니다.`;
          if (undeterminedNotice) response += `\n\n${undeterminedNotice}`;
        }

        // 의료 분석 결과가 있으면 추가(미가용은 여기서 문장으로 말하지 않는다 — 화면이 출처를 읽는다)
        if (medicalInsight?.source === 'AI') {
          response += `\n\n💡 참고 안내:\n${medicalInsight.answer.substring(0, 200)}${medicalInsight.answer.length > 200 ? '...' : ''}`;
        }

        // 이전 담당의가 추천 진료과에 해당하면 자동 설정
        if (ctx.patient.lastEncounter && deptRecs.some(d => d.name === ctx.patient.lastEncounter.department)) {
          ctx.reception.department = ctx.patient.lastEncounter.department;
          ctx.reception.doctorName = ctx.patient.lastEncounter.doctor;
          response += `\n\n📋 접수 준비:\n환자: ${ctx.patient.familyName}${ctx.patient.givenName} (${ctx.patient.mrn})\n진료과: ${ctx.reception.department} | 담당의: ${ctx.reception.doctorName}\n유형: ${ctx.reception.visitType === 'FOLLOW_UP' ? '재진' : '초진'} | 사유: ${ctx.reception.reason}`;
          newState = 'CONFIRMING';
          uiDirective = {
            type: 'CONFIRM_BOOKING',
            payload: {
              department: ctx.reception.department,
              doctor: ctx.reception.doctorName,
              visitType: ctx.reception.visitType,
              reason: ctx.reception.reason,
              medicalInsight: medicalInsight ?? undefined,
              quickReplies: [
                { label: '네, 예약할게요', value: '네' },
                { label: '다른 진료과', value: '다른 진료과 보여주세요' },
              ],
            },
          };
        } else if (deptRecs.length > 0) {
          ctx.reception.department = deptRecs[0].name;
          newState = 'CONFIRMING';
          uiDirective = {
            type: 'DEPT_CARDS',
            payload: {
              departments: deptRecs.map(d => ({ name: d.name, reason: d.reason, priority: d.priority, confidence: d.confidence })),
              medicalInsight: medicalInsight ?? undefined,
              quickReplies: [
                { label: `${deptRecs[0].name} 예약`, value: '네' },
                ...deptRecs.slice(1).map(d => ({ label: d.name, value: d.name })),
              ],
            },
          };
        } else {
          // 🔴 T3 — '판단 불가'를 숨기지 않는다. 내과는 기본 정답이 아니라 **제안**일 뿐이므로 그렇게 말한다.
          ctx.reception.department = '내과';
          response += '\n\n증상에 맞는 진료과를 특정하지 못했습니다. 정확한 분류는 진료 시 이루어집니다.\n우선 내과로 접수해 드릴까요?';
          newState = 'CONFIRMING';
          uiDirective = {
            type: 'QUICK_REPLIES',
            payload: [
              { label: '네, 내과로 예약', value: '네' },
              { label: '다른 진료과', value: '다른 진료과 보여주세요' },
            ],
          };
        }
        break;
      }

      case 'FOLLOW_UP': {
        // ── 증상이 아닌 입력 감지 ──
        const followUpNonSymptom = await this.handleNonSymptomInput(input, ctx, session, msgs);
        if (followUpNonSymptom) {
          response = followUpNonSymptom.response;
          skipOrchestrator = followUpNonSymptom.skipOrchestrator;
          newState = followUpNonSymptom.newState ?? 'FOLLOW_UP';
          if (followUpNonSymptom.uiDirective) uiDirective = followUpNonSymptom.uiDirective;
          break;
        }

        // ── LLM-First: 일반 의료 지식 질문 ──
        const isFollowUpKnowledgeQ = /알고\s*싶|궁금|대해서|뭐야|뭔가요|어떤\s*건|관리법|예방|치료법|원인/.test(input);
        if (isFollowUpKnowledgeQ) {
          const llmResult = await this.handleGeneralQuestion(input, ctx, msgs);
          if (llmResult) {
            response = llmResult.response;
            if (llmResult.uiDirective) uiDirective = llmResult.uiDirective;
            skipOrchestrator = true;
            break;
          }
        }

        // 추가 질문 답변 → 증상 정보 보강 후 재평가
        const combinedSymptom = `${ctx.reception?.reason ?? ''} ${input}`.trim();
        ctx.reception.reason = combinedSymptom;

        // 재평가 — 환자 정보 전달
        const rePatientAge = ageOf(ctx.patient.birthDate) ?? undefined;
        const rePatientSex = ctx.patient?.gender === 'MALE' ? 'M' : ctx.patient?.gender === 'FEMALE' ? 'F' : undefined;
        const reTriageResult = await this.triageService.evaluate(combinedSymptom, { age: rePatientAge, sex: rePatientSex });
        this.logger.log(`Re-triage [${reTriageResult.source}]: ${reTriageResult.symptoms.join(',')} → ${reTriageResult.recommendations.map(r => r.department).join(',')}`);

        ctx.reception.symptoms = reTriageResult.symptoms;
        const reDeptRecs = this.toDeptRecs(reTriageResult);
        ctx.recommendations.departments = reDeptRecs;

        if (!ctx.reception.visitType && ctx.patient.lastEncounter) ctx.reception.visitType = 'FOLLOW_UP';
        if (!ctx.reception.visitType) ctx.reception.visitType = 'INITIAL';

        // 🔴 T3/T6 — 여기도 DB 임상 메모를 환자 응답 맨 앞에 붙이고, FALLBACK 을 '응급 아님'으로 단정했다.
        const reEmergency = reTriageResult.emergencyAssessment === 'EMERGENCY'
          ? this.emergencyNotice(reTriageResult, session.channel)
          : null;
        const reUndetermined = reTriageResult.emergencyAssessment === 'UNDETERMINED'
          ? reTriageResult.patientEmergencyAction
          : null;
        response = reEmergency ? `${reEmergency}\n\n` : '';
        if (reDeptRecs.length > 0) {
          response += '감사합니다. 말씀하신 내용을 종합하면:\n\n';
          response += `🏥 추천 진료과:\n${reDeptRecs.map((d, i) => `${i + 1}순위: ${d.name} (${d.reason})`).join('\n')}`;
        } else {
          response += '감사합니다. 다만 말씀해주신 내용만으로는 진료과를 특정하지 못했습니다.';
          if (reUndetermined) response += `\n\n${reUndetermined}`;
        }

        if (reDeptRecs.length > 0) {
          ctx.reception.department = reDeptRecs[0].name;
          newState = 'CONFIRMING';
          uiDirective = {
            type: 'DEPT_CARDS',
            payload: {
              departments: reDeptRecs.map(d => ({ name: d.name, reason: d.reason, priority: d.priority, confidence: d.confidence })),
              quickReplies: [
                { label: `${reDeptRecs[0].name} 예약`, value: '네' },
                ...reDeptRecs.slice(1).map(d => ({ label: d.name, value: d.name })),
              ],
            },
          };
        } else {
          ctx.reception.department = '내과';
          response += '\n\n정확한 분류는 진료 시 이루어집니다. 우선 내과로 접수해 드릴까요?';
          newState = 'CONFIRMING';
          uiDirective = {
            type: 'QUICK_REPLIES',
            payload: [
              { label: '네, 내과로 예약', value: '네' },
              { label: '다른 진료과', value: '다른 진료과 보여주세요' },
            ],
          };
        }
        break;
      }

      case 'CONFIRMING': {
        // ── 다른 진료과 + 예약/시간 언급 → 새 예약으로 전환 (질문 감지보다 우선) ──
        const allDepts = ['내과', '외과', '정형외과', '신경외과', '신경과', '소아청소년과', '소아과', '산부인과', '정신건강의학과', '정신과', '안과', '이비인후과', '피부과', '비뇨의학과', '재활의학과', '가정의학과', '응급의학과', '치과', '영상의학과', '진단검사의학과', '병리과'];
        const reqDept = input.length >= 2 ? allDepts.find(d => input.includes(d)) : null;
        if (reqDept && /예약|가능|잡아|시간|오전|오후|내일|모레|다음/.test(input)) {
          // 새 예약 흐름으로 전환
          ctx.reception = { department: reqDept, chiefComplaint: input, type: 'NEW' };
          const dayPreference = this.parseDatePreference(input);
          if (dayPreference) ctx.datePreference = dayPreference;
          response = `${reqDept} 예약을 진행할게요!\n\n예약을 확인하시려면 "네"를 입력해주세요.`;
          newState = 'CONFIRMING';
          uiDirective = { type: 'QUICK_REPLIES', payload: [{ label: `네, ${reqDept} 예약`, value: '네' }, { label: '취소', value: '취소' }] };
          break;
        }

        // 질문형 패턴 (예약 일정 조회, 정보 질문 등)
        const isQuestionInput = /있나요|있어요|있어\?|있니|알려|조회|확인해|어때|뭐가 있|뭘 하|어떤 것|항목|종류|비용|가격|얼마|뭔가요|뭘까/.test(input);
        const positiveExact = ['네', '예', '응', 'ㅇ', 'ㅇㅇ', '맞아요', '맞아', '접수', '좋아요', '좋아', '그래', '진행', '확인', '고고', 'ㄱㄱ', 'y', 'yes', '네, 예약할게요'].includes(input.trim().toLowerCase().replace(/[.!~]$/, ''));
        const positiveIncludes = !isQuestionInput && ['예약 진행', '예약할게', '예약해', '접수해', '진행해'].some(p => input.toLowerCase().includes(p));
        const positive = positiveExact || positiveIncludes;
        if (positive) {
          // 접수 완료 → 대기열 추가
          if (session.channel === 'WEB_BOOKING') {
            // 인터넷 예약 → 날짜 선택 (공휴일 제외)
            const businessDays = await this.holidayService.getBusinessDays(new Date(), 5);
            const availDates = businessDays.map(d => d.toISOString().slice(0, 10));
            const dayN = ['일', '월', '화', '수', '목', '금', '토'];
            ctx.availableDates = availDates;

            response = `📅 ${ctx.reception?.department} 예약 가능 날짜:`;
            newState = 'SELECTING_TIME';
            uiDirective = {
              type: 'DATE_PICKER',
              payload: {
                department: ctx.reception?.department,
                dates: availDates.map((d, i) => ({
                  date: d,
                  dayName: dayN[new Date(d).getDay()],
                  label: `${new Date(d).getMonth() + 1}/${new Date(d).getDate()} (${dayN[new Date(d).getDay()]})`,
                  value: String(i + 1),
                })),
              },
            };
          } else {
            // HIS 접수 → 대기열 생성
            const doctor = ctx.reception.doctorName
              ? await this.prisma.user.findFirst({ where: { role: 'DOCTOR', OR: [{ givenName: { contains: ctx.reception.doctorName.replace(/^(김|이|박|최|정|한|오|강)/, '') } }] } })
              : await this.prisma.user.findFirst({ where: { role: 'DOCTOR', department: ctx.reception.department } });

            if (doctor && ctx.patient.id) {
              const queue = await this.prisma.waitingQueue.create({
                data: {
                  patientId: ctx.patient.id,
                  doctorId: doctor.id,
                  departmentName: ctx.reception.department ?? '',
                  queueNumber: await this.getNextQueueNumber(ctx.reception.department ?? ''),
                  type: 'WALK_IN',
                  visitType: ctx.reception.visitType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'INITIAL',
                  reason: ctx.reception.reason,
                  status: 'WAITING',
                },
              });

              response = `✅ 접수 완료!\n\n환자: ${ctx.patient.familyName}${ctx.patient.givenName}\n진료과: ${ctx.reception.department} | ${doctor.familyName}${doctor.givenName} 선생님\n대기번호: #${queue.queueNumber}\n유형: ${ctx.reception.visitType === 'FOLLOW_UP' ? '재진' : '초진'}\n사유: ${ctx.reception.reason}`;
              newState = 'COMPLETED';
              ctx.resultType = 'RECEPTION_COMPLETED';
              ctx.resultId = queue.id;
              uiDirective = { type: 'NAVIGATE', payload: { url: '/reception' } };
            } else {
              response = '담당 의사를 찾을 수 없습니다. 진료과를 다시 선택해주세요.';
              newState = 'COLLECTING_SYMPTOMS';
            }
          }
        } else if (['아니오', '취소', '다시', 'n', 'no'].includes(input.toLowerCase())) {
          response = '어떤 증상으로 내원하셨나요?';
          newState = 'COLLECTING_SYMPTOMS';
        } else {
          // 의료진/진료표/병원 질문 감지
          const infoKeywords = /어떤.*분|선생님.*누구|의사.*소개|의료진|진료.*시간|진료표|몇시|언제.*진료/;
          if (infoKeywords.test(input)) {
            // 현재 추천 진료과의 의료진 + 진료표 조회
            const dept = ctx.reception?.department ?? '내과';
            const doctors = await this.prisma.user.findMany({
              where: { role: 'DOCTOR', isActive: true, department: { contains: dept } },
              select: { familyName: true, givenName: true, department: true, specialty: true },
            });
            const schedules = await this.prisma.clinicSchedule.findMany({
              where: { doctor: { department: { contains: dept } } },
              include: { doctor: { select: { familyName: true, givenName: true } } },
            });
            const dayN = ['일', '월', '화', '수', '목', '금', '토'];
            const doctorInfo = doctors.map((d: any) => `• ${d.familyName}${d.givenName} 선생님 (${d.specialty ?? d.department})`).join('\n');
            const scheduleInfo = schedules.length > 0
              ? schedules.map((s: any) => `  ${s.doctor.familyName}${s.doctor.givenName}: ${dayN[s.dayOfWeek]}요일 ${s.period === 'AM' ? '오전' : '오후'} ${s.startTime}~${s.endTime}`).join('\n')
              : '  (진료표 등록 대기중)';

            response = `${dept} 의료진 안내:\n\n${doctorInfo}\n\n📅 진료 시간:\n${scheduleInfo}\n\n이 중 원하시는 선생님이 계시면 말씀해주세요.\n또는 "네"를 입력하시면 현재 설정대로 예약을 진행합니다.`;
            skipOrchestrator = true;
          } else if (isQuestionInput) {
            // 질문형 입력 → 정보 제공
            const dept = ctx.reception?.department ?? '가정의학과';
            if (/항목|종류|뭐가 있|뭘 하|어떤 것/.test(input)) {
              if (/검진/.test(input) || dept === '가정의학과') {
                response = `건강검진 주요 항목:\n\n📋 기본 검진\n• 신체계측 (키, 몸무게, BMI)\n• 혈압/맥박\n• 시력/청력\n• 흉부 X-ray\n• 심전도\n• 혈액검사 (CBC, 간기능, 신기능, 혈당, 지질)\n• 소변검사\n\n🔬 암 검진\n• 위암 (위내시경)\n• 대장암 (분변잠혈/대장내시경)\n• 간암 (초음파+AFP)\n• 유방암 (유방촬영)\n• 자궁경부암 (세포검사)\n• 폐암 (저선량 CT)\n\n예약을 진행하시려면 "네"를 입력해주세요.`;
              } else {
                response = `${dept}에서는 해당 증상에 맞는 검사와 진료를 진행합니다.\n\n예약을 진행하시려면 "네"를 입력해주세요.`;
              }
              skipOrchestrator = true;
            } else if (/비용|가격|얼마/.test(input)) {
              response = `진료비는 진료 내용에 따라 달라지며, 건강보험 적용 시 본인부담금은 약 30%입니다.\n\n건강검진 비용은 국민건강보험공단 검진은 무료이며, 종합검진은 프로그램에 따라 다릅니다.\n\n예약을 진행하시려면 "네"를 입력해주세요.`;
              skipOrchestrator = true;
            } else {
              response = `궁금한 점이 있으시군요! 더 자세한 내용은 진료 시 의사 선생님께 상담하실 수 있습니다.\n\n예약을 진행하시려면 "네"를, 다른 증상을 상담하시려면 말씀해주세요.`;
              skipOrchestrator = true;
            }
          } else {
            // ── 날짜/시간 선호도 감지 (예: "화,수요일 오후", "다음주 금요일") ──
            const dayPreference = this.parseDatePreference(input);
            if (dayPreference && session.channel === 'WEB_BOOKING') {
              // 선호 요일/시간대 저장 후 예약 확인으로 전환
              ctx.datePreference = dayPreference;
              const prefDesc = dayPreference.days.map((d: string) => `${d}요일`).join(', ') + (dayPreference.period ? ` ${dayPreference.period}` : '');
              response = `${prefDesc}을 선호하시는군요! 그 일정으로 예약을 진행할게요.`;
              // 예약 확인 → 날짜 선택 (공휴일 제외)
              const allBizDays = await this.holidayService.getBusinessDays(new Date(), 10);
              const availDates: string[] = [];
              for (const d of allBizDays) {
                const dayName = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
                if (dayPreference.days.includes(dayName)) availDates.push(d.toISOString().slice(0, 10));
              }
              if (availDates.length === 0) {
                // 선호 요일이 없으면 영업일 5일
                const bizDays = await this.holidayService.getBusinessDays(new Date(), 5);
                for (const d of bizDays) availDates.push(d.toISOString().slice(0, 10));
              }
              ctx.availableDates = availDates;
              const dayN = ['일', '월', '화', '수', '목', '금', '토'];
              newState = 'SELECTING_TIME';
              uiDirective = {
                type: 'DATE_PICKER',
                payload: {
                  department: ctx.reception?.department,
                  dates: availDates.map((d, i) => ({
                    date: d,
                    dayName: dayN[new Date(d).getDay()],
                    label: `${new Date(d).getMonth() + 1}/${new Date(d).getDate()} (${dayN[new Date(d).getDay()]})`,
                    value: String(i + 1),
                  })),
                },
              };
              break;
            }

            // ── 추가 증상/진료과 언급 감지 ──
            const additionalDepts = ['내과', '외과', '정형외과', '신경외과', '소아청소년과', '산부인과', '정신건강의학과', '안과', '이비인후과', '피부과', '비뇨의학과', '재활의학과', '가정의학과', '응급의학과', '치과', '한의원', '한방'];
            const mentionedDept = additionalDepts.find(d => input.includes(d));
            const hasAdditionalSymptom = /아프|통증|아파|불편/.test(input) && !mentionedDept;

            if (mentionedDept) {
              if (mentionedDept !== ctx.reception?.department) {
                // 다른 진료과 언급 → 순차 안내
                response = `네, ${mentionedDept} 예약도 도와드릴게요!\n\n현재 ${ctx.reception?.department} 예약을 먼저 완료한 뒤, 바로 ${mentionedDept} 예약을 진행할게요.\n\n(동시 예약은 어려워서 순서대로 진행합니다)`;
                ctx.pendingDept = mentionedDept; // 완료 후 자동 전환용
                uiDirective = {
                  type: 'QUICK_REPLIES',
                  payload: [
                    { label: `${ctx.reception?.department} 예약 진행`, value: '네' },
                    { label: `${mentionedDept}만 예약`, value: mentionedDept },
                  ],
                };
                break;
              } else {
                // 같은 진료과 → 예약 진행
                response = `네, ${mentionedDept}로 예약을 진행할까요?`;
                uiDirective = {
                  type: 'QUICK_REPLIES',
                  payload: [
                    { label: '네, 예약 진행', value: '네' },
                    { label: '다른 진료과', value: '다른 진료과 보여주세요' },
                  ],
                };
                break;
              }
            }

            if (hasAdditionalSymptom) {
              // 추가 증상 → 사유에 추가하고 재안내
              ctx.reception.reason = `${ctx.reception?.reason ?? ''}, ${input}`.replace(/^,\s*/, '');
              response = `증상을 추가로 기록했습니다.\n\n현재 ${ctx.reception?.department} 예약을 진행할까요?`;
              uiDirective = {
                type: 'QUICK_REPLIES',
                payload: [
                  { label: '네, 예약 진행', value: '네' },
                  { label: '다른 진료과 추천', value: '다른 진료과 보여주세요' },
                ],
              };
              break;
            }

            // 의사 이름 직접 입력 감지
            const doctorMatch = await this.prisma.user.findFirst({
              where: { role: 'DOCTOR', isActive: true, OR: [
                { givenName: { contains: input.replace(/선생님|의사|교수/, '').trim() } },
                { familyName: { equals: input.slice(0, 1) }, givenName: { startsWith: input.slice(1).replace(/선생님|의사|교수/, '').trim() } },
              ]},
              select: { familyName: true, givenName: true, department: true, specialty: true },
            });
            if (doctorMatch) {
              ctx.reception.department = doctorMatch.department ?? ctx.reception.department;
              ctx.reception.doctorName = `${doctorMatch.familyName}${doctorMatch.givenName}`;
              response = `${doctorMatch.familyName}${doctorMatch.givenName} 선생님(${doctorMatch.department})으로 변경했습니다. 예약을 진행할까요? (네/취소)`;
            } else {
              // 통합 질문 처리 (예약 조회, 인사, 잡담, 병원 안내 등)
              const confirmNonSymptom = await this.handleNonSymptomInput(input, ctx, session, msgs);
              if (confirmNonSymptom) {
                response = confirmNonSymptom.response;
                skipOrchestrator = confirmNonSymptom.skipOrchestrator;
                if (confirmNonSymptom.uiDirective) uiDirective = confirmNonSymptom.uiDirective;
              } else {
                response = '"네"(예약 진행) 또는 진료과/선생님 이름을 말씀해주세요.\n\n선호 요일(예: "화,수요일 오후")이나 예약 일정 확인도 가능해요.';
              }
            }
          }
        }
        break;
      }

      case 'SELECTING_TIME': {
        const dept = ctx.reception?.department;
        const allTimes = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'];
        const num = parseInt(input);

        // ── 자연어 날짜/시간 선호도 (예: "다음주 수요일 오후") ──
        const timePref = this.parseDatePreference(input);
        if (timePref && !ctx.selectedDate) {
          const dayN = ['일', '월', '화', '수', '목', '금', '토'];
          const filtered = (ctx.availableDates ?? []).filter((d: string) => timePref.days.includes(dayN[new Date(d).getDay()]));
          const datesToShow = filtered.length > 0 ? filtered : (ctx.availableDates ?? []);

          if (datesToShow.length === 1) {
            // 날짜 하나면 자동 선택 → 바로 시간 선택
            ctx.selectedDate = datesToShow[0];
            const dateLabel = `${new Date(datesToShow[0]).getMonth() + 1}월 ${new Date(datesToShow[0]).getDate()}일 (${dayN[new Date(datesToShow[0]).getDay()]})`;
            // 오전/오후 선호에 따라 시간 필터
            const filteredTimes = timePref.period === '오전' ? allTimes.filter(t => parseInt(t) < 12) :
                                  timePref.period === '오후' ? allTimes.filter(t => parseInt(t) >= 12) : allTimes;
            response = `${dateLabel} ${timePref.period ?? ''} 시간을 선택해주세요:`;
            uiDirective = {
              type: 'TIME_PICKER',
              payload: {
                date: datesToShow[0], dateLabel, department: dept,
                times: timePref.period
                  ? [{ period: timePref.period, slots: filteredTimes.map(t => ({ time: t, label: t, value: t })) }]
                  : [
                    { period: '오전', slots: allTimes.filter(t => parseInt(t) < 12).map(t => ({ time: t, label: t, value: t })) },
                    { period: '오후', slots: allTimes.filter(t => parseInt(t) >= 12).map(t => ({ time: t, label: t, value: t })) },
                  ],
              },
            };
          } else {
            response = `${timePref.days.map(d => `${d}요일`).join(', ')}${timePref.period ? ` ${timePref.period}` : ''} 중 날짜를 선택해주세요:`;
            uiDirective = {
              type: 'DATE_PICKER',
              payload: {
                department: dept,
                dates: datesToShow.map((d: string, i: number) => ({
                  date: d, dayName: dayN[new Date(d).getDay()],
                  label: `${new Date(d).getMonth() + 1}/${new Date(d).getDate()} (${dayN[new Date(d).getDay()]})`,
                  value: String(i + 1),
                })),
              },
            };
            // 필터된 날짜로 교체
            ctx.availableDates = datesToShow;
          }
          if (timePref.period) ctx.timePreference = timePref.period;
          break;
        }

        const times = allTimes;

        // 날짜 문자열 직접 입력도 허용 (예: "5/16", "2026-05-16")
        const dateInput = input.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? ctx.availableDates?.find((d: string) => input.includes(d));

        if (!ctx.selectedDate) {
          const resolvedDate = dateInput ?? (ctx.availableDates && num >= 1 && num <= ctx.availableDates.length ? ctx.availableDates[num - 1] : null);
          if (resolvedDate) {
            ctx.selectedDate = resolvedDate;
            const dayN = ['일', '월', '화', '수', '목', '금', '토'];
            const dateLabel = `${new Date(resolvedDate).getMonth() + 1}월 ${new Date(resolvedDate).getDate()}일 (${dayN[new Date(resolvedDate).getDay()]})`;
            const prefPeriod = ctx.timePreference;
            response = `⏰ ${dateLabel}${prefPeriod ? ` ${prefPeriod}` : ''} 예약 가능 시간:`;
            const amSlots = times.filter(t => parseInt(t) < 12).map(t => ({ time: t, label: t, value: t }));
            const pmSlots = times.filter(t => parseInt(t) >= 12).map(t => ({ time: t, label: t, value: t }));
            uiDirective = {
              type: 'TIME_PICKER',
              payload: {
                date: resolvedDate,
                dateLabel,
                department: dept,
                times: prefPeriod === '오전' ? [{ period: '오전', slots: amSlots }] :
                       prefPeriod === '오후' ? [{ period: '오후', slots: pmSlots }] :
                       [{ period: '오전', slots: amSlots }, { period: '오후', slots: pmSlots }],
              },
            };
          } else {
            response = `날짜를 선택해주세요.`;
            uiDirective = {
              type: 'DATE_PICKER',
              payload: {
                department: dept,
                dates: (ctx.availableDates ?? []).map((d: string, i: number) => {
                  const dayN = ['일', '월', '화', '수', '목', '금', '토'];
                  return { date: d, dayName: dayN[new Date(d).getDay()], label: `${new Date(d).getMonth() + 1}/${new Date(d).getDate()} (${dayN[new Date(d).getDay()]})`, value: String(i + 1) };
                }),
              },
            };
          }
        } else {
          // 시간 번호 입력 → 예약 생성
          if (num >= 1 && num <= times.length) {
            ctx.selectedTime = times[num - 1];
          } else if (/\d{1,2}:\d{2}/.test(input)) {
            ctx.selectedTime = input.trim();
          } else {
            response = `1~${times.length} 사이의 번호를 입력해주세요.`;
            break;
          }

          try {
            const doctor = await this.prisma.user.findFirst({ where: { role: 'DOCTOR', department: dept } });
            if (doctor && ctx.patient?.id) {
              const appt = await this.prisma.appointment.create({
                data: {
                  patientId: ctx.patient.id,
                  doctorId: doctor.id,
                  scheduledAt: new Date(`${ctx.selectedDate}T${ctx.selectedTime}:00+09:00`), // KST 명시(서버 TZ 비의존·2026-07 타임존 전수)
                  type: ctx.reception?.visitType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'INITIAL',
                  reason: ctx.reception?.reason ?? '',
                  createdBy: doctor.id,
                },
              });

              response = `✅ 예약이 완료되었습니다!`;
              newState = 'COMPLETED';
              ctx.resultType = 'BOOKING_COMPLETED';
              ctx.resultId = appt.id;

              // 문진표 자동 생성
              let questionnaireInfo: { token: string; url: string } | null = null;
              try {
                questionnaireInfo = await this.questionnaireService.generateForAppointment(ctx.patient.id, appt.id);
                if (questionnaireInfo) {
                  response += `\n\n📋 사전 문진표가 준비되었습니다.\n내원 전에 미리 작성해주시면 진료가 더 빨라져요!`;
                }
              } catch {}

              uiDirective = {
                type: 'BOOKING_COMPLETE',
                payload: {
                  department: dept,
                  doctor: `${doctor.familyName}${doctor.givenName}`,
                  date: ctx.selectedDate,
                  time: ctx.selectedTime,
                  patient: `${ctx.patient.familyName}${ctx.patient.givenName}`,
                  mrn: ctx.patient.mrn,
                  reason: ctx.reception?.reason ?? '',
                  appointmentId: appt.id,
                  questionnaire: questionnaireInfo ?? undefined,
                },
              };
              // pendingDept가 있으면 다음 예약 안내
              if (ctx.pendingDept) {
                const nextDept = ctx.pendingDept;
                ctx.pendingDept = undefined;
                response += `\n\n이어서 ${nextDept} 예약을 진행할까요?`;
                uiDirective = {
                  ...uiDirective,
                  payload: {
                    ...uiDirective.payload,
                    nextBooking: {
                      department: nextDept,
                      quickReplies: [
                        { label: `${nextDept} 예약 진행`, value: `${nextDept} 예약해줘` },
                        { label: '아니요, 괜찮아요', value: '괜찮아요' },
                      ],
                    },
                  },
                };
              }
            } else {
              response = '담당 의사를 찾을 수 없습니다. 원무과(내선 0)로 문의해주세요.';
              newState = 'IDLE';
            }
          } catch (e) {
            response = '예약 생성 중 오류가 발생했습니다. 원무과(내선 0)로 문의해주세요.';
            newState = 'IDLE';
          }
        }
        break;
      }

      case 'COMPLETED': {
        // 예약 완료 후 추가 대화 — 환자 정보는 이미 있으므로 재활용
        if (ctx.patient?.resolved) {
          // 진료과 언급 → 추가 예약
          const deptList = ['내과', '외과', '정형외과', '신경외과', '소아청소년과', '산부인과', '정신건강의학과', '안과', '이비인후과', '피부과', '비뇨의학과', '재활의학과', '가정의학과', '응급의학과', '치과', '한의원', '한방', '신경과'];
          const mentionedDept = deptList.find(d => input.includes(d));

          if (mentionedDept) {
            // 추가 예약 시작
            ctx.reception = { department: mentionedDept, reason: `${mentionedDept} 진료`, visitType: 'INITIAL' };
            ctx.recommendations = {};
            ctx.selectedDate = undefined;
            ctx.selectedTime = undefined;
            ctx.followUpAsked = false;
            response = `${mentionedDept} 예약도 진행할게요!\n\n${mentionedDept}에 방문하시는 이유를 말씀해주세요.`;
            newState = 'COLLECTING_SYMPTOMS';
            break;
          }

          // 증상 키워드 → 새 예약
          const symptomPattern = /아프|아파|통증|열이|기침|어지러|가려|불편/;
          if (symptomPattern.test(input)) {
            ctx.reception = { reason: input, visitType: 'INITIAL' };
            ctx.recommendations = {};
            ctx.selectedDate = undefined;
            ctx.selectedTime = undefined;
            ctx.followUpAsked = false;
            newState = 'COLLECTING_SYMPTOMS';
            // COLLECTING_SYMPTOMS로 재처리 — 직접 트리아지
            const patientAge = ageOf(ctx.patient.birthDate) ?? undefined;
            const patientSex = ctx.patient?.gender === 'MALE' ? 'M' : ctx.patient?.gender === 'FEMALE' ? 'F' : undefined;
            const triageResult = await this.triageService.evaluate(input, { age: patientAge, sex: patientSex });
            const deptRecs = this.toDeptRecs(triageResult);
            ctx.reception.symptoms = triageResult.symptoms;
            ctx.recommendations.departments = deptRecs;
            // 🔴 T4 — 추가 예약 경로에도 응급 안내가 없었다.
            const addNotice = this.emergencyNotice(triageResult, session.channel);
            if (deptRecs.length > 0) {
              ctx.reception.department = deptRecs[0].name;
              response = `${addNotice ? `${addNotice}\n\n` : ''}추가 예약을 도와드릴게요!\n\n🏥 추천 진료과:\n${deptRecs.map((d, i) => `${i + 1}순위: ${d.name} (${d.reason})`).join('\n')}`;
              newState = 'CONFIRMING';
              uiDirective = {
                type: 'DEPT_CARDS',
                payload: {
                  departments: deptRecs.map(d => ({ name: d.name, reason: d.reason, priority: d.priority, confidence: d.confidence })),
                  quickReplies: [
                    { label: `${deptRecs[0].name} 예약`, value: '네' },
                    ...deptRecs.slice(1).map(d => ({ label: d.name, value: d.name })),
                  ],
                },
              };
            } else {
              response = `${addNotice ? `${addNotice}\n\n` : ''}추가 예약을 도와드릴게요! 어떤 진료과를 원하시나요?`;
            }
            break;
          }

          // 일반 대화
          const completedNonSymptom = await this.handleNonSymptomInput(input, ctx, session, msgs);
          if (completedNonSymptom) {
            response = completedNonSymptom.response;
            skipOrchestrator = completedNonSymptom.skipOrchestrator;
            newState = 'COMPLETED';
            break;
          }

          response = `예약이 완료되었습니다! 추가 예약이 필요하시면 증상이나 진료과를 말씀해주세요.`;
          newState = 'COMPLETED';
        } else {
          response = '새로운 예약을 시작하려면 로그아웃 후 다시 로그인해주세요.';
          newState = 'COMPLETED';
        }
        break;
      }

      default:
        response = '새로운 환자를 접수하려면 이름을 입력해주세요.';
        newState = 'IDLE';
    }

    // WEB_BOOKING: 오케스트레이터 (LLM + Medical API + DB 도구)
    // response가 비어있으면 일반 질문 → 오케스트레이터에서 직접 응답 생성
    const needsOrchestrator = response.length === 0 || (response.length > 20 && !response.startsWith('1~') && !response.startsWith('⏰'));
    if (session.channel === 'WEB_BOOKING' && !skipOrchestrator && needsOrchestrator) {
      try {
        const patientName = ctx.patient ? `${ctx.patient.familyName}${ctx.patient.givenName}` : '환자';
        const hasNumberList = /^\d+\.\s/m.test(response);

        // ── 빈 응답 (인사/잡담/일반 질문) → 세션 기반 Chat API 우선 ──
        if (response.length === 0) {
          // 🔴 종전엔 **환자 실명과 HIS 환자 UUID 가 매 발화마다** 외부 AI 서버로 나갔다(마스킹·동의 둘 다 없음).
          //    이미 저장소 안에 잘 된 선례가 넷 있었다(referral-letter·surgery·telehealth·간호 SOAP):
          //    이름 자리는 `[환자명]` 으로 보내고 **응답을 받아 서버가 실명으로 되돌린다**.
          //    - 이름: 플레이스홀더 치환 + 후치환(문장 품질 유지·실명 미전송)
          //    - 환자 UUID: 원 키 대신 가명(HMAC) — 세션 연속성은 유지되고 재식별 키는 넘어가지 않는다
          //    정본: common/util/ai-phi-redact.ts (넷으로 흩어진 구현을 더 늘리지 않는다)
          const hospitalName = (await this.hospitalFacts())['hospital.name'];
          const systemPrompt = `당신은 ${hospitalName ?? '이 병원'}의 온라인 예약 AI 도우미입니다. 반드시 한국어 존댓말로 답변하세요. 마크다운 서식 금지.
환자 호칭: ${patientName ? PATIENT_NAME_PLACEHOLDER : '(미확인)'} — 이름이 필요하면 반드시 ${PATIENT_NAME_PLACEHOLDER} 로만 쓰세요(임의 이름 창작 금지).
현재 상태: ${newState === 'COLLECTING_SYMPTOMS' ? '증상 입력 대기' : newState === 'FOLLOW_UP' ? '추가 정보 수집' : newState === 'CONFIRMING' ? '예약 확인 중' : newState}
${ctx.reception?.department ? `추천 진료과: ${ctx.reception.department}` : ''}
역할: 환자의 질문에 친절하게 답변하고, 예약 흐름으로 자연스럽게 유도하세요. 증상을 물어보거나 예약 진행을 안내하세요.`;

          // 환자가 스스로 입력한 발화(input)에도 이름·연락처가 섞일 수 있다 — 같은 그물로 거른다.
          const red = redactForAiEgress(`${systemPrompt}\n\u0000${input}`, { patientNames: [patientName] });
          const [safePrompt, safeInput] = red.text.split('\u0000');

          const chatResult = await this.medicalAi.chatWithSession(safeInput ?? input, {
            sessionId: ctx.aiSessionId ?? undefined,
            userId: aiPseudonymousId(ctx.patient?.id) ?? undefined,
            systemPrompt: safePrompt,
          });

          if (chatResult.answer) {
            response = red.rehydrate(chatResult.answer); // 실명은 서버 안에서만 붙는다
            if (chatResult.sessionId && !ctx.aiSessionId) ctx.aiSessionId = chatResult.sessionId;
          }
          // 응답 있으면 오케스트레이터 스킵
          if (response.length > 0) {
            // 아래 오케스트레이터 블록 건너뛰기 위해 조기 종료
          }
        }

        if (response.length === 0 && !hasNumberList) {
          // [강화 7] 환자 컨텍스트 자동 구성
          let patientCtx = '';
          if (ctx.patient?.id) {
            const parts: string[] = [];
            if (ctx.patient.allergies?.length) parts.push(`알레르기: ${ctx.patient.allergies.join(', ')}`);
            if (ctx.patient.problems?.length) parts.push(`문제목록: ${ctx.patient.problems.map((p: any) => p.name ?? p).join(', ')}`);
            if (ctx.patient.lastEncounter) parts.push(`마지막 진료: ${ctx.patient.lastEncounter.date} ${ctx.patient.lastEncounter.department}`);
            if (ctx.reception?.department) parts.push(`현재 추천 진료과: ${ctx.reception.department}`);
            if (ctx.reception?.reason) parts.push(`증상: ${ctx.reception.reason}`);
            patientCtx = parts.join(' | ');
          }

          // 🔴 오케스트레이터도 같은 경계다 — 실명·HIS UUID 대신 플레이스홀더/가명으로 넘기고,
          //    대화 이력(history)·환자 컨텍스트(patientCtx)에 섞인 이름·연락처까지 한 벌로 거른다.
          //    (history 는 환자가 직접 쓴 문장이라 이름·전화번호가 실제로 들어온다)
          const history = msgs.slice(-6).map((m: any) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.content }));
          const redOrch = redactForAiEgress(
            JSON.stringify({ input, patientCtx, history }),
            { patientNames: [patientName] },
          );
          const safe = JSON.parse(redOrch.text) as { input: string; patientCtx: string; history: { role: string; content: string }[] };

          const result = await this.medicalAi.orchestrate(safe.input, {
            patientName: patientName ? PATIENT_NAME_PLACEHOLDER : undefined,
            patientId: aiPseudonymousId(ctx.patient?.id) ?? undefined,
            state: newState,
            history: safe.history,
            patientContext: safe.patientCtx,
          });

          // DB 도구 호출이 필요한 경우 → 실행 후 2차 오케스트레이터 호출
          if (result.toolCalls && result.toolCalls.length > 0) {
            const toolResults: Record<string, any> = {};

            for (const call of result.toolCalls) {
              const [tool, param] = call.split(':');
              try {
                switch (tool) {
                  case 'SCHEDULE_NEEDED': {
                    const schedules = await this.prisma.clinicSchedule.findMany({
                      where: param ? { doctor: { OR: [{ givenName: { contains: param } }, { department: { contains: param } }] } } : {},
                      include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
                      take: 10,
                    });
                    toolResults['진료표'] = schedules.map((s: any) => `${s.doctor.familyName}${s.doctor.givenName}(${s.doctor.department}) — ${['일','월','화','수','목','금','토'][s.dayOfWeek]} ${s.period === 'AM' ? '오전' : '오후'} ${s.startTime}~${s.endTime}`).join('\n');
                    break;
                  }
                  case 'DOCTORS_NEEDED': {
                    const doctors = await this.prisma.user.findMany({
                      where: { role: 'DOCTOR', isActive: true, ...(param ? { department: { contains: param } } : {}) },
                      select: { familyName: true, givenName: true, department: true, specialty: true },
                    });
                    toolResults['의료진'] = doctors.map((d: any) => `${d.familyName}${d.givenName} — ${d.department} ${d.specialty ?? ''}`).join('\n');
                    break;
                  }
                  case 'APPOINTMENTS_NEEDED': {
                    if (ctx.patient?.id) {
                      const appts = await this.prisma.appointment.findMany({
                        where: { patientId: ctx.patient.id, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
                        include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
                        orderBy: { scheduledAt: 'asc' }, take: 5,
                      });
                      toolResults['예약'] = appts.length > 0 ? appts.map((a: any) => `${new Date(a.scheduledAt).toLocaleDateString('ko')} ${localeTimeText(new Date(a.scheduledAt), 'ko-KR', { hour: '2-digit', minute: '2-digit' })} — ${a.doctor.familyName}${a.doctor.givenName}(${a.doctor.department}) [${a.status}]`).join('\n') : '예약 내역 없음';
                    }
                    break;
                  }
                  case 'LABRESULTS_NEEDED': {
                    if (ctx.patient?.id) {
                      const labs = await this.prisma.labResult.findMany({
                        where: { patientId: ctx.patient.id, status: 'COMPLETED' },
                        include: { items: { select: { testName: true, value: true, unit: true, flag: true } } },
                        orderBy: { completedAt: 'desc' }, take: 3,
                      });
                      toolResults['검사결과'] = labs.length > 0 ? labs.map((l: any) => `[${l.completedAt ? new Date(l.completedAt).toLocaleDateString('ko') : ''}] ${l.items.map((i: any) => `${i.testName}: ${i.value}${i.unit} ${i.flag !== 'N' ? `(${i.flag})` : ''}`).join(', ')}`).join('\n') : '검사 결과 없음';
                    }
                    break;
                  }
                  case 'BILLING_NEEDED': {
                    if (ctx.patient?.id) {
                      const bills = await this.prisma.billing.findMany({
                        where: { patientId: ctx.patient.id },
                        orderBy: { createdAt: 'desc' }, take: 3,
                      });
                      toolResults['진료비'] = bills.length > 0 ? bills.map((b: any) => `${new Date(b.createdAt).toLocaleDateString('ko')} — 총액 ${b.totalAmount.toLocaleString()}원 (본인부담 ${b.patientCopay.toLocaleString()}원) [${b.status === 'PAID' ? '수납완료' : '미수납'}]`).join('\n') : '수납 내역 없음';
                    }
                    break;
                  }
                  case 'HOSPITAL_INFO_NEEDED': {
                    // 🔴 정본 hospital.* 의 DB 행만 — 종전엔 행이 없거나 조회가 실패하면
                    //    '병원명: Hospital RUN · 평일 09:00~18:00 · 서울시 · 02-1234-5678' 을 병원 사실로 모델에 넘겼다(날조).
                    //    미설정은 formatHospitalContext 가 "확인되지 않음"으로 밝히고, 조회 실패는 실패라고 넘긴다.
                    try {
                      toolResults['병원안내'] = formatHospitalContext(await this.hospitalFacts());
                    } catch (e) {
                      this.logger.warn(`병원 정보 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
                      toolResults['병원안내'] = '병원 정보 조회 실패 — 이번 답변에서는 병원 이름·주소·전화·진료시간을 확인할 수 없습니다(추측해 안내하지 않음).';
                    }
                    break;
                  }
                }
              } catch (e) { this.logger.warn(`Tool ${tool} error: ${e}`); }
            }

            // 2차 오케스트레이터 호출 — DB 결과를 LLM이 자연어로 종합
            if (Object.keys(toolResults).length > 0) {
              // 2차 호출도 같은 그물 — 도구 결과(toolResults)에는 DB 에서 방금 꺼낸 이름·번호가 들어 있다.
              const red2 = redactForAiEgress(
                JSON.stringify({
                  input,
                  history: msgs.slice(-4).map((m: any) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.content })),
                  toolResults,
                }),
                { patientNames: [patientName] },
              );
              const safe2 = JSON.parse(red2.text) as { input: string; history: { role: string; content: string }[]; toolResults: Record<string, any> };
              const result2 = await this.medicalAi.orchestrate(safe2.input, {
                patientName: patientName ? PATIENT_NAME_PLACEHOLDER : undefined,
                patientId: aiPseudonymousId(ctx.patient?.id) ?? undefined,
                state: newState,
                history: safe2.history,
                toolResults: safe2.toolResults,
              });
              if (result2.response && result2.response.length > 10) response = red2.rehydrate(result2.response);
            }
          } else if (result.response && result.response.length > 10) {
            response = redOrch.rehydrate(result.response);
          }
        } else {
          const redNat = redactForAiEgress(`${response}\u0000환자 호칭: ${patientName ? PATIENT_NAME_PLACEHOLDER : '(미확인)'}, 상태: ${newState}`, { patientNames: [patientName] });
          const [safeDraft, safeCtx] = redNat.text.split('\u0000');
          const natural = await this.medicalAi.generateNaturalResponse('', safeDraft ?? response, safeCtx ?? '');
          if (natural && natural.length > 10) response = redNat.rehydrate(natural);
        }
      } catch {}
    }

    // 잔여 태그 제거
    response = response.replace(/\[(TRIAGE|REFERENCE|SCHEDULE|DOCTORS|APPOINTMENTS|LABRESULTS|BILLING|HOSPITAL_INFO|CLARIFY)_NEEDED(?::[^\]]+)?\]/g, '').trim();

    // 응답이 비어있으면 폴백 — 간단한 친절 응답 + 자연스러운 유도
    if (!response) {
      const pn = ctx.patient ? `${ctx.patient.familyName}${ctx.patient.givenName}님` : '';
      response = await this.generateCasualResponse(input, pn);
    }

    // 공통 후처리 파이프라인
    response = this.cleanLlmResponse(response);

    msgs.push({ role: 'agent', content: response, timestamp: new Date() });

    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        state: newState,
        context: ctx as unknown as Prisma.InputJsonValue,
        messages: msgs as unknown as Prisma.InputJsonValue,
        patientId: ctx.patient?.id,
        ...(newState === 'COMPLETED' ? { completedAt: new Date(), resultType: ctx.resultType, resultId: ctx.resultId } : {}),
      },
    });

    // 구조화 데이터 — FE가 현재 접수 환자/증상/진료과 자동 반영 (regex 의존 제거)
    const structuredPatient = ctx.patient?.resolved && ctx.patient?.id
      ? {
          id: ctx.patient.id,
          mrn: ctx.patient.mrn,
          familyName: ctx.patient.familyName,
          givenName: ctx.patient.givenName,
          dateOfBirth: ctx.patient.birthDate,
          gender: ctx.patient.gender,
          phone: ctx.patient.phone,
        }
      : undefined;
    return {
      response,
      state: newState,
      context: ctx,
      uiDirective,
      patient: structuredPatient,
      symptoms: ctx.reception?.symptoms?.length ? ctx.reception.symptoms : (ctx.reception?.reason || undefined),
      department: ctx.reception?.department || undefined,
    };
  }

  /**
   * 증상이 아닌 입력(인사, 잡담, 예약 조회, 병원 안내 등)을 감지하고 처리.
   * 증상 입력이면 null 반환 → 호출측에서 트리아지 진행.
   */
  private async handleNonSymptomInput(
    input: string, ctx: any, session: any, msgs: any[],
  ): Promise<{ response: string; skipOrchestrator: boolean; newState?: string; uiDirective?: any } | null> {
    const trimmed = input.trim();
    const patientName = ctx.patient ? `${ctx.patient.familyName}${ctx.patient.givenName}` : '';

    // 1. 인사 감지
    const greetings = /^(안녕|하이|헬로|hi|hello|반갑)(하세요|하셨어요)?[\s!?.~]*(잘\s*지내|오랜만|반가워)?[\s!?.~]*$/i;
    if (greetings.test(trimmed)) {
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '안녕하세요' : '좋은 저녁이에요';
      return {
        response: `${timeGreeting}, ${patientName}님! 무엇을 도와드릴까요?\n\n증상을 말씀해주시면 적합한 진료과를 추천해드리고, 예약 일정 확인이나 병원 안내도 가능해요.`,
        skipOrchestrator: true,
        uiDirective: {
          type: 'QUICK_REPLIES',
          payload: [
            { label: '증상으로 예약', value: '증상이 있어서 예약하고 싶어요', icon: '🩺' },
            { label: '예약 확인', value: '예약을 확인하고 싶어요', icon: '📅' },
            { label: '병원 안내', value: '병원 안내를 해주세요', icon: '🏥' },
            { label: '건강검진', value: '건강검진을 받고 싶어요', icon: '🔬' },
          ],
        },
      };
    }

    // 1.15. 서류/증명서 발급 요청
    const docKeywords = /증명서|진단서|소견서|서류|발급|의무기록|사본|영수증|납입|확인서/;
    if (docKeywords.test(trimmed)) {
      return {
        response: `📄 서류 발급 안내\n\n아래 서류를 발급받으실 수 있습니다:\n• 진단서\n• 소견서\n• 의무기록 사본\n• 진료비 영수증/납입확인서\n\n👉 환자 포털의 **서류** 탭에서 온라인으로 신청하실 수 있습니다.\n\n방문 발급이 필요하시면 원무과를 방문해주세요.`,
        skipOrchestrator: true,
        uiDirective: {
          type: 'QUICK_REPLIES',
          payload: [
            { label: '📄 포털에서 신청', value: '포털로 이동할게요' },
            { label: '다른 문의', value: '다른 게 궁금해요' },
          ],
        },
      };
    }

    // 1.16. 포털 기능 질문 — DB 조회 기반 응답
    const pid = ctx.patient?.id;

    // 예약 취소 확인 대기 중일 때 — "전부 취소", "네", "아니오" 등
    if (ctx.pendingCancelIds) {
      if (/네|예|확인|진행|맞아|그래|응|ㅇㅇ|전부|취소|다\s/.test(trimmed)) {
        const ids = ctx.pendingCancelIds;
        ctx.pendingCancelIds = undefined;
        await this.prisma.appointment.updateMany({
          where: { id: { in: ids } },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'AI 컨시어지 취소' },
        });
        return { response: `❌ ${ids.length}건의 예약이 취소되었습니다.\n\n다시 예약이 필요하시면 말씀해주세요.`, skipOrchestrator: true };
      }
      if (/아니|안\s*할|유지|취소\s*안|그만/.test(trimmed)) {
        ctx.pendingCancelIds = undefined;
        return { response: '예약을 유지합니다. 다른 도움이 필요하시면 말씀해주세요.', skipOrchestrator: true };
      }
    }

    // 예약 취소 (확인보다 먼저 체크 — "내 예약 다 취소" 가 "내 예약"에 먼저 걸리지 않도록)
    if (/취소/.test(trimmed) && pid) {
      const cancelAppts = await this.prisma.appointment.findMany({
        where: { patientId: pid, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
        include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
        orderBy: { scheduledAt: 'asc' },
      });
      if (cancelAppts.length === 0) {
        return { response: '취소할 예약이 없습니다.', skipOrchestrator: true };
      }
      const dayN = ['일', '월', '화', '수', '목', '금', '토'];
      const cancelAll = /전부|다\s|모두|전체|싹|다취소/.test(trimmed);

      // 취소 확인 요청 (바로 삭제하지 않고 확인 먼저)
      const targets = cancelAll ? cancelAppts : cancelAppts.length === 1 ? [cancelAppts[0]] : null;

      if (targets) {
        // 세션에 취소 대상 저장
        ctx.pendingCancelIds = targets.map(a => a.id);
        const list = targets.map(a => {
          const d = new Date(a.scheduledAt);
          return `• ${d.getMonth()+1}/${d.getDate()}(${dayN[d.getDay()]}) ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} — ${a.doctor?.department ?? ''} ${a.doctor?.familyName}${a.doctor?.givenName}`;
        }).join('\n');
        return {
          response: `⚠️ 다음 ${targets.length}건의 예약을 정말 취소하시겠습니까?\n\n${list}\n\n취소하시면 되돌릴 수 없습니다.`,
          skipOrchestrator: true,
          uiDirective: { type: 'QUICK_REPLIES', payload: [{ label: '네, 취소합니다', value: '네 예약 취소 확인' }, { label: '아니오, 유지합니다', value: '취소 안 할래요' }] },
        };
      }

      // 여러 건 중 특정 예약 매칭 시도 (번호/날짜/진료과)
      let matched: typeof cancelAppts[0] | null = null;

      // "1번", "2번" 번호 매칭
      const numMatch = trimmed.match(/(\d+)\s*번/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < cancelAppts.length) matched = cancelAppts[idx];
      }

      // "5월 15일", "15일" 날짜 매칭
      if (!matched) {
        const dateMatch = trimmed.match(/(\d{1,2})월\s*(\d{1,2})일/) || trimmed.match(/(\d{1,2})일/);
        if (dateMatch) {
          const month = dateMatch.length === 3 ? parseInt(dateMatch[1], 10) : null;
          const day = parseInt(dateMatch[dateMatch.length === 3 ? 2 : 1], 10);
          matched = cancelAppts.find(a => {
            const d = new Date(a.scheduledAt);
            return d.getDate() === day && (month === null || d.getMonth() + 1 === month);
          }) ?? null;
        }
      }

      // 진료과 매칭
      if (!matched) {
        const depts = ['내과', '외과', '정형외과', '산부인과', '소아청소년과', '가정의학과', '재활의학과', '신경과', '안과', '이비인후과', '피부과', '치과'];
        const deptMatch = depts.find(d => trimmed.includes(d));
        if (deptMatch) {
          matched = cancelAppts.find(a => (a.doctor as Record<string, string>)?.department?.includes(deptMatch)) ?? null;
        }
      }

      if (matched) {
        // 개별 취소 확인
        ctx.pendingCancelIds = [matched.id];
        const d = new Date(matched.scheduledAt);
        const desc = `${d.getMonth()+1}/${d.getDate()}(${dayN[d.getDay()]}) ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} — ${(matched.doctor as Record<string, string>)?.department ?? ''} ${(matched.doctor as Record<string, string>)?.familyName}${(matched.doctor as Record<string, string>)?.givenName}`;
        return {
          response: `⚠️ 다음 예약을 취소하시겠습니까?\n\n• ${desc}\n\n취소하시면 되돌릴 수 없습니다.`,
          skipOrchestrator: true,
          uiDirective: { type: 'QUICK_REPLIES', payload: [{ label: '네, 취소합니다', value: '네 예약 취소 확인' }, { label: '아니오', value: '취소 안 할래요' }] },
        };
      }

      // 매칭 실패 — 목록 보여주고 선택 요청
      const list = cancelAppts.map((a, i) => {
        const d = new Date(a.scheduledAt);
        return `${i+1}. ${d.getMonth()+1}/${d.getDate()}(${dayN[d.getDay()]}) ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} — ${(a.doctor as Record<string, string>)?.department ?? ''} ${(a.doctor as Record<string, string>)?.familyName}${(a.doctor as Record<string, string>)?.givenName}`;
      }).join('\n');
      return {
        response: `📅 취소할 예약을 선택해주세요:\n\n${list}\n\n"전부 취소" 또는 번호/날짜/진료과를 말씀해주세요.`,
        skipOrchestrator: true,
        uiDirective: { type: 'QUICK_REPLIES', payload: [{ label: '전부 취소', value: '예약 전부 취소해줘' }, ...cancelAppts.slice(0, 3).map((a, i) => ({ label: `${i+1}번 취소`, value: `${i+1}번 예약 취소해줘` }))] },
      };
    }

    // (취소 확인/거부는 상단 pendingCancelIds 블록에서 처리)
    if (/예약.*변경|예약.*바꾸|변경.*예약/.test(trimmed) && pid) {
      // 변경은 포털 안내

    // 예약 확인 (취소/변경이 아닌 경우만)
    if (/내 예약|예약 확인|다음 예약|예약.*있|예약 조회/.test(trimmed) && !/취소|변경|바꾸/.test(trimmed) && pid) {
      const appts = await this.prisma.appointment.findMany({ where: { patientId: pid, status: 'SCHEDULED', scheduledAt: { gte: new Date() } }, include: { doctor: { select: { familyName: true, givenName: true, department: true } } }, orderBy: { scheduledAt: 'asc' }, take: 3 });
      if (appts.length === 0) return { response: '📅 예약된 진료가 없습니다.\n\n예약을 원하시면 증상이나 진료과를 말씀해주세요.', skipOrchestrator: true };
      const list = appts.map(a => `• ${new Date(a.scheduledAt).toLocaleDateString('ko', { month: 'long', day: 'numeric', weekday: 'short' })} ${localeTimeText(new Date(a.scheduledAt), 'ko-KR', { hour: '2-digit', minute: '2-digit' })} — ${a.doctor?.department ?? ''} ${a.doctor?.familyName}${a.doctor?.givenName}`).join('\n');
      return { response: `📅 예약 내역:\n\n${list}\n\n취소를 원하시면 "예약 취소해줘"라고 말씀해주세요.`, skipOrchestrator: true, uiDirective: { type: 'QUICK_REPLIES', payload: [{ label: '예약 취소', value: '내 예약 다 취소해줘' }, { label: '포털로 이동', value: '포털' }, { label: '다른 예약', value: '다른 증상이 있어요' }] } };
    }
      return { response: '📅 예약 변경은 환자 포털의 \'예약\' 탭에서 직접 처리하실 수 있습니다.\n\n또는 "목요일 예약 취소해줘" 처럼 취소 후 재예약도 가능합니다.', skipOrchestrator: true };
    }

    // 진료비/미수납
    if (/진료비|수납|미수납|얼마.*내야|결제|납부|영수증/.test(trimmed) && pid) {
      const bills = await this.prisma.billing.findMany({ where: { patientId: pid, status: { in: ['PENDING', 'PARTIAL'] } }, select: { totalAmount: true, patientCopay: true, paidAmount: true, createdAt: true }, take: 5 });
      if (bills.length === 0) return { response: '💰 미수납 진료비가 없습니다.\n\n포털 \'진료비\' 탭에서 전체 내역을 확인할 수 있습니다.', skipOrchestrator: true };
      const total = bills.reduce((s, b) => s + ((b.patientCopay ?? b.totalAmount ?? 0) - (b.paidAmount ?? 0)), 0);
      return { response: `💰 미수납 진료비: ${total.toLocaleString()}원 (${bills.length}건)\n\n포털 '진료비' 탭에서 상세 확인 및 결제가 가능합니다.`, skipOrchestrator: true };
    }

    // 문진표
    if (/문진표|문진|미작성|작성해야/.test(trimmed) && pid) {
      const pending = await this.prisma.questionnaireToken.findMany({ where: { patientId: pid, status: 'SENT', expiresAt: { gt: new Date() } }, take: 5 });
      if (pending.length === 0) return { response: '📝 현재 미작성 문진표가 없습니다.', skipOrchestrator: true };
      return { response: `📝 미작성 문진표 ${pending.length}건이 있습니다.\n내원 전 미리 작성하시면 진료가 빨라집니다!\n\n포털 '문진/동의' 탭에서 작성 가능합니다.`, skipOrchestrator: true };
    }

    // 투약/알레르기
    if (/복용.*약|투약|약 목록|알레르기|알러지/.test(trimmed) && pid) {
      const allergies = await this.prisma.allergy.findMany({ where: { patientId: pid }, select: { allergen: true, type: true }, take: 10 });
      const allergyText = allergies.length > 0 ? allergies.map(a => `• ${a.allergen} (${a.type})`).join('\n') : '없음';
      return { response: `💊 알레르기 정보:\n${allergyText}\n\n복용 약물 상세는 포털 '투약/알레르기' 탭에서 확인하세요.`, skipOrchestrator: true };
    }

    // 검사 결과
    if (/검사 결과|혈액검사|피검사|검사.*나왔|검사.*확인|검사.*조회/.test(trimmed) && pid) {
      const results = await this.prisma.labResult.findMany({ where: { patient: { id: pid }, status: 'COMPLETED' }, select: { completedAt: true, items: { select: { testName: true, flag: true }, take: 3 } }, orderBy: { completedAt: 'desc' }, take: 3 });
      if (results.length === 0) return { response: '🔬 최근 검사 결과가 없습니다.\n\n포털 \'검사결과\' 탭에서 전체 이력을 확인할 수 있습니다.', skipOrchestrator: true };
      const list = results.map(r => { const dt = r.completedAt ? new Date(r.completedAt).toLocaleDateString('ko', { month: 'short', day: 'numeric' }) : ''; const items = r.items.map((i: { testName: string; flag?: string | null }) => `${i.testName}${i.flag === 'H' ? '↑' : i.flag === 'L' ? '↓' : ''}`).join(', '); return `• ${dt}: ${items}`; }).join('\n');
      return { response: `🔬 최근 검사 결과:\n${list}\n\n상세 수치는 포털 '검사결과' 탭에서 확인하세요.\n(정상/비정상 판단은 담당의에게 문의하세요)`, skipOrchestrator: true };
    }

    // 영상 검사
    if (/영상|CT|MRI|X-ray|엑스레이|초음파|영상.*결과/.test(trimmed) && pid) {
      const imgs = await this.prisma.imagingResult.findMany({ where: { patientId: pid, status: 'REPORTED' }, select: { modality: true, bodyPart: true, reportedAt: true }, orderBy: { reportedAt: 'desc' }, take: 3 });
      if (imgs.length === 0) return { response: '📷 최근 영상 검사 결과가 없습니다.', skipOrchestrator: true };
      const list = imgs.map(i => `• ${i.reportedAt ? new Date(i.reportedAt).toLocaleDateString('ko', { month: 'short', day: 'numeric' }) : ''} ${i.modality} ${i.bodyPart ?? ''}`).join('\n');
      return { response: `📷 최근 영상 검사:\n${list}\n\n포털 '영상검사' 탭에서 상세 확인 가능합니다.`, skipOrchestrator: true };
    }

    // 진료 이력
    if (/진료 기록|진료 이력|지난 진료|최근 진료|진료 내역/.test(trimmed) && pid) {
      const encounters = await this.prisma.encounter.findMany({ where: { patientId: pid }, include: { doctor: { select: { department: true, familyName: true, givenName: true } } }, orderBy: { createdAt: 'desc' }, take: 5 });
      if (encounters.length === 0) return { response: '📋 진료 이력이 없습니다.', skipOrchestrator: true };
      const list = encounters.map(e => `• ${new Date(e.createdAt).toLocaleDateString('ko', { month: 'short', day: 'numeric' })} ${e.doctor?.department ?? ''} — ${(e.subjective ?? '').slice(0, 20) || '진료'}`).join('\n');
      return { response: `📋 최근 진료 이력:\n${list}\n\n포털 '진료이력' 탭에서 상세 확인 가능합니다.`, skipOrchestrator: true };
    }

    // 내 정보/포털 안내
    if (/내 정보|정보 변경|연락처|전화번호.*변경|주소.*변경/.test(trimmed)) {
      return { response: '👤 개인정보 변경은 포털 \'내 정보\' 탭에서 가능합니다.\n\n변경 가능: 연락처, 주소, 이메일\n\n[포털 바로가기](/portal)', skipOrchestrator: true };
    }
    if (/인증서|전자서명|블록체인/.test(trimmed)) {
      return { response: '🔐 전자인증서는 포털에서 발급 가능합니다.\n인증서가 있으면 동의서에 법적 전자서명이 가능합니다.\n\n포털 홈 → \'내 인증서\' 섹션에서 발급하세요.', skipOrchestrator: true };
    }
    if (/포털|환자.*포털|마이.*페이지/.test(trimmed)) {
      return { response: '📱 환자 포털 기능 안내:\n\n• 📅 예약 조회/변경\n• 📋 진료이력\n• 🔬 검사결과\n• 📷 영상검사\n• 💊 투약/알레르기\n• 💰 진료비\n• 📄 서류 신청\n• 📹 원격진료\n• 🩺 건강검진\n\n[포털 바로가기](/portal)', skipOrchestrator: true };
    }

    // 1.17. 응급 키워드 감지 (최우선)
    const emergencyKeywords = /가슴.*통증|흉통|숨.*못.*쉬|호흡.*곤란|의식.*잃|실신|대량.*출혈|골절.*의심|심한.*화상|경련|발작|자살|자해/;
    if (emergencyKeywords.test(trimmed)) {
      return {
        response: `🚨 응급 상황으로 판단됩니다.\n\n📞 119에 즉시 연락하시거나, 가까운 응급실을 방문해주세요.\n\n🏥 ${(await this.hospitalFacts())['hospital.name'] ?? '본원'} 응급실: 24시간 운영\n☎ 응급전화: 02-000-0119`,
        skipOrchestrator: true,
        uiDirective: { type: 'QUICK_REPLIES', payload: [{ label: '📞 119 안내', value: '119' }, { label: '다른 증상 상담', value: '다른 증상이 있어요' }] },
      };
    }

    // 1.18. 의사 정보 질문
    const doctorInfoQ = /의사|선생님|누구.*진료|담당.*의|전문의|의료진/;
    if (doctorInfoQ.test(trimmed) && !(/예약|접수/.test(trimmed))) {
      const targetDept = ctx.reception?.department;
      const nameMatch = trimmed.match(/(김|이|박|최|정|한|오|강|신|윤|장|임|유|송|권|황|안|홍|전|고)\s*\S*/);
      if (nameMatch) {
        const docs = await this.prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true, familyName: nameMatch[1] }, select: { familyName: true, givenName: true, department: true, specialty: true }, take: 5 });
        if (docs.length > 0) {
          const list = docs.map(d => `• ${d.familyName}${d.givenName} 선생님 (${d.department}${d.specialty ? ' / ' + d.specialty : ''})`).join('\n');
          return { response: `🩺 의사 검색 결과:\n\n${list}\n\n원하시는 선생님으로 예약하시겠어요?`, skipOrchestrator: true, uiDirective: { type: 'QUICK_REPLIES', payload: docs.slice(0, 3).map(d => ({ label: `${d.familyName}${d.givenName} 선생님`, value: `${d.department} ${d.familyName}${d.givenName} 선생님 예약` })) } };
        }
      }
      if (targetDept) {
        const docs = await this.prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true, department: { contains: targetDept } }, select: { familyName: true, givenName: true, department: true, specialty: true }, take: 5 });
        const list = docs.map(d => `• ${d.familyName}${d.givenName} 선생님${d.specialty ? ' (' + d.specialty + ')' : ''}`).join('\n');
        return { response: `🩺 ${targetDept} 의료진:\n\n${list || '(등록된 의사 없음)'}\n\n원하시는 선생님이 있으시면 말씀해주세요.`, skipOrchestrator: true };
      }
      const allDepts = await this.prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true }, select: { department: true }, distinct: ['department'] });
      const depts = allDepts.map(d => d.department).filter(Boolean);
      return { response: `🩺 의료진 조회를 위해 진료과를 알려주세요.\n\n운영 진료과: ${depts.join(', ')}`, skipOrchestrator: true };
    }

    // 1.19. 약 관련 질문 — "예약"의 "약" 오탐 방지
    const isAboutDrug = /(?<!예)약\s|^약$|타이레놀|진통제|항생제|부작용|복용법|먹어도 돼|복용.*약|처방.*약|먹는.*약|약.*이름|약.*효과/.test(trimmed);
    if (isAboutDrug && !(/알레르기|알러지|예약/.test(trimmed))) {
      const drugName = trimmed.replace(/약|에 대해|관련|정보|알려|줘|주세요|부작용|복용법/g, '').trim();
      if (drugName.length >= 2) {
        // 한/영 병용 P1(D2): 공용 빌더 — 상담 질의의 영문 약물명도 매칭
        const meds = await this.prisma.medicationCode.findMany({ where: { isActive: true, ...buildMedicationSearchWhere(drugName) }, select: { nameKo: true, code: true, dosageForm: true, ingredient: true }, orderBy: MEDICATION_SEARCH_ORDER, take: 3 });
        if (meds.length > 0) {
          const list = meds.map(m => `• ${m.nameKo} (${m.code})\n  성분: ${m.ingredient ?? '-'} | 제형: ${m.dosageForm ?? '-'}`).join('\n');
          return { response: `💊 약물 정보:\n\n${list}\n\n⚠ 약물 복용은 반드시 의사/약사 상담 후 결정하세요.\n약물 상담은 약국에서도 가능합니다.`, skipOrchestrator: true };
        }
      }
      return { response: `💊 약물 관련 질문이시군요.\n\n약물 복용/부작용 관련 상담은 담당의 또는 약사에게 문의하시는 것이 가장 정확합니다.\n\n진료 예약을 원하시면 증상을 말씀해주세요.`, skipOrchestrator: true };
    }

    // 1.20. 병원 서비스 질문 (입원, 응급, 수술 등)
    const serviceQ = /입원.*절차|입원.*방법|응급실.*어디|수술.*절차|수술.*준비|면회|면회.*시간|주사|링거|점적/;
    if (serviceQ.test(trimmed)) {
      // 🔴 (2026-09-14) 규칙 응답의 근거 없는 병원 사실(원무과 '1층'·면회 18:00~20:00·중환자실 면회 시간·응급실 '1층')을 걷었다(P15).
      //    CMS 태그 경로(handleFacilityQuestion — '면회'·'입원 준비물' 태그)가 먼저 돌고, 등록 행이 없을 때만 여기로 온다 →
      //    절차 일반론만 말하고 위치·시간은 "등록된 안내 없음" 사실 문장(정적 문장 — 값을 지어내지 않는다).
      if (/입원/.test(trimmed)) return { response: '🏥 입원 안내\n\n1. 외래 진료 후 담당의 판단으로 입원 결정\n2. 원무과에서 입원 수속\n3. 병동 배정 후 안내\n\n준비물·면회 시간은 원내에 등록된 안내가 없어 알려드릴 수 없습니다. 원무과 또는 대표전화로 확인해 주세요.', skipOrchestrator: true };
      // 🔴 종전 '전화: 02-1234-5678' 은 실병원과 다른 날조 번호였다 — 정본 대표전화로(미설정이면 확인되지 않음)
      if (/응급/.test(trimmed)) {
        const ef = await this.hospitalFacts();
        return { response: `🚑 응급실 안내\n\n• 운영: ${ef['hospital.emergency'] ?? '확인되지 않음(기관 설정 없음)'}\n• 대표전화: ${ef['hospital.phone'] ?? '확인되지 않음(기관 설정 없음)'}\n• 응급 시 119 이용\n\n응급실은 중증도(KTAS)에 따라 진료 순서가 결정됩니다.`, skipOrchestrator: true };
      }
      if (/수술/.test(trimmed)) return { response: '🔪 수술 안내\n\n1. 담당의 진료 후 수술 결정\n2. 수술 전 검사 (혈액/심전도/X-ray)\n3. 마취 상담\n4. 수술 동의서 작성\n5. 수술 당일 금식\n\n수술 관련 문의는 담당 진료과에서 안내드립니다.', skipOrchestrator: true };
      if (/면회/.test(trimmed)) return { response: AgentSessionService.VISITING_NONE, skipOrchestrator: true };
      const svcPhone = (await this.hospitalFacts())['hospital.phone'];
      return { response: `해당 서비스에 대해서는 원무과 또는 대표전화${svcPhone ? `(${svcPhone})` : ''}로 문의해주세요.`, skipOrchestrator: true };
    }

    // 1.2. 병원 정보 질문 (진료과, 의사, 진료시간, 위치, 병원 안내 등)
    // 🔴 (2026-09-14) 장례 어휘 추가 — 빠른답장 '장례식장 안내'(끝에 '해' 없음)가 이 분기에 걸리지 않아 CMS 장례식장 안내로 가지 못했다
    const hospitalInfoQ = /진료과|무슨 과|어떤 과|과가 뭐|뭐가 있|진료.*시간|운영.*시간|주소|위치|어디|찾아가|주차|오시는|병원.*안내|안내.*해|소개|정보|알려|장례|빈소|조문|영안실/;
    if (hospitalInfoQ.test(trimmed)) {
      // DB에서 실제 데이터 조회
      const doctors = await this.prisma.user.findMany({
        where: { role: 'DOCTOR', isActive: true },
        select: { department: true },
        distinct: ['department'],
      });
      const departments = doctors.map(d => d.department).filter(Boolean);
      // 🔴 병원 이름·진료시간·주소·대표전화는 정본(hospital.* DB 행) — 종전엔 'Hospital RUN'·'서울시 강남구 · 강남역 3번 출구'·
      //    '02-1234-5678'·'평일 09:00~18:00' 이 하드코딩이었다(실병원은 가상 가상시 · CMS 진료시간 ~17:30).
      //    미설정은 "확인되지 않음". 주차·식당·장례식장·층별 안내는 CMS(HospitalInfoContent) 공개 행만 말한다 — `cmsGuide` 참조(2026-09-14).
      const hf = await this.hospitalFacts();
      const hName = hf['hospital.name'] ?? '병원';
      const hPhone = hf['hospital.phone'];
      const hHours = hospitalHoursLines(hf);
      const hoursText = hHours.length ? hHours.map((l) => `• ${l}`).join('\n') : '• 진료시간이 기관 설정에 등록돼 있지 않아 안내할 수 없습니다. 대표전화로 확인해 주세요.';

      if (/진료과|무슨 과|어떤 과|과가 뭐/.test(trimmed)) {
        const deptList = departments.length > 0 ? departments.join(', ') : '내과, 외과, 정형외과, 소아청소년과, 산부인과, 안과, 이비인후과, 피부과, 치과, 가정의학과';
        return {
          response: `🏥 ${hName} 진료과 안내\n\n${deptList}\n\n원하시는 진료과가 있으시면 말씀해주세요. 증상을 알려주시면 적합한 진료과를 추천해드립니다.`,
          skipOrchestrator: true,
          uiDirective: { type: 'QUICK_REPLIES', payload: departments.slice(0, 6).map(d => ({ label: d, value: `${d} 예약하고 싶어요` })) },
        };
      }
      if (/진료.*시간|운영.*시간/.test(trimmed)) {
        return {
          response: `🕐 진료 시간 안내\n\n${hoursText}${hPhone ? `\n• 대표전화: ${hPhone}` : ''}\n\n예약을 원하시면 증상이나 진료과를 말씀해주세요.`,
          skipOrchestrator: true,
        };
      }
      if (/주소|위치|어디|찾아가|오시는/.test(trimmed)) {
        return {
          response: `📍 오시는 길\n\n${hf['hospital.address'] ?? '주소 확인되지 않음(기관 설정 없음)'} (${hName})\n\n• 전화: ${hPhone ?? '확인되지 않음'}\n\n예약을 원하시면 증상이나 진료과를 말씀해주세요.`,
          skipOrchestrator: true,
        };
      }
      if (/주차/.test(trimmed)) {
        return { response: await this.cmsGuideResponse('PARKING'), skipOrchestrator: true };
      }
      if (/식당|구내식당|카페|커피|매점|편의점|먹|밥|식사|메뉴|점심|아침|저녁|음식/.test(trimmed)) {
        return { response: await this.cmsGuideResponse('DINING'), skipOrchestrator: true };
      }
      if (/장례|장례식|빈소|조문|조화|부고|영안실|안치/.test(trimmed)) {
        return { response: await this.cmsGuideResponse('FUNERAL'), skipOrchestrator: true };
      }
      if (/편의시설|시설.*안내|뭐.*있|어디.*있|층.*안내|층별|플로어|안내도|배치/.test(trimmed)) {
        return {
          response: await this.cmsGuideResponse('FACILITY'),
          skipOrchestrator: true,
          uiDirective: {
            type: 'QUICK_REPLIES',
            payload: [
              { label: '주차 안내', value: '주차 안내해줘', icon: '🅿️' },
              { label: '식당 메뉴', value: '식당 메뉴 알려줘', icon: '🍽️' },
              { label: '장례식장', value: '장례식장 안내해줘', icon: '🕊️' },
              { label: '예약하기', value: '진료 예약하고 싶어요', icon: '📅' },
            ],
          },
        };
      }
      // 포괄적 병원 안내 (진료과 목록 + 시간 + 위치 + 서비스)
      const deptList = departments.length > 0 ? departments.join(', ') : '내과, 외과, 정형외과, 소아청소년과, 산부인과, 안과, 이비인후과, 피부과';
      return {
        response: `🏥 ${hName} 안내\n\n📋 진료과: ${deptList}\n\n🕐 진료시간\n${hoursText}\n\n📍 위치: ${hf['hospital.address'] ?? '확인되지 않음(기관 설정 없음)'}\n📞 대표전화: ${hPhone ?? '확인되지 않음(기관 설정 없음)'}\n\n🅿️🍽️🕊️ 주차·식당·장례식장은 '주차 안내'처럼 물어보시면 원내에 등록된 안내를 알려드립니다.\n\n🩺 주요 서비스\n• AI 예약 도우미 / 건강검진센터 / 원격진료\n• 온라인 문진표 / 환자 포털\n\n궁금한 것을 물어보세요!`,
        skipOrchestrator: true,
        uiDirective: {
          type: 'QUICK_REPLIES',
          payload: [
            { label: '예약하기', value: '예약하고 싶어요', icon: '📅' },
            { label: '진료과 안내', value: '진료과를 알려주세요', icon: '🏥' },
            { label: '시설 안내', value: '편의시설 안내해줘', icon: '🏢' },
            { label: '식당 메뉴', value: '식당 메뉴 알려줘', icon: '🍽️' },
          ],
        },
      };
    }

    // 1.3. 서비스별 예약 의도 (물리치료, 투석, 재활 등 → 진료과 매핑)
    const serviceMap: [RegExp, string, string][] = [
      [/물리\s*치료|재활\s*치료|재활/, '재활의학과', '물리치료/재활'],
      [/투석/, '신장내과', '투석'],
      [/한방|한의|침/, '한의학과', '한방 진료'],
      [/치과|이.*아프|잇몸|충치/, '치과', '치과 진료'],
      [/안과|눈.*아프|시력/, '안과', '안과 진료'],
      [/피부|여드름|습진|발진/, '피부과', '피부과 진료'],
      [/산부인과|임신|산전/, '산부인과', '산부인과 진료'],
      [/소아|아이.*아프|어린이/, '소아청소년과', '소아 진료'],
      [/정신|우울|불안|수면|불면/, '정신건강의학과', '정신건강 진료'],
      [/이비인후|귀.*아프|코.*막|목.*아프/, '이비인후과', '이비인후과 진료'],
    ];
    for (const [pattern, dept, label] of serviceMap) {
      if (pattern.test(trimmed)) {
        ctx.reception = { ...(ctx.reception ?? {}), department: dept, reason: label, visitType: 'INITIAL' };
        ctx.recommendations = { departments: [{ name: dept, reason: label, priority: 1, confidence: 100 }] };
        return {
          response: `${label} 예약을 도와드릴게요!\n\n${dept}에서 진행합니다. 예약하시겠어요?`,
          skipOrchestrator: true,
          newState: 'CONFIRMING',
          uiDirective: {
            type: 'QUICK_REPLIES',
            payload: [
              { label: `${dept} 예약`, value: '네' },
              { label: '다른 진료과', value: '다른 진료과 보여주세요' },
            ],
          },
        };
      }
    }

    // 1.5. 건강검진/직접 예약 의도 감지
    const checkupKeywords = /건강\s*검진|종합\s*검진|검진.*받|검진.*예약|인간\s*도크/;
    const directBooking = /예약.*해\s*줘|예약.*해줘|예약.*잡아|예약.*진행|그냥.*예약|바로.*예약/;
    if (checkupKeywords.test(trimmed)) {
      ctx.reception = { ...(ctx.reception ?? {}), department: '가정의학과', reason: '건강검진', visitType: 'INITIAL' };
      ctx.recommendations = { departments: [{ name: '가정의학과', reason: '건강검진', priority: 1, confidence: 100 }] };
      return {
        response: `건강검진 예약을 도와드릴게요!\n\n건강검진은 가정의학과에서 진행합니다.`,
        skipOrchestrator: true,
        newState: 'CONFIRMING',
        uiDirective: {
          type: 'QUICK_REPLIES',
          payload: [
            { label: '가정의학과 예약', value: '네' },
            { label: '검진 항목 안내', value: '검진 항목이 뭐가 있어?' },
          ],
        },
      };
    }
    // 1.6. 원격진료/비대면 진료 의도 감지
    const telehealthKeywords = /원격\s*진료|비대면\s*진료|화상\s*진료|영상\s*통화.*진료|온라인\s*진료|전화\s*상담.*진료/;
    if (telehealthKeywords.test(trimmed)) {
      return {
        response: `원격진료(비대면 진료) 예약을 도와드릴게요! 📹\n\n원격진료는 화상, 음성, 비동기 상담 3가지 유형으로 진행됩니다.\n\n👉 환자 포털의 **원격진료** 탭에서 예약하실 수 있습니다.\n\n[원격진료 예약하기](/portal) 페이지에서 진료과와 의사를 선택하고 예약하세요.`,
        skipOrchestrator: true,
        newState: 'IDLE',
        uiDirective: {
          type: 'QUICK_REPLIES',
          payload: [
            { label: '📹 화상진료 안내', value: '화상진료는 어떻게 하나요?' },
            { label: '💬 비동기 상담 안내', value: '비동기 상담은 뭔가요?' },
            { label: '다른 증상 상담', value: '다른 증상이 있어요' },
          ],
        },
      };
    }

    if (directBooking.test(trimmed) && !checkupKeywords.test(trimmed)) {
      const deptList = ['내과', '외과', '정형외과', '소아청소년과', '산부인과', '안과', '이비인후과', '피부과', '치과', '가정의학과', '신경과', '정신건강의학과'];
      const mentioned = deptList.find(d => trimmed.includes(d));
      if (mentioned) {
        ctx.reception = { ...(ctx.reception ?? {}), department: mentioned, reason: `${mentioned} 진료`, visitType: 'INITIAL' };
        ctx.recommendations = { departments: [{ name: mentioned, reason: '직접 선택', priority: 1, confidence: 100 }] };
        return {
          response: `${mentioned} 예약을 진행할게요!`,
          skipOrchestrator: true,
          newState: 'CONFIRMING',
          uiDirective: {
            type: 'QUICK_REPLIES',
            payload: [{ label: `${mentioned} 예약 진행`, value: '네' }],
          },
        };
      }
      return {
        response: `어떤 진료과로 예약할까요?\n\n증상을 말씀해주시면 적합한 진료과를 추천해드릴게요.`,
        skipOrchestrator: true,
        uiDirective: {
          type: 'QUICK_REPLIES',
          payload: [
            { label: '내과', value: '내과 예약해줘' },
            { label: '가정의학과', value: '가정의학과 예약해줘' },
            { label: '증상으로 추천', value: '' },
          ],
        },
      };
    }

    // 2. 예약 관련 질문
    const apptKeywords = /예약|일정|스케줄|잡혀|잡힌|언제.*가|다음.*진료/;
    // 예약 생성 의도 → handleNonSymptomInput에서 처리하지 않고 메인 상태 머신으로 통과
    const hasBookingNegative = /취소|변경|바꾸|확인|조회|언제|있나|목록/.test(trimmed);
    const isBookingCreation = !hasBookingNegative && /예약.*하고|예약.*싶|예약.*할게|예약.*할께|예약.*해줘|예약.*하려|예약.*잡아|예약.*가능/.test(trimmed);
    if (isBookingCreation) return null; // 메인 플로우로 통과

    if (apptKeywords.test(trimmed) && ctx.patient?.id) {
      // 예약 진행/변경 의도는 제외 (예약 조회가 아님)
      const isBookingIntent = /예약.*할|예약.*진행|예약해|예약하려/.test(trimmed) && !/있|확인|조회|일정|언제/.test(trimmed);
      // "동시 예약", "둘다 예약" 등 → 질문이지 조회가 아님
      const isBookingQuestion = /동시|둘\s*다|같이.*예약|한꺼번|한번에/.test(trimmed);
      if (isBookingQuestion) {
        return {
          response: `현재는 한 번에 하나의 진료과 예약을 진행해요.\n\n첫 번째 예약을 완료하시면, 바로 이어서 다른 진료과 예약을 도와드릴게요!`,
          skipOrchestrator: true,
        };
      }

      // ── 예약 변경/취소 감지 ──
      const isReschedule = /미뤄|미루|변경|옮겨|바꿔|앞당|연기|일정.*변경|날짜.*변경|시간.*변경/.test(trimmed);
      const isCancel = /취소|삭제|안\s*갈|안\s*가|못\s*가/.test(trimmed) && /예약/.test(trimmed);
      if (isReschedule || isCancel) {
        const appts = await this.prisma.appointment.findMany({
          where: { patientId: ctx.patient.id, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
          orderBy: { scheduledAt: 'asc' }, take: 10,
        });
        if (appts.length === 0) {
          return { response: '변경할 예약이 없습니다.', skipOrchestrator: true };
        }

        // 요일/진료과로 대상 예약 특정
        const dayN = ['일', '월', '화', '수', '목', '금', '토'];
        const dayMatch = trimmed.match(/(월|화|수|목|금|토|일)\s*요?일?/);
        const deptMatch = ['내과', '외과', '정형외과', '치과', '신경과', '소아청소년과', '산부인과', '안과', '이비인후과', '피부과'].find(d => trimmed.includes(d));
        let targetAppt = appts[0]; // 기본: 가장 가까운 예약

        if (dayMatch) {
          const targetDay = dayN.indexOf(dayMatch[1]);
          const found = appts.find(a => new Date(a.scheduledAt).getDay() === targetDay);
          if (found) targetAppt = found;
        }
        if (deptMatch) {
          const found = appts.find((a: any) => a.doctor.department?.includes(deptMatch));
          if (found) targetAppt = found;
        }

        const apptDate = new Date(targetAppt.scheduledAt);
        const apptDesc = `${apptDate.getMonth() + 1}/${apptDate.getDate()}(${dayN[apptDate.getDay()]}) ${apptDate.getHours()}:${String(apptDate.getMinutes()).padStart(2, '0')} ${(targetAppt as any).doctor.familyName}${(targetAppt as any).doctor.givenName} 선생님`;

        if (isCancel) {
          // 예약 취소
          await this.prisma.appointment.update({ where: { id: targetAppt.id }, data: { status: 'CANCELLED' } });
          return {
            response: `❌ 예약이 취소되었습니다.\n\n취소된 예약: ${apptDesc}\n\n다시 예약이 필요하시면 말씀해주세요.`,
            skipOrchestrator: true,
          };
        }

        // 예약 변경 (미루기/앞당기기) — 공휴일 회피
        const weekShift = /한\s*주|1주|일주/.test(trimmed) ? 7 : /이주|2주|두\s*주/.test(trimmed) ? 14 : 7;
        const direction: 1 | -1 = /앞당|당겨/.test(trimmed) ? -1 : 1;
        const newDate = new Date(apptDate);
        newDate.setDate(newDate.getDate() + (weekShift * direction));

        // 주말 + 공휴일 회피
        const adjustedDate = await this.holidayService.skipHolidays(newDate, direction);

        await this.prisma.appointment.update({
          where: { id: targetAppt.id },
          data: { scheduledAt: adjustedDate },
        });
        const newDate2 = adjustedDate;

        const newDesc = `${newDate2.getMonth() + 1}/${newDate2.getDate()}(${dayN[newDate2.getDay()]}) ${newDate2.getHours()}:${String(newDate2.getMinutes()).padStart(2, '0')}`;
        return {
          response: `✅ 예약이 변경되었습니다.\n\n변경 전: ${apptDesc}\n변경 후: ${newDesc} ${(targetAppt as any).doctor.familyName}${(targetAppt as any).doctor.givenName} 선생님\n\n다른 변경이 필요하시면 말씀해주세요.`,
          skipOrchestrator: true,
          uiDirective: {
            type: 'QUICK_REPLIES',
            payload: [
              { label: '예약 확인', value: '내 예약은?' },
              { label: '새 예약', value: '새로 예약하고 싶어요' },
            ],
          },
        };
      }

      if (!isBookingIntent) {
        const appts = await this.prisma.appointment.findMany({
          where: { patientId: ctx.patient.id, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
          orderBy: { scheduledAt: 'asc' }, take: 5,
        });
        if (appts.length > 0) {
          let resp = `📋 ${patientName}님의 예약 내역:\n\n`;
          resp += appts.map((a: any, i: number) => {
            const dt = new Date(a.scheduledAt);
            const dayN = ['일', '월', '화', '수', '목', '금', '토'];
            return `${i + 1}. ${dt.getMonth() + 1}/${dt.getDate()}(${dayN[dt.getDay()]}) ${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')} — ${a.doctor.familyName}${a.doctor.givenName} 선생님 (${a.doctor.department})`;
          }).join('\n');
          resp += '\n\n새 예약이 필요하시면 증상을 말씀해주세요.';
          return { response: resp, skipOrchestrator: true };
        } else {
          return {
            response: `현재 예약된 일정이 없습니다.\n\n새 예약이 필요하시면 증상을 말씀해주세요.`,
            skipOrchestrator: true,
          };
        }
      }
    }

    // 3. 병원 안내/진료시간/위치 질문
    const hospitalInfoKeywords = /병원.*안내|위치|주소|전화|몇시|진료.*시간|영업|휴무|휴일|주차|오시는/;
    if (hospitalInfoKeywords.test(trimmed)) {
      // 오케스트레이터에서 HOSPITAL_INFO 도구로 처리
      return { response: '', skipOrchestrator: false };
    }

    // 4. 의료진/진료표 질문
    const doctorInfoKeywords = /의료진|선생님.*누구|어떤.*분|의사.*소개|진료표/;
    if (doctorInfoKeywords.test(trimmed)) {
      return { response: '', skipOrchestrator: false };
    }

    // 5. 증상 키워드가 확실히 포함된 경우에만 트리아지로 → 그 외 모두 오케스트레이터
    const symptomPattern = /아프|아파|아퍼|통증|열이|기침|두통|복통|설사|구토|어지러|숨이|가래|발진|가려|소변|불면|우울|불안|호흡|골절|외상|다쳤|부러|충혈|빈뇨|가슴.*답답|속이.*안|토할|메스꺼|욱신|찌릿|쑤시|붓고|부어|멍|피가|출혈|콧물|재채기/;
    if (!symptomPattern.test(trimmed)) {
      // 증상 키워드 없음 → 일반 대화 → 오케스트레이터로
      return { response: '', skipOrchestrator: false };
    }

    return null; // 증상으로 판단 → 트리아지 진행
  }

  /** 날짜/시간 선호도 파싱 (예: "화, 수요일 오후", "다음주 금요일 오전") */
  private parseDatePreference(input: string): { days: string[]; period: string | null; nextWeek: boolean } | null {
    const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
    const dayPattern = /(월|화|수|목|금|토|일)\s*요?일?/g;
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = dayPattern.exec(input)) !== null) {
      if (!matches.includes(m[1])) matches.push(m[1]);
    }
    if (matches.length === 0) return null;

    const period = /오전|아침/.test(input) ? '오전' : /오후|점심\s*후|저녁/.test(input) ? '오후' : null;
    const nextWeek = /다음\s*주|차주|내주/.test(input);

    return { days: matches, period, nextWeek };
  }

  /** 일반 대화에 대한 짧은 친절 응답 + 예약 유도 */
  private async generateCasualResponse(input: string, patientName: string): Promise<string> {
    const trimmed = input.trim().toLowerCase();
    const suffix = '\n\n혹시 불편한 곳이 있으시면 말씀해주세요.';
    const pn = patientName ? `${patientName}, ` : '';

    // 날씨 — 실제 API 호출
    if (/날씨|비\s*오|더워|추워|덥|춥/.test(trimmed)) {
      const weather = await this.medicalAi.getWeather();
      if (weather) {
        return `${pn}${weather}\n건강 관리에 유의하세요!${suffix}`;
      }
      const hour = new Date().getHours();
      if (hour < 12) return `${pn}오늘 아침 공기가 좋죠! 건강 관리에 좋은 날이에요.${suffix}`;
      if (hour < 18) return `${pn}오후에도 건강하게 보내고 계시죠?${suffix}`;
      return `${pn}저녁이 되니 선선해지네요. 건강 조심하세요!${suffix}`;
    }

    // 시간
    if (/몇\s*시|시간|지금/.test(trimmed)) {
      const now = new Date();
      return `지금 ${now.getHours()}시 ${now.getMinutes()}분이에요.${suffix}`;
    }

    // 감사/칭찬
    if (/고마|감사|잘\s*했|대단|최고|굿|좋아/.test(trimmed)) {
      return `감사합니다! 도움이 되어 기쁘네요.${suffix}`;
    }

    // 안부/기분
    if (/뭐해|심심|재미|놀아|잘\s*지내|어때/.test(trimmed)) {
      return `${patientName ? `${patientName}, ` : ''}저는 여기서 예약 도우미로 열심히 일하고 있어요!${suffix}`;
    }

    // 이름/정체
    if (/누구|이름|뭐야|넌\s*뭐|정체/.test(trimmed)) {
      return `저는 ${(await this.hospitalFacts())['hospital.name'] ?? '이 병원'}의 AI 상담 도우미예요. 증상 상담, 진료과 추천, 예약 관리를 도와드려요!${suffix}`;
    }

    // 농담/장난
    if (/ㅋ|ㅎ|하하|웃|재밌|농담/.test(trimmed)) {
      return `하하, 재미있으시네요!${suffix}`;
    }

    // 기본 폴백
    // 🔴 대표전화·평일 진료시간은 정본(hospital.*) — 미설정이면 싣지 않는다(종전 '(평일 09:00~18:00)' 은 CMS 정본과 어긋났다)
    const hf = await this.hospitalFacts();
    const phone = hf['hospital.phone'];
    const weekday = hf['hospital.hours.weekday'];
    return `${patientName ? `${patientName}, ` : ''}네, 알겠습니다! 증상이 있으시면 편하게 말씀해주세요. 예약 확인이나 병원 안내도 도와드릴 수 있어요.${phone ? `\n\n전화 문의: ${phone}${weekday ? ` (평일 ${weekday})` : ''}` : ''}`;
  }

  /**
   * 입력에서 식별정보(MRN/전화/생년월일/성별/접수유형/이름)를 뽑는다.
   * 🔴 증상 추출은 여기서 제거했다 — 하드코딩 맵 사본이었다(T4). 증상은 TriageService 정본이 뽑아
   *    `extracted` 로 넘어온다. 이름 오추출 방지에만 그 결과를 쓴다.
   */
  private parseInput(input: string, extracted?: ExtractedSymptoms) {
    const result: any = { name: null, mrn: null, phone: null, birthYear: null, birthDate: null, gender: null, symptoms: [], visitType: null };

    // MRN
    const mrnMatch = input.match(/(P2026-\d{4}|HR-[\d-]+)/i);
    if (mrnMatch) result.mrn = mrnMatch[1];

    // 전화번호
    const phoneMatch = input.match(/01[016789]-?\d{3,4}-?\d{4}/);
    if (phoneMatch) result.phone = phoneMatch[0];

    // 생년월일 — 전화번호/MRN 제거 후 8자리(YYYYMMDD)·6자리(YYMMDD) 우선 파싱
    const dateSrc = input
      .replace(/01[016789]-?\d{3,4}-?\d{4}/g, ' ')
      .replace(/P2026-\d{4}|HR-[\d-]+/gi, ' ');
    const ymd8 = dateSrc.match(/(?<!\d)(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/);
    if (ymd8) {
      result.birthYear = parseInt(ymd8[1]);
      result.birthDate = `${ymd8[1]}-${ymd8[2]}-${ymd8[3]}`;
    }
    const ymd6 = !result.birthDate ? dateSrc.match(/(?<!\d)(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/) : null;
    if (ymd6) {
      const yy = parseInt(ymd6[1]);
      result.birthYear = yy > 30 ? 1900 + yy : 2000 + yy; // 970101 → 1997
      result.birthDate = `${result.birthYear}-${ymd6[2]}-${ymd6[3]}`;
    }

    // 생년 (4자리 연도만)
    if (!result.birthYear) {
      const yearMatch = input.match(/(19\d{2}|20[012]\d)년?/);
      if (yearMatch) result.birthYear = parseInt(yearMatch[1]);
    }
    const shortYear = input.match(/(\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (shortYear) {
      const y = parseInt(shortYear[1]);
      result.birthYear = y > 30 ? 1900 + y : 2000 + y;
      result.birthDate = `${result.birthYear}-${shortYear[2].padStart(2, '0')}-${shortYear[3].padStart(2, '0')}`;
    }

    // 성별
    if (/남자|남성|\bM\b|male/i.test(input)) result.gender = 'MALE';
    if (/여자|여성|\bF\b|female/i.test(input)) result.gender = 'FEMALE';

    // 접수 유형
    if (/재진|다시|약\s*처방|리필|추적/i.test(input)) result.visitType = 'FOLLOW_UP';
    if (/초진|처음|첫\s*방문|신환/i.test(input)) result.visitType = 'INITIAL';

    // 증상 — DB 정본(TriageService)이 뽑은 결과를 그대로 쓴다
    result.symptoms = extracted?.symptoms ?? [];

    // 이름 (MRN/전화번호/숫자가 아닌 한글 2~4글자)
    const cleaned = input.replace(/\d+년?\s*\d*월?\s*\d*일?|01[016789]-?\d{3,4}-?\d{4}|P2026-\d+|HR-[\d-]+|남자|여자|남성|여성|초진|재진|처음/g, '').trim();
    const nameMatch = cleaned.match(/^([가-힣]{2,4})/);
    // 🔴 "머리가 아파요" 의 '머리가' 를 환자 이름으로 오인해 신환 등록으로 흐르던 것 —
    //    증상 매칭이 차지한 구간과 겹치면 이름으로 보지 않는다("김영수 두통" 은 이름이 겹치지 않아 그대로 산다).
    if (nameMatch && !this.overlapsSymptomMatch(nameMatch[1], extracted)) result.name = nameMatch[1];

    return result;
  }

  /** 이름 후보가 증상 매칭 구간과 겹치는지 — 정규화 좌표계는 TriageService 가 넘겨준 것을 그대로 쓴다 */
  private overlapsSymptomMatch(candidate: string, extracted?: ExtractedSymptoms): boolean {
    if (!extracted || extracted.matchedSpans.length === 0) return false;
    if (extracted.symptoms.includes(candidate)) return true;
    const needle = normalizeSymptomText(candidate);
    if (!needle) return false;
    const hay = extracted.normalizedText;
    for (let idx = hay.indexOf(needle); idx >= 0; idx = hay.indexOf(needle, idx + 1)) {
      const end = idx + needle.length;
      if (extracted.matchedSpans.some(sp => idx < sp.end && end > sp.start)) return true;
    }
    return false;
  }

  /**
   * 진료과 추천 — DB 규칙(TriageService) 정본 하나만 쓴다.
   * 🔴 원 결함 T4 — 예전 `recommendDepartments(symptoms)` 는 컴파일 타임 하드코딩 맵을 읽었다.
   *    관리 화면 편집이 반영되지 않았고, 타입에 emergency 가 없어 응급 경고도 안 나갔다.
   *    이제 응급 판정을 **반드시 함께** 돌려준다.
   */
  private async recommendDepartments(
    input: string,
    ctx: any,
    extracted?: ExtractedSymptoms,
  ): Promise<{ deptRecs: { name: string; reason: string; priority: number; confidence: number }[]; triage: TriageResult }> {
    const triage = await this.triageService.evaluate(input, {
      age: ageOf(ctx?.patient?.birthDate) ?? undefined,
      sex: ctx?.patient?.gender === 'MALE' ? 'M' : ctx?.patient?.gender === 'FEMALE' ? 'F' : undefined,
    }, extracted);
    return { deptRecs: this.toDeptRecs(triage), triage };
  }

  /** TriageResult → 화면/컨텍스트용 추천 목록 (표현 규칙 한 곳) */
  private toDeptRecs(triage: TriageResult) {
    return triage.recommendations.map(r => ({
      name: r.department,
      reason: `${r.reason} (${r.confidence}%)`,
      priority: r.priority,
      confidence: r.confidence,
    }));
  }

  /**
   * 응급 안내 문구.
   * 🔴 원 결함 T6 — DB `emergencyMsg` 는 "급성 관상동맥증후군/대동맥박리 감별 필요" 같은 감별진단 메모인데
   *    이것이 미인증 공개 예약 챗 환자의 응답 **맨 앞**에 그대로 붙었고, 무엇을 해야 하는지(119)가 없었다.
   *    환자에게는 코드 정본의 행동 지시만, 임상 메모는 스태프 채널(원무 데스크)에서만 참고로 덧붙인다.
   * 🔴 원 결함 T3 — UNDETERMINED(못 알아들음)는 '응급 아님'이 아니다. 안전측 안내를 남긴다.
   */
  private emergencyNotice(triage: TriageResult, channel: string): string | null {
    const isStaffChannel = channel === 'HIS_RECEPTION';
    if (triage.emergencyAssessment === 'EMERGENCY') {
      const action = triage.patientEmergencyAction ?? PATIENT_EMERGENCY_ACTION;
      const clinical = isStaffChannel && triage.emergencyMsg ? `\n(임상 참고: ${triage.emergencyMsg})` : '';
      return `${action}\n- 119 (응급전화)\n- 02-000-0119 (병원 응급실 직통, 24시간)${clinical}`;
    }
    if (triage.emergencyAssessment === 'UNDETERMINED') return triage.patientEmergencyAction;
    return null;
  }

  private async getLastEncounter(patientId: string) {
    const enc = await this.prisma.encounter.findFirst({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
    });
    if (!enc) return null;
    return {
      date: enc.createdAt.toISOString().split('T')[0],
      doctor: `${enc.doctor.familyName}${enc.doctor.givenName}`,
      department: enc.doctor.department ?? '내과',
      reason: enc.assessment?.substring(0, 50) ?? '',
    };
  }

  /**
   * 이 세션이 **공개(무인증)** 인가 — 🔴 `operatorId` 가 없으면 공개로 본다(fail-closed).
   *
   * 🔴 2026-08-19 실측 결함: `/api/v1/booking/*` 는 가드가 없는 공개 EP 인데,
   *    이 서비스가 **MRN 한 줄에 알레르기·활성 문제목록·최근 진료(의사·과)를 반환**하고 있었다.
   *    이름 검색은 한 술 더 떠 최대 5명의 `이름(MRN) 생년 성별` 목록을 냈다.
   *    본인확인 절차가 전혀 없었고, 무인증이라 감사 인터셉터도 탈락해(`audit.interceptor` 는
   *    `user.id` 가 없으면 즉시 return) **누가 무엇을 조회했는지 기록조차 남지 않았다.**
   */
  private isPublicSession(session: { operatorId?: string | null }): boolean {
    return !session?.operatorId;
  }

  /** 공개 채널 본인확인 실패 상한 — 초과 시 세션을 잠근다(세션 재생성은 생성 스로틀이 막는다) */
  private static readonly PUBLIC_VERIFY_MAX_ATTEMPTS = 5;

  /**
   * 🔴 공개 채널의 신원 조회 실패는 **한 가지 문구로만** 답한다.
   *    "등록번호가 없다"와 "생년월일이 다르다"를 구분해 주면 그것이 곧 MRN 열거 오라클이다
   *    (키오스크가 404/400 으로 갈라 놓아 같은 결함을 만든 전례가 있다).
   */
  private static publicVerifyFailMessage(phone: string | null): string {
    // 대표전화는 정본(hospital.phone) — 두 실패 사유에 **같은 번호**가 실리므로 오라클이 되지 않는다
    return `등록번호 또는 생년월일이 일치하지 않습니다.\n등록번호(예: P2026-****)와 생년월일 8자리(예: 19850312)를 다시 입력해주세요.\n\n등록번호를 모르시면 접수 창구${phone ? `(${phone})` : ''}로 문의해주세요.`;
  }

  /** 본인확인 잠금 안내 — 대표전화는 정본(hospital.phone), 미설정이면 번호 없이 */
  private static publicVerifyLockedMessage(phone: string | null): string {
    return `본인확인 시도가 많아 이 대화에서는 조회를 중단했습니다.\n접수 창구${phone ? `(${phone})` : ''}로 문의해주세요.`;
  }

  /** 🔴 병원 정체(이름·전화·주소·진료시간) — 정본 system_configs hospital.* 의 DB 행만. 안내 문구가 지어내지 않게 */
  private hospitalFacts(): Promise<HospitalFacts> {
    return readHospitalFacts(this.prisma);
  }

  /** 입력에서 생년월일 8자리(YYYYMMDD) 또는 YYYY-MM-DD 추출 */
  private parseBirthDate8(input: string): string | null {
    const m1 = input.match(/\b(19|20)\d{6}\b/);
    if (m1) return `${m1[0].slice(0, 4)}-${m1[0].slice(4, 6)}-${m1[0].slice(6, 8)}`;
    const m2 = input.match(/\b((?:19|20)\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
    if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
    return null;
  }

  /**
   * 환자 카드. 🔴 `publicChannel` 이면 **임상정보를 싣지 않는다** —
   *    알레르기·문제목록·최근 진료의는 예약에 필요 없고, 공개 화면에 나갈 이유가 없다.
   *    (본인확인을 통과했더라도 마찬가지다. 확인은 '이 사람이 맞다'는 뜻이지
   *     '이 채널로 임상정보를 보내도 된다'는 뜻이 아니다.)
   */
  private formatPatientCard(patient: any, allergies: any[], problems: any[], lastEnc: any, publicChannel = false) {
    let card = `✅ 기존 환자 발견\n`;
    card += `${patient.familyName}${patient.givenName} (${patient.mrn})\n`;
    if (publicChannel) return card.trimEnd();
    if (patient.birthDate) card += `생년: ${new Date(patient.birthDate).getFullYear()} | ${patient.gender === 'MALE' ? '남' : '여'}\n`;
    if (allergies.length) card += `⚠️ 알레르기: ${allergies.map((a: any) => a.allergen).join(', ')}\n`;
    if (problems.length) card += `📋 문제목록: ${problems.map((p: any) => `${p.description}(${p.status})`).join(', ')}\n`;
    if (lastEnc) card += `🕐 마지막 진료: ${lastEnc.date} ${lastEnc.doctor} (${lastEnc.department})`;
    return card;
  }

  /**
   * 공개 채널 본인확인 — **MRN + 생년월일 2요소**. 통과 전에는 어떤 환자 정보도 응답에 싣지 않는다.
   *
   * 🔴 실패 응답은 사유를 구분하지 않는다(§publicVerifyFailMessage).
   * 🔴 시도 횟수를 세션에 적립하고 상한을 넘으면 잠근다.
   * 🔴 성공·실패 모두 세션 컨텍스트에 남긴다 — `AuditLog.userId` 는 User FK 라 무인증 주체를
   *    담을 수 없다(직원 접속기록에서 확인한 동일 제약). 세션 행이 유일한 기록이므로 거기에 남긴다.
   *    별도 접근 원장은 스키마 제안 대상이다.
   */
  private async verifyPublicIdentity(
    session: { id: string },
    ctx: any,
    mrn: string,
    birthDate: string | null,
  ): Promise<{ response: string; newState: string; uiDirective?: any }> {
    ctx.verify = ctx.verify ?? { attempts: 0, locked: false, history: [] };

    if (ctx.verify.locked) {
      return {
        response: AgentSessionService.publicVerifyLockedMessage((await this.hospitalFacts())['hospital.phone']),
        newState: 'IDENTIFYING_PATIENT',
      };
    }

    // 생년월일이 아직 없으면 — 🔴 이 시점에 MRN 존재 여부를 조회하지 않는다(조회 자체가 오라클이 된다)
    if (!birthDate) {
      ctx.verify.pendingMrn = mrn;
      return {
        response: '본인확인이 필요합니다.\n생년월일 8자리(예: 19850312)를 입력해주세요.',
        newState: 'IDENTIFYING_PATIENT',
      };
    }

    ctx.verify.attempts += 1;
    const patient = await this.prisma.patient.findFirst({
      where: { mrn },
      select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true },
    });
    const dobMatches = !!patient && patient.dateOfBirth.toISOString().slice(0, 10) === birthDate;

    // 🔴 무인증이라 AuditLog 에 담을 수 없다 → 공개 접근 원장(등록번호는 해시)
    await this.accessLog?.record({
      channel: 'BOOKING', action: 'verify', path: '/api/v1/booking/session/message',
      result: !patient || !dobMatches ? 'FAIL' : 'OK', subject: mrn,
      patientId: patient && dobMatches ? patient.id : null, sessionRef: session.id,
    });
    if (!patient || !dobMatches) {
      ctx.verify.history.push({ at: new Date().toISOString(), result: 'FAIL' });
      if (ctx.verify.attempts >= AgentSessionService.PUBLIC_VERIFY_MAX_ATTEMPTS) {
        ctx.verify.locked = true;
        this.logger.warn(`공개 예약 본인확인 ${ctx.verify.attempts}회 실패 — 세션 잠금 session=${session.id}`);
        return {
          response: AgentSessionService.publicVerifyLockedMessage((await this.hospitalFacts())['hospital.phone']),
          newState: 'IDENTIFYING_PATIENT',
        };
      }
      // 존재/불일치를 구분하지 않는다
      return { response: AgentSessionService.publicVerifyFailMessage((await this.hospitalFacts())['hospital.phone']), newState: 'IDENTIFYING_PATIENT' };
    }

    // 통과 — 🔴 그래도 임상정보(알레르기·문제목록·최근 진료)는 싣지 않는다
    ctx.patient = {
      resolved: true, verified: true,
      id: patient.id, mrn: patient.mrn,
      familyName: patient.familyName, givenName: patient.givenName,
    };
    ctx.verify.history.push({ at: new Date().toISOString(), result: 'OK', patientId: patient.id });
    delete ctx.verify.pendingMrn;

    return {
      response: `${this.formatPatientCard(ctx.patient, [], [], null, true)}\n\n어떤 증상으로 내원하셨나요?`,
      newState: 'COLLECTING_SYMPTOMS',
      uiDirective: { type: 'SHOW_PATIENT_CARD', payload: this.publicPatientPayload(ctx.patient) },
    };
  }

  /** 공개 채널로 내보내도 되는 환자 필드만 — uiDirective payload 용(임상정보 제거) */
  private publicPatientPayload(patient: any) {
    return { resolved: true, id: patient.id, mrn: patient.mrn, familyName: patient.familyName, givenName: patient.givenName };
  }

  private async getNextQueueNumber(department: string): Promise<number> {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const count = await this.prisma.waitingQueue.count({
      where: { departmentName: department, createdAt: { gte: today } },
    });
    return count + 1;
  }

  /**
   * 세션 조회.
   *
   * 🔴 이 EP 는 공개 채널에서도 열려 있다(`GET /api/v1/booking/session/:id`).
   *    종전에는 **행 전체를 그대로 반환**해서, 세션 ID 만 알면 `context` 안의
   *    알레르기·문제목록·최근 진료까지 읽을 수 있었다(운영 실측: WEB_BOOKING 64건 중 45건이 그 상태).
   *    공개 세션에는 **대화에 필요한 것만** 돌려준다 — `context` 는 내부 상태이지 응답이 아니다.
   */
  async getSession(sessionId: string) {
    const session = await this.prisma.agentSession.findUnique({ where: { id: sessionId } });
    if (!session) return null;
    if (!this.isPublicSession(session)) return session;
    const ctx = (session.context ?? {}) as any;
    return {
      id: session.id,
      channel: session.channel,
      state: session.state,
      messages: session.messages,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      resultType: session.resultType,
      // 본인확인 통과 여부만 — 어떤 환자인지·임상정보는 싣지 않는다
      context: { patient: ctx?.patient?.verified ? { verified: true } : {} },
    };
  }

  // 컨시어지 트리아지용 — depth:fast(2단계·~5s) + qwen 단일모델(스왑 없음). 상세 임상분석은 full(다른 경로).
  private readonly conciergeFast = { depth: 'fast' as const, single_model: 'qwen2.5:14b' };

  /** 공개 enhanced chat — booking 페이지용 (인증 불필요) */
  async enhancedChat(message: string): Promise<any> {
    try {
      const result = await this.medicalAi.enhancedChat(message, 'medical', this.conciergeFast);
      return result;
    } catch (e) {
      this.logger.warn(`Enhanced chat error: ${e}`);
      // 에러 시 triage + reference 조합으로 fallback (한국어 강제)
      try {
        const [triageResult, refResult] = await Promise.allSettled([
          this.medicalAi.triage(message),
          this.medicalAi.reference(`${message} (한국어로 답변해주세요)`),
        ]);
        const triage = triageResult.status === 'fulfilled' ? triageResult.value : null;
        const ref = refResult.status === 'fulfilled' ? refResult.value : null;

        const parts: string[] = [];
        if (triage?.emergency_warning) {
          parts.push(`🚨 ${triage.emergency_warning}`);
        }
        if (triage?.recommendations?.length) {
          parts.push('📋 AI 감별진단:');
          triage.recommendations.forEach((r: any, i: number) => {
            parts.push(`${i + 1}. ${r.department} (${Math.round((r.confidence ?? 0) * 100)}%) — ${r.reason ?? ''}`);
          });
        }
        if (ref?.answer) {
          let refText = typeof ref.answer === 'string' ? ref.answer : JSON.stringify(ref.answer);
          // 중국어/일본어 제거 + 면책 조항 정리
          refText = refText
            .replace(/[\u4e00-\u9fff\u3400-\u4dbf]+[^\n]*/g, '')
            .replace(/\[면책\].*$/s, '')
            .replace(/请根据.*$/s, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          // 마지막 완전한 문장까지만 (잘림 방지)
          if (refText.length > 600) {
            const cut = refText.slice(0, 600);
            const lastEnd = Math.max(cut.lastIndexOf('다.'), cut.lastIndexOf('요.'), cut.lastIndexOf('세요.'), cut.lastIndexOf('니다.'));
            refText = lastEnd > 100 ? cut.slice(0, lastEnd + 2) : cut;
          }
          if (refText.length > 20) {
            parts.push('');
            parts.push('💡 의학 참고:');
            parts.push(refText);
          }
        }

        const rawAnswer = parts.length > 0 ? parts.join('\n') : '현재 정밀 분석 서비스를 이용할 수 없습니다. 일반 응답을 참고해주세요.';
        return { answer: this.cleanLlmResponse(rawAnswer), models_used: ['qwen2.5:14b'], fallback: true };
      } catch {
        return { answer: '현재 정밀 분석 서비스를 이용할 수 없습니다. 일반 응답을 참고해주세요.', error: true };
      }
    }
  }

  // ── 시설·편의시설 안내 (DB 기반 — HospitalInfoContent) ──
  private static readonly INFO_PATTERNS: Array<{ pattern: RegExp; tags: string[] }> = [
    { pattern: /주차/, tags: ['주차', '주차장', '주차비'] },
    { pattern: /식당|구내식당|카페|커피|매점|편의점|먹|밥|식사|메뉴|점심|아침|저녁|음식/, tags: ['식당', '카페', '편의점', '메뉴', '식사'] },
    { pattern: /장례|장례식|빈소|조문|조화|부고|영안실|안치/, tags: ['장례', '빈소', '조문'] },
    { pattern: /편의시설|시설.*안내|뭐.*있|층.*안내|층별|플로어|배치|안내도/, tags: ['시설', '층별'] },
    { pattern: /진료.*시간|몇시|운영.*시간/, tags: ['진료시간', '운영시간'] },
    { pattern: /주소|위치|어디|찾아가|오시는/, tags: ['위치', '주소', '오시는길'] },
    { pattern: /면회/, tags: ['면회', '방문'] },
    { pattern: /비급여|가격|수가|얼마|비용|MRI|CT/, tags: ['비급여', '가격'] },
    { pattern: /진단서|소견서|서류|증명서|발급/, tags: ['진단서', '발급', '서류'] },
    { pattern: /입원.*준비|준비물/, tags: ['입원', '준비물'] },
    { pattern: /예약.*변경|예약.*취소|취소.*방법/, tags: ['예약', '취소', '변경'] },
    { pattern: /의사.*소개|의사.*누구|선생님|교수님|전문의/, tags: ['의사', '소개'] },
    { pattern: /진료과.*안내|무슨.*과|어떤.*과/, tags: ['진료과'] },
    { pattern: /센터|심혈관|암센터|관절센터|투석센터|검진센터/, tags: ['센터', '심혈관센터', '암센터', '관절센터', '투석센터', '검진센터'] },
    { pattern: /내과/, tags: ['내과', '순환기', '호흡기', '소화기'] },
    { pattern: /외과|수술/, tags: ['외과', '수술', '복강경'] },
    { pattern: /정형|관절|골절|무릎|어깨/, tags: ['정형외과', '관절', '골절'] },
    { pattern: /소아|아이|어린이|예방접종/, tags: ['소아과', '소아청소년과', '예방접종'] },
    { pattern: /산부인과|임신|출산|분만/, tags: ['산부인과', '임신', '출산'] },
    { pattern: /안과|눈|시력|백내장/, tags: ['안과', '눈', '시력'] },
    { pattern: /이비인후|귀|코골이|축농증/, tags: ['이비인후과', '코골이'] },
    { pattern: /피부|아토피|여드름/, tags: ['피부과', '아토피'] },
    { pattern: /정신|우울|불안|수면|불면/, tags: ['정신과', '우울증', '수면'] },
    { pattern: /재활|물리치료|작업치료/, tags: ['재활', '물리치료'] },
    { pattern: /치과|치아|충치|임플란트/, tags: ['치과', '충치', '임플란트'] },
    { pattern: /비뇨|전립선|방광/, tags: ['비뇨의학과', '전립선'] },
    { pattern: /신경외과|디스크|뇌종양/, tags: ['신경외과', '디스크', '뇌종양'] },
    { pattern: /투석|콩팥|신장/, tags: ['투석', '만성콩팥병'] },
    { pattern: /항암|암.*치료|방사선.*치료/, tags: ['항암', '방사선치료', '암'] },
    { pattern: /건강검진|종합검진|인간도크/, tags: ['건강검진', '종합검진'] },
    { pattern: /병원.*안내|안내.*해|소개|정보.*알려/, tags: ['병원', '소개', '정보'] },
    { pattern: /응급|119|긴급/, tags: ['응급', '응급실'] },
    { pattern: /와이파이|wifi|인터넷/, tags: ['와이파이'] },
  ];

  /**
   * LLM-First 일반 질문 처리 — 의료 지식, 증상 문의, 진료과 안내 등
   * MedicalAiService.chatWithSession 활용 (인증 포함)
   */
  /** LLM 응답 공통 후처리 — 태그/마크다운/외국어/빈줄 제거 */
  private cleanLlmResponse(raw: string): string {
    let text = raw
      // 1. 태그 제거 (9종)
      .replace(/\[(?:CLARIFY_NEEDED|REFERENCE_NEEDED|DOCTORS_NEEDED|SCHEDULE_NEEDED|TRIAGE_NEEDED|APPOINTMENTS_NEEDED|LABRESULTS_NEEDED|BILLING_NEEDED|HOSPITAL_INFO_NEEDED)[^\]]*\]/g, '')
      // 2. 마크다운 제거
      .replace(/\*{2,}([^*]*)\*{2,}/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/^---+$/gm, '')
      .replace(/\[면책\]\s*/g, '');
    // 3. 외국어 줄 제거 (비율 기반)
    text = text.split('\n').filter(line => {
      const t = line.trim();
      if (!t) return true;
      const koreanCount = (t.match(/[\uAC00-\uD7AF]/g) || []).length;
      const cjkCount = (t.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length;
      if (cjkCount > 0 && cjkCount >= koreanCount) return false;
      if (/^\(번역\)$/.test(t)) return false;
      return true;
    }).join('\n');
    // 4+5. 빈 줄 + trim
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  private async handleGeneralQuestion(
    input: string, ctx: any, msgs: any[],
  ): Promise<{ response: string; uiDirective?: any } | null> {
    if (input.length <= 2 && /^(네|응|ㅇ|아니|ㅋ|ㅎ|음)$/.test(input)) return null;

    const patientName = ctx.patient?.familyName && ctx.patient?.givenName
      ? `${ctx.patient.familyName}${ctx.patient.givenName}` : null;

    const disclaimerShown = msgs.some((m: any) => m.role === 'agent' && String(m.content).includes('참고용'));
    // 🔴 병원 정체·진료시간은 정본(hospital.* DB 행) — 종전 '[진료시간] 평일 09:00~18:00' 상수는 CMS 정본(~17:30)과 어긋났다.
    //    미설정 항목은 "확인되지 않음"으로 싣고 추측을 금한다. 진료과 목록은 API 정본이 갈리지 않아 그대로 둔다(보고 목록).
    const hf = await this.hospitalFacts();
    const systemPrompt = `당신은 ${hf['hospital.name'] ?? '이 병원'}의 온라인 상담 예약 AI입니다.

[병원 정보 — 기관 설정에서 읽은 값]
${formatHospitalContext(hf)}
(위 병원 정보에 없는 사항은 추측해 말하지 말고 "확인되지 않는다"고 안내하세요.)
[진료과] 내과, 외과, 정형외과, 신경외과, 산부인과, 소아청소년과, 피부과, 비뇨의학과, 안과, 이비인후과, 재활의학과, 가정의학과, 응급의학과, 정신건강의학과, 치과
${patientName ? `[환자] ${patientName}님` : ''}

[화법 규칙]
1. 환자 이름을 자연스럽게 호칭하세요.
2. "~해드릴게요", "~이에요" 체를 사용하세요. 딱딱한 경어체 금지.
3. 질문에 대한 답변을 먼저 하고, 마지막에 예약을 자연스럽게 제안하세요.
4. 환자가 불안이나 걱정을 표현하면 먼저 공감한 후 정보를 제공하세요.
5. 진단/처방은 하지 않습니다. "전문의 상담을 권장합니다"로 마무리하세요.
6. ${disclaimerShown ? '"이 정보는 AI 참고용" 면책 고지를 반복하지 마세요. 이미 안내했습니다.' : '"이 정보는 AI 참고용이며 전문의 상담을 권장합니다"를 답변 끝에 한 번만 포함하세요.'}
7. 반드시 한국어로만 답변하세요. 일본어/중국어/영어 금지.
8. 마크다운 서식(**굵게**, *기울임*, ---, ### 등)을 사용하지 마세요. 일반 텍스트만.
9. 모호한 질문에는 추측하지 말고, 구체적 선택지 2~3개로 되물으세요.
10. 충분히 설명하되 핵심 위주로 답변하세요.`;

    try {
      // 대화 히스토리 구성 (최근 6턴)
      const history = msgs.slice(-6).map((m: any) =>
        `${m.role === 'user' ? '환자' : 'AI'}: ${String(m.content).slice(0, 200)}`,
      ).join('\n');
      const historyBlock = history ? `\n[이전 대화]\n${history}\n` : '';

      // Enhanced Chat (시스템 프롬프트 + 대화 히스토리 + 현재 질문)
      const fullMessage = `${systemPrompt}${historyBlock}\n환자: ${input}`;
      const chatResult = await this.medicalAi.enhancedChat(fullMessage, 'medical', this.conciergeFast);

      const answer = chatResult?.answer ?? chatResult?.response ?? '';
      if (answer.length > 10) {
        const text = answer;

        // 진료과 추천이 포함되면 예약 버튼 제안
        const deptMatch = text.match(/피부과|내과|외과|정형외과|신경외과|산부인과|소아청소년과|비뇨의학과|안과|이비인후과|재활의학과|가정의학과|응급의학과/);
        const uiDirective = deptMatch ? {
          type: 'QUICK_REPLIES',
          payload: [
            { label: `${deptMatch[0]} 예약`, value: `${deptMatch[0]} 예약하고 싶어요`, icon: '📅' },
            { label: '다른 질문', value: '다른 질문이 있어요', icon: '💬' },
          ],
        } : undefined;

        return { response: text, uiDirective };
      }
    } catch (e) {
      this.logger.warn(`handleGeneralQuestion chatWithSession failed: ${(e as Error).message}`);
    }

    return null;
  }

  /**
   * 🔴 (2026-09-14) 주차·식당·장례식장·층별 안내는 **CMS(HospitalInfoContent) 공개 행만** 말한다 — 3상태.
   *    종전 규칙 응답은 '지하 B1~B3 320대'·'구내식당 한우리'·'카페 메디치노'·'빈소 5실 1,200,000원/일'·장례식장 `02-1234-5670`
   *    같은 **코드 상수**를 환자에게 말했다(P15 — 지어낸 전화번호 포함). CMS 에 PARKING/DINING/FUNERAL/FACILITY 카테고리가
   *    이미 있는데 이 경로만 그 정본을 지나지 않았다(P12). 기획 `hospital-identity-canon.plan.md` §3 "내리는 쪽이 기본".
   *    - FOUND: 공개 조건 정본(`HospitalInfoService.publicVisibilityWhere` — 발행·활성·휴지통 아님·발행창)을 통과한 행의 제목·본문
   *    - NONE : "등록된 안내가 없습니다" — 값을 지어내지 않는다
   *    - FAILED: "지금 불러오지 못했습니다" — 조회 실패를 '없음'으로 번역하지 않는다(로그)
   *    머리말은 정적 문장, 본문은 기관이 CMS 에 쓴 텍스트 그대로다(서버가 값을 끼워 문장을 만들지 않는다).
   */
  private async cmsGuide(category: 'PARKING' | 'DINING' | 'FUNERAL' | 'FACILITY'): Promise<{ state: 'FOUND'; text: string } | { state: 'NONE' } | { state: 'FAILED' }> {
    try {
      const rows = await this.prisma.hospitalInfoContent.findMany({
        where: { ...HospitalInfoService.publicVisibilityWhere(new Date()), category },
        select: { title: true, content: true },
        orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }],
        take: 5,
      });
      if (!rows.length) return { state: 'NONE' };
      return { state: 'FOUND', text: rows.map((r) => ['■ ' + r.title, r.content].join('\n')).join('\n\n') };
    } catch (err) {
      this.logger.warn(`hospital info CMS lookup failed (${category}): ${err instanceof Error ? err.message : String(err)}`);
      return { state: 'FAILED' };
    }
  }

  private static readonly CMS_GUIDE_TITLE: Record<'PARKING' | 'DINING' | 'FUNERAL' | 'FACILITY', string> = {
    PARKING: '🅿️ 주차 안내',
    DINING: '🍽️ 원내 식당·편의시설 안내',
    FUNERAL: '🕊️ 장례식장 안내',
    FACILITY: '🏥 층별 시설 안내',
  };
  private static readonly VISITING_NONE = '👥 면회 안내\n\n원내에 등록된 면회 안내가 없어 면회 시간을 알려드릴 수 없습니다. 병동 또는 대표전화로 확인해 주세요.';
  private static readonly CMS_GUIDE_NONE = '원내에 등록된 안내가 없습니다. 원무과 또는 대표전화로 확인해 주세요.';
  private static readonly CMS_GUIDE_FAILED = '안내 정보를 지금 불러오지 못했습니다. 잠시 후 다시 물어보시거나 원무과 또는 대표전화로 확인해 주세요.';

  private async cmsGuideResponse(category: 'PARKING' | 'DINING' | 'FUNERAL' | 'FACILITY'): Promise<string> {
    const r = await this.cmsGuide(category);
    const body = r.state === 'FOUND' ? r.text : r.state === 'NONE' ? AgentSessionService.CMS_GUIDE_NONE : AgentSessionService.CMS_GUIDE_FAILED;
    return [AgentSessionService.CMS_GUIDE_TITLE[category], body].join('\n\n');
  }

  private async handleFacilityQuestion(input: string, ctx: any): Promise<{ response: string; skipOrchestrator?: boolean; uiDirective?: any } | null> {
    const t = input.trim().toLowerCase();

    // 1. 패턴 매칭으로 검색 태그 결정
    let matchedTags: string[] = [];
    for (const { pattern, tags } of AgentSessionService.INFO_PATTERNS) {
      if (pattern.test(t)) { matchedTags = tags; break; }
    }
    if (matchedTags.length === 0) return null;

    // 2. DB에서 태그 매칭 콘텐츠 조회
    const now = new Date();
    const results = await this.prisma.hospitalInfoContent.findMany({
      // 🔴 (2026-09-14) 공개 조건 정본 — 종전엔 isActive+발행창만 봐 DRAFT·ARCHIVED·휴지통 글이 환자 챗에 샜다(W9 와 같은 결함)
      where: {
        ...HospitalInfoService.publicVisibilityWhere(now),
        tags: { hasSome: matchedTags },
      },
      orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }],
      take: 5,
    });

    if (results.length === 0) return null; // DB에 없으면 기존 흐름으로

    // 3. 응답 포매팅
    let response: string;
    if (results.length === 1) {
      response = results[0].content;
    } else {
      // 여러 건이면 합산 (DINING 등)
      response = results.map(r => r.content).join('\n\n━━━━━━━━━━\n\n');
    }
    response += '\n\n예약을 원하시면 이름이나 등록번호를 알려주세요.';

    // 4. 의사 소개 질문이면 DB에서 의사 목록 추가
    if (matchedTags.includes('의사') || matchedTags.includes('진료과')) {
      const doctors = await this.prisma.user.findMany({
        where: { role: 'DOCTOR', isActive: true },
        select: { familyName: true, givenName: true, department: true, specialty: true },
        distinct: ['department'],
        take: 20,
      });
      if (doctors.length > 0) {
        const deptMap: Record<string, string[]> = {};
        doctors.forEach(d => {
          const dept = d.department ?? '기타';
          if (!deptMap[dept]) deptMap[dept] = [];
          deptMap[dept].push(`${d.familyName}${d.givenName}${d.specialty ? '(' + d.specialty + ')' : ''}`);
        });
        response += '\n\n📋 진료과별 의사:\n' + Object.entries(deptMap).map(([dept, drs]) => `• ${dept}: ${drs.join(', ')}`).join('\n');
      }
    }

    return {
      response,
      skipOrchestrator: true,
      uiDirective: results.length > 1 ? {
        type: 'QUICK_REPLIES',
        payload: [
          { label: '예약하기', value: '예약하고 싶어요', icon: '📅' },
          { label: '시설 안내', value: '편의시설 안내해줘', icon: '🏢' },
          { label: '식당 메뉴', value: '식당 메뉴 알려줘', icon: '🍽️' },
        ],
      } : undefined,
    };
  }
}
