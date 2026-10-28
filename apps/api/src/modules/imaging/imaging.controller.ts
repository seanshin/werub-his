import { Controller, Get, Patch, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ImagingService } from './imaging.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { AcquireImagingDto, ReportImagingDto, CancelAcquisitionDto, RecordRadiationDoseDto } from './dto/imaging-result.dto';
import { ImagingSafetyService } from './imaging-safety.service';
import { AuditAiRead } from '../audit/no-audit.decorator';

@ApiTags('Imaging')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.LAB_TECH, UserRole.DOCTOR)
@Controller('api/v1/imaging')
export class ImagingController {
  constructor(
    private readonly imagingService: ImagingService,
    private readonly imagingSafety: ImagingSafetyService,
  ) {}

  @Get('queue')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '영상 대기열' })
  @ApiResponse({ status: 200, description: '영상 대기열 조회 성공' })
  async getQueue() {
    return { data: await this.imagingService.getQueue() };
  }

  @Patch(':orderId/acquire')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '촬영 완료' })
  @ApiResponse({ status: 200, description: '촬영 완료 성공' })
  async acquire(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: AcquireImagingDto,
    @CurrentUser('id') userId: string,
  ) {
    return {
      data: await this.imagingService.acquire(
        orderId,
        dto.modality,
        dto.bodyPart,
        dto.notes,
        userId,
        {
          overrideSafety: dto.overrideSafety, overrideReason: dto.overrideReason,
          dlp: dto.dlp, ctdiVol: dto.ctdiVol,
          doseAreaProduct: dto.doseAreaProduct, effectiveDoseMsv: dto.effectiveDoseMsv,
        },
      ),
    };
  }

  @Get('orders/:orderId/safety-precheck')
  // 클래스 레벨 @Roles(ADMIN·LAB_TECH·DOCTOR) 는 간호사를 배제한다 — 핸들러 레벨이 이를 덮어쓴다.
  // 환자를 준비·이송하는 주체가 간호사이므로 이 읽기 전용 확인은 간호사에게 열려야 한다.
  @Roles(UserRole.ADMIN, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.NURSE)
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '이송 전 안전 사전 확인 — 조영제 알레르기·신기능·임신·누적선량(읽기 전용·게이트 미시행)' })
  async safetyPrecheck(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { data: await this.imagingSafety.precheck(orderId) };
  }

  @Get('patients/:patientId/radiation-exposure')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '환자 피폭선량 이력+누적 요약 (진단영역·최근 1년 집계 포함)' })
  async getRadiationExposure(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.imagingSafety.getPatientExposure(patientId) };
  }

  @Post('result/:imagingResultId/radiation-dose')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '피폭선량 기록 (촬영 후 장비 콘솔 판독값 수기 입력·upsert)' })
  async recordRadiationDose(
    @Param('imagingResultId', ParseUUIDPipe) imagingResultId: string,
    @Body() dto: RecordRadiationDoseDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.imagingService.getDetail(imagingResultId);
    return {
      data: await this.imagingSafety.recordExposure({
        imagingResultId,
        patientId: result.patientId,
        modality: result.modality,
        bodyPart: result.bodyPart,
        dlp: dto.dlp, ctdiVol: dto.ctdiVol,
        doseAreaProduct: dto.doseAreaProduct, effectiveDoseMsv: dto.effectiveDoseMsv,
        enteredBy: userId,
      }),
    };
  }

  @Post(':orderId/report')
  @RequirePermission(Permission.ORDER_EDIT)
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '판독 결과 입력' })
  @ApiResponse({ status: 201, description: '판독 결과 입력 성공' })
  async report(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: ReportImagingDto
  ) {
    return {
      data: await this.imagingService.report(
        orderId,
        dto.finding,
        dto.impression,
        dto.radiologistId
      ),
    };
  }

  @Get('detail/:imagingResultId')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '영상 결과 상세 조회' })
  @ApiResponse({ status: 200, description: '영상 결과 상세 조회 성공' })
  async getDetail(
    @Param('imagingResultId', ParseUUIDPipe) imagingResultId: string
  ) {
    return { data: await this.imagingService.getDetail(imagingResultId) };
  }

  @Get('patients/:patientId/results')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자별 영상 이력' })
  @ApiResponse({ status: 200, description: '환자별 영상 이력 조회 성공' })
  async getPatientResults(
    @Param('patientId', ParseUUIDPipe) patientId: string
  ) {
    return { data: await this.imagingService.getPatientResults(patientId) };
  }

  @Patch('result/:imagingResultId/cancel')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '촬영 취소' })
  @ApiResponse({ status: 200, description: '촬영 취소 성공' })
  async cancelAcquisition(
    @Param('imagingResultId', ParseUUIDPipe) imagingResultId: string,
    @Body() body: CancelAcquisitionDto
  ) {
    return {
      data: await this.imagingService.cancelAcquisition(
        imagingResultId,
        body.reason || ''
      ),
    };
  }

  @Patch('result/:imagingResultId')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '촬영 정보 수정' })
  @ApiResponse({ status: 200, description: '촬영 정보 수정 성공' })
  async updateAcquisition(
    @Param('imagingResultId', ParseUUIDPipe) imagingResultId: string,
    @Body() dto: AcquireImagingDto
  ) {
    return {
      data: await this.imagingService.updateAcquisition(
        imagingResultId,
        dto.modality,
        dto.bodyPart,
        dto.notes
      ),
    };
  }

  @AuditAiRead('AiImagingAnalyze')

  @Get('results/:resultId/ai-analyze')
  @ApiOperation({ summary: 'AI 영상 판독 보조 — 현재 산출 불가(영상 참조 부재). source=UNAVAILABLE + reason 반환' })
  async analyzeImagingAI(@Param('resultId', ParseUUIDPipe) resultId: string) {
    return { data: await this.imagingService.analyzeImagingAI(resultId) };
  }

  @AuditAiRead('AiImagingStructuredReport')

  @Get('results/:resultId/ai-structured-report')
  @ApiOperation({ summary: 'AI 구조화 판독 리포트 — 현재 산출 불가(영상 참조 부재). source=UNAVAILABLE + reason 반환' })
  async generateStructuredReport(@Param('resultId', ParseUUIDPipe) resultId: string) {
    return { data: await this.imagingService.generateStructuredReport(resultId) };
  }

  @AuditAiRead('AiImagingCompare')

  @Get('results/:currentId/ai-compare/:previousId')
  @ApiOperation({ summary: 'AI 비교 판독 — 현재 산출 불가(영상 참조 부재). source=UNAVAILABLE + reason 반환' })
  async compareImagingAI(@Param('currentId', ParseUUIDPipe) currentId: string, @Param('previousId', ParseUUIDPipe) previousId: string) {
    return { data: await this.imagingService.compareImagingAI(currentId, previousId) };
  }
}
