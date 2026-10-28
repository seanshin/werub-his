import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, MaxLength } from 'class-validator';

/** 🔴 인라인 `@Body` 를 쓰지 않는다 — 검증이 통째로 스킵된다 */
export class AtcMappingImportDto {
  @ApiProperty({ description: "CSV/TSV — 헤더에 'code','atc'(선택 'atcName') 필수", maxLength: 8_000_000 })
  @IsString()
  @MaxLength(8_000_000)
  content!: string;

  @ApiProperty({ description: '파일의 고시 기준월(YYYY-MM) — "현재 유효"를 뜻하지 않는다', example: '2021-11' })
  @IsString()
  @Length(7, 7)
  @Matches(/^\d{4}-\d{2}$/, { message: '기준 버전은 YYYY-MM 형식이어야 합니다' })
  version!: string;
}
