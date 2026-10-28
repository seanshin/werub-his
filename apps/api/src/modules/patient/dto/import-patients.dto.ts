import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreatePatientDto } from './create-patient.dto';

export class ImportPatientsDto {
  @ApiProperty({ type: [CreatePatientDto], description: '일괄 등록할 환자 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePatientDto)
  patients: CreatePatientDto[];
}
