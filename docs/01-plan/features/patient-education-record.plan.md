# 환자 교육 기록 (2026-09-30)

> 요청: "환자 교육 기록 진행해". 출발점: 의사 업무 점검(2026-09-30) 남은 항목 ⑥.

## 1. 실측 — 교육은 흩어진 자유 글뿐이었다
- 퇴원요약 `patient_education`(글) · 간호기록 DARE 의 E(글) · 약국 복약상담 `dispensing_counsels` · 영양상담 `nutrition_counsels`.
- "누가 · 누구에게(환자/보호자) · 무엇을 · 어떻게 · 이해했는가"를 한 곳에서 볼 수 없었다.
- 퇴원 준비 체크리스트의 "환자 교육 기록"은 퇴원요약 글자가 **비어 있지 않은지만** 셌다.

## 2. 설계
- 원장 `patient_education_records`(추가만 · 마이그레이션 `20260930000005_patient_education_record`) — 어휘 정본 shared `patient-education.ts`
  - 주제(12 · 기타 포함)·대상(환자/보호자/둘 다)·내용 **필수** · 방법·교육 장애·재교육 필요 선택
  - 이해도는 **평가한 경우에만**(null = "이해도 미기록" — 이해함으로 두지 않는다)
  - 교육 시각 필수(서버가 '지금'으로 채우지 않는다 · 미래 400) · 재원 중이면 그 입원에 붙인다(서버가 사실에서 파생)
  - 지우지 않는다 — 기록한 사람·관리자가 **사유와 함께 무효 처리**(조건부 갱신)
- API(경로를 `patients/:id/…` 에 두어 감사가 환자에 귀속):
  - `GET /api/v1/patients/:id/education` — 원장 + 다른 기록의 교육(복약상담·영양상담·간호기록 E·퇴원요약 · 출처별 최근 50) · 🔴 한 출처 실패는 `sourceErrors`(없음으로 접지 않는다)
  - `POST /api/v1/patients/:id/education` · `POST /api/v1/patients/:id/education/:recordId/void`
  - 쓰기 = 의사·간호사·약사·영양사·의료기사·관리자 / 읽기 = + 의무기록
- 퇴원 준비: `education{records, summaryText, source: RECORDS|SUMMARY_TEXT|null}` · `educationDone` = 기록 있음 또는 요약 글자 · `readyToDischarge` 는 바꾸지 않는다(사람 결정).

## 3. 화면
- 공용 `components/patient-education/PatientEducationPanel.tsx` — 환자 차트 새 탭 '환자 교육' · 퇴원 워크스테이션(간단 보기)
- 쓰기 폼 초기값 미선택(주제·대상·이해도) · 필수를 채워야 저장 · 무효 처리 버튼은 기록한 사람·관리자에게만 · 무효 기록은 접어서 사유와 함께
- 퇴원 준비 체크리스트: "환자 교육 기록 n건" / "퇴원요약 글자뿐(교육 기록 없음)" / "없음"

## 4. 사람 결정(등록부 배치 O · `decision.registry.batch-2026-09-o.ts`)
- `education.understandingRequired` — 이해도 평가 필수 여부(현행 선택)
- `discharge.educationForReady` — 교육 기록을 퇴원 가능 조건에(현행 보여 주기만)

## 5. 남은 것
- 퇴원요약 화면에 패널(그 화면은 환자 id 를 갖지 않는다 — 입원 id 만) · 교육 자료(인쇄물) 라이브러리 연결 · 교육 요구 사정(입원 초기평가와 연결)
