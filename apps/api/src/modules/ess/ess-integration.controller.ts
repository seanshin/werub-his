import { Controller, Post, Get, Body, Param, Headers, Req, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { EssService } from './ess.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { secureKeyEqual } from '../../common/util/secure-compare';
import { LeaveCallbackDto } from './dto/ess.dto';

// 휴가 결재 결과 콜백(Clinic/ERP → HIS, §9.6.2) + 증명서 진위확인(공개)
@ApiTags('ESS Integration (휴가 콜백·증명서 진위)')
@SkipThrottle()
@Controller('api/v1/ess')
export class EssIntegrationController {
  constructor(
    private readonly svc: EssService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly config: ConfigService,
  ) {}

  private async auth(key?: string) {
    const expected = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('연동 키가 올바르지 않습니다');
  }

  /** EApprovalRelay deliverCallback(X-Signature=HMAC(rawBody)) 수용 — wsign 결재 결과가 휴가에 닿는 마지막 구간 (C-3 리허설 발견 갭) */
  private verifySignature(rawBody?: Buffer, sig?: string): boolean {
    const secret = this.config.get<string>('EAPPROVAL_CALLBACK_SECRET');
    if (!secret || !rawBody || !sig) return false;
    const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = Buffer.from(sig.replace(/^sha256=/, ''), 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  @Post('leave/eapproval-callback')
  @ApiHeader({ name: 'X-Integration-Key', required: false })
  @ApiHeader({ name: 'X-Signature', required: false })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: '휴가 결재 결과 콜백 (Clinic/ERP 연동키 또는 릴레이 HMAC 서명, 멱등)' })
  async leaveCallback(
    @Req() req: { rawBody?: Buffer },
    @Headers('x-integration-key') key: string | undefined,
    @Headers('x-signature') sig: string | undefined,
    @Body() dto: LeaveCallbackDto,
  ) {
    if (!this.verifySignature(req.rawBody, sig)) await this.auth(key);
    // deliverCallback 스네이크 표기 정규화(result→status 등) — 미지정 status는 400
    // 🔴 (2026-09-28 §3 #27) 종전엔 여기서 401 을 던졌다 — 서명·키는 통과한 요청인데 발신 쪽이
    //    **인증 실패로 오인**했다(주석은 400 이라 적혀 있었다). 본문 결손은 400 이다.
    const status = dto.status ?? dto.result;
    if (!status) throw new BadRequestException('status/result 누락');
    return {
      data: await this.svc.leaveCallback({
        ref: dto.ref,
        status,
        approver: dto.approver ?? dto.approved_by,
        decidedAt: dto.decidedAt ?? dto.decided_at,
        approvalId: dto.approvalId ?? dto.approval_id,
      }),
    };
  }

  @Get('certificates/verify/:code')
  @ApiOperation({ summary: '증명서 진위확인(공개 — QR)' })
  async verify(@Param('code') code: string) {
    return { data: await this.svc.verifyCertificate(code) };
  }
}
