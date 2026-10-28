import { Controller, Post, Get, Body, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZERO_UUID } from '../audit/audit-routes';
import { AuditService } from '../audit/audit.service';
import { DocumentService } from './document.service';
import { IssueDocumentDto } from './dto/issue-document.dto';

@ApiTags('Documents')
@Controller('api/v1/documents')
export class DocumentController {
  constructor(private readonly svc: DocumentService, private readonly audit: AuditService) {}

  @Post('issue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MEDICAL_RECORDS, UserRole.RECEPTIONIST) // 공식 문서 발급 — 임의 인증사용자 위조 차단
  @ApiBearerAuth()
  @ApiOperation({ summary: '문서 발급 — 스냅샷 동결+발급번호+해시(P3)' })
  async issue(@Body() dto: IssueDocumentDto, @CurrentUser('id') userId?: string) {
    const r = await this.svc.issue(dto, userId);
    if (userId) void this.audit.log({
      userId, action: 'CREATE',
      resourceType: `IssuedDocument:${dto.documentType}`,
      resourceId: dto.patientId ?? dto.sourceId,
      changes: { issueNo: { old: null, new: r.issueNo } },
    }).catch(() => {});
    return { data: r };
  }

  @Post('reissue/:issueNo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MEDICAL_RECORDS, UserRole.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: '문서 재발급(사본)' })
  async reissue(@Param('issueNo') issueNo: string, @CurrentUser('id') userId?: string) {
    return { data: await this.svc.reissue(issueNo, userId) };
  }

  // 공개 진위검증(PHI 미노출) — nginx /api/v1 라우팅 대상
  @Get('verify/:issueNo')
  @ApiOperation({ summary: '문서 진위검증(공개) — 서버 생성 종류는 확인 코드 v 필요' })
  async verify(@Param('issueNo') issueNo: string, @Query('v') v?: string) {
    return { data: await this.svc.verify(issueNo, typeof v === 'string' ? v : undefined) };
  }

  // 인쇄 페이지용 렌더 데이터(단기 토큰 인증) — 헤드리스 렌더러 전용
  @Get('render/:issueNo')
  @ApiOperation({ summary: '인쇄 페이지 렌더 데이터(토큰)' })
  async render(@Param('issueNo') issueNo: string, @Query('rt') rt?: string) {
    return { data: await this.svc.renderData(issueNo, rt) };
  }

  // 서버 PDF(헤드리스) — 발급 문서
  @Get('pdf/:issueNo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  // 🔴 (2026-09-16 E3) 인증만 있으면 **누구나** 발급 문서 PDF(진단서·소견서 = PHI)를 받아갔다 —
  //    발급·재발급은 이 5역할인데 열람만 전 직원이었다. 발급 형제와 같은 집합으로 맞춘다.
  //    `verify`(PHI 미노출 공개)·`render`/`dl`(단기 토큰)은 성격이 달라 그대로 둔다.
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MEDICAL_RECORDS, UserRole.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: '발급 문서 서버 PDF(헤드리스)' })
  async pdf(@Param('issueNo') issueNo: string, @Res() res: Response, @CurrentUser('id') userId?: string) {
    const buf = await this.svc.generatePdf(issueNo);
    // 열람 감사의 resourceId 는 환자(audit-routes 규약). issueNo 는 UUID 가 아니라 resource_id 에 못 담는다 — changes 에 남긴다.
    const patientId = await this.svc.patientIdOf(issueNo);
    if (userId) {
      void this.audit.log({
        userId, action: 'READ', resourceType: 'DocumentPdf', resourceId: patientId ?? ZERO_UUID,
        changes: { issueNo: { old: null, new: issueNo } },
      }).catch(() => {});
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${issueNo}.pdf"`);
    res.end(buf);
  }

  // ERP e-sign #6 — 완료본 다운로드(토큰 인증, 무 JWT·서버↔서버 첨부). 토큰은 sign.completed payload.document.url 로 전달.
  //
  // 🔴 (2026-09-16 G2) 진단서·소견서 **PDF 전문**이 나가는데 열람 기록이 없었다 — 형제 `pdf/:issueNo` 는
  //    `audit.log` 를 남기지만 이 경로는 무인증(토큰)이라 감사 인터셉터가 `user.id` 없음으로 탈락시켰고,
  //    모듈도 직접 남기지 않았다. 그래서 **"누가 언제 그 진단서를 받아갔는가"를 아무도 답할 수 없었다**(§5).
  //    AuditLog 는 `userId` 가 User FK 필수라 무인증 주체를 담지 못한다 → 같은 이유로 만들어진
  //    `SmartAccessLog`(userId nullable = "시스템 단위 접근", `audit.service.ts` 주석)에 남긴다.
  //    스키마 변경 없음. 이 행은 `/admin/smart-clients` 에 clientId `public:document-dl` 로 보인다.
  @Get('dl/:issueNo')
  @ApiOperation({ summary: '완료본 PDF 다운로드(토큰 인증·외부 첨부용)' })
  async download(
    @Param('issueNo') issueNo: string,
    @Query('t') token: string,
    @Res() res: Response,
    @Req() req?: { ip?: string; headers?: Record<string, unknown> },
  ) {
    // 토큰 검증이 끝난 뒤에만 기록한다 — 실패한 시도를 "받아갔다"로 적지 않는다
    const buf = await this.svc.generatePdfWithToken(issueNo, token);
    const patientId = await this.svc.patientIdOf(issueNo);
    void this.audit.logSmartAccess({
      clientId: 'public:document-dl',
      clientName: '완료본 PDF 다운로드(토큰)',
      userId: undefined, // 무인증 — 주체가 직원 User 가 아니다
      patientId: patientId ?? undefined,
      resourceType: 'DocumentPdf',
      action: 'read',
      path: `/api/v1/documents/dl/${issueNo}`,
      ipAddress: req?.ip,
      userAgent: typeof req?.headers?.['user-agent'] === 'string' ? (req.headers['user-agent'] as string) : undefined,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${issueNo}.pdf"`);
    res.end(buf);
  }
}
