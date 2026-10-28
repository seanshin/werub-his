import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddIcuRecordDto } from '../../src/modules/icu/dto/icu.dto';

/**
 * ICU 플로우시트 기록 DTO 계약 — 전역 whitelist ValidationPipe가 프론트엔드가 보내는
 * 정본 camelCase 필드를 strip하거나 필수 type으로 400을 유발하던 P0 회귀 방지.
 * 프론트엔드 EMPTY_FORM 키(정본)로 검증이 통과하고 값이 보존되는지 확인.
 */
describe('AddIcuRecordDto — 필드 계약(정본 camelCase)', () => {
  // 프론트엔드 icu/page.tsx EMPTY_FORM이 실제 전송하는 필드 집합
  const fePayload = {
    heartRate: 88, systolicBp: 140, diastolicBp: 85, spo2: 96, respiratoryRate: 18, temperature: 37.2,
    gcScore: 14, consciousness: 'ALERT', pupilReaction: 'PRE',
    intakeOral: 100, intakeIv: 500, intakeOther: 0, outputUrine: 300, outputDrain: 20, outputOther: 0,
    ventMode: 'SIMV', fio2: 40, peep: 5, tidalVolume: 450, pip: 22,
    apacheScore: 12, sofaScore: 4, painScore: 2, sedationScore: 0,
    notes: '안정적',
  };

  it('type 없이도(선택) 검증 통과', async () => {
    const dto = plainToInstance(AddIcuRecordDto, fePayload);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    expect(errors).toHaveLength(0);
  });

  it('정본 필드가 whitelist에서 살아남음(strip 안 됨)', () => {
    const dto = plainToInstance(AddIcuRecordDto, fePayload, { excludeExtraneousValues: false });
    // 안전 핵심값(BP·SpO2·GCS·FiO2·I/O)이 DTO 인스턴스에 존재해야 함
    expect((dto as any).systolicBp).toBe(140);
    expect((dto as any).spo2).toBe(96);
    expect((dto as any).gcScore).toBe(14);
    expect((dto as any).fio2).toBe(40);
    expect((dto as any).intakeIv).toBe(500);
    expect((dto as any).outputUrine).toBe(300);
    expect((dto as any).sedationScore).toBe(0);
  });

  it('경계 위반(SpO2 120·RASS 9)은 검증 실패', async () => {
    const dto = plainToInstance(AddIcuRecordDto, { spo2: 120, sedationScore: 9 });
    const errors = await validate(dto);
    const props = errors.map((e) => e.property);
    expect(props).toContain('spo2');
    expect(props).toContain('sedationScore');
  });
});
