import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

/**
 * 🔴 (2026-09-15 T2) 인라인 @Body → DTO. 길이 제약은 넣지 않는다 — 서비스가 스키마 VarChar 에 맞춰 slice 로 자르는 계약이라
 * 여기서 MaxLength 로 400 을 내면 종전 성공하던 요청이 거부된다(자르는 것 자체의 적정성은 별도 판단).
 */
export class ReviewSampleDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() claimId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() encounterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() doctorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() result?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() reducedAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

/**
 * 사유코드 비어 있음·금액 양수 판정은 서비스가 한다(도메인 메시지 유지)
 * 🔴 (2026-09-15 U4) 심사조정 기록은 청구 이의·재청구의 근거라 **조용히 자르지 않는다** — 종전엔 서비스가 VarChar 에 맞춰
 *    slice 로 잘라 저장해 사용자는 입력한 사유가 온전히 남았다고 믿었다. 길이는 스키마(ClaimAdjustment) 그대로 400 으로 알린다.
 *    화면(ClaimAdjustmentSection)은 같은 커밋에서 maxLength 를 건다. 서비스 slice 는 방어로 남는다(도달하지 않음).
 */
export class ClaimAdjustmentLineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) lineRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) itemName?: string;
  @ApiProperty() @IsString() @MaxLength(20) adjustCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) adjustReason?: string;
  @ApiProperty() @IsNumber() amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}

export class AddClaimAdjustmentsDto {
  @ApiProperty({ type: [ClaimAdjustmentLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => ClaimAdjustmentLineDto)
  lines!: ClaimAdjustmentLineDto[];
}

/** 상태 어휘(ACCEPTED|APPEALING|REWORK|RESOLVED) 판정은 서비스 정본 — 종전 `@Body('status')` 원시값 추출은 파이프를 스킵했다 */
export class SetClaimAdjustmentStatusDto {
  @ApiProperty() @IsString() status!: string;
}

export class ClaimAppealDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) attachments?: string[];
}
