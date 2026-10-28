import { Allow, IsDateString, IsInt, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 U2) 임상연구·IRB 쓰기 10종 — 종전 `Record<string, unknown>` 8 + 인라인 타입 2 라 ValidationPipe 가 스킵됐다.
 *    `targetEnroll:'abc'`·`startDate:'abc'`·VarChar 초과(department 50·phase 10·docType 30·version 10…)가 Prisma 500 이었다.
 *
 * - 🔴 **필수 여부는 서비스가 이미 한국어 사유로 400 을 낸다**(제목·진료과·유형·환자·동의일·문서 4필드·변경 사유·심의 결과).
 *   DTO 가 필수로 올리면 그 사유 문장이 일반 검증 메시지로 바뀐다 — 그래서 여기서는 **형식·길이만** 본다.
 * - 빈 문자열은 서비스가 "미지정"으로 읽는다(`data.endDate ? … : null`) — 화면 폼이 선택 날짜를 ''로 보낼 수 있어 형식 검사는 값이 있을 때만.
 * - 어휘(studyType·phase·status·docType)는 정본 어휘가 없어 막지 않는다(길이만).
 * - `protocol`·`changes` 는 Json 컬럼 — 형태 근거가 없어 `@Allow` 로 보존만 한다(whitelist 에 지워지지 않게).
 */
const present = (_: object, v: unknown) => v !== '' && v !== null && v !== undefined;

class ResearchStudyFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) studyType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) phase?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) sponsor?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() targetEnroll?: number | null;
  @ApiPropertyOptional({ example: '2026-09-01' }) @ValidateIf(present) @IsDateString() startDate?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string | null;
  @ApiPropertyOptional({ description: '프로토콜(JSON)' }) @Allow() protocol?: unknown;
}

export class CreateResearchStudyDto extends ResearchStudyFieldsDto {
  /** 실존·활성 계정인지는 서비스(resolvePiUserId)가 사유와 함께 확인한다 · 비우면 등록자 */
  @ApiPropertyOptional({ description: '연구책임자 계정 id' }) @IsOptional() @IsString() piUserId?: string;
}

/**
 * 🔴 PUT 이 `irbExpiryDate` 를 받는다 — `approve` 의 "만료일은 승인일보다 뒤" 검사를 거치지 않는다(호출 화면 0 · 보고에 기록).
 */
export class UpdateResearchStudyDto extends ResearchStudyFieldsDto {
  @ApiPropertyOptional() @ValidateIf(present) @IsDateString() irbExpiryDate?: string;
}

export class ApproveResearchStudyDto {
  @ApiPropertyOptional({ nullable: true, description: '승인서의 만료일 YYYY-MM-DD — 없으면 비워 둔다' })
  @ValidateIf(present) @IsDateString() irbExpiryDate?: string | null;
}

export class AddResearchSubjectDto {
  @ApiPropertyOptional({ description: '환자 id(환자 검색에서 선택)' }) @IsOptional() @IsString() patientId?: string;
  @ApiPropertyOptional({ example: '2026-09-15' }) @ValidateIf(present) @IsDateString() consentDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) armGroup?: string | null;
}

/**
 * 🔴 `status` 를 본문으로 받는다 — `WITHDRAWN` 을 여기로 넣으면 사유 필수·등록 수 감소(withdraw 경로)를 우회한다(호출 화면 0 · 보고에 기록).
 */
export class UpdateResearchSubjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) armGroup?: string | null;
}

/** 화면은 `reason` · 구 키 `withdrawReason` 도 받는다(P11 유실 방지 — 컨트롤러 주석) */
export class WithdrawResearchSubjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional({ deprecated: true }) @IsOptional() @IsString() withdrawReason?: string;
}

export class AddResearchDocumentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) docType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) version?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fileUrl?: string;
}

export class AddIrbAmendmentDto {
  @ApiPropertyOptional({ description: '변경 사유(서비스가 필수 확인)' }) @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional({ description: '변경 내용(JSON)' }) @Allow() changes?: unknown;
}

export class SubmitIrbAmendmentDto extends AddIrbAmendmentDto {
  @ApiPropertyOptional({ description: '연구 id(컨트롤러가 필수 확인)' }) @IsOptional() @IsString() studyId?: string;
}

export class ReviewIrbAmendmentDto {
  @ApiPropertyOptional({ description: 'APPROVED|REJECTED — 서비스가 사유와 함께 확인' }) @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reviewNote?: string;
}
