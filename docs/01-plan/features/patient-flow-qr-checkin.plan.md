# 환자 QR 동선 체크인 (Patient Flow QR Check-in) 기획서

- **버전**: v1.1 (2026-06-16) — 검토 포인트 5건 확정 반영
- **목적**: 환자 QR을 각 장소(접수·진료실·검사실·수납 등)의 스테이션에 인식시켜 위치를 체크하고, 그 기록으로 **실시간 동선**을 자동 추적한다.
- **원칙**: 기존 자산(동선 데이터·시각화·QR 스캔 인프라)을 **재사용**하고, "환자 위치 QR + 장소 스테이션 스캔" 만 신규로 얹는다. 중복 신설 금지.

---

## 1. 배경 — 이미 있는 것 (재사용)

| 자산 | 내용 | 재사용 방식 |
|------|------|-------------|
| `SpaceNode` 모델 | 장소/구역(code·floor·parentId·type) | 각 장소 = SpaceNode = `zoneId` |
| `PatientLocation` 모델 | 환자 위치 이벤트(patientId·zoneId·status·enteredAt·leftAt·duration·eventType·metadata) | 체크인 1건 = PatientLocation 1행 |
| `FloorService.emitMovement(patientId, fromZoneId, toZoneId)` / `emitLeave` | 이동 기록 + 이전 구역 leftAt/duration 마감 + **SSE 실시간 브로드캐스트** | 스캔 → 그대로 호출 |
| `floor` API (`/floor/plans·zones·entities·stats`) + SSE | 동선 시각화(현재 위치·구역별 통계·평면도) | 그대로 사용(이미 환자 위치 표시) |
| `qr` 모듈 (`/qr/sessions`·`/qr/scan`) | QR 세션 생성·스캔, 용도 분기(LOGIN·CLOCK·ATTEND·RECEIPT) | 용도에 **LOCATION 추가** 또는 전용 스캔 EP |

> 결론: 동선 데이터·시각화·SSE·이동기록 함수는 **이미 완성**. 본 기획의 신규는 **(a) 환자 식별 QR (b) 장소 스테이션 매핑 (c) 스캔→emitMovement 연결** 세 가지뿐.

---

## 2. 사용자 시나리오

```
환자: 접수 시 발급된 'QR 카드/모바일 QR'(또는 진찰권·팔찌 QR) 소지
  ↓
각 장소(접수·진료대기·진료실·채혈실·영상실·수납·약국…)에 비치된
  '위치 스테이션'(태블릿/리더기)에 QR을 인식
  ↓
스테이션이 (자기 zoneId + 환자 QR 토큰)을 서버로 전송
  ↓
서버: 환자 직전 구역 leftAt 마감 + 새 구역 enteredAt 기록(emitMovement)
  ↓
동선 보드(floor)·환자 여정(journey)에 실시간 반영(SSE)
```

- 추가 가치: **구역별 체류시간/대기시간 자동 산출**, 동선 이탈/지연 감지(SLA), 감염 동선 역추적, 다음 단계 안내("채혈 → 3층 영상실").

---

## 3. 아키텍처

### 3.1 두 가지 QR 방향 — **방향 A 채택**
- **A. 장소가 환자 QR을 스캔** (요청사항: "환자 QR을 각 장소에서 인식") ✅
  - 환자 = 식별 QR 소지, 장소 = 스캔 디바이스(자기 zoneId 보유)
- B. 환자가 장소 QR을 스캔(환자 앱) — 보조 옵션(무인 키오스크 부재 장소). 동일 백엔드 재사용.

### 3.2 구성요소(신규)
1. **환자 위치 QR** — 확정: **멀티포맷(모바일·종이·카드)**
   - **raw patientId 노출 금지**(프라이버시). 서명 토큰 `plt`(patient-location-token) 사용.
   - **매체 3종 동일 토큰**: ① 모바일(환자앱/포털 QR) ② 종이 출력(접수 진찰권/안내문에 인쇄) ③ 카드/팔찌(재진·입원·소아·고령). 하나의 plt를 어느 매체로 출력해도 동일 인식.
   - **수명 2모드(확정)**:
     - **당일형(외래)**: 내원일 자정 만료(visit 단위 회전).
     - **입원형(재원)**: 입원~퇴원 기간 유효(팔찌). 퇴원 시 폐기.
   - 토큰→patientId 매핑: 입원형=DB(재원기간), 당일형=redis TTL.
2. **장소 스테이션(Location Station)** — 확정: **스마트폰/태블릿 다양 + 기기 위치등록 필수**
   - **기기 위치 등록 기능(필수)**: 디바이스를 특정 SpaceNode(zoneId)에 바인딩. 등록 = `{ stationId, zoneId, label, deviceType }` + 키 발급. 위치 이동/교체 시 재등록.
   - 디바이스 혼용: 스마트폰·태블릿(웹 카메라 스캐너) / 전용 QR 리더(키보드 웨지) 모두 지원.
   - 인증: 스테이션 전용 키(`X-Station-Key`, 해시 저장) 또는 직원 로그인 키오스크.
   - **장소 유형 자유(확정)**: 임상 장소(접수·진료·검사·수납·약국)뿐 아니라 **비임상 장소도 등록 가능** — 탈의실/가운(환자복) 수령·물품 보관·편의시설 등. SpaceNode.type 으로 구분(CLINICAL/SERVICE/CHECKPOINT).
3. **스캔 처리 엔드포인트**
   - `POST /api/v1/patient-flow/checkin { stationToken, plt }` → 토큰 검증 → patientId·zoneId 해석 → `FloorService.emitMovement(patientId, prevZone, zoneId)`.

---

## 4. 데이터 모델 변경 (최소)

기존 `PatientLocation`·`SpaceNode` 재사용. 신규:

```prisma
model LocationStation {            // 장소 스테이션(기기) 위치 등록 — 디바이스↔구역 바인딩(필수)
  id         String   @id @default(uuid()) @db.Uuid
  zoneId     String   @map("zone_id") @db.Uuid      // SpaceNode(임상/비임상)
  label      String   @db.VarChar(100)
  deviceType String   @map("device_type") @db.VarChar(20) // PHONE|TABLET|READER
  keyHash    String   @map("key_hash") @db.VarChar(128)   // X-Station-Key 해시
  isActive   Boolean  @default(true) @map("is_active")
  lastSeenAt DateTime? @map("last_seen_at") @db.Timestamptz()
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz()
  @@map("location_stations")
}

model PatientLocToken {            // 환자 위치 QR 토큰(plt) — 멀티포맷 공통, 당일/입원 2모드
  token     String   @id @db.VarChar(64)          // 서명/랜덤
  patientId String   @map("patient_id") @db.Uuid
  mode      String   @db.VarChar(10)              // DAILY|ADMISSION
  issuedVia String?  @map("issued_via") @db.VarChar(10) // MOBILE|PAPER|CARD(최초 매체, 참고)
  expiresAt DateTime @map("expires_at") @db.Timestamptz() // 당일=자정 / 입원=퇴원예정·재발급
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz()
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz()
  @@index([patientId])
  @@map("patient_loc_tokens")
}
```

- 당일형은 `PatientLocToken`(DB, expiresAt=자정) 또는 redis TTL 택1 — 입원형과 일관성 위해 **DB 단일 모델 권장**(매체 무관 1토큰·재발급 추적).
- `PatientLocation.eventType='QR_CHECKIN'`, `metadata={ stationId, deviceType }` 로 출처 구분.
- `SpaceNode.type` 에 `CLINICAL|SERVICE|CHECKPOINT` 활용(없으면 추가) — 비임상 장소(탈의/물품) 포함.

---

## 5. API 설계

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/api/v1/patient-flow/checkin` | 스테이션 스캔 체크인(plt+zone) → emitMovement | `X-Station-Key` |
| POST | `/api/v1/patient-flow/qr` | 환자 위치 QR(plt) 발급(접수/원무) | 직원(원무) |
| GET | `/api/v1/patient-flow/patient/:id/timeline` | 환자 동선 타임라인(구역·체류시간) | 직원 |
| POST | `/api/v1/admin/location-stations` | 스테이션 등록/키 발급 | ADMIN |
| GET | `/api/v1/admin/location-stations` | 스테이션 목록·상태 | ADMIN |
| (재사용) | `/api/v1/floor/entities/:floorId` + SSE | 실시간 위치/동선 보드 | 직원 |

- 체크인 응답: `{ patient, fromZone, toZone, enteredAt, nextHint? }` — 다음 단계 안내(선택, journey 연계).

---

## 6. 보안 · 프라이버시 (의료정보)

1. **환자 식별 비노출**: QR엔 raw patientId/주민번호 금지 → 서명/랜덤 토큰(plt)만. 토큰→환자 매핑은 서버.
2. **토큰 수명**: 당일형=자정 만료 / 입원형=재원기간 유효(퇴원 시 폐기). 분실 QR은 revoke·재발급.
3. **스테이션 인증**: `X-Station-Key`(해시 저장·`secureKeyEqual`), 비활성/회수 가능. 스푸핑 방지.
4. **접근권한**: 동선 조회는 직원(진료 관련 역할)만. 환자 본인은 자기 동선만(포털).
5. **감사·보존**: 체크인=PatientLocation(이미 감사 가능), 보존정책(개보법/의료법) 연계 — N개월 후 비식별/파기.
6. **동의(확정)**: 위치추적 동의는 **환자 등록(가입) 시 수집** — 회원/환자 등록 동의 항목에 1항 추가(상시 적용). 감염 역추적은 공중보건 예외 명시. 미동의 환자는 체크인 미기록(또는 비식별 카운트만).

---

## 7. 기능 요구사항 (FR)

- FR-1 접수 시 환자 위치 QR(plt) 발급(모바일+출력)
- FR-2 장소 스테이션 등록/키 관리(ADMIN)
- FR-3 스테이션이 환자 QR 스캔 → 체크인(emitMovement 재사용)
- FR-4 직전 구역 자동 마감(leftAt·duration) — emitMovement 기본 제공
- FR-5 실시간 동선 보드 반영(floor SSE 재사용)
- FR-6 환자 동선 타임라인(구역·체류·대기시간)
- FR-7 구역별 체류/대기 통계(floor stats 재사용·확장)
- FR-8 다음 단계 안내(journey 연계, 선택)
- FR-9 동선 이탈/지연 감지·알림(SLA, 선택)
- FR-10 감염 동선 역추적 조회(기간·구역 교차, 선택)
- FR-11 프라이버시(토큰·동의·접근권한·보존)

---

## 8. Phase 로드맵

| Phase | 범위 | 비고 |
|-------|------|------|
| **P1 (코어)** | LocationStation 모델·등록, 환자 plt 발급, `checkin` EP(emitMovement 연결), 스캐너 웹 페이지(태블릿), 동선 보드 확인 | 최소 동작 |
| **P2 (운영)** | 환자 동선 타임라인 화면, 구역 체류/대기 통계, 접수 발급 UI 통합, 동의 문구 | |
| **P3 (지능)** | SLA 지연/이탈 알림, 다음 단계 안내(journey), 감염 역추적 조회, 비식별 보존 cron | |

---

## 9. Out of Scope (1차)
- 실내 측위(BLE/UWB) 자동 추적 — 본 기획은 **능동 QR 체크포인트** 방식(저비용·정확). 측위는 Phase 4+.
- 의료진 동선(직원) — 동선 보드(floor)에 일부 존재. 별도 검토.

---

## 10. 확정 사항 (검토 포인트 결정 — 2026-06-16)
1. **QR 매체**: 모바일·종이·카드 **멀티포맷**(동일 plt). → 발급 시 매체 선택 출력.
2. **스테이션 디바이스**: 스마트폰·태블릿 등 다양 + **기기 위치 등록 기능 필수**(디바이스↔구역 바인딩, `LocationStation`).
3. **plt 수명**: **당일형(외래·자정 만료)** 과 **입원형(재원기간 유효·팔찌)** 2모드 모두 지원.
4. **장소 범위**: 임상 외 **임의 장소도 사용**(탈의실/환자복 수령·물품 등). `SpaceNode.type` 으로 분류. 방향 B(환자가 장소 QR 스캔)도 무인 보조로 동일 백엔드 재사용.
5. **동의**: 위치추적 동의는 **환자 등록(가입) 시 수집**(상시). 미동의 처리 규칙 정의.

→ 본 확정으로 설계 게이트 통과. 다음 단계: P1 설계/구현 착수.
