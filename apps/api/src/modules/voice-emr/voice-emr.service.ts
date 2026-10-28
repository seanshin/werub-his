import { Injectable, BadRequestException, ForbiddenException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AuditService } from '../audit/audit.service';
import { SttChunkClient } from './stt-chunk.client';
import { buildMedicationSearchWhere } from '../../common/medication-search';
import { ScribeAiClient } from '../scribe/scribe-ai.client';
import { VitalsService } from '../vitals/vitals.service';
import { processUtterance, rebuildRxOutcome, type Outcome, type OrchestratorCtx } from './orchestrator';
import { matchNbest, type Candidate } from './nbest-matcher';
import { buildPersonalization, validateCustomPhrase, type CustomPhrase as CP } from './personalization';
import { buildVocabShortlist } from './vocab-shortlist';
import { fuzzyCodeSearch, ageOf, isVoiceprintPurged, orTeamRoleOf, orWriteRequiresTeam, HIS_MODE_FALLBACK, type VoiceprintPurgeOutcome } from '@hospital-run/shared';
import { HisModeService } from '../../common/his-mode/his-mode.service';
import { VoiceMode, VoicePhraseType, VoiceSessionStatus } from '@prisma/client';

/**
 * VoiceEMR 서비스 — 세션 수명·config 게이트·orchestrator 파싱·개인화·확정 쓰기·감사.
 * 확정(confirm) 시: T1 활력은 **활력 정본(VitalsService)** 으로 직접 기록하고, T3 오더는 정본 CPOE EP
 * 의 step-up·DUR·역할 가드를 우회하지 않도록 `handoff`(EP+payload)만 돌려준다(§confirm 주석).
 * config voiceEmr.* 기본 OFF·pilotUserIds 게이트.
 */
@Injectable()
export class VoiceEmrService {
  private readonly logger = new Logger(VoiceEmrService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
    private readonly audit: AuditService,
    private readonly stt: SttChunkClient,
    private readonly scribeAi: ScribeAiClient,
    @Optional() private readonly vitals?: VitalsService, // T1 활력 정본 쓰기
    @Optional() private readonly hisMode?: HisModeService,
  ) {}

  private async cfg<T>(key: string, def: T): Promise<T> {
    const v = await this.config.get(key).catch(() => undefined);
    return (v === undefined || v === null ? def : v) as T;
  }

  /** 마스터 킬스위치 + 파일럿 게이트 — 모든 쓰기·세션 EP 가 공유(confirm 도 재확인). */
  private async assertMasterPilot(userId: string) {
    if (!(await this.cfg('voiceEmr.enabled', false))) throw new ForbiddenException({ code: 'VOICE_EMR_DISABLED', message: 'VoiceEMR 비활성' });
    const pilots = await this.cfg<string[]>('voiceEmr.pilotUserIds', []);
    if (Array.isArray(pilots) && pilots.length && !pilots.includes('*') && !pilots.includes(userId)) {
      throw new ForbiddenException({ code: 'VOICE_EMR_NOT_PILOT', message: '파일럿 대상 아님' });
    }
  }

  /** 마스터 게이트 — voiceEmr.enabled + 파일럿. write/order 는 mode별 추가 게이트. */
  private async assertEnabled(userId: string, mode: VoiceMode) {
    await this.assertMasterPilot(userId);
    if (mode === 'DICTATE' && !(await this.cfg('voiceEmr.dictate.enabled', false))) throw new ForbiddenException({ code: 'VOICE_DICTATE_OFF', message: '구술 비활성' });
    if (mode === 'COMMAND' && !(await this.cfg('voiceEmr.order.enabled', false))) throw new ForbiddenException({ code: 'VOICE_ORDER_OFF', message: '명령/오더 비활성' });
  }

  private async loadOwnedEncounter(encounterId: string, doctorId: string) {
    const enc = await this.prisma.encounter.findUnique({ where: { id: encounterId }, select: { id: true, patientId: true, doctorId: true } });
    if (!enc) throw new NotFoundException('진료 없음');
    if (enc.doctorId !== doctorId) throw new ForbiddenException({ code: 'NOT_OWNER', message: '담당의 아님' });
    return enc;
  }

  /**
   * 세션별 인식 언어 — 개인 설정(VoiceUserProfile.language)을 STT `X-Lang` 까지 실어나르기 위한 캐시.
   * 🔴 종전엔 프로필 language 를 **아무도 읽지 않아** 설정 화면의 '언어' 선택이 동작하는 것처럼만 보였다(P16).
   */
  private readonly sessionLang = new Map<string, string>();

  /**
   * 수술 단위 세션의 문맥 — **수술팀 자리에 있는 사람만**(집도·보조·마취·소독·순회 간호 · shared `orTeamRoleOf`).
   * 진료 세션의 "담당의만"과 같은 성격의 규칙 — 같은 과·같은 병동이라는 이유로 넓히지 않는다.
   */
  private async loadTeamSurgery(surgeryId: string, userId: string) {
    const s = await this.prisma.surgery.findUnique({
      where: { id: surgeryId },
      select: { id: true, patientId: true, status: true, surgeonId: true, assistantId: true, anesthetistId: true, scrubNurseId: true, circulatingNurseId: true },
    });
    if (!s) throw new NotFoundException('수술 없음');
    if (s.status === 'CANCELLED') throw new BadRequestException({ code: 'SURGERY_CANCELLED', message: '취소된 수술입니다.' });
    const anes = await this.prisma.anesthesiaRecord.findUnique({ where: { surgeryId }, select: { anesthetistId: true } });
    // 수술방 차트 작성 권한과 같은 규칙 — 리얼만 수술팀 한정 · 리허설·개발은 누구나(사용자 결정 2026-10-05 · 모르면 REAL)
    const mode = this.hisMode ? await this.hisMode.effective() : HIS_MODE_FALLBACK;
    if (orWriteRequiresTeam(mode) && !orTeamRoleOf({ ...s, recordAnesthetistId: anes?.anesthetistId ?? null }, userId)) {
      throw new ForbiddenException({ code: 'SURGERY_TEAM_ONLY', message: '운영(리얼) 모드에서는 이 수술의 수술팀 자리(집도·보조·마취·소독·순회 간호)에 있는 사람만 음성 입력을 쓸 수 있습니다.' });
    }
    return s;
  }

  async startSession(userId: string, dto: { encounterId?: string; surgeryId?: string; mode?: string }) {
    // 문맥은 진료 하나 또는 수술 하나 — 둘 다/둘 다 없음은 거절(어느 환자의 말인지 모르게 열지 않는다)
    if (!!dto.encounterId === !!dto.surgeryId) {
      throw new BadRequestException({ code: 'VOICE_CONTEXT_REQUIRED', message: '진료 또는 수술 중 하나를 지정하세요.' });
    }
    // 🔴 종전: `dto.mode || READ` — 개인 설정의 '기본 모드'를 아무도 읽지 않았다(설정해도 항상 조회로 시작).
    //    FE 가 mode 를 명시하면 그것이 우선, 미지정이면 **개인 기본 모드**, 그것도 없으면 READ.
    const profile = await this.prisma.voiceUserProfile.findUnique({ where: { userId } }).catch(() => null);
    const mode = (dto.mode?.toUpperCase() as VoiceMode) || profile?.defaultMode || VoiceMode.READ;
    // 수술 단위 세션은 구술만 — 명령·활력·오더는 진료 문맥의 정본 경로가 있다(수술방 차트는 자기 원장에 사람이 확인해 저장)
    if (dto.surgeryId && mode !== VoiceMode.DICTATE) {
      throw new BadRequestException({ code: 'SURGERY_SESSION_DICTATE_ONLY', message: '수술 단위 음성 세션은 구술만 엽니다.' });
    }
    await this.assertEnabled(userId, mode);
    const surgery = dto.surgeryId ? await this.loadTeamSurgery(dto.surgeryId, userId) : null;
    const enc = surgery ? null : await this.loadOwnedEncounter(dto.encounterId!, userId);
    const patientId = surgery ? surgery.patientId : enc!.patientId;
    const session = await this.prisma.voiceCommandSession.create({
      data: { encounterId: enc?.id ?? null, surgeryId: surgery?.id ?? null, patientId, doctorId: userId, mode, status: VoiceSessionStatus.ACTIVE, audioRetention: mode === 'READ' ? 'none' : 'transcribed' },
    });
    const language = profile?.language || 'ko';
    this.sessionLang.set(session.id, language);
    // 워밍 + 진료별 vocab shortlist(개인 VOCAB + 환자 활성처방)
    void this.stt.warm();
    void this.primeVocab(session.id, userId, patientId).catch(() => undefined);
    return { id: session.id, mode, language, patient: await this.patientRef(patientId) };
  }

  private async primeVocab(sessionId: string, userId: string, _patientId: string) {
    const phrases = await this.prisma.voiceCustomPhrase.findMany({ where: { userId, type: VoicePhraseType.VOCAB, enabled: true }, select: { pattern: true } });
    // 환자 활성처방 병합은 후속(Prescription 약품명 필드 연동). 지금은 개인 VOCAB.
    const sl = buildVocabShortlist({ personalVocab: phrases.map((p) => p.pattern) });
    if (sl.terms.length) await this.stt.registerVocab(sessionId, sl.terms).catch(() => undefined);
  }

  private async patientRef(patientId: string) {
    const p = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { familyName: true, givenName: true, mrn: true, gender: true, dateOfBirth: true } });
    const age = p?.dateOfBirth ? ageOf(p.dateOfBirth) : undefined;
    return { name: `${p?.familyName ?? ''}${p?.givenName ?? ''}`, mrn: p?.mrn ?? '', sexAge: `${p?.gender === 'MALE' ? '남' : p?.gender === 'FEMALE' ? '여' : '-'}${age !== undefined ? `/${age}` : ''}` };
  }

  private async session(sessionId: string, userId: string) {
    const s = await this.prisma.voiceCommandSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('세션 없음');
    if (s.doctorId !== userId) throw new ForbiddenException({ code: 'NOT_OWNER', message: '세션 소유 아님' });
    return s;
  }

  /** raw PCM 청크 → STT(저지연 프록시). partial=replace·final=스티칭. lang=세션 시작 시 개인 설정. */
  async chunk(sessionId: string, pcm: Uint8Array, mode: 'partial' | 'final', sampleRate?: number, targets?: string) {
    return this.stt.sendChunk({ sessionId, pcm, mode, sampleRate, targets, lang: this.sessionLang.get(sessionId) });
  }

  /** 파싱 — orchestrator(rule 1차·환자 신원·needsConfirm). 실행 없음. */
  async parse(userId: string, sessionId: string, body: { transcript: string; confidence?: number }): Promise<{ outcomes: Outcome[] }> {
    const s = await this.session(sessionId, userId);
    const phrases = (await this.prisma.voiceCustomPhrase.findMany({ where: { userId, enabled: true } })) as unknown as CP[];
    const perso = buildPersonalization(phrases);
    const patient = await this.patientRef(s.patientId);
    const ctx: OrchestratorCtx = {
      patient,
      confidence: body.confidence,
      customPhrases: perso.parserPhrases,
      lookupCandidates: () => [], // 동기 컨텍스트 — RX/LAB n-best 는 별도 search EP(아래)
      isVitalAbnormal: (m, v) => (m === 'BP' && v[0] >= 140) || (m === 'SPO2' && v[0] < 95) || (m === 'TEMP' && (v[0] >= 38 || v[0] < 35)),
    };
    const outcomes = await this.gateDictate(s.mode, await this.withRxHighAlert(processUtterance(body.transcript, ctx)));
    await this.prisma.voiceCommandLog.create({ data: { sessionId, transcript: body.transcript, intent: outcomes[0] && 'intent' in outcomes[0] ? (outcomes[0] as { kind: string }).kind : null, slots: outcomes as unknown as object, confidence: body.confidence ?? null } });
    // 🔴 hitCount 는 증가 코드가 전역 0건이라 화면에 **영원히 0** 이었다(문구는 실제로 적용되는데 미계측).
    //    적용 사실을 여기서 계측한다 — 진짜 0(=한 번도 안 걸림)과 미계측을 구분할 수 있게.
    void this.bumpPhraseHits(phrases as unknown as Array<CP & { id: string }>, body.transcript, outcomes).catch(() => undefined);
    return { outcomes };
  }

  /**
   * 🔴 **구술(dictate) 게이트는 세션 시작 시점이 아니라 발화마다 본다.**
   *
   * 종전: `voiceEmr.dictate.enabled` 는 `assertEnabled(mode=DICTATE)` — 즉 **세션을 DICTATE 로 시작할 때만** 읽혔다.
   * FE 는 세션을 READ 로 시작했고, 파서는 어떤 규칙에도 안 걸린 발화(잡담·환자의 말·의문형)를 전부 DICTATE 로
   * 폴백한다. 그래서 운영에서 게이트가 OFF 인데도 dictate outcome 이 게이트를 한 번도 지나지 않은 채 화면으로 나갔다
   * (기획서 voice-emr-ambient-conversation §13.2 P0-1 · CLAUDE.md §4 "가짜 게이트").
   *
   * 세션 mode ≠ DICTATE 이거나 게이트 OFF 면 dictate outcome 을 `hold(DICTATE_OFF)` 로 바꾼다.
   * 다른 outcome(read·vital·order·alias·system)은 손대지 않는다. 설정 조회 실패는 **닫는 쪽**(hold)으로 접는다.
   */
  private async gateDictate(mode: VoiceMode, outcomes: Outcome[]): Promise<Outcome[]> {
    if (!outcomes.some((o) => o.kind === 'dictate')) return outcomes;
    const allowed = mode === VoiceMode.DICTATE && Boolean(await this.cfg('voiceEmr.dictate.enabled', false));
    if (allowed) return outcomes;
    return outcomes.map((o) => (o.kind === 'dictate' ? { kind: 'hold', reason: 'DICTATE_OFF' } : o));
  }

  /**
   * 🔴 **처방 outcome 의 고위험 판정을 약품 마스터로 다시 내린다.**
   *
   * `processUtterance` 는 순수 함수라 `lookupCandidates: () => []`(동기 컨텍스트)로 불린다.
   * 그 상태에서 고위험 판정을 발화어에만 맡기면 — 종전이 그랬다 — **마스터의 고위험 표식
   * 634품목·7분류가 판정에 한 번도 들어가지 않는다.** 그래서 파싱 직후 여기서 마스터를 조회해
   * 정본으로 다시 판정한다(조제·투약 경로가 쓰는 것과 같은 컬럼).
   *
   * 조회가 실패하면 **삼키지 않는다** — 발화어 선별(`TERM_SCREEN`)/미확인(`UNSCREENED`)으로
   * 남은 판정이 그대로 카드에 실리고, 그 사실은 `highAlertSource`·`highAlertReason` 에 적혀 있다.
   * (`.catch(() => [])` 로 "후보 없음"을 만들면 실패가 "고위험 아님"으로 번역된다.)
   */
  private async withRxHighAlert(outcomes: Outcome[]): Promise<Outcome[]> {
    return Promise.all(outcomes.map(async (o) => {
      if (o.kind !== 'order-rx') return o;
      const term = o.term?.trim();
      if (!term) return o;
      let rows: Array<{ code: string; nameKo: string | null; nameEn: string | null; ingredient: string | null; highAlertFlag: boolean; highAlertCategory: string | null }>;
      try {
        rows = await this.prisma.medicationCode.findMany({
          where: buildMedicationSearchWhere(term),
          select: { code: true, nameKo: true, nameEn: true, ingredient: true, highAlertFlag: true, highAlertCategory: true },
          take: 20,
        });
      } catch {
        return o; // 조회 실패 = 마스터 미조회. 판정 출처가 그대로 남는다(거짓 안심 금지).
      }
      if (!rows.length) return o;
      const candidates: Candidate[] = rows.map((r) => ({
        code: r.code,
        name: r.nameKo ?? r.nameEn ?? r.code,
        synonyms: [r.nameEn, r.ingredient].filter((s): s is string => !!s),
        highAlertFlag: r.highAlertFlag,
        highAlertCategory: r.highAlertCategory,
      }));
      return rebuildRxOutcome(o, matchNbest(term, candidates));
    }));
  }

  /**
   * 개인화 문구 적중 계측 — parse 1건에 실제로 적용된 문구의 hitCount 를 올린다.
   * HABIT/VOCAB = 전사에 패턴이 등장(파서의 치환·바이어싱 조건과 동일), ALIAS = alias outcome 의 action 일치.
   * ※ MACRO 는 파이프라인 소비처가 아직 없어 계측하지 않는다(없는 적중을 만들지 않는다).
   */
  private async bumpPhraseHits(phrases: Array<CP & { id: string }>, transcript: string, outcomes: Outcome[]) {
    const text = transcript ?? '';
    const aliasActions = outcomes.filter((o) => o.kind === 'alias').map((o) => JSON.stringify((o as { action: unknown }).action));
    const ids = phrases
      .filter((p) => p.enabled !== false)
      .filter((p) => {
        if (p.type === 'HABIT' || p.type === 'VOCAB') return !!p.pattern && text.includes(p.pattern);
        if (p.type === 'ALIAS') return aliasActions.includes(JSON.stringify(p.action));
        return false;
      })
      .map((p) => p.id)
      .filter(Boolean);
    if (!ids.length) return;
    await this.prisma.voiceCustomPhrase.updateMany({ where: { id: { in: ids } }, data: { hitCount: { increment: 1 } } });
  }

  /** 약품/검사 마스터 n-best(퍼지·초성) — 확인 카드 후보. */
  async searchCodes(kind: 'drug' | 'lab', q: string) {
    if (!q?.trim()) return [];
    if (kind === 'drug') {
      // 한/영 병용 P1(D2·D9): 공용 빌더 + fuzzy 동의어에 nameEn·ingredient 주입(영문 발화 매칭)
      const rows = await this.prisma.medicationCode.findMany({
        where: buildMedicationSearchWhere(q),
        select: { code: true, nameKo: true, nameEn: true, ingredient: true }, take: 40,
      });
      return fuzzyCodeSearch(q, rows, {
        getName: (r) => r.nameKo ?? '',
        getSynonyms: (r) => [r.nameEn, r.ingredient].filter((s): s is string => !!s),
      }).map((h) => ({ code: h.item.code, name: h.item.nameKo, score: h.score }));
    }
    const rows = await this.prisma.procedureCode.findMany({ where: { OR: [{ nameKo: { contains: q } }, { code: { contains: q } }] }, select: { code: true, nameKo: true }, take: 40 });
    return fuzzyCodeSearch(q, rows, { getName: (r) => r.nameKo ?? '' }).map((h) => ({ code: h.item.code, name: h.item.nameKo, score: h.score }));
  }

  /**
   * 확인 카드 slot → 처방 폼 프리필 draft. 카드 필드명(selectedCode·dose·labs·modality)을 그대로 읽는다.
   * `code`/`procedureCode` 는 **코드 문자열**(id 아님) — FE 처방 폼이 코드→ID 로 해석·확정한다.
   */
  private orderDraftFromSlots(intent: string, slots: Record<string, unknown>): Record<string, unknown> {
    if (intent === 'order-rx') {
      return {
        ...(slots.selectedCode ? { code: slots.selectedCode } : {}),
        ...(slots.dose != null ? { dosage: String(slots.dose) } : {}),
        ...(slots.unit ? { doseUnit: slots.unit } : {}),
        ...(slots.freq ? { frequency: slots.freq } : {}),
        ...(slots.route ? { route: slots.route } : {}),
      };
    }
    if (intent === 'order-lab') {
      const labs = Array.isArray(slots.labs) ? (slots.labs as Array<Record<string, unknown>>) : [];
      const items = labs.map((l) => ({ code: l.selectedCode ?? null, term: l.term ?? null })).filter((l) => l.code || l.term);
      return items.length ? { labs: items } : {};
    }
    // order-imaging
    return {
      ...(slots.modality ? { modality: slots.modality } : {}),
      ...(slots.bodyPart ? { bodyPart: slots.bodyPart } : {}),
    };
  }

  /** 음성 활력 metric → PreVisitVitals 필드. 혈당(BST/FBS)은 정본에 컬럼이 없어 미지원(별도 경로). */
  private vitalFields(metric: string, values: number[]): Record<string, number> | null {
    const v0 = values[0];
    switch (metric) {
      case 'BP': return values.length >= 2 ? { systolicBp: values[0], diastolicBp: values[1] } : null;
      case 'HR': return { heartRate: v0 };
      case 'TEMP': return { temperature: v0 };
      case 'SPO2': return { spo2: v0 };
      case 'RR': return { respiratoryRate: v0 };
      default: return null; // BST/FBS 등
    }
  }

  /**
   * 확정 — 사용자가 확인 카드에서 명시 확정한 결과를 **실제로 기록**한다(2026-07-30 배선).
   *
   * 안전 설계:
   *  - T1 활력: `voiceEmr.write.enabled` 게이트 통과 시 **활력 정본**(VitalsService.record)으로 기록
   *    → 이상치 알림·NEWS2·만성추이 미러링을 음성 경로도 동일하게 받는다.
   *  - T3 오더/처방: 서버가 직접 만들지 않는다. 정본 CPOE EP(`POST /encounters/:id/prescriptions`)는
   *    **처방 step-up 가드·DUR 게이트·역할 가드·여정 발행**을 컨트롤러 층에서 강제하므로, 그 층을
   *    우회하지 않기 위해 여기서는 `handoff`(EP+payload)만 돌려주고 FE 가 정본 EP 로 제출한다.
   *  - 어느 경우든 확정 사실은 VoiceCommandLog + AuditLog 에 남는다.
   */
  async confirm(userId: string, sessionId: string, body: { intent: string; slots?: object; resultKind?: string; resultRef?: string; phraseId?: string }) {
    const s = await this.session(sessionId, userId);
    // 수술 단위 세션은 확정 경로를 쓰지 않는다 — 인식 문장은 수술방 차트가 사람 확인 뒤 자기 원장에 저장한다
    if (s.surgeryId) throw new BadRequestException({ code: 'SURGERY_SESSION_NO_CONFIRM', message: '수술 단위 음성 세션은 수술방 차트에서 저장합니다.' });
    // 마스터 킬스위치·파일럿 재확인 — confirm 은 독립 EP 라, 세션 시작 후 운영자가 마스터를 OFF(비상 정지)
    // 하거나 파일럿에서 제외해도 write.enabled 만 남으면 계속 써지던 우회를 봉합.
    await this.assertMasterPilot(userId);
    // 종료·비활성 세션엔 기록 금지 — 지연/재생된 확정이 닫힌 세션에 쓰이는 것을 차단.
    if (s.status !== VoiceSessionStatus.ACTIVE) {
      throw new ForbiddenException({ code: 'VOICE_SESSION_NOT_ACTIVE', message: '종료되었거나 비활성 세션에는 기록할 수 없습니다.' });
    }
    const slots = (body.slots ?? {}) as Record<string, unknown>;
    const intent = String(body.intent || '').toLowerCase();
    let written: { kind: string; ref?: string } | null = null;
    let handoff: { ep: string; method: 'POST'; payload: Record<string, unknown>; note: string } | null = null;

    // ── T1 활력 — 정본 기록 ──
    if (intent === 'vital') {
      if (!(await this.cfg('voiceEmr.write.enabled', false))) {
        throw new ForbiddenException({ code: 'VOICE_WRITE_OFF', message: '음성 활력 입력이 비활성 상태입니다.' });
      }
      // 멱등 — 같은 phraseId 로 이미 확정된 활력이면 재기록하지 않는다(더블탭·네트워크 재시도 방어).
      if (body.phraseId) {
        const dup = await this.prisma.voiceCommandLog.findFirst({
          where: { sessionId, phraseId: body.phraseId, confirmedByUser: true, resultKind: 'VITALS' },
          select: { resultRef: true },
        });
        if (dup) return { ok: true, written: { kind: 'VITALS', ref: dup.resultRef ?? undefined }, idempotent: true };
      }
      const metric = String(slots.metric ?? '');
      const values = Array.isArray(slots.values) ? (slots.values as number[]).map(Number).filter((n) => Number.isFinite(n)) : [];
      const fields = this.vitalFields(metric, values);
      if (!fields) {
        throw new BadRequestException({ code: 'VOICE_VITAL_UNSUPPORTED', message: `음성으로 기록할 수 없는 항목입니다(${metric || '미지정'}).` });
      }
      if (!this.vitals) {
        throw new BadRequestException({ code: 'VOICE_VITAL_UNAVAILABLE', message: '활력 기록 모듈을 사용할 수 없습니다.' });
      }
      const rec = await this.vitals.record(
        { patientId: s.patientId, encounterId: s.encounterId ?? undefined, ...fields },
        userId,
      );
      // 활력 정본이 수집 포트를 지나면서 "저장하지 않음"(중복 재수신·환자 미결속)이 가능해졌다.
      // 🔴 저장되지 않았는데 `written` 을 채우면 기록된 척이 된다. 실패로 말한다.
      //    2026-08-20: 종전엔 사유를 **추측해서**("중복 또는 미결속") 말했다 — 이제 포트가 준
      //    실제 판정을 그대로 전한다.
      if (!rec.vitals) {
        const why = rec.ingest.status === 'DUPLICATE'
          ? '같은 측정이 이미 기록되어 있습니다(중복 재수신).'
          : `저장이 보류되었습니다(${rec.ingest.pendingReason ?? '사유 미상'}).`;
        throw new BadRequestException({ code: 'VOICE_VITAL_NOT_STORED', message: `활력이 저장되지 않았습니다 — ${why}` });
      }
      written = { kind: 'VITALS', ref: rec.vitals.id };
    }

    // ── T2 구술 — 서버는 쓰지 않는다(SOAP 는 FE 폼 상태 → 저장/서명 정본 EP). 게이트만 parse 와 같은 조건으로 재확인 ──
    //    확정은 독립 EP 라 parse 가 hold 로 바꿨어도 클라이언트가 dictate 를 confirm 으로 밀어 넣을 수 있다.
    if (intent === 'dictate') {
      if (s.mode !== VoiceMode.DICTATE || !(await this.cfg('voiceEmr.dictate.enabled', false))) {
        throw new ForbiddenException({ code: 'VOICE_DICTATE_OFF', message: '구술이 비활성 상태입니다.' });
      }
    }

    // ── T3 오더/처방 — 정본 EP 로 위임(게이트 우회 금지) ──
    if (intent === 'order-rx' || intent === 'order-lab' || intent === 'order-imaging') {
      if (!(await this.cfg('voiceEmr.order.enabled', false))) {
        throw new ForbiddenException({ code: 'VOICE_ORDER_OFF', message: '음성 오더가 비활성 상태입니다.' });
      }
      if (!s.encounterId) {
        throw new BadRequestException({ code: 'VOICE_ORDER_NO_ENCOUNTER', message: '진료 문맥이 없어 오더를 낼 수 없습니다.' });
      }
      const type = intent === 'order-rx' ? 'MEDICATION' : intent === 'order-lab' ? 'LAB' : 'IMAGING';
      // 확인 카드에서 파싱된 실제 오더를 draft 로 옮긴다(FE 처방 폼 프리필용).
      // 코드 문자열→medicationCodeId/procedureCodeId 해석·DUR·step-up·역할 가드는 정본 EP 층에서 강제.
      handoff = {
        ep: `/api/v1/encounters/${s.encounterId}/prescriptions`,
        method: 'POST',
        payload: { type, ...this.orderDraftFromSlots(intent, slots) },
        note: '정본 CPOE EP 로 제출하세요(DUR·step-up·역할 가드는 그 경로에서 강제됩니다).',
      };
    }

    await this.prisma.voiceCommandLog.create({ data: { sessionId, intent: body.intent, slots: slots as object, resultKind: body.resultKind ?? written?.kind ?? null, resultRef: body.resultRef ?? written?.ref ?? null, phraseId: body.phraseId ?? null, confirmedByUser: true } });
    await this.audit.log({ action: 'CREATE', resourceType: 'VoiceCommandSession', resourceId: sessionId, userId, changes: { voiceConfirm: { old: null, new: { intent: body.intent, resultKind: body.resultKind ?? written?.kind, written: written?.ref ?? null, patientId: s.patientId } } } }).catch((e) => {
      // 음성 확정은 기록됐지만 감사 사본이 빠진다 — 조용히 삼키지 않는다
      this.logger.warn(`voice confirm audit write failed session=${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
    });
    return { ok: true, ...(written ? { written } : {}), ...(handoff ? { handoff } : {}) };
  }

  async closeSession(userId: string, sessionId: string) {
    const s = await this.session(sessionId, userId);
    await this.prisma.voiceCommandSession.update({ where: { id: s.id }, data: { status: VoiceSessionStatus.CLOSED, closedAt: new Date() } });
    this.sessionLang.delete(sessionId);
    return { ok: true };
  }

  // ── 화자 음성 등록(생체인식·성문) ──
  // 생체정보=민감정보(개인정보보호법 §23) → 별도 명시 동의 필수. 미동의=마이크 분리 사용(fail-open).
  static readonly CONSENT_VERSION = '2026-07-v1';
  static readonly ENROLL_MIN_SAMPLES = 3;
  static readonly ENROLL_MAX_SAMPLES = 8;

  /**
   * 화자 등록 현황(동의·표본·상태). 등록 안내 문구 상수도 반환.
   *
   * 🔴 종전: 성문 참조(voiceprintRef)가 **없어도** status='enrolled' 를 그대로 돌려줘, 화면이
   *    "● 등록됨 / 표본 4개로 등록 완료" 라고 말했다. 실제로는 AI 서버에 성문이 없어 화자 인식은
   *    한 번도 동작할 수 없는 상태였다(P16 — 하지 않은 것을 했다고 말함).
   *    이제 성문이 없으면 '등록됨'이 아니다: 상태를 pending 으로 정정하고 그 사실(voiceprintPresent·
   *    voiceprintMissing)을 응답에 담아 화면이 이유를 말할 수 있게 한다. 저장된 값은 바꾸지 않는다(표시 정정).
   */
  async getEnrollStatus(userId: string) {
    const p = await this.prisma.voiceUserProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    const voiceprintPresent = !!p.voiceprintRef;
    const voiceprintMissing = p.voiceprintStatus === 'enrolled' && !voiceprintPresent;
    /**
     * 동의는 철회됐는데 AI 서버 성문이 남아 있는 상태(파기 미완료). 철회 응답 한 번만 말하면
     * 새로고침 뒤엔 사라지므로 **저장 상태에서 파생**해 화면이 계속 말할 수 있게 한다(재시도 = 철회 EP 재호출).
     */
    const remotePurgePending = p.voiceprintStatus === 'revoked' && voiceprintPresent;
    return {
      status: voiceprintMissing ? 'pending' : p.voiceprintStatus,
      storedStatus: p.voiceprintStatus,
      voiceprintPresent,
      voiceprintMissing,
      remotePurgePending,
      sampleCount: p.voiceprintSampleCount,
      minSamples: VoiceEmrService.ENROLL_MIN_SAMPLES,
      maxSamples: VoiceEmrService.ENROLL_MAX_SAMPLES,
      enrolledAt: p.voiceprintEnrolledAt,
      consented: !!p.biometricConsentAt,
      consentAt: p.biometricConsentAt,
      consentVersion: p.biometricConsentVer,
      requiredConsentVersion: VoiceEmrService.CONSENT_VERSION,
      speakerGateEnabled: p.speakerGateEnabled,
    };
  }

  /** 생체정보 처리 동의 기록/철회. 동의 없이는 표본 수집 불가(게이트). */
  async recordConsent(userId: string, agreed: boolean, version?: string) {
    if (!(await this.cfg('voiceEmr.enabled', false))) throw new ForbiddenException({ code: 'VOICE_EMR_DISABLED', message: 'VoiceEMR 비활성' });
    if (agreed) {
      await this.prisma.voiceUserProfile.upsert({
        where: { userId },
        create: { userId, biometricConsentAt: new Date(), biometricConsentVer: version ?? VoiceEmrService.CONSENT_VERSION, voiceprintStatus: 'pending' },
        update: { biometricConsentAt: new Date(), biometricConsentVer: version ?? VoiceEmrService.CONSENT_VERSION, voiceprintStatus: 'pending' },
      });
      await this.audit.log({ action: 'CREATE', resourceType: 'VoiceBiometricConsent', resourceId: userId, userId, changes: { consent: { old: null, new: { agreed: true, version: version ?? VoiceEmrService.CONSENT_VERSION } } } }).catch(() => undefined);
    } else {
      // 철회 = 성문 삭제 + 동의 회수(파기)
      return this.revokeEnroll(userId);
    }
    return this.getEnrollStatus(userId);
  }

  /**
   * 등록 표본 1건 수신 → 성문 임베딩 전송(WeRU.B).
   *
   * 🔴 종전: AI 서버 미가용이면 **fail-open** 으로 표본 수만 올렸다. 오디오는 HIS 에 보관하지 않으므로
   *    그 카운트는 "저장된 표본"이 아니라 "시도 횟수"였고, 3회를 넘기면 completeEnroll 이 성문 없이
   *    'enrolled' 를 확정해 화면이 등록됐다고 말했다(운영 실측: enrolled·표본 4·voiceprint_ref NULL).
   *    표본은 **서버가 실제로 받았을 때만** 센다. 미가용은 미가용이라고 말한다(fail-closed).
   */
  async enrollSample(userId: string, pcm: Uint8Array, sampleRate?: number, promptId?: string) {
    if (!(await this.cfg('voiceEmr.enabled', false))) throw new ForbiddenException({ code: 'VOICE_EMR_DISABLED', message: 'VoiceEMR 비활성' });
    const p = await this.prisma.voiceUserProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    if (!p.biometricConsentAt) throw new ForbiddenException({ code: 'BIOMETRIC_CONSENT_REQUIRED', message: '생체정보 처리 동의가 필요합니다' });
    if (p.voiceprintSampleCount >= VoiceEmrService.ENROLL_MAX_SAMPLES) throw new BadRequestException({ code: 'ENROLL_MAX', message: '표본 한도 도달' });
    // 최소 길이 방어(무음/오발성 표본 배제): 16kHz mono 16-bit → 1.2초 미만이면 거절
    const minBytes = Math.floor((sampleRate ?? 16000) * 2 * 1.2);
    if (pcm.byteLength < minBytes) throw new BadRequestException({ code: 'SAMPLE_TOO_SHORT', message: '표본이 너무 짧습니다(최소 약 1.2초)' });
    const r = await this.stt.enrollSample({ speakerId: userId, pcm, sampleRate, promptId });
    if (!r.ok) {
      // 성문 서버가 표본을 받지 않았다 — 아무 데도 남지 않았으므로 카운트도 올리지 않는다.
      return {
        accepted: false,
        sampleCount: p.voiceprintSampleCount,
        minSamples: VoiceEmrService.ENROLL_MIN_SAMPLES,
        maxSamples: VoiceEmrService.ENROLL_MAX_SAMPLES,
        serverEnrolled: false,
        serverUnavailable: !!r.unavailable,
        reason: r.unavailable ? 'VOICEPRINT_SERVER_UNAVAILABLE' : 'VOICEPRINT_SERVER_REJECTED',
        message: r.unavailable
          ? '성문 서버(WeRU.B)가 아직 등록을 받지 않습니다 — 표본이 저장되지 않았습니다.'
          : '성문 서버가 표본을 거절했습니다 — 다시 시도해주세요.',
      };
    }
    const count = p.voiceprintSampleCount + 1;
    await this.prisma.voiceUserProfile.update({
      where: { userId },
      data: { voiceprintSampleCount: count, voiceprintStatus: 'pending', ...(r.ref ? { voiceprintRef: r.ref } : {}) },
    });
    return { accepted: true, sampleCount: count, minSamples: VoiceEmrService.ENROLL_MIN_SAMPLES, maxSamples: VoiceEmrService.ENROLL_MAX_SAMPLES, serverEnrolled: true, serverUnavailable: false, quality: r.quality };
  }

  /** 등록 완료 확정 — 최소 표본 + **서버 성문 참조**가 모두 있어야 enrolled. */
  async completeEnroll(userId: string) {
    const p = await this.prisma.voiceUserProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    if (!p.biometricConsentAt) throw new ForbiddenException({ code: 'BIOMETRIC_CONSENT_REQUIRED', message: '생체정보 처리 동의가 필요합니다' });
    if (p.voiceprintSampleCount < VoiceEmrService.ENROLL_MIN_SAMPLES) throw new BadRequestException({ code: 'ENROLL_INSUFFICIENT', message: `표본 ${VoiceEmrService.ENROLL_MIN_SAMPLES}개 이상 필요` });
    // 🔴 로컬 표본 수만 보고 'enrolled' 를 확정하던 자리 — 성문이 서버에 없으면 등록이 아니다.
    if (!p.voiceprintRef) {
      throw new BadRequestException({
        code: 'ENROLL_NO_VOICEPRINT',
        message: '성문이 서버에 등록되지 않아 완료할 수 없습니다(성문 서버 연동 대기). 표본만으로는 화자 인식이 동작하지 않습니다.',
      });
    }
    const updated = await this.prisma.voiceUserProfile.update({ where: { userId }, data: { voiceprintStatus: 'enrolled', voiceprintEnrolledAt: new Date() } });
    await this.audit.log({ action: 'UPDATE', resourceType: 'VoiceUserProfile', resourceId: userId, userId, changes: { voiceprintEnrolled: { old: null, new: { samples: updated.voiceprintSampleCount } } } }).catch(() => undefined);
    return this.getEnrollStatus(userId);
  }

  /**
   * 등록 철회 — 성문 삭제(WeRU.B) + 동의/표본 파기(개인정보보호법 §21 파기의무).
   *
   * 🔴 종전: `await this.stt.deleteSpeaker(userId).catch(() => undefined)` — 삭제 클라이언트는 **던지지 않고**
   *    `{ok, unavailable}` 로 답하는데(`stt-chunk.client.ts:155`) 그 `.catch` 는 아무것도 안 잡고 **반환값만
   *    버리고** 있었다. 원격 성문이 남아 있어도 로컬에서 `voiceprintRef` 까지 지워서 ① 화면은 '철회·삭제 완료'라
   *    말하고 ② 참조가 사라져 **재시도할 방법도 없었다**. 파기하지 못한 것을 파기했다고 말한 자리다.
   *
   *    이제: 동의 철회는 **즉시 효력**(게이트 off·표본 0·동의 회수 — 철회는 사용자의 권리이므로 원격 실패에
   *    묶어두지 않는다)이고, 원격 파기는 3상태로 말한다. 미파기면 `voiceprintStatus='revoked'` + `voiceprintRef`
   *    **보존** → 화면이 "파기 미완료"를 계속 말하고 같은 철회 EP 재호출이 재시도가 된다.
   *    🔴 참조 보존이 식별을 되살리지 않는다 — 화자 판정이 보는 것은 `speakerGateEnabled`(false 로 내린다)이고
   *    `voiceprintRef` 를 읽어 인식하는 경로는 없다(전역 grep 실측 2026-09-27: 소비처는 이 파일의 등록 상태 판정뿐).
   */
  async revokeEnroll(userId: string) {
    const p = await this.prisma.voiceUserProfile.findUnique({ where: { userId } });
    const hadVoiceprint = !!(p?.voiceprintRef || p?.voiceprintSampleCount);
    let purge: VoiceprintPurgeOutcome = 'NOT_PRESENT';
    if (hadVoiceprint) {
      const del = await this.stt.deleteSpeaker(userId);
      purge = del.ok ? 'PURGED' : del.unavailable ? 'REMOTE_UNAVAILABLE' : 'REMOTE_FAILED';
    }
    const purged = isVoiceprintPurged(purge);
    if (!purged) {
      this.logger.error(`성문 원격 파기 미완료(${purge}) — 동의는 철회, 참조 보존으로 재시도 가능: userId=${userId}`);
    }
    const revokedFields = { voiceprintSampleCount: 0, voiceprintEnrolledAt: null, biometricConsentAt: null, biometricConsentVer: null, speakerGateEnabled: false };
    const updated = await this.prisma.voiceUserProfile.upsert({
      where: { userId },
      create: { userId, voiceprintStatus: 'none' },
      update: purged
        ? { ...revokedFields, voiceprintStatus: 'none', voiceprintRef: null }
        : { ...revokedFields, voiceprintStatus: 'revoked' }, // 참조 보존 = 재시도 포인터
    });
    await this.audit.log({ action: 'DELETE', resourceType: 'VoiceBiometricConsent', resourceId: userId, userId, changes: { revoke: { old: { enrolled: true }, new: { remoteVoiceprintPurge: purge } } } }).catch(() => undefined);
    return { ...(await this.getEnrollStatus(updated.userId)), remoteVoiceprintPurge: purge };
  }

  // ── 다자간 화자분리(diarization) 테스트 ──
  // 여러 명 대화 녹음 → WeRU.B 업로드 → diarize 잡 → 화자별 텍스트. 확장 예정(회진·다직역 협진 기록).
  // scribe-ai.client 재사용(업로드→/api/meeting/analyze→폴링). 스키마 미확정(D-2)이라 방어적 파싱.
  async submitDiarizeTest(userId: string, audioBase64: string, mime?: string) {
    if (!(await this.cfg('voiceEmr.enabled', false))) throw new ForbiddenException({ code: 'VOICE_EMR_DISABLED', message: 'VoiceEMR 비활성' });
    const buf = Buffer.from(audioBase64, 'base64');
    if (buf.byteLength < 8000) throw new BadRequestException({ code: 'CLIP_TOO_SHORT', message: '녹음이 너무 짧습니다' });
    const ext = mime?.includes('wav') ? 'wav' : mime?.includes('ogg') ? 'ogg' : 'webm';
    const fileUrl = await this.scribeAi.uploadAudio(buf, `diarize-test-${Date.now()}.${ext}`, mime || 'audio/webm');
    const jobId = await this.scribeAi.submitTranscription(fileUrl, true);
    // 🔴 소유 증적 — 폴링(pollDiarizeTest)이 이 기록으로 본인 잡인지 확인한다. 실패를 삼키면(.catch)
    //    소유를 증명할 방법이 사라지므로 여기서는 삼키지 않는다(감사 실패 = 제출 실패).
    await this.audit.log({ action: 'CREATE', resourceType: 'VoiceDiarizeTest', resourceId: userId, userId, changes: { diarizeTest: { old: null, new: { jobId, bytes: buf.byteLength } } } });
    return { jobId };
  }

  /**
   * 화자분리 잡 폴링.
   * 🔴 종전 시그니처는 `(_userId, jobId)` — userId 를 **버렸다**. jobId 만 알면 남의 진료 대화
   *    화자분리 전문(fullText·세그먼트)을 그대로 받아볼 수 있었다(IDOR). 제출 시 남긴 감사 기록으로
   *    소유를 확인하고, 남의 잡과 없는 잡을 똑같이 404 로 답한다.
   */
  async pollDiarizeTest(userId: string, jobId: string) {
    const owned = await this.prisma.auditLog.findFirst({
      where: {
        resourceType: 'VoiceDiarizeTest',
        resourceId: userId,
        userId,
        changes: { path: ['diarizeTest', 'new', 'jobId'], equals: jobId },
      },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException({ code: 'DIARIZE_JOB_NOT_FOUND', message: '해당 화자분리 작업을 찾을 수 없습니다' });
    const { status, error, raw } = await this.scribeAi.pollJob(jobId);
    const done = /done|complete|success|finished/i.test(status);
    const failed = /fail|error/i.test(status);
    if (!done) return { jobId, status, done: false, failed, error };
    const t = this.scribeAi.parseTranscription(raw);
    // 화자 라벨 안정화 — 등장 순서대로 '화자 1/2/3'
    const order = new Map<string, number>();
    const segments = t.segments.map((s) => {
      if (!order.has(s.speaker)) order.set(s.speaker, order.size + 1);
      return { speaker: s.speaker, speakerLabel: `화자 ${order.get(s.speaker)}`, start: s.start, end: s.end, text: s.text };
    });
    return { jobId, status, done: true, failed: false, diarized: t.diarized, speakerCount: order.size, fullText: t.fullText, segments };
  }

  // ── 개인화 관리 ──
  async getProfile(userId: string) {
    const p = await this.prisma.voiceUserProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    return p;
  }
  async updateProfile(userId: string, body: { defaultMode?: string; pttEnabled?: boolean; speakerGateEnabled?: boolean; language?: string }) {
    return this.prisma.voiceUserProfile.upsert({
      where: { userId },
      create: { userId, defaultMode: (body.defaultMode?.toUpperCase() as VoiceMode) || VoiceMode.READ, pttEnabled: body.pttEnabled ?? true, speakerGateEnabled: body.speakerGateEnabled ?? false, language: body.language ?? 'ko' },
      update: { ...(body.defaultMode ? { defaultMode: body.defaultMode.toUpperCase() as VoiceMode } : {}), ...(body.pttEnabled !== undefined ? { pttEnabled: body.pttEnabled } : {}), ...(body.speakerGateEnabled !== undefined ? { speakerGateEnabled: body.speakerGateEnabled } : {}), ...(body.language ? { language: body.language } : {}) },
    });
  }
  async listPhrases(userId: string, type?: string) {
    return this.prisma.voiceCustomPhrase.findMany({ where: { userId, ...(type ? { type: type.toUpperCase() as VoicePhraseType } : {}) }, orderBy: [{ type: 'asc' }, { priority: 'asc' }] });
  }
  async addPhrase(userId: string, body: { type: string; pattern: string; action?: object; priority?: number }) {
    const type = body.type?.toUpperCase() as VoicePhraseType;
    const v = validateCustomPhrase({ type: type as CP['type'], pattern: body.pattern, action: body.action });
    if (!v.valid) throw new BadRequestException({ code: v.error, message: `문구 검증 실패: ${v.error}` });
    return this.prisma.voiceCustomPhrase.create({ data: { userId, type, pattern: body.pattern.trim(), action: (body.action ?? {}) as object, priority: body.priority ?? 100 } });
  }
  async togglePhrase(userId: string, id: string, enabled: boolean) {
    const p = await this.prisma.voiceCustomPhrase.findUnique({ where: { id } });
    if (!p || p.userId !== userId) throw new NotFoundException('문구 없음');
    return this.prisma.voiceCustomPhrase.update({ where: { id }, data: { enabled } });
  }
  async deletePhrase(userId: string, id: string) {
    const p = await this.prisma.voiceCustomPhrase.findUnique({ where: { id } });
    if (!p || p.userId !== userId) throw new NotFoundException('문구 없음');
    await this.prisma.voiceCustomPhrase.delete({ where: { id } });
    return { ok: true };
  }
}
