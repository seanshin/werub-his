import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PdfGenerationService } from '../../src/modules/medical-record-copy/pdf-generation.service';

/**
 * 🔴 (2026-09-03 실결함) 검진 결과서 PDF 가 `Record<string, unknown>` 캐스팅 뒤에서 **없는 키**를 읽었다 —
 *    `normalMin/normalMax`(실제 referenceRange) → 참고치 전건 '-',
 *    `flag`(실제 finding) → grade 없는 항목은 **CRITICAL 도 '정상'으로 인쇄**,
 *    `findings/content`(실제 doctorOpinion) → 종합 소견 전건 '-'. 법정 발급 문서다.
 *    목은 정본(Prisma CheckupResultItem/CheckupSummary)의 실제 반환 모양을 쓴다.
 */

const visit = {
  scheduledDate: new Date('2026-09-01'),
  patient: { mrn: 'M1', familyName: '검', givenName: '증', dateOfBirth: new Date('1980-01-01'), gender: 'M' },
  program: { name: '종합검진 A' },
  items: [
    {
      testName: '공복혈당', value: '412', unit: 'mg/dL', referenceRange: '70~99',
      finding: 'CRITICAL', grade: null,
    },
    {
      testName: '신장', value: '172', unit: 'cm', referenceRange: null,
      finding: 'NORMAL', grade: 'A',
    },
  ],
  summary: {
    overallGrade: 'D1',
    doctorOpinion: '혈당 위급 수치 — 즉시 내과 진료 필요',
    recommendations: ['즉시 재검', '내과 협진'],
  },
};

const CONFIGS: Record<string, unknown> = {
  'hospital.name': '위루비병원', 'hospital.address': '가상 가상시 가상로 126', 'hospital.phone': '+82-2-000-0000',
};
const mkSvc = (v: unknown) =>
  new PdfGenerationService({
    checkupVisit: { findUnique: vi.fn(async () => v) },
    systemConfig: { findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (CONFIGS[where.key] !== undefined ? { value: CONFIGS[where.key] } : null)) },
  } as never);

describe('검진 결과서 PDF — 실제 스키마 키를 읽는다', () => {
  it('🔴 CRITICAL 판정이 "정상"으로 인쇄되지 않는다', async () => {
    const html = await mkSvc(visit).generateCheckupResultPdf('v1');
    expect(html).toContain('위급');
    expect(html, 'CRITICAL 행이 위급 스타일 없이 나갑니다').toContain('text-decoration:underline');
  });

  it('🔴 결과 표가 마크업으로 렌더된다 — HTML 소스 문자열로 인쇄되지 않는다(2026-09-03 운영 실측)', async () => {
    const html = await mkSvc(visit).generateCheckupResultPdf('v1');
    expect(html).toContain('<table');
    expect(html, '표가 이스케이프되어 소스 문자열로 인쇄되고 있습니다').not.toContain('&lt;table');
  });

  it('🔴 헤더 병원 정체는 정본(hospital.*) — 날조 헤더가 되살아나지 않는다', async () => {
    const html = await mkSvc(visit).generateCheckupResultPdf('v1');
    expect(html).toContain('위루비병원');
    expect(html, "하드코딩 'Hospital RUN 의료원' 재발").not.toContain('Hospital RUN 의료원');
    expect(html).not.toContain('테헤란로 123');
  });

  it('🔴 참고치(referenceRange)·종합 소견(doctorOpinion)·권고가 문서에 실린다', async () => {
    const html = await mkSvc(visit).generateCheckupResultPdf('v1');
    expect(html, '참고치가 전건 - 로 나가던 결함의 회귀').toContain('70~99');
    expect(html).toContain('혈당 위급 수치');
    expect(html).toContain('즉시 재검');
    expect(html, '종합 판정(overallGrade)').toContain('D1');
  });

  it('정상 항목은 정상으로, 등급은 병기로(대조군 — 실제보다 덜 안전하게 말하지도 않는다)', async () => {
    const html = await mkSvc(visit).generateCheckupResultPdf('v1');
    expect(html).toContain('정상 (A)');
  });

  it('🔴 캐스팅이 되살아나지 않는다 — 키 오타는 tsc 가 잡아야 한다', () => {
    const src = readFileSync(join(process.cwd(), 'src/modules/medical-record-copy/pdf-generation.service.ts'), 'utf8');
    // 검진 함수 범위만 본다 — 검사결과 PDF(LabResultItem)는 normalMin/flag 가 실재하는 키다(오탐 금지)
    const start = src.indexOf('generateCheckupResultPdf');
    expect(start, '검진 PDF 함수를 찾지 못했습니다 — 가드가 헛돕니다').toBeGreaterThan(-1);
    const nextFn = src.indexOf('\n  async ', start);
    const fn = src.slice(start, nextFn === -1 ? undefined : nextFn);
    expect(fn.length, '함수 본문 추출이 깨졌습니다').toBeGreaterThan(500);
    // 주석은 결함 서사를 담으므로 걷어내고 코드만 본다
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, '없는 키(normalMin)를 다시 읽고 있습니다').not.toContain('normalMin');
    expect(code, 'items 를 Record 캐스팅으로 읽으면 컴파일러가 꺼집니다').not.toMatch(/\(r:\s*Record</);
    expect(code).not.toMatch(/visit\.summary as Record</);
    expect(code, '판정 정본 finding 을 읽어야 한다').toContain('r.finding');
    expect(code).toContain('referenceRange');
    expect(code).toContain('doctorOpinion');
  });
});
