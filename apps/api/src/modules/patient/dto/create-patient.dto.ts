import {
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
  IsEmail,
  IsArray,
  IsIn,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, InsuranceType } from '@prisma/client';
import { CreateContactDto } from './create-contact.dto';
import { IsBirthDate } from '../../../common/validators/is-birth-date.validator';

class ConsentsDto {
  @ApiProperty({ description: '개인정보 수집/이용 동의 (필수)' })
  @IsBoolean()
  privacy: boolean;

  @ApiProperty({ description: '민감정보 처리 동의 (필수)' })
  @IsBoolean()
  sensitive: boolean;

  @ApiPropertyOptional({ description: '마케팅 수신 동의 (선택)' })
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;

  // 🔴 (2026-10-02) 화면은 10종을 보내는데 DTO 가 3종만 선언해 **7종이 전역 whitelist 로 조용히 지워졌다**
  @ApiPropertyOptional() @IsOptional() @IsBoolean() uniqueId?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() thirdParty?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() treatment?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hie?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() research?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emrView?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() telehealth?: boolean;
}

class AddressDto {
  @ApiProperty() @IsString() line1: string;
  @ApiPropertyOptional() @IsOptional() @IsString() line2?: string;
  @ApiProperty() @IsString() city: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postalCode?: string;
  @ApiProperty() @IsString() country: string;
}

export class CreatePatientDto {
  @ApiProperty({ example: '홍' })
  @IsString()
  familyName: string;

  @ApiProperty({ example: '길동' })
  @IsString()
  givenName: string;

  // 🔴 @IsDateString 만으로는 **미래 생년월일이 통과**한다(운영 실측 13건 유입).
  //    나이가 음수로 계산돼 소아 용량·검사 기준치(성별·연령)·DUR 연령금기가 전부 어긋난다.
  @ApiProperty({ example: '1990-01-15' })
  @IsDateString()
  @IsBirthDate()
  dateOfBirth: string;

  @ApiProperty({ enum: Gender, example: 'MALE' })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({ enum: InsuranceType, example: 'NHI', default: 'NHI' })
  @IsOptional()
  @IsEnum(InsuranceType)
  insuranceType?: InsuranceType;

  @ApiPropertyOptional({ description: '건강보험증번호 (암호화 저장)' })
  @IsOptional()
  @IsString()
  insuranceNumber?: string;

  @ApiPropertyOptional({ example: '010-1234-5678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'hong@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ example: 'A+' })
  @IsOptional()
  @IsString()
  bloodType?: string;

  @ApiPropertyOptional({ example: ['페니실린'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  // Extended Demographics
  @ApiPropertyOptional({ description: '주민등록번호 (암호화 저장)' })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiPropertyOptional({ enum: ['RESIDENT', 'FOREIGNER', 'PASSPORT'], default: 'RESIDENT' })
  @IsOptional()
  @IsString()
  @IsIn(['RESIDENT', 'FOREIGNER', 'PASSPORT'])
  nationalIdType?: string;

  @ApiPropertyOptional({ default: 'KR' })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({ default: 'ko' })
  @IsOptional()
  @IsString()
  preferredLanguage?: string;

  @ApiPropertyOptional({ enum: ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'UNKNOWN'] })
  @IsOptional()
  @IsString()
  @IsIn(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'UNKNOWN'])
  maritalStatus?: string;

  @ApiPropertyOptional({ example: '교사' })
  @IsOptional()
  @IsString()
  occupation?: string;

  @ApiPropertyOptional({ enum: ['CURRENT', 'FORMER', 'NEVER', 'UNKNOWN'], description: '흡연상태(사회력) — CVD 위험엔진 입력' })
  @IsOptional()
  @IsString()
  @IsIn(['CURRENT', 'FORMER', 'NEVER', 'UNKNOWN'])
  smokingStatus?: string;

  @ApiPropertyOptional({ example: '불교' })
  @IsOptional()
  @IsString()
  religion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiPropertyOptional({ type: [String], example: ['VIP', '장애인'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [CreateContactDto], description: '보호자 동시 등록' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateContactDto)
  contacts?: CreateContactDto[];

  @ApiPropertyOptional({ type: ConsentsDto, description: '등록 시 동의 정보' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentsDto)
  consents?: ConsentsDto;
}
