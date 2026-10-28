import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { GldModule } from '../gld/gld.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { OrderGovernanceController } from './order-governance.controller';
import { OrderGovernanceService } from './order-governance.service';
import { CommitteeAgendaService } from './committee-agenda.service';
import { AttentionAgendaService } from './attention-agenda.service';

/**
 * 오더 위원회 기준 점검 — **잎 모듈**(아무도 import 하지 않는다).
 * 오더 모듈이 거버넌스 모듈(도메인 모듈 다수를 import)을 끌어오면 순환 위험이 있어, 둘 다를 쓰는 쪽을 따로 둔다.
 */
@Module({
  imports: [OrderModule, GldModule, ConfigRuntimeModule],
  controllers: [OrderGovernanceController],
  providers: [OrderGovernanceService, CommitteeAgendaService, AttentionAgendaService],
  // 위원회 안건 다리 — CPOE 질 지표(목표 안건)도 같은 다리를 쓴다(안건 출처·중복 판정이 한 곳)
  exports: [CommitteeAgendaService],
})
export class OrderGovernanceModule {}
