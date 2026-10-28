import { IsString, IsNotEmpty, IsOptional, IsIn, IsInt, IsBoolean, IsEmail, IsUUID, MaxLength, Min, Max, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ArrivalNoteDto } from './arrival-note.dto';

/**
 * 🔴 외국인·응급 미확인 환자 등록 DTO — `interface` → `class` 승격(2026-09-01 변이 EP 재실측).
 *
 * 종전엔 둘 다 `interface` 라 metatype 이 `Object` → **ValidationPipe 스킵**. 환자 PII(여권·외국인
 * 등록번호)를 쓰는 고위험 변이인데 빈/오염 바디가 검증 없이 서비스로 들어가 500 으로 샜다.
 * 같은 모듈 `IdentifyPatientDto` 가 같은 이유로 이미 클래스로 승격된 선례를 따른다.
 *
 * 🔴 전역 `whitelist:true` 라 장식하지 않은 필드는 지워진다 — 서비스가 읽는 필드를 빠짐없이 장식한다
 *    (중첩 객체 travelInsurance·emergencyContact 는 @ValidateNested + @Type 로 실체화).
 */
class TravelInsuranceDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  company!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  policyNo!: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  contactNo!: string;
}

class EmergencyContactDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string;

  @IsOptional() @IsString() @MaxLength(50)
  relationship?: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  phone!: string;
}

export class ForeignPatientDto {
  @IsIn(['FOREIGN_TOURIST', 'FOREIGN_RESIDENT', 'OVERSEAS_KOREAN', 'REMOTE_INTERNATIONAL'], {
    message: '환자 유형이 올바르지 않습니다',
  })
  patientType!: 'FOREIGN_TOURIST' | 'FOREIGN_RESIDENT' | 'OVERSEAS_KOREAN' | 'REMOTE_INTERNATIONAL';

  @IsString() @IsNotEmpty({ message: '성(姓)을 입력하세요' }) @MaxLength(50)
  familyName!: string;

  @IsString() @IsNotEmpty({ message: '이름을 입력하세요' }) @MaxLength(50)
  givenName!: string;

  @IsOptional() @IsString() @MaxLength(100)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(50)
  koreanName?: string;

  @IsString() @IsNotEmpty({ message: '국적을 입력하세요' }) @MaxLength(3)
  nationality!: string;

  @IsOptional() @IsString() @MaxLength(50)
  passportNumber?: string;

  @IsOptional() @IsString() @MaxLength(30)
  alienRegistrationNo?: string;

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '생년월일은 YYYY-MM-DD 형식이어야 합니다' })
  dateOfBirth!: string;

  @IsIn(['MALE', 'FEMALE'], { message: '성별은 MALE/FEMALE 중 하나여야 합니다' })
  gender!: 'MALE' | 'FEMALE';

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsEmail({}, { message: '이메일 형식이 올바르지 않습니다' }) @MaxLength(100)
  email?: string;

  @IsOptional() @IsString() @MaxLength(20)
  preferredLanguage?: string;

  @IsOptional() @IsIn(['NHI', 'SELF_PAY', 'TRAVEL_INSURANCE', 'EMBASSY', 'DEPOSIT'])
  insuranceType?: 'NHI' | 'SELF_PAY' | 'TRAVEL_INSURANCE' | 'EMBASSY' | 'DEPOSIT';

  @IsOptional() @ValidateNested() @Type(() => TravelInsuranceDto)
  travelInsurance?: TravelInsuranceDto;

  @IsOptional() @IsString() @MaxLength(200)
  embassyContact?: string;

  @IsOptional() @IsBoolean()
  interpreterNeeded?: boolean;

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '여권 만료일은 YYYY-MM-DD 형식이어야 합니다' })
  passportExpiry?: string;

  @IsOptional() @IsString() @MaxLength(20)
  visaType?: string;

  @IsOptional() @IsString() @MaxLength(300)
  localAddress?: string;

  @IsOptional() @ValidateNested() @Type(() => EmergencyContactDto)
  emergencyContact?: EmergencyContactDto;
}

export class EmergencyUnknownDto {
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'UNKNOWN'])
  gender?: 'MALE' | 'FEMALE' | 'UNKNOWN';

  @IsOptional() @IsInt() @Min(0) @Max(150)
  estimatedAge?: number;

  /** 도착 상황 기록(구조화) — 있으면 첫 기록(INITIAL)으로 저장한다 */
  @IsOptional() @ValidateNested() @Type(() => ArrivalNoteDto)
  arrival?: ArrivalNoteDto;

  /** 옛 필드 — 종전 화면·외부 호출 호환. 🔴 종전엔 검증만 하고 **버렸다** → 이제 첫 기록의 메모·손상 유형으로 저장한다 */
  @IsOptional() @IsString() @MaxLength(2000)
  arrivalNote?: string;

  @IsOptional() @IsString() @MaxLength(200)
  injuryType?: string;

  /** 119·전원 사전통보에서 불러와 쓴 기록이면 그 통보 id(첫 기록에 출처로 남긴다) */
  @IsOptional() @IsUUID()
  prenotificationId?: string;

  /** 🔴 등록하면서 그 사전통보를 도착 처리할지 — 사람이 고른 경우만(기본 false · 자동으로 닫지 않는다) */
  @IsOptional() @IsBoolean()
  markPrenotificationArrived?: boolean;
}
