# 간호 워크스테이션 — 기록 작성·시계열·상/하번 인계

- 2026-08-03 기획·P0 실행 / 2026-08-03 검토 보완(v2)
- 발단: /nurse-station 실사용 검토(스크린샷 제보) — ①새 기록 빠른 작성 부재 ②시계열 열람 불가
  ③상/하번(교대) 인계 처리 흐름 부재

## 1. 현행 실측 — 배선 문제가 본질

| 축 | BE | FE(워크스테이션·P0 이전) |
|---|---|---|
| 기록 작성 | 정본 `POST /admissions/:id/nursing-notes` — 유형 6종 enum·shiftType·우선순위·**작성=서명**(draft 옵션)·QA(`qa-check`)·AI 초안(`ai-draft`)·sign·AMENDED | 🔴 **정본 우회** — 외래용 Universal EP 에 `contextType:'INPATIENT'` + SBAR 를 **JSON 문자열**로 저장 |
| 시계열 | `GET /admissions/:id/nursing-notes?shiftType&date` 필터 지원 | 전체 노트 평면 목록(환자·교대 구분 없음) |
| 인계 | `ClinicalHandoff`(I-PASS 필드·acknowledgedAt) + EP 5종(`/api/v1/handoffs*` — **inpatient 프리픽스 아님**) + AI SBAR 초안(`ai-handoff-sbar`·결정적·근거기반 F-3) | 배선 0 — 별도 /handoffs 화면·대시보드 배너만 존재, 워크스테이션 흐름 없음 |

정본 우회의 실해: ①간호 스테이션 보드 최근기록/미서명에 안 잡힘 ②서명·QA·AI 흐름 전부 우회
③구조화 필드가 있는데 문자열이 됨. (운영 Universal 실데이터 2건뿐 — 오염 규모는 작았다)

## 2. 결정 (근거 포함)

| # | 결정 | 근거 |
|---|---|---|
| D1 | 작성은 **정본 EP·작성=서명** 고정(워크스테이션에서 draft 미노출) | 간호기록 무결성 규약(작성=서명·append-only). 정정은 입원 기록 화면의 AMENDED 흐름으로 — 워크스테이션은 빠른 작성이 목적 |
| D2 | 기록 유형은 **SOAP·DAR·서술 3종**(타블렛과 동일 필드맵). enum 의 SBAR·DARE 는 미노출 | `NursingNote` 모델에 SBAR 전용 필드(situation/background/recommendation)가 **없다** — SBAR 는 기록이 아니라 **인계(ClinicalHandoff)** 로 정리. DARE 는 타블렛도 미노출(일관) |
| D3 | 교대(shiftType)는 현재 시각 자동 판정(07/15/23 경계) + 수동 변경 | 야간 기록의 대부분이 교대 직후 몰림 — 자동이 기본, 경계 근무는 수동 |
| D4 | 인계는 **기존 ClinicalHandoff 재사용**·`type='NURSING_SHIFT'` — 모델·EP 신설 0 | I-PASS 구조·acknowledge·pending 이 이미 있다. `fromDoctorId/toDoctorId` 명칭은 의사 중심이지만 User FK 라 간호사 사용 무해(개명 비용>효익) |
| D5 | 인계 단위는 **환자별 1건**(병동 일괄 아님) | acknowledge 가 건 단위라 확인 책임이 명확. 담당환자 일괄 작성은 P1(초안 반복 생성으로 해소 가능) |
| D6 | AI SBAR 초안은 **참고용·실패 비차단** — 확정 책임은 작성 간호사(화면 명시) | F-3 게이트 규약(읽기 보조). AI 는 저자가 아니다 |
| D7 | 인수자 지정 **필수**(수신자 미정 병동 공유 인계 미지원) | acknowledge 모델이 to 단건 전제. 미정 인계는 "아무도 확인 안 함" 이 기본값이 된다 — 지정 강제가 안전 |

## 3. P0 실행결과 (2026-08-03 · 127faa58→dc2be784 배포)

- ① 기록 탭 재구현: 정본 저장(작성=서명)·유형 3종·교대 자동·긴급 플래그·자주 쓰는 문구 칩·Alt+A
- ② 시계열: 환자 선택 → 날짜 구분선+시각 축+교대 필터(활력 탭과 동일 패턴)·유형/긴급/미서명 배지·StaffName
- ③ 인계 탭: 하번(환자 선택→AI SBAR 초안→확정→미결 항목→인수 간호사 지정→등록) /
  상번(미확인 인계 목록 30초 폴링→인수 확인)
- 동반 발견·봉합 결함 3건:
  - 인계 EP 경로 — `inpatient` 프리픽스로 추정해 404("종단 404는 프로브부터")
  - pending 응답 이중 `{data}` 래핑(서비스+컨트롤러 — 접수 이중래핑 패턴 재발) → FE 방어 언랩
  - 🔴 `users?role=` 필터가 **조용히 무시**돼 전 직원 102명 반환(수혈 2인확인도 같은 전제로 호출)
    → BE 필터 지원·라이브 검증(NURSE 35명)
- 검증: web 210/210 · api 6,624/6,624 · 정본 기록 7건/AI SBAR 실생성/pending 라이브 확인

## 4. 검토 보완(v2)에서 확인한 잔여 갭 — P1 백로그

우선순위순. 전부 CLI 착수 가능.

1. ~~**인계 등록 알림 부재**~~ ✅ **P1-1 실행(2026-08-03) — 인수인계 서비스화 결정 반영**:
   - 통지는 **인앱 알림 서비스**(이메일 아님 — 사용자 결정). `notify(toDoctorId, CLINICAL_HANDOFF,
     refId=handoff.id)` + SSE·실패 비차단·(main) 딥링크 `/handoffs`
   - **스탭포털에서 처리**: `/staff/handoffs` 신설(받은 인계 확인·인수 처리·폰 최적화) + 홈 타일.
     작성(하번)은 워크스테이션 — 폰은 확인에 집중
   - **W.Channel 연동 훅**: `handoff.created` 이벤트 발행(handoffId·from/to·type). 어댑터가
     구독해 채널로 릴레이하는 구조 — 어댑터 구현은 W.Channel 연동 확정 후(외부 대기)
2. ~~**미확인 인계 감시 부재**~~ ✅ **P1-2 실행(2026-08-03)**: ①재알림 크론(매시·
   `nursing.handoff.remindAfterHours` 0=OFF·같은 건 N시간 간격 억제·유형 무관 — 의사 인계도
   묻히면 안 된다·DEFAULTS 등재) ②간호 스테이션 보드 요약에 '미확인 인계' 카드(수간호사 관제).
3. ~~**교대 경계 하드코딩 3곳**~~ ✅ **P1-3 실행(2026-08-03)**: shared `shiftOf()` 정본 +
   config `nursing.shift.boundaries`({day,evening,night}·순서 역전/형식 오류는 기본 7/15/23 폴백 —
   판정이 죽으면 기록 저장이 막힌다)·3곳 전부 수렴(타블렛 기록·워크스테이션 기록/활력·간호 대시보드).
4. ~~**다음 근무 간호사 자동 제안**~~ ✅ **P1-4 실행(2026-08-04·2adf04d9)**: GET
   `/handoffs/next-shift-nurses`(DutyEntry·다음 교대=shared shiftOf·NIGHT→익일 DAY·fail-open)
   → 인수자 select '★ 다음 교대 근무' optgroup(운영 실측: 초번 2명 상위 노출).
5. ~~AI 기록 초안 패널 이관~~ ✅ **P1-5 실행(2026-08-04)**: 공용 NursingAiDraftPanel 을
   WardNoteModal 에 배선 + qa-check(조언·비차단 — 비활성 시 안내만·활성화는 운영 판단).
6. ~~자주 쓰는 문구 사용자 정의~~ ✅ **P1-6 실행(2026-08-04)**: 편집 모드(삭제/추가)·
   localStorage 저장(브라우저 단위 — 계정 단위 서버 프로필은 필요 실증 시 승격)·기본 6문구 폴백.
7. 구 Universal SBAR JSON 2건 — 이관하지 않음(실데이터 2건·방치 무해 판정). 기록만 남긴다.

## 5. 비범위

- 병동 전체 일괄 인계서(수신자 미정 게시형) — D5·D7 로 배제. 필요가 실증되면 별도 기획
- 의사 인계(기존 /handoffs 화면·I-PASS 전체 필드) 개편 — 이번 축은 간호 상/하번에 한정

## 6. 검증 — 2026-08-03 API 경유 종단 실측(시드=실흐름)

- [x] **2계정 종단**(조간호→최정형외과간호): 인계 등록 → B 알림 1건 수신(CLINICAL_HANDOFF) →
      B pending 1건(미결 항목 포함) → **A 대리 확인 400 거부**(소유 검증) → B 인수 확인 →
      pending 0건. 동반 봉합=acknowledge 소유 검증 부재·pending/ack ADMIN 제외(ecda6d0d)
- [x] 기록 정본 저장 3건(교대별·SIGNED) → 시계열 교대 필터 동작 → **보드 최근기록이
      6/29→오늘로 갱신**(정본 수렴 효과 실증)
- [x] AI SBAR 초안 실생성 · 보드 handoffPending=1 반영
- [ ] 화면 체감 확인(사람): 관리자 앞 **시드 인계 1건(ca22a2fd·미확인) 대기 중** —
      /staff/handoffs 또는 워크스테이션 인계 탭에서 '인수 확인'을 눌러 체험. 확인 처리해도 무해
- [ ] 교대 경계(15:00 전후) 자동 판정 체감 확인(사람)
