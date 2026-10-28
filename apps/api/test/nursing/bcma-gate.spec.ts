/**
 * 🔴 BCMA 게이트가 **켜져 있는지 알 수 있는가** — 투약 흐름 검토(계획서 §3 #1).
 *
 * 2026-08-21 운영 실측:
 *   · `nursing.bcma.enforce` = **WARN**(켜져 있음)
 *   · 그런데 `medication_administrations.bcma_scan_at` **전건 NULL**(스캔 기록 0)
 *   · `gate_violation_logs` 에 BCMA 행 **0** — 우회 흔적이 `notes` 문자열에만 남았다
 *   · 안전 게이트 관제(`/admin/safety-gates` 2408)의 wired 목록에 **BCMA 가 없었다**
 * → 게이트는 켜져 있는데 **스캔율을 아무도 몰랐다**
 *   (v4.4.0 "게이트가 BLOCK 인데 위반 0행이 곧 탐지기가 죽음이었다"와 같은 유형).
 *
 * 눌러본 결과 **코드 경로 자체는 정상**이었다(WARN 마커·스캔 저장 모두 동작).
 * 결함은 **원장에 남지 않는 것**과 **관제가 세지 않는 것**이었다.
 *
 * 재주입: `safetyGate.record` 호출을 빼거나 wiredGates 에서 BCMA 를 지우면 이 파일이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SafetyGateService } from '../../src/modules/safety-gate/safety-gate.service';

const NURSING = join(__dirname, '../../src/modules/nursing/nursing.service.ts');

describe('BCMA 우회가 원장에 남는다', () => {
  it('🔴 WARN 우회 시 `safetyGate.record` 를 부른다 — notes 문자열은 원장이 아니다', () => {
    const src = readFileSync(NURSING, 'utf8');
    const i = src.indexOf("bcmaMarker = `[BCMA-BYPASS");
    expect(i, 'BCMA 우회 마커를 찾지 못했다').toBeGreaterThan(-1);
    const block = src.slice(i, i + 900);
    // 🔴 호출 **모양**이 아니라 (정본 함수 · 이 게이트키 · 그 recorder) 가 한 자리에 있는지를 본다.
    //    2026-08-26 에 기록 경로가 `recordGateViolation()` 정본으로 옮겨가면서
    //    `safetyGate?.record` 문자열 단언이 **사실이 아닌 이유로** 깨졌다.
    expect(block, '우회가 GateViolationLog 에 남지 않는다').toMatch(/recordGateViolation\(/);
    expect(block, '이 게이트키로 남기지 않는다').toMatch(/gateKey:\s*'nursing\.bcma\.enforce'/);
    expect(block, 'SafetyGateService 를 recorder 로 넘기지 않는다').toMatch(/recorder:\s*this\.safetyGate/);
    expect(block, '게이트 키가 다르면 관제가 못 센다').toContain("'nursing.bcma.enforce'");
    expect(block, '어느 투약인지 참조가 없다').toContain('MedicationAdministration');
  });
});

describe('BCMA 통계 — 분모와 함께 센다', () => {
  const mk = (rows: { total7: number; total30: number; scanned7: number; scanned30: number }) => {
    const prisma: any = {
      medicationAdministration: {
        count: vi.fn()
          .mockResolvedValueOnce(rows.total7)
          .mockResolvedValueOnce(rows.total30)
          .mockResolvedValueOnce(rows.scanned7)
          .mockResolvedValueOnce(rows.scanned30),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    return new SafetyGateService(prisma);
  };

  it('🔴 투약 10건 중 스캔 2건이면 위반 8 · 모집단 10', async () => {
    const svc = mk({ total7: 10, total30: 10, scanned7: 2, scanned30: 2 });
    const r: any = await (svc as any).fromBcma(new Date(), new Date());
    expect(r.violations30d).toBe(8);
    expect(r.evaluated30d).toBe(10);
  });

  it('🔴 투약이 0건이면 위반 0 이지만 **모집단도 0** — "안전"이 아니라 표본 없음', async () => {
    const svc = mk({ total7: 0, total30: 0, scanned7: 0, scanned30: 0 });
    const r: any = await (svc as any).fromBcma(new Date(), new Date());
    expect(r.violations30d).toBe(0);
    expect(r.evaluated30d).toBe(0); // 이 값이 없으면 화면이 "위반 0 = 안전"으로 읽는다
  });

  it('전건 스캔이면 위반 0 — 거짓 경보를 만들지 않는다', async () => {
    const svc = mk({ total7: 5, total30: 12, scanned7: 5, scanned30: 12 });
    const r: any = await (svc as any).fromBcma(new Date(), new Date());
    expect(r.violations7d).toBe(0);
    expect(r.violations30d).toBe(0);
    expect(r.evaluated30d).toBe(12);
  });

  it('🔴 관제 wired 목록에 BCMA 가 있다 — 없으면 모드만 보이고 통계가 "없음"이 된다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/safety-gate/safety-gate.service.ts'), 'utf8');
    const m = src.match(/private wiredGates\(\): GateDef\[\] \{([\s\S]*?)\n  \}/);
    expect(m, 'wiredGates 를 찾지 못했다').toBeTruthy();
    expect(m![1], 'BCMA 게이트가 관제에 등재되지 않았다').toContain("'nursing.bcma.enforce'");
    expect(m![1], 'BCMA 통계 수집기가 붙지 않았다').toContain('fromBcma');
  });
});
