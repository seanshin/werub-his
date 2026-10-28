import { Module } from '@nestjs/common';
import { CdaConverterService } from './cda-converter.service';

@Module({
  providers: [CdaConverterService],
  exports: [CdaConverterService],
})
export class CdaConverterModule {}
