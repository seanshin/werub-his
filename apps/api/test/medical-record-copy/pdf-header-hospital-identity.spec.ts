import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { PdfGenerationService } from '../../src/modules/medical-record-copy/pdf-generation.service';

/**
 * 🔴 의무기록 사본 PDF(pdf-lib · `POST /medical-records/download-pdf`) 헤더의 병원 정체 (2026-09-11).
 *
 * 원 결함: 같은 파일의 HTML 경로(`hospitalIdentity`)는 이미 정본 `hospital.*` 를 읽는데, PDF Buffer 경로만
 *   `'Hospital RUN Medical Center'` · `'Seoul, Gangnam-gu, Teheran-ro 123 | TEL: 02-1234-5678'` 을 찍고 있었다.
 *   발급 문서다 — 실병원(가상 가상시)과 다른 기관명·주소·전화가 사본에 인쇄됐다(P15).
 *
 * 🔴 국문명으로 폴백하지 않는다: Helvetica(WinAnsi)는 한글을 인코딩하지 못해 `drawText` 가 던진다(발급 500).
 *    영문명이 없으면 **없다고** 찍는다(`HOSPITAL_NAME_EN_UNSET`).
 *
 * 목은 정본의 실제 반환 모양: `prisma.systemConfig.findUnique({ where: { key } })` → 행(`{ key, value }`) 또는 `null`.
 * 인쇄된 글자는 pdf-lib 가 압축·16진 인코딩하므로 `PDFPage.prototype.drawText` 를 **통과 호출로** 엿본다.
 */

type Cfg = Record<string, unknown>;
const mkPrisma = (cfg: Cfg, extra: Record<string, unknown> = {}) => ({
  systemConfig: {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (cfg[where.key] !== undefined ? { key: where.key, value: cfg[where.key] } : null)),
  },
  ...extra,
});

// 발급 문서 헤더와 무관한 환자 정보는 ASCII 로 둔다(Helvetica 경로 — 한글 환자명 문제는 이 가드의 대상이 아니다)
const PATIENT = { mrn: 'P2026-0001', familyName: 'Kim', givenName: 'Test', dateOfBirth: new Date('1985-03-12'), gender: 'MALE' };
const DATA = { title: 'Medical Record', patient: PATIENT, sections: [{ label: 'Plan', value: 'follow-up' }] };

const FABRICATED = ['Hospital RUN Medical Center', 'Teheran-ro', '02-1234-5678'];

let drawn: string[] = [];
beforeEach(() => {
  drawn = [];
  const orig = PDFPage.prototype.drawText;
  vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (this: PDFPage, text: string, opts?: any) {
    drawn.push(text);
    return orig.call(this, text, opts);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('의무기록 사본 PDF 헤더 — 병원 정체는 정본(hospital.nameEn·addressEn·phone)', () => {
  it('🔴 ① 설정된 영문 기관명·영문 주소·대표전화가 헤더에 찍힌다(상수가 아니라 설정에서 온다)', async () => {
    const svc = new PdfGenerationService(mkPrisma({
      'hospital.nameEn': 'Sentinel Test Hospital',
      'hospital.addressEn': '1 Sentinel-ro, Example City-si, Example',
      'hospital.phone': '+82-2-000-0000',
    }) as never);
    const buf = await svc.generatePdfBuffer(DATA);
    expect(buf.length).toBeGreaterThan(0);
    expect(drawn[0], '첫 줄(헤더)이 설정의 영문 기관명이 아닙니다').toBe('Sentinel Test Hospital');
    expect(drawn).toContain('1 Sentinel-ro, Example City-si, Example | TEL: +82-2-000-0000');
    for (const f of FABRICATED) expect(drawn.join('\n'), `날조 상수 '${f}' 재발`).not.toContain(f);
  });

  it('🔴 ② 영문명이 없으면 국문명으로 폴백하지 않고 "미설정"이라고 찍는다 — 발급은 실패하지 않는다', async () => {
    // 운영처럼 국문명·전화만 있고 영문명이 없는 경우 — 국문명을 Helvetica 로 찍으면 WinAnsi 예외(500)
    const svc = new PdfGenerationService(mkPrisma({ 'hospital.name': '위루비병원', 'hospital.phone': '+82-2-000-0000' }) as never);
    await expect(svc.generatePdfBuffer(DATA)).resolves.toBeInstanceOf(Buffer);
    expect(drawn[0]).toBe(PdfGenerationService.HOSPITAL_NAME_EN_UNSET);
    expect(drawn).toContain('TEL: +82-2-000-0000');
    for (const f of FABRICATED) expect(drawn.join('\n')).not.toContain(f);
  });

  it('🔴 ③ 설정 행이 하나도 없어도 날조 상수(Hospital RUN·Teheran-ro·02-1234-5678)로 메우지 않는다', async () => {
    const svc = new PdfGenerationService(mkPrisma({}) as never);
    await svc.generatePdfBuffer(DATA);
    expect(drawn[0]).toBe(PdfGenerationService.HOSPITAL_NAME_EN_UNSET);
    // 주소·전화 줄은 싣지 않는다 — 두 번째로 찍힌 글자는 제목이다
    expect(drawn[1]).toBe('Medical Record');
    for (const f of FABRICATED) expect(drawn.join('\n')).not.toContain(f);
  });

  it('🔴 ④ 실제 EP 경로(getEncounterPdfBuffer)도 같은 헤더를 쓴다', async () => {
    const encounter = {
      createdAt: new Date('2026-09-01T01:00:00Z'), subjective: 'cough', objective: null, assessment: null, plan: null,
      patient: PATIENT, doctor: { familyName: 'Lee', givenName: 'Doc' }, diagnoses: [], prescriptions: [],
    };
    const svc = new PdfGenerationService(mkPrisma(
      { 'hospital.nameEn': 'Sentinel Test Hospital' },
      { encounter: { findUnique: vi.fn(async () => encounter) } },
    ) as never);
    await svc.getEncounterPdfBuffer('enc-1');
    expect(drawn[0]).toBe('Sentinel Test Hospital');
    for (const f of FABRICATED) expect(drawn.join('\n')).not.toContain(f);
  });
});
