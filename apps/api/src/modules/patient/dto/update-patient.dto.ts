import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePatientDto } from './create-patient.dto';

// MRN은 수정 불가 (자동 생성, 불변)
export class UpdatePatientDto extends PartialType(CreatePatientDto) {}
