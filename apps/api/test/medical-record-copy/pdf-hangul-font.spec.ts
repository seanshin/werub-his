import { describe, it, expect, vi } from 'vitest';
import { NotImplementedException } from '@nestjs/common';
import { PdfGenerationService } from '../../src/modules/medical-record-copy/pdf-generation.service';

/**
 * 🔴 pdf-lib 경로(의무기록 사본 `POST /medical-records/download-pdf` · 검진 결과서 `?format=pdf`)에 **한글**이 들어오면 (2026-09-11 실측).
 *
 * 원 결함: 두 경로 모두 pdf-lib 표준 글꼴 Helvetica(WinAnsi)만 쓴다. WinAnsi 는 한글을 인코딩하지 못해
 *   `drawText`/`widthOfTextAtSize` 가 `WinAnsi cannot encode "김"` 을 던지고 → 전역 필터가 **500 INTERNAL_ERROR** 로 말했다.
 *   이 병원의 환자명·의사명·진단명(nameKo)·SOAP 는 거의 전부 한글이다 — 즉 이 EP 는 **실데이터로는 한 번도 성공할 수 없는** 경로였다.
 *   (검진 결과서 경로엔 `drawText` 실패 시 한글을 '?' 로 바꾸는 catch 가 있었지만, 그 앞의 `widthOfTextAtSize` 가 먼저 던져 거기까지 가지도 못했다.)
 *
 * 저장소·의존성 어디에도 한글 글꼴(.ttf/.otf)·`@pdf-lib/fontkit` 이 없다 → 글꼴 바이너리를 지어 넣지 않고,
 *   **실패를 정직하게** 말한다: 501 `PDF_FONT_UNSUPPORTED_SCRIPT` "한글 글꼴 미탑재 — PDF 생성 불가"
 *   (서버에 그 기능이 없다는 사실 — 입력을 고쳐 풀리는 문제가 아니라 422 가 아니다).
 *   한글을 '?' 로 바꿔 찍는 것은 해법이 아니다 — 환자명·진단명이 '???' 인 사본은 발급 문서가 아니다(P1·P16).
 *
 * 목은 정본의 실제 반환 모양: `systemConfig.findUnique({ where: { key } })` → 행 또는 `null`,
 *   `encounter.findUnique` → include 한 관계를 가진 행.
 */

const mkPrisma = (extra: Record<string, unknown> = {}) => ({
  systemConfig: { findUnique: vi.fn(async () => null) },
  ...extra,
});

const KO_ENCOUNTER = {
  createdAt: new Date('2026-09-01T01:00:00Z'),
  subjective: '기침 3일', objective: null, assessment: null, plan: null,
  patient: { mrn: 'P2026-0001', familyName: '김', givenName: '민수', dateOfBirth: new Date('1985-03-12'), gender: 'MALE' },
  doctor: { familyName: '이', givenName: '의사' },
  diagnoses: [{ diagnosisCode: { code: 'J20.9', nameKo: '급성 기관지염' } }],
  prescriptions: [],
};

const ASCII_ENCOUNTER = {
  ...KO_ENCOUNTER,
  subjective: 'cough 3 days',
  patient: { ...KO_ENCOUNTER.patient, familyName: 'Kim', givenName: 'Minsu' },
  doctor: { familyName: 'Lee', givenName: 'Doc' },
  diagnoses: [{ diagnosisCode: { code: 'J20.9', nameKo: 'Acute bronchitis' } }],
};

async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p; return null; } catch (e) { return e; }
}

describe('pdf-lib 경로의 한글 — 500 이 아니라 "한글 글꼴 미탑재"라고 말한다', () => {
  it('🔴 ① 의무기록 사본 PDF: 한글 환자명·의사명·진단명이면 501 PDF_FONT_UNSUPPORTED_SCRIPT(종전 500 WinAnsi 예외)', async () => {
    const svc = new PdfGenerationService(mkPrisma({ encounter: { findUnique: vi.fn(async () => KO_ENCOUNTER) } }) as never);
    const e = await caught(svc.getEncounterPdfBuffer('enc-1'));
    expect(e, `WinAnsi 예외가 그대로 새면 500 이다: ${String(e)}`).toBeInstanceOf(NotImplementedException);
    const body = (e as NotImplementedException).getResponse() as { code: string; message: string };
    expect(body.code).toBe('PDF_FONT_UNSUPPORTED_SCRIPT');
    expect(body.message).toContain('한글 글꼴 미탑재');
    expect((e as NotImplementedException).getStatus()).toBe(501);
    // 응답에 글자 자체(환자명 조각)를 싣지 않는다
    expect(JSON.stringify(body)).not.toMatch(/김|민수|기관지염/);
  });

  it('🔴 ② 검진 결과서 PDF(htmlToPdfBuffer): 한글 줄이 있으면 501 — "?" 로 바꿔 찍지 않는다', async () => {
    const svc = new PdfGenerationService(mkPrisma() as never);
    const e = await caught(svc.htmlToPdfBuffer('<h1>건강검진 결과서</h1><p>환자명: 김민수</p>'));
    expect(e, `WinAnsi 예외가 그대로 새면 500 이다: ${String(e)}`).toBeInstanceOf(NotImplementedException);
    expect(((e as NotImplementedException).getResponse() as { code: string }).code).toBe('PDF_FONT_UNSUPPORTED_SCRIPT');
  });

  it('대조군 — 인코딩 가능한 글자뿐이면 두 경로 모두 PDF 를 만든다(성공을 실패로 말하지 않는다)', async () => {
    const svc = new PdfGenerationService(mkPrisma({ encounter: { findUnique: vi.fn(async () => ASCII_ENCOUNTER) } }) as never);
    const buf = await svc.getEncounterPdfBuffer('enc-1');
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const buf2 = await svc.htmlToPdfBuffer('<h1>Checkup Result</h1><p>Name: Kim Minsu — café</p>');
    expect(buf2.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('대조군 — 표(td/th)가 있는 영문 HTML 도 PDF 가 된다(종전 칸 구분 \\t 가 표준 글꼴에서 던져 500 이었다)', async () => {
    const svc = new PdfGenerationService(mkPrisma() as never);
    const buf = await svc.htmlToPdfBuffer('<table><tr><th>Test</th><th>Result</th></tr><tr><td>HbA1c</td><td>5.6 %</td></tr></table>');
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
