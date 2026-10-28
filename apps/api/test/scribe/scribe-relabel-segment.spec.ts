import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ArgumentMetadata, BadRequestException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ScribeService } from '../../src/modules/scribe/scribe.service';
import { RelabelScribeSegmentDto } from '../../src/modules/scribe/dto/scribe.dto';

/**
 * 🔴 D8 — `TranscriptViewer.onRelabel` 은 로컬 React 상태만 바꿨다(voice-emr-ambient-conversation.plan.md
 * §13.2 P2). `scribe-api.ts` 에 PATCH 가 없어 서버 `ScribeSession.transcript` 는 자동 라벨 그대로였고,
 * `draft()` 는 그 DB 값을 읽으므로 **의사가 고친 화자가 초안에 반영되지 않았다.**
 *
 * 지키는 것: ① 재라벨이 DB(모의 prisma)에 남는다 ② `draft()` 가 부르는 것과 같은 조회 경로가 그 값을 읽는다
 *          ③ 원문(text)·화자 식별자(speaker)는 손대지 않는다 ④ 전역 whitelist 에 `text` 를 실어도 지워진다
 *            (DTO 에 `text` 필드가 없다 — 재라벨 EP 로 원문을 바꿀 길이 애초에 없다)
 *          ⑤ 게이트·소유·범위 검증(SEGMENT_NOT_FOUND·NO_TRANSCRIPT)
 */
const ENC = { id: 'e1', patientId: 'p1', doctorId: 'doc1' };

function make(transcript: unknown = [
  { role: 'DOCTOR', text: '어디가 불편하세요', speaker: 'spk_0', start: 0, end: 1.2 },
  { role: 'DOCTOR', text: '두통이 있어요', speaker: 'spk_1', start: 1.3, end: 2.5 }, // 실제로는 환자 발화 — 화자분리가 틀렸다고 가정
]) {
  // update() 는 실제 DB처럼 세션 레코드를 in-place 로 갱신한다 — draft() 등 이후 조회가 같은 레코드를 본다
  const session: Record<string, unknown> = { id: 's1', encounterId: 'e1', patientId: 'p1', doctorId: 'doc1', transcript };
  const update = vi.fn(({ data }: any) => { Object.assign(session, data); return Promise.resolve(session); });
  const prisma: any = {
    encounter: { findUnique: vi.fn().mockResolvedValue(ENC) },
    scribeSession: { findUnique: vi.fn(() => Promise.resolve(session)), update },
    patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '김', givenName: '철수', koreanName: null, mrn: 'M1' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ familyName: '박', givenName: '지훈' }) },
  };
  const config: any = { get: vi.fn((k: string) => Promise.resolve(k === 'scribe.enabled' ? true : undefined)) };
  const svc = new ScribeService(prisma, {} as any, {} as any, config, undefined, undefined); // medicalAi 없음 → 규칙 저하 경로
  return { svc, prisma, session, update };
}

describe('🔴 D8 — 화자분리 세그먼트 재라벨이 DB에 남고 draft() 가 그 값을 읽는다', () => {
  it('① 지정 인덱스의 role 만 바뀌고 text·speaker·start·end 는 그대로다', async () => {
    const { svc, update, session } = make();
    const r = await svc.relabelSegment('e1', 's1', 1, 'doc1', { role: 'PATIENT' } as RelabelScribeSegmentDto);
    expect(r).toMatchObject({ role: 'PATIENT', text: '두통이 있어요', speaker: 'spk_1', start: 1.3, end: 2.5 });
    expect(update).toHaveBeenCalledTimes(1);
    const written = (update.mock.calls[0][0].data.transcript as any[]);
    expect(written[0]).toMatchObject({ role: 'DOCTOR', text: '어디가 불편하세요' }); // 다른 세그먼트는 무영향
    expect(written[1]).toMatchObject({ role: 'PATIENT', text: '두통이 있어요' });
    expect((session.transcript as any[])[1].role).toBe('PATIENT'); // 레코드에 실제로 반영됨
  });

  it('🔴 ② draft() 가 부르는 것과 같은 조회 경로가 이미 반영된 값을 읽는다(로컬 상태였다면 여기서 옛 값이 나온다)', async () => {
    const { svc, session } = make();
    await svc.relabelSegment('e1', 's1', 1, 'doc1', { role: 'PATIENT' } as RelabelScribeSegmentDto);
    // draft() 는 scribeSession.findUnique 로 세션을 다시 읽는다 — 같은 레코드이므로 재라벨이 이미 반영돼 있다
    expect((session.transcript as any[])[1].role).toBe('PATIENT');
    const result = await svc.draft('e1', 's1', 'doc1');
    expect(result).toBeDefined(); // NO_TRANSCRIPT 로 막히지 않고 갱신된 transcript 로 정상 진행
  });

  it('③ 서로 다른 두 세그먼트를 독립적으로 재라벨해도 서로 간섭하지 않는다', async () => {
    const { svc, session } = make();
    await svc.relabelSegment('e1', 's1', 0, 'doc1', { role: 'PATIENT' } as RelabelScribeSegmentDto);
    await svc.relabelSegment('e1', 's1', 1, 'doc1', { role: 'GUARDIAN' } as RelabelScribeSegmentDto);
    const t = session.transcript as any[];
    expect(t[0].role).toBe('PATIENT');
    expect(t[1].role).toBe('GUARDIAN');
  });

  it('범위 밖 인덱스는 400 SEGMENT_NOT_FOUND', async () => {
    const { svc } = make();
    await expect(svc.relabelSegment('e1', 's1', 5, 'doc1', { role: 'PATIENT' } as RelabelScribeSegmentDto))
      .rejects.toMatchObject({ response: { code: 'SEGMENT_NOT_FOUND' } });
  });

  it('전사가 없으면 400 NO_TRANSCRIPT', async () => {
    const { svc } = make([]);
    await expect(svc.relabelSegment('e1', 's1', 0, 'doc1', { role: 'PATIENT' } as RelabelScribeSegmentDto))
      .rejects.toMatchObject({ response: { code: 'NO_TRANSCRIPT' } });
  });

  it('담당의 아니면 차단(IDOR)', async () => {
    const { svc } = make();
    await expect(svc.relabelSegment('e1', 's1', 0, 'intruder', { role: 'PATIENT' } as RelabelScribeSegmentDto))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('게이트 OFF 면 차단(SCRIBE_DISABLED)', async () => {
    const { svc, prisma } = make();
    prisma.encounter.findUnique.mockClear();
    const config: any = { get: vi.fn().mockResolvedValue(false) };
    const off = new ScribeService(prisma, {} as any, {} as any, config, undefined, undefined);
    await expect(off.relabelSegment('e1', 's1', 0, 'doc1', { role: 'PATIENT' } as RelabelScribeSegmentDto))
      .rejects.toMatchObject({ response: { code: 'SCRIBE_DISABLED' } });
    expect(prisma.encounter.findUnique).not.toHaveBeenCalled();
  });

  it('세션이 없거나 다른 진료의 세션이면 404', async () => {
    const { svc, prisma } = make();
    prisma.scribeSession.findUnique = vi.fn().mockResolvedValue(null);
    await expect(svc.relabelSegment('e1', 's1', 0, 'doc1', { role: 'PATIENT' } as RelabelScribeSegmentDto))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('🔴 ④ 원문은 이 EP 로 바꿀 길이 없다 — DTO 에 text 가 없어 전역 whitelist 가 지운다', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }); // main.ts 전역 파이프와 동일 옵션
  const meta: ArgumentMetadata = { type: 'body', metatype: RelabelScribeSegmentDto, data: undefined };

  it('role 은 통과하고 text 는 조용히 지워진다(변조 시도가 성공한 것처럼 보이지 않는다)', async () => {
    const out: any = await pipe.transform({ role: 'PATIENT', text: '조작된 원문' }, meta);
    expect(out).toMatchObject({ role: 'PATIENT' });
    expect(out.text).toBeUndefined();
  });

  it('role 이 허용 목록 밖이면 400', async () => {
    await expect(pipe.transform({ role: 'ATTACKER' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('role 이 없으면 400', async () => {
    await expect(pipe.transform({}, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
