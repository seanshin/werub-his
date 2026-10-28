import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { OrderSignLogService } from './order-sign-log.service';
import { ACTION_LABEL } from './order-sign-entry';

/**
 * 오더 서명 로그 조회 — "누가 언제 이 오더를 어떻게 했는가"를 봉인된 형태로 확인한다.
 *
 * 권한: 오더 열람 권한이면 **그 오더의** 로그를 볼 수 있고(진료 맥락), 전체 목록·검증·현황은
 * 감사 권한(AUDIT_VIEW)으로 분리한다 — 전 오더 횡단 조회는 감사 성격이기 때문.
 * **쓰기(reconcile)는 읽기 권한과 분리한다** — SYSTEM_MANAGE(아래 주석 참조).
 */
@ApiTags('Order Sign Log (오더 서명 로그)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class OrderSignLogController {
  constructor(private readonly service: OrderSignLogService) {}

  @Get('orders/:id/sign-log')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '오더 1건의 서명 로그(시간순·봉인 영수증 포함)' })
  async byOrder(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.byOrder(id), meta: { actionLabels: ACTION_LABEL } };
  }

  @Get('order-sign-logs')
  @RequirePermission(Permission.AUDIT_VIEW)
  @ApiOperation({ summary: '오더 서명 로그 목록(기간·행위·행위자·봉인상태 필터)' })
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('orderId') orderId?: string,
    @Query('patientId') patientId?: string,
    @Query('sealStatus') sealStatus?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const r = await this.service.list({
      from, to, action, actorId, orderId, patientId, sealStatus,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { data: r.data, meta: { ...r.meta, actionLabels: ACTION_LABEL } };
  }

  @Get('order-sign-logs/stats')
  @RequirePermission(Permission.AUDIT_VIEW)
  @ApiOperation({ summary: '봉인 현황 — 봉인률·행위별 건수·복원 불가 취소' })
  async stats() {
    return { data: await this.service.stats() };
  }

  @Get('order-sign-logs/verify')
  @RequirePermission(Permission.AUDIT_VIEW)
  @ApiOperation({ summary: 'sign 원장 체인 무결성·시점앵커 검증(위변조 탐지)' })
  async verify() {
    return { data: await this.service.verifyChain() };
  }

  /**
   * 🔴 원 결함(W8/A4): 이 **쓰기**(sign 원장에 누락분을 소급 기록)가 **읽기 권한 `AUDIT_VIEW`**
   *    로 게이팅돼 있었다. `AUDIT_VIEW` 는 의사·간호·약사·검사·**CRM_MANAGER** 까지 갖는 조회
   *    권한이라, 감사 로그를 '볼 수 있는' 사람이면 누구나 봉인 원장에 기록을 만들 수 있었다.
   *    읽기 권한으로 쓰기를 열지 않는다 → 크론과 동일한 운영 작업이므로 `SYSTEM_MANAGE`
   *    (기본 보유: ADMIN 뿐)로 좁힌다. 부여가 필요하면 /admin/rbac 매트릭스로 명시 부여한다.
   */
  @Post('order-sign-logs/reconcile')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '누락분 소급 복원 즉시 실행(크론과 동일 로직·시스템 관리 권한)' })
  async reconcile(@Query('hours') hours?: string) {
    return { data: await this.service.reconcile(hours ? Number(hours) : undefined) };
  }
}
