import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IssuanceService } from './issuance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StaffCreateRequestDto } from './dto/staff-create-request.dto';
import { DeliverDocumentRequestDto, RejectDocumentRequestDto, VerifyProxyDto } from './dto/staff-process.dto';

@ApiTags('의무기록 사본 발급(의료진)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.MEDICAL_RECORDS) // 큐·발급은 3역할+의무기록사, author/sign 은 메서드에서 DOCTOR 한정
@Controller('api/v1/staff/document-requests')
export class StaffDocumentController {
  constructor(private readonly svc: IssuanceService) {}

  /**
   * 🔴 (2026-10-10 사용자 결정) 원무(RECEPTIONIST)에게 **접수와 대기 목록만** 연다 — 종전엔 설명이 "창구(원무) 접수"인데 원무 역할이 없었다.
   *    상세·초안·작성·발급·거절·수령은 그대로 의료진·의무기록사(클래스 @Roles). 신청인 신분·관계 확인은 창구의 대면 책임(시스템 미검증).
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.MEDICAL_RECORDS, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '창구(원무) 접수 — 포털 신청이 성립하지 않는 서류(사망진단서 등)의 접수 경로(N-W1)' })
  async createRequest(@Body() body: StaffCreateRequestDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.staffCreateRequest(body, userId) };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.MEDICAL_RECORDS, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '서류 발급 요청 큐(상태·유형 필터 + 통계 · 상한 100 + 전체 수)' })
  async queue(@Query('status') status?: string, @Query('type') type?: string, @Query('q') q?: string) {
    return { data: await this.svc.staffQueue({ status, type, q: q?.slice(0, 40) }) };
  }

  @Get('ledger')
  @ApiOperation({ summary: '발급대장(P0 최소 — 발급완료 목록)' })
  async ledger(@Query('from') from?: string, @Query('to') to?: string, @Query('type') type?: string) {
    return { data: await this.svc.ledger({ from, to, type }) };
  }

  @Get('report')
  @ApiOperation({ summary: 'P3 발급 리포트(기간별 타입/상태/수령/수수료/SLA)' })
  async report(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.svc.report({ from, to }) };
  }

  @Get(':id')
  @ApiOperation({ summary: '요청 상세 + 동결 가능 기록 건수 + 수수료 견적' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.staffDetail(id) };
  }

  @Get(':id/fee')
  @ApiOperation({ summary: 'P3 수수료 견적(발급 전)' })
  async fee(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.feeEstimate(id) };
  }

  @Post(':id/deliver')
  @ApiOperation({ summary: 'P3 수령 완료(방문/우편 송장/팩스 수신번호)' })
  async deliver(@Param('id', ParseUUIDPipe) id: string, @Body() body: DeliverDocumentRequestDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.markDelivered(id, body, userId) };
  }

  // ─── B그룹(진단서·소견서·입퇴원확인서) 작성·서명 — DOCTOR ───
  @Get(':id/draft')
  @ApiOperation({ summary: '증명서 작성 초안(진료기록 자동채움)' })
  async draft(@Param('id', ParseUUIDPipe) id: string, @Query('encounterId') encounterId: string | undefined, @CurrentUser('id') userId: string) {
    return { data: await this.svc.certificateDraft(id, encounterId, userId) };
  }

  @Post(':id/author')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '증명서 작성/임시저장(담당의 검증, 의료법 §17)' })
  async author(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { encounterId?: string; admissionId?: string; diagnoses?: { kcdCode?: string; name?: string }[]; onsetDate?: string; diagnosedDate?: string; treatmentOpinion?: string; purpose?: string; content?: string; death?: { deathDate?: string; deathLocation?: string; deathType?: string; causeChain?: { a?: string; b?: string; c?: string; d?: string }; certKind?: 'DEATH_CERT' | 'POSTMORTEM' }; birth?: { deliveryId?: string; birthOrder?: number } },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.authorCertificate(id, body, userId) };
  }

  @Post(':id/sign')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '증명서 전자서명(작성 의사 본인) — 서명 후 발급 가능' })
  async sign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.signCertificate(id, userId) };
  }

  @Post(':id/snapshot')
  @ApiOperation({ summary: '기록 범위 선택 → SIGNED 기록 스냅샷 동결(IN_REVIEW)' })
  async snapshot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { recordTypes: string[]; periodFrom?: string; periodTo?: string },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.createSnapshot(id, body, userId) };
  }

  @Post(':id/issue')
  @ApiOperation({ summary: '발급(IssuedDocument 생성·READY) — 멱등' })
  async issue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.issue(id, userId) };
  }

  @Post(':id/fee-billing')
  @ApiOperation({ summary: '발급된 서류 수수료를 그 진료의 미납 수납에 올리기(재시도 · 결정 documents.fee.billingLink = BILLING_ITEM 일 때만 · 멱등)' })
  async feeBilling(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.linkFeeToBilling(id) };
  }

  @Post(':id/reject')
  @ApiOperation({ summary: '반려(사유 필수 — 제한 카테고리)' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectDocumentRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.reject(id, body.reason, body.detail, userId) };
  }

  @Post(':id/verify-proxy')
  @ApiOperation({ summary: 'P1 대리인 자격 검증(VERIFIED/REJECTED) — 기능 게이트 OFF 기본' })
  async verifyProxy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VerifyProxyDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.verifyProxy(id, body, userId) };
  }
}
