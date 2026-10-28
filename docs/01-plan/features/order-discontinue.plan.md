# 오더 중단(DISCONTINUED) — 취소(무효)와 중단(그 시각 이후 멈춤)을 가른다 (2026-09-30)

> 요청: "오더 중단 설계 진행해" → "구현까지 진행하고 배포 후 푸시해". 출발점: 의사 업무 점검(2026-09-30)의 남은 항목 ①.

## 1. 실측 — 멈추는 방법이 '취소' 하나뿐이었다
- `PrescriptionStatus` 는 `ACTIVE`·`CANCELLED` 두 값뿐이었다. 투약 중인 입원 약을 멈추는 것도 `DELETE /prescriptions/:id`(취소)라, 처방 원장이 **"처음부터 무효"** 로 남았다(일어난 사실의 소급 — 판정 규칙 §7).
- 취소는 접수 전 오더·예정 투약(SCHEDULED)을 **전부** 지웠다 — 시각이 지났는데 아직 기록되지 않은 투약까지 사라져 "줬는지·빠뜨렸는지"를 적을 자리가 없어졌다.
- 중단 사유·시각·행위자를 남길 칸이 없었다. 입원 화면에는 멈출 수단 자체가 없었다(진료 작성 화면의 행 삭제가 유일한 호출처).
- 오더 취소 연쇄(`order.service` changeStatus → CANCELLED)가 처방이 `CANCELLED` 가 아니면 무조건 처방까지 취소했다 — 다른 오더가 이미 시행된 처방도.

## 2. 설계
### 어휘(정본 shared `PRESCRIPTION_STATUS_LABEL` · prisma enum)
| 상태 | 뜻 | 이미 일어난 일 |
|---|---|---|
| `ACTIVE` | 유효 | — |
| `CANCELLED` | 무효 — **발효 전** 취소·오입력 | 없어야 한다(있으면 취소 불가) |
| `DISCONTINUED` | 중단 — 그 시각 이후 멈춤 | 유효(조제·투약·청구 기록 보존) |

**발효** = 투약 기록(ADMINISTERED·HELD·REFUSED·MISSED — 간호사가 판단을 남긴 것) 또는 접수 이후 오더(RECEIVED·IN_PROGRESS·COMPLETED). 예정 투약·접수 전 오더는 아직 일어나지 않은 일이다.

### 동작
- **취소**(`DELETE /api/v1/prescriptions/:id`): 발효됐으면 **409 `PRESCRIPTION_TOOK_EFFECT`**(details: 투약 기록 수·시작된 오더 수·`use: 'DISCONTINUE'`) · 중단된 처방은 409 `PRESCRIPTION_DISCONTINUED`. 발효 전이면 종전대로.
- **중단**(`POST /api/v1/prescriptions/:id/discontinue` · DOCTOR·ADMIN · 권한은 취소와 같은 규칙 — 책임 처방의·담당 의료군·ADMIN):
  - 사유 필수(비면 400 `DISCONTINUE_REASON_REQUIRED` · 어휘를 지어내 고르게 하지 않는다 — 자유 기술)
  - 상태 `DISCONTINUED` + `discontinuedAt/By/Reason` — 조건부 갱신(`where status=ACTIVE`)으로 동시 요청이 먼저 난 것을 덮지 않는다 · 이미 중단이면 그대로 돌려준다
  - 접수 전(ORDERED) 오더만 취소(`order.cancelled` 이벤트·서명 로그) · 시작된 오더는 남는다(약국·검사실이 '처방 중단' 표식을 본다)
  - 예정 투약 중 **중단 시각 이후만** 삭제 — 지난 예정분은 간호사가 보류(미투여)로 기록한다. 투여(ADMINISTERED)는 여전히 막는다(`PRESCRIPTION_DISCONTINUED`)
- 오더 취소 연쇄: **활성·미발효** 처방만 따라 취소한다.
- 투여기간 정본 `dosingWindow`: `discontinuedAt` 이 지났으면 기간이 남았어도 `ENDED`(종료 시각 = 중단 시각) — 기간 미상이어도 중단 시각은 안다.
- FHIR `MedicationRequest.status` 정본 `common/fhir-medication-status.ts`: ACTIVE→active · CANCELLED→cancelled · DISCONTINUED→**stopped** · 모름→unknown. 종전 HIE·전원 반출은 **모든 처방을 active** 로 내보냈다(취소된 약까지).

### 소비처 분류(28개 모듈 전수 — 에이전트 분류 뒤 반영)
- **현재가 아님으로**(중단 제외): 투약 이력 '투여 중'·상호작용 점검 · 오더 추적 '진행 중' · 시계열 레인 진행 중 · 간호 복약 설명 · 환자 포털 복약 설명 · 진료 화면 상호작용·WeRU.B DUR 대상 · MAR 예정 생성(비활성 처방은 409). 🔴 이 자리들은 `!== 'CANCELLED'` 로 걸러 **중단된 약을 '현재 복용 중'으로** 볼 뻔했다.
- **이력으로 유효**(중단 포함): 워크리스트(약국·검사·영상)의 **이미 시작된** 오더 — 큐에서 사라지면 아무도 마무리하지 않는다 · 진료 화면 재진입(읽기 전용 행) · 차트 검색 표식.
- **표식**: 약국 워크스테이션 '처방중단' 배지·안내 · 투약 이력 '중단' 배지+사유 · 상태 배지 톤 · 입원 화면 활성 처방 묶음.
- 변경 없음: `status: 'ACTIVE'` 로 '현재'를 뜻하는 곳(DUR 현재약·활성 처방 조회·포털 복약 알림 등) — 중단은 자연히 빠진다.

### 불변식(감시자 데이터 정합성)
- 73 중단 처방인데 접수 전 오더 잔존 · 74 중단 처방인데 중단 시각 이후 예정 투약 잔존(이전 예정분은 정상).

## 3. 화면
- **진료 작성**: 행 삭제가 409 `PRESCRIPTION_TOOK_EFFECT` 면 중단 창을 연다 · 중단된 행은 '중단' 배지·삭제 버튼 없음 · 재진입 때도 보인다.
- **환자 차트 투약 이력**: 활성 처방에 '중단'(의사) · 중단은 '기간 종료·중단' 탭에 배지·사유로.
- **입원 상세 활성 처방/투약**: 🔴 종전엔 **용량 문자열로 묶어** 다른 약이 한 줄로 합쳐지고 약 이름도 없었다 → 처방 단위로 묶고 약 이름·'중단' 배지·중단 버튼.
- 공용 부품 `components/prescription/DiscontinueDialog.tsx`(사유 필수 · 무엇이 남고 무엇이 멈추는지 세 줄).

## 4. 사람 결정(등록부 배치 L · `decision.registry.batch-2026-09-l.ts`)
- `order.discontinue.billingQuantity` — 중단 처방 청구 수량(현행 유지 / 실제 조제·투약분 / 처방량 전부) · **개시 전 필수**. 현행: 서명 때 청구된 라인은 그대로, 중단 뒤 재청구는 ACTIVE 만 담아 중단 처방 제외 · 미청구 채권 집계는 처방량 전부로 센다.
- `order.discontinue.onDeath` — 사망 처리 때 활성 처방 자동 중단 여부(현행: 오더만 취소). 자동으로 끊는 방향은 사람 판단.

## 5. 남은 것(이 설계 범위 밖)
- 예약 중단(미래 시각 stopAt)·지속 처방 갱신/만료 — 이 설계의 중단 칸(`discontinuedAt`)을 미래 시각으로 여는 확장으로 잇는다.
- 퇴원약 오더화 · 대체조제 결정자 칸.
- 마이그레이션 `20260930000002_prescription_discontinue`(열거형 값 1·열 3 — 추가만).
