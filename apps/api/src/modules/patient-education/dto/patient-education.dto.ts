import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  EDUCATION_LEARNERS, EDUCATION_METHODS, EDUCATION_TEXT_MAX, EDUCATION_TOPICS, EDUCATION_UNDERSTANDING,
  type EducationLearner, type EducationMethod, type EducationTopic, type EducationUnderstanding,
} from '@hospital-run/shared';

/**
 * 환자 교육 기록 DTO — 어휘는 shared `patient-education.ts` 정본.
 * 🔴 전역 `whitelist:true` — 서비스가 읽는 필드는 전부 장식한다(장식 안 한 키는 조용히 지워진다).
 * 🔴 교육 시각은 필수 — 서버가 '지금'으로 채우지 않는다(화면이 보이는 값으로 채워 보낸다).
 */
export class CreateEducationRecordDto {
  @IsIn(EDUCATION_TOPICS as unknown as string[])
  topic!: EducationTopic;

  @IsString() @MaxLength(EDUCATION_TEXT_MAX.content)
  content!: string;

  @IsIn(EDUCATION_LEARNERS as unknown as string[])
  learner!: EducationLearner;

  @IsOptional() @IsString() @MaxLength(EDUCATION_TEXT_MAX.short)
  learnerNote?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(EDUCATION_METHODS.length) @IsIn(EDUCATION_METHODS as unknown as string[], { each: true })
  methods?: EducationMethod[];

  /** 평가한 경우에만 — 보내지 않으면 미기록(이해함으로 두지 않는다) */
  @IsOptional() @IsIn(EDUCATION_UNDERSTANDING as unknown as string[])
  understanding?: EducationUnderstanding;

  @IsOptional() @IsString() @MaxLength(EDUCATION_TEXT_MAX.short)
  barriers?: string;

  @IsOptional() @IsBoolean()
  followUpNeeded?: boolean;

  @IsISO8601({ strict: true })
  educatedAt!: string;

  @IsOptional() @IsUUID()
  encounterId?: string;
}

export class VoidEducationRecordDto {
  @IsString() @MaxLength(EDUCATION_TEXT_MAX.reason)
  reason!: string;
}
