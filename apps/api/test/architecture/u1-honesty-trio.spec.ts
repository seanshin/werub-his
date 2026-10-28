/**
 * 🔴 (2026-09-15 U1) 소형 정직성 3건
 * ① AI egress·환자 컨텍스트 열람 감사 실패를 `.catch(() => {})` 로 삼키지 않는다(warn)
 * ② 표준 매핑 작성자는 인증 사용자 — 본문 값이 아니다(대량 할당 차단 후 null 로만 저장되던 것)
 * ③ 이식 대기 상태는 어휘 정본만(모르는 값 400) · 시드 값이 어휘 안에 있다
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CodeMasterService } from '../../src/modules/code-master/code-master.service';
import { TransplantService } from '../../src/modules/transplant/transplant.service';
import { TRANSPLANT_WAITLIST_STATUSES } from '../../src/modules/transplant/transplant-waitlist-status';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const src = (p: string) => strip(fs.readFileSync(path.resolve(__dirname, '../../src', p), 'utf8'));

describe('U1 ① AI 감사 기록 실패 정직성', () => {
  it('medical-ai.controller 에 audit.log(...).catch(() => {}) 가 없고 실패는 warn 으로 남긴다', () => {
    const s = src('modules/medical-ai/medical-ai.controller.ts');
    expect(s).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
    expect(s).toMatch(/AI egress audit write failed/);
    expect(s).toMatch(/AI patient-context read audit failed/);
  });
});

describe('U1 ② 표준 매핑 작성자 = 인증 사용자', () => {
  const make = () => {
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve(data));
    const svc = Object.create(CodeMasterService.prototype) as CodeMasterService;
    (svc as any).prisma = { terminologyMapping: { create } };
    return { svc, create };
  };
  it('서비스가 userId 를 createdBy 로 쓰고 본문의 createdBy 를 따르지 않는다', async () => {
    const { svc, create } = make();
    const body = { sourceTable: 'diagnosis_codes', sourceId: '00000000-0000-4000-8000-000000000001', sourceCode: 'I10', targetSystem: 'SNOMED', targetCode: '38341003', targetDisplay: 'HTN', createdBy: 'forged' } as any;
    await svc.createMapping(body, 'u-real');
    expect(create.mock.calls[0][0].data.createdBy).toBe('u-real');
  });
  it('대조군 — 인증 사용자를 모르면 null(추정 금지)', async () => {
    const { svc, create } = make();
    await svc.createMapping({ sourceTable: 't', sourceId: 's', sourceCode: 'c', targetSystem: 'x', targetCode: 'y', targetDisplay: 'z' } as any);
    expect(create.mock.calls[0][0].data.createdBy).toBeNull();
  });
  it("컨트롤러가 @CurrentUser('id') 를 넘긴다", () => {
    expect(src('modules/code-master/code-master.controller.ts')).toMatch(/createMapping\(@Body\(\) body: CreateTerminologyMappingDto, @CurrentUser\('id'\) userId: string\)/);
  });
});

describe('U1 ③ 이식 대기 상태 어휘', () => {
  const make = () => {
    const update = vi.fn().mockResolvedValue({});
    const svc = Object.create(TransplantService.prototype) as TransplantService;
    (svc as any).prisma = { transplantWaitlist: { update } };
    return { svc, update };
  };
  it('모르는 상태는 400 이고 쓰지 않는다', async () => {
    const { svc, update } = make();
    await expect(svc.updateWaitlistStatus('wl-1', 'WAITNG')).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
  it.each([...TRANSPLANT_WAITLIST_STATUSES])('대조군 — %s 는 저장한다', async (st) => {
    const { svc, update } = make();
    await svc.updateWaitlistStatus('wl-1', st, st === 'REMOVED' ? '사유' : undefined);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('시드의 transplantWaitlist status 값이 어휘 안에 있다(어휘는 시드에서 갈라진다)', () => {
    const seed = fs.readFileSync(path.resolve(__dirname, '../../prisma/seed.ts'), 'utf8');
    const i = seed.indexOf('// TransplantWaitlist');
    expect(i).toBeGreaterThan(-1);
    const block = seed.slice(i, i + 1500);
    const statuses = [...block.matchAll(/prisma\.transplantWaitlist\.create\(\{[\s\S]*?status:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) expect(TRANSPLANT_WAITLIST_STATUSES as readonly string[]).toContain(s);
  });
});
