import { Module } from '@nestjs/common';
import { EligibilityController } from './eligibility.controller';
import { EligibilityService } from './eligibility.service';
import { SimulationEligibilityProvider } from './simulation.provider';
import { NhisEligibilityProvider } from './nhis.provider';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [PrismaModule, ConfigRuntimeModule],
  controllers: [EligibilityController],
  providers: [EligibilityService, SimulationEligibilityProvider, NhisEligibilityProvider],
  exports: [EligibilityService],
})
export class EligibilityModule {}
