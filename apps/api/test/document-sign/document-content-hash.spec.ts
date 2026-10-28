/**
 * 전자서명은 문서 **내용**에 묶인다(2026-10-13 결함 발굴 A2).
 *  · 🔴 종전: 서명 모달이 `${종류}:${id}:${제목}` 을 해시해 서명 → 서버는 같은 요청의 해시로 검증해 VERIFIED.
 *    SOAP 를 바꿔도, 다른 환자의 같은 제목 문서여도 "검증됨"이었다.
 *  · 이제 해시는 서버가 원장에서 계산한다 — 서명 EP·임상 서명 경로가 대조 · 검증은 "지금 내용과 맞는가"를 따로 말한다
 *  · 정규화: 키 순서·자식 행 재생성(id 변경)·서명 행위 칸(상태·서명 시각)에 흔들리지 않는다 · 내용이 바뀌면 바뀐다
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { signedContentHash, canonicalJson } from '../../src/modules/document-sign/document-content-hash';
import { DocumentSignService } from '../../src/modules/document-sign/document-sign.service';
import { DocumentSignController } from '../../src/modules/document-sign/document-sign.controller';
import { recordBlockchainSignature } from '../../src/common/util/blockchain-signature';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const E = '00000000-0000-4000-a000-0000000000e1';
const enc = (over: Record<string, unknown> = {}, dx: Array<Record<string, unknown>> = [{ id: 'dx-1', encounterId: E, diagnosisCodeId: 'J00', type: 'PRIMARY', rank: 1, certainty: 'CONFIRMED', onsetDate: null, notes: null }]) => ({
  id: E, patientId: 'p1', doctorId: 'd1', appointmentId: null, admissionId: null, visitType: 'OUTPATIENT',
  subjective: '기침 3일', objective: null, assessment: '감기', plan: '대증 치료', chiefComplaint: null, historyPresentIllness: null,
  pastMedicalHistory: null, familyHistory: null, socialHistory: null, reviewOfSystems: null, physicalExamination: null,
  status: 'DRAFT', signedAt: null, signedBy: null, createdAt: new Date('2026-10-13T00:00:00Z'), updatedAt: new Date('2026-10-13T00:00:00Z'),
  pregnancyStatus: null, eligibilityCheckId: null, aiScribed: false, scribeSessionId: null, aiEditDistance: null,
  diagnoses: dx, ...over,
});
const prismaWith = (row: unknown) => ({ encounter: { findUnique: vi.fn().mockResolvedValue(row) } }) as never;
const hashOf = async (row: unknown) => (await signedContentHash(prismaWith(row), 'ENCOUNTER', E))!.hash;

describe('내용 해시 정규화', () => {
  it('키 순서와 무관 · Date 는 ISO', () => {
    expect(canonicalJson({ b: 1, a: new Date('2026-01-01T00:00:00Z') })).toBe(canonicalJson({ a: new Date('2026-01-01T00:00:00Z'), b: 1 }));
  });
  it('🔴 내용이 바뀌면 해시가 바뀐다 — SOAP 한 글자 · 진단 하나', async () => {
    const h = await hashOf(enc());
    expect(await hashOf(enc({ plan: '대증 치료.' }))).not.toBe(h);
    expect(await hashOf(enc({}, [{ id: 'dx-1', encounterId: E, diagnosisCodeId: 'J01', type: 'PRIMARY', rank: 1, certainty: 'CONFIRMED', onsetDate: null, notes: null }]))).not.toBe(h);
  });
  it('대조군 — 서명 행위 칸(상태·서명 시각·수정 시각)·진단 행 재생성(id)은 해시를 바꾸지 않는다', async () => {
    const h = await hashOf(enc());
    expect(await hashOf(enc({ status: 'SIGNED', signedAt: new Date(), signedBy: 'd1', updatedAt: new Date(), aiEditDistance: 3 }))).toBe(h);
    expect(await hashOf(enc({}, [{ id: 'dx-NEW', encounterId: E, diagnosisCodeId: 'J00', type: 'PRIMARY', rank: 1, certainty: 'CONFIRMED', onsetDate: null, notes: null }]))).toBe(h);
  });
  it('🔴 종류 밖·문서 없음은 지어내지 않는다(null)', async () => {
    expect(await signedContentHash(prismaWith(enc()), 'MYSTERY', E)).toBeNull();
    expect(await signedContentHash(prismaWith(null), 'ENCOUNTER', E)).toBeNull();
  });
  it('퇴원요약 — 입원 id 로 물어도 요약 id 를 정본으로 돌려준다(종전: 모달=입원 id·서버=요약 id 로 갈림)', async () => {
    const ds = { id: 'ds-1', admissionId: 'adm-1', hospitalCourse: 'x', status: 'DRAFT' };
    const prisma = {
      dischargeSummary: { findUnique: vi.fn(async ({ where }: { where: { id?: string; admissionId?: string } }) => (where.admissionId === 'adm-1' || where.id === 'ds-1' ? ds : null)) },
      admission: { findUnique: vi.fn().mockResolvedValue({ patientId: 'p9' }) },
    } as never;
    const a = await signedContentHash(prisma, 'DISCHARGE_SUMMARY', 'adm-1');
    const b = await signedContentHash(prisma, 'DISCHARGE_SUMMARY', 'ds-1');
    expect(a).toMatchObject({ documentId: 'ds-1', patientId: 'p9' });
    expect(a!.hash).toBe(b!.hash);
  });
});

/* ── 서명 경로 — 실제 WebCrypto 서명으로 ── */
let pem = '';
let ecSign: (h: string) => Promise<string>;
beforeAll(async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const b64 = Buffer.from(await webcrypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
  pem = `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----`;
  ecSign = async (h) => Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Uint8Array.from(Buffer.from(h, 'hex')))).toString('base64');
});
const CERT = () => ({ id: 'cert-1', ownerType: 'STAFF', userId: 'u1', patientId: null, status: 'ACTIVE', issuedAt: new Date('2026-01-01'), expiresAt: new Date('2099-01-01'), revokedAt: null, algorithm: 'ECDSA-P256', publicKey: pem, serialNumber: 'S', fingerprint: 'f' });
/** 종전 모달이 서명하던 것 */
const TITLE_HASH = createHash('sha256').update(`ENCOUNTER:${E}:진료 기록`).digest('hex');

function world(row = enc()) {
  const docs: any[] = []; const sigs: any[] = [];
  const p: any = {
    encounter: { findUnique: vi.fn().mockResolvedValue(row) },
    blockchainCertificate: { findUnique: vi.fn().mockResolvedValue(CERT()) },
    signedDocument: {
      findFirst: vi.fn(async ({ where }: any) => docs.find((d) => d.documentType === where.documentType && d.documentId === where.documentId) ?? null),
      findUnique: vi.fn(async ({ where }: any) => { const d = docs.find((x) => x.id === where.id); return d ? { ...d, signatures: sigs.filter((s) => s.signedDocumentId === d.id).map((s) => ({ ...s, certificate: CERT() })) } : null; }),
      create: vi.fn(async ({ data }: any) => { const d = { id: `sd-${docs.length + 1}`, completedSigners: 0, requiredSigners: 1, ...data }; docs.push(d); return d; }),
      update: vi.fn(async ({ where, data }: any) => { const d = docs.find((x) => x.id === where.id); if (data.completedSigners?.increment) d.completedSigners += 1; else Object.assign(d, data); return { ...d, signatures: [] }; }),
    },
    documentSignature: {
      create: vi.fn(async ({ data }: any) => { const s = { id: `sig-${sigs.length + 1}`, isValid: true, ...data }; sigs.push(s); return s; }),
      findFirst: vi.fn(async ({ where }: any) => sigs.find((s) => s.signedDocumentId === where.signedDocumentId && s.certificateId === where.certificateId && s.signatureValue === where.signatureValue) ?? null),
      count: vi.fn(async ({ where }: any) => sigs.filter((s) => s.signedDocumentId === where.signedDocumentId).length),
      updateMany: vi.fn(),
    },
  };
  p.$transaction = vi.fn(async (fn: any) => fn(p));
  return { p, docs, sigs };
}
const body = (hash: string, signatureValue: string) => ({ documentType: 'ENCOUNTER', documentId: E, documentHash: hash, certificateId: 'cert-1', signatureValue, signatureAlgorithm: 'ECDSA-P256', signerRole: 'PRIMARY', signerType: 'STAFF' });

describe('🔴 서명 EP — 서명한 해시가 문서 내용이어야 한다', () => {
  it('제목 문자열 해시(종전 모달)에 한 실서명 → 409 SIGN_HASH_NOT_CONTENT · 기록 0', async () => {
    const { p, sigs } = world();
    const e = await new DocumentSignService(p).sign(body(TITLE_HASH, await ecSign(TITLE_HASH)), { userId: 'u1' }).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({ code: 'SIGN_HASH_NOT_CONTENT' });
    expect(sigs).toHaveLength(0);
  });
  it('종류 밖 → 400 SIGN_DOCUMENT_TYPE_UNSUPPORTED', async () => {
    const { p } = world();
    const e = await new DocumentSignService(p).sign({ ...body(TITLE_HASH, 'x'), documentType: 'MYSTERY' }, { userId: 'u1' }).catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'SIGN_DOCUMENT_TYPE_UNSUPPORTED' });
  });
  it('대조군 — 서버 내용 해시에 한 서명은 기록 · 검증 시 내용 MATCH · 내용이 바뀌면 MISMATCH', async () => {
    const { p, docs } = world();
    const svc = new DocumentSignService(p);
    const c = await svc.contentOrThrow('ENCOUNTER', E);
    const r = await svc.sign(body(c.hash, await ecSign(c.hash)), { userId: 'u1' });
    expect(r.signature.verification).toBe('VERIFIED');
    expect((await svc.verify(docs[0].id)).contentState).toBe('MATCH');
    p.encounter.findUnique.mockResolvedValue(enc({ plan: '서명 뒤 바꾼 계획' }));
    const v = await svc.verify(docs[0].id);
    expect(v.contentState).toBe('MISMATCH');
    expect(v.signatures[0].verification).toBe('VERIFIED'); // 서명값은 그 해시에 대해 여전히 맞다 — 내용 대조는 따로 말한다
  });
});

describe('🔴 임상 서명 경로(recordBlockchainSignature)', () => {
  it('제목 문자열 해시에 한 실서명 → false · 기록 0', async () => {
    const { p, sigs } = world();
    const ok = await recordBlockchainSignature(p, { certificateId: 'cert-1', signatureValue: await ecSign(TITLE_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: TITLE_HASH }, { documentType: 'ENCOUNTER', documentId: E, signerUserId: 'u1' });
    expect(ok).toBe(false);
    expect(sigs).toHaveLength(0);
  });
  it('대조군 — 내용 해시 서명은 기록 · 모달이 먼저 기록한 같은 서명은 내용이 그 뒤 저장으로 흔들려도 이중 기록 없이 통과', async () => {
    const { p, sigs } = world();
    const svc = new DocumentSignService(p);
    const c = await svc.contentOrThrow('ENCOUNTER', E);
    const sv = await ecSign(c.hash);
    await svc.sign(body(c.hash, sv), { userId: 'u1' });
    p.encounter.findUnique.mockResolvedValue(enc({ status: 'SIGNED', signedAt: new Date() }));
    const ok = await recordBlockchainSignature(p, { certificateId: 'cert-1', signatureValue: sv, signatureAlgorithm: 'ECDSA-P256', documentHash: c.hash }, { documentType: 'ENCOUNTER', documentId: E, signerUserId: 'u1' });
    expect(ok).toBe(true);
    expect(sigs).toHaveLength(1);
  });
});

describe('내용 해시 EP', () => {
  it('서명할 수 있는 역할 = 서명 EP 역할 · 검사 담당 포함(작업지 서명)', () => {
    const a = Reflect.getMetadata(ROLES_KEY, DocumentSignController.prototype.contentHash);
    const b = Reflect.getMetadata(ROLES_KEY, DocumentSignController.prototype.sign);
    expect(a).toEqual(b);
    expect(a).toContain('LAB_TECH');
  });
});
