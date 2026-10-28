import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Min, ValidateIf, ValidateNested,
} from 'class-validator';

/**
 * 비대면 상담(의사 쪽) 쓰기 본문 — 🔴 (2026-09-15 N4-B8) 종전 인라인 타입은 런타임 metatype 이 `Object` 라
 * ValidationPipe 가 통째로 건너뛰었다.
 *  - 진료과 설정: 서비스가 **본문 전체를 `value` 로 저장**했다 — 아무 키나 운영 정책(system_configs)에 박혔다.
 *  - 처방: `duration`·`quantity` 에 문자열·0·음수가 그대로 처방으로 저장되거나 500 이 났다.
 * 필드 이름은 종전 인라인 타입·화면(remote-consult/page.tsx)이 보내는 키와 같다(whitelist 가 지우지 않게 — 계약 스펙이 대조).
 * 길이 상한·카테고리 어휘는 정본 정책이 없어 지어내지 않는다.
 */
export class SetRemoteDepartmentConfigDto {
  @ApiProperty({ description: '비대면 허용 진료과 목록 — null=전체 허용', type: [String], nullable: true })
  @ValidateIf((o: SetRemoteDepartmentConfigDto) => o.enabled !== null)
  @IsArray()
  @IsString({ each: true })
  enabled!: string[] | null;

  @ApiPropertyOptional({ description: '감염병 모드' })
  @IsOptional()
  @IsBoolean()
  infectiousMode?: boolean;
}

export class RemoteDoctorReplyDto {
  @ApiProperty({ description: '답변 본문' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({ description: '첨부(형식은 서비스가 그대로 저장)', type: [Object] })
  @IsOptional()
  @IsArray()
  attachments?: unknown[];

  @ApiPropertyOptional({ description: '의료적 조언 여부' })
  @IsOptional()
  @IsBoolean()
  isMedicalAdvice?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsUUID() sharedLabResultId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sharedImagingId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sharedPrescriptionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assessment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;

  @ApiPropertyOptional({ description: '단순 문의(무료 처리)' })
  @IsOptional()
  @IsBoolean()
  isSimpleInquiry?: boolean;
}

export class RemoteCompleteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() assessment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;
  @ApiPropertyOptional({ description: '진료 기록(Encounter) 연결' }) @IsOptional() @IsBoolean() linkToEncounter?: boolean;
}

export class RemotePrescriptionItemDto {
  @ApiProperty() @IsUUID() medicationCodeId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() dosage!: string;
  @ApiProperty() @IsString() @IsNotEmpty() frequency!: string;

  @ApiProperty({ description: '투약 일수(1 이상 정수)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration!: number;

  @ApiProperty({ description: '총량(1 이상 정수)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty() @IsString() @IsNotEmpty() route!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instructions?: string;
}

export class RemotePrescribeDto {
  @ApiProperty({ type: [RemotePrescriptionItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RemotePrescriptionItemDto)
  medications!: RemotePrescriptionItemDto[];

  @ApiPropertyOptional({ description: '조제 유형(서비스 정의: INTERNAL=원내 · EXTERNAL=원외 · 기본 EXTERNAL)', enum: ['INTERNAL', 'EXTERNAL'] })
  @IsOptional()
  @IsIn(['INTERNAL', 'EXTERNAL'])
  dispensingType?: 'INTERNAL' | 'EXTERNAL';
}

export class RemoteInitiateDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() subject!: string;
  @ApiProperty() @IsString() @IsNotEmpty() content!: string;
  @ApiProperty() @IsString() @IsNotEmpty() category!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sharedLabResultId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sharedImagingId?: string;
}

export class RemoteVideoProposeDto {
  @ApiPropertyOptional({ description: '제안 시각(ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
