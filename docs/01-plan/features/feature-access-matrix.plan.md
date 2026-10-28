# 기능별 접근 권한 매트릭스 기획서 (Feature Access Matrix)

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/access-control/feature-access.service.ts · apps/api/src/modules/access-control/require-feature.decorator.ts · 잔여: 없음

> **Feature**: feature-access-matrix
> **Project**: Hospital RUN
> **Version**: 1.0
> **Date**: 2026-06-17
> **Status**: Draft
> **관련**: [role-department-access-control.plan.md](./role-department-access-control.plan.md) (데이터·메뉴 스코핑 — 상호보완), [consult-desk-expansion](./consult-desk-expansion.plan.md)

---

## 1. 문제 정의

### 1.1 현재 상태

`https://his.example.org/admin/access-control` 는 3개 탭만 관리한다.

| 탭 | 대상 | 실제 강제 | 한계 |
|----|------|----------|------|
| 부서별 메뉴 접근 | 부서 → 메뉴경로 | **사이드바 숨김만** (`Sidebar.tsx` `dept-access` 소비) | URL 직접진입 차단 불가 |
| 역할별 데이터 접근 | 역할 → 환자 데이터 필드 | 응답 마스킹 | OK |
| 외부(ERP) 접근 | 역할/사용자 → ERP | ERP SSO | OK |

반면 **상담실과 유사하게 자체 가드로 접근을 통제하는 기능**들은 access-control 화면에서 전혀 보이지도, 관리되지도 않는다. 각 기능에 권한 로직이 흩어져 있고 감사·가시성이 없다.

### 1.2 자체가드 기능 인벤토리 (코드 grounded)

| 기능 | 가드 | 현재 권한 결정 방식 | 관리 위치 |
|------|------|-------------------|----------|
| 상담 데스크 `/consult` | `ConsultAgentGuard` | ConsultAgent 팀 등록 (AGENT) | `/consult/admin` |
| 상담 팀장콘솔 `/consult/lead` | `ConsultAgentGuard` + `@ConsultRole(LEAD)` | 팀 등록 + role | `/consult/admin` |
| 상담 팀관리 `/consult/admin` | `ConsultAgentGuard` + `@ConsultRole(ADMIN)` | role + ADMIN 부트스트랩 | 코드 |
| 직원 인증 콘솔 `/admin/credentials` | `CredentialGuard` | CRED_* 권한 grant + 4-eyes | 자체 콘솔 |
| 단말 관리 `/terminal/*` | `@RequirePermission` + `DailyPinGuard` | 역할 + 일일 PIN | 코드 |
| 감사 BTG 열람 | `BtgGuard` | Break-the-glass 사유 | 코드 |
| 경영진 관제 `/executive` | `@Roles(EXECUTIVE)` | 전역 역할 | 코드 |

### 1.3 핵심 갭

1. **분산** — "누가 이 기능에 들어갈 수 있는가"가 7곳에 흩어져 있음.
2. **비가시성** — 관리자가 한눈에 "기능 × 누구" 를 볼 화면이 없음.
3. **체크 누락 위험** — 메뉴 접근이 화면 숨김 수준이라 백엔드 강제가 약한 기능 존재.
4. **세밀도 부족** — 역할 단위(coarse)만 있고, 사용자 단위 grant/deny 오버라이드가 없음.

---

## 2. 목표 / 비목표

### 2.1 목표
- access-control에 **"기능 접근" 탭** 신설 → 자체가드 기능들을 한 곳에서 관리.
- **역할 × 기능 매트릭스** + **사용자별 grant/deny 오버라이드** (세밀도).
- 가드들이 참조하는 **중앙 FeatureAccessService** 도입 (단일 판정 경로 + 감사).
- 스키마 마이그레이션 없이 기존 `SystemConfig`(JSONB, category) 재사용 → `db push` 회피.

### 2.2 비목표 (Out of Scope)
- 상담 **팀 내부 모델**(ConsultAgent 팀배정·maxConcurrent·동시건수) 대체 ❌ — 유지. 매트릭스는 **외곽 진입 게이트**만 통제.
- credential-admin의 4-eyes 승인 흐름 대체 ❌ — 유지.
- 전역 RBAC(`@Roles`) 폐기 ❌ — 기능 키가 없는 일반 엔드포인트는 그대로.
- 단말 일일 PIN/BTG 사유 입력 같은 **2차 인증 단계** 대체 ❌ — 진입 허용 여부만 판정.

---

## 3. 설계 원칙 — 2계층 권한

```
[1차] 기능 진입 게이트 (이번 기획)   ← FeatureAccessService.can(user, featureKey)
        ↓ 통과 시
[2차] 기능 내부 정밀 통제 (기존 유지)  ← ConsultAgentGuard 팀스코프 / CRED 4-eyes / 일일PIN / BTG사유
```

- 매트릭스는 **"이 사용자가 이 기능 영역에 들어올 자격이 있는가"** 만 결정한다.
- 기능 고유의 세부 로직(팀 세션 IDOR 방지, 동시건수, 4-eyes)은 그대로 둔다 → **두 SoT 충돌 방지**.
- 상담의 경우: 매트릭스 = "상담 desk/lead/admin 영역 진입 허용", ConsultAgentGuard = "내 팀 세션만 조회" 로 역할 분담.

---

## 4. 데이터 모델 (스키마 변경 없음)

`SystemConfig` 재사용. category = `feature-access`.

### 4.1 기능 카탈로그 (코드 상수, FEATURE_REGISTRY)
```ts
// apps/api/src/modules/access-control/feature-registry.ts
{ key: 'consult.desk',   label: '상담 데스크',      group: '상담', defaultRoles: ['CRM_STAFF','CRM_MANAGER','ADMIN'] }
{ key: 'consult.lead',   label: '상담 팀장 콘솔',   group: '상담', defaultRoles: ['CRM_MANAGER','ADMIN'] }
{ key: 'consult.admin',  label: '상담 팀 관리',     group: '상담', defaultRoles: ['ADMIN'] }
{ key: 'credential.admin', label: '직원 인증 콘솔', group: '보안', defaultRoles: ['ADMIN'] }
{ key: 'terminal.admin', label: '단말 관리',        group: '보안', defaultRoles: ['ADMIN'] }
{ key: 'audit.btg',      label: '감사 BTG 열람',    group: '보안', defaultRoles: ['ADMIN'] }
{ key: 'executive.console', label: '경영진 관제',   group: '경영', defaultRoles: ['EXECUTIVE','ADMIN'] }
```
> 카탈로그는 코드 SoT(가드와 동일 키 사용). 오버라이드만 DB 저장.

### 4.2 권한 저장 (SystemConfig)
```
key: feature-access.config.<featureKey>
category: feature-access
value: {
  roles:  { CRM_STAFF: true, DOCTOR: false, ... },   // 역할 allowlist (미설정 시 defaultRoles)
  grants: ["userId-A", ...],   // 역할과 무관하게 명시 허용 (deny보다 약함)
  denies: ["userId-B", ...]    // 명시 차단 (최우선)
}
```

### 4.3 판정 규칙 (FeatureAccessService.can)
```
1. ADMIN(UserRole.ADMIN) → 항상 허용 (부트스트랩, 잠금 방지)
2. userId ∈ denies         → 차단   (최우선)
3. userId ∈ grants         → 허용
4. roles[userRole] === true (또는 미설정 시 defaultRoles 포함) → 허용
5. 그 외                    → 차단
```

---

## 5. 백엔드 통합

### 5.1 신규
- `access-control/feature-registry.ts` — FEATURE_REGISTRY 상수 + 헬퍼.
- `access-control/feature-access.service.ts` — `can()`, `listMatrix()`, `setFeatureConfig()`, 감사로그.
- `@RequireFeature('consult.desk')` 데코레이터 + `FeatureAccessGuard` (전역 판정 → 401/403).
- access-control.controller에 매트릭스 조회/설정 EP 3종 (`@Roles ADMIN`).

### 5.2 기존 가드 위임 (점진)
- `ConsultAgentGuard` — 팀 등록 체크 **전에** `featureAccess.can(user, 'consult.desk')` 선행. 통과 못하면 403. (기존 팀스코프 로직 유지)
- credential/terminal/btg/executive — 컨트롤러에 `@RequireFeature` 부착하여 중앙 판정 경유. (각 기능 2차 통제는 유지)
- **무중단**: 오버라이드 미설정 기능은 defaultRoles = 현재 `@Roles` 와 동일하게 시드 → 동작 변화 0.

### 5.3 감사
- 권한 변경 시 AuditLog 기록(`FEATURE_ACCESS_CHANGED`, before/after).
- 차단 발생 시 기존 가드 거부 로그에 featureKey 포함.

---

## 6. 프론트엔드 (access-control 4번째 탭)

`/admin/access-control` 에 **"기능 접근"** 탭 추가.

```
[기능 접근 탭]
 ├ 좌: 기능 목록 (그룹: 상담/보안/경영) — 선택
 └ 우: 선택 기능 권한 패널
      ├ 역할 매트릭스 (역할별 ON/OFF 토글, defaultRoles 기준선 표기)
      ├ 사용자 grant 목록 (직원 검색 추가/삭제)
      ├ 사용자 deny 목록 (직원 검색 추가/삭제)
      └ [저장] / [기본값 복원]
 + 상단 요약 매트릭스(기능 × 역할 한눈에)
```
- `apiClient` 사용(기존 탭과 동일). 직원 목록은 기존 `/api/v1/users` 재사용.

---

## 7. 단계별 구현

| Phase | 범위 | 산출 |
|-------|------|------|
| **P1** | 코어: FEATURE_REGISTRY + FeatureAccessService + 매트릭스 EP 3종 + 시드(defaultRoles) | 백엔드 판정/조회/저장 동작, 무중단 |
| **P2** | FE: access-control "기능 접근" 탭 (매트릭스·grant·deny·저장) | 관리 화면 |
| **P3** | 가드 위임: ConsultAgentGuard 선행 + credential/terminal/btg/executive `@RequireFeature` + 감사 | 실제 중앙 강제 |
| 검증 | code-analyzer + E2E(역할 허용/차단/deny우선/ADMIN부트스트랩) | 회귀 0 확인 |

---

## 8. 리스크 / 완화

| 리스크 | 완화 |
|--------|------|
| 잘못된 설정으로 관리자 잠금 | 규칙 1: ADMIN 항상 허용(부트스트랩). deny에 ADMIN 넣어도 무시 |
| 두 SoT 충돌(상담 팀모델) | 매트릭스는 진입게이트만, 팀모델은 2차 — 책임 분리 |
| 기존 동작 변화 | defaultRoles = 현행 `@Roles` 와 일치하게 시드 → 변화 0, 오버라이드 시에만 변경 |
| db push 위험 | SystemConfig 재사용, 마이그레이션 없음 |
| 가드 위임 누락 | P3에서 기능별 E2E(허용/차단) 필수 |

---

## 9. 완료 기준 (DoD)
- access-control "기능 접근" 탭에서 7개 기능의 역할/사용자 권한을 보고 편집 가능.
- 역할 토글·grant·deny 가 즉시 가드 판정에 반영(E2E 통과).
- ADMIN 부트스트랩으로 자기잠금 불가.
- 기존 기능 동작 회귀 0 (defaultRoles 시드).
- code-analyzer 통과.
