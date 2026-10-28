# 공간·동선 정본화 + 도면 판독 + 3D 동선 뷰어 기획서 (Spatial Flow · Vision · 3D)

- **버전**: v0.2 (2026-09-28) — §5-A 자산 배치 원장·§5-B 합성 도면 **구현**(미배포) · 나머지 기획
- **상태**: 🟡 부분 구현 — §5-A·§5-B 배포(`6c2a7cace`) · **P0 정본화 구현(2026-09-28 · §5-P0 결과)** · P1~P5 착수 전 · 사람 결정 11건 대기(§9)
- **선행 기획(대체하지 않고 이어받음)**: `metaverse-hospital-space.plan.md` · `metaverse-patient-journey.plan.md` ·
  `patient-flow-qr-checkin.plan.md` · `patient-journey-tracking.plan.md` · `journey-console-redesign.plan.md`
- **관련 정본**: `clinical-ux-agent-era.plan.md` §7(에이전트 관계 모드·초안≠확정) · `ai-judgment-governance.plan.md` ·
  `outbound-channel-console.plan.md`(대외 발신 3조건) · `docs/05-reference/ARCHITECTURE-INVARIANTS.md` INV-PHI-03

---

## 0. 한 줄 결론

🔴 **3D 는 지금 얹을 곳이 없다 — 그리면 "지어낸 건물 위에 추정한 환자"를 실감 나게 보여주게 된다.**
기하는 격자 자동 배치이고, 위치의 상당수는 관측이 아니라 이벤트에서 번역한 추정이며, 층·방 위치의 정본이 다섯 갈래다.
그래서 이 기획은 순서를 뒤집는다.
- **P0 공간 정본화**: 먼저 위치 출처와 층 정본을 하나로 만든다.
- **P1 도면 판독**: 이미지 이해가 가장 큰 값을 내는 곳이다. 실제 평면도를 읽어 공간 그래프 초안을 만들고, 사람이 확정한다.
- **P2 이후 3D 뷰어·길안내·동선 최적화**: 앞의 두 단계가 끝난 뒤에 한다.

---

## 1. 전제 — "모델의 이미지·3D 능력"을 이 시스템에 쓰는 두 경로

| 경로 | 무엇을 하나 | 환자 정보(PHI) | 가능 여부 |
|------|-------------|---------------|-----------|
| **A. 개발 시점**(Claude Code) | 도면 이미지를 읽어 `SpaceNode`/`SpaceEdge` 가져오기용 JSON **초안** 작성 · three.js 뷰어 코드 작성 · 렌더 결과 스크린샷을 보고 시각 검수 | 없음(도면은 PHI 아님) | **지금 가능** — 결과물은 코드·시드 JSON 이라 기존 리뷰·가드 경로를 탄다 |
| **B. 런타임**(HIS 가 모델을 호출) | 관리자가 올린 도면을 서버가 판독 | 도면 자체는 없음 · 단, 도면에 환자 게시물이 찍힌 사진은 예외 | **사람 결정 필요**(§9 D1) |

실측으로 확인한 전제:
- **런타임 AI 제공자는 원내 WeRU.B 하나다**(Ollama 형 `/api/chat`·`/api/vision/medical/*`). 저장소에 Anthropic/OpenAI SDK 가 **없다**.
  - 모든 AI 송신은 `common/util/ai-egress-fetch.ts` 한 곳을 지난다.
  - 외부 호스트는 `AI_EGRESS_ALLOWED_HOSTS` 미설정이면 차단된다.
- **INV-PHI-03(BLOCKER)**: SaMD 추론의 입출력은 온프렘 경계를 벗어나지 않는다.
  - → 환자 이미지(상처·피부·영상)에 외부 모델을 쓰는 것은 **이 기획의 범위가 아니다**(§11).
  - 도면은 SaMD 추론이 아니므로 이 불변식에 직접 걸리지는 않는다. 다만 외부 송신이므로 **대외 발신 3조건**(구현 + 설정 기본 OFF + 승인)을 따른다.
- **3D 렌더링은 브라우저가 한다**(three.js/WebGL). 런타임에 모델의 "3D 능력"이 필요한 곳은 없다.
  - 모델의 몫은 ① 도면 → 구조 초안(판독) ② 뷰어 코드 작성(개발 시점) 둘이다.
- 🔴 **판독 정확도는 모른다.** 도면 판독 품질을 원내 도면으로 잰 적이 없다. 측정 전까지는 화면·문서 어디에도 정확도를 적지 않는다(§8 수용 시험).

---

## 2. 실측 — 이미 있는 것

| 자산 | 위치 | 상태 |
|------|------|------|
| `SpaceNode`(병원›동›층›구역 트리 + `connectedTo` Json·`walkTime`·`metadata.bounds/door/sla`) | `schema.prisma:9221` · 시드 `seed.ts:6630~6717`(약 70노드, 1F~6F+B1) | 있음 — 기하는 가짜(F2) |
| `PatientLocation`(환자×구역×입퇴장) | `schema.prisma:9257` — `zoneId` 에 FK 관계 없음 | 있음 — 출처 혼재(F1) |
| QR 위치 스테이션 `LocationStation`·`PatientLocToken`(위치 동의 포함) | `schema.prisma:9277~9293` · `patient-flow.service.ts:91~135` · 화면 `/station`·`/admin/location-stations` | 있음 — **관측 경로는 이것 하나** |
| `floor` API(평면·OD 흐름 p90·토폴로지·SLA·다음 목적지·SSE) — ADMIN | `floor.controller.ts:24~134` · `floor.service.ts` | 있음 — 저장소 안 소비처는 `/simulator` 하나, 주 소비처는 외부 clinic 저장소(`docs/05-reference/clinic-floor-his-api-response.md` — "RTLS 좌표 ❌" 명시) |
| `metaverse` API(구조·환자 위치·점유 히트맵·궤적) | `metaverse.controller.ts:17~55` | 있음 — 화면 `/metaverse`(2603)는 CSS 그리드 2D |
| 여정 분석(OPD 대기→호출→진료·ER door→triage, 병목 순위) | `journey-console/journey-analytics.service.ts:40~135` · 정본 `flow-canon.ts` | 있음 — **시간 단계만, 공간 축 없음** |
| 검진 동선(고정 순서 규칙 + 대기 최소 추천) | `checkup.service.ts:41~59` · `checkup-station.service.ts:309~358` | 있음 — 결함(F5) |
| 시뮬레이터(합성 환자가 `journey.emit` 을 탐) | `simulator/simulator.service.ts:106,422` · 화면 `/simulator`(2602) | 있음 |
| 차트 라이브러리 | web: `chart.js`+`react-chartjs-2` 뿐 · mobile: svg·지도 라이브러리 없음 | 3D·SVG 지도 **없음** |

## 3. 실측 — 결함과 공백 (3D 이전에 풀어야 하는 것)

> 구분: **확정 결함**(코드로 확인) / **공백**(없음) / **구조적 위험**(실피해 미실측 — 운영 DB 는 가상병원 시드라 피해를 실측할 수 없다)

**F1 확정 · 추정 위치가 관측 위치와 같은 원장에 같은 모양으로 들어간다** — `journey.service.ts:44~128`
- 여정 이벤트를 위치로 **번역**한다.
  - `ORDER_CREATED` → 검사실(`in-lab`)
  - `ENCOUNTER_SIGNED` → 수납 창구
  - `BILLING_PAID` → 약국
  - 오더가 났다고 환자가 검사실에 간 것이 아니다.
- 같은 종류의 구역이 여럿이면 `spaceNode.findFirst`(:65)로 **아무거나 하나** 고른다. 예를 들어 채혈실이 둘이면 첫 번째로 기록된다.
- 이전 구역을 닫을 때 `duration` 을 비운다(:76). QR 경로(`patient-flow.service.ts:120`)는 채운다.
- 출처를 구분할 단서는 `eventType`(`QR_CHECKIN` 대 여정 이벤트 이름)뿐이다. 그런데 **어느 소비처도 구분하지 않는다**(`metaverse.service.ts` 는 `eventType` 을 그대로 넘길 뿐 · `floor.service.ts` 는 읽지 않음).
- → 동선 뷰어가 추정을 관측처럼 그린다(P1·P17). 3D 는 이 착시를 더 강하게 만든다.

**F2 확정 · 기하가 지어낸 값이다**
- `seed-floor-metadata.ts` 가 구역을 4열 격자로 자동 배치하고, 연결은 허브 하나에 모두 붙는 별 모양이다.
- SLA 대기 기준(진료 20·영상 25·내시경 30분)은 시드 상수다.
- `floor.service.ts:131,456`: `bounds` 가 없으면 `{x:0,y:0,w:4,h:3}` 로 채운다(모르는 좌표를 지어냄).
- `walkTime` 이 없으면 격자 중심 간 거리로 계산한다(:481).
- 이동 데모는 `Math.random` 이다(`seed-floor-demo-movement.ts`).

**F3 확정 · 방·층 위치의 정본이 다섯 갈래다(P12)**

| 출처 | 예 |
|------|----|
| `SpaceNode` 시드 | 영상실 `F2-IMG` = **2층** · 검진센터 = **B1** |
| `Equipment.location` 시드 | '**1층** 영상의학과' |
| `portal.service.ts:2276` `ROOM_MAP` 하드코딩 | 영상의학과 **1층** · 건강검진센터 **2층** |
| `facility-info/page.tsx:19~91` `FLOORS` 하드코딩(화면이 스스로 "예시"라고 밝힘 :184) | 검진센터 **7층** |
| `CheckupStation.location` | 시드 없음(null) |

- 같은 검진센터가 **B1·2층·7층** 세 곳에 있다.
- 환자 앱(`CheckupCard.tsx:57`)이 보는 것은 `ROOM_MAP` 이다.

**F4 공백 · 방·장치가 공간 모델에 묶이지 않는다**
- 외래 진료실은 모델이 없다. `WaitingQueue.roomName`·`ClinicSchedule.roomName` 이 텍스트(`${dept} ${n}진료실`, 층 없음)로만 있다.
- 키오스크·TV 박스(`DisplayApiKey`)는 자기가 어느 구역에 있는지 모른다.
- `guide/[id]` 는 `roomName` 텍스트만 보여준다.

**F5 확정 · "다음 검진 스테이션" 정본이 둘이고, 하나는 날짜 필터가 없다**
- 워크스테이션용 `checkup-station.service.ts:309~358`: 대기 수 × 평균 소요로 가장 작은 곳을 고른다.
  - 대기 수 조건이 `arrivedAt: { not: undefined }` 인데, Prisma 는 `undefined` 조건을 **무시한다**. → **날짜와 상관없이 완료되지 않은 모든 로그**를 센다.
  - 어제 끝내지 못한 기록이 오늘의 대기로 계산된다(구조적 위험 · 운영 피해는 실측 전).
  - 이동 거리를 보지 않는다. 공복 우선 규칙(`ORDERING_RULES`)도 무시한다.
- 포털용 `portal.service.ts:2327~2367`: 혼잡도 단계 → 예상 시간 순으로 고른다.
  - 층 정보는 `ROOM_MAP` 에서 가져온다.
- 같은 환자에게 **직원 화면과 환자 앱이 다른 곳을 추천할 수 있다.**

**F6 확정 · 검진 스테이션 간 이동이 위치 원장에 안 남는다**
- `CHECKUP_STATION_ARRIVE/COMPLETE` 는 여정 이벤트 어휘에 있다(`journey-event-types.ts:32`).
- 그러나 위치 매핑 표에는 없다. → 검진 동선이 공간 뷰에 나타나지 않는다.

**F7 확정 · 동선 SSE 실패를 삼킨다**
- `floor.service.ts:44` `catch { /* 이벤트 발행 실패는 무시 */ }`, `:62` `catch { /* noop */ }` 이다.
- 판정 규칙 §1(`.catch(()=>기본값)` = 실패를 없음으로 번역)에 걸린다. 층별 현황판이 조용히 멈춰도 흔적이 남지 않는다.
- 호출부(`journey.service.ts:95`)는 09-15 에 warn 으로 고쳤지만, 안쪽이 여전히 삼킨다.

**F8 공백 · 위치 기반 감염 접촉자 추적이 없다**
- `infection-control.service.ts:266~300` 은 접촉자를 사람이 손으로 입력한다.
- `PatientLocation`·`BedAssignment` 의 시공간 겹침은 쓰이지 않는다.

**F9 공백 · 원내 이송(porter) 요청 모듈이 없다**
- 가장 가까운 것이 `staff-call`(범용 호출)이다. 전동은 `admission/:id/transfer-bed` 로 기록만 한다.

**F10 사실 · 모든 위치 데이터는 합성이다**
- `dev.demoDateRoll` 은 `waiting_queue`·`appointments` 만 민다. `patient_locations`·`patient_journey_events`·`ck_station_logs` 는 밀지 않는다.
  → "오늘" 동선 뷰가 비어 있을 수 있다. 🔴 **"오늘 0"을 결함으로 읽지 않는다**(CLAUDE.md 함정 2).

---

## 4. 설계 원칙 (이 기획 고유 + 판정 규칙 연결)

1. **위치는 세 종류다 — 관측 / 추정 / 계획.** 원장·API·화면 모두 이 셋을 구분해 싣는다. 섞어 그리지 않는다(규칙 §1).
   - **관측**: QR 스캔 또는 스테이션 도착 기록.
   - **추정**: 여정 이벤트를 위치로 번역한 것.
   - **계획**: 예약·오더상 다음 목적지.
   - 화면 약속: 관측 = 실선·채운 점 · 추정 = 점선·빈 점 + "추정" 표식 · 계획 = 화살표 끝 흐림 · **모름 = 그리지 않음**.
2. **기하에도 출처가 있다.** `GRID_AUTO`(지금 전부) / `DRAWING_DRAFT`(판독 초안) / `DRAWING_CONFIRMED`(사람 확정) / `SURVEYED`(실측).
   - 🔴 **길안내·걸음 시간 계산은 `DRAWING_CONFIRMED` 이상에서만** 한다. 그 아래에서는 텍스트 위치만 보이고, "도면 미확정"이라고 말한다.
3. **층·방 위치의 정본은 `SpaceNode` 하나다.** `ROOM_MAP`·`CheckupStation.location`·`Equipment.location`·`facility-info` 는 SpaceNode 를 참조하도록 바꾼다. 텍스트 사본은 표시 캐시일 뿐이다(규칙 §2).
4. **판독 결과는 초안이다**(초안≠확정 · 출처 `AI`/`UNAVAILABLE` 두 가지 · **FALLBACK 없음** — 판독에 실패하면 격자로 채우지 않는다). 증빙 판독(`evidence-extract.service.ts`)의 틀을 재사용한다.
5. **3D 는 보조 뷰다.** 2D 평면도가 정본 화면이다.
   - WebGL 이 없거나, 저사양 단말이거나, 전광판이거나, 스크린리더를 쓰면 2D 로 그린다.
   - 3D 전용 정보는 두지 않는다.
6. **혼잡도·점유율에는 분모를 함께 적는다.** `capacity` 미설정이면 회색 "산출 불가"이고, 0% 로 그리지 않는다(규칙 §1·§7).
7. **위치 정보는 민감 정보다.**
   - 환자 식별은 기존 `entityId = p-<MRN>` 규약을 따른다. 3D 뷰에 이름을 띄우지 않는다.
   - 환자 궤적 조회는 AuditLog 에 `resourceId=patientId` 로 남긴다(감사 규약).
   - `PatientLocToken` 위치 동의가 없는 환자의 **관측 위치는 기록되지 않는다**. 이는 기존 동작이며, 화면에 "동의 없음 N명"을 분모로 적는다.
8. **추천은 제안이다.**
   - 다음 스테이션·경로는 "실행 제안" 관계 모드다. 직원이 무시할 수 있고, 무시는 기록한다.
   - 자동으로 환자를 호출하지 않는다(자동실행 기본 금지).

---

## 5. 단계별 기능

### P0 — 공간·위치 정본화 (3D 의 선행 조건 · 스키마 변경 포함)

| # | 작업 | 대상 |
|---|------|------|
| P0-1 | `PatientLocation.source` 추가(`OBSERVED_QR`·`OBSERVED_STATION`·`INFERRED_EVENT`·`MANUAL`) — 기존 행은 `eventType='QR_CHECKIN'`→`OBSERVED_QR`, 그 외→`INFERRED_EVENT` 로 **파생 백필**(추정 금지 규칙과 충돌 없음: 출처 판별은 기록된 사실에서 파생) | schema · `journey.service.ts` · `patient-flow.service.ts` |
| P0-2 | 추정 매핑의 후보가 여럿이면 `findFirst` 를 쓰지 않는다 — 층까지만 알면 **층 단위 위치**(구역 미상), 층도 모르면 기록하지 않음 | `journey.service.ts:60~66` |
| P0-3 | 추정 경로도 이전 구역을 닫을 때 `duration` 을 채움(QR 경로와 한 함수로) — 닫기 로직 정본 하나 | 두 서비스 |
| P0-4 | 검진 스테이션 도착/완료 → `OBSERVED_STATION` 위치 기록(F6) — `CheckupStation.spaceNodeId` 연결 필요 | checkup · schema |
| P0-5 | 층·방 정본 수렴(F3): `CheckupStation.spaceNodeId`·`ClinicRoom`(→ §6 신규) · `ROOM_MAP` 제거 후 SpaceNode 조회 · facility-info 는 SpaceNode 트리에서 렌더 | portal · checkup · facility-info |
| P0-6 | `getNextStation` 수정: 당일(`dateOnlyValue` 기준) 필터 · 공복 우선 규칙 반영 · 포털 추천과 **정본 하나**로 합침(shared 순수 함수) | checkup-station · portal |
| P0-7 | `floor.service.ts` 의 빈 catch 2곳 → warn + 센티널 파이프 생존 지표에 "동선 SSE 발행 실패 수" | floor · sentinel |
| P0-8 | `bounds` 기본값 `{0,0,4,3}` 폴백 제거 — 좌표 없음은 `null` + 화면 "배치 미정" 목록 | floor.service · simulator/metaverse 화면 |
| P0-9 | `SpaceNode.metadata.geometrySource` 도입, 기존 전부 `GRID_AUTO` | seed-floor-metadata · API 응답 |

#### §5-P0 결과 (2026-09-28 구현 · 마이그레이션 `20260928000002_location_source_station_space`)

| # | 결과 | 비고 |
|---|------|------|
| P0-1 | ✅ `PatientLocation.source`(DB 기본값 없음 — 쓰는 코드가 밝혀야 컴파일) · shared `LOCATION_SOURCES` 6 · 백필은 기록된 사실에서만(QR_CHECKIN·demo·event_type·그 외 UNKNOWN) | 메타버스·층 API 응답에 `source`/`locationSource` 추가(계약 **추가만**) |
| P0-2 | ✅ 후보 1=구역 · 여럿·한 층=층 노드(`granularity: FLOOR`) · 층도 갈리면 기록 안 함 | 층 API `patientsZoneUnknown` 로 수를 숨기지 않는다 |
| P0-3 | ✅ 쓰기 단일 경로 `FloorService.recordLocation`(트랜잭션 · 열린 위치 전부 닫고 체류 분 채움) — QR·여정·검진 스테이션 | 트랜잭션 밖 다중쓰기 199→198 |
| P0-4 | ✅ 검진 스테이션 도착 → `OBSERVED_STATION`(공간 연결 시만) · `ck_stations.space_node_id` + 연결 화면(`/admin/space-assets` 스테이션 칸) | 🔴 스테이션 설정을 **고치는 화면이 원래 0곳**이었다(PUT 호출 0) |
| P0-5 | ✅ 포털 `ROOM_MAP` 층·위치 텍스트 제거(공간 연결에서만 · 미연결=`null`→앱 "위치 미등록") · 스테이션 조회 실패 `.catch(()=>[])` 봉합 · 장비 시드 층 텍스트(수술실 3층→1층·영상 1층→2층) | ✅ 잔여분(09-28 2차): `ClinicRoom`(진료 스케줄 `roomName` 원문 ↔ 공간 · 이름 일치는 **후보만** · QR 대기표 `roomLocation`) · 시설 안내 '층 구성'(전 직원 `metaverse/directory` — 이름만) · 🔴 예시 `FLOORS` 는 결정 `policy.facilityInfo.floorGuide` 대기라 지우지 않고 '공간 모델과 다를 수 있다' 표기 |
| P0-6 | ✅ shared `checkup-routing.ts` 정본(순서 규칙 이관·`rankNextStations`) — 워크스테이션·환자 앱 같은 규칙 · 오늘 도착·미완료만 | 이동 거리는 넣지 않았다(격자 거리=지어낸 값 · P1 이후) |
| P0-7 | ✅ 빈 catch 2곳 → warn · 감시자 펄스 `location.observedRatio`(열린 위치 중 관측 비율·분모 병기·시뮬 제외·급락 감시) | 🔴 기획의 '발행 실패 수'는 **불가** — SSE 발행은 API 프로세스 메모리 안의 일이라 별도 프로세스인 감시자가 볼 수 없다(warn 로그만) |
| P0-8 | 🟡 **조정**: 폴백 값은 계약(clinic-floor 문서가 폴백을 약속)대로 두고 출처를 **추가** — `boundsSource`·`doorSource`·`distanceSource`(RECORDED·WALK_TIME_MIN·EUCLID_FALLBACK) | 폴백 제거는 외부 점검가 필요한 사람 결정 |
| P0-9 | ✅ `metadata.geometrySource`(격자 시드가 `GRID_AUTO` 표식 · 마이그레이션이 bounds 보유 노드에 파생 표식) | |

**P0 잔여 운영 반영(09-28 · `53cbaa136`)**: `clinic_rooms` 추가만 적용 · 운영 진료실 이름 30 · 연결 0 · 이름 일치 후보 7(사람이 연결 — 연결 전 QR 대기표는 층 없이 이름만) · 감시자 펄스는 표본 축적 중(열린 위치 10건 미만이면 산출 안 함)

**자산 편집 화면 수렴(09-28 2차)**: 실측하니 위치를 **수정**하는 화면은 워크스테이션 관리 하나뿐(장비·검사장비·보관·약제기기는 등록 폼만 · 투석기·서명 태블릿·단말은 화면 0) → 워크스테이션 목록에 공식 위치(원장) 표시 + 위치 칸을 '메모'로 명시.
등록 폼의 자유 텍스트 위치는 남는다 — 등록 권한(ADMIN_STAFF·PHARMACIST 등)과 원장 쓰기 권한(ADMIN)이 달라 폼에서 원장에 쓰게 하려면 D9(조회·쓰기 개방) 결정이 먼저다.
남은 소비처: 전광판(`ClinicQueueBoard`)·음성 호출(TTS)·환자 푸시 문구는 진료실 이름만 쓴다 — 층 안내를 붙이는 것은 P3(길안내)와 함께.

**P0 중 새로 찾아 고친 것**: 메타버스 히트맵이 정원 미설정 구역을 **정원 10 으로 지어냈다**(`capacity ?? 10` → null·UNKNOWN·"정원 미설정") ·
격자 시드가 모든 구역에 **걸음 3분을 지어내** 토폴로지 거리로 쓰였다(시드 수정 · 기존 DB 값은 사람 입력과 구분 불가라 코드로 교정하지 않음 — 응답이 `WALK_TIME_MIN` 으로 밝힌다) ·
시뮬레이터가 실제 환자 id 로 실원장에 쓰던 이동을 `SIMULATED` 로 표식(격리는 P4 선행 과제로 남음).

**운영 반영(2026-09-28 · `88ccb3997`)**: 마이그레이션을 **두 단계로** 적용 — ① nullable 추가+백필(구 API 가 source 없이 쓰는 동안 깨지지 않게) ② 신 API 배포 후 창 사이 행 재백필(0건)→`NOT NULL` · 운영 diff 는 기존 드리프트 2줄만 남음(미적용 유지)
· 실측: 위치 378 = 추정 281·시뮬 75·미상 21·**QR 관측 1** · 현재 위치 33 **전부 추정**(관측 0) · 2층 동선 간선 18 **전부 걸음 3분(시드 날조)**·좌표 전부 `GRID_AUTO` · 검진 스테이션 6/11 공간 연결(나머지 5 는 공간 모델에 구역 없음 — 미연결=위치 미등록)

**검증**: 신규 P0 17 + shared 4 · 재주입 7종 전부 실패 확인(첫 주입은 문법 오류로 수집 실패 → 다시 주입해 확인) · 기준선 하향 3(삼킴·트랜잭션·마이그레이션 목록) · 저장 기본값 1 은 기준선을 올리지 않고 호출자 필수로 제거

🔴 P0 는 시드 생성기도 함께 고친다. 시드가 `ROOM_MAP` 사본이나 격자 기하를 다시 만들면 되살아난다(CLAUDE.md 함정 4).

### P1 — 도면 판독 → 공간 그래프 초안 → 사람 확정

**흐름**
```
관리자: 층 평면도 업로드(PNG/JPG · PDF 는 서버에서 페이지별 래스터화)
  → 축척 보정: 도면 위 두 점을 찍고 실제 거리(m) 입력 (사람 — 판독이 축척을 지어내지 않음)
  → 판독(초안): 방 폴리곤·이름 텍스트·문·복도 중심선·엘리베이터·계단·경사로·출입 통제 표시
  → 편집기(2D SVG 오버레이): 초안을 도면 위에 겹쳐 보여주고 사람이 수정·병합·삭제
     · 방 ↔ 기존 SpaceNode 매칭 제안(이름 유사도) — 자동 확정 없음
     · 판독이 못 읽은 영역은 "미판독"으로 비워 둠
  → 확정: geometrySource=DRAWING_CONFIRMED, 확정자·시각·도면 해시 기록
  → SpaceEdge 그래프 생성(거리 = 복도 중심선 길이 × 축척)
```

**판독 수행자 — 두 갈래(§9 D1 사람 결정)**
- **(a) 개발 시점 판독 — 지금 가능, 추천 착수점**
  - 병원이 도면을 개발팀에 제공한다. Claude Code 가 도면 이미지를 읽어 **가져오기 JSON 초안**(`space-import.v1` 스키마, §6)을 만든다.
  - 그 초안은 편집기에서 사람이 확정한다.
  - 런타임 외부 송신이 없다. 결과물은 저장소 리뷰를 거친다.
- **(b) 런타임 판독**
  - 서버의 `SpaceDrawingExtractService` 가 판독 제공자를 호출한다. 제공자는 두 후보 중 사람이 고른다.
    - ① WeRU.B 비전(llava/MedGemma): 도면 판독 품질이 미측정이다.
    - ② 외부 Claude API: 신규 egress 호스트 · 설정 `space.drawingExtract.provider` 기본 `NONE` · 승인 필요.
  - 증빙 판독과 같은 틀을 쓴다: 기본 OFF · 초안만 · `AI`/`UNAVAILABLE`.
- 🔴 (a) 만으로도 P2~P4 는 전부 진행할 수 있다. (b) 는 도면이 자주 바뀌는 병원(리모델링)이나 다기관 배포 때 필요하다.

**판독 품질 수용 시험(§8)을 통과하기 전**에는 판독 결과를 "초안"으로도 편집기에 넣지 않는다. 이 게이트는 "N건 중 M건 일치"를 분모와 함께 보여준다.

#### §P1 결과 (2026-09-28 구현)
- **판독 수용 시험** `docs/04-report/space-drawing-read-2026-09-28.md` — 생성기·정답을 모르는 새 에이전트 3개(Opus 5.5)에 PNG 한 장씩:
  방 재현 100%(145/145)·IoU≥0.9 99% · 문 재현 78~90%·정밀 100%(만든 문 0) · 놓친 문 21 은 **빗금·계단 디딤판·엘리베이터 기호가 문 호를 가린 자리**.
  🔴 면적이 인쇄된 깨끗한 합성 벡터 도면이다 — 실제 CAD·스캔 정확도가 아니다 · 합격선은 D3(사람).
- **가져오기 파이프라인**: `SpaceImport`(마이그레이션 `20260928000004`) · `api/v1/space/imports`(올리기·확정·반려 — ADMIN) · `GET api/v1/space/geometry`(전 직원 — 방·문뿐) · 화면 `/admin/space-model`(3414)
  - 검증은 **코드·값**으로 저장(서버 조립 한국어 금지 — 가드가 잡아 고쳤다) · 오류 있으면 확정 불가(서버 재검증) · 경고(도면에 없는 구역)는 확정 허용
  - 확정 = 매핑 노드에 `rect`·기하 출처 · 이전 확정본 SUPERSEDED·좌표 회수 · 🔴 `SYNTHETIC` 은 REAL 에서 올리기·확정 모두 거부
- 계획과 다르게 한 것: 동선 그래프는 `SpaceEdge` 테이블 대신 **확정본 payload 안에** 둔다(노드가 공간이 아니라 문·복도 지점이라 SpaceNode 로 옮기면 공간 트리가 오염된다) · 도면에만 있는 공간(화장실·복도·306호 등)은 SpaceNode 를 만들지 않고 기하에만 둔다
- 런타임 판독(P1-b · 외부 모델 호출)은 D1 결정 전이라 만들지 않았다

### P2 — 2.5D/3D 동선 뷰어 (관리·운영 화면)

- **라이브러리**: `three` + `@react-three/fiber` + `@react-three/drei`. Next 15 에서 `dynamic(() => import(...), { ssr:false })` 로 불러 3D 번들을 분리한다.
  - 🔴 **React 19 호환을 먼저 확인한다**(web `react ^19.1.0` — `react-grid-layout` 이 React 19 에서 실패한 이력 [[feedback_rgl_react19]]).
  - 번들 예산: 3D 청크는 gzip 기준 상한을 두고 CI 에서 측정한다(수치는 착수 시 실측 후 정함).
- **장면 구성**
  - 층 슬래브를 쌓고 방은 폴리곤을 돌출시킨다. 층 간 간격은 조절할 수 있다.
  - 층을 "펼치기"(분해도)하거나 "한 층만"(나머지 반투명) 볼 수 있다.
  - 엘리베이터·계단은 층을 잇는 기둥으로 그린다.
  - `GRID_AUTO` 층은 **평면 상자만** 그리고 워터마크 "배치 미확정 — 실제 도면 아님"을 붙인다(F2 를 숨기지 않음).
- **레이어**(토글, 기본은 관측만)
  1. 현재 위치: 관측 점과 추정 빈 점. 추정은 기본 OFF 이고, 켜면 범례에 "이벤트로 추정한 위치"를 적는다.
  2. 혼잡도: 구역 점유 ÷ capacity 로 색칠한다. 분모가 없으면 회색 빗금 + "정원 미설정".
  3. OD 흐름: `floor/flows` 의 건수와 p90 을 두께와 색으로 그린다. 표본 n<5 인 흐름은 흐리게 그리고 수치를 숨긴다.
  4. 체류 병목: `journey-analytics` 의 단계 지연을 공간에 투영한다. 공간 축이 연결된 단계만 그린다.
  5. 개별 궤적: 환자를 지목해야 볼 수 있다. 감사가 남는다. 관측·추정 구분은 선 모양으로 한다.
- **시간 슬라이더**: 하루를 재생한다. 🔴 재생은 기록된 시각만 쓰고, 이동 중 위치를 보간하지 않는다. 구역 사이는 "이동 중"으로만 표시한다. 보간하면 복도에 있지도 않은 환자를 그리게 된다.
- **2D 정본 화면**: 같은 데이터를 SVG 평면도로 그린다. `/metaverse` 와 `/simulator` 의 CSS 그리드를 이것으로 교체한다. 3D 는 이 화면의 탭이다.
- **개발 시점 시각 검수**: 뷰어를 헤드리스로 렌더해 스크린샷을 찍고, 모델이 스크린샷을 판독해 범례·표식·워터마크가 보이는지 확인한다. 이는 보조 수단이며, 판정 테스트는 DOM·데이터 계약 테스트로 한다.

#### §P2 결과 (2026-09-28 구현)
- 부품 `components/space/` — `FloorPlanSvg`(2D 정본: 방·문·출입구·통제 문 · 환자 관측=채운 점/추정=빈 점선 점(기본 꺼짐) · 혼잡도(정원 미설정=회색 빗금) · 자산 수(관리자) · 합성 워터마크)
  · `FloorStack3D`(CSS 3D 적층 — 드래그 회전·기울이기 · 모든 층 같은 틀로 그려 코어 정렬) · `SpaceViewer`(층 레일·도구 막대·정보 패널·범례)
- 🔴 three.js 대신 CSS 3D — 새 의존성은 서버 `npm ci`(사람 허가 대기)가 필요하고 배포 스크립트가 설치하지 않는다 · 3D 전용 정보 없음(보조 보기)
- `/metaverse` 재구성: 지표 4(현재 위치 환자 관측·추정·구역 미상 / 관측 비율 `<Ratio>` / 혼잡 구역·정원 미설정 / 도면 규모) · 탭(도면 뷰어 기본·환자 목록 관측 필터·혼잡도·구역 격자='도면 아님' 명시)
- 백엔드: REAL 로 전환된 뒤 남은 합성 확정본은 기하로 내려보내지 않음 · **확정 철회**(`POST imports/:id/withdraw` — 좌표 회수·WITHDRAWN · 되돌릴 수 없는 확정을 두지 않는다)
- 운영: 합성 도면 v1 을 REHEARSAL 에서 확정(공간 노드 63 SYNTHETIC)

### P3 — 환자·보호자 길안내 (포털·모바일·QR 안내·키오스크)

- **경로 계산**: `SpaceEdge` 그래프에서 다익스트라로 계산한다. shared 순수 함수이고 서버와 앱이 같은 함수를 쓴다.
  - 선택 조건: `accessible=true` 간선만(휠체어·유모차 → 엘리베이터와 경사로) · 계단 제외 · 출입 통제 구역 제외.
  - 출력: 단계 문장("엘리베이터로 3층 → 오른쪽 복도 20m → 초음파실") + 2D 평면도 하이라이트 + 예상 걸음 시간.
  - 걸음 시간의 보행 속도는 config 로 두고, 미설정이면 시간을 표시하지 않는다.
- **노출 조건**: 출발·도착 층이 모두 `DRAWING_CONFIRMED` 일 때만 경로를 보인다. 아니면 지금처럼 텍스트 위치만 보이고 "상세 길안내 준비 중"이라고 적는다.
- **출발점**: 환자 기기는 자기 위치를 모른다(BLE·RTLS 없음). 출발점은 다음 순서로 정한다.
  - ① 방금 스캔한 QR 스테이션 ② 사용자가 고른 현재 위치 ③ 모름 → "현재 위치를 선택하세요".
  - 추정 위치를 출발점으로 쓰지 않는다.
- **접점**
  - `guide/[id]`: 대기표 QR 에 경로를 추가한다.
  - 모바일 `OutpatientCard`: "진료실로 이동해주세요" 옆에 경로를 붙인다.
  - `CheckupCard.nextRecommended`: 추천 스테이션 경로를 붙인다.
  - 키오스크 영수증: 약국·수납 경로를 붙인다.
  - 모바일은 `react-native-svg` 라는 신규 의존성이 필요하다. 🔴 서버 `npm ci` 가 09-13 이후 미실시다. 배포 스크립트가 새 의존성을 깔지 않는다 [[feedback_deploy_npm_dep]].
- 3D 는 환자 화면에 쓰지 않는다. 저사양 단말·고령 사용자·접근성 때문이다. 2D 평면도와 문장으로 안내한다.
- 다국어: 경로 문장은 i18n 영역 카탈로그에 등재한다. 방 이름은 SpaceNode 에 다국어 필드를 둘지 사람이 결정한다(§9 D6).

#### §P3 결과 (2026-09-28 구현)
- 정본 shared `space-route.ts` — `buildRouteGraph`(확정본 층 간선+수직 연결) · `findRoute`(다익스트라 · 휠체어=엘리베이터만 · 통제 간선은 직원만) · `describeRoute`(구조화 단계 START/WALK/VERTICAL/ARRIVE + 층별 경로 점 · 연속 엘리베이터 한 단계)
  · 수직 이동 비용은 **선택용 가중치**(시간 아님 — 걸음 시간을 지어내지 않는다) · 문장은 화면(`RouteSteps`)이 조립
- API `GET /api/v1/space/route`·`/entrances`(직원) · 공개 `GET /api/v1/guide/:queueId/route`(대기표 검증 먼저 · 진료실 공간 연결 시만 · 통제 구역 통과 금지 · 못 구하면 이유만)
- 화면: QR 대기표 '진료실까지 길 안내'(출발 출입구·휠체어 · 경로 주변 확대 평면도) · 도면 뷰어 '길찾기' 패널(2D·3D 경로선)
- 실측(합성 도면): 주출입구→내과 1진료실 휠체어 97m(EV2)·일반 47m(에스컬레이터) · 비통제 매핑 구역 전부 휠체어 도달 · 수술실은 직원 경로만
- 🔴 운영에서 환자 길안내가 뜨려면 진료실 ↔ 공간 연결(사람 몫 · 후보 7)이 먼저다 · 모바일 앱은 SVG 의존성이 없어 이번 범위 밖(문장 단계만 가능)

### P4 — 운영 최적화 (공간을 아는 추천·분석)

- **검진 다음 스테이션 v2**(P0-6 정본 위에서 계산)
  - 점수 = 당일 대기 × 평균 소요 + 이동 시간(SpaceEdge) + 순서 규칙 위반 벌점(공복 채혈 우선·내시경 후순위).
  - 화면에 **근거 항목을 분해해 보인다**("대기 3명×8분 + 이동 2분"). 가중치는 config 이며, 기본값을 정책인 척하지 않는다(미설정이면 이동 항목 제외라고 명시).
- **공간 병목 분석**: 구역별 체류 p50/p90, 구역 간 이동 p90, 병목 순위를 낸다. 관측 표본만 쓰고, 추정은 별도 열에 둔다. 🔴 관측 표본이 0 인 구역은 "산출 불가"다.
- **배치 가정 시뮬레이션**: "채혈대 1개 추가", "초음파실을 2층으로" 같은 가정을 시뮬레이터로 돌린다.
  - 🔴 결과에 "시뮬레이션" 표식을 달고, 실적 원장에 쓰지 않는다(P16). 지금 시뮬레이터는 `journey.emit` 을 실제로 타므로 **실원장을 오염시킨다** — 시뮬레이션 격리가 선행 조건이다.

#### P4a 결과 (2026-09-28 · 검진 추천 이동 거리)

- 🔴 **기획을 실측이 고쳤다** — 초안의 "대기×평균 + 이동 시간" 점수는 걸음 속도를 지어내야 성립한다(정해진 값이 없다). 그래서 **거리를 시간으로 바꾸지 않고**, 정렬의 4번째 기준(순서 → 대기 → **거리** → 키)으로만 쓴다. 대기가 1명 다르면 300 m 떨어진 방이 이긴다(테스트로 못박음).
- 출발점 = **마지막으로 완료한 스테이션의 공간**(환자의 관측 위치가 아니다 — 관측 0 이라 쓸 수 없다). 거리 = 확정 도면 경로 걷기 m(수직 이동 제외·통제 구역 제외) · 정본 `SpaceModelService.walkDistances`.
- 모르면 없다: 확정 도면 없음·REAL 에서 합성 도면·도면에 없는 공간·출발 미상 → `distanceM: null` · 화면은 그리지 않는다.
- 배선: 워크스테이션 `getNextStation`·포털 검진 여정(두 추천이 같은 정본 `rankNextStations`) · 표시 = 워크스테이션 `NextStationGuide`·모바일 `CheckupCard`.
- 테스트 `apps/api/test/space/p4-checkup-distance.spec.ts`(재주입: 거리 비교 삭제 → 2 실패 · 최근 완료 정렬 삭제 → 2 실패).

#### P4b 결과 (2026-09-28 · 구역 체류 분석)

- EP `GET /api/v1/metaverse/dwell?days=1~90`(임상 3역할 — 환자 식별 없음) · 화면 = 메타버스 '체류 분석' 탭.
- 떠난 시각이 있는 구역 단위 체류만 · p50/p90(분, PG `percentile_cont`) · **관측(QR·스테이션·직원 입력)과 추정(이벤트 번역)을 다른 열**로 — 추정의 "체류"는 이벤트 간격이라 병목 순위에 쓰지 않는다.
- 표본 < `DWELL_MIN_SAMPLE`(5, shared) → 값 대신 "표본 부족 n/5" · 시뮬레이션·출처 미상·층 단위 행은 **빼고 뺀 수를 함께** · 시각 역전 행은 고치지 않고 따로 센다.
- 🔴 운영 현재 관측 0 → 전 구역이 "표본 부족"으로 보이는 것이 정답이다(QR 스테이션 운영 전). 병목 순위 0곳.
- 백분위 실측: 로컬 PG 트랜잭션에 10·20·30·40·50분 표본 → p50 30·p90 46(롤백) · 테스트 `apps/api/test/space/p4-dwell.spec.ts`(재주입: 최소 표본 검사 삭제 → 실패 · 순위를 추정 p90 으로 → 실패).
- 배치 가정 시뮬레이션은 **착수하지 않았다** — 시뮬레이터가 실원장(`journey.emit`)을 타는 문제(격리)가 선행이다.

#### 3D 자산 배치 편집 (2026-09-28 · 사용자 요청 "더 세련된 기능과 아이템 배치")

- 실측: 운영 자산 85·배치 0 · '자산 배치' 토글을 켜도 3D 에는 자산이 그려지지 않았다(3D 뷰어가 자산을 받지 않았다).
- 3D 자산 모형(그룹별 모양·강조색 · 보기용 1.25배) · 가리키기 이름표 · 선택 고리 · 더블클릭/자산 선택 시 카메라 접근.
- 배치 편집 패널 `components/space/AssetPlacementPanel.tsx`(관리자) — 미배치 목록(종류·검색·후보 수) → 배치 중 후보 방 노란 강조(제안 · 자동 배치 없음) → 방 클릭 → 확인 → `POST /api/v1/space-assets/placements` · 선택 자산 옮기기(같은 EP — 서버가 이전 배치를 MOVED 로 닫는다) · 종료(`…/:id/end` · 사유 2자 이상) · 자체 테이블 자산(NATIVE)은 읽기만.
- 🔴 좌표: 서버는 확정 도면(DRAWING_CONFIRMED·SURVEYED) 구역에서만 x·y 를 받는다 — 합성 도면이면 화면이 좌표를 보내지 않고 방 단위로 기록, 3D 방 안 정렬이 실제 위치가 아니라고 말한다. 확정 도면이면 누른 지점(평면 좌표 환산)을 보낸다.
- 순수 함수 `arrangeInRoom`·`placeAssetMarkers`(좌표 있으면 그 지점 · 없으면 정렬 · 도면에 없는 공간은 그리지 않음) · 테스트 `space-scene.spec.ts`(재주입: 합성에도 좌표 전송 → 실패 · 좌표 배치를 정렬로 → 실패).

#### three.js 3D 뷰어 (2026-09-28 · 사용자 설치 허가)

- 장면 기술자(순수 함수) `components/space/space-scene.ts` — 방 바닥·**절단 벽**(닫힌 방 경계만 · 공유 변 한 번 · 외곽선 위 변은 외벽이 대신)·문 틈(도면의 DOOR·EXTERIOR 자리에 그 문 폭만큼 · 🔴 폭 0 이면 틈 없음 — 지어낸 0.9m 로 벽을 뚫지 않는다)·층 높이(선택 층 위만 분해). 테스트 `apps/web/test/ui/space-scene.spec.ts`(재주입: 폭 0 문을 0.9m 로 → 실패 · WebGL 폴백 삭제 → 실패).
- 렌더러 `FloorStackWebGL.tsx` — three + OrbitControls + CSS2DRenderer(방·층 이름표 · 화면 좌표 겹침 정리) · 그림자(PCFSoft) · 방 클릭 선택(끌기와 구분 5px) → 2D 와 같은 정보·길찾기 패널 · 경로 관·출발/도착 구.
- `SpaceViewer` 는 `next/dynamic`(ssr:false)로 불러 three 가 3D 를 열 때만 내려온다(로컬 `next build` 확인 — 별도 청크 약 570KB).
- 🔴 정직: 벽 높이는 보기용 절단 높이라고 화면이 말한다 · WebGL 을 만들 수 없으면 CSS 3D 로 떨어지고 그 사실을 말한다 · 합성 표식 유지 · 관측/추정 모양 구분.
- 서버 의존성: `deploy.sh --install-deps`(lockfile 지문 불일치 → `npm ci`) — 서버 lockfile 이 8월판이라 모바일 누적분 422개도 함께 맞춰졌다.

#### 뷰어 표현 재구성 (2026-09-28 · 사용자 피드백 "세련되게 그려지지 않았다")

- 확인 방법: 운영 확정 기하(`/api/v1/space/geometry`)를 받아 부품(`FloorPlanSvg`·`FloorStack3D`)만 esbuild 로 묶은 로컬 하네스(`127.0.0.1`)를 브라우저로 열어 전·후를 눈으로 비교(운영 로그인은 대신하지 않는다).
- 전: 파스텔이 옅어 방 구분이 약함·벽이 머리카락 두께·방 이름 과소·환자 점이 안 보임·워터마크가 도면 한가운데를 덮음 / 3D 는 두께 없는 투명 종이 겹침·맨 위층 잘림·층 이름 없음·위층이 선택 층을 가림·위층이 작아도 틀 전체가 흰 판.
- 후: 범주 8색(정본 `SPACE_CATEGORY_STYLE` — 범례도 같은 값) · 벽 굵기 층위 · 흰 테두리 두 줄 이름(작으면 숨기고 마우스를 올리면 이름) · 코어 빗금+기호 · 혼잡도는 범주 위 덧칠(방 종류를 지우지 않는다) · 3D 는 층 외곽에 맞춘 두께 판·선택 층 발광·위층 분해·시점 프리셋·선택 층 중심.
- 🔴 정직 표기는 그대로다: 합성 표식은 **지우지 않고** 모서리 띠+옅은 글자로 옮겼다 · 관측/추정 점 모양 구분 · 정원 미설정 빗금.
- WebGL 은 여전히 쓰지 않는다(새 의존성 = 서버 설치 사람 허가) — CSS 3D 의 한계: 층판 사이 조명·그림자는 흉내뿐이다.

#### 시뮬레이터 원장 격리 (2026-09-28 · 배치 시뮬레이션의 선행)

- 🔴 실측한 결함 두 가지:
  - ① `start()` 가 `patientLocation.updateMany({ where: { leftAt: null } })` 로 **모든 환자의 현재 위치를 닫았다** — 시뮬레이션을 누르는 순간 실제 환자의 "지금 어디 있나"가 사라진다.
  - ② 실제 환자 id(시드 30명·입원 환자)로 `journey.emit` 을 호출해, 접수·입원·퇴원·수술 시작 같은 가짜 이벤트를 **그 환자의 여정 원장**에 발행했다. 환자 타임라인·환자 앱·여정 관제가 이 원장을 읽는다.
- 운영 피해는 확인할 수 없었다. 여정 이벤트 2,383건 중 `simulated` 표식은 0건이다(표식은 이날 생겼다). 시뮬레이터에만 있는 제목('수납 완료 → 약국'·'검사 의뢰')도 0건이다. 공통 제목은 시드도 쓰기 때문에 가려낼 수 없다. **데이터는 고치지 않았다.**
- 지금 시뮬레이터는 **메모리에서만** 돈다. 실원장에는 아무것도 쓰지 않는다.
  - 가상 환자는 `SIM-001` 식별자로 만든다(실제 환자를 빌리지 않는다).
  - 입원 현황은 병동 점유만 읽고 환자 신원은 읽지 않는다.
  - 상태에 `writesLedger:false` 를 담고, 화면이 그 사실을 알린다.
- 같은 화면에서 추가로 찾은 결함: '플로어맵' 탭의 조회 4개가 전부 응답 모양과 어긋나 있었다. 서버는 `{floors}` 로 감싸 주는데 화면은 배열로 읽어 **탭을 열면 `floors.map` 에서 터졌다**. 통계는 JSON 을 그대로 찍었고, "시뮬레이터를 시작하면 층이 자동 생성된다"는 문구도 사실이 아니었다(층은 공간 정본에서 온다).
  - 교정: 위치는 관측/추정으로 구분해 그리고, 정원(서버가 미설정을 1 로 둔다)은 그리지 않는다.
  - 기능 삭제 방지 메모(플로어맵 FE 는 과거 삭제 후 복원된 기능)에 따라 탭을 지우지 않고 고쳤다.
- 테스트:
  - `test/simulator/simulator.service.spec.ts` — 프록시 prisma 로 `admission.findMany` 외의 모든 접근을 잡는다. 재주입 두 가지(위치 일괄 종료를 되살림 → 4 실패 · 환자 신원 select → 3 실패)로 확인했다.
  - `floor-tab-contract.spec.ts` — 재주입(배열 읽기로 되돌림 → 실패)으로 확인했다.

### P5 — 감염 접촉자 후보 (위치 겹침)

- 지표 환자의 관측 위치 구간과 같은 구역·겹치는 시간에 있던 환자를 **후보 목록**으로 뽑는다.
- 추정 위치 겹침은 별도 등급으로 두고 기본적으로 숨긴다.
- 위치의 해상도는 구역 단위다. 같은 대기실이라도 거리는 모른다고 화면에 명시한다.
- 확정은 감염관리실이 하며, 기존 `InfectionSurveillance` 수동 입력 경로로 이어진다. 자동 통보는 없다.

#### P5 결과 (2026-09-28 · 위치 겹침 접촉자 후보)

- EP `GET /api/v1/infection-control/contact-candidates?patientId&days=1~30&includeInferred`(**관리자 전용**) · 화면 = 감염관리 목록의 '접촉자 후보' 버튼 → 패널(관리자에게만 버튼).
- 🔴 설정 **두 개 모두 기본 OFF**: `infection.contactCandidates.enabled`(꺼지면 DB 를 읽지 않고 "조회하지 않았다"고 말한다) · `…includeInferred`(켜져야 추정 겹침을 별도 등급으로 요청할 수 있다). 결정 `infection.contactCandidates` 는 두 설정을 함께 바꾸므로 자동 집행을 걸지 않았다.
- 겹침 = 지표 환자의 떠난 시각이 있는 구역 단위 구간과 **같은 구역·겹친 시간**의 다른 환자 구간 · 등급 OBSERVED(양쪽 관측)/INFERRED(한쪽이라도 추정) · 관측 먼저 → 겹친 시간 순.
- 🔴 "후보 0" 과 "지표 환자에게 쓸 수 있는 구간이 없음"을 가른다 — 지표 구간 수(관측·추정·제외 사유별)를 함께 낸다. 운영 현재 관측 0 이라 켜도 대부분 후자로 보인다.
- 후보 조회는 쓰기 없음(확정·격리·통보 없음).
- ✅ (2026-09-28 후속) **후보 → 접촉자 등록**: 행마다 '접촉자로 등록' → 관계·위험도·보호구(초기값 전부 미선택 · 보호구 '모름' 선택지) → 기존 `POST contact-traces`. 겹친 시각·시간은 후보에서, 메모에 출처(관측/추정·구역) · 이미 등록된(미해소) 후보는 '등록됨'.
  - 🔴 기존 등록 경로에서 고친 것: 보호구 미입력을 `PPE: No`(착용 안 함)·위험도 미입력을 `Risk: undefined`·시간 미입력을 `0min` 으로 적었다 → `UNKNOWN`/`UNSPECIFIED` · 같은 접촉자·같은 감염 미해소 건이 있으면 409 `CONTACT_ALREADY_REGISTERED`(중복 생성 없음) · 일괄 등록이 실패를 `catch {}` 로 삼키던 것 → `failed[{contactPersonId, reason}]`.
  - 접두사 `Contact Exposure: ` 는 `InfectionControlService.CONTACT_TRACE_PREFIX` 하나(후보 조회도 이것을 쓴다).
  - 테스트: 서비스 스펙(재주입: 중복 거절 삭제 → 실패 · 보호구 UNKNOWN 을 No 로 → 실패) · 웹 `contact-register-row.spec.tsx`(재주입: 보호구 초기값 'NO' → 실패).
- 감사: `?patientId=` 로 환자 지목 열람 감사에 귀속(지표 환자 1행) — 🔴 응답에 실리는 **후보 환자들의 신원은 감사 행에 남지 않는다**(한계).
- 로컬 PG 트랜잭션 실측(관측 10분 겹침 1명 · 추정 허용 시 +2 INFERRED · 열린 구간 1 제외 · 롤백) · 테스트 `apps/api/test/space/p5-contact-candidates.spec.ts`(재주입: 꺼짐 분기 삭제 → 실패 · 추정 허용 설정 무시 → 실패).
- 역할×EP 스캐너: 역할 검사를 페이지에 두면 형제 조회(`stats`)까지 "게이트됨"으로 분류돼 그 대조가 빠졌다 → 검사를 패널 파일로 옮기고 조회에 `enabled: isAdmin` 명시.

### §5-A 공간 자산 배치 원장 — ✅ 구현(2026-09-28 · 미배포)

**요청**: 도면에 워크스테이션·PC·의료기기·장비의 위치를 기록·관리하고 기존 기능과 포괄적으로 연동.

**실측(착수 전)**: 자산 위치가 **14개 테이블에 제각각 자유 텍스트**(`location`)로 있고, `SpaceNode` 에 묶인 것은
QR 스테이션(`LocationStation.zoneId`) 하나뿐이었다. 시드 텍스트도 공간 정본과 어긋난다 — 장비 시드가 수술 장비 4종을
"**3층** 수술실"(SpaceNode: 수술실=1층·3층=내과병동), CT·MRI·X-ray 를 "1층 영상의학과"(SpaceNode 영상실=2층)에 둔다(F3 의 추가 증거).

**설계 — 원장 하나 + 어댑터**
- 모델 `AssetPlacement`(`asset_placements` · 마이그레이션 `20260928000001_asset_placements` — Prisma diff 와 문자 단위 일치 확인)
  - (assetKind, assetId) → spaceNodeId · x/y(nullable) · source · 배치 시점 기존 텍스트 보존 · 종료(endedAt·사유) = **이력 append**
  - 자산당 활성 배치 하나 — 부분 유니크 인덱스는 `db push` 가 DROP 하므로 **advisory lock**(`asset-placement:<kind>:<id>`)
- 어휘 정본 shared `space-asset.ts`: `ASSET_KINDS` 10종 · 원장에 **넣지 않은** 4개 테이블과 이유(`ASSET_KINDS_EXCLUDED` — 마약류 재고 논리 키·논리 스테이션·순환 멸균물·혈액 재고)
  - 의료기기: 장비(`equipment`)·검사장비·투석기·약제 자동화기기 / IT: 등록 단말(PC)·워크스테이션 프로파일·서명 태블릿·**QR 스테이션(읽기 전용 — 자기 테이블이 정본)** / 보관 장소 / 전광판 박스
- 어댑터(`asset-adapters.ts`): 원 테이블을 읽기만 · **비밀값 미적재**(전광판 API 키·단말 IP/MAC/비콘·keyHash — 단말은 UUID 끝 6자리만)
- 🔴 **기존 텍스트를 덮어쓰지 않는다** — 다른 모듈의 쓰기 경로와 갈라지므로 "텍스트 다름"(느슨한 대조: 이름 토큰·실번호·코드)으로 드러낸다
- 🔴 좌표는 `DRAWING_CONFIRMED`/`SURVEYED` 구역 경계 안에서만 — 지금은 확정 도면이 없어 **구역 단위만** 기록된다(화면이 그렇게 말한다)
- 미배치 목록: 기존 텍스트 → 후보 공간(근거 코드 `NAME`·`NAME_PART`·`ROOM_NUMBER`·`FLOOR`) — **제안만, 자동 배치 없음**
- 출처(`source`)는 호출자가 밝힌다 — 서버 기본값 `MANUAL` 을 두지 않는다(가져오기 도구가 빠뜨린 건이 직원 입력으로 남지 않게)

**API** `api/v1/space-assets` (ADMIN) — `GET coverage`(종류별 분모·배치·미배치·텍스트 다름 + 제외 테이블) · `GET spaces` ·
`GET placements?floor&kind&spaceNodeId` · `GET unplaced?kind` · `GET history/:kind/:assetId` · `POST placements` · `POST placements/:id/end`
**화면** `/admin/space-assets`(3413 · 시설·장비) — 현황(`<Ratio>` 분모 0=산출 불가) · 층별 배치 · 미배치+후보 · 이동·이력·종료

**검증**: 단위 12 · 재주입 5종 전부 실패 확인(이전 배치 미종료·좌표 검사 제거·단말 식별자 노출·분모 0→0·잠금 키 전역화) ·
아키텍처 가드가 잡은 것 6 교정(서버 조립 한국어 7→0·저장 기본값 1→0·EmptyState 번역 이중·자체 `산출 불가`→`<Ratio>`·마이그레이션/중첩 경로 기준선)

**남은 것(연동의 나머지 절반)**
- 각 자산 편집 화면(장비·단말·워크스테이션·검사장비·보관 장소)의 **자유 텍스트 입력 → 공간 선택기**로 교체 — 그때 텍스트는 표시 캐시가 된다(한 곳만 고치면 갈라진다)
- 단말 등록(`terminal`) 시 배치 동시 기록 · 장비 점검/리콜(`device-recall`) 화면에 현재 위치 표시 · Code Blue·안전사고의 `location` 텍스트 → 공간
- 도면 뷰어(P2)에 자산 레이어 — 확정 도면 전에는 구역 목록으로만
- 운영 반영: `migrate diff` 미리보기 → 마이그레이션 SQL 적용 → 서버 `prisma generate` → `nest build`

### §5-B 합성 평면도 — ✅ 생성(2026-09-28)

가상병원에는 실도면이 없어(§10 위험) P1 판독 시험·P2 뷰어·P3 길안내 개발용으로 **정답이 알려진 도면**을 만들었다.
- 생성기 `scripts/floorplan/generate-synthetic-floorplans.mjs` → `apps/api/prisma/fixtures/floorplans-synthetic/`
  - `B1·1F~6F` 도면 SVG/PNG 7장 + **장비·단말 배치도** 7장 + 정답 `space-import.v1.json`
- 구성: 저층부(B1~2F 84×40.4m)+병동 타워(3~6F 84×18.8m) · 8.4m 기둥 격자 · 중앙 코어(침대용·비상용·승객용 EV 4·EPS/TPS) ·
  특별피난계단 2+저층부 피난계단 2 · 1F↔2F 에스컬레이터 · 응급(구급차·도보 입구 분리·소생실·음압격리)·수술부 청결복도(통제문)·
  ICU 음압격리·병동 오물처리실/린넨/배선/투약준비 · 방사선 차폐 표기 · 공간 293 · 문/개구부 307 · 동선 간선 900(수직 41)
- 정답은 **시드 SpaceNode ZONE 63개와 코드·층 1:1**(생성기와 테스트가 seed.ts 를 직접 읽어 대조) — 시드에 없는 방(306호·화장실·코어 등)은 `spaceNodeCode: null`
- 가상 자산 227(의료기기 115·PC 64·전광판 11·보관 10·워크스테이션 9·QR 8·검사장비 5·약제기기 3·서명 태블릿 2) — `SYN-` id, **실제 장비 목록 아님**
- 검증(생성기): 공간 겹침·외곽 이탈·문이 허공/벽 밖·층 그래프 단절·**주출입구에서 엘리베이터만으로 전 공간 도달**·시드 대조 — 재주입 6종 확인(엘리베이터 1대 제거는 정당하게 통과 — 3대가 남는다)
- 🔴 치수는 병원 건축의 흔한 형태를 따랐을 뿐 **법령·시설 기준 적합성을 검증하지 않았다**
- 도면에는 SpaceNode 코드를 적지 않는다(실도면에 없다) — 판독 시험이 코드를 베껴 맞히지 못하게

### (범위 밖·후속) P6 원내 이송 요청(porter)
- 모듈이 없다(F9). 경로 계산(P3)을 재사용할 수 있지만, 업무 흐름 설계는 따로 기획한다.

---

## 6. 데이터 모델 변경 (초안)

```prisma
// P0
model PatientLocation {
  // + 추가
  source      String   @default("INFERRED_EVENT") @db.VarChar(20) // OBSERVED_QR|OBSERVED_STATION|INFERRED_EVENT|MANUAL
  granularity String   @default("ZONE") @db.VarChar(10)           // ZONE|FLOOR (P0-2 층 단위 추정)
  // zoneId 는 granularity=FLOOR 일 때 FLOOR 노드 id
}

model CheckupStation { spaceNodeId String? @map("space_node_id") @db.Uuid }   // P0-4·P0-5

model ClinicRoom {             // P0-5 — 외래 진료실 정본(지금은 roomName 텍스트뿐)
  id          String @id @default(uuid()) @db.Uuid
  name        String @db.VarChar(50)      // 기존 roomName 과 매칭
  department  String @db.VarChar(50)
  spaceNodeId String? @map("space_node_id") @db.Uuid
  isActive    Boolean @default(true)
  @@unique([department, name])
  @@map("clinic_rooms")
}

// P1
model SpaceDrawing {           // 층 도면 원본 + 축척
  id           String   @id @default(uuid()) @db.Uuid
  floorNodeId  String   @map("floor_node_id") @db.Uuid
  mediaPath    String   @db.VarChar(300)
  sha256       String   @db.VarChar(64)
  pxPerMeter   Decimal? @map("px_per_meter") @db.Decimal(10, 4) // 사람이 보정 — null=미보정
  status       String   @db.VarChar(20)   // UPLOADED|DRAFTED|CONFIRMED|SUPERSEDED
  extractSource String? @db.VarChar(20)   // AI|UNAVAILABLE|DEV_IMPORT
  confirmedBy  String?  @db.Uuid
  confirmedAt  DateTime? @db.Timestamptz()
  createdAt    DateTime @default(now()) @db.Timestamptz()
  @@map("space_drawings")
}

model SpaceEdge {              // connectedTo Json 대체(읽기 호환 기간 병행)
  id         String  @id @default(uuid()) @db.Uuid
  fromNodeId String  @db.Uuid
  toNodeId   String  @db.Uuid
  kind       String  @db.VarChar(15)  // CORRIDOR|ELEVATOR|STAIR|ESCALATOR|RAMP|DOOR
  distanceM  Decimal? @db.Decimal(8, 2) // null=모름(격자에서 계산하지 않음)
  accessible Boolean?                // null=미확인 → 접근성 경로에서 제외
  restricted Boolean @default(false)
  source     String  @db.VarChar(20)  // GRID_AUTO|DRAWING_CONFIRMED|SURVEYED|MANUAL
  polyline   Json?                   // 도면 좌표계 복도 중심선
  @@unique([fromNodeId, toNodeId, kind])
  @@map("space_edges")
}
// SpaceNode.metadata: + geometrySource · polygon(도면 좌표) · drawingId
```

- `accessible` 과 `distanceM` 은 **nullable 이 정답**이다. 모르는 걸 `true`/격자 거리로 채우면 휠체어 사용자를 계단으로 보낸다.
- 가져오기 스키마 `space-import.v1`(shared)는 개발 시점 판독(P1-a)과 런타임 판독(P1-b)이 같이 쓰는 형식이다. 방·문·간선·미판독 영역 목록을 담고, **각 항목에 신뢰 표식**(판독/사람 수정)을 둔다.
- 🔴 운영 반영: 신규 모델이므로 `migrate diff` 로 미리보기 → 서버 `prisma generate` → `nest build` 순서다(`deploy.sh --api` 는 generate 를 하지 않는다).

## 7. API · 화면

| 구분 | 경로 | 권한 | 비고 |
|------|------|------|------|
| API | `GET/POST /api/v1/space/drawings` · `POST …/:id/calibrate` · `POST …/:id/extract` · `POST …/:id/confirm` | ADMIN | P1 · extract 는 설정 OFF 면 503 이 아니라 `{source:'UNAVAILABLE', reason:'DISABLED'}` |
| API | `POST /api/v1/space/import`(space-import.v1) | ADMIN | P1-a 개발 시점 초안 적재 → DRAFTED |
| API | `GET /api/v1/space/route?from&to&accessible` | 직원 + 포털(자기 목적지만) | P3 · 미확정 층 = `{route:null, reason:'GEOMETRY_UNCONFIRMED'}` |
| API | 기존 `metaverse/*`·`floor/*` 응답에 `source`·`granularity`·`geometrySource` 추가 | 기존 | P0 · 🔴 외부 clinic 저장소가 `floor/*` 소비 — 필드 **추가만**, 계약 변경 통지 |
| 화면 | `/admin/space-model`(도면·편집기·확정) | ADMIN | 신규 · 화면번호는 `NAV_SECTIONS` 등재 시 부여(`screen-code-assignment.md`) |
| API·화면 | `api/v1/space-assets/*` · `/admin/space-assets`(3413) | ADMIN | ✅ §5-A 구현 |
| 화면 | `/metaverse` 개편(2D SVG 정본 + 3D 탭) | ADMIN·EXECUTIVE | 2603 유지 |
| 화면 | `/simulator` 2D 교체 + 시뮬레이션 격리 | ADMIN | 2602 유지 |
| 화면 | 포털·모바일·`guide/[id]`·키오스크 경로 카드 | 환자 | P3 |

## 8. 검증 · 가드 (재주입으로 실패해야 가드다)

| 가드 | 재주입(실패해야 함) | 대조군 |
|------|--------------------|--------|
| 추정 위치 렌더 계약 | 추정 점을 관측 스타일로 그리게 바꿈 | 관측 점은 실선으로 통과 |
| 길안내 기하 게이트 | `GRID_AUTO` 층에서 경로 반환 허용 | 확정 층은 경로 반환 |
| `accessible=null` 제외 | null 간선을 접근성 경로에 포함 | true 간선은 포함 |
| 층 정본 단일화 | `ROOM_MAP` 류 방·층 하드코딩 재도입(구조 가드: `'\d층 ` 리터럴 + 방 이름 사전) | SpaceNode 조회 경로 통과 |
| `getNextStation` 당일 필터 | 필터 제거 → 어제 미완료 로그가 대기에 섞임 | 오늘 로그만 셈 |
| 추천 정본 하나 | 포털·워크스테이션 추천 결과 불일치 픽스처 | 같은 입력 같은 출력 |
| 판독 FALLBACK 금지 | 판독 실패 시 격자 채움 | 실패 = `UNAVAILABLE`·빈 초안 |
| 시뮬레이션 격리 | 시뮬레이터가 실원장(`patient_journey_events`)에 씀 | 격리 저장소에만 씀 |
| 빈 catch 금지(floor) | `catch {}` 재도입 | warn 로그 1회 |

- 🔴 각 가드는 재주입이 성공했는지부터 확인한다(`assert count==1`). zsh 에서 `$T` 가 쪼개지지 않는 함정도 있다 [[feedback_reinject_harness_traps]].
- **판독 수용 시험**(P1 게이트): 사람이 확정한 기준 도면 N장(최소 3층분)에 대해 아래를 잰다. 합격선은 사람 결정이다(§9 D3). 측정 전에는 "미측정"으로 적는다.
  - 방 검출 재현율과 정밀도
  - 문 연결 정확도
  - 방 이름 일치율
  - 축척 보정 후 거리 오차(p90)
- **3D 뷰어 계약 테스트**: 장면을 만드는 순수 함수(SpaceNode → 메시 기술자)를 테스트한다. WebGL 렌더 자체는 스모크 테스트만 한다. 스크린샷 시각 검수는 보조다.

## 9. 사람 결정 (2026-09-28 등록부 등재 — `decision.registry.batch-2026-09-i.ts` · 이 표는 정본이 아니다, 키로 등록부를 가리킨다)

| # | 키(제안) | 질문 | 선택지 |
|---|---------|------|--------|
| D1 | `space.drawingExtract.provider` | 런타임 도면 판독을 누가 하나 | 없음(개발 시점 판독만) / WeRU.B 비전 / 외부 Claude API(대외 발신 3조건) |
| D2 | `space.geometry.confirmAuthority` | 도면 확정 권한자 | 시설팀 / 원무 / 관리자 · 확정자 직책 검증 불가 사실 명시 |
| D3 | `space.drawingExtract.acceptance` | 판독 합격선 | 재현율·거리 오차 기준값 |
| D4 | `location.inferred.display` | 추정 위치를 운영 화면에 보일지 | 숨김(기본) / 표식과 함께 표시 / 폐지(추정 기록 자체 중단) |
| D5 | `wayfinding.patientExposure` | 환자에게 길안내 공개 범위 | 비공개 / 포털·앱 / + 키오스크·QR |
| D6 | `space.i18nNames` | 방 이름 다국어 | SpaceNode 필드 / i18n 카탈로그 / 한국어만 |
| D7 | `location.retentionDays` | 위치 원장 보존 기간 | 국가 보존 기간(T10)과 연동 |
| D8 | `infection.contactCandidates` | 위치 겹침 접촉자 후보 사용 | 사용 안 함 / 감염관리실만 |
| D9 | `space.assets.readRoles` | 자산 위치 조회를 임상 직군(장비 찾기)에 열지 | 관리자만(현재) / + 간호·의사(의료기기만 · 단말 제외) |
| D10 | `space.assets.legacyText` | 기존 자유 텍스트 위치의 운명 | 병행 유지(현재) / 편집 화면을 공간 선택기로 교체 후 표시 캐시화 / 폐지 |
| D11 | `space.assets.controlledSubstance` | 마약류 금고의 물리 위치 연결 | 연결 안 함(현재) / 금고를 보관 장소로 등록 후 연결(법정 대장 영향 검토) |
| D12 | `space.floorApi.fallbackGeometry` | 확정 도면이 없을 때 층 API 가 격자 자동 배치를 그릴지 | 격자 표시+표식(현재) / 확정 도면 없으면 그리지 않음 |

- 🔴 **3D 라이브러리 도입**(three/r3f)은 기술 선택이라 사람 결정 표에 넣지 않는다. 다만 번들 예산 초과 시 중단 조건으로 둔다.
- F3 의 **실제 층 배치(검진센터가 몇 층인가)**는 코드가 정하지 않는다. 기관 정체성 정본과 같은 축이다. 확인 전까지 SpaceNode 시드를 "가상병원 배치"로 표식한다.

## 10. 순서 · 규모 · 위험

| 단계 | 선행 | 규모(개략) | 비고 |
|------|------|-----------|------|
| P0 | — | 스키마 3 · 서비스 6 · 시드 2 · 가드 5 | 3D 없이도 가치: 환자 앱 층 오안내·추천 불일치 봉합 |
| P1-a | P0-9 | import EP · 편집기 화면 · shared 스키마 | 도면 확보가 선행(병원 제공 — 가상병원이면 **도면 자체가 없다**) |
| P1-b | P1-a · D1 · D3 | 판독 서비스 · 수용 시험 | 사람 결정 대기 |
| P2 | P0 · (P1 없으면 GRID_AUTO 워터마크 모드) | 3D 청크 · 2D SVG 정본 · 레이어 5 | React 19 호환 먼저 |
| P3 | P1 확정 층 ≥1 · D5 | 경로 함수 · 4접점 · 모바일 의존성 | 서버 `npm ci` 선행 |
| P4 | P0 · 시뮬레이션 격리 | 추천 v2 · 병목 분석 | |
| P5 | P0 · D8 | 후보 질의 · 화면 | |

**위험**
- 🔴 **가상병원에는 실제 도면이 없다.** P1 을 시연하려면 공개 샘플 도면이나 합성 도면이 필요하다. 합성 도면으로 만든 것은 `DEV_IMPORT`/데모 표식을 달고, REAL 모드 시드 가드(`seed-mode-guard`)를 지나게 한다.
- 관측 위치는 QR 스캔 협조에 의존한다. 스캔 누락은 "모름"이지 "그 자리에 계속 있음"이 아니다. 닫히지 않은 위치 구간에 최대 체류 상한(config)을 두고, 넘으면 "위치 미상"으로 전환한다.
- 외부 clinic 저장소가 `floor/*` 응답을 소비한다. 필드 제거·의미 변경은 외부 점검 대상이다.
- 3D 뷰가 "보기 좋은 거짓"이 될 위험이 있다. §4 원칙 1·2·6 이 이를 막으며, 가드(§8)로 고정한다.

## 11. 검토했으나 이번 범위 밖 — 이미지 능력의 다른 활용

| 후보 | 판단 | 이유 |
|------|------|------|
| 상처·욕창·피부 사진 판독 | 범위 밖 | 환자 영상 = SaMD 추론 → INV-PHI-03 온프렘 고정. 외부 모델 불가 · 욕창 사진 모델도 없음 |
| PACS 영상 선판독 | 범위 밖 | 의도적으로 꺼져 있음(`workstation/reading/page.tsx:34~59` — StudyInstanceUID 미저장) · OpenPACS 분리 |
| 안내 표지판 사진 ↔ SpaceNode 대조(현장 사진으로 방 이름·번호 검수) | **후속 후보** | PHI 없음 · P1 확정 후 현장 검수 보조로 가치 — 사진에 사람이 찍히면 PHI 가 되므로 촬영 가이드 필요 |
| 병동 사진 → 병상 배치 초안 | 후속 후보 | P1 과 같은 틀 · 병상은 `Bed` 정본과 연결 필요 |
| 신분증 OCR(`idCardOcr`)·증빙 판독 | 이미 있음 | 이 기획에서 판독 틀만 재사용 |

## 12. 근거 색인

- 위치 번역: `apps/api/src/modules/journey/journey.service.ts:44~128`
- QR 관측: `apps/api/src/modules/patient-flow/patient-flow.service.ts:91~135`
- 동선 SSE·기하 폴백: `apps/api/src/modules/floor/floor.service.ts:22~62,131,455~481`
- 소비처: `apps/api/src/modules/metaverse/metaverse.service.ts:90,172` · `apps/web/src/app/(main)/simulator/page.tsx:44~67`
- 검진 추천: `apps/api/src/modules/checkup/checkup-station.service.ts:309~358` · `checkup.service.ts:41~59`
- 포털 방 표: `apps/api/src/modules/portal/portal.service.ts:2270~2367`
- 시설 안내 예시값: `apps/web/src/app/(main)/facility-info/page.tsx:19~91,175~186`
- 기하 시드: `apps/api/prisma/seed-floor-metadata.ts` · `seed-floor-demo-movement.ts` · `seed.ts:6630~6742`
- AI 송신 경계: `apps/api/src/common/util/ai-egress-fetch.ts` · `modules/evidence/evidence-extract.service.ts` · `ARCHITECTURE-INVARIANTS.md:37,87`
