import { IsIn, IsNumber, IsOptional, IsString, IsDateString, IsUUID, Min, Max } from 'class-validator';

/** 만성질환 측정 코드(정규 코드) */
export const CHRONIC_CODES = ['HBA1C', 'FBS', 'PPG', 'SBP', 'DBP', 'WEIGHT', 'BMI'] as const;
/** 측정 출처: 외래/자가측정(SMBG)/검진/기기 */
export const CHRONIC_SOURCES = ['CLINIC', 'SMBG', 'CHECKUP', 'DEVICE'] as const;

export class CreateChronicObservationDto {
  @IsIn(CHRONIC_CODES as unknown as string[])
  code!: string;

  @IsNumber()
  @Min(0)
  @Max(1000)
  value!: number;

  /** 단위 미지정 시 코드 기본 단위 사용 */
  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsIn(CHRONIC_SOURCES as unknown as string[])
  source?: string;

  /** 측정 시각(미지정 시 현재) */
  @IsOptional()
  @IsDateString()
  measuredAt?: string;

  @IsOptional()
  @IsUUID()
  encounterId?: string;
}
