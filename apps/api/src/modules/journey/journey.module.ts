import { Global, Module } from '@nestjs/common';
import { JourneyController } from './journey.controller';
import { JourneyService } from './journey.service';
import { JourneyListener } from './journey.listener';
import { FloorModule } from '../floor/floor.module';

@Global() // 모든 모듈에서 주입 가능
@Module({
  imports: [FloorModule], // 이동 이벤트 SSE emit (clinic-floor #2)
  controllers: [JourneyController],
  providers: [JourneyService, JourneyListener], // 리스너=order.created 등 도메인 이벤트 브리지
  exports: [JourneyService],
})
export class JourneyModule {}
