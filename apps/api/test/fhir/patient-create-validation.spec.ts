import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { FhirPatientMapper } from '../../src/modules/fhir/fhir-patient.mapper';

/**
 * 🔴 FHIR Patient 생성이 값을 지어내지 않는다 (2026-09-01 · 변이 유효-바디 프로브 후속).
 *
 * 종전엔 `toCreateDto` 가 `family:''`·`birthDate:'1900-01-01'` 로 날조해 빈/오염 FHIR 바디
 * (`{}`·`{invalid:x}`)가 **무명·가짜 생년월일 환자를 201 로 생성**했다(MRN 까지 발급). 또 FHIR 경로는
 * DTO 를 코드로 조립해 ValidationPipe 를 거치지 않아 정본 검증(@IsBirthDate 미래 차단 등)이 통째로
 * 우회됐다. 이 가드는 두 결함이 되살아나면 실패한다.
 *
 * 재주입: `?? '1900-01-01'` 를 되살리거나 validateSync 를 지우면 아래가 통과해버려 실패로 뒤집힌다.
 */
const mapper = new FhirPatientMapper();

describe('FHIR Patient 생성 검증 — 날조·우회 금지', () => {
  it('🔴 이름(family)이 없으면 거부한다 — 무명 환자를 만들지 않는다', () => {
    // 🔴 birthDate 는 유효하게 줘서 **family 검증만** 격리한다(안 그러면 birthDate 누락으로 통과해
    //    family 검증이 없어도 테스트가 "다른 이유로" 통과한다 — 재주입에서 실제로 겪었다).
    expect(() => mapper.toCreateDto({ gender: 'male', birthDate: '1990-01-15' } as never)).toThrow(BadRequestException);
    expect(() => mapper.toCreateDto({ name: [{ family: '  ' }], gender: 'male', birthDate: '1990-01-15' } as never)).toThrow(BadRequestException);
  });

  it('🔴 생년월일이 없으면 거부한다 — 1900-01-01 로 지어내지 않는다', () => {
    // family 는 유효하게 줘서 birthDate 검증만 격리한다.
    expect(() => mapper.toCreateDto({ name: [{ family: '홍', given: ['길동'] }], gender: 'male' } as never)).toThrow(BadRequestException);
  });

  it('🔴 미래 생년월일을 거부한다 — 정본 검증(@IsBirthDate)이 FHIR 경로에도 적용된다', () => {
    expect(() => mapper.toCreateDto({
      name: [{ family: '홍', given: ['길동'] }], gender: 'male', birthDate: '2999-01-15',
    } as never)).toThrow(BadRequestException);
  });

  it('정상 FHIR 환자는 통과한다 — 과잉 제한이 아니다(해피패스)', () => {
    const dto = mapper.toCreateDto({
      resourceType: 'Patient', name: [{ family: '홍', given: ['길동'] }], gender: 'male', birthDate: '1990-01-15',
    } as never);
    expect(dto.familyName).toBe('홍');
    expect(dto.givenName).toBe('길동');
    expect(dto.dateOfBirth).toBe('1990-01-15');
    expect(dto.gender).toBe('MALE');
  });
});
