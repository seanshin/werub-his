# HIS ↔ ERP 연동 마스터 계획서 (전수조사) v1.0

> **요약**: HIS 154개 모듈을 전수조사하여 ERP(재무·자재·자산·구매·인사)와 연동해야 할 도메인을 도출하고 우선순위 로드맵으로 정리. CSSD 재고 연동(완료)을 **표준 패턴**으로 전 도메인에 확산.
>
> **프로젝트**: Hospital RUN v3.10.0 · **작성일**: 2026-06-09 · **상태**: Draft · **우선순위**: P0(전략) · **연관**: [[cssd-erp-integration-spec]], [[cssd-inventory]], erp_sso_integration

## 0. 목적 / 방법
- ERP = 회계/재무·구매조달·자재재고·고정자산·인사급여. HIS의 운영 데이터 중 **돈·물자·사람**에 해당하는 것은 모두 연동 대상.
- 방법: `apps/api/src/modules` 전수 스캔 → ERP 도메인 매핑 → 방향·우선순위 산정.

## 1. 표준 연동 패턴 (CSSD에서 확립 → 전 도메인 재사용)
1. **코드 매핑**: HIS 코드 ↔ `erpItemCode`/`erpRefCode`
2. **인증**: `X-Integration-Key`(서버-서버) — 도메인 공통 키 또는 도메인별 키
3. **인바운드**(ERP→HIS): `POST /api/v1/integration/{domain}/...`
4. **아웃바운드 웹훅**(HIS→ERP): 변동 이벤트 `*.changed` POST(config on/off)
5. **읽기**(ERP→HIS): `GET /api/v1/integration/{domain}/...`
6. 설정: `/admin/erp`(연동키·웹훅·on/off)

## 2. 전수조사 결과 — 연동 후보 (도메인별)

### A. 재무/회계 (Finance) — 매출·미수·원가
| HIS 모듈 | 데이터 | 방향 | ERP 영역 | 우선 |
|----------|--------|------|----------|------|
| billing / billing-advanced | 수납·정산·일일마감 | HIS→ERP | 매출·현금·전표 | **High** |
| claim / insurance-claim | 보험청구·심사·지급 | HIS→ERP | 수익·미수금 | High |
| non-covered | 비급여 매출 | HIS→ERP | 매출 | Medium |
| cost-analysis | 원가·수익성 | 양방향 | 원가회계 | Medium |

### B. 자재/재고 (Materials) — 표준 패턴 동일
| HIS 모듈 | 데이터 | 방향 | 우선 | 상태 |
|----------|--------|------|------|------|
| **cssd** | 기구 멸균품 재고·입고·소모 | 양방향 | High | ✅ **완료** |
| inventory | 일반 소모품/자재 재고·입출고 | 양방향 | **High** | (CSSD와 동일 패턴 적용) |
| pharmacy | 의약품 재고·조제 소모 | 양방향 | High | |
| blood-bank | 혈액 제제 재고 | HIS→ERP | Medium | |
| nutrition | 급양 식자재 | 양방향 | Low | |
| lab | 검사 시약·소모품 | 양방향 | Medium | |

### C. 고정자산 (Assets)
| HIS 모듈 | 데이터 | 방향 | 우선 |
|----------|--------|------|------|
| equipment | 의료기기 자산·감가·유지보수·A/S | 양방향 | High |
| 디바이스(consent 태블릿·survey 태블릿·StaffDevice) | IT 자산·배치·상태 | HIS→ERP | Medium |

### D. 구매/조달 (Procurement)
| 항목 | 데이터 | 방향 | 우선 |
|------|--------|------|------|
| 공급업체 마스터(Supplier) | 거래처 공통화 | 양방향 | **High**(선행 — 매핑 기준) |
| 발주(PO) | 구매요청·발주·수령 | ERP가 SoT, HIS는 입고 수신 | High |
| order / pre-order | 자재 청구성 오더 | HIS→ERP | Low |

### E. 인사/급여 (HR)
| HIS 모듈 | 데이터 | 방향 | 우선 |
|----------|--------|------|------|
| hr / staff | 인사기록·부서·스케줄 | 양방향(ERP가 인사 SoT일 수 있음) | High |
| staff-qualification | 자격·면허 | HIS→ERP | Medium |
| staff(근태/스케줄) | 근태 → 급여 산정 | HIS→ERP(급여는 ERP) | High |
| staff-meal | 직원 식대(복리후생) | HIS→ERP | Low |

> 참고: hr는 이미 "Clinic 연동용" 부분수정 API 존재 — ERP/Clinic 연동 경로 정합 필요.
> 참고: `inventory`(범용) 모듈이 CSSD 품목과 **기능 중복** — 통합/역할정리 검토.

## 3. 우선순위 로드맵 (Wave)
| Wave | 범위 | 근거 |
|------|------|------|
| **W0 (완료)** | CSSD 재고 | 표준 패턴 확립 |
| **W1** | 공급업체 마스터 통합 + **inventory(범용 자재)** + **pharmacy 재고** | 자재 흐름 일원화(매핑 기준 선행) |
| **W2** | **billing/claim → 회계(매출·미수)** + equipment(자산) | 돈·자산 |
| **W3** | hr/근태 → 급여 + blood-bank·lab·nutrition 자재 + 디바이스 자산 | 인사·잔여 자재 |

## 4. 공통 인프라 제안
- **공급업체(거래처) 마스터 통합**: 현재 Supplier가 CSSD 내부 → 공통 `Vendor` 마스터로 승격, ERP 거래처코드 매핑(전 자재 도메인 공유).
- **통합 연동 게이트웨이**: `/api/v1/integration/*` 일관 규격(인증·웹훅·오류) — 도메인별 컨트롤러가 동일 패턴 상속.
- **이벤트 아웃박스**(신뢰성): 웹훅 fire-and-forget → **재시도·멱등키** 위한 outbox 테이블(전 도메인 공통).
- **연동 모니터링**: `/admin/erp`에 도메인별 연동 상태·최근 전송·실패 로그.

## 5. 결정 필요
| # | 항목 | 옵션 | 기본 |
|---|------|------|------|
| D-1 | 연동 키 | 단일 공통 / 도메인별 | **도메인별**(권한 최소화) |
| D-2 | 인사 SoT | HIS / ERP | **ERP**(HIS는 근태 제공) |
| D-3 | 재무 전표 | 건별 실시간 / 일마감 배치 | **일마감 배치 + 정정 실시간** |
| D-4 | inventory vs cssd | 통합 / 역할분리(범용 자재 vs 멸균품) | **역할분리 후 공통 패턴** |
| D-5 | 웹훅 신뢰성 | fire-and-forget / outbox 재시도 | W1에서 **outbox 도입** |

## 6. 다음 단계
- 본 마스터 계획 확정 → **W1(공급업체 통합 + inventory/pharmacy 재고)** 설계/구현 → W2(재무·자산) → W3(인사·잔여).
- 각 Wave는 [[cssd-erp-integration-spec]] 패턴으로 도메인별 명세서 산출 후 ERP 팀 전달.

## 7. ERP 응답 반영 (v1.1)
- ERP 대응계획서(2026-06-09) 수신 — **수신 측 모델 대부분 보유**(재무·AR/AP·자산·원가·SCM·procure-to-pay·근태→급여).
- **결정 확정**: D-1·D-3·D-4·D-5 합의. **D-2 = 역할분리 수용**(디렉터리/계정 SoT=Clinic·HIS, 인사·발령·급여 SoT=ERP).
- **신뢰성 정합**: HIS outbox(전송보장) ↔ ERP inbox 멱등(source_ref UNIQUE)+staging = 1:1.
- **W1 선행 2건**: ① 거래처(Vendor) 공통 마스터 승격 + `erpVendorCode` ② 코드 매핑표(item·vendor).
- 상세 회신: [[erp-master-integration-response]]. 다음: HIS가 W1 선행(Vendor 승격 + outbox + inventory 웹훅) 착수.

## 버전 이력
| 버전 | 일자 | 내용 |
|------|------|------|
| 1.0 | 2026-06-09 | 전수조사 — 재무·자재·자산·구매·인사 연동 후보 + Wave 로드맵 |
| 1.1 | 2026-06-09 | ERP 응답 반영 — D-1~5 확정(D-2 역할분리), W1 선행 2건, outbox↔inbox 정합 |
| 1.2 | 2026-06-09 | **W1~W3 HIS측 구현 완료** — outbox + CSSD/inventory(자재)·billing(회계)·equipment(자산)·hr(인사) outbox 이벤트 + erp 매핑 + 도메인 명세서(W1/W2/W3) 발행. ERP 수신 어댑터 대기 |
