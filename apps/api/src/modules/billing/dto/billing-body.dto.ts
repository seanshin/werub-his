import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';

/** 🔴 (2026-09-15 T2) 인라인 @Body → DTO — 종전엔 ValidationPipe 가 스킵됐다 */
export class ReemitAccrualDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cancelled?: boolean;
  /** 서비스가 `${treatedOn}T12:00:00+09:00` 로 조립한다 — 날짜만(YYYY-MM-DD) 받아야 Invalid Date 가 되지 않는다 */
  @ApiPropertyOptional({ example: '2026-09-14' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) treatedOn?: string;
}

/** 보험코드 형식(8~13자리 숫자) 판정은 서비스가 `{ok:false, reason:'INVALID_INSURANCE_CODE'}` 계약으로 돌려준다 — 여기서 400 으로 바꾸지 않는다 */
export class ConfirmDrugCodeDto {
  @ApiProperty() @IsString() @IsNotEmpty() hisCode!: string;
  @ApiProperty() @IsString() insuranceCode!: string;
}

/** 🔴 totalInstallments 0 이면 서비스가 `amount / 0` = Infinity 회차 금액을 만든다 — 1 이상 정수만 */
export class CreateInstallmentPlanDto {
  @ApiProperty({ example: 3 }) @Type(() => Number) @IsInt() @Min(1) totalInstallments!: number;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) intervalDays?: number;
}
