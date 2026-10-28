import { IsString, IsOptional, IsUUID, IsBoolean, IsInt, IsIn, IsArray, ArrayMaxSize, Length, Min, Max, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertWorkstationDto {
  @ApiProperty({ description: '워크스테이션 코드(로그인/선택 키)' }) @IsString() @Length(1, 30) code: string;
  @ApiProperty() @IsString() @Length(1, 100) label: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) location?: string;
  @ApiPropertyOptional({ type: [String], description: '논리 스테이션 ID 매핑' }) @IsOptional() @IsArray() @IsString({ each: true }) defaultStationIds?: string[];
  @ApiPropertyOptional({ description: '물리 단말 바인딩(TerminalRegistry id)' }) @IsOptional() @IsUUID() terminalId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

const PERIPHERAL_TYPES = ['LABEL_PRINTER', 'DOC_PRINTER', 'BARCODE_SCANNER', 'SIGNATURE_PAD', 'DICOM_MODALITY', 'VITALS_MONITOR', 'CARD_READER', 'OTHER'] as const;
const CONNECTIONS = ['NETWORK', 'LOCAL_AGENT', 'WEBUSB', 'WEBSERIAL'] as const;

export class UpsertPeripheralDto {
  @ApiProperty() @IsUUID() workstationProfileId: string;
  @ApiProperty({ enum: PERIPHERAL_TYPES }) @IsIn(PERIPHERAL_TYPES as unknown as string[]) type: string;
  @ApiProperty() @IsString() @Length(1, 100) name: string;
  @ApiPropertyOptional({ enum: CONNECTIONS }) @IsOptional() @IsIn(CONNECTIONS as unknown as string[]) connection?: string;
  @ApiPropertyOptional({ description: '네트워크 IP/호스트' }) @IsOptional() @IsString() @Length(1, 120) host?: string;
  @ApiPropertyOptional({ description: '포트(라벨프린터 9100 등)' }) @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @ApiPropertyOptional({ type: Object, description: '드라이버별 설정(용지·DPI·에이전트·프로토콜)' }) @IsOptional() @IsObject() config?: Record<string, unknown>;
  @ApiPropertyOptional({ description: '유형별 기본기' }) @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PrintJobDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() workstationProfileId?: string;
  @ApiPropertyOptional({ description: '워크스테이션 코드(id 대체)' }) @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiProperty({ enum: ['LABEL', 'DOC'] }) @IsIn(['LABEL', 'DOC']) kind: string;
  @ApiProperty({ description: 'ZPL(라벨) 또는 텍스트(문서)' }) @IsString() @Length(1, 100000) payload: string;
}

export class PrintOrderLabelDto {
  @ApiProperty() @IsUUID() orderId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workstationProfileId?: string;
  @ApiPropertyOptional({ description: '워크스테이션 코드(id 대체)' }) @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional({ description: '매수(1~5)' }) @IsOptional() @IsInt() @Min(1) @Max(5) copies?: number;
}

/** 논리 스테이션 검사항목(수가코드) 설정 — 🔴 마스터 대조는 조회가 알려주고 저장은 막지 않는다 */
export class SetStationOrderCodesDto {
  @ApiProperty({ type: [String], description: '수가코드 목록(공백·중복은 서버가 정리)' })
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @Length(1, 20, { each: true })
  orderCodes: string[];
}
