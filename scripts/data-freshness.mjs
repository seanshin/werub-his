#!/usr/bin/env node
/**
 * scripts/data-freshness.mjs — **시점 정합(freshness) 판정기**
 *
 * 왜 있는가
 *   운영 DB 는 가상 병원 시드이고, `dev.demoDateRoll` 이 축마다 다른 속도로 시각을 다시 쓴다.
 *   그 결과 **"접수·오더는 오늘까지 살아 있는데 진료·검사·조제·수납은 몇 주 전에서 멈춘"**
 *   상태가 오래 방치됐다(2026-08-18 실측: encounters 08-05 · lab 07-28 · dispensings 07-14 ·
 *   billings.paid 07-10 · imaging 07-09). 아무도 몰랐던 이유는 **재는 도구가 없어서**다.
 *   🔴 한 번 채워 넣는 것보다 **갈라졌을 때 알아채는 것**이 중요하다 — 이 스크립트가 그 역할이다.
 *
 * 이 도구가 하지 **못하는** 것 (출력에도 매번 찍는다)
 *   🔴 **"0 건"은 세 가지 뜻이 될 수 있고, 이 판정기는 셋을 구분하지 못한다.**
 *        ① 시드에 없다  ② 기능이 미배선이다  ③ **쓰기 경로가 막혀 있다**
 *      → 0 을 곧바로 결함으로 단정하지 않는다. 확인 순서는 `--why` 참조.
 *   🔴 임상 내용의 옳고 그름은 보지 않는다(값 이상치·코드 정합은 이 도구 범위 밖).
 *
 * 이미 있는 것과의 관계 (🔴 정본이 둘이 되지 않게 한다 — 이 저장소의 반복 결함 P12)
 *   - `infra/scripts/data-integrity-scan.sql` … 도메인 횡단 **불변식** 스캔(50항목·읽기 전용).
 *     행 안의 모순(취소인데 ACTIVE, 퇴원인데 병상 점유 …)은 **거기가 정본**이다.
 *     그 스캔이 이미 보고 있는 시각 검사는 여기서 **다시 세지 않고 위임 목록으로만 출력**한다.
 *   - `scripts/system-scale.mjs` … 파일시스템 계측 정본. **DB 를 읽지 않는다**(그렇게 못박혀 있다).
 *     그래서 "DB 가 오늘 살아 있는가"는 거기에 붙일 수 없어 이 스크립트를 새로 만들었다.
 *     대신 CLI 규약(`--json` / `--rules` / `--check` / exit code)은 그대로 맞췄다.
 *
 * 사용법
 *   node scripts/data-freshness.mjs                # 사람이 읽는 표
 *   node scripts/data-freshness.mjs --days 30      # 관측 창(기본 30일)
 *   node scripts/data-freshness.mjs --all          # 정상 축까지 전부(기본은 접는다)
 *   node scripts/data-freshness.mjs --json         # 기계 판독용
 *   node scripts/data-freshness.mjs --rules        # 판정 규칙과 축별 임계값 근거만
 *   node scripts/data-freshness.mjs --why          # "0 은 세 가지 뜻" 확인 절차
 *   node scripts/data-freshness.mjs --sql          # 실행할 SQL 만 출력(psql -f 로 직접 돌릴 때)
 *   node scripts/data-freshness.mjs --check        # 🔴 위반이 있으면 exit 1
 *   node scripts/data-freshness.mjs --check --with-warn   # 🟡 도 실패로 친다
 *   node scripts/data-freshness.mjs --selftest     # 합성 입력으로 판정 로직 자체를 검증
 *
 * DB 접속 (🔴 **읽기 전용 — SELECT 만 생성한다**)
 *   기본값은 운영 HIS 로의 ssh + docker exec psql 이다. 바꾸려면:
 *     FRESHNESS_PSQL='psql "$DATABASE_URL" -X -tA -f -'  node scripts/data-freshness.mjs
 *   명령은 **stdin 으로 SQL 을 받아** `-tA`(비정렬·헤더 없음) 형식으로 출력해야 한다.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ═══════════════════════════════════════════════════════════ 임계값 정책(근거 포함)

/**
 * 🔴 근거 없는 임계값은 거짓 경보를 만들고, **거짓 경보는 진짜 경보를 죽인다.**
 *    그래서 "며칠이면 이상한가"를 사람이 감으로 정하지 않는다 —
 *    **그 축 자신의 과거 발생 간격**에서 뽑는다(자기 교정).
 */
const POLICY = {
  /** 관측 창 기본값(일). 30 = 월 단위 운영 리듬 한 바퀴. */
  windowDays: 30,

  /**
   * 지연 예산 = p95(과거 이벤트 간 간격) × 계수. 과거에 최장 그만큼 쉬어 본 축이라면
   * 그 간격 안의 침묵은 정상이다. 계수 2 = 한 번의 정상 공백을 두 번 연속 놓쳤을 때 경보.
   */
  gapMultiplier: 2,

  /**
   * 지연 예산 하한(일). 근거: 설·추석 연휴가 주말과 붙으면 **최장 5일 연속 무진료**가
   * 실제로 발생한다(한국 병원 달력). 7일 미만의 공백으로는 경보하지 않는다.
   */
  lagFloorDays: 7,

  /**
   * 간격 통계를 신뢰하는 최소 표본(이벤트 수). 이보다 적으면 임계값을 **만들어내지 않고**
   * `산출 불가` 로 남긴다. 🔴 표본 부재의 정답은 폴백이 아니라 "산출 불가"다.
   */
  minGapSamples: 20,

  /**
   * 인과쌍 판정을 시작하는 최소 상류 건수. 1~4건이면 하류 결과가 다음 창으로
   * 넘어가 있을 수 있다(우연). 5건이면 하나도 없는 것이 우연이기 어렵다.
   */
  minUpstream: 5,

  /**
   * 지연 예산 상한(일). 이보다 넓은 예산이 나온 축은 **판정하지 않고 "산출 불가"** 로 남긴다.
   * 🔴 근거: 분기(90일)를 넘는 예산으로는 "정지한 것"과 "원래 드문 것"을 구분할 수 없다.
   *    구분 못 하는 것을 초록으로 칠하면 **근거 없이 안심시키는 것**(P17)이 된다.
   */
  lagBudgetCapDays: 90,

  /** 미래 시각 허용 오차. `data-integrity-scan.sql` 38번과 같은 값(시계 오차·시간대 흔들림). */
  futureToleranceHours: 1,

  /**
   * 시각 역전 최소 격차(초). 이보다 작은 역전은 **같은 트랜잭션 안의 삽입 순서 아티팩트**로 보고
   * 세지 않는다(다만 몇 건을 걸렀는지는 반드시 표시한다 — 자르면 잘랐다고 말한다).
   *
   * 🔴 근거는 감이 아니라 실측 분포다(2026-08-18 운영 DB, 전 역전 쌍의 격차를 초 단위로 측정):
   *      - 아티팩트 쪽: `encounters.signed_at<created_at` 30건 · `billings.paid_at<created_at` 2건
   *        → **32건 전부 정확히 0.0010초**(최소=최대=1ms).
   *      - 진짜 쪽: `waiting_queue` 호출<접수 5,015초 · 진료종료<시작 900초.
   *      - **1초 ~ 60초 구간은 0건.** 분포가 밀리초와 분(分) 사이에서 완전히 갈라진다.
   *    그 빈 골짜기 안이면 어디를 잘라도 같으므로 1초로 둔다. 임상적으로도 사람이 기록한
   *    두 사실의 순서가 1초 미만으로 뒤집히는 일은 없다(그건 기계의 흔적이다).
   */
  reversalToleranceSeconds: 1,
};

/** 🔴 매번 출력에 붙는다 — 이 판정기가 구분하지 못하는 것. */
const ZERO_AMBIGUITY =
  '0 은 ①시드 부재 ②기능 미배선 ③쓰기 경로 막힘 중 무엇인지 이 도구는 구분하지 못한다(--why)';

// ═══════════════════════════════════════════════════════════════════════ 축 정의

/**
 * kind:
 *   'actual' … 이미 일어난 일이 박히는 컬럼 → 미래 시각은 결함이다.
 *   'plan'   … 앞으로 할 일이 박히는 컬럼(예약·예정) → 미래 시각이 **정상**이다.
 * rarity:
 *   'routine' … 병원이 돌아가면 상시 발생 → 지연 판정 대상.
 *   'rare'    … 원래 드물다(사망·중대사고·대량수혈 …) → **지연 판정에서 면제**.
 *               🔴 드문 축의 0 을 경보하면 진짜 경보가 묻힌다.
 */
const AXES = [
  // ── 접수 · 진료
  ax('waiting_queue', '접수(대기열 등록)', 'waiting_queue', 'checked_in_at', {
    why: '외래 접수. 병원이 문을 열면 매일 발생한다.',
  }),
  ax('waiting_queue.completed', '접수 → 진료 종료 처리', 'waiting_queue', 'completed_at', {
    filter: "status = 'COMPLETED'",
  }),
  ax('encounters', '진료 기록(생성)', 'encounters', 'created_at', {
    why: '접수된 환자에게 열리는 진료 기록. 접수가 있으면 있어야 한다.',
  }),
  ax('encounters.signed', '진료 기록(서명)', 'encounters', 'signed_at', {
    filter: "status = 'SIGNED'",
  }),
  ax('appointments', '예약(예정 시각)', 'appointments', 'scheduled_at', {
    kind: 'plan',
    why: '🔴 계획 컬럼이다 — 미래 시각이 정상. 미래 판정에서 제외한다.',
  }),
  ax('emergency_visits', '응급 방문(내원)', 'emergency_visits', 'arrival_at'),
  ax('admissions', '입원(입원일)', 'admissions', 'admit_date'),

  // ── 오더 (하류 축의 상류가 되므로 부서별로 나눈다)
  ax('orders', '오더(전체)', 'orders', 'created_at', { filter: "status <> 'CANCELLED'" }),
  ax('orders.lab', '오더 — 검사(LAB)', 'orders', 'created_at', {
    filter: "department = 'LAB' AND status <> 'CANCELLED'",
  }),
  ax('orders.imaging', '오더 — 영상(IMAGING)', 'orders', 'created_at', {
    filter: "department = 'IMAGING' AND status <> 'CANCELLED'",
  }),
  ax('orders.pharmacy', '오더 — 약제(PHARMACY)', 'orders', 'created_at', {
    filter: "department = 'PHARMACY' AND status <> 'CANCELLED'",
  }),
  ax('prescriptions', '처방', 'prescriptions', 'created_at', { filter: "status <> 'CANCELLED'" }),

  // ── 실행 결과
  ax('lab_results', '검사 — 채취', 'lab_results', 'collected_at'),
  ax('lab_results.completed', '검사 — 결과 확정', 'lab_results', 'completed_at'),
  ax('imaging_results', '영상 — 촬영', 'imaging_results', 'acquired_at'),
  ax('imaging_results.reported', '영상 — 판독', 'imaging_results', 'reported_at'),
  ax('dispensings', '조제·불출', 'dispensings', 'dispensed_at'),
  ax('mar', '투약 실시(MAR)', 'medication_administrations', 'administered_at'),
  ax('surgeries', '수술(집도 시작)', 'surgeries', 'started_at'),

  // ── 간호 · 관찰
  ax('nursing_notes', '간호기록', 'nursing_notes', 'recorded_at'),
  ax('vitals', '내원 전 활력징후', 'pre_visit_vitals', 'measured_at'),
  ax('flow_sheet', '플로시트(간호 관찰)', 'flow_sheet_entries', 'recorded_at'),
  ax('icu_records', '중환자실 기록', 'icu_records', 'record_time'),

  // ── 원무 · 수납
  ax('billings', '청구 생성', 'billings', 'created_at'),
  ax('billings.paid', '수납(결제 완료)', 'billings', 'paid_at'),
  ax('claims', '보험 청구 전송', 'claims', 'submitted_at'),
  ax('checkup_visits', '건강검진 완료', 'checkup_visits', 'completed_at'),

  // ── 시스템 활동(앵커: 시스템이 아예 죽었는지 구분하는 데 쓴다)
  ax('audit_logs', '감사 로그', 'audit_logs', 'timestamp'),
  ax('notifications', '알림 발행', 'notifications', 'created_at'),
  ax('journey_events', '환자 여정 이벤트', 'patient_journey_events', 'event_at'),

  // ── 🔴 희소 축 — 지연 판정 면제. 0 이 정상이다.
  ax('deaths', '사망', 'patients', 'death_date', {
    rarity: 'rare',
    why: '사망은 드물다. 0 은 결함이 아니다 — 지연 판정에서 면제한다.',
  }),
  ax('safety_incidents', '환자안전 사건', 'safety_incidents', 'occurred_at', {
    rarity: 'rare',
    why: '중대 사건은 드물다. 🔴 다만 "보고가 0"과 "사건이 0"은 다르다 — 이 도구는 구분 못 한다.',
  }),
  ax('code_blue', '심정지(Code Blue)', 'code_blue_events', 'recognized_at', { rarity: 'rare' }),
  ax('rrt', '신속대응팀 출동(RRT)', 'rrt_activations', 'activated_at', { rarity: 'rare' }),
  ax('mci', '다수사상자(MCI)', 'mci_events', 'activated_at', { rarity: 'rare' }),
  ax('blood_transfusions', '수혈 시행', 'blood_transfusions', 'start_time', { rarity: 'rare' }),
  ax('transfusion_orders', '수혈 오더', 'transfusion_orders', 'ordered_at', { rarity: 'rare' }),
  ax('critical_value_alerts', '검사 위급값 경보', 'critical_value_alerts', 'created_at', {
    rarity: 'rare',
  }),
  ax('notifiable_disease_reports', '법정감염병 신고', 'notifiable_disease_reports', 'created_at', {
    rarity: 'rare',
  }),
  ax('hai_cases', '의료관련감염 사례', 'hai_cases', 'onset_at', { rarity: 'rare' }),
];

function ax(key, label, table, col, opts = {}) {
  return {
    key,
    label,
    table,
    col,
    filter: opts.filter ?? null,
    kind: opts.kind ?? 'actual',
    rarity: opts.rarity ?? 'routine',
    why: opts.why ?? null,
  };
}

// ══════════════════════════════════════════════════════ 인과쌍(축 간 모순) 정의

/**
 * 🔴 여기가 이 도구의 핵심이다. 축 하나만 보면 "원래 그런 축인지" 알 수 없지만,
 *    **상류가 살아 있는데 하류가 죽어 있으면** 그건 병원 규모와 무관하게 모순이다.
 *
 * zero  … 창 안 상류 ≥ minUpstream 인데 하류가 **0** → 🔴 (비율이 아니라 0/비0 만 본다.
 *          비율 임계값은 근거를 댈 수 없어 쓰지 않는다.)
 * tatDays … 하류 최신일이 상류 최신일보다 이만큼 뒤처지면 🟡. 근거는 해당 업무의 통상 소요(TAT).
 */
const PAIRS = [
  {
    key: 'reception→encounter',
    up: 'waiting_queue',
    down: 'encounters',
    tatDays: 1,
    why: '접수한 환자는 진료를 받는다. 접수만 쌓이고 진료 기록이 없으면 "왔는데 아무 일도 안 일어난" 상태다.',
    tatWhy: '외래는 접수 당일 진료가 원칙 — 하루를 넘겨 벌어지면 기록 경로를 의심한다.',
  },
  {
    key: 'lab order→lab result',
    up: 'orders.lab',
    down: 'lab_results',
    tatDays: 3,
    why: '검사 오더가 났는데 채취가 한 건도 없으면 검사 경로가 끊긴 것이다.',
    tatWhy: '일반 검체 TAT 는 당일~익일, 외부 의뢰를 감안해도 3일이면 나온다.',
  },
  {
    key: 'lab collect→lab report',
    up: 'lab_results',
    down: 'lab_results.completed',
    tatDays: 3,
    why: '채취했는데 결과 확정이 하나도 없으면 결과 회신 경로가 끊긴 것이다.',
    tatWhy: '검체 TAT 와 동일 근거.',
  },
  {
    key: 'imaging order→acquisition',
    up: 'orders.imaging',
    down: 'imaging_results',
    tatDays: 3,
    why: '영상 오더가 났는데 촬영 기록이 없으면 촬영/연동 경로가 끊긴 것이다.',
    tatWhy: '예약 촬영을 감안해도 3일. 🔴 PACS 자체는 별도 시스템이라 여기서 보지 않는다.',
  },
  {
    key: 'acquisition→report',
    up: 'imaging_results',
    down: 'imaging_results.reported',
    tatDays: 3,
    why: '촬영했는데 판독이 한 건도 없으면 판독 경로가 끊긴 것이다.',
    tatWhy: '정규 판독 TAT 는 통상 1~2일.',
  },
  {
    key: 'pharmacy order→dispensing',
    up: 'orders.pharmacy',
    down: 'dispensings',
    tatDays: 1,
    why: '약제 오더가 났는데 조제가 한 건도 없으면 조제 경로가 끊긴 것이다.',
    tatWhy: '조제는 당일 처리가 원칙(퇴원약 포함).',
  },
  {
    key: 'encounter→billing',
    up: 'encounters',
    down: 'billings',
    tatDays: 3,
    why: '진료가 있었는데 청구가 한 건도 안 만들어지면 수납 파이프라인이 끊긴 것이다.',
    tatWhy: '외래는 진료 직후 수납. 입원 중간청구를 감안해 3일.',
  },
  {
    key: 'encounter→payment',
    up: 'encounters',
    down: 'billings.paid',
    tatDays: 7,
    why: '진료가 수십 건인데 같은 창에서 수납이 한 건도 없으면 수납 경로가 끊긴 것이다. '
       + '(중간 축인 청구 생성이 소량이면 billing→payment 쌍만으로는 0 판정이 안 서므로 직접 잇는다.)',
    tatWhy: '외래는 진료 당일 수납. 입원 중간청구·미수를 감안해 주 단위로 본다.',
  },
  {
    key: 'billing→payment',
    up: 'billings',
    down: 'billings.paid',
    tatDays: 7,
    why: '청구가 생성됐는데 수납이 한 건도 없으면 결제 경로가 끊긴 것이다.',
    tatWhy: '미수·분납이 있으므로 하루로 자르면 거짓 경보가 난다. 주 단위로 본다.',
  },
];

// ══════════════════════════════════════════════════ 시각 역전 / 위임 목록

/**
 * 행 **안**의 시각 역전. 🔴 이미 `data-integrity-scan.sql` 이 보고 있는 것은 여기 넣지 않는다
 *    (아래 DELEGATED 참조) — 같은 사실에 정본이 둘이 되면 갈라진다.
 */
const REVERSALS = [
  rev('surgeries.end<start', '수술 종료 < 시작', 'surgeries', 'started_at', 'ended_at'),
  rev('surgeries.close<incision', '수술 봉합 < 절개', 'surgeries', 'incision_time', 'closure_time'),
  rev('er.triage<arrival', '응급 트리아지 < 내원', 'emergency_visits', 'arrival_at', 'triaged_at'),
  rev('er.disposition<arrival', '응급 퇴실결정 < 내원', 'emergency_visits', 'arrival_at', 'disposition_at'),
  rev('dispensing.verify<dispense', '조제 감사 < 조제', 'dispensings', 'dispensed_at', 'verified_at'),
  rev('imaging.report<acquire', '영상 판독 < 촬영', 'imaging_results', 'acquired_at', 'reported_at'),
  rev('wq.call<checkin', '호출 < 접수', 'waiting_queue', 'checked_in_at', 'called_at'),
  rev('wq.complete<start', '진료종료 < 진료시작', 'waiting_queue', 'started_at', 'completed_at'),
  rev('transfusion.end<start', '수혈 종료 < 시작', 'blood_transfusions', 'start_time', 'end_time'),
];

/**
 * 🔴 **판정에서 뺀 쌍과 그 근거.** 뺐다는 사실을 감추지 않는다(`--rules` 가 출력한다).
 *
 * `created_at` 은 **행이 DB 에 들어온 시각**이고 `signed_at`·`recorded_at`·`paid_at` 은
 * **임상·업무 시각**이다. 두 축은 서로 다른 시간이라 대소 비교가 사실을 뜻하지 않는다.
 * 실측이 그것을 확정한다(2026-08-18):
 *   - `nursing_notes`: `signed_at < created_at` 187건, 격차 중앙값 **27.9일**(최대 57일).
 *     1초 tolerance 로는 절대 못 거른다 — **쌍 자체가 무효**라는 뜻이다.
 *   - `nursing_notes`: `created_at - recorded_at` 이 0일~57일에 고르게 퍼져 있다
 *     → `created_at` 은 업무 시각이 아니다.
 *   - `encounters.created_at` 은 2024-08-09~2026-08-18 에 퍼져 있다(시드가 소급 조작).
 *     즉 **어떤 행에서는 삽입 시각, 어떤 행에서는 조작된 과거** — 어느 쪽이든 사실의 근거가 못 된다.
 */
const EXCLUDED_REVERSALS = [
  [
    'encounters: signed_at < created_at',
    '실측 30건이 **전부 정확히 1ms** — 같은 트랜잭션 삽입 순서 아티팩트였다. 게다가 `created_at` 은 '
      + '임상 시각이 아니라 비교 자체가 무효(간호기록 같은 비교는 중앙값 27.9일 격차를 만든다).',
  ],
  [
    'billings: paid_at < created_at',
    '실측 2건이 **전부 정확히 1ms** — 같은 아티팩트. `billings.created_at` 도 삽입/소급이 섞여 있어 '
      + '업무 순서의 근거가 못 된다. 🔴 대체할 업무 시각 컬럼이 없으므로 **이 사실은 판정하지 않는다**(폴백을 만들지 않는다).',
  ],
  [
    'nursing_notes: signed_at < created_at',
    '실측 187건 중 182건이 60초 이상이고 **격차 중앙값이 27.9일**(최대 57일)이다. 아티팩트가 아니라 '
      + '`signed_at`(과거 임상 시각)과 `created_at`(시드 삽입 시각)을 비교한 것이 무의미할 뿐이다 — '
      + '🔴 tolerance 를 아무리 키워도 못 거른다. 쌍 자체를 빼는 것이 정답이라는 결정적 근거.',
  ],
];

function rev(key, label, table, earlier, later) {
  return { key, label, table, earlier, later, expr: `${later} < ${earlier}` };
}

/** 🔴 여기 있는 것은 이 스크립트가 **세지 않는다**. 정본은 왼쪽 파일이다. */
const DELEGATED = [
  ['infra/scripts/data-integrity-scan.sql · 08', '오더 시각 역전(완료 < 시작)'],
  ['infra/scripts/data-integrity-scan.sql · 17', '퇴원일이 입원일보다 빠름'],
  ['infra/scripts/data-integrity-scan.sql · 26', '검사 시각 역전(완료 < 채취)'],
  ['infra/scripts/data-integrity-scan.sql · 36', '생년월일이 미래이거나 150세 초과'],
  ['infra/scripts/data-integrity-scan.sql · 38', '미래 시각으로 기록된 감사'],
  ['infra/scripts/data-integrity-scan.sql · 12/21/23/48*', '묵은 미종결(DRAFT·예약·대기·오더)'],
];

// ═══════════════════════════════════════════════════════════════ 맞춤 프로브

/**
 * 축·인과쌍으로 표현되지 않는 "지금 이 순간의 침묵". 근거를 각자 단다.
 */
const PROBES = [
  {
    key: 'admitted.no_nursing_note_48h',
    label: '재원 중인데 48시간 넘게 간호기록 없음',
    sev: '🟡',
    why: '간호기록은 근무조(8시간)마다 남는 것이 표준이다. 48시간 = 6개 근무조 연속 무기록.',
    sql: `SELECT count(*) FROM admissions a
           WHERE a.status = 'ADMITTED'
             AND NOT EXISTS (
               SELECT 1 FROM nursing_notes n
                WHERE n.admission_id = a.id
                  AND n.recorded_at >= now() - interval '48 hours'
                  AND n.recorded_at <= now())`,
  },
  {
    key: 'admitted.no_vitals_flowsheet_48h',
    label: '재원 중인데 48시간 넘게 플로시트 기록 없음',
    sev: '⚪',
    why: '활력 관찰도 근무조 단위다. 다만 이 병원은 플로시트 자체가 거의 비어 있어 ⚪(관측)으로 둔다 — '
       + '🔴 0 이 "미배선"일 수 있다는 뜻이고, 이 도구는 그것을 구분하지 못한다.',
    sql: `SELECT count(*) FROM admissions a
           WHERE a.status = 'ADMITTED'
             AND NOT EXISTS (
               SELECT 1 FROM flow_sheet_entries f
                WHERE f.admission_id = a.id
                  AND f.recorded_at >= now() - interval '48 hours'
                  AND f.recorded_at <= now())`,
  },
];

// ═════════════════════════════════════════════════════════════════ SQL 생성

/** 🔴 SELECT 만 만든다. 이 함수가 만드는 문자열에 DML/DDL 이 들어가면 안 된다. */
/**
 * 🔴 `to_char(t,'…OF')` 는 `+09` 를 내놓는다 — JS `new Date()` 가 **파싱하지 못해 NaN 이 되고,
 *    NaN 비교는 전부 false 라 지연 판정이 통째로 조용히 꺼진다.** (이 스크립트를 처음 돌렸을 때
 *    실제로 그렇게 됐다. 가드가 "통과"한 것이 아니라 아무것도 재지 않았던 것이다.)
 *    그래서 오프셋을 `+09:00` 으로 정규화하고, 그래도 못 읽으면 judge 가 **경보를 낸다**.
 */
const isots = (e) =>
  `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS') || regexp_replace(to_char(${e}, 'OF'), '^([+-][0-9]{2})$', '\\1:00')`;

export function buildSql(windowDays) {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 3650) {
    throw new Error(`windowDays 는 1~3650 의 정수여야 한다 (받은 값: ${windowDays})`);
  }
  const ev = AXES.map(
    (a) =>
      `  SELECT '${a.key}'::text AS k, ${a.col} AS t FROM ${a.table}` +
      (a.filter ? ` WHERE ${a.filter}` : ''),
  ).join('\n  UNION ALL\n');

  const tol = POLICY.reversalToleranceSeconds;
  const revs = REVERSALS.map((r) => {
    const gap = `EXTRACT(epoch FROM (${r.earlier} - ${r.later}))`;
    return (
      `  SELECT 'REV'::text, '${r.key}'::text,` +
      ` count(*) FILTER (WHERE ${gap} >= ${tol})::text,` +      // 진짜 역전
      ` count(*) FILTER (WHERE ${gap} < ${tol})::text,` +       // 1초 미만 = 아티팩트
      ` coalesce(round(max(${gap})::numeric, 3)::text, ''),` +  // 최대 격차(초)
      ` ''::text, ''::text` +
      ` FROM ${r.table} WHERE ${r.expr}`
    );
  }).join('\n  UNION ALL\n');

  const probes = PROBES.map(
    (p) =>
      `  SELECT 'PROBE'::text, '${p.key}'::text, (${p.sql})::text, ''::text, ''::text, ''::text, ''::text`,
  ).join('\n  UNION ALL\n');

  return `-- 생성: scripts/data-freshness.mjs (읽기 전용 · SELECT 만)
WITH ev AS (
${ev}
),
gaps AS (
  SELECT k, EXTRACT(epoch FROM (t - lag(t) OVER (PARTITION BY k ORDER BY t))) / 86400.0 AS g
    FROM ev WHERE t IS NOT NULL AND t <= now()
),
gstat AS (
  SELECT k, count(*) AS gn, percentile_disc(0.95) WITHIN GROUP (ORDER BY g) AS p95
    FROM gaps WHERE g IS NOT NULL GROUP BY k
),
asum AS (
  SELECT k,
         count(t) AS total,
         max(t) FILTER (WHERE t <= now()) AS latest,
         count(*) FILTER (WHERE t >= now() - interval '${windowDays} days' AND t <= now()) AS inwin,
         count(*) FILTER (WHERE t > now() + interval '${POLICY.futureToleranceHours} hours') AS fut
    FROM ev GROUP BY k
)
SELECT 'AXIS'::text, a.k, a.total::text, coalesce(${isots('a.latest')}, ''),
       a.inwin::text, a.fut::text, coalesce(round(g.p95::numeric, 3)::text, '')
  FROM asum a LEFT JOIN gstat g ON g.k = a.k
UNION ALL
${revs}
UNION ALL
${probes}
UNION ALL
  SELECT 'META'::text, 'now'::text, ${isots('now()')}, ''::text, ''::text, ''::text, ''::text
;`;
}

// ═════════════════════════════════════════════════════════════════ 파싱

export function parseRows(text) {
  const snap = { now: null, axes: {}, revs: {}, probes: {} };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = line.split('|');
    const kind = f[0];
    if (kind === 'AXIS') {
      snap.axes[f[1]] = {
        total: Number(f[2]),
        latest: f[3] || null,
        inWindow: Number(f[4]),
        future: Number(f[5]),
        gapP95: f[6] === '' ? null : Number(f[6]),
      };
    } else if (kind === 'REV') {
      snap.revs[f[1]] = {
        real: Number(f[2]),
        artifact: Number(f[3]),
        maxGapSec: f[4] === '' ? null : Number(f[4]),
      };
    } else if (kind === 'PROBE') {
      snap.probes[f[1]] = Number(f[2]);
    } else if (kind === 'META' && f[1] === 'now') {
      snap.now = f[2] || null;
    }
  }
  return snap;
}

// ═════════════════════════════════════════════════════════════════ 판정

const DAY = 86_400_000;
const daysBetween = (a, b) => (a - b) / DAY;

/**
 * 🔴 **표시(verdict)와 판정(findings)의 계약.**
 *
 * 표시 라벨을 판정과 따로 대입하면 둘이 갈라진다 — 판정을 꺼도 라벨이 남거나,
 * 라벨만 '정상'으로 바꿔도 아무도 못 잡는다(P17: 근거 없이 안심시킴).
 * 실제로 그 구멍이 **두 번** 뚫렸다: 처음엔 축(axis) 경로, 다음엔 인과쌍(pair) 경로.
 * 그래서 네 섹션 **전부** 여기 계약대로 findings 에서 파생시키고,
 * 성질 검사가 **네 섹션을 모두** 훑는다(한쪽만 보면 다른 쪽이 열린다).
 *
 * 계약: `problem.has(row.verdict) === (그 key 의 findings 가 있는가)`
 */
const SECTION_CONTRACT = {
  axes: {
    types: ['STALE', 'FUTURE', 'AXIS_EMPTY', 'AXIS_MISSING', 'UNPARSABLE_TIME'],
    problem: ['지연', '미래 시각', '지연+미래', '데이터 없음', '시각 해석 실패', '측정 안 됨'],
  },
  pairs: { types: ['PAIR_ZERO', 'PAIR_LAG'], problem: ['모순', '뒤처짐'] },
  revs: { types: ['REVERSAL'], problem: ['위반'] },
  probes: { types: ['PROBE'], problem: ['적중'] },
};

/** 그 key 에 대해, 해당 섹션이 책임지는 유형의 findings 만 골라낸다. */
function findingsFor(findings, section, key) {
  const types = new Set(SECTION_CONTRACT[section].types);
  return findings.filter((f) => f.key === key && types.has(f.type));
}

/** 격차를 사람이 읽는 단위로. 🔴 밀리초를 "0초"로 반올림하면 아티팩트가 진짜처럼 보인다. */
function fmtGap(sec) {
  if (sec < 1) return `${(sec * 1000).toFixed(0)}ms`;
  if (sec < 60) return `${sec.toFixed(0)}초`;
  if (sec < 3600) return `${(sec / 60).toFixed(0)}분`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}시간`;
  return `${(sec / 86400).toFixed(1)}일`;
}

/**
 * 순수 함수. DB 를 모른다 — 스냅샷만 받는다.
 * 그래서 합성 입력으로 **판정 로직 자체를 검증**할 수 있다(`--selftest`).
 */
export function judge(snap, opts = {}) {
  const windowDays = opts.windowDays ?? POLICY.windowDays;
  const findings = [];
  const rows = [];

  /**
   * 🔴 시각을 못 읽으면 **조용히 통과시키지 않는다.** NaN 비교는 전부 false 라서
   *    "위반 없음"처럼 보이지만 실제로는 아무것도 재지 않은 것이다 —
   *    이 스크립트를 처음 돌렸을 때 실제로 그렇게 됐다(`+09` 를 JS 가 못 읽었다).
   */
  const ms = (v, key, where = key) => {
    if (v === null || v === undefined) return null;
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) {
      findings.push({
        sev: '🔴',
        type: 'UNPARSABLE_TIME',
        key,
        msg: `시각을 해석하지 못했다: "${v}" (${where}) — 판정이 조용히 꺼진다. 출력 형식을 확인하라.`,
      });
      return NaN;
    }
    return t;
  };

  const now = snap.now == null ? Date.now() : ms(snap.now, 'META.now');
  if (Number.isNaN(now)) {
    return { windowDays, now: snap.now, findings, axes: [], pairs: [], revs: [], probes: [] };
  }

  for (const a of AXES) {
    const s = snap.axes[a.key];
    if (!s) {
      rows.push({ ...a, verdict: '측정 안 됨', detail: 'SQL 결과에 이 축이 없다' });
      findings.push({
        sev: '🟡',
        type: 'AXIS_MISSING',
        key: a.key,
        msg: `${a.label}: 스냅샷에 결과가 없다(테이블/컬럼이 바뀌었을 수 있다)`,
      });
      continue;
    }

    const latestMs = s.latest ? ms(s.latest, a.key, `${a.table}.${a.col}`) : null;
    if (Number.isNaN(latestMs)) {
      rows.push({ ...a, total: s.total, verdict: '시각 해석 실패', detail: String(s.latest) });
      continue;
    }
    const lagDays = latestMs === null ? null : daysBetween(now, latestMs);

    // ── 지연 예산 산출 (🔴 표본이 없으면 만들어내지 않는다)
    let budget = null;
    let budgetWhy;
    if (a.rarity === 'rare') {
      budgetWhy = '희소 축 — 지연 판정 면제(0 이 정상)';
    } else if (s.total < POLICY.minGapSamples || s.gapP95 === null) {
      budgetWhy = `표본 부족(${s.total} < ${POLICY.minGapSamples}) — **산출 불가**`;
    } else {
      const raw = Math.max(s.gapP95 * POLICY.gapMultiplier, POLICY.lagFloorDays);
      if (raw > POLICY.lagBudgetCapDays) {
        budget = null;
        budgetWhy =
          `p95 간격 ${s.gapP95.toFixed(1)}일 → 예산 ${raw.toFixed(0)}일 > 상한 ` +
          `${POLICY.lagBudgetCapDays}일 — **산출 불가**(정지와 희소를 구분할 수 없다)`;
      } else {
        budget = raw;
        budgetWhy =
          `p95 간격 ${s.gapP95.toFixed(1)}일 × ${POLICY.gapMultiplier}` +
          (s.gapP95 * POLICY.gapMultiplier < POLICY.lagFloorDays
            ? ` → 하한 ${POLICY.lagFloorDays}일 적용`
            : '');
      }
    }

    let detail = '';
    if (latestMs === null) {
      detail = ZERO_AMBIGUITY;
      if (a.rarity !== 'rare') {
        findings.push({
          sev: '🟡',
          type: 'AXIS_EMPTY',
          key: a.key,
          msg: `${a.label}: 이벤트가 한 건도 없다`,
          ambiguity: ZERO_AMBIGUITY,
        });
      }
    } else if (budget !== null && lagDays > budget) {
      detail = `${lagDays.toFixed(0)}일 정지 > 예산 ${budget.toFixed(0)}일 (${budgetWhy})`;
      findings.push({
        sev: '🔴',
        type: 'STALE',
        key: a.key,
        msg: `${a.label}: 최신 ${s.latest?.slice(0, 10)} — ${lagDays.toFixed(0)}일째 정지 (예산 ${budget.toFixed(0)}일)`,
        basis: budgetWhy,
        ambiguity: ZERO_AMBIGUITY,
      });
    }

    // ── 미래 시각 (계획 컬럼은 면제)
    if (a.kind === 'actual' && s.future > 0) {
      findings.push({
        sev: '🔴',
        type: 'FUTURE',
        key: a.key,
        msg: `${a.label}: 이미 일어난 일의 시각이 미래다 — ${s.future}건 (${a.table}.${a.col} > now()+${POLICY.futureToleranceHours}h)`,
      });
    }

    /**
     * 🔴 verdict(표시 라벨)는 **findings(판정 실체)에서 파생**한다. 따로 대입하면
     *    판정을 꺼도 라벨이 남거나 그 반대가 되어 **표시와 판정이 갈라진다** —
     *    그러면 화면이 사실을 말하지 않고, 가드도 그 갈라짐을 못 잡는다.
     */
    const mine = findingsFor(findings, 'axes', a.key);
    const hasStale = mine.some((f) => f.type === 'STALE');
    const hasFuture = mine.some((f) => f.type === 'FUTURE');
    const verdict =
      hasStale && hasFuture ? '지연+미래'
      : hasStale ? '지연'
      : hasFuture ? '미래 시각'
      : mine.some((f) => f.type === 'AXIS_EMPTY') ? '데이터 없음'
      : latestMs === null && a.rarity === 'rare' ? '희소(0건)'
      : budget === null ? (a.rarity === 'rare' ? '희소' : '산출 불가')
      : 'OK';

    rows.push({
      ...a,
      total: s.total,
      latest: s.latest,
      lagDays,
      inWindow: s.inWindow,
      future: s.future,
      gapP95: s.gapP95,
      budget,
      budgetWhy,
      verdict,
      detail,
    });
  }

  // ── 인과쌍 (축 간 모순)
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const pairRows = [];
  for (const p of PAIRS) {
    const up = byKey[p.up];
    const down = byKey[p.down];
    if (!up || !down || up.inWindow === undefined || down.inWindow === undefined) {
      pairRows.push({ ...p, verdict: '측정 안 됨' });
      continue;
    }
    let detail = `${up.inWindow} → ${down.inWindow}`;

    if (up.inWindow >= POLICY.minUpstream && down.inWindow === 0) {
      findings.push({
        sev: '🔴',
        type: 'PAIR_ZERO',
        key: p.key,
        msg:
          `${up.label} 최근 ${windowDays}일 ${up.inWindow}건인데 ` +
          `${down.label} 은 **0건** — ${p.why}`,
        ambiguity: ZERO_AMBIGUITY,
      });
    } else if (up.latest && down.latest) {
      const gap = daysBetween(new Date(up.latest).getTime(), new Date(down.latest).getTime());
      if (gap > p.tatDays) {
        detail += ` · 최신일 ${gap.toFixed(0)}일 격차`;
        findings.push({
          sev: '🟡',
          type: 'PAIR_LAG',
          key: p.key,
          msg:
            `${down.label} 최신일(${down.latest.slice(0, 10)})이 ` +
            `${up.label}(${up.latest.slice(0, 10)})보다 ${gap.toFixed(0)}일 뒤처졌다 ` +
            `(통상 ${p.tatDays}일 이내)`,
          basis: p.tatWhy,
        });
      }
    } else if (up.latest && !down.latest) {
      findings.push({
        sev: '🔴',
        type: 'PAIR_ZERO',
        key: p.key,
        msg: `${up.label} 은 기록이 있는데 ${down.label} 은 **전 기간 0건** — ${p.why}`,
        ambiguity: ZERO_AMBIGUITY,
      });
    }
    /** 🔴 축과 같은 방식 — 라벨은 판정에서 파생된다. 여기서 따로 대입하지 말 것. */
    const mine = findingsFor(findings, 'pairs', p.key);
    const verdict = mine.some((f) => f.type === 'PAIR_ZERO')
      ? '모순'
      : mine.some((f) => f.type === 'PAIR_LAG')
        ? '뒤처짐'
        : 'OK';
    pairRows.push({ ...p, upLabel: up.label, downLabel: down.label, verdict, detail });
  }

  // ── 시각 역전
  const revRows = [];
  for (const r of REVERSALS) {
    const v = snap.revs[r.key];
    if (v === undefined) {
      revRows.push({ ...r, real: null, artifact: null, verdict: '측정 안 됨' });
      continue;
    }
    // 구형 스냅샷(숫자 하나)도 받아들이되, 아티팩트 구분이 없다는 사실을 숨기지 않는다.
    const real = typeof v === 'number' ? v : v.real;
    const artifact = typeof v === 'number' ? null : v.artifact;
    const maxGapSec = typeof v === 'number' ? null : v.maxGapSec;

    if (real > 0) {
      findings.push({
        sev: '🔴',
        type: 'REVERSAL',
        key: r.key,
        msg:
          `시각 역전 — ${r.label}: ${real}건 (${r.table}: ${r.expr}` +
          (maxGapSec != null ? ` · 최대 격차 ${fmtGap(maxGapSec)}` : '') +
          ')',
        basis:
          `격차 ${POLICY.reversalToleranceSeconds}초 이상만 센다` +
          (artifact ? ` — 같은 조건의 ${artifact}건은 1초 미만이라 삽입 순서 아티팩트로 보고 세지 않았다` : ''),
      });
    }
    /** 🔴 라벨은 판정에서 파생. '아티팩트만' 은 위반이 아니지만 **감추지도 않는다**. */
    const mine = findingsFor(findings, 'revs', r.key);
    const verdict = mine.length > 0 ? '위반' : artifact ? '아티팩트만' : 'OK';
    revRows.push({ ...r, real, artifact, maxGapSec, verdict });
  }

  // ── 프로브
  const probeRows = [];
  for (const p of PROBES) {
    const n = snap.probes[p.key];
    if (n === undefined) {
      probeRows.push({ ...p, n: null, verdict: '측정 안 됨' });
      continue;
    }
    if (n > 0) {
      findings.push({
        sev: p.sev,
        type: 'PROBE',
        key: p.key,
        msg: `${p.label}: ${n}건`,
        basis: p.why,
        ambiguity: p.sev === '⚪' ? ZERO_AMBIGUITY : undefined,
      });
    }
    /** 🔴 라벨은 판정에서 파생. */
    const verdict = findingsFor(findings, 'probes', p.key).length > 0 ? '적중' : 'OK';
    probeRows.push({ ...p, n, verdict });
  }

  return { windowDays, now: snap.now, findings, axes: rows, pairs: pairRows, revs: revRows, probes: probeRows };
}

// ═══════════════════════════════════════════════════════════════════ 렌더링

/** 표 정렬용 표시 폭. 한글·CJK 와 이모지(🔴🟡⚪)는 터미널에서 2칸을 먹는다. */
const w = (s) =>
  [...String(s)].reduce(
    (n, c) => n + (/[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60]/.test(c) || c.codePointAt(0) > 0xffff ? 2 : 1),
    0,
  );
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - w(s)));

function table(headers, rowsArr) {
  const widths = headers.map((h, i) => Math.max(w(h), ...rowsArr.map((r) => w(r[i] ?? ''))));
  const line = (cells) => '  ' + cells.map((c, i) => pad(c ?? '', widths[i])).join('  ').trimEnd();
  const out = [line(headers), '  ' + widths.map((n) => '─'.repeat(n)).join('  ')];
  for (const r of rowsArr) out.push(line(r));
  return out.join('\n');
}

const SEV_ORDER = { '🔴': 0, '🟡': 1, '⚪': 2 };

function render(res, { showAll }) {
  const out = [];
  out.push(`# 시점 정합(freshness) 판정 — 관측 창 ${res.windowDays}일 · DB 기준시각 ${res.now ?? '?'}`);
  out.push('');

  const bad = res.findings.slice().sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
  const red = bad.filter((f) => f.sev === '🔴').length;
  const yellow = bad.filter((f) => f.sev === '🟡').length;
  const white = bad.filter((f) => f.sev === '⚪').length;

  out.push(`## 판정 요약 — 🔴 ${red} · 🟡 ${yellow} · ⚪ ${white}`);
  out.push('');
  if (bad.length === 0) {
    out.push('  위반 없음.');
  } else {
    for (const f of bad) {
      out.push(`  ${f.sev} [${f.type}] ${f.msg}`);
      if (f.basis) out.push(`       근거: ${f.basis}`);
      if (f.ambiguity) out.push(`       ⚠ ${f.ambiguity}`);
    }
  }
  out.push('');

  /**
   * 🔴 표식은 "판정 결과"여야 한다. 판정하지 않은 것(희소·산출 불가)에 경고색을 칠하면
   *    거짓 경보가 되고, 진짜 경보가 그 안에 묻힌다.
   */
  const mark = (verdict) => {
    if (verdict === 'OK') return '·';
    if (verdict === '희소' || verdict === '희소(0건)' || verdict === '산출 불가') return '–';
    if (verdict.includes('지연') || verdict.includes('미래') || verdict === '시각 해석 실패') return '🔴';
    return '🟡';
  };

  // ── 축
  const axisRows = res.axes
    .filter((a) => showAll || a.verdict !== 'OK')
    .map((a) => [
      mark(a.verdict),
      a.label,
      `${a.table}.${a.col}`,
      String(a.total ?? '-'),
      a.latest ? a.latest.slice(0, 10) : '없음',
      a.lagDays == null ? '-' : `${a.lagDays.toFixed(0)}일`,
      String(a.inWindow ?? '-'),
      a.budget == null ? (a.rarity === 'rare' ? '면제(희소)' : '산출 불가') : `${a.budget.toFixed(0)}일`,
      a.budgetWhy ?? a.detail ?? '',
    ]);
  const hiddenAxes = res.axes.length - axisRows.length;
  out.push(`## 축별 시점 (${res.axes.length}개 축)`);
  out.push('');
  out.push(
    table(
      ['', '축', '출처', '전체', '최신일', '정지', `창 ${res.windowDays}일`, '지연 예산', '예산 근거'],
      axisRows,
    ),
  );
  if (hiddenAxes > 0) {
    out.push('');
    out.push(`  🔴 정상 ${hiddenAxes}개 축은 **접었다**(잘랐다고 말한다). 전부 보려면 \`--all\`.`);
  }
  out.push('');

  // ── 인과쌍
  out.push('## 축 간 인과쌍 (상류가 살아 있는데 하류가 죽었는가)');
  out.push('');
  out.push(
    table(
      ['', '상류 → 하류', `창 ${res.windowDays}일`, '판정'],
      res.pairs
        .filter((p) => showAll || p.verdict !== 'OK')
        .map((p) => [
          p.verdict === 'OK' ? '·' : p.verdict === '모순' ? '🔴' : '🟡',
          `${p.upLabel ?? p.up} → ${p.downLabel ?? p.down}`,
          p.detail ?? '',
          p.verdict,
        ]),
    ),
  );
  const hiddenPairs = res.pairs.length - res.pairs.filter((p) => showAll || p.verdict !== 'OK').length;
  if (hiddenPairs > 0) out.push(`\n  정상 ${hiddenPairs}쌍은 접었다(\`--all\`).`);
  out.push('');

  // ── 역전 · 프로브
  const revBad = res.revs.filter((r) => showAll || r.verdict !== 'OK');
  out.push(`## 시각 역전 · 맞춤 프로브  (역전은 격차 ${POLICY.reversalToleranceSeconds}초 이상만 센다)`);
  out.push('');
  out.push(
    table(
      ['', '항목', '역전', '아티팩트(<1초)', '최대 격차'],
      [
        ...revBad.map((r) => [
          r.verdict === 'OK' ? '·' : r.verdict === '위반' ? '🔴' : '·',
          r.label,
          String(r.real ?? '-'),
          r.artifact == null ? '-' : String(r.artifact),
          r.maxGapSec == null ? '-' : fmtGap(r.maxGapSec),
        ]),
        ...res.probes
          .filter((p) => showAll || p.verdict !== 'OK')
          .map((p) => [p.verdict === 'OK' ? '·' : p.sev, p.label, String(p.n ?? '-'), '', '']),
      ],
    ),
  );
  const artifacts = res.revs.reduce((n, r) => n + (r.artifact ?? 0), 0);
  if (artifacts > 0) {
    out.push('');
    out.push(
      `  🔴 ${artifacts}건은 격차가 ${POLICY.reversalToleranceSeconds}초 미만이라 ` +
        '**삽입 순서 아티팩트로 보고 세지 않았다**(잘랐다고 말한다).',
    );
  }
  const hiddenRev =
    res.revs.length - revBad.length +
    (res.probes.length - res.probes.filter((p) => showAll || p.verdict !== 'OK').length);
  if (hiddenRev > 0) out.push(`\n  정상 ${hiddenRev}항목은 접었다(\`--all\`).`);
  out.push('');

  out.push('## 이 도구가 판정하지 않는 것');
  out.push('');
  out.push(`  🔴 ${ZERO_AMBIGUITY}`);
  out.push('  🔴 아래 시각 역전 쌍은 **원리적으로 무효라 판정에서 뺐다**(`--rules` 에 근거):');
  for (const [what] of EXCLUDED_REVERSALS) out.push(`     - ${what}`);
  out.push('  🔴 아래는 `infra/scripts/data-integrity-scan.sql` 이 정본이다 — 여기서 다시 세지 않는다:');
  for (const [where, what] of DELEGATED) out.push(`     - ${what}  (${where})`);
  out.push('');
  return out.join('\n');
}

function printRules() {
  const out = [];
  out.push('# 시점 정합 판정 규칙 (정본: scripts/data-freshness.mjs)');
  out.push('');
  out.push('## 정책 상수와 근거');
  out.push('');
  out.push(`- 관측 창 기본 ${POLICY.windowDays}일 (\`--days\` 로 변경)`);
  out.push(`- 지연 예산 = **p95(그 축의 과거 이벤트 간 간격) × ${POLICY.gapMultiplier}**, 하한 ${POLICY.lagFloorDays}일`);
  out.push(`  - 🔴 임계값을 사람이 감으로 정하지 않는다. 축 자신의 과거가 근거다.`);
  out.push(`  - 하한 ${POLICY.lagFloorDays}일 근거: 설·추석 연휴가 주말과 붙으면 최장 5일 무진료가 실제로 발생한다.`);
  out.push(`- 간격 통계 최소 표본 ${POLICY.minGapSamples}건. 미만이면 임계값을 **만들지 않고 "산출 불가"** 로 남긴다.`);
  out.push(`- 지연 예산 상한 ${POLICY.lagBudgetCapDays}일. 이보다 넓으면 "정지"와 "원래 드묾"을 구분할 수 없으므로 **판정하지 않는다**.`);
  out.push(`- 인과쌍 최소 상류 ${POLICY.minUpstream}건. 미만이면 판정하지 않는다(하류가 다음 창으로 넘어갔을 수 있다).`);
  out.push(`- 미래 시각 허용 오차 ${POLICY.futureToleranceHours}시간 (data-integrity-scan.sql 38번과 동일).`);
  out.push(`- 시각 역전 최소 격차 ${POLICY.reversalToleranceSeconds}초. 실측 근거: 아티팩트 32건이 **전부 정확히 1ms**,`);
  out.push(`  진짜 역전은 900초·5,015초 — **1초~60초 구간은 0건**이라 분포가 완전히 갈라진다.`);
  out.push(`  🔴 걸러낸 건수는 침묵시키지 않고 출력에 표시한다.`);
  out.push('');
  out.push('## 축 (kind: actual=이미 일어난 일 / plan=예정 · rarity: rare=지연 판정 면제)');
  out.push('');
  out.push(
    table(
      ['축', '출처', '필터', 'kind', 'rarity', '비고'],
      AXES.map((a) => [a.label, `${a.table}.${a.col}`, a.filter ?? '', a.kind, a.rarity, a.why ?? '']),
    ),
  );
  out.push('');
  out.push('🔴 **희소 축은 지연 판정을 하지 않는다.** 사망·심정지·MCI·대량수혈은 원래 드물어서,');
  out.push('   그 0 을 경보하면 거짓 경보가 쌓이고 **진짜 경보가 묻힌다.**');
  out.push('');
  out.push('## 인과쌍과 근거');
  out.push('');
  for (const p of PAIRS) {
    out.push(`### ${p.key}`);
    out.push(`- 모순 조건: 상류(${p.up}) ≥ ${POLICY.minUpstream}건인데 하류(${p.down}) **0건** → 🔴`);
    out.push(`  - 근거: ${p.why}`);
    out.push(`- 뒤처짐 조건: 하류 최신일이 상류보다 ${p.tatDays}일 초과 뒤처짐 → 🟡`);
    out.push(`  - 근거: ${p.tatWhy}`);
    out.push('');
  }
  out.push('🔴 **비율 임계값은 쓰지 않는다.** "오더 100건에 결과 30건이면 정상인가"에 근거를 댈 수 없다.');
  out.push('   0 인가 아닌가만 본다 — 그건 규모와 무관한 논리적 모순이다.');
  out.push('');
  out.push('## 시각 역전 (여기서 세는 것)');
  out.push('');
  out.push(table(['항목', '조건'], REVERSALS.map((r) => [r.label, `${r.table}: ${r.expr}`])));
  out.push('');
  out.push('## 🔴 판정에서 뺀 시각 역전 쌍 (원리적으로 무효 — 되살리지 말 것)');
  out.push('');
  out.push('`created_at` 은 **행이 DB 에 들어온 시각**이고 `signed_at`·`recorded_at`·`paid_at` 은');
  out.push('**임상·업무 시각**이다. 서로 다른 시간축이라 대소 비교가 사실을 뜻하지 않는다.');
  out.push('실측(2026-08-18)이 이를 확정한다 — 간호기록의 같은 비교는 중앙값 **27.9일** 격차를 만든다.');
  out.push('즉 tolerance 로는 못 거른다. **쌍 자체를 빼는 것이 정답이다.**');
  out.push('');
  for (const [what, why] of EXCLUDED_REVERSALS) out.push(`- **${what}** — ${why}`);
  out.push('');
  out.push('## 위임 — 여기서 세지 않는 것 (정본이 둘이 되면 갈라진다)');
  out.push('');
  out.push(table(['항목', '정본'], DELEGATED.map(([where, what]) => [what, where])));
  out.push('');
  out.push('## 맞춤 프로브');
  out.push('');
  for (const p of PROBES) out.push(`- ${p.sev} **${p.label}** — ${p.why}`);
  out.push('');
  return out.join('\n');
}

function printWhy() {
  return `# "0 건" 을 결함으로 단정하기 전에

🔴 ${ZERO_AMBIGUITY}

이 저장소에서 ③(쓰기 경로 막힘)을 ①(시드 부재)로 오판한 사례가 **3건** 나왔다
(배너 '추가' 버튼에 onClick 부재 · 등록 폼 미렌더 2건). 그래서 순서를 정해 둔다.

1. **쓰기 경로를 눌러 본다.** 해당 화면에서 실제로 한 건 만들어 본다.
   - 만들어지면 → ① 시드 부재. 데이터 문제지 코드 문제가 아니다.
   - 버튼이 없거나 폼이 안 뜨면 → ② 미배선.
   - 눌렀는데 성공처럼 보이고 행이 안 생기면 → ③ **쓰기 경로 막힘**(가장 위험).
     · 전역 \`whitelist:true\` 가 DTO 에 없는 키를 조용히 지웠을 수 있다(성공 응답 + 데이터 소실).
     · 교차 타입·인터페이스·\`Partial<>\` DTO 는 ValidationPipe 가 통째로 스킵된다.
2. **API 로그·감사 로그를 본다.** 시도 자체가 없으면 FE, 시도가 400/500 이면 BE.
3. **시드 생성기를 본다**(\`apps/api/prisma/seed.ts\`·\`seeds/**\`).
   🔴 DB 만 고치면 다음 시드에서 되살아난다.
4. **롤포워드를 의심한다**(\`dev.demoDateRoll\`). 축마다 최신일이 다른 것은 그 때문일 수 있다.
   🔴 다만 **"오늘 0" 자체가 결함은 아니다. 진짜 결함은 같은 창 안에서 축끼리 모순이 나는 지점이다** —
   이 도구의 "인과쌍" 절이 그것만 골라낸다.

🔴 그리고 반대 방향도 사실이 아니다: **롤포워드는 허구 실적을 만든다.**
   외래 COMPLETED 462건 중 456건이 호출·진료시작·Encounter 가 전부 없는 건이었다.
`;
}

// ═════════════════════════════════════════════════════════════════ 셀프테스트

/**
 * 🔴 가드는 **결함을 재주입해 실패해야** 가드다. 여기서는 판정 로직에
 *    "정상 스냅샷"과 "결함을 심은 스냅샷"을 각각 넣어, 후자에서만 잡히는지 본다.
 *    (같은 검증을 vitest 로도 돌린다: apps/api/test/architecture/data-freshness-judge.spec.ts)
 */
export function healthySnapshot(nowIso = '2026-08-18T12:00:00+09:00') {
  const now = new Date(nowIso).getTime();
  const iso = (d) => new Date(now - d * DAY).toISOString();
  const axes = {};
  for (const a of AXES) {
    axes[a.key] = {
      total: a.rarity === 'rare' ? 3 : 400,
      latest: iso(1),
      inWindow: a.rarity === 'rare' ? 1 : 50,
      future: 0,
      // p95 간격 1일 → 예산 = max(1×2, 7) = 7일
      gapP95: a.rarity === 'rare' ? null : 1,
    };
  }
  const revs = Object.fromEntries(REVERSALS.map((r) => [r.key, { real: 0, artifact: 0, maxGapSec: null }]));
  const probes = Object.fromEntries(PROBES.map((p) => [p.key, 0]));
  return { now: nowIso, axes, revs, probes };
}

const SELFTESTS = [
  {
    name: '정상 스냅샷에서는 아무것도 잡히지 않는다',
    build: (s) => s,
    expect: (r) => (r.findings.length === 0 ? null : `위반 ${r.findings.length}건이 잡혔다: ${r.findings.map((f) => f.type + ':' + f.key).join(', ')}`),
  },
  {
    name: '축 정지(STALE) — 예산 7일을 넘긴 축을 잡는다',
    build: (s) => {
      s.axes['lab_results'].latest = new Date(new Date(s.now).getTime() - 21 * DAY).toISOString();
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'STALE' && f.key === 'lab_results')
        ? null
        : 'STALE:lab_results 를 못 잡았다',
  },
  {
    name: '축 정지 — 예산 안(6일)은 잡지 않는다(거짓 경보 방지)',
    build: (s) => {
      s.axes['lab_results'].latest = new Date(new Date(s.now).getTime() - 6 * DAY).toISOString();
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'STALE') ? '6일 정지를 경보했다(거짓 경보)' : null,
  },
  {
    name: '희소 축은 전 기간 0건이어도 경보하지 않는다',
    build: (s) => {
      for (const a of AXES.filter((x) => x.rarity === 'rare')) {
        s.axes[a.key] = { total: 0, latest: null, inWindow: 0, future: 0, gapP95: null };
      }
      return s;
    },
    expect: (r) =>
      r.findings.length === 0 ? null : `희소 축 0건에 경보가 났다: ${r.findings.map((f) => f.key).join(', ')}`,
  },
  {
    // 🔴 위 케이스만으로는 부족했다. rare 면제를 코드에서 지워도 통과했다 —
    //    표본이 0 이라 "산출 불가" 로 빠져 **다른 이유로** 통과한 것이다(가드가 헛돈 11번째 사례).
    //    그래서 표본은 충분하고 간격도 촘촘한데 오래 멈춘 희소 축을 따로 넣는다.
    name: '🔴 희소 축은 표본이 충분해도 지연 판정하지 않는다 (rare 면제가 살아 있는지)',
    build: (s) => {
      s.axes['critical_value_alerts'] = {
        total: 300,
        latest: new Date(new Date(s.now).getTime() - 60 * DAY).toISOString(),
        inWindow: 0,
        future: 0,
        gapP95: 0.5, // 면제가 없으면 예산 7일 → 60일 정지는 반드시 STALE 이 된다
      };
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'STALE' && f.key === 'critical_value_alerts')
        ? '희소 축을 지연으로 경보했다(rare 면제가 꺼져 있다)'
        : null,
  },
  {
    // 🔴 rare 면제는 두 갈래다(지연 예산 · 전 기간 0건). 위 케이스는 앞 갈래만 덮는다.
    name: '🔴 희소 축의 "전 기간 0건"도 경보하지 않는다 (AXIS_EMPTY 면제가 살아 있는지)',
    build: (s) => {
      s.axes['deaths'] = { total: 0, latest: null, inWindow: 0, future: 0, gapP95: null };
      // 대조군: 상시 축이 0건이면 반드시 경보가 나야 한다(면제가 전역으로 새지 않았는지).
      s.axes['nursing_notes'] = { total: 0, latest: null, inWindow: 0, future: 0, gapP95: null };
      return s;
    },
    expect: (r) => {
      if (r.findings.some((f) => f.type === 'AXIS_EMPTY' && f.key === 'deaths'))
        return '희소 축의 0건을 경보했다';
      return r.findings.some((f) => f.type === 'AXIS_EMPTY' && f.key === 'nursing_notes')
        ? null
        : '대조군(상시 축 0건)을 경보하지 않았다 — 면제가 전역으로 새고 있다';
    },
  },
  {
    name: '인과쌍 모순 — 상류 살아 있는데 하류 0건을 잡는다',
    build: (s) => {
      s.axes['orders.pharmacy'].inWindow = 14;
      s.axes['dispensings'].inWindow = 0;
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'PAIR_ZERO' && f.key === 'pharmacy order→dispensing')
        ? null
        : 'PAIR_ZERO(약제 오더→조제) 를 못 잡았다',
  },
  {
    name: `인과쌍 — 상류가 최소 건수(${POLICY.minUpstream}) 미만이면 판정하지 않는다`,
    build: (s) => {
      s.axes['orders.pharmacy'].inWindow = POLICY.minUpstream - 1;
      s.axes['dispensings'].inWindow = 0;
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'PAIR_ZERO') ? '표본 부족인데 모순으로 단정했다' : null,
  },
  {
    name: '인과쌍 뒤처짐 — 하류 최신일이 TAT 를 넘어 뒤처지면 잡는다',
    build: (s) => {
      s.axes['dispensings'].latest = new Date(new Date(s.now).getTime() - 5 * DAY).toISOString();
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'PAIR_LAG' && f.key === 'pharmacy order→dispensing')
        ? null
        : 'PAIR_LAG(약제 오더→조제) 를 못 잡았다',
  },
  {
    name: '미래 시각 — actual 컬럼의 미래 이벤트를 잡는다',
    build: (s) => {
      s.axes['waiting_queue'].future = 2;
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'FUTURE' && f.key === 'waiting_queue')
        ? null
        : 'FUTURE:waiting_queue 를 못 잡았다',
  },
  {
    name: '🔴 미래 시각 — plan 컬럼(예약 예정)은 잡지 않는다(거짓 경보 방지)',
    build: (s) => {
      s.axes['appointments'].future = 120;
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'FUTURE')
        ? '예약의 미래 시각을 결함으로 경보했다(계획 컬럼은 미래가 정상)'
        : null,
  },
  {
    name: '시각 역전을 잡는다',
    build: (s) => {
      s.revs['er.triage<arrival'] = { real: 4, artifact: 0, maxGapSec: 1800 };
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'REVERSAL' && f.key === 'er.triage<arrival')
        ? null
        : 'REVERSAL:er.triage<arrival 을 못 잡았다',
  },
  {
    // 🔴 실제로 난 거짓 경보. `encounters.signed_at < created_at` 30건이 전부 1ms 였다.
    name: '🔴 1초 미만 역전은 아티팩트로 보고 경보하지 않는다 (32건 거짓 경보 재발 방지)',
    build: (s) => {
      s.revs['er.triage<arrival'] = { real: 0, artifact: 30, maxGapSec: 0.001 };
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'REVERSAL')
        ? '1ms 역전을 진짜 역전으로 경보했다(거짓 경보는 진짜 경보를 죽인다)'
        : null,
  },
  {
    name: '🔴 걸러낸 아티팩트 건수를 침묵시키지 않는다 (잘랐으면 잘랐다고 말한다)',
    build: (s) => {
      s.revs['er.triage<arrival'] = { real: 0, artifact: 30, maxGapSec: 0.001 };
      return s;
    },
    expect: (r) => {
      const row = r.revs.find((x) => x.key === 'er.triage<arrival');
      if (row.artifact !== 30) return `아티팩트 건수가 결과에 남지 않았다: ${row.artifact}`;
      return row.verdict === '아티팩트만' ? null : `verdict 가 아티팩트를 감췄다: ${row.verdict}`;
    },
  },
  {
    name: '진짜 역전과 아티팩트가 섞여 있으면 진짜만 세고 아티팩트는 함께 알린다',
    build: (s) => {
      s.revs['wq.call<checkin'] = { real: 1, artifact: 12, maxGapSec: 5015 };
      return s;
    },
    expect: (r) => {
      const f = r.findings.find((x) => x.type === 'REVERSAL' && x.key === 'wq.call<checkin');
      if (!f) return '진짜 역전 1건을 못 잡았다';
      if (!/1건/.test(f.msg)) return `건수가 진짜만 세지 않았다: ${f.msg}`;
      return /12건/.test(f.basis ?? '') ? null : `아티팩트 12건을 알리지 않았다: ${f.basis}`;
    },
  },
  {
    // 🔴 이 구멍은 **두 번** 뚫렸다.
    //    1차: 축(axis) 경로에서 verdict 를 따로 대입 → 라벨만 바꿔도 아무도 못 잡음.
    //    2차: 축만 고치고 "고쳤다"고 보고했는데 **인과쌍(pair) 경로는 그대로**였다
    //         (코디네이터가 692행 `verdict='뒤처짐'→'정상'` 재주입으로 뚫었다).
    //    그래서 이제 성질 검사는 **네 섹션을 모두** 훑는다. 한쪽만 보면 다른 쪽이 열린다.
    name: '🔴 표시(verdict)와 판정(findings)이 갈라지지 않는다 — 축·인과쌍·역전·프로브 전부',
    build: (s) => {
      // 네 섹션 모두에서 실제로 소견이 나오도록 결함을 심는다.
      // (결함이 없으면 "전부 OK" 라서 검사가 아무것도 확인하지 못하고 통과한다.)
      s.axes['lab_results'].latest = new Date(new Date(s.now).getTime() - 21 * DAY).toISOString();
      s.axes['waiting_queue'].future = 2;
      s.axes['nursing_notes'] = { total: 0, latest: null, inWindow: 0, future: 0, gapP95: null };
      s.axes['orders.pharmacy'].inWindow = 14;
      s.axes['dispensings'].inWindow = 0; // PAIR_ZERO
      s.axes['imaging_results'].latest = new Date(new Date(s.now).getTime() - 9 * DAY).toISOString(); // PAIR_LAG
      s.revs['wq.call<checkin'] = { real: 1, artifact: 3, maxGapSec: 5015 };
      s.probes['admitted.no_nursing_note_48h'] = 5;
      return s;
    },
    expect: (r) => {
      // 🔴 섹션 목록을 여기 손으로 적으면 한 줄 지우는 것만으로 가드가 죽는다.
      //    계약(SECTION_CONTRACT)에서 파생한다 — 섹션을 빼려면 계약을 고쳐야 하고,
      //    계약의 키 집합은 vitest 가 따로 못박는다.
      const sections = Object.keys(SECTION_CONTRACT);

      // 전제 확인 — 네 섹션 전부에서 소견이 실제로 나와야 이 검사가 의미를 갖는다.
      for (const name of sections) {
        const types = SECTION_CONTRACT[name].types;
        if (!r.findings.some((f) => types.includes(f.type))) {
          return `${name} 섹션에서 소견이 하나도 안 나왔다 — 이 검사가 헛돈다(전제 붕괴)`;
        }
        if (!Array.isArray(r[name]) || r[name].length === 0) {
          return `${name} 섹션의 표 행이 없다 — 계약과 결과가 어긋난다`;
        }
      }

      // ① 소견 → 표. 요약에만 뜨고 표에는 안 뜨는 소견이 있으면 화면이 갈라진다.
      for (const f of r.findings) {
        if (f.key === 'META.now') continue; // 전역 소견(축이 아니라 DB 기준시각)
        const owners = sections.filter((n) => SECTION_CONTRACT[n].types.includes(f.type));
        if (owners.length !== 1) {
          return `소견 유형 ${f.type} 이 ${owners.length}개 섹션에 속한다 — 요약과 표가 갈라진다`;
        }
        const row = r[owners[0]].find((x) => x.key === f.key);
        if (!row) return `${f.type}:${f.key} 소견에 대응하는 표 행이 없다`;
        if (!SECTION_CONTRACT[owners[0]].problem.includes(row.verdict)) {
          return `${owners[0]}/${f.key}: 소견 ${f.type} 이 있는데 표는 "${row.verdict}" 라고 말한다`;
        }
      }

      // ② 표 → 소견. 문제 라벨인데 판정이 없으면 거짓 경보다.
      for (const name of sections) {
        const problem = new Set(SECTION_CONTRACT[name].problem);
        for (const row of r[name]) {
          const hasFinding = findingsFor(r.findings, name, row.key).length > 0;
          if (problem.has(row.verdict) !== hasFinding) {
            return (
              `${name}/${row.key}: verdict="${row.verdict}" 인데 ` +
              `판정 ${hasFinding ? '있음' : '없음'} — 표시와 판정이 갈라졌다`
            );
          }
        }
      }
      return null;
    },
  },
  {
    name: '🔴 created_at 을 임상 시각과 비교하는 쌍은 등재되어 있지 않다 (되살리면 187건 거짓 경보)',
    build: (s) => s,
    expect: () => {
      const bad = REVERSALS.filter((r) => r.earlier === 'created_at' || r.later === 'created_at');
      if (bad.length > 0) return `created_at 비교쌍이 되살아났다: ${bad.map((r) => r.key).join(', ')}`;
      return EXCLUDED_REVERSALS.length >= 3 ? null : '뺀 쌍의 근거 목록이 사라졌다';
    },
  },
  {
    name: '프로브 적중을 잡는다',
    build: (s) => {
      s.probes['admitted.no_nursing_note_48h'] = 5;
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'PROBE' && f.key === 'admitted.no_nursing_note_48h')
        ? null
        : 'PROBE:간호기록 공백을 못 잡았다',
  },
  {
    name: '표본 부족 축은 "산출 불가"로 남기고 경보하지 않는다',
    build: (s) => {
      s.axes['surgeries'] = {
        total: POLICY.minGapSamples - 1,
        latest: new Date(new Date(s.now).getTime() - 200 * DAY).toISOString(),
        inWindow: 0,
        future: 0,
        gapP95: null,
      };
      return s;
    },
    expect: (r) => {
      if (r.findings.some((f) => f.type === 'STALE' && f.key === 'surgeries'))
        return '표본이 없는데 지연으로 단정했다';
      const row = r.axes.find((a) => a.key === 'surgeries');
      return row.verdict === '산출 불가' ? null : `verdict 가 "산출 불가" 가 아니다: ${row.verdict}`;
    },
  },
  {
    name: '축이 통째로 사라지면(테이블/컬럼 변경) 조용히 통과하지 않는다',
    build: (s) => {
      delete s.axes['dispensings'];
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'AXIS_MISSING' && f.key === 'dispensings')
        ? null
        : '사라진 축을 조용히 넘겼다',
  },
  {
    name: `🔴 지연 예산이 상한(${POLICY.lagBudgetCapDays}일)을 넘으면 초록으로 칠하지 않는다`,
    build: (s) => {
      // p95 간격 92일 → 예산 184일. 이런 축은 "정지"와 "원래 드묾"을 구분할 수 없다.
      s.axes['checkup_visits'] = {
        total: 20,
        latest: new Date(new Date(s.now).getTime() - 39 * DAY).toISOString(),
        inWindow: 0,
        future: 0,
        gapP95: 92,
      };
      return s;
    },
    expect: (r) => {
      const row = r.axes.find((a) => a.key === 'checkup_visits');
      if (row.verdict !== '산출 불가') return `verdict 가 "산출 불가" 가 아니다: ${row.verdict}`;
      return r.findings.some((f) => f.type === 'STALE' && f.key === 'checkup_visits')
        ? '구분할 수 없는 축을 지연으로 단정했다'
        : null;
    },
  },
  {
    name: '진료가 있는데 수납이 창 안에서 0 이면 잡는다(중간 축이 얇아도)',
    build: (s) => {
      s.axes['encounters'].inWindow = 84;
      s.axes['billings'].inWindow = 3;
      s.axes['billings.paid'].inWindow = 0;
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'PAIR_ZERO' && f.key === 'encounter→payment')
        ? null
        : 'PAIR_ZERO(진료→수납) 를 못 잡았다',
  },
  {
    // 🔴 이 스크립트가 처음 돌 때 실제로 밟은 함정. psql `OF` 가 `+09` 를 주는데
    //    JS 가 못 읽어 NaN 이 됐고, NaN 비교는 전부 false 라 **지연 판정이 통째로 꺼진 채**
    //    "위반 없음"처럼 보였다. 재발하면 반드시 실패해야 한다.
    name: '🔴 시각을 못 읽으면 조용히 통과하지 않는다 (NaN 무음 실패 재발 방지)',
    build: (s) => {
      s.axes['encounters'].latest = '2026-08-05T09:00:00+09'; // 오프셋에 분이 없다 = JS 파싱 실패
      return s;
    },
    expect: (r) =>
      r.findings.some((f) => f.type === 'UNPARSABLE_TIME' && f.key === 'encounters')
        ? null
        : '해석 불가 시각을 조용히 넘겼다(지연 판정이 꺼진 채 "정상"으로 보인다)',
  },
  {
    name: '🔴 DB 기준시각을 못 읽으면 판정 자체를 포기한다(추측하지 않는다)',
    build: (s) => {
      s.now = '2026-08-18T13:46:39+09';
      return s;
    },
    expect: (r) => {
      if (!r.findings.some((f) => f.type === 'UNPARSABLE_TIME' && f.key === 'META.now'))
        return 'META.now 해석 실패를 경보하지 않았다';
      return r.axes.length === 0 ? null : '기준시각을 모르는데 축 판정을 계속했다';
    },
  },
  {
    name: '생성된 SQL 이 JS 가 읽을 수 있는 오프셋(+09:00)을 만든다',
    build: (s) => s,
    expect: () =>
      /regexp_replace\(to_char\([^)]*'OF'\), '\^\(\[\+-\]\[0-9\]\{2\}\)\$', '\\1:00'\)/.test(buildSql(30))
        ? null
        : 'SQL 이 오프셋을 +09:00 으로 정규화하지 않는다 — JS 가 NaN 을 받는다',
  },
  {
    name: 'SQL 은 SELECT 만 만든다(DML/DDL 금지)',
    build: (s) => s,
    expect: () => {
      const sql = buildSql(30);
      const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|COPY)\b/i;
      return forbidden.test(sql) ? `금지 키워드가 SQL 에 있다: ${sql.match(forbidden)[0]}` : null;
    },
  },
];

export function runSelftest() {
  const fails = [];
  for (const t of SELFTESTS) {
    const snap = t.build(healthySnapshot());
    const res = judge(snap);
    const err = t.expect(res);
    if (err) fails.push(`${t.name} → ${err}`);
  }
  return fails;
}

export {
  AXES, PAIRS, REVERSALS, EXCLUDED_REVERSALS, PROBES, POLICY,
  SELFTESTS, DELEGATED, ZERO_AMBIGUITY, SECTION_CONTRACT,
};

// ═══════════════════════════════════════════════════════════════════════ CLI

function isMain() {
  try {
    return process.argv[1] ? import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href : false;
  } catch {
    return false;
  }
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };

  if (has('--rules')) {
    console.log(printRules());
    process.exit(0);
  }
  if (has('--why')) {
    console.log(printWhy());
    process.exit(0);
  }

  const windowDays = Number(val('--days', String(POLICY.windowDays)));
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    console.error(`--days 는 1 이상의 정수여야 한다 (받은 값: ${val('--days', '')})`);
    process.exit(2);
  }

  if (has('--selftest')) {
    const fails = runSelftest();
    if (fails.length === 0) {
      console.log(`OK — 판정 로직 셀프테스트 ${SELFTESTS.length}건 전부 통과.`);
      process.exit(0);
    }
    console.error(`FAIL — 셀프테스트 ${fails.length}/${SELFTESTS.length} 건 실패:\n`);
    for (const f of fails) console.error('  ' + f);
    process.exit(1);
  }

  const sql = buildSql(windowDays);
  if (has('--sql')) {
    console.log(sql);
    process.exit(0);
  }

  const DEFAULT_PSQL =
    'ssh -p 819 -o BatchMode=yes -o ConnectTimeout=20 deploy@198.51.100.73 ' +
    '"docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -X -tA -f -"';
  const cmd = process.env.FRESHNESS_PSQL || DEFAULT_PSQL;

  let raw;
  try {
    raw = execFileSync('/bin/sh', ['-c', cmd], {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error('DB 조회 실패 — 판정하지 않는다(모르면 침묵한다).');
    console.error(`  명령: ${cmd}`);
    console.error(`  ${(e.stderr || e.message || '').toString().trim().split('\n').slice(0, 6).join('\n  ')}`);
    console.error('  FRESHNESS_PSQL 로 접속 명령을 바꿀 수 있다(stdin 으로 SQL 을 받아 -tA 로 출력).');
    process.exit(2);
  }

  const snap = parseRows(raw);
  if (!snap.now || Object.keys(snap.axes).length === 0) {
    console.error('DB 응답을 해석하지 못했다 — 판정하지 않는다. (psql 이 -tA 형식으로 출력했는지 확인)');
    process.exit(2);
  }

  const res = judge(snap, { windowDays });

  if (has('--json')) {
    console.log(JSON.stringify({ ...res, policy: POLICY, zeroAmbiguity: ZERO_AMBIGUITY }, null, 2));
  } else {
    console.log(render(res, { showAll: has('--all') }));
  }

  if (has('--check')) {
    const red = res.findings.filter((f) => f.sev === '🔴').length;
    const yellow = res.findings.filter((f) => f.sev === '🟡').length;
    const fail = red > 0 || (has('--with-warn') && yellow > 0);
    if (fail) {
      console.error(
        `\nFAIL — 시점 정합 위반 🔴 ${red}건` + (has('--with-warn') ? ` · 🟡 ${yellow}건` : ''),
      );
      process.exit(1);
    }
    console.log(`\nOK — 🔴 위반 없음${yellow > 0 ? ` (🟡 ${yellow}건은 --with-warn 에서만 실패)` : ''}.`);
  }
  process.exit(0);
}
