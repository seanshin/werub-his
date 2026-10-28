/**
 * 식이 표기 정본 — 2026-08-12.
 *
 * 🔴 세 가지가 겹쳐 있었다.
 *   ① 라벨표가 **두 파일에 각자** 있고 내용이 다르다 — `nutrition/page.tsx` 7종 /
 *      `NutritionAdvanced.tsx` 15종. 급식 화면에는 `HIGH_PROTEIN`(고단백식)이 **없어서**
 *      코드가 그대로 노출될 수 있었다.
 *   ② **질감(texture) 라벨은 아예 없어** `SOFT`·`REGULAR` 가 화면에 영문으로 떴다.
 *   ③ DB 에 **영문 코드와 한글이 섞여** 저장돼 있다(실측: `DIABETIC`·`RENAL`·`HIGH_PROTEIN`
 *      과 `일반식`·`저염식`·`저단백식(CKD)` 이 공존). 마취 종류와 같은 병이다.
 *
 * 그래서 이 정본은 **코드와 한글 둘 다 받아** 한글 하나로 말한다.
 * 모르는 값은 **뭉개지 않고 그대로** 돌려준다 — 임상 기재(`저단백식(CKD)`)를 지우면 안 된다.
 *
 * ── 2026-08-27 · 정본이 둘이었다 ────────────────────────────────────────────
 * 🔴 `apps/api/src/modules/nutrition/diet-types.ts` 가 **같은 개념에 다른 코드**를 들고
 *    "단일 소스"라고 적어 두고 있었다 — 저염식 `LOW_SODIUM` · 간장식 `LIVER` · 저단백식 **없음**.
 *    그래서 그쪽 `normalizeDietLabel('LOW_SALT')` 는 라벨을 못 찾고 **영문 원문을 그대로** 냈다
 *    (v4.4.0 DUR 43룰·v4.1.0 누적선량과 같은 병 — 어휘가 갈라지면 조회가 조용히 빗나간다).
 *
 * 어느 쪽이 정본인가는 취향이 아니라 **실측**으로 갈랐다(저장소 전역 grep):
 *   · `LOW_SALT`   → 이 파일 + FE 3화면(`inpatient`·`workstation/nutrition`·`NutritionAdvanced`)
 *                    + `prisma/seed.ts:5796`(DietOrder 시드)          ⇒ **쓰이고 있다**
 *   · `LOW_SODIUM` → `diet-types.ts` **단 한 줄**. 읽는 곳도 쓰는 곳도 0  ⇒ 아무도 안 쓴다
 *   · `HEPATIC`    → 이 파일 + `NutritionAdvanced`                      ⇒ **쓰이고 있다**
 *   · `LIVER`      → `diet-types.ts` 단 한 줄(식이 맥락). 소비처 0
 *   · `LOW_PROTEIN`→ 이 파일 + `NutritionAdvanced`. api 목록에는 아예 없었다
 * **쓰이고 있는 값을 정본으로 삼는다.** 어휘를 새로 지어내지 않는다.
 */
export const DIET_TYPE_LABEL: Record<string, string> = {
  REGULAR: '일반식',
  LOW_SALT: '저염식',
  DIABETIC: '당뇨식',
  LOW_FAT: '저지방식',
  SOFT: '연식',
  LIQUID: '유동식',
  CLEAR_LIQUID: '맑은유동식',
  NPO: '금식',
  RENAL: '신장식',
  HEPATIC: '간장식',
  HIGH_PROTEIN: '고단백식',
  LOW_PROTEIN: '저단백식',
  LOW_RESIDUE: '저잔사식',
  PUREED: '갈은식',
  TUBE_FEEDING: '경관영양',
  TPN: '정맥영양(TPN)',
};

/**
 * 표시 순서를 가진 코드 목록 — 선택 UI·서버 목록 EP 가 이것을 쓴다.
 * `DIET_TYPE_LABEL` 과의 집합 일치는 가드가 강제한다(둘이 갈라지면 옵션이 조용히 빠진다).
 */
export const DIET_TYPE_CODES = [
  'REGULAR', 'LOW_SALT', 'DIABETIC', 'LOW_FAT', 'SOFT', 'LIQUID', 'CLEAR_LIQUID', 'NPO',
  'RENAL', 'HEPATIC', 'HIGH_PROTEIN', 'LOW_PROTEIN', 'LOW_RESIDUE', 'PUREED', 'TUBE_FEEDING', 'TPN',
] as const;

export type DietTypeCode = (typeof DIET_TYPE_CODES)[number];

/** `{ code, label }` 목록 — 종전 api `DIET_TYPES` 를 대체한다(모양 동일). */
export const DIET_TYPES: readonly { code: DietTypeCode; label: string }[] =
  DIET_TYPE_CODES.map((code) => ({ code, label: DIET_TYPE_LABEL[code] }));

/** 한글 라벨 → 코드. 레거시 한글 저장분을 코드로 되읽을 때만 쓴다. */
export const DIET_CODE_BY_LABEL: Record<string, string> = Object.fromEntries(
  DIET_TYPE_CODES.map((code) => [DIET_TYPE_LABEL[code], code as string]),
);

/**
 * 🔴 **레거시 코드 별칭 — 읽기 전용이다. 새로 쓰라는 어휘가 아니다.**
 *
 * 갈라져 있던 쪽 코드(`LOW_SODIUM`·`LIVER`)를 삭제만 하면, 혹시 그 값으로 저장된 행이
 * 어딘가에 있을 때 **라벨을 잃고 영문으로 샌다**(= 지금 `LOW_SALT` 에 일어나던 일의 대칭).
 * 어휘를 지어내지 않으면서 기존 기록을 고아로 만들지도 않는 방법은 **별칭으로 읽어 주는 것**뿐이다.
 * 쓰기 쪽(선택 UI·`DIET_TYPES`)에는 절대 넣지 않는다.
 */
export const DIET_TYPE_CODE_ALIAS: Record<string, string> = {
  LOW_SODIUM: 'LOW_SALT',
  LIVER: 'HEPATIC',
};

/**
 * 코드·별칭·한글 라벨 → **정본 코드**. 어느 것도 아니면 `null`.
 * 🔴 `null` 은 "표준 코드가 아니다"라는 사실이지 "일반식"이 아니다 — 뭉개지 않는다.
 */
export function dietCodeOf(value: string | null | undefined): DietTypeCode | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const up = v.toUpperCase();
  if (DIET_TYPE_LABEL[up]) return up as DietTypeCode;
  const alias = DIET_TYPE_CODE_ALIAS[up];
  if (alias) return alias as DietTypeCode;
  const byLabel = DIET_CODE_BY_LABEL[v];
  return byLabel ? (byLabel as DietTypeCode) : null;
}

/** 식사 질감 — 연하장애 환자의 안전과 직결된다(오연 위험) */
export const DIET_TEXTURE_LABEL: Record<string, string> = {
  REGULAR: '일반',
  SOFT: '연식',
  MINCED: '다진식',
  PUREED: '갈은식',
  LIQUID: '유동',
  THICKENED: '점도증진',
};

function lookup(table: Record<string, string>, value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  if (!v) return fallback;
  return table[v] ?? table[v.toUpperCase()] ?? v; // 한글 저장분·미등재 값은 그대로
}

/**
 * 식이 종류 → 한글. 코드·한글 어느 쪽이 와도 한글 하나로 답한다.
 * 갈라져 있던 레거시 코드(`LOW_SODIUM`·`LIVER`)도 라벨을 찾는다 — 읽기만 한다.
 */
export function dietTypeText(value: string | null | undefined, fallback = '-'): string {
  if (!value) return fallback;
  const v = value.trim();
  if (!v) return fallback;
  const alias = DIET_TYPE_CODE_ALIAS[v.toUpperCase()];
  if (alias) return DIET_TYPE_LABEL[alias];
  return lookup(DIET_TYPE_LABEL, v, fallback);
}

/**
 * 종전 api `nutrition/diet-types.ts` 의 이름 — 동작은 그대로 두고 **표만 정본으로 바꿨다**.
 * (빈 값을 `'일반식'` 으로 답하는 것은 원래 동작이라 유지한다. 새 코드는 `dietTypeText` 를 쓴다.)
 * @deprecated `dietTypeText(value, fallback)` 를 쓴다.
 */
export function normalizeDietLabel(value?: string | null): string {
  return dietTypeText(value, '일반식');
}

/** 식사 질감 → 한글. */
export function dietTextureText(value: string | null | undefined, fallback = '-'): string {
  return lookup(DIET_TEXTURE_LABEL, value, fallback);
}

/** 표준 코드로 저장된 값인가 — 마이그레이션 대상 식별용 */
export function isCanonicalDietCode(value: string | null | undefined): boolean {
  return !!value && !!DIET_TYPE_LABEL[value.trim()];
}

// ── 급식 오더 상태 정본 (2026-08-21) ────────────────────────────────────────
/**
 * 🔴 급식 상태 어휘가 선언된 적이 없었다.
 *   · Prisma 모델 주석은 `ORDERED, PREPARED, DELIVERED, COMPLETED, PARTIAL, REFUSED` 라 적어 두고
 *     **운영 실측은 `UNDELIVERED` 23 · `REFUSED` 1** 이었다(주석에 없는 값이 원장의 대부분).
 *   · `UpdateMealStatusDto.status` 가 `@IsString()` 뿐이라 **아무 문자열이나 저장**됐다.
 *   · 라벨은 `tablet/nutrition` 이 **로컬 Record 로 재정의**하고 있었다(UX 규약 위반 — 정본서 조용히 드리프트).
 *
 * 이 저장소는 같은 병을 이미 앓았다 — 어휘가 갈라지면 **집계 조건이 조용히 빗나가고**
 * 안전장치가 꺼진다(v4.1.0 누적선량·v4.4.0 DUR 43룰).
 */
export const MEAL_ORDER_STATUS = [
  'ORDERED',      // 오더됨(생성 직후)
  'PREPARED',     // 조리 완료
  'DELIVERED',    // 배식 완료
  'COMPLETED',    // 섭취 기록까지 완료
  'PARTIAL',      // 일부 섭취
  'REFUSED',      // 환자 거부
  'UNDELIVERED',  // 미배식(NPO·검사·부재 등 — `undeliveredReason` 과 한 벌)
] as const;
export type MealOrderStatus = (typeof MEAL_ORDER_STATUS)[number];

export const MEAL_ORDER_STATUS_LABEL: Record<MealOrderStatus, string> = {
  ORDERED: '오더됨',
  PREPARED: '조리 완료',
  DELIVERED: '배식 완료',
  COMPLETED: '섭취 완료',
  PARTIAL: '일부 섭취',
  REFUSED: '거부',
  UNDELIVERED: '미배식',
};

/** 🔴 배식이 실제로 이뤄진 상태 — 집계는 문자열을 직접 비교하지 말고 이것을 쓴다 */
export const MEAL_DELIVERED_STATUSES: MealOrderStatus[] = ['DELIVERED', 'COMPLETED', 'PARTIAL'];

export const isMealOrderStatus = (v: unknown): v is MealOrderStatus =>
  typeof v === 'string' && (MEAL_ORDER_STATUS as readonly string[]).includes(v);

/** 모르는 값은 뭉개지 않고 그대로 돌려준다 — 원장에 있는 사실을 지우지 않는다 */
export function mealOrderStatusText(value: string | null | undefined, fallback = '-'): string {
  if (!value) return fallback;
  return MEAL_ORDER_STATUS_LABEL[value as MealOrderStatus] ?? value;
}

/**
 * 미배식 사유 — 🔴 **자유 문자열이다. 화이트리스트로 막지 않는다.**
 *
 * 2026-08-21 운영 실측에서 저장된 값은:
 *   · `[2026-08-12 데이터 정리] 배식일 경과 — 미배식으로 종결(배식 기록 없음)` × 22 (정리 배치의 출처 문장)
 *   · `검사(NPO)` × 1 (현장 자유 입력)
 * 여기에 영문 enum(`NPO|TEST|…`)을 강제하려다 멈췄다 — **아무도 쓰지 않는 어휘를 지어내면**
 * 기존 화면이 깨지고 이미 남은 기록이 고아가 된다(v4.6.0 에서 같은 실수를 했다:
 * FE 에 지어낸 어휘를 넣어 서버와 교집합 0 이 됐고, 내 가드가 내 어휘를 테스트해 통과했다).
 *
 * 그래서 정본이 정하는 것은 **입력 보조(자주 쓰는 사유)** 이지 허용 목록이 아니다.
 * 강제하는 것은 하나뿐 — **미배식이면 사유가 비어 있으면 안 된다**(서버가 검증한다).
 */
export const MEAL_UNDELIVERED_REASON_PRESET = ['금식(NPO)', '검사', '부재', '거부', '전동/퇴원'] as const;

/** 사유는 그대로 보여준다 — 모르는 값을 뭉개면 원장에 있는 사실이 지워진다 */
export function mealUndeliveredReasonText(value: string | null | undefined, fallback = '-'): string {
  const v = (value ?? '').trim();
  return v || fallback;
}
