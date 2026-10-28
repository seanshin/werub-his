/**
 * 입퇴원확인서는 입원 원장의 날짜를 싣는다(2026-10-13 결함 발굴 B7).
 *  · 🔴 종전: 스냅샷·양식 어디에도 입원일·퇴원일이 없었다(실손 번들 구성 서류) · 진단서 문구로 나갔다
 *  · 입원이 하나면 그것 · 여럿이면 골라야(400) · 다른 환자의 입원 400 · 발급 스냅샷에 그 입원
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { IssuanceService } from '../../src/modules/medical-record-issuance/issuance.service';

const ADM = { id: 'adm-1', admitDate: new Date('2026-10-01T01:00:00Z'), dischargeDate: new Date('2026-10-05T02:00:00Z') };
function mk(admissions: unknown[]) {
  const created: any[] = [];
  const prisma: any = {
    documentRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', type: 'ADMISSION_CERT', patientId: 'p1', status: 'REQUESTED', issuedDocumentId: null, purpose: '실손' }), update: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'DOCTOR' }) },
    admission: { findMany: vi.fn(async ({ where }: any) => (admissions as any[]).filter((a) => !where.id || a.id === where.id).slice(0, 2)) },
    issuanceArtifact: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: any) => { created.push(data); return data; }), update: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  const svc = new IssuanceService(prisma, {} as never, { safeLog: vi.fn() } as never, { emit: vi.fn() } as never);
  return { svc, created };
}
const code = async (p: Promise<unknown>) => ((await p.catch((x) => x)) as BadRequestException).getResponse() as { code: string };

describe('🔴 입퇴원확인서 — 입원 원장', () => {
  it('입원이 하나면 그 입원의 입원·퇴원 일자가 작성본에 · 근거 = 그 입원', async () => {
    const { svc, created } = mk([ADM]);
    await svc.authorCertificate('r1', { diagnoses: [] }, 'doc');
    expect(created[0].authoredJson.admission).toEqual({ admissionId: 'adm-1', admitDate: ADM.admitDate, dischargeDate: ADM.dischargeDate });
    expect(created[0].sourceIds).toEqual(['adm-1']);
  });
  it('입원이 여럿이면 골라야 · 없으면 · 다른 환자 입원이면 400', async () => {
    expect((await code(mk([ADM, { ...ADM, id: 'adm-2' }]).svc.authorCertificate('r1', {}, 'doc'))).code).toBe('ADMISSION_REQUIRED');
    expect((await code(mk([]).svc.authorCertificate('r1', {}, 'doc'))).code).toBe('ADMISSION_REQUIRED');
    expect((await code(mk([ADM]).svc.authorCertificate('r1', { admissionId: 'other' }, 'doc'))).code).toBe('ADMISSION_INVALID');
  });
  it('대조군 — 여럿이어도 고르면 그 입원', async () => {
    const { svc, created } = mk([ADM, { ...ADM, id: 'adm-2', dischargeDate: null }]);
    await svc.authorCertificate('r1', { admissionId: 'adm-2' }, 'doc');
    expect(created[0].authoredJson.admission).toMatchObject({ admissionId: 'adm-2', dischargeDate: null });
  });
});

describe('발급 스냅샷', () => {
  it('🔴 증명서 발급 스냅샷이 작성본의 입원을 싣는다(구조 — 발급 경로는 issuance.service.spec 이 실서비스로 잰다)', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/medical-record-issuance/issuance.service.ts'), 'utf8');
    const block = src.slice(src.indexOf('private async issueBGroup'), src.indexOf('const docType = B_GROUP[req.type].docType;'));
    expect(block).toContain('...(a.admission ? { admission: a.admission } : {})');
  });
});

