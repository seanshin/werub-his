import { Module } from '@nestjs/common';
import { EmergencyPathwayController } from './emergency-pathway.controller';
import { EmergencyPathwayService } from './emergency-pathway.service';

@Module({
  controllers: [EmergencyPathwayController],
  providers: [EmergencyPathwayService],
})
export class EmergencyPathwayModule {}
