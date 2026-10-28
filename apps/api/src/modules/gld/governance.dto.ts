import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitAgendaDto {
  @IsUUID()
  committeeId!: string;

  @IsString() @MaxLength(300)
  title!: string;

  @IsOptional() @IsString()
  body?: string;

  @IsOptional() @IsObject()
  sourceRef?: Record<string, unknown>;

  /** 의결 선택지 `[{ value, label, effect, enact }]` — 없으면 자유서술 안건 */
  @IsOptional() @IsArray()
  options?: Record<string, unknown>[];
}

export class UpdateAgendaDto {
  @IsOptional() @IsUUID()
  meetingId?: string;

  @IsOptional() @IsInt() @Min(1)
  seq?: number;

  @IsOptional() @IsString() @MaxLength(20)
  status?: string;

  @IsOptional() @IsString() @MaxLength(300)
  title?: string;

  @IsOptional() @IsString()
  body?: string;

  /** 선택지 편집 — 🔴 의결된 안건은 서비스가 거부한다(과거 의결의 근거가 바뀌면 안 된다) */
  @IsOptional() @IsArray()
  options?: Record<string, unknown>[];
}

export class DecisionActionDto {
  @IsString() @MaxLength(30)
  kind!: string;

  @IsObject()
  target!: Record<string, unknown>;

  @IsOptional() @IsString()
  manualNote?: string;
}

/**
 * 🔴 고른 선택 — `value` 하나가 아니라 **그때 본 선택지 전문(snapshot)** 을 함께 받는다.
 *    안건 선택지는 나중에 바뀔 수 있고, 그때 무엇을 보고 골랐는지가 근거다.
 */
export class ChosenOptionDto {
  @IsString() @MaxLength(80)
  value!: string;

  @IsArray()
  snapshot!: Record<string, unknown>[];

  /** 원안 수정·선택지 밖 의결일 때 필수(서비스가 강제한다) */
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class ResolveAgendaDto {
  @IsString()
  resolution!: string;

  @IsOptional() @ValidateNested() @Type(() => ChosenOptionDto)
  chosenOption?: ChosenOptionDto;

  /** 근거 `{ legal?, accreditation?, evidence? }` — 정본 밖 키는 서비스가 버린다 */
  @IsOptional() @IsObject()
  basis?: Record<string, unknown>;

  @IsOptional() @IsInt() @Min(0) voteFor?: number;
  @IsOptional() @IsInt() @Min(0) voteAgainst?: number;
  @IsOptional() @IsInt() @Min(0) voteAbstain?: number;

  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsString() effectiveUntil?: string;
  @IsOptional() @IsString() reviewDue?: string;

  @IsOptional() @IsUUID() supersedesId?: string;
  @IsOptional() @IsUUID() policyId?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DecisionActionDto)
  actions?: DecisionActionDto[];
}

export class ConfirmManualActionDto {
  @IsOptional() @IsString()
  manualNote?: string;
}

export class PrecheckAgendaDto {
  @IsOptional() @IsUUID()
  committeeId?: string;

  @IsString() @MaxLength(300)
  title!: string;

  @IsOptional() @IsString()
  body?: string;
}

/**
 * 표준 발효 요건 (P1-c).
 *
 * 🔴 인라인 `@Body()` 로 받으면 런타임 metatype 이 `Object` 라 **ValidationPipe 가 통째로 스킵**된다
 *    (이 저장소가 이미 겪은 함정 — 구조 가드가 새 컨트롤러를 잡는다). 클래스로 받는다.
 */
export class StandardRuleDto {
  @IsIn(['PATHWAY', 'PROTOCOL', 'PROCESS'])
  standardKind!: string;

  /** 생략 = 그 유형 전체 기본 규칙 */
  @IsOptional() @IsString() @MaxLength(60)
  standardCode?: string;

  @IsOptional() @IsBoolean()
  requireAll?: boolean;

  /** `{ ENACT|AMEND|RETIRE: 'COMMITTEE'|'DELEGATED'|'NONE' }` — 값 검증은 서비스가 한다 */
  @IsOptional() @IsObject()
  actions?: Record<string, string>;

  @IsOptional() @IsArray() @IsString({ each: true })
  requireBasis?: string[];

  /** 🔴 null = 주기 없음(지어내지 않는다) */
  @IsOptional() @IsInt() @Min(1) @Max(120)
  reviewCycleM?: number | null;

  @IsOptional() @IsIn(['OFF', 'WARN', 'BLOCK'])
  gateMode?: string;

  /** 위임(경미개정 전결)의 근거 의결번호 — `DELEGATED` 가 있으면 서비스가 필수로 강제한다 */
  @IsOptional() @IsString() @MaxLength(30)
  delegationRef?: string | null;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

/** 결정 경로 시작 — 🔴 출처는 안건·등록부 중 **정확히 하나**(서비스가 강제) */
export class StartPathwayDto {
  @IsIn(['LICENSE', 'COMMITTEE', 'CODE_CHANGE'])
  code!: string;

  @IsOptional() @IsUUID()
  agendaId?: string;

  @IsOptional() @IsString() @MaxLength(80)
  registryKey?: string;
}

export class CompleteStepDto {
  @IsString() @MaxLength(40)
  stepKey!: string;

  @IsOptional() @IsBoolean()
  gatePassed?: boolean;

  /** 게이트 통과 근거 — 무엇을 보고 통과시켰는가 */
  @IsOptional() @IsString() @MaxLength(1000)
  gateEvidence?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class BlockStepDto {
  @IsString() @MaxLength(40)
  stepKey!: string;

  /** 🔴 사유 없는 "막힘"은 아무 정보도 아니다 */
  @IsString() @MaxLength(1000)
  reason!: string;
}
