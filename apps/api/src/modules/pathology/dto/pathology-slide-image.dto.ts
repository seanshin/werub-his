import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * 병리 슬라이드·보고서 이미지 본문 — 🔴 (2026-09-15 N4-B8) 종전 인라인 타입은 ValidationPipe 가 통째로 건너뛰었다.
 * 슬라이드 추가는 서비스가 `{ ...slide }` 로 **본문 전체를 검체 clinicalInfo JSON 에 펼쳐 저장**했다 — 아무 키나 임상 정보에 박혔다.
 */
export class AddPathologySlideDto {
  @ApiProperty() @IsString() @IsNotEmpty() blockNo!: string;
  @ApiProperty() @IsString() @IsNotEmpty() slideNo!: string;
  @ApiProperty() @IsString() @IsNotEmpty() stainType!: string;
}

export class AddPathologyReportImageDto {
  @ApiProperty() @IsString() @IsNotEmpty() filename!: string;
  @ApiProperty() @IsString() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() magnification?: string;
}
