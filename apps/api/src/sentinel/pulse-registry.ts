/**
 * 실시간 축(펄스) 등록부 — **1분마다 재는 값싼 지표**.
 *
 * 🔴 왜 층을 나눴나: 딥 스윕(75불변식 전테이블 조인)은 1분마다 돌릴 수 없다.
 *    반면 아래 지표는 인덱스를 타는 카운트라 **1~12ms**(2026-09-03 운영 실측)다.
 *    비싼 것은 드물게, 값싼 것은 자주 — 그래야 "지금 무슨 일이 일어나는가"를 볼 수 있다.
 *
 * 🔴 **임계를 절대값으로 박지 않는다.** 병원마다 평상시 값이 다르다.
 *    각 지표의 **자기 이력**(baseline)과 비교해 급변만 본다.
 *    baseline 이 모자라면 **판정하지 않고 "축적 중"** 이라 말한다(축 B 와 같은 규칙).
 */

export interface PulseMetricDef {
  /** 'queue.active' */
  key: string;
  label: string;
  /** 단위 표기(없으면 건) */
  unit?: string;
  /** 값 1개를 내는 읽기 전용 SQL — 반드시 `n` 컬럼 하나 */
  sql: string;
  /**
   * 🔴 **최소 절대 증가폭.** 이것을 넘지 않으면 급변이라 하지 않는다.
   *    baseline 이 0~1 근처일 때 1 → 3 같은 변화가 통계적으로는 큰 이탈이지만
   *    현장에서는 아무 일도 아니다. 이 하한이 없으면 거짓 경보가 쏟아진다.
   */
  minDelta: number;
  /** 값이 **줄어드는 것**이 이상인 지표(쓰기 정지 등) */
  watchDrop?: boolean;
  /**
   * 🔴 **표본 게이트.** 분모가 이만큼 되지 않으면 **값을 내지 않는다**(산출 불가 ≠ 0).
   *    비율 지표에서 분모 3건짜리 33% 는 사실이 아니라 잡음이다 —
   *    그것을 시계열에 쌓으면 baseline 이 잡음으로 만들어지고 이 축이 거짓 경보를 낸다.
   *    이 값이 있으면 `sql` 은 값 `n` 과 함께 **분모 `d`** 를 내야 한다(가드가 대조한다).
   */
  minSample?: number;
  /**
   * 임계 규칙. 기본(`MAD_Z`)은 자기 이력의 중앙값·MAD 이탈이다.
   *
   * `P95_X2` = 자기 이력 **p95 × 2**(축 B 흐름 완결성과 같은 규약). 평상시 0 에 가까운
   * 희소 지표에서 중앙값·MAD 는 산포가 0 이 되어 판정이 절대 하한만 남는다 — 그런 축은
   * 상위 분위로 임계를 세운다. 🔴 어느 쪽이든 **임계는 자기 이력에서만** 나온다(절대값을 박지 않는다).
   */
  thresholdRule?: 'MAD_Z' | 'P95_X2';
  severity: 'RED' | 'AMBER' | 'INFO';
  /** 어디서 보는가 — 🔴 모르면 비운다 */
  drillDown?: string;
  why: string;
}

/**
 * 🔴 로버스트 z 문턱. 정규분포 가정 없이 중앙값·MAD 로 잰다.
 *    4.0 은 보수적인 값이다 — **거짓 경보는 진짜 경보를 죽이므로** 처음엔 넓게 잡고,
 *    운영에서 거짓 경보율을 본 뒤 사람이 좁힌다(그 전까지 알림은 보내지 않는다).
 */
export const PULSE_Z_THRESHOLD = 4.0;

/**
 * 급변을 판정하기 위한 최소 baseline 표본 수.
 * 1분 틱이므로 120점 = **2시간**. 그 전에는 판정하지 않고 축적 상황을 보여준다.
 */
export const PULSE_MIN_BASELINE = 120;

/** baseline 창(분) — 최근 24시간 */
export const PULSE_BASELINE_MINUTES = 24 * 60;

export const PULSE_METRICS: PulseMetricDef[] = [
  {
    key: 'queue.active',
    label: '원내 대기열 활성',
    sql: `SELECT count(*)::float AS n FROM waiting_queue WHERE status IN ('WAITING','CALLED','IN_CONSULTATION')`,
    minDelta: 20,
    severity: 'AMBER',
    drillDown: '/reception',
    why: '접수·대기가 갑자기 몰리는 것은 앞단(수납·진료실)이 막혔다는 신호일 수 있다.',
  },
  {
    key: 'queue.longWait',
    label: '30분 넘게 대기 중',
    sql: `SELECT count(*)::float AS n FROM waiting_queue
           WHERE status IN ('WAITING','CALLED') AND checked_in_at <= now()
             AND EXTRACT(epoch FROM (now() - checked_in_at))/60 > 30`,
    minDelta: 10,
    severity: 'AMBER',
    drillDown: '/reception',
    why: '총 대기는 그대로인데 장기 대기만 늘면 특정 진료실이 멈춘 것이다.',
  },
  {
    key: 'critical.pending',
    label: '위급값 미보고',
    // 미확인 = PENDING ∪ ESCALATED(정본 lab/critical-value-alert-states) — PENDING 만 세면 상향 전이가 "감소"로 보인다
    sql: `SELECT count(*)::float AS n FROM critical_value_alerts WHERE status IN ('PENDING', 'ESCALATED')`,
    // 🔴 위급값은 절대 수가 작다 — 하한을 낮게 두되 0 은 아니다(1건 변동으로 깨우지 않는다)
    minDelta: 3,
    severity: 'RED',
    drillDown: '/diagnostics-board',
    why: '보고 폐루프가 열린 채 쌓이는 것은 사람이 즉시 움직여야 하는 일이다.',
  },
  {
    key: 'order.pending',
    label: '미처리 오더',
    sql: `SELECT count(*)::float AS n FROM orders WHERE status IN ('ORDERED','RECEIVED')`,
    minDelta: 20,
    severity: 'AMBER',
    why: '오더가 쌓이는 것은 수행 부서(검사·약제·영상)가 막혔다는 신호다.',
  },
  {
    key: 'audit.writes5m',
    label: '최근 5분 감사 기록 수',
    // 🔴 컬럼명은 `timestamp` 다. 처음에 `created_at` 으로 적어 이 지표가 7틱 내내 실패했다 —
    //    다행히 "잴 수 없으면 0 을 쌓지 않는다" 규칙이 작동해 baseline 을 오염시키진 않았고,
    //    화면은 '관측 없음'으로 그 사실을 말했다(0 으로 접었다면 조용히 지나갔을 것이다).
    sql: `SELECT count(*)::float AS n FROM audit_logs WHERE "timestamp" > now() - interval '5 minutes'`,
    minDelta: 10,
    // 🔴 이 지표는 **줄어드는 것**이 이상이다 — 감사 기록이 멈추면 시스템이 쓰기를 멈춘 것이다.
    watchDrop: true,
    severity: 'RED',
    why: '변이는 기본 감사 ON 이므로, 감사 기록이 끊기면 쓰기 경로가 죽었다는 뜻이다.',
  },
  {
    key: 'db.idleInTx5m',
    label: '5분 넘은 idle 트랜잭션',
    sql: `SELECT count(*)::float AS n FROM pg_stat_activity
           WHERE state = 'idle in transaction' AND xact_start < now() - interval '5 minutes'`,
    minDelta: 2,
    severity: 'AMBER',
    why: '공유 DB 에서 장기 idle 트랜잭션은 VACUUM 회수를 막는다. 실제로 26일짜리가 있었다.',
  },
  {
    key: 'db.longQuery1m',
    label: '1분 넘게 실행 중인 쿼리',
    sql: `SELECT count(*)::float AS n FROM pg_stat_activity
           WHERE state = 'active' AND query_start < now() - interval '1 minute'
             AND query NOT ILIKE '%pg_stat_activity%'`,
    minDelta: 2,
    severity: 'AMBER',
    why: '느린 쿼리가 쌓이면 그 다음은 커넥션 고갈이다 — 장애 직전에 보이는 신호다.',
  },

  /* ───────── AI 판단 거버넌스 감독(기획 §2.3) ─────────
   * 🔴 이 두 지표는 **AI 의 품질을 판정하지 않는다.** 사람과 AI 사이에서 무슨 일이
   *    일어나는지의 관측점일 뿐이다. 거부율이 높은 것도 낮은 것도 그 자체로 결함이 아니다 —
   *    이 축이 보는 것은 **자기 이력 대비 급변**뿐이다.
   * 🔴 딥링크(drillDown)를 비워 둔다 — 감독 화면(`/admin/ai-oversight`)이 아직 없다.
   *    없는 화면으로 보내는 링크를 그리면 화면이 있는 척하는 것이 된다. */
  {
    key: 'ai.proposal.rejectRate.1h',
    label: 'AI 제안 거부율(1시간)',
    unit: '%',
    /**
     * 분모 = **사람이 결정한 건**(ACCEPTED·EDITED·REJECTED). 🔴 `EXPIRED` 는 넣지 않는다 —
     * 만료는 거부가 아니다. 섞으면 아무도 손대지 않은 제안이 거부율을 부풀린다.
     * 소수 1자리 반올림은 SQL 에서 한다(표시 정본 `NUMERIC_POLICIES` 의 임상·재무 도메인이 아니며,
     * TS 쪽에서 `toFixed`/`Math.round` 를 쓰면 구조 가드가 잡는다).
     */
    sql: `SELECT round((100.0 * count(*) FILTER (WHERE status = 'REJECTED')
                        / NULLIF(count(*), 0))::numeric, 1)::float AS n,
                 count(*)::float AS d
            FROM ai_proposals
           WHERE decided_at > now() - interval '1 hour'
             AND status IN ('ACCEPTED','EDITED','REJECTED')`,
    // 🔴 분모 10건 미만은 산출하지 않는다. 2건 중 1건 거부 = 50% 는 사실이 아니라 잡음이다
    minSample: 10,
    // %p 단위 하한 — 평상시가 낮은 축에서 몇 %p 흔들림이 경보가 되지 않게
    minDelta: 20,
    severity: 'AMBER',
    why: '거부율이 자기 이력에서 갑자기 튀는 것은 모델·프롬프트·입력이 그 사이 바뀌었다는 신호다(어느 쪽인지는 이 지표가 말하지 못한다).',
  },
  {
    key: 'ai.proposal.quickAccept.1h',
    label: 'AI 제안 5초 미만 승인(1시간)',
    /**
     * 🔴 `presented_at IS NOT NULL` 이 이 지표의 핵심이다. 노출 기록 없이 결정된 건
     * (배치·API 직행 · 전이 사유 `NOT_PRESENTED`)을 여기 세면 **"0초 만에 검토했다"** 는
     * 거짓이 된다. 그런 건은 이 지표의 대상이 아니라 다른 사실이다.
     * 🔴 `decided_at >= presented_at` — 1ms 역전 같은 시계 아티팩트를 표본에서 뺀다
     *    (역전 자체는 정합성 축이 센다. 같은 사실을 두 축이 세지 않는다).
     */
    sql: `SELECT count(*)::float AS n
            FROM ai_proposals
           WHERE status = 'ACCEPTED'
             AND decided_at > now() - interval '1 hour'
             AND presented_at IS NOT NULL
             AND decided_at >= presented_at
             AND decided_at - presented_at < interval '5 seconds'`,
    // 평상시 0 에 가까운 희소 축 — 중앙값·MAD 로는 산포가 0 이라 판정이 서지 않는다
    thresholdRule: 'P95_X2',
    // 🔴 희소 축의 1~2건을 경보하지 않는다(거짓 경보는 진짜 경보를 죽인다)
    minDelta: 5,
    severity: 'AMBER',
    why: '초안이 뜨자마자 승인되는 건이 갑자기 늘면 사람이 읽지 않고 누르고 있다는 신호다 — 승인은 정본 내용의 책임을 지는 행위다.',
  },
  /**
   * 🔴 (2026-09-28 공간·동선 P0) 환자 위치 중 **관측**(QR 스캔·검진 스테이션 도착·직원 입력)의 비율.
   *    P0 전에는 여정 이벤트를 번역한 추정이 관측과 같은 모양으로 섞여 있었다 — 운영 첫 실측은 열린 위치 33건 중 관측 0.
   *    이 지표가 보는 것: QR 스테이션·스테이션 도착 처리가 **실제로 쓰이는가**, 그리고 쓰이다가 **멈췄는가**(watchDrop).
   * 🔴 시뮬레이션은 분모에서 뺀다(시뮬레이터가 돌면 비율이 거짓으로 내려간다).
   * 🔴 동선 SSE 발행 실패 수는 여기 두지 못한다 — 발행은 API 프로세스 메모리 안의 일이라 별도 프로세스인 감시자가 볼 수 없다(warn 로그만).
   */
  {
    key: 'location.observedRatio',
    label: '환자 위치 관측 비율(열린 위치)',
    unit: '%',
    sql: `SELECT round((100.0 * count(*) FILTER (WHERE source IN ('OBSERVED_QR','OBSERVED_STATION','OBSERVED_WIFI','MANUAL'))
                        / NULLIF(count(*), 0))::numeric, 1)::float AS n,
                 count(*)::float AS d
            FROM patient_locations
           WHERE left_at IS NULL AND source <> 'SIMULATED'`,
    // 열린 위치 10건 미만은 산출하지 않는다 — 소수 표본의 비율은 잡음이다
    minSample: 10,
    minDelta: 20,
    watchDrop: true,
    severity: 'INFO',
    drillDown: '/metaverse',
    why: '관측 비율이 자기 이력에서 급락하면 QR 위치 스테이션·검진 도착 처리가 멈췄거나 공간 연결이 풀렸다는 신호다(동선 화면은 추정만 남는다).',
  },
];
