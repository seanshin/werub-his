import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, Optional, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { QualityService } from './quality.service';
import { CreateIndicatorDto, CreateMeasurementDto, UpdateIndicatorDto, UpdateMeasurementDto, VoidMeasurementDto } from './dto/quality.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * 질 지표(QI) API — **누가 이 일을 실제로 하는가**로 가른다(2026-08-18).
 *
 * 🔴 종전: 입력·정정·무효화가 전부 `@Roles(UserRole.ADMIN)` 단독이었다. 운영 실측(계정 102개)에서
 *    ADMIN 은 **2개**뿐이고 그중 하나는 원무과 소속이다. 반면 25지표 중 감염관리 4·환자안전 6 =
 *    10지표의 산출 주체는 감염관리실·환자안전 전담인력(= 이 저장소의 `NURSE`)이다.
 *    **지표를 만드는 사람이 지표를 넣을 수 없는** 상태였다.
 *
 * 이제 세 갈래로 나눈다 —
 *  ① **지표 정의**(등록·방향/단위/배율/목표 수정) = `@Roles(ADMIN)` **유지**. 이것을 바꾸면
 *    저장된 전 기간의 달성 판정이 통째로 뒤집힌다(읽는 시점 재판정) — 규칙을 바꾸는 행위다.
 *  ② **측정 입력·정정** = `QI_MEASURE_WRITE`(기본: ADMIN·NURSE). 집계 수치이며 PHI 가 없다.
 *  ③ **무효화** = `QI_MEASURE_VOID`(기본: ADMIN). ②보다 **엄격하다** — 근거는 permission.types.ts.
 *
 * 🔴 읽기 역할은 **넓히지 않았다**(ADMIN·DOCTOR·NURSE 유지). 다른 역할에 ②를 오버라이드로 켜려면
 *    (i) 이 읽기 목록 (ii) `Sidebar` 의 `/quality` roles 까지 **한 벌로** 열어야 한다 —
 *    권한만 켜면 화면에 닿지 못해 '있는데 안 되는 권한'이 된다.
 */
@ApiTags('Quality (QI/질향상)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/quality')
export class QualityController {
  constructor(
    private readonly service: QualityService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  @Get('indicators')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '질 지표 목록' })
  async getIndicators() { return { data: await this.service.getIndicators() }; }

  @Post('indicators')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '질 지표 등록' })
  async create(@Body() dto: CreateIndicatorDto, @CurrentUser('id') userId: string) {
    // 결정 qi.indicator.directEdit — 화면 경로만(위원회 집행은 서비스 직접)
    await this.service.guardDirectEdit({ create: true, fields: [], changeReason: dto.changeReason });
    const { changeReason, ...rest } = dto;
    const created = await this.service.createIndicator(rest);
    this.events?.emit('qi.indicator.directEdit', { indicatorId: created.id, name: created.name, fields: ['create'], reason: changeReason ?? null, actorId: userId });
    return { data: created };
  }

  /**
   * 🔴 지표 방향·단위·배율 등재 경로. 종전에는 방향이 코드 등재표에만 있어 관리자가 화면에서 만든
   *    지표는 **코드 배포 전까지 판정 불가**였다(측정 입력이 422 로 막혔다).
   */
  @Patch('indicators/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '질 지표 수정 (방향·단위·배율 등재)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIndicatorDto, @CurrentUser('id') userId: string) {
    const { changeReason, ...patch } = dto;
    const fields = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    const g = await this.service.guardDirectEdit({ fields, changeReason });
    const updated = await this.service.updateIndicator(id, patch);
    if (g.definitionChange) this.events?.emit('qi.indicator.directEdit', { indicatorId: id, name: updated.name, fields, reason: changeReason ?? null, actorId: userId });
    return { data: updated };
  }

  @Post('measurements')
  @RequirePermission(Permission.QI_MEASURE_WRITE)
  @ApiOperation({ summary: '측정값 입력 (qi:measure:write)' })
  async measure(@Body() dto: CreateMeasurementDto, @CurrentUser('id') userId: string) {
    // 화면 입력 = 출처 MANUAL(기본) 또는 EXTERNAL(외부 기관 통보 결과 · 통보 문서·번호 필수) · 기록자
    const { source, externalRef, ...rest } = dto;
    if (source === 'EXTERNAL' && !(externalRef && externalRef.trim().length >= 3)) {
      throw new BadRequestException({ code: 'QI_EXTERNAL_REF_REQUIRED', message: '외부 결과는 통보 문서·번호를 함께 적어주세요' });
    }
    return {
      data: await this.service.addMeasurement({
        ...rest, source: source === 'EXTERNAL' ? 'EXTERNAL' : 'MANUAL', createdBy: userId,
        ...(source === 'EXTERNAL' ? { evidence: { externalRef: externalRef!.trim() } } : {}),
      }),
    };
  }

  @Get('measurements/:indicatorId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '지표별 측정 추이 (무효화분은 includeVoided=true 로만)' })
  async getMeasurements(
    @Param('indicatorId', ParseUUIDPipe) id: string,
    @Query('includeVoided') includeVoided?: string,
  ) {
    return { data: await this.service.getMeasurements(id, includeVoided === 'true') };
  }

  /**
   * 🔴 측정값 정정 — 종전에는 **오기를 고칠 방법이 없었다.**
   *    같은 기간을 다시 넣으면 별도 행으로 쌓여 어느 것이 맞는지 알 수 없었다(유니크 제약으로 차단).
   */
  @Patch('measurements/:id')
  @RequirePermission(Permission.QI_MEASURE_WRITE)
  @ApiOperation({ summary: '측정값 정정 (값·판정 재산출 · qi:measure:write)' })
  async updateMeasurement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMeasurementDto,
  ) {
    return { data: await this.service.updateMeasurement(id, dto) };
  }

  /**
   * 🔴 무효화 — **지우지 않는다.** QI 는 인증·대외 보고 근거라 "무엇이 있었는지"가 남아야 한다.
   *    하드 삭제하면 그 기간이 애초에 미측정이었는지, 잘못 넣었다 지운 것인지 구분할 수 없다.
   */
  @Patch('measurements/:id/void')
  @RequirePermission(Permission.QI_MEASURE_VOID)
  @ApiOperation({ summary: '측정값 무효화 (사유 필수·이력 보존 · qi:measure:void)' })
  async voidMeasurement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidMeasurementDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.voidMeasurement(id, userId, dto.reason) };
  }

  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'QI 대시보드 (전체 지표 + 최신값)' })
  async getDashboard() { return { data: await this.service.getDashboard() }; }
}
