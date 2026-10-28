# 기능별 접근 권한 매트릭스 설계서 (Feature Access Matrix)

> **Feature**: feature-access-matrix
> **Version**: 1.0
> **Date**: 2026-06-17
> **Status**: Design
> **기획**: [feature-access-matrix.plan.md](../../01-plan/features/feature-access-matrix.plan.md)

---

## 1. 아키텍처 개요

```
FE  /admin/access-control  ─[기능 접근 탭]
        │  apiClient
        ▼
BE  access-control.controller
        │  GET/PUT feature-access/*  (@Roles ADMIN)
        ▼
    FeatureAccessService ──reads/writes──▶ SystemConfig (category='feature-access')
        ▲                                   FEATURE_REGISTRY (코드 상수)
        │  can(user, featureKey)
        │
    각 기능 가드 (ConsultAgentGuard / FeatureAccessGuard via @RequireFeature)
```

판정 단일 경로: **모든 진입 결정은 `FeatureAccessService.can()` 한 곳**.

---

## 2. 백엔드 상세

### 2.1 feature-registry.ts (신규)
```ts
// apps/api/src/modules/access-control/feature-registry.ts
export interface FeatureDef {
  key: string;
  label: string;
  group: '상담' | '보안' | '경영';
  defaultRoles: string[];   // UserRole 문자열
  description?: string;
}

export const FEATURE_REGISTRY: FeatureDef[] = [
  { key: 'consult.desk',     label: '상담 데스크',     group: '상담', defaultRoles: ['CRM_STAFF','CRM_MANAGER','ADMIN'] },
  { key: 'consult.lead',     label: '상담 팀장 콘솔',  group: '상담', defaultRoles: ['CRM_MANAGER','ADMIN'] },
  { key: 'consult.admin',    label: '상담 팀 관리',    group: '상담', defaultRoles: ['ADMIN'] },
  { key: 'credential.admin', label: '직원 인증 콘솔',  group: '보안', defaultRoles: ['ADMIN'] },
  { key: 'terminal.admin',   label: '단말 관리',       group: '보안', defaultRoles: ['ADMIN'] },
  { key: 'audit.btg',        label: '감사 BTG 열람',   group: '보안', defaultRoles: ['ADMIN'] },
  { key: 'executive.console',label: '경영진 관제',     group: '경영', defaultRoles: ['EXECUTIVE','ADMIN'] },
];

export const FEATURE_MAP = new Map(FEATURE_REGISTRY.map(f => [f.key, f]));
```

### 2.2 FeatureAccessConfig 타입 / 저장
```ts
interface FeatureAccessConfig {
  roles?: Record<string, boolean>;  // 미설정 시 defaultRoles 사용
  grants?: string[];                // userId allow (deny보다 약함)
  denies?: string[];                // userId block (최우선)
}
// SystemConfig.key = `feature-access.config.${featureKey}`, category='feature-access'
```

### 2.3 feature-access.service.ts (신규)
```ts
@Injectable()
export class FeatureAccessService {
  constructor(private prisma: PrismaService) {}

  // 판정 — 모든 가드가 호출
  async can(userId: string, userRole: string, featureKey: string): Promise<boolean> {
    if (userRole === 'ADMIN') return true;                  // 규칙1 부트스트랩
    const def = FEATURE_MAP.get(featureKey);
    if (!def) return false;                                 // 미등록 기능 = 거부
    const cfg = await this.getConfig(featureKey);
    if (cfg.denies?.includes(userId)) return false;         // 규칙2 deny 최우선
    if (cfg.grants?.includes(userId)) return true;          // 규칙3 grant
    const roleMap = cfg.roles;
    if (roleMap && Object.keys(roleMap).length)
      return roleMap[userRole] === true;                    // 규칙4 명시 매트릭스
    return def.defaultRoles.includes(userRole);             // 규칙5 기준선
  }

  private async getConfig(featureKey: string): Promise<FeatureAccessConfig> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: `feature-access.config.${featureKey}` } });
    return (row?.value as FeatureAccessConfig) ?? {};
  }

  // 매트릭스 전체 조회 (FE 탭)
  async listMatrix(): Promise<{ features: FeatureDef[]; configs: Record<string, FeatureAccessConfig> }> { ... }

  // 설정 저장 (+ 감사)
  async setConfig(featureKey: string, cfg: FeatureAccessConfig, updatedBy: string) {
    if (!FEATURE_MAP.has(featureKey)) throw new BadRequestException('unknown feature');
    const before = await this.getConfig(featureKey);
    await this.prisma.systemConfig.upsert({
      where: { key: `feature-access.config.${featureKey}` },
      update: { value: cfg as Prisma.InputJsonValue, updatedBy },
      create: { key: `feature-access.config.${featureKey}`, value: cfg as Prisma.InputJsonValue,
                category: 'feature-access', label: `${FEATURE_MAP.get(featureKey)!.label} 기능 접근 권한`, updatedBy },
    });
    await this.audit('FEATURE_ACCESS_CHANGED', updatedBy, { featureKey, before, after: cfg });
  }

  async resetConfig(featureKey: string) {  // 기본값 복원 = 행 삭제
    await this.prisma.systemConfig.deleteMany({ where: { key: `feature-access.config.${featureKey}` } });
  }
}
```
> `listMatrix` 는 SystemConfig category='feature-access' 일괄 findMany 후 키별 매핑(쿼리 1회). N+1 회피.

### 2.4 데코레이터 + 가드 (신규)
```ts
// require-feature.decorator.ts
export const REQUIRE_FEATURE = 'require_feature';
export const RequireFeature = (key: string) => SetMetadata(REQUIRE_FEATURE, key);

// feature-access.guard.ts
@Injectable()
export class FeatureAccessGuard implements CanActivate {
  constructor(private reflector: Reflector, private fa: FeatureAccessService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(REQUIRE_FEATURE, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const req = ctx.switchToHttp().getRequest();
    const u = req.user;                              // JwtAuthGuard 선행 필요
    if (!u) throw new UnauthorizedException();
    const ok = await this.fa.can(u.sub ?? u.userId, u.role, key);
    if (!ok) throw new ForbiddenException(`기능 접근 권한 없음: ${key}`);
    return true;
  }
}
```
> 사용: `@UseGuards(JwtAuthGuard, FeatureAccessGuard) @RequireFeature('terminal.admin')`

### 2.5 컨트롤러 EP (access-control.controller, @Roles ADMIN)
```
GET  /api/v1/access-control/feature-access            → listMatrix()
PUT  /api/v1/access-control/feature-access/:key       → setConfig(key, body, req.user)
DEL  /api/v1/access-control/feature-access/:key       → resetConfig(key)  (기본값 복원)
```

### 2.6 모듈 배선
- `AccessControlModule` 에 `FeatureAccessService` provider 추가 + `exports`.
- `ConsultModule` / `CredentialAdminModule` / `TerminalModule` / `AuditEnhancedModule` 가 `FeatureAccessService` 주입받도록 `AccessControlModule` import (또는 글로벌 모듈화). → P3.

### 2.7 가드 위임 (P3)
**ConsultAgentGuard** — 기존 팀 등록 체크 *앞에* 진입게이트 선행:
```ts
const area = this.reflector.get(CONSULT_ROLE, ctx.getHandler());  // AGENT/LEAD/ADMIN
const featureKey = area === 'ADMIN' ? 'consult.admin' : area === 'LEAD' ? 'consult.lead' : 'consult.desk';
if (!await this.fa.can(userId, userRole, featureKey)) throw new ForbiddenException();
// ↓ 이하 기존 ConsultAgent 팀 등록/스코프 로직 그대로
```
**나머지** — 컨트롤러에 `@RequireFeature` 부착:
- credential-admin.controller → `@RequireFeature('credential.admin')` (CredentialGuard 유지)
- terminal admin EP → `@RequireFeature('terminal.admin')` (DailyPinGuard 유지)
- audit BTG EP → `@RequireFeature('audit.btg')` (BtgGuard 유지)
- executive.controller → `@RequireFeature('executive.console')`

---

## 3. 프론트엔드 상세

### 3.1 탭 추가
`apps/web/src/app/(main)/admin/access-control/page.tsx`
- `tab` 상태에 `'feature'` 추가, 탭바에 "기능 접근" 버튼.
- `{tab === 'feature' && <FeatureAccessTab />}`.

### 3.2 FeatureAccessTab 컴포넌트 (동일 파일 내)
```tsx
function FeatureAccessTab() {
  const [data, setData] = useState<{features: FeatureDef[]; configs: Record<string, Cfg>}>();
  const [users, setUsers] = useState<StaffUser[]>([]);   // /api/v1/users 재사용
  const [sel, setSel] = useState<string>('consult.desk');
  const [edit, setEdit] = useState<Cfg>({});
  // GET /access-control/feature-access, GET /users
  // PUT /access-control/feature-access/:key  { roles, grants, denies }
  // DEL /access-control/feature-access/:key  (기본값 복원)
}
```
레이아웃:
```
┌ 좌(기능 목록, 그룹헤더 상담/보안/경영) ┬ 우(선택 기능 패널) ───────────┐
│ • 상담 데스크         [기본값]         │ 역할 토글: ADMIN✓ CRM_STAFF✓ ... │
│ • 상담 팀장 콘솔                        │   (defaultRoles 회색 기준선 표기) │
│ • 상담 팀 관리                          │ 추가 허용(grant): [직원검색+] 칩  │
│ • 직원 인증 콘솔                        │ 차단(deny):       [직원검색+] 칩  │
│ • 단말 관리 ...                         │ [저장] [기본값 복원]              │
└────────────────────────────────────────┴──────────────────────────────────┘
상단: 요약 매트릭스(기능 행 × 역할 열, ✓/·)
```
- ADMIN 역할 토글은 비활성+체크고정(항상 허용 안내 툴팁).
- grant/deny 직원 추가: `users` 드롭다운/검색, 칩 X 제거.
- 저장 후 `listMatrix` 재조회.

### 3.3 (선택) 메뉴 노출 연동
P2 범위 외. 사이드바 `/consult` 등 진입 메뉴는 추후 `feature-access` 결과로 숨김 연동 가능(별도 작업). 본 설계는 **백엔드 강제**가 본질.

---

## 4. 시드 (P1)

`apps/api/prisma/seeds/feature-access.seed.cjs` — **선택적**. 기본 동작은 시드 없이 `defaultRoles` 로 동작(무중단). 시드는 데모용 오버라이드 예시만(없어도 됨). → P1에서는 시드 생략, defaultRoles 폴백으로 충분.

---

## 5. 테스트 / 검증

### 5.1 단위 (can 규칙)
| 케이스 | 기대 |
|--------|------|
| ADMIN + denies에 포함 | 허용 (규칙1 우선) |
| userId ∈ denies | 차단 |
| userId ∈ grants, role 미허용 | 허용 |
| roles 미설정, defaultRoles 포함 역할 | 허용 |
| roles 미설정, 비포함 역할 | 차단 |
| roles={DOCTOR:false}, DOCTOR | 차단 |

### 5.2 HTTP E2E (P3)
- CRM_STAFF → `/consult` 200 (기본), deny 추가 후 403, deny 제거 후 200.
- DOCTOR → `/terminal/admin` 403 → grant 추가 후 200.
- ADMIN → 항상 200.
- 기존 회귀: 오버라이드 없을 때 7개 기능 전부 현행과 동일 동작.

### 5.3 code-analyzer
- 가드 주입 누락, any, IDOR 재검.

---

## 6. 구현 순서 (파일 단위)

**P1**
1. `feature-registry.ts`
2. `feature-access.service.ts`
3. `require-feature.decorator.ts`, `feature-access.guard.ts`
4. `access-control.controller.ts` EP 3종 + module provider/export
5. `nest build`

**P2**
6. `access-control/page.tsx` 탭 + `FeatureAccessTab`
7. 빌드·배포 `--web`

**P3**
8. `ConsultAgentGuard` 선행 게이트 + ConsultModule import
9. credential/terminal/btg/executive `@RequireFeature` 부착 + module 배선
10. E2E + code-analyzer + `nest build` + 배포 `--api`

---

## 7. 롤백
- FE 탭/EP는 가산적(기존 미변경) → 즉시 롤백 가능.
- P3 가드 위임은 `defaultRoles=현행@Roles` 라 동작 동일 → 문제 시 `@RequireFeature`/선행 게이트 코드만 제거.
