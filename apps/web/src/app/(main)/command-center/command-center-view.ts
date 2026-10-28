import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
/**
 * 통합 상황판 표시 규칙 — 순수 로직.
 *
 * 서버(`/command-center/summary`)는 섹션당 5~9개 지표를 주는데 화면은 2~3개만 쓰고 있었다.
 * "무엇을 크게 보여주고(대표), 무엇을 붉게 세우고(경보), 나머지를 어떤 순서로 늘어놓는가"를
 * 여기서 한 번만 정한다 — 카드마다 조건문이 흩어지면 지표가 늘 때 표시가 어긋난다.
 *
 * 원칙:
 *  - 서버가 준 값은 **버리지 않는다**(모르는 키도 라벨 없이 표시하지 않고 그대로 이름을 낸다).
 *  - 경보는 "지금 사람이 움직여야 하는가"만 붉게 — 단순 대기 수치는 경보가 아니다.
 *  - 값이 없는 지표(null)는 '—' 로 두고 0 과 구분한다(측정 안 됨 ≠ 0).
 */

export type Tone = 'normal' | 'warn' | 'danger';

export interface FieldView {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  /** 값이 0/없음이라 굳이 눈에 띌 필요 없는 항목(흐리게) */
  muted?: boolean;
  /** FIELDS 에 라벨이 없어 영문 키로 표시 중 — 등재 대상(가드 테스트가 잡는다) */
  unregistered?: boolean;
}

export interface BoardView {
  primary: { key: string; label: string; value: string };
  alert?: { label: string; value: number };
  fields: FieldView[];
}

export interface ActionItem {
  key: string;
  /** 이 조치가 속한 보드(카드 상태 판정에 쓴다) */
  section: string;
  label: string;
  count: number;
  tone: Exclude<Tone, 'normal'>;
  href: string;
  /** 왜 지금 조치인가 */
  why: string;
}

const n = (s: Record<string, unknown>, k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : 0);
const has = (s: Record<string, unknown>, k: string) => s[k] !== undefined && s[k] !== null;

export const fmtInt = (v: number) => v.toLocaleString('ko-KR');
export const fmtMoney = (v: number) => `${Math.round(v / 10000).toLocaleString('ko-KR')}만원`;
const pct = (v: number) => `${v}%`;

/** 섹션별 지표 정의 — 라벨·서식·경보 기준(정본) */
interface FieldDef {
  key: string;
  label: string;
  fmt?: (v: number) => string;
  /** 몇 이상이면 주의/위험인가 */
  warnAt?: number;
  dangerAt?: number;
}

const FIELDS: Record<string, FieldDef[]> = {
  nursing: [
    { key: 'medsOverdue', label: '투약 지연', warnAt: 1, dangerAt: 3 },
    { key: 'unsignedNotes', label: '미서명 기록', warnAt: 1 },
    { key: 'isolated', label: '격리 중' },
    { key: 'handoffPending', label: '인계 대기', warnAt: 1 },
    // 2026-10-04 스테이션 보드 인계 메모 — 직전·이번 근무조 창(위 '인계 대기'는 기간 없는 누적 미확인)
    { key: 'handoffsInWindowPending', label: '근무조 인계 미확인', warnAt: 1 },
    { key: 'handoffsInWindow', label: '근무조 인계' },
    // 이번 근무조 기록 유무(병동 근무조 마감) — 기록이 하나도 없는 환자 수 · 충분성 판정 아님
    { key: 'shiftWithoutNote', label: '이번 근무조 간호기록 없음' },
    { key: 'shiftWithoutVitals', label: '이번 근무조 활력 없음' },
    { key: 'shiftWithoutHandoff', label: '이번 근무조 인계 없음' },
    { key: 'shiftMedsPending', label: '이번 근무조 미처리 투약' },
    // 2026-10-04 보드 ④~⑦ — 활력 경과(기준은 원내 설정 · 미설정이면 수 없음)·위급값 미확인·수술·금식·퇴원 예정·전동 요청
    { key: 'vitalsStaleHours', label: '활력 경과 강조 기준(시간)' },
    { key: 'vitalsStale', label: '활력 경과 초과', warnAt: 1 },
    { key: 'vitalsNever', label: '활력 기록 없음', warnAt: 1 },
    { key: 'criticalOpenPatients', label: '위급값 미확인 환자', warnAt: 1, dangerAt: 1 },
    { key: 'surgeryUpcoming', label: '오늘·내일 수술' },
    { key: 'npo', label: '금식(NPO)' },
    { key: 'dischargeToday', label: '오늘 퇴원 예정' },
    { key: 'transferPending', label: '전동 요청 대기' },
  ],
  emergency: [
    { key: 'boarding', label: '입원 대기', warnAt: 1 },
    { key: 'longStay', label: '장기 체류', warnAt: 1 },
    { key: 'reassessOverdue', label: '재평가 지연', warnAt: 1, dangerAt: 1 },
  ],
  bed: [
    { key: 'available', label: '가용 병상' },
    { key: 'totalBeds', label: '전체 병상' },
    { key: 'occupied', label: '사용 중' },
    { key: 'cleaning', label: '청소 중' },
    { key: 'admittedTotal', label: '재원 합계' },
    { key: 'admitToday', label: '금일 입원' },
    { key: 'dischargeToday', label: '금일 퇴원' },
    { key: 'longStay', label: '장기 재원', warnAt: 1 },
    { key: 'avgLos', label: '평균 재원일', fmt: (v) => `${v}일` },
  ],
  pharmacy: [
    // 🔴 원내/원외는 분리해서 센다 — 합쳐 부르면 어느 쪽이 밀렸는지 알 수 없다(정본 pharmacyType)
    { key: 'verifyWait', label: '검수 대기(원내)', warnAt: 1 },
    { key: 'verifyWaitExternal', label: '검수 대기(원외)', warnAt: 1 },
    { key: 'dispensedToday', label: '금일 조제' },
    { key: 'lowStockCount', label: '재고 부족', warnAt: 1, dangerAt: 1 },
  ],
  receptionBilling: [
    { key: 'eligUnchecked', label: '자격 미확인', warnAt: 1 },
    { key: 'todayPaidCount', label: '금일 수납 건' },
    { key: 'todayPaidAmount', label: '금일 수납액', fmt: fmtMoney },
    { key: 'outstandingCount', label: '미수 건', warnAt: 1 },
    { key: 'outstandingAmount', label: '미수금', fmt: fmtMoney, warnAt: 1 },
    { key: 'docPending', label: '증명서 대기', warnAt: 1 },
  ],
  diagnostics: [
    { key: 'labPending', label: '검사 대기' },
    { key: 'imagingUnread', label: '판독 대기', warnAt: 1 },
    { key: 'tatOverdue', label: 'TAT 초과', warnAt: 1, dangerAt: 10 },
    { key: 'pendingReview', label: '검토 대기', warnAt: 1 },
    { key: 'functionalActive', label: '기능검사 진행' },
    { key: 'functionalCritical', label: '기능검사 위험', warnAt: 1, dangerAt: 1 },
    // 🔴 '경보 부재' — 위급 flag 는 붙었는데 경보가 없는 건수. 0 이 아니면 초록을 띄우면 안 된다
    { key: 'criticalUnalerted', label: '위급값 경보 누락', warnAt: 1, dangerAt: 1 },
    { key: 'criticalFlagTotal', label: '위급 flag 전체' },
    // 허용시간 초과 판정 기준(분) — 상향 보고 크론과 같은 config. 미설정·조회 실패면 서버가 null → '—'(0 이 아니다)
    { key: 'criticalOverdueAfterMinutes', label: '위급값 허용시간(분)' },
  ],
  safetyQuality: [
    { key: 'incidents30d', label: '30일 안전사건' },
    { key: 'incidentsOpen30d', label: '30일 미종결', warnAt: 1 },
    { key: 'infectionsActive', label: '활성 감염', warnAt: 1, dangerAt: 3 },
    { key: 'qiIndicators', label: 'QI 지표 수' },
    { key: 'qiMet', label: 'QI 달성' },
    { key: 'qiJudged', label: 'QI 판정(달성률 분모)' },
    // 🔴 이 달성률이 **언제 것인지** — 서버가 qiStaleMonths 를 내는데 화면이 읽지 않아
    //    4개월 전(2026-05) 측정이 '지금 값'처럼 보였다(2026-09-02 운영 실측)
    { key: 'qiStaleMonths', label: 'QI 측정 경과', fmt: (v) => `${v}개월 전` },
    { key: 'qiRate', label: 'QI 달성률', fmt: pct },
    { key: 'handHygieneRate', label: '손위생 준수', fmt: pct },
    // 🔴 비율은 분모와 함께 — 관찰 0건이면 '준수 0%'가 아니라 표본 부재다
    { key: 'handHygieneObserved', label: '손위생 관찰(분모)' },
    { key: 'handHygienePerformed', label: '손위생 수행(분자)' },
  ],
};

/**
 * 🔴 **숫자가 아닌 서버 키는 화면이 조용히 버린다** — 폴백이 숫자만 붙이기 때문이다.
 *    버릴지 말지를 여기서 **명시**한다(비어 있으면 "빠뜨린 것"과 구분되지 않는다).
 *    값은 사유이고, 가드가 "등재도 안 되고 여기에도 없는 키"를 잡는다.
 */
export const NON_FIELD_KEYS: Record<string, Record<string, string>> = {
  diagnostics: {
    criticalOverduePolicy: '허용시간 기준 상태 문자열(설정·미설정·해석 불가·조회 불가) — 수치가 아니다. 미설정은 허용시간 칸 `—` 로 드러난다',
  },
  emergency: {
    ktas: '중증도 분포 — 숫자 하나가 아니라 ktasChips() 로 별도 표시',
  },
  safetyQuality: {
    oldestOpenAt: '가장 오래된 미종결 발생시각 — 건수(incidentsOpen)로 대표하고 상세는 QI 화면',
    qiLatestPeriod: '달성률 표본 창 — 카드 각주(boardNote)가 조각으로 조립해 표시',
    qiOldestPeriod: '달성률 표본 창(가장 오래된 측정) — 각주 문장에는 쓰지 않는다',
    qiIsCurrentPeriod: '이번 달 측정 여부 — 각주 문장을 고르는 조각(boardNote)',
  },
};

/**
 * 카드 각주 — "이 값이 언제 것인가"를 값 옆에 붙인다.
 * 🔴 서버가 qiBasis/qiStaleMonths 를 계산해 두고도 **읽는 화면이 없어**, 4개월 전(2026-05) 측정이
 *    '지금 QI 달성률 88%'처럼 보였다(2026-09-02 운영 실측).
 */
export interface BoardNote {
  /** 카탈로그 키(한국어 원문 · 자리표시자 포함) */
  key: string;
  params: Record<string, string | number>;
}

/**
 * 🔴 종전에는 **서버가 한국어 문장으로 조립해** 내려준 `qiBasis` 를 그대로 그렸다(2026-09-10 실측).
 *    서버는 로케일을 모르므로 화면 언어를 무엇으로 바꿔도 이 줄만 한국어로 남았다 —
 *    카탈로그로는 고칠 수 없는 자리였다(값이 문장 안에 녹아 있었다).
 *    서버가 조각(`qiLatestPeriod`·`qiIsCurrentPeriod`·`qiStaleMonths`)을 이미 주고 있으므로
 *    **조립은 화면이 한다**. 이 함수는 훅을 쓸 수 없어 키와 파라미터만 돌려주고, 그리기는 `<Tf>` 가 한다.
 */
export function boardNote(sectionKey: string, s: Record<string, unknown>): BoardNote | null {
  if (sectionKey !== 'safetyQuality') return null;
  const period = typeof s.qiLatestPeriod === 'string' ? s.qiLatestPeriod : null;
  /**
   * 🔴 **카탈로그 키는 리터럴이어야 한다** — 정본 상수로 조립하면(`${RATIO_UNAVAILABLE}`) 소스에
   *    키 문자열이 남지 않아 **고아 키 검사가 "아무도 안 쓰는 키"로 본다**(2026-09-10 실측).
   *    두 가드가 맞선 자리다: '산출 불가 자체 구현' 가드 ↔ '고아 키' 가드.
   *    이건 비율 폴백 문구를 화면이 지어낸 것이 아니라 **번역 키(한국어 원문)** 이므로 리터럴로 둔다.
   *    비율 문구 자체는 여전히 정본(`<Ratio>`·`ratioText`)이 만든다 — 그 규약은 그대로다.
   */
  if (!period) return { key: '측정 없음 — 달성률 산출 불가', params: {} };
  if (s.qiIsCurrentPeriod === true) {
    return { key: '지표별 최신 측정(기간 무관) 기준 · 최신 측정 시점 {기간}(이번 달)', params: { 기간: period } };
  }
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = typeof s.qiStaleMonths === 'number' ? s.qiStaleMonths : null;
  // 🔴 경과 개월을 모르면 그 조각을 지어내지 않는다 — 아는 것까지만 말한다
  if (months === null) {
    return { key: '지표별 최신 측정(기간 무관) 기준 · 최신 측정 시점 {기간} — 이번 달({이번달}) 측정 아님', params: { 기간: period, 이번달: currentPeriod } };
  }
  return {
    key: '지표별 최신 측정(기간 무관) 기준 · 최신 측정 시점 {기간} — 이번 달({이번달}) 측정 아님, {개월}개월 전',
    params: { 기간: period, 이번달: currentPeriod, 개월: months },
  };
}

/** 대표 지표·경보 정의 */
const PRIMARY: Record<string, { key: string; label: string; fmt?: (v: number) => string; alertKey?: string; alertLabel?: string }> = {
  nursing: { key: 'total', label: '재원 환자', alertKey: 'highRisk', alertLabel: '고위험(EWS)' },
  emergency: { key: 'active', label: '응급 재실', alertKey: 'pendingTriage', alertLabel: '분류 대기' },
  bed: { key: 'occupancyRate', label: '병상 가동률', fmt: pct },
  pharmacy: { key: 'pending', label: '조제 대기', alertKey: 'lowStockCount', alertLabel: '재고 부족' },
  receptionBilling: { key: 'waiting', label: '접수 대기', alertKey: 'outstandingCount', alertLabel: '미수 건' },
  diagnostics: { key: 'criticalPending', label: '위급값 미보고', alertKey: 'criticalOverdue', alertLabel: '허용시간 초과' },
  safetyQuality: { key: 'incidentsOpen', label: '미종결 안전사건', alertKey: 'infectionsActive', alertLabel: '활성 감염' },
};

function toneOf(def: FieldDef, value: number): Tone {
  if (def.dangerAt !== undefined && value >= def.dangerAt) return 'danger';
  if (def.warnAt !== undefined && value >= def.warnAt) return 'warn';
  return 'normal';
}

/** 섹션 요약 → 카드 표시 모델. 정의에 없는 키도 버리지 않고 뒤에 붙인다 */
export function boardView(sectionKey: string, s: Record<string, unknown>): BoardView {
  const p = PRIMARY[sectionKey];
  /**
   * 🔴 **대표값이 null 을 0 으로 접고 있었다**(2026-09-02).
   *    `bed.occupancyRate` 는 등록 병상 0 이면 서버가 `null`(산출 불가)을 준다. 그런데 `n()` 이
   *    숫자가 아니면 0 을 돌려줘 카드에 **"0%"** 가 3xl 볼드로 찍혔다 — "병원이 텅 비었다"는 값이다.
   *    같은 화면 상단 KPI 띠는 같은 사실을 "산출 불가"로 그린다. **한 화면이 한 값을 두 가지로 말했다.**
   *    아래 FIELDS 경로는 `has()` 로 이미 걸러 `'—'` 를 냈다 — 대표값 경로에만 그 가드가 없었다.
   */
  const primaryValue = !p ? '—'
    : !has(s, p.key) ? RATIO_UNAVAILABLE
    : (p.fmt ? p.fmt(n(s, p.key)) : fmtInt(n(s, p.key)));
  const alertCount = p?.alertKey ? n(s, p.alertKey) : 0;

  const defs = FIELDS[sectionKey] ?? [];
  const fields: FieldView[] = defs.map((d) => {
    if (!has(s, d.key)) return { key: d.key, label: d.label, value: '—', tone: 'normal' as Tone, muted: true };
    const raw = n(s, d.key);
    return {
      key: d.key,
      label: d.label,
      value: d.fmt ? d.fmt(raw) : fmtInt(raw),
      tone: toneOf(d, raw),
      muted: raw === 0,
    };
  });

  // 서버가 새 지표를 추가해도 화면에서 사라지지 않게 — 정의에 없는 숫자 키를 뒤에 붙인다.
  // 🔴 다만 **라벨을 영문 키 그대로 쓰면 한글 화면에 `occupied`·`admittedTotal` 같은 것이 그대로 샌다**
  //    (2026-08-11 상황판 실측 4건). 폴백은 "사라지지 않게" 하는 안전망이지 정식 표시가 아니다 —
  //    미등록임을 눈에 보이게(⚠ 접두) 표시하고, FIELDS 등재를 강제하는 가드 테스트로 재발을 막는다.
  const known = new Set([...defs.map((d) => d.key), p?.key, p?.alertKey].filter(Boolean) as string[]);
  for (const [k, v] of Object.entries(s)) {
    if (known.has(k) || typeof v !== 'number') continue;
    fields.push({ key: k, label: `⚠ ${k}`, value: fmtInt(v), tone: 'normal', muted: v === 0, unregistered: true });
  }

  return {
    primary: { key: p?.key ?? sectionKey, label: p?.label ?? sectionKey, value: primaryValue },
    ...(alertCount > 0 ? { alert: { label: p?.alertLabel ?? '경보', value: alertCount } } : {}),
    fields,
  };
}

/** KTAS 분포(응급) — 중증도 순서 고정 */
export function ktasChips(s: Record<string, unknown>): { level: string; count: number; danger: boolean }[] {
  const k = s.ktas as Record<string, number> | undefined;
  if (!k) return [];
  return ['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5'].map((lv, i) => ({
    level: `L${i + 1}`,
    count: typeof k[lv] === 'number' ? k[lv] : 0,
    danger: i < 2, // KTAS 1·2 는 소생·중증
  }));
}

/**
 * 지금 조치가 필요한 항목만 모은다 — 상황판의 존재 이유.
 * "대기 수치"가 아니라 **폐루프가 열려 있거나 시간이 지난 것**만 올린다.
 */
export function criticalActions(sections: Record<string, { ok: boolean; summary?: Record<string, unknown> }>): ActionItem[] {
  const s = (k: string) => (sections[k]?.ok ? sections[k].summary ?? {} : {});
  const out: ActionItem[] = [];
  const push = (i: ActionItem) => { if (i.count > 0) out.push(i); };

  push({ section: 'diagnostics', key: 'criticalOverdue', label: '위급값 보고 허용시간 초과', count: n(s('diagnostics'), 'criticalOverdue'), tone: 'danger', href: '/diagnostics-board', why: '담당의 확인 폐루프가 열린 채 시간이 지났습니다' });
  push({ section: 'diagnostics', key: 'criticalPending', label: '위급값 미보고', count: n(s('diagnostics'), 'criticalPending'), tone: 'danger', href: '/diagnostics-board', why: '확인·통지가 아직 이뤄지지 않았습니다' });
  push({ section: 'nursing', key: 'highRisk', label: '고위험 환자(EWS)', count: n(s('nursing'), 'highRisk'), tone: 'danger', href: '/nursing-station', why: '조기경보 점수가 높은 재원 환자입니다' });
  push({ section: 'emergency', key: 'pendingTriage', label: '응급 분류 대기', count: n(s('emergency'), 'pendingTriage'), tone: 'danger', href: '/emergency-board', why: 'KTAS 분류 전이라 중증도를 모릅니다' });
  push({ section: 'emergency', key: 'reassessOverdue', label: '응급 재평가 지연', count: n(s('emergency'), 'reassessOverdue'), tone: 'danger', href: '/emergency-board', why: '재평가 주기를 넘겼습니다' });
  push({ section: 'nursing', key: 'medsOverdue', label: '투약 지연', count: n(s('nursing'), 'medsOverdue'), tone: 'warn', href: '/nursing-station', why: '예정 시각을 지난 투약이 있습니다' });
  push({ section: 'safetyQuality', key: 'infectionsActive', label: '활성 감염', count: n(s('safetyQuality'), 'infectionsActive'), tone: 'warn', href: '/safety-quality-board', why: '격리·접촉자 관리가 필요합니다' });
  push({ section: 'diagnostics', key: 'tatOverdue', label: '검사 TAT 초과', count: n(s('diagnostics'), 'tatOverdue'), tone: 'warn', href: '/diagnostics-board', why: '목표 회신시간을 넘긴 검사입니다' });
  push({ section: 'pharmacy', key: 'lowStockCount', label: '약품 재고 부족', count: n(s('pharmacy'), 'lowStockCount'), tone: 'warn', href: '/pharmacy-board', why: '조제 중단 위험이 있습니다' });
  push({ section: 'nursing', key: 'unsignedNotes', label: '미서명 기록', count: n(s('nursing'), 'unsignedNotes'), tone: 'warn', href: '/nursing-station', why: '법정 기록이 서명 전 상태입니다' });
  push({ section: 'receptionBilling', key: 'docPending', label: '증명서 발급 대기', count: n(s('receptionBilling'), 'docPending'), tone: 'warn', href: '/reception-billing-board', why: '환자가 기다리는 서류입니다' });

  // 위험 먼저, 같은 등급이면 건수 많은 순
  return out.sort((a, b) => (a.tone === b.tone ? b.count - a.count : a.tone === 'danger' ? -1 : 1));
}


// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-02 디자인 강화 — 색은 상태만 말한다 · 경보 구성 · 직전 갱신 대비 변화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 카드 상태 — 🔴 종전 카드 윗선은 **부서 색**(무지개)이라, 빨간 윗선이 "위험"인지 "응급실 색"인지 읽히지 않았다.
 * 이제 윗선·바탕은 이 다섯 가지만 말한다. 부서는 아이콘이 말한다.
 *  - FAILED = 섹션 조회 실패(0 이 아니라 알 수 없음) · NO_DATA = 응답에 요약이 없음
 *  - CLEAR = **기준 초과 없음** — "정상"이라 하지 않는다(경보 기준에 안 걸렸다는 것뿐, 안전하다는 판정이 아니다)
 */
export type BoardStatus = 'DANGER' | 'FAILED' | 'WARN' | 'CLEAR' | 'NO_DATA';

export const BOARD_STATUS_LABEL: Record<BoardStatus, string> = {
  DANGER: '위험',
  FAILED: '조회 실패',
  WARN: '주의',
  CLEAR: '기준 초과 없음',
  NO_DATA: '데이터 없음',
};

const STATUS_ORDER: Record<BoardStatus, number> = { DANGER: 0, FAILED: 1, WARN: 2, CLEAR: 3, NO_DATA: 4 };

export function boardStatus(
  sectionKey: string,
  section: { ok: boolean; summary?: Record<string, unknown> } | undefined,
  actions: ActionItem[],
): BoardStatus {
  if (!section) return 'NO_DATA';
  if (!section.ok) return 'FAILED';
  if (!section.summary) return 'NO_DATA';
  const mine = actions.filter((a) => a.section === sectionKey);
  const fields = boardView(sectionKey, section.summary).fields.filter((f) => !f.muted);
  if (mine.some((a) => a.tone === 'danger') || fields.some((f) => f.tone === 'danger')) return 'DANGER';
  if (mine.some((a) => a.tone === 'warn') || fields.some((f) => f.tone === 'warn')) return 'WARN';
  return 'CLEAR';
}

/** 위험 → 조회 실패 → 주의 → 기준 초과 없음 → 데이터 없음 (같은 상태 안에서는 원래 순서 유지) */
export function sortByStatus<T extends { key: string }>(items: T[], statusOf: (key: string) => BoardStatus): T[] {
  return items
    .map((it, i) => ({ it, i, o: STATUS_ORDER[statusOf(it.key)] }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map((x) => x.it);
}

/**
 * 경보 구성 — 🔴 종전 머리 띠의 "경고 총합 337" 은 숫자만 컸다(무엇이 얼마나 급한지 말하지 않음 · 아래 칸과 중복).
 * "지금 조치 필요" 목록과 **같은 원천**(criticalActions)으로 등급별 종류·건수를 센다.
 */
export function alertComposition(actions: ActionItem[]) {
  const danger = actions.filter((a) => a.tone === 'danger');
  const warn = actions.filter((a) => a.tone === 'warn');
  const sum = (xs: ActionItem[]) => xs.reduce((t, a) => t + a.count, 0);
  return { dangerKinds: danger.length, dangerCount: sum(danger), warnKinds: warn.length, warnCount: sum(warn) };
}

/** 응답의 숫자 값 평면화 — `kpi.<키>` · `<섹션>.<키>` (실패 섹션·숫자 아닌 값은 넣지 않는다) */
export function numericSnapshot(summary: { kpi?: Record<string, unknown>; sections?: Record<string, { ok: boolean; summary?: Record<string, unknown> }> } | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!summary) return out;
  for (const [k, v] of Object.entries(summary.kpi ?? {})) if (typeof v === 'number') out[`kpi.${k}`] = v;
  for (const [sec, s] of Object.entries(summary.sections ?? {})) {
    if (!s?.ok || !s.summary) continue;
    for (const [k, v] of Object.entries(s.summary)) if (typeof v === 'number') out[`${sec}.${k}`] = v;
  }
  return out;
}

/**
 * 직전 갱신 대비 변화 — 양쪽에 **모두 있는** 키만(한쪽이 조회 실패였으면 변화를 지어내지 않는다) · 0 변화는 넣지 않는다.
 * 기준은 "이 화면이 받은 직전 응답"이다(서버 이력이 아니다 — 화면을 새로 열면 비어 있다).
 */
export function numericDelta(prev: Record<string, number> | null, cur: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!prev) return out;
  for (const [k, v] of Object.entries(cur)) {
    if (k in prev && prev[k] !== v) out[k] = v - prev[k];
  }
  return out;
}

/** 관제 모드 이름 가림 — 첫 글자만 남긴다(벽 모니터는 지나가는 사람도 본다) */
export function wallMaskName(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  if (!t) return '○○';
  return `${Array.from(t)[0]}○○`;
}
