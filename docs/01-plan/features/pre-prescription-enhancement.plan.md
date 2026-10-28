# 사전처방 (Pre-Prescription) 상세 기획

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:8762 model PreOrder · apps/api/src/app.module.ts:114 · 잔여: 없음

> 작성: 2026-07-14 / 상태: Plan v1.0 (승인 대기 — 구현 착수 전 검토 필요)
> 관련: [diagnosis-order-set-management](diagnosis-order-set-management.plan.md) · [diagnosis-treatment-schedule](diagnosis-treatment-schedule.plan.md)
> 한 줄: 약속처방(OrderSet=진단별 **템플릿**)과 구별되는 사전처방(PreOrder=**특정 환자**에게 미리 내리는 개별 처방 예약)을 대학병원급 워크플로로 완성한다 — 유형 확장·예약 연계·승인/활성화 게이트·DUR 사전체크·만료·감사.

---

## 1. 개념 정의 (약속처방과의 구별)

| | 약속처방 (OrderSet) | **사전처방 (PreOrder)** |
|---|---|---|
| 본질 | 진단/상황별 처방 **템플릿** (환자 무관) | **특정 환자**에게 미리 작성해 두는 처방 **예약** |
| 작성 시점 | 관리자/의사가 사전 정의·승인 | 진료 중 or 진료 전 (재진 대비·검사 선행) |
| 발효 | 진료 중 적용 → 즉시 처방 생성 | 예정일/차기 진료에 **승인 → 처방·오더 전환** |
| 대표 사례 | "폐렴 입원 세트" | "다음 재진 2주 전 HbA1c 채혈", "수술 전일 금식+장정결제" |

## 2. 배경·현황 (2026-07-14 실사)

### 이미 있는 것
- **`PreOrder` 모델**(schema:7466): type(MEDICATION/LAB/IMAGING)·용법 필드·`scheduledDate/scheduledTime`·status(PENDING/MODIFIED/APPROVED/CANCELLED/EXPIRED)·`expiresAt`·승인자·encounterId/prescriptionId 연결.
- **승인 전환**(pre-order.service.ts:116 `approve`): 승인 시 `Prescription`(source='PRE_ORDER') + `Order`(부서 라우팅) **자동 생성**. modify/cancel 존재.
- **FE 배너**(PreOrderBanner.tsx): 진료화면 상단 미결 사전오더 건수 → 승인/취소.
- `Prescription.source`에 PRE_ORDER 출처 추적 존재.

### 갭
| # | 갭 |
|---|----|
| G1 | **유형 3종뿐** — THERAPY/DIET/ACTIVITY/NURSING 사전오더 불가 (PrescriptionType은 7종) |
| G2 | **작성 진입점이 없음** — 모델·승인만 있고 FE에서 사전처방을 **작성하는 UI 부재** (배너는 소비 전용) |
| G3 | **예약(Appointment) 미연계** — "다음 재진 시" 개념 없음. scheduledDate 수동 입력만 |
| G4 | **DUR 사전체크 부재** — 승인 시점에만 처방 생성되므로 작성 시점 안전성 미검증 |
| G5 | **만료 처리 불완전** — `expiresAt` 필드는 있으나 EXPIRED 전환 크론 없음 (원외처방 만료 크론과 별개) |
| G6 | **검사실 선행 준비 미연동** — 채혈 사전오더가 있어도 검사실 워크리스트에 예정건으로 안 보임 |
| G7 | **반복 사전처방 없음** — "매 재진 시 채혈" 같은 반복 규칙 미지원 |
| G8 | **권한·감사 얇음** — 작성/승인 권한 분리 없음, 수정 이력 없음 |

## 3. 핵심 설계

### 3.1 데이터 모델 확장

```prisma
model PreOrder {
  // 기존 필드 유지 +
  type            String   // MEDICATION|LAB|IMAGING|THERAPY|DIET|ACTIVITY|NURSING  ← 7종 확장
  appointmentId   String?  // ★ 예약 연계: "이 재진에서 시행"
  activationMode  String @default("ON_APPROVAL")
                  // ON_APPROVAL: 진료 중 의사 승인 시 전환 (현행·기본)
                  // ON_CHECKIN:  연계 예약 접수(CHECKED_IN) 시 자동 전환 — 검사 선행용
  durSnapshot     Json?    // 작성 시점 DUR 결과 (경고 스냅샷)
  recurringGroupId String? // 반복 그룹 (Appointment 패턴 이식)
  revisions       PreOrderRevision[]  // 수정 이력 (수정 전 값 스냅샷)
}
```

**상태기계 (확정)**
```
PENDING ──approve()──────────→ APPROVED (Prescription+Order 생성, 연결)
   │  └─modify()→ MODIFIED ─┘        (MODIFIED도 approve 가능)
   ├─cancel()→ CANCELLED
   └─(cron) expiresAt 경과 → EXPIRED
APPROVED 이후는 일반 처방/오더 라이프사이클 (PreOrder는 종결)
```

### 3.2 활성화 게이트 — 두 모드

**(a) ON_APPROVAL (기본·현행 유지)**: 차기 진료 중 배너에서 의사가 검토·승인 → 전환. 사람이 항상 게이트.

**(b) ON_CHECKIN (신규 — 검사 선행 시나리오)**:
```
재진 예약 + 채혈 사전오더(appointmentId 연계, activationMode=ON_CHECKIN)
  → 예약일 접수(CHECKED_IN 이벤트)
  → 리스너가 자동 전환: Prescription+Order(LAB) 생성 → 검사실 워크리스트 진입
  → 환자가 진료 전 채혈 → 진료 시점에 결과 준비됨
```
- **안전 게이트**: ON_CHECKIN은 **비약물(LAB/IMAGING)만 허용** — 약물은 반드시 의사 대면 승인(ON_APPROVAL 강제). config `preOrder.autoActivation`(OFF|ON, 기본 OFF)로 기능 전체 게이팅(기존 config 게이트 선례).
- 자동 전환 실패(코드 미해석 등)는 PENDING 유지 + 배너 경고.

### 3.3 작성 진입점 (FE)

1. **진료화면(CPOE)**: 처방 패널에 "사전처방으로 저장" 토글 — 현재 작성 중 항목을 즉시 처방 대신 PreOrder로 저장(scheduledDate/연계 예약 선택 모달). 기존 addPrescription 폼 재사용.
2. **예약 생성 화면**: 재진 예약 생성 직후 "이 예약에 사전처방 추가" (검사 선행 UX의 자연 진입점).
3. **퇴원 프로세스**: 퇴원 시 "퇴원 후 재진 사전처방" 섹션(퇴원약과 구별 — 재진일 검사·처치 예약).
4. **환자차트 사전처방 탭**: 환자별 PENDING/APPROVED/EXPIRED 목록 + 이력.

### 3.4 DUR 사전체크 (G4)

- 작성 시점: MEDICATION 사전오더 생성 시 기존 `dur.service.checkInteractions` 호출 → `durSnapshot` 저장 + 경고 표시(차단 아님 — 발효 시점이 아니므로).
- **승인 시점 재검증(필수)**: approve()에서 DUR 재실행 — 작성 후 환자 상태 변화(신규 처방·임신·알레르기) 반영. 여기서의 차단/override는 기존 처방 게이트와 동일 규칙.
- 스냅샷 대비 신규 경고 발생 시 승인 모달에 "작성 이후 변경된 경고" 강조.

### 3.5 검사실 선행 준비 큐 (G6)

- 워크스테이션 검사 큐에 "예정" 섹션: `PreOrder(type=LAB, APPROVED 전, scheduledDate=오늘±1, activationMode=ON_CHECKIN)` 조회 — 시약·검체 용기 사전 준비용 read-only.
- 접수 자동 전환 후에는 일반 큐로 자연 이동.

### 3.6 반복 사전처방 (G7 — P3)

- `recurringGroupId` + 생성 시 반복 규칙(매 N주 × M회) → 회차별 PreOrder 일괄 생성(Appointment 반복 패턴 이식). 수정/취소 시 "이 건만/이후 전체" 선택.

### 3.7 권한·감사 (G8)

- 작성: DOCTOR (처방권자 — prescriber-designation 규칙 준수). 승인: DOCTOR 본인 또는 담당의료군(위임 규칙 기존 config 재사용).
- `PreOrderRevision`: modify 시 이전 값 스냅샷(수정자·시각·사유).
- AuditInterceptor AUDIT_PATTERNS에 `/api/v1/pre-orders` 등록 (현재 미커버 — 오더추적 감사 보강과 함께).
- 승인·자동전환 시 `journey.emit('PRE_ORDER_ACTIVATED')`.

## 4. 단계

| 단계 | 내용 | 산출 |
|------|------|------|
| P0 | 작성 진입점(CPOE 토글+환자차트 탭) + DUR 사전체크(스냅샷+승인 재검증) + 만료 크론 + 감사 등록 | 사전처방 실사용 가능 |
| P1 | 7유형 확장 + 예약 연계(appointmentId) + 예약 화면 진입점 + 수정 이력 | 재진 워크플로 |
| P2 | ON_CHECKIN 자동 활성화(비약물 한정·config OFF) + 검사실 예정 큐 + 접수 이벤트 리스너 | 검사 선행 |
| P3 | 반복 사전처방 + 퇴원 진입점 + 통계(사전처방 이행률) | 운영 완성 |

## 5. 리스크·가드

- **약물 자동 발효 금지**: ON_CHECKIN은 LAB/IMAGING 한정 — 약물 사전처방은 어떤 경로로도 의사 승인 없이 Prescription이 되지 않는다.
- **만료 기본값**: expiresAt 미지정 시 생성+90일 자동 설정(무기한 잔존 방지). EXPIRED 크론은 원외처방 만료 크론(pharmacy.service:904) 패턴 이식.
- **이중 청구 방지**: 승인 전환은 기존 approve 트랜잭션 유지 — Prescription 생성이 유일한 청구 진입점(PreOrder 자체는 무과금).
- **치료일정 기획과의 접점**: 일정 전개(treatment-schedule P2)가 LAB/IMAGING 항목을 PreOrder로 생성 — 본 기획의 ON_CHECKIN·예정 큐가 그 실행 인프라가 된다(선행 관계: 본 기획 P1~P2 → 일정 전개 P2).
