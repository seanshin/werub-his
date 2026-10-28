import { Module } from '@nestjs/common';
import { HieController } from './hie.controller';
import { HieService } from './hie.service';
import { CdaConverterModule } from '../cda-converter/cda-converter.module';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

@Module({
  imports: [CdaConverterModule],
  controllers: [HieController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다(Prisma 리프 재등록 관례)
  providers: [HieService, DriftRecorderService],
  exports: [HieService],
})
export class HieModule {}
