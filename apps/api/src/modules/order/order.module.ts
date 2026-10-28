import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderTrackingService } from './order-tracking.service';
// 오더 추적 주의 기준(orders.tracking.attentionMin) — import 없으면 @Optional config 가 조용히 undefined
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { PacsProxyModule } from '../pacs-proxy/pacs-proxy.module';
import { OrderSignLogModule } from '../order-sign-log/order-sign-log.module';
// AuditModule 은 BlockchainAnchorModule 만 의존하는 잎 모듈 — 순환 없음(취소 연동 감사용)
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PacsProxyModule, OrderSignLogModule, AuditModule, ConfigRuntimeModule],
  controllers: [OrderController],
  providers: [OrderService, OrderTrackingService],
  exports: [OrderService, OrderTrackingService],
})
export class OrderModule {}
