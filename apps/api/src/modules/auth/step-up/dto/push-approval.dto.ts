import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 폰 승인 요청 3종이 인라인 본문이라 검증이 없었다 — `prescriberId` 가 UUID 가 아니면 Prisma 500,
 * `action` 이 비어도 서비스 분기에 기댔다. 요약(summary)은 서비스가 120자로 자르므로 길이 제한을 두지 않는다.
 */
export class StepUpPushRequestDto {
  @ApiProperty() @IsString() @IsNotEmpty() action!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() resourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bodyHash?: string;
}

export class StepUpApprovePinDto {
  @ApiProperty() @IsString() @IsNotEmpty() pin!: string;
}
