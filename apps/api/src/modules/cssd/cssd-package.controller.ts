import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CssdPackageService } from './cssd-package.service';
import { CreateLoadDto, ReleaseLoadDto } from './dto/cssd.dto';
import { RepackageDto } from './dto/cssd-unit.dto';
import { CssdEventNoteDto, UsePackageDto } from './dto/cssd-inventory-write.dto';

@ApiTags('CSSD 재포장·패키지')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/cssd')
export class CssdPackageController {
  constructor(private readonly svc: CssdPackageService) {}

  // 트레이 마스터
  @Get('templates')
  @ApiOperation({ summary: '트레이 마스터 목록' })
  listTemplates() { return this.svc.listTemplates().then((data) => ({ data })); }
  @Post('templates')
  @ApiOperation({ summary: '트레이 마스터 생성' })
  createTemplate(@Body() body: { name: string; category?: string; packagingType?: string; shelfLifeDays?: number; items: { name: string; qty: number }[] }) {
    return this.svc.createTemplate(body).then((data) => ({ data }));
  }
  @Patch('templates/:id')
  @ApiOperation({ summary: '트레이 마스터 수정' })
  updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() body: { category?: string; packagingType?: string; shelfLifeDays?: number; items?: object; isActive?: boolean }) {
    return this.svc.updateTemplate(id, body).then((data) => ({ data }));
  }

  // 재포장
  @Post('repackage')
  @ApiOperation({ summary: '재포장 — 조립·카운트 검증 후 LOT 패키지 생성(기구 개체 연결 선택 · 수명 한도 도달은 경고만)' })
  repackage(@Body() body: RepackageDto, @CurrentUser('id') userId: string) {
    return this.svc.repackage({ ...body, userId }).then((data) => ({ data }));
  }

  // 패키지
  @Get('packages')
  @ApiOperation({ summary: '멸균 패키지 목록' })
  listPackages(@Query('status') status?: string) { return this.svc.listPackages(status).then((data) => ({ data })); }
  @Get('packages/:id')
  @ApiOperation({ summary: '패키지 상세(추적 타임라인)' })
  getPackage(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getPackage(id).then((data) => ({ data })); }
  @Post('packages/:id/use')
  @ApiOperation({ summary: '출고·사용(사용처 연결)' })
  use(@Param('id', ParseUUIDPipe) id: string, @Body() body: UsePackageDto, @CurrentUser('id') userId: string) {
    return this.svc.usePackage(id, userId, body?.encounterId).then((data) => ({ data }));
  }
  @Post('packages/:id/return')
  @ApiOperation({ summary: '반납' })
  ret(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) { return this.svc.returnPackage(id, userId).then((data) => ({ data })); }
  @Post('packages/:id/recall')
  @ApiOperation({ summary: '리콜' })
  recall(@Param('id', ParseUUIDPipe) id: string, @Body() body: CssdEventNoteDto, @CurrentUser('id') userId: string) {
    return this.svc.recallPackage(id, userId, body?.note).then((data) => ({ data }));
  }

  // 멸균 로드
  @Get('loads')
  @ApiOperation({ summary: '멸균 로드 목록' })
  listLoads() { return this.svc.listLoads().then((data) => ({ data })); }
  @Post('loads')
  @ApiOperation({ summary: '멸균 로드 생성(패키지 투입)' })
  createLoad(@Body() body: CreateLoadDto, @CurrentUser('id') userId: string) {
    return this.svc.createLoad({ ...body, userId }).then((data) => ({ data }));
  }
  @Post('loads/:id/release')
  @ApiOperation({ summary: 'BI/CI 판독 → BI·CI 모두 PASS 시 일괄 멸균완료, 그 외 회수' })
  release(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReleaseLoadDto, @CurrentUser('id') userId: string) {
    return this.svc.releaseLoad(id, { ...body, userId }).then((data) => ({ data }));
  }
  @Post('loads/:id/recall')
  @ApiOperation({ summary: '지연양성 BI 로드 회수(전 패키지 RECALLED·사용 환자 감염추적)' })
  recallLoad(@Param('id', ParseUUIDPipe) id: string, @Body() body: CssdEventNoteDto, @CurrentUser('id') userId: string) {
    return this.svc.recallLoad(id, userId, body?.note).then((data) => ({ data }));
  }

  @Get('package-stats')
  @ApiOperation({ summary: '패키지 통계' })
  stats() { return this.svc.stats().then((data) => ({ data })); }
}
