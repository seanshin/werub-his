import { Module } from '@nestjs/common';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { EssModule } from '../ess/ess.module';

@Module({
  imports: [EssModule],
  controllers: [QrController],
  providers: [QrService],
})
export class QrModule {}
