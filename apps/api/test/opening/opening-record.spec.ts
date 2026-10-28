import { describe, it, expect, vi } from 'vitest';
import { OpeningService } from '../../src/modules/opening/opening.service';
import { OPENING_REGISTRY } from '../../src/modules/opening/opening.registry';

/**
 * 개원 항목 사람 기록 (P1 · 2026-08-28).
 *
 * 🔴 이 기능의 위험은 **기록이 정본을 덮는 것**과 **해당 없음이 완료로 섞이는 것**이다.
 */
function makeSvc() {
  const upsert = vi.fn(async (a: unknown) => a);
  const deleteMany = vi.fn(async () => ({ count: 1 }));
  const prisma = { openingTaskRecord: { upsert, deleteMany, findMany: vi.fn().mockResolvedValue([]) } };
  return { svc: new OpeningService(prisma as never, {} as never, {} as never), upsert, deleteMany };
}

/** 연결 키가 없는 항목(사람이 기록해야 하는 것) */
const FREE = OPENING_REGISTRY.find((d) => !d.goLiveKey && !d.decisionKey && !d.committeeCode)!;
const DERIVED = OPENING_REGISTRY.find((d) => d.goLiveKey || d.decisionKey || d.committeeCode)!;

describe('🔴 파생 항목에는 기록하지 않는다 — 정본이 둘이 된다', () => {
  it('연결 키가 있으면 거부한다', async () => {
    const { svc } = makeSvc();
    await expect(svc.record(DERIVED.key, { state: 'RECORDED' }, 'u1'))
      .rejects.toThrow(/다른 정본|OPENING_DERIVED/);
  });

  it('연결 키가 없으면 기록된다', async () => {
    const { svc, upsert } = makeSvc();
    await svc.record(FREE.key, { state: 'RECORDED' }, 'u1');
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('레지스트리에 없는 키는 거부한다(아무 키나 기록할 수 없다)', async () => {
    const { svc } = makeSvc();
    await expect(svc.record('open.nope', { state: 'RECORDED' }, 'u1')).rejects.toThrow();
  });
});

describe('🔴 해당 없음에는 사유가 필요하다', () => {
  it('사유 없이 해당 없음으로 지울 수 없다 — 빠뜨린 것과 구분되지 않는다', async () => {
    const { svc } = makeSvc();
    await expect(svc.record(FREE.key, { state: 'NOT_APPLICABLE' }, 'u1')).rejects.toThrow(/사유/);
  });

  it('사유가 있으면 기록된다', async () => {
    const { svc, upsert } = makeSvc();
    await svc.record(FREE.key, { state: 'NOT_APPLICABLE', note: '위탁이 아니라 직영이다' }, 'u1');
    expect(upsert).toHaveBeenCalledOnce();
  });
});

describe('🔴 증빙을 강제하지 않는다 — 필수로 만들면 아무 값이나 채워진다', () => {
  it('증빙 없이도 완료를 기록할 수 있다', async () => {
    const { svc, upsert } = makeSvc();
    await svc.record(FREE.key, { state: 'RECORDED' }, 'u1');
    const arg = upsert.mock.calls[0][0] as { create: { evidenceRef: unknown } };
    // 🔴 빈 문자열이 아니라 `null` — "안 적었다"와 "빈 값을 적었다"를 뭉개지 않는다
    expect(arg.create.evidenceRef).toBeNull();
  });
});

describe('🔴 날짜는 date-only 정본으로만 — 로컬 자정은 KST 에서 하루 밀린다', () => {
  it('잘못된 날짜는 400 이다(500 이 아니다)', async () => {
    const { svc } = makeSvc();
    await expect(svc.record(FREE.key, { state: 'RECORDED', evidenceDate: '어제' }, 'u1'))
      .rejects.toThrow(/형식/);
  });

  it('날짜가 UTC 자정으로 저장된다', async () => {
    const { svc, upsert } = makeSvc();
    await svc.record(FREE.key, { state: 'RECORDED', evidenceDate: '2026-03-01' }, 'u1');
    const arg = upsert.mock.calls[0][0] as { create: { evidenceDate: Date } };
    expect(arg.create.evidenceDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('상태 어휘', () => {
  it('RECORDED / NOT_APPLICABLE 외에는 받지 않는다', async () => {
    const { svc } = makeSvc();
    await expect(svc.record(FREE.key, { state: 'DONE' }, 'u1')).rejects.toThrow();
  });
});

describe('🔴 증빙 첨부', () => {
  const makeAtt = (rec: unknown) => {
    const update = vi.fn(async (a: unknown) => a);
    const prisma = { openingTaskRecord: { findUnique: vi.fn().mockResolvedValue(rec), update, findMany: vi.fn().mockResolvedValue([]) } };
    return { svc: new OpeningService(prisma as never, {} as never, {} as never), update };
  };
  const FILE = { filename: 'x.png', originalName: '신고증.png', mimetype: 'image/png', size: 100 };

  it('🔴 기록이 없으면 붙일 수 없다 — 무엇에 대한 증빙인지가 먼저다', async () => {
    const { svc } = makeAtt(null);
    await expect(svc.addAttachment(FREE.key, FILE, 'u1')).rejects.toThrow(/먼저 기록/);
  });

  it('🔴 파생 항목에는 붙이지 않는다', async () => {
    const { svc } = makeAtt({ taskKey: DERIVED.key, attachments: [] });
    await expect(svc.addAttachment(DERIVED.key, FILE, 'u1')).rejects.toThrow(/다른 정본|OPENING_DERIVED/);
  });

  it('🔴 저장은 원본 경로, 응답은 서명 URL — /uploads 는 인증이 없다', async () => {
    const { svc, update } = makeAtt({ taskKey: FREE.key, attachments: [] });
    const att = await svc.addAttachment(FREE.key, FILE, 'u1');
    const saved = (update.mock.calls[0][0] as { data: { attachments: { url: string }[] } }).data.attachments[0];
    expect(saved.url, '저장은 서명 없는 경로').toBe(`/uploads/opening/${FREE.key}/x.png`);
    expect(att.url, '응답은 서명된 URL').toMatch(/exp=/);
  });

  it('모양이 아닌 값은 첨부 목록에서 버린다 — 지어내지 않는다', async () => {
    const { svc, update } = makeAtt({ taskKey: FREE.key, attachments: ['쓰레기', { nope: 1 }] });
    await svc.addAttachment(FREE.key, FILE, 'u1');
    const saved = (update.mock.calls[0][0] as { data: { attachments: unknown[] } }).data.attachments;
    expect(saved).toHaveLength(1);
  });
});

describe('🔴 소스 규약', () => {
  const SRC = require('fs').readFileSync(
    require('path').join(process.cwd(), 'src/modules/opening/opening.service.ts'), 'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔴 해당 없음을 완료로 세지 않는다', () => {
    expect(SRC).toMatch(/return t\.state === 'RECORDED';/);
    expect(SRC).toMatch(/notApplicable: list\.filter\(\(t\) => t\.state === 'NOT_APPLICABLE'\)\.length/);
  });

  it('🔴 파생 항목은 기록을 읽지도 않는다 — 읽으면 어느 쪽을 보여줄지 정해야 한다', () => {
    expect(SRC).toMatch(/const rec = derived \? null : recordByKey\.get\(d\.key\)/);
  });
});
