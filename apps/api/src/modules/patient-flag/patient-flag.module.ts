import { Module } from '@nestjs/common';
import { PatientFlagController } from './patient-flag.controller';
import { PatientFlagService } from './patient-flag.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PatientFlagController],
  providers: [PatientFlagService],
  exports: [PatientFlagService],
})
export class PatientFlagModule {}
