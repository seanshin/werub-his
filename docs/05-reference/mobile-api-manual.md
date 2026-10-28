# 환자 모바일 앱 — API 사용 매뉴얼

정본 계약: **`docs/05-reference/openapi-mobile.json`** (159 operation · 5 태그).
🔴 **핵심 EP 13종은 응답 스키마(반환 필드)까지 계약에 담겨 있다**(login·refresh·lab-results·notices·
billings·medications·vaccinations·encounters·allergies + app-key 4). 나머지 저빈도 EP 의 반환 필드는
아래 §2 표(산문)로 확인한다 — 앱은 그 필드에 맞춰 화면을 붙인다.
갱신: `npm run gen:mobile-openapi` (apps/api 를 먼저 `nest build`). 이 매뉴얼은 그 계약을 **사람이 읽는 안내**다.

🔴 **운영 Swagger 는 비공개다**(`main.ts` 옵트인 원칙 — 운영 공개가 답이 아니다). 앱팀은 위 JSON 스냅샷을 정본으로 쓴다.

---

## 0. 공통 규약

- **베이스**: `https://his.example.org` · 내부 API 프리픽스 `/api/v1/`
- **응답**: 성공 `{ data, meta }` · 실패 `{ error: { code, message, details }, meta }`
- **인증 2종**:
  - `Authorization: Bearer <access>` — 환자 로그인 후 발급(대부분의 EP)
  - `X-Portal-Token: <token>` — 일부 포털 EP 의 대체 헤더(계약의 `PortalToken` 스킴)
- 🔴 **날짜 쿼리**: `date`/`from`/`to` 는 `YYYY-MM-DD`, `month` 는 `YYYY-MM`, `year` 는 `YYYY`.
  **못 읽는 값은 400** 이다(빈 값은 "안 준 것"으로 통과). 서버 오류(500)로 오지 않으니 앱은 입력을 검증해 보내라.
- **시각**: 서버는 KST 기준. `date-only` 는 로컬 자정으로 해석된다.

---

## 1. 인증 흐름 (`Patient Auth`)

```
가입:   POST signup/availability  → POST sms/send → POST sms/verify → POST signup
로그인: POST login (전화+비밀번호) 또는 POST login/pin
갱신:   POST token/refresh (회전 refresh — 재사용 탐지)
로그아웃: POST logout
```

- 🔴 **`token/refresh` 의 `expiresIn` 은 서명 토큰 `exp` 에서 산출된 실제 만료다**(과거 32배 오차 봉합분).
  앱은 그 값을 신뢰해 갱신 타이밍을 잡아라 — 하드코딩하지 마라.
- 로그인 body 는 `deviceId`·`platform` 을 요구한다(기기 등록·세션 관리에 쓰임).
- 🔴 **시드 EP(`seed-*`)는 관리자 전용이다** — 앱에서 부르지 마라(무인증 공개였던 것을 2026-08-31 봉합).

### 기기·보호자·알림
- 기기: `GET devices` · `DELETE devices/:id` · `PUT devices/fcm-token`
- 보호자: `POST guardians/request` · `GET guardians` · `DELETE guardians/:id`
  - 🔴 응답은 `{ asGuardian, asDependent }` 두 배열. 각 항목 필드는 `relationship`·`isApproved`·`rejectedReason`·`counterpart`.
- 알림: `GET notifications`(items 페이지네이션) · `unread-count` · `PUT :id/read` · `read-all` · `settings`

---

## 2. 환자 데이터 (`Patient Portal`)

### 건강
| EP | 반환 핵심 필드 |
|----|---------------|
| `GET allergies` | allergen·reaction·severity·onsetDate |
| `GET medications` · `medication-schedule` | name·dosage·frequency·route·slots·checks |
| `GET lab-results` | id·**orderName**·**orderedAt**·items[{name,value,unit,flag}] |
| `GET lab-trends` | 항목별 시계열 |
| `GET vaccinations` | vaccineName·administeredAt·doseNumber·nextDueAt |
| `GET health-score` · `health-dashboard` | 종합 지표(dict) |
| `GET health-memos` | 자가 메모 |

🔴 **`lab-results` 의 날짜 필드는 `orderedAt` 이다**(서버가 완료시각을 그 이름으로 정규화). `completedAt` 이 아니다 —
과거 앱이 `completedAt` 을 읽어 **완료 검사가 전부 "검사 중"으로** 보였다(2026-08-31 봉합). 이 EP 는 COMPLETED 만 준다.

🔴 **위급값 마스킹**: 담당의 미확인(PENDING) 위급값은 `value: "담당의 확인 중"`·`pendingReview: true` 로 온다.
앱은 그 상태를 그대로 표시하라(수치를 지어내 채우지 마라).

### 진료·검진·수납·여정
- 진료: `GET encounters`(assessment·plan·diagnoses·doctor) · `appointments` · `consents` · `questionnaire/active`
- 검진: `GET checkup-visits` · `checkup-visits/:id` · `checkup-visits/:id/summary`
  - 🔴 **의사 서명(signedAt)이 있는 검진만** 노출된다(미검토 원시값 비노출).
- 수납: `GET billings`(totalAmount·patientCopay·paidAmount·status) · `billings/unpaid` · `billing/annual-summary` · `medical-expenses`
  - 🔴 **연간 합산 영수증·연말정산 증빙은 서버에 없다**(25회차 확인). 건별 영수증(`billings/:id/receipt`)은 동작한다.
- 여정: `GET journey/status` · `journey/timeline` · `journey/inpatient`
- 영상: `GET imaging/studies` · `imaging/reports`
  - 🔴 **PACS 미설정 시 503**(`PACS_UNAVAILABLE`) — "영상 없음"이 아니라 "조회 실패"다. 앱은 그 사실을 그대로 말하라.

### 비대면 진료
```
목록:   GET telehealth
예약:   GET telehealth-departments → telehealth-doctors → telehealth-slots(date 필수) → POST 예약
입장:   PATCH telehealth/:id/join
```

---

## 3. 공지 (`Patient Portal`)

`GET notices` — 항목 필드는 `id`·`title`·`content`·**`date`**.
🔴 **날짜는 `date` 다**(`createdAt` 아님) — 과거 앱이 `createdAt` 을 읽어 **모든 공지의 날짜가 빈칸**이었다(2026-08-31 봉합).

---

## 4. 앱 인프라 (`mobile-device-push` · `mobile-app-integrity`)

| EP | 용도 | 🔴 주의 |
|----|------|--------|
| `GET mobile/config` | 최소버전·기능 플래그 | **미설정을 "제한 없음"으로 지어내지 않는다** — 값이 없으면 없다고 온다 |
| `GET .well-known/apple-app-site-association` | 유니버설 링크 | 🔴 **Team ID 미설정이면 404**(자리표시자 아님) — 설정 후 200 |
| `POST device/push-token` · `PUT devices/fcm-token` | FCM 토큰 | 계약의 토큰 필드명 준수 |
| `mobile/external-credentials` | 외부 자격증명 준비율 | `FAIL_CLOSED`(막힘) vs `FEATURE_OFF`(꺼짐) 구분 — 합치지 마라 |
| `mobile/app-key/*` | App Attest | 🔴 서버는 구현됨 — 앱 배선은 P2(Team ID 선행) |

---

## 5. 🔴 앱 개발자가 반드시 지킬 것

1. **서버 응답에 없는 필드를 읽지 마라** — 이 저장소에서 공지 날짜·검사 날짜가 그렇게 빈칸/오표시됐다.
   화면을 붙이기 전 계약 JSON 의 `properties` 를 확인하라.
2. **500 을 기대하지 마라** — 잘못된 입력은 400 으로 온다. 500 을 받으면 그건 서버 결함이니 리포트하라.
3. **미설정을 성공으로 지어내지 마라** — config·AASA·자격증명은 "없음"을 그대로 말한다.
4. **하위호환** — 서버 계약이 바뀌어도 구 앱이 안 깨지게 필드를 **추가**하지 제거하지 않는다.
   계약 버전은 JSON `info.version` 으로 확인.
5. **PHI** — 응답의 환자 데이터는 로컬에 평문 캐시하지 마라. 오프라인 열람은 현재 Out of Scope(FR-08).

---

## 6. 확장 로드맵 (기획서 §3~5)

정본: `docs/01-plan/integrations/ios-patient-app-api-review.plan.md`
- P1(서버 있음·앱 배선): 만성질환 추이 · 검진 예약/비교 · 응급실 혼잡도 · 건별 영수증 · 접근 로그
- P2(선행 조건): 네이티브 세션 전환 · App Attest 배선 · NICE 본인확인
- P3(신규·결정): 오프라인 열람 · 연간 서류

관련: `ios-native-app-server-response.md`(직원 앱) · CLAUDE.md §판정규칙
