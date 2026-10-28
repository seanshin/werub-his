import { Module } from '@nestjs/common';
import { AllergyController } from './allergy.controller';
import { AllergyService } from './allergy.service';

@Module({
  
  controllers: [AllergyController],
  providers: [AllergyService],
  exports: [AllergyService],
})
export class AllergyModule {}
