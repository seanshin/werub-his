import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OutboundChannelService } from './outbound-channel.service';

@ApiTags('Outbound Channels (대외 발신 관제)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/outbound-channels')
export class OutboundChannelController {
  constructor(private readonly svc: OutboundChannelService) {}

  /**
   * 🔴 기관 전송은 **여기 나오지 않는다** — 별도 메뉴 `/admin/agency-integrations` 로 분리했다
   * (2026-08-20 사람 결정). 법정 의무·대외 계약이 걸린 축이라 운영 성격이 다르다.
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '대외 발신 통로(메시지·환자 앱) 현황 — 기관 전송은 /agency-integrations' })
  async list() {
    // 외부 전송 경로(egress) 인벤토리를 같은 응답에 싣는다 — 새 EP 를 두지 않는다(관제 정본은 이 화면 하나)
    return { data: { ...(await this.svc.list('NON_AGENCY')), egress: this.svc.egressInventory() } };
  }
}

@ApiTags('Agency Integrations (기관 연동)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/agency-integrations')
export class AgencyIntegrationController {
  constructor(private readonly svc: OutboundChannelService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '기관 전송 채널(법정 보고·청구) — 구현 여부와 Go-Live 추적 연결' })
  async list() {
    return { data: await this.svc.listAgency() };
  }
}
