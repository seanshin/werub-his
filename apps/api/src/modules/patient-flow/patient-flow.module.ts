import { Module } from '@nestjs/common';
import { PatientFlowController } from './patient-flow.controller';
import { PatientFlowService } from './patient-flow.service';
import { FloorModule } from '../floor/floor.module';

// 환자 QR 동선 체크인 — FloorService(emitMovement·SSE) 재사용.
@Module({
  imports: [FloorModule],
  controllers: [PatientFlowController],
  providers: [PatientFlowService],
})
export class PatientFlowModule {}
