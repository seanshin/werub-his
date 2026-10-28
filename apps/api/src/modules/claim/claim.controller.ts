import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClaimService } from './claim.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReviewClaimDto, ExportClaimXmlDto } from './dto/claim.dto';
import { AddClaimAdjustmentsDto, ClaimAppealDto, ReviewSampleDto, SetClaimAdjustmentStatusDto } from './dto/claim-body.dto';

@ApiTags('Claims')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/claims')
export class ClaimController {
  constructor(private readonly claimService: ClaimService) {}

  @Get()
  @ApiOperation({ summary: '청구 목록' })
  async findAll(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.claimService.findAll({ status, page: page ? Number(page) : undefined, limit: limit ? Number(limit) : undefined });
  }

  @Post('review-sample')
  @ApiOperation({ summary: '심사 결과 알림 데모 — 샘플 심사결과로 의료진 알림(개발용)' })
  async reviewSample(@Body() body: ReviewSampleDto) {
    return { data: await this.claimService.reviewCallback({ result: body.result ?? 'REDUCED', reducedAmount: body.reducedAmount ?? 12000, reason: body.reason ?? '산정기준 초과(샘플)', ...body }) };
  }

  @Post('generate')
  @ApiOperation({ summary: '청구 데이터 일괄 생성' })
  async generate() { return { data: await this.claimService.generateClaims() }; }

  @Get('summary')
  @ApiOperation({ summary: '월별 청구 요약' })
  async getSummary() { return { data: await this.claimService.getSummary() }; }

  @Get(':id')
  @ApiOperation({ summary: '청구 상세' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const claim = await this.claimService.findById(id);
    // 🔴 insuranceNumber 는 암호문(원시 hex 키 계열)이라 응답에 실으면 ciphertext 유출 —
    //    FE 는 이 필드를 쓰지 않고, 복호가 필요한 곳은 청구 XML 빌더(서버 내부)뿐이다.
    if (claim?.patient) {
      const { insuranceNumber: _omit, ...patient } = claim.patient as Record<string, unknown>;
      return { data: { ...claim, patient } };
    }
    return { data: claim };
  }

  @Patch(':id/submit')
  @ApiOperation({ summary: '청구 제출' })
  async submit(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.claimService.submit(id) }; }

  @Patch(':id/review')
  @ApiOperation({ summary: '심사 결과 입력' })
  async review(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewClaimDto) {
    return { data: await this.claimService.review(id, body) };
  }

  @Get(':id/edi')
  @ApiOperation({ summary: 'HIRA EDI 청구 파일 다운로드 (파이프 구분자)' })
  async downloadEdi(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const claim = await this.claimService.findById(id);
    const edi = await this.claimService.generateEdi(id);
    const filename = `claim-${claim.claimNumber || claim.id}.edi`;
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename=${filename}`,
    });
    res.send(edi);
  }

  @Get(':id/xml')
  @ApiOperation({ summary: 'HIRA 청구 XML 다운로드' })
  async downloadXml(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const claim = await this.claimService.findById(id);
    const xml = await this.claimService.generateHiraXml(id);
    const filename = `claim-${claim.claimNumber || claim.id}.xml`;
    res.set({
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename=${filename}`,
    });
    res.send(xml);
  }

  // ── 심사조정(삭감) 라인 (R3-3) ──
  @Get('adjustments/stats')
  @ApiOperation({ summary: '삭감 패턴 통계 — 사유코드별 건수·금액·상태 분포' })
  async adjustmentStats(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.claimService.getAdjustmentStats(from, to) };
  }

  @Get(':id/adjustments')
  @ApiOperation({ summary: '청구 조정(삭감) 라인 목록' })
  async getAdjustments(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.claimService.getAdjustments(id) };
  }

  @Post(':id/adjustments')
  @ApiOperation({ summary: '조정 라인 일괄 기록 — 사유코드 필수·총액 정합 경고' })
  async addAdjustments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddClaimAdjustmentsDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.claimService.addAdjustments(id, body.lines ?? [], userId) };
  }

  @Patch('adjustments/:adjustmentId/status')
  @ApiOperation({ summary: '조정 라인 상태 전이 (수용/이의/재작업/해소)' })
  async setAdjustmentStatus(
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Body() body: SetClaimAdjustmentStatusDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.claimService.setAdjustmentStatus(adjustmentId, body.status, userId) };
  }

  @Post(':id/appeal')
  @ApiOperation({ summary: '이의신청' })
  async appeal(@Param('id', ParseUUIDPipe) id: string, @Body() body: ClaimAppealDto) {
    return { data: await this.claimService.appeal(id, body) };
  }

  @Get('stats/monthly')
  @ApiOperation({ summary: '월별 청구 통계' })
  async getMonthlyStats() { return { data: await this.claimService.getStatsByMonth() }; }

  @Post('export-xml')
  @ApiOperation({ summary: 'HIRA 일괄 청구 XML' })
  async exportXml(@Body() body: ExportClaimXmlDto, @Res() res: Response) {
    const xml = await this.claimService.generateBatchHiraXml(body.claimIds);
    const filename = `claims-batch-${new Date().toISOString().slice(0, 10)}.xml`;
    res.set({
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename=${filename}`,
    });
    res.send(xml);
  }
}
