/**
 * 🔴 (2026-09-14) 비동기 원격진료 환자 메시지·의사 답변이 인라인 타입 @Body 라 ValidationPipe 가 건너뛰었다.
 * 지키는 것: ① 실제 전역 파이프 설정(whitelist·forbidNonWhitelisted 여부는 main.ts 정본을 따름)으로 빈 본문 거부
 *           ② 대조군 — 정상 본문은 통과하고 필드가 지워지지 않는다 ③ 핸들러 metatype 이 class 다(인라인으로 되돌리면 실패)
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SubmitTelehealthDoctorReplyDto, SubmitTelehealthPatientMessageDto } from '../../src/modules/telehealth/dto/telehealth-async.dto';

// main.ts 전역 파이프와 같은 옵션
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });

// vitest(esbuild)는 design:paramtypes 를 내지 않는다 — 핸들러 시그니처는 소스로 대조한다(주석 제거 후)
const CONTROLLER_SRC = fs
  .readFileSync(path.resolve(__dirname, '../../src/modules/telehealth/telehealth.controller.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
function bodyTypeName(method: string): string | null {
  // 시그니처 안(함수 본문 `{` 이전)에서만 찾는다 — 인라인 타입은 `{` 를 가져 여기서 끊긴다
  const m = CONTROLLER_SRC.match(new RegExp(`async ${method}\\([^{]*?@Body\\(\\)\\s*\\w+:\\s*(\\w+)\\)`));
  return m ? m[1] : null;
}

describe('원격진료 비동기 본문 검증', () => {
  it('① 빈 본문은 400', async () => {
    await expect(pipe.transform({}, meta(SubmitTelehealthPatientMessageDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ reply: '' }, meta(SubmitTelehealthDoctorReplyDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('② 대조군 — 정상 본문은 필드 그대로 통과', async () => {
    const m = await pipe.transform({ message: '두통', photos: [{ url: 'x' }] }, meta(SubmitTelehealthPatientMessageDto));
    expect(m).toMatchObject({ message: '두통', photos: [{ url: 'x' }] });
    const r = await pipe.transform({ reply: '내원 권고' }, meta(SubmitTelehealthDoctorReplyDto));
    expect(r).toMatchObject({ reply: '내원 권고' });
  });

  it('③ 핸들러 본문이 DTO class 로 선언돼 있다(인라인 타입·@Body(키)로 되돌리면 실패)', () => {
    expect(bodyTypeName('submitPatientMessage')).toBe(SubmitTelehealthPatientMessageDto.name);
    expect(bodyTypeName('submitDoctorReply')).toBe(SubmitTelehealthDoctorReplyDto.name);
  });
});
