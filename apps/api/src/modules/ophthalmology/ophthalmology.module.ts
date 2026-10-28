import { Module } from '@nestjs/common';
import { OphthalmologyController } from './ophthalmology.controller';
import { OphthalmologyService } from './ophthalmology.service';

@Module({
  controllers: [OphthalmologyController],
  providers: [OphthalmologyService],
})
export class OphthalmologyModule {}
