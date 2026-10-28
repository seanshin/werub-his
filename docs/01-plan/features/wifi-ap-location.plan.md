# 무선 AP 기반 원내 위치 — 수집 프로토콜·측위·표시 (PLAN-WIFI-LOC-001)

2026-10-09 · 사용자 요청 "3D 건물 보기에서 환자 위치를 표시하기 위해 위치정보를 디테일하게 수집하는 형태로 확장하고 프로토콜도 디자인. 무선 AP 기준으로 위치를 추적하는 형태로 표기, 시드 데이터도 충분하게."

🔴 **실측 전제** — 운영 DB 는 가상 병원 시드다(CLAUDE.md). 운영의 AP 는 전부 **데모 배치**(실제 설치 아님)이고 측위는 **시뮬레이션**이다.

## 1. 왜

- 위치 원장(`patient_locations`)의 관측 기록은 개통 이래 1건이다(QR 스테이션 1곳). 나머지는 이벤트 추정과 데모 시뮬레이션이라, 3D 의 "실시간 추적"은 실제 위치를 보여줄 수 없었다(v4.44.0).
- 병원에는 이미 무선망(AP)이 깔려 있다. AP 가 들은 신호 세기(RSSI)로 위치를 **근사**하는 것이 추가 장비 없이 관측 원천을 만드는 가장 가까운 길이다.
- 🔴 근사다 — 벽·사람·단말 방향에 흔들린다. 좌표마다 **오차 반경**을 함께 싣고, 반경이 방보다 크면 방을 고르지 않는다.

## 2. 구성

```
수집기(무선 컨트롤러·태그 게이트웨이·환자 앱 중계)
   │  POST /api/v1/location/wifi/ingest   (wifi-location.v1 · X-Collector-Key)
   ▼
[형식 검사] → [설정 location.wifi.enabled 꺼짐 → 503] → [단말 해시 → 동의 연결 확인(없으면 수만 셈)]
   → [측위: 층 선택 → 강한 AP 가중 중심 → 오차 반경] → 측위 원장 wifi_position_fixes
   → [같은 방 연속 2회] → 위치 원장 patient_locations (출처 OBSERVED_WIFI · FloorService.recordLocation)
   ▼
3D 건물 보기(AP 표식·측위 점·오차 원·추적 궤적) · 관리 /admin/wifi-location(3416)
```

| 원장 | 모델 | 요점 |
|------|------|------|
| AP 등록부 | `WifiAccessPoint` | BSSID(소문자)·확정 도면 층 키·좌표(m)·놓인 방·교정값(1m 세기·감쇠 지수 — null 이면 기본 모델)·출처 REGISTERED/SEED |
| 수집기 | `WifiCollector` | 수집 방식(NETWORK/DEVICE)·키 sha256(원문은 발급 응답 한 번)·마지막 수신·마지막 배치 결과 |
| 단말 연결 | `WifiDeviceBinding` | 단말 해시·끝 4자리 표식·환자·**동의 근거**(서면/구두+메모)·해제 시각·사유(지우지 않음) |
| 측위 | `WifiPositionFix` | 좌표·오차 반경·쓴 AP·품질(POINT/CELL)·층 몫·방(또는 층까지만)·출처(OBSERVED_WIFI/SIMULATED)·시뮬레이션의 실제 방·위치 원장 연결 |

## 3. 수집 프로토콜 `wifi-location.v1`

**요청** `POST /api/v1/location/wifi/ingest` · 헤더 `X-Collector-Key: wfc_…` · 본문 JSON

```json
{
  "schema": "wifi-location.v1",
  "mode": "NETWORK",
  "sentAt": "2026-10-09T05:00:00Z",
  "deviceRefKind": "RAW",
  "observations": [
    {
      "deviceRef": "TAG-00012345",
      "observedAt": "2026-10-09T04:59:58Z",
      "readings": [
        { "bssid": "aa:bb:cc:dd:ee:01", "rssi": -52, "band": "5", "channel": 36 },
        { "bssid": "aa:bb:cc:dd:ee:02", "rssi": -67 }
      ]
    }
  ]
}
```

| 칸 | 규칙 |
|----|------|
| `mode` | `NETWORK`(컨트롤러가 여러 AP 에서 단말 신호를 들음) · `DEVICE`(태그·앱이 주변 AP 를 스캔) — 수집기 등록 방식과 다르면 400 |
| `deviceRef` | 태그 번호·MAC 등(≤128자). 서버는 **sha256 만** 저장. `deviceRefKind: DEVICE_HASHED` 면 수집기 쪽 HMAC 을 그대로 다시 해시 |
| `observedAt` | 수신 시각보다 120초 넘게 미래면 `FUTURE`, 900초 넘게 지났으면 `TOO_OLD` — 그 관측만 거절 |
| `readings` | 1~32개 · BSSID 는 `aa:bb:…`·`AA-BB-…`·`aabb.ccdd.eeff` 모두 정규화 · RSSI −110~−10 dBm |
| 한도 | 배치당 관측 500 |

**응답** `200 { data: { accepted, stored, unbound, rejected: { FUTURE, TOO_OLD, NO_KNOWN_AP, ALL_TOO_WEAK }, moved } }`

| 상태 | 뜻 |
|------|----|
| 400 `WIFI_BATCH_INVALID` | 형식 오류 — **배치 전체를 받지 않았다**(무엇이 저장됐는지 수집기가 모르게 만들지 않는다) · `details.errors` |
| 400 `WIFI_MODE_MISMATCH` | 등록된 수집 방식과 다름 |
| 401 `COLLECTOR_KEY_*` | 키 없음·비활성 |
| 503 `WIFI_LOCATION_DISABLED` | 설정이 꺼져 있다 — 아무것도 저장하지 않았다(마지막 배치 결과에 DISABLED 로 남긴다) |

🔴 연결(동의) 없는 단말은 **저장하지 않는다** — 해시도 남기지 않고 `unbound` 수만 센다.

## 4. 측위 (shared `wifi-location.ts` — `solveWifiPosition`·`wifiZoneForFix`)

1. 알려진 AP·−90 dBm 이상만 쓴다(같은 AP 중복은 센 값 하나). 없으면 `NO_KNOWN_AP`/`ALL_TOO_WEAK`.
2. **층 선택** — 층별 선형 전력 합이 가장 큰 층. 그 층의 몫(`floorShare`)이 0.6 미만이면 층이 모호하다.
3. **좌표** — 그 층의 강한 AP 최대 4대, 경로 손실 모델로 거리 dᵢ = 10^((P₁ₘ − RSSI)/(10n)), 1/dᵢ² 가중 중심.
4. **오차 반경** — AP 3대 이상(POINT): 중심에서 각 AP 까지 거리와 추정 거리 차이의 RMS · 1~2대(CELL): 가장 가까운 추정 거리 · 하한 3m.
5. **방 대응** — 좌표를 담는 가장 작은 방. 반경 > 8m·층 모호·연결 안 된 공간이면 **층까지만(FLOOR)**.
6. **위치 원장** — 관측 측위가 ZONE 이고 직전 관측 측위도 같은 방이며 지금 열린 위치가 그 방이 아닐 때만 `OBSERVED_WIFI` 로 옮긴다(방 경계 떨림 방지). 시뮬레이션은 옮기지 않는다.
7. **교정** — AP 마다 1m 세기·감쇠 지수. 없으면 기본 모델(−40 dBm · 2.8 — 일반 실내 값의 중간, 측정값 아님) · 측위에 `uncalibrated` 를 남기고 화면이 "교정 안 됨"이라고 말한다.

출처 `OBSERVED_WIFI` 는 관측 출처(`OBSERVED_LOCATION_SOURCES`)에 들어간다 — 체류 분석·접촉자 후보·감시자 관측 비율 펄스가 함께 센다(펄스 SQL 은 정본과 기계 대조).

## 5. 단말 연결·동의

- 연결은 관리자·간호사·원무(태그를 건네는 직군). 근거 **서면** 또는 **구두(메모 필수)** · `DEMO` 는 직원 화면에서 거절.
- 한 단말에 열린 연결은 하나(단말별 잠금) — 다른 환자에게 열려 있으면 409. 해제는 사유와 함께, 지우지 않는다.
- 단말 원문은 저장하지 않는다(해시 + 끝 4자리).

## 6. 데모·시드

- **AP 배치 시드** `apps/api/prisma/seeds/wifi-access-points.ts` — 확정 도면 각 층 12m 격자(수직 코어 안 제외 · 작은 층도 3대 이상) · BSSID 로컬 관리 주소 `02:57:46:…` · 라벨 "(데모)" · `dataOrigin SEED` · create-only. REAL 모드는 시드 가드가 중단.
- **측위 시뮬레이션** — 데모 이동 시뮬레이터(2분)가 계획한 방 안의 점에서 각 AP 가 들었을 RSSI(기본 모델 + ±6dB 결정적 잡음 · 위아래 층은 18dB 감쇠)를 만들고 **실제 수집과 같은 엔진**으로 푼다. 출처 SIMULATED · 신호를 만든 방(`truthZoneId`)을 남겨 **방 적중률**을 분모와 함께 센다 — 엔진 성능이지 실제 병원 정확도가 아니다. 24시간 지난 시뮬레이션 측위는 이 생성기가 지운다. 위치 원장은 건드리지 않는다.

## 7. 사람 결정 (등록부 배치 10-E `decision.registry.batch-2026-10-e.ts`)

| 키 | 층 | 요지 |
|----|----|------|
| `location.wifi.collect` | 허가권자 | 무선으로 환자 위치를 수집할 것인가(태그만/태그+단말) — 설정 `location.wifi.enabled` 는 결정 기록 뒤 관리자가 켠다 |
| `location.wifi.consentMethod` | 위원회 | 동의 방식(서면·구두 / 서면만 / 초진 동의 항목) |
| `location.wifi.calibration` | 위원회 | 교정 안 된 AP 측위를 운영 위치로 쓸 것인가 |
| `location.retentionDays`(배치 I) | 허가권자 | 위치 원장 보존 기간 — 측위 원장도 같은 결정을 따른다(지우는 코드는 결정 뒤) |

## 8. 현장 측정 · 신호 지도 · 교정 제안 (2026-10-10)

실제 수집 결정 뒤 사람이 하는 "현장 교정"을 도구로 만들었다.

| 부분 | 요점 |
|------|------|
| 원장 `WifiSurveySample` | 위치를 아는 지점(확정 도면 층·좌표)에서 잰 AP 세기 · 측정 시각 필수(미래 거부) · 같은 AP 는 센 값 하나 · 지우지 않고 무효(사유) · 마이그레이션 `20261010000001_wifi_survey` |
| EP(관리자) | `GET/POST location/wifi/survey` · `POST survey/:id/void` · `GET calibration-suggestions` |
| 신호 지도 측위 | 가중 중심이 고른 층의 유효 표본이 `WIFI_FINGERPRINT.minSamplesPerFloor`(10) 이상이면 신호 공간 최근접 k=3 가중 중심(`FINGERPRINT_KNN_V1`) · 함께 들은 AP 3 미만 표본은 비교 안 함 · 모자라면 가중 중심 그대로 · 수집과 데모 시뮬레이션이 같은 `solve` |
| 교정 제안 | AP 마다 같은 층 표본의 (거리, 세기) 쌍으로 RSSI = A − 10·n·log10(d) 최소제곱 · 쌍 5 미만·거리비 3 미만·n 이 1.5~6 밖이면 이유만 · 🔴 **제안만** — 적용은 관리자가 버튼으로(기존 AP 교정 PATCH) |
| 화면 | `/admin/wifi-location` '현장 측정 · 교정 제안' — 층별 유효 표본·신호 지도 켜짐 · 표본 기록(`BSSID,세기` 줄 · 틀린 줄 있으면 저장 불가) · 무효 · 제안 표 |

운영에는 표본이 없다(0) — 모든 층이 가중 중심이다. 데모 표본을 만들지 않았다(만든 신호로 맞춘 교정은 교정이 아니다).

## 8-2. 운영 도구 (2026-10-10 · 결정 뒤 개시용)

| 도구 | 요점 |
|------|------|
| 수집기 키 교체 `POST collectors/:id/rotate-key` | 새 키 원문은 응답 한 번 · 해시 교체로 이전 키 즉시 무효(유예 없음 — 화면이 두 번 눌러 확정) · `key_rotated_at` 열(마이그레이션 `20261010000401_wifi_collector_key_rotation`) |
| AP 등록부 CSV `POST access-points/import` | 머리글 `bssid,label,floorKey,x,y,vendor` · 500행 · 미리보기(dryRun) 먼저 · 🔴 한 줄이라도 틀리면(형식·도면에 없는 층) 아무것도 넣지 않음 · create-only(이미 있는 BSSID 건너뜀) |
| 연결 거르기·일괄 해제 | `GET bindings?state=DECEASED|NOT_ADMITTED|ADMITTED`(열린 연결만 · 상한 전에 거름) · `POST bindings/unbind-bulk`(사람이 고른 것만 · 사유 하나 · 100개 · 이미 해제는 건너뜀) — 자동 해제는 여전히 하지 않는다 |
| 관리 화면 | 섹션 이동 · 도면 위 AP(교정 여부·중지)·유효 측정 표본 배치 · 44px 쓰기 버튼 |
| 3D 추적 | 마지막 무선 관측 경과(방금/n분 전 — 미래·모름은 표시 안 함) |

## 9. 하지 않은 것

- 칼만 필터 등 궤적 평활 · 수집기 쪽 HMAC 키 교환 절차 · 특정 무선 컨트롤러 제품 어댑터(수집기는 이 프로토콜로 변환해서 보낸다) · 수집기로 측정 표본을 받는 프로토콜 모드(지금은 화면·EP 입력 — 표본 원장의 기록자가 사람(collectedById)이라 수집기 단독 기록은 원장 칸 판단이 먼저).
- 실측 정확도 — 교정 측정·실제 AP 좌표가 있어야 잰다. 데모 적중률을 실제 정확도로 쓰지 않는다.
