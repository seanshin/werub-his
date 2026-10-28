import { Injectable, NotFoundException, ConflictException, BadRequestException, Optional, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
// 게이트 위반 원장 — 차단만 하고 남기지 않으면 관제의 '0건'이 준수인지 미평가인지 구분 불가
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { gateMode } from '../../common/gate-mode';
import { nonEmptyStringArrayOr } from '../../common/qi-targets';
import { LATERALITY_REQUIRED_KEYWORDS } from '../../common/laterality-keywords';
import { UpdateSurgicalChecklistDto, UpsertPreAnesthesiaDto } from './dto/surgery-advanced.dto';
import { recordGateViolation } from '../../common/gate-enforce';

/**
 * 수술 계수(거즈·바늘·기구) 종합 판정 — **숫자가 정본**이다.
 *
 * 🔴 거즈·기구 계수는 사람이 두 번 세는 절차다. 화면이 그 절차를 대신할 수는 없지만,
 *    **입력된 숫자가 어긋나는데 'MATCH' 로 저장되는 일**은 막아야 한다 —
 *    잔류이물 게이트(`assertCountReconciled`)는 정확히 'MISMATCH' 일 때만 차단하므로
 *    자유 판정을 그대로 믿으면 게이트가 조용히 열린다.
 *
 * 규칙(안전한 방향으로만 서버가 개입한다):
 *   · 초기≠최종 이 하나라도 있으면 → MISMATCH (화면이 MATCH 라고 해도 덮는다)
 *   · 사람이 한 품목이라도 MISMATCH 로 표시했거나 종합판정을 MISMATCH 로 보냈으면 → MISMATCH
 *   · 그 외에는 **전 품목을 사람이 확인(MATCH|NA)** 했을 때만 MATCH
 *     — 숫자가 같다는 이유만으로 자동 MATCH 하지 않는다(오타를 '확인됨'으로 만들지 않기 위해)
 *   · 확인이 덜 끝났으면 → UNRESOLVED
 */
export function deriveCountStatus(items: unknown, provided?: string): string {
  if (!Array.isArray(items)) return provided ?? 'UNRESOLVED';
  const rows = items as Array<{ initial?: unknown; final?: unknown; status?: unknown }>;
  const numericMismatch = rows.some(
    (r) => typeof r?.initial === 'number' && typeof r?.final === 'number' && r.initial !== r.final,
  );
  if (numericMismatch) return 'MISMATCH';
  if (rows.some((r) => r?.status === 'MISMATCH')) return 'MISMATCH';
  if (provided === 'MISMATCH') return 'MISMATCH';
  if (rows.length > 0 && rows.every((r) => r?.status === 'MATCH' || r?.status === 'NA')) return 'MATCH';
  return 'UNRESOLVED';
}

@Injectable()
export class SurgeryAdvancedService {
  /** 🔴 게이트 위반 원장 기록이 실패하거나 원장이 미주입일 때, 그 사실을 지우지 않고 남긴다 */
  private readonly logger = new Logger(SurgeryAdvancedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
    @Optional() private readonly gates?: SafetyGateService,
  ) {}

  // ── Operating Room ──

  async getRooms() {
    return this.prisma.operatingRoom.findMany({
      where: { isActive: true },
      include: { _count: { select: { schedules: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createRoom(data: {
    name: string; floor?: string; roomType: string;
    equipment?: Record<string, unknown>;
  }) {
    return this.prisma.operatingRoom.create({
      data: {
        name: data.name,
        floor: data.floor,
        roomType: data.roomType,
        equipment: data.equipment as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 시각 문자열을 분으로 — **정렬은 문자열에 기대지 않는다**.
   *
   * 🔴 `startTime` 은 문자열이라 사전순 정렬이 `15:00` 뒤에 `9:00` 을 놓는다.
   *    2026-09-03 운영이 정확히 그 상태였다(`… 13:00 14:52 15:00 9:00`) —
   *    **오전 9시 수술이 오후 3시 뒤에** 보였고, 수술 순서는 금식·마취 준비와 직결된다.
   *    DTO 가 이제 `HH:MM` 을 강제하지만 **기존 행은 그대로 남는다**(데이터를 코드로 교정하지 않는다).
   *    그래서 표시하는 쪽이 방어한다. 형식이 아니면 맨 뒤로 보내되 **버리지 않는다**.
   */
  private static minutesOf(t: string | null | undefined): number {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? ''));
    if (!m) return Number.MAX_SAFE_INTEGER;
    const h = Number(m[1]); const mi = Number(m[2]);
    if (h > 23 || mi > 59) return Number.MAX_SAFE_INTEGER;
    return h * 60 + mi;
  }

  async getRoomSchedule(roomId: string, date: string) {
    const targetDate = new Date(date);
    const rows = await this.prisma.orSchedule.findMany({ where: { roomId, date: targetDate } });
    // 🔴 DB 문자열 정렬이 아니라 **분으로** 정렬한다(`9:00` 이 `15:00` 뒤로 가지 않게)
    return rows.sort((a, b) => SurgeryAdvancedService.minutesOf(a.startTime) - SurgeryAdvancedService.minutesOf(b.startTime));
  }

  async assignRoom(data: {
    roomId: string; surgeryId: string; date: string;
    startTime: string; endTime: string; estimatedDuration: number;
  }) {
    const targetDate = new Date(data.date);
    // OR 룸 이중예약 방지 — 룸 단위 advisory lock으로 충돌검사+생성 원자화(check-then-act race 제거)
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`or:${data.roomId}`}))`;
      const conflicts = await tx.orSchedule.findMany({
        where: {
          roomId: data.roomId,
          date: targetDate,
          status: { not: 'CANCELLED' },
          OR: [
            { startTime: { lt: data.endTime }, endTime: { gt: data.startTime } },
          ],
        },
      });
      if (conflicts.length > 0) {
        throw new ConflictException('해당 시간에 이미 수술이 예약되어 있습니다');
      }
      return tx.orSchedule.create({
        data: {
          roomId: data.roomId,
          surgeryId: data.surgeryId,
          date: targetDate,
          startTime: data.startTime,
          endTime: data.endTime,
          estimatedDuration: data.estimatedDuration,
        },
      });
    });
  }

  async getOrBoard(date?: string) {
    // 🔴 @db.Date 는 UTC 자정으로 저장 — 로컬(KST) 자정으로 비교하면 -9h 어긋나 오늘 일정이 0건이 된다
    const kst = new Date(Date.now() + 9 * 3600_000);
    const targetDate = date
      ? new Date(date) // 'YYYY-MM-DD' → UTC 자정(저장 표현과 동일)
      : new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));

    const rooms = await this.prisma.operatingRoom.findMany({
      where: { isActive: true },
      include: {
        // 🔴 문자열 정렬은 `9:00` 을 `15:00` 뒤로 보낸다 — 아래에서 분으로 다시 세운다
        schedules: { where: { date: targetDate } },
      },
      orderBy: { name: 'asc' },
    });

    // 일정에 수술 정보 조인(OrSchedule↔Surgery 는 관계 부재) — 보드 카드가 "무슨 수술·누가"를 말할 수 있게
    const surgeryIds = rooms.flatMap((r) => r.schedules.map((s) => s.surgeryId));
    const surgeries = surgeryIds.length
      ? await this.prisma.surgery.findMany({
          where: { id: { in: surgeryIds } },
          select: {
            id: true, procedureName: true, status: true, startedAt: true,
            patient: { select: { familyName: true, givenName: true } },
            surgeon: { select: { familyName: true, givenName: true } },
          },
        })
      : [];
    const surgeryById = new Map(surgeries.map((s) => [s.id, s]));

    return rooms.map(room => {
      const ordered = [...room.schedules].sort(
        (a, b) => SurgeryAdvancedService.minutesOf(a.startTime) - SurgeryAdvancedService.minutesOf(b.startTime),
      );
      return {
        ...room,
        schedules: ordered.map((s) => ({ ...s, surgery: surgeryById.get(s.surgeryId) ?? null })),
        currentStatus: this.getRoomCurrentStatus(ordered),
      };
    });
  }

  /**
   * 수술실 현재 상태 — 🔴 **문자열 비교로 시각을 재지 않는다**(2026-09-03 운영 실측).
   *    종전에는 `s.startTime <= currentTime` 처럼 **사전순**으로 비교했다.
   *    `or_schedules` 에 0 을 안 채운 `9:00` 이 섞여 있었고, `'9:00' <= '09:35'` 는 **거짓**이라
   *    **수술이 진행 중인 방을 '사용 가능'으로 표시**했다. 빈 방인 줄 알고 배정하면 충돌이다.
   *    형식을 모르면 `MAX_SAFE_INTEGER` 로 두어 **진행 중으로 오판하지 않는다**(안전측).
   */
  private getRoomCurrentStatus(schedules: Array<{ status: string; startTime: string; endTime: string }>) {
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const live = schedules.filter((s) => s.status !== 'CANCELLED');
    const mo = SurgeryAdvancedService.minutesOf;
    if (live.some((s) => mo(s.startTime) <= cur && mo(s.endTime) > cur)) return 'IN_USE';
    if (live.some((s) => mo(s.startTime) > cur)) return 'SCHEDULED';
    return 'AVAILABLE';
  }

  // ── Pre-anesthesia Evaluation (2026-07 R2-2 — 술전 독립 게이트) ──

  private static readonly PRE_ANES_REQUIRED: { field: string; label: string; check?: (v: unknown) => boolean }[] = [
    { field: 'asaClass', label: 'ASA 분류' },
    { field: 'airwayMallampati', label: '기도평가(Mallampati)' },
    { field: 'npoConfirmed', label: '금식(NPO) 확인', check: (v) => v === true },
    { field: 'labsReviewed', label: '술전검사 리뷰', check: (v) => v === true },
    { field: 'anesthesiaConsent', label: '마취 동의 확인', check: (v) => v === true },
    { field: 'plan', label: '마취 계획' },
  ];

  async getPreAnesthesia(surgeryId: string) {
    return this.prisma.preAnesthesiaEvaluation.findUnique({
      where: { surgeryId },
      include: { evaluator: { select: { familyName: true, givenName: true, department: true } } },
    });
  }

  /** 마취 기록 조회(수술 단위) — SurgeryAdvanced 마취 탭 */
  async getAnesthesiaRecord(surgeryId: string) {
    return this.prisma.anesthesiaRecord.findUnique({ where: { surgeryId } });
  }

  /** PACU 기록 조회(수술 단위) — SurgeryAdvanced 회복실 탭. 퇴실은 게이트(POST /pacu/:id/discharge·Aldrete/PADSS)로만. */
  async getPacuRecord(surgeryId: string) {
    return this.prisma.pacuRecord.findFirst({
      where: { surgeryId },
      orderBy: { arrivalTime: 'desc' },
    });
  }

  /** 평가 작성/수정(DRAFT) — 완료 후 수정 불가(정정은 감사 관점에서 재평가로) */
  async upsertPreAnesthesia(surgeryId: string, dto: UpsertPreAnesthesiaDto, evaluatorId: string) {
    const surgery = await this.prisma.surgery.findUnique({ where: { id: surgeryId }, select: { id: true, patientId: true } });
    if (!surgery) throw new NotFoundException('수술을 찾을 수 없습니다');
    const existing = await this.prisma.preAnesthesiaEvaluation.findUnique({ where: { surgeryId } });
    if (existing?.status === 'COMPLETED') throw new BadRequestException('완료된 마취전평가는 수정할 수 없습니다');
    const data = {
      asaClass: (dto.asaClass as string) ?? undefined,
      airwayMallampati: (dto.airwayMallampati as string) ?? undefined,
      npoConfirmed: dto.npoConfirmed === true,
      npoSince: dto.npoSince ? new Date(String(dto.npoSince)) : undefined,
      cardiacRiskRcri: typeof dto.cardiacRiskRcri === 'number' ? dto.cardiacRiskRcri : undefined,
      pulmonaryRisk: (dto.pulmonaryRisk as string) ?? undefined,
      labsReviewed: dto.labsReviewed === true,
      anesthesiaConsent: dto.anesthesiaConsent === true,
      plan: (dto.plan as string) ?? undefined,
      notes: (dto.notes as string) ?? undefined,
      evaluatorId,
    };
    return this.prisma.preAnesthesiaEvaluation.upsert({
      where: { surgeryId },
      update: data,
      create: { surgeryId, patientId: surgery.patientId, ...data },
    });
  }

  /** 평가 완료 — 필수 6요소 검증 후 COMPLETED (sign-in 게이트 통과 조건) */
  async completePreAnesthesia(surgeryId: string, evaluatorId: string) {
    const ev = await this.prisma.preAnesthesiaEvaluation.findUnique({ where: { surgeryId } });
    if (!ev) throw new NotFoundException('마취전평가가 없습니다 — 먼저 작성하세요');
    if (ev.status === 'COMPLETED') throw new BadRequestException('이미 완료된 평가입니다');
    const missing = SurgeryAdvancedService.PRE_ANES_REQUIRED
      .filter((r) => (r.check ? !r.check((ev as Record<string, unknown>)[r.field]) : !(ev as Record<string, unknown>)[r.field]))
      .map((r) => r.label);
    if (missing.length) {
      throw new BadRequestException({ code: 'PRE_ANES_INCOMPLETE', message: `마취전평가 필수 항목 미완: ${missing.join(', ')}`, missing });
    }
    return this.prisma.preAnesthesiaEvaluation.update({
      where: { surgeryId },
      data: { status: 'COMPLETED', completedAt: new Date(), evaluatorId },
    });
  }

  // ── Anesthesia Record ──

  async createAnesthesiaRecord(surgeryId: string, data: {
    anesthesiaType: string; asaClass?: string; airwayType?: string;
    ettSize?: string; notes?: string;
  }, anesthetistId: string) {
    return this.prisma.anesthesiaRecord.create({
      data: {
        surgeryId,
        anesthetistId,
        anesthesiaType: data.anesthesiaType,
        asaClass: data.asaClass,
        airwayType: data.airwayType,
        ettSize: data.ettSize,
        notes: data.notes,
      },
      include: { anesthetist: { select: { familyName: true, givenName: true } } },
    });
  }

  async updateAnesthesiaRecord(surgeryId: string, data: {
    inductionTime?: string; intubationTime?: string; extubationTime?: string;
    inductionDrugs?: Record<string, unknown>; maintenanceDrugs?: Record<string, unknown>;
    analgesics?: Record<string, unknown>; reversal?: Record<string, unknown>;
    fluidInput?: Record<string, unknown>; bloodProducts?: Record<string, unknown>;
    ebl?: number; urineOutput?: number; complications?: Record<string, unknown>;
    vitalSigns?: Record<string, unknown>; notes?: string;
  }) {
    const existing = await this.prisma.anesthesiaRecord.findUnique({ where: { surgeryId } });
    if (!existing) throw new NotFoundException('마취 기록을 찾을 수 없습니다');

    const updateData: Record<string, unknown> = {};
    if (data.inductionTime) updateData.inductionTime = new Date(data.inductionTime);
    if (data.intubationTime) updateData.intubationTime = new Date(data.intubationTime);
    if (data.extubationTime) updateData.extubationTime = new Date(data.extubationTime);
    if (data.inductionDrugs !== undefined) updateData.inductionDrugs = data.inductionDrugs;
    if (data.maintenanceDrugs !== undefined) updateData.maintenanceDrugs = data.maintenanceDrugs;
    if (data.analgesics !== undefined) updateData.analgesics = data.analgesics;
    if (data.reversal !== undefined) updateData.reversal = data.reversal;
    if (data.fluidInput !== undefined) updateData.fluidInput = data.fluidInput;
    if (data.bloodProducts !== undefined) updateData.bloodProducts = data.bloodProducts;
    if (data.ebl !== undefined) updateData.ebl = data.ebl;
    if (data.urineOutput !== undefined) updateData.urineOutput = data.urineOutput;
    if (data.complications !== undefined) updateData.complications = data.complications;
    if (data.vitalSigns !== undefined) updateData.vitalSigns = data.vitalSigns;
    if (data.notes !== undefined) updateData.notes = data.notes;

    return this.prisma.anesthesiaRecord.update({ where: { surgeryId }, data: updateData });
  }

  // ── PACU Record ──

  // ── Surgical Safety Checklist (WHO) — IPSG.4 ──

  // 단계별 항목(dtoKey → 모델필드, required 여부)
  static readonly CHECKLIST_ITEMS = {
    signIn: [
      { key: 'patientId', field: 'signInPatientId', label: '환자 신원 확인', required: true },
      { key: 'siteMarked', field: 'signInSiteMarked', label: '수술 부위 표시', required: true },
      { key: 'consentSigned', field: 'signInConsentSigned', label: '동의서 서명', required: true },
      { key: 'anesthesiaCheck', field: 'signInAnesthesiaCheck', label: '마취 안전 점검', required: true },
      { key: 'allergyCheck', field: 'signInAllergyCheck', label: '알레르기 확인', required: true },
      { key: 'pulseOximeter', field: 'signInPulseOximeter', label: '맥박산소측정기 부착', required: false },
      { key: 'expectedBloodLoss', field: 'signInExpectedBloodLoss', label: '예상 출혈량(>500ml)', required: false },
      { key: 'difficultAirway', field: 'signInDifficultAirway', label: '기도관리 위험 평가', required: false },
    ],
    timeOut: [
      { key: 'teamIntro', field: 'timeOutTeamIntro', label: '팀원 소개', required: true },
      { key: 'patientName', field: 'timeOutPatientName', label: '환자명 확인', required: true },
      { key: 'procedure', field: 'timeOutProcedure', label: '수술명 확인', required: true },
      { key: 'site', field: 'timeOutSite', label: '수술 부위 확인', required: true },
      { key: 'antibiotics', field: 'timeOutAntibiotics', label: '예방적 항생제 투여', required: true },
      { key: 'criticalEvents', field: 'timeOutCriticalEvents', label: '예상 주요 사건 공유', required: false },
      { key: 'imagingDisplayed', field: 'timeOutImagingDisplayed', label: '필수 영상 게시', required: false },
    ],
    signOut: [
      { key: 'procedureRecorded', field: 'signOutProcedureRecorded', label: '수술명 기록', required: true },
      { key: 'instrumentCount', field: 'signOutInstrumentCount', label: '기구·거즈 계수', required: true },
      { key: 'specimenLabeled', field: 'signOutSpecimenLabeled', label: '검체 라벨 확인', required: true },
      { key: 'recoveryPlan', field: 'signOutRecoveryPlan', label: '회복 계획 공유', required: true },
      { key: 'equipmentIssues', field: 'signOutEquipmentIssues', label: '장비 문제 점검', required: false },
    ],
  } as const;

  static computeProgress(cl: Record<string, boolean | null>) {
    const phaseProgress = (phase: 'signIn' | 'timeOut' | 'signOut') => {
      const items = SurgeryAdvancedService.CHECKLIST_ITEMS[phase];
      const req = items.filter((i) => i.required);
      const reqDone = req.filter((i) => cl[i.field] === true).length;
      const allDone = items.filter((i) => cl[i.field] === true).length;
      return { requiredComplete: reqDone === req.length, requiredDone: reqDone, requiredTotal: req.length, doneCount: allDone, totalCount: items.length };
    };
    return { signIn: phaseProgress('signIn'), timeOut: phaseProgress('timeOut'), signOut: phaseProgress('signOut') };
  }

  async createChecklist(surgeryId: string) {
    const existing = await this.prisma.surgicalChecklist.findUnique({ where: { surgeryId } });
    if (existing) return existing;
    return this.prisma.surgicalChecklist.create({ data: { surgeryId } });
  }

  /** 체크리스트 조회 + 항목 정의 + 단계별 완료 현황 */
  async getChecklist(surgeryId: string) {
    const cl = await this.prisma.surgicalChecklist.findUnique({ where: { surgeryId } });
    // 확인자 이름 — 인증조사에서 묻는 것은 "누가 확인했는가"다. UUID 를 화면에 찍을 수는 없다.
    //  🔴 이름을 못 찾으면 만들어내지 않는다(null → 화면은 '확인자 미상'을 그대로 말한다).
    const byIds = cl
      ? [cl.signInCompletedBy, cl.timeOutCompletedBy, cl.signOutCompletedBy].filter((v): v is string => !!v)
      : [];
    const users = byIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: [...new Set(byIds)] } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const nameOf = (id?: string | null) => {
      const u = users.find((x) => x.id === id);
      return u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || null : null;
    };
    return {
      checklist: cl,
      items: SurgeryAdvancedService.CHECKLIST_ITEMS,
      progress: cl ? SurgeryAdvancedService.computeProgress(cl as unknown as Record<string, boolean>) : null,
      completedByName: cl
        ? { signIn: nameOf(cl.signInCompletedBy), timeOut: nameOf(cl.timeOutCompletedBy), signOut: nameOf(cl.signOutCompletedBy) }
        : null,
    };
  }

  async updateChecklist(
    surgeryId: string,
    phase: 'signIn' | 'timeOut' | 'signOut',
    data: UpdateSurgicalChecklistDto,
    completedBy: string,
  ) {
    const existing = await this.prisma.surgicalChecklist.findUnique({ where: { surgeryId } });
    if (!existing) throw new NotFoundException('수술 체크리스트를 찾을 수 없습니다');

    // 마취전평가 게이트(R2-2) — sign-in(마취 유도 전 최종 관문) 진입 시 평가 COMPLETED 필수
    if (phase === 'signIn' && String((await this.configRuntime?.get('surgery.preAnesthesiaGate')) ?? 'false') === 'true') {
      const preAnes = await this.prisma.preAnesthesiaEvaluation.findUnique({ where: { surgeryId }, select: { status: true } });
      if (preAnes?.status !== 'COMPLETED') {
        const msg = `마취전평가 미완료(현재 ${preAnes?.status ?? '평가 없음'}) — sign-in 진입 차단`;
        // 🔴 2026-08-26: 종전엔 예외만 던지고 아무 데도 남기지 않았다. 같은 모듈의
        //    siteVerify/signOut/count 는 `SafetyGateService.record` 를 쓰는데 이 게이트만 빠져 있어,
        //    관제가 이 게이트의 '0건'을 영원히 준수/미평가로 구분할 수 없었다.
        await recordGateViolation({ gateKey: 'surgery.preAnesthesiaGate', recorder: this.gates, logger: this.logger, refType: 'Surgery', refId: surgeryId }, 'BLOCK', msg);
        throw new BadRequestException({
          code: 'PRE_ANESTHESIA_REQUIRED',
          message: '마취전평가(Pre-anesthesia Evaluation)가 완료되지 않았습니다 — sign-in 진입 불가',
        });
      }
    }

    // 오부위수술 방지 게이트(P2-A) — Sign-In 진입 시 좌우구분 술식인데 laterality 미기재면 차단.
    //  config surgery.siteVerify.enforce(OFF|WARN|BLOCK·기본 OFF, fail-closed 방지 위해 fallback 'OFF').
    if (phase === 'signIn') {
      const mode = gateMode(await this.configRuntime?.get('surgery.siteVerify.enforce'), 'OFF');
      if (mode === 'BLOCK') {
        const surgery = await this.prisma.surgery.findUnique({ where: { id: surgeryId }, select: { procedureName: true, bodySite: true, laterality: true } });
        if (surgery) {
          const hay = `${surgery.procedureName ?? ''} ${surgery.bodySite ?? ''}`;
          // 키워드 개정 표면 = config surgery.lateralityKeywords(유효 배열=전량 대체·§7 P1)
          const keywords = nonEmptyStringArrayOr(await this.configRuntime?.get('surgery.lateralityKeywords').catch(() => null), LATERALITY_REQUIRED_KEYWORDS);
          const lateralityRequired = keywords.some((k) => hay.includes(k));
          const missing = !surgery.laterality || surgery.laterality === 'NA';
          if (lateralityRequired && missing) {
            throw new BadRequestException({
              code: 'SURGERY_LATERALITY_REQUIRED',
              message: '좌우 구분이 필요한 술식입니다 — 수술 부위 좌/우(laterality)를 먼저 지정해야 Sign-In을 진행할 수 있습니다(오부위수술 방지).',
            });
          }
        }
      }
    }

    const updateData: Record<string, unknown> = {};
    const checked = data as unknown as Record<string, unknown>;
    for (const item of SurgeryAdvancedService.CHECKLIST_ITEMS[phase]) {
      if (checked[item.key] !== undefined) updateData[item.field] = checked[item.key];
    }
    // 수술 계수 대조(P2-D) — signOut 단계에서 품목별 계수(Json)·종합상태·불일치 해소기록 저장.
    //  computeProgress(boolean 가정)와 별개 필드라 진행도 계산에 영향 없음.
    if (phase === 'signOut') {
      const raw = data as unknown as Record<string, unknown>;
      if (raw.countItems !== undefined) updateData.countItems = raw.countItems as Prisma.InputJsonValue;
      if (raw.countStatus !== undefined) updateData.countStatus = raw.countStatus;
      if (raw.countDiscrepancyNote !== undefined) updateData.countDiscrepancyNote = raw.countDiscrepancyNote;
      // 🔴 계수 판정의 정본은 **입력된 숫자**다 — 화면이 보낸 종합판정을 그대로 믿지 않는다.
      //    숫자가 어긋나는데 'MATCH' 가 오면 잔류이물 게이트(assertCountReconciled)가 조용히 열린다.
      //    안전한 방향(MISMATCH)으로만 서버가 덮어쓴다 — 사람이 MISMATCH 라고 한 것을 MATCH 로 바꾸지 않는다.
      if (updateData.countItems !== undefined) {
        updateData.countStatus = deriveCountStatus(
          updateData.countItems as unknown,
          typeof updateData.countStatus === 'string' ? updateData.countStatus : undefined,
        );
      }
    }

    /* ── "완료"의 정의(2026-08-18) ──────────────────────────────────────────────
     * 종전: 항목 **하나만** 눌러도 `${phase}CompletedAt/By` 를 무조건 찍었다.
     *   운영 실측 — sign_in_completed_at 39/39 인데 Sign-In 필수 5항목이 전부 true 인 것은 **24건**.
     *   즉 15건은 원장에 "마취 유도 전 확인 완료 · 확인자 OO · 시각 T" 라고 적혀 있지만 사실이 아니었다.
     *
     * 정의: **완료 = 그 단계의 필수 항목이 전부 true 인 상태.**
     *   · 부분 저장은 그대로 허용한다(하나만 눌러도 그 값은 저장된다) — 수술 전 확인은
     *     여러 번에 나눠 입력하는 절차다(마취전평가 임시 저장과 같은 판단).
     *   · 완료가 된 **그 순간의 사람·시각**만 스탬프한다. 이미 찍혀 있으면 덮지 않는다
     *     (나중에 선택 항목을 하나 더 눌렀다고 완료 시각이 뒤로 밀리면 안 된다).
     *   · 필수 항목이 다시 꺼지면 스탬프를 **지운다** — 성립하지 않는 완료를 원장에 남기지 않는다.
     *     항목별 입력 이력은 AuditLog(변이 기본 감사 ON)에 남으므로 이력이 사라지는 것은 아니다.
     * ─────────────────────────────────────────────────────────────────────────── */
    const merged = { ...(existing as unknown as Record<string, unknown>), ...updateData };
    const requiredComplete = SurgeryAdvancedService.computeProgress(
      merged as Record<string, boolean>,
    )[phase].requiredComplete;
    const alreadyStamped = (existing as unknown as Record<string, unknown>)[`${phase}CompletedAt`] != null;
    if (requiredComplete) {
      if (!alreadyStamped) {
        updateData[`${phase}CompletedBy`] = completedBy;
        updateData[`${phase}CompletedAt`] = new Date();
      }
    } else if (alreadyStamped) {
      updateData[`${phase}CompletedBy`] = null;
      updateData[`${phase}CompletedAt`] = null;
    }

    return this.prisma.surgicalChecklist.update({ where: { surgeryId }, data: updateData });
  }

  /**
   * 여러 수술의 단계별 진행도 일괄 조회 — 체크리스트 목록 화면용.
   *
   * 🔴 이 EP 가 없어서 `/surgery` 안전체크리스트 탭 표가 `surgery.checklist?.signIn` 을 읽고 있었는데
   *    `/api/v1/surgery/schedule` 은 checklist 를 include 한 적이 없다. 그래서 표는 수술이
   *    실제로 어떤 상태든 **전 행을 '미완료'** 로 칠했다(P11 — 화면이 실제보다 덜 안전하게 말하는 것도 사실이 아니다).
   */
  async getChecklistProgressBatch(surgeryIds: string[]) {
    if (!surgeryIds.length) return [];
    const rows = await this.prisma.surgicalChecklist.findMany({ where: { surgeryId: { in: surgeryIds } } });
    return rows.map((cl) => ({
      surgeryId: cl.surgeryId,
      progress: SurgeryAdvancedService.computeProgress(cl as unknown as Record<string, boolean>),
      signInCompletedAt: cl.signInCompletedAt,
      timeOutCompletedAt: cl.timeOutCompletedAt,
      signOutCompletedAt: cl.signOutCompletedAt,
      countStatus: cl.countStatus,
    }));
  }

  /** 수술 계수 대조 게이트(P2-D) — 종료 시 countStatus=MISMATCH이고 해소기록(재계수·X-ray) 없으면 차단(잔류이물 방지). */
  async assertCountReconciled(surgeryId: string) {
    const cl = await this.prisma.surgicalChecklist.findUnique({ where: { surgeryId }, select: { countStatus: true, countDiscrepancyNote: true } });
    if (cl?.countStatus === 'MISMATCH' && !cl.countDiscrepancyNote?.trim()) {
      throw new BadRequestException({
        code: 'SURGERY_COUNT_MISMATCH_UNRESOLVED',
        message: '수술 계수 불일치(MISMATCH)가 해소되지 않았습니다 — 재계수·영상확인 등 해소 기록 없이는 수술을 종료할 수 없습니다(잔류이물 방지).',
      });
    }
    return true;
  }

  /** 수술 시작 가능 여부 — Sign-In + Time-Out 필수항목 충족 (IPSG.4 미완료 차단) */
  async assertChecklistReadyForStart(surgeryId: string) {
    const cl = await this.prisma.surgicalChecklist.findUnique({ where: { surgeryId } });
    if (!cl) {
      throw new BadRequestException({ code: 'SURGERY_CHECKLIST_REQUIRED', message: '수술 안전 체크리스트(Sign-In/Time-Out)를 먼저 작성해야 합니다.' });
    }
    const p = SurgeryAdvancedService.computeProgress(cl as unknown as Record<string, boolean>);
    if (!p.signIn.requiredComplete || !p.timeOut.requiredComplete) {
      throw new BadRequestException({
        code: 'SURGERY_CHECKLIST_INCOMPLETE',
        message: `수술 시작 전 안전 체크리스트 필수항목 미완료 (Sign-In ${p.signIn.requiredDone}/${p.signIn.requiredTotal}, Time-Out ${p.timeOut.requiredDone}/${p.timeOut.requiredTotal})`,
      });
    }
    return true;
  }

  /** IPSG.4 — 수술 종료(Sign-Out) 게이트: 기구·거즈 계수, 검체 라벨 등 Sign-Out 필수항목 미완료 시 종료 차단(잔류이물 방지). */
  async assertChecklistReadyForClose(surgeryId: string) {
    const cl = await this.prisma.surgicalChecklist.findUnique({ where: { surgeryId } });
    if (!cl) {
      throw new BadRequestException({ code: 'SURGERY_SIGNOUT_REQUIRED', message: '수술 종료 전 Sign-Out(기구·거즈 계수 등)을 작성해야 합니다.' });
    }
    const p = SurgeryAdvancedService.computeProgress(cl as unknown as Record<string, boolean>);
    if (!p.signOut.requiredComplete) {
      throw new BadRequestException({
        code: 'SURGERY_SIGNOUT_INCOMPLETE',
        message: `수술 종료 전 Sign-Out 필수항목 미완료 (${p.signOut.requiredDone}/${p.signOut.requiredTotal} — 기구·거즈 계수/검체 라벨 확인 필요)`,
      });
    }
    return true;
  }
}
