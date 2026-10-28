import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { CompleteSurgeryDto } from '../../src/modules/surgery/dto/surgery.dto';
import { CreateOpNoteDto, UpdateOpNoteDto } from '../../src/modules/surgery-opnote/dto/surgery-opnote.dto';
import { SurgeryOpnoteService } from '../../src/modules/surgery-opnote/surgery-opnote.service';

/**
 * 수술기록 DTO ↔ 실제 전역 파이프 계약 가드 — 2026-08-18.
 *
 * 🔴 컨트롤러를 직접 호출하는 단위 테스트는 **파이프를 타지 않는다**. 그래서
 *    `surgery.controller.spec.ts` 가 `ebl: 100` 으로 통과하는 동안, 운영에서는 같은 값이
 *    `@IsString()` 에 걸려 400 이 났고 Op Note **전체**가 저장되지 않았다.
 *    이 스펙은 `main.ts` 와 **같은 옵션의 ValidationPipe** 를 실제로 태워서 확인한다.
 *
 * 확인하는 것 두 가지:
 *   ① 화면이 보내는 값이 파이프를 **통과**하는가(400 으로 튕기지 않는가)
 *   ② 통과한 뒤에도 키가 **살아남는가**(whitelist 가 조용히 지우지 않는가)
 */

// main.ts 와 동일 — 옵션이 갈라지면 이 가드는 아무것도 보증하지 못한다.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });

function meta(metatype: unknown): ArgumentMetadata {
  return { type: 'body', metatype: metatype as ArgumentMetadata['metatype'], data: '' };
}

async function through<T extends object>(metatype: unknown, payload: Record<string, unknown>): Promise<T> {
  return (await pipe.transform(payload, meta(metatype))) as T;
}

/**
 * 실제로 **값이 실린** 키만 센다.
 * 🔴 클래스 필드는 컴파일 결과에서 `undefined` 로 선언되므로 `Object.keys()` 는 DTO 전 필드를 돌려준다 —
 *    그대로 세면 "아무것도 안 버려졌다"고 잘못 통과한다(가드가 다른 이유로 통과하는 전형).
 */
function definedKeys(out: Record<string, unknown>): string[] {
  return Object.entries(out).filter(([, v]) => v !== undefined).map(([k]) => k).sort();
}

const SURGERY_ID = '11111111-1111-4111-8111-111111111111';
const DOCTOR_ID = '22222222-2222-4222-8222-222222222222';

describe('수술 완료 + Op Note (CompleteSurgeryDto)', () => {
  /** `/surgery/[id]` 화면과 수술 진료 레이아웃이 실제로 보내는 12키 */
  const screenPayload = {
    preOpDiagnosis: '우측 서혜부 탈장',
    postOpDiagnosis: '우측 간접 서혜부 탈장',
    opNote: '절개 → 고위결찰 → mesh 삽입 → 층별 봉합',
    findings: '간접 서혜부 탈장 확인',
    complications: '없음',
    specimens: '탈장낭 1개',
    ebl: 50,
    fluidsGiven: 'NS 1000mL',
    implants: 'Ultrapro mesh',
    drains: 'JP 1개',
    anesthesiaType: 'GENERAL',
    anesthesiaNote: '전신마취, 이상 없음',
  };

  it('화면이 보내는 12키가 하나도 버려지지 않는다', async () => {
    const out = await through<Record<string, unknown>>(CompleteSurgeryDto, screenPayload);
    expect(definedKeys(out)).toEqual(Object.keys(screenPayload).sort());
  });

  it('🔴 추정 실혈량은 숫자로 통과한다 — 컬럼(Surgery.ebl)이 Int 다', async () => {
    const out = await through<{ ebl?: number }>(CompleteSurgeryDto, { ...screenPayload, ebl: 350 });
    expect(out.ebl).toBe(350);
    expect(typeof out.ebl).toBe('number');
  });

  it('실혈량이 400 으로 튕기면 소견·검체·합병증까지 함께 사라진다 — 그 일이 없어야 한다', async () => {
    await expect(through(CompleteSurgeryDto, screenPayload)).resolves.toBeDefined();
  });

  it('미입력(빈 문자열)은 0 이 아니라 미기재로 떨어진다', async () => {
    const out = await through<Record<string, unknown>>(CompleteSurgeryDto, { findings: 'x', ebl: '' });
    expect('ebl' in out ? out.ebl : undefined).toBeUndefined();
  });

  it('숫자가 아닌 실혈량은 조용히 버리지 않고 400 으로 거절한다', async () => {
    await expect(through(CompleteSurgeryDto, { ebl: '많음' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('수술기록 보완 (Create/UpdateOpNoteDto)', () => {
  /** `OpNotePanel` 이 실제로 보내는 본문 */
  const panelBody = {
    assistants: [{ userId: DOCTOR_ID, name: '김보조' }],
    incisionTime: '2026-08-18T09:00',
    closureTime: '2026-08-18T10:30',
    complicationGrade: 'I',
    postOpOrders: '금식 유지, 6시간 후 유동식',
  };

  it('생성 — 패널이 보내는 키가 하나도 버려지지 않는다', async () => {
    const out = await through<Record<string, unknown>>(CreateOpNoteDto, { surgeryId: SURGERY_ID, ...panelBody });
    expect(definedKeys(out)).toEqual(['assistants', 'closureTime', 'complicationGrade', 'incisionTime', 'postOpOrders', 'surgeryId']);
  });

  it('수정 — 패널이 보내는 키가 하나도 버려지지 않는다', async () => {
    const out = await through<Record<string, unknown>>(UpdateOpNoteDto, panelBody);
    expect(definedKeys(out)).toEqual(['assistants', 'closureTime', 'complicationGrade', 'incisionTime', 'postOpOrders']);
  });

  it('🔴 보조 집도진은 중첩 안쪽(userId)까지 살아남는다 — 중첩 키 유실이 오늘 반복된 함정이다', async () => {
    const out = await through<{ assistants?: { userId: string; name?: string }[] }>(UpdateOpNoteDto, panelBody);
    expect(out.assistants).toHaveLength(1);
    expect(out.assistants?.[0].userId).toBe(DOCTOR_ID);
    expect(out.assistants?.[0].name).toBe('김보조');
  });

  it('보조 집도진에 이름 문자열만 넣으면 400 — uuid 칸에 이름을 밀어 넣지 않는다', async () => {
    await expect(through(UpdateOpNoteDto, { assistants: [{ name: '김보조' }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(through(UpdateOpNoteDto, { assistants: [{ userId: '김보조' }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Clavien-Dindo 는 등급 문자열이다 — 화면이 숫자(3.1)를 보내던 것은 거절된다', async () => {
    await expect(through(UpdateOpNoteDto, { complicationGrade: 3.1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(through(UpdateOpNoteDto, { complicationGrade: 'IIIb' })).resolves.toBeDefined();
  });

  it('종전 패널이 쓰던 이름은 전부 버려진다 — 이름을 컬럼에 맞춘 이유', async () => {
    const legacy = {
      mallampati: 3, npoConfirmed: true, prophylacticAntibiotic: 'Cefazolin 1g',
      signIn: true, timeOut: true, signOut: false,
      specimen: '탈장낭', fluids: 'NS 1000mL', clavienDindo: 3.1,
    };
    const out = await through<Record<string, unknown>>(UpdateOpNoteDto, legacy);
    expect(definedKeys(out)).toEqual([]);
  });
});

describe('수술기록 시각은 해석되지 않으면 저장하지 않는다', () => {
  const create = vi.fn().mockResolvedValue({ id: 'n-1' });
  const service = new SurgeryOpnoteService({ surgeryOpNote: { create } } as never);

  it('절개 시각이 해석 불가면 400 — Invalid Date 를 원장에 박지 않는다', async () => {
    create.mockClear();
    await expect(
      service.createOpNote({ surgeryId: SURGERY_ID, createdBy: DOCTOR_ID, incisionTime: '어제 오전' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create, '해석 실패인데도 DB 쓰기가 일어났다').not.toHaveBeenCalled();
  });

  it('빈 문자열은 미기재(undefined)로 저장된다 — 0 이나 Invalid Date 가 아니다', async () => {
    create.mockClear();
    await service.createOpNote({ surgeryId: SURGERY_ID, createdBy: DOCTOR_ID, incisionTime: '', closureTime: undefined });
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.incisionTime).toBeUndefined();
    expect(data.closureTime).toBeUndefined();
  });

  it('정상 시각은 Date 로 저장된다', async () => {
    create.mockClear();
    await service.createOpNote({ surgeryId: SURGERY_ID, createdBy: DOCTOR_ID, incisionTime: '2026-08-18T09:00' });
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.incisionTime).toBeInstanceOf(Date);
    expect(Number.isNaN((data.incisionTime as Date).getTime())).toBe(false);
  });

  it('보조 집도진은 저장 데이터에 그대로 실린다', async () => {
    create.mockClear();
    await service.createOpNote({
      surgeryId: SURGERY_ID, createdBy: DOCTOR_ID,
      assistants: [{ userId: DOCTOR_ID, name: '김보조' }],
    });
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.assistants).toEqual([{ userId: DOCTOR_ID, name: '김보조' }]);
  });
});
