import { IsUUID, IsOptional, IsString, IsInt, Min, Max, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartDispensingDto {
  @ApiPropertyOptional({ description: '약사 노트' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'DUR 경고 무시 사유(규제 감사)' })
  @IsOptional()
  @IsString()
  durOverrideReason?: string;
}

export class DispensingItemDto {
  @ApiProperty({ description: '의약품 코드 ID' })
  @IsUUID()
  medicationCodeId: string;

  @ApiProperty({ description: '처방 수량' })
  @IsInt()
  @Min(0)
  @Max(100000)
  prescribedQty: number;

  @ApiProperty({ description: '실제 조제 수량' })
  @IsInt()
  @Min(0)
  @Max(100000)
  dispensedQty: number;
}

export class UpdateDispensingDto {
  @ApiPropertyOptional({ description: '조제 항목들', type: [DispensingItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispensingItemDto)
  items?: DispensingItemDto[];

  @ApiPropertyOptional({ description: '약사 노트' })
  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * 조제 완료 — 고위험약/마약류면 2차 확인자(ISMP 독립 이중확인)가 필요하다.
 *
 * 🔴 `secondCheckBy` 는 **선택**이다. 고위험약이 아니면 요구하지 않는다
 *    (전부에 걸면 형식화되어 검출력이 사라진다 — ISMP). 대상 판정과 차단은 서버가 한다.
 */
export class CompleteDispensingDto {
  @ApiPropertyOptional({ description: '2차 확인자 User.id (고위험약/마약류·조제약사와 달라야 함)' })
  @IsOptional()
  @IsUUID('4', { message: '2차 확인자 ID 는 UUID 여야 합니다' })
  secondCheckBy?: string;
}

export class CancelDispensingDto {
  @ApiPropertyOptional({ description: '취소 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}
