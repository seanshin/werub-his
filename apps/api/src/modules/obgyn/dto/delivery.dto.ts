import { IsUUID, IsIn, IsOptional, IsString, IsInt, IsNumber, Min, Max, IsBoolean, Length, IsISO8601 } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDeliveryDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() encounterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 10) gestationalWeeks?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() laborOnsetAt?: string;
}

export class UpdateDeliveryDto {
  @ApiPropertyOptional({ enum: ['IN_LABOR', 'DELIVERED', 'POSTPARTUM', 'CLOSED'] }) @IsOptional() @IsIn(['IN_LABOR', 'DELIVERED', 'POSTPARTUM', 'CLOSED']) status?: string;
  @ApiPropertyOptional({ enum: ['VAGINAL', 'VACUUM', 'FORCEPS', 'CESAREAN'] }) @IsOptional() @IsIn(['VAGINAL', 'VACUUM', 'FORCEPS', 'CESAREAN']) deliveryType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveredAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) stage1Minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) stage2Minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) stage3Minutes?: number;
  @ApiPropertyOptional({ enum: ['NONE', 'EPIDURAL', 'SPINAL', 'GENERAL'] }) @IsOptional() @IsIn(['NONE', 'EPIDURAL', 'SPINAL', 'GENERAL']) anesthesia?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) bloodLossMl?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) indication?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) complications?: string;
  // 산욕
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) lochia?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) fundusStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) woundStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) breastfeeding?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) notes?: string;
}

export class CreateNewbornDto {
  @ApiProperty({ enum: ['M', 'F', 'AMBIGUOUS'] }) @IsIn(['M', 'F', 'AMBIGUOUS']) sex: string;
  @ApiPropertyOptional({ description: '출생 순번(다태아, 미지정 시 자동 부여)' }) @IsOptional() @IsInt() @Min(1) @Max(10) birthOrder?: number;
  @ApiPropertyOptional({ description: '신생아 식별밴드 번호' }) @IsOptional() @IsString() @Length(1, 40) idBandNo?: string;
  @ApiPropertyOptional({ description: '산모 식별밴드 번호(모아 페어링)' }) @IsOptional() @IsString() @Length(1, 40) motherBandNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() birthAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(200) @Max(7000) weightG?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(10) @Max(70) lengthCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(15) @Max(50) headCircCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10) apgar1?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10) apgar5?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10) apgar10?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) resuscitation?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() nicuAdmission?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) feedingType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) notes?: string;
}

/**
 * 모아 식별밴드 대조 — 🔴 종전 이 EP 는 인라인 `@Body() body: { motherBand; babyBand }` 였다.
 *    인라인 객체 타입은 런타임 metatype 이 `Object` 라 **ValidationPipe 가 통째로 스킵**한다
 *    (v4.3.0 처방 EP 와 같은 함정). 대조 문자열이 검증 없이 서비스에 들어가고 있었다.
 * 🔴 두 밴드 모두 **필수**다 — 하나만 보내 통과시키는 경로를 만들지 않는다(반쪽 대조는 대조가 아니다).
 */
export class VerifyNewbornMatchDto {
  @ApiProperty({ description: '스캔한 산모 식별밴드 번호' })
  @IsString() @Length(1, 40) motherBand: string;

  @ApiProperty({ description: '스캔한 신생아 식별밴드 번호' })
  @IsString() @Length(1, 40) babyBand: string;
}

export class AddLaborProgressDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10) cervicalDilation?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-5) @Max(5) station?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10) contractionFreq?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(300) contractionDur?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(300) fetalHeartRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) note?: string;
  /** 측정 시각(ISO-8601) — 🔴 (2026-10-10) 종전엔 칸이 없어 **저장한 시각**이 측정 시각이 됐다(파토그래프 시간축이 입력 지연만큼 밀린다). 비우면 저장 시각 */
  @ApiPropertyOptional() @IsOptional() @IsISO8601() recordedAt?: string;
}
