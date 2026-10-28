/**
 * 축 B — 흐름 완결성 등록부.
 *
 * 🔴 **임계를 지어내지 않는다.** 기획 §3 축 B: 임계는 감이 아니라 그 축의 **과거 실측 p95×2** 에서
 *    뽑는다. 그런데 2026-09-02 운영 실측에서 단계별 완료 표본이 **12~16건**뿐이었다
 *    (외래 완료 총 4건). 그 표본으로 p95 를 뽑으면 임계를 지어내는 것과 같다 —
 *    접수→호출 p95 가 564분으로 나왔는데 이상치 하나가 만든 값이다.
 *
 * 그래서 이 축은 이렇게 동작한다:
 *   1. 매 스윕마다 **분포를 잰다**(표본 수·중앙값·p95).
 *   2. 표본이 `minSample` 미만이면 **임계를 만들지 않고 관측 불가**로 남긴다.
 *      화면은 "표본 N건 — 임계 산출에 M건 필요" 라고 말한다.
 *   3. 표본이 차면 임계(p95×2)를 만들고, **지금 진행 중인 건** 중 그 임계를 넘긴 수를 센다.
 *
 * 🔴 이것이 "표본 부재의 정답은 폴백이 아니라 산출 불가" 규칙의 흐름 축 적용이다.
 *    실환자 전환 후 표본이 쌓이면 이 축은 **저절로 살아난다.**
 */

export interface FlowStageDef {
  /** 'flow.opd.checkin_to_call' */
  key: string;
  label: string;
  severity: 'RED' | 'AMBER' | 'INFO';
  /**
   * 임계를 산출하기 위한 최소 표본 수.
   * 🔴 p95 를 몇 건으로 추정할 수 있는가는 통계 문제다. 100건은 "이 정도면 이상치 하나가
   *    임계를 지배하지 않는다"는 보수적 선이며, **근거 없이 낮추지 않는다**
   *    (낮추면 이 축이 거짓 경보를 만들기 시작한다).
   */
  minSample: number;
  /** 완료된 전이의 소요(분) — `n`, `p50`, `p95` 를 낸다. 읽기 전용 */
  distSql: string;
  /** 아직 다음 단계로 넘어가지 않은 건 중 현재 경과가 $1(분)을 넘는 수 — `n` 을 낸다 */
  pendingSql: string;
  /** 어디서 보는가 — 🔴 모르면 비운다 */
  drillDown?: string;
  why: string;
}

/**
 * 🔴 시각 역전(`완료 < 시작`)은 여기서 세지 않는다 — 이미 정합성 스캔(축 A)이 센다.
 *    같은 사실을 두 축이 세면 화면이 같은 문제를 두 번 말한다.
 *    그래서 분포 쿼리는 `>=` 로 역전 행을 **표본에서 제외**만 한다.
 */
export const FLOW_STAGES: FlowStageDef[] = [
  {
    key: 'flow.opd.checkin_to_call',
    label: '외래 접수 → 호출 지연',
    severity: 'AMBER',
    minSample: 100,
    distSql: `
      SELECT count(*)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (called_at - checked_in_at))/60) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (called_at - checked_in_at))/60) AS p95
        FROM waiting_queue
       WHERE called_at IS NOT NULL AND checked_in_at IS NOT NULL AND called_at >= checked_in_at`,
    pendingSql: `
      SELECT count(*)::int AS n
        FROM waiting_queue
       WHERE status = 'WAITING' AND checked_in_at IS NOT NULL AND checked_in_at <= now()
         AND EXTRACT(epoch FROM (now() - checked_in_at))/60 > $1`,
    drillDown: '/reception',
    why: '접수했는데 호출되지 않은 채 시간이 지난 환자. 대기 화면에는 보이지만 "얼마나 오래"는 아무도 세지 않는다.',
  },
  {
    key: 'flow.opd.call_to_start',
    label: '외래 호출 → 진료 시작 지연',
    severity: 'AMBER',
    minSample: 100,
    distSql: `
      SELECT count(*)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (started_at - called_at))/60) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (started_at - called_at))/60) AS p95
        FROM waiting_queue
       WHERE started_at IS NOT NULL AND called_at IS NOT NULL AND started_at >= called_at`,
    pendingSql: `
      SELECT count(*)::int AS n
        FROM waiting_queue
       WHERE status = 'CALLED' AND called_at IS NOT NULL AND called_at <= now()
         AND EXTRACT(epoch FROM (now() - called_at))/60 > $1`,
    drillDown: '/clinic-queue',
    why: '호출했는데 진료가 시작되지 않은 건. 환자가 진료실 앞에서 사라졌거나 호출이 전달되지 않았을 수 있다.',
  },
  {
    key: 'flow.opd.start_to_cashier',
    label: '외래 진료 시작 → 수납 대기 전환 지연',
    severity: 'INFO',
    minSample: 100,
    distSql: `
      SELECT count(*)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (completed_at - started_at))/60) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (completed_at - started_at))/60) AS p95
        FROM waiting_queue
       WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at >= started_at`,
    pendingSql: `
      SELECT count(*)::int AS n
        FROM waiting_queue
       WHERE status = 'IN_CONSULTATION' AND started_at IS NOT NULL AND started_at <= now()
         AND EXTRACT(epoch FROM (now() - started_at))/60 > $1`,
    drillDown: '/clinic-queue',
    why: '진료가 시작된 뒤 끝나지 않은 채 남아 있는 건. 기록만 안 닫혔을 수도, 환자가 계속 있을 수도 있다.',
  },
];
