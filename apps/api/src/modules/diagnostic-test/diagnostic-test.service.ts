import { Injectable, NotFoundException, BadRequestException, HttpStatus, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DIAGNOSTIC_TEST_TYPES,
  DIAGNOSTIC_STATION_CATEGORY,
  DIAGNOSTIC_TEST_TRANSITIONS,
  DIAGNOSTIC_TEST_REASON_REQUIRED,
  canTransitionDiagnosticTest,
  diagnosticMeasurementFields,
  resolveDiagnosticStationTypes,
  ageOf,
  serverMsg,
} from '@hospital-run/shared';
import { msgException } from '../../common/msg-exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { DomainException } from '../../common/errors/domain.exception';
import * as E from '../../common/errors/domain-error-codes';

/** 🔴 검사 종류 목록은 shared 정본 하나 — 여기 사본을 두면 FE 4벌과 다시 갈라진다. */
const TEST_TYPES = DIAGNOSTIC_TEST_TYPES;

/** 대기 큐가 다루는 상태 — 아직 끝나지 않은 것 */
const OPEN_STATUSES = ['ORDERED', 'SCHEDULED', 'IN_PROGRESS'] as const;
const PRIORITY_RANK: Record<string, number> = { STAT: 0, URGENT: 1, ROUTINE: 2 };
/** 전이 여정 이벤트 제목(고정 문장) */
const JOURNEY_TITLE: Record<string, string> = {
  DIAGNOSTIC_CANCELLED: '기초검사 취소',
  DIAGNOSTIC_ON_HOLD: '기초검사 보류',
  DIAGNOSTIC_RESUMED: '기초검사 보류 해제',
};

@Injectable()
export class DiagnosticTestService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventEmitter2,
    // JourneyModule 은 @Global — 취소·보류·보류 해제를 환자 여정에 남긴다
    @Optional() private readonly journey?: JourneyService,
  ) {}

  async create(data: { patientId: string; testType: string; testName: string; requestedBy: string; scheduledAt?: string; priority?: string; targetTatMinutes?: number; requestNote?: string; roomName?: string; equipmentName?: string; orderId?: string }) {
    return this.prisma.diagnosticTest.create({
      data: {
        patientId: data.patientId,
        testType: data.testType,
        testName: data.testName,
        requestedBy: data.requestedBy,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
        status: data.scheduledAt ? 'SCHEDULED' : 'ORDERED',
        priority: data.priority ?? 'ROUTINE',
        targetTatMinutes: data.targetTatMinutes ?? null,
        requestNote: data.requestNote ?? null,
        roomName: data.roomName ?? null,
        equipmentName: data.equipmentName ?? null,
        orderId: data.orderId ?? null,
      },
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
    });
  }

  async findAll(filters: { testType?: string; status?: string; patientId?: string }) {
    const where: Prisma.DiagnosticTestWhereInput = {};
    if (filters.testType) where.testType = filters.testType;
    if (filters.status) where.status = filters.status;
    if (filters.patientId) where.patientId = filters.patientId;

    const tests = await this.prisma.diagnosticTest.findMany({
      where,
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
      orderBy: { createdAt: 'desc' }, take: 300,
    });

    // 의뢰의/담당기사/판독의 이름 조인
    const userIds = [...new Set(tests.flatMap(t => [t.requestedBy, t.performedBy, t.interpretedBy].filter(Boolean) as string[]))];
    const users = userIds.length ? await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, familyName: true, givenName: true },
    }) : [];
    const userMap = new Map(users.map(u => [u.id, u]));

    return tests.map(t => ({
      ...t,
      requestedByUser: userMap.get(t.requestedBy) ?? null,
      performedByUser: t.performedBy ? userMap.get(t.performedBy) ?? null : null,
      interpretedByUser: t.interpretedBy ? userMap.get(t.interpretedBy) ?? null : null,
    }));
  }

  async findOne(id: string) {
    const test = await this.prisma.diagnosticTest.findUnique({
      where: { id },
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true } } },
    });
    if (!test) throw new NotFoundException('Diagnostic test not found');
    return test;
  }

  async perform(id: string, performedBy: string, stationId?: string) {
    const test = await this.prisma.diagnosticTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException('Diagnostic test not found');
    if (test.status === 'COMPLETED') throw new BadRequestException('완료된 검사는 다시 시작할 수 없습니다');
    if (test.status === 'CANCELLED') throw new BadRequestException('취소된 검사는 시작할 수 없습니다');
    // 보류는 멈춘 이유가 풀렸다는 사람의 확인이 먼저다 — 시작 버튼이 보류를 조용히 지우지 않게 한다
    if (test.status === 'ON_HOLD') throw new BadRequestException('보류된 검사입니다 — 보류를 해제한 뒤 시작하세요');

    // 어느 자리에서 시행했는지 기록 — 자리 설정이 기록으로 이어지지 않으면 설정은 장식이 된다.
    // 🔴 이미 검사실이 적혀 있으면 덮어쓰지 않는다(먼저 적힌 사실을 지우지 않는다).
    const roomName = test.roomName ?? (stationId ? await this.stationLabel(stationId) : null);

    return this.prisma.diagnosticTest.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        performedBy,
        performedAt: new Date(),
        ...(roomName ? { roomName } : {}),
      },
    });
  }

  private async stationLabel(stationId: string): Promise<string | null> {
    const station = await this.prisma.workstationConfig.findUnique({
      where: { stationId }, select: { label: true },
    });
    return station?.label ?? null;
  }

  /**
   * 검사값(측정값)만 저장 — 판독·완료는 하지 않는다.
   * 🔴 기사가 잰 값과 의사의 판독은 시점이 다르다. 한 몸으로 묶으면 판독 전 값이 화면 밖에서 사라진다.
   */
  async saveMeasurements(id: string, measurements: Record<string, unknown>, performedBy: string, stationId?: string) {
    const test = await this.prisma.diagnosticTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException('Diagnostic test not found');
    if (test.status === 'CANCELLED') throw new BadRequestException('취소된 검사에는 값을 기록할 수 없습니다');

    const clean = this.normalizeMeasurements(test.testType, measurements);
    // 🔴 빈 저장을 "저장했다"고 말하지 않는다 — 화면이 성공 토스트를 띄우고 아무것도 안 남는 일을 막는다.
    if (Object.keys(clean).length === 0) {
      throw new BadRequestException('저장할 검사값이 없습니다(입력된 항목이 하나도 없습니다)');
    }

    // 이미 기록된 값은 유지하고 이번에 넣은 항목만 갱신한다(부분 입력·이어쓰기).
    const prev = (test.measurements as Record<string, unknown> | null) ?? {};
    const merged = { ...prev, ...clean };
    const roomName = test.roomName ?? (stationId ? await this.stationLabel(stationId) : null);

    return this.prisma.diagnosticTest.update({
      where: { id },
      data: {
        measurements: merged as Prisma.InputJsonValue,
        // 값을 기록했다는 것은 검사가 시작됐다는 뜻이다. 다만 **시행 시각은 지어내지 않는다** —
        // 아직 시작 처리를 안 했다면 지금이 시행 시점이다.
        ...(test.status === 'ORDERED' || test.status === 'SCHEDULED'
          ? { status: 'IN_PROGRESS', performedBy: test.performedBy ?? performedBy, performedAt: test.performedAt ?? new Date() }
          : {}),
        ...(roomName ? { roomName } : {}),
      },
    });
  }

  /**
   * 측정값 정규화 — 빈 값은 버리고, 정본이 숫자라고 말한 항목은 숫자로 저장한다.
   *
   * 🔴 숫자 항목을 문자열로 저장하면 델타체크(`Number(v)`)와 추이가 조용히 어긋난다.
   * 🔴 정본에 없는 키는 **버리지 않는다**(미지 키 보존) — 장비마다 항목이 다르고,
   *    whitelist 로 지우면 기사가 입력한 값이 성공 토스트와 함께 사라진다(이 저장소 최다 결함).
   */
  private normalizeMeasurements(testType: string, input: Record<string, unknown>): Record<string, unknown> {
    const spec = new Map(diagnosticMeasurementFields(testType).map((f) => [f.key, f]));
    const out: Record<string, unknown> = {};
    const entries = Object.entries(input ?? {});
    if (entries.length > 80) throw new BadRequestException('측정 항목이 너무 많습니다(최대 80)');

    for (const [key, raw] of entries) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 64) {
        throw msgException(HttpStatus.BAD_REQUEST, serverMsg('측정 항목 키가 올바르지 않습니다: {항목}', { 항목: String(key).slice(0, 20) }));
      }
      if (raw === null || raw === undefined) continue;
      if (typeof raw === 'string' && raw.trim() === '') continue; // 미입력 — 값이 아니다
      if (typeof raw === 'object') throw msgException(HttpStatus.BAD_REQUEST, serverMsg('측정값은 단일 값이어야 합니다: {항목}', { 항목: key }));

      const field = spec.get(key);
      if (field?.kind === 'number') {
        const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(num)) throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{항목}: 숫자를 입력해 주세요', { 항목: field.label }));
        if (field.min !== undefined && num < field.min) throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{항목}: {최소} 미만은 입력할 수 없습니다', { 항목: field.label, 최소: field.min }));
        if (field.max !== undefined && num > field.max) throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{항목}: {최대} 초과는 입력할 수 없습니다', { 항목: field.label, 최대: field.max }));
        out[key] = num;
        continue;
      }
      if (field?.kind === 'select' && field.options && typeof raw === 'string' && !field.options.includes(raw)) {
        throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{항목}: 선택지에 없는 값입니다', { 항목: field.label }));
      }
      out[key] = typeof raw === 'string' ? raw.trim() : raw;
    }
    return out;
  }

  async report(id: string, data: { findings?: string; impression?: string; conclusion?: string; measurements?: Record<string, unknown>; interpretedBy?: string; criticalFlag?: boolean; criticalNote?: string }) {
    const test = await this.prisma.diagnosticTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException('Diagnostic test not found');
    // 판독 저장은 상태를 COMPLETED 로 만든다 — 취소·보류된 검사를 판독 한 번으로 되살리지 않는다
    if (test.status === 'CANCELLED') throw new BadRequestException('취소된 검사에는 판독을 저장할 수 없습니다');
    if (test.status === 'ON_HOLD') throw new BadRequestException('보류된 검사입니다 — 보류를 해제한 뒤 판독하세요');

    // 판독 시 함께 들어온 측정값도 정규화·병합한다 — 기사가 먼저 저장해 둔 값을 덮어 지우지 않는다.
    const prevMeasurements = (test.measurements as Record<string, unknown> | null) ?? null;
    const merged = data.measurements
      ? { ...(prevMeasurements ?? {}), ...this.normalizeMeasurements(test.testType, data.measurements) }
      : prevMeasurements;

    // P3 delta check — 직전 동일 검사종류 측정값 대비 >30% 변동 감지
    const delta = merged ? await this.computeDelta(test.patientId, test.testType, id, merged) : null;

    const updated = await this.prisma.diagnosticTest.update({
      where: { id },
      data: {
        findings: data.findings,
        impression: data.impression,
        conclusion: data.conclusion,
        measurements: (merged ?? undefined) as Prisma.InputJsonValue,
        interpretedBy: data.interpretedBy,
        reportedAt: new Date(),
        status: 'COMPLETED',
        criticalFlag: data.criticalFlag ?? false,
        criticalNote: data.criticalNote ?? null,
        reviewStatus: 'PENDING_REVIEW', // P2 판독 검토 대기
        deltaFlag: !!delta,
        deltaNote: delta ?? null,
      },
    });

    // critical result closed-loop(2차 스카우트 R3) — 위험소견 시 오더 주치의 능동 통보.
    //  기존: criticalFlag 저장만·통보 경로 없어 판독 위험소견이 방치될 위험.
    if (data.criticalFlag) {
      this.events?.emit('diagnostic.critical', {
        patientId: test.patientId, testId: id, testName: test.testName,
        criticalNote: data.criticalNote ?? null, orderedBy: test.requestedBy,
      });
    }
    return updated;
  }

  /** 직전 완료 동일검사 측정값 대비 >30% 변동 항목 감지 */
  private async computeDelta(patientId: string, testType: string, currentId: string, measurements: Record<string, unknown>): Promise<string | null> {
    const prev = await this.prisma.diagnosticTest.findFirst({
      where: { patientId, testType, status: 'COMPLETED', id: { not: currentId }, measurements: { not: Prisma.DbNull } },
      orderBy: { reportedAt: 'desc' },
      select: { measurements: true },
    });
    if (!prev?.measurements) return null;
    const prevM = prev.measurements as Record<string, unknown>;
    const changed: string[] = [];
    for (const [k, v] of Object.entries(measurements)) {
      const cur = Number(v), old = Number(prevM[k]);
      if (Number.isFinite(cur) && Number.isFinite(old) && old !== 0) {
        const pct = Math.abs((cur - old) / old) * 100;
        if (pct >= 30) changed.push(`${k} ${old}→${cur}(${pct.toFixed(0)}%)`);
      }
    }
    return changed.length ? `이전 대비 급변: ${changed.join(', ')}` : null;
  }

  /** P2 판독 검토(서명) — COMPLETED 건 승인/반려 */
  async review(id: string, decision: string, note: string | undefined, reviewedBy: string) {
    const test = await this.prisma.diagnosticTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException('Diagnostic test not found');
    if (!test.reportedAt) throw new BadRequestException('판독 완료(reported)된 검사만 검토 가능합니다');
    return this.prisma.diagnosticTest.update({
      where: { id },
      data: { reviewStatus: decision, reviewedBy, reviewedAt: new Date(), ...(note ? { findings: test.findings } : {}) },
    });
  }

  /**
   * P2 상태 전이(취소·보류·보류 해제·예정) — 전이표 정본은 shared `DIAGNOSTIC_TEST_TRANSITIONS`.
   *
   * 🔴 종전 구현은 어느 상태로든 바꿨고 사유를 `criticalNote`(위험소견 메모)에 덮어써 위험소견을 지웠다.
   *    사유·행위자·시각은 자기 칸(`statusReason`·`statusChangedBy`·`statusChangedAt`)에 둔다.
   * 🔴 결과(측정값·판독)가 있는 검사의 취소는 막지 않는다 — 대신 `acknowledgeResult` 로 결과가 있다는 사실을 확인받는다.
   *    확인 없이 오면 409 로 **무엇이 남아 있는지** 돌려준다(결과는 어떤 경우에도 지우지 않는다).
   * 🔴 청구·오더는 **건드리지 않는다**(일어난 사실은 소급하지 않는다 — 정정은 원무 판단). 영향만 `impacts` 로 알린다.
   */
  async transition(id: string, status: string, reason: string | undefined, actorId: string | undefined, opts: { acknowledgeResult?: boolean } = {}) {
    const test = await this.prisma.diagnosticTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException('Diagnostic test not found');

    // 문장에 값을 끼워 넣지 않는다(화면 언어를 바꿔도 한국어로 남는다) — 고정 문장 + details 로 값을 내려보낸다.
    // 🔴 DomainException 이어야 code·details 가 응답에 실린다(일반 HttpException 은 예외 필터가 details 를 버린다)
    if (!canTransitionDiagnosticTest(test.status, status)) {
      throw new DomainException(E.DIAGNOSTIC_TRANSITION_NOT_ALLOWED, '현재 상태에서는 이 상태로 옮길 수 없습니다', HttpStatus.BAD_REQUEST,
        { from: test.status, to: status, allowed: DIAGNOSTIC_TEST_TRANSITIONS[test.status] ?? [] });
    }
    const trimmed = reason?.trim() ?? '';
    if (DIAGNOSTIC_TEST_REASON_REQUIRED.includes(status) && !trimmed) {
      throw new DomainException(E.DIAGNOSTIC_TRANSITION_REASON_REQUIRED, '취소·보류는 사유를 입력해야 합니다', HttpStatus.BAD_REQUEST, { to: status });
    }
    // 예정으로 되돌리려면 예정 시각이 있어야 한다 — 시각 없는 "예정"은 워크리스트에서 언제인지 말하지 못한다
    if (status === 'SCHEDULED' && !test.scheduledAt) {
      throw new BadRequestException('예정 시각이 없는 검사는 예정 상태로 옮길 수 없습니다 — 의뢰 상태로 되돌리세요');
    }

    const result = this.resultPresence(test);
    if (status === 'CANCELLED' && result.hasResult && !opts.acknowledgeResult) {
      throw new DomainException(
        E.DIAGNOSTIC_HAS_RESULT,
        '이미 결과가 기록된 검사입니다 — 취소해도 결과는 지워지지 않으며, 완료 검사 추이에서 빠집니다. 확인 후 다시 요청하세요.',
        HttpStatus.CONFLICT,
        { result },
      );
    }

    const impacts = await this.transitionImpacts(test.orderId);

    const updated = await this.prisma.diagnosticTest.update({
      where: { id },
      data: {
        status,
        statusReason: trimmed ? trimmed.slice(0, 300) : null,
        statusChangedBy: actorId ?? null,
        statusChangedAt: new Date(),
      },
    });

    const eventType = status === 'CANCELLED' ? 'DIAGNOSTIC_CANCELLED' : status === 'ON_HOLD' ? 'DIAGNOSTIC_ON_HOLD' : test.status === 'ON_HOLD' ? 'DIAGNOSTIC_RESUMED' : null;
    if (eventType) {
      this.journey?.emit({
        patientId: test.patientId,
        eventType,
        title: JOURNEY_TITLE[eventType],
        // 검사명·사유는 값으로 — 문장으로 조립하지 않는다
        description: [test.testName, trimmed].filter(Boolean).join(' · '),
        refType: 'diagnostic_test',
        refId: id,
        navUrl: '/diagnostics',
        severity: status === 'CANCELLED' ? 'warning' : 'info',
        metadata: { from: test.status, to: status, hadResult: result.hasResult },
      });
    }

    return {
      ...updated,
      warnings: status === 'CANCELLED' && result.hasResult ? ['HAS_RESULT'] : [],
      impacts,
    };
  }

  /** 결과가 남아 있는가 — 판독 시각·소견·측정값 중 하나라도 있으면 "있다" */
  private resultPresence(test: { reportedAt: Date | null; findings: string | null; impression: string | null; conclusion: string | null; measurements: unknown }) {
    const m = test.measurements as Record<string, unknown> | null;
    const measurementCount = m && typeof m === 'object' ? Object.keys(m).length : 0;
    const reported = test.reportedAt != null;
    const hasText = !!(test.findings?.trim() || test.impression?.trim() || test.conclusion?.trim());
    return { hasResult: reported || hasText || measurementCount > 0, reported, measurementCount };
  }

  /**
   * 전이가 닿는 다른 기록 — **바꾸지 않고 알리기만** 한다.
   * 🔴 청구 품목(`BillingItem`)에는 검사·오더를 가리키는 키가 없다 — 이 검사에 청구가 붙었는지 **판정할 수 없다**.
   *    "청구 없음"으로 말하지 않고 판정 불가와 그 이유를 돌려준다.
   */
  private async transitionImpacts(orderId: string | null) {
    let order: { id: string; status: string | null; found: boolean } | null = null;
    if (orderId) {
      const o = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
      order = o ? { id: o.id, status: String(o.status), found: true } : { id: orderId, status: null, found: false };
    }
    return {
      order,
      billing: { determinable: false as const, reason: 'BILLING_ITEM_HAS_NO_TEST_OR_ORDER_LINK' },
      note: '오더·청구는 자동으로 바꾸지 않습니다 — 필요하면 담당 부서가 확인해 정정합니다.',
    };
  }

  /** P3 환자별 검사종류 측정값 추이 */
  async getTrend(patientId: string, testType: string, metric?: string) {
    const tests = await this.prisma.diagnosticTest.findMany({
      where: { patientId, testType, status: 'COMPLETED', reportedAt: { not: null } },
      orderBy: { reportedAt: 'asc' },
      select: { id: true, reportedAt: true, conclusion: true, measurements: true, deltaFlag: true },
      take: 50,
    });
    return tests.map(t => {
      const m = (t.measurements as Record<string, unknown>) ?? {};
      return { id: t.id, reportedAt: t.reportedAt, conclusion: t.conclusion, deltaFlag: t.deltaFlag, value: metric ? m[metric] : undefined, measurements: m };
    });
  }

  getTypes() {
    return TEST_TYPES;
  }

  // ══════════════════════════════════════════════════════════════
  // 자리(스테이션) — ① 이 자리에서 무슨 검사를 하는가 ② 대기 환자
  // ══════════════════════════════════════════════════════════════

  /**
   * 기초검사 자리 목록 + 각 자리의 설정·대기 건수.
   *
   * 🔴 설정이 안 된 자리의 대기 건수는 **`0` 이 아니라 `null`**(산출 불가)이다.
   *    0 은 "할 일이 없다"는 다른 사실이고, 사람은 그것을 보고 한가한 줄 안다.
   * 🔴 어느 자리에도 배정되지 않은 검사 종류를 함께 돌려준다 — 워크리스트가 없으면
   *    그 검사는 아무 화면에도 뜨지 않고, 미실시가 드러나지 않는다.
   */
  async listStations() {
    const stations = await this.prisma.workstationConfig.findMany({
      where: { category: DIAGNOSTIC_STATION_CATEGORY },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });

    const rows = await Promise.all(stations.map(async (s) => {
      const { usable, unknown } = resolveDiagnosticStationTypes(s.orderCodes);
      const waiting = usable.length
        ? await this.prisma.diagnosticTest.count({
            where: { testType: { in: usable }, status: { in: [...OPEN_STATUSES] } },
          })
        : null;
      return {
        stationId: s.stationId,
        label: s.label,
        department: s.department,
        location: s.location,
        sortOrder: s.sortOrder,
        isActive: s.isActive,
        testTypes: usable,
        /** 정본 어휘에 없는 잔재 코드 — 화면이 "이 설정은 아무것도 잡지 못한다"고 말할 근거 */
        unknownCodes: unknown,
        configured: usable.length > 0,
        /** null = 설정이 없어 셀 수 없다(0 과 다른 사실) */
        waiting,
      };
    }));

    const assigned = new Set(rows.filter((r) => r.isActive).flatMap((r) => r.testTypes));
    const unassignedTestTypes = TEST_TYPES.filter((t) => !assigned.has(t.code)).map((t) => t.code);

    return { stations: rows, unassignedTestTypes };
  }

  /** 자리에서 시행하는 검사 종류 설정 — 정본 어휘로만 저장된다(DTO 가 강제) */
  async setStationTestTypes(stationId: string, data: { testTypes: string[]; label?: string; location?: string }) {
    const station = await this.prisma.workstationConfig.findUnique({ where: { stationId } });
    if (!station) throw msgException(HttpStatus.NOT_FOUND, serverMsg('자리를 찾을 수 없습니다: {자리}', { 자리: stationId }));
    if (station.category !== DIAGNOSTIC_STATION_CATEGORY) {
      // 🔴 검사실·영상실 자리의 orderCodes 는 다른 어휘(수가코드)를 쓴다. 여기서 덮으면 그 큐가 죽는다.
      throw msgException(HttpStatus.BAD_REQUEST, serverMsg('기초검사 자리가 아닙니다(category={분류})', { 분류: String(station.category) }));
    }
    return this.prisma.workstationConfig.update({
      where: { stationId },
      data: {
        orderCodes: data.testTypes as Prisma.InputJsonValue,
        ...(data.label ? { label: data.label } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
      },
    });
  }

  /** 자리 신설 — 정본 종류 중 어느 자리에도 없는 검사에 담당 자리를 만들 수 있어야 한다 */
  async createStation(data: { stationId: string; label: string; department: string; location?: string; testTypes: string[] }) {
    const exists = await this.prisma.workstationConfig.findUnique({ where: { stationId: data.stationId } });
    if (exists) throw msgException(HttpStatus.BAD_REQUEST, serverMsg('이미 있는 자리 ID 입니다: {자리}', { 자리: data.stationId }));
    const maxSort = await this.prisma.workstationConfig.aggregate({
      where: { category: DIAGNOSTIC_STATION_CATEGORY }, _max: { sortOrder: true },
    });
    return this.prisma.workstationConfig.create({
      data: {
        stationId: data.stationId,
        label: data.label,
        category: DIAGNOSTIC_STATION_CATEGORY,
        department: data.department,
        location: data.location ?? null,
        orderCodes: data.testTypes as Prisma.InputJsonValue,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    });
  }

  /**
   * 자리별 대기 환자(워크리스트).
   *
   * 🔴 설정된 종류가 하나도 없으면 **빈 목록**을 돌려주고 meta 로 그 이유를 말한다.
   *    종전 워크스테이션은 설정이 안 맞으면 부서 전체(LAB) 오더로 폴백해서,
   *    심전도실 화면이 **채혈 오더 8건**을 "심전도 대기"로 보여주고 있었다(2026-08-26 실측).
   *    임상 워크리스트에서 틀린 목록은 빈 목록보다 나쁘다.
   */
  async getStationQueue(stationId: string, opts?: { statOnly?: boolean }) {
    const station = await this.prisma.workstationConfig.findUnique({ where: { stationId } });
    if (!station) throw msgException(HttpStatus.NOT_FOUND, serverMsg('자리를 찾을 수 없습니다: {자리}', { 자리: stationId }));

    const { usable, unknown } = resolveDiagnosticStationTypes(station.orderCodes);
    const meta = {
      stationId: station.stationId,
      label: station.label,
      category: station.category,
      testTypes: usable,
      unknownCodes: unknown,
      configured: usable.length > 0,
      isActive: station.isActive,
    };
    if (!usable.length) return { items: [], meta };

    const tests = await this.prisma.diagnosticTest.findMany({
      where: {
        testType: { in: usable },
        status: { in: [...OPEN_STATUSES] },
        ...(opts?.statOnly ? { priority: 'STAT' } : {}),
      },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 200,
    });

    const userIds = [...new Set(tests.map((t) => t.performedBy).filter(Boolean) as string[])];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const now = Date.now();
    const items = tests.map((t) => {
      const since = (t.scheduledAt ?? t.createdAt).getTime();
      const measurements = (t.measurements as Record<string, unknown> | null) ?? null;
      return {
        id: t.id,
        patientId: t.patientId,
        testType: t.testType,
        testName: t.testName,
        status: t.status,
        priority: t.priority,
        scheduledAt: t.scheduledAt,
        performedAt: t.performedAt,
        createdAt: t.createdAt,
        roomName: t.roomName,
        equipmentName: t.equipmentName,
        /** 대기 경과(분) — 예정시각이 있으면 그 기준, 없으면 의뢰시각 기준 */
        waitingMinutes: Math.floor((now - since) / 60000),
        targetTatMinutes: t.targetTatMinutes,
        /** 목표 소요시간이 없으면 초과 여부를 **판정하지 않는다**(null) */
        tatOverdue: t.targetTatMinutes ? now - since > t.targetTatMinutes * 60000 : null,
        /** 이미 기록된 측정 항목 수 — 이어쓰기인지 새로 재는지 화면이 안다 */
        measuredCount: measurements ? Object.keys(measurements).length : 0,
        performedByUser: t.performedBy ? userMap.get(t.performedBy) ?? null : null,
        patient: t.patient
          ? { ...t.patient, age: t.patient.dateOfBirth ? ageOf(t.patient.dateOfBirth) : null }
          : null,
      };
    });

    items.sort((a, b) => {
      const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      if (p !== 0) return p;
      return b.waitingMinutes - a.waitingMinutes;
    });

    return { items, meta };
  }
}
