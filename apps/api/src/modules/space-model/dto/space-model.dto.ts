import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString, Length } from 'class-validator';

export class CreateSpaceImportDto {
  @ApiProperty({ description: '가져오기 제목(예: 본관 합성 도면 v1)' })
  @IsString()
  @Length(1, 200)
  title!: string;

  /** space-import.v1 JSON — 구조 검증은 서비스(validateSpaceImport)가 한다(수백 개 공간이라 DTO 중첩 검증 대신 결과를 기록) */
  @ApiProperty({ description: 'space-import.v1 JSON', type: Object })
  @IsObject()
  payload!: Record<string, unknown>;
}

export class RejectSpaceImportDto {
  @ApiProperty({ description: '반려 사유' })
  @IsString()
  @Length(2, 300)
  reason!: string;
}
