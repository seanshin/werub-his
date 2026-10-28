import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * 협진 의뢰 생성.
 *
 * 🔴 종전엔 **인라인 `@Body()`** 였다 — 런타임 metatype 이 `Object` 라 `ValidationPipe` 가
 *    통째로 스킵됐다(처방 EP 가 같은 이유로 검증이 한 번도 실행된 적 없었던 전례).
 *    화면을 붙이면서 DTO 로 승격한다 — **부르는 화면까지가 한 벌**이고, 검증도 한 벌이다.
 */
export const CONSULT_URGENCY = ['ROUTINE', 'URGENT', 'EMERGENCY'] as const;

export class CreateConsultationDto {
  @ApiProperty({ description: '의뢰 근거 진료(Encounter) ID' })
  @IsUUID()
  encounterId!: string;

  @ApiProperty({ description: '의뢰 대상 진료과' })
  @IsString()
  @Length(1, 100)
  toDepartment!: string;

  @ApiPropertyOptional({ description: '의뢰 대상 의사(지정 시)' })
  @IsOptional()
  @IsUUID()
  toDoctorId?: string;

  @ApiProperty({ description: '의뢰 사유' })
  @IsString()
  @Length(2, 2000)
  reason!: string;

  @ApiPropertyOptional({ description: '임상 질문(무엇을 답해 주기 바라는가)' })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  clinicalQuestion?: string;

  @ApiPropertyOptional({ enum: CONSULT_URGENCY })
  @IsOptional()
  @IsIn(CONSULT_URGENCY as unknown as string[])
  urgency?: string;
}

/**
 * 🔴 (2026-09-15 B10) 협진 회신 — 인라인 본문이었다. 본문 없이 부르면 `replyContent` 없이 상태만 `REPLIED` 가 됐다
 *    (회신 내용 없는 "회신 완료"). 회신 의사(`replyDoctorId`)는 본문이 아니라 로그인 사용자다.
 */
export class ReplyConsultationDto {
  @ApiProperty({ description: '회신 내용' })
  @IsString()
  @IsNotEmpty()
  replyContent: string;

  @ApiPropertyOptional({ description: '권고사항' })
  @IsOptional()
  @IsString()
  recommendations?: string;
}
