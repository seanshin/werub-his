import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { POA_VALUES } from '@hospital-run/shared';

export class SetPoaDto {
  @ApiProperty({ description: '진단 코드(KCD)' }) @IsString() @MaxLength(20)
  diagnosisCode!: string;

  @ApiProperty({ enum: POA_VALUES }) @IsIn([...POA_VALUES])
  poa!: string;
}
