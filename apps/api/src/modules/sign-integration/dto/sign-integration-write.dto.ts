import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * 외부 서명(sign) 요청 본문 — 🔴 (2026-09-15 N4-B8) 종전 인라인 타입은 ValidationPipe 가 통째로 건너뛰었다.
 *  - `inPerson` 에 문자열 `"false"` 가 오면 참으로 읽혀 **요구 본인확인 수준이 INPERSON 으로 내려갔다**
 *    (수술·마취·DNR 등 고위험 동의는 APP_STEPUP 이어야 한다 — `sign.highRiskConsentTypes`).
 *  - `channel` 은 아무 문자열이었다(DIRECT 가 아니면 환자 채널로 흘렀다).
 * 서명자(`signerUserId`)는 본문에서 받지 않는다 — 컨트롤러가 로그인 사용자로 정한다(종전과 같음).
 * 필드 이름은 종전 인라인 타입·화면(consent/page.tsx)이 보내는 키와 같다.
 */
export const SIGN_CHANNELS = ['DIRECT', 'PORTAL'] as const;

export class EnrollStaffBulkDto {
  @ApiPropertyOptional({ enum: UserRole, isArray: true, description: '대상 역할(기본 DOCTOR)' })
  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];
}

class SignRequestCommonDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() consentFormId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() documentType?: string;

  @ApiPropertyOptional({ enum: SIGN_CHANNELS })
  @IsOptional()
  @IsIn(SIGN_CHANNELS)
  channel?: 'DIRECT' | 'PORTAL';

  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() consentType?: string;

  @ApiPropertyOptional({ description: '대면 서명 여부(불리언만 — 문자열 "false" 는 거부)' })
  @IsOptional()
  @IsBoolean()
  inPerson?: boolean;
}

export class SubmitSignRequestDto extends SignRequestCommonDto {
  @ApiProperty() @IsString() @IsNotEmpty() issueNo!: string;
}

export class RequestDocumentSignDto extends SignRequestCommonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() issueNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceId?: string;

  @ApiPropertyOptional({ description: '문서 스냅샷(서비스가 렌더에 사용)' })
  @IsOptional()
  @IsObject()
  snapshot?: Record<string, unknown>;
}
