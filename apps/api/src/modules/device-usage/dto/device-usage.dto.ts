import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

/** 🔴 인라인 `@Body` 를 쓰지 않는다 — 검증이 통째로 스킵된다 */
export class ScanBarcodeDto {
  @ApiProperty({ description: 'GS1-128 또는 GTIN 원문' })
  @IsString()
  @Length(1, 200)
  barcode!: string;
}

export const DEVICE_USAGE_TYPES = ['IMPLANT', 'SINGLE_USE', 'REUSABLE', 'OTHER'] as const;

export class RecordDeviceUsageDto {
  @ApiProperty() @IsUUID() patientId!: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() surgeryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() encounterId?: string;

  @ApiPropertyOptional({ description: '스캔 원문 — 보존된다' })
  @IsOptional() @IsString() @Length(1, 200) barcode?: string;

  @ApiProperty({ description: '기기명' })
  @IsString() @Length(1, 300) deviceName!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) manufacturer?: string;

  @ApiPropertyOptional({ enum: DEVICE_USAGE_TYPES })
  @IsOptional() @IsIn(DEVICE_USAGE_TYPES as unknown as string[]) usageType?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(999) quantity?: number;

  /** 스캔이 안 되는 기기는 손으로 넣는다 — 사람이 스캔을 정정할 수도 있어야 한다 */
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(8, 14) gtin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) lotNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) serialNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) note?: string;
}
