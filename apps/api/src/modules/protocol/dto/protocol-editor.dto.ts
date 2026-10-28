import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

// 단계 배열 요소는 서버 normalizeSteps에서 화이트리스트·정규화하므로 여기선 array/object 수준만 검증.
export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsArray()
  steps!: unknown[];
}

export class SimulateDto {
  @IsArray()
  steps!: unknown[];

  @IsOptional()
  @IsObject()
  sampleFlags?: Record<string, boolean>;
}

export class SimulateInstanceDto {
  @IsArray()
  steps!: unknown[];

  @IsString()
  instanceId!: string;
}
