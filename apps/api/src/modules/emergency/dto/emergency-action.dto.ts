import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 B7) 응급 처치·코드 방송·사전통보·MCI 쓰기 6 핸들러가 인라인 타입이라 ValidationPipe 가 스킵됐다.
 *  - 코드 방송은 **아무 문자열이나** 전 의료진(최대 500명)에게 critical 알림 제목으로 나갔다 — 길이·빈 값을 입구에서 막는다
 *    (코드 어휘는 지어내지 않는다: 화면 버튼 3종 외 원내 코드가 있을 수 있다).
 *  - 도착 연결 `visitId`·MCI `expectedCasualties` 는 형식 밖이면 `@db.Uuid`·`Int` 컬럼에서 Prisma 500 → 400.
 * MCI 유형 어휘는 스키마 주석 3종(MCI·DISASTER·DRILL)만.
 */
export const MCI_TYPES = ['MCI', 'DISASTER', 'DRILL'] as const;

export class EmergencyTreatmentNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string;
}

export class EmergencyCodeAlertDto {
  @ApiProperty({ description: '화면 버튼: CODE_BLUE·CODE_RED·CODE_WHITE' }) @IsString() @IsNotEmpty() @MaxLength(30) code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
}

export class PrenotificationArriveDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() visitId?: string;
}

export class PrenotificationCancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ActivateMciDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiPropertyOptional({ enum: MCI_TYPES }) @IsOptional() @IsIn(MCI_TYPES) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) expectedCasualties?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string;
}

export class CloseMciDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string;
}
