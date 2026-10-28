import { BadRequestException, Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Request, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsArray, ArrayMaxSize, MaxLength, IsIn, IsOptional, IsDateString } from 'class-validator';
import { UserRole } from '@prisma/client';
import { HospitalInfoService } from './hospital-info.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TranslationService } from '../i18n/translation.service';

// ── 관리자 API (인증 필수) ──

/**
 * 🔴 (2026-09-15 B7) 콘텐츠 상태 변경이 인라인 타입이라 **아무 상태 문자열이나** 저장됐다 — 소문자 `published` 는
 *    `isActive=false` 로 숨겨지고, 예약 발행 크론(SCHEDULED→PUBLISHED→ARCHIVED)도 줍지 않아 영영 어느 상태도 아니었다.
 *    어휘는 이 EP 설명과 크론이 쓰는 4종. 날짜는 형식 밖이면 Invalid Date(Prisma 500) → 400.
 */
export const HOSPITAL_INFO_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] as const;
export class UpdateHospitalInfoStatusDto {
  @IsIn(HOSPITAL_INFO_STATUSES) status!: string;
  @IsOptional() @IsDateString() publishFrom?: string;
  @IsOptional() @IsDateString() publishUntil?: string;
}

@ApiTags('Hospital Info (병원 정보 관리)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/hospital-info')
export class HospitalInfoController {
  constructor(private readonly svc: HospitalInfoService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '콘텐츠 전체 조회' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(@Query('category') category?: string, @Query('search') search?: string) {
    return { data: await this.svc.findAll({ category, search }) };
  }

  @Get('export/all')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CMS 전체 내보내기 (JSON)' })
  async exportAll() {
    return { data: await this.svc.exportAll() };
  }

  @Post('revalidate-homepage')
  @Roles(UserRole.ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: '홈페이지 콘텐츠 즉시 반영(On-demand ISR·재빌드 없음)' })
  async revalidateHomepage(@Body() body: { paths?: string[]; all?: boolean }) {
    return { data: await this.svc.revalidateHomepage({ paths: body?.paths, all: body?.all }) };
  }

  @Post('deploy-homepage')
  @Roles(UserRole.ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '홈페이지 배포(코드/디자인 변경·CI 빌드·S3 발행 트리거)' })
  async deployHomepage() {
    return { data: await this.svc.deployHomepage() };
  }

  @Get('deploy-homepage/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '최근 홈페이지 배포 실행 상태' })
  async deployHomepageStatus() {
    return { data: await this.svc.homepageDeployStatus() };
  }

  // ⚠️ 리터럴 라우트는 ':id' 와일드카드보다 위에 선언(선점 방지 — 'seo'가 ParseUUIDPipe 400 나던 버그)
  @Get('seo')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'SEO 메타데이터 전체 조회' })
  async getSeoEntries() {
    return { data: await this.svc.getSeoEntries() };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '콘텐츠 상세' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.findById(id) };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '콘텐츠 등록' })
  async create(
    @Body() body: { category: string; slug: string; title: string; content: string; metadata?: Record<string, unknown>; sortOrder?: number; tags?: string[]; imageUrl?: string; publishFrom?: string; publishUntil?: string; isPinned?: boolean; editableDepts?: string[] },
    @Request() req: { user: { id: string } },
  ) {
    return { data: await this.svc.create(body, req.user.id) };
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '콘텐츠 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { title?: string; content?: string; metadata?: Record<string, unknown>; sortOrder?: number; tags?: string[]; imageUrl?: string; publishFrom?: string; publishUntil?: string; isPinned?: boolean; editableDepts?: string[] },
    @Request() req: { user: { id: string } },
  ) {
    return { data: await this.svc.update(id, body, req.user.id) };
  }

  @Patch(':id/toggle')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '활성/비활성 토글' })
  async toggle(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: { id: string } }) {
    return { data: await this.svc.toggle(id, req.user.id) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '삭제 (소프트 삭제 → 휴지통)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: { id: string } }) {
    return { data: await this.svc.softDelete(id, req.user.id) };
  }

  @Patch(':id/restore')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '휴지통에서 복원' })
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.restore(id) };
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '상태 변경 (DRAFT/SCHEDULED/PUBLISHED/ARCHIVED)' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHospitalInfoStatusDto,
  ) {
    return { data: await this.svc.updateStatus(id, dto.status, dto.publishFrom, dto.publishUntil) };
  }

  @Post('bulk')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '일괄 등록 (시드 데이터)' })
  async bulkCreate(
    @Body() body: { items: Array<{ category: string; slug: string; title: string; content: string; metadata?: Record<string, unknown>; sortOrder?: number; tags?: string[] }> },
    @Request() req: { user: { id: string } },
  ) {
    return { data: await this.svc.bulkCreate(body.items, req.user.id) };
  }

  // ── 변경이력 ──

  @Get(':id/history')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '콘텐츠 변경이력 조회' })
  async getHistory(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getHistory(id) };
  }

  @Post(':id/restore/:auditId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '이전 버전으로 복원' })
  async restoreVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('auditId', ParseUUIDPipe) auditId: string,
    @Request() req: { user: { id: string } },
  ) {
    return { data: await this.svc.restoreVersion(id, auditId, req.user.id) };
  }

  // ── 내보내기/가져오기 ──

  @Post('import/all')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CMS 전체 가져오기 (JSON)' })
  async importAll(
    @Body() body: { contents: Array<{ category: string; slug: string; title: string; content: string; metadata?: Record<string, unknown>; sortOrder?: number; isActive?: boolean; imageUrl?: string; tags?: string[]; isPinned?: boolean }> },
    @Request() req: { user: { id: string } },
  ) {
    return { data: await this.svc.importAll(body, req.user.id) };
  }

  // ── 의사 프로필 관리 ──

  @Get('doctors/profiles')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '의사 프로필 목록' })
  @ApiQuery({ name: 'department', required: false })
  async getDoctorProfiles(@Query('department') department?: string) {
    return { data: await this.svc.getDoctorProfiles(department) };
  }

  @Post('doctors/:userId/profile')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '의사 프로필 등록/수정' })
  async upsertDoctorProfile(
    @Param('userId') userId: string,
    @Body() body: { position?: string; education?: string[]; career?: string[]; certifications?: string[]; research?: string[]; languages?: string[]; introduction?: string; photoUrl?: string; scheduleNote?: string; isPublic?: boolean },
  ) {
    return { data: await this.svc.upsertDoctorProfile(userId, body) };
  }

  // ── SEO 관리 ── (전체 조회 GET 'seo'는 ':id' 선점 방지 위해 상단으로 이동)

  /**
   * 🔴 W9 실결함: `seo/:path` 는 **한 세그먼트만** 매칭한다. 관리 화면이 편집하는 경로의 절반
   * (`/care/departments`·`/care/centers`·`/care/doctors`)은 `PUT /seo/care/departments` 가 되어
   * 라우트에 닿지도 못하고 404 → 화면엔 '저장에 실패했습니다' 만 떴다(운영 seo 설정 0행이 그 결과).
   * 경로는 세그먼트가 아니라 **값**이므로 쿼리로 받는다. 구 라우트는 단일 세그먼트 호환용으로 남긴다.
   */
  @Get('seo-entry')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'SEO 메타데이터 단건 조회(다중 세그먼트 경로 지원)' })
  @ApiQuery({ name: 'path', required: true, description: '예: /care/departments' })
  async getSeoEntryByQuery(@Query('path') path: string) {
    return { data: await this.svc.getSeoForPath(this.normalizeSeoPath(path)) };
  }

  @Put('seo-entry')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'SEO 메타데이터 저장(다중 세그먼트 경로 지원)' })
  @ApiQuery({ name: 'path', required: true, description: '예: /care/departments' })
  async upsertSeoEntryByQuery(
    @Query('path') path: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.svc.upsertSeoEntry(this.normalizeSeoPath(path), body);
    return { data: { message: 'SEO 메타데이터가 저장되었습니다.' } };
  }

  /** `/home`·`home` 을 모두 받되 저장 키는 항상 선행 슬래시 하나로 정규화(정본이 갈라지지 않게) */
  private normalizeSeoPath(raw: string): string {
    const p = String(raw ?? '').trim();
    if (!p) throw new BadRequestException('경로(path)가 필요합니다');
    if (p.includes('..') || p.includes('\0')) throw new BadRequestException('경로가 올바르지 않습니다');
    const norm = '/' + p.split('/').filter(Boolean).join('/');
    if (norm.length > 80) throw new BadRequestException('경로가 너무 깁니다');
    return norm;
  }

  @Get('seo/:path')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'SEO 메타데이터 단건 조회(단일 세그먼트 · 구 경로)' })
  async getSeoEntry(@Param('path') path: string) {
    return { data: await this.svc.getSeoForPath(this.normalizeSeoPath(path)) };
  }

  @Put('seo/:path')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'SEO 메타데이터 저장(단일 세그먼트 · 구 경로)' })
  async upsertSeoEntry(
    @Param('path') path: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.svc.upsertSeoEntry(this.normalizeSeoPath(path), body);
    return { data: { message: 'SEO 메타데이터가 저장되었습니다.' } };
  }
}

// ── 공개 API (인증 불필요) ──

class PublicTranslateDto {
  @IsArray() @ArrayMaxSize(80) @IsString({ each: true }) @MaxLength(1000, { each: true }) texts!: string[];
  @IsString() target!: string;
}

@ApiTags('Public Hospital Info (공개 병원 정보)')
@Controller('api/v1/public')
export class PublicHospitalInfoController {
  constructor(private readonly svc: HospitalInfoService, private readonly t: TranslationService) {}

  @Post('translate')
  @Throttle({ default: { ttl: 60000, limit: 400 } })
  @ApiOperation({ summary: '공개 배치 번역(런타임 자동번역용, 캐시)' })
  async translateBatch(@Body() dto: PublicTranslateDto) {
    const target = dto.target;
    if (!target || target === 'ko') return { data: dto.texts ?? [] };
    const out = await Promise.all((dto.texts ?? []).map((tx) =>
      this.t.translate(tx, target, 'ko').then((r) => r.translated).catch(() => tx),
    ));
    return { data: out };
  }

  /** title(+짧은 plain content) 자동 번역. HTML/장문 content는 안전하게 원문 유지. */
  private async localize<T extends { title?: string; content?: string }>(items: T[], lang?: string): Promise<T[]> {
    if (!lang || lang === 'ko' || !Array.isArray(items)) return items;
    return Promise.all(items.map(async (it) => {
      const out = { ...it } as T;
      try {
        if (it.title) out.title = (await this.t.translate(it.title, lang, 'ko')).translated;
        if (it.content && it.content.length <= 2000 && !/<[a-z!/][\s\S]*>/i.test(it.content)) {
          out.content = (await this.t.translate(it.content, lang, 'ko')).translated;
        }
      } catch { /* 실패 시 원문 */ }
      return out;
    }));
  }
  private async localizeOne<T extends { title?: string; content?: string }>(it: T, lang?: string): Promise<T> {
    return (await this.localize([it], lang))[0];
  }

  @Get('hospital-info')
  @ApiOperation({ summary: '병원 정보 전체 (공개, lang 자동번역)' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'lang', required: false })
  async findPublic(@Query('category') category?: string, @Query('lang') lang?: string) {
    return { data: await this.localize(await this.svc.findPublic(category), lang) };
  }

  @Get('hospital-info/search')
  @ApiOperation({ summary: '병원 정보 검색 (공개)' })
  @ApiQuery({ name: 'q', required: true })
  async search(@Query('q') q: string) {
    return { data: await this.svc.searchPublic(q ?? '') };
  }

  @Get('departments')
  @ApiOperation({ summary: '진료과 목록 (공개, lang)' })
  @ApiQuery({ name: 'lang', required: false })
  async departments(@Query('lang') lang?: string) {
    return { data: await this.localize(await this.svc.findPublic('DEPARTMENT'), lang) };
  }

  @Get('departments/:slug')
  @ApiOperation({ summary: '진료과 상세 (공개, lang)' })
  @ApiQuery({ name: 'lang', required: false })
  async department(@Param('slug') slug: string, @Query('lang') lang?: string) {
    // 🔴 W9: findBySlug(관리자용·필터 없음) 를 쓰면 미발행/휴지통 진료과가 공개로 샌다 → findPublicBySlug
    const dept = await this.svc.findPublicBySlug('DEPARTMENT', slug);
    const meta = dept.metadata as Record<string, unknown>;
    const deptName = (meta?.departmentName as string) ?? dept.title;
    const doctors = await this.svc.getPublicDoctorProfiles(deptName);
    return { data: { ...(await this.localizeOne(dept, lang)), doctors } };
  }

  @Get('centers')
  @ApiOperation({ summary: '센터 목록 (공개, lang)' })
  @ApiQuery({ name: 'lang', required: false })
  async centers(@Query('lang') lang?: string) {
    return { data: await this.localize(await this.svc.findPublic('CENTER'), lang) };
  }

  @Get('news')
  @ApiOperation({ summary: '뉴스/공지 목록 (공개, lang)' })
  @ApiQuery({ name: 'subType', required: false, description: 'NOTICE|PRESS|EVENT|AWARD' })
  @ApiQuery({ name: 'lang', required: false })
  async news(@Query('subType') subType?: string, @Query('lang') lang?: string) {
    let items = await this.svc.findPublic('NEWS');
    if (subType) items = items.filter(i => (i.metadata as Record<string, unknown> | null)?.subType === subType);
    return { data: await this.localize(items, lang) };
  }

  @Get('health-info')
  @ApiOperation({ summary: '건강정보 목록 (공개, lang)' })
  @ApiQuery({ name: 'lang', required: false })
  async healthInfo(@Query('lang') lang?: string) {
    return { data: await this.localize(await this.svc.findPublic('HEALTH_INFO'), lang) };
  }

  @Get('recruit')
  @ApiOperation({ summary: '채용정보 목록 (공개)' })
  async recruit() {
    const items = await this.svc.findPublic('RECRUIT');
    return { data: items };
  }

  @Get('doctors')
  @ApiOperation({ summary: '의사 목록 (공개)' })
  @ApiQuery({ name: 'department', required: false })
  async doctors(@Query('department') department?: string) {
    return { data: await this.svc.getPublicDoctorProfiles(department) };
  }

  @Get('doctors/:userId')
  @ApiOperation({ summary: '의사 상세 (공개 — isPublic·재직자만, 이메일 미노출)' })
  // 🔴 W9 라이브 실측에서 나온 것 — 잘못된 형식의 id 를 주면 Prisma 가 던져 **500 INTERNAL_ERROR** 가 났다.
  //    무인증 공개 EP 가 내부 예외로 답하면 안 된다(형식 오류는 400, 없는 것은 404).
  async doctor(@Param('userId', new ParseUUIDPipe({ errorHttpStatusCode: 400 })) userId: string) {
    // 🔴 W9: getDoctorProfile(관리자용) 은 isPublic 을 무시하고 user.email 을 반환한다 → 공개 전용 메서드
    return { data: await this.svc.getPublicDoctorProfile(userId) };
  }

  @Get('seo/:path')
  @ApiOperation({ summary: '페이지 SEO 메타데이터 (공개)' })
  async getSeoPublic(@Param('path') path: string) {
    return { data: await this.svc.getSeoForPath(`/${path}`) };
  }
}
