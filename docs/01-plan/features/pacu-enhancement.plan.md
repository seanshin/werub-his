# PACU(회복실) 보강 기획

> 2026-07-04 / Plan v1.0 / 대상: `apps/api/src/modules/pacu`·`apps/web/.../pacu`·`PacuRecord`
> 계기: 현황 검토 결과 핵심 워크플로는 견고하나 대학병원급 표준 항목 일부 미비 + 전용 기획 문서 부재.

## 1. 현황 (코드 grounded)
- 모델 `PacuRecord`: 수정 Aldrete 6항목(0~12)·통증·산소요법·활력(JSON)·중재·disposition·**퇴실 override**.
- 흐름: 수술 완료 → 입실 대기 자동 감지 → 입실 → 활력 기록(이상 플래그 저산소/저혈압/저체온) → Aldrete 채점 → 퇴실.
- **환자안전 게이트**: Aldrete<9 퇴실 차단·강제 퇴실은 마취과 사유 필수·기록. (핵심 강점)
- 9 EP·485줄 FE·인가 DOCTOR/NURSE/ADMIN.

## 2. 갭
| 우선 | 갭 | 근거 |
|:---:|----|------|
| **P1** | **PONV**(수술후 오심·구토) 평가 부재 | PACU 표준 항목 |
| **P1** | **PADSS**(귀가 척도) 부재 | HOME 퇴실인데 Aldrete만 — 당일수술 귀가엔 PADSS 필요 |
| **P1** | **구조화 핸드오프**(SBAR) 부재 | 수술실→PACU, PACU→병동/ICU 인수인계 미구조화 |
| P2 | 이상 플래그 → 알림/EWS 팬아웃 | flag가 조회 응답에만 |
| P2 | 여정 이벤트 발행 | 입실/퇴실 journey 미발행 |
| P2 | 퇴실 전자서명 | dischargedById만·e-sign 미연계 |
| P3 | 구조화 합병증·통증 재평가 추이 | interventions JSON뿐 |

## 3. P1 설계 (본 기획 구현 범위)

### 3-A PONV 평가
- 모델 += `ponvScore Int?`(0 없음·1 오심·2 구역질·3 구토)·`ponvManagement String?`(중재 약물/조치).
- EP `PATCH :id/ponv { score 0~3, management? }`. FE 빠른 채점 + 중재 입력.

### 3-B PADSS 귀가 척도 + HOME 퇴실 게이트
- 모델 += `padssScore Int?`(0~10)·`padssDetail Json?`(5항목 각 0~2: 활력징후·보행·오심구토·통증·수술부위출혈).
- EP `PATCH :id/padss { score 0~10, detail? }`.
- **퇴실 게이트 이원화**(임상 표준):
  - `disposition WARD/ICU` → **수정 Aldrete ≥ 9**(phase 1 회복) — 현행 유지.
  - `disposition HOME` → **PADSS ≥ 9**(phase 2 귀가 준비) — 신규. 미달 시 사유(override) 필수.
- 강제 퇴실 사유는 척도별로 `dischargeOverride`에 기록.

### 3-C 구조화 핸드오프(SBAR)
- 모델 += `arrivalHandoff Json?`(수술실→PACU)·`dischargeHandoff Json?`(PACU→병동/ICU/귀가).
- 구조: `{ situation, background, assessment, recommendation, lines?, drains?, allergies?, notes? }`(SBAR + 라인/배액/알레르기).
- 입실(admit)·퇴실(discharge) 시 선택 캡처. FE 접이식 SBAR 폼.

## 4. P2 (구현 완료 — 2026-07-04)
- ✅ **이상 활력 → 알림 팬아웃**: recordVitals 이상 플래그 시 담당 간호사(`nurseId`)에게 `PACU_VITAL_ALERT` 알림(NotificationService·SSE·fire-and-forget).
- ✅ **여정 이벤트**: 입실 `PACU_ADMISSION`·퇴실 `PACU_DISCHARGE`(강제 퇴실 시 WARNING) JourneyService.emit → PatientLocation 자동 갱신.
- ⏸ **퇴실 전자서명**: 책임 임상의는 이미 `dischargedById`로 귀속. 완전한 e-sign은 **외부 sign 프로바이더(config-gated·별도 프로젝트)** 필요 → sign 트랙 결정에 이연(반쪽 구현 지양).
- ⏸ **EWS 레코드 생성**: 현재 알림 팬아웃까지. 정식 NEWS 스코어 산출·EarlyWarningScore 적재는 파라미터 완비 후 후속.

## 5. 비범위(후속)
P3(구조화 합병증·통증추이)·퇴실 e-sign(sign 트랙)·EWS 정식 적재. 별도 증분.

## 5. 배포
신규 컬럼 6종(전부 nullable·가산적) → manual SQL ALTER → prisma generate → --api → --web. 데이터 손실 0.

## 6. 안전·정합
- 게이트 이원화는 **완화가 아니라 강화**(HOME에 PADSS 추가). 기존 WARD/ICU Aldrete 게이트 불변.
- 신규 필드 전부 optional → 기존 기록·흐름 무영향.
