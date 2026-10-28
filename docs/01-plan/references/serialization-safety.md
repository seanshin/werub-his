# 응답 직렬화 안전 가이드 (React #31 방어)

> 작성: 2026-06-10 · 배경: Date 직렬화 인터셉터가 Prisma `Decimal`의 프로토타입을 벗겨 `{s,e,d}` plain 객체로 만들어 프론트 렌더 시 **React error #31**(object with keys {s,e,d}) 유발. 화상진료·patient summary·진료시작 등에서 재발.

## 근본 원인
- Prisma `Decimal`은 `toJSON()`이 있어 정상적으론 **문자열**로 직렬화됨(안전).
- 그런데 `DateSerializerInterceptor`가 **모든 object를 `Object.entries`로 재구성** → Decimal의 프로토타입(+`toJSON`) 소실 → `{s,e,d}` 객체로 응답에 노출 → 프론트가 객체를 JSX에 렌더 → #31.

## 4겹 방어 (현재 적용)
| 계층 | 조치 | 위치 |
|------|------|------|
| **1. 직렬화 경계(단일 변환점)** | 인터셉터가 **plain object/배열만 재귀**, Date→ISO·Decimal→number·BigInt→number, **클래스 인스턴스는 프로토타입 보존**(재구성 금지). 프로토타입 소실된 plain `{s,e,d}`도 재구성. | `apps/api/src/common/interceptors/date-serializer.interceptor.ts` |
| **2. 회귀 테스트 + CI** | Decimal 인스턴스/plain `{s,e,d}`/BigInt/Buffer/중첩 모두 검증. CI `Serialization safety test` 단계. | `*.interceptor.spec.ts`, `.github/workflows/ci.yml` |
| **3. 소스 변환은 의도적 제외** | 아래 참조 | — |
| **4. 프론트 최후 보루** | `toSafeNumber/formatNumber/formatCurrency` — 객체·문자열 입력도 안전 변환. 금액/수치는 표시 직전 반드시 number화. | `apps/web/src/lib/safe-number.ts` |

## ⚠️ 의도적 결정 — Prisma 단계 전역 Decimal→number 변환은 **하지 않음**
- 유혹: Prisma Client extension으로 모든 Decimal을 number로 바꾸면 소스에서 끝남.
- **그러나 금지**: 청구/수가/원가 등 **금액 계산은 Decimal 정밀도가 필수**(부동소수점 오차 → 금전 오류). 쿼리 결과를 number로 바꾸면 서비스 내부 Decimal 연산·`.toFixed`·정확 비교가 깨짐.
- **원칙**: **내부는 Decimal 유지(정밀), 변환은 "응답 경계"에서만**(계층 1). 변환점은 한 곳이어야 한다.

## 개발 규칙
1. 응답을 가공하는 인터셉터/직렬화기는 **특수 객체(Decimal·Buffer·BigInt·Date) 프로토타입을 보존**해야 한다. `Object.entries` 무차별 재구성 금지 — plain object만.
2. 프론트는 **금액/수치를 JSX에 직접 렌더하지 말고** `formatNumber/formatCurrency` 사용.
3. 새 특수 타입(예: 새로운 도메인 객체) 도입 시 계층 1·2에 케이스 추가.
4. 공유 타입(`packages/shared`)에서 금액/수치 필드는 `number`로 선언(경계 변환 후 형태와 일치).
