import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsIn, IsArray, IsObject,
  IsDateString, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 병리 DTO — 🔴 인라인 @Body 승격(2026-08-18)
 *
 * `POST /pathology/specimens`·`POST /pathology/reports`·`PATCH /pathology/reports/:id` 는
 * `Record<string, unknown>` 이라 **ValidationPipe 를 통째로 건너뛰었다**. 병리 보고서는
 * 암 진단의 법정 정본이다. 실제 결과:
 *   · `specimenId`·`patientId` 가 uuid 가 아니면 Prisma P2023(500) — 400 이어야 한다.
 *   · TNM(pT/pN/pM)·병기군·절제연이 VarChar(10~20) 인데 길이·값 제한이 전혀 없었다.
 *
 * 🔴 **키 별칭을 하나도 빠뜨리지 않았다** — 서비스가 `microDescription ?? microscopicDescription`,
 *    `diagnosisCode ?? icdCode`, `ihcResults ?? ihc`, `molecularResults ?? molecularTest`,
 *    `clinicalInfo ?? clinicalHistory`, `reportedBy ?? pathologistId` 를 모두 읽는다.
 *    DTO 에서 빠뜨리면 whitelist 가 지워 **오늘 새 유실을 만든다**.
 */

const MARGIN_STATUS = ['CLEAR', 'INVOLVED', 'CLOSE', 'NA', ''];

export class CreatePathologySpecimenDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID('4', { message: 'patientId 는 UUID 여야 합니다' })
  patientId: string;

  @ApiProperty({ description: '검체 유형', enum: ['BIOPSY', 'EXCISION', 'CYTOLOGY', 'FNA', 'FROZEN'] })
  @IsIn(['BIOPSY', 'EXCISION', 'CYTOLOGY', 'FNA', 'FROZEN'])
  specimenType: string;

  @ApiPropertyOptional({ description: '채취 부위' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  collectionSite?: string;

  @ApiPropertyOptional({ description: '고정액' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  fixative?: string;

  @ApiPropertyOptional({ description: '우선순위', enum: ['ROUTINE', 'URGENT', 'FROZEN'] })
  @IsOptional()
  @IsIn(['ROUTINE', 'URGENT', 'FROZEN'])
  priority?: string;

  @ApiPropertyOptional({ description: '임상 정보' })
  @IsOptional()
  @IsString()
  clinicalInfo?: string;

  /** 서비스가 `clinicalInfo ?? clinicalHistory` 를 읽는다 — 별칭 유지 */
  @ApiPropertyOptional({ description: '임상 정보(별칭)' })
  @IsOptional()
  @IsString()
  clinicalHistory?: string;

  @ApiPropertyOptional({ description: '채취 일시(미지정 시 서버 현재시각)' })
  @IsOptional()
  @IsDateString()
  collectedAt?: string;

  /** 미지정 시 컨트롤러가 로그인 사용자로 채운다(의뢰 의사) */
  @ApiPropertyOptional({ description: '채취자(의뢰 의사) ID' })
  @IsOptional()
  @IsUUID()
  collectorId?: string;
}

/** 면역화학·분자검사 행 — `[{marker, result}]` 자유 구조라 키 제약 없이 객체만 보장한다 */
export class PathologyTestRowDto {
  @ApiPropertyOptional({ description: '마커' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  marker?: string;

  @ApiPropertyOptional({ description: '결과' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  result?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpsertPathologyReportDto {
  @ApiPropertyOptional({ description: '검체 ID(생성 시 필수)' })
  @IsOptional()
  @IsUUID('4', { message: 'specimenId 는 UUID 여야 합니다' })
  specimenId?: string;

  @ApiPropertyOptional({ description: '육안 소견' })
  @IsOptional()
  @IsString()
  grossDescription?: string;

  @ApiPropertyOptional({ description: '현미경 소견' })
  @IsOptional()
  @IsString()
  microDescription?: string;

  /** 별칭 — 서비스가 `microDescription ?? microscopicDescription` 을 읽는다 */
  @ApiPropertyOptional({ description: '현미경 소견(별칭)' })
  @IsOptional()
  @IsString()
  microscopicDescription?: string;

  @ApiPropertyOptional({ description: '최종 진단' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: '진단코드(KCD)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  diagnosisCode?: string;

  /** 별칭 — `diagnosisCode ?? icdCode` */
  @ApiPropertyOptional({ description: '진단코드(별칭)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  icdCode?: string;

  @ApiPropertyOptional({ description: '면역화학염색 결과', type: [PathologyTestRowDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PathologyTestRowDto)
  ihcResults?: PathologyTestRowDto[];

  @ApiPropertyOptional({ description: '면역화학염색 결과(별칭)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PathologyTestRowDto)
  ihc?: PathologyTestRowDto[];

  @ApiPropertyOptional({ description: '분자검사 결과', type: [PathologyTestRowDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PathologyTestRowDto)
  molecularResults?: PathologyTestRowDto[];

  @ApiPropertyOptional({ description: '분자검사 결과(별칭)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PathologyTestRowDto)
  molecularTest?: PathologyTestRowDto[];

  @ApiPropertyOptional({ description: 'pT 분류' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  tnmT?: string;

  @ApiPropertyOptional({ description: 'pN 분류' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  tnmN?: string;

  @ApiPropertyOptional({ description: 'pM 분류' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  tnmM?: string;

  @ApiPropertyOptional({ description: 'AJCC 병기군' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tnmStage?: string;

  @ApiPropertyOptional({ description: '종양 분화도' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tumorGrade?: string;

  @ApiPropertyOptional({ description: '절제연', enum: MARGIN_STATUS })
  @IsOptional()
  @IsIn(MARGIN_STATUS, { message: 'marginStatus 는 CLEAR|INVOLVED|CLOSE|NA 여야 합니다' })
  marginStatus?: string;

  @ApiPropertyOptional({ description: '추가 소견(수정 경로에서만 반영)' })
  @IsOptional()
  @IsString()
  addendum?: string;

  @ApiPropertyOptional({ description: '판독 병리의 ID' })
  @IsOptional()
  @IsUUID()
  reportedBy?: string;

  /** 별칭 — `reportedBy ?? pathologistId` */
  @ApiPropertyOptional({ description: '판독 병리의 ID(별칭)' })
  @IsOptional()
  @IsUUID()
  pathologistId?: string;
}

export class AddPathologyAddendumDto {
  @ApiProperty({ description: '추가 소견' })
  @IsString()
  @IsNotEmpty({ message: '추가 소견 본문은 필수입니다' })
  addendum: string;
}

export class UpdateProcessingStepDto {
  @ApiProperty({ description: '처리 단계', enum: ['FIXATION', 'EMBEDDING', 'SECTIONING', 'STAINING', 'MOUNTING'] })
  @IsIn(['FIXATION', 'EMBEDDING', 'SECTIONING', 'STAINING', 'MOUNTING'], {
    message: 'step 은 FIXATION|EMBEDDING|SECTIONING|STAINING|MOUNTING 이어야 합니다',
  })
  step: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

/** 서명 — 블록체인 서명 블록은 선택. 구조만 보장한다(값 검증은 서명 서비스 몫). */
export class SignPathologyReportDto {
  @ApiPropertyOptional({ description: '블록체인 서명 블록' })
  @IsOptional()
  @IsObject()
  blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  };
}
