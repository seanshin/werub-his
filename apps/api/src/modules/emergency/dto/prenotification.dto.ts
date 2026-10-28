import { IsString, IsOptional, IsIn, IsInt, Min, Max, Length, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 119/전원 사전통보 DTO — 외부(EMS)·직원 수기 공용.
 * 스카우트 3차: 인라인 body 타입은 class-validator 미적용(전역 whitelist가 걸러줄 데코레이터도 없음)
 * → VarChar 초과 500·무제한 Text·etaMinutes 오버플로(Invalid Date 500)가 가능했던 갭 봉합.
 */
export class CreatePrenotificationDto {
  @ApiPropertyOptional({ enum: ['EMS_119', 'TRANSFER', 'OTHER'] })
  @IsOptional() @IsIn(['EMS_119', 'TRANSFER', 'OTHER'])
  source?: string;

  @ApiPropertyOptional({ description: '구급대/이송기관 식별' })
  @IsOptional() @IsString() @Length(1, 40)
  unitId?: string;

  @ApiPropertyOptional({ description: '도착 예정(분) 0~720' })
  @IsOptional() @IsInt() @Min(0) @Max(720)
  etaMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(150)
  patientAge?: number;

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'UNKNOWN'] })
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'UNKNOWN'])
  patientGender?: string;

  @ApiProperty({ description: '주호소' }) @IsString() @Length(1, 500)
  chiefComplaint: string;

  @ApiPropertyOptional({ description: '구급대 추정 중증도(참고용)' })
  @IsOptional() @IsString() @Length(1, 20)
  severityHint?: string;

  @ApiPropertyOptional({ description: '활력징후(자유 JSON)' })
  @IsOptional() @IsObject()
  vitals?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000)
  note?: string;
}
