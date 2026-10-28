/**
 * 동의서 서명 앵커는 문안에 묶인다(2026-10-13 결함 발굴 B3).
 *  · 🔴 종전 앵커 = sha256(`CONSENT|id|역할|서명자|시각`) — 환자가 본 위험·대안·설명이 앵커에 없었다
 *  · 이제 동의서 내용 해시(전자서명 정본 · A2)를 서명 사건 해시에 넣고, 서명 문서 해시도 내용 해시로 시작한다
 *  · 대조군: 같은 문안·같은 사건 입력이면 같은 내용 해시 / 문안이 바뀌면 앵커가 바뀐다
 */
import { describe, it, expect, vi } from 'vitest';
import { ConsentService } from '../../src/modules/consent/consent.service';
import { signedContentHash } from '../../src/modules/document-sign/document-content-hash';

const CONSENT = (risks: string) => ({ id: 'c1', patientId: 'p1', type: 'SURGERY', consentType: 'SURGERY', templateId: null, templateName: '수술 동의서', content: { sections: [] }, risks, alternatives: '약물 치료', explanation: null, encounterId: null, surgeryId: null, doctorId: 'd1', expiresAt: null, status: 'PENDING' });
function mk(risks: string) {
  const anchors: any[] = []; const docs: any[] = [];
  const prisma: any = {
    consentForm: { findUnique: vi.fn().mockResolvedValue(CONSENT(risks)) },
    signedDocument: {
      findFirst: vi.fn(async () => docs[0] ?? null),
      create: vi.fn(async ({ data }: any) => { const d = { id: 'sd1', ...data }; docs.push(d); return d; }),
      update: vi.fn(async ({ data }: any) => ({ ...docs[0], completedSigners: 1, requiredSigners: 2, ...data })),
    },
    blockchainAnchor: { create: vi.fn(async ({ data }: any) => { anchors.push(data); return data; }) },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  return { svc: new ConsentService(prisma) as any, prisma, anchors, docs };
}

describe('🔴 동의서 서명 앵커 — 문안이 들어간다', () => {
  it('서명 문서 해시 = 동의서 내용 해시 · 앵커 해시는 내용에 따라 달라진다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
    const a = mk('출혈·감염');
    await a.svc.anchorConsentSignature('c1', 'p1', 'PATIENT', undefined, 'p1');
    const content = await signedContentHash(a.prisma, 'CONSENT', 'c1');
    expect(a.docs[0].documentHash).toBe(content!.hash);
    const b = mk('출혈·감염·사망');
    await b.svc.anchorConsentSignature('c1', 'p1', 'PATIENT', undefined, 'p1');
    expect(b.anchors[0].dataHash).not.toBe(a.anchors[0].dataHash); // 같은 사람·같은 시각이어도 문안이 다르면 다르다
    const c = mk('출혈·감염');
    await c.svc.anchorConsentSignature('c1', 'p1', 'PATIENT', undefined, 'p1');
    expect(c.anchors[0].dataHash).toBe(a.anchors[0].dataHash); // 대조군 — 같은 문안·같은 사건이면 같다
    vi.useRealTimers();
  });
});
