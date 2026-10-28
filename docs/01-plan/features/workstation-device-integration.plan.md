# 워크스테이션-디바이스 연동 & 설정 관리 기획

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:11611 model WorkstationProfile · apps/api/prisma/schema.prisma:11629 model PeripheralDevice · apps/api/prisma/schema.prisma:7373 model TerminalRegistry · 잔여: P2 디바이스 I/O(네트워크 프린트/로컬 에이전트/WebUSB)(사람); P3 모달리티 worklist·활력계(사람)

> 2026-07-04 / Plan v1.0 / 대상: `apps/api/src/modules/workstation`·`terminal`·`apps/web/.../workstation`·`admin`
> 요구: 각 워크스테이션이 물리 디바이스(라벨프린터·바코드스캐너·서명패드·DICOM 모달리티·활력계 등)와 연동되도록 **워크스테이션 정체성 + 주변기기 바인딩 + 설정 관리**가 필요. "워크스테이션 ID 로그인" 또는 "설정 관리 기능".

## 1. 현황 (코드 grounded)
| 자산 | 성격 |
|------|------|
| `WorkstationConfig`(stationId·label·category·department·orderCodes·location) | **논리 스테이션**(어떤 코드/오더를 처리하는지). 물리 단말·디바이스와 무관 |
| `TerminalRegistry`(deviceUuid·ip·mac·mode PUBLIC/PRIVATE·dedicatedUserId·location·beaconId·lockTimeout) | **물리 단말** 정체성(단말 보안 트랙 Tier1/2). 이미 존재 |
| `DevicePairingCode`(8자 코드·만료·usedByDevice) | **QR/코드 페어링** 선례(동의 태블릿) |
| `PharmacyDevice`(type ATC/COUNTER/PACKAGER/LABEL_PRINTER) | **주변기기 모델링 선례**(약국 한정) |
| 워크스테이션 FE(lab·imaging·pharmacy·therapy…) | 논리 stationId를 쿼리로 넘겨 큐/오더 처리. **현재 어느 물리 워크스테이션인지 모름** |

**갭**: (1) "이 브라우저가 어느 물리 워크스테이션인가" 해석 부재 → (2) 워크스테이션별 기본 프린터/스캐너/서명패드 등 **주변기기 바인딩 없음** → (3) 중앙 **설정 관리 UI** 없음.

## 2. 정체성(Identity) 설계 — 결정 필요
워크스테이션을 식별하는 두 방식(요구사항의 두 옵션):

| 방식 | 방법 | 장점 | 단점 |
|------|------|------|------|
| **A. 워크스테이션 ID 로그인/선택** | 사용자 로그인 후 워크스테이션 ID를 선택(또는 입력)·브라우저에 영속(localStorage/쿠키) | 인프라 0·즉시 | 사용자가 매번/기기별 선택·오선택 위험 |
| **B. 단말 바인딩(TerminalRegistry 재사용)** | 물리 단말(deviceUuid/IP)을 워크스테이션에 등록 → 접속 시 자동 해석 | 견고(사용자 무관)·단말 보안 트랙과 통합 | 최초 등록/페어링 필요 |

> **권고: 하이브리드** — 물리 단말은 **B(TerminalRegistry↔워크스테이션 바인딩)** 로 자동 해석, 미등록 기기는 **A(ID 선택)** 폴백. 단말 보안(Tier1/2)·BLE 비콘 자산과 자연 통합.

## 3. 데이터 모델 (신규·확장)
### 3-A WorkstationProfile (물리 워크스테이션)
논리 `WorkstationConfig`와 분리한 **물리 워크스테이션 단위**:
- code(고유·로그인/선택 키)·label·department·location·defaultStationIds(논리 스테이션 매핑)·terminalId?(TerminalRegistry 바인딩)·isActive.

### 3-B PeripheralDevice (주변기기)
- workstationProfileId(바인딩)·type(`LABEL_PRINTER`/`DOC_PRINTER`/`BARCODE_SCANNER`/`SIGNATURE_PAD`/`DICOM_MODALITY`/`VITALS_MONITOR`/`CARD_READER`/`OTHER`)·name·
- 연결정보: connection(`NETWORK`/`LOCAL_AGENT`/`WEBUSB`/`WEBSERIAL`)·host·port·agentId?·config(Json 드라이버별)·
- isDefault(유형별 기본기)·status(ONLINE/OFFLINE/UNKNOWN)·lastSeenAt.

### 3-C (재사용) DevicePairingCode
QR/코드 페어링으로 단말↔워크스테이션·주변기기 등록(동의 태블릿 선례 재사용).

## 4. 설정 관리 (Admin)
- **워크스테이션 관리 콘솔**(`/admin/workstations`): 워크스테이션 등록·논리 스테이션 매핑·단말 바인딩·주변기기 CRUD·유형별 기본기 지정·상태 모니터.
- 페어링: 워크스테이션에서 QR 표시 → 관리자 승인 or 코드 입력으로 단말/기기 바인딩.

## 5. 런타임 연동 (디바이스 I/O)
브라우저는 네트워크 프린터·USB 기기에 직접 접근 불가 → 연결 방식별 경로:
- **NETWORK**(라벨/문서 프린터·DICOM): 서버측 렌더→프린터 전송(IPP/LPR) 또는 프린터 스풀러. 워크스테이션 기본 프린터로 라우팅.
- **LOCAL_AGENT**: 워크스테이션 로컬 경량 에이전트(프린트/스캔 브리지)·`agentId`로 명령 전달(선택).
- **WEBUSB/WEBSERIAL**: 바코드 스캐너·서명패드를 브라우저 권한으로 직접(사용자 1회 허용). 서명패드는 기존 consent 서명패드 자산 활용.
- 해석 흐름: 접속 → 워크스테이션 해석(B/A) → 유형별 기본 기기 조회 → 인쇄/스캔/서명 시 해당 기기로 라우팅.

## 6. 단계
| Phase | 내용 | 게이트 |
|-------|------|--------|
| **P0** | WorkstationProfile 모델·정체성 해석(B 단말바인딩+A ID선택 폴백)·Admin 워크스테이션 콘솔(등록·매핑) | 없음 |
| **P1** | PeripheralDevice 모델·바인딩·유형별 기본기·페어링(QR/코드)·상태표시 | 없음 |
| **P2** | 디바이스 I/O — NETWORK 프린트 라우팅(라벨/문서)·WEBUSB 바코드·서명패드 연계 | 인프라(프린터 네트워크·에이전트 결정) |
| **P3** | 모달리티(DICOM worklist)·활력계·상태 모니터링·오프라인 처리 | 장비·PACS 협의 |

## 7. 안전·정합
- 신규 모델은 가산적(기존 WorkstationConfig/TerminalRegistry 불변). 단말 보안 트랙과 통합(중복 아님).
- 주변기기 연결정보는 내부 네트워크 한정(egress 통제·SSRF 유틸 재사용).

## 8. 결정 필요 (사람)
1. 정체성 방식 확정(권고: 하이브리드 B+A).
2. 디바이스 I/O 경로(네트워크 프린트 vs 로컬 에이전트 vs WebUSB) — 병원 인프라·보안 정책 종속.
3. 대상 주변기기 우선순위(라벨프린터·바코드가 통상 최우선).
