/**
 * 수술방 차트 정본(2026-10-05) — 수술방 역할 · 기기 구성 · 패널 · 기본 배치 · 수술 중 기록 종류와 값 검사.
 *
 * 🔴 배치는 **사람 × 기기 구성 × 수술방 역할**마다 다르다(마취과 태블릿 한 대 ≠ 순회간호 모니터 두 대).
 *    모니터 n대 = 화면 n개(창 하나가 화면 하나 · 주소 `screen=` 으로 고른다) · 태블릿 = 화면 하나에 탭.
 * 🔴 저장된 배치는 이 정본으로 정규화한다 — 모르는 패널은 버리고, 같은 패널이 두 번이면 한 번만(새 패널이 생겨도 옛 저장본이 깨지지 않게).
 */

export const OR_ROLES = ['ANESTHESIA', 'SURGEON', 'SCRUB', 'CIRCULATING', 'OBSERVER'] as const;
export type OrRole = (typeof OR_ROLES)[number];
export const OR_ROLE_LABEL: Record<OrRole, string> = {
  ANESTHESIA: '마취',
  SURGEON: '집도',
  SCRUB: '소독 간호',
  CIRCULATING: '순회 간호',
  OBSERVER: '참관',
};

/** 수술에 지정된 자리 — 수술팀 판정의 입력(지정 칸에 있는 사람만 · 추정하지 않는다) */
export interface OrTeamSlots {
  surgeonId: string | null; assistantId: string | null; anesthetistId: string | null;
  /** 마취 기록의 마취의(수술 원장 칸과 다를 수 있다 — 둘 다 마취팀) */
  recordAnesthetistId?: string | null;
  scrubNurseId: string | null; circulatingNurseId: string | null;
}

/**
 * 수술팀에서의 자리 — 수술방 차트의 기본 역할 · 수술 단위 음성 세션의 허용 판정이 **같은 규칙**을 쓴다.
 * 자리에 없으면 null(참관·권한 없음) — 같은 과·같은 병동이라는 이유로 넓히지 않는다.
 */
export function orTeamRoleOf(t: OrTeamSlots, userId: string): OrRole | null {
  if (!userId) return null;
  if (t.anesthetistId === userId || t.recordAnesthetistId === userId) return 'ANESTHESIA';
  if (t.surgeonId === userId || t.assistantId === userId) return 'SURGEON';
  if (t.scrubNurseId === userId) return 'SCRUB';
  if (t.circulatingNurseId === userId) return 'CIRCULATING';
  return null;
}

/**
 * 수술 중 기록(원장·단계 찍기·수술 단위 구술)을 **수술팀 자리에 있는 사람만** 쓰게 하는가 — 운영 모드로 갈린다.
 * 🔴 사용자 결정(2026-10-05): 리허설(·개발)에서는 누구나 작성 · **리얼(실제 구동)에서는 권한(수술팀 자리)으로만.**
 * 모드 값은 서버 정본(HisModeService.effective — 빌드 상한·런타임 좁히기)에서 온다 · 모르면 REAL 로 읽는다(HIS_MODE_FALLBACK).
 * 읽기·AI 요약 초안·순회 간호 맡기(팀에 드는 길)는 이 규칙 밖이다.
 */
export function orWriteRequiresTeam(mode: 'DEV' | 'REHEARSAL' | 'REAL'): boolean {
  return mode === 'REAL';
}

/** 기기 구성 — 화면 수가 정해진다 */
export const OR_DEVICE_PROFILES = ['TABLET', 'MONITOR_1', 'MONITOR_2', 'MONITOR_3', 'MONITOR_4'] as const;
export type OrDeviceProfile = (typeof OR_DEVICE_PROFILES)[number];
export const OR_DEVICE_LABEL: Record<OrDeviceProfile, string> = {
  TABLET: '태블릿',
  MONITOR_1: '모니터 1대',
  MONITOR_2: '모니터 2대',
  MONITOR_3: '모니터 3대',
  MONITOR_4: '모니터 4대',
};
export const OR_SCREEN_COUNT: Record<OrDeviceProfile, number> = { TABLET: 1, MONITOR_1: 1, MONITOR_2: 2, MONITOR_3: 3, MONITOR_4: 4 };

export const OR_PANELS = ['header', 'phases', 'vitals', 'meds', 'timeline', 'safety', 'opnote', 'notes', 'summary'] as const;
export type OrPanel = (typeof OR_PANELS)[number];
export const OR_PANEL_LABEL: Record<OrPanel, string> = {
  header: '환자·수술 요약',
  phases: '단계·시각',
  vitals: '활력',
  meds: '약물·수액·배출',
  timeline: '수술 중 기록 흐름',
  safety: '안전 체크리스트',
  opnote: '수술 기록',
  notes: '메모',
  summary: '수술 경과 요약',
};

export interface OrScreen { panels: OrPanel[]; columns: 1 | 2 | 3 }
export interface OrLayout { screens: OrScreen[] }

/** 역할마다 먼저 보이는 패널 순서 — 화면 수로 나눠 담는다 */
const ROLE_ORDER: Record<OrRole, OrPanel[]> = {
  ANESTHESIA: ['header', 'vitals', 'meds', 'phases', 'timeline', 'safety', 'notes', 'summary'],
  SURGEON: ['header', 'phases', 'safety', 'opnote', 'vitals', 'summary', 'timeline', 'notes'],
  SCRUB: ['header', 'safety', 'phases', 'meds', 'timeline', 'notes'],
  CIRCULATING: ['header', 'phases', 'safety', 'meds', 'timeline', 'vitals', 'notes', 'summary'],
  OBSERVER: ['header', 'phases', 'vitals', 'timeline', 'summary'],
};

/** 기본 배치 — 역할 순서를 화면 수로 고르게 나눈다(태블릿·모니터 1대는 한 화면에 전부 · 탭/2열) */
export function defaultOrLayout(role: OrRole, profile: OrDeviceProfile): OrLayout {
  const order = ROLE_ORDER[role];
  const n = OR_SCREEN_COUNT[profile];
  if (n === 1) return { screens: [{ panels: [...order], columns: profile === 'TABLET' ? 1 : 2 }] };
  const per = Math.ceil(order.length / n);
  const screens: OrScreen[] = [];
  for (let i = 0; i < n; i++) {
    const panels = order.slice(i * per, (i + 1) * per);
    // 모든 화면에 머리(환자·수술 요약)를 둔다 — 화면마다 어느 환자인지 보이게
    if (i > 0 && !panels.includes('header')) panels.unshift('header');
    screens.push({ panels, columns: panels.length > 3 ? 2 : 1 });
  }
  return { screens };
}

const isPanel = (v: unknown): v is OrPanel => typeof v === 'string' && (OR_PANELS as readonly string[]).includes(v);

/**
 * 저장본 정규화 — 화면 수는 기기 구성에 맞춘다(모자라면 기본으로 채우고, 넘치면 버린다) · 모르는 패널·중복 제거 ·
 * 빈 화면은 기본 화면으로 · 모양을 모르면 `null`(호출부가 기본 배치를 쓴다 — 지어내지 않는다).
 */
export function normalizeOrLayout(raw: unknown, role: OrRole, profile: OrDeviceProfile): OrLayout | null {
  const screensRaw = (raw as { screens?: unknown } | null)?.screens;
  if (!Array.isArray(screensRaw)) return null;
  const n = OR_SCREEN_COUNT[profile];
  const def = defaultOrLayout(role, profile);
  const screens: OrScreen[] = [];
  for (let i = 0; i < n; i++) {
    const s = screensRaw[i] as { panels?: unknown; columns?: unknown } | undefined;
    const panels = Array.isArray(s?.panels) ? [...new Set(s!.panels.filter(isPanel))] : [];
    const columns = s?.columns === 1 || s?.columns === 2 || s?.columns === 3 ? s.columns : def.screens[i].columns;
    screens.push(panels.length ? { panels, columns } : def.screens[i]);
  }
  return { screens };
}

// ─────────────────────────── 수술 중 기록 ───────────────────────────

export const INTRAOP_EVENT_KINDS = ['VITALS', 'DRUG', 'FLUID', 'BLOOD', 'OUTPUT', 'EVENT', 'NOTE', 'PHASE'] as const;
export type IntraopEventKind = (typeof INTRAOP_EVENT_KINDS)[number];
export const INTRAOP_EVENT_LABEL: Record<IntraopEventKind, string> = {
  VITALS: '활력', DRUG: '약물', FLUID: '수액', BLOOD: '혈액', OUTPUT: '배출', EVENT: '사건', NOTE: '메모', PHASE: '단계',
};

/** 단계 찍기 — 각 단계의 정본 칸(마취 기록·수술 원장)에 쓴다. 이미 적힌 단계는 덮지 않는다 */
export const INTRAOP_PHASE_STAMPS = ['INDUCTION', 'INTUBATION', 'INCISION', 'CLOSURE', 'EXTUBATION'] as const;
export type IntraopPhaseStamp = (typeof INTRAOP_PHASE_STAMPS)[number];
export const INTRAOP_PHASE_STAMP_LABEL: Record<IntraopPhaseStamp, string> = {
  INDUCTION: '마취 유도', INTUBATION: '기관 삽관', INCISION: '절개', CLOSURE: '봉합', EXTUBATION: '발관',
};

export const OUTPUT_TYPES = ['URINE', 'BLOOD_LOSS', 'DRAIN', 'GASTRIC', 'OTHER'] as const;
export const OUTPUT_TYPE_LABEL: Record<(typeof OUTPUT_TYPES)[number], string> = {
  URINE: '소변', BLOOD_LOSS: '실혈', DRAIN: '배액', GASTRIC: '위액', OTHER: '기타',
};

/**
 * 활력 값의 **기록 가능 범위**(입력 오타 차단용 — 임상 정상 범위가 아니다 · 경보 기준도 아니다).
 * 범위를 넘으면 저장하지 않고 400 — 확실히 틀린 값을 원장에 박지 않는다.
 */
export const INTRAOP_VITAL_LIMITS: Record<'heartRate' | 'systolicBp' | 'diastolicBp' | 'spo2' | 'etco2' | 'temperature', [number, number]> = {
  heartRate: [0, 300], systolicBp: [0, 300], diastolicBp: [0, 250], spo2: [0, 100], etco2: [0, 150], temperature: [25, 45],
};

export type IntraopPayloadCheck = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };

const posNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * 종류별 값 검사 — 알려진 칸만 남긴다(모르는 칸은 버린다) · 필수 칸이 비면 거절.
 * 🔴 값을 지어내지 않는다: 단위가 없으면 단위 없이 저장하지 않고 거절(약물 용량은 단위가 뜻의 절반이다).
 */
export function checkIntraopPayload(kind: IntraopEventKind, raw: unknown): IntraopPayloadCheck {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (kind) {
    case 'VITALS': {
      const out: Record<string, number> = {};
      for (const [k, [lo, hi]] of Object.entries(INTRAOP_VITAL_LIMITS)) {
        const v = r[k];
        if (v == null || v === '') continue;
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n) || n < lo || n > hi) return { ok: false, error: `${k} 값이 기록 가능 범위(${lo}~${hi}) 밖입니다.` };
        out[k] = n;
      }
      if (!Object.keys(out).length) return { ok: false, error: '활력 값을 하나 이상 입력하세요.' };
      // 수축기 ≤ 이완기는 기록할 수 없는 값(칸을 바꿔 적은 오타) — 경보 기준이 아니라 입력 검사
      if (out.systolicBp != null && out.diastolicBp != null && out.systolicBp <= out.diastolicBp) return { ok: false, error: '수축기 혈압이 이완기 혈압보다 커야 합니다(칸을 바꿔 적었는지 확인하세요).' };
      return { ok: true, payload: out };
    }
    case 'DRUG': {
      const name = text(r.name, 200); const dose = posNum(typeof r.dose === 'string' ? Number(r.dose) : r.dose); const unit = text(r.unit, 20);
      if (!name || dose == null || !unit) return { ok: false, error: '약물은 이름·용량·단위가 모두 있어야 합니다.' };
      return { ok: true, payload: { name, dose, unit, ...(text(r.route, 30) ? { route: text(r.route, 30) } : {}) } };
    }
    case 'FLUID': {
      const name = text(r.name, 200); const volumeMl = posNum(typeof r.volumeMl === 'string' ? Number(r.volumeMl) : r.volumeMl);
      if (!name || volumeMl == null) return { ok: false, error: '수액은 이름과 양(mL)이 있어야 합니다.' };
      return { ok: true, payload: { name, volumeMl } };
    }
    case 'BLOOD': {
      const product = text(r.product, 100); const units = posNum(typeof r.units === 'string' ? Number(r.units) : r.units);
      const volumeMl = posNum(typeof r.volumeMl === 'string' ? Number(r.volumeMl) : r.volumeMl);
      if (!product || (units == null && volumeMl == null)) return { ok: false, error: '혈액은 제제와 단위 수 또는 양(mL)이 있어야 합니다.' };
      return { ok: true, payload: { product, ...(units != null ? { units } : {}), ...(volumeMl != null ? { volumeMl } : {}), ...(text(r.unitNo, 50) ? { unitNo: text(r.unitNo, 50) } : {}) } };
    }
    case 'OUTPUT': {
      const type = typeof r.type === 'string' && (OUTPUT_TYPES as readonly string[]).includes(r.type) ? r.type : null;
      const volumeMl = posNum(typeof r.volumeMl === 'string' ? Number(r.volumeMl) : r.volumeMl);
      if (!type || volumeMl == null) return { ok: false, error: '배출은 종류와 양(mL)이 있어야 합니다.' };
      return { ok: true, payload: { type, volumeMl } };
    }
    case 'EVENT':
    case 'NOTE': {
      const t = text(r.text, 2000);
      if (!t) return { ok: false, error: '내용을 입력하세요.' };
      // 입력 방식 — 음성 인식 문장을 사람이 확인해 저장한 것인지 남긴다(출처 · 모르는 값은 버린다)
      const inputMethod = r.inputMethod === 'VOICE' ? 'VOICE' : null;
      return { ok: true, payload: { text: t, ...(inputMethod ? { inputMethod } : {}) } };
    }
    case 'PHASE':
      // 단계는 단계 찍기 경로만 쓴다(직접 넣지 못하게 — 정본 칸과 갈라진다)
      return { ok: false, error: '단계는 단계 기록 버튼으로만 남깁니다.' };
  }
}
