import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateNeurosurgeryExamDto } from '../../src/modules/neurosurgery/dto/neurosurgery.dto';

/**
 * NIHSS·ASIA 저장 검증(2026-10-10) — 🔴 종전엔 아무 문자열(ASIA)·아무 숫자(NIHSS 음수·소수·100)를 받았다.
 * 화면에 입력 칸이 생기면서(전문진료 2차) 서버가 척도 범위를 지킨다.
 */
const errs = async (o: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateNeurosurgeryExamDto, { patientId: '00000000-0000-4000-8000-000000000001', ...o }))).map((e) => e.property);

describe('신경외과 검사 DTO — NIHSS·ASIA', () => {
  it('🔴 NIHSS 0~42 정수만', async () => {
    for (const bad of [-1, 43, 3.5]) expect(await errs({ nihss: bad })).toContain('nihss');
    for (const ok of [0, 42, 7]) expect(await errs({ nihss: ok })).not.toContain('nihss');
  });
  it('🔴 ASIA 는 A~E', async () => {
    for (const bad of ['F', 'a', 'complete', '']) expect(await errs({ asiaScale: bad })).toContain('asiaScale');
    for (const ok of ['A', 'C', 'E']) expect(await errs({ asiaScale: ok })).not.toContain('asiaScale');
  });
  it('대조군 — 둘 다 빼면(평가 안 함) 통과', async () => {
    expect(await errs({})).toEqual([]);
  });
});
