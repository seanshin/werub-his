import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 사망진단서 입력이 저장되지 않던 것 (2026-08-26 실측 · P0)
 *
 * DTO 는 `deathLocation`·`deathType`·`causeChain{a,b,c,d}` 를 받고 응답(`deceasedInfo`)에도 실었는데
 * `patient.update` 는 `isDeceased`·`deathDate`·`deathCause(=causeChain.a)` **셋만** 썼다.
 * → 사망장소·사망종류·사인 (나)(다)(라)가 **다음 조회에서 사라졌다.** 사망진단서는 법정 서식이다.
 */
const SVC = join(process.cwd(), 'src/modules/patient/patient.service.ts');
const SCHEMA = join(process.cwd(), 'prisma/schema.prisma');

describe('사망 처리 입력은 저장된다', () => {
  const svc = readFileSync(SVC, 'utf8');
  const schema = readFileSync(SCHEMA, 'utf8');

  it('Patient 에 담을 자리가 있다', () => {
    for (const col of ['death_location', 'death_type', 'death_cause_chain']) {
      expect(schema, `${col} 컬럼이 없다`).toContain(col);
    }
  });

  it('🔴 update 가 그 값들을 실제로 쓴다(응답에만 싣지 않는다)', () => {
    // markDeceased 의 update 블록만 잘라서 본다 — 파일 어딘가에 이름이 있는 것으로는 부족하다
    const from = svc.indexOf('const updated = await tx.patient.update(');
    expect(from, 'markDeceased 의 update 를 찾지 못했다').toBeGreaterThan(0);
    const block = svc.slice(from, from + 900);
    for (const f of ['deathLocation:', 'deathType:', 'deathCauseChain:']) {
      expect(block, `${f} 가 update 에 없다`).toContain(f);
    }
  });

  it('대조군 — 기존 3필드도 그대로 저장된다(고치면서 지우지 않았다)', () => {
    const from = svc.indexOf('const updated = await tx.patient.update(');
    const block = svc.slice(from, from + 900);
    for (const f of ['isDeceased:', 'deathDate:', 'deathCause:']) expect(block).toContain(f);
  });

  it('사인 체인은 (가)만이 아니라 통째로 남는다', () => {
    const from = svc.indexOf('const updated = await tx.patient.update(');
    const block = svc.slice(from, from + 900);
    // deathCause 는 (가) 요약이고, 원문은 causeChain 으로 남아야 한다
    expect(block).toMatch(/deathCauseChain:\s*deceasedInfo\.causeChain/);
  });
});
