import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { Module } from '@nestjs/common';
import { VitalsIngestModule } from '../vitals/vitals-ingest.module';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';

@Module({
  imports: [VitalsIngestModule, PrismaModule, ConfigRuntimeModule],
  controllers: [DoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}
