import { Controller, Post, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { EmergencyService } from './emergency.service';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { CreatePrenotificationDto } from './dto/prenotification.dto';

/**
 * 119/이송기관 사전통보 수신(서버-서버) — ER 잔여 2026-07-23.
 * 인증: X-Integration-Key = config `emergency.emsKey`(미구성 시 fail-closed 401 — 활성화=키 발급·전달).
 * 도착 전 통보만 수신 — 도착/트리아지 연결은 원내(직원 EP)에서 처리.
 */
@ApiTags('EMS Integration (119 사전통보)')
@Controller('api/v1/integration/ems')
export class EmsIntegrationController {
  constructor(
    private readonly emergency: EmergencyService,
    private readonly auth: IntegrationAuthService,
  ) {}

  @Post('prenotify')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '사전통보 수신 — 구급대/이송기관이 도착 전 환자 정보 통보' })
  async prenotify(
    @Headers('x-integration-key') key: string,
    @Body() body: CreatePrenotificationDto,
  ) {
    await this.auth.assertEmsKey(key);
    const rec = await this.emergency.createPrenotification(body);
    return { data: { id: rec.id, status: rec.status, receivedAt: rec.receivedAt, etaAt: rec.etaAt } };
  }
}
