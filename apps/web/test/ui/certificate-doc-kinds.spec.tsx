/**
 * 진단서 틀을 쓰는 세 서식의 문구·칸(2026-10-13 결함 발굴 B7).
 *  · 🔴 종전: 입퇴원확인서·소견서가 제목만 바뀐 진단서 — "위와 같이 진단합니다"·"진단 의사"·진단서 법 문구 · 입·퇴원일 없음 · 소견 본문 미인쇄
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { CertificateDoc } from '@/components/document/forms/CertificateDoc';

const base = { patient: { name: '홍길동' }, diagnoses: [{ kcdCode: 'I20', name: '협심증' }], doctor: { name: '김의사' } };

describe('🔴 서식별 문구·칸', () => {
  it('입퇴원확인서 — 입원·퇴원 일자 · 확인 문구 · 진단서 문구 없음 · 재원 중', () => {
    const t = render(<CertificateDoc kind="ADMISSION_CERT" title="입퇴원확인서" data={{ ...base, admission: { admitDate: '2026-10-01T01:00:00Z', dischargeDate: '2026-10-05T02:00:00Z' } }} />).container.textContent!;
    expect(t).toContain('2026-10-01');
    expect(t).toContain('2026-10-05');
    expect(t).toContain('입원(및 퇴원)하였음을 확인합니다');
    expect(t).not.toContain('진단합니다');
    expect(t).not.toContain('진단서');
    expect(render(<CertificateDoc kind="ADMISSION_CERT" data={{ ...base, admission: { admitDate: '2026-10-01T01:00:00Z', dischargeDate: null } }} />).container.textContent).toContain('재원 중');
  });
  it('소견서 — 소견 본문을 그린다 · 소견 문구', () => {
    const t = render(<CertificateDoc kind="OPINION" title="소견서" data={{ ...base, content: '운동 제한 3주 권고' }} />).container.textContent!;
    expect(t).toContain('운동 제한 3주 권고');
    expect(t).toContain('위와 같이 소견합니다');
    expect(t).not.toContain('진단합니다');
  });
  it('대조군 — 진단서는 그대로(진단 문구·발병일 칸)', () => {
    const t = render(<CertificateDoc data={{ ...base, onsetDate: '2026-09-01' }} />).container.textContent!;
    expect(t).toContain('위와 같이 진단합니다');
    expect(t).toContain('발병 연월일');
  });
  it('인쇄 렌더러가 종류를 넘긴다', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/print/[issueNo]/page.tsx'), 'utf8');
    expect(page).toContain('title="입퇴원확인서" kind="ADMISSION_CERT"');
    expect(page).toContain('title="소견서" kind="OPINION"');
  });
});
