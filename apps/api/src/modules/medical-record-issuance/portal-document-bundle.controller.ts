import { Controller, Get, Post, Body, Param, Req, Res, UseGuards, ParseUUIDPipe, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { DocumentBundleService } from './document-bundle.service';
import { RequestBundleDto } from './dto/request-bundle.dto';
import { PortalOrPatientGuard } from '../patient-auth/guards/portal-or-patient.guard';
import { PortalRequest } from '../../common/interfaces/portal-request.interface';

/**
 * F-4 실손보험 청구 서류 패키지 — 포털 EP 3종 + 신청 전 고지(bundle-sets).
 * 전부 PortalOrPatientGuard · config portal.insuranceDocBundle OFF 면 404(서비스 게이트).
 * 보호자 위임: 신청 POST 는 가드 GUARDIAN_BLOCKED(비GET 차단), 다운로드 GET 은 여기서 403(설계 §6.6).
 * 라우트: 리터럴 경로만 사용 — PortalDownloadController 의 ':id/download'(2세그먼트)와 충돌 없음.
 */
@ApiTags('실손보험 서류 번들(포털)')
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal/documents')
export class PortalDocumentBundleController {
  constructor(private readonly bundles: DocumentBundleService) {}

  @Get('bundle-sets')
  @ApiBearerAuth()
  @ApiOperation({ summary: '실손보험 세트 구성·수수료 고지(신청 전) — config OFF 404' })
  async getSets() {
    return { data: await this.bundles.getSets() };
  }

  @Post('request-bundle')
  @ApiBearerAuth()
  @ApiOperation({ summary: '실손보험 청구 서류 세트 신청 — 자동발급분 즉시 READY' })
  async requestBundle(@Body() dto: RequestBundleDto, @Req() req: PortalRequest) {
    // 이중 방어 — 1차는 portal-or-patient.guard GUARDIAN_BLOCKED(비GET 차단)
    if (req.isGuardianAccess) {
      throw new ForbiddenException('보호자 권한으로는 서류를 신청할 수 없습니다. 본인 계정으로 전환하세요.');
    }
    return { data: await this.bundles.requestBundle(req.portalPatientId, dto) };
  }

  @Get('bundles/:bundleId')
  @ApiBearerAuth()
  @ApiOperation({ summary: '번들 상태 — 소유 검증(불일치 404)' })
  async getBundle(@Param('bundleId', ParseUUIDPipe) bundleId: string, @Req() req: PortalRequest) {
    return { data: await this.bundles.getBundle(req.portalPatientId, bundleId) };
  }

  @Get('bundles/:bundleId/download')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'READY분 zip 다운로드(부분 허용·영수증 PDF 동봉) — 위임 세션 403' })
  async download(
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Req() req: PortalRequest,
    @Res() res: Response,
  ) {
    await this.bundles.streamBundleZip(req.portalPatientId, bundleId, res, { isGuardianAccess: !!req.isGuardianAccess });
  }
}
