import { describe, it, expect, vi } from 'vitest';
import { NursingService } from '../../src/modules/nursing/nursing.service';

/**
 * 고위험약 **독립 이중확인(IPSG.3)** 서버 동작 — 2026-08-18.
 *
 * 🔴 재현된 결함: BE 로직은 견고했으나 화면 4곳이 `verifiedBy` 를 보내지 않아 전건 우회됐고,
 *    우회 표식은 notes 에만 남아 아무 화면에도 뜨지 않았다.
 *    여기서는 서버 쪽 두 가지를 못박는다 —
 *      ① **적용 범위를 좁혔다는 것**(모든 고위험약이 아니다 — 전부에 걸면 형식화된다)
 *      ② **우회는 허용하되 사유·표식이 반드시 남고 응답으로 되돌아온다**(보이지 않는 우회 금지)
 */

const build = (opts: {
  highAlertFlag?: boolean;
  highAlertCategory?: string | null;
  rxRoute?: string | null;
  gate?: string | null;
  verifierOk?: boolean;
}) => {
  const mockPrisma: any = {
    medicationAdministration: {
      findUnique: vi.fn()
        .mockResolvedValueOnce({
          id: 'mar-1', status: 'SCHEDULED', patientId: 'p-1', route: opts.rxRoute ?? 'IV',
          patient: { mrn: 'P2026-0001' },
          prescription: {
            status: 'ACTIVE',
            route: opts.rxRoute ?? null,
            medicationCode: {
              highAlertFlag: opts.highAlertFlag ?? true,
              highAlertCategory: opts.highAlertCategory ?? null,
              nameKo: '테스트약', barcode: 'B1', code: 'C1',
            },
          },
        })
        .mockResolvedValue({ id: 'mar-1', status: 'ADMINISTERED' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(
        opts.verifierOk === false ? null : { id: 'n-2', isActive: true, accountStage: 'ACTIVE', role: 'NURSE' },
      ),
    },
  };
  const svc = new NursingService(
    mockPrisma, undefined,
    { get: vi.fn(async (k: string) => (k === 'nursing.highAlertDoubleCheck' ? (opts.gate ?? null) : null)) } as any,
  );
  return { svc, mockPrisma };
};

const notesOf = (mockPrisma: any) => String(mockPrisma.medicationAdministration.updateMany.mock.calls[0][0].data.notes ?? '');

describe('적용 범위 — 모든 고위험약에 걸지 않는다', () => {
  it('경구 마약성 진통제는 이중확인을 요구하지 않는다(BLOCK 게이트에서도 통과)', async () => {
    const { svc, mockPrisma } = build({ highAlertCategory: 'OPIOID', rxRoute: 'PO', gate: 'BLOCK' });
    const r: any = await svc.administerMed('mar-1', { dose: '5mg', route: 'PO' }, 'n-1');
    expect(r.status).toBe('ADMINISTERED');
    expect(r.doubleCheck.required).toBe(false);
    expect(notesOf(mockPrisma)).not.toContain('IPSG3-DOUBLECHECK-BYPASS');
  });

  it('같은 약이라도 정맥 투여면 요구한다', async () => {
    const { svc } = build({ highAlertCategory: 'OPIOID', rxRoute: 'IV', gate: 'BLOCK' });
    await expect(svc.administerMed('mar-1', { dose: '5mg', route: 'IV' }, 'n-1'))
      .rejects.toMatchObject({ response: { code: 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED' } });
  });

  it('항암제는 경구여도 요구한다(ISMP 상시 목록)', async () => {
    const { svc } = build({ highAlertCategory: 'CHEMOTHERAPY', rxRoute: 'PO', gate: 'BLOCK' });
    await expect(svc.administerMed('mar-1', { dose: '1T', route: 'PO' }, 'n-1'))
      .rejects.toMatchObject({ response: { code: 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED' } });
  });

  it('고위험이 아닌 약은 아무것도 요구하지 않는다', async () => {
    const { svc } = build({ highAlertFlag: false, rxRoute: 'IV', gate: 'BLOCK' });
    const r: any = await svc.administerMed('mar-1', { dose: '1T', route: 'IV' }, 'n-1');
    expect(r.doubleCheck.required).toBe(false);
  });
});

describe('우회 — 막지 않되 반드시 보이게', () => {
  it('사유를 보내면 표식·응답에 그 사유가 남는다', async () => {
    const { svc, mockPrisma } = build({ highAlertCategory: 'INSULIN', rxRoute: 'SC' });
    const r: any = await svc.administerMed(
      'mar-1',
      { dose: '10U', route: 'SC', doubleCheckBypassReason: '단독 근무 — 2차 확인 간호사 부재' },
      'n-1',
    );
    expect(r.status).toBe('ADMINISTERED');
    expect(r.doubleCheck).toMatchObject({ required: true, satisfied: false, bypassed: true, bypassReason: '단독 근무 — 2차 확인 간호사 부재' });
    expect(notesOf(mockPrisma)).toContain('reason=단독 근무 — 2차 확인 간호사 부재');
    // 사유를 냈으므로 '미기재' 경고는 없다
    expect((r.warnings ?? []).join(' ')).not.toContain('미기재');
  });

  it('사유 미기재를 "사유 있음"으로 위장하지 않는다', async () => {
    const { svc, mockPrisma } = build({ highAlertCategory: 'INSULIN', rxRoute: 'SC' });
    const r: any = await svc.administerMed('mar-1', { dose: '10U', route: 'SC' }, 'n-1');
    expect(r.doubleCheck.bypassReason).toBe('미기재');
    expect(notesOf(mockPrisma)).toContain('reason=미기재');
    expect((r.warnings ?? []).join(' ')).toContain('미기재');
  });

  it('유효한 확인 간호사가 있으면 우회 표식이 남지 않는다', async () => {
    const { svc, mockPrisma } = build({ highAlertCategory: 'INSULIN', rxRoute: 'SC' });
    const r: any = await svc.administerMed('mar-1', { dose: '10U', route: 'SC', verifiedBy: 'n-2' }, 'n-1');
    expect(r.doubleCheck).toMatchObject({ required: true, satisfied: true, bypassed: false, verifiedBy: 'n-2' });
    expect(notesOf(mockPrisma)).not.toContain('IPSG3-DOUBLECHECK-BYPASS');
    expect(mockPrisma.medicationAdministration.updateMany.mock.calls[0][0].data.verifiedBy).toBe('n-2');
  });

  it('자가서명은 우회로 기록된다(확인자 = 투약자)', async () => {
    const { svc, mockPrisma } = build({ highAlertCategory: 'INSULIN', rxRoute: 'SC' });
    const r: any = await svc.administerMed('mar-1', { dose: '10U', route: 'SC', verifiedBy: 'n-1' }, 'n-1');
    expect(r.doubleCheck.satisfied).toBe(false);
    expect(notesOf(mockPrisma)).toContain('IPSG3-DOUBLECHECK-BYPASS');
    expect(mockPrisma.medicationAdministration.updateMany.mock.calls[0][0].data.verifiedBy).toBeNull();
  });
});

describe('BCMA 팔찌 — 발급 정본 파서와 통일', () => {
  const patientScan = async (raw: string) => {
    const { svc } = build({ highAlertFlag: false, rxRoute: 'PO' });
    return svc.administerMed('mar-1', { dose: '1T', route: 'PO', patientBandScan: raw, medScan: 'B1' }, 'n-1');
  };

  it('구 형식 팔찌(JSON)도 통과한다 — 이미 인쇄돼 병동에 도는 것', async () => {
    const r: any = await patientScan('{"t":"PATIENT","mrn":"P2026-0001","n":"홍길동"}');
    expect(r.status).toBe('ADMINISTERED');
  });

  it('구 포털 접두(HRPT:)도 통과한다', async () => {
    const r: any = await patientScan('HRPT:P2026-0001');
    expect(r.status).toBe('ADMINISTERED');
  });

  it('순수 MRN(발급 정본)도 통과한다', async () => {
    const r: any = await patientScan('p2026-0001');
    expect(r.status).toBe('ADMINISTERED');
  });

  it('진짜 다른 환자는 여전히 차단한다(관대하게 받되 대조는 엄격)', async () => {
    await expect(patientScan('{"t":"PATIENT","mrn":"P2026-9999"}'))
      .rejects.toMatchObject({ response: { code: 'BCMA_PATIENT_MISMATCH' } });
  });
});

describe('5-Rights ③ — 용량·경로', () => {
  it('자리표시 문자열은 투여량으로 저장할 수 없다', async () => {
    const { svc } = build({ highAlertFlag: false, rxRoute: 'PO' });
    await expect(svc.administerMed('mar-1', { dose: '처방 용량', route: 'PO' }, 'n-1'))
      .rejects.toMatchObject({ response: { code: 'DOSE_PLACEHOLDER' } });
  });

  it('처방 경로와 실제 투여 경로가 다르면 경고한다', async () => {
    const { svc } = build({ highAlertFlag: false, rxRoute: 'PO' });
    const r: any = await svc.administerMed('mar-1', { dose: '1T', route: 'IV' }, 'n-1');
    expect((r.warnings ?? []).join(' ')).toContain('처방과 다릅니다');
  });

  it('처방 경로가 없으면 침묵한다 — 거짓 경보는 진짜 경보를 죽인다', async () => {
    const { svc } = build({ highAlertFlag: false, rxRoute: null });
    const r: any = await svc.administerMed('mar-1', { dose: '1T', route: 'IV' }, 'n-1');
    expect((r.warnings ?? []).join(' ')).not.toContain('처방과 다릅니다');
  });
});
