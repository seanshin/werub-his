import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 표준 매핑 추가가 `Prisma.TerminologyMappingUncheckedCreateInput` 본문을 그대로 create 에 넣었다 —
 * `mapSource`(MANUAL/AUTO 출처)·`createdBy`·`isActive`·`id` 를 본문으로 지정할 수 있었다(대량 할당 · 출처 위장).
 * 출처·작성자·활성은 DTO 에 두지 않는다(서버 기본값). 길이·정밀도는 `TerminologyMapping` 스키마 그대로(confidence Decimal(3,2)).
 */
export class CreateTerminologyMappingDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) sourceTable!: string;
  @ApiProperty() @IsUUID() sourceId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) sourceCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) targetSystem!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) targetCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) targetDisplay!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) targetVersion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) equivalence?: string;
  @ApiPropertyOptional({ description: '0~1 (Decimal(3,2))' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(9.99) confidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
}
