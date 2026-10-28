import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, MaxLength } from 'class-validator';

/**
 * 🔴 코드 마스터(진단·시술·약품) 쓰기 DTO — `interface` → `class` 승격(2026-09-01 변이 EP 재실측).
 *
 * 종전엔 `...Input` interface 라 metatype 이 `Object` → ValidationPipe 스킵. 이름이 `Dto` 도
 * 아니라 인라인 @Body 가드조차 스캔 대상이 아니었다(이중 사각). 빈 바디로 `codes/diagnosis`·
 * `codes/procedure` 를 눌러 500(필수 `code`/`nameKo` 누락)이 샜다 — 사용자 입력 문제를 서버
 * 오류로 읽는다. 이제 400.
 *
 * 🔴 서비스는 명명 필드만 골라 Prisma 에 넘긴다(옛 `[key:string]:unknown` 인덱스 시그니처는
 *    실제로 쓰이지 않았다) → whitelist 스트립이 동작을 바꾸지 않는다. 나머지 컬럼은 여기서 장식한다.
 */
export class CreateDiagnosisInput {
  @IsOptional() @IsString() @MaxLength(20)
  codeSystem?: string;

  @IsString() @IsNotEmpty({ message: '진단 코드를 입력하세요' }) @MaxLength(20)
  code!: string;

  @IsString() @IsNotEmpty({ message: '한글명을 입력하세요' }) @MaxLength(300)
  nameKo!: string;

  @IsOptional() @IsString() @MaxLength(300)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @IsOptional() @IsString() @MaxLength(100)
  chapter?: string;

  @IsOptional() @IsString() @MaxLength(20)
  icd10Code?: string;

  @IsOptional() @IsString() @MaxLength(20)
  icd11Code?: string;
}

export class UpdateDiagnosisInput {
  @IsOptional() @IsString() @MaxLength(300)
  nameKo?: string;

  @IsOptional() @IsString() @MaxLength(300)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @IsOptional() @IsString() @MaxLength(100)
  chapter?: string;

  @IsOptional() @IsString() @MaxLength(20)
  icd10Code?: string;

  @IsOptional() @IsString() @MaxLength(20)
  icd11Code?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class CreateProcedureInput {
  @IsString() @IsNotEmpty({ message: '시술 코드를 입력하세요' }) @MaxLength(20)
  code!: string;

  @IsString() @IsNotEmpty({ message: '한글명을 입력하세요' }) @MaxLength(300)
  nameKo!: string;

  @IsOptional() @IsString() @MaxLength(300)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @IsOptional() @IsNumber()
  unitPrice?: number;

  @IsOptional() @IsNumber()
  copayRate?: number;

  @IsOptional() @IsBoolean()
  insuranceCovered?: boolean;

  @IsOptional() @IsString() @MaxLength(30)
  snomedCode?: string;
}

export class UpdateProcedureInput {
  @IsOptional() @IsString() @MaxLength(300)
  nameKo?: string;

  @IsOptional() @IsString() @MaxLength(300)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @IsOptional() @IsNumber()
  unitPrice?: number;

  @IsOptional() @IsNumber()
  copayRate?: number;

  @IsOptional() @IsBoolean()
  insuranceCovered?: boolean;

  // modality 는 null 로 명시적 해제 가능(@IsOptional 이 null·undefined 를 통과시킨다)
  @IsOptional() @IsString() @MaxLength(10)
  modality?: string | null;

  @IsOptional() @IsBoolean()
  usesContrast?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class CreateMedicationInput {
  @IsString() @IsNotEmpty({ message: '약품 코드를 입력하세요' }) @MaxLength(20)
  code!: string;

  @IsString() @IsNotEmpty({ message: '한글명을 입력하세요' }) @MaxLength(300)
  nameKo!: string;

  @IsOptional() @IsString() @MaxLength(300)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(300)
  ingredient?: string;

  @IsOptional() @IsString() @MaxLength(200)
  manufacturer?: string;

  @IsOptional() @IsString() @MaxLength(50)
  dosageForm?: string;

  @IsOptional() @IsString() @MaxLength(30)
  unit?: string;

  @IsOptional() @IsNumber()
  unitPrice?: number;

  @IsOptional() @IsString() @MaxLength(30)
  snomedCode?: string;
}

export class UpdateMedicationInput {
  @IsOptional() @IsString() @MaxLength(300)
  nameKo?: string;

  @IsOptional() @IsString() @MaxLength(300)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(300)
  ingredient?: string;

  @IsOptional() @IsString() @MaxLength(200)
  manufacturer?: string;

  @IsOptional() @IsString() @MaxLength(50)
  dosageForm?: string;

  @IsOptional() @IsString() @MaxLength(30)
  unit?: string;

  @IsOptional() @IsNumber()
  unitPrice?: number;

  @IsOptional() @IsString() @MaxLength(20)
  insuranceCode?: string | null;

  @IsOptional() @IsString() @MaxLength(5)
  controlSchedule?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  narcoticType?: string | null;

  @IsOptional() @IsString() @MaxLength(5)
  psychotropicGroup?: string | null;

  @IsOptional() @IsNumber()
  maxSingleDose?: number | null;

  @IsOptional() @IsNumber()
  maxDailyDose?: number | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
