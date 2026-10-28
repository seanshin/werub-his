import {
  IsString, IsOptional, IsBoolean, IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 텍스트 매크로 생성 ──

export class CreateTextMacroDto {
  @ApiProperty({ description: '분류' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: '단축어' })
  @IsString()
  @IsNotEmpty()
  shortcut: string;

  @ApiProperty({ description: '확장 내용' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: '공유 여부' })
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}
