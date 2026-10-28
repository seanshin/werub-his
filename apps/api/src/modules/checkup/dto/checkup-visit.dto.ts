import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  IsDateString,
  IsUUID,
  IsIn,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCheckupVisitDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '프로그램 ID' })
  @IsUUID()
  programId: string;

  @ApiProperty({ description: '예약일', example: '2026-06-15' })
  @IsDateString()
  scheduledDate: string;

  @ApiPropertyOptional({ description: '선택 추가 항목 ID 목록' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptions?: string[];

  @ApiPropertyOptional({ description: '국가건강검진 여부' })
  @IsOptional()
  @IsBoolean()
  isNhiScreening?: boolean;

  @ApiPropertyOptional({ description: '국가검진 코드' })
  @IsOptional()
  @IsString()
  nhiScreeningCode?: string;

  @ApiPropertyOptional({ description: '단체 계약 ID' })
  @IsOptional()
  @IsUUID()
  contractId?: string;
}

/**
 * 🔴 허용 어휘는 서비스의 `STATUS_FLOW` 전이 대상과 같아야 한다.
 *    종전 목록에 `PARTIAL_COMPLETE` 가 빠져 있어, `STATUS_FLOW.IN_PROGRESS` 가 허용하는 전이를
 *    ValidationPipe 가 **400 으로 먼저 잘랐다**(계약 불일치·P11). 실피해는 없었다 —
 *    현재 그 상태는 `checkAutoStatusTransition` 이 자동으로만 세운다.
 *    `CANCELLED`·`NO_SHOW` 는 여기 넣지 않는다(전용 EP 가 취소 규칙·사유를 함께 검사한다).
 */
export class UpdateCheckupVisitStatusDto {
  @ApiProperty({
    description: '변경할 상태',
    enum: [
      'RESERVED',
      'CHECKED_IN',
      'IN_PROGRESS',
      'EXAM_COMPLETE',
      'PARTIAL_COMPLETE',
      'REVIEW',
      'COMPLETED',
      'DELIVERED',
    ],
  })
  @IsString()
  @IsIn([
    'RESERVED',
    'CHECKED_IN',
    'IN_PROGRESS',
    'EXAM_COMPLETE',
    'PARTIAL_COMPLETE',
    'REVIEW',
    'COMPLETED',
    'DELIVERED',
  ])
  status: string;
}

export class CreateWalkInVisitDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '프로그램 ID' })
  @IsUUID()
  programId: string;

  @ApiPropertyOptional({ description: '선택 추가 항목 ID 목록' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptions?: string[];

  @ApiPropertyOptional({ description: '국가건강검진 여부' })
  @IsOptional()
  @IsBoolean()
  isNhiScreening?: boolean;

  @ApiPropertyOptional({ description: '국가검진 코드' })
  @IsOptional()
  @IsString()
  nhiScreeningCode?: string;

  @ApiPropertyOptional({ description: '단체 계약 ID' })
  @IsOptional()
  @IsUUID()
  contractId?: string;
}

export class CreateCheckupSummaryDto {
  @ApiProperty({
    description: '종합 등급',
    enum: ['A', 'B', 'C1', 'C2', 'D1', 'D2'],
  })
  @IsString()
  @IsIn(['A', 'B', 'C1', 'C2', 'D1', 'D2'])
  overallGrade: string;

  @ApiProperty({ description: '영역별 판정', type: 'array' })
  @IsArray()
  sections: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '의사 종합소견' })
  @IsOptional()
  @IsString()
  doctorOpinion?: string;

  @ApiPropertyOptional({ description: '추천사항 목록' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recommendations?: string[];
}
