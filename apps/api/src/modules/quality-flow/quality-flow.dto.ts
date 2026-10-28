import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, IsNotEmpty, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ACCREDITATION_FRAMEWORKS, ACCREDITATION_JUDGMENTS, QI_DEVICE_TYPES } from '@hospital-run/shared';

export class PeriodDto {
  @ApiProperty({ description: 'YYYY-MM' }) @Matches(/^\d{4}-\d{2}$/)
  period!: string;
}

export class PeriodQueryDto {
  @ApiPropertyOptional({ description: 'YYYY-MM' }) @IsOptional() @Matches(/^\d{4}-\d{2}$/)
  period?: string;
}

export class DateRangeDto {
  @ApiProperty({ description: 'YYYY-MM-DD' }) @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ description: 'YYYY-MM-DD(포함)' }) @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

export class SpcQueryDto {
  @ApiPropertyOptional({ description: '개월 수(3~36)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(36)
  months?: number;
}

export class TargetAgendaDto {
  @ApiProperty({ type: [Number], description: '목표 후보 1~3' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsNumber({}, { each: true })
  targets!: number[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class NoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class DeviceDayDto {
  @ApiProperty({ description: 'YYYY-MM' }) @Matches(/^\d{4}-\d{2}$/)
  period!: string;

  @ApiPropertyOptional({ description: '병동 id(비우면 병원 전체)' }) @IsOptional() @IsUUID()
  wardKey?: string;

  @ApiProperty({ enum: QI_DEVICE_TYPES }) @IsIn(QI_DEVICE_TYPES as unknown as string[])
  deviceType!: string;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  days!: number;
}

export class CreateAccreditationStandardDto {
  @ApiProperty({ enum: ACCREDITATION_FRAMEWORKS }) @IsIn(ACCREDITATION_FRAMEWORKS as unknown as string[])
  framework!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120)
  chapter!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(40)
  code!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300)
  title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  measurableElement?: string;

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true })
  indicatorIds?: string[];

  @ApiPropertyOptional({ description: '원문 출처(문서명·판·쪽)' }) @IsOptional() @IsString() @MaxLength(300)
  sourceRef?: string;
}

export class AttachmentDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) url!: string;
}

export class AccreditationAssessDto {
  @ApiProperty({ description: '평가 주기 표식(예: 2026-H2)' }) @IsString() @IsNotEmpty() @MaxLength(20)
  cycle!: string;

  @ApiProperty({ enum: ACCREDITATION_JUDGMENTS }) @IsIn(ACCREDITATION_JUDGMENTS as unknown as string[])
  judgment!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  evidenceText?: string;

  @ApiPropertyOptional({ type: [AttachmentDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;
}

/** 기구 원장 조회 — 환자 또는 입원 하나 이상 */
export class DeviceLineQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  patientId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  admissionId?: string;

  @ApiPropertyOptional({ description: 'true 면 무효 행 포함' }) @IsOptional() @IsIn(['true', 'false'])
  includeVoided?: string;
}

export class DeviceLineRecordDto {
  @ApiProperty() @IsUUID()
  patientId!: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  admissionId?: string;

  @ApiProperty({ enum: QI_DEVICE_TYPES }) @IsIn([...QI_DEVICE_TYPES])
  deviceType!: string;

  @ApiPropertyOptional({ description: '부위(예: 우측 내경정맥)' }) @IsOptional() @IsString() @MaxLength(80)
  site?: string;

  @ApiProperty({ description: '삽입 시각 ISO 8601' }) @IsString() @IsNotEmpty()
  insertedAt!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class DeviceLineRemoveDto {
  @ApiProperty({ description: '제거 시각 ISO 8601' }) @IsString() @IsNotEmpty()
  removedAt!: string;
}

export class DeviceLineVoidDto {
  @ApiProperty({ description: '무효 사유(5자 이상)' }) @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
