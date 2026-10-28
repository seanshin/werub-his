# 응급실 환자 흐름 TV 보드 — 도착→배정→검사→처분→퇴실 단계 전광판 (환자·보호자 공개)

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/app/display/_boards/ErFlowBoard.tsx · apps/api/src/modules/emergency/er-flow-display.service.ts · 잔여: 없음 (검토 초안 근거가 공개 사이트 갤러리 파일이던 오기 교정)

- 작성: 2026-08-05 · 상태: **P0 구현 착수(같은 날)**
- 요구: `/workstation/emergency` 와 연계되는 **TV 화면 전용 별도 구성** — 각 환자별 도착 시간부터 담당의사 배정·검사·퇴원/입원까지의 **흐름이 보이는** 형태. **일반 환자·보호자가 상태 확인 가능**해야 함(대기실 벽면 TV).

## 1. 실측 자산 (2026-08-05)

| 자산 | 실측 |
|---|---|
| `/workstation/emergency` | 트리아지 접수·대기열·완료 3탭(580줄) — 스태프 작업 화면. TV 형태 아님 |
| 공개 전광판 선례 | `/display/waiting`(외래 호출) — **공개 SSE+PHI 강마스킹** 패턴 ③(`/api/v1/queue/public/stream`·EventSource·키 없음) + 키 검증 EP 병행(DisplayApiKey). 마스킹 정본 `maskName`(홍○동)·계약 테스트 `public-display-masking.spec.ts` |
| 흐름 데이터 | `EmergencyVisit` 세분화 status 8종(PENDING_TRIAGE→…→COMPLETED)·arrivalAt·triagedAt·**doctorId**·treatmentStartedAt·disposition/dispositionAt·admissionId·**bedId(v3.92 베드 보드)** — 단계 전량이 **실데이터 파생 가능(날조 불요)** |
| 검사 상세 | ER visit↔오더 직결 스키마 없음(ER_CONSULT encounter 경유) — **P0 은 status 파생 단계만**, 오더 건수는 P1 실측 후 |

## 2. 결정

- **D1 공개 등급 = 선례 ③(공개+강마스킹)**: 대기실 TV 는 로그인 없는 브라우저 — 외래 호출 전광판과 동일 민감도 계약. 표시=마스킹 이름(홍○동)+베드(구역-번호)+도착시각/경과+단계. **비표시=KTAS(중증도)·주호소·진단·담당의 실명**(의사도 마스킹 김○수 — queue display 선례 동일). 계약 테스트 필수.
- **D2 단계 정의 = status 실데이터 파생**(추정 금지): ①도착(arrivalAt) ②중증도 분류(triagedAt) ③담당의사 배정(doctorId 존재·시각=treatmentStartedAt 폴백 없음이면 '배정됨'만) ④진료·검사(status: IN_TREATMENT=진료 중·PENDING_RESULT=검사·결과 대기·UNDER_OBSERVATION=관찰 중) ⑤처분 결정(disposition — 입원 준비/귀가 준비/전원) ⑥퇴실(COMPLETED — admissionId 有=입원·else 처분 라벨). 현재 단계 하이라이트.
- **D3 종결 후 60분 유지**: 보호자가 "입원됐다/귀가했다"를 확인할 수 있게 COMPLETED 도 60분간 표시 후 소거.
- **D4 라우트**: FE `/display/er-flow`(무인증 `/display` 레이아웃·다크 TV 전체화면·10초 폴링) · BE `GET /api/v1/emergency/public/flow-board`(공개·서버 마스킹 — 클라 신뢰 금지). 워크스테이션 헤더에 [TV 보드 ↗](새 탭) 진입 링크.
- **D5 스태프 상세는 기존 화면이 정본** — TV 는 공개 모드 단일(풀정보 TV 가 필요해지면 베드사이드 D5 원칙대로 스태프 세션 화면을 별도 검토). 이중 모드로 마스킹 우회 파라미터를 만들지 않는다.
- **D6 정렬 = 도착 오름차순**(보호자가 자기 환자를 찾는 화면 — 중증 우선 정렬은 중증도 노출이라 배제).

## 3. 화면 (TV 16:9·다크)

```
  응급실 진행 현황                                   14:32   재실 6
  ────────────────────────────────────────────────────────────
  홍○동  ACUTE-1  도착 09:12 (5시간 20분)
   ●도착 ─ ●분류 ─ ●의사 배정 ─ ◉검사·결과 대기 ─ ○처분 ─ ○퇴실
  김○수  GEN-3   도착 11:05 (3시간 27분)
   ●도착 ─ ●분류 ─ ◉의사 배정 ─ ○진료·검사 ─ ○처분 ─ ○퇴실
  박○이  (배정 대기)  도착 14:10 (22분)
   ◉도착 ─ ○분류 ─ …
  이○라  귀가 완료 14:05                                  [60분 후 소거]
   ●도착 ─ ● ─ ● ─ ● ─ ● ─ ●퇴실(귀가)
```

## 4. Phase

- **P0(즉시)**: 공개 EP(서버 마스킹·단계 파생)+계약 테스트, `/display/er-flow` TV 페이지, 워크스테이션 진입 링크. 라이브 검증=마스킹·단계 정확성(실 재실 데이터 대조).
- ~~P1~~ **✅완료(2026-08-05 당일)**:
  - **검사 오더 배지**: 소스 실측=Order→prescription(procedureCodeId 有)→encounter→patient 경유·재실 창(도착 이후) 귀속·CANCELLED 제외 — `검사 done/total` 표시(0건이면 미표시).
  - **SSE 전환**: `@Sse flow-board/stream`(10초·선례 ③) + FE EventSource 우선·오류 시 폴링 폴백. 라이브 스트림 수신 실증.
  - **보호자·본인 조회**: `GET /portal/er-status`(PortalOrPatientGuard — 가족 전환 포함 본인 스코프라 실명·담당의 표시·재실 없으면 null) + 포털 홈 응급 진행 카드(재실 시에만 렌더·미니 스테퍼). ErFlowDisplayService 는 Prisma 리프라 PortalModule 에 provider 직접 재등록(포털 "신규 모듈 import 0" 관례 유지).
  - 🔴 동반 함정: 사망 제외를 SQL `NOT {disposition:'DEATH'}` 로 걸었더니 **disposition=null(미결정) 행까지 통째 제외**(NULL 비교) — 포털 조회 상시 null 실증 후 JS 필터로 봉합. 라이브=손서연 stage 4·ACUTE-1·담당의 실명·계약 테스트 5 유지.

## 5. P0 실행 기록 (2026-08-05 — 당일 완료)

- BE: `GET /api/v1/emergency/public/flow-board`(의도된 공개 컨트롤러 — 무가드 감사 관점 주석 명기) + `ErFlowDisplayService`(서버 마스킹·필드 화이트리스트·단계 파생·**사망 제외**·종결 60분 유지).
- 계약 테스트 5건: 마스킹 규약(홍○동·2자)·행 키 화이트리스트 고정(금지 키 부재)·단계 파생·입원 종결·사망 제외.
- FE: `/display/er-flow`(무인증 레이아웃·다크 TV·10초 폴링·9행+외 N명·개인정보 안내 푸터) + 워크스테이션 헤더 [📺 TV 보드 ↗].
- 라이브 검증: 무인증 curl — 마스킹(배○우·손○연)·베드(GEN-1·ACUTE-1)·단계(관찰 중 3·처분 결정 4·도착 0·분류 1)·**PHI 누출 키 0**. TV 렌더 실확인(6단계 스테퍼·현재 단계 앰버 펄스).
