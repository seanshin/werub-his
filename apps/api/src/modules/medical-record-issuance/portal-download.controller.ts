import { Controller, Get, Param, Req, Res, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { IssuanceService } from './issuance.service';
import { DocumentService } from '../document/document.service';
import { PortalOrPatientGuard } from '../patient-auth/guards/portal-or-patient.guard';
import { PortalRequest } from '../../common/interfaces/portal-request.interface';

@ApiTags('의무기록 사본 발급(포털)')
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal/documents')
export class PortalDownloadController {
  constructor(
    private readonly svc: IssuanceService,
    private readonly documents: DocumentService,
  ) {}

  @Get(':id/download')
  @ApiOperation({ summary: '발급 완료(READY) 서류 PDF 다운로드 — 본인 검증' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: PortalRequest,
    @Res() res: Response,
  ) {
    const patientId = req.portalPatientId;
    const issueNo = await this.svc.patientDownloadIssueNo(patientId, id);
    const pdf = await this.documents.generatePdf(issueNo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${issueNo}.pdf"`);
    res.send(pdf);
  }
}
