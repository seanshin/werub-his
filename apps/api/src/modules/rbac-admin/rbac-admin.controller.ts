import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PermissionService } from '../auth/rbac/permission.service';
import { PermissionOverrideService } from '../auth/rbac/permission-override.service';
import { PERMISSION_CATALOG, uncatalogedPermissions } from '../auth/rbac/permission-catalog';
import { Permission, ROLE_PERMISSIONS } from '../auth/rbac/permission.types';
import { PERMISSION_ENFORCEMENT } from './permission-enforcement.map';
import { AuditService } from '../audit/audit.service';

const ROLE_VALUES = Object.values(UserRole) as string[];

/**
 * 🔴 이 매트릭스가 판정하지 **않는** 권한에 한해, 실제로 무엇이 판정하는지 한 줄로 알린다.
 *    (집행 여부 자체는 기계 스캔 정본 `permission-enforcement.map.ts` 가 정한다 — 여기는 설명뿐)
 *    키가 실제로 미집행인지는 `test/rbac/permission-enforcement.spec.ts` 가 검증한다.
 */
const ENFORCEMENT_NOTES: Record<string, string> = {
  'cred:device:manage': 'CredentialGuard 가 판정 — ADMIN 은 항상 통과, 그 외는 AdminPermissionGrant(사용자별·만료有) 또는 기능접근 매트릭스 credential.admin',
  'cred:cert:issue': 'CredentialGuard 가 판정 — ADMIN 은 항상 통과, 그 외는 AdminPermissionGrant(사용자별·만료有) 또는 기능접근 매트릭스 credential.admin',
  'cred:cert:revoke': 'CredentialGuard 가 판정 — ADMIN 은 항상 통과, 그 외는 AdminPermissionGrant(사용자별·만료有) 또는 기능접근 매트릭스 credential.admin',
  'cred:recovery:approve': 'CredentialGuard 가 판정 — ADMIN 은 항상 통과, 그 외는 AdminPermissionGrant(사용자별·만료有) 또는 기능접근 매트릭스 credential.admin',
  'cred:policy:manage': 'CredentialGuard 가 판정 — ADMIN 은 항상 통과, 그 외는 AdminPermissionGrant(사용자별·만료有) 또는 기능접근 매트릭스 credential.admin',
  'cred:audit:read': 'CredentialGuard 가 판정 — ADMIN 은 항상 통과, 그 외는 AdminPermissionGrant(사용자별·만료有) 또는 기능접근 매트릭스 credential.admin',
  'encounter:view': '진료기록 열람은 encounter 컨트롤러의 @Roles 가 판정한다(의사·간호·관리자·약사)',
  'encounter:edit': '진료기록 수정은 encounter 컨트롤러의 @Roles 가 판정한다(의사·관리자)',
  'encounter:delete': '진료기록 삭제 EP 가 없다(첨부 삭제만 있고 @Roles 로 판정)',
  'prescription:create': '처방 발행은 prescription 컨트롤러의 @Roles + 처방권·서명 게이트가 판정한다',
  'prescription:edit': '처방 수정은 prescription 컨트롤러의 @Roles 가 판정한다',
  'prescription:delete': '처방 취소는 prescription 컨트롤러의 @Roles 가 판정한다(의사·관리자)',
  'order:delete': '오더 도메인은 @Roles 로 통제된다 — 이 권한을 읽는 집행점이 없다',
  'billing:create': '수납·청구는 billing 컨트롤러의 @Roles 가 판정한다',
  'billing:delete': '수납·청구는 billing 컨트롤러의 @Roles 가 판정한다',
  'user:view': '직원 계정 API 는 user 컨트롤러의 @Roles 가 판정한다(클래스 기본 ADMIN)',
  'user:create': '직원 계정 API 는 user 컨트롤러의 @Roles 가 판정한다(클래스 기본 ADMIN)',
  'user:edit': '직원 계정 API 는 user 컨트롤러의 @Roles 가 판정한다(클래스 기본 ADMIN)',
  'user:delete': '직원 계정 API 는 user 컨트롤러의 @Roles 가 판정한다(클래스 기본 ADMIN)',
  'audit:export': '감사 API 는 audit 컨트롤러의 @Roles(ADMIN) 로 통제된다 — 별도 반출 EP 는 없다',
  'pacs:admin': 'PACS 시스템 설정은 OpenPACS(별도 프로젝트) 소관 — HIS 에 집행점이 없다',
};

class SetOverrideDto {
  @IsIn(ROLE_VALUES) role!: UserRole;
  @IsString() @MaxLength(60) permission!: string;
  /** null = 오버라이드 해제(코드 기본값으로 복귀) */
  @IsOptional() @IsBoolean() allow?: boolean | null;
}

class ResetDto {
  @IsOptional() @IsIn(ROLE_VALUES) role?: UserRole;
}

/**
 * 역할×권한 관리 — 관리 화면이 읽고 쓰는 단일 창구.
 * 기본 매트릭스(코드)와 오버라이드(DB)를 함께 내려, 화면이 "기본값 대비 무엇이 바뀌었는지"를 보여줄 수 있게 한다.
 */
@ApiTags('Admin RBAC (역할 권한)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/admin/rbac')
export class RbacAdminController {
  constructor(
    private readonly permissions: PermissionService,
    private readonly overrides: PermissionOverrideService,
    private readonly audit: AuditService,
  ) {}

  @Get('matrix')
  @ApiOperation({ summary: '역할×권한 매트릭스(카탈로그·기본값·오버라이드·유효값·집행 여부)' })
  async matrix() {
    const roles = Object.values(UserRole);
    // 🔴 집행 대조표를 함께 내린다 — 화면이 "이 토글은 실제로 무엇을 바꾸는가"를 말할 수 있어야 한다.
    //    (원 결함: 켜도 꺼도 달라지는 API 가 없는 권한을 화면이 평범한 토글로 보여줬다)
    const enforcement = Object.fromEntries(
      Object.values(Permission).map((p) => {
        const e = PERMISSION_ENFORCEMENT[p as string] ?? { mode: 'none' as const, count: 0, files: [] };
        return [p as string, { ...e, note: ENFORCEMENT_NOTES[p as string] ?? null }];
      }),
    );
    return {
      data: {
        domains: PERMISSION_CATALOG,
        roles: roles.map((r) => ({
          key: r,
          /** 🔴 관리자는 오버라이드 대상이 아니다(스스로 잠그는 사고 방지) */
          locked: r === UserRole.ADMIN,
          defaults: [...(ROLE_PERMISSIONS[r] ?? new Set())],
          effective: this.permissions.effectivePermissions(r),
        })),
        overrides: this.overrides.all(),
        /** 카탈로그에 라벨이 없는 권한 — 있으면 화면에 '설명 없음'으로 뜬다 */
        uncataloged: uncatalogedPermissions(Object.values(Permission)),
        /** 권한별 실제 집행 등급(matrix / other-guard / none) — 기계 스캔 정본 */
        enforcement,
        enforcementSummary: {
          total: Object.keys(enforcement).length,
          matrix: Object.values(enforcement).filter((e) => e.mode === 'matrix').length,
          otherGuard: Object.values(enforcement).filter((e) => e.mode === 'other-guard').length,
          none: Object.values(enforcement).filter((e) => e.mode === 'none').length,
        },
      },
    };
  }

  @Put('override')
  @ApiOperation({ summary: '역할 권한 오버라이드 설정/해제(allow=null 이면 기본값 복귀)' })
  async setOverride(@Body() dto: SetOverrideDto, @CurrentUser('id') userId: string) {
    const before = this.permissions.effectivePermissions(dto.role).find((p) => p.key === dto.permission);
    const map = await this.overrides.set(dto.role, dto.permission, dto.allow ?? null, userId);
    // 권한 변경은 그 자체가 감사 대상(누가 어떤 역할에 무엇을 열고 닫았는지)
    void this.audit
      .log({
        userId,
        action: 'UPDATE',
        resourceType: 'RbacRoleOverride',
        resourceId: userId,
        changes: {
          role: { old: null, new: dto.role },
          permission: { old: before?.allowed ?? null, new: dto.allow ?? '(기본값 복귀)' },
        },
      })
      .catch(() => {});
    // 🔴 집행되지 않는 권한을 저장했으면 그 사실을 응답에 담는다 — 화면이 "저장됨"만 보여주면
    //    관리자는 차단·허용이 실제로 걸린 줄 안다(근거 없이 안심시킴).
    const enf = PERMISSION_ENFORCEMENT[dto.permission];
    return {
      data: {
        overrides: map,
        effective: this.permissions.effectivePermissions(dto.role),
        enforced: (enf?.mode ?? 'none') === 'matrix',
        enforcementMode: enf?.mode ?? 'none',
        enforcementNote: ENFORCEMENT_NOTES[dto.permission] ?? null,
      },
    };
  }

  @Post('reset')
  @ApiOperation({ summary: '오버라이드 초기화(역할 지정 시 그 역할만)' })
  async reset(@Body() dto: ResetDto, @CurrentUser('id') userId: string) {
    const map = await this.overrides.reset(dto.role);
    void this.audit
      .log({ userId, action: 'UPDATE', resourceType: 'RbacRoleOverride', resourceId: userId,
             changes: { reset: { old: null, new: dto.role ?? '전체' } } })
      .catch(() => {});
    return { data: { overrides: map } };
  }
}
