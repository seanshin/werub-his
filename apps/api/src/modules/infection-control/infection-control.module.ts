import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { InfectionControlService } from './infection-control.service';
import { InfectionControlController } from './infection-control.controller';
import { ContactCandidatesService } from './contact-candidates.service';

@Module({
  imports: [ConfigRuntimeModule],
  controllers: [InfectionControlController],
  providers: [InfectionControlService, ContactCandidatesService],
  exports: [InfectionControlService],
})
export class InfectionControlModule {}
