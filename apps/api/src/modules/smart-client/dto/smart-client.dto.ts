import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsUUID, MaxLength, ArrayMaxSize, Matches, ValidateIf } from 'class-validator';

/**
 * launch/redirect URL 은 브라우저가 그대로 이동하는 값이다 → **https 스킴만** 허용한다.
 * (javascript:·data: 를 넣으면 런처 클릭이 그대로 스크립트 실행이 된다)
 */
const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/;

export class CreateSmartClientDto {
  @ApiProperty({ description: '클라이언트 표시명' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: '허용 스코프' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: '연결 기관 UUID' })
  @IsOptional()
  @IsUUID()
  orgId?: string;

  @ApiPropertyOptional({ description: '허용 redirect_uri (https)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(HTTPS_URL, { each: true, message: 'redirect_uri 는 https URL 이어야 합니다' })
  @MaxLength(500, { each: true })
  redirectUris?: string[];

  @ApiPropertyOptional({ description: 'EHR launch 진입점(앱의 SMART launch 엔드포인트·https) — 등록 시 차트 런처에 노출' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @Matches(HTTPS_URL, { message: 'launchUrl 은 https URL 이어야 합니다' })
  @MaxLength(500)
  launchUrl?: string | null;
}

/** 부분 수정 — 보낸 필드만 갱신(시크릿은 여기서 다루지 않는다) */
export class UpdateSmartClientDto extends CreateSmartClientDto {
  @ApiPropertyOptional({ description: '클라이언트 표시명' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare name: string;
}
