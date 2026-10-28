/**
 * 환자안전 사건 심각도 정본 — 화면 실사용 점검 W7(2026-08-14).
 *
 * 🔴 어휘가 **세 벌**로 갈라져 있었다.
 *   - 화면 라벨표: `NEAR_MISS · MINOR · MODERATE · SEVERE · SENTINEL` (5종)
 *   - DB 저장값: `severity String @db.VarChar(20)` — **enum 이 아닌 자유 문자열**. 실측 `LOW` 2건 · `MODERATE` 1건
 *   - 서버 에스컬레이션 판정: `CRITICAL·CATASTROPHIC·MAJOR·HIGH·중대·근접오류…` 10종 이상 인정
 *
 * 결과: 저장된 `LOW` 2건이 화면 차트의 **어느 막대에도 속하지 않아** "총 사고 3"인데
 * 중증도 막대 합이 1이었고, 상세 패널의 중증도 칸은 **빈칸**이었으며, 필터 드롭다운에
 * `LOW` 가 없어 그 2건은 중증도로 **조회조차 불가**했다.
 *
 * 저장값은 건드리지 않는다(과거 기록 변조 금지) — **읽는 쪽에서 정본으로 접는다.**
 */

/** 표시·집계 정본 등급(위중도 오름차순) */
export const INCIDENT_SEVERITIES = [
  'NEAR_MISS',
  'MINOR',
  'MODERATE',
  'MAJOR',
  'CRITICAL',
  'SENTINEL',
  'UNSPECIFIED',
] as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  NEAR_MISS: '아차사고',
  MINOR: '경미',
  MODERATE: '중등도',
  MAJOR: '중대',
  CRITICAL: '위해',
  SENTINEL: '적신호',
  UNSPECIFIED: '미분류',
};

/**
 * 저장된 자유 문자열 → 정본 등급.
 *
 * 🔴 `UNSPECIFIED` 는 "모른다"는 뜻이다 — **경미로 접지 않는다.** 미분류를 최선값으로
 *    폴백하면 분류가 안 된 사건이 화면에서 안전해 보인다(P1 변종).
 */
export function normalizeIncidentSeverity(raw: string | null | undefined): IncidentSeverity {
  const u = String(raw ?? '').trim().toUpperCase();
  if (!u) return 'UNSPECIFIED';
  if (u.includes('SENTINEL') || u === '적신호') return 'SENTINEL';
  if (u.includes('CRITICAL') || u === 'CATASTROPHIC' || u === 'SEVERE' || u === '위해') return 'CRITICAL';
  if (u === 'MAJOR' || u === 'HIGH' || u === '중대') return 'MAJOR';
  if (u === 'MODERATE' || u === 'MEDIUM' || u === '중등도' || u === '보통') return 'MODERATE';
  if (u === 'NEAR_MISS' || u === 'NEARMISS' || u === '근접오류' || u === '아차사고') return 'NEAR_MISS';
  if (u === 'MINOR' || u === 'LOW' || u === '경미') return 'MINOR';
  return 'UNSPECIFIED';
}

/**
 * 즉시 에스컬레이션(`incident.critical` 발행) 대상인가.
 * 🔴 종전 서버 동작(`SENTINEL || CRITICAL`)과 **정확히 동일**하게 유지한다 —
 *    표시를 고치면서 통지 범위를 조용히 넓히지 않는다.
 */
export function isEscalatingSeverity(raw: string | null | undefined): boolean {
  const s = normalizeIncidentSeverity(raw);
  return s === 'SENTINEL' || s === 'CRITICAL';
}

/**
 * 정본 등급으로 필터할 때 DB 에서 찾아야 할 **원본 문자열 후보**.
 * 저장값이 자유 문자열이라 `severity = 'MINOR'` 만으로는 `LOW` 를 놓친다.
 */
const RAW_ALIASES: Record<IncidentSeverity, string[]> = {
  NEAR_MISS: ['NEAR_MISS', 'NEARMISS', '근접오류', '아차사고'],
  MINOR: ['MINOR', 'LOW', '경미'],
  MODERATE: ['MODERATE', 'MEDIUM', '중등도', '보통'],
  MAJOR: ['MAJOR', 'HIGH', '중대'],
  CRITICAL: ['CRITICAL', 'CATASTROPHIC', 'SEVERE', '위해'],
  SENTINEL: ['SENTINEL', '적신호'],
  UNSPECIFIED: [],
};

export function rawSeverityAliases(level: IncidentSeverity): string[] {
  return RAW_ALIASES[level] ?? [];
}

/**
 * `groupBy(severity)` 결과(원본 문자열 기준)를 정본 등급으로 합산한다.
 * 화면이 하드코딩 키로 훑다가 값을 흘리지 않도록 **서버가 접어서 보낸다.**
 */
export function foldSeverityCounts(
  rows: Array<{ severity: string | null; count: number }>,
): Array<{ severity: IncidentSeverity; label: string; count: number }> {
  const acc = new Map<IncidentSeverity, number>();
  for (const r of rows) {
    const k = normalizeIncidentSeverity(r.severity);
    acc.set(k, (acc.get(k) ?? 0) + r.count);
  }
  // 등급 순서 고정 + 0건 등급도 포함(막대가 사라지지 않게)
  return INCIDENT_SEVERITIES.filter((s) => s !== 'UNSPECIFIED' || (acc.get(s) ?? 0) > 0).map((s) => ({
    severity: s,
    label: INCIDENT_SEVERITY_LABEL[s],
    count: acc.get(s) ?? 0,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   사고 유형 정본 — 보고자 보호 축(2026-08-18)
   ═══════════════════════════════════════════════════════════════════════════

   🔴 이 파일은 **심각도만** 제공했고 유형은 화면이 로컬 `Record` 로 재정의하고 있었다
      (FE 표현 단위 규약 위반 — "상태 라벨/색은 로컬 Record 재정의 금지").

   그 결과 운영 실측(2026-08-18·safety_incidents 75건)에서 저장된 유형 중
     DOCUMENTATION 10 · PATIENT_ID 10 · SPECIMEN_LABEL 10 · PRESSURE_ULCER 10
   = **40건(53%)** 이 화면 드롭다운에 없어 **유형으로 조회조차 불가**했다.
   (드롭다운은 MEDICATION·IDENTIFICATION·PRESSURE_INJURY 를 갖고 있었는데
    저장값은 MEDICATION_ERROR·PATIENT_ID·PRESSURE_ULCER 였다 — 어휘가 갈라진 것이다.)

   심각도와 같은 원칙:
   - **저장값은 건드리지 않는다**(과거 기록 변조 금지) — 읽는 쪽에서 정본으로 접는다.
   - `type` 은 DB 에서 `String @db.VarChar(50)` 자유 문자열이라 `type = 'PATIENT_ID'` 하나로는
     `IDENTIFICATION` 을 놓친다 → 필터는 **원본 문자열 후보 전부**를 `in` 으로 찾는다.
   - 🔴 **정본에 없는 저장값은 `null`(모른다)로 돌려준다.** '기타(OTHER)'로 접으면
     분류되지 않은 사건이 화면에서 분류된 것처럼 보인다(P1 변종).
 */

/** 표시·집계·필터 정본 유형 */
export const INCIDENT_TYPES = [
  'FALL',
  'MEDICATION_ERROR',
  'PATIENT_ID',
  'SPECIMEN_LABEL',
  'TRANSFUSION',
  'PRESSURE_ULCER',
  'INFECTION',
  'NEEDLE_STICK',
  'PROCEDURE',
  'EQUIPMENT',
  'DOCUMENTATION',
  'COMMUNICATION',
  'OTHER',
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  FALL: '낙상',
  MEDICATION_ERROR: '투약오류',
  PATIENT_ID: '환자확인',
  SPECIMEN_LABEL: '검체라벨',
  TRANSFUSION: '수혈',
  PRESSURE_ULCER: '욕창',
  INFECTION: '감염',
  NEEDLE_STICK: '주사침상해',
  PROCEDURE: '시술·수술',
  EQUIPMENT: '장비',
  DOCUMENTATION: '기록',
  COMMUNICATION: '의사소통',
  OTHER: '기타',
};

/**
 * 정본 유형 → DB 에서 찾아야 할 **원본 문자열 후보**.
 * 정본 키 자신도 후보에 포함한다(첫 원소 = 저장 시 사용할 값).
 */
const TYPE_RAW_ALIASES: Record<IncidentType, string[]> = {
  FALL: ['FALL', 'FALLS', '낙상'],
  MEDICATION_ERROR: ['MEDICATION_ERROR', 'MEDICATION', 'MED_ERROR', 'MEDICATION_ADMINISTRATION', '투약오류', '투약'],
  PATIENT_ID: ['PATIENT_ID', 'IDENTIFICATION', 'PATIENT_IDENTIFICATION', 'WRONG_PATIENT', '환자확인'],
  SPECIMEN_LABEL: ['SPECIMEN_LABEL', 'SPECIMEN', 'LABELING', 'SPECIMEN_LABELING', '검체라벨'],
  TRANSFUSION: ['TRANSFUSION', '수혈'],
  PRESSURE_ULCER: ['PRESSURE_ULCER', 'PRESSURE_INJURY', 'BEDSORE', 'DECUBITUS', '욕창'],
  INFECTION: ['INFECTION', 'HAI', '감염'],
  NEEDLE_STICK: ['NEEDLE_STICK', 'NEEDLESTICK', 'SHARPS', 'SHARPS_INJURY', '주사침상해'],
  PROCEDURE: ['PROCEDURE', 'SURGERY', 'SURGICAL', 'OPERATION', '시술', '수술'],
  EQUIPMENT: ['EQUIPMENT', 'DEVICE', '장비'],
  DOCUMENTATION: ['DOCUMENTATION', 'RECORD', 'CHARTING', '기록'],
  COMMUNICATION: ['COMMUNICATION', 'HANDOVER', '의사소통'],
  OTHER: ['OTHER', 'ETC', '기타'],
};

const TYPE_LOOKUP: Map<string, IncidentType> = new Map(
  (Object.entries(TYPE_RAW_ALIASES) as [IncidentType, string[]][]).flatMap(([canon, aliases]) =>
    aliases.map((a) => [a.toUpperCase(), canon] as [string, IncidentType]),
  ),
);

/**
 * 저장된 자유 문자열 → 정본 유형. **모르면 `null`** (기타로 접지 않는다).
 */
export function normalizeIncidentType(raw: string | null | undefined): IncidentType | null {
  const u = String(raw ?? '').trim().toUpperCase();
  if (!u) return null;
  return TYPE_LOOKUP.get(u) ?? null;
}

/**
 * 화면 라벨 — 정본에 있으면 한글 라벨, 없으면 **저장값 그대로**.
 * 🔴 모르는 것을 아는 척하지 않는다: 미등재 유형은 원본 문자열이 보여야 사람이 알아채고 정본에 등재한다.
 */
export function incidentTypeLabel(raw: string | null | undefined): string {
  const t = normalizeIncidentType(raw);
  if (t) return INCIDENT_TYPE_LABEL[t];
  const s = String(raw ?? '').trim();
  return s || '미분류';
}

/** 정본 유형으로 필터할 때 DB 에서 찾아야 할 원본 문자열 후보 */
export function rawTypeAliases(type: IncidentType): string[] {
  return TYPE_RAW_ALIASES[type] ?? [];
}

/** 정본에 등재된 모든 원본 문자열 후보(대문자) — 미등재 저장값 탐지용 */
export function allKnownIncidentTypeAliases(): string[] {
  return [...TYPE_LOOKUP.keys()];
}

/**
 * `groupBy(type)` 결과(원본 문자열 기준)를 정본 유형으로 합산한다.
 * 🔴 미등재 저장값은 **버리지 않고** `type:null` + 원본 라벨로 남긴다 — 자르면 잘랐다고 말한다.
 */
export function foldTypeCounts(
  rows: Array<{ type: string | null; count: number }>,
): Array<{ type: IncidentType | null; rawType: string | null; label: string; count: number }> {
  const known = new Map<IncidentType, number>();
  const unknown = new Map<string, number>();
  for (const r of rows) {
    const t = normalizeIncidentType(r.type);
    if (t) known.set(t, (known.get(t) ?? 0) + r.count);
    else {
      const k = String(r.type ?? '').trim() || '미분류';
      unknown.set(k, (unknown.get(k) ?? 0) + r.count);
    }
  }
  return [
    ...INCIDENT_TYPES.filter((t) => (known.get(t) ?? 0) > 0).map((t) => ({
      type: t as IncidentType | null,
      rawType: t as string | null,
      label: INCIDENT_TYPE_LABEL[t],
      count: known.get(t) ?? 0,
    })),
    ...[...unknown.entries()].map(([raw, count]) => ({
      type: null,
      rawType: raw,
      label: raw, // 정본 미등재 — 라벨을 지어내지 않는다
      count,
    })),
  ];
}

/* ── 사고 처리 상태 정본(2026-10-08 QI 흐름 P0) ─────────────────────────────────
 * 🔴 종전 `UpdateIncidentStatusDto.status` 는 `@IsString` — 어떤 문자열도 저장됐고, 순서(보고→조사→해결→종료)는
 *    화면 버튼에만 있었다. 워크그룹 알림 확인은 검토 권한 없이 사고를 RESOLVED 로 닫았다(가짜 게이트).
 *    어휘·전이는 여기 하나 — 서버가 검증하고 화면은 이 표로 버튼을 그린다.
 *    운영 실측(10-08): REPORTED 61 · INVESTIGATING 9 · CLOSED 5 — 어휘 밖 저장값 0.
 */
export const INCIDENT_STATUSES = ['REPORTED', 'INVESTIGATING', 'RESOLVED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  REPORTED: '보고됨', INVESTIGATING: '조사중', RESOLVED: '해결됨', CLOSED: '종료',
};

/**
 * 허용 전이. REPORTED → CLOSED 는 "사고가 아님·중복" 종결이라 **사유(조치 내역) 필수**.
 * 종료(CLOSED)는 끝이다 — 되돌리지 않는다(재조사는 새 보고로).
 */
export const INCIDENT_STATUS_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  REPORTED: ['INVESTIGATING', 'CLOSED'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  CLOSED: [],
};

/** 이 전이에 사유(조치 내역)가 필수인가 */
export function incidentTransitionNeedsReason(from: IncidentStatus, to: IncidentStatus): boolean {
  return (from === 'REPORTED' && to === 'CLOSED') || to === 'RESOLVED' || (from === 'RESOLVED' && to === 'INVESTIGATING');
}

export function isIncidentStatus(v: unknown): v is IncidentStatus {
  return typeof v === 'string' && (INCIDENT_STATUSES as readonly string[]).includes(v);
}

/** 미종결(검토·조치가 남은) 상태 — 보드·지표의 "열린 사고" 정의 하나 */
export const INCIDENT_OPEN_STATUSES: readonly IncidentStatus[] = ['REPORTED', 'INVESTIGATING'];

/**
 * 대외 환자안전 보고(KOPS · 환자안전보고학습시스템) 상태 — 🔴 송신 코드가 **없다**.
 * 화면이 "보고됨"을 그리지 않도록 정직 표식만 둔다(감염 축 `LOCAL_RECORDED` 와 같은 원칙).
 * 송신은 허가권자 결정(`safety.kopsTransmit`) + 채널 구축 뒤.
 */
export const KOPS_REPORT_STATUS = { channel: 'KOPS', implemented: false, status: 'LOCAL_RECORDED', reportedAt: null } as const;

/**
 * 사고 한 건의 KOPS 보고 상태(2026-10-09) — 송신 채널은 여전히 없다(implemented:false).
 * 사람이 KOPS 웹에 직접 보고하고 접수번호를 기록했으면 MANUAL_REPORTED(사람이 적은 번호 · 기관 접수는 시스템이 확인하지 않음).
 */
export function kopsReportStatusOf(row: { kopsManualRef?: string | null; kopsManualAt?: Date | string | null }) {
  if (row.kopsManualRef) {
    const at = row.kopsManualAt ? new Date(row.kopsManualAt).toISOString() : null;
    return { channel: 'KOPS', implemented: false, status: 'MANUAL_REPORTED', reportedAt: at, ref: row.kopsManualRef } as const;
  }
  return KOPS_REPORT_STATUS;
}
