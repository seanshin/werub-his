import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  stayDays, summarizeStayDays, journeyObjectTypeOf, JOURNEY_EPISODE_OBJECT_TYPES, JOURNEY_EPISODE_REQUIRED,
  JOURNEY_ACTIVITY_MAP, journeyEventTypesOfActivity, JOURNEY_REF_TYPE_TO_OBJECT, type JourneyEpisodeSummary,
  type JourneyDataOrigin, type JourneyTransition, type JourneyObjectType, type JourneyQualifier, type JourneyTimeSource,
  roundBy,
} from '@hospital-run/shared';
import { dayRange } from '../../common/day-range';
import { admissionEpisode, checkupEpisode, emergencyEpisode, episodeSortKey, outpatientEndAt, outpatientEpisode, surgeryEpisode } from './journey-episodes';
import { buildJourneyReport, type JourneyReport } from './journey-report';
import { buildClinicalLens, type ClinicalLens } from './clinical-lens';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FloorService } from '../floor/floor.service';

export interface JourneyEvent {
  patientId: string;
  eventType: string;
  title: string;
  description?: string;
  department?: string;
  doctorId?: string;
  doctorName?: string;
  refType?: string;
  refId?: string;
  navUrl?: string;
  severity?: string;
  metadata?: any;
  /**
   * (P1 2026-10-01) 발생 시각 — 도메인이 아는 시각(도착·입원·투약 시각 등). 주지 않으면 **발행 순간 = 기록 순간**으로 본다
   * (`SAME_AS_RECORDED`). 🔴 도메인 시각을 아는 지점은 반드시 넘긴다(구조 가드) — 모르는 시각은 `null`+`UNKNOWN`(지어내지 않는다).
   */
  occurredAt?: Date | null;
  /** 발생 시각 출처 — `occurredAt` 를 주면 기본 `DOMAIN_FIELD`. 사용자가 과거 시각을 입력했으면 `USER_CLAIMED` */
  occurredAtSource?: JourneyTimeSource;
  /** 발생 시각 정밀도 — 날짜만 아는 값(@db.Date)은 `DAY` */
  occurredAtPrecision?: 'SECOND' | 'MINUTE' | 'DAY';
  /** 예정 시각(예약·계획) — 발생과 섞지 않는다 */
  plannedAt?: Date | null;
  /** 데이터 출처 — 정본 발행기는 실제 업무(`LIVE`). 시드·데모는 각자 밝힌다 */
  dataOrigin?: JourneyDataOrigin;
  /**
   * 방문 단위(episode) — refType 이 이미 방문 단위면 생략해도 된다(그것이 episode 가 된다).
   * refType 이 원 기록(PACU 기록·스테이션 로그 등)이면 여기에 소속 방문 단위를 밝힌다.
   */
  episode?: { type: JourneyObjectType; id: string } | null;
  /**
   * (P2) 전이 — 기본은 shared `JOURNEY_ACTIVITY_MAP` 의 값. 같은 유형이 경로에 따라 다른 전이일 때만 덮는다
   * (응급 처분 **변경** = `REVISED`). 덮으면 멱등 키를 만들지 않는다(재발생이 정상인 전이).
   */
  transition?: JourneyTransition;
  /** (P2) 결과 속성 — 퇴원·전원·처분 값 등 */
  outcome?: string | null;
  /** (P2) 정정 대상 사건 id — `REVISED` 인데 주지 않으면 같은 활동·같은 원 기록의 직전 사건을 찾아 잇는다(없으면 null) */
  supersedesId?: string | null;
}

/** (P2) 사건 유형 → 활동·전이·멱등 키(정본 하나 — 테스트가 직접 부른다) */
export function journeyActivityFields(event: Pick<JourneyEvent, 'eventType' | 'transition' | 'outcome' | 'refId'>) {
  const map = JOURNEY_ACTIVITY_MAP[event.eventType as keyof typeof JOURNEY_ACTIVITY_MAP];
  if (!map) return { activity: null, transition: event.transition ?? null, outcome: event.outcome ?? null, idempotencyKey: null };
  const transition = event.transition ?? map.transition;
  const overridden = event.transition !== undefined && event.transition !== map.transition;
  const idempotencyKey = map.once && !overridden && event.refId && UUID_RE.test(event.refId)
    ? `${map.activity}:${transition}:${event.refId}` : null;
  return { activity: map.activity, transition, outcome: event.outcome ?? map.outcome ?? null, idempotencyKey };
}

/** (P2) 발행기 상태 — **이 프로세스가 시작된 뒤**의 수(재시작하면 0 부터). 감시자 불변식과 다른 층이다 */
export interface JourneyEmitStats {
  since: string;
  saved: number;
  failed: number;
  duplicateSuppressed: number;
  missingEpisode: number;
  lastFailureAt: string | null;
}

/** 사건–객체 관계 행(관계표 한 줄) */
export interface JourneyObjectLink { objectType: JourneyObjectType; objectId: string; qualifier: JourneyQualifier }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 발행 사건 → 관계표 행. 정본 하나(테스트가 직접 부른다).
 *  · refType 이 방문 단위 유형이면 qualifier `episode`, 아니면 `focus`
 *  · 명시 `episode` 는 `episode`(refType 과 같은 객체면 한 줄로)
 *  · uuid 가 아닌 refId(코드·번호)는 관계표에 싣지 않는다(@db.Uuid — 넣으면 저장 전체가 실패한다)
 */
export function journeyObjectLinks(event: Pick<JourneyEvent, 'refType' | 'refId' | 'episode'>): JourneyObjectLink[] {
  const out: JourneyObjectLink[] = [];
  const push = (l: JourneyObjectLink) => {
    if (!UUID_RE.test(l.objectId)) return;
    if (out.some((o) => o.objectType === l.objectType && o.objectId === l.objectId && o.qualifier === l.qualifier)) return;
    out.push(l);
  };
  const refObj = journeyObjectTypeOf(event.refType);
  if (event.episode?.id) push({ objectType: event.episode.type, objectId: event.episode.id, qualifier: 'episode' });
  if (refObj && event.refId) {
    const isEpisode = JOURNEY_EPISODE_OBJECT_TYPES.includes(refObj);
    const dupOfEpisode = event.episode?.type === refObj && event.episode?.id === event.refId;
    if (!dupOfEpisode) push({ objectType: refObj, objectId: event.refId, qualifier: isEpisode && !event.episode ? 'episode' : 'focus' });
  }
  return out;
}

/** 발행 사건의 시각 필드 — 정본 하나(테스트가 직접 부른다) */
export function journeyTimeFields(event: Pick<JourneyEvent, 'occurredAt' | 'occurredAtSource' | 'occurredAtPrecision'>, recordedAt: Date) {
  if (event.occurredAt === undefined) {
    // 발행 순간에 일어난 일 — 기록 시각과 같다고 밝힌다(추정이 아니라 정의)
    return { occurredAt: recordedAt, occurredAtSource: event.occurredAtSource ?? 'SAME_AS_RECORDED', occurredAtPrecision: event.occurredAtPrecision ?? 'SECOND' };
  }
  if (event.occurredAt === null || Number.isNaN(event.occurredAt.getTime())) {
    // 모른다 — 기록 시각으로 채우지 않는다
    return { occurredAt: null, occurredAtSource: 'UNKNOWN' as const, occurredAtPrecision: null };
  }
  return { occurredAt: event.occurredAt, occurredAtSource: event.occurredAtSource ?? 'DOMAIN_FIELD', occurredAtPrecision: event.occurredAtPrecision ?? 'SECOND' };
}

/** Prisma 유니크 위반(P2002) — 인스턴스 비교는 @prisma/client 이중 로딩에서 깨져 code 로 본다 */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

/** 호출 지점 파일명(`emergency.service` 등) — 어느 경로가 발행했는지(진단용 · 실패하면 null) */
function callerName(): string | null {
  const stack = new Error().stack?.split('\n') ?? [];
  for (const line of stack.slice(2)) {
    const m = line.match(/([\w.-]+)\.(?:ts|js):\d+/);
    if (m && m[1] !== 'journey.service') return m[1].slice(0, 80);
  }
  return null;
}

@Injectable()
export class JourneyService {
  private readonly logger = new Logger(JourneyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly floor: FloorService,
    // 🔴 관제 SSE(journey-console/stream) 갱신 힌트 — 환자 식별 정보 없이 유형·시각만 흘린다. 누락 시 힌트만 없다(저장 불변)
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** 관제 스트림 이벤트 이름 — 발행·구독이 한 상수를 쓴다 */
  static readonly SAVED_EVENT = 'journey.event.saved';

  /** 기간 보고서 조회 상한 */
  static readonly REPORT_LIMIT = 2000;

  /** 이벤트 발행 (fire-and-forget) + PatientLocation 자동 갱신 */
  private readonly stats: JourneyEmitStats = {
    since: new Date().toISOString(), saved: 0, failed: 0, duplicateSuppressed: 0, missingEpisode: 0, lastFailureAt: null,
  };

  /** (P2-5) 발행기 상태 — 관제 카드용(운영자 전용 EP 에서만 노출) */
  emitStats(): JourneyEmitStats {
    return { ...this.stats };
  }

  emit(event: JourneyEvent) {
    // 발행 경로는 동기 구간에서 잡는다(await 뒤에는 호출 스택이 사라진다)
    this.persist(event, callerName()).catch((err) => {
      // 🔴 (P2) 같은 사실의 이중 발행(멱등 키 충돌)은 실패가 아니라 억제다 — 실패 수에 섞지 않는다
      if (isUniqueViolation(err)) {
        this.stats.duplicateSuppressed++;
        this.logger.log(`Journey duplicate suppressed: ${event.eventType} (ref ${event.refId ?? '-'})`);
        return;
      }
      this.stats.failed++;
      this.stats.lastFailureAt = new Date().toISOString();
      this.logger.warn(`Journey emit failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async persist(event: JourneyEvent, emitter: string | null) {
    const recordedAt = new Date();
    const {
      occurredAt: _o, occurredAtSource: _s, occurredAtPrecision: _p, plannedAt, dataOrigin, episode,
      transition: _t, outcome: _oc, supersedesId, ...rest
    } = event;
    const time = journeyTimeFields(event, recordedAt);
    const links = journeyObjectLinks(event);
    const act = journeyActivityFields(event);
    // 🔴 방문 단위가 필수인 유형인데 귀속이 없다 — 저장은 하되 흔적을 남긴다(감시자 77 이 신규 행을 센다)
    const need = JOURNEY_EPISODE_REQUIRED[event.eventType as keyof typeof JOURNEY_EPISODE_REQUIRED];
    if (need && !links.some((l) => l.qualifier === 'episode' && l.objectType === need)) {
      this.stats.missingEpisode++;
      this.logger.warn(`Journey ${event.eventType} without ${need} episode (ref ${event.refType ?? '-'})`);
    }
    // (P2) 정정은 새 사건 — 앞 사건을 가리킨다. 직접 주지 않으면 같은 활동·같은 원 기록의 직전 사건(없으면 null · 추정 귀속 안 함)
    let supersedes = supersedesId ?? null;
    if (supersedesId === undefined && act.transition === 'REVISED' && act.activity && event.refType && event.refId) {
      const prev = await this.prisma.patientJourneyEvent.findFirst({
        where: {
          patientId: event.patientId, refType: event.refType, refId: event.refId,
          eventType: { in: journeyEventTypesOfActivity(act.activity) },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      supersedes = prev?.id ?? null;
    }
    const saved = await this.prisma.patientJourneyEvent.create({
      data: {
        ...rest, eventAt: recordedAt, ...time, plannedAt: plannedAt ?? null,
        dataOrigin: dataOrigin ?? 'LIVE', emitter,
        activity: act.activity, transition: act.transition, outcome: act.outcome,
        supersedesId: supersedes, idempotencyKey: act.idempotencyKey,
        ...(links.length ? { objects: { create: links } } : {}),
      },
    });
    this.stats.saved++;
    this.events?.emit(JourneyService.SAVED_EVENT, { eventType: event.eventType, at: saved.eventAt.toISOString() });
    // 🔴 (2026-09-14 P3) 종전 `.catch(() => {})` — 위치 갱신 실패가 흔적 없이 사라져 환자 위치가 멈춘 이유를 알 수 없었다.
    //    발행은 이미 저장됐으므로 되돌리지 않는다(동작 불변) — 실패만 남긴다.
    this.updatePatientLocation(event, saved.id).catch((err) =>
      this.logger.warn(`Patient location update failed (event ${saved.id}, ${event.eventType}): ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  /**
   * Journey 이벤트 → PatientLocation(위치 원장) — 쓰기는 `FloorService.recordLocation` 하나로(P0-3).
   *
   * 🔴 (P0-1·P0-2 · 2026-09-28) 이 함수가 만드는 위치는 대부분 **추정**이다 — "오더가 났다 → 검사실에 있다".
   *    종전엔 관측(QR)과 같은 모양으로 넣었고, 같은 종류 구역이 여럿이면 `findFirst` 로 **아무 구역이나** 골랐다.
   *    이제: 출처를 밝힌다(INFERRED_EVENT·SIMULATED) · 후보가 여럿이면 층까지만(FLOOR) · 층도 갈리면 기록하지 않는다.
   *    검진 스테이션 도착은 직원이 처리한 **관측**이다 — 스테이션이 공간에 연결돼 있을 때만(OBSERVED_STATION).
   */
  private async updatePatientLocation(event: JourneyEvent, eventId: string) {
    const simulated = event.metadata?.simulated === true;

    if (event.eventType === 'CHECKUP_STATION_ARRIVE') {
      if (event.refType !== 'CheckupStationLog' || !event.refId) return;
      const log = await this.prisma.checkupStationLog.findUnique({
        where: { id: event.refId },
        select: { station: { select: { spaceNodeId: true, spaceNode: { select: { nodeType: true } } } } },
      });
      const zoneId = log?.station?.spaceNodeId;
      if (!zoneId) return; // 스테이션이 공간에 연결되지 않았다 — 위치를 지어내지 않는다
      await this.floor.recordLocation({
        patientId: event.patientId, zoneId, source: simulated ? 'SIMULATED' : 'OBSERVED_STATION',
        // 스테이션을 층에만 연결했으면 층 단위로 적는다(구역을 지어내지 않는다)
        granularity: log?.station?.spaceNode?.nodeType === 'FLOOR' ? 'FLOOR' : 'ZONE',
        status: 'in-lab', eventType: event.eventType, eventId,
      });
      return;
    }

    // 🔴 (2026-10-03 결정 D8 = 수납 완료) 외래 방문은 수납 완료로 끝난다 — 종전엔 "약국 대기"를 새로 열어 그 위치가 남았다.
    //    외래 진료의 수납일 때만 닫는다(입원·응급 진행 중이면 그 머묾이 정본 — 닫지 않는다).
    if (event.eventType === 'BILLING_PAID') {
      if (simulated || event.refType !== 'Billing' || !event.refId) return;
      const billing = await this.prisma.billing.findUnique({
        where: { id: event.refId },
        select: { encounter: { select: { visitType: true, admissionId: true } } },
      });
      const enc = billing?.encounter;
      if (!enc || enc.admissionId || (enc.visitType != null && enc.visitType !== 'OUTPATIENT')) return;
      const [admitted, erOpen] = await Promise.all([
        this.prisma.admission.count({ where: { patientId: event.patientId, status: 'ADMITTED' } }),
        this.prisma.emergencyVisit.count({ where: { patientId: event.patientId, status: { not: 'COMPLETED' } } }),
      ]);
      if (admitted || erOpen) return;
      await this.floor.closeOpenLocations({ patientId: event.patientId, closedBy: 'OUTPATIENT_PAID', closeSource: 'INFERRED_EVENT', eventRef: event.refId });
      return;
    }

    const mapping = this.getLocationMapping(event);
    if (!mapping) return;

    const where: Prisma.SpaceNodeWhereInput = { spaceType: mapping.spaceType, isActive: true, nodeType: { in: ['ZONE', 'WING'] } };
    if (mapping.department) where.department = mapping.department;
    if (mapping.floor) where.floor = mapping.floor;
    const candidates = await this.prisma.spaceNode.findMany({ where, select: { id: true, floor: true }, take: 50 });
    if (!candidates.length) return;

    let zoneId: string;
    let granularity: 'ZONE' | 'FLOOR' = 'ZONE';
    if (candidates.length === 1) {
      zoneId = candidates[0].id;
    } else {
      const floors = [...new Set(candidates.map((c) => c.floor))];
      if (floors.length !== 1 || floors[0] == null) return; // 층까지 갈린다 — 어디라고 말할 수 없다
      const floorNode = await this.prisma.spaceNode.findFirst({
        where: { nodeType: 'FLOOR', floor: floors[0], isActive: true },
        select: { id: true },
      });
      if (!floorNode) return;
      zoneId = floorNode.id;
      granularity = 'FLOOR';
    }

    await this.floor.recordLocation({
      patientId: event.patientId, zoneId, granularity,
      source: simulated ? 'SIMULATED' : 'INFERRED_EVENT',
      status: mapping.status, eventType: event.eventType, eventId,
    });
  }

  private getLocationMapping(event: JourneyEvent): { spaceType: string; status: string; department?: string; floor?: number } | null {
    const dept = event.department;
    const map: Record<string, { spaceType: string; status: string; floor?: number }> = {
      'RECEPTION_CHECKIN': { spaceType: 'RECEPTION', status: 'waiting', floor: 1 },
      'RECEPTION_CALLED': { spaceType: 'WAITING', status: 'waiting' },
      'ENCOUNTER_START': { spaceType: 'CLINIC', status: 'in-treatment' },
      'ENCOUNTER_SIGNED': { spaceType: 'CASHIER', status: 'moving', floor: 1 },
      'PRESCRIPTION_ADDED': { spaceType: 'CLINIC', status: 'in-treatment' },
      'ORDER_CREATED': { spaceType: 'LAB', status: 'in-lab' },
      'LAB_RESULT': { spaceType: 'LAB', status: 'moving' },
      'IMAGING_RESULT': { spaceType: 'IMAGING', status: 'moving' },
      // 'BILLING_PAID' 위치 매핑 제거(2026-10-03 결정 D8) — 수납 완료는 외래의 끝이라 위치를 닫는다(updatePatientLocation)
      'ADMISSION': { spaceType: 'WARD_ROOM', status: 'resting' },
      'BED_TRANSFER': { spaceType: 'WARD_ROOM', status: 'resting' },
      // 'ROUND' 제거(2026-09-14) — 회진 기록 도메인이 없어 어느 경로도 발행하지 않는 이름이었다(shared JOURNEY_EVENT_NOT_EMITTED).
      'SURGERY_START': { spaceType: 'SURGERY', status: 'in-surgery', floor: 1 },
      'SURGERY_COMPLETE': { spaceType: 'RECOVERY', status: 'resting', floor: 1 },
      'ER_ARRIVAL': { spaceType: 'ER', status: 'waiting', floor: 1 },
      'ER_TRIAGE': { spaceType: 'ER', status: 'in-treatment', floor: 1 },
      'ER_TREATMENT_START': { spaceType: 'ER', status: 'in-treatment', floor: 1 },
      'ER_DISPOSITION': { spaceType: 'ER', status: 'moving', floor: 1 },
      // 'DISCHARGE' 제거(2026-10-03) — 퇴원은 "로비에 있다(완료)"를 **새로 열어** 그 위치가 영영 현재로 남았다.
      //   퇴원은 위치를 여는 사건이 아니라 닫는 사건이다 → admission.closed 구독(FloorLocationListener)이 닫는다.
    };

    const m = map[event.eventType];
    if (!m) return null;
    return { ...m, department: dept };
  }

  /** 직원 타임라인 기본·최대 건수 */
  static readonly TIMELINE_DEFAULT = 200;
  static readonly TIMELINE_MAX = 500;

  /**
   * 이벤트 조회 (타임라인).
   * 🔴 (2026-10-01 여정 P0-8) 종전 `orderBy asc · take 200` — 행이 200 을 넘는 장기 재원 환자는 **최근 사건이 잘렸고**
   *    잘렸다는 표시도 없었다(환자 포털은 반대로 최신부터 잘랐다 — 같은 원장을 두 화면이 반대로 잘랐다).
   *    → **최신 N건**을 가져와 시간순(오래된→최신)으로 돌려주고, 더 오래된 행이 있으면 `truncated`·`olderCursor` 로 말한다.
   *    이전 기록은 `before=<eventAt ISO>|<id>` 커서로 이어 받는다(시각 커서 규약 — 같은 시각 행도 빠지지 않게 id 를 함께).
   * 🔴 날짜 경계는 정본 `dayRange`(KST) — 종전 `new Date(from)`·`'T23:59:59Z'` 는 UTC 라 앞뒤 9시간이 밀렸다(P0-4).
   */
  /**
   * 환자 여정 타임라인 — **발생 시각 기준** 최신순(2026-10-01 · P3 표시 잔여).
   *
   * 정렬 키 = `COALESCE(occurred_at, event_at)`(발생 시각, 모르면 표시 시각) — 화면 `placedAt` 과 같은 정의.
   * 🔴 종전엔 서버가 `event_at`(표시 시각)으로 자르고 화면이 페이지 **안에서만** 발생 시각으로 다시 줄 세웠다 —
   *    늦게 입력된 사건(30분 전 도착을 지금 등록)은 첫 페이지에 들어오고, 발생 시각상 더 최근인 사건이 다음 페이지로 밀릴 수 있었다.
   *    잘림·커서도 같은 키로 판정한다(커서 모양 `<ISO>|<id>` 는 그대로 · 뜻이 정렬 키로 바뀐다).
   * 기간(from/to)도 같은 키로 거른다. 정렬은 Prisma `orderBy` 로 표현할 수 없어(COALESCE) id 선택만 매개변수 SQL 로 하고,
   * 행·관계는 종전처럼 Prisma 로 읽는다. 식 인덱스는 두지 않는다 — 스키마로 표현할 수 없어 `db push` 가 지운다(2026-10-01 SQL 튜닝 교훈) ·
   * 환자 한 명의 행 수는 `patient_id` 인덱스로 좁힌 뒤 정렬하면 충분하다.
   */
  async getTimeline(patientId: string, opts?: { from?: string; to?: string; types?: string[]; limit?: number; before?: string; episode?: { type: string; id: string } }) {
    const conds: Prisma.Sql[] = [Prisma.sql`e.patient_id = ${patientId}::uuid`];
    const key = Prisma.sql`COALESCE(e.occurred_at, e.event_at)`;
    const range = dayRange(opts?.from, opts?.to);
    if (range?.gte) conds.push(Prisma.sql`${key} >= ${range.gte}`);
    if (range?.lt) conds.push(Prisma.sql`${key} < ${range.lt}`);
    if (opts?.types?.length) conds.push(Prisma.sql`e.event_type = ANY(${opts.types}::text[])`);
    if (opts?.episode) {
      // (P3 표시 잔여) 방문 하나로 거르기 — 관계표(P1 이후 행) **또는** 옛 refType·refId(P1 전 행 — 관계 없음)
      const legacy = Object.entries(JOURNEY_REF_TYPE_TO_OBJECT).filter(([, t]) => t === opts.episode!.type).map(([k]) => k);
      const viaObjects = Prisma.sql`EXISTS (SELECT 1 FROM patient_journey_event_objects o WHERE o.event_id = e.id AND o.qualifier = 'episode'
        AND o.object_type = ${opts.episode.type} AND o.object_id = ${opts.episode.id}::uuid)`;
      conds.push(legacy.length
        ? Prisma.sql`(${viaObjects} OR (e.ref_type = ANY(${legacy}::text[]) AND e.ref_id = ${opts.episode.id}::uuid))`
        : viaObjects);
    }
    if (opts?.before) {
      const [iso, id] = opts.before.split('|');
      const at = new Date(iso ?? '');
      if (!iso || !id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('before cursor must be <ISO time>|<id>');
      conds.push(Prisma.sql`(${key} < ${at} OR (${key} = ${at} AND e.id < ${id}::uuid))`);
    }
    const limit = Math.min(Math.max(opts?.limit ?? JourneyService.TIMELINE_DEFAULT, 1), JourneyService.TIMELINE_MAX);
    const picked = await this.prisma.$queryRaw<{ id: string; sort_at: Date }[]>(Prisma.sql`
      SELECT e.id::text AS id, ${key} AS sort_at FROM patient_journey_events e
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY ${key} DESC, e.id DESC
      LIMIT ${limit + 1}`);
    const truncated = picked.length > limit;
    const page = picked.slice(0, limit);
    const rows = page.length
      ? await this.prisma.patientJourneyEvent.findMany({
          where: { id: { in: page.map((r) => r.id) } },
          // (P3 UX) 방문 단위 — 화면이 "이 방문만 보기"·방문 표식을 그린다(귀속 없는 과거 행은 빈 배열 = 방문 미지정)
          include: { objects: { where: { qualifier: 'episode' }, select: { objectType: true, objectId: true } } },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = page.map((r) => byId.get(r.id)).filter((r): r is NonNullable<typeof r> => !!r);
    const oldest = page[page.length - 1];
    return {
      // data 는 시간순(오래된 것 먼저 — 종전 모양 유지) · 정렬 키는 발생 시각(모르면 표시 시각)
      events: ordered.reverse(),
      truncated,
      olderCursor: truncated && oldest ? `${new Date(oldest.sort_at).toISOString()}|${oldest.id}` : null,
      /** 이 응답의 정렬·잘림 기준 — 화면이 밝힌다 */
      orderBy: 'OCCURRED_ELSE_DISPLAYED' as const,
    };
  }

  /** 방문 묶음 상한 — 유형마다 최근 N 건 */
  static readonly EPISODES_PER_TYPE = 30;

  /**
   * 방문 묶음(2026-10-01 · P3 표시 잔여) — 환자의 방문 단위 요약을 **도메인 원장**에서(여정 원장 아님 · `journey-episodes.ts`).
   * 유형마다 최근 N 건 · 넘으면 그 유형을 `truncatedTypes` 로 말한다.
   */
  async getEpisodes(patientId: string): Promise<{ episodes: JourneyEpisodeSummary[]; truncatedTypes: string[]; perTypeLimit: number }> {
    const N = JourneyService.EPISODES_PER_TYPE;
    const take = N + 1;
    const [qs, ers, adms, surgs, cks] = await Promise.all([
      this.prisma.waitingQueue.findMany({ where: { patientId }, orderBy: [{ checkedInAt: 'desc' }, { id: 'desc' }], take,
        select: { id: true, departmentName: true, status: true, checkedInAt: true, encounterId: true } }),
      this.prisma.emergencyVisit.findMany({ where: { patientId }, orderBy: [{ arrivalAt: 'desc' }, { id: 'desc' }], take,
        select: { id: true, status: true, arrivalAt: true, disposition: true, dispositionAt: true, departedAt: true } }),
      this.prisma.admission.findMany({ where: { patientId }, orderBy: [{ admitDate: 'desc' }, { id: 'desc' }], take,
        select: { id: true, status: true, admitDate: true, dischargeDate: true, bed: { select: { ward: { select: { name: true } } } } } }),
      this.prisma.surgery.findMany({ where: { patientId }, orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }], take,
        select: { id: true, status: true, procedureName: true, scheduledAt: true, startedAt: true, endedAt: true } }),
      this.prisma.checkupVisit.findMany({ where: { patientId }, orderBy: [{ scheduledDate: 'desc' }, { id: 'desc' }], take,
        select: { id: true, status: true, scheduledDate: true, checkedInAt: true, completedAt: true, program: { select: { name: true } } } }),
    ]);
    const truncatedTypes: string[] = [];
    const cut = <T,>(rows: T[], type: string) => { if (rows.length > N) truncatedTypes.push(type); return rows.slice(0, N); };
    // 외래 끝(D8 = 수납 완료) — 그 진료의 수납(진료 1:1)
    const encIds = qs.map((q) => q.encounterId).filter((x): x is string => !!x);
    const bills = encIds.length
      ? await this.prisma.billing.findMany({ where: { encounterId: { in: encIds } }, select: { encounterId: true, status: true, paidAt: true } })
      : [];
    const billOf = new Map(bills.map((b) => [b.encounterId, { status: String(b.status), paidAt: b.paidAt }]));
    const episodes = [
      ...cut(qs, 'WaitingQueue').map((q) => outpatientEpisode({ ...q, billing: q.encounterId ? billOf.get(q.encounterId) ?? null : null })),
      ...cut(ers, 'EmergencyVisit').map((v) => emergencyEpisode({ ...v, disposition: v.disposition ?? null })),
      ...cut(adms, 'Admission').map((a) => admissionEpisode({ ...a, status: String(a.status), wardName: a.bed?.ward?.name ?? null })),
      ...cut(surgs, 'Surgery').map((s) => surgeryEpisode({ ...s, status: String(s.status) })),
      ...cut(cks, 'CheckupVisit').map((c) => checkupEpisode({ ...c, programName: c.program?.name ?? null })),
    ].sort((a, b) => episodeSortKey(b) - episodeSortKey(a));
    return { episodes, truncatedTypes, perTypeLimit: N };
  }

  /** 의료진 관점 여정 조회 상한 */
  static readonly LENS_LIMIT = { orders: 300, prescriptions: 200, criticals: 100 } as const;

  /**
   * 의료진 관점 여정(2026-10-01) — 오더·처방·위급값의 단계 이력과 질관리 점검. 정본은 도메인 원장(여정 원장 아님).
   * 기간 기본 최근 90일(발행 시각 기준) · 상한을 넘으면 `truncated` 로 말한다.
   */
  async getClinicalLens(patientId: string, opts: { from?: string; to?: string }): Promise<ClinicalLens> {
    const range = dayRange(opts.from, opts.to);
    const to = range?.lt ?? new Date();
    const from = range?.gte ?? new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
    const L = JourneyService.LENS_LIMIT;
    const nameSel = { medicationCode: { select: { nameKo: true } }, procedureCode: { select: { nameKo: true } } } as const;
    const [orders, prescriptions, criticals] = await Promise.all([
      this.prisma.order.findMany({
        where: { prescription: { encounter: { patientId } }, createdAt: { gte: from, lt: to } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: L.orders + 1,
        select: {
          id: true, department: true, status: true, priority: true, createdAt: true, receivedAt: true, startedAt: true,
          completedAt: true, cancelledAt: true, acknowledgedAt: true, specimenCollectedAt: true, specimenCollectionSource: true,
          prescription: { select: { type: true, ...nameSel } },
          labResult: { select: { status: true, collectedAt: true, completedAt: true, verifiedAt: true, items: { select: { flag: true } } } },
          imagingResult: { select: { status: true, acquiredAt: true, reportedAt: true } },
          dispensing: { select: { status: true, dispensedAt: true, verifiedAt: true, issuedAt: true } },
        },
      }),
      this.prisma.prescription.findMany({
        // 검사·영상 처방은 오더의 운반체 — 오더 단계에서 본다(이중 표시 안 함)
        where: { encounter: { patientId }, type: { notIn: ['LAB', 'IMAGING'] }, createdAt: { gte: from, lt: to } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: L.prescriptions + 1,
        select: {
          id: true, type: true, status: true, priority: true, createdAt: true, duration: true, dosage: true, frequency: true,
          orderSource: true, readBackConfirmedAt: true, prescriberCosignedAt: true, durChecked: true, durOverridden: true,
          durWarnings: true, discontinuedAt: true, discontinueReason: true, renewedFromId: true, dischargeMed: true,
          ...nameSel,
          medAdmins: { select: { status: true, scheduledAt: true, administeredAt: true } },
        },
      }),
      this.prisma.criticalValueAlert.findMany({
        where: { patientId, notifiedAt: { gte: from, lt: to } },
        orderBy: [{ notifiedAt: 'desc' }, { id: 'desc' }],
        take: L.criticals + 1,
        select: {
          id: true, testName: true, value: true, unit: true, status: true, notifiedAt: true, escalatedAt: true,
          acknowledgedAt: true, actedAt: true, closedAt: true,
        },
      }),
    ]);
    return buildClinicalLens({
      orders: orders.slice(0, L.orders),
      prescriptions: prescriptions.slice(0, L.prescriptions),
      criticals: criticals.slice(0, L.criticals),
      period: { from, to },
      truncated: { orders: orders.length > L.orders, prescriptions: prescriptions.length > L.prescriptions, criticals: criticals.length > L.criticals },
    });
  }

  /**
   * (P3-1 · 2026-10-01) 반출 준비도 — **집계만**(사건·환자 데이터를 내보내지 않는다). 반출 자체는 사람 결정
   * `journey.exportMode`(허가권자 층) 전에는 경로가 없다. 기간은 **기록 시각(created_at)** 기준이다(event_at 은 재작성된 행이 있다).
   *  · 평탄화 경고(XES 는 사례 하나를 고른다): 결핍 = 그 사례 유형 관계가 없는 사건 · 수렴 = 그 유형 객체가 둘 이상인 사건
   *  · 시각 미상 사건은 반출에서 빠진다(기록 시각으로 대신하지 않는다) — 그 수를 낸다
   */
  async exportReadiness(opts: { caseType?: string; from?: string; to?: string }) {
    const caseType = opts.caseType ?? 'EmergencyVisit';
    if (!(JOURNEY_EPISODE_OBJECT_TYPES as readonly string[]).includes(caseType)) {
      throw new BadRequestException(`caseType must be one of ${JOURNEY_EPISODE_OBJECT_TYPES.join(', ')}`);
    }
    const range = dayRange(opts.from, opts.to);
    const lt = range?.lt ?? new Date();
    const gte = range?.gte ?? new Date(lt.getTime() - 30 * 24 * 60 * 60 * 1000);
    const where: Prisma.PatientJourneyEventWhereInput = { createdAt: { gte, lt } };
    const mappableTypes = Object.keys(JOURNEY_ACTIVITY_MAP);
    const [total, withTime, mappable, related, byOrigin, multi, cases] = await Promise.all([
      this.prisma.patientJourneyEvent.count({ where }),
      this.prisma.patientJourneyEvent.count({ where: { ...where, occurredAt: { not: null } } }),
      this.prisma.patientJourneyEvent.count({ where: { ...where, eventType: { in: mappableTypes } } }),
      this.prisma.patientJourneyEvent.count({ where: { ...where, objects: { some: { objectType: caseType } } } }),
      this.prisma.patientJourneyEvent.groupBy({ by: ['dataOrigin'], where, _count: { _all: true } }),
      this.prisma.patientJourneyEventObject.groupBy({
        by: ['eventId'], where: { objectType: caseType, event: where }, _count: { _all: true },
        having: { eventId: { _count: { gt: 1 } } },
      }),
      this.prisma.patientJourneyEventObject.findMany({ where: { objectType: caseType, event: where }, distinct: ['objectId'], select: { objectId: true } }),
    ]);
    return {
      caseType,
      period: { from: gte.toISOString(), to: lt.toISOString(), basis: 'RECORDED_AT' as const },
      events: {
        total,
        withOccurredAt: withTime,
        unknownTime: total - withTime,
        mappable,
        unmappable: total - mappable,
        byOrigin: Object.fromEntries(byOrigin.map((g) => [g.dataOrigin, g._count._all])) as Record<string, number>,
      },
      flattening: { cases: cases.length, relatedToCase: related, deficiency: total - related, convergence: multi.length },
      export: { available: false as const, reason: 'NO_EXPORT_PATH' as const, decisionKey: 'journey.exportMode' },
    };
  }

  /**
   * 환자 여정 기간 보고서(기획 patient-journey-tracking §3.4) — 입원 1건 기간 또는 from~to(끝나는 날 포함).
   * 🔴 기간을 안 주면 400(전 기간 전건 조회를 조용히 하지 않는다) · 다른 환자의 입원 id 는 404.
   */
  async getReport(patientId: string, opts: { admissionId?: string; from?: string; to?: string }): Promise<JourneyReport> {
    let period: JourneyReport['period'];
    let admission: { id: string; admitDate: Date; dischargeDate: Date | null; lengthOfStayDays: number | null } | null = null;
    const where: Prisma.PatientJourneyEventWhereInput = { patientId };
    if (opts.admissionId) {
      const adm = await this.prisma.admission.findFirst({
        where: { id: opts.admissionId, patientId },
        select: { id: true, admitDate: true, dischargeDate: true },
      });
      if (!adm) throw new NotFoundException('Admission not found for this patient');
      admission = { ...adm, lengthOfStayDays: stayDays(adm.admitDate, adm.dischargeDate) };
      where.eventAt = { gte: adm.admitDate, ...(adm.dischargeDate ? { lte: adm.dischargeDate } : {}) };
      period = { from: adm.admitDate.toISOString(), to: adm.dischargeDate?.toISOString() ?? null, source: 'ADMISSION' };
    } else {
      const range = dayRange(opts.from, opts.to);
      if (!range?.gte || !range?.lt) throw new BadRequestException('Specify a period (from and to) or an admissionId');
      where.eventAt = { gte: range.gte, lt: range.lt };
      period = { from: range.gte.toISOString(), to: range.lt.toISOString(), source: 'RANGE' };
    }
    const rows = await this.prisma.patientJourneyEvent.findMany({
      where,
      orderBy: { eventAt: 'asc' },
      take: JourneyService.REPORT_LIMIT + 1,
      select: { eventType: true, eventAt: true, refType: true, refId: true, occurredAt: true },
    });
    return buildJourneyReport(rows, { limit: JourneyService.REPORT_LIMIT, period, admission });
  }

  /**
   * 질관리 지표 집계.
   * 🔴 (2026-10-01 여정 P0-1·P0-2) 정의서 `patient-journey-model.plan.md` §5.10:
   *  · 표본이 없으면 `null`(산출 불가)이고 표본 수를 함께 낸다 — 종전 응급 체류·재원일수·재입원율은 `0` 을 냈다(화면이 "0시간·0일·0%"를 사실로 그렸다).
   *  · **응급 체류(ED LOS) = 응급 방문 도착 → 퇴실.** 종전은 `admitReason` 에 'ER' 이 든 **입원의 재원 기간**이었다(모집단·정의가 이름과 달랐다).
   *    퇴실 시각의 정본이 아직 없다(`EmergencyVisit` 에 퇴실 시각 필드 없음 · 사람 결정 D9) → **산출 불가**로 두고 이유를 싣는다. 대용값을 쓰지 않는다.
   *  · 날짜 경계는 정본 `dayRange`(KST).
   *  · 재입원 판정은 퇴원 건마다 쿼리하던 N+1 을 한 번의 조회로.
   */
  async getMetrics(opts?: { from?: string; to?: string }) {
    const range = dayRange(opts?.from, opts?.to);
    const dateFrom = range?.gte ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = range?.lt ?? new Date();
    const period = { gte: dateFrom, lt: dateTo };

    // 1. 평균 외래 대기시간 (접수→진료시작)
    const waitingQueues = await this.prisma.waitingQueue.findMany({
      where: {
        checkedInAt: period,
        startedAt: { not: null },
        status: { in: ['IN_CONSULTATION', 'COMPLETED'] },
      },
      select: { checkedInAt: true, startedAt: true },
    });

    // 🔴 표본이 없을 때 `0` 을 내던 것 — 화면 실사용 점검 W8(2026-08-14).
    //    '평균 대기 0분'은 "기다림이 없다"는 **관측된 사실**로 읽힌다. 표본 부재는 그 반대,
    //    아무것도 모른다는 뜻이다(P1: 모르는 것을 안다고 말함).
    let avgOutpatientWaitMinutes: number | null = null;
    if (waitingQueues.length > 0) {
      const totalWait = waitingQueues.reduce((sum, q) => {
        return sum + (q.startedAt!.getTime() - q.checkedInAt.getTime()) / 60000;
      }, 0);
      avgOutpatientWaitMinutes = Math.round((totalWait / waitingQueues.length) * 10) / 10;
    }
    const outpatientWaitSampleN = waitingQueues.length;

    // 1-b. 평균 외래 체류(2026-10-03 결정 D8) — 접수 → 그 진료의 수납 완료. 모집단 = 기간 안 접수 중 수납 완료가 있는 방문.
    //      수납 전·미수·접수보다 앞선 수납(데이터 결함)은 표본에서 빼고 수를 밝힌다 · 표본 0 = null
    const opdQueues = await this.prisma.waitingQueue.findMany({
      where: { checkedInAt: period, encounterId: { not: null }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
      select: { checkedInAt: true, encounterId: true },
    });
    const opdBills = opdQueues.length
      ? await this.prisma.billing.findMany({
          where: { encounterId: { in: opdQueues.map((q) => q.encounterId!) }, encounter: { admissionId: null } },
          select: { encounterId: true, status: true, paidAt: true },
        })
      : [];
    const opdBillOf = new Map(opdBills.map((b) => [b.encounterId, { status: String(b.status), paidAt: b.paidAt }]));
    let opdStaySum = 0, opdStayN = 0, opdNotPaid = 0;
    for (const q of opdQueues) {
      const end = outpatientEndAt(q, opdBillOf.get(q.encounterId!));
      if (!end) { opdNotPaid++; continue; }
      opdStaySum += (end.getTime() - q.checkedInAt.getTime()) / 60000;
      opdStayN++;
    }
    const avgOutpatientStayMinutes = opdStayN > 0 ? roundBy(opdStaySum / opdStayN, 'outpatientStayMinutesMean') : null;

    // 2. 응급 체류(2026-10-03 결정 D9) — 도착 → 퇴실 시각(departedAt). 모집단은 기간 안 도착한 응급 방문.
    //    퇴실 시각 없는 방문(진행 중·자동 종결·기록 이전)은 표본에서 빼고 수를 밝힌다 · 표본 0 = null + 이유
    const erVisits = await this.prisma.emergencyVisit.findMany({ where: { arrivalAt: period }, select: { arrivalAt: true, departedAt: true } });
    const erVisitCount = erVisits.length;
    let erStaySum = 0, erStayN = 0;
    for (const v of erVisits) {
      if (!v.departedAt || v.departedAt.getTime() < v.arrivalAt.getTime()) continue;
      erStaySum += (v.departedAt.getTime() - v.arrivalAt.getTime()) / 3_600_000;
      erStayN++;
    }
    const avgErStayHours: number | null = erStayN > 0 ? roundBy(erStaySum / erStayN, 'erStayHoursMean') : null;
    const erStayUnavailableReason = erStayN > 0 ? null : ('NO_DEPARTURE_RECORDED' as const);

    // 3. 평균 재원일수 — 지표 정의서(§5.10): 모집단 = **기간 안 퇴원한** 입원(취소 제외) · 개별 값 = 정본 `stayDays` · 표본 0 이면 null
    //    🔴 (2026-10-01 여정 P1 잔여) 종전엔 기간 안 **입원**한 것 중 퇴원한 것을 소수 일로 평균했다 — 환자 화면의 재원일수
    //       (stayDays · max(1,ceil))와 계산이 달랐고, 기간 끝 무렵 입원한 장기 재원은 아직 퇴원 전이라 빠져 평균이 짧게 나왔다.
    const admissions = await this.prisma.admission.findMany({
      where: { dischargeDate: period, status: 'DISCHARGED' },
      select: { admitDate: true, dischargeDate: true },
    });
    const los = summarizeStayDays(admissions);
    const avgLengthOfStayDays = los.meanDays;

    // 4. 30일 재입원율 — 분모 0 이면 null · 재입원 후보를 한 번에 읽어 메모리에서 짝짓는다(N+1 제거)
    const allDischarges = await this.prisma.admission.findMany({
      where: { dischargeDate: period, status: 'DISCHARGED' },
      select: { patientId: true, dischargeDate: true },
      orderBy: { dischargeDate: 'asc' },
    });
    const DAY30 = 30 * 24 * 60 * 60 * 1000;
    const laterAdmits = allDischarges.length
      ? await this.prisma.admission.findMany({
          where: {
            patientId: { in: [...new Set(allDischarges.map((d) => d.patientId))] },
            admitDate: { gt: dateFrom, lte: new Date(dateTo.getTime() + DAY30) },
            // 🔴 (2026-10-01) 취소된 입원은 일어나지 않은 입원이다 — 종전엔 재입원으로 셌다(정의 결정 D11 과 무관한 결함)
            status: { not: 'CANCELLED' },
          },
          select: { patientId: true, admitDate: true },
        })
      : [];
    const admitsBy = new Map<string, number[]>();
    for (const a of laterAdmits) admitsBy.set(a.patientId, [...(admitsBy.get(a.patientId) ?? []), a.admitDate.getTime()]);
    let readmissionCount = 0;
    for (const d of allDischarges) {
      const t = d.dischargeDate!.getTime();
      if ((admitsBy.get(d.patientId) ?? []).some((x) => x > t && x <= t + DAY30)) readmissionCount++;
    }

    const readmissionRate30Days = allDischarges.length > 0
      ? Math.round((readmissionCount / allDischarges.length) * 1000) / 10
      : null;

    return {
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      avgOutpatientWaitMinutes,
      /** 평균 대기 산출에 쓴 표본 수 — 0 이면 위 값은 null(산출 불가)이다 */
      outpatientWaitSampleN,
      /** 평균 외래 체류(접수 → 수납 완료 · 결정 D8) — 표본 0 = null */
      avgOutpatientStayMinutes,
      outpatientStaySampleN: opdStayN,
      /** 외래 체류에서 뺀 방문 — 수납 전·미수·접수보다 앞선 수납 */
      outpatientStayExcluded: opdNotPaid,
      avgErStayHours,
      /** 응급 체류가 산출 불가인 이유 — 기간 안 퇴실 시각이 기록된 방문 0(결정 D9 이후 퇴실 확정분부터 쌓인다) */
      erStayUnavailableReason,
      /** 응급 체류 산출에 쓴 방문 수(퇴실 시각 있는 것) */
      erVisitSampleN: erStayN,
      /** 응급 체류에서 뺀 방문 — 진행 중·퇴실 시각 없음(자동 종결·기록 이전) */
      erStayExcluded: erVisitCount - erStayN,
      avgLengthOfStayDays,
      /** 재원일수 산출에 쓴 퇴원 입원 수(제외분 빼고) */
      admissionSampleN: los.n,
      /** 재원일수에서 뺀 것 — 날짜 없음·퇴원이 입원보다 이름(데이터 결함은 1일로 감싸 섞지 않는다) */
      lengthOfStayExcluded: los.excluded,
      readmissionRate30Days,
      /** 재입원율 분모(기간 안 퇴원 수) */
      dischargeSampleN: allDischarges.length,
      sampleCounts: {
        outpatientWaits: waitingQueues.length,
        erVisits: erVisitCount,
        outpatientStays: opdStayN,
        erStays: erStayN,
        admissions: los.n,
        discharges: allDischarges.length,
        readmissions: readmissionCount,
      },
    };
  }
}
