import { Module } from '@nestjs/common';
import { CancerRegistryController } from './cancer-registry.controller';
import { CancerRegistryService } from './cancer-registry.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';

@Module({
  imports: [MedicalAiModule],
  controllers: [CancerRegistryController],
  providers: [CancerRegistryService],
  exports: [CancerRegistryService],
})
export class CancerRegistryModule {}
