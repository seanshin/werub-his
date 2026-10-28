import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PAYMENT_METHODS } from '@hospital-run/shared';

/**
 * 분할 납부 1회차 수납.
 *
 * 🔴 종전에는 컨트롤러에 인라인 타입(`@Body() dto: { method?: string }`)이라
 *    **ValidationPipe 가 통째로 스킵**됐다(v4.3.0 에서 정리한 유형). 그 값이 그대로
 *    수납 원장의 `method` 로 저장되므로 어휘가 오염되면 대사가 갈라진다.
 */
export class PayInstallmentDto {
  @ApiPropertyOptional({ description: '결제 수단(미지정 시 원장에 UNKNOWN 으로 남는다)', enum: PAYMENT_METHODS })
  @IsOptional()
  @IsString()
  @IsIn([...PAYMENT_METHODS])
  method?: string;

  @ApiPropertyOptional({ description: '원무 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
