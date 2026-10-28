import { IsOptional, IsUUID, IsInt, IsNumber, IsString, IsBoolean, IsIn, IsISO8601 } from 'class-validator';
import { ACVPU_LEVELS } from './vitals-evaluate';

export class CreateVitalsDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() encounterId?: string;
  /** 🔴 DTO 에 없는 키는 전역 whitelist 가 조용히 지운다 — VitalsInput 이 쓰는 키는 전부 여기 선언 */
  @IsOptional() @IsUUID() queueId?: string;
  /** 재원(입원 원장에 쓴다) — 같은 환자의 재원 중 입원이 아니면 400 */
  @IsOptional() @IsUUID() admissionId?: string;
  @IsOptional() @IsInt() systolicBp?: number;
  @IsOptional() @IsInt() diastolicBp?: number;
  @IsOptional() @IsInt() heartRate?: number;
  @IsOptional() @IsNumber() temperature?: number;
  @IsOptional() @IsInt() spo2?: number;
  @IsOptional() @IsInt() respiratoryRate?: number;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsNumber() height?: number;
  @IsOptional() @IsInt() painScore?: number;
  @IsOptional() @IsString() notes?: string;
  /** NEWS2 요소 — 관측했을 때만 보낸다. 보내지 않으면 NEWS2 는 **산출하지 않는다**(가정 금지) */
  @IsOptional() @IsBoolean() supplementalO2?: boolean;
  @IsOptional() @IsIn(ACVPU_LEVELS as unknown as string[]) consciousness?: string;
  @IsOptional() @IsIn([1, 2]) spO2Scale?: number;
  /**
   * 측정 시각(ISO8601·오프셋 포함). 🔴 **모르면 보내지 않는다** — 지어낸 시각을 원장에 박지 않기 위해서다.
   * 보내지 않으면 DB 기본값(삽입 시각)이 들어가고, 그 사실은 서버 로그(`MEASURED_AT_DEFAULTED_TO_RECEIPT`)에 남는다.
   * 보내면 그 시각으로 **멱등 판정**이 켜진다(같은 환자·같은 시각·같은 값의 재수신은 저장하지 않는다).
   */
  @IsOptional() @IsISO8601() measuredAt?: string;
}
