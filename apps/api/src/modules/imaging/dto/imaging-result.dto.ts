import { IsString, IsOptional, IsUUID, IsBoolean, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AcquireImagingDto {
  @ApiPropertyOptional({ description: '영상 모달리티' })
  @IsOptional()
  @IsString()
  modality?: string;

  @ApiPropertyOptional({ description: '촬영 부위' })
  @IsOptional()
  @IsString()
  bodyPart?: string;

  @ApiPropertyOptional({ description: '기술자 노트' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: '안전게이트(조영제·임신) 차단 무시하고 강제 시행 — 사유 필수 권고', default: false })
  @IsOptional()
  @IsBoolean()
  overrideSafety?: boolean;

  @ApiPropertyOptional({ description: '안전게이트 override 사유(감사 기록)' })
  @IsOptional()
  @IsString()
  overrideReason?: string;

  @ApiPropertyOptional({ description: 'CT DLP (mGy·cm) — 장비 콘솔 판독값' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dlp?: number;

  @ApiPropertyOptional({ description: 'CTDIvol (mGy)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ctdiVol?: number;

  @ApiPropertyOptional({ description: 'DAP (Gy·cm²) — 투시/일반촬영' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  doseAreaProduct?: number;

  @ApiPropertyOptional({ description: '유효선량 (mSv) — 미입력 시 DLP×k 부위별 추정' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  effectiveDoseMsv?: number;
}

export class RecordRadiationDoseDto {
  @ApiPropertyOptional({ description: 'CT DLP (mGy·cm)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dlp?: number;

  @ApiPropertyOptional({ description: 'CTDIvol (mGy)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ctdiVol?: number;

  @ApiPropertyOptional({ description: 'DAP (Gy·cm²)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  doseAreaProduct?: number;

  @ApiPropertyOptional({ description: '유효선량 (mSv)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  effectiveDoseMsv?: number;
}

export class ReportImagingDto {
  @ApiProperty({ description: '판독 소견' })
  @IsString()
  finding: string;

  @ApiProperty({ description: '판독 결론' })
  @IsString()
  impression: string;

  @ApiPropertyOptional({ description: '판독 의사 ID (선택)' })
  @IsOptional()
  @IsUUID()
  radiologistId?: string;
}

export class GetImagingDetailDto {
  @ApiPropertyOptional({ description: '상세 정보 포함 여부' })
  @IsOptional()
  @IsString()
  include?: string;
}

export class CancelAcquisitionDto {
  @ApiPropertyOptional({ description: '취소 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}
