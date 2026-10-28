# 멀티테넌트 서비스 자격 체계 설계 (edu #8)

- **작성일**: 2026-07-29
- **발단**: edu #8/#+ "병원별 서비스 자격 발급 체계 — 멀티테넌트 온보딩 전제". 외부 공유 서비스(edu·sign·pacs·twin)가 **어느 병원 요청인지 + 그 병원이 서비스 자격이 있는지** 판정할 근거가 필요.
- **요지**: **HIS는 현재 단일 테넌트**임을 먼저 확정하고, 현실적 테넌시 모델 위에 **서비스 자격 레지스트리**를 얹는다. 대규모 멀티테넌트 리팩터는 전략 결정 사항으로 분리.

---

## 1. 현행 실측

| 요소 | 실측 | 함의 |
|---|---|---|
| 테넌시 | **단일 테넌트** — `hospital.*` config(name·code=요양기관기호·license·grade)가 단일 값·1병원/배포 | HIS 데이터에 orgId 스코프 없음(전역) |
| `Organization` 모델 | **HIE 피어 디렉터리**(전원 TransferRecord·의뢰 HieExchange)·`code @unique`·`grade`·`fhirEndpoint`·`smartClientId/Secret`·**`isSelf`(본원 앵커)** | 테넌시 아님. 단 **본원 식별 앵커는 존재** |
| 서비스 자격 | **모델 없음** | 어느 병원이 어떤 외부 서비스 자격인지 표현 불가 |
| 외부 연동 키 | `edu.integrationKey`·`erp.integrationKey` 등 **단일 키/배포** | 병원별 구분 없음(배포 단위) |

→ **edu의 "멀티테넌트 온보딩"은 현행에 존재하지 않는 전제.** 지금은 **병원 1곳 = HIS 1배포 = 단일 edu 키**.

## 2. 핵심 결정 — 테넌시 모델 (전략)

| 안 | 내용 | 평가 |
|---|---|---|
| **A. per-deployment(권장·현실)** | 병원마다 HIS 인스턴스 별도 배포(현행 유지). "멀티테넌트"=여러 배포를 외부 서비스가 병원 식별로 라우팅 | 리팩터 0·현행 정합·edu 요구 충족 가능 |
| B. multi-tenant HIS | 단일 HIS가 다병원 데이터를 orgId 스코프로 격리 | **대규모 리팩터**(전 테이블 orgId·RLS·격리)·PHI 격리 위험·전략 결정 |

**권장 = A**. edu가 필요한 건 "**병원 식별 + 서비스 자격**"이지 HIS 내부 멀티테넌시가 아니다. per-deployment에서도 **서비스 자격 레지스트리**로 충족된다.

## 3. 설계 — 서비스 자격 레지스트리

### 3.1 병원 식별 앵커
- 본원 = `Organization.isSelf=true`(이미 존재). `code`(요양기관 기호)가 병원 전역 식별자.
- 배포마다 본원 Organization 1건. 외부 서비스는 **요청의 병원 식별자=`org.code`(또는 발급 키)** 로 병원을 안다.

### 3.2 신규 모델 (초안)
```prisma
enum EntitlementStatus { ACTIVE SUSPENDED EXPIRED }

/// 병원(본원)이 어떤 외부/부가 서비스 자격을 갖는지
model ServiceEntitlement {
  id          String            @id @default(uuid()) @db.Uuid
  orgId       String            @map("org_id") @db.Uuid      // Organization(isSelf) 참조
  service     String            @db.VarChar(40)              // edu|sign|pacs|twin|checkup-voucher …
  status      EntitlementStatus @default(ACTIVE)
  plan        String?           @db.VarChar(40)              // 요금제/등급(선택)
  issuedAt    DateTime          @default(now()) @map("issued_at") @db.Timestamptz()
  expiresAt   DateTime?         @map("expires_at") @db.Timestamptz()
  keyHint     String?           @map("key_hint") @db.VarChar(20) // 발급 키 지문(앞 8hex)·값 미저장
  meta        Json?
  @@unique([orgId, service], map: "uq_entitlement")
  @@index([service, status])
  @@map("service_entitlements")
}
```
- **키 자체는 미저장**(config 시크릿·keyHint로 대사). 서비스별 1자격/병원.

### 3.3 온보딩 흐름 (신규 병원)
1. 본원 `Organization` 생성(code·grade·isSelf).
2. 자격 발급: `ServiceEntitlement(orgId, service, ACTIVE, expiresAt)` — 관리 UI/EP(ADMIN).
3. 서비스 키 발급: 서비스별 스코프 키(`edu.integrationKey` 등) config 주입 + `keyHint` 기록.
4. 외부 서비스(edu)에 **병원 식별자(org.code) + 키** 전달.

### 3.4 자격 조회 EP (외부 서비스용)
```
GET /api/v1/integration/entitlement?service=edu   (스코프 키)
→ { org: {code,name,grade}, service:'edu', status:'ACTIVE', expiresAt }
```
- edu는 온보딩 시 1회 + 주기 대사로 자격/만료 확인. SUSPENDED/EXPIRED면 서비스 차단.

## 4. edu 적용
- **현행(단일 병원)**: edu는 `edu.integrationKey` 1개로 1병원 서빙. 자격 레지스트리는 **미래 다병원 대비 선구축**(현행도 자격 1건 등록으로 일관).
- **다병원(A안)**: edu가 여러 HIS 배포를 서빙 → 각 요청의 `org.code`로 병원 식별 + 자격 조회로 서비스 여부 판정. 병원별 키는 각 HIS 배포가 발급.

## 5. 전제·결정 사항 (사람)
- 🔴 **전략**: HIS가 per-deployment(A)로 갈지 multi-tenant(B)로 갈지 = **제품/사업 결정**. 본 설계는 A 전제.
- edu #1(키 발급·aud strict) 선결 — 자격 체계는 스코프 키 위에 성립.
- 요금제/과금 연동 여부(plan 필드)·자격 만료 정책 = 사업.
- **기관 정보 3건**(code·bizNo·ceo)은 실 법적 데이터 = 원무 입력(날조 금지).

## 6. 범위·비착수 명시
- 본 문서는 **설계**. 모델·EP 구현은 **전략 결정(§5) 후**. 현행 단일 테넌트 운영에는 영향 없음.
- multi-tenant HIS(B)는 별도 대형 트랙(전 테이블 orgId·PHI 격리·RLS) — 본 설계 범위 밖.

---

## 요약
edu #8의 "멀티테넌트"는 현행 단일 테넌트에 없는 전제. **권장=per-deployment + 서비스 자격 레지스트리**(`ServiceEntitlement`·Organization.isSelf 앵커·자격 조회 EP)로 edu 요구를 리팩터 없이 충족. 전략(per-deployment vs multi-tenant HIS)은 사업 결정.
