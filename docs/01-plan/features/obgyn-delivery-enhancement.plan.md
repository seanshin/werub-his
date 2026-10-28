# 산과/분만(OB/Delivery) 보강 기획 — P1·P2·P3

> 2026-07-04 / Plan v1.0 / 대상: `apps/api/src/modules/obgyn`·`apps/web/.../obgyn`
> 계기: 검토 결과 가장 취약 — 산전/부인과/초음파는 있으나 **분만(L&D) 전용 모델·워크플로 부재**.

## 1. 현황
- `ObGynExam` 단일 테이블(PRENATAL/GYNECOLOGY/LABOR/POSTPARTUM). 분만 전용 필드 없음(방식·Apgar·출혈·신생아 X).
- getToday/getStats 스텁(빈 배열·0).

## 2. 보강 범위 (3가지 모두)

### P1 — 분만기록 + 신생아 + L&D 보드
- **`DeliveryRecord`**: deliveryType(질식/흡입/겸자/제왕)·분만일시·재태주수·1/2/3기 소요·마취·실혈량(mL)·적응증·합병증·집도의.
- **`NewbornRecord`**(deliveryId 연계): 출생일시·성별·체중/신장/두위·**Apgar 1/5/10분**·소생술·**NICU 입원**·수유·비고.
- **L&D 보드**: 진행 중 분만(활성) 목록 + 오늘 분만 통계. getToday/getStats 실구현.

### P2 — 파토그램 + 산욕
- **`LaborProgressRecord`**(시계열): 자궁경부 개대·하강도(station)·수축 빈도/강도·FHR·시각 → 파토그램 플로팅.
- **산욕(Postpartum)**: 오로·자궁저부·회음/제왕 상처·수유·합병증 — DeliveryRecord에 postpartum 필드 or 재사용.

### P3 — 산전 위험 + 통계
- 산전 위험 계층화(고/중/저)·분만 통계(방식별·제왕률·NICU율).

## 3. 안전·정합
- 신규 모델 3종 plain patientId(Patient 미수정). 기존 ObGynExam 흐름 무영향.
- Apgar·실혈량·NICU는 환자안전/질지표 핵심.

## 4. 배포
신규 모델 3 → manual SQL → prisma generate → --api → --web.
