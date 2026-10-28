import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * SMART-on-FHIR 토큰 발급 요청 DTO — 2026-07 입력 검증 전수검토.
 * 자격증명 자리에 객체가 들어오면 조회·비교 로직이 예기치 않게 동작하므로 문자열을 강제한다.
 */
export class OAuth2TokenDto {
  @ApiPropertyOptional({ description: 'grant_type' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  grant_type?: string;

  @ApiPropertyOptional({ description: 'client_id' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  client_id?: string;

  @ApiPropertyOptional({ description: 'client_secret' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  client_secret?: string;

  @ApiPropertyOptional({ description: 'scope' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  scope?: string;

  @ApiPropertyOptional({ description: 'authorization code' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  code?: string;

  @ApiPropertyOptional({ description: 'redirect_uri' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  redirect_uri?: string;

  @ApiPropertyOptional({ description: 'PKCE code_verifier' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  code_verifier?: string;
}
