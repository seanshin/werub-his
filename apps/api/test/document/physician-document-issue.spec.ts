/**
 * 의사 발급 문서(2026-10-13 결함 발굴 A4 · 의료법 §17).
 *  · 🔴 종전: 진단서가 범용 발급 EP(간호사·원무 포함)로 의사 서명 없이 발급 · 서명 의사 이름·진단은 화면이 보낸 값 ·
 *    발병일을 진료일로 채움 · 발급일 = 진료 서명일
 *  · 이제: 발급자 = 의사(아니면 403) · 서명 의사·면허 = 발급한 의사 본인 · 진단·진단일 = 서명된 진료기록 원장 ·
 *    환자 일치 · 발병일은 입력한 것만 · 발급일 = 서버 시각 · 해시 = 서버가 고쳐 쓴 판
 *  · 대조군: 의사 발급 문서가 아닌 종류(검사 성적서)는 화면 스냅샷 그대로 · 출생증명서는 조산사도 교부(§17②) → 막지 않는다
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { isPhysicianIssuedDocumentType } from '@hospital-run/shared';
import { DocumentService } from '../../src/modules/document/document.service';

const ENC = { patientId: 'p1', status: 'SIGNED', signedAt: new Date('2026-10-12T05:00:00Z'), createdAt: new Date('2026-10-12T01:00:00Z'), diagnoses: [{ diagnosisCode: { code: 'J00', nameKo: '급성 비인두염' } }] };
function mk(role = 'DOCTOR', enc: unknown = ENC) {
  const create = vi.fn(async ({ data }: any) => ({ ...data, issuedAt: new Date() }));
  const prisma: any = {
    user: { findUnique: vi.fn().mockResolvedValue({ role, familyName: '김', givenName: '의사' }) },
    staff: { findUnique: vi.fn().mockResolvedValue({ licenseNumber: '12345' }) },
    encounter: { findUnique: vi.fn().mockResolvedValue(enc) },
    issuedDocument: { aggregate: vi.fn().mockResolvedValue({ _max: { seq: 0 } }), create },
  };
  const svc = new DocumentService(prisma);
  vi.spyOn(svc as any, 'qrDataUrl').mockResolvedValue('data:');
  return { svc, create };
}
const forged = { patient: { name: '환자' }, doctor: { name: '다른 의사', license: '99999' }, diagnoses: [{ kcdCode: 'C34', name: '폐암' }], onsetDate: '', purpose: '보험', issuedAt: '2020-01-01' };
const dto = (over: Record<string, unknown> = {}) => ({ documentType: 'CERTIFICATE', sourceId: 'enc-1', patientId: 'p1', snapshot: forged, ...over });

describe('🔴 진단서 — 의사만 · 내용은 원장에서', () => {
  it('간호사·원무 발급 → 403 PHYSICIAN_DOCUMENT_ROLE · 아무것도 남기지 않는다', async () => {
    for (const role of ['NURSE', 'RECEPTIONIST', 'MEDICAL_RECORDS', 'ADMIN']) {
      const { svc, create } = mk(role);
      const e = await svc.issue(dto() as never, 'u1').catch((x) => x);
      expect(e, role).toBeInstanceOf(ForbiddenException);
      expect(create).not.toHaveBeenCalled();
    }
  });
  it('🔴 화면이 보낸 서명 의사·진단·발급일을 쓰지 않는다 — 발급한 의사·서명된 진료기록 진단·서버 시각 · 해시는 그 판', async () => {
    const { svc, create } = mk();
    const r = await svc.issue(dto() as never, 'u1');
    const snap = create.mock.calls[0][0].data.snapshotJson;
    expect(snap.doctor).toEqual({ name: '김의사', license: '12345' });
    expect(snap.diagnoses).toEqual([{ kcdCode: 'J00', name: '급성 비인두염' }]);
    expect(snap.diagnosedDate).toBe(ENC.createdAt.toISOString());
    expect(snap.issuedAt).not.toBe('2020-01-01');
    expect(snap.onsetDate).toBeNull(); // 입력 안 한 발병일을 진료일로 채우지 않는다
    expect(snap.purpose).toBe('보험'); // 화면 입력은 그대로
    expect(create.mock.calls[0][0].data.hash).toBe(createHash('sha256').update(JSON.stringify(snap)).digest('hex'));
    expect((r as { snapshot: unknown }).snapshot).toEqual(snap);
  });
  it('서명 안 된 진료기록 → 409 · 다른 환자 → 400', async () => {
    expect(await mk('DOCTOR', { ...ENC, status: 'DRAFT', signedAt: null }).svc.issue(dto() as never, 'u1').catch((x) => x)).toBeInstanceOf(ConflictException);
    expect(await mk().svc.issue(dto({ patientId: 'p2' }) as never, 'u1').catch((x) => x)).toBeInstanceOf(BadRequestException);
  });
  it('대조군 — 검사 성적서는 화면 스냅샷 그대로(간호사도) · 출생증명서는 의사 전용이 아니다', async () => {
    const { svc, create } = mk('NURSE');
    await svc.issue({ documentType: 'LAB_REPORT', sourceId: 'x', snapshot: { a: 1 } } as never, 'u1');
    expect(create.mock.calls[0][0].data.snapshotJson).toEqual({ a: 1 });
    expect(isPhysicianIssuedDocumentType('BIRTH_CERT')).toBe(false);
    expect(['CERTIFICATE', 'OPINION', 'DEATH_CERT'].every(isPhysicianIssuedDocumentType)).toBe(true);
  });
});

describe('🔴 (v4.82 회귀 봉합) 서류 발급 업무 — 의사가 작성·서명한 판을 원무·의무기록이 발급', () => {
  const userBy = (roles: Record<string, string>) => vi.fn(async ({ where }: { where: { id: string } }) => ({ role: roles[where.id], familyName: '김', givenName: '의사' }));
  it('서명 의사가 의사면 발급자가 원무여도 발급 · 스냅샷은 서버가 만든 그대로(진료기록을 찾지 않는다)', async () => {
    const { svc, create } = mk('RECEPTIONIST', null);
    (svc as any).prisma.user.findUnique = userBy({ clerk: 'RECEPTIONIST', doc: 'DOCTOR' });
    const snap = { doctor: { name: '김의사', license: '1' }, diagnoses: [{ kcdCode: 'J00' }] };
    await svc.issue({ documentType: 'CERTIFICATE', sourceId: 'req-1', patientId: 'p1', snapshot: snap } as never, 'clerk', { preSigned: { signerUserId: 'doc' } });
    expect(create.mock.calls[0][0].data.snapshotJson).toEqual(snap);
  });
  it('서명자가 의사가 아니면 403 · 대조군: 범용 EP 경로(preSigned 없음)는 발급자 기준 그대로', async () => {
    const { svc, create } = mk('RECEPTIONIST');
    (svc as any).prisma.user.findUnique = userBy({ clerk: 'RECEPTIONIST', nurse: 'NURSE' });
    expect(await svc.issue({ documentType: 'OPINION', sourceId: 'r', snapshot: {} } as never, 'clerk', { preSigned: { signerUserId: 'nurse' } }).catch((x) => x)).toBeInstanceOf(ForbiddenException);
    expect(await svc.issue({ documentType: 'OPINION', sourceId: 'r', snapshot: {} } as never, 'clerk').catch((x) => x)).toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });
  it('구조 가드 — 서류 발급 업무의 증명서 발급은 서명 의사를 넘긴다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/medical-record-issuance/issuance.service.ts'), 'utf8');
    expect(src).toMatch(/documentType: docType[\s\S]{0,300}preSigned: \{ signerUserId: signerId \}/);
  });
});

