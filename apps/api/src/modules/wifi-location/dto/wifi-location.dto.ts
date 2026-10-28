import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { WIFI_COLLECT_MODES, WIFI_CONSENT_BASES, WIFI_DEVICE_KINDS, WIFI_PROTOCOL_LIMITS } from '@hospital-run/shared';

/**
 * wifi-location.v1 배치 — 겉 칸만 여기서 거르고, 관측 안쪽(단말·시각·AP·RSSI)은 shared `checkWifiBatch` 가 전부 본다
 * (형식 오류는 배치 전체 400 — 일부만 저장하지 않는다).
 */
export class WifiIngestDto {
  @ApiProperty({ example: 'wifi-location.v1' }) @IsString() schema!: string;
  @ApiProperty({ enum: WIFI_COLLECT_MODES }) @IsIn(WIFI_COLLECT_MODES as unknown as string[]) mode!: string;
  @ApiProperty({ description: '수집기가 보낸 시각(ISO-8601)' }) @IsString() sentAt!: string;
  @ApiPropertyOptional({ enum: ['RAW', 'DEVICE_HASHED'] }) @IsOptional() @IsIn(['RAW', 'DEVICE_HASHED']) deviceRefKind?: string;
  @ApiProperty({ description: '관측 목록 — {deviceRef, observedAt, readings:[{bssid, rssi, band?, channel?}]}' })
  @IsArray() @ArrayMaxSize(WIFI_PROTOCOL_LIMITS.maxObservations) observations!: unknown[];
}

export class CreateWifiApDto {
  @ApiProperty({ example: 'aa:bb:cc:dd:ee:ff' }) @IsString() @Length(12, 17) bssid!: string;
  @ApiProperty() @IsString() @Length(1, 100) label!: string;
  @ApiProperty({ description: '확정 도면의 층 키(1F 등)' }) @IsString() @Length(1, 10) floorKey!: string;
  @ApiProperty({ description: '층 도면 좌표 x(m)' }) @Type(() => Number) @IsNumber() @Min(-1000) @Max(5000) x!: number;
  @ApiProperty({ description: '층 도면 좌표 y(m)' }) @Type(() => Number) @IsNumber() @Min(-1000) @Max(5000) y!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) vendor?: string;
}

export class UpdateWifiApDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) label?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(-1000) @Max(5000) x?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(-1000) @Max(5000) y?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  /** 교정 — 1m 수신 세기(dBm) · null 이면 교정 지움 */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-90) @Max(-10) rssiAt1m?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(1.5) @Max(6) pathLossExponent?: number | null;
}

export class CreateWifiCollectorDto {
  @ApiProperty() @IsString() @Length(1, 100) label!: string;
  @ApiProperty({ enum: WIFI_COLLECT_MODES }) @IsIn(WIFI_COLLECT_MODES as unknown as string[]) mode!: 'NETWORK' | 'DEVICE';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) vendor?: string;
}

export class SetWifiCollectorActiveDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

export class BindWifiDeviceDto {
  @ApiProperty({ description: '단말 식별자(태그 번호·MAC) — 서버는 해시와 끝 4자리만 남긴다' }) @IsString() @Length(4, WIFI_PROTOCOL_LIMITS.maxDeviceRefLength) deviceRef!: string;
  @ApiProperty({ enum: WIFI_DEVICE_KINDS }) @IsIn(WIFI_DEVICE_KINDS as unknown as string[]) deviceKind!: 'TAG' | 'PATIENT_APP' | 'NETWORK_CLIENT';
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty({ enum: WIFI_CONSENT_BASES }) @IsIn(WIFI_CONSENT_BASES as unknown as string[]) consentBasis!: 'WRITTEN' | 'VERBAL_RECORDED' | 'DEMO';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) consentNote?: string;
}

export class UnbindWifiDeviceDto {
  @ApiProperty() @IsString() @Length(1, 200) reason!: string;
}

/** 현장 측정 표본의 한 AP 세기 */
export class WifiSurveyReadingDto {
  @ApiProperty({ example: 'aa:bb:cc:dd:ee:ff' }) @IsString() @Length(12, 17) bssid!: string;
  @ApiProperty({ example: -61 }) @Type(() => Number) @IsNumber() @Min(WIFI_PROTOCOL_LIMITS.rssiMin) @Max(WIFI_PROTOCOL_LIMITS.rssiMax) rssi!: number;
}

/** 현장 측정 표본 — 위치를 아는 지점(층·좌표)에서 잰 신호 */
export class CreateWifiSurveyDto {
  @ApiProperty({ description: '확정 도면의 층 키' }) @IsString() @Length(1, 10) floorKey!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-1000) @Max(5000) x!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-1000) @Max(5000) y!: number;
  @ApiProperty({ description: '측정 시각(ISO-8601) — 모르면 보내지 않는 것이 아니라 필수(교정 근거)' }) @IsISO8601() measuredAt!: string;
  @ApiProperty({ type: [WifiSurveyReadingDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(WIFI_PROTOCOL_LIMITS.maxReadings)
  @ValidateNested({ each: true }) @Type(() => WifiSurveyReadingDto) readings!: WifiSurveyReadingDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) note?: string;
}

export class VoidWifiSurveyDto {
  @ApiProperty() @IsString() @Length(1, 200) reason!: string;
}

/** AP 등록부 CSV 가져오기 — 미리보기(dryRun) 먼저 */
export class ImportWifiApCsvDto {
  @ApiProperty({ description: '첫 줄 머리글 bssid,label,floorKey,x,y,vendor · 최대 500행' }) @IsString() @Length(1, 200_000) csv!: string;
  @ApiPropertyOptional({ description: 'true 면 미리보기만(쓰기 0)' }) @IsOptional() @IsBoolean() dryRun?: boolean;
}

/** 일괄 해제 — 사람이 고른 연결만 · 사유 필수 */
export class UnbindWifiBulkDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) ids!: string[];
  @ApiProperty() @IsString() @Length(1, 200) reason!: string;
}
