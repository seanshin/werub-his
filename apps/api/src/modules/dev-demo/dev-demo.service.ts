import { pacuVitalFlags } from '../pacu/pacu.service';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { BedStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { JourneyService } from '../journey/journey.service';

/**
 * 개발용 데모 데이터 날짜 롤포워드.
 *
 * 목적: 개발/데모 환경에서 예약(appointments)·접수(waiting_queue) 등 환자 세팅이
 *  과거 날짜에 머물러 "오늘" 화면(진료실 대기 관리 등)이 비어 보이는 문제 해소.
 *  매 자정, 각 테이블의 **가장 최근 날짜 배치가 오늘이 되도록** 전체 행을 같은 일수만큼
 *  앞으로 당긴다(시각·상태·상대 간격 보존). 이미 오늘(또는 미래)이면 no-op(멱등).
 *
 * 안전: config `dev.demoDateRoll`(기본 false)로 게이트 — 운영에서는 비활성(불변).
 *  테이블/컬럼은 하드코딩 화이트리스트만(주입 불가). 시프트 일수는 DB가 산정.
 */
@Injectable()
export class DevDemoService {
  private readonly logger = new Logger(DevDemoService.name);

  // 시프트 대상: anchor(기준 컬럼) 의 max 날짜를 오늘로 맞춤. cols 는 anchor 와 같은 offset 으로 함께 이동.
  private static readonly SPECS: {
    table: string; anchor: string; cols: string[]; label: string;
    /**
     * 🔴 **미래가 될 수 없는 컬럼인가.**
     *
     * 롤은 **일 단위**로만 옮긴다. 그래서 원래 시각이 지금보다 늦은 행은 이동 후
     * **오늘의 미래 시각**이 된다 — 접수·호출·진료시작·완료는 *일어난 일*의 시각이라
     * 미래일 수 없다(2026-08-28 실측: `checked_in_at` 17:22 인데 현재 09:36 — 6건).
     * 예약(`scheduled_at`)은 반대로 **미래가 정상**이다. 그래서 표에 성격을 적는다.
     */
    pastOnly: boolean;
    /**
     * 🔴 **매일 오늘 몫을 따로 채우는 작업이 있는 테이블인가**(2026-10-01).
     *
     * 접수 대기열은 9시 크론(`refreshClinicQueue`)이 매일 오늘 몫을 만든다. 그러면 자정마다 "최근 접수일 = 어제"라
     * offset 이 늘 1 이 되어 **전 행을 +1일** 옮겼고, 미래가 된 오늘 아침 행은 다시 하루 되돌려졌다 —
     * 지난 모든 날의 묶음이 **"어제 07:30~09:41"에 영원히 쌓였다**(운영 실측: WAITING 6,631건 · 서로 다른 39일 치 묶음이 9/30 하나에).
     * 이런 테이블은 데이터가 **하루를 넘게** 멈췄을 때(크론이 못 돌았을 때)만 옮긴다 — 지난 날짜는 제 날짜에 남는다.
     */
    dailyRefreshed?: boolean;
  }[] = [
    // 🔴 created_at 도 함께 — 안 옮기면 checkedInAt(오늘)·createdAt(과거) 역전으로
    //    원내 판정 등 createdAt 소비처와 대기열 화면이 어긋난다(2026-08-04 실측)
    { table: 'waiting_queue', anchor: 'checked_in_at', cols: ['checked_in_at', 'called_at', 'started_at', 'completed_at', 'created_at'], label: '접수/대기', pastOnly: true, dailyRefreshed: true },
    { table: 'appointments', anchor: 'scheduled_at', cols: ['scheduled_at'], label: '예약', pastOnly: false },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
    // 여정 발행 정본(@Global) — 데모 방문도 같은 길로 사건을 남긴다(누락 시 사건만 없다 · 방문 생성은 그대로)
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /** config 게이트 — dev.demoDateRoll === true 일 때만 동작 */
  async isEnabled(): Promise<boolean> {
    const v = await this.config.get('dev.demoDateRoll');
    return v === true || v === 'true';
  }

  /**
   * 롤포워드 실행. dryRun=true 면 시프트 일수/대상 건수만 산정(변경 없음).
   * 각 테이블 독립: offset = CURRENT_DATE − max(anchor)::date. offset>0 일 때만 전체 행 이동.
   */
  async rollForward(dryRun = false): Promise<{
    dryRun: boolean;
    today: string;
    tables: { table: string; label: string; rows: number; offsetDays: number; shifted: number; futureFixed: number }[];
  }> {
    const tables: { table: string; label: string; rows: number; offsetDays: number; shifted: number; futureFixed: number }[] = [];

    for (const spec of DevDemoService.SPECS) {
      // offset(일) + 전체 행수 산정 (anchor 의 max 날짜 기준)
      // 🔴 날짜 비교는 KST — DB 세션은 UTC 라 ::date 로 자르면 KST 오전 행(=UTC 전날)이
      //    "어제"로 오판돼 매일 +1d 과잉 시프트된다(2026-08-04 실측: 대기열이 내일로 밀림)
      const stat = await this.prisma.$queryRawUnsafe<{ off: number | null; cnt: number }[]>(
        `SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date - (MAX(${spec.anchor}) AT TIME ZONE 'Asia/Seoul')::date) AS off, COUNT(*)::int AS cnt FROM ${spec.table}`,
      );
      const off = stat?.[0]?.off ?? null;
      const cnt = stat?.[0]?.cnt ?? 0;
      const rawOffset = typeof off === 'number' ? off : 0;
      // 매일 채우는 테이블은 하루 밀림(정상 — 어제 크론 묶음)을 옮기지 않는다 · 하루 넘게 멈췄을 때만
      const offsetDays = spec.dailyRefreshed && rawOffset <= 1 ? 0 : rawOffset;

      let shifted = 0;
      /** 시프트 후 미래가 된 "일어난 일" 행을 되돌린 수 — 0 이 정상이다 */
      let futureFixed = 0;
      if (!dryRun && cnt > 0 && offsetDays > 0) {
        // 전체 행을 offsetDays 만큼 이동 → max(anchor) 가 오늘이 됨. null 컬럼은 null 유지.
        const setClause = spec.cols.map((c) => `${c} = ${c} + make_interval(days => ${offsetDays})`).join(', ');
        shifted = await this.prisma.$executeRawUnsafe(`UPDATE ${spec.table} SET ${setClause}`);

        /**
         * 🔴 **일어난 일이 미래에 있으면 안 된다** (2026-08-28).
         *
         * 일 단위 시프트라 원래 시각이 지금보다 늦은 행은 오늘의 미래가 된다.
         * 그 행만 **하루 더 되돌린다** — 어제의 같은 시각이면 실제로 일어난 일이 되고,
         * 대기열의 시간대 분포도 그대로 남는다.
         * (`now()` 로 잘라 붙이면 여러 행이 같은 시각에 쌓여 순서가 사라진다)
         */
        if (spec.pastOnly) {
          const back = spec.cols.map((c) => `${c} = ${c} - make_interval(days => 1)`).join(', ');
          /**
           * 🔴 미래 판정을 anchor 하나로 하면 안 된다 (2026-09-04 실측 — 감시자 60 적발).
           *    시프트는 5컬럼을 함께 옮기는데 미래 검사가 `checked_in_at` 만 봐서,
           *    접수는 아침(과거)이고 **완료만 오후(미래)** 인 행이 보정을 지나갔다 —
           *    전일 일괄 마감 배치(completed_at 동일 시각) 140건 전부가 그 모양이었고,
           *    감시자 60(미래 시각의 대기열)이 아침마다 1,000건대로 떴다.
           *    옮긴 컬럼 전부를 보고, 하나라도 미래면 그 행을 하루 되돌린다.
           */
          const futureWhere = spec.cols.map((c) => `${c} > now()`).join(' OR ');
          futureFixed = await this.prisma.$executeRawUnsafe(
            `UPDATE ${spec.table} SET ${back} WHERE ${futureWhere}`,
          );
        }
      }

      tables.push({ table: spec.table, label: spec.label, rows: cnt, offsetDays, shifted, futureFixed });
    }

    const today = (await this.prisma.$queryRawUnsafe<{ d: string }[]>(`SELECT CURRENT_DATE::text AS d`))?.[0]?.d ?? '';
    return { dryRun, today, tables };
  }

  // 검사/영상/약국 큐는 날짜가 아닌 status(ORDERED/RECEIVED/IN_PROGRESS) 기준 → 진행중 오더가 없으면 빈 탭.
  private static readonly QUEUE_DEPTS = ['LAB', 'IMAGING', 'PHARMACY'] as const;
  private static readonly OPEN_STATES = ['ORDERED', 'RECEIVED', 'IN_PROGRESS'];
  // 소생 후보 우선순위: 취소(무해) → 완료. 부서별 데이터 한계 시 가능한 만큼만.
  private static readonly REVIVE_FROM = ['CANCELLED', 'COMPLETED'] as const;
  private static readonly QUEUE_TARGET = 6;

  /**
   * 검사/영상/약국 큐를 진행중 오더로 채우고 createdAt 을 오늘로 갱신(대기시간 신선화).
   * 부족분은 기존 오더를 ORDERED 로 소생(취소→완료 순). 새 오더 그래프 생성 없음(안전).
   * dryRun 이면 부서별 현황·소생 예정 건수만 산정.
   */
  async refreshOrderQueues(dryRun = false): Promise<{
    dryRun: boolean;
    queues: { department: string; openBefore: number; revived: number; created: number; total: number; capped: boolean }[];
  }> {
    const target = DevDemoService.QUEUE_TARGET;
    const queues: { department: string; openBefore: number; revived: number; created: number; total: number; capped: boolean }[] = [];

    for (const dept of DevDemoService.QUEUE_DEPTS) {
      const open = await this.prisma.order.findMany({
        where: { department: dept as never, status: { in: DevDemoService.OPEN_STATES as never } },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      const selected = open.map((o) => o.id);
      let revived = 0;

      if (open.length < target) {
        let need = target - open.length;
        const reviveIds: string[] = [];
        for (const st of DevDemoService.REVIVE_FROM) {
          if (need <= 0) break;
          const cand = await this.prisma.order.findMany({
            where: { department: dept as never, status: st as never },
            select: { id: true },
            orderBy: { createdAt: 'desc' },
            take: need,
          });
          reviveIds.push(...cand.map((c) => c.id));
          need -= cand.length;
        }
        revived = reviveIds.length;
        if (!dryRun && reviveIds.length) {
          await this.prisma.order.updateMany({
            where: { id: { in: reviveIds } },
            data: { status: 'ORDERED' as never, receivedAt: null, startedAt: null, completedAt: null, result: undefined },
          });
          selected.push(...reviveIds);
        } else if (dryRun) {
          selected.push(...reviveIds); // 미리보기 total 계산용
        }
      }

      // createdAt 을 오늘 최근 시각으로 스태거(대기 5·13·21…분) — 대기시간 표시 신선화
      if (!dryRun) {
        for (let i = 0; i < selected.length; i++) {
          await this.prisma.order.update({
            where: { id: selected[i] },
            data: { createdAt: new Date(Date.now() - (5 + i * 8) * 60000) },
          });
        }
      }

      // 소생으로도 목표 미달 시: 영상은 소생 가능한 과거 오더가 거의 없어 신규 생성으로 보강.
      let created = 0;
      const stillNeed = target - selected.length;
      if (stillNeed > 0 && dept === 'IMAGING') {
        created = dryRun ? stillNeed : await this.createImagingOrders(stillNeed);
      }

      // createdAt 을 오늘 최근 시각으로 스태거(대기 5·13·21…분) — 기존/소생분만(신규는 생성 시 설정)
      if (!dryRun) {
        for (let i = 0; i < selected.length; i++) {
          await this.prisma.order.update({
            where: { id: selected[i] },
            data: { createdAt: new Date(Date.now() - (5 + i * 8) * 60000) },
          });
        }
      }

      const total = selected.length + created;
      queues.push({ department: dept, openBefore: open.length, revived, created, total, capped: total < target });
    }

    return { dryRun, queues };
  }

  /**
   * 영상 오더 신규 생성(보강) — 소생할 과거 오더가 부족한 영상 전용.
   * 기존 영상 처방 구조 모방: Prescription(type=IMAGING·영상진단료 procedureCode·최근 encounter·DOCTOR) + Order(IMAGING·ORDERED).
   * 멱등 호출 전제(상위가 목표 미달분 need 만 전달). 데이터(encounter·doctor) 부족 시 가능한 만큼만.
   */
  private async createImagingOrders(need: number): Promise<number> {
    const doc = await this.prisma.user.findFirst({ where: { role: 'DOCTOR' as never }, select: { id: true } });
    if (!doc) return 0;
    const encs = await this.prisma.encounter.findMany({ select: { id: true }, orderBy: { createdAt: 'desc' }, take: need });
    if (!encs.length) return 0;
    const procs = await this.prisma.procedureCode.findMany({
      where: { category: '영상진단료', isActive: true },
      select: { id: true },
      take: 20,
    });

    let created = 0;
    for (let i = 0; i < need && i < encs.length; i++) {
      const procedureCodeId = procs.length ? procs[i % procs.length].id : null;
      const rx = await this.prisma.prescription.create({
        data: {
          encounterId: encs[i].id,
          type: 'IMAGING' as never,
          procedureCodeId,
          createdBy: doc.id,
          priority: 'ROUTINE',
          source: 'MANUAL',
        },
        select: { id: true },
      });
      await this.prisma.order.create({
        data: {
          prescriptionId: rx.id,
          department: 'IMAGING' as never,
          status: 'ORDERED' as never,
          createdAt: new Date(Date.now() - (5 + i * 8) * 60000),
        },
      });
      created++;
    }
    return created;
  }

  /** 날짜 롤포워드 + 큐 리프레시 일괄 (cron·수동 공용) */
  // 진단검사 보드 데모 행(seed-diagnostics-board-demo.ts와 동일 uid)의 시간 필드를 현재 기준으로 리프레시.
  // 상대 시간 시드라 시간이 지나면 오래돼 보이는 문제 해소. 데모 행만 대상(결정적 uid).
  private dxUid(key: string): string {
    const h = createHash('md5').update(`dxb-demo:${key}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }

  async refreshDiagnosticsDemo(dryRun = false): Promise<number> {
    const min = (m: number) => new Date(Date.now() - m * 60 * 1000);
    // key → 갱신할 시간 필드(시드의 상대 오프셋과 일치)
    const rows: { key: string; data: Record<string, Date> }[] = [
      { key: 'tat1', data: { createdAt: min(95), performedAt: min(20) } },
      { key: 'tat2', data: { createdAt: min(130) } },
      { key: 'crit1', data: { createdAt: min(30), reportedAt: min(15) } },
      { key: 'crit2', data: { createdAt: min(60), reportedAt: min(40) } },
      { key: 'delta1', data: { createdAt: min(50), reportedAt: min(30) } },
      { key: 'rev1', data: { createdAt: min(35), reportedAt: min(20) } },
      { key: 'q1', data: { createdAt: min(30), scheduledAt: min(-60) } },
      { key: 'q2', data: { createdAt: min(10) } },
      { key: 'trend1', data: { createdAt: min(2900), reportedAt: min(2880) } },
      { key: 'trend2', data: { createdAt: min(75), reportedAt: min(60) } },
    ];
    if (dryRun) return rows.length;
    let n = 0;
    for (const r of rows) {
      const res = await this.prisma.diagnosticTest.updateMany({ where: { id: this.dxUid(r.key) }, data: r.data });
      n += res.count;
    }
    return n;
  }

  /**
   * 진료실 대기(/clinic-queue) 당일 배치 — 과별 목표 5~20명(날짜·과 결정적 난수)으로 맞춘다(2026-08-04).
   *  - 매일 09시(KST) 배치 — 그 전엔 무동작(자정 롤포워드 직후 00시 접수 같은 어색한 시각 방지)
   *  - 신환/재환 혼합: 과·날짜별 신환 비율 25~55% 변동
   *  - 목표 초과분(롤포워드로 넘어온 전일분)은 오래된 순 완료 마감 — 축적 방지
   * 🔴 rollForward 는 대기열을 하루를 넘게 멈췄을 때만 옮긴다(dailyRefreshed) · 지난 날짜 데모 대기는 이 배치가 마감 — 반드시 목표치 수렴 방식.
   * 멱등키=waitingToken(dcq-YYYYMMDD-과-슬롯)·목표/비율은 같은 날 항상 같아 재실행 안전.
   */
  async refreshClinicQueue(dryRun = false): Promise<{ created: number; depts: number; closedStale?: number }> {
    const EXCLUDE = ['영상의학과(판독)', '영상의학과', '건강검진센터(의사)'];
    const REASONS = ['정기 진료', '감기 증상', '복통', '두통·어지럼', '검사결과 상담', '재처방', '피부 발진', '관절 통증', '건강 상담', '어제부터 발열'];
    const now = new Date();
    // KST 기준 하루 — 컨테이너 OS=UTC(UTC 자정=KST 09시)라 UTC 로 자르면 9시 이전 접수가 전날로 밀린다
    const kst = new Date(now.getTime() + 9 * 3600_000);
    const dateKey = kst.toISOString().slice(0, 10).replace(/-/g, '');
    const todayStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000);
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
    // '오늘' 창은 상·하한 모두 — 상한 없이는 (과잉 시프트 등으로) 미래에 놓인 행이 오늘 대기로 세진다
    const todayWindow = { gte: todayStart, lt: tomorrowStart };
    if (kst.getUTCHours() < 9) return { created: 0, depts: 0 };

    // 결정적 난수 — 같은 날·같은 과는 항상 같은 목표(재실행 멱등)
    const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

    const doctors = await this.prisma.user.findMany({
      where: { role: 'DOCTOR', isActive: true, department: { notIn: EXCLUDE } },
      select: { id: true, department: true },
    });
    const byDept = new Map<string, string[]>();
    for (const d of doctors) {
      if (!d.department) continue;
      byDept.set(d.department, [...(byDept.get(d.department) ?? []), d.id]);
    }
    const patients = await this.prisma.patient.findMany({ select: { id: true }, take: 500, orderBy: { createdAt: 'asc' } });
    if (!byDept.size || patients.length < 20) return { created: 0, depts: 0 };

    /**
     * 🔴 (2026-10-01) 지난 날짜의 데모 접수가 대기·호출 상태로 남아 있으면 마감한다 — 종전엔 **오늘 창의 초과분만** 마감해,
     *    날짜 롤과 맞물려 어제에 쌓인 데모 묶음 6,631건이 영원히 '대기'였다(접수 화면·지표에 섞였다).
     *    데모 생성분(토큰 `dcq-`)만 — 사람이 만든 접수는 건드리지 않는다. 진료를 받지 않았으므로 완료가 아니라 취소(위 W8 규약).
     */
    let closedStale = 0;
    if (!dryRun) {
      const r = await this.prisma.waitingQueue.updateMany({
        where: { waitingToken: { startsWith: 'dcq-' }, status: { in: ['WAITING', 'CALLED'] }, checkedInAt: { lt: todayStart } },
        data: { status: 'CANCELLED', completedAt: now, reason: '[데모 롤포워드] 전일 미진료 마감 — 진료 실적으로 세지 않음' },
      });
      closedStale = r.count;
    }

    /**
     * (2026-10-01) 진료실 — 실제 접수(`waiting-queue.service` create)와 같은 규칙으로 의사의 진료 일정에서 고른다(KST 요일·오전/오후·ALL).
     * 🔴 종전 데모 대기는 진료실을 비워 두어, 통합 상황판 3D 가 오늘 대기 260건을 전부 "진료실 미지정"으로 그렸다.
     *    일정이 없는 의사는 그대로 비운다(진료실을 지어내지 않는다). 기존 행은 고치지 않는다.
     */
    const dow = kst.getUTCDay();
    const period = kst.getUTCHours() < 13 ? 'AM' : 'PM';
    const schedules = await this.prisma.clinicSchedule.findMany({
      where: { dayOfWeek: dow, isActive: true, OR: [{ period }, { period: 'ALL' }] },
      select: { doctorId: true, roomName: true, period: true },
    });
    const roomOf = new Map<string, string>();
    // 정확한 오전/오후가 ALL 보다 먼저(실제 접수의 findFirst 와 같은 결과가 되게 — 둘 다 있으면 시간대 일정)
    for (const sc of schedules.sort((a, b) => (a.period === 'ALL' ? 1 : 0) - (b.period === 'ALL' ? 1 : 0))) {
      if (!roomOf.has(sc.doctorId) && sc.roomName) roomOf.set(sc.doctorId, sc.roomName);
    }

    let created = 0;
    let pi = hash(dateKey) % patients.length; // 배정 시작점도 날마다 회전 — 매일 같은 환자만 돌지 않게
    for (const [dept, docIds] of [...byDept.entries()].sort()) {
      const target = 5 + (hash(`${dateKey}:${dept}`) % 16); // 5~20명
      const initialPct = 25 + (hash(`${dateKey}:${dept}:ratio`) % 31); // 신환 25~55%

      const waitingRows = await this.prisma.waitingQueue.findMany({
        where: { departmentName: dept, status: 'WAITING', checkedInAt: todayWindow },
        orderBy: { checkedInAt: 'asc' },
        select: { id: true },
      });
      // 목표 초과분 — 오래된 순으로 마감(롤포워드 전일분 축적 방지)
      //
      // 🔴 종전에는 `status:'COMPLETED'` 로 찍었다 — 화면 실사용 점검 W8(2026-08-14).
      //    호출도 진료 시작도 Encounter 생성도 건너뛴 채 "완료"만 기록한 것이다(**P16**).
      //    실측 결과 COMPLETED 462건 중 **456건이 called_at·started_at·encounter_id 전부 NULL** 이었고,
      //    completed_at 이 분 단위 네 버킷(09:00 에 241건 등)에 몰려 있었으며
      //    **그 456건 중 같은 날 encounter 가 있는 것은 0건**이었다 — 진료받은 적 없는 사람들이다.
      //    그 결과 ① "오늘 완료 462건" 이라는 처리량 실적이 허구가 되고
      //          ② 대기시간 지표의 분모가 오염돼 표본 13건이 462건에 묻혔다.
      //
      //    이 사람들은 접수만 하고 **진료를 받지 않았다.** 그러면 완료가 아니라 취소다.
      //    (CANCELLED 는 이 저장소 집계 규약상 대기에도 완료에도 세지 않는다 — 정확히 이 경우를 위한 상태다.
      //     NO_SHOW 는 '오지 않았다'는 뜻이라 접수 기록이 있는 이들에게는 틀린 말이다.)
      if (waitingRows.length > target && !dryRun) {
        const excess = waitingRows.slice(0, waitingRows.length - target).map((r) => r.id);
        await this.prisma.waitingQueue.updateMany({
          where: { id: { in: excess } },
          data: {
            status: 'CANCELLED',
            completedAt: now,
            reason: '[데모 롤포워드] 진료 없이 마감 — 진료 실적으로 세지 않음',
          },
        });
      }
      const need = target - waitingRows.length;
      if (need <= 0) continue;
      if (dryRun) { created += need; continue; }

      const agg = await this.prisma.waitingQueue.aggregate({
        where: { departmentName: dept, checkedInAt: todayWindow },
        _max: { queueNumber: true },
      });
      let seq = (agg._max.queueNumber ?? 0) + 1;
      let made = 0;
      for (let slot = 0; slot < 60 && made < need; slot++) {
        const token = `dcq-${dateKey}-${dept}-${slot}`;
        const exists = await this.prisma.waitingQueue.findUnique({ where: { waitingToken: token }, select: { id: true } });
        if (exists) continue;
        // 접수 시각: 최근 90분 안에 순서대로 분산(오늘 KST 이전으로는 내려가지 않게)
        const backMin = Math.round(((need - made) * 90) / Math.max(need, 1));
        await this.prisma.waitingQueue.create({
          data: {
            patientId: patients[pi++ % patients.length].id,
            doctorId: docIds[slot % docIds.length],
            roomName: roomOf.get(docIds[slot % docIds.length]) ?? null,
            departmentName: dept,
            queueNumber: seq++,
            type: slot % 3 === 0 ? 'APPOINTMENT' : 'WALK_IN',
            visitType: hash(`${dateKey}:${dept}:${slot}`) % 100 < initialPct ? 'INITIAL' : 'FOLLOW_UP',
            reason: REASONS[slot % REASONS.length],
            status: 'WAITING',
            waitingToken: token,
            checkedInAt: new Date(Math.max(todayStart.getTime(), now.getTime() - backMin * 60_000)),
          },
        });
        made++;
      }
      created += made;
    }
    return { created, depts: byDept.size, closedStale };
  }

  /**
   * 접수 예약(/reception) 당일 목표치 보충(top-up) — 오늘 SCHEDULED/CONFIRMED가 20건 미만이면 부족분만 생성.
   * 시프트된 전일분과 합산해 목표치 유지(축적 방지). 멱등키=결정적 id(a0000000-…-{YYYYMMDD}00{NN}).
   */
  async refreshReceptionAppointments(dryRun = false): Promise<number> {
    const TOTAL = 20;
    const EXCLUDE = ['영상의학과(판독)', '건강검진센터(의사)'];
    const REASONS = ['정기 외래', '재진 상담', '검사결과 확인', '만성질환 관리', '수술 후 경과', '초진 상담', '예방접종 상담', '통증 재평가'];
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');
    const todayStart = new Date(now.toISOString().slice(0, 10));
    const tomorrowStart = new Date(todayStart.getTime() + 86400_000);

    const existing = await this.prisma.appointment.count({
      where: { scheduledAt: { gte: todayStart, lt: tomorrowStart }, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
    });
    const need = TOTAL - existing;
    if (need <= 0) return 0;
    if (dryRun) return need;

    const doctors = await this.prisma.user.findMany({
      where: { role: 'DOCTOR', isActive: true, department: { notIn: EXCLUDE, not: null } },
      select: { id: true, department: true },
      orderBy: { email: 'asc' },
    });
    const patients = await this.prisma.patient.findMany({ select: { id: true }, skip: 300, take: 100, orderBy: { createdAt: 'asc' } });
    if (!doctors.length || patients.length < TOTAL) return 0;

    const base = new Date(now); base.setHours(9, 0, 0, 0);
    let created = 0;
    for (let i = 0; i < TOTAL && created < need; i++) {
      const id = `a0000000-0000-4000-9000-${dateKey}00${String(i).padStart(2, '0')}`;
      const dup = await this.prisma.appointment.findUnique({ where: { id }, select: { id: true } });
      if (dup) continue;
      const doctor = doctors[i % doctors.length];
      const scheduledAt = new Date(base.getTime() + i * 30 * 60_000);
      const confirmed = i % 3 === 0;
      await this.prisma.appointment.create({
        data: {
          id, patientId: patients[i].id, doctorId: doctor.id, scheduledAt, duration: 30,
          status: confirmed ? 'CONFIRMED' : 'SCHEDULED',
          type: i % 2 === 0 ? 'FOLLOW_UP' : 'INITIAL',
          reason: REASONS[i % REASONS.length],
          departmentName: doctor.department,
          slotPeriod: scheduledAt.getHours() < 12 ? 'AM' : 'PM',
          bookedVia: i % 4 === 0 ? 'PORTAL' : 'STAFF',
          ...(confirmed ? { confirmedAt: new Date(scheduledAt.getTime() - 86400_000) } : {}),
        },
      });
      created++;
    }
    return created;
  }

  async refreshAll(dryRun = false) {
    const dates = await this.rollForward(dryRun);
    const orders = await this.refreshOrderQueues(dryRun);
    const dxRefreshed = await this.refreshDiagnosticsDemo(dryRun);
    // 🔴 (2026-10-01 .catch 비리터럴 판정) 종전엔 실패를 `{ created: 0 }`·`0` 으로 접어 "아무것도 만들 게 없었다"로 응답했다.
    //    한 갈래가 실패해도 나머지는 돌리되, 실패는 실패로 말한다.
    const failedPart = (e: unknown) => ({ failed: true as const, error: e instanceof Error ? e.message : String(e) });
    const clinicQueue = await this.refreshClinicQueue(dryRun).catch(failedPart);
    const receptionAppts = await this.refreshReceptionAppointments(dryRun).catch(failedPart);
    const surgeries = await this.refreshSurgeries(dryRun).catch(failedPart);
    const emergency = await this.refreshEmergency(dryRun).catch(failedPart);
    const pacu = await this.refreshPacu(dryRun).catch(failedPart);
    return { dryRun, today: dates.today, dates: dates.tables, queues: orders.queues, diagnosticsDemo: dxRefreshed, clinicQueue, receptionAppts, surgeries, emergency, pacu };
  }

  /**
   * 응급실 재실 신선화(2026-08-04) — /emergency 가 "현재 0명" 죽은 화면이 되지 않게.
   * 🔴 처분 완료된 방문은 임상 기록이라 불변.
   *  1) 어제 이전 도착인데 미처분인 방문 → 퇴원 마감(도착+4h) — 하루 넘는 재실은 비현실(축적 방지)
   *  2) 오늘 재실이 목표(4~7건·날짜 결정적)에 못 미치면 생성 — KTAS·상태 분포, 도착은 최근 4시간 분산,
   *     멱등키=결정적 id(ee000000-0000-4000-a000-{YYYYMMDD}00{NN})
   */
  async refreshEmergency(dryRun = false): Promise<{ closed: number; created: number }> {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600_000);
    const dateKey = kst.toISOString().slice(0, 10).replace(/-/g, '');
    const todayStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000);

    const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
    const target = 4 + (hash(`${dateKey}:er`) % 4); // 4~7건

    // 1) 묵은 재실 마감 — 퇴원 처분(도착+4h)
    const stale = await this.prisma.emergencyVisit.findMany({
      where: { disposition: null, arrivalAt: { lt: todayStart } },
      select: { id: true, arrivalAt: true },
    });
    let closed = 0;
    if (dryRun) {
      closed = stale.length;
    } else {
      for (const v of stale) {
        // 🔴 마감은 **병상 반납까지**다 — 종전엔 방문만 COMPLETED 로 바꾸고 베드 배정을 그대로 둬서
        //    `emergency_bed_assignments.released_at` 이 NULL 로 남고 병상이 **영구 OCCUPIED** 가 됐다
        //    (2026-08-10 실측 2건·응급 GEN-1/ACUTE-1). ER 축의 "결정≠퇴실" 함정이 데모 경로에서 재현된 것.
        //    자동 해제 경로(er-bed.service)에 데모 마감이 빠져 있었다.
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
          await tx.emergencyVisit.update({
            where: { id: v.id },
            data: { disposition: 'DISCHARGE', dispositionAt: new Date(v.arrivalAt.getTime() + 4 * 3600_000), status: 'COMPLETED' },
          });
          const open = await tx.emergencyBedAssignment.findMany({
            where: { visitId: v.id, releasedAt: null },
            select: { id: true, bedId: true },
          });
          if (open.length) {
            await tx.emergencyBedAssignment.updateMany({
              where: { id: { in: open.map((o) => o.id) } },
              data: { releasedAt: now, releaseReason: 'DEMO_CLOSE' },
            });
            await tx.bed.updateMany({
              where: { id: { in: open.map((o) => o.bedId) }, status: BedStatus.OCCUPIED },
              data: { status: BedStatus.AVAILABLE },
            });
          }
        });
        closed++;
      }
    }

    // 2) 오늘 재실 부족분 생성
    const active = await this.prisma.emergencyVisit.count({ where: { disposition: null } });
    const need = target - active;
    if (need <= 0) return { closed, created: 0 };
    if (dryRun) return { closed, created: need };

    // KTAS·상태·주증상 분포 — 소생(1)은 드물게, 3~4가 다수(실제 ER 분포 근사)
    const CASES: { level: string; status: string; cc: string; vitals?: Record<string, number> }[] = [
      { level: 'LEVEL_2', status: 'IN_TREATMENT', cc: '흉통 — 발한 동반, NRS 7/10', vitals: { sbp: 148, dbp: 92, hr: 104, rr: 20, bt: 36.8, spo2: 95 } },
      { level: 'LEVEL_3', status: 'PENDING_RESULT', cc: '급성 복통(RLQ) — 발열 38.1°C, 오심', vitals: { sbp: 128, dbp: 82, hr: 96, rr: 18, bt: 38.1, spo2: 98 } },
      { level: 'LEVEL_3', status: 'PENDING_DOCTOR', cc: '고열(39.2°C) — 오한, 근육통', vitals: { sbp: 118, dbp: 76, hr: 102, rr: 18, bt: 39.2, spo2: 97 } },
      { level: 'LEVEL_4', status: 'TRIAGED', cc: '발목 염좌 — 부종, 보행 시 통증', vitals: { sbp: 122, dbp: 78, hr: 84, rr: 16, bt: 36.6, spo2: 99 } },
      { level: 'LEVEL_3', status: 'UNDER_OBSERVATION', cc: '어지럼·구토 — 수액 처치 후 관찰 중', vitals: { sbp: 108, dbp: 70, hr: 88, rr: 16, bt: 36.9, spo2: 98 } },
      { level: 'LEVEL_4', status: 'PENDING_TRIAGE', cc: '두통 — 3일 지속, OTC 진통제 무효' },
      { level: 'LEVEL_2', status: 'PENDING_DISPOSITION', cc: '호흡곤란 — 천식 병력, 청진상 천명', vitals: { sbp: 132, dbp: 84, hr: 108, rr: 24, bt: 37.0, spo2: 93 } },
      { level: 'LEVEL_5', status: 'TRIAGED', cc: '경미한 찰과상 — 소독 요망' },
    ];
    const erDoctors = await this.prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true, department: '응급의학과' }, select: { id: true } });
    const anyDoctors = erDoctors.length ? erDoctors : await this.prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true }, select: { id: true }, take: 5 });
    const nurses = await this.prisma.user.findMany({ where: { role: 'NURSE', isActive: true }, select: { id: true }, take: 5 });
    const patients = await this.prisma.patient.findMany({ select: { id: true }, take: 300, orderBy: { createdAt: 'desc' } });
    if (!patients.length || !anyDoctors.length) return { closed, created: 0 };

    let created = 0;
    for (let slot = 0; slot < target * 3 && created < need; slot++) {
      const id = `ee000000-0000-4000-a000-${dateKey}00${String(slot + 1).padStart(2, '0')}`;
      const exists = await this.prisma.emergencyVisit.findUnique({ where: { id }, select: { id: true } });
      if (exists) continue;
      const c = CASES[hash(`${dateKey}:${slot}:er`) % CASES.length];
      const arrivalAt = new Date(now.getTime() - (30 + (hash(`${dateKey}:${slot}:arr`) % 210)) * 60_000); // 최근 30분~4시간
      const triaged = c.status !== 'PENDING_TRIAGE';
      const visit = await this.prisma.emergencyVisit.create({
        data: {
          id,
          patientId: patients[(hash(dateKey) + slot * 11) % patients.length].id,
          doctorId: ['IN_TREATMENT', 'PENDING_RESULT', 'UNDER_OBSERVATION', 'PENDING_DISPOSITION'].includes(c.status)
            ? anyDoctors[slot % anyDoctors.length].id : null,
          arrivalAt,
          triageLevel: c.level as never,
          chiefComplaint: c.cc,
          status: c.status,
          isNonEmergency: c.level === 'LEVEL_5',
          triageNurseId: triaged && nurses.length ? nurses[slot % nurses.length].id : null,
          triagedAt: triaged ? new Date(arrivalAt.getTime() + 10 * 60_000) : null,
          vitalSigns: c.vitals ?? undefined,
          treatmentStartedAt: c.status === 'IN_TREATMENT' ? new Date(arrivalAt.getTime() + 30 * 60_000) : null,
        },
      });
      // 🔴 (여정 P2 2026-10-01) 종전엔 방문 상태(도착·분류·진료 시작 시각)만 쓰고 여정 사건은 하나도 남기지 않았다 —
      //    감시자 79(상태–사건 대조)가 운영에서 센 21건이 전부 이 생성기 행이었다. 데이터를 고치지 않고 생성기를 고친다:
      //    정본 발행기로, 출처 DEMO·위치 SIMULATED 로 같은 사건을 남긴다.
      this.emitDemoErJourney(visit);
      created++;
    }
    return { closed, created };
  }

  /** 데모 응급 방문의 여정 사건 — 원장 시각을 그대로(도착·분류·진료 시작) · 출처 DEMO · 위치는 시뮬레이션 */
  private emitDemoErJourney(visit: { id: string; patientId: string; arrivalAt: Date; triagedAt: Date | null; treatmentStartedAt: Date | null }) {
    // 귀속(refType·refId)은 발행마다 적는다 — 구조 가드가 발행 블록 안에서 귀속을 확인한다
    const base = { patientId: visit.patientId, department: '응급의학과', dataOrigin: 'DEMO' as const, metadata: { simulated: true } };
    this.journey?.emit({ ...base, eventType: 'ER_ARRIVAL', refType: 'EmergencyVisit', refId: visit.id, title: '응급실 도착', occurredAt: visit.arrivalAt });
    if (visit.triagedAt) {
      this.journey?.emit({ ...base, eventType: 'ER_TRIAGE', refType: 'EmergencyVisit', refId: visit.id, title: '트리아지 완료', occurredAt: visit.triagedAt });
    }
    if (visit.treatmentStartedAt) {
      this.journey?.emit({ ...base, eventType: 'ER_TREATMENT_START', refType: 'EmergencyVisit', refId: visit.id, title: '응급 처치 시작', occurredAt: visit.treatmentStartedAt });
    }
  }

  /**
   * 수술 일정 신선화(2026-08-04 요청) — 예정 수술이 매일 오늘 보이게.
   * 🔴 완료/진행 수술은 임상 기록이라 절대 이동하지 않는다 — **SCHEDULED 만** 다룬다.
   *  1) 어제 이전에 남은 예정 수술 → 오늘 같은 시각으로 이동(연결 or_schedules date 동행)
   *  2) 오늘 예정이 목표(2~4건·날짜 결정적 난수)에 못 미치면 데모 수술 생성
   *     — 멱등키=결정적 id(dd000000-0000-4000-a000-{YYYYMMDD}00{NN}) · 수술방 라운드로빈 배정
   */
  async refreshSurgeries(dryRun = false): Promise<{ moved: number; created: number }> {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600_000);
    const dateKey = kst.toISOString().slice(0, 10).replace(/-/g, '');
    const todayStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000);
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
    const todayDateCol = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())); // @db.Date=UTC 자정 표현

    const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
    const target = 2 + (hash(`${dateKey}:surgery`) % 3); // 2~4건

    // 1) 묵은 예정 → 오늘로(하루 안의 시각 보존)
    const stale = await this.prisma.surgery.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lt: todayStart } },
      select: { id: true, scheduledAt: true },
    });
    let moved = 0;
    if (dryRun) {
      moved = stale.length;
    } else {
      for (const s of stale) {
        const tKst = new Date(s.scheduledAt.getTime() + 9 * 3600_000);
        const msIntoDay = (tKst.getUTCHours() * 3600 + tKst.getUTCMinutes() * 60) * 1000;
        await this.prisma.surgery.update({ where: { id: s.id }, data: { scheduledAt: new Date(todayStart.getTime() + msIntoDay) } });
        await this.prisma.orSchedule.updateMany({ where: { surgeryId: s.id, status: 'SCHEDULED' }, data: { date: todayDateCol } });
        moved++;
      }
    }

    // 2) 오늘 예정 부족분 생성
    const todayCount = await this.prisma.surgery.count({
      where: { status: 'SCHEDULED', scheduledAt: { gte: todayStart, lt: tomorrowStart } },
    });
    const need = target - todayCount;
    if (need <= 0) return { moved, created: 0 };
    if (dryRun) return { moved, created: need };

    const PROCEDURES = [
      { name: '복강경 담낭절제술', dept: '외과', anesthesia: 'GENERAL' },
      { name: '슬관절 관절경 수술', dept: '정형외과', anesthesia: 'SPINAL' },
      { name: '탈장 복원술(서혜부)', dept: '외과', anesthesia: 'GENERAL' },
      { name: '요추 추간판 절제술', dept: '신경외과', anesthesia: 'GENERAL' },
      { name: '백내장 수정체 치환술', dept: '안과', anesthesia: 'LOCAL' },
      { name: '갑상선 절제술', dept: '외과', anesthesia: 'GENERAL' },
    ];
    const doctors = await this.prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true }, select: { id: true, department: true } });
    const patients = await this.prisma.patient.findMany({ select: { id: true }, take: 200, orderBy: { createdAt: 'asc' } });
    const rooms = await this.prisma.operatingRoom.findMany({ where: { isActive: true, name: { startsWith: 'OR-' } }, orderBy: { name: 'asc' } });
    if (!doctors.length || !patients.length) return { moved, created: 0 };

    let created = 0;
    for (let slot = 0; slot < target * 3 && created < need; slot++) {
      const id = `dd000000-0000-4000-a000-${dateKey}00${String(slot + 1).padStart(2, '0')}`;
      const exists = await this.prisma.surgery.findUnique({ where: { id }, select: { id: true } });
      if (exists) continue; // 당일 이미 생성(시작·완료로 소비됐어도 재생성하지 않음)
      const proc = PROCEDURES[hash(`${dateKey}:${slot}:proc`) % PROCEDURES.length];
      const surgeon = doctors.find((d) => d.department === proc.dept) ?? doctors[hash(`${dateKey}:${slot}:doc`) % doctors.length];
      const pat = patients[(hash(dateKey) + slot * 7) % patients.length];
      const startHour = 9 + (slot % 5) * 2; // 09·11·13·15·17시
      await this.prisma.surgery.create({
        data: {
          id, patientId: pat.id, surgeonId: surgeon.id,
          scheduledAt: new Date(todayStart.getTime() + startHour * 3600_000),
          procedureName: proc.name, status: 'SCHEDULED', anesthesiaType: proc.anesthesia,
        },
      });
      if (rooms.length) {
        await this.prisma.orSchedule.create({
          data: {
            roomId: rooms[slot % rooms.length].id, surgeryId: id, date: todayDateCol,
            startTime: `${String(startHour).padStart(2, '0')}:00`,
            endTime: `${String(startHour + 2).padStart(2, '0')}:00`,
            estimatedDuration: 120, status: 'SCHEDULED',
          },
        });
      }
      created++;
    }
    return { moved, created };
  }

  /**
   * 회복실 데모 신선화(2026-10-07) — /pacu 가 "재실 0명" 죽은 화면이 되지 않게(운영 실측: 기록 6건 전부 5~7월·재실 0).
   * 🔴 데모 전용 결정적 id 만 만든다/닫는다(dd2…=수술 · dd3…=회복실) — 사람 기록·다른 시드는 건드리지 않는다.
   *  1) 지난 날 열린 데모 회복실 기록 → 입실+2시간으로 마감(사유 "데모 정리" · 여러 날째 재실로 보이지 않게)
   *  2) 오늘 시나리오 6(재실 4·퇴실 2) + 입실 대기 1 — 실행 시각 기준 상대 시각 · 이미 있으면 건너뜀(멱등)
   *  · 마취기록(ETT·역전제·EBL·수액)·점수 이력·통증·I/O·간호기록·지연 사유·마취과 확인을 시나리오마다 다르게 — 화면에서 각 기능을 확인할 수 있게
   *  · 활력 이상 판정은 회복실 정본(`pacuVitalFlags`)으로
   */
  async refreshPacu(dryRun = false): Promise<{ closed: number; created: number; skipped: number }> {
    const now = Date.now();
    const kst = new Date(now + 9 * 3600_000);
    const dateKey = kst.toISOString().slice(0, 10).replace(/-/g, '');
    const todayStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000);
    const at = (minAgo: number) => new Date(now - minAgo * 60_000);
    const iso = (minAgo: number) => at(minAgo).toISOString();

    const closed = dryRun ? 0 : await this.prisma.$executeRaw`
      UPDATE pacu_records SET discharge_time = arrival_time + interval '2 hours', disposition = COALESCE(disposition, 'WARD'),
        discharge_override = '데모 정리 — 지난 날 데모 재실 기록 마감'
      WHERE discharge_time IS NULL AND id::text LIKE 'dd300000-%' AND arrival_time < ${todayStart}`;

    // 밤(KST 07시 전 · 자정 롤)에는 만들지 않는다 — "N분 전" 상대 시각이 전날로 넘어가 오늘 화면에 안 보이고 다음 정리에 닫힌다
    if (kst.getUTCHours() < 7) return { closed: Number(closed), created: 0, skipped: 0 };
    const doctors = await this.prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 5 });
    const nurse = await this.prisma.user.findFirst({ where: { role: 'NURSE', isActive: true }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    const patients = await this.prisma.patient.findMany({ select: { id: true }, take: 300, orderBy: { createdAt: 'asc' } });
    if (!doctors.length || !nurse || patients.length < 7) return { closed: Number(closed), created: 0, skipped: 0 };
    const surgeon = doctors[0].id;
    const anesth = doctors[doctors.length - 1].id;
    const hash = (x: string) => { let h = 0; for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) >>> 0; return h; };
    const sid = (n: number) => `dd200000-0000-4000-a000-${dateKey}00${String(n).padStart(2, '0')}`;
    const pid = (n: number) => `dd300000-0000-4000-a000-${dateKey}00${String(n).padStart(2, '0')}`;
    const vit = (minAgo: number, v: { bp: string; hr: number; rr: number; spo2: number; temp?: number; consciousness?: string; rass?: number }) => {
      const flags = pacuVitalFlags(v);
      return { time: iso(minAgo), ...v, abnormal: flags.length > 0, flags, by: nurse.id };
    };
    const ald = (s: number) => {
      // 총점과 세부의 합이 같게(서버 검증 규칙) — 6항목에 2점씩 채우고 남은 감점을 앞 항목부터
      const keys = ['activity', 'respiration', 'circulation', 'consciousness', 'spo2', 'pain'];
      let lack = 12 - s; const d: Record<string, number> = {};
      for (const k of keys) { const minus = Math.min(2, lack); d[k] = 2 - minus; lack -= minus; }
      return d;
    };
    const padss = (s: number) => {
      const keys = ['vitalSigns', 'ambulation', 'nausea', 'pain', 'bleeding'];
      let lack = 10 - s; const d: Record<string, number> = {};
      for (const k of keys) { const minus = Math.min(2, lack); d[k] = 2 - minus; lack -= minus; }
      return d;
    };
    const score = (kind: string, sc: number, phase: string, minAgo: number, detail: Record<string, number> | null = null) => ({ kind, score: sc, detail, phase, at: iso(minAgo), by: nurse.id });

    type Case = {
      n: number; proc: string; anes: string; endedMin: number; pacu?: Record<string, unknown> & { arrivalMin: number; dischargeMin?: number };
      anesthesia?: Record<string, unknown>;
    };
    const cases: Case[] = [
      { n: 1, proc: '복강경 담낭절제술', anes: 'GENERAL', endedMin: 15,
        anesthesia: { asaClass: 'II', airwayType: 'ETT', ettSize: '7.0', extubationMin: 12, reversal: [{ drug: 'Sugammadex', dose: '200 mg' }], analgesics: [{ drug: 'Fentanyl', dose: '100 mcg' }], fluidInput: [{ type: 'Hartmann', ml: 800 }], ebl: 150, urineOutput: 200 },
        pacu: { arrivalMin: 10, vitals: [vit(9, { bp: '138/82', hr: 92, rr: 14, spo2: 96, temp: 36.1, consciousness: '졸림', rass: -2 })],
          history: [score('ALDRETE', 7, 'ADMIT', 8, ald(7))], aldrete: 7, oxygen: 'Simple mask 6L', bay: 'B1',
          handoff: { situation: '복강경 담낭절제술 후 전신마취 발관 직후', background: '고혈압 · 수술 중 특이 없음', assessment: '각성 중 RASS -2', recommendation: '산소 유지 · 15분 간격 활력' } } },
      { n: 2, proc: '슬관절 관절경 수술', anes: 'SPINAL', endedMin: 50,
        anesthesia: { asaClass: 'I', airwayType: null, analgesics: [{ drug: 'Bupivacaine(척추)', dose: '12 mg' }], fluidInput: [{ type: 'NS', ml: 500 }], ebl: 30 },
        pacu: { arrivalMin: 45, vitals: [vit(44, { bp: '122/76', hr: 78, rr: 16, spo2: 98, temp: 36.4, consciousness: '명료', rass: 0 }), vit(30, { bp: '118/72', hr: 74, rr: 14, spo2: 98, temp: 36.5, rass: 0 }), vit(15, { bp: '120/74', hr: 72, rr: 14, spo2: 99, temp: 36.6, rass: 0 })],
          history: [score('ALDRETE', 9, 'ADMIT', 43, ald(9)), score('PONV', 1, 'ADMIT', 40), score('ALDRETE', 11, 'INTERVAL', 15, ald(11)), score('PONV', 0, 'INTERVAL', 15)], aldrete: 11, ponv: 0,
          pain: [{ score: 6, scale: 'NRS', intervention: 'Ketorolac 30 mg IV', time: iso(40), by: nurse.id }, { score: 3, scale: 'NRS', intervention: '재평가', time: iso(10), by: nurse.id }], painScore: 3,
          io: [{ kind: 'IN', route: 'IV', ml: 200, note: 'NS', at: iso(30), by: nurse.id }, { kind: 'OUT', route: 'URINE', ml: 150, note: null, at: iso(12), by: nurse.id }], bay: 'B2' } },
      { n: 3, proc: '위 아전절제술', anes: 'GENERAL', endedMin: 75,
        anesthesia: { asaClass: 'III', airwayType: 'ETT', ettSize: '7.5', extubationMin: 72, reversal: [{ drug: 'Neostigmine + Glycopyrrolate', dose: '2 mg / 0.4 mg' }], fluidInput: [{ type: 'Hartmann', ml: 1800 }], bloodProducts: [{ type: 'RBC', units: 1 }], ebl: 450, urineOutput: 350 },
        pacu: { arrivalMin: 70, vitals: [vit(69, { bp: '108/64', hr: 104, rr: 20, spo2: 91, temp: 35.4, consciousness: '혼미', rass: -3 }), vit(50, { bp: '112/68', hr: 98, rr: 18, spo2: 94, temp: 35.8, rass: -1 }), vit(25, { bp: '118/70', hr: 90, rr: 16, spo2: 96, temp: 36.2, rass: 0 })],
          history: [score('ALDRETE', 6, 'ADMIT', 68, ald(6)), score('ALDRETE', 9, 'INTERVAL', 25, ald(9))], aldrete: 9,
          complications: [{ type: 'DESATURATION', severity: 'MODERATE', intervention: '턱 들기·산소 증량 6→10L', note: 'SpO2 89% 1분', time: iso(66), by: nurse.id }],
          interventions: [{ type: 'WARMING', detail: '가온담요 적용', note: null, time: iso(68), by: nurse.id }, { type: 'OXYGEN', detail: 'Venturi 40%', note: null, time: iso(66), by: nurse.id }],
          notes: [{ text: '입실 시 오한 · 가온 시작 · 보호자에게 경과 설명', at: iso(60), by: nurse.id }], oxygen: 'Venturi 40%', bay: 'B3' } },
      { n: 4, proc: '충수돌기절제술', anes: 'GENERAL', endedMin: 135,
        anesthesia: { asaClass: 'II', airwayType: 'LMA', analgesics: [{ drug: 'Fentanyl', dose: '50 mcg' }], fluidInput: [{ type: 'Hartmann', ml: 600 }], ebl: 20 },
        pacu: { arrivalMin: 130, vitals: [vit(128, { bp: '126/80', hr: 84, rr: 16, spo2: 97, temp: 36.5, rass: -1 }), vit(90, { bp: '122/78', hr: 80, rr: 14, spo2: 98, temp: 36.7, rass: 0 }), vit(40, { bp: '120/76', hr: 76, rr: 14, spo2: 98, temp: 36.8, rass: 0 })],
          history: [score('ALDRETE', 9, 'ADMIT', 127, ald(9)), score('ALDRETE', 12, 'DISCHARGE', 40, ald(12))], aldrete: 12,
          delayReason: 'NO_BED', delayNote: '외과 병동 병상 정리 대기', signOffMin: 35, bay: 'B4' } },
      { n: 5, proc: '백내장 수정체 치환술', anes: 'LOCAL', endedMin: 155,
        anesthesia: { asaClass: 'II', airwayType: null, analgesics: [{ drug: 'Lidocaine(국소)', dose: '2%' }] },
        pacu: { arrivalMin: 150, dischargeMin: 60, disposition: 'HOME', vitals: [vit(148, { bp: '132/80', hr: 70, rr: 14, spo2: 98, temp: 36.6, rass: 0 }), vit(90, { bp: '128/78', hr: 68, rr: 14, spo2: 98, temp: 36.7, rass: 0 })],
          history: [score('PADSS', 8, 'ADMIT', 145, padss(8)), score('PADSS', 10, 'DISCHARGE', 65, padss(10)), score('ALDRETE', 12, 'ADMIT', 146, ald(12))], aldrete: 12, padssScore: 10, signOffMin: 62 } },
      { n: 6, proc: '대장 절제술', anes: 'GENERAL', endedMin: 305,
        anesthesia: { asaClass: 'III', airwayType: 'ETT', ettSize: '7.0', extubationMin: 300, reversal: [{ drug: 'Sugammadex', dose: '200 mg' }], fluidInput: [{ type: 'Hartmann', ml: 2200 }], ebl: 600, urineOutput: 250 },
        pacu: { arrivalMin: 300, dischargeMin: 200, disposition: 'ICU', override: '재삽관 후 ICU 이송 — 마취과 판단(Aldrete 기준 미달)',
          vitals: [vit(298, { bp: '84/50', hr: 118, rr: 26, spo2: 88, temp: 35.9, rass: -3 }), vit(280, { bp: '92/56', hr: 112, rr: 0, spo2: 90, rass: -4 })],
          history: [score('ALDRETE', 5, 'ADMIT', 296, ald(5))], aldrete: 5,
          complications: [{ type: 'HYPOTENSION', severity: 'SEVERE', intervention: 'Phenylephrine 100 mcg · 수액 볼루스', note: null, time: iso(295), by: nurse.id },
            { type: 'REINTUBATION', severity: 'SEVERE', intervention: 'ETT 7.0 재삽관', note: '호흡 저하·SpO2 88%', time: iso(285), by: anesth }], signOffMin: 205 } },
      { n: 7, proc: '탈장 복원술(서혜부)', anes: 'GENERAL', endedMin: 8 }, // 입실 대기(수술 완료 · 회복실 기록 없음)
    ];
    if (dryRun) return { closed: 0, created: cases.length, skipped: 0 };

    let created = 0; let skipped = 0;
    for (const c of cases) {
      const surgeryId = sid(c.n);
      const exists = await this.prisma.surgery.findUnique({ where: { id: surgeryId }, select: { id: true } });
      if (exists) { skipped++; continue; }
      const pat = patients[(hash(dateKey) + c.n * 13) % patients.length];
      const ended = at(c.endedMin);
      // 수술·마취기록·회복실 기록을 한 트랜잭션으로 — 중간에 실패하면 다음 실행이 '이미 있음'으로 건너뛰어 반쪽 시나리오가 남는다
      await this.prisma.$transaction(async (tx) => {
        await tx.surgery.create({
          data: {
            id: surgeryId, patientId: pat.id, surgeonId: surgeon, procedureName: c.proc, anesthesiaType: c.anes, status: 'COMPLETED',
            scheduledAt: new Date(ended.getTime() - 150 * 60_000), startedAt: new Date(ended.getTime() - 110 * 60_000), endedAt: ended,
          },
        });
        if (c.anesthesia) {
          const a = c.anesthesia as Record<string, unknown>;
          await tx.anesthesiaRecord.create({
            data: {
              surgeryId, anesthetistId: anesth, anesthesiaType: c.anes, asaClass: (a.asaClass as string) ?? null,
              airwayType: (a.airwayType as string | null) ?? null, ettSize: (a.ettSize as string | undefined) ?? null,
              inductionTime: new Date(ended.getTime() - 120 * 60_000),
              extubationTime: typeof a.extubationMin === 'number' ? at(a.extubationMin) : null,
              analgesics: (a.analgesics ?? undefined) as never, reversal: (a.reversal ?? undefined) as never,
              fluidInput: (a.fluidInput ?? undefined) as never, bloodProducts: (a.bloodProducts ?? undefined) as never,
              ebl: (a.ebl as number | undefined) ?? null, urineOutput: (a.urineOutput as number | undefined) ?? null,
              notes: '데모 마취기록(dev.demoDateRoll)',
            },
          });
        }
        if (c.pacu) {
          const p = c.pacu as Record<string, any>;
          // 점수 칸의 평가 시각은 그 종류의 마지막 이력 시각 — 둘이 다른 말을 하지 않게
          const lastAt = (kind: string) => { const h = (p.history ?? []).filter((e: { kind: string }) => e.kind === kind); return h.length ? new Date(h[h.length - 1].at) : null; };
          await tx.pacuRecord.create({
            data: {
              id: pid(c.n), surgeryId, patientId: pat.id, nurseId: nurse.id,
              arrivalTime: at(p.arrivalMin), dischargeTime: p.dischargeMin != null ? at(p.dischargeMin) : null,
              disposition: p.disposition ?? null, dischargedById: p.dischargeMin != null ? (p.disposition === 'ICU' ? anesth : nurse.id) : null,
              dischargeOverride: p.override ?? null,
              aldretScore: p.aldrete ?? null, aldreteDetail: p.aldrete != null ? ald(p.aldrete) : undefined,
              aldreteAssessedAt: p.aldrete != null ? lastAt('ALDRETE') : null, aldreteAssessedById: p.aldrete != null ? nurse.id : null,
              padssScore: p.padssScore ?? null, padssDetail: p.padssScore != null ? padss(p.padssScore) : undefined,
              padssAssessedAt: p.padssScore != null ? lastAt('PADSS') : null, padssAssessedById: p.padssScore != null ? nurse.id : null,
              ponvScore: p.ponv ?? null, ponvAssessedAt: p.ponv != null ? lastAt('PONV') : null, ponvAssessedById: p.ponv != null ? nurse.id : null,
              painScore: p.painScore ?? null, painAssessments: p.pain ?? undefined,
              vitalSigns: p.vitals ?? [], interventions: p.interventions ?? [], complications: p.complications ?? undefined,
              scoreHistory: p.history ?? undefined, ioEntries: p.io ?? undefined, nursingNotes: p.notes ?? undefined,
              oxygenTherapy: p.oxygen ?? null, bayCode: p.bay ?? null,
              delayReason: p.delayReason ?? null, delayNote: p.delayNote ?? null,
              anesthesiaSignOffAt: p.signOffMin != null ? at(p.signOffMin) : null, anesthesiaSignOffById: p.signOffMin != null ? anesth : null,
              arrivalHandoff: p.handoff ?? undefined,
              notes: '데모 회복실 기록(dev.demoDateRoll)',
            },
          });
        }
      });
      // 여정 정본 발행(다른 데모 신선화와 같은 길 · DEMO 출처) — 회복실 입실·퇴실
      if (c.pacu) {
        const p = c.pacu as Record<string, any>;
        const base = { patientId: pat.id, department: '회복실', dataOrigin: 'DEMO' as const, metadata: { simulated: true } };
        this.journey?.emit({ ...base, eventType: 'PACU_ADMISSION', title: 'PACU(회복실) 입실', refType: 'PACU', refId: pid(c.n), navUrl: '/pacu', episode: { type: 'Surgery', id: surgeryId }, occurredAt: at(p.arrivalMin) });
        if (p.dischargeMin != null) this.journey?.emit({ ...base, eventType: 'PACU_DISCHARGE', title: 'PACU(회복실) 퇴실', refType: 'PACU', refId: pid(c.n), navUrl: '/pacu', episode: { type: 'Surgery', id: surgeryId }, occurredAt: at(p.dischargeMin) });
      }
      created++;
    }
    return { closed: Number(closed), created, skipped };
  }
}

