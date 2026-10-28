import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
// 계측 규칙 정본은 스캐너 하나 — 주석 토크나이저를 여기서 다시 만들지 않는다
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';
import { recordGateViolation } from '../../src/common/gate-violation-record';

/**
 * 🔴 안전 게이트 위반 원장은 **기록 실패를 조용히 삼키지 않는다**(2026-09-16 K4).
 *
 * 배경: 게이트 규약은 "막으면 방치된다 — 봉쇄가 아니라 기록과 가시화"이고 "가짜 게이트 금지 —
 * 막는다면 서버에 남아야 한다"이다. 그런데 `gateViolationLog.create(...).catch(() => undefined)` 가
 * 8파일 10자리에 흩어져 있었다. 기록이 실패하면 흔적이 전혀 없고, `/admin/safety-gates` 는 그 게이트를
 * "위반 0"으로 그린다 — 이 화면에서 0건은 "준수"로 읽히고 WARN→BLOCK 승격 판단의 근거가 된다.
 * 읽는 쪽은 이미 고쳐져 있었다(`governance.service` 집계 실패 → null + '산출 불가'). **쓰는 쪽만 조용했다.**
 */
const MODULES = path.join(__dirname, '..', '..', 'src', 'modules');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** `gateViolationLog.create(...)` 직후 리터럴 기본값으로 삼키는 모양 — 정본을 쓰면 이 모양이 남지 않는다 */
const SWALLOWED_GATE_WRITE = /gateViolationLog[\s\S]{0,400}?\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)?\s*=>\s*(?:null|undefined|\{\s*\})\s*\)/g;

function swallowedGateWrites(): string[] {
  const hits: string[] = [];
  for (const f of tsFiles(MODULES)) {
    const src = stripComments(fs.readFileSync(f, 'utf8')) as string;
    const n = (src.match(SWALLOWED_GATE_WRITE) ?? []).length;
    if (n > 0) hits.push(`${path.relative(MODULES, f).split(path.sep).join('/')}×${n}`);
  }
  return hits.sort();
}

function canonUsers(): string[] {
  return tsFiles(MODULES)
    .filter((f) => (stripComments(fs.readFileSync(f, 'utf8')) as string).includes('recordGateViolation('))
    .map((f) => path.relative(MODULES, f).split(path.sep).join('/'))
    .sort();
}

describe('🔴 게이트 위반 원장 — 기록 실패를 삼키지 않는다', () => {
  const makeLogger = () => ({ error: vi.fn(), warn: vi.fn(), log: vi.fn() }) as unknown as Logger;

  it('성공하면 true 를 돌려주고 원장에 그대로 적는다', async () => {
    const create = vi.fn().mockResolvedValue({});
    const logger = makeLogger();
    const ok = await recordGateViolation({ gateViolationLog: { create } } as never, logger, {
      gateKey: 'dur.enforce', severity: 'OVERRIDE', message: 'x', refType: 'ENCOUNTER', refId: 'e1',
    });
    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { gateKey: 'dur.enforce', severity: 'OVERRIDE', message: 'x', refType: 'ENCOUNTER', refId: 'e1' },
    });
    // 대조군 — 성공을 실패로 말하지 않는다
    expect((logger.error as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('🔴 기록이 실패하면 false 를 돌려주고 유실을 남긴다(던지지 않는다)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('DB down'));
    const logger = makeLogger();
    const ok = await recordGateViolation({ gateViolationLog: { create } } as never, logger, {
      gateKey: 'pharmacy.durGate.enforce', severity: 'BLOCK', message: 'y', refType: 'PRESCRIPTION', refId: 'rx1',
    });
    expect(ok).toBe(false); // 호출부가 드러내고 싶으면 쓸 수 있다
    const errArg = String((logger.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
    expect(errArg).toContain('pharmacy.durGate.enforce'); // 어느 게이트가 유실됐는지
    expect(errArg).toContain('rx1'); // 무엇에 대한 위반이었는지
  });

  it('원장 컬럼 상한(2000)을 넘겨 쓰기를 깨뜨리지 않는다', async () => {
    const create = vi.fn().mockResolvedValue({});
    await recordGateViolation({ gateViolationLog: { create } } as never, makeLogger(), {
      gateKey: 'g', severity: 'WARN', message: 'ㄱ'.repeat(5000),
    });
    expect(create.mock.calls[0][0].data.message.length).toBe(2000);
  });

  it('🔴 게이트 원장 쓰기를 삼키는 자리가 0 이다(늘면 실패 — 정본을 쓴다)', () => {
    expect(swallowedGateWrites()).toEqual([]);
  });

  it('하한 — 정본 소비처가 실재한다(스캐너가 죽어서 0 이 아니다)', () => {
    // 2026-09-16 K4: 8파일(safety-gate·prescription·pharmacy·encounter·inventory·formulary·equipment·remote-consultation)
    expect(canonUsers().length).toBeGreaterThanOrEqual(8);
  });
});
