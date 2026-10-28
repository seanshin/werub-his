import { Injectable, BadRequestException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { Patient, Gender } from '@prisma/client';
import { FhirPatient, FhirAddress } from './types/fhir-r4.types';
import { CreatePatientDto } from '../patient/dto/create-patient.dto';

/** FHIR OperationOutcome 오류 — 사유를 전역 예외 필터가 유실하지 않게 message 에도 싣는다(ServiceRequest 경로와 동일). */
function fhirError(diagnostics: string) {
  return { message: diagnostics, resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'processing', diagnostics }] };
}

const GENDER_TO_FHIR: Record<Gender, 'male' | 'female' | 'other' | 'unknown'> = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other',
  UNKNOWN: 'unknown',
};

const FHIR_TO_GENDER: Record<string, Gender> = {
  male: 'MALE',
  female: 'FEMALE',
  other: 'OTHER',
  unknown: 'UNKNOWN',
};

@Injectable()
export class FhirPatientMapper {
  toFhir(patient: Patient): FhirPatient {
    const address = patient.address as Record<string, string> | null;

    return {
      resourceType: 'Patient',
      id: patient.fhirId ?? patient.id,
      identifier: [
        {
          system: 'urn:hospital-run:mrn',
          value: patient.mrn,
        },
      ],
      name: [
        {
          family: patient.familyName,
          given: [patient.givenName],
          text: `${patient.familyName}${patient.givenName}`,
        },
      ],
      gender: GENDER_TO_FHIR[patient.gender],
      birthDate: this.formatDate(patient.dateOfBirth),
      telecom: [
        ...(patient.phone ? [{ system: 'phone' as const, value: patient.phone }] : []),
        ...(patient.email ? [{ system: 'email' as const, value: patient.email }] : []),
      ],
      address: address
        ? [
            {
              line: [address.line1, address.line2].filter(Boolean) as string[],
              city: address.city,
              state: address.state,
              postalCode: address.postalCode,
              country: address.country,
            },
          ]
        : [],
    };
  }

  toCreateDto(fhirPatient: FhirPatient): CreatePatientDto {
    const name = fhirPatient.name?.[0];
    const phone = fhirPatient.telecom?.find((t) => t.system === 'phone');
    const email = fhirPatient.telecom?.find((t) => t.system === 'email');
    const addr = fhirPatient.address?.[0];

    // 🔴 값을 지어내지 않는다 — 종전엔 `family:''`·`birthDate:'1900-01-01'` 로 날조해
    //    빈/오염 FHIR 바디(`{}`·`{invalid:x}`)가 **무명·가짜 생년월일 환자를 201 로 생성**했다(MRN 까지 발급).
    //    필수 신원은 FHIR OperationOutcome 로 거부한다.
    const family = name?.family?.trim();
    if (!family) throw new BadRequestException(fhirError('name[0].family(성)가 필요합니다 — 이름 없는 환자는 생성하지 않습니다'));

    const dto = new CreatePatientDto();
    dto.familyName = family;
    dto.givenName = name?.given?.[0] ?? '';
    dto.gender = FHIR_TO_GENDER[fhirPatient.gender ?? 'unknown'] ?? 'UNKNOWN';
    dto.dateOfBirth = fhirPatient.birthDate as string; // 아래 validateSync 가 누락·미래·형식오류를 잡는다
    dto.phone = phone?.value;
    dto.email = email?.value;

    if (addr) {
      dto.address = {
        line1: addr.line?.[0] ?? '',
        line2: addr.line?.[1],
        city: addr.city ?? '',
        state: addr.state,
        postalCode: addr.postalCode,
        country: addr.country ?? 'KR',
      };
    }

    // 🔴 FHIR 경로는 DTO 를 **코드로 조립**해 ValidationPipe 를 거치지 않는다 → 정본 검증
    //    (@IsBirthDate 미래 생년월일 차단·@IsDateString·@IsEnum gender)이 통째로 우회됐다.
    //    정본 DTO 를 여기서 직접 검증해 REST 생성과 같은 규칙을 FHIR 생성·수정·Bundle 에도 적용한다.
    const errors = validateSync(dto);
    if (errors.length) {
      const detail = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');
      throw new BadRequestException(fhirError(`Patient 리소스 검증 실패: ${detail}`));
    }

    return dto;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
