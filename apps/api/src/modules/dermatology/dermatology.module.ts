import { Module } from '@nestjs/common';
import { DermatologyController } from './dermatology.controller';
import { DermatologyService } from './dermatology.service';

@Module({
  controllers: [DermatologyController],
  providers: [DermatologyService],
})
export class DermatologyModule {}
