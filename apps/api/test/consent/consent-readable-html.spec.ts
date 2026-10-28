/**
 * 동의서 본문 — 서명 화면과 서명 대상 문서가 같은 정본(2026-10-12 · v4.78 후속).
 *  · 🔴 서버 HTML 이 `content` JSON 을 그대로 덤프했다(환자가 본 본문과 다른 것이 서명 대상으로 동결됐다)
 *  · 🔴 서명 전 문서에 '서명완료' 워터마크 · 근거 없는 "의료법 요건 충족" 바닥글
 *  · 🔴 출력 시각이 HTML 에 들어가 같은 동의서도 해시가 매번 달랐다(서명 요청 중복 방지가 늘 빗나감) → 서명용은 시각 없음
 */
import { describe, it, expect, vi } from 'vitest';
import { consentReadableSections } from '@hospital-run/shared';
import { PdfGenerationService } from '../../src/modules/medical-record-copy/pdf-generation.service';

const consent = (over: Record<string, unknown> = {}) => ({
  id: 'c1', status: 'PENDING', isValid: true, type: 'SURGERY', templateName: '수술 동의서',
  content: { sections: [{ title: '수술 내용', body: '복강경 담낭절제술' }, { title: '마취', body: '전신마취' }] },
  risks: '출혈·감염', alternatives: '약물 치료', explanation: null, patientSignedAt: null,
  patient: { mrn: 'M1', familyName: '김', givenName: '환자', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' },
  doctor: { familyName: '이', givenName: '의사' }, template: { id: 't', name: '수술 동의서', type: 'SURGERY' }, ...over,
});
const svc = (row: unknown) => new PdfGenerationService({ consentForm: { findFirst: vi.fn(async () => row) }, systemConfig: { findUnique: vi.fn(async () => ({ value: '가상병원' })) } } as never);

describe('동의서 본문 정본', () => {
  it('절 → 위험 → 대안 → 설명 순 · 단일 본문 · 🔴 본문 없으면 지어 채우지 않는다', () => {
    expect(consentReadableSections(consent()).sections.map((s) => s.title)).toEqual(['수술 내용', '마취', '위험·합병증', '대체 치료법']);
    expect(consentReadableSections({ content: { body: '본문' } })).toEqual({ sections: [{ title: null, body: '본문' }], hasBody: true });
    expect(consentReadableSections({ content: {}, risks: '출혈' })).toEqual({ sections: [{ title: '위험·합병증', body: '출혈' }], hasBody: false });
  });
});

describe('🔴 서버 동의서 HTML', () => {
  it('사람이 읽는 본문(JSON 덤프 아님) · 서명 전 워터마크 · 근거 없는 법 요건 문구 없음', async () => {
    const html = await svc(consent()).generateConsentFormPdf('c1');
    expect(html).toContain('복강경 담낭절제술');
    expect(html).toContain('출혈·감염');
    expect(html).not.toContain('&quot;sections&quot;');
    expect(html).not.toContain('"sections"');
    expect(html).toMatch(/class="watermark">서명 전</);
    expect(html).not.toContain('의료법이 정한 요건을 충족');
  });
  it('🔴 서명용(forSigning)은 출력 시각이 없어 같은 동의서 = 같은 HTML · 대조군: 일반 출력은 시각이 있다', async () => {
    const a = await svc(consent()).generateConsentFormPdf('c1', undefined, { forSigning: true });
    await new Promise((r) => setTimeout(r, 1100));
    const b = await svc(consent()).generateConsentFormPdf('c1', undefined, { forSigning: true });
    expect(a).toBe(b);
    expect(a).not.toContain('출력일시');
    expect(await svc(consent()).generateConsentFormPdf('c1')).toContain('출력일시');
  });
  it('서명 완료 문서는 서명완료 · 본문 없는 동의서는 그렇게 적는다', async () => {
    expect(await svc(consent({ status: 'SIGNED' })).generateConsentFormPdf('c1')).toMatch(/class="watermark">서명완료</);
    expect(await svc(consent({ content: {}, risks: null, alternatives: null })).generateConsentFormPdf('c1')).toContain('(본문이 없는 동의서입니다)');
  });
});
