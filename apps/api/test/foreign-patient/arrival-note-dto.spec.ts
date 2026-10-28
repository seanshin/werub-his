import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EmergencyUnknownDto } from '../../src/modules/foreign-patient/dto/foreign-patient.dto';
import { ArrivalNoteDto } from '../../src/modules/foreign-patient/dto/arrival-note.dto';

/**
 * 🔴 전역 ValidationPipe(whitelist:true) 계약 — 장식하지 않은 필드는 조용히 지워진다(성공 응답+데이터 소실).
 * 등록 DTO 의 중첩 `arrival` 과 추가 기록 DTO 가 실제로 검증·보존되는지 class 로 확인한다.
 */
const opts = { whitelist: true, forbidNonWhitelisted: false };

describe('도착 기록 DTO', () => {
  it('등록 DTO 의 중첩 arrival 은 보존·검증된다(소지품 중첩까지)', async () => {
    const dto = plainToInstance(EmergencyUnknownDto, {
      gender: 'UNKNOWN',
      arrival: { arrivalMode: 'AMBULANCE_119', injuryTypes: ['FALL', 'BURN'], belongings: [{ item: '지갑', custody: 'HOSPITAL_STORED' }], policeInvolved: true, foundAt: '2026-09-29T07:30:00+09:00' },
    });
    expect(await validate(dto, opts)).toEqual([]);
    expect(dto.arrival).toBeInstanceOf(ArrivalNoteDto);
    expect(dto.arrival!.belongings![0].item).toBe('지갑');
  });
  it('어휘 밖 값·잘못된 시각·잘못된 보관 방법은 400', async () => {
    const bad = plainToInstance(ArrivalNoteDto, { arrivalMode: 'BUS', injuryTypes: ['FALL', 'ZOMBIE'], arrivalAt: '어제 밤', belongings: [{ item: '가방', custody: 'LOST' }] });
    const errs = await validate(bad, opts);
    expect(errs.map((e) => e.property).sort()).toEqual(['arrivalAt', 'arrivalMode', 'belongings', 'injuryTypes']);
  });
});
