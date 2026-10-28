import { Module } from '@nestjs/common';
import { FormEngineController } from './form-engine.controller';
import { FormEngineService } from './form-engine.service';

@Module({
  
  controllers: [FormEngineController],
  providers: [FormEngineService],
  exports: [FormEngineService],
})
export class FormEngineModule {}
