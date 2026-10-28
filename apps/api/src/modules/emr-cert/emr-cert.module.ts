import { Module } from '@nestjs/common';
import { EmrCertController } from './emr-cert.controller';
import { EmrCertService } from './emr-cert.service';

@Module({
  
  controllers: [EmrCertController],
  providers: [EmrCertService],
})
export class EmrCertModule {}
