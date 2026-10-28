import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/**
 * 🔴 인라인 `@Body()` 가 아니라 클래스 DTO 다 — 인라인이면 런타임 metatype 이 `Object` 라
 * ValidationPipe 가 통째로 스킵된다(이 저장소 실측: 쓰기 핸들러의 28%가 그 상태였다).
 */
export class RecordDecisionDto {
  @ApiProperty({ description: '선택지 value(등록부에 있는 값만)' })
  @IsString() @MinLength(1) @MaxLength(60)
  choice!: string;

  @ApiProperty({ description: '🔴 법적 검토 근거 — 문서번호·회신·위원회 의결번호 등. 없으면 거부' })
  @IsString() @MinLength(4) @MaxLength(400)
  legalReviewRef!: string;

  @ApiProperty({ description: '허가권 근거(직책·위임) — 시스템이 검증하지 못하므로 기록만 한다' })
  @IsString() @MinLength(2) @MaxLength(200)
  authorityClaim!: string;

  @ApiPropertyOptional({ description: '부가 메모' })
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

/** 재검토 확인 — 선행 결정이 바뀐 뒤 "이 결정은 그대로 유효"를 남긴다(근거 필수) */
export class ReviewConfirmDto {
  @ApiProperty({ description: '재검토 근거 — 무엇을 보고 그대로 둔다고 판단했는가' })
  @IsString() @MinLength(2) @MaxLength(1000)
  note!: string;
}

/** 결정 이력 조회 — 최신부터 · 커서 `<ISO>|<id>` */
export class DecisionLogQueryDto {
  @ApiPropertyOptional({ description: '1~500(기본 100)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;

  @ApiPropertyOptional({ description: '다음 쪽 커서 — 이전 응답의 nextCursor' })
  @IsOptional() @IsString() @MaxLength(120)
  cursor?: string;

  @ApiPropertyOptional({ description: '이력 종류(shared DECISION_LOG_KINDS)' })
  @IsOptional() @IsString() @MaxLength(30)
  kind?: string;

  @ApiPropertyOptional({ description: '결정 키' })
  @IsOptional() @IsString() @MaxLength(120)
  key?: string;
}

/** 영향 미리보기 — 고르기 전에 */
export class DecisionImpactQueryDto {
  @ApiProperty({ description: '선택지 value' })
  @IsString() @MinLength(1) @MaxLength(60)
  choice!: string;
}

class BulkItemDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) key!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) choice!: string;
}
class BulkMeetingDto {
  @ApiProperty({ description: '회의 일시(ISO) — 사람이 넣는다(지어내지 않는다)' }) @IsString() @MinLength(10) @MaxLength(40) heldAt!: string;
  @ApiProperty({ description: '참석자 계정 id — 명부로 채우지 않는다(사람이 고른다)' }) @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) attendeeUserIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
}
/** 위원회 중요결정 일괄 의사결정 — 경로는 하나씩과 같다(회의·안건·의결 / 권한자 기록) */
export class BulkDecisionDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(10) committeeCode!: string;
  @ApiProperty({ type: [BulkItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => BulkItemDto) items!: BulkItemDto[];
  @ApiProperty({ description: '의사결정 근거(회의록·문서 번호)' }) @IsString() @MinLength(4) @MaxLength(400) basisRef!: string;
  @ApiProperty({ description: '권한 근거 — 권한자 경로 항목에 쓴다' }) @IsString() @MaxLength(200) authorityClaim!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: BulkMeetingDto }) @IsOptional() @ValidateNested() @Type(() => BulkMeetingDto) meeting?: BulkMeetingDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enactNow?: boolean;
}


/** 위원회 안건 일괄 상정 — 회의는 셋 중 하나: 없음(접수만) / 예정 회의 id / 새 회의 예정 일시 */
export class BulkSubmitDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(10) committeeCode!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(120, { each: true }) keys!: string[];
  @ApiPropertyOptional({ description: '이 위원회의 예정 회의' }) @IsOptional() @IsUUID() meetingId?: string;
  @ApiPropertyOptional({ description: '새 회의 예정 일시(ISO) — meetingId 와 함께 쓰지 않는다' }) @IsOptional() @IsString() @MinLength(10) @MaxLength(40) scheduledAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) meetingTitle?: string;
}

/** 개발 반영 기록(기획 P2-1) — 반영 확인은 릴리즈 버전 필수 · 근거 필수 */
export class DevEnactmentDto {
  @ApiProperty({ enum: ['DEV_ENACTED', 'DEV_NOT_REQUIRED'] })
  @IsIn(['DEV_ENACTED', 'DEV_NOT_REQUIRED'])
  kind!: 'DEV_ENACTED' | 'DEV_NOT_REQUIRED';

  @ApiPropertyOptional({ description: '반영 확인일 때 릴리즈 버전 vX.Y.Z' })
  @IsOptional() @IsString() @MaxLength(20)
  version?: string;

  @ApiProperty({ description: '근거 — 커밋·릴리즈 문서·판정표 등' })
  @IsString() @MinLength(2) @MaxLength(1000)
  note!: string;
}

/** 위원회 결정권한자 표 원내 채택 기록(기획 P3 G7) — 근거(규정·의결 번호) 필수 */
export class CommitteeAuthorityRecordDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) chair!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) secretary!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) verifier!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) votingRule!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(200, { each: true }) exOfficio!: string[];
  @ApiProperty({ description: '채택 근거 — 위원회 규정 문서 번호·의결 번호' }) @IsString() @MinLength(2) @MaxLength(300) basisRef!: string;
}
