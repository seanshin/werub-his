import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InsuranceClaimService } from './insurance-claim.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Permission } from '../auth/rbac/permission.types';
import { CreateClaimDto, SubmitClaimDto, ReviewClaimDto, UpdateClaimDataDto, RecordPaymentDto } from './dto/claim.dto';

@ApiTags('Insurance Claim')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
// 🔴 (2026-10-14 수납·청구 결함 발굴 P2-4) 정본 `/claims` 는 관리자 전용인데 이 쌍둥이 경로는 `BILLING_EDIT` 만 보아
//    간호사·원무가 청구 심사·지급 기록·청구 데이터 교체를 할 수 있었다(부르는 화면 0). 정본과 같은 역할로 좁힌다.
@Roles(UserRole.ADMIN)
@Controller('api/v1/insurance-claims')
export class InsuranceClaimController {
  constructor(private readonly claimService: InsuranceClaimService) {}

  @Get('queue')
  @RequirePermission(Permission.BILLING_VIEW)
  @ApiOperation({ summary: '청구 대기열' })
  @ApiResponse({ status: 200, description: '청구 대기열 조회 성공' })
  async getQueue() {
    return { data: await this.claimService.getQueue() };
  }

  @Post('create')
  @RequirePermission(Permission.BILLING_EDIT)
  @ApiOperation({ summary: '청구서에서 청구 생성' })
  @ApiResponse({ status: 201, description: '청구 생성 성공' })
  async create(@Body() dto: CreateClaimDto) {
    return {
      data: await this.claimService.create(dto.billingId, dto.reason),
    };
  }

  @Post(':claimId/submit')
  @RequirePermission(Permission.BILLING_EDIT)
  @ApiOperation({ summary: '청구 제출 (EDI 전송)' })
  @ApiResponse({ status: 200, description: '청구 제출 성공' })
  async submit(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: SubmitClaimDto
  ) {
    return {
      data: await this.claimService.submit(claimId, dto.ediData, dto.notes),
    };
  }

  @Get(':claimId')
  @RequirePermission(Permission.BILLING_VIEW)
  @ApiOperation({ summary: '청구 상세 조회' })
  @ApiResponse({ status: 200, description: '청구 상세 조회 성공' })
  async getDetail(@Param('claimId', ParseUUIDPipe) claimId: string) {
    return { data: await this.claimService.getDetail(claimId) };
  }

  @Get('patients/:patientId/history')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자별 청구 이력' })
  @ApiResponse({ status: 200, description: '환자별 청구 이력 조회 성공' })
  async getPatientHistory(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.claimService.getPatientHistory(patientId) };
  }

  @Patch(':claimId/review')
  @RequirePermission(Permission.BILLING_EDIT)
  @ApiOperation({ summary: '청구 검토 (승인/거절)' })
  @ApiResponse({ status: 200, description: '청구 검토 완료' })
  async review(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: ReviewClaimDto
  ) {
    return {
      data: await this.claimService.review(claimId, dto.action, dto.approvedAmount, dto.reason),
    };
  }

  @Patch(':claimId/payment')
  @RequirePermission(Permission.BILLING_EDIT)
  @ApiOperation({ summary: '청구 지급 기록' })
  @ApiResponse({ status: 200, description: '청구 지급 기록 완료' })
  async recordPayment(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: RecordPaymentDto
  ) {
    return {
      data: await this.claimService.recordPayment(claimId, body.paidAmount),
    };
  }

  @Patch(':claimId/update-data')
  @RequirePermission(Permission.BILLING_EDIT)
  @ApiOperation({ summary: '청구 데이터 업데이트' })
  @ApiResponse({ status: 200, description: '청구 데이터 업데이트 성공' })
  async updateClaimData(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: UpdateClaimDataDto
  ) {
    return {
      data: await this.claimService.updateClaimData(claimId, dto.claimData, dto.reducedAmount),
    };
  }
}
