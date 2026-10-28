import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn } from 'class-validator';
import { INSURANCE_DOC_SET_TYPES } from '../insurance-doc-sets';

/** F-4 실손보험 청구 서류 세트 신청 — 전 필드 class-validator 필수(전역 whitelist strip) */
export class RequestBundleDto {
  @ApiProperty({ description: '세트 유형', enum: INSURANCE_DOC_SET_TYPES })
  @IsIn(INSURANCE_DOC_SET_TYPES as unknown as string[])
  setType: string;

  @ApiProperty({ description: '대상 기간 시작일 (YYYY-MM-DD)' })
  @IsDateString()
  periodFrom: string;

  @ApiProperty({ description: '대상 기간 종료일 (YYYY-MM-DD)' })
  @IsDateString()
  periodTo: string;
}
