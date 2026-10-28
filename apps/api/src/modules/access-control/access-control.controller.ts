import { Controller, Get, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AccessControlService } from './access-control.service';
import { FeatureAccessService } from './feature-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetDeptAccessDto, SetRoleDataAccessDto, SetPacsAccessDto, SetUserPacsOverrideDto, SetFeatureAccessDto } from './dto/access-control.dto';
import { MenuCustomDto, MenuOverridesDto } from './dto/menu-config.dto';

@ApiTags('Access Control')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/access-control')
export class AccessControlController {
  constructor(
    private readonly svc: AccessControlService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  @Get('menu-paths')
  // 🔴 (2026-09-16 D4) 관리 화면 전용 설정 조회인데 무역할이었다 — Sidebar 가 부르는 내 메뉴 조회와 성격이 다르다
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '전체 메뉴 목록 조회' })
  async getMenuPaths() {
    return { data: this.svc.getMenuPaths() };
  }

  @Get('departments')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '부서별 접근 권한 현황' })
  async getDepartments() {
    return { data: await this.svc.getDepartments() };
  }

  @Get('dept-access')
  @ApiOperation({ summary: '전체 부서 접근 설정 (사이드바용)' })
  async getAllDeptAccess() {
    return { data: await this.svc.getAllDeptAccess() };
  }

  @Get('menu-overrides')
  @ApiOperation({ summary: '사이드바 메뉴 오버라이드(구성·권한) — 사이드바용' })
  async getMenuOverrides() {
    return { data: await this.svc.getMenuOverrides() };
  }

  @Put('menu-overrides')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사이드바 메뉴 구성·권한 오버라이드 저장(관리자)' })
  async setMenuOverrides(
    @Body() body: MenuOverridesDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.setMenuOverrides(body.overrides ?? {}, userId) };
  }

  @Get('menu-custom')
  @ApiOperation({ summary: '사용자 정의(커스텀) 메뉴 조회 — 사이드바용' })
  async getMenuCustom() {
    return { data: await this.svc.getMenuCustom() };
  }

  @Put('menu-custom')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사용자 정의 메뉴 생성·수정·삭제(관리자, 전체 배열 교체)' })
  async setMenuCustom(
    @Body() body: MenuCustomDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.setMenuCustom(body.items ?? [], userId) };
  }

  // 커스텀 콘텐츠 페이지(/custom/<slug>) — 커스텀 메뉴 내부 목적지(404 방지)
  @Get('custom-pages/:slug')
  @ApiOperation({ summary: '커스텀 페이지 내용 조회(인증된 직원)' })
  async getCustomPage(@Param('slug') slug: string) {
    return { data: await this.svc.getCustomPage(slug) };
  }

  @Put('custom-pages/:slug')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '커스텀 페이지 내용 저장(관리자)' })
  async setCustomPage(@Param('slug') slug: string, @Body() body: { title?: string; content?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.svc.setCustomPage(slug, body, userId) };
  }

  @Get('dept-access/:department')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '부서별 접근 권한 상세' })
  async getDeptAccess(@Param('department') department: string) {
    return { data: await this.svc.getDeptAccess(department) };
  }

  @Put('dept-access/:department')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '부서별 접근 권한 설정' })
  async setDeptAccess(
    @Param('department') department: string,
    @Body() body: SetDeptAccessDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.svc.setDeptAccess(department, body.allowedPaths, userId);
    return { data: result };
  }

  @Delete('dept-access/:department')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '부서별 접근 권한 초기화 (기본값 복원)' })
  async deleteDeptAccess(@Param('department') department: string) {
    await this.svc.deleteDeptAccess(department);
    return { data: { reset: true, department } };
  }

  // ── 역할별 데이터 접근 권한 ──

  @Get('data-access-fields')
  // 🔴 (2026-09-16 D4) 관리 화면 전용 설정 조회인데 무역할이었다 — Sidebar 가 부르는 내 메뉴 조회와 성격이 다르다
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '데이터 접근 권한 항목 정의' })
  async getDataAccessFields() {
    return { data: this.svc.getDataAccessFields() };
  }

  @Get('role-data-access')
  @ApiOperation({ summary: '전체 역할별 데이터 접근 설정' })
  async getAllRoleDataAccess() {
    return { data: await this.svc.getAllRoleDataAccess() };
  }

  @Get('role-data-access/:role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '역할별 데이터 접근 상세' })
  async getRoleDataAccess(@Param('role') role: string) {
    return { data: await this.svc.getRoleDataAccess(role) };
  }

  @Put('role-data-access/:role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '역할별 데이터 접근 설정' })
  async setRoleDataAccess(@Param('role') role: string, @Body() body: SetRoleDataAccessDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.setRoleDataAccess(role, body.permissions, userId) };
  }

  @Delete('role-data-access/:role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '역할별 데이터 접근 초기화' })
  async resetRoleDataAccess(@Param('role') role: string) {
    await this.svc.resetRoleDataAccess(role);
    return { data: { reset: true, role } };
  }

  // ── PACS 권한 관리 ──

  @Get('pacs/permissions')
  // 🔴 (2026-09-16 D4) 관리 화면 전용 설정 조회인데 무역할이었다 — Sidebar 가 부르는 내 메뉴 조회와 성격이 다르다
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'PACS 권한 항목 정의' })
  async getPacsPermissionFields() {
    return { data: this.svc.getPacsPermissionFields() };
  }

  @Get('pacs/access')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '전체 역할별 PACS 접근 설정' })
  async getAllPacsAccess() {
    return { data: await this.svc.getAllPacsAccess() };
  }

  @Get('pacs/access/:role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '역할별 PACS 접근 상세' })
  async getPacsAccess(@Param('role') role: string) {
    return { data: await this.svc.getPacsAccess(role) };
  }

  @Put('pacs/access/:role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '역할별 PACS 접근 설정' })
  async setPacsAccess(
    @Param('role') role: string,
    @Body() body: SetPacsAccessDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.setPacsAccess(role, body.permissions, userId) };
  }

  @Delete('pacs/access/:role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'PACS 접근 초기화 (기본값 복원)' })
  async resetPacsAccess(@Param('role') role: string) {
    await this.svc.resetPacsAccess(role);
    return { data: { reset: true, role } };
  }

  // ── 사용자 개별 PACS 권한 ──

  @Get('pacs/user/:userId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사용자 개별 PACS 권한 조회' })
  async getUserPacsOverride(@Param('userId') userId: string) {
    return { data: await this.svc.getUserPacsOverride(userId) };
  }

  @Put('pacs/user/:userId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사용자 개별 PACS 권한 설정 (역할 오버라이드)' })
  async setUserPacsOverride(
    @Param('userId') userId: string,
    @Body() body: SetUserPacsOverrideDto,
    @CurrentUser('id') adminId: string,
  ) {
    return { data: await this.svc.setUserPacsOverride(userId, body.permissions, adminId) };
  }

  @Delete('pacs/user/:userId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사용자 개별 PACS 권한 초기화 (역할 기본으로 복원)' })
  async resetUserPacsOverride(@Param('userId') userId: string) {
    await this.svc.resetUserPacsOverride(userId);
    return { data: { reset: true, userId } };
  }

  @Get('pacs/check/:userId/:permission')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '사용자 PACS 특정 권한 확인' })
  async checkPacsPermission(
    @Param('userId') userId: string,
    @Param('permission') permission: string,
  ) {
    // userId로 사용자 역할 조회
    const user = await this.svc['prisma'].user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) return { data: { allowed: false, reason: 'user_not_found' } };
    const allowed = await this.svc.checkPacsPermission(userId, user.role, permission);
    return { data: { allowed, userId, permission, role: user.role } };
  }

  // ── 기능별 접근 권한 매트릭스 ──

  @Get('feature-access')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기능 접근 매트릭스 전체 조회 (기능 카탈로그 + 오버라이드)' })
  async getFeatureAccessMatrix() {
    return { data: await this.featureAccess.listMatrix() };
  }

  @Put('feature-access/:key')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기능별 접근 권한 설정 (역할 매트릭스 + grant/deny)' })
  async setFeatureAccess(
    @Param('key') key: string,
    @Body() body: SetFeatureAccessDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.featureAccess.setConfig(key, body, userId) };
  }

  @Delete('feature-access/:key')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기능별 접근 권한 초기화 (기본값 복원)' })
  async resetFeatureAccess(@Param('key') key: string) {
    await this.featureAccess.resetConfig(key);
    return { data: { reset: true, key } };
  }
}
