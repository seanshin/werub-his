import { describe, it, expect } from 'vitest';
import { NotImplementedException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClinicAdapter } from '../../src/modules/checkup/adapters/prisma-clinic.adapter';

/**
 * 검진↔진료 어댑터 — **미구현을 성공으로 말하지 않는다** (2026-08-27).
 *
 * 🔴 종전 여섯 메서드는 아무것도 만들지 않고 `lab-<encounterId>-<Date.now()>` 같은 **가짜 ID 를
 *    성공 응답으로** 돌려줬다. 이 저장소가 이미 겪은 두 가지가 겹친 자리다 —
 *    **P16**(실행하지 않고 성공 상태만 기록)와 **값 날조**(키오스크 `KIOSK-<ts>` 승인번호).
 *    지금은 호출부가 0이라 피해가 없지만, 배선되는 순간 "오더를 냈다"고 믿게 된다.
 *
 * 재주입: 아무 메서드든 `return { orderId: \`lab-${'$'}{...}\` }` 로 되돌리면 아래가 실패한다.
 */
describe('PrismaClinicAdapter — 지어낸 식별자로 성공한 척하지 않는다', () => {
  const adapter = new PrismaClinicAdapter({} as never);

  const cases: Array<[string, () => Promise<unknown>]> = [
    ['createLabOrder', () => adapter.createLabOrder({ encounterId: 'e1' } as never)],
    ['createImagingOrder', () => adapter.createImagingOrder({ encounterId: 'e1' } as never)],
    ['createDiagnosticTest', () => adapter.createDiagnosticTest({ encounterId: 'e1' } as never)],
    ['createAppointment', () => adapter.createAppointment({ patientId: 'p1' } as never)],
    ['createReferral', () => adapter.createReferral({ patientId: 'p1' } as never)],
    ['createBilling', () => adapter.createBilling({ patientId: 'p1' } as never)],
  ];

  for (const [name, call] of cases) {
    it(`🔴 ${name} 는 미구현임을 밝힌다 — 가짜 ID 를 돌려주지 않는다`, async () => {
      await expect(call()).rejects.toBeInstanceOf(NotImplementedException);
      await expect(call()).rejects.toMatchObject({
        response: { code: 'CHECKUP_CLINIC_LINK_NOT_WIRED' },
      });
    });
  }

  it('🔴 어댑터 소스에 타임스탬프로 식별자를 만드는 코드가 남아 있지 않다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/modules/checkup/adapters/prisma-clinic.adapter.ts'), 'utf-8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // 주석의 인용은 근거다
    expect(code, '`<접두사>-<Date.now()>` 는 실행하지 않고 성공만 기록하는 형태다')
      .not.toMatch(/`[a-z]+-\$\{[^}]*\}-\$\{Date\.now\(\)\}`/);
  });

  it('실제로 구현된 것(환자 조회·Encounter 생성)은 그대로 둔다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/modules/checkup/adapters/prisma-clinic.adapter.ts'), 'utf-8');
    expect(src).toContain('prisma.patient.findUniqueOrThrow');
    expect(src).toContain('prisma.encounter.create');
  });
});
