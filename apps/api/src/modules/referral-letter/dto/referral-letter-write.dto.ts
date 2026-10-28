import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** 의뢰서 유형 정본 — 서비스 `LetterType` 이 이 목록에서 나온다(한 곳) · 스키마 주석(ReferralLetter.type) 그대로 */
export const REFERRAL_LETTER_TYPES = ['CONSULTATION_REQUEST', 'CONSULTATION_REPLY', 'TRANSFER', 'LAB_ORDER', 'CHECKUP_REFERRAL', 'MEDICAL_OPINION'] as const;
export type ReferralLetterType = (typeof REFERRAL_LETTER_TYPES)[number];

/**
 * 🔴 (2026-09-15 B10) 의뢰서 쓰기 4 핸들러 — 인라인 본문·`@Body('key')` 원시 추출이었다.
 *  - 초안 생성: 컨트롤러가 `body as any` 로 넘겼다. 유형 오타는 프롬프트 분기를 조용히 벗어났고, uuid 아닌 환자·진료 id 는 Prisma 500.
 *  - 수정: 본문 없이 부르면 `content: undefined`(바꾸지 않음)인데 `editedByDoctor: true` 만 찍혀 **고치지 않은 의뢰서가 "의사 수정됨"**이 됐다.
 *  - 거절·폐기: 사유는 강제하지 않는다(필수로 강제하면 거짓 사유가 쌓인다 — 서비스 주석) · 문자열이 아니면 400.
 * 길이는 스키마 VarChar(toDepartment 50·urgency 20) 그대로. 긴급도 어휘는 강제하지 않는다.
 */
export class GenerateReferralLetterDto {
  @ApiProperty({ enum: REFERRAL_LETTER_TYPES }) @IsIn(REFERRAL_LETTER_TYPES as unknown as string[]) type: ReferralLetterType;
  @ApiProperty() @IsUUID() patientId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() encounterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() consultationId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) toDepartment: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() toDoctorId?: string;
  @ApiPropertyOptional({ description: 'ROUTINE·URGENT·EMERGENT(스키마 주석)' }) @IsOptional() @IsString() @MaxLength(20) urgency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() additionalNote?: string;
}

export class UpdateReferralLetterDto {
  @ApiProperty({ description: '의뢰서 본문(DRAFT 만 수정)' }) @IsString() content: string;
}

export class ReferralLetterReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
