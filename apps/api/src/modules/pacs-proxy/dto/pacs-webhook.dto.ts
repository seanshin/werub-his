import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * PACS 웹훅 수신 DTO — 2026-07 입력 검증 전수검토.
 *
 * ⚠️ accession_number 는 `order.notes` 의 **부분 일치(contains)** 검색에 그대로 쓰인다.
 * 검증이 없으면 빈 문자열·한두 글자 값이 **무관한 오더에 매치**되어, 판독 소견이 엉뚱한 환자
 * 기록에 REPORTED 로 기재되거나 오더가 임의 전이된다. 최소 길이·형식을 강제한다.
 */
const ACCESSION_MIN = 4;

export class PacsStudyReceivedDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @Length(ACCESSION_MIN, 64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'accession_number 형식이 올바르지 않습니다' })
  accession_number: string;

  @ApiPropertyOptional({ description: 'Study Instance UID' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  study_uid?: string;

  @ApiPropertyOptional({ description: 'Modality' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  modality?: string;
}

export class PacsReportCompletedDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @Length(ACCESSION_MIN, 64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'accession_number 형식이 올바르지 않습니다' })
  accession_number: string;

  @ApiPropertyOptional({ description: '판독 소견' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  finding?: string;

  @ApiPropertyOptional({ description: '판독 결론' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  impression?: string;

  @ApiPropertyOptional({ description: '판독의' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  radiologist_name?: string;
}

export class PacsStudyUpdatedDto {
  @ApiProperty({ description: 'Accession Number' })
  @IsString()
  @Length(ACCESSION_MIN, 64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'accession_number 형식이 올바르지 않습니다' })
  accession_number: string;

  @ApiPropertyOptional({ description: '영상 상태', enum: ['ACQUIRED', 'REPORTED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  @IsIn(['ACQUIRED', 'REPORTED', 'CANCELLED', 'acquired', 'reported', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ description: '메시지' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  message?: string;
}
