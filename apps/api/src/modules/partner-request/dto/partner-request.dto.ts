import { IsString, IsOptional, IsIn, MaxLength, IsEmail, IsArray, IsInt, Min, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 파트너 신청 심사 DTO — 🔴 인라인 @Body / @Body 부재 봉합(2026-08-18)
 *
 * · `PATCH .../review` 는 인라인 `@Body() body: { status: string; reviewNote?: string }` 라
 *   status 가 자유문자열이었다 — 오타 status 가 VarChar(20) 에 그대로 저장되면
 *   목록 필터(PENDING/APPROVED/REJECTED)에서 그 신청서가 사라진다.
 * · 🔴 `POST .../approve` 는 **`@Body` 자체가 없었다.** 화면은 같은 심사메모 입력칸의
 *   `reviewNote` 를 승인에도 실어 보내는데(거절 경로는 저장된다) 승인에서는 통째로 버려졌다 —
 *   `partner_requests.review_note` 컬럼이 **있는데도** 승인 사유가 남지 않았다.
 */
export const PARTNER_REQUEST_STATUSES = ['PENDING', 'REVIEWING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

export class ReviewPartnerRequestDto {
  @ApiProperty({ description: '심사 결과 상태', enum: PARTNER_REQUEST_STATUSES })
  @IsIn(PARTNER_REQUEST_STATUSES, { message: `status 는 ${PARTNER_REQUEST_STATUSES.join('|')} 중 하나여야 합니다` })
  status: string;

  @ApiPropertyOptional({ description: '심사 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNote?: string;
}

export class ApprovePartnerRequestDto {
  @ApiPropertyOptional({ description: '승인 메모(심사 근거) — 승인 경로에서도 저장한다' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNote?: string;
}


/**
 * 파트너 연동 **공개 신청** DTO — 🔴 2026-09-02.
 *
 * 종전 `@Post('partner/apply') apply(@Body() dto: any)` 는 검증이 없어, 필수 항목이 빠진 요청이
 * 그대로 Prisma 까지 내려가 **500** 이 났다(운영 실호출로 확인). 공개 화면이 그 EP 를 실제로 부르기
 * 시작했으므로(같은 날 배선) 신청자가 받는 것은 "무엇이 빠졌는지"여야지 서버 오류가 아니다.
 * 길이 상한은 스키마(VarChar)와 맞춘다 — 넘치면 저장 시점에 터진다.
 */
export const PARTNER_ORG_TYPES = ['HOSPITAL', 'CLINIC', 'INSURANCE', 'APP_VENDOR', 'RESEARCH'];

export class ApplyPartnerRequestDto {
  @ApiProperty({ description: '기관명' })
  @IsString() @MaxLength(200)
  orgName: string;

  @ApiProperty({ description: '기관 유형', enum: PARTNER_ORG_TYPES })
  @IsIn(PARTNER_ORG_TYPES, { message: `orgType 은 ${PARTNER_ORG_TYPES.join('|')} 중 하나여야 합니다` })
  orgType: string;

  @ApiPropertyOptional({ description: '기관코드(HIRA·해외)' })
  @IsOptional() @IsString() @MaxLength(20)
  orgCode?: string;

  @ApiProperty({ description: '국가코드(3자)' })
  @IsString() @MaxLength(3)
  country: string;

  @ApiProperty({ description: '담당자 이름' })
  @IsString() @MaxLength(100)
  contactName: string;

  @ApiProperty({ description: '담당자 이메일' })
  @IsEmail({}, { message: '담당자 이메일 형식이 올바르지 않습니다' }) @MaxLength(200)
  contactEmail: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30)
  contactPhone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  techContactName?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(200)
  techContactEmail?: string;

  @ApiPropertyOptional({ description: 'FHIR Base URL' })
  @IsOptional() @IsUrl({ require_tld: false }, { message: 'FHIR Base URL 형식이 올바르지 않습니다' })
  fhirBaseUrl?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  purpose?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  requestedScopes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  ipWhitelist?: string[];

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1)
  rateLimit?: number;
}
