/**
 * QI 보고서 봉인은 저장된 본문으로 다시 계산된다(2026-10-13 결함 발굴 C4).
 *  · 🔴 종전: sha256(JSON.stringify(content)) — JSONB 가 키 순서를 바꿔 저장해 저장 본문으로 재계산 불가(봉인 검산 불가)
 *  · 이제: 키 정렬 JSON · 봉인 방식 표식 · 대조 MATCH/MISMATCH/LEGACY/UNSEALED · 인쇄본 발급은 MISMATCH 거부
 */
import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { qiReportSealCheck, qiReportSealHash, QI_REPORT_SEAL_CANON } from '../../src/modules/quality-flow/qi-report.service';
import { PrintIssuanceService } from '../../src/modules/print-issuance/print-issuance.service';

/** JSONB 저장 흉내 — 키 순서를 뒤집어 돌려준다 */
const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).reverse().map((k) => [k, reorder((v as Record<string, unknown>)[k])])) : v;

const content = { summary: { keyFindings: ['a', 'b'], rate: 0.12 }, precedence: ['X'], measurementIds: [{ id: 'm1', source: null }], sealCanon: QI_REPORT_SEAL_CANON };

describe('🔴 QI 보고서 봉인 — 저장 뒤에도 검산된다', () => {
  it('키 순서가 바뀐 저장 본문으로도 MATCH · 대조군: 종전 방식(JSON.stringify)은 맞지 않는다', () => {
    const sha256 = qiReportSealHash(content);
    const stored = reorder(content);
    expect(qiReportSealCheck({ body: stored, sha256 })).toBe('MATCH');
    const { createHash } = require('node:crypto');
    expect(createHash('sha256').update(JSON.stringify(stored)).digest('hex')).not.toBe(createHash('sha256').update(JSON.stringify(content)).digest('hex'));
  });
  it('본문이 바뀌면 MISMATCH · 표식 없는 옛 봉인은 LEGACY(일치라 말하지 않는다) · 해시 없음 UNSEALED', () => {
    const sha256 = qiReportSealHash(content);
    expect(qiReportSealCheck({ body: { ...content, summary: { keyFindings: ['조작'] } }, sha256 })).toBe('MISMATCH');
    const { sealCanon: _drop, ...old } = content;
    expect(qiReportSealCheck({ body: old, sha256: 'x'.repeat(64) })).toBe('LEGACY');
    expect(qiReportSealCheck({ body: content, sha256: null })).toBe('UNSEALED');
  });
  it('인쇄본 발급 — MISMATCH 면 409 QI_REPORT_SEAL_MISMATCH', async () => {
    const prisma: any = { qiReportSnapshot: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', status: 'DRAFT', sha256: qiReportSealHash(content), body: { ...content, precedence: ['Y'] } }) } };
    const svc = new (PrintIssuanceService as any)(prisma, {}, {}, {}, {}, {});
    const e = await svc.build('QI_REPORT', { kind: 'QI_REPORT', reportId: 'r1' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({ code: 'QI_REPORT_SEAL_MISMATCH' });
  });
});
