import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { adverseDrugBody, complicationBody, normalizePrediction, readmissionBody } from './predict-contract';
import { buildReadmissionContext } from './readmission-context';
import { createHash } from 'node:crypto';
import { AI_CHAT_COMMANDS, AI_CHAT_FREE_METRIC, AI_DEFAULT_DISCLAIMER, ageOf, canUseAiChatCommand, parseAiChatInput, parseAiStreamLine, stayDays, type AiChatContextPayload, type AiChatReason, type AiChatSource } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { configEnvOverride } from '../../common/config-env-overrides';
import { readHospitalConfig } from '../config/hospital-facts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ToolRegistry } from '../orchestrator/tool-registry';
import { OrchestratorEngine } from '../orchestrator/orchestrator-engine';
import { createBuiltinTools } from '../orchestrator/builtin-tools';
import { createEnterpriseTools } from '../orchestrator/enterprise-tools';
import { EgressBlockedError } from '../../common/util/safe-fetch';
import { assertAiServerUrl } from '../../common/util/ai-egress-url';
import { aiEgressFetch, withAiSkill } from '../../common/util/ai-egress-fetch';
import { aiDisabledException, isAiDisabledError, isAiServerEnabled } from '../../common/util/ai-kill-switch';
import { redactIdentifiers } from '../../common/util/ai-phi-redact';
import { unfetchableByExternalAi } from './image-url-reachability';
import { allergyPromptLine, promptList } from './ai-grounding';
import { checkDrugNameScript, checkDrugsResolvable, checkForbiddenAdvice, checkKorean, checkNoMixedScript, checkLabDirection, checkMentionsOnlyProvidedTests, checkNonEmpty, checkSexAgeAppropriate, extractJsonObject, failedSkill, finalizeSkill, textOf, unavailableSkill, type LabFlag } from './ai-verify';
import { AI_QUALITY_SKILLS, judgeSkillQuality, resolveActions, resolveMinAiRate, resolveMinCalls } from '../../common/ai-skill-quality';
import { positiveNumberOr } from '../../common/qi-targets';
import { AllergyService } from '../allergy/allergy.service';
import { PatientBriefService, type PatientBrief } from './patient-brief.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { DurService } from '../prescription/dur/dur.service';
import { resolveEncounterForDur, verdictForRecommendation } from './drug-verdict';
import type { SkillEnvelope } from './ai-verify';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

/**
 * 프롬프트 버전 상수 — 제안 원장(`AiProposal.promptVersion`)이 "어떤 프롬프트가 이 초안을 만들었는가"를
 * 말하기 위한 코드 정본. 선례: `SCRIBE_DRAFT_PROMPT_VERSION_AI|_RULE`(scribe.service.ts).
 * 🔴 프롬프트 문구를 바꾸면 **여기 버전도 함께 올린다** — 안 올리면 원장이 옛 버전을 사실처럼 말한다.
 */
export const AUTO_SOAP_PROMPT_VERSION_AI = 'auto-soap-ai-v1';
/** 규칙/체이닝 폴백(`draft('assessment_plan')`) 경로 — LLM 프롬프트와 다른 산출 경로다(같은 버전으로 세지 않는다) */
export const AUTO_SOAP_PROMPT_VERSION_FALLBACK = 'auto-soap-fallback-v1';
/**
 * 🔴 `writing/craft` 의 **실제 프롬프트는 상류(AI 서버) 안에** 있다 — HIS 는 본문(text)과 style 만 보낸다.
 *    그래서 이 상수는 "프롬프트 문구의 버전"이 아니라 **HIS 가 보내는 요청 계약의 버전**이다.
 *    상류 프롬프트가 바뀌어도 이 값은 변하지 않는다는 사실을 감독 화면이 알아야 한다.
 */
export const WRITING_CRAFT_PROMPT_VERSION = 'writing-craft-request-v1';

/** `medicalAsk` 미가용 사유 어휘 — 코드만(문장 없음). 화면이 카탈로그로 말한다. */
export const MEDICAL_ASK_UNAVAILABLE_REASONS = [
  'AI_UPSTREAM_AUTH', 'AI_SERVER_URL_UNSET', 'AI_EGRESS_BLOCKED', 'AI_DISABLED',
  'AI_UPSTREAM_FAILED', 'AI_UPSTREAM_ERROR', 'AI_REQUEST_FAILED', 'AI_UPSTREAM_BUSY',
] as const;

/**
 * 🔴 같은 키의 의료 생성 요청은 키당 1건씩 처리되고 나머지는 60초까지 대기 — 넘으면
 *    **429 + Retry-After**(종전 502 generation_failed)로 거절된다. 이것은 고장이 아니라 "잠시 후 다시"다.
 *    → `aiFetch` 가 Retry-After 만큼 기다려 **최대 2회** 다시 보낸다. 그래도 바쁘면
 *      `AI_UPSTREAM_BUSY`(HTTP 429)로 올린다 — 500/503("고장")으로 바꿔 말하지 않는다. 502·503 의 뜻은 그대로다.
 */
export const AI_BUSY_MAX_RETRIES = 2;
const AI_BUSY_DEFAULT_WAIT_S = 5;
const AI_BUSY_MAX_WAIT_S = 10;
/** Retry-After(초) → 대기 ms — 못 읽으면 통지 기본 5초 · 1~10초로 자른다(날짜 형식은 쓰지 않는 서버라 초만 읽는다) */
export function aiRetryAfterMs(header: string | null | undefined): number {
  const n = Number(header);
  const s = Number.isFinite(n) && n > 0 ? n : AI_BUSY_DEFAULT_WAIT_S;
  return Math.min(AI_BUSY_MAX_WAIT_S, Math.max(1, s)) * 1000;
}
export type MedicalAskUnavailableReason = (typeof MEDICAL_ASK_UNAVAILABLE_REASONS)[number];
/** 구조화 의료 질의 3상태 — `null` 을 돌려주지 않는다(없는 것과 못 얻은 것을 갈라 말한다) */
export type MedicalAskResult =
  | { source: 'AI'; data: any }
  | { source: 'UNAVAILABLE'; reason: MedicalAskUnavailableReason };

const UUID_FULL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 어시스턴트 응답 봉투 — `source:null` = AI 를 부르지 않았다(이유는 reason) */
export interface AiChatEnvelope {
  cmd: string | null;
  type: string;
  source: AiChatSource | null;
  reason?: AiChatReason;
  /** 상류 실패의 세부 코드(AI_SERVER_URL_UNSET 등) */
  detail?: string;
  draft: boolean;
  data: unknown;
  disclaimer?: string;
  basis?: Record<string, unknown>;
  unknownCommand?: string;
}

@Injectable()
export class MedicalAiService implements OnModuleInit {
  private readonly logger = new Logger(MedicalAiService.name);
  // 🔴 경계 통과 감사 Logger('AiEgressAudit') 는 여기 있지 않다 — 정본 `common/util/ai-egress-fetch`
  //    하나가 남긴다(2026-08-20 수렴). 여기에 다시 만들면 같은 사실에 형식이 둘이 된다.
  private readonly baseUrl: string;
  private medicalKey: string;
  private readonly gpuKey: string;
  private toolRegistry: ToolRegistry;
  private orchestratorEngine: OrchestratorEngine;

  constructor(
    private readonly config: ConfigService,
    private readonly runtimeConfig: ConfigRuntimeService,
    private readonly prisma: PrismaService,
    /** 알레르기 3상태 정본(NKA 문진). 미주입이면 프롬프트는 "조회 불가"라고 말한다 — "없음"으로 접지 않는다. */
    @Optional() private readonly allergyService?: AllergyService,
    /** 배치 A 브리핑(컨텍스트 빌더 정본 · P1). 미주입/실패면 종전 직접 조회로 접는다(같은 값·다른 신선도) */
    @Optional() private readonly briefService?: PatientBriefService,
    /** 실시간 응답 캐시(`ai:skill:<skill>:<입력해시>` · TTL 600s · source AI 만). 없으면 캐시 없음 */
    @Optional() private readonly redis?: RedisService,
    /** DUR 정본 — 약물추천 `durVerdict` 재검증. 미주입이면 null + "재검증 실패"(PASS 를 지어내지 않는다) */
    @Optional() private readonly durService?: DurService,
    /** 계약 드리프트 관측(axis C) — 미주입이면 관측만 조용히 빠진다(임상 경로 영향 없음) */
    @Optional() private readonly drift?: DriftRecorderService,
  ) {
    this.baseUrl = this.config.get<string>('MEDICAL_AI_URL', ''); // P0-6: 하드코딩 기본값 제거 — 실사용은 runtime ai.server.url
    this.medicalKey = this.config.get<string>('MEDICAL_AI_KEY', '');
    this.gpuKey = this.config.get<string>('GPU_API_KEY', '');

    // v3 도구 레지스트리 초기화
    this.toolRegistry = new ToolRegistry();
    const builtinTools = createBuiltinTools(this.prisma, {
      triage: (s) => this.triage(s),
      reference: (q, c) => this.reference(q, c),
      getHospitalContext: () => this.runtimeConfig.getHospitalContext(),
    });
    for (const tool of builtinTools) this.toolRegistry.register(tool);

    // 엔터프라이즈 도구 등록 (경영진/의료진/간호사/약사/행정)
    const enterpriseTools = createEnterpriseTools(this.prisma);
    for (const tool of enterpriseTools) this.toolRegistry.register(tool);

    // v3 엔진 초기화
    this.orchestratorEngine = new OrchestratorEngine(
      this.toolRegistry,
      (msgs, opts) => this.chatLlm(msgs, opts),
    );
  }

  /**
   * 배치 B(야간 LLM 사전 스킬) 해석기 늦은 바인딩 — PatientBriefService ↔ MedicalAiService 는 같은 모듈 안 순환이라
   * 생성자 주입 대신 부팅 후 함수를 붙인다. 실시간 `interpretLab` 과 **같은 함수·같은 검증층**을 쓴다(정본은 하나).
   */
  onModuleInit() {
    this.briefService?.attachLabInterpreter?.((patientId, brief) => this.interpretLab({
      patientId,
      results: brief.recentLabs.map((l) => ({ testName: l.testName, value: l.value, unit: l.unit ?? undefined, flag: l.flag })),
      clinicalContext: '야간 배치 사전해석(브리핑 기준)',
    }));
  }

  /** DB config에서 AI 설정을 런타임으로 읽음 (캐시 30초) */
  private configCache: { url?: string; key?: string; gpuKey?: string; enabled?: boolean; timeoutMs?: number; ts: number } = { ts: 0 };

  /** 타임아웃 정책 — 조회성 15s(ai.server.timeout으로 대체 가능) / LLM 생성형 120s / 스트리밍 180s */
  private readonly llmTimeoutMs = 120_000;
  private readonly streamTimeoutMs = 180_000;

  private async getAiConfig(): Promise<{ url: string; key: string; gpuKey: string; enabled: boolean; timeoutMs?: number }> {
    const now = Date.now();
    if (now - this.configCache.ts < 30000 && this.configCache.url) {
      return {
        url: this.configCache.url,
        key: this.configCache.key ?? '',
        gpuKey: this.configCache.gpuKey ?? '',
        enabled: this.configCache.enabled ?? true,
        timeoutMs: this.configCache.timeoutMs,
      };
    }
    try {
      const configs = await this.prisma.systemConfig.findMany({
        where: { key: { in: ['ai.server.url', 'ai.server.apiKey', 'ai.server.gpuKey', 'ai.server.enabled', 'ai.server.timeout'] } },
      });
      const cfgMap = new Map(configs.map(c => [c.key, c.value]));
      // 🔴 배포 환경변수가 DB 설정을 이긴다 — 정본 `common/config-env-overrides`.
      //    이 자리는 `system_configs` 를 직접 읽으므로 설정 서비스의 덮어쓰기가 닿지 않는다.
      //    한쪽만 고치면 "관리 화면엔 환경변수 값, 실제 전송은 DB 주소"가 된다.
      const url = configEnvOverride('ai.server.url') ?? ((cfgMap.get('ai.server.url') as string) || this.baseUrl);
      const key = (cfgMap.get('ai.server.apiKey') as string) || this.medicalKey;
      const gpuKey = (cfgMap.get('ai.server.gpuKey') as string) || this.gpuKey;
      // kill switch: 명시적 false 만 비활성(기본/미설정=활성)
      const enabledRaw = cfgMap.get('ai.server.enabled');
      const enabled = isAiServerEnabled(enabledRaw); // 정본 common/util/ai-kill-switch
      // 조회성 기본 타임아웃 대체값(ms)
      const timeoutRaw = Number(cfgMap.get('ai.server.timeout'));
      const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined;
      this.configCache = { url, key, gpuKey, enabled, timeoutMs, ts: now };
      return { url, key, gpuKey, enabled, timeoutMs };
    } catch {
      return { url: this.baseUrl, key: this.medicalKey, gpuKey: this.gpuKey, enabled: true };
    }
  }

  /**
   * 🔴 다른 모듈(컨시어지)이 **같은 상류**를 부를 때의 접속 정본 — URL·인증 헤더·kill switch 를 여기서만 푼다.
   *
   * 2026-09-21 외부 점검: 컨시어지가 `process.env.MEDICAL_AI_URL` 만 보고 **Authorization 없이**
   * `/api/generate` 를 불렀다 — 상류가 Bearer 를 요구하면 늘 401 → 늘 키워드 폴백이었고 환자는 AI 가 답한 줄 알았다.
   * 목적지는 `getAiConfig()`(환경변수 덮어쓰기 `configEnvOverride('ai.server.url')` 포함)를 지나고,
   * 인증은 `aiFetch` 와 같은 규약(`X-Medical-Key`=ai.server.apiKey · `Authorization: Bearer`=ai.server.gpuKey)이다.
   * 🔴 키가 비어 있으면 헤더를 붙이지 않는다(빈 Bearer 를 지어내지 않는다) — 401 은 호출부가 사유로 남긴다.
   */
  async resolveAiServerTarget(): Promise<{ url: string; headers: Record<string, string>; enabled: boolean }> {
    const cfg = await this.getAiConfig();
    const headers: Record<string, string> = {};
    if (cfg.key) headers['X-Medical-Key'] = cfg.key;
    if (cfg.gpuKey) headers['Authorization'] = `Bearer ${cfg.gpuKey}`;
    return { url: cfg.url, headers, enabled: cfg.enabled };
  }

  /**
   * AI egress 목적지 검증 — 규약·판단 근거는 `common/util/ai-egress-url.ts`(정본).
   * 여기서는 위반을 **정직한 실패(503)** 로 바꾼다. 빈 결과로 덮지 않는다.
   */
  private assertAiEgressUrl(raw: string): void {
    // 미설정과 '허용되지 않음'은 다른 사실이다 — 화면에 같은 말로 내려보내지 않는다(P0-6 규약).
    if (!raw || !raw.trim()) {
      throw new ServiceUnavailableException({
        code: 'AI_SERVER_URL_UNSET',
        message: 'AI 서버 주소(ai.server.url)가 설정되지 않아 요청을 보내지 않았습니다.',
      });
    }
    try {
      assertAiServerUrl(raw);
    } catch (e) {
      throw this.egressBlocked503(e);
    }
  }

  /** egress 차단(정본 예외) → 사용자에게 정직한 503. 빈 결과·`{}` 로 덮지 않는다. */
  private egressBlocked503(e: unknown): ServiceUnavailableException {
    const reason = e instanceof EgressBlockedError ? e.message : String(e);
    this.logger.error(`AI egress 차단 — ai.server.url 이 안전하지 않습니다: ${reason}`);
    return new ServiceUnavailableException({
      code: 'AI_EGRESS_BLOCKED',
      message: 'AI 서버 주소가 허용되지 않아 요청을 보내지 않았습니다(관리자 확인 필요).',
    });
  }

  /**
   * WeRU.B 공용 AI 클라이언트 — **medical-ai 고유 정책만** 여기서 처리하는 얇은 래퍼.
   *
   * 🔴 2026-08-20 수렴: 실제 전송(목적지 검증 + 경계 통과 감사 + 타임아웃 + raw fetch)은
   *   `common/util/ai-egress-fetch` **정본 하나**가 한다. 이 함수가 남아 있는 이유는
   *   아래 넷이 egress 정책이 아니라 이 모듈의 정책이기 때문이다(정본에 올리면 다른 12곳에 잘못 강요된다):
   *     - kill switch: SystemConfig `ai.server.enabled === false` 면 즉시 차단
   *     - 인증: X-Medical-Key + Authorization Bearer(gpuKey) 병행(notice/DUR 등 Bearer-only EP 401 방지)
   *     - 타임아웃 기본값: 조회성 15s(`ai.server.timeout` 로 대체) / LLM 120s / 스트리밍 180s(호출부 지정)
   *     - 미설정(AI_SERVER_URL_UNSET)과 차단(AI_EGRESS_BLOCKED)을 **다른 사실로** 구분한 503
   *   Response 원본 반환은 그대로 — NDJSON/스트리밍/에러 처리 시맨틱은 호출부 유지.
   */
  private async aiFetch(
    path: string,
    opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<globalThis.Response> {
    const cfg = await this.getAiConfig();
    if (!cfg.enabled) {
      throw aiDisabledException();
    }
    this.assertAiEgressUrl(cfg.url); // 미설정/차단을 여기서 구분(정본은 둘을 구분하지 않는다)
    const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs ?? 15_000;
    const headers: Record<string, string> = { 'X-Medical-Key': cfg.key };
    if (cfg.gpuKey) headers['Authorization'] = `Bearer ${cfg.gpuKey}`;
    let body: string | FormData | undefined;
    if (opts.body !== undefined) {
      if (typeof FormData !== 'undefined' && opts.body instanceof FormData) {
        body = opts.body; // multipart — Content-Type(boundary)은 fetch가 자동 설정
      } else if (typeof opts.body === 'string') {
        headers['Content-Type'] = 'application/json';
        body = opts.body;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
    } else {
      headers['Content-Type'] = 'application/json';
    }
    const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
    // 감사(메타만·PHI 본문 금지)는 정본 안에서 한 형식으로 남는다 — 여기서 또 남기면 형식이 갈라진다.
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await aiEgressFetch(
          cfg.url,
          path,
          { method, headers, ...(body !== undefined ? { body } : {}) },
          { client: 'medical-ai', timeoutMs },
        );
        // 429 = 상류 동시 처리 한도(키당 1건·대기 60초) — Retry-After 만큼 쉬고 다시(최대 2회). 그 밖의 응답은 그대로 호출부로
        if (res.status !== 429 || attempt >= AI_BUSY_MAX_RETRIES) return res;
        const waitMs = aiRetryAfterMs(res.headers.get('retry-after'));
        await res.text().catch(() => ''); // 본문을 비워 연결을 돌려준다(내용은 쓰지 않는다)
        this.logger.warn(`AI busy(429) ${path} — ${waitMs}ms 후 재시도 ${attempt + 1}/${AI_BUSY_MAX_RETRIES}`);
        await this.sleep(waitMs);
      }
    } catch (e) {
      // 위 assertAiEgressUrl 을 통과했으므로 사실상 도달하지 않지만, 정본이 던지는 차단을
      // raw 예외로 새어나가게 두지 않는다(호출부가 "그냥 에러"로 삼킬 여지를 만들지 않는다).
      if (e instanceof EgressBlockedError) throw this.egressBlocked503(e);
      throw e;
    }
  }

  /** 재시도 대기 — 테스트가 갈아끼운다 */
  protected sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 재시도 뒤에도 바쁨(429) → `AI_UPSTREAM_BUSY`(HTTP 429) · Retry-After 를 그대로 전한다 */
  private static busyException(res: globalThis.Response, ctx: string): HttpException {
    const retryAfter = Math.round(aiRetryAfterMs(res.headers.get('retry-after')) / 1000);
    return new HttpException({
      code: 'AI_UPSTREAM_BUSY',
      message: 'AI 서버가 동시 처리 한도로 바쁩니다 — 잠시 후 다시 시도하세요',
      retryAfter,
      endpoint: ctx,
    }, 429);
  }

  // ── 🔴 aiFetch 응답 해석 정본(W8-R6) ──
  //
  // 원 결함: `aiFetch` 를 부르고 **res.ok 를 검사하지 않고 그대로 `res.json()` 을 반환**하는 경로가
  // 검사하는 `request()` 경로와 공존했다(meetingAnalyze·counselingChat·visionMedicalAnalyze·translate·
  // reasoningChainStream·autoRecordStream 6경로). 결과로 502/504 의 에러 본문이 "정상 결과"로 화면에
  // 그려졌고, 특히 **상담 위기감지는 `is_crisis` 가 undefined 가 되어 "위기 없음"으로 뒤바뀌었다**
  // (자살위험 상담에서 실패가 안전으로 downgrade — P1: 모르는 것을 아는 것처럼 말함).
  // → 아래 두 헬퍼가 유일한 해석 경로다. 신규 aiFetch 호출은 반드시 `aiJson`/`assertStreamOk` 를 거치거나
  //   호출부에서 `res.ok` 를 직접 검사할 것(구조 가드: test/medical-ai/ai-egress-guard.spec.ts §①).

  /**
   * aiFetch 응답 → JSON. res.ok 실패는 삼키지 않고 503 으로 올린다(실패는 실패로).
   *
   * `generation: true` — **생성형 호출**(판독·번역·분석 접수)이면 본문도 `assertUpstreamOk` 정본으로 본다.
   * 🔴 (2026-09-28 a18ec 재판정) R43 봉합(1c6e7cd98)은 `request()/requestGet()` 두 경로에만 걸렸고, 이 헬퍼를 지나는
   *    영상 판독·번역·회의 분석 접수는 상류가 **200 + `success:false`/`error`/토큰 0** 으로 답해도 그대로 결과가 됐다
   *    (판독 소견 공백이 "판독 결과"로, 빈 번역이 "번역 완료"로).
   * 🔴 상태·목록·작업 조회(`meeting/job`·`meeting/jobs`·`meeting/status`·`counseling/status`·`counseling/sessions`)에는 **걸지 않는다** —
   *    실패한 작업의 `error` 필드는 "조회 실패"가 아니라 **조회된 사실**이다. 상담 대화(`counseling/chat`)도 걸지 않는다 —
   *    위기 감지 정형 응답이 토큰 0 으로 올 수 있고, 그것을 503 으로 바꾸면 **위기 배너가 사라진다**(안전측이 반대다).
   */
  private async aiJson(res: globalThis.Response, ctx: string, opts?: { generation?: boolean }): Promise<any> {
    if (res.status === 429) throw MedicalAiService.busyException(res, ctx);
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.error(`AI Error(${ctx}): ${res.status} - ${err.slice(0, 200)}`);
      // 🔴 401/403 은 "서버 오류"가 아니라 **키 인증 실패**다(재시도로 안 풀린다 — 키를 교체해야 한다).
      const auth = res.status === 401 || res.status === 403;
      throw new ServiceUnavailableException({
        code: auth ? 'AI_UPSTREAM_AUTH' : 'AI_UPSTREAM_ERROR',
        message: auth
          ? `WeRU.B 키 인증 실패(${res.status}) — 키 교체가 필요합니다. ${ctx}`
          : `WeRU.B 응답 실패(${res.status}) — ${ctx}`,
      });
    }
    const json = await res.json();
    if (opts?.generation) this.assertUpstreamOk(ctx, json);
    return json;
  }

  /** 스트리밍(Response 원본 전달) 경로의 res.ok 검사 — 실패를 빈 스트림으로 흘려보내지 않는다. */
  private async assertStreamOk(res: globalThis.Response, ctx: string): Promise<globalThis.Response> {
    if (res.status === 429) throw MedicalAiService.busyException(res, ctx);
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.error(`AI Stream Error(${ctx}): ${res.status} - ${err.slice(0, 200)}`);
      const auth = res.status === 401 || res.status === 403;
      throw new ServiceUnavailableException({
        code: auth ? 'AI_UPSTREAM_AUTH' : 'AI_UPSTREAM_ERROR',
        message: auth
          ? `WeRU.B 키 인증 실패(${res.status}) — 키 교체가 필요합니다. ${ctx}`
          : `WeRU.B 스트림 실패(${res.status}) — ${ctx}`,
      });
    }
    return res;
  }

  // ── AI 거버넌스: disclaimer 표준 동봉 ──

  /** config 미설정/오류 시 기본 문구(정본) */
  private static readonly DEFAULT_DISCLAIMER =
    AI_DEFAULT_DISCLAIMER;

  private disclaimerCache: { text: string; ts: number } = { text: '', ts: 0 };

  /**
   * AI 면책 문구 — SystemConfig `ai.disclaimer`(런타임 변경 가능·캐시 30초).
   * 소비 모듈(cancer-registry·mdt·surgery·telehealth·lab·checkup)도 이 헬퍼를 사용(중복 최소화).
   */
  async getDisclaimer(): Promise<string> {
    const now = Date.now();
    if (this.disclaimerCache.text && now - this.disclaimerCache.ts < 30_000) return this.disclaimerCache.text;
    try {
      const v = await this.runtimeConfig.get('ai.disclaimer');
      const text = typeof v === 'string' && v.trim() ? v.trim() : MedicalAiService.DEFAULT_DISCLAIMER;
      this.disclaimerCache = { text, ts: now };
      return text;
    } catch {
      return MedicalAiService.DEFAULT_DISCLAIMER;
    }
  }

  /**
   * 합성형 응답에 disclaimer 필드 자동 동봉(비파괴 — 필드 추가만).
   * 이미 disclaimer가 있으면 유지(WeRU.B 정본 우선 원칙). 객체가 아니면 그대로 반환.
   */
  private async withDisclaimer<T>(result: T): Promise<T> {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const obj = result as Record<string, unknown>;
      if (obj.disclaimer == null || obj.disclaimer === '') obj.disclaimer = await this.getDisclaimer();
    }
    return result;
  }

  /** 경로 파라미터로 삽입되는 코드 값 화이트리스트 — 경로 조작(../, %2F, 쿼리 주입) 방어 */
  private assertSafePathCode(code: string): string {
    if (!/^[0-9A-Za-z._-]{1,20}$/.test(code)) {
      throw new BadRequestException('유효하지 않은 코드 형식입니다');
    }
    return code;
  }

  /**
   * 🔴 **200 이라고 성공이 아니다**.
   *
   * AI 서버가 오류를 본문 `raw` 에 담아 **200 으로** 답하면, HIS 는 그것을 그대로 201 로 넘겼고
   * 화면은 상류가 붙여 보낸 `hallucination_check.passed: true` 까지 그렸다 — 실패가 "검증 통과한 요약"이 됐다.
   *
   * 🔴 **본문 텍스트를 패턴으로 판정하지 않는다.** 임상 문장에는 `medication error`·`투약 오류` 같은
   *    정당한 말이 들어온다 — 그것을 오류로 읽으면 진짜 요약을 버린다. 판정은 **구조**로만 한다:
   *    ① 상류가 `success:false`·`error` 를 실었다 ② 토큰 사용량이 **명시적으로 0** 이다(생성이 없었다).
   *    둘 다 아니면 판정하지 않는다(모르면 침묵한다).
   */
  private assertUpstreamOk(endpoint: string, json: unknown): void {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return;
    const obj = json as Record<string, any>;
    const errored =
      obj.success === false ||
      (typeof obj.error === 'string' && obj.error.trim() !== '') ||
      (obj.error != null && typeof obj.error === 'object');
    const tokens = obj.tokens ?? obj.usage?.total_tokens ?? obj.usage?.totalTokens;
    const noGeneration = typeof tokens === 'number' && tokens === 0;
    if (!errored && !noGeneration) return;
    this.logger.error(`AI 상류가 200 으로 실패를 돌려줬다: ${endpoint} errored=${errored} tokens=${String(tokens)}`);
    throw new ServiceUnavailableException({
      error: 'AI_UPSTREAM_FAILED',
      message: 'AI 서버가 결과를 만들지 못했습니다. 초안이 생성되지 않았습니다.',
      details: { endpoint, tokens: tokens ?? null, upstreamError: typeof obj.error === 'string' ? obj.error.slice(0, 200) : null },
    });
  }

  private async request(endpoint: string, body: Record<string, unknown>, timeoutMs?: number): Promise<any> {
    this.logger.log(`AI Request: ${endpoint}`);
    const res = await this.aiFetch(endpoint, { method: 'POST', body, ...(timeoutMs ? { timeoutMs } : {}) });
    if (res.status === 429) throw MedicalAiService.busyException(res, endpoint);
    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`AI Error: ${res.status} - ${err}`);
      // 🔴 상류 실패는 우리 서버 고장(500 INTERNAL_ERROR)이 아니다 — 502(상류 오류)로 · 문구는 그대로(사유 판정이 이 문구를 읽는다)
      throw new HttpException(`AI API error: ${res.status}`, 502);
    }
    const json = await res.json();
    this.assertUpstreamOk(endpoint, json);
    return json;
  }

  /** GET 호출(경로 파라미터형 EP — drug-substitution/drug-master/drug-info/sync-status/fee-codes) */
  private async requestGet(endpoint: string): Promise<any> {
    this.logger.log(`AI Request(GET): ${endpoint}`);
    const res = await this.aiFetch(endpoint);
    if (res.status === 429) throw MedicalAiService.busyException(res, endpoint);
    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`AI Error: ${res.status} - ${err}`);
      // 🔴 상류 실패는 우리 서버 고장(500 INTERNAL_ERROR)이 아니다 — 502(상류 오류)로 · 문구는 그대로(사유 판정이 이 문구를 읽는다)
      throw new HttpException(`AI API error: ${res.status}`, 502);
    }
    const json = await res.json();
    this.assertUpstreamOk(endpoint, json);
    return json;
  }

  /**
   * AI 서버 연결 진단(관리자 전용).
   * 🔴 실패를 HTTP 200 `{connected:false}` 로 내리는 계약 자체는 유지한다(진단 화면이 사유를 읽어야 하므로).
   *    대신 **화면이 connected 를 반드시 읽도록** 계약을 명확히 한다 — `/admin/ai-settings` 는 요청이 200 이면
   *    무조건 초록 "정상 연결"을 칠하고 `error` 키를 `.filter` 로 제거해 사유까지 지우고 있었다(F).
   * 🔴 `model: 'qwen2.5'` 하드코딩 제거 — 상류에 물어본 적 없는 값을 사실처럼 표시하던 상수(P15).
   */
  async getStatus(): Promise<Record<string, unknown>> {
    const cfg = await this.getAiConfig();
    const checkedAt = new Date().toISOString();
    try {
      const res = await this.aiFetch('/api/medical/knowledge/stats');
      if (!res.ok) {
        // 🔴 401/403 은 "연결 실패"가 아니라 **키 인증 실패**다 — 사람이 키를 교체해야 풀린다.
        //    종전엔 401 을 보면 하드코딩 조직정보로 테넌트를 재등록해 새 키를 몰래 받았다(R6에서 제거).
        const auth = res.status === 401 || res.status === 403;
        return {
          connected: false,
          authFailed: auth,
          reason: auth ? 'UPSTREAM_AUTH' : 'UPSTREAM_ERROR',
          error: auth ? `HTTP ${res.status} — 키 인증 실패(키 교체 필요)` : `HTTP ${res.status}`,
          keyConfigured: !!cfg.key,
          url: cfg.url,
          checkedAt,
        };
      }
      const data = await res.json();
      return { connected: true, authFailed: false, url: cfg.url, knowledgeBase: data, keyConfigured: !!cfg.key, checkedAt };
    } catch (e: any) {
      const auth = MedicalAiService.isUpstreamAuthError(e);
      return {
        connected: false,
        authFailed: auth,
        reason: auth ? 'UPSTREAM_AUTH' : undefined,
        error: e?.message ?? 'Connection failed',
        keyConfigured: !!cfg.key,
        url: cfg.url,
        checkedAt,
      };
    }
  }

  /**
   * 신분증(주민등록증/운전면허증) OCR — AI 서버 vision 모델.
   * ⚠️ 이미지는 메모리에서만 처리하고 저장하지 않음(개보법, 신분증 사본 비저장 원칙).
   * 추출 텍스트만 반환. 호출 측은 OCR 동의를 받은 뒤 호출해야 함.
   */
  async idCardOcr(imageBase64: string, docType: string): Promise<{ familyName: string; givenName: string; rrn: string; birthDate: string; address: string }> {
    const model = this.config.get<string>('AI_OCR_MODEL', 'llava');
    const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const docLabel = docType === 'DRIVER_LICENSE' ? '운전면허증' : '주민등록증';
    const prompt = `이 이미지는 한국 ${docLabel}입니다. 다음을 추출해 JSON으로만 답하세요(보이지 않으면 빈 문자열): {"name":"성명","rrn":"주민등록번호 13자리(######-#######)","address":"주소"}`;
    const res = await this.aiFetch('/api/chat', {
      method: 'POST',
      body: { model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt, images: [b64] }] },
      timeoutMs: this.llmTimeoutMs,
    });
    if (!res.ok) {
      this.logger.error(`ID OCR error: ${res.status}`);
      throw new Error(`OCR AI error: ${res.status}`);
    }
    const data = await res.json() as { message?: { content?: string }; response?: string };
    const text = data?.message?.content ?? data?.response ?? '{}';
    let parsed: { name?: string; rrn?: string; address?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* 파싱 실패 시 빈값 */ }

    const name = (parsed.name ?? '').trim();
    const rrnDigits = (parsed.rrn ?? '').replace(/\D/g, '').slice(0, 13);
    return {
      familyName: name ? name.charAt(0) : '',
      givenName: name ? name.slice(1) : '',
      rrn: rrnDigits.length >= 7 ? `${rrnDigits.slice(0, 6)}-${rrnDigits.slice(6)}` : rrnDigits,
      birthDate: this.rrnToBirthDate(rrnDigits),
      address: (parsed.address ?? '').trim(),
    };
  }

  /**
   * 행정 **증빙 문서** 판독 — 원문 JSON 문자열을 그대로 돌려준다(파싱·검증은 호출부 정본).
   *
   * 🔴 신분증 OCR(`idCardOcr`)과 **다른 함수**다. 저 함수는 주민번호를 뽑고 여기는 문서 번호를
   *    뽑는다 — 같은 함수로 합치면 행정 문서 판독이 개인식별자를 달라고 묻게 된다.
   * 🔴 프롬프트가 "모르면 비워라"를 **명시**한다. 안 적으면 모델이 그럴듯한 번호를 만든다.
   */
  async extractDocumentFields(imageBase64: string, docHint: string): Promise<string> {
    const model = this.config.get<string>('AI_OCR_MODEL', 'llava');
    const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const prompt =
      `이 이미지는 한국 의료기관의 행정 증빙 문서입니다(${docHint}). `
      + '다음을 JSON 으로만 답하세요. '
      + '🔴 보이지 않거나 확실하지 않으면 그 항목을 **빈 문자열**로 두세요. 추측하지 마세요. '
      + '{"docNo":"문서·신고·허가 번호","issuedDate":"발급일 YYYY-MM-DD","issuer":"발급 기관","docTitle":"문서 제목"}';
    const res = await this.aiFetch('/api/chat', {
      method: 'POST',
      body: { model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt, images: [b64] }] },
      timeoutMs: this.llmTimeoutMs,
    });
    if (!res.ok) throw new Error(`증빙 판독 AI 오류: ${res.status}`);
    const data = await res.json() as { message?: { content?: string }; response?: string };
    return data?.message?.content ?? data?.response ?? '{}';
  }

  private rrnToBirthDate(rrn: string): string {
    if (rrn.length < 7) return '';
    const yy = parseInt(rrn.slice(0, 2), 10);
    const mm = rrn.slice(2, 4);
    const dd = rrn.slice(4, 6);
    const g = rrn[6];
    const century = ['1', '2', '5', '6'].includes(g) ? 1900 : ['3', '4', '7', '8'].includes(g) ? 2000 : (yy > 30 ? 1900 : 2000);
    if (!/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd)) return '';
    return `${century + yy}-${mm}-${dd}`;
  }

  /** SOAP 구조화 */
  async summarize(text: string, specialty?: string): Promise<any> {
    return this.withDisclaimer(await this.request('/api/medical/summarize', { text, specialty: specialty ?? '내과', format: 'soap' }));
  }

  /** 감별진단 */
  async analyze(data: { symptoms: string[]; vitals?: Record<string, unknown>; labs?: Record<string, unknown>; history?: string; age?: number; sex?: string }): Promise<any> {
    return this.withDisclaimer(await this.request('/api/medical/analyze', data));
  }

  /** 의학 참고 (RAG) */
  async reference(question: string, category?: string): Promise<any> {
    return this.withDisclaimer(await this.request('/api/medical/reference', { question, category, n_context: 5 }));
  }

  /** 환자 설명문 (한국어 강제) */
  async explain(diagnosis: string, treatmentPlan: string, patientLevel?: string): Promise<any> {
    const koreanInstruction = '반드시 한국어로만 답변하세요. ';
    return this.withDisclaimer(await this.request('/api/medical/explain', {
      diagnosis,
      treatment_plan: koreanInstruction + treatmentPlan,
      patient_level: patientLevel ?? 'general',
      language: 'ko',
    }));
  }

  /** 의무기록 초안 */
  async draft(type: string, data: Record<string, unknown>): Promise<any> {
    return this.withDisclaimer(await this.request('/api/medical/draft', { type, data }));
  }

  /** 약물 정보 (영어 모델) */
  async drugInfo(query: string): Promise<any> {
    return this.request('/api/medical/clinical/drug', { query, translate: true });
  }

  /** 임상 분석 (영어 모델) */
  async clinicalAnalyze(data: Record<string, unknown>): Promise<any> {
    return this.request('/api/medical/clinical/analyze', { ...data, translate: true });
  }

  /** 트리아지: 증상 → 진료과 추천 (확장 파라미터) */
  async triage(symptoms: string, params?: { age?: number; sex?: string; duration?: string; severity?: string }): Promise<any> {
    try {
      return await this.request('/api/medical/triage', {
        symptom: symptoms,
        ...(params?.age && { age: params.age }),
        ...(params?.sex && { sex: params.sex }),
        ...(params?.duration && { duration: params.duration }),
        ...(params?.severity && { severity: params.severity }),
      });
    } catch (e) {
      this.logger.warn(`Triage API fallback: ${e}`);
      return null;
    }
  }

  /**
   * 구조화 의료 질의 — /api/medical/ask (v2.36.0).
   *
   * 🔴 (2026-09-21) 종전엔 실패를 `null` 로 삼켰고, 호출부(agent-session)는 그 `null` 로 '참고 안내' 블록을
   *    **통째로 생략**했다 — 상류가 401/404 로 늘 실패해도 화면에는 "못 얻었다"가 한 글자도 없었다.
   *    없는 것과 못 얻은 것은 다른 사실이다 → 3상태로 **말한다**(`AI` / `UNAVAILABLE`).
   *    `FALLBACK` 은 쓰지 않는다 — 이 경로엔 규칙으로 대신 답하는 대체가 없다(있지도 않은 것을 지어내지 않는다).
   *    `reason` 은 **코드**다(문장이 아니다) — 화면이 카탈로그로 말한다. 본문 텍스트를 패턴으로 판정하지 않는다.
   */
  async medicalAsk(
    data: { symptoms: string[]; duration?: string; severity?: string; patient_age?: number; context?: string },
  ): Promise<MedicalAskResult> {
    try {
      return { source: 'AI', data: await this.request('/api/medical/ask', data) };
    } catch (e) {
      const reason = MedicalAiService.upstreamFailureReason(e);
      this.logger.warn(`Medical ask unavailable(${reason}): ${e instanceof Error ? e.message : String(e)}`);
      return { source: 'UNAVAILABLE', reason };
    }
  }

  /**
   * 상류 실패 → 사유 코드(정적 어휘). 우리 예외 봉투의 `code` 와 상태코드만 읽는다 —
   * 🔴 상류 **본문** 텍스트를 패턴으로 판정하지 않는다(`medication error` 같은 정당한 임상 문장을 버린다).
   */
  private static upstreamFailureReason(e: unknown): MedicalAskUnavailableReason {
    if (MedicalAiService.isUpstreamAuthError(e)) return 'AI_UPSTREAM_AUTH';
    const r = (e as { response?: { code?: unknown; error?: unknown } } | null)?.response;
    const code = typeof r?.code === 'string' ? r.code : typeof r?.error === 'string' ? r.error : '';
    if ((MEDICAL_ASK_UNAVAILABLE_REASONS as readonly string[]).includes(code)) return code as MedicalAskUnavailableReason;
    // `request()` 가 던지는 우리 자신의 예외 문구(`AI API error: <status>`) — 상류 본문이 아니다
    if (e instanceof Error && /^AI API error: \d{3}$/.test(e.message)) return 'AI_UPSTREAM_ERROR';
    return 'AI_REQUEST_FAILED';
  }

  /** 트리아지: 대화형 추가 질문 */
  async triageFollowUp(symptoms: string, history: Record<string, unknown>[]): Promise<any> {
    try {
      return await this.request('/api/medical/triage/follow-up', { symptoms, history });
    } catch (e) {
      this.logger.warn(`Triage follow-up fallback: ${e}`);
      return null;
    }
  }

  /** 트리아지: 진료과 목록 */
  async triageDepartments(): Promise<any> {
    try {
      const res = await this.aiFetch('/api/medical/triage/departments');
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  // ── Chat API v2.36: 세션 메모리 + 품질검증 + 모델자동선택 ──

  /**
   * 세션 기반 Chat API 호출
   * - session_id: AI 서버가 대화 이력을 자동 관리
   * - quality_check: 한국어 30% 검증 + 자동 재시도
   * - model 생략: simple(7b)/complex(14b) 자동 선택
   */
  async chatWithSession(
    message: string,
    opts: { sessionId?: string; userId?: string; systemPrompt?: string },
  ): Promise<{ answer: string; sessionId?: string; model?: string; messageCount?: number; failure?: 'BUSY' | 'ERROR' }> {
    try {
      const messages: { role: string; content: string }[] = [];
      if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
      messages.push({ role: 'user', content: message });

      // 스트림 전환(의료팀 결정) — quality_check(비스트림+재시도) 지연 제거. NDJSON 집계.
      const res = await this.aiFetch('/api/chat', {
        method: 'POST',
        body: {
          messages,
          stream: true,
          ...(opts.sessionId && { session_id: opts.sessionId }),
          ...(opts.userId && { user_id: opts.userId }),
        },
        timeoutMs: this.llmTimeoutMs,
      });

      if (!res.ok) {
        // 429 는 aiFetch 가 Retry-After 로 2회 다시 보낸 뒤에도 바쁜 것 — 고장(ERROR)과 다른 사실로 남긴다
        this.logger.warn(`Chat API ${res.status === 429 ? '바쁨(429 · 재시도 후)' : `실패(${res.status})`}`);
        return { answer: '', failure: res.status === 429 ? 'BUSY' : 'ERROR' };
      }

      // 응답 본문(스트림 완료분)을 NDJSON 으로 집계. 단일 JSON(answer) 도 호환.
      const raw = await res.text();
      let streamed = '';
      let singleAnswer = '';
      let sessionId: string | undefined = opts.sessionId;
      let model: string | undefined;
      let messageCount: number | undefined;
      for (const line of raw.trim().split('\n')) {
        // 🔴 스트림 중간 오류 이벤트(server_busy 등) — 헤더는 200 이라 줄을 읽어야 안다.
        //    종전엔 오류 줄을 내용 없는 줄로 넘겨, 끊긴 앞부분이 완결된 답처럼 쓰였다 → 답을 버리고 실패로 말한다.
        const p = parseAiStreamLine(line);
        if (p.kind === 'error') {
          this.logger.warn(`Chat API 스트림 오류 이벤트(${p.busy ? '바쁨' : p.code ?? 'error'}) — 받은 앞부분은 쓰지 않는다`);
          return { answer: '', sessionId, failure: p.busy ? 'BUSY' : 'ERROR' };
        }
        if (p.kind !== 'data') continue;
        const o = p.obj as any;
        streamed += (o.message?.content ?? o.response ?? '');
        if (typeof o.answer === 'string' && o.answer) singleAnswer = o.answer;
        if (o.session_id) sessionId = o.session_id;
        if (o.model_used || o.model) model = o.model_used ?? o.model;
        if (o.message_count != null) messageCount = o.message_count;
      }
      const answer = (streamed.trim() || singleAnswer).trim();
      return { answer, sessionId, model, messageCount };
    } catch (e) {
      this.logger.warn(`chatWithSession error: ${e}`);
      return { answer: '' };
    }
  }

  // ── Ollama Chat 호출 유틸 (품질검증 모드 우선) ──
  /**
   * @param meta 선택 — **상류가 보고한 모델 태그**를 호출부로 되돌리는 출력 인자(제안 원장 `modelRef`).
   *   🔴 요청에 실은 태그(`qwen2.5:14b`)로 대신 채우지 않는다 — 상류가 말하지 않으면 `model` 은 `undefined` 로 남고
   *      호출부는 그것을 `null`(미보고)로 기록한다. 넘기지 않는 호출부의 동작은 종전과 완전히 같다(가산적 인자).
   */
  private async chatLlm(messages: { role: string; content: string }[], options?: { temperature?: number; num_predict?: number }, meta?: { model?: string | null }): Promise<string> {
    // 품질검증 모드 (비스트리밍 + quality_check + 모델자동선택)
    try {
      const res = await this.aiFetch('/api/chat', {
        method: 'POST',
        body: {
          messages,
          stream: false,
          quality_check: true,
          options: { temperature: options?.temperature ?? 0.7, num_predict: options?.num_predict ?? 1024 },
        },
        timeoutMs: this.llmTimeoutMs,
      });
      if (!res.ok) return '';
      const data = await res.json() as any;
      // 비스트리밍 응답: { answer, model_used, quality_check, ... }
      if (data.answer && data.answer.length > 10) {
        this.logger.debug?.(`chatLlm: model=${data.model_used}, quality=${data.quality_check?.validated}`);
        if (meta) meta.model = (typeof data.model_used === 'string' && data.model_used) || (typeof data.model === 'string' && data.model) || null;
        return data.answer.trim();
      }
    } catch {}

    // 폴백: 기존 NDJSON 파싱 (quality_check 미지원 서버)
    try {
      const res = await this.aiFetch('/api/chat', {
        method: 'POST',
        body: {
          model: 'qwen2.5:14b',
          messages,
          stream: false,
          options: { temperature: options?.temperature ?? 0.7, num_predict: options?.num_predict ?? 1024 },
        },
        timeoutMs: this.llmTimeoutMs,
      });
      if (!res.ok) return '';
      const text = await res.text();
      let full = '';
      for (const line of text.trim().split('\n')) {
        try {
          const o = JSON.parse(line) as { message?: { content?: string }; model_used?: unknown; model?: unknown };
          full += (o.message?.content ?? '');
          // 상류가 라인에 실어 보낸 모델만 기록한다(요청 태그로 채우지 않는다)
          if (meta && (typeof o.model_used === 'string' || typeof o.model === 'string')) meta.model = (o.model_used as string) ?? (o.model as string);
        } catch {}
      }
      const cjkCount = (full.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
      if (full.length > 10 && cjkCount < 3) return full.trim();
    } catch {}

    return '';
  }

  /**
   * 오케스트레이터 v2
   * - 멀티 도구 병렬 호출
   * - 도구 체이닝 (A→B)
   * - JSON 구조화 의도 분류
   * - 대화 메모리 압축
   * - 폴백 체인 (14b→7b→규칙)
   * - 환자 컨텍스트 자동 주입
   * - 모호한 입력 재확인
   */
  async orchestrate(userMessage: string, context: { patientName?: string; patientId?: string; state?: string; history?: { role: string; content: string }[]; toolResults?: Record<string, unknown>; patientContext?: string }): Promise<{ response: string; medicalData?: any; toolCalls?: string[] }> {
    const now = new Date();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const todayStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${dayNames[now.getDay()]}요일`;
    const tomorrowDate = new Date(now); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = `${tomorrowDate.getFullYear()}년 ${tomorrowDate.getMonth() + 1}월 ${tomorrowDate.getDate()}일 ${dayNames[tomorrowDate.getDay()]}요일`;

    // 병원 기본 정보 + 날씨
    const hospitalContext = await this.runtimeConfig.getHospitalContext();
    // 🔴 소재 도시는 정본(DB 행만) — 종전 `get('hospital.city') ?? '서울'` 은 DB 행이 없으면 DEFAULTS '서울'(개발 플레이스홀더)로,
    //    그것도 없으면 다시 '서울' 로 떨어졌다(가상 병원이 "위치: 서울"). 미설정이면 위치 줄을 싣지 않는다 —
    //    미설정 사실은 위 병원 정보 문단(`getHospitalContext`)이 "확인되지 않은 항목"으로 이미 밝힌다.
    const { 'hospital.city': city } = await readHospitalConfig(this.prisma, ['hospital.city'] as const);
    const weather = await this.getWeather();

    const systemPrompt = `당신은 한국 병원의 AI 도우미입니다. 반드시 한국어로만 답변하세요. 존댓말을 사용하세요.

현재 시각: ${todayStr} ${now.getHours()}시 ${now.getMinutes()}분
내일: ${tomorrowStr}
${weather ? (city ? `${weather} (${city})` : weather) : (city ? `위치: ${city}` : '')}

병원 정보:
${hospitalContext}

역할: 환자와 친절하게 대화하며, 필요한 정보를 조회하여 안내합니다.

도구(태그) 목록 — 해당 질문이면 답변 맨 끝에 태그를 한 줄로 출력하세요:
- 증상/아픈 곳 언급 → [TRIAGE_NEEDED]
- 약물/의학 질문 → [REFERENCE_NEEDED:질문요약]
- 의사 진료 시간/일정 → [SCHEDULE_NEEDED:의사이름또는진료과]
- 진료과/의사 소개 → [DOCTORS_NEEDED:진료과이름]
- 예약 확인 → [APPOINTMENTS_NEEDED]
- 검사결과 문의 → [LABRESULTS_NEEDED]
- 진료비/수납 → [BILLING_NEEDED]
- 병원 안내(위치/시간) → [HOSPITAL_INFO_NEEDED]
- 일반 대화(인사, 확인) → 태그 없이 직접 답변
- 모호한 질문 → [CLARIFY_NEEDED] 태그 + 되묻기 질문

규칙:
- 300자 이내 답변
- 환자 이름을 자연스럽게 호칭
- 태그는 답변 맨 끝에, 여러 개 가능 (각 줄에 하나)
- 날씨 언급 시 자연스럽게 건강 팁 추가`;

    // v3 엔진으로 위임
    try {
      const startMs = Date.now();
      const result = await this.orchestratorEngine.run(userMessage, systemPrompt, {
        patientId: context.patientId,
        patientName: context.patientName,
        department: (context as any).department,
        userMessage,
        history: context.history,
        patientContext: context.patientContext,
      });

      const latencyMs = Date.now() - startMs;
      this.logger.log(`Orchestrator v3: ${result.steps?.length ?? 0} steps, ${latencyMs}ms`);

      // 피드백 저장용 메타데이터
      if (result.response) {
        try {
          await this.prisma.aiFeedback.create({
            data: {
              userMessage, aiResponse: result.response, rating: 'NEUTRAL',
              toolsUsed: result.steps?.map(s => s.action.split('(')[0]) ?? [],
              latencyMs, model: 'qwen2.5:14b',
            },
          });
        } catch {}
      }

      // DB 도구 결과가 있으면 toolResults로 반환 (agent-session에서 처리)
      const dbToolCalls: string[] = [];
      if (result.toolResults) {
        for (const [name, tr] of result.toolResults) {
          if (!tr.success) continue;
          // DB 도구 결과는 이미 엔진에서 종합됨
        }
      }

      return { response: result.response || '', medicalData: null, toolCalls: dbToolCalls };
    } catch (e) {
      this.logger.warn(`Orchestrator v3 error: ${e}, falling back to v2`);
    }

    // v3 실패 시 v2 폴백
    let history = context.history?.slice(-8) ?? [];
    if ((context.history?.length ?? 0) > 10) {
      const oldMsgs = context.history!.slice(0, -6).map(m => `${m.role}: ${m.content}`).join('\n');
      const summary = await this.chatLlm([
        { role: 'system', content: '대화 내용을 3줄로 요약하세요. 한국어. 핵심 정보만.' },
        { role: 'user', content: oldMsgs },
      ], { num_predict: 100 });
      if (summary) {
        history = [{ role: 'system', content: `[이전 대화 요약] ${summary}` }, ...context.history!.slice(-6)];
      }
    }

    // [강화 7] 환자 컨텍스트 자동 주입
    const patientInfo = context.patientContext ? `\n[환자 정보] ${context.patientContext}` : '';

    const messages = [
      { role: 'system', content: systemPrompt + patientInfo },
      ...history,
      { role: 'user', content: `${context.patientName ? `[환자: ${context.patientName}]` : ''} ${userMessage}` },
    ];

    try {
      // [강화 6] 폴백 체인: 14b → 7b → 규칙
      let llmResponse = await this.chatLlm(messages, { num_predict: 1024 });
      if (!llmResponse) {
        this.logger.warn('Primary model failed, trying fallback (7b)');
        llmResponse = await this.chatLlmWithModel('qwen2.5:7b', messages, { num_predict: 800 });
      }
      if (!llmResponse) return { response: '', toolCalls: [] };

      let medicalData: any = null;

      // [강화 1] 멀티 도구 감지 — 모든 태그를 한번에 파싱
      const allTags = ['TRIAGE_NEEDED', 'REFERENCE_NEEDED', 'SCHEDULE_NEEDED', 'DOCTORS_NEEDED', 'APPOINTMENTS_NEEDED', 'LABRESULTS_NEEDED', 'BILLING_NEEDED', 'HOSPITAL_INFO_NEEDED', 'CLARIFY_NEEDED'];
      const toolCalls: string[] = [];

      for (const tag of allTags) {
        const regex = new RegExp(`\\[${tag}(?::(.+?))?\\]`, 'g');
        let m: RegExpExecArray | null;
        while ((m = regex.exec(llmResponse)) !== null) {
          toolCalls.push(m[1] ? `${tag}:${m[1]}` : tag);
          llmResponse = llmResponse.replace(m[0], '').trim();
        }
      }

      // [강화 8] 모호한 입력 재확인
      if (toolCalls.includes('CLARIFY_NEEDED')) {
        return { response: llmResponse, toolCalls: [] }; // LLM이 이미 되묻기 질문 생성
      }

      // [강화 1+2] Medical API 도구 병렬 호출 + 체이닝
      const apiPromises: Promise<void>[] = [];
      let triageInfo = '';
      let referenceInfo = '';

      if (toolCalls.some(t => t === 'TRIAGE_NEEDED')) {
        apiPromises.push((async () => {
          try {
            medicalData = await this.triage(userMessage);
            if (medicalData?.recommendations?.length) {
              triageInfo = medicalData.recommendations.map((r: any) => `${r.rank}순위: ${r.department} (${Math.round(r.confidence * 100)}%) - ${r.reason}`).join('\n');
              if (medicalData.emergency_warning) triageInfo = `⚠️ 응급: ${medicalData.emergency_warning}\n${triageInfo}`;
            }
          } catch (e) { this.logger.warn(`Triage: ${e}`); }
        })());
      }

      const refCalls = toolCalls.filter(t => t.startsWith('REFERENCE_NEEDED:'));
      for (const rc of refCalls) {
        const q = rc.replace('REFERENCE_NEEDED:', '');
        apiPromises.push((async () => {
          try {
            const refData = await this.reference(q);
            if (refData?.answer) referenceInfo += `\n[${q}] ${refData.answer}`;
          } catch (e) { this.logger.warn(`Reference: ${e}`); }
        })());
      }

      // 병렬 실행
      if (apiPromises.length > 0) await Promise.all(apiPromises);

      // DB 도구는 호출자(agent-session)에게 반환
      const dbToolCalls = toolCalls.filter(t => !t.startsWith('TRIAGE_NEEDED') && !t.startsWith('REFERENCE_NEEDED') && !t.startsWith('CLARIFY'));

      // [2차 호출] toolResults 전달 시 — 모든 결과를 LLM이 종합
      if (context.toolResults && Object.keys(context.toolResults).length > 0) {
        const toolInfo = Object.entries(context.toolResults).map(([k, v]) => `[${k}]\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`).join('\n\n');
        const combined = [triageInfo && `[진료과 추천]\n${triageInfo}`, referenceInfo, toolInfo].filter(Boolean).join('\n\n');
        const synthesized = await this.chatLlm([
          { role: 'system', content: '한국 병원 AI 도우미. 한국어만. 존댓말. 300자 이내. 조회 결과를 환자에게 친절하게 안내. 핵심 데이터(이름/날짜/시간/금액/확률)는 정확히 유지.' },
          { role: 'user', content: `환자 "${context.patientName ?? ''}"님의 질문: "${userMessage}"\n\n${combined}\n\n자연스럽게 안내해주세요.` },
        ], { num_predict: 400 });
        if (synthesized) return { response: synthesized, medicalData, toolCalls: [] };
      }

      // Medical API 결과가 있으면 종합
      if (triageInfo || referenceInfo) {
        const combined = [triageInfo && `[진료과 추천]\n${triageInfo}`, referenceInfo].filter(Boolean).join('\n\n');
        const synthesized = await this.chatLlm([
          { role: 'system', content: '한국 병원 AI 도우미. 한국어만. 존댓말. 300자 이내. 분석 결과를 환자에게 친절하게 안내. 핵심 정보 유지.' },
          { role: 'user', content: `환자 "${context.patientName ?? ''}"님 질문: "${userMessage}"\n\n${combined}\n\n자연스럽게 안내해주세요.` },
        ], { num_predict: 400 });
        if (synthesized) llmResponse = synthesized;
      }

      return { response: llmResponse, medicalData, toolCalls: dbToolCalls };
    } catch (e) {
      this.logger.warn(`Orchestrator v2 error: ${e}`);
      return { response: '', toolCalls: [] };
    }
  }

  /** 폴백용 — 다른 모델로 LLM 호출 */
  private async chatLlmWithModel(model: string, messages: { role: string; content: string }[], options?: { num_predict?: number }): Promise<string> {
    try {
      const res = await this.aiFetch('/api/chat', {
        method: 'POST',
        body: { model, messages, stream: false, options: { temperature: 0.5, num_predict: options?.num_predict ?? 200 } },
        timeoutMs: this.llmTimeoutMs,
      });
      if (!res.ok) return '';
      const text = await res.text();
      let full = '';
      for (const line of text.trim().split('\n')) { try { full += (JSON.parse(line).message?.content ?? ''); } catch {} }
      const cjk = (full.match(/[\u4e00-\u9fff]/g) || []).length;
      return (full.length > 10 && cjk < 3) ? full.trim() : '';
    } catch { return ''; }
  }

  /**
   * 감시자 판정 보조 — **초안 전용** 범용 프롬프트 호출(환자 데이터 없음·발견 메타만).
   * 🔴 실패는 '' 로 온다(chatLlm 계약) — 호출부가 UNAVAILABLE 로 말한다. 여기서 지어내지 않는다.
   */
  async sentinelAdvise(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.chatLlm(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.2, num_predict: 900 },
    );
  }

  /**
   * 수술 중 기록 경과 요약 — **초안 전용**(수술방 차트 · 사람이 요청할 때만). 입력은 호출부가 비식별 사실 목록으로 만든다.
   * 🔴 실패는 '' 로 온다(chatLlm 계약) — 호출부가 UNAVAILABLE 로 말한다. 여기서 지어내지 않는다.
   */
  async intraopNarrative(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.chatLlm(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.2, num_predict: 700 },
    );
  }

  /** 단순 자연어 변환 (기존 메시지를 대화체로) */
  async generateNaturalResponse(systemPrompt: string, userMessage: string, context?: string): Promise<string> {
    try {
      return await this.chatLlm([
        { role: 'system', content: '당신은 한국 병원의 온라인 예약 AI 도우미입니다. 반드시 한국어로만 답변하세요. 존댓말. 친절하고 따뜻한 말투. 핵심 정보(진료과명, 의사명, 날짜, 시간, 번호 목록)는 반드시 유지. 200자 이내.' },
        { role: 'user', content: `${context ? `[상황] ${context}\n\n` : ''}다음 안내를 자연스럽게 바꿔주세요:\n\n${userMessage}` },
      ]);
    } catch (e) {
      this.logger.warn(`Natural response fallback: ${e}`);
      return '';
    }
  }

  /** 피드백 업데이트 */
  async updateFeedback(id: string, rating: string, comment?: string) {
    return this.prisma.aiFeedback.update({ where: { id }, data: { rating, comment } });
  }

  /** 피드백 직접 생성 — 진료보조 탭별 👍/👎(기능명은 toolsUsed에 저장) */
  async createFeedback(params: { feature: string; rating: string; comment?: string; aiResponse?: string }) {
    return this.prisma.aiFeedback.create({
      data: {
        userMessage: `[${params.feature}] 진료보조`,
        aiResponse: (params.aiResponse ?? '').slice(0, 4000),
        rating: params.rating,
        comment: params.comment,
        toolsUsed: [params.feature],
      },
      select: { id: true },
    });
  }

  /** 피드백 통계 */
  async getFeedbackStats() {
    const [good, bad, total, avgLatency] = await Promise.all([
      this.prisma.aiFeedback.count({ where: { rating: 'GOOD' } }),
      this.prisma.aiFeedback.count({ where: { rating: 'BAD' } }),
      this.prisma.aiFeedback.count(),
      this.prisma.aiFeedback.aggregate({ _avg: { latencyMs: true } }),
    ]);
    return { good, bad, total, neutral: total - good - bad, avgLatencyMs: avgLatency._avg.latencyMs != null ? Math.round(avgLatency._avg.latencyMs) : null, satisfactionRate: total > 0 ? Math.round((good / total) * 100) : null };
  }

  /** 등록된 도구 목록 */
  getRegisteredTools() {
    return this.toolRegistry.getAll().map(t => ({ name: t.name, description: t.description, category: t.category, keywords: t.keywords, paramCount: t.parameters.length }));
  }

  /** 날씨 조회 (인사말용) */
  async getWeather(): Promise<string> {
    try {
      // GET /api/weather 또는 /api/weather/my-city
      for (const path of ['/api/weather', '/api/weather/my-city']) {
        const res = await this.aiFetch(path);
        if (res.ok) {
          const d = await res.json() as any;
          const curr = d.current ?? d;
          const temp = curr.temp ?? curr.temperature;
          const cond = curr.condition ?? curr.weather ?? curr.description;
          if (temp != null) return `현재 날씨: ${temp}°C, ${cond ?? ''}`;
        }
      }
    } catch {}
    return '';
  }

  // 🔴 삭제됨(2026-09-09 P0-C R6): `refreshApiKeyIfNeeded()` — 상류 401 을 보면 하드코딩한 조직정보
  //    (`'Hospital RUN HIS'` · `admin@hospitalrun.example`)로 `POST /api/medical/tenant/register` 를 불러
  //    **새 테넌트 키를 발급받아 메모리에 넣던** 코드였다. 감사도 승인도 없이 병원 자격증명이 바뀌고,
  //    조직정보는 이 저장소 어디서도 사실이 아니다(병원은 `위루비병원`). 호출부는 **0곳**이었다
  //    (정의만 있고 아무도 부르지 않았다 — 그래서 지운다. 되살릴 필요가 생기면 발급은 사람 승인 경로로).
  //    401 은 이제 `UPSTREAM_AUTH`(UNAVAILABLE)로 **말한다** — 아래 `isUpstreamAuthError`·`getStatus` 참조.

  /**
   * 상류 401/403 = **키 인증 실패**. "AI 서버 오류"와 다른 사실이다 — 재시도로 풀리지 않고 사람이 키를 교체해야 한다.
   * `request()/requestGet()` 의 `AI API error: 401` 과 `aiJson()/assertStreamOk()` 의 `AI_UPSTREAM_AUTH` 둘 다 본다.
   */
  private static isUpstreamAuthError(e: unknown): boolean {
    const code = (e as { response?: { code?: string } } | null)?.response?.code;
    if (code === 'AI_UPSTREAM_AUTH') return true;
    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    return /(?:AI API error|WeRU\.B (?:응답|스트림) 실패|WeRU\.B 키 인증 실패)\D*(401|403)/.test(msg);
  }

  /**
   * 상류 실패 봉투 — 401/403 은 `UNAVAILABLE`/`UPSTREAM_AUTH`(키 교체 전에는 **규칙 대체조차 하지 않는다**),
   * 그 외는 종전대로 `FALLBACK`/`UPSTREAM_ERROR`. 화면이 "AI 서버 오류"와 "키 교체 필요"를 다른 사실로 그리게.
   */
  private upstreamFailedSkill<T extends object>(result: T, startedAt: number, e: unknown, groundedOn?: string[]) {
    return MedicalAiService.isUpstreamAuthError(e)
      ? unavailableSkill(result, startedAt, 'UPSTREAM_AUTH', groundedOn)
      : failedSkill(result, startedAt, 'UPSTREAM_ERROR', groundedOn);
  }

  // ══════════════════════════════════════════════
  // AI 진료 보조 Phase 1: 실시간 감별진단 / SOAP 자동 초안 / 검사 해석
  // ══════════════════════════════════════════════

  /** 실시간 감별진단 (Realtime DDx) */
  /**
   * 최근 검사(30일) 요약 — 항목별 최신값·이상치(H/L) 우선 정렬. AI 컨텍스트 서버측 주입용(A-9).
   * VERIFIED/COMPLETED만(임상 사용 가능 결과). 실패 시 빈 배열(비차단).
   */
  private async getRecentLabsSummary(patientId: string): Promise<string[]> {
    try {
      const since = new Date(Date.now() - 30 * 86400_000);
      const results = await this.prisma.labResult.findMany({
        where: { patientId, status: { in: ['COMPLETED', 'VERIFIED'] }, completedAt: { gte: since } },
        orderBy: { completedAt: 'desc' },
        take: 5,
        select: { items: { select: { testName: true, value: true, unit: true, flag: true } } },
      });
      const latest = new Map<string, { text: string; abnormal: boolean }>();
      for (const r of results) {
        for (const it of r.items) {
          if (latest.has(it.testName)) continue; // desc 순회 — 항목별 최신값만
          const abnormal = !!it.flag && it.flag !== 'N';
          latest.set(it.testName, { text: `${it.testName} ${it.value}${it.unit ?? ''}${it.flag && it.flag !== 'N' ? `(${it.flag})` : ''}`, abnormal });
        }
      }
      const all = [...latest.values()];
      return [...all.filter((x) => x.abnormal), ...all.filter((x) => !x.abnormal)].slice(0, 20).map((x) => x.text);
    } catch {
      return [];
    }
  }

  // ══════════════════════════════════════════════
  // P1 컨텍스트 빌더 = 배치 A 브리핑 주입 · 실시간 응답 캐시
  // ══════════════════════════════════════════════

  /**
   * 스킬 공통 환자 컨텍스트 — **브리핑(배치 A)** 이 있으면 재조회 없이 그것을 쓰고, `groundedOn` 에
   * `브리핑(<trigger> <computedAt>)` 를 적어 화면이 근거의 신선도를 알게 한다. 브리핑 서비스가 없거나 실패하면
   * 종전 직접 조회(알레르기 3상태·활성약·활성 문제·최근 검사 30일)로 접는다 — 같은 정본 값, 다른 신선도.
   */
  private async skillContext(patientId: string): Promise<{
    allergyLine: string; activeMedications: string[]; activeProblems: string[]; recentLabs: string[];
    groundedOn: string[]; brief: PatientBrief | null;
  }> {
    if (this.briefService) {
      try {
        const brief = await this.briefService.get(patientId);
        const allergySt = brief.allergy.status === 'UNAVAILABLE' ? null : { status: brief.allergy.status, allergies: brief.allergy.items.map((a) => ({ allergen: a })) };
        const labs = brief.recentLabs.map((l) => ({ text: `${l.testName} ${l.value}${l.unit ?? ''}${l.flag && l.flag !== 'N' ? `(${l.flag})` : ''}`, abnormal: !!l.flag && l.flag !== 'N' }));
        return {
          allergyLine: allergyPromptLine(allergySt),
          activeMedications: brief.activeMedications,
          activeProblems: brief.activeProblems,
          recentLabs: [...labs.filter((x) => x.abnormal), ...labs.filter((x) => !x.abnormal)].slice(0, 20).map((x) => x.text),
          groundedOn: [`브리핑(${brief.trigger} ${brief.computedAt})`, ...(brief.unavailable.length ? [`⚠️ 브리핑 미계산 축: ${brief.unavailable.join(',')}`] : [])],
          brief,
        };
      } catch (e) {
        this.logger.warn(`브리핑 조회 실패(${patientId}) — 직접 조회로 접음: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const [allergySt, meds, problems, recentLabs] = await Promise.all([
      this.allergyStatusOf(patientId),
      this.prisma.prescription.findMany({ where: { encounter: { patientId }, status: 'ACTIVE' }, select: { medicationCode: { select: { nameKo: true } } }, take: 50 }),
      this.prisma.problemList.findMany({ where: { patientId, status: 'ACTIVE' }, select: { description: true }, take: 20 }),
      this.getRecentLabsSummary(patientId),
    ]);
    return {
      allergyLine: allergyPromptLine(allergySt),
      activeMedications: [...new Set(meds.map((m) => m.medicationCode?.nameKo).filter((x): x is string => !!x))],
      activeProblems: problems.map((p) => p.description),
      recentLabs,
      groundedOn: [],
      brief: null,
    };
  }

  /** 키 순서·undefined 에 무관한 안정 직렬화(입력 해시용) */
  private static stableStringify(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map((x) => MedicalAiService.stableStringify(x)).join(',') + ']';
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + MedicalAiService.stableStringify(o[k])).join(',') + '}';
  }
  private static readonly SKILL_CACHE_TTL_SEC = 600;
  static skillCacheKey(skill: string, patientId: string, input: unknown): string {
    const h = createHash('sha256').update(patientId + MedicalAiService.stableStringify(input)).digest('hex');
    return `ai:skill:${skill}:${h}`;
  }

  /**
   * 실시간 응답 캐시 — 같은 환자·같은 입력의 재호출을 막는다(§4.6-a 실시간 층). **`source:'AI'` 만** 저장(실패·폴백은 캐시하지 않는다 —
   * 다음 호출이 다시 시도해야 한다). 캐시 응답은 `cached:true`·`cachedAt`(저장 시각) 을 달고 원본 `latencyMs` 를 그대로 둔다.
   * Redis 가 없거나 실패하면 캐시 없이 실행한다(던지지 않는다).
   */
  private async withSkillCache<T extends SkillEnvelope>(skill: string, patientId: string, input: unknown, run: () => Promise<T>): Promise<T & { cached?: boolean; cachedAt?: string }> {
    if (!this.redis) return run();
    const key = MedicalAiService.skillCacheKey(skill, patientId, input);
    try {
      const raw = await this.redis.get(key);
      if (raw) {
        const hit = JSON.parse(raw) as T & { cachedAt?: string };
        return { ...hit, cached: true, cachedAt: hit.cachedAt ?? new Date().toISOString() };
      }
    } catch (e) { this.logger.warn(`스킬 캐시 조회 실패(${skill}): ${e instanceof Error ? e.message : String(e)}`); }
    const out = await run();
    if (out && out.source === 'AI') {
      try { await this.redis.setex(key, MedicalAiService.SKILL_CACHE_TTL_SEC, JSON.stringify({ ...out, cachedAt: new Date().toISOString() })); }
      catch (e) { this.logger.warn(`스킬 캐시 저장 실패(${skill}): ${e instanceof Error ? e.message : String(e)}`); }
    }
    return out;
  }

  async realtimeDdx(params: {
    patientId: string;
    subjective: string;
    objective?: string;
    existingDiagnoses?: string[];
  }) {
    return this.withSkillCache('realtimeDdx', params.patientId, params, () => this.realtimeDdxRun(params));
  }
  private async realtimeDdxRun(params: {
    patientId: string;
    subjective: string;
    objective?: string;
    existingDiagnoses?: string[];
  }) {
    const startedAt = Date.now();
    // 환자 맥락 조회 — 알레르기 3상태·활성 문제·최근 검사는 브리핑(배치 A)에서(재조회 없음 · 없으면 직접 조회로 접음)
    const [patient, ctx] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: params.patientId },
        select: { dateOfBirth: true, gender: true, familyName: true, givenName: true },
      }),
      this.skillContext(params.patientId),
    ]);
    const groundedOn = ['S/O 텍스트', '알레르기 3상태', '활성 문제목록', '최근 검사(30일)', '기존 진단', ...ctx.groundedOn];
    const age = patient?.dateOfBirth
      ? ageOf(patient.dateOfBirth)
      : null;

    // AI API 호출: analyze (감별진단)
    // 🔴 알레르기는 3상태(미문진/없음 확인/확인 불가)로 AI 에게 말한다 — 활성 0건을 "없음"으로 전제하지 않는다
    const prompt = `환자 정보: ${age ? `${age}세` : '나이 미상'} ${patient?.gender === 'MALE' ? '남성' : patient?.gender === 'FEMALE' ? '여성' : ''}
알레르기: ${ctx.allergyLine}
활성 문제목록: ${promptList(ctx.activeProblems)}
최근 검사(30일·이상치 우선): ${promptList(ctx.recentLabs)}
기존 진단: ${promptList(params.existingDiagnoses)}

주관적 소견(S): ${params.subjective}
${params.objective ? `객관적 소견(O): ${params.objective}` : ''}

위 환자의 감별진단을 확률순으로 **반드시 3~5개** 제시하세요(빈 배열 금지 — 정보가 부족하면 가장 넓은 범주의 감별을 낮은 확률로 적으세요). 각 항목에 ICD-10 코드, 확률(%), 긴급도(CRITICAL/HIGH/MODERATE/LOW), 근거, 추천 검사를 포함하세요. 반드시 한국어.
JSON 형식으로 응답: { "differentials": [{ "rank", "code", "name", "probability", "urgency", "reasoning", "keyFindings": [], "suggestedQuestions": [] }], "suggestedTests": [{ "name", "priority", "reason" }], "redFlags": [] }`;

    try {
      const aiResult = await this.chatLlm([
        { role: 'system', content: '당신은 한국 종합병원 임상의사결정 지원 AI입니다. JSON만 출력하세요. 한국어.' },
        { role: 'user', content: prompt },
      ], { temperature: 0.3, num_predict: 800 });

      if (aiResult) {
        const parsedObj = extractJsonObject(aiResult) as Record<string, unknown> | null;
        // 형태 진단 로그(PHI 없이 — 길이·모양만): 운영에서 빈 배열/추출 실패의 원인을 보기 위해
        this.logger.debug?.(`realtimeDdx: answer len=${aiResult.length} braces=${(aiResult.match(/[{]/g) ?? []).length} extracted=${!!parsedObj} keys=${parsedObj ? Object.keys(parsedObj).slice(0, 8).join(',') : '-'} diffs=${Array.isArray(parsedObj?.differentials) ? (parsedObj!.differentials as unknown[]).length : Array.isArray((parsedObj as { __array?: unknown[] })?.__array) ? `arr:${((parsedObj as { __array?: unknown[] }).__array as unknown[]).length}` : 'n/a'}${parsedObj ? '' : ` shape=${aiResult.slice(0, 260).replace(/[가-힣0-9A-Za-z]/g, '·')}`}`);
        if (parsedObj) {
          try {
            // 모델이 배열을 `{ {…},{…} }` 로 낸 경우(운영 실측) → differentials 로 읽는다(rank 보정)
            const { __array: ddxArr, __truncated: ddxTrunc, ...ddxRest } = parsedObj as Record<string, unknown> & { __array?: unknown[]; __truncated?: boolean };
            const parsed: Record<string, unknown> = Array.isArray(ddxArr)
              ? { ...ddxRest, differentials: (ddxArr as Record<string, unknown>[]).map((d, i) => ({ rank: i + 1, ...d })), ...(ddxTrunc ? { truncated: true } : {}) }
              : ddxRest;
            if (ddxTrunc) groundedOn.push('⚠️ 모델 답변이 잘려 완결된 항목만 표시');
            // 모델이 감별과 검사를 한 집합에 섞어 낸다(운영 실측: "심전도 검사"가 감별진단으로) — 검사 어휘는 suggestedTests 로 옮긴다
            if (Array.isArray(parsed.differentials)) {
              const TEST_WORD = /(검사|측정|촬영|영상|X-?ray|CT|MRI|초음파|ECG|EKG|심전도|채혈|배양|패널)/i;
              const diffs = parsed.differentials as Record<string, unknown>[];
              // 🔴 2026-08-25 실측 봉합 — 운영 폐기 16건 중 9건이 `EMPTY_RESULT` 였고 로그는
              //    `extracted=true keys=__array diffs=n/a` 였다(추출은 됐는데 항목이 0).
              //    원인: 모델이 진단명을 `name` 이 아닌 다른 키(`diagnosis`·`condition`·`disease`·`진단명`)로 낸다.
              //    `String(d.name ?? '')` 는 그때 빈 문자열이 되어 **검사 어휘 판정도, 이름 표시도 못 한다.**
              //    이름 후보를 넓혀 읽고 `name` 으로 정규화한다 — 모델 출력 어휘를 우리가 강제할 수 없으므로
              //    **읽는 쪽이 유연해야 한다**(단, 지어내지 않는다 — 후보가 전부 비면 그대로 빈 이름이다).
              const nameOf = (d: Record<string, unknown>): string =>
                String(d.name ?? d.diagnosis ?? d.condition ?? d.disease ?? d['진단명'] ?? d['진단'] ?? d.title ?? '').trim();
              const named: Record<string, unknown>[] = diffs.map((d) => ({ ...d, name: nameOf(d) }));
              const tests = named.filter((d) => TEST_WORD.test(String(d.name ?? '')));
              parsed.differentials = named.filter((d) => !TEST_WORD.test(String(d.name ?? ''))).map((d, i) => ({ ...d, rank: i + 1 }));
              const prevTests = Array.isArray(parsed.suggestedTests) ? (parsed.suggestedTests as unknown[]) : [];
              parsed.suggestedTests = [...prevTests, ...tests.map((t) => ({ name: String(t.name), priority: 'ROUTINE', reason: String(t.reasoning ?? t.reason ?? '') }))];
            }
            const base = await this.withDisclaimer({
              patientId: params.patientId,
              patientName: patient ? `${patient.familyName}${patient.givenName}` : null,
              age,
              differentials: [], suggestedTests: [], redFlags: [],
              ...parsed,
            });
            // 🔴 출력 계약 — 빈 배열은 "성공"이 아니다. 실측(2026-08-19): 15~23초 뒤 [] 가 source 없이 나가 화면이 "아직 안 눌렀다"처럼 그렸다.
            const text = textOf(parsed);
            return finalizeSkill(base, startedAt, [
              checkNonEmpty('differentials', base.differentials),
              checkKorean(text),
              checkNoMixedScript(text),
              checkSexAgeAppropriate(text, patient?.gender, age),
            ], { groundedOn });
          } catch {
            this.logger.warn('realtimeDdx: LLM 응답 JSON 파싱 실패');
          }
        }
      }
    } catch (e) {
      this.logger.warn(`realtimeDdx AI error: ${e}`);
    }

    // 폴백: 기존 analyze API
    try {
      const symptoms = params.subjective.split(/[,，\s]+/).filter(Boolean);
      const analyzeResult = await this.analyze({ symptoms, age: age ?? undefined, sex: patient?.gender === 'MALE' ? 'M' : 'F' });
      const fb = await this.withDisclaimer({
        patientId: params.patientId,
        patientName: patient ? `${patient.familyName}${patient.givenName}` : null,
        age,
        differentials: analyzeResult?.diagnoses?.map((d: any, i: number) => ({
          rank: i + 1,
          code: d.icd_code ?? '',
          name: d.name ?? d.diagnosis,
          probability: Math.round((d.confidence ?? 0.5) * 100),
          urgency: d.urgency ?? (i === 0 ? 'HIGH' : 'MODERATE'),
          reasoning: d.reasoning ?? d.reason ?? '',
          keyFindings: d.key_findings ?? [],
          suggestedQuestions: d.questions ?? [],
        })) ?? [],
        suggestedTests: analyzeResult?.suggested_tests ?? [],
        redFlags: analyzeResult?.red_flags ?? [],
      });
      // 규칙 기반 폴백 — AI 소견이 아니라고 말한다
      return finalizeSkill(fb, startedAt, [checkNonEmpty('differentials', fb.differentials)], { groundedOn, sourceOverride: { source: 'FALLBACK', reason: fb.differentials.length ? 'UPSTREAM_FALLBACK' : 'EMPTY_RESULT' } });
    } catch (e) {
      this.logger.warn(`realtimeDdx fallback error: ${e}`);
      return this.upstreamFailedSkill(await this.withDisclaimer({ patientId: params.patientId, differentials: [], suggestedTests: [], redFlags: [] }), startedAt, e, groundedOn);
    }
  }

  /** SOAP 자동 초안 (Auto-SOAP) */
  async autoSoap(params: {
    patientId: string;
    subjective: string;
    objective?: string;
    differentials?: Record<string, unknown>[];
    existingMedications?: string[];
    deidentify?: boolean; // PHI 최소화(D-2) — 기본 true: 성명 미전송('환자'), 연령/성별만. 명시적 false만 실명 포함.
  }) {
    return this.withSkillCache('autoSoap', params.patientId, params, () => this.autoSoapRun(params));
  }
  private async autoSoapRun(params: {
    patientId: string;
    subjective: string;
    objective?: string;
    differentials?: Record<string, unknown>[];
    existingMedications?: string[];
    deidentify?: boolean;
  }) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: params.patientId },
      select: { dateOfBirth: true, gender: true, familyName: true, givenName: true },
    });
    const age = patient?.dateOfBirth
      ? ageOf(patient.dateOfBirth)
      : null;
    const nameLabel = params.deidentify === false ? (patient ? `${patient.familyName}${patient.givenName}` : '미상') : '환자';
    const startedAt = Date.now();
    // 현재 약물: 클라가 넘긴 목록이 우선 · 없으면 브리핑(배치 A)의 활성약(브리핑 서비스가 있을 때만 — 종전엔 이 줄이 없었다)
    let meds = params.existingMedications?.filter((x) => typeof x === 'string' && x.length > 0) ?? [];
    let medsBasis: string[] = meds.length ? ['현재 약물(클라 전달)'] : [];
    if (!meds.length && this.briefService) {
      const ctx = await this.skillContext(params.patientId);
      if (ctx.brief) { meds = ctx.activeMedications; medsBasis = ['현재 약물(브리핑)', ...ctx.groundedOn]; }
    }
    const groundedOn = ['S/O 텍스트', ...(params.differentials?.length ? ['감별진단 결과'] : []), ...medsBasis];

    const prompt = `환자: ${nameLabel}, ${age ? `${age}세` : ''} ${patient?.gender === 'MALE' ? '남' : patient?.gender === 'FEMALE' ? '여' : ''}
주관적 소견(S): ${params.subjective}
${params.objective ? `객관적 소견(O): ${params.objective}` : ''}
${params.differentials?.length ? `감별진단: ${params.differentials.map((d: any) => `${d.name}(${d.probability}%)`).join(', ')}` : ''}
${meds.length ? `현재 약물: ${meds.join(', ')}` : ''}

위 정보를 바탕으로 Assessment와 Plan 초안을 작성하세요. **반드시 한국어로만** 작성하세요(의학 약어 제외 — 영어 문장 금지).
JSON 형식: { "assessment": "...", "plan": "1. ...\n2. ...", "confidence": 0.0~1.0, "references": ["가이드라인명"] }`;

    /**
     * 제안 원장 입력 스냅샷(P1) — **서버가 조립해 실제로 상류로 보낸 프롬프트 전문**의 sha256.
     * 🔴 해시만 남긴다(원문은 PHI). 승인 시점에 다시 계산해 다르면 "입력이 바뀌었다"를 말할 수 있게 하는 값이다.
     */
    const inputSnapshotHash = createHash('sha256').update(prompt).digest('hex');
    /** 상류가 보고한 모델 태그를 받는 자리 — 안 주면 undefined 로 남고 `modelRef` 는 null(미보고) */
    const modelMeta: { model?: string | null } = {};
    /** 제안 원장이 읽는 세 값을 응답 봉투에 붙인다(컨트롤러가 `AiProposal.create` 로 옮긴다) */
    const stamp = <T extends object>(o: T, promptVersion: string, modelRef: string | null) =>
      ({ ...o, promptVersion, inputSnapshotHash, modelRef });

    try {
      const runOnce = async (retryNote?: string) => {
        const aiResult = await this.chatLlm([
          { role: 'system', content: '당신은 한국 종합병원의 진료기록 AI 초안 작성자입니다. JSON만 출력. 반드시 한국어(영어 문장 금지). 의학적으로 정확하게.' },
          ...(retryNote ? [{ role: 'system', content: retryNote }] : []),
          { role: 'user', content: prompt },
        ], { temperature: 0.4, num_predict: 600 }, modelMeta);
        const parsedRaw = extractJsonObject(aiResult) as Record<string, unknown> | null;
        if (!parsedRaw) return null;
        const { __array: _sa, __truncated: _st, ...parsed } = parsedRaw as Record<string, unknown>;
        const base = await this.withDisclaimer({ assessment: '', plan: '', confidence: null, references: [], ...parsed });
        const text = [base.assessment, Array.isArray(base.plan) ? base.plan.join('\n') : base.plan].filter(Boolean).join('\n');
        // 🔴 실측(2026-08-19): 영어 초안 + "ACS 에서 아스피린 회피" — 검증층 없이는 그대로 폼에 들어간다
        return finalizeSkill(base, startedAt, [
          checkNonEmpty('assessment', base.assessment),
          checkKorean(text),
          checkNoMixedScript(text),
          checkForbiddenAdvice(text),
          checkSexAgeAppropriate(text, patient?.gender, age),
        ], { groundedOn });
      };
      let out = await runOnce();
      // 영어 답변만 문제면 한 번 더(운영 재실측: 한국어 지시에도 영어로 답함) — 두 번째도 실패면 첫 결과를 FALLBACK 으로 그대로 낸다. 시간 예산 20초 안에서만
      if (out && out.source === 'FALLBACK' && out.verify.failed.length === 1 && out.verify.failed[0].startsWith('KOREAN') && Date.now() - startedAt < 20_000) {
        const again = await runOnce('이전 답변이 영어였습니다. 반드시 한국어 문장으로만 다시 작성하세요(약어 제외).').catch(() => null);
        if (again && again.source === 'AI') out = again;
      }
      if (out) return stamp(out, AUTO_SOAP_PROMPT_VERSION_AI, modelMeta.model ?? null);
    } catch (e) {
      this.logger.warn(`autoSoap AI error: ${e}`);
    }

    // 폴백: 기존 summarize → draft 체이닝
    try {
      const draftResult = await this.draft('assessment_plan', {
        subjective: params.subjective,
        objective: params.objective,
        differentials: params.differentials,
      });
      const fb = await this.withDisclaimer({
        assessment: draftResult?.assessment ?? '',
        plan: draftResult?.plan ?? '',
        confidence: null as number | null,
        references: [] as string[],
      });
      // 🔴 규칙/체이닝 폴백은 LLM 프롬프트의 산출물이 아니다 — modelRef 는 null(앞선 시도의 모델을 여기 적으면 거짓말)
      return stamp(
        finalizeSkill(fb, startedAt, [checkNonEmpty('assessment', fb.assessment), checkKorean(`${fb.assessment}\n${fb.plan}`), checkForbiddenAdvice(`${fb.assessment}\n${fb.plan}`)], { groundedOn, sourceOverride: { source: 'FALLBACK', reason: fb.assessment ? 'UPSTREAM_FALLBACK' : 'EMPTY_RESULT' } }),
        AUTO_SOAP_PROMPT_VERSION_FALLBACK,
        null,
      );
    } catch (e) {
      return stamp(
        this.upstreamFailedSkill(await this.withDisclaimer({ assessment: '', plan: '', confidence: null, references: [] }), startedAt, e, groundedOn),
        AUTO_SOAP_PROMPT_VERSION_FALLBACK,
        null,
      );
    }
  }

  /** 검사 결과 해석 (Lab Interpretation) */
  async interpretLab(params: {
    patientId: string;
    results: { testName: string; value: string; unit?: string; normalMin?: number; normalMax?: number; flag?: string | null }[];
    clinicalContext?: string;
  }) {
    return this.withSkillCache('interpretLab', params.patientId, params, () => this.interpretLabRun(params));
  }
  private async interpretLabRun(params: {
    patientId: string;
    results: { testName: string; value: string; unit?: string; normalMin?: number; normalMax?: number; flag?: string | null }[];
    clinicalContext?: string;
  }) {
    const startedAt = Date.now();
    const [patient, ctx] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: params.patientId },
        select: { dateOfBirth: true, gender: true, familyName: true, givenName: true },
      }),
      this.skillContext(params.patientId),
    ]);
    const groundedOn = ['전달된 검사 결과(값·flag·기준치)', '활성 문제목록', '현재 복용약물', '직전 확정 검사(30일)', ...ctx.groundedOn];
    const age = patient?.dateOfBirth
      ? ageOf(patient.dateOfBirth)
      : null;

    // 🔴 LIS 가 준 flag(H/L/HH/LL)가 정본 — 기준치가 없어도 방향을 안다. 종전엔 flag 를 버리고 normalMin/Max 만 봐서
    //    K 5.9(H) 를 방향 없이 보냈고 모델이 "저하"라 답했다(2026-08-19 실측).
    const effFlag = (r: { value: string; normalMin?: number; normalMax?: number; flag?: string | null }): LabFlag => {
      const f = (r.flag ?? '').toString().toUpperCase();
      if (f === 'H' || f === 'HH' || f === 'L' || f === 'LL') return f;
      const val = parseFloat(r.value);
      if (!isNaN(val)) {
        if (r.normalMax != null && val > r.normalMax) return 'H';
        if (r.normalMin != null && val < r.normalMin) return 'L';
      }
      return f === 'N' ? 'N' : '';
    };
    const labInputs = params.results.map((r) => ({ testName: r.testName, value: r.value, flag: effFlag(r) }));
    const labText = params.results.map((r, i) => {
      const flag = labInputs[i].flag;
      const arrow = flag === 'H' ? ' ↑(높음)' : flag === 'HH' ? ' ↑↑(위급 높음)' : flag === 'L' ? ' ↓(낮음)' : flag === 'LL' ? ' ↓↓(위급 낮음)' : flag === 'N' ? ' (정상)' : '';
      return `- ${r.testName}: ${r.value} ${r.unit ?? ''}${arrow} (정상: ${r.normalMin ?? '?'}~${r.normalMax ?? '?'})`;
    }).join('\n');

    // 활성 문제·복용약물(검사 해석 맥락 — 예: 신질환→크레아티닌·이뇨제→전해질) + 직전 검사 추이(A-9) — 브리핑(배치 A)에서
    const prompt = `환자: ${age ? `${age}세` : ''} ${patient?.gender === 'MALE' ? '남' : patient?.gender === 'FEMALE' ? '여' : ''}
임상 맥락: ${params.clinicalContext ?? '미입력'}
활성 문제목록: ${promptList(ctx.activeProblems)}
현재 복용약물: ${promptList(ctx.activeMedications)}
직전 확정 검사(30일·추이 비교용): ${promptList(ctx.recentLabs)}

검사 결과:
${labText}

위 검사 결과를 해석하세요. **전달된 검사 항목만** 해석하고(목록에 없는 검사는 언급 금지), 표시된 방향(↑/↓)과 반대로 말하지 마세요. 반드시 한국어.
JSON 형식: { "summary": "한줄요약", "findings": [{ "test": "검사명", "interpretation": "해석", "severity": "CRITICAL|HIGH|MODERATE|NORMAL" }], "clinicalImplication": "종합 임상 의미", "suggestedActions": ["추가검사/조치"], "confidence": 0.0~1.0 }`;

    try {
      const aiResult = await this.chatLlm([
        { role: 'system', content: '당신은 한국 종합병원의 진단검사의학 AI입니다. JSON만 출력. 한국어. 정확한 수치 해석.' },
        { role: 'user', content: prompt },
      ], { temperature: 0.3, num_predict: 800 });

      if (aiResult) {
        const parsedObj = extractJsonObject(aiResult) as Record<string, unknown> | null;
        this.logger.debug?.(`interpretLab: answer len=${aiResult.length} braces=${(aiResult.match(/[{]/g) ?? []).length} extracted=${!!parsedObj} keys=${parsedObj ? Object.keys(parsedObj).slice(0, 8).join(',') : '-'}`);
        if (parsedObj) {
          try {
            const { __array, __truncated, ...rest } = parsedObj as Record<string, unknown> & { __array?: unknown[]; __truncated?: boolean };
            const parsed: Record<string, unknown> = Array.isArray(__array) ? { ...rest, findings: __array } : rest;
            if (__truncated) groundedOn.push('⚠️ 모델 답변이 잘려 완결된 항목만 표시');
            const base = await this.withDisclaimer({ summary: '', findings: [] as { test: string; interpretation?: string; severity?: string }[], clinicalImplication: '', suggestedActions: [] as string[], confidence: null as number | null, ...parsed });
            const findings = Array.isArray(base.findings) ? base.findings : [];
            const text = textOf(parsed);
            // 🔴 방향 대조·미입력 검사 언급·성별/연령 부적합 — 실측 3건 전부 여기서 잡힌다
            return finalizeSkill(base, startedAt, [
              checkNonEmpty('findings', findings),
              checkLabDirection(labInputs, findings),
              checkMentionsOnlyProvidedTests(labInputs, findings),
              checkSexAgeAppropriate(text, patient?.gender, age),
              checkKorean(text),
              checkNoMixedScript(text),
            ], { groundedOn });
          } catch {
            this.logger.warn('interpretLab: LLM 응답 JSON 파싱 실패');
          }
        }
      }
    } catch (e) {
      this.logger.warn(`interpretLab AI error: ${e}`);
    }

    // 폴백: 단순 이상치 감지 — 🔴 LIS flag 가 있으면 그것이 정본(기준치가 없어도 "정상 범위"라 말하지 않는다 — 운영 재실측: K 5.9(H) 를 규칙 폴백이 "정상 범위"로 냈다)
    const findings = params.results.map((r, i) => {
      const val = parseFloat(r.value);
      let severity: string = 'NORMAL';
      let interpretation = '정상 범위';
      const f = labInputs[i].flag;
      if (f === 'HH') { severity = 'CRITICAL'; interpretation = '위급 높음(LIS flag HH)'; }
      else if (f === 'LL') { severity = 'CRITICAL'; interpretation = '위급 낮음(LIS flag LL)'; }
      else if (f === 'H') { severity = 'MODERATE'; interpretation = '높음(LIS flag H)'; }
      else if (f === 'L') { severity = 'MODERATE'; interpretation = '낮음(LIS flag L)'; }
      else if (!f && r.normalMin == null && r.normalMax == null) { severity = 'UNKNOWN'; interpretation = '판정 불가(flag·기준치 없음)'; }

      if (severity === 'NORMAL' && !isNaN(val) && r.normalMax != null && val > r.normalMax) {
        const ratio = val / r.normalMax;
        severity = ratio > 10 ? 'CRITICAL' : ratio > 3 ? 'HIGH' : 'MODERATE';
        interpretation = `정상 상한 (${r.normalMax})의 ${ratio.toFixed(1)}배 상승`;
      } else if (severity === 'NORMAL' && !isNaN(val) && r.normalMin != null && val < r.normalMin) {
        severity = 'MODERATE';
        interpretation = `정상 하한 (${r.normalMin}) 미만`;
      }

      return { test: r.testName, interpretation, severity };
    });

    const abnormals = findings.filter(f => f.severity !== 'NORMAL' && f.severity !== 'UNKNOWN');
    const unknowns = findings.filter(f => f.severity === 'UNKNOWN');
    const fb = await this.withDisclaimer({
      summary: abnormals.length > 0 ? `이상 소견 ${abnormals.length}건 감지(규칙 기반)` : unknowns.length ? `판정 불가 ${unknowns.length}건(flag·기준치 없음 · 규칙 기반)` : '전달된 검사 기준치 범위 내(규칙 기반 · AI 소견 아님)',
      findings,
      clinicalImplication: abnormals.length > 0 ? '이상 소견에 대한 추가 임상 판단 필요' : '규칙 기반 판정 — 임상 의미는 산출하지 않았습니다',
      suggestedActions: abnormals.filter(f => f.severity === 'CRITICAL').map(f => `${f.test} — 긴급 확인 필요`),
      confidence: null as number | null,
    });
    return finalizeSkill(fb, startedAt, [], { groundedOn: ['전달된 검사 결과(기준치만)'], sourceOverride: { source: 'FALLBACK', reason: 'UPSTREAM_FALLBACK' } });
  }

  /**
   * 검증층 규칙 6 임계 — 약가마스터 미매칭 추천 허용 비율(config `ai.skill.quality.maxUnresolvedDrugRatio`).
   * `positiveNumberOr` 규약(유한 양수만 채택)에 1 상한을 더한다. 조회 실패는 코드 기본(0.5)으로 접는다.
   */
  private async maxUnresolvedDrugRatio(): Promise<number> {
    const raw = await this.runtimeConfig.get('ai.skill.quality.maxUnresolvedDrugRatio').catch(() => null);
    return Math.min(1, positiveNumberOr(raw, 0.5));
  }

  /** 약물 추천 (Drug Recommendation) */
  async recommendDrugs(params: {
    patientId: string;
    diagnosis: string;
    patientContext?: {
      age?: number;
      eGFR?: number;
      allergies?: string[];
      currentMedications?: string[];
    };
    /** DUR 정본 재검증이 볼 진료 — 없으면 환자 최근 진료 → 그것도 없으면 ZERO_UUID(임신·현 진료 처방 점검 생략 · basis 에 명시) */
    encounterId?: string;
  }) {
    return this.withSkillCache('recommendDrugs', params.patientId, params, () => this.recommendDrugsRun(params));
  }
  private async recommendDrugsRun(params: {
    patientId: string;
    diagnosis: string;
    patientContext?: { age?: number; eGFR?: number; allergies?: string[]; currentMedications?: string[] };
    encounterId?: string;
  }) {
    const startedAt = Date.now();
    const [patient, ctx] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: params.patientId },
        select: { dateOfBirth: true, gender: true },
      }),
      this.skillContext(params.patientId),
    ]);
    const age = params.patientContext?.age ?? (patient?.dateOfBirth
      ? ageOf(patient.dateOfBirth)
      : null);

    const groundedOn = ['진단(입력)', '알레르기 3상태', '현재 약물', '활성 문제', '최근 검사(30일)', '활성 약속처방 목록', ...ctx.groundedOn];
    // 알레르기 — 클라가 명시적으로 넘긴 목록(1건 이상)이 있으면 그것, 아니면 서버 3상태 정본(빈 배열은 "없음"이 아니다)
    const clientAllergies = params.patientContext?.allergies?.filter((x) => typeof x === 'string' && x.length > 0) ?? [];
    const allergyLine = clientAllergies.length ? clientAllergies.join(', ') : ctx.allergyLine;

    // 현재 복용약물(병용금기·상호작용 반영) — 클라 미전달 시 서버 보강(브리핑)
    const currentMeds = params.patientContext?.currentMedications ?? ctx.activeMedications;

    // 활성 문제목록(약물-질환 금기 반영) + 최근 검사(신기능·전해질·간기능 용량 조정 반영 — A-9)
    const activeProblems = ctx.activeProblems;
    const drugRecentLabs = ctx.recentLabs;

    // P3-a: orderSetSuggested를 실제 ACTIVE 약속처방 코드로 강제(자유 텍스트 환각 차단) — 목록 주입 후 DB 재검증
    const activeSets = await this.prisma.orderSet.findMany({
      where: { isActive: true, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, diagnosisCode: true, items: true, ageGroup: true, contraindications: true },
      orderBy: { useCount: 'desc' },
      take: 30,
    });
    const setCatalog = activeSets.map((s) => `${s.code}: ${s.name}${s.diagnosisCode ? ` (${s.diagnosisCode})` : ''}`).join('\n');

    const prompt = `환자: ${age ? `${age}세` : ''} ${patient?.gender === 'MALE' ? '남' : patient?.gender === 'FEMALE' ? '여' : ''}
진단: ${params.diagnosis}
알레르기: ${allergyLine}
${params.patientContext?.eGFR ? `eGFR: ${params.patientContext.eGFR} mL/min` : ''}
현재 약물: ${promptList(currentMeds)}
활성 문제: ${promptList(activeProblems)}
최근 검사(30일·이상치 우선 — 신기능/전해질/간기능 용량조정 반영): ${promptList(drugRecentLabs)}

원내 활성 약속처방 목록(orderSetSuggested는 반드시 이 목록의 code 값 중 하나, 해당 없으면 null):
${setCatalog || '(없음)'}

가이드라인 기반 약물 추천을 하세요(2~4개). 반드시 한국어(성분명은 한글 병기 가능).
JSON 형식(모든 키 필수):
{ "recommendations": [ { "ingredient": "metformin", "name": "메트포르민", "dosage": "1일 2회 500mg", "reason": "...", "guideline": "...", "modelNote": "..." } ], "contraindicated": ["금기사항"], "orderSetSuggested": "위 목록의 code 또는 null" }
"ingredient" 는 위 예시처럼 **영문 성분명(INN) 한 개**만 씁니다 — 상품명·함량·염·제형 금지("metformin" O / "Glucophage"·"metformin HCl 500mg 서방정" X).
복합제는 성분별로 나누어 각각 한 줄로 적으세요. 확실한 성분명을 모르면 그 약을 빼세요(지어내지 마세요).`;

    try {
      const runOnce = async (retryNote?: string) => {
      const aiResult = await this.chatLlm([
        // 🔴 `ingredient` 요구는 **system** 에 둔다 — user 프롬프트 안에만 적었을 때 qwen2.5:14b 는 이 키를 통째로
        //    빼먹었다(2026-08-20 실측 5진단 0/5 준수). system 으로 올리고 JSON 예시의 첫 키로 두니 12/12 준수.
        { role: 'system', content: '당신은 한국 종합병원의 약물 추천 AI입니다. JSON만 출력. 반드시 한국어(영어 문장 금지). 가이드라인 근거. 모든 recommendations 항목에는 "ingredient"(영문 성분명 INN 한 개, 상품명·함량·염 표기 제외)를 반드시 포함하세요.' },
        ...(retryNote ? [{ role: 'system', content: retryNote }] : []),
        { role: 'user', content: prompt },
      ], { temperature: 0.3, num_predict: 600 });

      if (aiResult) {
        const parsedObj = extractJsonObject(aiResult) as Record<string, any> | null;
        if (parsedObj) {
          try {
            const { __array: _a, __truncated: _t, ...parsed } = parsedObj as Record<string, any>;
            // DB 재검증: 목록에 실재하는 코드만 인정 — 실 OrderSet(items 포함) 동봉해 FE 클릭 적용 가능하게
            const matched = parsed.orderSetSuggested
              ? activeSets.find((s) => s.code === String(parsed.orderSetSuggested).trim())
              : null;
            parsed.orderSetSuggested = matched?.code ?? null;
            parsed.orderSet = matched
              ? { id: matched.id, code: matched.code, name: matched.name, items: matched.items, ageGroup: matched.ageGroup, contraindications: matched.contraindications }
              : null;
            // 🔴 LLM 이 적은 "cdssCheck: PASS" 는 판정이 아니다 — 문자열을 판정처럼 보이게 두지 않는다.
            //    판정은 **DUR 정본 재검증**(drug-verdict.ts · P1)만이 낸다: 약가마스터 정본 검색으로 특정 → DurService.checkInteractions.
            //    특정 못 하면 UNRESOLVED · 서비스 부재/오류면 null + "재검증 실패"(PASS 를 지어내지 않는다).
            const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
            const enc = this.durService ? await resolveEncounterForDur(this.prisma as any, params.patientId, params.encounterId) : null;
            await Promise.all(recs.map(async (r: any) => {
              if (!r || typeof r !== 'object') return;
              if ('cdssCheck' in r) { r.modelNote = r.modelNote ?? r.cdssCheck; delete r.cdssCheck; }
              const v = await verdictForRecommendation(
                { prisma: this.prisma as any, dur: this.durService },
                {
                  name: String(r.name ?? ''),
                  // 🔴 성분(INN) 힌트 — 프롬프트 계약(§4.2 약물추천). 있으면 복합제를 제외한 성분 경로로 특정한다.
                  //    LLM 이 안 냈거나 틀리면 조용히 약명 경로로 내려간다(힌트 부재를 실패로 만들지 않는다).
                  ingredient: typeof r.ingredient === 'string' ? r.ingredient : null,
                  dosage: typeof r.dosage === 'string' ? r.dosage : null,
                  patientId: params.patientId, encounterId: enc?.encounterId ?? '', encounterNote: enc?.note ?? null,
                },
              );
              r.durVerdict = v.durVerdict;
              r.durVerdictBasis = v.durVerdictBasis;
              r.durWarnings = v.durWarnings;
              if (v.medicationCodeId) r.medicationCodeId = v.medicationCodeId;
              if (v.resolvedName) r.resolvedName = v.resolvedName;
              // 특정 방식(EXACT/INGREDIENT_GROUP/AMBIGUOUS/NONE) — 화면이 '성분 대표 판정'을 구분해 그린다
              if (v.resolution) r.resolution = v.resolution;
            }));
            const base = await this.withDisclaimer({ recommendations: recs, contraindicated: parsed.contraindicated ?? [], orderSetSuggested: parsed.orderSetSuggested ?? null, orderSet: parsed.orderSet ?? null });
            const text = textOf(parsed);
            // 🔴 규칙 6(§4.4 drugsResolvable) — 약가마스터에 **전혀 매칭되지 않은** 추천이 임계를 넘으면 AI 로 내보내지 않는다.
            //    2026-08-20 실측: 6건 중 4건이 미매칭인 응답이 `source:'AI'` 로 나갔다(`나이아즈올` 은 존재하지 않는 약이다).
            //    + 약명 한정 표기 혼입 규칙 — 본문 규칙(MIXED_SCRIPT)은 키릴·가나만 봐서 `로바statin` 을 통과시켰다.
            return finalizeSkill(base, startedAt, [
              checkNonEmpty('recommendations', recs),
              checkKorean(text),
              checkNoMixedScript(text),
              checkSexAgeAppropriate(text, patient?.gender, age),
              checkDrugNameScript(recs.map((r: any) => (r && typeof r === 'object' ? r.name : null))),
              checkDrugsResolvable(recs as Array<{ resolution?: string }>, await this.maxUnresolvedDrugRatio()),
            ], { groundedOn });
          } catch {
            this.logger.warn('recommendDrugs: LLM 응답 JSON 파싱 실패');
          }
        }
      }
      return null;
      };
      let out = await runOnce();
      // 재시도는 시간 예산 안에서만(운영 실측: 재시도가 60초 게이트웨이 타임아웃을 넘겨 504) — 20초 넘게 걸렸으면 FALLBACK 그대로 낸다
      if (out && out.source === 'FALLBACK' && out.verify.failed.length === 1 && out.verify.failed[0].startsWith('KOREAN') && Date.now() - startedAt < 20_000) {
        const again = await runOnce('이전 답변이 영어였습니다. 반드시 한국어 문장으로만 다시 작성하세요(성분명은 한글 병기).').catch(() => null);
        if (again && again.source === 'AI') out = again;
      }
      // 🔴 약가마스터에 없는 약(환각)으로 폐기됐으면 **어떤 이름이 없었는지 알려주고** 한 번만 다시 부른다.
      //    후보를 제안하지는 않는다 — 비슷한 이름을 골라 주면 "지어낸 약"이 "그럴듯한 다른 약"으로 바뀔 뿐이다.
      //    시간 예산은 KOREAN 재시도와 같은 규약(게이트웨이 60초 · 실측상 1회 호출 12~20초).
      if (out && out.source === 'FALLBACK' && out.verify.failed.some((f) => f.startsWith('DRUGS_RESOLVABLE')) && Date.now() - startedAt < 20_000) {
        const unmatched = (Array.isArray((out as any).recommendations) ? (out as any).recommendations : [])
          .filter((r: any) => r && r.resolution === 'NONE')
          .map((r: any) => String(r.ingredient ?? r.name ?? '').trim())
          .filter(Boolean);
        if (unmatched.length) {
          const again = await runOnce(
            `이전 답변의 성분명 ${unmatched.map((u: string) => `'${u}'`).join(', ')} 은(는) 국내 약가마스터에 없습니다. `
            + '표준 영문 성분명(INN)으로 바꾸거나, 확실하지 않으면 그 약을 빼고 다시 작성하세요. 없는 약을 지어내지 마세요.',
          ).catch(() => null);
          if (again && again.source === 'AI') out = again;
        }
      }
      if (out) return out;
    } catch (e) {
      this.logger.warn(`recommendDrugs AI error: ${e}`);
    }

    return failedSkill(await this.withDisclaimer({ recommendations: [], contraindicated: [], orderSetSuggested: null, orderSet: null }), startedAt, 'EMPTY_RESULT', groundedOn);
  }

  /**
   * P3-b: AI 약속처방 초안 생성 (관리 도구) — 진단/질환명 기반 items 초안을 DRAFT로만 저장.
   * 항목은 name-only(미해석)로 생성 → 기존 해석 콘솔(P0)에서 사람이 코드 확정 → 승인 상태머신 그대로.
   * AI는 초안, 승인은 사람 — 미해석 승격 게이트가 자동 ACTIVE를 이중 방어.
   */
  async draftOrderSet(params: { diagnosis: string; diagnosisCode?: string; department?: string }, userId?: string) {
    const prompt = `질환: ${params.diagnosis}${params.diagnosisCode ? ` (KCD ${params.diagnosisCode})` : ''}
${params.department ? `진료과: ${params.department}` : ''}

이 질환의 표준 외래 약속처방(order set) 초안을 만드세요. 약물은 성분명+용량, 검사/영상은 표준 검사명.
JSON 형식: { "name": "세트명", "items": [{ "type": "MEDICATION|LAB|IMAGING", "name": "항목명", "dosage": "용량(약물만)", "frequency": "횟수(약물만)", "duration": 일수(약물만, 숫자) }] }`;

    const aiResult = await this.chatLlm([
      { role: 'system', content: '당신은 한국 종합병원 처방 표준화 AI입니다. JSON만 출력. 한국어.' },
      { role: 'user', content: prompt },
    ], { temperature: 0.3, num_predict: 700 });

    const jsonMatch = aiResult?.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 초안 생성 실패 — 응답 없음');
    // 🔴 LLM 이 `{...}` 모양이나 유효하지 않은 JSON 을 내면 raw SyntaxError 로 크래시한다(흔한 실패).
    //    바로 위 '응답 없음'과 같은 우아한 실패 계약에 맞춰 파싱 오류도 의미 있는 메시지로 던진다.
    let parsed: { name?: string; items?: { type?: string; name?: string; dosage?: string; frequency?: string; duration?: number }[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('AI 초안 생성 실패 — 응답 형식 오류(JSON 파싱 불가)');
    }
    const items = (parsed.items ?? [])
      .filter((it) => it?.name && ['MEDICATION', 'LAB', 'IMAGING'].includes(it.type ?? ''))
      .slice(0, 20)
      .map((it) => ({
        type: it.type!, name: String(it.name).slice(0, 200),
        ...(it.type === 'MEDICATION' ? { dosage: it.dosage, frequency: it.frequency, duration: it.duration } : {}),
        isDefault: true,
      }));
    if (!items.length) throw new Error('AI 초안 생성 실패 — 유효 항목 없음');

    const created = await this.prisma.orderSet.create({
      data: {
        name: `[AI초안] ${parsed.name ?? params.diagnosis}`.slice(0, 190),
        code: `CP-AI-${Date.now().toString(36).toUpperCase()}`,
        category: 'DISEASE',
        department: params.department ?? null,
        diagnosisCode: params.diagnosisCode ?? null,
        description: `AI 생성 초안 — 코드 해석·검토·승인 필요 (질환: ${params.diagnosis})`,
        items: items as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
        createdBy: userId ?? null,
      },
    });
    return { id: created.id, name: created.name, itemCount: items.length, note: '미해석 초안 — 해석 콘솔에서 코드 확정 후 승인 절차 진행' };
  }

  // ══════════════════════════════════════════════
  // AI 진료 보조 Phase 2: 의무기록 품질검사
  // ══════════════════════════════════════════════

  /** 의무기록 품질검사 (Chart QA) */
  async chartQa(params: {
    encounterId?: string;
    subjective: string;
    objective?: string;
    assessment?: string;
    plan?: string;
    prescriptions?: { name: string; dosage?: string }[];
    diagnoses?: string[];
  }) {
    const issues: { category: string; level: 'ERROR' | 'WARNING' | 'INFO'; message: string; suggestion?: string }[] = [];

    // 규칙 기반 검사 (빠른 응답)
    if (!params.subjective || params.subjective.trim().length < 10) {
      issues.push({ category: 'COMPLETENESS', level: 'ERROR', message: 'S (주관적 증상) 미입력 또는 내용 부족', suggestion: '환자 주소, 현병력을 기록하세요' });
    }
    if (!params.assessment || params.assessment.trim().length < 3) {
      issues.push({ category: 'COMPLETENESS', level: 'ERROR', message: 'A (평가/진단) 미입력', suggestion: '진단명 또는 감별진단을 기록하세요' });
    }
    if (!params.plan || params.plan.trim().length < 5) {
      issues.push({ category: 'COMPLETENESS', level: 'WARNING', message: 'P (치료 계획) 미입력 또는 내용 부족', suggestion: '치료 계획, 처방, 경과 관찰 등을 기록하세요' });
    }
    if (!params.objective) {
      issues.push({ category: 'COMPLETENESS', level: 'INFO', message: 'O (객관적 소견) 미입력', suggestion: '활력징후, 신체검진 소견 등을 기록하세요' });
    }

    // S-A 일관성 (AI 검증)
    if (params.subjective && params.assessment && params.subjective.length >= 10 && params.assessment.length >= 3) {
      try {
        const consistencyPrompt = `SOAP 기록의 일관성을 검증하세요.
S: ${params.subjective.slice(0, 300)}
O: ${params.objective?.slice(0, 200) ?? '미입력'}
A: ${params.assessment.slice(0, 200)}
P: ${params.plan?.slice(0, 200) ?? '미입력'}
처방: ${promptList(params.prescriptions?.map(p => p.name))}
진단코드: ${promptList(params.diagnoses)}

JSON 형식으로 문제점만 응답: { "issues": [{ "category": "CONSISTENCY|CODING|COMPLETENESS|GUIDELINE", "level": "ERROR|WARNING|INFO", "message": "문제점", "suggestion": "개선안" }] }
문제 없으면: { "issues": [] }`;

        const aiResult = await this.chatLlm([
          { role: 'system', content: '한국 의무기록 품질 감사 AI. JSON만 출력. 한국어. 의료기관 인증 기준 적용.' },
          { role: 'user', content: consistencyPrompt },
        ], { temperature: 0.2, num_predict: 500 });

        if (aiResult) {
          const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.issues?.length) {
                issues.push(...parsed.issues);
              }
            } catch {}
          }
        }
      } catch (e) {
        this.logger.warn(`chartQa AI error: ${e}`);
      }
    }

    // 처방-진단 매칭 검사
    if ((params.prescriptions?.length ?? 0) > 0 && (!params.diagnoses || params.diagnoses.length === 0)) {
      issues.push({ category: 'CODING', level: 'WARNING', message: '처방이 있으나 진단코드 미등록', suggestion: '진단코드(ICD-10)를 등록하세요. 청구 누락 위험.' });
    }

    const hasError = issues.some(i => i.level === 'ERROR');
    const hasWarning = issues.some(i => i.level === 'WARNING');
    const score = Math.max(0, 100 - issues.filter(i => i.level === 'ERROR').length * 25 - issues.filter(i => i.level === 'WARNING').length * 10 - issues.filter(i => i.level === 'INFO').length * 3);

    return this.withDisclaimer({
      score,
      grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D',
      level: hasError ? 'ERROR' : hasWarning ? 'WARNING' : 'PASS',
      totalIssues: issues.length,
      issues,
    });
  }

  // ══════════════════════════════════════════════
  // AI 진료 보조 Phase 3: 환자 설명문 / 임상 Q&A
  // ══════════════════════════════════════════════

  /** 환자 설명문 생성 (Patient Education) */
  async patientEducation(params: {
    diagnosis: string;
    treatmentPlan?: string;
    medications?: string[];
    patientAge?: number;
    language?: string;
  }) {
    const prompt = `다음 진단과 치료 계획을 환자에게 설명하는 문서를 작성하세요.

진단: ${params.diagnosis}
${params.treatmentPlan ? `치료 계획: ${params.treatmentPlan}` : ''}
${params.medications?.length ? `약물: ${params.medications.join(', ')}` : ''}
${params.patientAge ? `환자 나이: ${params.patientAge}세` : ''}

요구사항:
1. 의학 전문용어를 쉬운 말로 풀어서 설명
2. 질병의 원인, 증상, 치료법을 포함
3. 일상생활 주의사항 포함
4. 약 복용법과 부작용 안내 (해당 시)
5. 재방문 기준 (이런 증상이 있으면 즉시 방문)

JSON 형식: { "title": "문서 제목", "sections": [{ "heading": "소제목", "content": "내용" }], "precautions": ["주의사항"], "followUpCriteria": ["재방문 기준"], "summary": "한줄 요약" }`;

    try {
      const aiResult = await this.chatLlm([
        { role: 'system', content: '당신은 한국 병원의 환자 교육 문서 작성 AI입니다. JSON만 출력. 한국어. 쉽고 친절한 말투. 전문용어 금지.' },
        { role: 'user', content: prompt },
      ], { temperature: 0.5, num_predict: 1000 });

      if (aiResult) {
        const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return await this.withDisclaimer(JSON.parse(jsonMatch[0]));
          } catch {}
        }
      }
    } catch (e) {
      this.logger.warn(`patientEducation AI error: ${e}`);
    }

    // 폴백: 기존 explain API
    try {
      const explainResult = await this.explain(params.diagnosis, params.treatmentPlan ?? '', 'general');
      return await this.withDisclaimer({
        title: `${params.diagnosis} 안내문`,
        sections: [{ heading: '설명', content: explainResult?.explanation ?? '' }],
        precautions: explainResult?.key_points ?? [],
        followUpCriteria: [],
        summary: params.diagnosis,
      });
    } catch {
      return this.withDisclaimer({ title: params.diagnosis, sections: [], precautions: [], followUpCriteria: [], summary: '' });
    }
  }

  /** 임상 질문 답변 (Clinical Q&A) */
  async clinicalQa(params: {
    question: string;
    patientContext?: string;
    specialty?: string;
  }) {
    const prompt = `의사의 임상 질문에 근거 기반으로 답변하세요.

질문: ${params.question}
${params.patientContext ? `환자 맥락: ${params.patientContext}` : ''}
${params.specialty ? `진료과: ${params.specialty}` : ''}

요구사항:
1. 최신 가이드라인 근거 기반
2. 근거 수준 (A/B/C) 명시
3. 참고문헌 명시
4. 실용적 답변

JSON 형식: { "answer": "답변", "evidenceLevel": "A|B|C", "keyPoints": ["핵심 포인트"], "references": ["가이드라인/논문명"], "relatedQuestions": ["관련 추가 질문"] }`;

    try {
      const aiResult = await this.chatLlm([
        { role: 'system', content: '당신은 한국 종합병원의 임상 지식 AI입니다. JSON만 출력. 한국어. 가이드라인 근거 기반. 정확성 최우선.' },
        { role: 'user', content: prompt },
      ], { temperature: 0.3, num_predict: 800 });

      if (aiResult) {
        const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return await this.withDisclaimer(JSON.parse(jsonMatch[0]));
          } catch {}
        }
      }
    } catch (e) {
      this.logger.warn(`clinicalQa AI error: ${e}`);
    }

    // 폴백: reference API
    try {
      const refResult = await this.reference(params.question, params.specialty);
      return await this.withDisclaimer({
        answer: refResult?.answer ?? '',
        evidenceLevel: 'C',
        keyPoints: [],
        references: refResult?.sources?.map((s: any) => s.title) ?? [],
        relatedQuestions: [],
      });
    } catch {
      return this.withDisclaimer({ answer: '', evidenceLevel: 'C', keyPoints: [], references: [], relatedQuestions: [] });
    }
  }

  // ══════════════════════════════════════════════
  // WeRU.B Medical AI v2.39.2 — 추가 API 프록시
  // ══════════════════════════════════════════════

  /** SOAP 구조화 스트리밍 (NDJSON) */
  async summarizeStream(text: string, specialty?: string): Promise<globalThis.Response> {
    this.logger.log('AI Request: /api/medical/summarize/stream (stream)');
    const res = await this.aiFetch('/api/medical/summarize/stream', {
      method: 'POST',
      body: { text, specialty: specialty ?? '내과', format: 'soap' },
      timeoutMs: this.streamTimeoutMs,
    });
    // 429 는 바쁨(AI_UPSTREAM_BUSY) · 그 밖 실패는 503 — 종전 Error 는 전역 필터에서 500 "우리 서버 고장"이었다
    return this.assertStreamOk(res, 'medical/summarize/stream');
  }

  /** 임상 번역 (영한 의학용어) */
  async clinicalTranslate(text: string): Promise<any> {
    return this.request('/api/medical/clinical/translate', { text });
  }

  /** 약물 상호작용 확인 */
  async drugInteractions(drugs: string[]): Promise<any> {
    return this.request('/api/medical/drug-interactions', { drugs });
  }

  // ── WeRU.B 약가/DUR/e약은요 (v2.102.1 OpenAPI 상세화분) — 제네릭 보류건·표준코드 close-loop 지원 ──

  /**
   * 생동성 대체조제 가능 여부 + 대체품·동일성분 저가약(제네릭 보류건 해결 지원).
   * code = 보험 제품코드(9자리). 반환: eligible·alternatives[]·cheaper[] 등.
   */
  async drugSubstitution(code: string): Promise<any> {
    return this.requestGet(`/api/notice/drug-substitution/${this.assertSafePathCode(code)}`);
  }

  /** 대체조제 일괄 조회(여러 코드) — POST body. */
  async drugSubstitutionBatch(body: Record<string, unknown>): Promise<any> {
    return this.request('/api/notice/drug-substitution', body);
  }

  /**
   * 약가마스터 코드 해석 — 제품코드 ↔ ATC ↔ 표준코드(개정 전/후) 매칭(matches[]).
   * code = 보험 제품코드/구코드. ERP·HIS 보험코드 표준화 대사용.
   */
  async drugMaster(code: string): Promise<any> {
    return this.requestGet(`/api/notice/drug-master/${this.assertSafePathCode(code)}`);
  }

  /** 약가마스터 해석(POST resolve — body {code}로 의약품 정체성 해석. 경로 파라미터 없음). */
  async drugMasterResolve(code: string, body: Record<string, unknown>): Promise<any> {
    return this.request('/api/notice/drug-master/resolve', { code, ...body });
  }

  /** DUR 정밀 점검 — 병용금기·임부·연령·노인·효능군중복·서방정분할 등(advisories). */
  async durCheck(body: { drugs: unknown[]; age?: number; pregnant?: boolean; [k: string]: unknown }): Promise<any> {
    return this.request('/api/medical/dur/check', body);
  }

  /** DUR 데이터 동기화 상태(소스별 status·건수·에러). */
  async durSyncStatus(): Promise<any> {
    return this.requestGet('/api/medical/dur/sync-status');
  }

  /** e약은요 — 품목기준코드(item_seq)로 효능·부작용·복용법 등. */
  async eDrugInfo(itemSeq: string): Promise<any> {
    return this.requestGet(`/api/medical/drug-info/${this.assertSafePathCode(itemSeq)}`);
  }

  /** 수가 고시 해석(notice_type 등) — 수가 코드 기준. */
  async feeCodeNotice(code: string): Promise<any> {
    return this.requestGet(`/api/notice/fee-codes/${this.assertSafePathCode(code)}`);
  }

  /** 지식 색인 등록 */
  async knowledgeIndex(data: { title: string; content: string; category: string; source?: string; shared?: boolean }): Promise<any> {
    return this.request('/api/medical/knowledge/index', data);
  }

  /** 지식 검색 */
  async knowledgeSearch(data: { query: string; category?: string; limit?: number }): Promise<any> {
    return this.request('/api/medical/knowledge/search', data);
  }

  /** 지식 통계 */
  async knowledgeStats(): Promise<any> {
    const res = await this.aiFetch('/api/medical/knowledge/stats');
    if (!res.ok) throw new Error(`AI API error: ${res.status}`);
    return res.json();
  }

  /** 사용량 조회 */
  async getUsage(): Promise<any> {
    const res = await this.aiFetch('/api/medical/usage');
    if (!res.ok) throw new Error(`AI API error: ${res.status}`);
    return res.json();
  }

  /** 호출 이력 조회 */
  async getHistory(limit?: number, action?: string): Promise<any> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (action) params.set('action', action);
    const qs = params.toString();
    const res = await this.aiFetch(`/api/medical/history${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`AI API error: ${res.status}`);
    return res.json();
  }

  /** 오케스트레이터 워크플로우 실행 */
  async orchestratorRun(data: { workflow: string; input: object }): Promise<any> {
    return this.request('/api/orchestrator/run', data);
  }

  /** 오케스트레이터 워크플로우 실행 (SSE 스트리밍) */
  async orchestratorRunStream(data: { workflow: string; input: object }): Promise<globalThis.Response> {
    this.logger.log('AI Request: /api/orchestrator/run/stream (stream)');
    const res = await this.aiFetch('/api/orchestrator/run/stream', {
      method: 'POST',
      body: data,
      timeoutMs: this.streamTimeoutMs,
    });
    // 429 는 바쁨(AI_UPSTREAM_BUSY) · 그 밖 실패는 503 — 종전 Error 는 전역 필터에서 500 "우리 서버 고장"이었다
    return this.assertStreamOk(res, 'orchestrator/run/stream');
  }

  /** 오케스트레이터 워크플로우 목록 */
  async orchestratorWorkflows(): Promise<any> {
    const res = await this.aiFetch('/api/orchestrator/workflows');
    if (!res.ok) throw new Error(`AI API error: ${res.status}`);
    return res.json();
  }

  /** 트리아지 후속 질문 (단일 증상) */
  async triageFollowUpSimple(symptom: string): Promise<any> {
    return this.request('/api/medical/triage/follow-up', { symptom });
  }

  /** 트리아지 흔한 증상 목록 */
  async triageCommonSymptoms(): Promise<any> {
    const res = await this.aiFetch('/api/medical/triage/common-symptoms');
    if (!res.ok) throw new Error(`AI API error: ${res.status}`);
    return res.json();
  }

  /**
   * 어시스턴트 패널 — 슬래시 명령 실행(2026-10-02 재구성).
   *
   * 🔴 명령 정본은 shared `AI_CHAT_COMMANDS` 하나(서버 분기·`/도움`·화면 팔레트가 같은 표를 읽는다).
   * 🔴 요구 입력(`needs`)이 없으면 **AI 를 부르지 않는다** — `source:null` + 이유 코드(빈 증상을 AI 에 보내지 않는다).
   * 🔴 임상 판단 명령은 진료 직군만 — EP 의 ADMIN 전역 우회를 명령 단위로 다시 막는다(AI 호출 **앞**).
   * 🔴 나이·성별은 화면이 보낸 값이 아니라 **환자 원장**에서 읽는다(맥락은 `patientId` 만 믿는다).
   * 🔴 상류 실패는 "답 없음"이 아니라 `UNAVAILABLE`+이유 — 문장은 화면이 코드로 만든다(서버는 코드만).
   */
  async processCommand(
    message: string,
    context?: AiChatContextPayload | null,
    actor?: { role?: string | null } | null,
  ): Promise<AiChatEnvelope> {
    const { cmd: def, token, arg } = parseAiChatInput(message);
    const ctx = context ?? {};
    const notCalled = (reason: AiChatReason, cmd: string | null, detail?: string): AiChatEnvelope =>
      ({ cmd, type: 'notice', source: null, reason, ...(detail ? { detail } : {}), draft: false, data: null });

    // 명령이 아닌 글 · 모르는 명령 → 참고 검색(모르는 명령은 그 사실을 함께 돌려준다)
    if (!def) {
      const env = await this.callAi(null, 'chat', false, () => this.reference(token ? message.trim() : arg));
      return token ? { ...env, unknownCommand: token } : env;
    }
    const cmd = def.cmd;
    if (!canUseAiChatCommand(def, actor?.role)) return notCalled('ROLE_NOT_ALLOWED', cmd);

    if (cmd === '/도움') {
      return {
        cmd, type: 'help', source: null, draft: false,
        data: { commands: AI_CHAT_COMMANDS.filter((c) => canUseAiChatCommand(c, actor?.role)).map((c) => c.cmd) },
      };
    }

    if (def.needs.includes('ARG') && !arg) return notCalled('ARG_REQUIRED', cmd);
    const soap = ctx.soap;
    if (def.needs.includes('SOAP')) {
      if (!soap || typeof soap !== 'object') return notCalled('SOAP_REQUIRED', cmd);
      if (![soap.subjective, soap.objective, soap.assessment, soap.plan].some((s) => typeof s === 'string' && s.trim())) {
        return notCalled('SOAP_EMPTY', cmd);
      }
    }

    // 환자 맥락 — patientId 만 받는다. 있으면 실재를 확인하고 나이·성별을 원장에서 읽는다
    let patient: { id: string; age: number | null; sex: 'M' | 'F' | null } | null = null;
    if (ctx.patientId != null) {
      if (typeof ctx.patientId !== 'string' || !UUID_FULL_RE.test(ctx.patientId)) return notCalled('PATIENT_NOT_FOUND', cmd);
      const p = await this.prisma.patient.findUnique({ where: { id: ctx.patientId }, select: { id: true, dateOfBirth: true, gender: true } });
      if (!p) return notCalled('PATIENT_NOT_FOUND', cmd);
      patient = { id: p.id, age: p.dateOfBirth ? ageOf(p.dateOfBirth) : null, sex: p.gender === 'MALE' ? 'M' : p.gender === 'FEMALE' ? 'F' : null };
    }
    if (def.needs.includes('PATIENT') && !patient) return notCalled('PATIENT_REQUIRED', cmd);

    const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const demo = patient ? { ...(patient.age != null ? { age: patient.age } : {}), ...(patient.sex ? { sex: patient.sex } : {}) } : {};
    const soapText = soap
      ? `S: ${soap.subjective ?? ''}\nO: ${soap.objective ?? ''}\nA: ${soap.assessment ?? ''}\nP: ${soap.plan ?? ''}`
      : '';

    switch (cmd) {
      case '/요약':
        return this.callAi(cmd, 'summarize', true, () => this.summarize(soapText, ctx.department));
      case '/초안':
        return this.callAi(cmd, 'draft', true, () => this.draft(arg || 'progress_note', { soap, ...(ctx.department ? { department: ctx.department } : {}) }));
      case '/자동기록':
        return this.callAi(cmd, 'auto-record', true, () => this.autoRecord({ conversation: arg }));
      case '/설명':
        return this.callAi(cmd, 'explain', true, () => this.explain(arg, '', 'general'));
      case '/문서':
        return this.callAi(cmd, 'writing', true, () => this.writingCraft(arg));
      case '/감별':
        return this.callAi(cmd, 'diagnose', false, () => this.analyze({ symptoms: list(arg), ...demo }), patient ? { patientId: patient.id, ...demo } : undefined);
      case '/정밀감별':
        return this.callAi(cmd, 'enhanced', false, () => this.enhancedChat(arg, 'medical'));
      case '/추론':
        return this.callAi(cmd, 'reasoning', false, () => this.reasoningChain({ symptoms: list(arg), ...demo }), patient ? { patientId: patient.id, ...demo } : undefined);
      case '/매핑':
        return this.callAi(cmd, 'mapping', false, () => this.codeMapping(arg));
      case '/재입원': {
        const dx = list(arg);
        if (!dx.length) return notCalled('ARG_REQUIRED', cmd);
        const rin = await this.resolveReadmissionInput(patient!.id);
        if ('missing' in rin) return notCalled(rin.missing, cmd);
        return this.callAi(cmd, 'predict', false,
          () => this.predictReadmission({ age: rin.age, sex: rin.sex, diagnoses: dx, lengthOfStay: rin.lengthOfStay, ...(rin.admissionId ? { admissionId: rin.admissionId } : {}) }),
          { patientId: rin.patientId, age: rin.age, sex: rin.sex, lengthOfStay: rin.lengthOfStay, admissionId: rin.admissionId });
      }
      case '/부작용':
        return this.callAi(cmd, 'predict-adr', false, () => this.predictAdverseDrug({ drugs: list(arg) }));
      case '/참고':
        return this.callAi(cmd, 'reference', false, () => this.reference(arg));
      case '/약물':
        return this.callAi(cmd, 'drug', false, () => this.drugInfo(arg));
      case '/번역':
        return this.callAi(cmd, 'translate', false, () => this.request('/api/medical/clinical/translate', { text: arg }));
      case '/KCD':
        return this.callAi(cmd, 'kcd', false, () => this.searchKcd(arg));
      case '/EDI':
        return this.callAi(cmd, 'edi', false, () => this.searchEdi(arg));
      default: {
        // 정본에 있는데 분기가 없다 = 배선 누락 — 조용히 참고 검색으로 빠지지 않는다(가드가 잡는다)
        const never: string = cmd;
        throw new Error(`AI_CHAT_COMMAND_UNWIRED ${never}`);
      }
    }
  }

  /** 상류 호출 봉투 — 성공=AI(스킬이 출처를 보고하면 그 값) · 실패=UNAVAILABLE+이유 코드 */
  private async callAi(
    cmd: string | null,
    type: string,
    draft: boolean,
    fn: () => Promise<unknown>,
    basis?: Record<string, unknown>,
  ): Promise<AiChatEnvelope> {
    // 계측 — 이 명령이 부른 상류 호출은 원장에 `medical-ai:chat.<metric>` 으로 남는다(명령 정본의 metric)
    const metric = (cmd ? AI_CHAT_COMMANDS.find((c) => c.cmd === cmd)?.metric : null) ?? AI_CHAT_FREE_METRIC;
    try {
      const data = await withAiSkill(`chat.${metric}`, fn);
      const reported = data && typeof data === 'object' ? (data as { source?: unknown }).source : undefined;
      const source: AiChatSource = reported === 'FALLBACK' || reported === 'UNAVAILABLE' ? reported : 'AI';
      const disclaimer = await this.getDisclaimer();
      // 스킬이 대체·불가로 보고했으면 그 이유 코드(UPSTREAM_AUTH 등)를 함께 — 화면이 "빈 답"으로 그리지 않게
      const skillReason = source !== 'AI' ? (data as { reason?: unknown }).reason : undefined;
      return {
        cmd, type, source, draft, data, disclaimer,
        ...(typeof skillReason === 'string' ? { detail: skillReason } : {}),
        ...(basis ? { basis } : {}),
      };
    } catch (e) {
      const code = e instanceof HttpException ? ((e.getResponse() as { code?: unknown })?.code as string | undefined) : undefined;
      this.logger.warn(`ai chat ${cmd ?? '(chat)'} 상류 실패: ${e instanceof Error ? e.message : String(e)}`);
      return {
        cmd, type, source: 'UNAVAILABLE', draft, data: null,
        reason: isAiDisabledError(e) ? 'AI_DISABLED' : 'UPSTREAM_ERROR',
        ...(code && code !== 'AI_DISABLED' ? { detail: code } : {}),
      };
    }
  }

  /**
   * `/재입원` 입력 해소 — 나이·성별·재원일수를 **실제 환자·실제 입원건**에서 읽는다.
   * 하나라도 없으면 상수로 메우지 않고 무엇이 없는지 코드로 돌려준다(호출부가 예측을 포기한다).
   */
  private async resolveReadmissionInput(
    patientId: string,
  ): Promise<
    | { patientId: string; age: number; sex: string; lengthOfStay: number; admissionId: string }
    | { missing: AiChatReason }
  > {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { dateOfBirth: true, gender: true },
    });
    if (!patient) return { missing: 'PATIENT_NOT_FOUND' };
    const age = patient.dateOfBirth ? ageOf(patient.dateOfBirth) : null;
    if (age == null) return { missing: 'READMISSION_NO_DOB' };
    // 성별은 예측 모델 입력 형식(M/F)으로만 보낸다 — 미상·기타를 임의로 M 으로 접지 않는다.
    const sex = patient.gender === 'MALE' ? 'M' : patient.gender === 'FEMALE' ? 'F' : null;
    if (!sex) return { missing: 'READMISSION_NO_SEX' };

    // 재원일수는 **현재/최근 입원건**에서만 — 입원 이력이 없으면 재입원 위험도의 대상이 아니다.
    const adm = await this.prisma.admission.findFirst({
      where: { patientId, status: { in: ['ADMITTED', 'TRANSFERRED', 'DISCHARGED'] } },
      orderBy: { admitDate: 'desc' },
      select: { id: true, admitDate: true, dischargeDate: true },
    });
    if (!adm) return { missing: 'READMISSION_NO_ADMISSION' };
    const los = stayDays(adm.admitDate, adm.dischargeDate ?? undefined);
    if (los == null) return { missing: 'READMISSION_NO_LOS' };

    return { patientId, age, sex, lengthOfStay: los, admissionId: adm.id };
  }

  // ══════════════════════════════════════════════
  // v2.48.0 신규 API 연동
  // ══════════════════════════════════════════════

  // ── Medical CLI (역할별 업무 자동화) ──

  /** CLI 명령 실행 (접수/수납/간호/진료/청구) */
  async cliExecute(role: string, command: string): Promise<any> {
    return this.request('/api/medical/cli/execute', { role, command });
  }

  /** CLI 입력 자동완성 */
  async cliSuggest(role: string, partial: string): Promise<any> {
    return this.request('/api/medical/cli/suggest', { role, partial });
  }

  /** 역할별 인텐트 목록 */
  async cliIntents(role: string): Promise<any> {
    try {
      const res = await this.aiFetch(`/api/medical/cli/intents/${role}`);
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  /** CLI 명령 이력 */
  async cliHistory(role?: string, limit?: number): Promise<any> {
    try {
      const params = new URLSearchParams();
      if (role) params.set('role', role);
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      const res = await this.aiFetch(`/api/medical/cli/history${qs ? `?${qs}` : ''}`);
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  /** KCD 질병코드 검색 */
  async searchKcd(query: string): Promise<any> {
    return this.request('/api/medical/code/kcd', { query });
  }

  /** EDI 수가코드 검색 */
  async searchEdi(query: string): Promise<any> {
    return this.request('/api/medical/code/edi', { query });
  }

  /** 질병 → 검사/처방 매핑 */
  async codeMapping(diseaseCode: string): Promise<any> {
    return this.request('/api/medical/code/mapping', { disease_code: diseaseCode });
  }

  // ── Reasoning Chain (5단계 추론) ──

  /** 5단계 임상 추론 체인: 증상→감별→순위→검사→평가 */
  async reasoningChain(data: {
    symptoms: string[];
    age?: number;
    sex?: string;
    vitals?: Record<string, unknown>;
    labs?: Record<string, unknown>;
    history?: string;
  }): Promise<any> {
    const startedAt = Date.now();
    // 🔴 상류(WeRU.B) 계약 드리프트: 2026-08-19 실측 `400 {"error":"patient_text is required"}` — HIS 는 symptoms[] 만 보냈고 화면은 500 이었다.
    //    symptoms/history 를 patient_text 로 합성해 함께 보낸다(옛 필드도 유지 — 어느 쪽 계약이든 살아남게).
    const patientText = [
      data.symptoms?.length ? `증상: ${data.symptoms.join(', ')}` : '',
      data.history ? `병력/소견: ${data.history}` : '',
      data.age != null ? `나이: ${data.age}` : '', data.sex ? `성별: ${data.sex}` : '',
    ].filter(Boolean).join('\n');
    try {
      // 5단계 체인은 실측 ~30초 — 기본 30초 타임아웃에 걸려 UPSTREAM_ERROR 가 되던 것. LLM 타임아웃(llmTimeoutMs)을 준다
      const r = await this.request('/api/medical/reasoning/chain', { ...data, patient_text: patientText }, this.llmTimeoutMs);
      const steps = Array.isArray(r?.steps) ? r.steps : Array.isArray(r?.chain) ? r.chain : [];
      return finalizeSkill({ ...r, steps }, startedAt, [checkNonEmpty('steps', steps)], { groundedOn: ['증상 목록', '병력/소견 텍스트'] });
    } catch (e) {
      this.logger.warn(`reasoningChain 상류 실패: ${e instanceof Error ? e.message : e}`);
      return this.upstreamFailedSkill({ steps: [] }, startedAt, e, ['증상 목록', '병력/소견 텍스트']);
    }
  }

  /** 추론 체인 SSE 스트리밍 (Response 객체 직접 전달) */
  async reasoningChainStream(data: any): Promise<globalThis.Response> {
    // 🔴 res.ok 미검사 → 상류 502 가 빈 스트림으로 흘러 화면이 "추론 없음"처럼 보였다.
    const res = await this.aiFetch('/api/medical/reasoning/chain/stream', {
      method: 'POST',
      body: data,
      timeoutMs: this.streamTimeoutMs,
    });
    return this.assertStreamOk(res, 'reasoning/chain/stream');
  }

  // ── Auto Record (진료 대화 → 의무기록 자동) ──

  /** 진료 대화 → NER → SOAP + ICD-10 + 처방 자동 생성 */
  async autoRecord(data: { conversation: string; specialty?: string }): Promise<any> {
    return this.withDisclaimer(await this.request('/api/medical/auto-record', data));
  }

  /** 자동 의무기록 SSE 스트리밍 */
  async autoRecordStream(data: any): Promise<globalThis.Response> {
    // 🔴 res.ok 미검사 → 상류 실패가 빈 SOAP 초안으로 보였다(진료 대화 전송 실패를 성공으로 표시).
    const res = await this.aiFetch('/api/medical/auto-record/stream', {
      method: 'POST',
      body: data,
      timeoutMs: this.streamTimeoutMs,
    });
    return this.assertStreamOk(res, 'auto-record/stream');
  }

  // ── Predict (예측 모델) ──

  /** 30일 재입원 위험도 예측 (HOSPITAL Score) */
  async predictReadmission(data: {
    age: number;
    sex: string;
    diagnoses: string[];
    procedures?: string[];
    lengthOfStay?: number;
    previousAdmissions?: number;
    comorbidities?: string[];
    admissionId?: string;
  }): Promise<any> {
    // 입원을 지정하면 권장 키(재원일수·1년 내 입원·Hb·Na·응급 경유·입원 중 수술)를 **기록에서** 채운다 — readmission-context.ts
    const ctx = data.admissionId ? await buildReadmissionContext(this.prisma as never, data.admissionId) : null;
    const lengthOfStay = ctx?.lengthOfStay ?? data.lengthOfStay ?? null;
    if (lengthOfStay == null) throw new BadRequestException('재원일수(lengthOfStay) 또는 입원(admissionId)이 필요합니다 — 재원일수를 추정하지 않습니다');
    const body = readmissionBody({
      ...data,
      lengthOfStay,
      previousAdmissions: ctx ? ctx.pastAdmissions : data.previousAdmissions,
      labResults: ctx?.labResults ?? null,
      admissionInfo: ctx?.admissionInfo ?? null,
    });
    // 빠진 점수 항목 — 상류는 빠진 항목을 0점으로 본다(위험도 과소 가능 · AI 서버 회신 10-07). 화면이 그 사실을 말하게 함께 돌려준다
    const inputGaps = [...(ctx?.gaps ?? ['HB', 'NA', 'ADMISSION_ROUTE', 'PROCEDURE', 'ONCOLOGY'])];
    if (!ctx && data.previousAdmissions == null) inputGaps.push('PAST_ADMISSIONS');
    // 상류 계약(patient_data)대로 싸고 화면이 읽는 필드를 덧붙인다 — predict-contract.ts
    return { ...normalizePrediction('readmission', await this.request('/api/medical/predict/readmission', body)), inputGaps };
  }

  /** 합병증 위험도 예측 */
  async predictComplication(data: {
    age: number;
    sex: string;
    diagnosis: string;
    procedure?: string;
    comorbidities?: string[];
    vitals?: Record<string, unknown>;
    labs?: Record<string, unknown>;
  }): Promise<any> {
    return normalizePrediction('complication', await this.request('/api/medical/predict/complication', complicationBody(data)));
  }

  /** 약물 부작용 예측 + DB 검증 */
  async predictAdverseDrug(data: {
    drugs: string[];
    age?: number;
    sex?: string;
    diagnoses?: string[];
    allergies?: string[];
    renalFunction?: string;
    hepaticFunction?: string;
  }): Promise<any> {
    return normalizePrediction('adverse-drug', await this.request('/api/medical/predict/adverse-drug', adverseDrugBody(data)));
  }

  // ── Vision Medical (MedGemma 영상 분석) ──

  /** 의료 영상 모델 목록 */
  async visionModels(): Promise<any> {
    try {
      const res = await this.aiFetch('/api/vision/medical/models');
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  /**
   * 외부 AI 가 가져갈 수 없는 영상 URL 이면 **호출하지 않고** 400 으로 세운다.
   * 실패를 실패로 두는 편이, 보지 않은 영상의 소견이 소견으로 렌더되는 것보다 안전하다.
   */
  private assertImageFetchable(imageUrl: string, ctx: string): void {
    const bad = unfetchableByExternalAi(imageUrl);
    if (bad) {
      throw new BadRequestException({
        code: 'IMAGE_URL_NOT_FETCHABLE',
        message: `${ctx}: ${bad} 외부 AI 서버가 가져갈 수 없는 URL 이라 판독을 요청하지 않았습니다 — 바이트를 직접 보내는 POST /api/v1/ai/vision/medical/analyze 를 사용하십시오.`,
      });
    }
  }

  /**
   * 의료 영상 AI 분석.
   *
   * 🔴 **가져갈 수 없는 URL 은 여기서 막는다(정본 초크포인트).** 이 EP 는 URL 을 넘기면
   *    WeRU.B 가 **스스로 fetch** 한다. 종전엔 컨트롤러 한 곳에서만 `unfetchableByExternalAi` 를 걸었고,
   *    `ImagingService` 는 그 옆을 지나 **빈 문자열 `''`** 을 넘겼다 — AI 는 영상을 한 장도 보지 못한 채
   *    "판독 소견"을 지어냈고 그게 화면에 렌더됐다(2026-08-18 적발 · P15).
   *    한 곳만 막으면 갈라진다 → **서비스 계층에서 전 호출자를 막는다.**
   */
  async visionAnalyze(imageUrl: string, modality: string, bodyPart: string, clinicalInfo?: string): Promise<any> {
    this.assertImageFetchable(imageUrl, '영상 분석');
    return this.request('/api/vision/medical/analyze', {
      image_url: imageUrl,
      modality,
      body_part: bodyPart,
      clinical_info: this.sanitizeClinicalInfo(clinicalInfo),
      language: 'ko',
    });
  }

  /**
   * 🔴 `clinical_info` 는 **원문이 그대로 외부로 나가는 유일한 자유 텍스트**다.
   * 컨트롤러 입구(DTO)만 조이면 서비스를 직접 부르는 내부 호출자(예: 판독 소견을 그대로 채워 보내는 경로)는
   * 그물을 통과한다 — 그래서 마지막 관문을 서비스에 둔다.
   *
   * ⚠️ 이것은 **비식별이 아니다.** 형식이 명확한 식별자(주민·여권·전화·이메일·UUID)만 지운다.
   *    이름은 여기서 알 수 없으므로 **지우지 못한다** — 이름을 아는 호출부가 `redactForAiEgress` 로
   *    치환해서 넘겨야 한다(정본 common/util/ai-phi-redact.ts).
   */
  private sanitizeClinicalInfo(raw?: string): string {
    if (!raw) return '';
    const cut = raw.length > 4000 ? `${raw.slice(0, 4000)}…(4000자 초과분 미전송)` : raw; // 자르면 잘랐다고 말한다
    return redactIdentifiers(cut);
  }

  /** 구조화 영상 판독 (BI-RADS/Lung-RADS). 🔴 URL 도달 가능성은 visionAnalyze 와 동일 규칙. */
  async visionStructuredReport(imageUrl: string, modality: string, bodyPart: string): Promise<any> {
    this.assertImageFetchable(imageUrl, '구조화 판독');
    return this.request('/api/vision/medical/structured-report', {
      image_url: imageUrl,
      modality,
      body_part: bodyPart,
      language: 'ko',
    });
  }

  /** 비교 판독 보고서. 🔴 두 영상 **모두** 도달 가능해야 한다(한쪽만 있어도 '비교'가 아니다). */
  async visionCompareReport(currentImageUrl: string, previousImageUrl: string, modality: string, bodyPart: string): Promise<any> {
    this.assertImageFetchable(currentImageUrl, '비교 판독(현재 영상)');
    this.assertImageFetchable(previousImageUrl, '비교 판독(비교 영상)');
    return this.request('/api/vision/medical/report', {
      current_image: currentImageUrl,
      previous_image: previousImageUrl,
      modality,
      body_part: bodyPart,
      language: 'ko',
    });
  }

  // ── FHIR R4 Interoperability ──

  /** AI 추론 결과 → FHIR DiagnosticReport Bundle */
  async fhirDiagnosticReport(data: any): Promise<any> {
    return this.request('/api/fhir/DiagnosticReport', data);
  }

  /** 자동 의무기록 → FHIR DocumentReference */
  async fhirDocumentReference(data: any): Promise<any> {
    return this.request('/api/fhir/DocumentReference', data);
  }

  /** 예측 결과 → FHIR RiskAssessment */
  async fhirRiskAssessment(data: any): Promise<any> {
    return this.request('/api/fhir/RiskAssessment', data);
  }

  /** 약물 상호작용 → FHIR Observation Bundle */
  async fhirDrugCheck(drugs: string[]): Promise<any> {
    return this.request('/api/fhir/Observation/drug-check', { drugs });
  }

  /** KCD 코드 → FHIR Condition searchset */
  async fhirConditionSearch(query: string): Promise<any> {
    return this.request('/api/fhir/Condition/search', { query });
  }

  // ── Enhanced Chat (멀티모델 오케스트레이션) ──

  /** 강화 채팅 — 도메인별 2~3 모델 파이프라인 (medical/coding/writing/legal) */
  async enhancedChat(
    message: string,
    domain: 'medical' | 'coding' | 'writing' | 'legal' = 'medical',
    opts?: { depth?: 'fast' | 'triage' | 'default'; single_model?: string },
  ): Promise<any> {
    // API는 messages 배열 + domain 파라미터를 기대.
    // depth:'fast'+single_model 은 컨시어지 트리아지용(2단계·~5s, 스왑 없음). 임상 상세분석은 default(full).
    // aiFetch가 X-Medical-Key + Bearer 병행 전송 — 기존 Bearer 실패 시 X-Medical-Key 재시도 로직 불필요.
    const res = await this.aiFetch('/api/chat/enhanced', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: message }],
        domain,
        ...(opts?.depth ? { depth: opts.depth } : {}),
        ...(opts?.single_model ? { single_model: opts.single_model } : {}),
      },
      timeoutMs: this.llmTimeoutMs,
    });
    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`Enhanced chat error: ${res.status} - ${err.slice(0, 200)}`);
      throw new Error(`Enhanced chat error: ${res.status}`);
    }
    return res.json();
  }

  // ── Writing Craft (고품질 글쓰기) ──

  /** 고품질 글쓰기 — 3모델 파이프라인 (qwen→exaone-deep→dna) */
  async writingCraft(text: string, style?: string): Promise<any> {
    return this.request('/api/writing/craft', { text, style: style ?? 'professional' });
  }

  /** FHIR CapabilityStatement */
  async fhirMetadata(): Promise<any> {
    try {
      const res = await this.aiFetch('/api/fhir/metadata');
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  // ============================================================
  // Medical Law (14 API) — v2.53.0
  // ============================================================

  /** 의료법 질의응답 (RAG 조문 검색 + LLM) */
  async medicalLawAsk(question: string): Promise<any> {
    return this.request('/api/medical-law/ask', { question });
  }

  /** 법률 조문 검색 */
  async medicalLawSearch(query: string, category?: string): Promise<any> {
    return this.request('/api/medical-law/search', { query, category });
  }

  /** 의무기록 기재사항 검사 (의료법 제22조) */
  async medicalLawCheckRecord(record: string): Promise<any> {
    return this.request('/api/medical-law/check/record', { record });
  }

  /** 감염병 신고 의무 확인 */
  async medicalLawCheckReport(diagnoses: { diagnosis_ko: string; icd10: string }[]): Promise<any> {
    return this.request('/api/medical-law/check/report', { diagnoses });
  }

  /** 동의서 요건 확인 */
  async medicalLawCheckConsent(procedures: string[]): Promise<any> {
    return this.request('/api/medical-law/check/consent', { procedures });
  }

  /** 개인정보 처리 적법성 */
  async medicalLawCheckPrivacy(data: { data_type: string; purpose: string; third_party?: boolean }): Promise<any> {
    return this.request('/api/medical-law/check/privacy', data);
  }

  /** 응급의료 의무 준수 확인 */
  async medicalLawCheckEmergency(data: { situation: string; actions_taken: string[] }): Promise<any> {
    return this.request('/api/medical-law/check/emergency', data);
  }

  /** 통합 법적 검사 (기록+감염병+동의서 일괄) */
  async medicalLawAutoCheck(data: { record: string; diagnoses?: { diagnosis_ko: string; icd10: string }[]; procedures?: string[] }): Promise<any> {
    return this.request('/api/medical-law/auto-check', data);
  }

  /** 인폼드 컨센트 가이드 */
  async medicalLawInformedConsent(procedure: string): Promise<any> {
    return this.request('/api/medical-law/guide/informed-consent', { procedure });
  }

  /** 기록 보관 기간 안내 */
  async medicalLawRetentionGuide(recordType: string): Promise<any> {
    return this.request('/api/medical-law/guide/retention', { record_type: recordType });
  }

  /** 의료 광고 적법성 검토 */
  async medicalLawAdCheck(content: string): Promise<any> {
    return this.request('/api/medical-law/guide/advertisement', { content });
  }

  /** 위반 벌칙/과태료 조회 */
  async medicalLawPenalty(violation: string): Promise<any> {
    return this.request('/api/medical-law/calculate/penalty', { violation });
  }

  /** 의료법 DB 통계 */
  async medicalLawStats(): Promise<any> {
    try {
      const res = await this.aiFetch('/api/medical-law/stats');
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  // ============================================================
  // Meeting Analysis (6 API) — v2.63.0
  // ============================================================

  /**
   * 🔴 WeRU.B `/api/meeting/*` 큐는 **테넌트·출처 공용 작업 큐**다(병원 회의 전용이 아니다).
   * 실측(2026-08) 47건 = 교육 STT 벤치마크 31 · **앰비언트 진료녹취 `scribe` 6** · 미상 9 · 병원 회의 0.
   * 관리자 화면 `/admin/ai-meeting` 이 이 큐를 그대로 "병원 회의"로 렌더했고(A), 상세 조회가
   * `transcript.full_text`·`speaker_segments`(=진료 녹취 전문)를 그대로 반환했다(B).
   *   → 제출 시 출처를 각인하고, 조회는 **이 각인이 있는 작업만** 돌려준다(남의 큐를 병원 회의로 그리지 않는다).
   *   → 전문·화자분절은 **응답 자체에서 제거**한다(FE 가 안 그리는 것은 보호가 아니다).
   *     진료 녹취 전문의 정본 열람 경로는 scribe 모듈(진료건 바인딩·녹음 동의·감사)뿐이다.
   */
  private static readonly MEETING_SOURCE = 'his-meeting';

  /** 작업 metadata 의 출처 표기(없으면 null) */
  private static meetingSourceOf(job: any): string | null {
    const s = job?.metadata?.source;
    return typeof s === 'string' && s.trim() ? s.trim() : null;
  }

  /** 이 HIS 가 회의 분석으로 제출한 작업인가 */
  private static isOwnMeetingJob(job: any): boolean {
    return MedicalAiService.meetingSourceOf(job) === MedicalAiService.MEETING_SOURCE;
  }

  /**
   * 🔴 회의 작업 응답 화이트리스트 — 전사 전문/화자분절/원음 URL 은 담지 않는다.
   * 블랙리스트(=특정 키 삭제)는 상류 스키마가 바뀌면 조용히 새므로 화이트리스트로 고정한다.
   */
  private sanitizeMeetingJob(job: any): Record<string, unknown> | null {
    if (!job || typeof job !== 'object') return null;
    const r = (job.result ?? {}) as Record<string, any>;
    const hadTranscript = !!(
      r.transcript || r.speaker_segments || r.segments || r.diarization || r.text || job.transcript || job.speaker_segments
    );
    /**
     * 🔴 관측점(axis C): 전문 탐지(hadTranscript)는 상류 키 이름 7종의 수기 목록이다 — 상류가
     *    `utterances` 같은 새 이름을 쓰면 "전문이 존재했다"는 고지(transcriptOmitted)가 조용히 사라진다.
     *    화이트리스트 밖의 미지 키가 있는데 전문을 못 찾았으면 **키 이름만**(값 없이) 원장에 남긴다.
     */
    if (!hadTranscript) {
      const KNOWN = new Set(['summary', 'action_items', 'highlights']);
      const unknown = Object.keys(r).filter((k) => !KNOWN.has(k));
      if (unknown.length > 0) {
        this.drift?.record({
          kind: 'KEY_MISSING',
          producer: 'werub.meeting-job.result',
          consumer: 'medical-ai.sanitizeMeetingJob',
          detail: `전문 탐지 목록 밖의 미지 키 존재(고지 누락 가능) · 키: ${unknown.join(', ').slice(0, 200)}`,
        });
      }
    }
    const m = (job.metadata ?? {}) as Record<string, any>;
    return {
      id: job.id ?? job.job_id ?? null,
      status: job.status ?? null,
      created_at: job.created_at ?? null,
      error: job.error ?? null,
      metadata: {
        room_name: m.room_name ?? null,
        meeting_id: m.meeting_id ?? null,
        duration_sec: m.duration_sec ?? null,
        source: MedicalAiService.meetingSourceOf(job),
      },
      result: {
        summary: typeof r.summary === 'string' ? r.summary : undefined,
        action_items: Array.isArray(r.action_items) ? r.action_items : undefined,
        highlights: Array.isArray(r.highlights) ? r.highlights : undefined,
        // 전문이 상류에 존재했다는 사실만 알린다(내용은 반환하지 않음).
        transcriptOmitted: hadTranscript || undefined,
      },
    };
  }

  /** 화상회의 녹화 AI 분석 요청 — 출처 각인(공용 큐에서 우리 작업을 식별하기 위한 유일한 근거) */
  async meetingAnalyze(data: { file_url: string; callback_url?: string; options?: { summary?: boolean; action_items?: boolean; highlights?: boolean }; metadata?: Record<string, unknown> }): Promise<any> {
    const body = {
      ...data,
      // 호출자가 무엇을 보내든 출처는 서버가 확정한다(scribe 로 위장 제출 방지).
      metadata: { ...(data.metadata ?? {}), source: MedicalAiService.MEETING_SOURCE },
    };
    const res = await this.aiFetch('/api/meeting/analyze', { method: 'POST', body, timeoutMs: this.llmTimeoutMs });
    return this.aiJson(res, 'meeting/analyze', { generation: true }); // 🔴 기존: res.ok 미검사 → 제출 실패가 "접수됨" 으로 표시
  }

  /**
   * 분석 작업 상태/결과 조회 — **우리 작업만**. 남의 작업(진료녹취 등)은 403.
   * 반환은 화이트리스트(전문 제거).
   */
  async meetingJobStatus(jobId: string): Promise<any> {
    const res = await this.aiFetch(`/api/meeting/job/${jobId}`);
    const raw = await this.aiJson(res, 'meeting/job'); // 🔴 기존: 실패를 null 로 삼켜 화면이 "결과 없음"
    const job = raw?.job ?? raw?.data ?? raw;
    if (!MedicalAiService.isOwnMeetingJob(job)) {
      // 🔴 진료 녹취(scribe)·타 출처 작업을 회의 화면으로 열람하던 경로. 전문 노출의 실제 통로였다.
      throw new ForbiddenException({
        code: 'NOT_A_HOSPITAL_MEETING_JOB',
        message: '이 병원 회의로 제출된 작업이 아닙니다(공용 AI 큐의 타 출처 작업). 진료 녹취는 진료기록 화면에서만 열람합니다.',
      });
    }
    return this.sanitizeMeetingJob(job);
  }

  /**
   * 분석 작업 목록 — 우리 출처 각인이 있는 작업만. 나머지는 **개수만** 사실대로 알린다
   * (표본 부재의 정답은 폴백이 아니라 빈 목록 — 병원 회의가 0건이면 0건이라 말한다).
   */
  async meetingJobs(status?: string): Promise<any> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await this.aiFetch(`/api/meeting/jobs${qs}`);
    const raw = await this.aiJson(res, 'meeting/jobs'); // 🔴 기존: 실패를 null 로 삼킴
    const all: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.jobs) ? raw.jobs : [];
    const mine = all.filter((j) => MedicalAiService.isOwnMeetingJob(j));
    const bySource: Record<string, number> = {};
    for (const j of all) {
      if (MedicalAiService.isOwnMeetingJob(j)) continue;
      const key = MedicalAiService.meetingSourceOf(j) ?? 'unknown';
      bySource[key] = (bySource[key] ?? 0) + 1;
    }
    return {
      jobs: mine.map((j) => this.sanitizeMeetingJob(j)),
      queueTotal: all.length,
      excluded: { total: all.length - mine.length, bySource },
    };
  }

  /** 시스템 상태 (Whisper/ffmpeg/GPU) */
  async meetingStatus(): Promise<any> {
    const res = await this.aiFetch('/api/meeting/status');
    return this.aiJson(res, 'meeting/status'); // 🔴 기존: 실패를 null 로 삼킴
  }

  // ============================================================
  // Counseling (6 API) — v2.62.0
  // ============================================================

  /**
   * 상담 대화 (mindwell + qwen 오케스트레이션 · 자살위험 등 위기 감지 포함).
   *
   * 🔴 원 결함: `res.ok` 를 검사하지 않고 `res.json()` 을 반환했다. 상류 502/504 의 에러 본문에는
   * `is_crisis` 가 없으므로 FE 에서 `undefined` → falsy → **위기 배너 미표시 + 빈 말풍선**.
   * 자살위험 상담에서 "판단 실패"가 "위기 없음"으로 뒤바뀌던 경로다.
   *   → ① 실패는 503 으로 올린다 ② 200 이어도 상류가 `is_crisis` 를 **boolean 으로 명시하지 않았으면**
   *      `crisis_assessed=false` 로 내려 화면이 "판단 불가"를 말하게 한다(P1: 모르면 모른다고).
   */
  async counselingChat(message: string, sessionId?: string): Promise<any> {
    const res = await this.aiFetch('/api/counseling/chat', {
      method: 'POST',
      body: { message, session_id: sessionId },
      timeoutMs: this.llmTimeoutMs,
    });
    const data = await this.aiJson(res, 'counseling/chat');
    const assessed = typeof data?.is_crisis === 'boolean';
    return {
      ...data,
      is_crisis: assessed ? data.is_crisis : null, // 미판정을 false 로 위장하지 않는다
      crisis_assessed: assessed,
    };
  }

  /** 상담 세션 목록 */
  async counselingSessions(): Promise<any> {
    const res = await this.aiFetch('/api/counseling/sessions');
    return this.aiJson(res, 'counseling/sessions');
  }

  /** 상담 시스템 상태 */
  async counselingStatus(): Promise<any> {
    const res = await this.aiFetch('/api/counseling/status');
    return this.aiJson(res, 'counseling/status');
  }

  // ============================================================
  // Vision Medical (3 API)
  // ============================================================

  /** 의료 영상 AI 분석 (MedGemma 4B) */
  async visionMedicalAnalyze(data: { imageBase64: string; modality: string; bodyPart: string; clinicalInfo?: string }): Promise<any> {
    const formData = new FormData();
    // Base64 → Blob
    const binary = Buffer.from(data.imageBase64, 'base64');
    const blob = new Blob([binary], { type: 'image/png' });
    formData.append('image', blob, 'image.png');
    formData.append('modality', data.modality);
    formData.append('body_part', data.bodyPart);
    const clinicalInfo = this.sanitizeClinicalInfo(data.clinicalInfo);
    if (clinicalInfo) formData.append('clinical_info', clinicalInfo);
    formData.append('language', 'ko');

    const res = await this.aiFetch('/api/vision/medical/analyze', {
      method: 'POST',
      body: formData,
      timeoutMs: this.llmTimeoutMs,
    });
    // 🔴 기존: res.ok 미검사 → 상류 실패 본문이 "판독 결과"로 렌더(소견 공백을 정상 판독처럼 표시)
    return this.aiJson(res, 'vision/medical/analyze', { generation: true });
  }

  // ============================================================
  // Writing / Translate (5 API) — v2.55.0
  // ============================================================

  /** 텍스트 번역 (7개 언어) */
  async translate(text: string, target: string, tone?: string): Promise<any> {
    const res = await this.aiFetch('/api/writing/translate', {
      method: 'POST',
      body: { text, target, tone },
      timeoutMs: this.llmTimeoutMs,
    });
    return this.aiJson(res, 'writing/translate', { generation: true }); // 🔴 기존: res.ok 미검사
  }

  // ============================================================
  // Tool Calling — v2.64.0
  // ============================================================

  /** AI 서버 등록 도구 목록 */
  async getAiTools(): Promise<any> {
    const res = await this.aiFetch('/api/orchestrator/tools');
    return res.ok ? res.json() : null;
  }

  /**
   * 스킬 계측(기획서 chart-ai-assistant-agent §4.6) — 감사 원장의 `Ai*Outcome` 행(source·latencyMs·verifyFailed)을 스킬별로 센다.
   * 🔴 분모(호출 N)와 함께 낸다 · 호출 0이면 비율은 산출 불가(화면이 <Ratio> 로 그린다).
   */
  async skillMetrics(days = 30) {
    const since = new Date(Date.now() - days * 86400_000);
    const rows = await this.prisma.auditLog.findMany({
      where: { resourceType: { endsWith: 'Outcome', startsWith: 'Ai' }, timestamp: { gte: since } },
      select: { resourceType: true, changes: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: 20000,
    });
    const parse = (changes: unknown): Record<string, string> => {
      const summary = (changes as { egress?: { new?: unknown } })?.egress?.new;
      if (typeof summary !== 'string') return {};
      return Object.fromEntries(summary.split(';').map((kv) => { const i = kv.indexOf('='); return i > 0 ? [kv.slice(0, i), kv.slice(i + 1)] : [kv, '']; }));
    };
    const bySkill = new Map<string, { calls: number; bySource: Record<string, number>; latencies: number[]; verifyFailed: Record<string, number>; reasons: Record<string, number> }>();
    for (const r of rows) {
      const skill = r.resourceType.replace(/^Ai/, '').replace(/Outcome$/, '');
      const m = parse(r.changes);
      const cur = bySkill.get(skill) ?? { calls: 0, bySource: {}, latencies: [], verifyFailed: {}, reasons: {} };
      cur.calls += 1;
      const src = m.source || 'UNKNOWN';
      cur.bySource[src] = (cur.bySource[src] ?? 0) + 1;
      const lat = Number(m.latencyMs); if (Number.isFinite(lat)) cur.latencies.push(lat);
      if (m.reason) cur.reasons[m.reason] = (cur.reasons[m.reason] ?? 0) + 1;
      if (m.verifyFailed) for (const f of m.verifyFailed.split('|')) { const k = f.replace(/\(.*\)$/, ''); cur.verifyFailed[k] = (cur.verifyFailed[k] ?? 0) + 1; }
      bySkill.set(skill, cur);
    }
    const pct = (arr: number[], q: number) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]; };
    return {
      windowDays: days,
      generatedAt: new Date().toISOString(),
      note: 'Ai*Outcome 감사행 기준(2026-08-19 이후 배선) — 그 전 호출은 이 표에 없다',
      skills: [...bySkill.entries()].map(([skill, v]) => ({
        skill, calls: v.calls, bySource: v.bySource,
        aiOk: v.bySource.AI ?? 0,
        latencyP50Ms: pct(v.latencies, 0.5), latencyP95Ms: pct(v.latencies, 0.95),
        verifyFailed: v.verifyFailed, reasons: v.reasons,
      })).sort((a, b) => b.calls - a.calls),
    };
  }

  /**
   * 스킬 **품질 임계 판정**(기획서 §4.6 계측 · §6-1 사람 게이트) — `skillMetrics` 실측 위에 위원회 임계를 얹는다.
   *
   * 🔴 계측 재료는 `skillMetrics(days)` 를 **그대로 재사용**한다(같은 사실을 두 번 세지 않는다 — 정본이 둘이면 갈라진다).
   * 🔴 임계·조치는 **기본 미설정·전부 OFF** 다. 이 EP 는 임계를 정하지 않고, 실측과 분모를 보여줄 뿐이다.
   * 🔴 표본 부족(`calls < minCalls`)으로는 **어떤 조치도 하지 않는다** — 그건 품질이 나쁘다는 뜻이 아니다.
   * 🔴 호출 0 의 통과율은 `null`(산출 불가)이다 — `0`(전부 실패)과 다른 사실이다.
   */
  async skillQuality(days = 30) {
    const metrics = await this.skillMetrics(days);
    const [rateRaw, callsRaw, actionRaw] = await Promise.all([
      this.runtimeConfig.get('ai.skill.quality.minAiRate').catch(() => null),
      this.runtimeConfig.get('ai.skill.quality.minCalls').catch(() => null),
      this.runtimeConfig.get('ai.skill.quality.action').catch(() => null),
    ]);
    const minAiRate = resolveMinAiRate(rateRaw);
    const minCalls = resolveMinCalls(callsRaw);
    const actions = resolveActions(actionRaw);
    const byName = new Map(metrics.skills.map((s) => [s.skill, s]));
    return {
      windowDays: metrics.windowDays,
      generatedAt: metrics.generatedAt,
      note: `${metrics.note} · 임계·조치는 config ai.skill.quality.*(기본 미설정·전부 OFF) — 위원회가 실측에서 정한다`,
      skills: AI_QUALITY_SKILLS.map((def) => {
        const m = byName.get(def.skill);
        const calls = m?.calls ?? 0;
        const aiOk = m?.aiOk ?? 0;
        const threshold = {
          minAiRate: minAiRate[def.key] ?? null,
          minCalls: minCalls[def.key],
          action: actions[def.key],
        };
        const j = judgeSkillQuality({ calls, aiOk, ...threshold });
        return { skill: def.skill, label: def.label, calls, aiOk, aiRate: j.aiRate, threshold, status: j.status, effect: j.effect, basis: j.basis };
      }),
    };
  }

  /**
   * 무수정 승인율(human_edit_ratio) 계측 — 기획서 chart-ai-assistant-agent §4.5·§4.6. **스키마 없이 감사 원장으로.**
   *
   * 두 종류의 감사행을 센다(형태가 다르므로 둘 다 판다):
   *   · `AiDraftApply`   — `changes.aiDraftApply.new` 객체(초안이 폼에 적용된 사실)
   *   · `AiDraftOutcome` — `changes.egress.new` 의 `k=v;k=v` 요약(확정 시 편집 거리 · 본문 없음)
   *
   * 🔴 분모 규약
   *   · `unchanged` 의 분모는 **outcomes** 다. `applied` 로 나누면 "적용은 했는데 확정 계측이 오지 않은 건"이
   *     전부 '수정함'으로 세어져 승인율이 조용히 낮아진다(반대로 계측만 오면 100% 를 넘는다).
   *   · outcomes 가 0이면 `medianEditDistance` 는 **null** — 화면은 '산출 불가'로 그린다(0 은 무수정이라는 다른 사실).
   *   · `measured` 는 초안이 있어 거리를 **잴 수 있었던** 건수다(NO_DRAFT 제외). 중앙값의 실제 분모는 이 수다.
   *   · 비율은 서버가 만들지 않는다 — 분자·분모를 그대로 주고 화면(`<Ratio>`)이 분모 0을 '산출 불가'로 그린다.
   */
  async draftMetrics(days = 30) {
    const d = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
    const since = new Date(Date.now() - d * 86400_000);
    const rows = await this.prisma.auditLog.findMany({
      where: { resourceType: { in: ['AiDraftApply', 'AiDraftOutcome'] }, timestamp: { gte: since } },
      select: { resourceType: true, changes: true },
      orderBy: { timestamp: 'desc' },
      take: 20000,
    });
    /** 두 형태(문자열 요약 / 객체) 를 같은 map 으로 — 어느 쪽으로 쓰였든 읽힌다 */
    const metaOf = (changes: unknown): Record<string, string> => {
      const c = (changes ?? {}) as { egress?: { new?: unknown }; aiDraftApply?: { new?: unknown } };
      const summary = c?.egress?.new;
      if (typeof summary === 'string') {
        return Object.fromEntries(summary.split(';').map((kv) => { const i = kv.indexOf('='); return i > 0 ? [kv.slice(0, i), kv.slice(i + 1)] : [kv, '']; }));
      }
      const obj = c?.aiDraftApply?.new;
      if (obj && typeof obj === 'object') {
        return Object.fromEntries(Object.entries(obj as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => [k, String(v)]));
      }
      return {};
    };
    type Bucket = { applied: number; outcomes: number; measured: number; unchanged: number; distances: number[] };
    const mk = (): Bucket => ({ applied: 0, outcomes: 0, measured: 0, unchanged: 0, distances: [] });
    const byType = new Map<string, Bucket>();
    const all = mk();
    for (const r of rows) {
      const m = metaOf(r.changes);
      const key = m.resourceType || 'UNKNOWN';
      const b = byType.get(key) ?? mk();
      if (r.resourceType === 'AiDraftOutcome') {
        b.outcomes += 1; all.outcomes += 1;
        const raw = m.editDistance;
        const dist = raw !== undefined && raw !== '' ? Number(raw) : NaN;
        if (Number.isFinite(dist)) {
          b.measured += 1; all.measured += 1;
          b.distances.push(dist); all.distances.push(dist);
          // 🔴 '무수정' 은 거리를 실제로 잰 건에서만 센다 — 초안이 없던 건(NO_DRAFT)은 무수정이 아니다
          if (m.unchanged === 'true') { b.unchanged += 1; all.unchanged += 1; }
        }
      } else {
        b.applied += 1; all.applied += 1;
      }
      byType.set(key, b);
    }
    /** 표본이 없으면 null — 0 을 만들어 내지 않는다(0 은 '전건 무수정'이라는 다른 사실) */
    const median = (arr: number[]): number | null => {
      if (!arr.length) return null;
      const a = [...arr].sort((x, y) => x - y);
      const mid = a.length >> 1;
      return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
    };
    return {
      windowDays: d,
      generatedAt: new Date().toISOString(),
      note: 'AiDraftApply(적용)·AiDraftOutcome(확정 계측) 감사행 기준 — 2026-08-19 배선 이후 건만 있다. '
        + '🔴 무수정 승인율의 분모는 outcomes 다(applied 가 아니다 — 적용 후 확정 계측이 오지 않은 건이 있다). '
        + 'outcomes 가 0이면 medianEditDistance 는 null 이고 화면은 "산출 불가"로 그린다(0 으로 그리지 않는다). '
        + 'measured 는 초안이 있어 거리를 잰 건수(초안 없음 NO_DRAFT 제외) — 중앙값의 실제 분모다. '
        + '초안·최종 본문은 계측에 저장하지 않는다(길이·거리만).',
      total: { applied: all.applied, outcomes: all.outcomes, measured: all.measured, unchanged: all.unchanged, medianEditDistance: median(all.distances) },
      byResourceType: [...byType.entries()]
        .map(([resourceType, b]) => ({ resourceType, applied: b.applied, outcomes: b.outcomes, measured: b.measured, unchanged: b.unchanged, medianEditDistance: median(b.distances) }))
        .sort((a, b) => (b.applied + b.outcomes) - (a.applied + a.outcomes)),
    };
  }

  /**
   * 알레르기 3상태 정본 조회 — 실패·미주입은 `null`(프롬프트는 "조회 불가"라고 말한다). 조용히 "없음"이 되지 않는다.
   */
  private async allergyStatusOf(patientId: string): Promise<{ status: string; allergies: { allergen: string }[] } | null> {
    if (!this.allergyService) return null;
    try {
      const st = await this.allergyService.getStatus(patientId);
      return { status: st.status, allergies: st.allergies.map((a) => ({ allergen: a.allergen })) };
    } catch (e) {
      this.logger.warn(`알레르기 상태 조회 실패(${patientId}): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * 환자 구조화 안전 컨텍스트 — 알레르기·활성약물·활성문제. AI 호출에 주입해 안전성 강화.
   * (약물추천이 알레르기·병용약물·질환 금기를 반영하도록)
   */
  async getPatientContext(patientId: string) {
    const [allergyStatus, problems, meds, recentLabs] = await Promise.all([
      this.allergyStatusOf(patientId),
      this.prisma.problemList.findMany({ where: { patientId, status: 'ACTIVE' }, select: { description: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.prescription.findMany({ where: { encounter: { patientId }, status: 'ACTIVE' }, select: { medicationCode: { select: { nameKo: true } } }, take: 50 }),
      this.getRecentLabsSummary(patientId),
    ]);
    const allergyList = (allergyStatus?.allergies ?? []).map((a) => a.allergen);
    const medList = [...new Set(meds.map((m) => m.medicationCode?.nameKo).filter((x): x is string => !!x))];
    const problemList = problems.map((p) => p.description);
    const parts: string[] = [];
    // 🔴 활성 0건 ≠ "확인된 것 없음". 미문진/확인불가/조회실패를 구분해 말한다(NKA 정본)
    parts.push(`알레르기: ${allergyPromptLine(allergyStatus)}`);
    if (medList.length) parts.push(`현재 복용약물: ${medList.slice(0, 20).join(', ')}`);
    if (problemList.length) parts.push(`활성 문제목록: ${problemList.slice(0, 15).join(', ')}`);
    if (recentLabs.length) parts.push(`최근 검사(30일): ${recentLabs.slice(0, 12).join(', ')}`);
    return { allergies: allergyList, allergyStatus: allergyStatus?.status ?? 'UNKNOWN', medications: medList, problems: problemList, recentLabs, summaryText: parts.join(' | ') };
  }

  /**
   * AI 피드백 통계(A-9 대시보드) — 기간 내 기능별(toolsUsed[0]) 👍/👎 집계 + 최근 부정 코멘트.
   * 탭별 수집(P2 PR#233)분의 관측 화면 — 프롬프트/기능 개선 우선순위 판단용.
   */
  async feedbackStats(days = 30) {
    const d = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
    const since = new Date(Date.now() - d * 86400_000);
    const rows = await this.prisma.aiFeedback.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: { rating: true, toolsUsed: true, comment: true, createdAt: true, model: true },
    });
    const byFeature = new Map<string, { good: number; bad: number; neutral: number }>();
    for (const r of rows) {
      const feature = r.toolsUsed?.[0] ?? 'GENERAL';
      const agg = byFeature.get(feature) ?? { good: 0, bad: 0, neutral: 0 };
      if (r.rating === 'GOOD') agg.good++;
      else if (r.rating === 'BAD') agg.bad++;
      else agg.neutral++;
      byFeature.set(feature, agg);
    }
    const features = [...byFeature.entries()]
      .map(([feature, a]) => {
        const total = a.good + a.bad + a.neutral;
        // 🔴 (2026-09-17 L4) 피드백 0 건이면 '부정률 0%'(=좋은 기능)가 아니라 산출 불가 — 화면이 30% 이상을 빨갛게 그린다
    return { feature, ...a, total, badRate: total ? Math.round((a.bad / total) * 100) : null };
      })
      .sort((a, b) => b.total - a.total);
    const recentBad = rows
      .filter((r) => r.rating === 'BAD' && r.comment?.trim())
      .slice(0, 10)
      .map((r) => ({ feature: r.toolsUsed?.[0] ?? 'GENERAL', comment: r.comment, model: r.model, at: r.createdAt }));
    return { days: d, total: rows.length, features, recentBad };
  }

}
