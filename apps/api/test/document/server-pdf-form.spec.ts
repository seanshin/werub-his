/**
 * 서버 PDF — 양식 없는 종류는 만들지 않는다 · 동의서는 동결된 본문 HTML 로(2026-10-12).
 *  · 🔴 종전엔 양식 없는 종류(CONSENT·CONTRACT·CHECKUP_RESULT)도 렌더러를 불러 "로딩 중…"만 찍힌 PDF 가 나왔다 —
 *     전자서명 요청은 그 PDF 의 해시를 서명 대상으로 보냈다(환자가 본문 없는 문서에 서명)
 *  · 가드: 렌더러 페이지의 종류 분기 = shared PRINT_RENDERER_TYPES(한쪽만 늘면 실패)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PRINT_RENDERER_TYPES } from '@hospital-run/shared';
import { DocumentService, PRINT_READY_SELECTOR } from '../../src/modules/document/document.service';

const svc = (row: Record<string, unknown> | null) => new DocumentService({ issuedDocument: { findUnique: vi.fn(async () => row) } } as never);
const ok = () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }) as never);
afterEach(() => vi.restoreAllMocks());

describe('🔴 서버 PDF — 양식 없는 종류는 만들지 않는다', () => {
  it('CHECKUP_RESULT·CONTRACT·모르는 종류 → 409 DOCUMENT_NO_PRINT_FORM · 렌더러를 부르지 않는다', async () => {
    const f = ok();
    for (const t of ['CHECKUP_RESULT', 'CONTRACT', 'NOPE']) {
      const e = await svc({ issueNo: 'n', documentType: t, snapshotJson: {} }).generatePdf('n').catch((x) => x);
      expect(e, t).toBeInstanceOf(ConflictException);
      expect((e as ConflictException).getResponse()).toMatchObject({ code: 'DOCUMENT_NO_PRINT_FORM' });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it('🔴 동의서 — 동결된 본문 HTML 이 없으면(옛 발급) 만들지 않는다 · 있으면 그 HTML 로(주소 아님)', async () => {
    const f = ok();
    await expect(svc({ issueNo: 'c', documentType: 'CONSENT', snapshotJson: { title: 't' } }).generatePdf('c')).rejects.toBeInstanceOf(ConflictException);
    await svc({ issueNo: 'c', documentType: 'CONSENT', snapshotJson: { html: '<p>본문</p>' } }).generatePdf('c');
    const body = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(body.html).toBe('<p>본문</p>');
    expect(body.url).toBeUndefined();
  });
  it('대조군 — 양식이 있는 종류는 인쇄 주소로 그린다', async () => {
    const f = ok();
    await svc({ issueNo: 'WRB-LAB_REPORT-1', documentType: 'LAB_REPORT', snapshotJson: {} }).generatePdf('WRB-LAB_REPORT-1');
    const body = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(body.url).toContain('/print/WRB-LAB_REPORT-1?rt=');
    expect(body.html).toBeUndefined();
  });
  it('🔴 (A5) 주소 렌더는 렌더러의 준비 완료 표식을 기다린다 · 표식은 렌더러가 실제로 찍는 모양 · 렌더 실패면 PDF 를 돌려주지 않는다', async () => {
    const f = ok();
    await svc({ issueNo: 'WRB-LAB_REPORT-2', documentType: 'LAB_REPORT', snapshotJson: {} }).generatePdf('WRB-LAB_REPORT-2');
    const body = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(body.waitFor).toBe(PRINT_READY_SELECTOR);
    const page = readFileSync(join(__dirname, '../../../web/src/app/print/[issueNo]/page.tsx'), 'utf8');
    expect(page).toMatch(/data-print-ready=\{[^}]*'ok'/); // 렌더러가 'ok' 를 찍는다(선택자와 같은 값)
    expect(PRINT_READY_SELECTOR).toBe('div[data-print-ready=ok]');
    f.mockRestore();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Waiting for selector failed', { status: 400 }) as never);
    await expect(svc({ issueNo: 'WRB-LAB_REPORT-3', documentType: 'LAB_REPORT', snapshotJson: {} }).generatePdf('WRB-LAB_REPORT-3')).rejects.toThrow(/PDF 렌더 실패 HTTP 400/);
  });
  it('대조군 — 동결 HTML 은 기다릴 표식이 없다(waitFor 없음)', async () => {
    const f = ok();
    await svc({ issueNo: 'c2', documentType: 'CONSENT', snapshotJson: { html: '<p>본문</p>' } }).generatePdf('c2');
    expect(JSON.parse(String((f.mock.calls[0][1] as RequestInit).body)).waitFor).toBeUndefined();
  });
  it('🔴 렌더러 페이지의 종류 분기 = PRINT_RENDERER_TYPES(양방향)', () => {
    const page = readFileSync(join(__dirname, '../../../web/src/app/print/[issueNo]/page.tsx'), 'utf8');
    const rendered = [...page.matchAll(/documentType === '([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(rendered).toEqual([...PRINT_RENDERER_TYPES].sort());
  });
});
