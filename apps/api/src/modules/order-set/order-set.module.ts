import { Module } from '@nestjs/common';
import { OrderSetController } from './order-set.controller';
import { OrderSetService } from './order-set.service';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

@Module({

  controllers: [OrderSetController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다(Prisma 리프 재등록 관례)
  providers: [OrderSetService, DriftRecorderService],
  exports: [OrderSetService],
})
export class OrderSetModule {}
