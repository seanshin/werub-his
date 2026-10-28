/**
 * 식이유형 코드체계 — **정본은 shared `@hospital-run/shared` `diet.ts` 하나다.**
 *
 * 🔴 2026-08-27. 이 파일은 스스로 "단일 소스"라고 적어 두고 shared 정본과 **다른 코드**를 들고 있었다:
 *      저염식 `LOW_SODIUM`(정본 `LOW_SALT`) · 간장식 `LIVER`(정본 `HEPATIC`) · 저단백식 **누락**.
 *    결과로 `normalizeDietLabel('LOW_SALT')` 가 라벨을 못 찾아 **영문 코드를 그대로** 돌려줬다.
 *    같은 병을 이 저장소는 이미 세 번 앓았다 — v4.1.0 누적선량(상태 문자열)·v4.4.0 DUR 43룰(한글 룰
 *    vs 영문 마스터)·v3.98 급식 상태. **어휘가 갈라지면 조회가 조용히 빗나간다.**
 *
 *    어느 쪽을 정본으로 삼을지는 실측으로 갈랐다(전역 grep):
 *      `LOW_SODIUM`·`LIVER`(식이) = **이 파일 각 한 줄뿐, 읽는 곳도 쓰는 곳도 0**.
 *      `LOW_SALT`·`HEPATIC`·`LOW_PROTEIN` = FE 3화면 + `prisma/seed.ts` 가 실제로 쓴다.
 *    → **쓰이고 있는 값이 정본**이다. 지어낸 어휘로 기존 기록을 고아로 만들지 않는다.
 *
 * 이 파일은 이제 **재수출 껍데기**다(경로를 살려 두되 갈라질 수 없게 한다).
 * 새 코드는 `@hospital-run/shared` 에서 직접 가져온다.
 */
export {
  DIET_TYPES,
  DIET_TYPE_CODES,
  DIET_TYPE_LABEL as DIET_LABEL,
  DIET_CODE_BY_LABEL,
  DIET_TYPE_CODE_ALIAS,
  dietCodeOf,
  dietTypeText,
  normalizeDietLabel,
  type DietTypeCode,
} from '@hospital-run/shared';
