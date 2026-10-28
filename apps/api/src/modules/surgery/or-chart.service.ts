import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, SurgeryStatus } from '@prisma/client';
import {
  checkIntraopPayload, orWriteRequiresTeam, HIS_MODE_FALLBACK, defaultOrLayout, normalizeOrLayout, intraopVitalsOf, orTeamRoleOf, surgeryFlowOf, intraopSummaryOf, roundBy, localeTimeText,
  INTRAOP_EVENT_KINDS, INTRAOP_PHASE_STAMPS, OR_DEVICE_PROFILES, OR_ROLES,
  type IntraopEventKind, type IntraopPhaseStamp, type OrDeviceProfile, type OrRole, joinPatientName } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { withAiSkill } from '../../common/util/ai-egress-fetch';
import { HisModeService } from '../../common/his-mode/his-mode.service';

/** 미래 시각 허용 오차 — 단말 시계 차이(2분) */
const FUTURE_SKEW_MS = 2 * 60_000;
/** 수술 예정·시작보다 이만큼 앞선 발생 시각은 오타로 본다(하루) */
const EARLIEST_BEFORE_MS = 24 * 3_600_000;

/**
 * 수술방 차트(2026-10-05) — 수술 중 기록 원장 · 단계 찍기 · 사람×기기×역할 배치.
 *
 * 🔴 수술 중 기록은 **덧붙이기만** — 종전 마취 기록 JSON 은 통째로 덮어써 동시 기록이 사라졌다.
 *    틀린 줄은 무효(사유 필수 · 적은 사람 또는 관리자) 후 다시 적는다.
 * 🔴 단계 시각은 정본 칸에 쓴다(유도·삽관·발관 = 마취 기록 · 절개·봉합 = 수술 원장) — 원장에 따로 두면 두 시각이 갈라진다.
 *    이미 적힌 단계는 덮지 않는다(409 + 적힌 시각) · 순서가 뒤집힌 시각은 거절.
 */
@Injectable()
export class OrChartService {
  private readonly logger = new Logger(OrChartService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly medicalAi?: MedicalAiService,
    @Optional() private readonly hisMode?: HisModeService,
  ) {}

  /** 실효 운영 모드 — 모르면 REAL(정본 폴백 · 권한을 느슨하게 읽지 않는다) */
  private async mode() {
    return this.hisMode ? this.hisMode.effective() : HIS_MODE_FALLBACK;
  }

  /**
   * 작성 권한 — 리얼이면 수술팀 자리(shared orTeamRoleOf)만 · 리허설·개발은 누구나(사용자 결정 2026-10-05).
   * 같은 판정을 차트 응답(writePolicy)에 실어 화면이 입력칸을 그릴지 정한다.
   */
  private async writePolicyOf(s: Awaited<ReturnType<OrChartService['surgeryOr404']>>, userId: string, recordAnesthetistId: string | null) {
    const mode = await this.mode();
    const teamOnly = orWriteRequiresTeam(mode);
    const onTeam = !!orTeamRoleOf({ ...s, recordAnesthetistId }, userId);
    return { mode, teamOnly, onTeam, canWrite: !teamOnly || onTeam };
  }

  private async assertCanWrite(s: Awaited<ReturnType<OrChartService['surgeryOr404']>>, userId: string) {
    const anes = await this.prisma.anesthesiaRecord.findUnique({ where: { surgeryId: s.id }, select: { anesthetistId: true } });
    const p = await this.writePolicyOf(s, userId, anes?.anesthetistId ?? null);
    if (!p.canWrite) {
      throw new ForbiddenException({ code: 'OR_TEAM_ONLY', message: '운영(리얼) 모드에서는 이 수술의 수술팀 자리(집도·보조·마취·소독·순회 간호)에 있는 사람만 기록합니다.' });
    }
  }

  private parseAt(at: string | undefined, now: Date): { at: Date; source: 'RECORDED' | 'USER_CLAIMED' } {
    if (!at) return { at: now, source: 'RECORDED' };
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('시각 형식이 올바르지 않습니다.');
    if (d.getTime() > now.getTime() + FUTURE_SKEW_MS) throw new BadRequestException('시각이 지금보다 뒤입니다.');
    return { at: d, source: 'USER_CLAIMED' };
  }

  private async surgeryOr404(id: string) {
    const s = await this.prisma.surgery.findUnique({
      where: { id },
      select: {
        id: true, status: true, scheduledAt: true, startedAt: true, endedAt: true, incisionTime: true, closureTime: true,
        procedureName: true, bodySite: true, laterality: true, anesthesiaType: true, anesthetistId: true, surgeonId: true,
        scrubNurseId: true, circulatingNurseId: true, assistantId: true, patientId: true,
        patient: { select: { id: true, familyName: true, givenName: true, koreanName: true, mrn: true, dateOfBirth: true, gender: true } },
        surgeon: { select: { familyName: true, givenName: true } },
      },
    });
    if (!s) throw new NotFoundException('수술을 찾을 수 없습니다');
    return s;
  }

  /** 수술방 차트 한 화면에 필요한 것 — 수술·단계 정본 시각·마취 기록 머리·체크리스트 요약·기록 원장·내 역할 추정 */
  async getChart(surgeryId: string, userId: string) {
    const s = await this.surgeryOr404(surgeryId);
    const [anes, cl, events, note, pacu] = await Promise.all([
      this.prisma.anesthesiaRecord.findUnique({ where: { surgeryId }, select: { anesthesiaType: true, asaClass: true, airwayType: true, inductionTime: true, intubationTime: true, extubationTime: true, anesthetistId: true, vitalSigns: true } }),
      this.prisma.surgicalChecklist.findUnique({ where: { surgeryId }, select: { signInCompletedAt: true, timeOutCompletedAt: true, signOutCompletedAt: true, countStatus: true } }),
      this.prisma.intraopEvent.findMany({ where: { surgeryId }, orderBy: [{ occurredAt: 'asc' }, { recordedAt: 'asc' }] }),
      this.prisma.surgeryOpNote.findFirst({ where: { surgeryId }, select: { incisionTime: true, closureTime: true } }),
      this.prisma.pacuRecord.findFirst({ where: { surgeryId }, orderBy: { arrivalTime: 'desc' }, select: { arrivalTime: true, dischargeTime: true } }),
    ]);
    const incisionAt = s.incisionTime ?? note?.incisionTime ?? null;
    const closureAt = s.closureTime ?? note?.closureTime ?? null;
    // 10단계 흐름 — 실시간 모니터와 같은 정본(shared surgeryFlowOf)
    const flow = surgeryFlowOf({
      SIGN_IN: cl?.signInCompletedAt, INDUCTION: anes?.inductionTime, TIME_OUT: cl?.timeOutCompletedAt, START: s.startedAt,
      INCISION: incisionAt, CLOSURE: closureAt, SIGN_OUT: cl?.signOutCompletedAt, END: s.endedAt,
      PACU_IN: pacu?.arrivalTime, PACU_OUT: pacu?.dischargeTime,
    });
    // 수술 중 기록 요약 — 셈만(AI 아님) · 합계는 정본 반올림(부동소수 잡음 제거)
    const raw = intraopSummaryOf(events, {
      induction: anes?.inductionTime, extubation: anes?.extubationTime, incision: incisionAt, closure: closureAt, start: s.startedAt, end: s.endedAt,
    });
    const ml = (v: number | null) => roundBy(v, 'intraopVolumeMl');
    const summary = {
      ...raw,
      io: { ...raw.io, fluidMl: ml(raw.io.fluidMl), bloodMl: ml(raw.io.bloodMl), urineMl: ml(raw.io.urineMl), bloodLossMl: ml(raw.io.bloodLossMl), drainMl: ml(raw.io.drainMl), otherOutMl: ml(raw.io.otherOutMl), balanceMl: ml(raw.io.balanceMl) },
      drugs: raw.drugs.map((d) => ({ ...d, total: roundBy(d.total, 'intraopDoseSum') })),
    };
    const userIds = [...new Set([...events.flatMap((e) => [e.recordedById, e.voidedById]), s.circulatingNurseId, s.scrubNurseId].filter((x): x is string => !!x))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim()]));
    // 내 역할 추정 — 수술에 지정된 자리에서만(지정이 없으면 null · 화면이 고르게 한다) · 음성 세션 허용과 같은 규칙(shared)
    const suggestedRole: OrRole | null = orTeamRoleOf({ ...s, recordAnesthetistId: anes?.anesthetistId ?? null }, userId);
    return {
      surgery: {
        id: s.id, status: s.status, procedureName: s.procedureName, bodySite: s.bodySite, laterality: s.laterality,
        scheduledAt: s.scheduledAt, startedAt: s.startedAt, endedAt: s.endedAt,
        anesthesiaType: anes?.anesthesiaType ?? s.anesthesiaType ?? null, asaClass: anes?.asaClass ?? null, airwayType: anes?.airwayType ?? null,
        patient: s.patient ? { id: s.patient.id, name: joinPatientName(s.patient.familyName, s.patient.givenName), koreanName: s.patient.koreanName ?? null, mrn: s.patient.mrn, dateOfBirth: s.patient.dateOfBirth, gender: s.patient.gender } : null,
        surgeon: s.surgeon ? `${s.surgeon.familyName}${s.surgeon.givenName}` : null,
        scrubNurse: s.scrubNurseId ? { id: s.scrubNurseId, name: nameOf.get(s.scrubNurseId) ?? null } : null,
        circulatingNurse: s.circulatingNurseId ? { id: s.circulatingNurseId, name: nameOf.get(s.circulatingNurseId) ?? null } : null,
      },
      phases: {
        INDUCTION: anes?.inductionTime ?? null, INTUBATION: anes?.intubationTime ?? null,
        INCISION: incisionAt, CLOSURE: closureAt, EXTUBATION: anes?.extubationTime ?? null,
        START: s.startedAt, END: s.endedAt,
      },
      flow,
      summary,
      anesthesiaRecordPresent: !!anes,
      // 옛 마취 기록 JSON 의 활력(읽기만 · 새 활력은 원장으로) — 배열이 아니면 null(모름)
      legacyVitals: anes ? intraopVitalsOf(anes.vitalSigns) : null,
      checklist: cl ? { signIn: !!cl.signInCompletedAt, timeOut: !!cl.timeOutCompletedAt, signOut: !!cl.signOutCompletedAt, countStatus: cl.countStatus } : null,
      events: events.map((e) => ({
        id: e.id, kind: e.kind, occurredAt: e.occurredAt, occurredAtSource: e.occurredAtSource, payload: e.payload,
        recordedAt: e.recordedAt, recordedBy: { id: e.recordedById, name: nameOf.get(e.recordedById) ?? null },
        voidedAt: e.voidedAt, voidedBy: e.voidedById ? { id: e.voidedById, name: nameOf.get(e.voidedById) ?? null } : null, voidReason: e.voidReason,
        // 늦은 기록 — 수술이 끝난 뒤에 적은 것(사실만 · 판정 아님)
        lateEntry: !!s.endedAt && e.recordedAt.getTime() > s.endedAt.getTime(),
      })),
      suggestedRole,
      writePolicy: await this.writePolicyOf(s, userId, anes?.anesthetistId ?? null),
    };
  }

  async addEvent(surgeryId: string, dto: { kind: string; payload: unknown; occurredAt?: string }, userId: string, now: Date = new Date()) {
    if (!(INTRAOP_EVENT_KINDS as readonly string[]).includes(dto.kind)) throw new BadRequestException('알 수 없는 기록 종류입니다.');
    const s = await this.surgeryOr404(surgeryId);
    if (s.status === SurgeryStatus.CANCELLED) throw new ConflictException({ code: 'SURGERY_CANCELLED', message: '취소된 수술에는 기록할 수 없습니다.' });
    await this.assertCanWrite(s, userId);
    const chk = checkIntraopPayload(dto.kind as IntraopEventKind, dto.payload);
    if (!chk.ok) throw new BadRequestException(chk.error);
    const t = this.parseAt(dto.occurredAt, now);
    // 입력 오타 차단 — 수술 예정·시작 하루 전보다 앞선 시각은 이 수술의 수술 중 기록일 수 없다
    const anchor = s.startedAt && s.startedAt < s.scheduledAt ? s.startedAt : s.scheduledAt;
    if (t.at.getTime() < anchor.getTime() - EARLIEST_BEFORE_MS) {
      throw new BadRequestException({ code: 'OCCURRED_BEFORE_SURGERY', message: '발생 시각이 수술 예정·시작보다 하루 이상 앞입니다 — 시각을 확인하세요.' });
    }
    return this.prisma.intraopEvent.create({
      data: { surgeryId, kind: dto.kind, occurredAt: t.at, occurredAtSource: t.source, payload: chk.payload as Prisma.InputJsonValue, recordedById: userId },
    });
  }

  /**
   * 순회 간호 자리 — 간호사가 "내가 맡기"(TAKE)·"내려놓기"(RELEASE).
   * 🔴 종전엔 자리 자체가 없어 순회 간호가 수술팀(음성 세션·기본 역할)에서 빠졌다.
   *    남이 맡은 자리를 넘겨받는 것도 TAKE(교대) — 덮기 전 사람은 응답·감사(변이 기본 감사)에 남는다.
   *    내려놓기는 맡은 본인 또는 관리자만(남을 지우지 않는다).
   */
  async setCirculating(surgeryId: string, action: 'TAKE' | 'RELEASE', userId: string, role: string) {
    const s = await this.surgeryOr404(surgeryId);
    if (s.status === SurgeryStatus.CANCELLED) throw new ConflictException({ code: 'SURGERY_CANCELLED', message: '취소된 수술입니다.' });
    if (action === 'TAKE') {
      if (role !== 'NURSE' && role !== 'ADMIN') throw new ForbiddenException({ code: 'NURSE_ONLY', message: '순회 간호는 간호사가 맡습니다.' });
    } else {
      if (!s.circulatingNurseId) return { circulatingNurseId: null, previous: null };
      if (role !== 'ADMIN' && s.circulatingNurseId !== userId) throw new ForbiddenException({ code: 'NOT_CIRCULATING', message: '맡은 본인만 내려놓을 수 있습니다.' });
    }
    const next = action === 'TAKE' ? userId : null;
    await this.prisma.surgery.update({ where: { id: surgeryId }, data: { circulatingNurseId: next } });
    return { circulatingNurseId: next, previous: s.circulatingNurseId };
  }

  /** 무효 — 사유 필수 · 적은 사람 또는 관리자 · 이미 무효면 그대로 409(무효 시각을 덮지 않는다) */
  async voidEvent(surgeryId: string, eventId: string, reason: string, userId: string, role: string) {
    if (!reason?.trim()) throw new BadRequestException('무효 사유를 입력하세요.');
    const e = await this.prisma.intraopEvent.findUnique({ where: { id: eventId } });
    if (!e || e.surgeryId !== surgeryId) throw new NotFoundException('기록을 찾을 수 없습니다');
    if (e.kind === 'PHASE') throw new BadRequestException({ code: 'PHASE_NOT_VOIDABLE', message: '단계 시각은 정본 칸에 있어 여기서 무효로 할 수 없습니다 — 수술 기록·마취 기록에서 바로잡으세요.' });
    if (role !== 'ADMIN' && e.recordedById !== userId) throw new ForbiddenException({ code: 'NOT_EVENT_RECORDER', message: '적은 사람만 무효로 할 수 있습니다.' });
    const r = await this.prisma.intraopEvent.updateMany({ where: { id: eventId, voidedAt: null }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason.trim().slice(0, 500) } });
    if (r.count === 0) throw new ConflictException({ code: 'ALREADY_VOIDED', message: '이미 무효로 처리된 기록입니다.' });
    return this.prisma.intraopEvent.findUnique({ where: { id: eventId } });
  }

  /**
   * 단계 찍기 — 정본 칸에 쓰고(이미 있으면 409) 원장에 PHASE 줄을 남긴다(누가 찍었는지).
   * 유도·삽관·발관은 마취 기록 칸 — 마취 기록이 없으면 만든다(마취 방법·마취과 의사가 수술에 있어야 · 없으면 409 로 말한다).
   */
  async stampPhase(surgeryId: string, phase: string, atRaw: string | undefined, userId: string, role: string, now: Date = new Date()) {
    if (!(INTRAOP_PHASE_STAMPS as readonly string[]).includes(phase)) throw new BadRequestException('알 수 없는 단계입니다.');
    const p = phase as IntraopPhaseStamp;
    const s = await this.surgeryOr404(surgeryId);
    if (s.status === SurgeryStatus.CANCELLED) throw new ConflictException({ code: 'SURGERY_CANCELLED', message: '취소된 수술입니다.' });
    await this.assertCanWrite(s, userId);
    const t = this.parseAt(atRaw, now);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM surgeries WHERE id = ${surgeryId}::uuid FOR UPDATE`;
      if (p === 'INCISION' || p === 'CLOSURE') {
        const cur = await tx.surgery.findUnique({ where: { id: surgeryId }, select: { incisionTime: true, closureTime: true } });
        // 🔴 같은 시각이 구조화 수술 기록(SurgeryOpNote)에도 있을 수 있다 — 거기 있으면 여기서 두 번째 값을 만들지 않는다(실시간 모니터와 같은 규칙)
        const note = await tx.surgeryOpNote.findFirst({ where: { surgeryId }, select: { incisionTime: true, closureTime: true } });
        const incisionAt = cur?.incisionTime ?? note?.incisionTime ?? null;
        const existing = p === 'INCISION' ? incisionAt : (cur?.closureTime ?? note?.closureTime ?? null);
        if (existing) throw new ConflictException({ code: 'PHASE_ALREADY_RECORDED', message: '이미 기록된 단계입니다.', details: { at: existing } });
        if (p === 'CLOSURE' && (!incisionAt || t.at < incisionAt)) {
          throw new BadRequestException({ code: 'PHASE_ORDER', message: '봉합은 절개가 기록된 뒤, 절개 시각 이후여야 합니다.' });
        }
        await tx.surgery.update({ where: { id: surgeryId }, data: p === 'INCISION' ? { incisionTime: t.at } : { closureTime: t.at } });
      } else {
        let anes = await tx.anesthesiaRecord.findUnique({ where: { surgeryId }, select: { id: true, inductionTime: true, intubationTime: true, extubationTime: true } });
        if (!anes) {
          // 🔴 마취의는 수술에 지정된 사람만 — 종전엔 버튼을 누른 의사(집도의라도)가 마취의로 기록됐다(누가 마취했는지를 지어냄)
          const anesthetistId = s.anesthetistId;
          if (!s.anesthesiaType || !anesthetistId) {
            throw new ConflictException({ code: 'ANESTHESIA_RECORD_MISSING', message: '마취 기록이 없고 수술에 마취 방법·마취과 의사가 지정돼 있지 않아 만들 수 없습니다 — 수술 일정에서 마취과 의사를 지정하세요.' });
          }
          anes = await tx.anesthesiaRecord.create({ data: { surgeryId, anesthetistId, anesthesiaType: s.anesthesiaType }, select: { id: true, inductionTime: true, intubationTime: true, extubationTime: true } });
        }
        const field = p === 'INDUCTION' ? 'inductionTime' : p === 'INTUBATION' ? 'intubationTime' : 'extubationTime';
        const existing = anes[field];
        if (existing) throw new ConflictException({ code: 'PHASE_ALREADY_RECORDED', message: '이미 기록된 단계입니다.', details: { at: existing } });
        // 순서: 유도 ≤ 삽관 ≤ 발관(기록된 앞 단계가 있을 때만 — 없는 단계를 요구하지 않는다 · 국소·척추 마취는 삽관이 없다)
        if (p === 'INTUBATION' && anes.inductionTime && t.at < anes.inductionTime) {
          throw new BadRequestException({ code: 'PHASE_ORDER', message: '삽관은 마취 유도 시각 이후여야 합니다.' });
        }
        if (p === 'EXTUBATION' && ((anes.intubationTime && t.at < anes.intubationTime) || (anes.inductionTime && t.at < anes.inductionTime))) {
          throw new BadRequestException({ code: 'PHASE_ORDER', message: '발관은 유도·삽관 시각 이후여야 합니다.' });
        }
        if (p === 'INDUCTION' && ((anes.intubationTime && t.at > anes.intubationTime) || (anes.extubationTime && t.at > anes.extubationTime))) {
          throw new BadRequestException({ code: 'PHASE_ORDER', message: '마취 유도는 삽관·발관 시각보다 앞이어야 합니다.' });
        }
        await tx.anesthesiaRecord.update({ where: { id: anes.id }, data: { [field]: t.at } });
      }
      return tx.intraopEvent.create({
        data: { surgeryId, kind: 'PHASE', occurredAt: t.at, occurredAtSource: t.source, payload: { phase: p } as Prisma.InputJsonValue, recordedById: userId },
      });
    });
  }

  /**
   * 수술 경과 요약 **AI 초안**(요청할 때만 · 저장하지 않는다).
   * 🔴 AI 에 주는 것은 원장에서 센 사실 목록뿐 — 이름·등록번호·자유 서술 메모는 보내지 않는다(비식별 · 메모에 이름이 섞일 수 있다).
   * 🔴 출처 3상태 — AI 가 답하지 못하면 UNAVAILABLE(대신 문장을 지어내지 않는다 · FALLBACK 없음).
   * 🔴 AI 문장의 숫자 중 사실 목록에 없는 것을 골라 돌려준다(검증 안 된 수치) — 화면이 그 자리를 표시한다.
   */
  async aiNarrative(surgeryId: string, userId: string) {
    const c = await this.getChart(surgeryId, userId);
    const facts = OrChartService.narrativeFacts(c);
    const unavailable = (reason: string) => ({ source: 'UNAVAILABLE' as const, reason, text: null, facts, unverifiedNumbers: [] as string[], languageMixed: false });
    if (facts.length <= 2) return unavailable('NO_RECORDS');
    if (!this.medicalAi) return unavailable('AI_MODULE_MISSING');
    const system =
      '당신은 수술실 기록 보조입니다. 아래 [FACTS](키=값 줄 · io 는 mL · time 은 KST 날짜·시각 · 체크리스트 단계는 수술 시작·종료가 아니다)만 사용해 한국어로 "수술 경과 요약" 초안을 5문장 이내로 쓰세요. ' +
      'FACTS 에 없는 수치·약물·사건·진단·합병증 판단·권고·평가(빠르다·효율적이다 등)를 추가하지 마세요. FACTS 에 없는 항목은 언급하지 마세요. 환자 이름을 쓰지 마세요. ' +
      '날짜·시각·수치는 FACTS 표기 그대로 옮기세요(예: 2026-10-05 14:27 · 오전/오후·12시간제로 바꾸지 마세요).';
    let text = '';
    try {
      text = await withAiSkill('surgery.intraopNarrative', () => this.medicalAi!.intraopNarrative(system, `[FACTS]\n${facts.join('\n')}`));
    } catch (e) {
      this.logger.warn(`수술 경과 요약 AI 실패 ${surgeryId}: ${e instanceof Error ? e.message : e}`);
      return unavailable('AI_ERROR');
    }
    if (!text || !text.trim()) return unavailable('AI_EMPTY');
    const known = new Set(facts.join(' ').match(/\d+(?:\.\d+)?/g) ?? []);
    const unverifiedNumbers = [...new Set((text.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !known.has(n)))];
    return {
      source: 'AI' as const, reason: null, text: text.trim().slice(0, 2000), facts, unverifiedNumbers,
      // 한자·가나가 섞이면 알린다(모델 출력 언어 섞임 실측 이력)
      languageMixed: /[\u4e00-\u9fff\u3040-\u30ff]/.test(text),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * AI 에 줄 사실 목록 — 원장에서 센 것만 · 비식별(이름·등록번호·자유 서술 없음).
   * 언어 중립 `키=값` 줄(서버가 한국어 문장을 조립하지 않는다 · 화면은 데이터로 보여 준다).
   */
  static narrativeFacts(c: Awaited<ReturnType<OrChartService['getChart']>>): string[] {
    // 날짜까지 — 시각만 주면 서로 다른 날의 단계를 같은 날로 읽는다(실측: 09-30 시작·10-05 절개를 한 흐름으로 서술)
    const hm = (iso: string) => localeTimeText(new Date(iso), 'en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    // 단계 키는 뜻이 드러나게 — 'SIGN_OUT' 을 수술 종료로 읽은 실측이 있다(체크리스트 단계와 수술 종료 버튼을 구분)
    const KEY: Record<string, string> = {
      SIGN_IN: 'safetyChecklist.signIn', INDUCTION: 'anesthesia.induction', TIME_OUT: 'safetyChecklist.timeOut', START: 'surgery.startPressed',
      INCISION: 'skinIncision', CLOSURE: 'woundClosure', SIGN_OUT: 'safetyChecklist.signOut(not surgery end)', END: 'surgery.endPressed',
      PACU_IN: 'recoveryRoom.arrival', PACU_OUT: 'recoveryRoom.discharge',
    };
    const out: string[] = [`procedure=${c.surgery.procedureName}`, `anesthesiaType=${c.surgery.anesthesiaType ?? 'unrecorded'}`];
    for (const p of c.flow.phases) if (p.at) out.push(`time.${KEY[p.key] ?? p.key}=${hm(p.at)} KST`);
    const d = c.summary.durations;
    if (d.anesthesiaMin != null) out.push(`duration.anesthesia(induction-extubation)=${d.anesthesiaMin} min`);
    if (d.incisionToClosureMin != null) out.push(`duration.incision-closure=${d.incisionToClosureMin} min`);
    if (d.startToEndMin != null) out.push(`duration.start-end=${d.startToEndMin} min`);
    for (const [k, v] of Object.entries(c.summary.io)) if (k !== 'bloodUnitsOnly' && typeof v === 'number') out.push(`io.${k}=${v}`);
    for (const [k, v] of Object.entries(c.summary.vitals)) if (v) out.push(`vital.${k}=min ${v.min}, max ${v.max}, n ${v.n}`);
    for (const dr of c.summary.drugs) out.push(`drug=${dr.name}; total ${dr.total} ${dr.unit}; doses ${dr.count}`);
    if (c.summary.counts.events) out.push(`eventRecords=${c.summary.counts.events} (text not sent)`);
    return out;
  }

  // ── 배치 ──

  private assertKeys(profile: string, role: string): { profile: OrDeviceProfile; role: OrRole } {
    if (!(OR_DEVICE_PROFILES as readonly string[]).includes(profile)) throw new BadRequestException('알 수 없는 기기 구성입니다.');
    if (!(OR_ROLES as readonly string[]).includes(role)) throw new BadRequestException('알 수 없는 수술방 역할입니다.');
    return { profile: profile as OrDeviceProfile, role: role as OrRole };
  }

  async getLayout(userId: string, profileRaw: string, roleRaw: string) {
    const { profile, role } = this.assertKeys(profileRaw, roleRaw);
    const row = await this.prisma.orChartLayout.findUnique({ where: { userId_deviceProfile_orRole: { userId, deviceProfile: profile, orRole: role } } });
    const saved = row ? normalizeOrLayout(row.layout, role, profile) : null;
    // 저장본이 있는데 모양을 모르면 그 사실을 말한다(기본으로 조용히 바꾸지 않는다)
    return { profile, role, layout: saved ?? defaultOrLayout(role, profile), source: saved ? 'SAVED' as const : row ? 'INVALID_SAVED' as const : 'DEFAULT' as const, updatedAt: row?.updatedAt ?? null };
  }

  async saveLayout(userId: string, body: { profile: string; role: string; layout: unknown }) {
    const { profile, role } = this.assertKeys(body.profile, body.role);
    const layout = normalizeOrLayout(body.layout, role, profile);
    if (!layout) throw new BadRequestException('배치 모양이 올바르지 않습니다(screens 배열).');
    const row = await this.prisma.orChartLayout.upsert({
      where: { userId_deviceProfile_orRole: { userId, deviceProfile: profile, orRole: role } },
      create: { userId, deviceProfile: profile, orRole: role, layout: layout as unknown as Prisma.InputJsonValue },
      update: { layout: layout as unknown as Prisma.InputJsonValue },
    });
    return { profile, role, layout, source: 'SAVED' as const, updatedAt: row.updatedAt };
  }

  async resetLayout(userId: string, profileRaw: string, roleRaw: string) {
    const { profile, role } = this.assertKeys(profileRaw, roleRaw);
    await this.prisma.orChartLayout.deleteMany({ where: { userId, deviceProfile: profile, orRole: role } });
    return { profile, role, layout: defaultOrLayout(role, profile), source: 'DEFAULT' as const, updatedAt: null };
  }
}
