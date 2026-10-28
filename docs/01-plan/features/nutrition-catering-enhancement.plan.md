# 급양(給養)·급식·영양 보강 기획서

- **버전**: v0.1 (2026-07-09·초안)
- **대상**: `nutrition` 모듈(환자 급식·영양) + `staff-meal`(직원 급식) + 급식운영
- **기준선**: 기존 `docs/01-plan/features/advanced-nutrition.plan.md`(계획 필드 일부 미반영). 본 문서는 **실제 구현 상태 대비 갭**을 기준.

## 1. 현황 요약
전용 `nutrition` 모듈 존재(기본 MealOrder + advanced DietOrder/Assessment/Counsel). "기록·조회"는 되나 **①처방→급양 워크플로우 단절 ②급식 운영(생산·발주·원가·위생) 부재 ③특수영양(TPN/경장) 실처방 부재 ④알레르기 미연계 ⑤일부 버그**가 핵심 갭.

## 2. 핵심 갭 (조사 결과)
| 영역 | 상태 | 핵심 갭 |
|---|---|---|
| 식이처방 DietOrder | 부분 | 처방(Order.DIET→PHARMACY 임시매핑)과 DietOrder 단절·dietType 코드체계 없음 |
| 배식/식수 MealOrder | 부분 | **병동별 집계 없음·알레르기 자동필터 없음·`intakePercent` 미저장(버그)**·일괄생성 취약(unique 없음) |
| 영양평가 | 부분 | NRS-2002 문항 없음(총점만)·MNA/MUST 없음·prealbumin 등 미반영 |
| TPN/경장영양 | 없음 | 드롭다운 라벨만·처방/조성/주입/프로토콜 모델 전무 |
| 직원급식 | 있음 | CONFIRMED 전이·마감·발주·정산(식대공제) 없음 |
| 급식운영 | 없음 | 식단편성·영양소계산·식재료·원가·발주·HACCP 도메인 부재 |
| 영양사 역할/워크스테이션 | 부분 | 전용 Role 없음(ADMIN)·**nutrition 큐가 LAB로 폴백(버그)** |
| 알레르기 연계 | 없음 | 정식 Allergy 모델과 급식 미연결(문자열 덤프만) |
| 오더세트/모바일/FHIR | 없음/부분 | 식이 오더셋 없음·모바일 화면 없음·NutritionOrder는 CarePlan detail만 |

## 3. 보강 방향 (우선순위)

### 🔴 P0 — 단절·버그 해소 (저위험·즉효)
1. **섭취량 정상화**: `MealOrder.intakePercent Int?` 필드 추가(현재 스키마 부재 → 계산만 되고 저장 안 됨). `recordMealIntake` 저장·`daily-summary` 실값화.
2. **영양 워크스테이션 큐 수정**: `workstation.service STATION_DEPT_MAP`에 `nutrition` 키 부재 → LAB 폴백. nutrition 큐를 **MealOrder 기반**(조리/배식 대기)으로 분기.
3. **dietType 코드체계**: 프론트 상수 15종 → 서버 enum/코드마스터(`DietType`)로 승격(일반·저염·당뇨·저지방·연식·유동·맑은유동·NPO·신장·간장·고단백·저잔사·갈은식·경관·정맥). DietOrder·MealOrder·Admission 공통 참조.
4. **처방→급양 워크플로우 연결**: `Order/Prescription.DIET`를 PHARMACY 임시매핑 해제 → **DietOrder 생성으로 라우팅**(order.service). 의사 식이처방 → 급양실 자동 전달.
5. **알레르기 자동 반영**: MealOrder 생성 시 정식 `Allergy` 모델(active·food type) 조회 → `allergies` 구조화 + 금기 경고. 대시보드 알레르기 판정을 restrictions→Allergy로 교정.

### 🟡 P1 — 급식 운영 기본 (배식보드·집계·평가)
6. **병동별 식수 집계·배식 보드**: `GET /nutrition/meals/census?date&mealType` → 병동×식이유형 매트릭스. 배식 진행판(조리→배식→섭취) — 태블릿/워크스테이션.
7. **일괄생성 견고화**: `@@unique([admissionId,date,mealType])` + upsert 정상화(중복 방지).
8. **영양평가 표준화**: NRS-2002 실제 문항(초기+최종 스크리닝) 자동 총점, MNA-SF(노인)·MUST 선택. prealbumin·연하곤란·치아 필드. 위험군 자동 상담 큐.
9. **직원급식 운영**: CONFIRMED 전이·**신청 마감시간**(config)·일별 발주량 확정·**식대 정산**(급여공제 연계 `billing.discount.staff` 또는 ERP 릴레이).

### 🟢 P2 — 특수영양·식단 편성
10. **경장영양(EN) 프로토콜**: 제제·투여경로(비위관/PEG)·목표량·증량스케줄·잔여량 모니터·합병증.
11. **정맥영양(TPN)**: 조성(포도당/아미노산/지질/전해질/미량원소)·칼로리/질소·주입속도·검사연동(전해질·중성지방·간기능)·약제부 조제 연계.
12. **식단 편성·영양소 계산**: 표준레시피·식품DB(칼로리/3대영양소/나트륨) 자동합산·주간 식단표·치료식별 영양기준 검증.

### ⚪ P3 — 운영 고도화
13. **식재료·발주·원가·재고**: 식수→식재료 소요량 전개(BOM)·발주·입고·원가.
14. **위생(HACCP)**: CCP 점검(온도·보관)·위생점검 체크리스트·이력.
15. **모바일**: 환자 식단/알레르기 확인·간호 섭취량 입력(태블릿)·직원 식수 신청(모바일).
16. **FHIR NutritionOrder** 정식 리소스(현 CarePlan detail → 독립 리소스 + 외부 연동).

## 4. 데이터 모델 변경(요약)
- `MealOrder`: +`intakePercent Int?`·+`wardName`(집계)·`dietTypeCode` enum·`@@unique`.
- 신규 `DietType`(코드마스터) 또는 Prisma enum.
- 신규 `EnteralNutritionOrder`·`ParenteralNutritionOrder`(P2).
- 신규 `MealMenuRecipe`·`FoodItem`(P2)·`FoodStock`/`FoodPurchaseOrder`(P3).
- `NutritionAssessment`: +NRS-2002/MNA/MUST 세부·prealbumin·dysphagia.
- `StaffMealRequest`: 마감·정산 필드.

## 5. 역할·권한
- **영양사(DIETITIAN) Role 신설** 검토 또는 기존 역할에 `nutrition:manage` 권한 분리(현재 전부 ADMIN). RBAC 확장.

## 6. 단계·게이트
- **P0**(즉효·저위험) 먼저 배포 → P1(운영 기본) → P2(특수영양·**약제부/의사 협의 게이트**) → P3(원가·HACCP·**급양과 운영 프로세스 확정 게이트**).
- 범위 밖: 외주급식업체 정산(ERP)·식자재 유통 연동(초기 제외).
