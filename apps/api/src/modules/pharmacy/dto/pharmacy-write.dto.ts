import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 B5) 약국 인라인 @Body 8 핸들러 → class DTO.
 * 종전은 런타임 metatype 이 `Object` 라 ValidationPipe 가 통째로 스킵됐다 —
 *  · 대체조제 요청 `{ ...body, pharmacistId }` 가 그대로 `genericSubstitution.create` 로 가서
 *    본문의 `status: 'APPROVED'`·`doctorApproved: true` 가 **의사 승인 없이 승인된 대체조제**를 만들 수 있었다.
 *  · 기기 등록 `data: body as never` — 본문의 `status: 'ONLINE'`·`lastHeartbeatAt` 이 하트비트 없이 "온라인"을 만들었다.
 * 제약은 스키마·서비스 근거만(길이·uuid·Int) · 도메인 어휘(type·connectionType)는 막지 않는다.
 */

export class VerifyDispensingDto {
  @ApiPropertyOptional({ description: '블록체인 서명 블록(구조만 보장 — 값 검증은 서명 서비스)' })
  @IsOptional()
  @IsObject()
  blockchainSignature?: { certificateId: string; signatureValue: string; signatureAlgorithm: string; documentHash: string };

  @ApiPropertyOptional({ description: '환자 앱 푸시 명시 옵트인(기본 false)' })
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;
}

export class IssueDispensingDto {
  /** 수령 확인 기록(Dispensing.issuedTo VarChar(100)) — 기록이라 자르지 않고 400 · 화면은 공란이면 키를 빼고 보낸다 */
  @ApiPropertyOptional({ description: '수령자(외래: 환자/보호자명, 입원: 병동/인수자)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  issuedTo?: string;
}

export class StartSplitDispensingDto {
  @ApiProperty() @IsUUID() orderId: string;
  /** 서비스가 `totalQty / totalSplits` 로 나눈다 — 0·음수·소수는 Infinity/NaN 수량(종전 Prisma 500) */
  @ApiProperty({ description: '분할 회차 수' }) @IsInt() @Min(1) totalSplits: number;
}

export class DispenseSplitNextDto {
  @ApiProperty() @IsUUID() orderId: string;
}

export class RequestSubstitutionDto {
  @ApiProperty() @IsUUID() originalPrescriptionId: string;
  @ApiProperty() @IsUUID() substituteMedicationCodeId: string;
  @ApiProperty({ description: '대체 사유' }) @IsString() reason: string;
}

/** 대체조제 판정(2026-09-30) — 승인 메모(선택) · 거부 사유(필수 — 서비스가 400) */
export class DecideSubstitutionDto {
  @ApiPropertyOptional({ description: '승인 메모 또는 거부 사유(거부는 필수)' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreatePharmacyDeviceDto {
  @ApiProperty() @IsString() @MaxLength(100) name: string; // VarChar(100)
  @ApiProperty({ description: 'ATC, COUNTER, PACKAGER, LABEL_PRINTER' }) @IsString() @MaxLength(20) type: string; // VarChar(20)
  @ApiProperty({ description: 'TCP, SERIAL, USB, API' }) @IsString() @MaxLength(10) connectionType: string; // VarChar(10)
  @ApiProperty({ description: '연결 설정(JSON 객체)' }) @IsObject() connectionConfig: Record<string, unknown>; // Json NOT NULL
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
}

export class CreateAtcJobDto {
  @ApiProperty() @IsUUID() dispensingId: string;
  @ApiProperty({ description: '[{code, qty, slot}]' }) @IsArray() medications: unknown[];
}

export class GeneratePharmacyLabelDto {
  @ApiProperty() @IsUUID() dispensingId: string;
}
