/**
 * 보호자(위임) 열람 범위 — **정본**.
 *
 * 🔴 2026-09-02 실측: 이 개념이 네 곳에 흩어져 있었고, 그 중 한 키가 **아무 데서도 생성되지 않아
 *    게이트가 한 번도 발동하지 않았다.**
 *    - 가드는 `scope['imaging'] === false` 로 막으려 했는데
 *    - 생산자(일반 위임 기본값 2곳·BTG 1곳) 어디에도 `imaging` 키가 없었다
 *    - `undefined === false` 는 `false` → **영상은 한 번도 막히지 않았다**
 *    그동안 포털 화면은 참인 키만 나열하므로 "열람 범위: 예약/진료/검사/수납"이라 그렸다.
 *    **화면은 '영상 미위임'이라 말하고 서버는 판독소견·DICOM 원본까지 내주고 있었다.**
 *    (병상 건이 값을 잃고 '산출 불가'를 그렸다면, 이쪽은 제한을 잃고 '제한됨'을 그렸다)
 *
 * 🔴 그리고 URL→섹션 지도가 **두 가드에 각자** 있었다. W9 에서 막은 우회로(lab-trends·
 *    chronic-trend·medical-expenses 등)가 한쪽에만 반영돼 갈라져 있었다.
 *
 * 규칙:
 *  - 키 집합은 여기 하나(`GUARDIAN_SCOPE_KEYS`) — 기본값도 여기서 만든다
 *  - 판정은 **fail-closed**: 섹션이 지도에 있는데 scope 가 `true` 라고 말하지 않으면 막는다
 *    ("모르면 안전측으로 접는다" · 키 누락이 곧 개방이 되면 안 된다)
 */

/** 위임 가능한 정보 구획 — 이 목록이 곧 화면이 보여줄 항목이다 */
export const GUARDIAN_SCOPE_KEYS = ['appointments', 'encounters', 'labs', 'imaging', 'billing', 'documents'] as const;
export type GuardianScopeKey = (typeof GUARDIAN_SCOPE_KEYS)[number];
export type GuardianScope = Partial<Record<GuardianScopeKey | 'sensitive', boolean>>;

/**
 * 일반 위임 기본값 — 임상 정보(진료·검사·영상)는 열고, 문서 발급은 닫는다.
 * 🔴 `imaging` 을 **명시**한다. 빠뜨리면 fail-closed 로 막히고, 화면과 서버가 또 갈라진다.
 */
export const DEFAULT_GUARDIAN_SCOPE: GuardianScope = {
  appointments: true, encounters: true, labs: true, imaging: true, billing: true, documents: false,
};

/**
 * 응급 임시 열람(break-the-glass) — 수납·문서·민감정보는 잠근다.
 * 🔴 영상도 잠근다: BTG 는 "지금 필요한 최소"이지 전체 위임이 아니다.
 *    (종전에는 키가 없어 BTG 에서도 DICOM 원본이 그대로 나갔다)
 */
export const BTG_GUARDIAN_SCOPE: GuardianScope = {
  appointments: true, encounters: true, labs: true, imaging: false, billing: false, documents: false, sensitive: false,
};

/** URL 조각 → 구획. 순서가 곧 우선순위다(더 구체적인 경로를 앞에) */
export const GUARDIAN_SECTION_MAP: { match: string; section: GuardianScopeKey }[] = [
  { match: 'cost-estimate', section: 'billing' },          // 2026-10-20 B6 — 예약 아래 경로지만 돈 정보다(BTG 는 수납을 잠근다)
  { match: 'appointments', section: 'appointments' },
  { match: 'encounters', section: 'encounters' },
  { match: 'lab-results', section: 'labs' },
  { match: 'lab-trends', section: 'labs' },              // W9 — 종전 매칭 없음(우회로)
  { match: 'chronic-trend', section: 'labs' },
  { match: 'chronic-observations', section: 'labs' },
  { match: 'diagnostic', section: 'labs' },
  { match: 'imaging', section: 'imaging' },
  { match: 'billings', section: 'billing' },
  { match: 'billing/annual-summary', section: 'billing' }, // W9 — 'billings'(복수)와 경로가 달라 새고 있었다
  { match: 'medical-expenses', section: 'billing' },        // W9
  { match: 'documents', section: 'documents' },
  { match: 'inpatient/interim-bill', section: 'billing' },
  { match: 'inpatient/meals', section: 'encounters' },
];

export function guardianSectionOf(url: string): GuardianScopeKey | undefined {
  return GUARDIAN_SECTION_MAP.find((s) => url.includes(s.match))?.section;
}

/**
 * 이 URL 을 이 범위로 막아야 하는가 — **fail-closed**.
 * 🔴 종전 `scope[section] === false` 는 키가 없으면 통과시켰다(그래서 imaging 이 열려 있었다).
 */
export function guardianDenies(scope: GuardianScope | undefined | null, url: string): boolean {
  const section = guardianSectionOf(url);
  if (!section) return false;             // 지도에 없는 경로는 이 게이트의 소관이 아니다
  return scope?.[section] !== true;
}
