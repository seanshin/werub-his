# 급양과 운영 기획서 — 생산·배식·식후 관리

- **버전**: v0.1 (2026-07-09·초안)
- **범위**: 실제 식사 **생산(조리) → 입원환자 배식(제공)·확인 → 식후 관리**의 운영 라이프사이클
- **기반선**: 급양 보강 P0~P3 완료(`nutrition-catering-enhancement.plan.md`) — MealOrder(intakePercent·wardName·allergies·status)·병동별 식수집계·배식/섭취 태블릿. 본 기획은 그 위에 **생산·검식·배식확인·식후 관리** 운영을 얹음.

## 1. 목표
1) 식수 확정→생산→검식→배식→섭취→식후 관리를 **하나의 추적 가능한 흐름**으로.
2) **환자 안전**: 배식 5-Rights(본인·식이·알레르기·온도·시간) 확인, 검식·HACCP 온도 기록.
3) **식후 관리**: 섭취 부진 조기 발견 → 영양팀 연계 → 식이 재평가 → 개선 폐순환(closed-loop).

## 2. 프로세스 설계

### 2-A. 생산(조리) — 급양과 조리팀
```
식수 마감확정 → 생산량 산출 → 조리지시서 → 조리 진행 → 검식(관능) → HACCP CCP → 배선 준비
```
- **식수 마감·생산량 산출**: 특정 시각 마감(config) → MealOrder(환자)+StaffMealRequest(직원) 집계 → **식이유형별 생산 수량** 자동 전개(`ProductionBatch`).
- **조리 지시서**: 배치별 식이유형·수량·특이(알레르기 대체·질감) 목록. 조리 시작/완료 체크(시간).
- **검식(검수)**: 조리 완료 후 관능검사(맛·온도·양·위생) 기록 + 검식자 서명. 부적합 시 재조리.
- **HACCP CCP**: 중요관리점(가열 중심온도 ≥75℃·보관 냉장 ≤5℃/온장 ≥57℃·시간) 측정·기록. 이탈 시 시정조치.

### 2-B. 배식(제공)·확인 — 병동 배식/간호
```
병동 배차 → 배선(트레이) → 환자 확인(5-Rights) → 배식 완료 → 미배식 사유
```
- **병동 배차**: 병동별 식단 카트 배정(기존 census 활용).
- **배선 검증**: 트레이 세팅 시 식이유형·알레르기 대체 최종 확인.
- **환자 확인(5-Rights)**: ① 본인(팔찌/바코드) ② 식이유형 일치 ③ **알레르기 재확인**(정식 Allergy 대조·차단 경고) ④ 배식 온도 ⑤ 배식 시간. → `MealDeliveryCheck`.
- **배식 완료/미배식**: 상태 DELIVERED. 금식(NPO)·검사·부재·거부 등 **미배식 사유** 코드 기록.

### 2-C. 식후 관리 — 병동 간호·영양팀
```
섭취량 기록 → 잔반·회수 → 섭취부진 감지 → 영양팀 연계 → 식이 재평가 → 개선
```
- **섭취량**: 이미 태블릿 입력(P3·intakePercent). 확장: 잔반량·거부 사유·수분 섭취(I/O 연동 이미 있음).
- **회수**: 트레이 회수 체크(감염·미회수 방지).
- **섭취 부진 자동 감지**: 연속 N끼 ≤25%(또는 일 평균 <50%) → **알림**(영양팀·주치의) + 영양평가 재실시 큐. (기존 알림 인프라 재사용)
- **폐순환**: 부진 → 영양상담(NutritionCounsel)·식이 재처방(DietOrder 변경)·특수영양(EN/TPN) 검토 → 재평가.

## 3. 데이터 모델(신규)
```
model ProductionBatch {           // 생산 배치(끼니·식이유형별)
  date, mealType, dietType, plannedQty, producedQty,
  cookStartAt?, cookEndAt?, status(PLANNED/COOKING/DONE), cookedBy?
}
model MealInspection {            // 검식(관능·검수)
  productionBatchId, taste, temperature, portion, hygiene, pass(bool), inspectedBy, notes
}
model HaccpCheck {                // HACCP CCP 기록
  productionBatchId?, ccpType(HEATING/COLD/HOT/TIME), value, withinLimit(bool), correctiveAction?, checkedBy, at
}
model MealDeliveryCheck {         // 배식 확인(5-Rights)
  mealOrderId, patientVerified, dietVerified, allergyVerified, tempOk, deliveredAt, deliveredBy, undeliveredReason?
}
// MealOrder 확장: leftoverPercent?, refusalReason?, trayCollectedAt?
```

## 4. 화면·역할
- **급양과 조리(생산 콘솔·PC/주방 태블릿)**: 생산량·조리지시서·검식·HACCP 입력. `/nutrition/production`.
- **병동 배식/간호(태블릿·기존 /tablet/nutrition 확장)**: 배식 5-Rights 체크·미배식 사유·섭취·회수.
- **영양사(영양팀)**: 섭취부진 큐·재평가·상담·식이 재처방.
- **역할 권한**: 영양사(DIETITIAN) 또는 `nutrition:manage`(현재 ADMIN 일괄 → 분리 검토).

## 5. 안전·품질 체크포인트
- 배식 전 **알레르기 재확인 차단 경고**(정식 Allergy 대조) — 필수 게이트.
- 검식 미통과/HACCP 이탈 시 배식 차단 or 경고.
- 본인확인(팔찌 바코드) 연동 — 오배식 방지.
- 섭취부진 자동 알림 SLA.

## 6. 단계
- **P0** ✅(2026-07-09·PR#362): 생산량 산출+조리지시서+생산 상태(ProductionBatch) · 배식 알레르기 차단(태블릿 confirm). **+MealDeliveryCheck 5-Rights 영속(PR#365)**.
- **P1** ✅(2026-07-09·PR#362~364): 검식(MealInspection) · 미배식 사유(undeliveredReason) · 섭취부진 census. **+섭취부진 자동 알림(연속 3끼≤25%→주치의)·잔반/회수(leftoverPercent·trayCollectedAt·refusalReason)(PR#365)**.
- **P2** 🔶 부분(PR#365): **HACCP CCP 기록·자동 이탈판정·시정조치**(가열≥75℃·냉장≤5℃·온장≥57℃·시간≤120분) ✅ · 폐순환=섭취부진 알림으로 진입점 마련(재평가·재처방은 기존 화면). ⏳ **영양사(DIETITIAN) 역할 분리 유보**(UserRole enum 신설=전역 guard 파급 → RBAC 정책 게이트).
- **P3** ⏳ 유보: 본인확인 바코드 연동(하드웨어) · 원가/식재료(별도 발주/ERP 도메인) · 통계(생산효율·섭취율 추이·운영데이터 축적 후).

## 7. 게이트(선결)
- 🔒 **급양과 SOP 확정**: 마감시각·생산 배치 단위·검식 항목·HACCP CCP 기준(원내 위생 기준).
- 🔒 **HACCP 인증 요건**(해당 시)·법정 기록 보존.
- 🔒 영양사 역할/권한 정책(RBAC 확장 여부).
- 범위 밖(초기): 외주급식 정산·식자재 유통 연동.
