/**
 * 🔴 W8 R3 가드 — HIRA EDI '제출'이 상태만 바꾸던 것(C1).
 *
 * 원 결함: `submitDocument` 가 심평원으로 나가는 전송 코드 없이 `status:'SUBMITTED'` ·
 * `submittedAt: now` 를 적었고, 화면은 '제출됨' 배지를 보여줬다. 재생성은 그 상태를 영구 차단해
 * **나가지도 않은 명세서를 고칠 수 없게** 만들었다.
 *
 * 이 스펙이 지키는 것:
 *  ③ 전송 코드 없이 SUBMITTED 금지 — 미구축이면 LOCAL_RECORDED · submittedAt=null · LOCAL- 접수번호
 *    · 재제출/재생성 가능 · 읽는 쪽은 '전송 근거 없음'으로 판정
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HiraEdiService } from '../../src/modules/hira-edi/hira-edi.service';
import {
  HIRA_CHANNEL,
  HIRA_SUBMITTABLE_STATUSES,
  canRegenerateHiraDocument,
  classifyHiraTransmission,
  localReceiptNo,
  transmitToHira,
} from '../../src/modules/hira-edi/hira-transmission';

const SRC_DIR = join(__dirname, '../../src/modules/hira-edi');

describe('🔴 W8 R3 C1 — 전송 채널', () => {
  it('심평원 전송은 아직 구현되지 않았다(구현되면 이 가드를 함께 갱신할 것)', async () => {
    expect(HIRA_CHANNEL.implemented).toBe(false);
    const r = await transmitToHira({});
    expect(r.outcome).toBe('NOT_TRANSMITTED');
    expect(r.at).toBeUndefined();       // 모르는 시각을 만들어내지 않는다
    expect(r.externalRef).toBeUndefined();
  });

  it('원내 접수번호는 기관 부여가 아님을 접두어로 드러낸다', () => {
    expect(localReceiptNo()).toMatch(/^LOCAL-HIRA-/);
  });

  it('③ 서비스 어디에도 무조건 SUBMITTED 를 적는 코드가 없다', () => {
    const src = readFileSync(join(SRC_DIR, 'hira-edi.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 원 결함을 기록한 주석은 판정에서 제외
      .replace(/\/\/.*$/gm, '');
    // 종전: `data: { status: 'SUBMITTED', submittedAt: new Date() }`
    expect(src).not.toMatch(/status:\s*['"]SUBMITTED['"]/);
    // SUBMITTED 는 전송 성공(outcome==='SENT') 분기에서만 쓰인다
    expect(src).toMatch(/HIRA_DOC_STATUS\.SUBMITTED/);
  });
});

describe('🔴 W8 R3 C1 — 읽는 쪽 판정(저장값 변조 없음)', () => {
  it('운영에 남은 status=SUBMITTED 는 "전송 근거 없음"으로 읽힌다', () => {
    const t = classifyHiraTransmission({ status: 'SUBMITTED', submittedAt: new Date(), receiptNo: null });
    expect(t.transmitted).toBe(false);
    expect(t.state).toBe('UNVERIFIED');
    expect(t.label).not.toContain('완료');
  });

  it('LOCAL_RECORDED 는 "원내 접수(미전송)"이고 수기 조치 안내를 함께 준다', () => {
    const t = classifyHiraTransmission({ status: 'LOCAL_RECORDED', submittedAt: null, receiptNo: 'LOCAL-HIRA-XYZ' });
    expect(t.transmitted).toBe(false);
    expect(t.label).toBe('원내 접수(미전송)');
    expect(t.note).toContain('요양기관업무포털');
  });

  it('심사결과(ACCEPTED)도 연동 미구축인 동안 시스템 전송 근거로 치지 않는다', () => {
    const t = classifyHiraTransmission({ status: 'ACCEPTED', submittedAt: null, receiptNo: null });
    expect(t.transmitted).toBe(false);
    expect(t.label).toContain('수기');
  });

  it('미전송 건은 재제출·재생성이 열려 있다(영구 미청구 방지)', () => {
    expect(HIRA_SUBMITTABLE_STATUSES).toContain('LOCAL_RECORDED');
    expect(HIRA_SUBMITTABLE_STATUSES).toContain('SEND_FAILED');
    expect(canRegenerateHiraDocument('LOCAL_RECORDED')).toBe(true);
    expect(canRegenerateHiraDocument('SUBMITTED')).toBe(true);   // 전송 근거가 없으므로 정정 허용
    expect(canRegenerateHiraDocument('ACCEPTED')).toBe(false);   // 심사결과는 사람 판단 영역
  });
});

describe('🔴 W8 R3 C1 — submitDocument 는 전송을 흉내내지 않는다', () => {
  let svc: HiraEdiService;
  let prisma: {
    hiraClaimDocument: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prisma = {
      hiraClaimDocument: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'he-1', status: 'VALIDATED', claimId: 'c-1', createdBy: 'u-1',
          submittedAt: null, ediData: { totals: { total: 250000, insurance: 175000, patient: 75000 } },
        }),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'he-1', ...data })),
      },
    };
    svc = new HiraEdiService(prisma as never);
  });

  it('③ 상태는 LOCAL_RECORDED · submittedAt 은 null · 접수번호는 LOCAL- 접두어', async () => {
    const r = await svc.submitDocument('he-1');
    const data = prisma.hiraClaimDocument.update.mock.calls[0][0].data;

    expect(data.status).toBe('LOCAL_RECORDED');
    expect(data.status).not.toBe('SUBMITTED');
    expect(data.submittedAt).toBeNull();          // 🔴 모르는 시각을 원장에 박지 않는다
    expect(data.ediData.transmission.outcome).toBe('NOT_TRANSMITTED');
    expect(data.ediData.transmission.receiptNo).toMatch(/^LOCAL-HIRA-/);
    expect(data.ediData.transmission.note).toContain('[미전송]');
    // 기존 명세 내용(totals)은 그대로 보존된다
    expect(data.ediData.totals.insurance).toBe(175000);

    expect(r.transmission.transmitted).toBe(false);
    expect(r.transmission.label).toBe('원내 접수(미전송)');
  });

  it('③ 이미 원내 접수된 건도 다시 제출을 시도할 수 있다', async () => {
    prisma.hiraClaimDocument.findUnique.mockResolvedValue({
      id: 'he-1', status: 'LOCAL_RECORDED', claimId: 'c-1', createdBy: 'u-1', submittedAt: null, ediData: {},
    });
    await expect(svc.submitDocument('he-1')).resolves.toBeDefined();
  });

  it('③ 검증 전(DRAFT) 제출은 여전히 거부된다', async () => {
    prisma.hiraClaimDocument.findUnique.mockResolvedValue({
      id: 'he-1', status: 'DRAFT', claimId: 'c-1', createdBy: 'u-1', submittedAt: null, ediData: {},
    });
    await expect(svc.submitDocument('he-1')).rejects.toThrow(/검증/);
  });
});
