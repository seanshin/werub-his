import {
  Controller, Get, Post, Param, Body, Query, Req, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DocumentSignService } from './document-sign.service';
import { InitMultiSignDto, SignDocumentDto, VerifySignedDocumentDto } from './dto/document-sign.dto';

/** 서명 증빙 — 본문이 아니라 요청 연결에서 뽑는다 */
interface SignRequest { ip?: string; headers?: Record<string, string | string[] | undefined> }

@ApiTags('Document Signing (문서 서명)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/document-sign')
export class DocumentSignController {
  constructor(private readonly service: DocumentSignService) {}

  /**
   * 서명 대상 내용 해시(2026-10-13 A2) — 서명 모달은 이 해시에 서명한다(종전: 클라이언트가 `종류:id:제목` 을 해시).
   * 응답의 documentId 가 서명 원장 정본이다(퇴원요약은 입원 id 로 물어도 요약 id).
   */
  @Get('content-hash/:type/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '서명 대상 문서 내용 해시(서버 정본)' })
  async contentHash(@Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.service.contentOrThrow(type, id);
    return { data: { documentType: c.type, documentId: c.documentId, hash: c.hash, canon: c.canon } };
  }

  @Post('sign')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '문서 서명' })
  async sign(@Body() body: SignDocumentDto, @CurrentUser('id') userId: string, @Req() req: SignRequest) {
    const ua = req?.headers?.['user-agent'];
    return {
      data: await this.service.sign(
        {
          documentType: body.documentType, documentId: body.documentId, patientId: body.patientId,
          documentHash: body.documentHash, certificateId: body.certificateId,
          signatureValue: body.signatureValue, signatureAlgorithm: body.signatureAlgorithm,
          signerRole: body.signerRole, signerType: body.signerType, signerPatientId: body.signerPatientId,
        },
        { userId, ipAddress: req?.ip, userAgent: Array.isArray(ua) ? ua[0] : ua },
      ),
    };
  }

  @Post('verify')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '서명 검증' })
  async verify(@Body() body: VerifySignedDocumentDto) {
    return { data: await this.service.verify(body.signedDocumentId) };
  }

  @Get('document/:type/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '서명 문서 조회' })
  async getSignedDocument(
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.service.getSignedDocument(type, id) };
  }

  @Get('history')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '서명 이력 (비ADMIN 의 userId 조회는 본인만·환자 문맥은 patientId)' })
  async getSignHistory(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') role: string,
    @Query('userId') userId?: string,
    @Query('patientId') patientId?: string,
  ) {
    // IDOR 차단 — 비ADMIN 이 userId 로 타인 서명이력(문서·인증서 일련번호)을 훑지 못하게 본인으로 고정.
    // 환자 문맥(patientId) 조회는 임상 열람이라 유지.
    const scopedUser = role === UserRole.ADMIN ? userId : (userId ? callerId : undefined);
    return { data: await this.service.getSignHistory(scopedUser, patientId) };
  }

  @Get('my-history')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '내 서명 이력(현재 사용자)' })
  async getMySignHistory(@CurrentUser('id') userId: string) {
    return { data: await this.service.getSignHistory(userId) };
  }

  @Post('multi-sign/init')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '다중 서명 초기화' })
  async initMultiSign(@Body() body: InitMultiSignDto) {
    return { data: await this.service.initMultiSign(body) };
  }

  @Get('multi-sign/:id/status')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '다중 서명 진행 상태' })
  async getMultiSignStatus(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getMultiSignStatus(id) };
  }

  @Get('envelope/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '서명 봉투 (문서+서명 번들)' })
  async getEnvelope(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getEnvelope(id) };
  }
}
