# 중앙공급실(CSSD) 재포장·패키지 관리 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:5337 · apps/api/prisma/schema.prisma:5308 · apps/api/src/modules/cssd/cssd-package.service.ts:50 · 잔여: 없음

> **요약**: 현행 CSSD(세트 상태 전환·이력)에 **재포장(검수→조립→포장→라벨)**, **멸균 로드(회차)+BI/CI 검증**, **멸균 패키지(LOT) 추적성**을 추가해 실제 중앙공급실 운영 표준을 충족.
>
> **프로젝트**: Hospital RUN v3.10.0 · **작성일**: 2026-06-08 · **상태**: Draft · **우선순위**: P1 · **연관**: cssd(기존), 수술실(OR), 재고관리

## 0. 현황 / 문제
- 현재 `InstrumentSet`(세트=단일 레코드) + 상태(DIRTY→…→IN_USE) + `SterilizationLog`만 존재.
- **빠진 것**: ① 표준 구성품(트레이 리스트) 마스터 ② 세척 후 **조립 카운트 검증** ③ 포장·**LOT 라벨/바코드** ④ 멸균기 **회차(로드)·BI/CI 판독** ⑤ 같은 세트의 **여러 멸균 패키지(LOT) 재고·추적** ⑥ 사용처 연결·**리콜** ⑦ 만료 자동처리.
- 결과: "재포장으로 새로 만들어진 패키지"를 개별 추적/검증/리콜할 수 없음.

## 1. 목표
- 재포장 1건 = **검수·조립·포장·라벨**을 거쳐 **고유 LOT 패키지** 생성.
- 멸균은 **로드(회차) 단위** + **BI/CI 합격** 시에만 사용 가능(STERILE).
- 모든 패키지는 **LOT/바코드로 추적**(보관→출고→사용처→반납), 문제 시 **로드/LOT 일괄 리콜**.
- 유효기간 **자동 만료 처리** + 임박 알림.

## 2. 범위
- **포함**: 트레이 마스터, 조립 카운트, 포장/라벨(LOT·QR), 멸균 로드+BI/CI, 패키지 인스턴스 재고/추적, 리콜, 만료 배치.
- **제외(차기)**: EO/과산화수소 멸균 세부 파라미터 자동연동(멸균기 IoT), RFID 자동 카운트, 외부 위탁멸균.

## 3. 도메인 모델 (제안)
```
InstrumentSetTemplate (트레이 마스터)
  - name, category(과), packagingType(POUCH/WRAP/CONTAINER), shelfLifeDays(기본30)
  - items: [{ name, qty }]   ← 표준 구성품/수량
  - isActive

SterilePackage (멸균 패키지 = LOT 인스턴스)   ★ 핵심 신규
  - id, lotNo(고유, 바코드/QR), templateId, templateName(스냅샷)
  - status: ASSEMBLING → PACKAGED → IN_LOAD → STERILE → IN_USE → RETURNED → EXPIRED → RECALLED
  - assembledBy, assembledAt, countVerified(bool), countNote(누락/대체)
  - packagingType, packagedBy, packagedAt
  - loadId?(멸균 로드)
  - sterilizedAt?, expiresAt?
  - location, usedEncounterId?(사용처), usedAt?
  - createdAt

SterilizationLoad (멸균 로드 = 회차)
  - id, loadNo, sterilizer(멸균기), program(STEAM/EO/H2O2), tempC, durationMin
  - operatorId, startedAt, finishedAt
  - biResult(PASS/FAIL/PENDING), ciResult(PASS/FAIL/PENDING), releasedBy?, releasedAt?
  - packages: SterilePackage[]

PackageEvent (추적 로그)  ← 기존 SterilizationLog 확장/대체
  - packageId, action(조립·검수·포장·로드투입·멸균합격·출고·사용·반납·만료·리콜), by, note, at
```
> 기존 `InstrumentSet`은 **호환 유지**(단순 세트 현황) 또는 마이그레이션. v1은 신규 모델 병행 후 점진 통합.

## 4. 기능 요구사항 (FR)
| ID | 기능 | 우선 |
|----|------|------|
| FR-01 | 트레이 마스터 CRUD(구성품·수량·포장유형·유효일수) | High |
| FR-02 | **조립 카운트 검증** — 마스터 대비 구성품 체크, 누락 시 경고/사유 | High |
| FR-03 | **포장 + LOT 라벨 발행**(세트명·LOT·포장자·멸균예정) QR | High |
| FR-04 | **멸균 로드 생성** — 멸균기·프로그램·패키지 묶음 투입 | High |
| FR-05 | **BI/CI 판독** — 합격 시 로드 내 패키지 일괄 STERILE+유효기간 부여, 실패 시 전체 회수 | High |
| FR-06 | **패키지 재고/현황** — 상태·위치·LOT·유효기한, 검색/필터 | High |
| FR-07 | **바코드 출고/사용/반납** — 스캔 처리, 사용처(encounter) 연결 | Medium |
| FR-08 | **리콜** — LOT/로드 단위 일괄 회수 + 사용처 알림 | Medium |
| FR-09 | **만료 자동 처리(배치)** + 임박 알림 | Medium 🟡 **부분**: 조회 시 lazy 만료 보정(stats)·임박 카운트 O / **status→EXPIRED cron·능동 알림 미구현**(잔여) |
| FR-10 | 추적성 리포트 — 패키지 전체 생애(조립~사용) 타임라인 | Medium |
| FR-11 | 라벨 프린트(라벨지/PDF) 양식 | Low |

## 5. 사용자 플로우
```
[세척 완료] → 검수·조립(카운트 검증 FR-02) → 포장+LOT 라벨(FR-03) [PACKAGED]
  → 멸균 로드에 투입(FR-04) [IN_LOAD] → 멸균 → BI/CI 판독(FR-05)
     ├ 합격 → 패키지 일괄 STERILE + 유효기간(FR-05) → 보관
     └ 실패 → 로드 전체 회수(재처리)
  → 출고/사용(바코드, 사용처 연결 FR-07) → 반납 → (재세척)
  ※ 유효기간 경과 → 자동 EXPIRED(FR-09) → 재처리
  ※ 오염/실패 의심 → LOT/로드 리콜(FR-08)
```

## 6. 화면 (UX)
- `/cssd` 탭 확장: **패키지 현황**(LOT·상태·유효), **재포장(조립/포장 작업)**, **멸균 로드**, **트레이 마스터**, **리콜/만료**.
- 재포장 작업 화면: 마스터 선택 → 구성품 체크리스트(카운트) → 포장유형 → LOT 라벨(QR) 발행.
- 멸균 로드 화면: 패키지 다중 선택 → 멸균기/프로그램 → 시작/종료 → BI/CI 입력 → 일괄 합격/회수.
- 패키지 상세: 생애 타임라인(추적성).

## 7. 결정 필요
| # | 항목 | 옵션 | 기본 |
|---|------|------|------|
| D-1 | 기존 InstrumentSet | 신규 모델 병행 / 마이그레이션 | **병행 후 점진 통합** |
| D-2 | LOT 식별 | 순번 / UUID단축 / 날짜+멸균기+seq | **날짜+멸균기+seq**(가독·추적) |
| D-3 | 바코드 | QR / Code128 | **QR**(기존 인프라 재사용) |
| D-4 | BI 판독 시점 | 즉시(CI) / 24~48h(BI 배양) 후 출고 | **CI 합격 시 조기출고 + BI 사후확정**(관행) |
| D-5 | 만료 자동처리 | 배치(cron) / 조회시 lazy | **배치(일 1회)** + 조회 보정 |

## 8. 단계 (Phase)
| Phase | 내용 |
|-------|------|
| **P1** | 트레이 마스터 + 재포장(조립카운트·포장·LOT 라벨) + 패키지 현황/재고 |
| **P2** | 멸균 로드 + BI/CI 판독 → 패키지 일괄 STERILE/회수 |
| **P3** | 바코드 출고/사용처 연결 · 리콜 · 만료 자동처리 배치 · 추적성 리포트 |

## 9. 리스크
- 모델 신설로 기존 `/cssd` 현황과 **이원화** → 병행 기간 UI 혼선(D-1 점진 통합으로 완화).
- BI 배양 지연(24~48h)과 조기출고 운영 정책 → D-4 명문화 필요.
- 라벨 프린터 환경 의존(FR-11) → 우선 PDF/화면 QR로 시작.

## 10. 성공 기준
- 재포장 1건 → LOT 패키지 생성·라벨 발행, 멸균 로드 BI/CI 합격 시 STERILE 전환, 패키지 생애 추적 가능, 리콜 시 LOT/로드 일괄 회수.

## 11. 다음 단계
- 본 기획 확정 → P1 설계/구현(트레이 마스터·재포장·패키지) → P2(로드·BI/CI) → P3(추적·리콜·배치).

## 버전 이력
| 버전 | 일자 | 내용 |
|------|------|------|
| 1.0 | 2026-06-08 | 최초 — 재포장/멸균로드/패키지(LOT) 추적 기획 |
| 1.1 | 2026-06-09 | 동기화 — Match 92%. FR-01~08·10 구현 완료, FR-09(만료) 부분(lazy만, EXPIRED cron 잔여), FR-11 라벨PDF(FE) 잔여 |
