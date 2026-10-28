import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 B9) 임상경로 쓰기 6 EP — 종전 `Record<string, unknown>` 은 ValidationPipe 를 건넜다.
 *  · 마일스톤 `isRequired: "false"` 는 Boolean 컬럼에 문자열 → 500 · `day`/`totalDays` 문자열도 Int 컬럼 500
 *  · 🔴 결과 기록의 **시행자(`performedBy`)를 본문이 정했다** — 누가 했는지를 요청자가 다른 사람으로 적을 수 있었고,
 *    화면은 보내지 않아 실제 기록은 전부 null(누가 했는지 모름)이었다. 이제 로그인 사용자다(컨트롤러).
 * 상태(`status`)·발행자·버전은 발행/폐기/복제 EP 가 정본이라 생성·수정 본문으로 받지 않는다.
 */
export class CreatePathwayDto {
  @IsString() @IsNotEmpty() @MaxLength(30) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) department!: string;
  @IsOptional() @IsString() @MaxLength(20) targetDrg?: string;
  @IsInt() @Min(1) totalDays!: number;
  @IsOptional() @IsString() description?: string;
}

export class UpdatePathwayDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50) department?: string;
  @IsOptional() @IsString() @MaxLength(20) targetDrg?: string | null;
  @IsOptional() @IsInt() @Min(1) totalDays?: number;
  @IsOptional() @IsString() description?: string | null;
}

export class CreateMilestoneDto {
  @IsInt() @Min(0) day!: number;
  @IsString() @IsNotEmpty() @MaxLength(30) category!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsOptional() @IsObject() detail?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateMilestoneDto {
  @IsOptional() @IsInt() @Min(0) day?: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30) category?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsObject() detail?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

/** 배정 — 시작일은 경과일·진행률의 기준이라 필수(서비스가 추정하지 않는다) · 배정자는 로그인 사용자 */
export class AssignPathwayDto {
  @IsUUID() patientId!: string;
  @IsUUID() encounterId!: string;
  @IsDateString() startDate!: string;
  @IsOptional() @IsString() note?: string;
}

/**
 * 마일스톤 결과 — 상태 어휘(DONE/SKIPPED/DELAYED/DEVIATED) 검사는 서비스 정본이 한다(`status` 정식 · `outcome` 화면 별칭).
 * 🔴 `performedBy` 는 선언하지 않는다 — whitelist 가 지우고 컨트롤러가 로그인 사용자를 넘긴다.
 */
export class RecordMilestoneOutcomeDto {
  @IsUUID() milestoneId!: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(20) outcome?: string;
  @IsOptional() @IsInt() @Min(1) actualDay?: number;
  @IsOptional() @IsString() variance?: string;
  @IsOptional() @IsString() note?: string;
}
