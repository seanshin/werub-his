import { IsString, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBtgDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '접근 사유' })
  @IsString()
  reason: string;

  @ApiProperty({ description: '리소스 타입', example: 'MedicalRecord' })
  @IsString()
  resourceType: string;

  @ApiPropertyOptional({ description: '리소스 ID' })
  @IsOptional()
  @IsUUID()
  resourceId?: string;
}

export class ReviewBtgDto {
  @ApiProperty({ description: '승인 여부' })
  @IsBoolean()
  isApproved: boolean;
}

export class DesignateVipDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '지정 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}
