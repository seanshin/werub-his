import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  ARRIVAL_CONSCIOUSNESS, ARRIVAL_INFO_SOURCES, ARRIVAL_MODES, ARRIVAL_TEXT_MAX, BELONGING_CUSTODY, COMPANION_TYPES, INJURY_TYPES,
  type ArrivalConsciousness, type ArrivalInfoSource, type ArrivalMode, type BelongingCustody, type CompanionType, type InjuryType,
} from '@hospital-run/shared';

/**
 * 응급 도착 상황 기록 DTO — 어휘는 shared `er-arrival.ts` 정본.
 * 🔴 전역 `whitelist:true` — 서비스가 읽는 필드는 전부 장식한다(종전 `arrivalNote` 는 장식돼 있었는데 서비스가 버렸다).
 * 🔴 시각은 ISO(시간대 포함) — 모르면 보내지 않는다(서버가 '지금'으로 채우지 않는다).
 */
export class ArrivalBelongingDto {
  @IsString() @MaxLength(ARRIVAL_TEXT_MAX.short)
  item!: string;

  @IsIn(BELONGING_CUSTODY as unknown as string[])
  custody!: BelongingCustody;
}

export class ArrivalNoteDto {
  @IsOptional() @IsISO8601({ strict: true })
  arrivalAt?: string;

  @IsOptional() @IsIn(ARRIVAL_MODES as unknown as string[])
  arrivalMode?: ArrivalMode;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.short)
  emsUnit?: string;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.place)
  foundLocation?: string;

  @IsOptional() @IsISO8601({ strict: true })
  foundAt?: string;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.long)
  circumstance?: string;

  @IsOptional() @IsIn(ARRIVAL_CONSCIOUSNESS as unknown as string[])
  consciousness?: ArrivalConsciousness;

  @IsOptional() @IsArray() @ArrayMaxSize(INJURY_TYPES.length) @IsIn(INJURY_TYPES as unknown as string[], { each: true })
  injuryTypes?: InjuryType[];

  @IsOptional() @IsIn(COMPANION_TYPES as unknown as string[])
  companionType?: CompanionType;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.short)
  companionName?: string;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.short)
  companionContact?: string;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.short)
  companionRelation?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ArrivalBelongingDto)
  belongings?: ArrivalBelongingDto[];

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.long)
  identifyingFeatures?: string;

  @IsOptional() @IsBoolean()
  policeInvolved?: boolean;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.short)
  policeAgency?: string;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.short)
  policeOfficer?: string;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.short)
  policeCaseNo?: string;

  @IsOptional() @IsIn(ARRIVAL_INFO_SOURCES as unknown as string[])
  infoSource?: ArrivalInfoSource;

  @IsOptional() @IsString() @MaxLength(ARRIVAL_TEXT_MAX.long)
  note?: string;
}
