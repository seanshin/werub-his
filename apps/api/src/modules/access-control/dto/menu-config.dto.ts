import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsObject, IsOptional, IsString, ValidateNested, ValidateBy, ValidationOptions } from 'class-validator';

/**
 * 🔴 (2026-09-15 T2) 사이드바 메뉴 구성·권한 오버라이드 — 종전 인라인 @Body 라 ValidationPipe 가 스킵돼
 * `roles: "ADMIN"`(문자열)·`order: "3"` 같은 모양이 그대로 system_configs 에 저장됐다(사이드바는 전 직원에게 렌더).
 * 값 모양만 검증한다 — 어떤 href·역할을 허용할지는 기존 서비스·사이드바 소관(여기서 어휘를 지어내지 않는다).
 */
function IsMenuOverrideMap(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isMenuOverrideMap',
      validator: {
        validate: (value: unknown) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          return Object.values(value as Record<string, unknown>).every((e) => {
            if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
            const o = e as Record<string, unknown>;
            if (o.hidden !== undefined && typeof o.hidden !== 'boolean') return false;
            if (o.roles !== undefined && !(Array.isArray(o.roles) && o.roles.every((r) => typeof r === 'string'))) return false;
            if (o.order !== undefined && !(typeof o.order === 'number' && Number.isFinite(o.order))) return false;
            if (o.label !== undefined && typeof o.label !== 'string') return false;
            return true;
          });
        },
        defaultMessage: () => 'overrides 는 { [href]: { hidden?: boolean; roles?: string[]; order?: number; label?: string } } 모양이어야 합니다',
      },
    },
    options,
  );
}

export class MenuOverridesDto {
  @ApiProperty({ description: 'href → { hidden?, roles?, order?, label? }' })
  @IsObject()
  @IsMenuOverrideMap()
  overrides!: Record<string, { hidden?: boolean; roles?: string[]; order?: number; label?: string }>;
}

/** 빈 항목 제거·href 위험 스킴 차단·중복 제거·id 보정은 서비스 정본(sanitizeMenuHref)이 계속 한다 */
export class MenuCustomItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() id?: string;
  @ApiProperty() @IsString() section!: string;
  @ApiProperty() @IsString() href!: string;
  @ApiProperty() @IsString() label!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) roles?: string[];
}

export class MenuCustomDto {
  @ApiProperty({ type: [MenuCustomItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => MenuCustomItemDto)
  items!: MenuCustomItemDto[];
}
