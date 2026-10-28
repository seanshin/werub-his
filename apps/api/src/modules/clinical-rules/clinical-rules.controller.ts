import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClinicalRulesLedgerService } from './clinical-rules-ledger.service';
import { CatalogAgendaService } from './catalog-agenda.service';

@ApiTags('Clinical Rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/clinical-rules')
export class ClinicalRulesController {
  constructor(private readonly ledger: ClinicalRulesLedgerService, private readonly agenda: CatalogAgendaService) {}

  /** 임상 규칙 대장 — 카탈로그 10개 지표(코드·값) · 카드별 확인 불가 · 소유 위원회 결정 기록(2026-10-21 P4) */
  @Get('ledger')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '임상 규칙 대장(카탈로그 10 · 지표 코드 정본 shared clinical-rules-ledger · 카드별 실패는 null)' })
  async get() {
    return { data: await this.ledger.ledger() };
  }

  /** 약속처방 사용 중 전환 안건 — 담당 위원회(없으면 null)와 이 출처의 안건 목록(2026-10-21 P5 B4) */
  @Get('agendas')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '카탈로그 안건 — 담당 위원회(표면 매핑 · 없으면 null)·약속처방 사용 중 전환 안건 목록' })
  async agendas() {
    const [owner, items] = await Promise.all([this.agenda.owner(), this.agenda.list()]);
    return { data: { owner, items } };
  }

  /** 약속처방 사용 중 전환을 담당 위원회 안건으로 — 세트는 바뀌지 않는다(의결 → 집행 엔진) */
  @Post('order-sets/:id/agenda')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '약속처방 사용 중 전환 안건 상정(담당 없음 400 · 열린 안건 409 · 사용 중으로 못 바꾸는 상태 409)' })
  async submitOrderSet(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.agenda.submitOrderSetActivation(id, userId) };
  }
}
