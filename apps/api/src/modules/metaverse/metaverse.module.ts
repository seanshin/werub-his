import { Module } from '@nestjs/common';
import { MetaverseController } from './metaverse.controller';
import { MetaverseService } from './metaverse.service';

@Module({
  controllers: [MetaverseController],
  providers: [MetaverseService],
  exports: [MetaverseService],
})
export class MetaverseModule {}
