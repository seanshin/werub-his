import { Module } from '@nestjs/common';
import { EntController } from './ent.controller';
import { EntService } from './ent.service';

@Module({
  controllers: [EntController],
  providers: [EntService],
})
export class EntModule {}
