# 응급실 베드 보드 기획 — 표시·관리·베드사이드 디스플레이

- 작성: 2026-08-05
- 상태: **P0~P3 전량 완료(2026-08-05)** — 기획 종결. 후속은 운영 판단(재평가 알림 크론 ON·통합 원무 전환 등 config)
- 대상 화면: `/emergency`(응급실 워크플로), `/emergency-board`(관제), 신규 `/emergency/bed-display/[bedId]`
- 관련: `docs/01-plan/features/emergency-*.plan.md`, 간호 스테이션 보드, 병상 보드(`/bed-board`·입원)

---

## 1. 배경 — 무엇이 문제인가 (2026-08-05 실측)

응급실 화면은 **환자 목록형**이다. 환자가 응급실 어디에 누워 있는지 시스템이 모른다.

실측 근거:

| 항목 | 실측 |
|------|------|
| `/emergency` | 좌측 목록·우측 상세(687줄). KTAS 색·10초 폴링. **베드 개념 없음** |
| `/emergency-board` | 관제(NEDOCS·KTAS 분포·boarding·골든패스웨이·사전통보). **베드 없음** |
| `EmergencyVisit` 모델 | bed/zone/위치 필드 **없음** — 세분화 status 8종·onVentilator·mciEventId 는 있음 |
| `Ward '응급병동'` | 운영 DB 에 실존(floor 1)·베드 **ER-01~05 5개 전원 AVAILABLE** — 어떤 화면·방문과도 미연결 |
| `Bed`/`BedStatus` | 입원 정본 존재. AVAILABLE/OCCUPIED/RESERVED/MAINTENANCE/CLEANING/ISOLATION — ER 에 그대로 쓸 수 있는 어휘 |
| `BedAssignment` | admissionId FK — **입원 전용이라 ER 방문에 재사용 불가** |
| 재실 환자 | 4명(PENDING_TRIAGE·TRIAGED·UNDER_OBSERVATION·PENDING_DISPOSITION 각 1) — 전원 위치 미상 |

현장에서 생기는 문제:
- 간호사·의사가 "3번 베드 환자" 로 소통하는데 시스템은 이름 목록만 보여준다 — 구두 매핑에 의존.
- 소생실·격리실이 비었는지 화면으로 알 수 없다 — 중증 환자 도착 시 배치 판단이 느리다.
- 퇴실 후 청소 대기(CLEANING) 상태를 추적하지 않아 "비어 보이는데 쓸 수 없는 베드" 가 생긴다.
- 입원 결정 후 병상 대기(boarding) 환자가 어느 베드를 점유 중인지 몰라 회전율 관리가 안 된다.
- 베드사이드에 놓인 태블릿/모니터에 보여줄 화면이 없다 — 환자 확인(안전)·낙상/알레르기 주의 표시가 종이에 의존.

## 2. 목표 / 비목표

**목표**
1. 응급실 베드를 구역(zone) 단위 그리드로 **표시**하고, 배정·이동·해제·청소를 화면에서 **관리**한다.
2. 배정 이력을 정본 테이블로 남긴다(누가·언제·어느 베드 — 감사 추적).
3. 디스포지션(퇴원·입원·전원·사망)과 베드 수명주기를 **자동 연동**한다(해제→CLEANING→AVAILABLE).
4. 각 베드에 두는 **베드사이드 디스플레이**(태블릿/모니터) 전용 화면을 제공한다 — 환자 확인·안전 배지·개인정보 마스킹.
5. 관제 보드(`/emergency-board`)에 구역 점유 요약을 얹는다.

**비목표**
- 입원 병상 보드(`/bed-board`)·병동 배정 로직 변경 — ER 전용으로 한정. 입원 전환 시점의 병상 배정은 기존 `visits/:id/admit` 경로 유지.
- 실시간 WebSocket — 기존 규약대로 `usePollInterval` 폴링(fast). SSE/WS 는 이 축의 범위 밖.
- 하드웨어(호출벨·센서) 연동 — 로드맵 메모만 남긴다.

## 3. 설계 결정 (D1~D11)

### D1. 베드 정본 = 기존 `Bed` 재사용, 구역 = `roomNumber` 컨벤션
신설 ErBed 모델을 만들지 않는다. `Ward '응급병동'` + `Bed.roomNumber` 를 **구역 코드**로 쓴다
(`RESUS`(소생) · `ACUTE`(중증) · `GEN`(일반) · `ISO`(격리) · `OBS`(관찰)), `bedNumber` = 구역 내 번호.
- 근거: `BedStatus` 어휘(CLEANING·ISOLATION 포함)가 ER 요구와 정확히 일치하고, `/api/v1/beds` EP·상태 변경 감사가 이미 있다.
- 기존 ER-01~05 시드는 마이그레이션에서 구역 컨벤션으로 재명명한다(§12 P0).
- 🔴 **실결함 확인(2026-08-05 재실측)**: `getAvailableBeds` 는 wardId 미지정 시 **전 병동을 반환**하고, 호출부 2곳(`/workstation/emergency` 응급 입원 병상 선택·`/inpatient`)이 wardId 없이 호출한다 — **현재도 응급병동 ER-01~05 가 입원 병상 선택 목록에 노출 중**. 24병상으로 늘리면 오염이 5→24로 커진다. **P0 최선행: 입원용 가용 조회에서 응급병동 제외**(제외 방식은 ward 이름 하드코딩이 아니라 `Ward` 에 `type`(GENERAL|EMERGENCY) additive 컬럼 또는 config 지정 — 구현 시 확정).

### D2. 배정 이력 = 신설 `EmergencyBedAssignment` (BedAssignment 재사용 불가)
`BedAssignment.admissionId` 는 입원 FK 라 ER 방문에 못 쓴다. 최소 신설:

```prisma
model EmergencyBedAssignment {
  id         String    @id @default(uuid()) @db.Uuid
  visitId    String    @map("visit_id") @db.Uuid
  bedId      String    @map("bed_id") @db.Uuid
  assignedBy String    @map("assigned_by") @db.Uuid
  assignedAt DateTime  @default(now()) @map("assigned_at") @db.Timestamptz()
  releasedAt DateTime? @map("released_at") @db.Timestamptz()
  releaseReason String? @map("release_reason") @db.VarChar(30) // MOVE|DISPOSITION|MANUAL|AUTO_CLOSE
  @@index([visitId])
  @@index([bedId, releasedAt])
  @@map("emergency_bed_assignments")
}
```

+ `EmergencyVisit.bedId String? @db.Uuid`(additive nullable) = **현재 배정 캐시**(목록 조인 비용 절감). 정본은 assignment 테이블, bedId 는 파생 — 불일치 시 assignment 가 이긴다(데이터 정합성 스캔 불변식에 등재).

### D3. 동시 배정 방지 = DB 부분 유니크 인덱스 (check-then-act 금지)
같은 베드에 두 환자, 같은 환자에 두 베드가 동시에 생기지 않아야 한다. 애플리케이션 검사만으로는 동시 요청에 진다(멱등성 캠페인 교훈).

```sql
CREATE UNIQUE INDEX uq_er_bed_active ON emergency_bed_assignments (bed_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX uq_er_visit_active ON emergency_bed_assignments (visit_id) WHERE released_at IS NULL;
```

배정 tx: assignment insert + `Bed.status=OCCUPIED` + `visit.bedId` 갱신을 한 트랜잭션으로. 유니크 충돌(P2002)은 "이미 사용 중인 베드" 409 로 번역.

### D4. 베드 수명주기 자동화 — **결정(disposition)≠퇴실**, 해제 트리거는 경로별로 다르다
```
AVAILABLE ─배정→ OCCUPIED ─퇴실→ CLEANING ─청소완료(수동)→ AVAILABLE
     └─예약(사전통보 도착 임박)→ RESERVED ─배정→ OCCUPIED / 취소→ AVAILABLE
MAINTENANCE·ISOLATION 은 수동 전환(기존 beds PATCH 재사용)
```
디스포지션은 의사의 **결정**이고 환자는 그 뒤로도 베드에 남는다(입원대기·귀가 준비). 자동 해제 시점을 경로별로 정확히 잡는다(§4.6 워크플로와 정합):

| 경로 | 결정 후 상태 | 베드 자동 해제 시점 |
|---|---|---|
| 입원(ADMISSION) | 🛏입원대기(boarding) — ER 베드 점유 유지 | **병상 배정 완료**(`admit` 성공 = admissionId 생성) 시 |
| 퇴원(DISCHARGE) | 귀가 준비(안내·처방) | **퇴실 처리**(`discharge` EP) 시 |
| 전원(TRANSFER) | 이송 대기 | 퇴실 처리 시 |
| 사망(DEATH) | — | 디스포지션 확정 시(안치 이동) |
| stale auto-close | — | auto-close 시(releaseReason=AUTO_CLOSE) |

- 해제는 전부 releaseReason 기록 + 베드→CLEANING.
- 청소 완료는 사람 판단이라 수동 버튼(CLEANING→AVAILABLE). 청소 지연은 배지로만 압박(§8).
- 사전통보(`prenotifications`) 도착 처리 시 RESERVED 를 **제안**(자동 강제 아님 — 접수 판단 존중, P1).

### D5. 베드사이드 디스플레이 인증 = 스태프 세션 (기기 익명 접근 금지)
베드 화면은 환자명·알레르기 등 PHI 를 표시한다. `/uploads` 무인증 공개 사고(파일 접근 캠페인)와 같은 유형의 실수를 원천 차단:
- 라우트는 `(main)` 그룹 = 기존 JWT 세션 필수. 베드사이드 태블릿은 간호 타블렛 모드처럼 스태프 계정으로 로그인해 두는 운영.
- 익명 kiosk 토큰은 만들지 않는다. 필요해지면 별도 축으로 승격(터미널 등록 + 단말 바인딩 — terminal 모듈 존재).

### D6. 개인정보 마스킹 = config, 화면 등급 2단
- 베드사이드(환자 곁): 실명 표시 기본(본인 확인 목적) — `er.bedDisplay.nameMasking=false` 기본.
- 스테이션 벽면 등 공용 대형 화면으로 쓸 때를 위해 마스킹 토글 제공(`true` 면 "홍*동"). 쿼리파라미터가 아니라 **config 로만** 제어(URL 로 마스킹 해제 우회 금지).
- 대기실 공용 안내(순번 표시 등)는 이 축의 범위 밖 — 베드 화면을 대기실에 걸지 않는다는 운영 전제를 문서화.

### D7. 표시 정본 준수 (UX 규약 2026-07)
KTAS 색/라벨이 `/emergency` 와 `/emergency-board` 에 **로컬 Record 로 2벌 중복**되어 있는 것을 실측 확인. 이번 축에서 `@hospital-run/shared` 에 KTAS 정본(`KTAS_LEVEL_LABEL`·tone)을 신설하고 세 화면(기존 2 + 베드 보드)이 공유한다. 날짜/빈 상태는 `KDate`·`EmptyState`, 폴링은 `usePollInterval`.

### D8. 여정 이벤트 발행 (Journey Integration 규약)
배정/이동/해제 시 `er.bed.assigned`·`er.bed.moved`·`er.bed.released` 이벤트 발행(JourneyService @Optional 주입 — **EmergencyModule imports 확인 필수**, @Optional 조용한 no-op 함정 2연발 전례).

### D9. 거버넌스 연계
구역 구성·마스킹·청소 SLA 는 운영 정책이므로 SystemConfig 표면화 + SurfaceMap 등재(담당: 운영위원회 OPS 또는 안전관리위원회 SAFE). 레이아웃 변경·마스킹 정책 변경은 안건 상정 대상으로 배지(⚖) 노출.

### D10. 응급실 베드(임상) 영역 vs 응급실 원무 영역 — 분리 여부는 config, 원무는 **접수 전용**
응급실에는 임상 영역(베드·진료)과 **원무 영역**(응급 접수 창구)이 공존한다. 응급 원무의 기능 범위는 **접수뿐이다** — 예약·수납·기타 원무 기능은 응급 원무에 두지 않는다(예약은 응급 개념에 없고, 수납은 퇴실 후 일반 수납 흐름 소관 — §4.5). 응급 전용 접수 창구를 두는지(대형 병원), 일반 원무 데스크가 응급 접수를 겸하는지(소규모·야간)는 **조직 구성의 문제라 코드에 박지 않고 config 로 둔다**: `er.reception.separated` (boolean).

실측 보정(2026-08-05): 응급 방문은 대기열(waiting-queue)을 쓰지 않아 **`/reception` 에는 응급 건이 애초에 섞이지 않는다** — 즉 시스템은 이미 '분리' 상태가 사실상 기본이고, 이 config 가 실제로 바꾸는 것은 ①접수 트랙 패널의 표시 위치와 ②통합 모드에서 `/reception` 에 응급 도착 배너를 **추가**할지 여부다(분리 모드에 제외 필터 신규 작업은 없음).

- **true(분리 운영·기본)**: 응급 접수는 별도 창구 —
  - `/reception` 은 현행 그대로(응급 건 없음 — 위 실측).
  - 베드 보드에 **응급 접수 트랙 패널**: 접수 미완료·신원미상(신원 확인 대기)·**보호자 미등록** 칩 + 응급 등록(`/patients/register/emergency`) 바로가기. 접수 관련만 — 예약·수납 요소는 두지 않는다.
  - RECEPTIONIST 는 이 접수 트랙 패널만 열람(베드 임상 카드는 비노출 — 임상 화면 권한 원칙 §7 유지).
- **false(통합 운영)**: 일반 접수 데스크가 응급 접수를 겸한다 —
  - `/reception` 에 응급 도착 알림 배너(사전통보·미접수 응급 도착)가 표시되고, 응급 등록 흐름이 접수 데스크에서 진입 가능.
  - 베드 보드의 접수 트랙 패널은 숨김.
- 이 설정은 **화면 흐름·표시만 바꾼다** — 데이터 정본(접수 레코드)은 동일 경로. 전환 시 마이그레이션 불필요.
- 베드 자체는 항상 임상 영역 소유다 — 원무 영역에는 베드가 없고, 이 설정이 베드 배정 권한을 바꾸지 않는다(배정은 §5 Roles 그대로 ER 임상 스태프).

### D11. 응급 접수의 핵심 강화 = 보호자 등록 상세화 (모델 신설 없음 — `PatientContact` 정본 활용)
응급 환자는 의식저하·미성년·신원미상이 흔해 **보호자 정보가 접수의 본질**이다. 실측: `PatientContact` 정본이 이미 필요한 구조를 갖추고 있다 — relationship(PARENT/SPOUSE/CHILD/SIBLING/GUARDIAN/OTHER)·relationshipDetail·phone/phone2·isEmergencyContact·**isLegalGuardian**·isPrimaryContact·**priority**·notes. 모델 추가 없이 **응급 접수 UX 에서 이 정본을 제대로 채우게** 만든다.

응급 접수 보호자 스텝(신규):
- 항목: 관계(코드+상세 자유입력)·이름·연락처 1/2·**법정대리인 여부**·**현장 동행 여부**(동행/유선 연락만 — notes 규약 `동행:Y/N` 또는 additive 컬럼은 구현 시 판단)·연락 우선순위(복수 보호자 시 priority).
- **미성년·의식저하 환자**: 법정대리인 1인 등록을 강하게 유도 — 게이트 config `er.registration.guardianGate`(OFF/WARN/**BLOCK 아님 — 기본 WARN**). 진료를 막지 않는다(fail-open 이 아니라 **진료 우선 원칙** — KTAS 1·2 는 선진료·후등록이 규정이다). WARN 시 접수 트랙에 '보호자 미등록' 칩이 남아 원무가 후속한다.
- **신원미상 흐름**(`/patients/register/emergency` 기존): 보호자 없음으로 시작 → '보호자 확인 중' 상태 칩 → 신원 확인 시 보호자 등록을 같은 화면에서 촉구.
- **동의서 연계**: 미성년/의사무능력 시 동의 대행은 동의서 모듈의 보호자 서명 필드(guardianName·guardianRelation·guardianLegalBasis)와 연결 — 접수에서 등록한 법정대리인이 동의서 대행 서명자 기본값으로 프리필(이중 입력 제거).
- **표시**: 베드 카드 상세·베드사이드 디스플레이에 1순위 보호자(이름·관계·연락처) 표시(`er.bedDisplay.fields` 항목) — 상태 악화 시 임상진이 바로 연락.
- 기존 일반 등록의 보호자 입력과 정본이 같으므로(PatientContact) 일반 흐름과 충돌 없음.

## 4. 화면 설계

### 4.1 `/emergency` — "베드 보드" 뷰 (기본 뷰로 승격, 목록 뷰 토글 유지)

```
┌ 응급실 ────────────────────────────── [베드 보드|목록] [관제 보드→] ┐
│ 재실 4명 · 중증(1·2급) 1명 · 미배정 2명 · 청소대기 1병상              │
├──────────────────────────────────────────────────────────────┤
│ 소생 RESUS          중증 ACUTE                격리 ISO          │
│ ┌R-01────┐┌R-02───┐ ┌A-01────┐┌A-02───┐...   ┌I-01 ⚠격리─┐    │
│ │ (빈)가용 ││🔴 김OO │ │🟠 이OO  ││(청소중) │      │ (빈)가용   │    │
│ └────────┘│KTAS1   │ │KTAS2   ││ 🧹12분 │      └──────────┘    │
│           │흉통     │ │호흡곤란⚡│└───────┘                      │
│           │⏱2시간10분│ │⏱45분 인공호흡기│                          │
│           └────────┘ └────────┘                               │
│ 일반 GEN (10)                      관찰 OBS (4)                 │
│ … 동일 그리드 …                                                 │
├──────────────────────────────────────────────────────────────┤
│ 미배정 재실 (도착순)  🔴박OO KTAS2·도착 8분 [배정▾]  🟡최OO KTAS3 [배정▾] │
└──────────────────────────────────────────────────────────────┘
```

**베드 카드 구성** (점유 시):
- 테두리·좌측 굵은 바 = KTAS 색(정본 tone). 빈 베드 = 상태색(가용 emerald·청소 amber+경과분·정비 gray·예약 sky 점선+사전통보 환자명).
- 1행: 베드번호 + 환자명 + 나이/성별. 2행: 주호소(말줄임). 3행: 체류시간(`⏱`) + 상태 칩(EMERGENCY_VISIT_STATUS_LABEL 정본).
- 배지(있을 때만): `인공호흡기`(onVentilator) · `⚠재평가 지연`(KTAS별 주기 초과 — §8) · `🛏입원대기`(boarding=PENDING_DISPOSITION+disposition ADMISSION) · `⚠격리`(ISO 구역 또는 bed.status=ISOLATION) · `MCI`(mciEventId).
- 클릭 → 기존 우측 상세 패널(재사용) + 베드 액션 3종: **이동**(다른 가용 베드 선택 팝오버) · **해제**(사유 선택) · *(빈 베드 클릭 시)* **배정**(미배정 재실 환자 선택).
- 드래그&드롭은 P2 이후(RGL 함정 전례 — @dnd-kit 검증 후). P0 은 클릭-투-배정만.

### 4.2 배정 UX 원칙
- 미배정 트레이는 KTAS 1·2 를 항상 맨 앞 + 붉은 펄스 — "중증이 바닥에 있다" 를 화면이 소리치게 한다.
- KTAS 1·2 환자를 GEN/OBS 에 배정하려 하면 **경고 확인**(차단 아님 — 현장 판단 존중, WARN 게이트 사상).
- 격리 필요 신호(감염 플래그)는 이 축에서는 표시만(ISO 권장 문구), 강제 없음.

### 4.3 `/emergency/bed-display/[bedId]` — 베드사이드 디스플레이 (신규)
태블릿/모니터 전체화면(가로), 다크 배경, 폴링 fast. 사이드바 없는 전용 레이아웃.

```
┌────────────────────────────────────────────┐
│  A-03            KTAS 2 긴급        14:32   │  ← 상단: 베드·KTAS 색 밴드·시계
│                                            │
│   김 O O   M/67   MRN P2026-xxxx           │  ← 환자 확인(마스킹 config)
│   주호소: 호흡곤란     체류 1시간 12분         │
│                                            │
│  ⚠ 알레르기: 페니실린    🚫 금식    ⚠ 낙상주의  │  ← 안전 배지(있는 것만·대형)
│                                            │
│  담당의 김내과 · 담당간호사 박OO               │
│  진행: 검사 결과 대기 │ 다음: 흉부 CT (예정)     │  ← 상태·예정 오더 1줄
└────────────────────────────────────────────┘
```

- 빈 베드일 때: 베드번호 + "가용/청소 중/정비 중" 대형 상태 표시(색상만으로도 복도에서 식별).
- 데이터 소스: `GET /emergency/beds/:bedId/display` 단일 EP(아래 §5) — 화면에서 다중 호출 조립 금지(베드사이드 기기 성능·PHI 최소 전송).
- 안전 배지 소스: 알레르기=Patient.allergies, 금식/낙상=간호평가·오더에서 파생 — **P2 에서 실제 소스 필드를 재실측해 확정**(추정 금지, 없으면 해당 배지 미표시).
- 표시 항목은 `er.bedDisplay.fields`(MAP config)로 온오프 — 병원 정책마다 다른 항목(예: 진단명 노출 여부)을 코드 수정 없이.

### 4.4 관리 기능 (ADMIN) — 베드·구역·운영 설정
시스템 설정 안에 응급실 운영 관리 절을 둔다(신규 `/admin/er-beds` 또는 시스템 설정 탭 — 구현 시 기존 admin IA 에 맞춰 확정):

- **베드 관리**: 베드 추가/비활성(삭제 아님 — 이력 보존)·구역 이동·번호 변경. 점유 중 베드는 비활성/이동 거부. 위원회 관리 모달과 같은 패턴(생성·수정·비활성=이력 보존).
- **구역 관리**: `er.beds.zones` 편집 UI(라벨·정렬·표시 색) — 자유 문자열이 아니라 정의된 구역 코드에만 베드를 귀속(드리프트 방지).
- **운영 설정**: 원무영역 분리(`er.reception.separated`·D10) 토글 + 분리 시 접수 트랙 패널 구성(접수 전용 — 예약·수납 없음), 보호자 게이트(`er.registration.guardianGate`·D11), 재평가 주기·청소 SLA·boarding 경고·베드사이드 마스킹/표시 필드 — 전부 §8 config 의 관리 UI 표면.
- 변경은 전부 감사 대상 + 거버넌스 배지(⚖) — 구역 개편·원무 분리 전환은 안건 상정 권고 문구 노출(강제 아님).

### 4.5 입원·퇴원 워크플로 연계 기능 (실측 기반)
실측: `visits/:id/admit` 은 `AdmissionService.create` 위임으로 입원 병상까지 배정하고, `discharge` 는 disposition 기록만 하며 **퇴실(베드 정리)·귀가 절차 개념이 없다**. 보드가 생기면 이 흐름이 베드 위에서 보이고 진행돼야 한다.

**입원 경로 (결정 → boarding → 병상 배정 → 퇴실·인계)**
- 베드 카드에서 입원 결정 시 카드가 **🛏입원대기(boarding)** 모드로 전환 — 경과시간 표시(관제 boarding 정의와 동일식). ER 베드는 계속 점유(D4).
- 카드 액션에 "병상 배정 →"(기존 admit 흐름 진입). admit 성공(admissionId 생성) 시:
  - ER 베드 자동 해제 → CLEANING
  - 병동 인계: **admit 이 이미 `ClinicalHandoff`(ER_TO_ADMISSION) 를 자동 생성한다**(2026-08-05 실측 — 비차단·SBAR/I-PASS·인수자 acknowledge 전 미확인 상태). 보드가 할 일은 생성이 아니라 **인수 확인(acknowledge) 대기 표시** — 해제된 베드 이력·관제에 '인계 인수 대기' 칩. 이중 생성 금지.
- boarding 장기화(config `er.boarding.warnMinutes` 기본 120)는 베드 카드·관제에 경고 배지 — 병상 회전 압박의 근거 데이터.

**퇴원 경로 (결정 → 귀가 준비 → 퇴실)**
- 퇴원 결정 시 카드가 **귀가 준비** 모드 — 퇴원 체크리스트 패널(현행 데이터로 표시 가능한 것만·날조 금지):
  - 퇴원 안내(dischargeInstructions) 작성 여부 — `EmergencyDispositionRecord` 실존 필드
  - 외래 추적 예약(followUpDate) 입력 여부
  - 처방 존재 여부(원내 조제/원외 처방전 — 오더 조회)
  - 수납 상태 — **응급 원무가 아니라 일반 수납 흐름 소관**(D10). 카드에는 수납 대기 여부를 **읽기 전용 표시만** 하고 처리 링크는 기존 수납 화면으로.
- "퇴실" 버튼(신설 개념 — `discharge` EP 를 퇴실 확정으로 재해석·베드 해제 훅) → 베드 CLEANING. 수납 미완료여도 퇴실은 가능(임상 흐름이 수납에 묶이면 안 됨) — 미수납은 수납 화면 몫.
- 전원(TRANSFER): transferTo/transferReason 기록 확인 + 이송 준비 표시 → 퇴실 시 해제. 사망(DEATH): 확정 즉시 해제(D4).

**공통**
- 여정 이벤트: `er.boarding.started`·`er.discharged`(퇴실)·기존 admit 이벤트와 중복 발행 금지(발행 지점 실측 후 배선 — 정의≠발행 교훈).
- 이 절은 기존 EP 재해석+훅이 중심이라 **신규 모델 없음**(boarding 은 disposition=ADMISSION ∧ admissionId null 로 파생).

### 4.6 `/emergency-board` 관제 확장
- 상단 통계 행에 **구역 점유 타일** 추가: `소생 1/2 · 중증 4/6 · 일반 6/10 · 격리 0/2 · 관찰 2/4 · 청소대기 1`.
- 재실 목록 행에 베드 컬럼 추가(미배정은 `—` + 주황 표시).
- NEDOCS 계산의 병상수 입력이 현재 어떻게 산정되는지 P1 에서 실측 — ER 베드 정본과 연결 가능하면 자동화(불일치 시 관제가 거짓말하게 되므로 확인 전 연결 금지).

## 5. API 설계 (`/api/v1/emergency/beds*`)

| Method | Path | Roles | 동작 |
|---|---|---|---|
| GET | `/emergency/beds` | ER 스태프(ADMIN·DOCTOR·NURSE) | 구역 그룹 베드 전체 + 현재 배정 visit 요약(환자명·KTAS·주호소·arrivalAt·status·onVentilator·disposition)+ 미배정 재실 목록. 단일 응답(보드 1폴링 1콜) |
| POST | `/emergency/beds/assign` | 〃 | `{visitId, bedId}` — tx(D3). RESERVED 베드는 배정으로 소화. 409=선점 |
| POST | `/emergency/beds/move` | 〃 | `{visitId, toBedId}` — 기존 해제(MOVE)+신규 배정 원자화. 원 베드→CLEANING |
| POST | `/emergency/beds/release` | 〃 | `{visitId, reason?}` — 수동 해제. 베드→CLEANING |
| PATCH | `/emergency/beds/:bedId/status` | 〃 | CLEANING→AVAILABLE(청소완료)·MAINTENANCE·ISOLATION·RESERVED 전환. 점유 중 베드는 거부 |
| GET | `/emergency/beds/:bedId/display` | 〃 | 베드사이드 디스플레이 전용 조립(마스킹·fields config 서버 적용 — 클라 신뢰 금지) |

- 전 EP 변이는 기본 감사 ON(규약 — 면제 없음). 열람 중 `display` 는 환자 지목 조회이므로 AuditLog 열람 기록 대상인지 P0 에서 audit-routes 규약 확인.
- 기존 `PUT visits/:id/visit-status`·`disposition`·`discharge`·`admit`·stale auto-close 서비스에 **베드 자동 해제 훅**(D4) — 실패는 비차단 warn(베드 정리가 진료 흐름을 막으면 안 됨) + 관제 "유령 점유" 배지로 회수(§8).

## 6. 상태·배지 파생 규칙 (§8 로 통합)

| 배지 | 파생 |
|---|---|
| ⚠재평가 지연 | `now - max(triagedAt, 최근 reassessment.at) > er.reassessInterval[KTAS]` (config MAP, 기본 1:15분/2:30분/3:60분/4·5:120분 — **qi.targets 의 KTAS 재평가 15분과 별개 키인지 P1 실측**·이중 선언 금지 원칙) |
| 🛏입원대기 | status=PENDING_DISPOSITION ∧ disposition=ADMISSION(관제 boarding 정의와 동일식 — emergency.service 기존 로직 재사용) |
| 🧹청소 지연 | bed.status=CLEANING ∧ 경과 > `er.cleaning.slaMinutes`(기본 30) |
| 유령 점유 | bed.status=OCCUPIED ∧ 활성 assignment 없음(자동 해제 훅 실패 잔재) — 관제·보드에 표시, 클릭 한 번으로 정리 |

## 7. 개인정보·보안·감사

- 베드사이드 디스플레이 = 스태프 세션 필수(D5)·마스킹은 서버 적용(D6)·표시 필드 화이트리스트(AI 평가 컨텍스트와 동일 사상 — PHI 최소).
- 배정/이동/해제 감사 자동(변이 기본 ON). `display` 열람 기록은 P0 확인 항목.
- 화면 인쇄 없음(print guard 무관).
- RECEPTIONIST 는 베드 보드 열람 불가(임상 화면) — 접수는 기존 사전통보 EP 범위 유지.

## 8. Config 표면 (거버넌스 SurfaceMap 등재)

| key | 형 | 기본 | 소비처 |
|---|---|---|---|
| `er.beds.zones` | MAP | RESUS/ACUTE/GEN/ISO/OBS 라벨·정렬 | 보드 그리드·시드 |
| `er.reassessInterval` | MAP | KTAS별 분(§6) | 배지·(후속) 재평가 알림 크론 |
| `er.cleaning.slaMinutes` | number | 30 | 청소 지연 배지 |
| `er.bedDisplay.nameMasking` | boolean | false | display EP |
| `er.bedDisplay.fields` | MAP | 전 필드 on | display EP |
| `er.reception.separated` | boolean | true | 베드 보드 접수 트랙 패널·`/reception` 응급 필터/배너(D10) |
| `er.registration.guardianGate` | OFF/WARN | WARN | 응급 접수 보호자 스텝(D11) — 미성년·의식저하 미등록 시 경고(BLOCK 없음 — 진료 우선) |
| `er.boarding.warnMinutes` | number | 120 | 입원대기 장기화 경고 배지(§4.5) |

전부 폴백 fail-safe(테이블 정본+하드코딩 폴백 패턴). "정의만 된 config 는 없는 것보다 나쁘다" — **각 키는 소비 코드와 같은 PR 에서만 추가**.

## 9. AI 보조 (P3·optional)

- 배치 제안: 미배정 환자 선택 시 "KTAS 2·인공호흡기 → ACUTE 권장(A-04 가용)" 1줄 — 서버 결정적 규칙(KTAS·onVentilator·격리 신호→구역 매핑)이 1차, LLM 은 근거 문장 생성만(governance.ai 패턴·disclaimer 고정). 규칙만으로 충분하면 LLM 생략 — **AI 는 장식이 아니라 필요할 때만**.
- 과밀 시 재배치 제안·퇴실 예측은 범위 밖(백로그 메모).

## 10. 시드 (개발 모드 규약 — dev-simulation-production-switchover 준수)

- 응급병동 베드 재구성: RESUS 2·ACUTE 6·GEN 10·ISO 2·OBS 4 = **24병상**(기존 ER-01~05 는 재명명 흡수). advisory lock + 멱등(구역·번호 존재 검사).
- 재실 4명 중 2명을 시드로 배정(ACUTE·OBS), 2명은 미배정 트레이 시연용. CLEANING 1병상 연출.
- 실 서비스 전 실제 병상 배치도로 교체하는 항목으로 switchover 문서 §시드 절에 등재.

## 11. 함정 체크리스트 (전례 기반)

- [ ] EmergencyModule 에 Journey/Notification 신규 주입 시 **모듈 imports 전수 확인**(@Optional 조용한 no-op 2연발 전례)
- [ ] 신규 모델 후 서버 `prisma generate` + `nest build`(deploy 함정)
- [ ] 부분 유니크 인덱스는 Prisma schema 로 표현 불가 → 마이그레이션 SQL 수동(`db push` 손실 경고 시 무손실 DDL 수동 선적용 전례 — `--accept-data-loss` 금지)
- [ ] date-only 없음(전부 timestamptz) — KST 경계 함정 해당 없음 확인
- [ ] 보드 1콜 응답에 이중 `{data:{data}}` 래핑 방지(rail unwrap 방어 전례)
- [ ] 입원측 `beds/available` 응급병동 제외(D1 — **집계 사실 확정**: wardId 미지정 전 병동 반환·호출부 2곳 무필터)
- [ ] DTO 는 class-validator 클래스(인라인 @Body 금지 — ValidationPipe 스킵 40% 전례)

## 12. 단계별 실행 계획 · 검증

### P0 — 배정 코어 + 베드 보드 (1차 배포 단위)
**선행: `beds/available` 응급병동 제외**(D1 실결함 — 현재도 입원 병상 선택 오염 중), 모델 2건(D2)+부분 유니크 인덱스, 시드(§10), EP 5종(assign/move/release/status/beds), `/emergency` 베드 보드 뷰(그리드+미배정 트레이+클릭 배정), KTAS 정본 shared 승격(D7), 여정 이벤트(D8).
**검증**: 라이브 왕복 — 배정→보드 반영→이동(원 베드 CLEANING)→해제→청소완료. 동시 배정 경합은 curl 2발 동시 발사로 409 확인. spec: assignment tx·유니크 충돌 번역·visit.bedId 캐시 정합.

### P1 — 수명주기 자동화 + 입퇴원 워크플로 + 관제·관리 기능
경로별 자동 해제 훅(D4 표 — admit 성공/퇴실/사망/auto-close), **입퇴원 워크플로(§4.5 — boarding 카드 모드·병상 배정 진입·병동 인계 유도·퇴원 체크리스트·퇴실 버튼)**, 사전통보 도착→RESERVED 제안, 관제 구역 타일·베드 컬럼·boarding 경고, 재평가 지연·청소 지연·유령 점유 배지, **관리 기능(§4.4 — 베드/구역 관리 UI + 원무영역 분리 설정 D10)**, **응급 접수 보호자 스텝(D11 — PatientContact 정본·guardianGate WARN·접수 트랙 '보호자 미등록' 칩·동의서 대행 서명 프리필)**, config 7종(`zones`·`reassessInterval`·`cleaning.slaMinutes`·`reception.separated`·`registration.guardianGate`·`boarding.warnMinutes`+표시 필드)+SurfaceMap 등재.
**검증**: 입원 종단(결정→boarding 배지→admit→ER 베드 자동 CLEANING→인계 기록), 퇴원 종단(결정→체크리스트→퇴실→CLEANING·수납 미완료여도 퇴실 가능), 보호자 스텝 저장이 PatientContact 로 남고 동의서 대행 서명에 프리필되는 왕복, `er.reception.separated` 토글 왕복, NEDOCS 병상수 산정 실측 보고.

### P2 — 베드사이드 디스플레이
`/emergency/bed-display/[bedId]` 전용 레이아웃+display EP(서버 마스킹·fields), 안전 배지 소스 재실측 후 배선(금식/낙상 — 소스 없으면 미표시로 정직하게), 빈 베드 상태 화면, config 2종.
**검증**: 태블릿 해상도(1280×800) 실렌더 스크린샷, 마스킹 config 토글 왕복, display 열람 감사 기록 확인.

### P3 — 다듬기 (운영 판단 후)
드래그&드롭(@dnd-kit), 배치 제안(§9), 구역 점유율·베드 회전 리포트, 재평가 지연 알림 크론(탐지와 상신 분리 불가 원칙).

각 단계 완료 시: 기획서 실행 기록 절 추가·릴리즈 노트·(P1 이후) 거버넌스 안건 상정(구역 구성·마스킹 정책 — 시드 의결 규약).

## 12.5 P0 실행 기록 (2026-08-05)

- 스키마: `Ward.type`(GENERAL|EMERGENCY)·`EmergencyVisit.bedId` 캐시·`EmergencyBedAssignment` 신설. 부분 유니크 인덱스 2종은 psql 수동 DDL(`uq_er_bed_active`·`uq_er_visit_active`).
- 운영 마이그레이션: 응급병동 type=EMERGENCY, ER-01~05 → RESUS-1/2·ACUTE-1/2/3 재명명(베드 id 보존), 19병상 증설 → **24병상 5구역**. 시드(seed.ts)도 구역 체계로 동기화.
- 🔴 D1 실결함 봉합 라이브 실증: `beds/available` 27건 중 ER 병상 **0건**(종전 5건 노출).
- EP 5종 + `ErBedService`(tx·P2002→409·유령 점유 판정) + spec 11건. KTAS 정본 D7(shared 라벨+`lib/ktas.ts` 색 — 기존 2벌 board 계열로 통일).
- 라이브 종단: KTAS2→ACUTE-1 배정 → 동일 베드 이중 배정 **409** → KTAS3→OBS-1 → GEN-1 이동(원 베드 CLEANING) — 보드 최종 상태 점유 2·청소대기 1·미배정 2(§10 연출 일치). UI 렌더 확인.
- 함정 실전 기록: ssh 경유 psql 은 `docker exec -i`(stdin) 필수 — `-i` 없이는 **조용히 no-op**(적용 확인 쿼리로 잡음).

## 12.6 P1 코어 실행 기록 (2026-08-05)

- **자동 해제 훅 4경로(D4)**: admit 성공(+방문 COMPLETED — boarding 이 관제에 영구 잔류하던 것도 함께 종결)·퇴실(checkout)·사망 확정(+COMPLETED)·stale auto-close. 전부 `releaseByVisit`(무예외·실패=유령 점유 배지로 회수).
- **퇴실 신설**: `POST visits/:id/checkout` — discharge EP 재해석 대신 신규(결정 없이 400·수납 비종속). 보드 카드에 퇴원/전원 결정 시 [퇴실] 버튼.
- **배지**: ⚠재평가 지연(qi.targets.ktasReassessMin **재사용** — er.reassessInterval 신규 키는 이중 선언이라 만들지 않음·기획 §6 경고 적중), 청소 경과/지연(er.cleaning.slaMinutes=30), 입원대기 경과/경고(er.boarding.warnMinutes=120)+[병상 배정 →].
- **관제 확장**: 구역 점유 타일·베드 컬럼(미배정 표시)·**NEDOCS ED병상수=실 ER 베드 수 우선**(0 이면 config 폴백 — "Bed 에 응급 구분 없음" 주석이 낡아서 갱신).
- config 2키 DEFAULTS+SurfaceMap(OPS) 등재. KTAS_REASSESS_MIN 은 common/qi-targets 로 승격(관제·보드 공유).
- 라이브 종단: 결정 없이 퇴실 400 → 배정 → 퇴원 결정 → 퇴실(bedReleased·OBS-2 CLEANING·방문 COMPLETED). 스펙 62(신규 releaseByVisit 2 포함).
- 동반: CI Build Web 2차 OOM(배포 빌드와 동시·시작 4초 만 exit 137) — `webpackMemoryOptimizations` CI 한정 추가.

## 12.7 P1 후반 실행 기록 (2026-08-05)

- **관리(§4.4)**: `/admin/er-beds`(사이드바 3103) — 베드 추가(`beds/create`·구역 대문자/번호 검증·중복 400)·구역/번호 변경(`beds/:id/rename`·점유 거부)·상태 select·운영 설정 4키 인라인 편집(config PUT 정본). 삭제 없음(비활성=MAINTENANCE).
- **D10**: `er.reception.separated`(기본 true) — 분리=보드 접수 트랙 패널(신원 확인 중 `EMG-` MRN 파생·보호자 미등록), 통합=`/reception` 응급 도착 배너(`ErArrivalBanner`·통합일 때만 조회). 접수 전용 — 예약·수납 요소 없음.
- **D11**: `er.registration.guardianGate`(WARN/OFF·BLOCK 없음) — 접수 트랙 '보호자 미등록' 칩→GuardianModal(PatientContact 정본 POST — 관계·상세·연락처 2·법정대리인·현장 동행 notes). 라이브 왕복=등록 후 칩 소멸(4→3). 법정대리인은 동의서 대행 서명과 같은 정본이라 연계 자동.
- **RESERVED(사전통보 제안)**: 빈 AVAILABLE 베드 [예약]·RESERVED [예약 해제] — 수동 판단(자동 강제 없음·D4 취지). 배정은 RESERVED 도 소화.
- SurfaceMap 2건 추가(OPS 분리 운영·SAFE 보호자 게이트). 스펙 62 유지.
- 🔎 **CI 러너 정정**: 러너는 HIS 서버가 아닌 별도 머신(가용 12.6GB 표시 중에도 exit 137) — 시스템 OOM 아님·cgroup 제한 의심. ci.yml 에 진단 스텝(cgroup memory.max/peak)+빌드 1회 재시도. §13 다음 실패 시 진단 출력으로 확정.

## 12.8 P2·P3 실행 기록 (2026-08-05 — 기획 종결)

- **P2 베드사이드 디스플레이**: `GET beds/:bedId/display`(서버 조립 단일 EP — 마스킹·표시 필드 config 서버 적용·클라 신뢰 금지) + `/emergency/bed-display/[bedId]`(fixed 전체화면·다크·빈 베드=상태 대형 표시). 안전 배지 소스 재실측 결과=알레르기(Allergy 정본)·낙상(FallRiskAssessment.riskLevel HIGH)·인공호흡기만 표시 — **금식(NPO)은 확실한 정본 부재로 미표시(날조 금지)**. 보호자 1순위 표시(D11 연계). 라이브=점유/빈/마스킹(손서연→손*연) 왕복. 관리 페이지 베드 카드에 🖵 디스플레이 링크.
- **P3 배치 제안**: 서버 결정적 규칙만(`suggestZone` — KTAS1→소생·KTAS2/인공호흡기→중증·관찰상태→관찰·그외→일반. **격리는 감염 플래그 정본 부재로 제안 안 함**). LLM 미사용(§9 "규칙으로 충분하면 생략" 이행). 트레이·배정 모달에 권장 칩(일치 시 ✓).
- **P3 드래그 배정**: @dnd-kit(기설치·RGL 대체 검증본) — 트레이→빈 베드 드롭, 5px 활성화로 내부 버튼 클릭과 공존, WARN 확인 동일 적용.
- **P3 리포트**: `GET beds/stats?days=` — 배정 이력 기반 구역별 배정 수·평균 점유·해제 사유(표본 없으면 없는 대로). 관리 페이지 카드(7/30/90일).
- **P3 재평가 알림 크론**: `er.reassessNotify.enabled`(**기본 OFF** — 보드 배지가 1차·알림 남발 방지) — ON 시 10분 주기, 담당의 지정 방문만, 방문당 60분 dedupe(refId=visitId uuid 계약). 관제 getBoard 재사용이라 판정 이중화 없음. ON 은 운영 판단으로 이연.
- config 3키(bedDisplay 2·reassessNotify)+SurfaceMap 3건(SAFE 마스킹·OPS 필드·QPS 크론). 스펙 62 유지.

## 13. 기존 워크플로 영향도 검토 (2026-08-05 코드 실측)

| 기존 워크플로 | 영향 | 근거·조치 |
|---|---|---|
| 응급 입원(`visits/:id/admit`) | **무영향(additive)** | AdmissionService.create 위임(병상 비관적 선점·중복가드·여정 포함)은 그대로. ER 베드 해제 훅만 뒤에 붙는다(비차단 warn) |
| ER→병동 인계 | **무영향 — 기획 수정으로 이중 생성 회피** | admit 이 이미 ClinicalHandoff 자동 생성(실측). 보드는 acknowledge 대기 표시만(§4.5 보정) |
| 응급 퇴원(`visits/:id/discharge`) | **저위험 — 의미 재해석** | FE 호출부 **0건 실측**(화면은 disposition EP 만 사용) — '퇴실 확정' 의미 부여·베드 해제 훅 추가해도 기존 화면 동작 불변. 단 P1 에서 mobile·테스트 호출부 재확인 후 확정 |
| 디스포지션(`disposition` EP) | **무영향** | 결정 기록은 그대로 — D4 에 따라 ADMISSION/DISCHARGE/TRANSFER 는 결정 시점에 베드를 건드리지 않는다(DEATH 만 해제) |
| stale auto-close 크론 | **무영향(additive)** | COMPLETED+DISCHARGE 보정 로직 그대로 + 활성 배정 해제 1줄 추가(AUTO_CLOSE) |
| 입원 병상 선택(`beds/available`) | 🔴 **기존 결함 노출 — P0 선행 수정** | wardId 미지정 시 전 병동 반환 — 응급병동 ER-01~05 가 지금도 `/workstation/emergency`·`/inpatient` 병상 목록에 노출 중(D1). 이 축과 무관하게도 고쳐야 할 실결함 |
| 일반 접수 데스크(`/reception`) | **무영향** | 응급 방문은 대기열 미사용(실측) — 분리 모드는 현행 유지, 통합 모드만 배너 추가(D10 보정) |
| 입원 병상 보드(`/bed-board`)·병동 운영 | **무영향** | Bed 모델 공유하지만 응급병동 스코프만 조작. 병동 베드 상태 전이는 건드리지 않음 |
| 사전통보(prenotifications) | **저영향(opt-in)** | 도착 처리에 RESERVED '제안' 만 추가 — 기존 arrive/cancel 흐름 불변 |
| NEDOCS | **P1 확인 전 미연결** | 병상수 산정 방식 실측 전에는 연결하지 않는다(관제 거짓말 방지) |
| KTAS 표시(기존 2화면) | **저위험 — 회귀 주의** | 로컬 Record → shared 정본 승격(D7) 시 색·라벨 문자열이 1:1 동일함을 스냅샷으로 검증 후 치환 |
| 응급 미확인 등록·일반 등록 | **무영향(additive)** | 보호자 스텝은 PatientContact 정본에 쓰기 추가 — 기존 필드·흐름 변경 없음(D11) |
| 여정 이벤트 | **무영향(additive)** | emergency.* 기존 발행 유지 — er.bed.* 3종만 신규. admit 여정은 AdmissionService 가 이미 발행하므로 중복 발행 금지(§4.5) |

요약: **차단성 영향 0**. 유일한 필수 선행은 `beds/available` 응급병동 제외(기존 잠복 결함의 수정이라 이 축이 아니어도 정당). 의미 변경은 discharge EP 재해석 하나뿐이고 호출부 0건 실측으로 저위험.

## 14. 연계 영역 요약

| 영역 | 연계 |
|---|---|
| 입원(admit) | 기존 `visits/:id/admit` → 입원 병상 배정과 별개. ER 베드는 admit 완료 시 자동 해제 |
| 원무(reception) | `er.reception.separated`(D10) — **응급 원무는 접수 전용**. 분리 시 `/reception` 응급 제외+베드 보드 접수 트랙, 통합 시 접수 데스크 응급 배너 |
| 보호자(PatientContact) | D11 — 응급 접수 보호자 스텝이 정본을 채움·동의서 대행 서명 프리필·베드사이드 1순위 보호자 표시 |
| 수납 | 퇴원 체크리스트에 읽기 전용 표시만 — 처리는 기존 수납 화면(퇴실은 수납에 비종속) |
| 인계(ClinicalHandoff) | ER→병동 인계 기록 유도(admit 성공 시·WARN) |
| 사전통보 | 도착 임박 → RESERVED 제안(P1) |
| 골든패스웨이 | 베드 카드에 활성 패스웨이 배지(P1 검토 — 필드 이미 존재) |
| 간호 | 간호 타블렛 모드에서 베드 보드 열람(레이아웃 반응형이면 추가 작업 없음 — P0 에서 확인) |
| NEDOCS | 병상수 자동 산정 후보(P1 실측 후) |
| 거버넌스 | config 5종 SurfaceMap·정책 변경 안건화(D9) |
| 여정 | er.bed.* 이벤트 3종(D8) |
