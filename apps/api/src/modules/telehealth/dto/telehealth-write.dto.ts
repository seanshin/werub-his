import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min, ValidateIf } from 'class-validator';

/**
 * 원격진료 세션 쓰기 본문 — 🔴 (2026-09-15 N4-B8) 종전 인라인 타입은 ValidationPipe 가 통째로 건너뛰었다.
 *  - 세션 생성: `scheduledAt` 이 형식 밖이면 Invalid Date 로 저장 단계에서 500, `sessionType` 은 아무 문자열.
 *  - (직원 JWT 평가 EP 는 2026-09-15 제거 — 환자 평가는 포털 본인 경로 `PortalTelehealthRateDto` 만)
 * 필드 이름은 종전 인라인 타입·화면(telehealth/page.tsx `form`)과 같다.
 */
export class CreateTelehealthSessionDto {
  @ApiProperty() @IsUUID() patientId!: string;

  @ApiPropertyOptional({ description: '담당의 — 의사 본인이 잡을 때만 생략(빈 값 포함 · 서버가 판정)' })
  @ValidateIf((o: CreateTelehealthSessionDto) => o.doctorId != null && o.doctorId !== '')
  @IsUUID()
  doctorId?: string;

  @ApiProperty({ description: '예약 시각(ISO-8601)' })
  @IsISO8601()
  scheduledAt!: string;

  @ApiProperty({ description: '세션 유형(스키마 정의 VIDEO·AUDIO·ASYNC)', enum: ['VIDEO', 'AUDIO', 'ASYNC'] })
  @IsIn(['VIDEO', 'AUDIO', 'ASYNC'])
  sessionType!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() chiefComplaint?: string;
}

export class EndTelehealthSessionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosisCode?: string;
}
