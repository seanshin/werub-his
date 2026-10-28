import { Injectable, NotFoundException, UnauthorizedException, Optional, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';
import { readHospitalFacts, formatHospitalContext, hospitalHoursLines, type HospitalFacts } from '../config/config-runtime.service';

// ── 타입 정의 ──

type DataType = 'ENCOUNTER' | 'LAB_RESULT' | 'MEDICATION' | 'APPOINTMENT' | 'BILLING' | 'VITAL' | 'ADMISSION';

interface ActionSuggestion {
  type: 'BOOK' | 'CALL' | 'INFO' | 'LOGIN' | 'PORTAL';
  label: string;
  department?: string;
}

/**
 * 🔴 출처 3상태(2026-09-09 P0-C R7) — 정본 어휘는 AI 스킬 계약(`medical-ai/ai-verify.ts`)과 같다.
 *   · `AI`       — LLM 이 실제로 답했다
 *   · `FALLBACK` — LLM 이 답하지 않아 **규칙**이 답했다(=AI 답변이 아니다) / 규칙 안전 안내(응급·상담원 연결)
 *   · `UNAVAILABLE` — 답할 수 없었다
 * 원 결함: LLM 2단(12b→4b)이 모두 실패하면 `keywordFallback` 이 규칙 문구를 돌려주는데, 응답에 그 사실이
 *   없어 **화면이 규칙 응답을 AI 답변으로 그렸다**. 환자에게 나가는 말이라 더 위험하다.
 */
type ConciergeSource = 'AI' | 'FALLBACK' | 'UNAVAILABLE';
/**
 * `LLM_UNAVAILABLE` = 모델 전부 실패(규칙이 대신 답했다)
 * `RULE_SAFETY`     = 응급·상담원 연결 — LLM 이전에 결정론 규칙이 답한다(실패가 아니라 설계다)
 * `RULE_NO_INPUT`   = 입력이 비어 LLM 을 부르지 않았다
 */
type ConciergeReason = 'LLM_UNAVAILABLE' | 'RULE_SAFETY' | 'RULE_NO_INPUT';

interface LLMParsedResponse {
  message: string;
  track: 'A' | 'B' | 'C';
  dataNeeded: DataType[];
  actions: ActionSuggestion[];
  source: ConciergeSource;
  reason?: ConciergeReason;
}

interface DataCard {
  type: DataType;
  title: string;
  items: Record<string, unknown>[];
}

const EMERGENCY_PATTERNS = [
  /흉통|가슴.*통증|가슴.*아파|심장.*아파/,
  /호흡.*곤란|숨.*못.*쉬|숨이.*안/,
  /의식.*잃|기절|쓰러/,
  /대량.*출혈|피.*많이|피.*멈추지.*않/,
  /자살|죽고.*싶|목.*매/,
  /경련|발작/,
  /얼굴.*마비|말.*어눌|팔.*못.*움직/,
];

const ESCALATION_PATTERN = /사람.*연결|전화.*연결|상담원|직접.*상담|전화.*해|콜백|인간.*상담/;

/**
 * 🔴 컨시어지 시스템 프롬프트 — 병원 정체(이름·주소·전화·진료시간)는 **정본 system_configs `hospital.*` 의 DB 행**에서.
 *    종전엔 상수 문자열에 박혀 있었고, 진료시간 '평일 09:00~18:00' 은 CMS 정본(평일 ~17:30)과 어긋난 채
 *    환자에게 사실로 나갔다. 미설정 항목은 `formatHospitalContext` 가 "확인되지 않음"으로 밝히고,
 *    모델에게 그 자리를 추측하지 말라고 지시한다(시간을 지어내지 않는다).
 *    남은 상수(서울사무소·응급실 직통·진료과 목록)는 API 쪽 정본 키가 없다 — 사람 결정 전까지 그대로 둔다.
 */
export function buildConciergeSystemPrompt(facts: HospitalFacts): string {
  return `당신은 ${facts['hospital.name'] ?? '이 병원'}의 AI 컨시어지입니다.

[역할]
- 환자의 질문에 정확하고 친절하게 한국어로 답변합니다.
- 증상 문의 시 해당 진료과를 안내하고, 예약을 제안합니다.
- 검사/투약/비용 등 개인 데이터가 필요하면 dataNeeded에 명시합니다.

[의료 안전 원칙]
- 진단/처방은 하지 않습니다. "담당 의사와 상담하세요"로 안내합니다.
- 모든 의료 정보에 "참고용이며 전문의 상담을 권장합니다"를 포함합니다.

[병원 정보 — 기관 설정에서 읽은 값]
${formatHospitalContext(facts)}
- 서울사무소: 가상구 가상로 1 가상빌딩 5층
- 응급실 직통: 02-000-0119
- 진료과: 내과, 외과, 정형외과, 신경외과, 산부인과, 소아청소년과, 피부과, 비뇨의학과, 안과, 이비인후과, 재활의학과, 영상의학과, 마취통증의학과, 응급의학과, 가정의학과
- 위 병원 정보에 없는 사항(진료시간 등)은 추측해 말하지 않습니다. "확인되지 않는다"고 말하고 대표전화 문의를 안내합니다.

[대화 스타일]
- 환자 이름(~님)을 자연스럽게 사용합니다 (이름이 주어진 경우).
- 존댓말을 쓰되 딱딱하지 않게 합니다. "확인해 드릴게요" O, "확인하겠습니다" X
- 한 번에 너무 많은 정보를 주지 않습니다. 핵심 후 "더 궁금하시면 말씀해주세요."
- 환자가 불안/걱정을 표현하면 먼저 공감한 후 정보를 제공합니다.
- 모호한 질문에는 추측하지 말고, 구체적 선택지(2~3개)로 되물으세요.
- "응", "네" 같은 단답은 이전 제안의 확인으로 해석합니다.
- 주제가 바뀌면 새 주제에 답하면서 이전 주제와 연결 가능하면 자연스럽게 연결합니다.

[Track 판정 규칙 — 반드시 따르세요]
- Track A (일반 의료 지식): 환자 개인 데이터 없이 답변 가능. dataNeeded를 빈 배열로.
  예: "무좀 어디로?", "MRI가 뭐야?", "고혈압 관리법", "진료시간?"
- Track B (병원 내부 데이터): 환자 본인의 HIS 데이터가 필요.
  예: "내 검사결과", "다음 예약", "먹는 약", "수납 내역"
- Track C (하이브리드): 일반 지식 답변 + 본인 데이터로 보강하면 더 유용.
  예: "콜레스테롤이 높다는데 어떡해?", "이 약 부작용?"

[dataNeeded 항목]
ENCOUNTER, LAB_RESULT, MEDICATION, APPOINTMENT, BILLING, VITAL, ADMISSION

[actions 항목]
- type: BOOK(예약), CALL(전화), INFO(병원안내), LOGIN(로그인유도), PORTAL(포털이동)
- label: 버튼 텍스트
- department: 진료과명 (BOOK 시)

[응답 형식]
1. 먼저 질문에 대한 충분하고 자연스러운 답변을 작성합니다.
2. 마지막 줄에 반드시 아래 JSON 블록을 추가합니다:
{"track":"A","dataNeeded":[],"actions":[]}`;
}

@Injectable()
export class ConciergeService {
  private readonly logger = new Logger(ConciergeService.name);
  private readonly sessionTimeoutMs = 30 * 60 * 1000; // 30분
  private readonly llmModel: string;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly aiService?: MedicalAiService,
  ) {
    this.llmModel = process.env.CONCIERGE_LLM_MODEL || 'gemma3:12b';
  }

  /**
   * 🔴 (2026-09-21 외부 점검) 종전 이 클라이언트만 `process.env.MEDICAL_AI_URL` 을 보고 **Authorization 없이**
   *    `/api/generate` 를 불렀다. 상류가 Bearer 를 요구하면 **늘 401 → 늘 키워드 폴백**(`LLM_UNAVAILABLE`)이었고
   *    환자는 AI 가 답한 줄 알았다. 설정 다이얼(`ai.server.url`)이 이 경로에는 닿지도 않았다.
   *    → 접속 정본은 의료 AI 서비스 **하나**(`resolveAiServerTarget`: `ai.server.url` 은 `configEnvOverride` 를 지나고
   *      인증은 `ai.server.apiKey`/`gpuKey` 규약). 여기서 DB 나 환경변수를 다시 읽지 않는다(정본이 둘이면 갈라진다).
   *    정본이 주입되지 않았거나 kill switch 가 꺼져 있거나 주소가 비어 있으면 LLM 을 부르지 않는다 —
   *    규칙이 답하고 그 사실(`FALLBACK`/`LLM_UNAVAILABLE`)을 남긴다.
   */
  private async resolveLlmTarget(): Promise<{ url: string; headers: Record<string, string> } | null> {
    if (!this.aiService) {
      this.logger.warn('컨시어지 LLM 비활성 — 의료 AI 서비스가 주입되지 않았다');
      return null;
    }
    try {
      const t = await this.aiService.resolveAiServerTarget();
      if (!t.enabled) { this.logger.warn('컨시어지 LLM 비활성 — ai.server.enabled=false'); return null; }
      if (!t.url) { this.logger.warn('컨시어지 LLM 비활성 — ai.server.url 미설정'); return null; }
      return { url: t.url, headers: { 'Content-Type': 'application/json', ...t.headers } };
    } catch (e) {
      this.logger.warn(`컨시어지 LLM 접속 정본 조회 실패: ${(e as Error).message}`);
      return null;
    }
  }

  // ═══════════════════════════════════════
  //  인증 & 세션
  // ═══════════════════════════════════════

  /**
   * 공개(무인증) 환자 본인 인증 — MRN + 생년월일.
   *
   * 🔴 (2026-09-16 H1) 종전엔 `crypto.randomBytes(32)` 로 만든 `token` 과 24시간 뒤 `expiresAt` 을
   *    돌려줬는데 **어디에도 저장하지 않았다** — ConciergeSession 에 토큰 컬럼이 없다(schema 실측).
   *    아무것도 인증하지 않는 값을 자격증명 모양으로 내주고 있었다(있지도 않은 것을 지어내지 않는다).
   *    저장할 곳이 없으므로 **만들지 않는다** — 실재하는 식별자(sessionId)만 돌려주고,
   *    베어러 토큰을 발급하지 않는다는 사실을 응답이 말한다.
   * 🔴 입력은 DTO 로 검증한다(개별 `@Body(key)` 는 ValidationPipe 를 건너뛰어 연산자 주입이 통했다).
   */
  async authenticatePatient(mrn: string, dateOfBirth: string) {
    // 방어적 재확인 — 서비스가 컨트롤러 밖(테스트·다른 호출부)에서 불릴 때도 연산자 주입을 막는다
    if (typeof mrn !== 'string' || typeof dateOfBirth !== 'string') {
      throw new UnauthorizedException('등록번호 또는 생년월일이 일치하지 않습니다.');
    }
    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) throw new UnauthorizedException('등록번호 또는 생년월일이 일치하지 않습니다.');

    const patient = await this.prisma.patient.findFirst({
      where: { mrn, dateOfBirth: dob },
      select: { id: true, familyName: true, givenName: true },
    });
    if (!patient) throw new UnauthorizedException('등록번호 또는 생년월일이 일치하지 않습니다.');

    // 성공마다 새 세션을 만들지 않는다(무인증 쓰기 누적) — 활성 세션이 있으면 그것을 쓴다
    const existing = await this.prisma.conciergeSession.findFirst({
      where: { patientId: patient.id, status: 'ACTIVE' },
      select: { id: true },
    });
    const session = existing ?? (await this.prisma.conciergeSession.create({
      data: { patientId: patient.id, status: 'ACTIVE' },
      select: { id: true },
    }));

    return {
      sessionId: session.id,
      patientId: patient.id,
      patientName: `${patient.familyName}${patient.givenName}`,
      // 베어러 토큰은 발급하지 않는다(저장·검증할 원장이 없다) — 후속 호출은 세션 id 로 한다
      token: null,
      tokenReason: 'NOT_ISSUED_NO_LEDGER' as const,
    };
  }

  async createSession(patientId: string) {
    const existing = await this.prisma.conciergeSession.findFirst({
      where: { patientId, status: 'ACTIVE' },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
    });
    if (existing) return existing;
    return this.prisma.conciergeSession.create({ data: { patientId }, include: { messages: true } });
  }

  async closeSession(sessionId: string, patientId: string) {
    return this.prisma.conciergeSession.updateMany({
      where: { id: sessionId, patientId, status: 'ACTIVE' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }

  async rateSession(sessionId: string, patientId: string, rating: number, comment?: string) {
    if (rating < 1 || rating > 5) throw new NotFoundException('평점은 1~5 범위입니다.');
    return this.prisma.conciergeSession.updateMany({
      where: { id: sessionId, patientId },
      data: { rating, ratingComment: comment },
    });
  }

  async getRatingStats() {
    const sessions = await this.prisma.conciergeSession.findMany({
      where: { rating: { not: null } },
      select: { rating: true },
    });
    /**
     * 🔴 (2026-09-16 I4) 평가가 한 건도 없을 때 `average: 0` 을 돌려줬다 — 척도가 1~5 라
     *    **0 은 어떤 실제 평가보다도 나쁜 값**이고, 화면은 "만족도 0점"(최악)으로 그린다.
     *    표본 부재는 `null`(산출 불가)이다. 분포는 빈 객체가 아니라 0 채움을 유지해 화면 축이 안 무너지게 한다.
     */
    if (sessions.length === 0) {
      return {
        average: null,
        count: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        unavailableReason: '평가가 아직 없습니다(표본 0) — 평균을 산출할 수 없습니다',
      };
    }
    const total = sessions.reduce((s, r) => s + (r.rating ?? 0), 0);
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    sessions.forEach(s => { if (s.rating) distribution[s.rating] = (distribution[s.rating] ?? 0) + 1; });
    return {
      average: +(total / sessions.length).toFixed(1),
      count: sessions.length,
      distribution,
      unavailableReason: null,
    };
  }

  // ═══════════════════════════════════════
  //  v2.0 LLM-First 메시지 처리
  // ═══════════════════════════════════════

  async sendMessage(sessionId: string, patientId: string, content: string) {
    const session = await this.prisma.conciergeSession.findFirst({
      where: { id: sessionId, patientId, status: 'ACTIVE' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다.');

    // 세션 만료 체크
    const lastActive = session.lastActiveAt ?? session.startedAt;
    if (Date.now() - new Date(lastActive).getTime() > this.sessionTimeoutMs) {
      await this.prisma.conciergeSession.update({
        where: { id: sessionId },
        data: { status: 'EXPIRED', closedAt: new Date() },
      });
      throw new NotFoundException('세션이 만료되었습니다. 새로 시작해주세요.');
    }

    // Step 0: 응급 감지 (LLM 이전)
    if (EMERGENCY_PATTERNS.some(p => p.test(content))) {
      return this.saveAndReturn(sessionId, content, 'EMERGENCY',
        '🚨 응급 상황이 의심됩니다.\n\n지금 바로 아래로 연락해주세요:\n• 119 (응급전화)\n• 02-000-0119 (병원 응급실 직통)\n\n응급실은 24시간 운영됩니다. 즉시 도움을 받으실 수 있습니다.',
        null, [{ type: 'CALL', label: '119 응급전화' }, { type: 'CALL', label: '응급실 02-000-0119' }],
        // LLM 을 부르기 전의 결정론 안전 규칙 — AI 답변이 아니다
        { source: 'FALLBACK', reason: 'RULE_SAFETY' },
      );
    }

    // 에스컬레이션 감지
    // 🔴 대표전화·평일 진료시간은 정본(hospital.* DB 행) — 종전 '(평일 09:00~18:00)' 은 CMS 정본과 어긋난 상수였다.
    //    진료시간이 미설정이면 괄호째 싣지 않는다(지어내지 않는다). 응급실 직통은 API 정본 키가 없어 상수로 남는다.
    if (ESCALATION_PATTERN.test(content)) {
      const facts = await readHospitalFacts(this.prisma);
      const phone = facts['hospital.phone'];
      const weekday = facts['hospital.hours.weekday'];
      return this.saveAndReturn(sessionId, content, 'ESCALATION',
        `네, 상담원 연결을 도와드릴게요.\n\n• 대표전화: ${phone ?? '확인되지 않음(기관 설정 없음)'}${phone && weekday ? ` (평일 ${weekday})` : ''}\n• 응급: 24시간 02-000-0119\n\n전화 연결이 어려우시면 콜백을 요청해 주세요.`,
        null, phone ? [{ type: 'CALL', label: `전화 연결 ${phone}` }] : [],
        { source: 'FALLBACK', reason: 'RULE_SAFETY' },
      );
    }

    // 대화 히스토리 구성 (최신→오래된 → 뒤집기)
    const history = [...session.messages].reverse();
    const conversationForLLM = this.buildConversationHistory(history);
    const patientName = await this.getPatientName(patientId);

    // Step 1: LLM 호출 (자연어 응답 + Track 판정 동시)
    const parsed = await this.callLLM(content, conversationForLLM, patientName);

    // 환자 메시지 저장
    await this.prisma.conciergeMessage.create({
      data: { sessionId, role: 'patient', content, intent: parsed.track },
    });

    // Step 2: Track 분기
    let dataCards: DataCard[] = [];
    let finalMessage = parsed.message;
    let finalActions = parsed.actions;

    if ((parsed.track === 'B' || parsed.track === 'C') && parsed.dataNeeded.length > 0) {
      // Step 3: DB 데이터 조회
      dataCards = await this.fetchDataCards(patientId, parsed.dataNeeded);

      if (dataCards.length === 0 && parsed.track === 'B') {
        // 데이터 없음 → LLM 응답에 안내 추가
        finalMessage += '\n\n조회된 데이터가 없습니다. 아직 해당 기록이 등록되지 않았을 수 있어요.';
      }

      // Step 5: Track C — 데이터 기반 2차 해석 (선택)
      if (parsed.track === 'C' && dataCards.length > 0) {
        const supplement = await this.interpretData(content, parsed.message, dataCards);
        if (supplement) finalMessage += '\n\n' + supplement;
      }
    }

    // 인텐트 추출 (로깅용)
    const intent = this.extractIntent(parsed);

    // AI 응답 저장 + 반환
    // 🔴 출처를 함께 싣는다 — LLM 2단이 모두 실패해 규칙(keywordFallback)이 답한 건을 "AI 답변"으로 그리지 않게.
    const richData: Record<string, unknown> = {
      ...(dataCards.length > 0 ? { dataCards } : {}),
      ...(finalActions.length > 0 ? { actions: finalActions } : {}),
      source: parsed.source,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    };
    const agentMsg = await this.prisma.conciergeMessage.create({
      data: {
        sessionId, role: 'agent', content: finalMessage, intent,
        richData: JSON.parse(JSON.stringify(richData)),
      },
    });

    await this.prisma.conciergeSession.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } });
    return { ...agentMsg, source: parsed.source, reason: parsed.reason ?? null };
  }

  // ═══════════════════════════════════════
  //  LLM 호출
  // ═══════════════════════════════════════

  private async callLLM(
    message: string,
    conversationHistory: string,
    patientName?: string,
  ): Promise<LLMParsedResponse> {
    const contextLine = patientName ? `\n[환자 이름: ${patientName}님]` : '';
    // 병원 정체는 매 호출 정본에서 — 한 번 읽어 프롬프트와 키워드 폴백이 같은 사실을 쓴다
    const facts = await readHospitalFacts(this.prisma);
    const prompt = `${buildConciergeSystemPrompt(facts)}${contextLine}\n\n${conversationHistory}\n환자: ${message}\n\nAI 컨시어지:`;

    // 계층형 폴백: 12b → 4b → 키워드. 접속 정본이 없으면(미주입·kill switch·주소 없음) 모델을 부르지 않는다.
    const target = await this.resolveLlmTarget();
    const models = target ? [this.llmModel, 'gemma3:4b'] : [];
    for (const model of models) {
      try {
        // G3: 목적지 검증 + 경계 통과 감사(정본 common/util/ai-egress-fetch). 인증 헤더는 정본.
        const response = await aiEgressFetch(target!.url, '/api/generate', {
          method: 'POST',
          headers: target!.headers,
          body: JSON.stringify({ model, prompt, stream: false }),
          signal: AbortSignal.timeout(model === 'gemma3:4b' ? 8000 : 15000),
        }, { client: 'concierge' });
        if (!response.ok) {
          // 🔴 401/403 은 "모델이 답하지 않았다"가 아니라 **키가 거부된 것**이다 — 더 작은 모델로 재시도해도 안 풀린다.
          //    C24 의 증상이 정확히 이것이었다: 늘 폴백인데 로그에 사유가 없었다.
          if (response.status === 401 || response.status === 403) {
            this.logger.warn(`LLM 인증 거부(HTTP ${response.status}) — ai.server.gpuKey/apiKey 확인 필요`);
            break;
          }
          this.logger.warn(`LLM ${model} 응답 실패(HTTP ${response.status})`);
          continue;
        }

        const result = await response.json() as { response?: string };
        const raw = result.response ?? '';
        if (raw.length > 10) return this.parseLLMResponse(raw);
      } catch (e) {
        this.logger.warn(`LLM ${model} failed: ${(e as Error).message}`);
      }
    }

    // 최종 폴백: 키워드 기반 (v1.0 로직)
    this.logger.warn('All LLM models failed — falling back to keyword matching');
    return this.keywordFallback(message, facts);
  }

  private parseLLMResponse(raw: string): LLMParsedResponse {
    // JSON 블록 추출 (마지막 {...} 찾기)
    const jsonMatch = raw.match(/\{[^{}]*"track"[^{}]*\}[^{}]*$/s)
      ?? raw.match(/\{[^{}]*"dataNeeded"[^{}]*\}/s)
      ?? raw.match(/```json\s*(\{[\s\S]*?\})\s*```/);

    let track: 'A' | 'B' | 'C' = 'A';
    let dataNeeded: DataType[] = [];
    let actions: ActionSuggestion[] = [];
    let message = raw;

    if (jsonMatch) {
      try {
        const jsonStr = jsonMatch[1] ?? jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        track = (['A', 'B', 'C'].includes(parsed.track) ? parsed.track : 'A') as 'A' | 'B' | 'C';
        dataNeeded = Array.isArray(parsed.dataNeeded) ? parsed.dataNeeded.filter(this.isValidDataType) : [];
        actions = Array.isArray(parsed.actions) ? parsed.actions : [];
        // JSON 부분 제거 → 순수 메시지
        message = raw.slice(0, raw.indexOf(jsonMatch[0])).trim();
        // ```json ... ``` 블록도 제거
        message = message.replace(/```json[\s\S]*?```/g, '').trim();
      } catch {
        // JSON 파싱 실패 → Track A 폴백
        message = raw.replace(/\{[\s\S]*\}$/s, '').trim();
      }
    }

    // 빈 메시지 방지
    if (!message || message.length < 5) {
      message = '궁금하신 점이 있으시면 편하게 말씀해주세요. 예약, 검사 결과, 복용약, 병원 안내 등을 도와드릴 수 있어요.';
    }

    return { message, track, dataNeeded, actions, source: 'AI' };
  }

  private isValidDataType(t: string): t is DataType {
    return ['ENCOUNTER', 'LAB_RESULT', 'MEDICATION', 'APPOINTMENT', 'BILLING', 'VITAL', 'ADMISSION'].includes(t);
  }

  // ═══════════════════════════════════════
  //  키워드 폴백 (v1.0 호환)
  // ═══════════════════════════════════════

  private keywordFallback(message: string, facts: HospitalFacts): LLMParsedResponse {
    const msg = message.toLowerCase();
    const patterns: [RegExp, DataType, string][] = [
      [/내 예약|예약 확인|다음 예약|예약.*있나/, 'APPOINTMENT', 'BOOKING'],
      [/진료.?(?:이력|기록|내역)|지난.?진료/, 'ENCOUNTER', 'HISTORY'],
      [/검사.?결과|혈액.?검사|피검사|수치/, 'LAB_RESULT', 'LAB_RESULT'],
      [/복용.?약|처방.?약|먹는.?약|투약/, 'MEDICATION', 'MEDICATION'],
      [/비용|수납|진료비|영수증|미수납/, 'BILLING', 'BILLING'],
      [/혈압|맥박|체온|바이탈|체중/, 'VITAL', 'VITAL'],
      [/입원.?정보|병실|주치의|퇴원/, 'ADMISSION', 'ADMISSION'],
    ];

    for (const [pattern, dataType] of patterns) {
      if (pattern.test(msg)) {
        return {
          message: '확인해 드릴게요.',
          track: 'B',
          dataNeeded: [dataType],
          actions: [],
          source: 'FALLBACK',
          reason: 'LLM_UNAVAILABLE',
        };
      }
    }

    // 병원 안내 — 이름·진료시간·주소·대표전화는 정본(hospital.* DB 행). 미설정은 "확인되지 않음"(지어내지 않는다)
    //    🔴 주차·면회시간 줄은 API 쪽 정본 키가 없는 상수다 — 사람 결정 전까지 그대로 둔다(보고 목록)
    if (/진료.?시간|오시는.?길|주차|면회|위치|전화|병원.?안내/.test(msg)) {
      const hours = hospitalHoursLines(facts);
      const phone = facts['hospital.phone'];
      return {
        message: `🏥 ${facts['hospital.name'] ?? '병원'} 안내\n\n• 진료시간: ${hours.length ? hours.join(' / ') : '확인되지 않음(기관 설정 없음)'}\n• 주소: ${facts['hospital.address'] ?? '확인되지 않음'}\n• 대표전화: ${phone ?? '확인되지 않음'}\n• 주차: 병원 주차장 무료\n• 면회시간: 18:00~20:00`,
        track: 'A',
        dataNeeded: [],
        actions: phone ? [{ type: 'CALL', label: `전화 ${phone}` }] : [],
        source: 'FALLBACK',
        reason: 'LLM_UNAVAILABLE',
      };
    }

    return {
      message: `안녕하세요! ${facts['hospital.name'] ? `${facts['hospital.name']} ` : ''}AI 컨시어지입니다.\n\n도와드릴 수 있는 것들이에요:\n• 증상에 맞는 진료과 안내\n• 예약 확인/변경\n• 검사 결과, 복용약 확인\n• 진료비 내역\n• 병원 안내 (진료시간, 오시는 길)\n\n궁금하신 점을 편하게 말씀해주세요.`,
      track: 'A',
      dataNeeded: [],
      actions: [],
      source: 'FALLBACK',
      reason: 'LLM_UNAVAILABLE',
    };
  }

  // ═══════════════════════════════════════
  //  DB 데이터 조회 + 카드 생성
  // ═══════════════════════════════════════

  private async fetchDataCards(patientId: string, dataNeeded: DataType[]): Promise<DataCard[]> {
    const cards: DataCard[] = [];

    const fetchers: Record<DataType, () => Promise<DataCard | null>> = {
      ENCOUNTER: async () => {
        const items = await this.getEncounters(patientId);
        return items.length ? { type: 'ENCOUNTER', title: '📋 진료 이력', items: items as unknown as Record<string, unknown>[] } : null;
      },
      LAB_RESULT: async () => {
        const items = await this.getLabResults(patientId);
        return items.length ? { type: 'LAB_RESULT', title: '🔬 검사 결과', items: items as unknown as Record<string, unknown>[] } : null;
      },
      MEDICATION: async () => {
        const items = await this.getMedications(patientId);
        return items.length ? { type: 'MEDICATION', title: '💊 현재 복용약', items: items as unknown as Record<string, unknown>[] } : null;
      },
      APPOINTMENT: async () => {
        const items = await this.getAppointments(patientId);
        return items.length ? { type: 'APPOINTMENT', title: '📅 예약 현황', items: items as unknown as Record<string, unknown>[] } : null;
      },
      BILLING: async () => {
        const items = await this.getBillings(patientId);
        return items.length ? { type: 'BILLING', title: '💰 수납 내역', items: items as unknown as Record<string, unknown>[] } : null;
      },
      VITAL: async () => {
        const items = await this.getVitals(patientId);
        return items.length ? { type: 'VITAL', title: '📊 바이탈', items: items as unknown as Record<string, unknown>[] } : null;
      },
      ADMISSION: async () => {
        const item = await this.getAdmissionInfo(patientId);
        return item ? { type: 'ADMISSION', title: '🏨 입원 정보', items: [item as unknown as Record<string, unknown>] } : null;
      },
    };

    const results = await Promise.all(
      dataNeeded.filter(d => fetchers[d]).map(d => fetchers[d]()),
    );
    for (const r of results) { if (r) cards.push(r); }

    return cards;
  }

  // ═══════════════════════════════════════
  //  Track C: 2차 데이터 해석
  // ═══════════════════════════════════════

  private async interpretData(question: string, firstResponse: string, dataCards: DataCard[]): Promise<string | null> {
    const dataSummary = dataCards.map(c => {
      const preview = JSON.stringify(c.items.slice(0, 3)).slice(0, 500);
      return `[${c.title}] ${preview}`;
    }).join('\n');

    const prompt = `이전 질문: "${question}"
이전 답변: "${firstResponse.slice(0, 300)}"

아래는 환자의 실제 데이터입니다:
${dataSummary}

위 데이터를 참고하여, 이전 답변을 보충하는 짧은 설명(2~3문장)을 한국어로 작성하세요.
- 수치가 정상/이상인지 간단히 언급
- "담당 의사와 상담을 권장합니다"로 마무리
- 진단/처방은 하지 마세요`;

    try {
      const target = await this.resolveLlmTarget();
      if (!target) return null;
      // G3: 목적지 검증 + 경계 통과 감사(정본 common/util/ai-egress-fetch). 인증 헤더는 정본.
      const response = await aiEgressFetch(target.url, '/api/generate', {
        method: 'POST',
        headers: target.headers,
        body: JSON.stringify({ model: 'gemma3:4b', prompt, stream: false }),
        signal: AbortSignal.timeout(8000),
      }, { client: 'concierge/data-explain' });
      if (!response.ok) {
        this.logger.warn(`데이터 보충설명 LLM 응답 실패(HTTP ${response.status})`);
        return null;
      }
      const result = await response.json() as { response?: string };
      const text = (result.response ?? '').trim();
      return text.length > 10 ? text : null;
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════
  //  헬퍼
  // ═══════════════════════════════════════

  private buildConversationHistory(history: Array<{ role: string; content: string; intent?: string | null }>): string {
    if (history.length === 0) return '';
    const lines = history.slice(-8).map(m => {
      const role = m.role === 'patient' ? '환자' : 'AI 컨시어지';
      return `${role}: ${m.content.slice(0, 200)}`;
    });
    return '[이전 대화]\n' + lines.join('\n') + '\n';
  }

  private async getPatientName(patientId: string): Promise<string | undefined> {
    const p = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { familyName: true, givenName: true },
    });
    return p ? `${p.familyName}${p.givenName}` : undefined;
  }

  // 예약 상담 챗(스태프 ai-booking) — 세션리스. callLLM 재사용 + BOOK 액션→진료과 제안
  async bookingChat(
    message: string,
    patientId?: string,
    _context?: string,
  ): Promise<{ reply: string; suggestion?: { department?: string; reason?: string }; source: ConciergeSource; originReason: ConciergeReason | null }> {
    if (!message?.trim()) return { reply: '무엇을 도와드릴까요? 증상이나 원하시는 진료과를 말씀해 주세요.', source: 'FALLBACK', originReason: 'RULE_NO_INPUT' };
    const patientName = patientId ? await this.getPatientName(patientId) : undefined;
    const parsed = await this.callLLM(message, '', patientName);
    const book = parsed.actions?.find((a) => a.type === 'BOOK' && a.department);
    return {
      reply: parsed.message,
      suggestion: book ? { department: book.department, reason: book.label } : undefined,
      // 🔴 `suggestion.reason`(진료과 추천 사유)과 이름이 겹치지 않게 `originReason` 으로 낸다
      source: parsed.source,
      originReason: parsed.reason ?? null,
    };
  }

  private extractIntent(parsed: LLMParsedResponse): string {
    if (parsed.dataNeeded.length > 0) return parsed.dataNeeded[0];
    const bookAction = parsed.actions.find(a => a.type === 'BOOK');
    if (bookAction) return 'BOOKING';
    return parsed.track === 'A' ? 'GENERAL' : 'GENERAL';
  }

  /**
   * 🔴 출처는 응답에도, 원장(richData)에도 남긴다 — 나중에 "이 말은 누가 했나"를 되물을 수 있어야 한다.
   *    `origin` 은 필수 인자다(기본값을 두면 새 경로가 조용히 `AI` 로 들어간다).
   */
  private async saveAndReturn(
    sessionId: string, patientContent: string, intent: string,
    agentContent: string, richData: Record<string, unknown> | null,
    actions: ActionSuggestion[] | undefined,
    origin: { source: ConciergeSource; reason?: ConciergeReason },
  ) {
    await this.prisma.conciergeMessage.create({ data: { sessionId, role: 'patient', content: patientContent, intent } });
    const rd = { ...(richData ?? {}), ...(actions ? { actions } : {}), source: origin.source, ...(origin.reason ? { reason: origin.reason } : {}) };
    const agentMsg = await this.prisma.conciergeMessage.create({
      data: { sessionId, role: 'agent', content: agentContent, intent, richData: JSON.parse(JSON.stringify(rd)) },
    });
    await this.prisma.conciergeSession.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } });
    // 응답 계약: 기존 필드는 그대로 두고 출처만 **추가**한다(FE 가 읽지 않아도 깨지지 않게)
    return { ...agentMsg, source: origin.source, reason: origin.reason ?? null };
  }

  // ═══════════════════════════════════════
  //  DB 조회 (기존 유지)
  // ═══════════════════════════════════════

  async getEncounters(patientId: string) {
    return this.prisma.encounter.findMany({
      where: { patientId, status: 'SIGNED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, createdAt: true, chiefComplaint: true, assessment: true, status: true,
        doctor: { select: { familyName: true, givenName: true, department: true } },
        diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } },
      },
    });
  }

  async getLabResults(patientId: string) {
    return this.prisma.labResult.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        items: { select: { testName: true, value: true, unit: true, normalMin: true, normalMax: true, flag: true } },
      },
    });
  }

  async getMedications(patientId: string) {
    return this.prisma.prescription.findMany({
      where: { encounter: { patientId }, type: 'MEDICATION', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, dosage: true, frequency: true, route: true, duration: true, quantity: true, createdAt: true,
        medicationCode: { select: { code: true, nameKo: true, dosageForm: true } },
      },
    });
  }

  async getAppointments(patientId: string) {
    return this.prisma.appointment.findMany({
      where: { patientId, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
      select: {
        id: true, scheduledAt: true, type: true, status: true, reason: true,
        doctor: { select: { familyName: true, givenName: true, department: true } },
      },
    });
  }

  async getBillings(patientId: string) {
    return this.prisma.billing.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, totalAmount: true, patientCopay: true, insuranceCovered: true,
        paidAmount: true, status: true, createdAt: true,
      },
    });
  }

  async getVitals(patientId: string) {
    return this.prisma.preVisitVitals.findMany({
      where: { patientId },
      orderBy: { measuredAt: 'desc' },
      take: 5,
      select: { systolicBp: true, diastolicBp: true, heartRate: true, temperature: true, spo2: true, weight: true, height: true, bmi: true, measuredAt: true },
    });
  }

  async getAdmissionInfo(patientId: string) {
    return this.prisma.admission.findFirst({
      where: { patientId, status: 'ADMITTED' },
      include: {
        bed: { include: { ward: { select: { name: true } } } },
        admittingDoctor: { select: { familyName: true, givenName: true, department: true } },
        attendingDoctor: { select: { familyName: true, givenName: true, department: true } },
      },
    });
  }
}
