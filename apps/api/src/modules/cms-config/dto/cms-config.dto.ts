import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, IsArray, MaxLength } from 'class-validator';

/**
 * 🔴 CMS 카테고리·메뉴 쓰기 DTO — `interface` → `class` 승격(2026-09-01 변이 EP 재실측).
 *
 * 종전엔 네 개가 전부 `interface` 라 metatype 이 `Object` → **ValidationPipe 가 통째로 스킵**됐다.
 * 이름이 `...Dto` 라 인라인 @Body 가드도 "검증됨"으로 세어 넘어갔다(가드 구멍). 빈 바디로 눌러
 * `PrismaClientValidationError`(필수 `code`/`name`/`menuGroup`/`label` 누락)가 500 으로 샜다 —
 * 사용자가 자기 입력 문제를 서버 오류로 읽는다. 이제 400 으로 말한다.
 *
 * 🔴 전역 ValidationPipe 는 `whitelist:true` 라 **장식하지 않은 필드는 조용히 지워진다** —
 *    서비스가 Prisma create/update 로 그대로 넘기므로 **모든 컬럼을 빠짐없이 장식**한다.
 */
export class CreateCategoryDto {
  @IsString() @IsNotEmpty({ message: '카테고리 코드를 입력하세요' }) @MaxLength(50)
  code!: string;

  @IsString() @IsNotEmpty({ message: '카테고리 이름을 입력하세요' }) @MaxLength(100)
  name!: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @IsString() @MaxLength(100)
  icon?: string;

  @IsOptional() @IsString() @MaxLength(30)
  color?: string;

  @IsOptional() @IsString()
  parentId?: string;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  showOnHome?: boolean;

  @IsOptional() @IsString() @MaxLength(30)
  renderMode?: string;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @IsString() @MaxLength(100)
  icon?: string;

  @IsOptional() @IsString() @MaxLength(30)
  color?: string;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsBoolean()
  showOnHome?: boolean;

  @IsOptional() @IsBoolean()
  showOnSubpage?: boolean;

  @IsOptional() @IsString() @MaxLength(30)
  renderMode?: string;
}

export class CreateMenuDto {
  @IsString() @IsNotEmpty({ message: '메뉴 그룹을 입력하세요' }) @MaxLength(50)
  menuGroup!: string;

  @IsString() @IsNotEmpty({ message: '메뉴 라벨을 입력하세요' }) @MaxLength(100)
  label!: string;

  @IsOptional() @IsString() @MaxLength(500)
  href?: string;

  @IsOptional() @IsString() @MaxLength(100)
  icon?: string;

  @IsOptional() @IsString()
  parentId?: string;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  isExternal?: boolean;

  @IsOptional() @IsString() @MaxLength(50)
  categoryCode?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  roles?: string[];
}

export class UpdateMenuDto {
  @IsOptional() @IsString() @MaxLength(100)
  label?: string;

  @IsOptional() @IsString() @MaxLength(500)
  href?: string;

  @IsOptional() @IsString() @MaxLength(100)
  icon?: string;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsBoolean()
  isExternal?: boolean;

  @IsOptional() @IsString() @MaxLength(50)
  categoryCode?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  roles?: string[];
}
