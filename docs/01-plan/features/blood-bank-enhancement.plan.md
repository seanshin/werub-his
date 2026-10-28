# 혈액은행(Blood Bank) 보강 기획 — P1·P2·P3

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/blood-bank/blood-bank.service.ts · apps/api/prisma/schema.prisma:3219 · apps/api/prisma/schema.prisma:3249 · 잔여: 없음

> 2026-07-04 / Plan v1.0 / 대상: `apps/api/src/modules/blood-bank`·`apps/web/.../blood-bank`
> 계기: 현황 검토 — 핵심 수혈 안전체인(재고·교차시험·2인확인·수혈반응)은 견고하나 수혈검사 기반·MTP·반응 신고 미비.

## 1. 현황 (기구현·견고)
재고(만료추적·통계)·교차시험(+항체선별·72h 유효)·수혈오더(특수요구·수혈전Hb)·**병상 2인 간호사 확인**·수혈중 활력·수혈반응 플래그. 16 EP.

## 2. 보강 범위 (3가지 모두)

### P1 — 수혈검사 기반 + 대량수혈
- **환자 혈액형(PatientBloodTyping)**: ABO/Rh 확정(2차 재검)·항체선별·검사자. 환자 1:1.
- **불규칙항체 이력(PatientAntibody)**: 동정 항체(anti-E·anti-K 등)·임상적 유의성·이력 누적.
- **대량수혈 프로토콜(MassiveTransfusionProtocol)**: 활성화(외상/산과/GI/수술)·비율(1:1:1)·출고 팩 수·해제. ACTIVE/DEACTIVATED.
- **긴급 출고(emergency O⁻ uncrossmatched)**: issueBlood에 emergency 플래그 — 교차시험 미완 출고 + 사유·감사.

### P2 — 수혈반응 신고 + 특수제제 + 반납/폐기
- **수혈반응 상세 보고(TransfusionReactionReport)**: 유형(발열/알레르기/급성·지연 용혈/TRALI/TACO/패혈증)·중증도·징후·워크업(Json)·**혈액원 신고**(reportedToBloodCenter)·경과. 수혈 1:1.
- **특수제제 속성**: BloodProduct += 방사선조사(irradiated)·백혈구제거(leukoreduced)·CMV음성(cmvNegative)·세척(washed). 오더 특수요구 매칭 근거.
- **반납/폐기(return/discard)**: 전용 EP·사유 기록·상태 전이(RETURNED→AVAILABLE / DISCARDED).
- **수혈 동의 연계**: TransfusionOrder += consentId(선택).

### P3 — 재고 알림 + 발주
- **재고 임계 알림**: 혈액형×제제 재고가 임계 미만 → 알림(GET inventory/alerts). 임계 SystemConfig.
- **혈액원 발주(BloodReorderRequest)**: 제제·혈액형·수량·요청자·상태·공급처.

## 3. 안전·정합
- 신규 모델/필드 전부 **가산적**(nullable·기본값)·기존 흐름 무영향.
- 긴급 출고는 **게이트 우회가 아니라 명시적 사유+감사**(추적성 강화).
- 환자 관계는 plain patientId(비파괴·Patient 모델 미수정).

## 4. 배포
신규 모델 5종 + 필드 → manual SQL(CREATE TABLE·ALTER ADD) → prisma generate → --api → --web. 데이터 손실 0.
