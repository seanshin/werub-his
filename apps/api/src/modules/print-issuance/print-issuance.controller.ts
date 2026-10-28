import { Body, Controller, Get, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { ZERO_UUID } from '../audit/audit-routes';
import { PrintIssuanceService } from './print-issuance.service';
import { PrintIssueDto } from './print-issuance.dto';

/**
 * 서버 발급 인쇄본(2026-10-12 기획 P0·P1) — 인쇄 버튼은 먼저 여기서 발급받고, 실패하면 화면이 인쇄하지 않는다.
 * 발급 역할은 관리자(사람 결정 D3 전 기본값) · 대조는 관리자·경영진(D1 기본값 — 공개 진위확인에는 내용이 없다).
 */
@ApiTags('Print issuance (서버 발급 인쇄본)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/print-issue')
export class PrintIssuanceController {
  private readonly logger = new Logger(PrintIssuanceController.name);
  constructor(private readonly svc: PrintIssuanceService, private readonly audit: AuditService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '서버 발급 인쇄본 — 결정 대장·의사결정서·개시 브리핑·당직표·QI 보고서(스냅샷은 서버가 만든다)' })
  async issue(@Body() dto: PrintIssueDto, @CurrentUser('id') userId: string) {
    const r = await this.svc.issue(dto, userId);
    // 발급번호는 UUID 가 아니라 resource_id 에 못 담는다 — changes 에 남긴다(발급 문서 PDF 열람과 같은 규약)
    void this.audit.log({
      userId, action: 'CREATE', resourceType: `IssuedDocument:${r.documentType}`, resourceId: ZERO_UUID,
      changes: { issueNo: { old: null, new: r.issueNo }, hash: { old: null, new: r.hash.slice(0, 16) } },
    }).catch((e: unknown) => this.logger.warn(`인쇄본 발급 감사 기록 실패 ${r.issueNo}: ${e instanceof Error ? e.message : String(e)}`));
    return { data: r };
  }

  @Get(':issueNo/compare')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '서버 발급 인쇄본 — 발급 판과 지금 원장 대조(일치/바뀜/비교 불가)' })
  async compare(@Param('issueNo') issueNo: string) {
    return { data: await this.svc.compare(issueNo) };
  }
}
