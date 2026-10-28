import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PharmacistActivityService } from './pharmacist-activity.service';
import {
  CreateInterventionDto, RespondInterventionDto,
  CreateTdmRequestDto, RecordTdmResultDto,
  CreateAdrReportDto, CreateAspRequestDto, HandleAspRequestDto,
} from './dto/pharmacist-activity.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Pharmacist Activity (약사 임상활동)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PHARMACIST, UserRole.ADMIN)
@Controller('api/v1/pharmacist')
export class PharmacistActivityController {
  constructor(private readonly service: PharmacistActivityService) {}

  // ── Interventions (처방 중재) ──

  @Get('interventions')
  @ApiOperation({ summary: '처방 중재 목록' })
  async getInterventions(
    @Query('pharmacistId') pharmacistId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
  ) {
    // 🔴 워크리스트가 없으면 약사는 기억으로 일한다 — 미회신(PENDING)만 뽑는 필터가
    //    화면에 필요하다. 서버가 걸러야 절단(LIST_LIMIT) 이후에도 대기분이 보인다.
    const page = await this.service.getInterventions({ pharmacistId, type, status, patientId });
    // 잘랐으면 잘랐다고 말한다(meta.truncated)
    return { data: page.items, meta: { truncated: page.truncated, limit: page.limit } };
  }

  /**
   * 🔴 의사의 회신 워크리스트 — 내가 책임 처방의인 처방에 달린 중재(기본 회신 대기).
   *    종전엔 목록이 약사·관리자 전용이라 의사는 회신 EP 가 열려 있어도 **무엇에 회신할지 볼 수 없었다**.
   *    전건 목록(`GET interventions`)을 의사에게 여는 대신 자기 스코프만 연다(권한 역전 방지).
   */
  @Get('interventions/mine')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '내 처방에 달린 약사 중재(의사 회신 워크리스트)' })
  async getMyInterventions(
    @CurrentUser('id') userId: string,
    @Query('status') status?: string,
  ) {
    const page = await this.service.getMyInterventions(userId, status);
    return { data: page.items, meta: { truncated: page.truncated, limit: page.limit } };
  }

  @Post('interventions')
  @ApiOperation({ summary: '처방 중재 등록' })
  async createIntervention(
    @Body() body: CreateInterventionDto,
    @CurrentUser('id') userId: string,
  ) {
    // 중재 주체는 인증 사용자 — ADR/ASP 와 동일 규약. 종전 FE 하드코딩 'ph-001' 은
    // @db.Uuid 컬럼에 들어갈 수 없다(이름도 사용자 원장에서 조회한다).
    return {
      data: await this.service.createIntervention({
        pharmacistId: userId,
        patientId: body.patientId,
        prescriptionId: body.prescriptionId,
        prescriptionDrug: body.prescriptionDrug,
        type: body.type,
        reason: body.reason,
        suggestion: body.suggestion,
      }),
    };
  }

  @Patch('interventions/:id')
  // 🔴 회신하는 사람은 처방한 의사다. 클래스 @Roles(PHARMACIST·ADMIN) 만 있던 동안
  //    의사는 자기 처방에 대한 중재에 **직접 회신할 수 없었고**, 약사가 대신 눌러
  //    `respondedBy` 에 약사가 남았다(회신 주체가 기록과 어긋난다).
  //    RolesGuard 는 handler → class 순으로 읽으므로 여기서 넓힌다.
  @Roles(UserRole.PHARMACIST, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '처방 중재 처리 (수락/거절)' })
  async updateIntervention(
    @Param('id') id: string,
    @Body() body: RespondInterventionDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    // 🔴 의사는 자기 처방의 중재에만 회신한다(관리자·약사 대리 기록은 종전 그대로) — 쓰기 전에 따로 검사
    await this.service.assertCanRespond(id, user);
    const userId = user.id;
    // 응답 주체·시각은 서버가 기록한다(respondedBy/respondedAt)
    return {
      data: await this.service.updateIntervention(id, {
        status: body.status,
        doctorResponse: body.doctorResponse,
        respondedBy: userId,
      }),
    };
  }

  // ── TDM (약물농도모니터링) ──

  @Get('tdm')
  @ApiOperation({ summary: 'TDM 요청 목록' })
  async getTdmRequests(@Query('status') status?: string) {
    const page = await this.service.getTdmRequests(status);
    return { data: page.items, meta: { truncated: page.truncated, limit: page.limit } };
  }

  @Post('tdm')
  @ApiOperation({ summary: 'TDM 요청 등록' })
  async createTdmRequest(
    @Body() body: CreateTdmRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    // requestedBy 는 인증 사용자 — 클라이언트 하드코딩('ph-001')은 uuid 가 아니라 저장 자체가 불가능하다.
    return {
      data: await this.service.createTdmRequest({
        patientId: body.patientId,
        drugName: body.drugName,
        indication: body.indication,
        targetRangeMin: body.targetRangeMin,
        targetRangeMax: body.targetRangeMax,
        targetUnit: body.targetUnit,
        requestedBy: userId,
      }),
    };
  }

  @Patch('tdm/:id/result')
  @ApiOperation({ summary: 'TDM 결과 입력' })
  async recordTdmResult(
    @Param('id') id: string,
    @Body() body: RecordTdmResultDto,
  ) {
    return {
      data: await this.service.recordTdmResult(id, {
        resultLevel: body.resultLevel,
        resultInterpretation: body.resultInterpretation,
        doseRecommendation: body.doseRecommendation,
      }),
    };
  }

  // ── ADR (약물이상반응) ──

  @Get('adr')
  @ApiOperation({ summary: 'ADR 보고 목록' })
  async getAdrReports() {
    return { data: await this.service.getAdrReports() };
  }

  @Post('adr')
  @ApiOperation({ summary: 'ADR 보고 등록 (KAERS 형식)' })
  async createAdrReport(
    @Body() body: CreateAdrReportDto,
    @CurrentUser('id') userId: string,
  ) {
    // reportedBy는 인증 사용자(유효 UUID·FK) — 클라이언트 임의값 무시
    return {
      data: await this.service.createAdrReport({
        patientId: body.patientId,
        patientName: body.patientName ?? '',
        suspectedDrug: body.suspectedDrug,
        reaction: body.reaction,
        severity: body.severity,
        onsetDate: body.onsetDate,
        outcome: body.outcome,
        causalityAssessment: body.causalityAssessment,
        // 계산하지 않았으면 넘기지 않는다 — 0 은 UNLIKELY 라는 다른 사실이다
        naranjoScore: body.naranjoScore,
        kaersReportId: body.kaersReportId,
        reportedBy: userId,
      }),
    };
  }

  // ── ASP (항생제 스튜어드십) ──

  @Get('asp')
  @ApiOperation({ summary: 'ASP 요청 목록' })
  async getAspRequests(@Query('status') status?: string) {
    return { data: await this.service.getAspRequests(status) };
  }

  @Post('asp')
  @ApiOperation({ summary: 'ASP 승인 요청' })
  async createAspRequest(
    @Body() body: CreateAspRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    // requestedBy는 인증 사용자 — ADR 과 같은 규약. 종전엔 FE 하드코딩 'dr-001' 이
    // @db.Uuid 컬럼에 그대로 들어가 등록이 구조적으로 실패했다(2026-08-13 W3).
    return {
      data: await this.service.createAspRequest({
        patientId: body.patientId,
        antimicrobialName: body.antimicrobialName,
        indication: body.indication,
        duration: body.duration,
        durationUnit: body.durationUnit,
        restrictedLevel: body.restrictedLevel,
        requestedBy: userId,
      }),
    };
  }

  @Patch('asp/:id')
  @ApiOperation({ summary: 'ASP 승인/거절' })
  async handleAspRequest(
    @Param('id') id: string,
    @Body() body: HandleAspRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    // reviewedBy도 인증 사용자 — 클라이언트 임의값('ph-001')은 uuid 가 아니라 처리 실패 + 주체 위조 여지.
    return {
      data: await this.service.handleAspRequest(id, body.approve, {
        reviewedBy: userId,
        reviewComment: body.reviewComment,
      }),
    };
  }

  // ── Stats (통계) ──

  @Get('stats')
  @ApiOperation({ summary: '약사 임상활동 통계' })
  async getStats(
    @Query('pharmacistId') pharmacistId?: string,
    @Query('period') period?: string,
  ) {
    return { data: await this.service.getStats(pharmacistId, period) };
  }
}
