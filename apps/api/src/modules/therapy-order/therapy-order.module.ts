import { Module } from '@nestjs/common';
import { TherapyOrderController } from './therapy-order.controller';
import { TherapyOrderService } from './therapy-order.service';

@Module({
  controllers: [TherapyOrderController],
  providers: [TherapyOrderService],
  exports: [TherapyOrderService],
})
export class TherapyOrderModule {}
