import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 녹화 메모·태그 수정.
 * 🔴 class 로 선언한다 — interface·교차 타입 DTO 는 런타임 metatype 이 `Object` 라 ValidationPipe 가 통째로 스킵된다.
 */
export class UpdateTelehealthRecordingDto {
  @ApiPropertyOptional({ description: '메모(진료 기록 연동)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  memo?: string;

  @ApiPropertyOptional({ description: '태그(쉼표 구분)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;
}
