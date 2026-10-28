import { IsString, IsOptional, IsDateString, IsEnum, ValidateNested, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class CauseChainDto {
  @ApiProperty({ description: '(가) 직접 사인' }) @IsString() a: string;
  @ApiPropertyOptional({ description: '(나) (가)의 원인' }) @IsOptional() @IsString() b?: string;
  @ApiPropertyOptional({ description: '(다) (나)의 원인' }) @IsOptional() @IsString() c?: string;
  @ApiPropertyOptional({ description: '(라) (다)의 원인' }) @IsOptional() @IsString() d?: string;
}

export class MarkDeceasedDto {
  @ApiProperty({ example: '2026-05-09T14:30:00Z' })
  @IsDateString()
  deathDate: string;

  @ApiPropertyOptional({ example: '심정지' })
  @IsOptional()
  @IsString()
  deathCause?: string;

  @ApiPropertyOptional({ enum: ['HOSPITAL', 'ER', 'OR', 'ICU', 'OTHER'] })
  @IsOptional()
  @IsString()
  deathLocation?: string;

  @ApiPropertyOptional({ enum: ['NATURAL', 'EXTERNAL', 'OTHER'] })
  @IsOptional()
  @IsString()
  deathType?: string;

  @ApiPropertyOptional({ description: '사인 체인 (가→나→다→라)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CauseChainDto)
  causeChain?: CauseChainDto;

  /**
   * 🔴 (2026-09-15 P2) 세 후속 처리는 서비스가 `!== false` 로 판정한다(생략=수행). `@IsOptional` 만이라
   *    문자열 `"false"` 가 통과해 `"false" !== false` → **사용자가 끈 처방 중단·예약 취소·퇴원이 그대로 실행**됐다.
   *    되돌리기 어려운 연쇄라 불리언만 받는다.
   */
  @ApiPropertyOptional({ description: '자동 후속 처리 수행 여부' })
  @IsOptional()
  @IsBoolean()
  stopPrescriptions?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  cancelAppointments?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dischargeIfAdmitted?: boolean;
}
