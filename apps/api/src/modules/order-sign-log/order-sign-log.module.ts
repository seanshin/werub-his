import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { SignIntegrationModule } from '../sign-integration/sign-integration.module';
import { OrderSignLogService } from './order-sign-log.service';
import { OrderSignLogController } from './order-sign-log.controller';

/**
 * 오더 서명 로그 — CPOE 행위를 sign 해시체인 원장에 봉인하고 원내에서 조회한다.
 * OrderModule 이 상태 전이 시 이 서비스를 부르므로 export 한다(순환 방지: 이 모듈은 OrderModule 을 import 하지 않는다).
 */
@Module({
  imports: [PrismaModule, SignIntegrationModule],
  controllers: [OrderSignLogController],
  providers: [OrderSignLogService],
  exports: [OrderSignLogService],
})
export class OrderSignLogModule {}
