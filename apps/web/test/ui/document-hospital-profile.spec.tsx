/**
 * 발급 서식의 기관 정보는 설정 원장에서(2026-10-13 결함 발굴 C6).
 *  · 🔴 종전: 모든 서식·서버 PDF 가 데모 상수(가짜 요양기관기호·사업자번호·대표자)
 *  · 이제: 공급자가 준 원장 값 · 없으면 '미설정' · 조회 실패면 '확인 불가' · 기본값(source≠db)은 쓰지 않는다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { CertificateDoc } from '@/components/document/forms/CertificateDoc';
import { HospitalProfileProvider, profileFromConfig } from '@/components/document/lib/hospitalProfile';

const data = { patient: { name: '홍길동' }, diagnoses: [] };

describe('🔴 서식 기관 정보', () => {
  it('공급자 없음 → 미설정 · 데모 상수 없음', () => {
    const t = render(<CertificateDoc data={data} />).container.textContent!;
    expect(t).toContain('요양기관기호 미설정');
    expect(t).not.toContain('WRB' + '-DEMO');
  });
  it('원장 값은 그대로 · 빠진 키는 미설정 · 실패는 확인 불가', () => {
    const p = profileFromConfig({ 'hospital.name': '시험병원', 'hospital.code': '12345678', 'hospital.phone': '' });
    expect(p).toMatchObject({ name: '시험병원', ykiho: '12345678', tel: '미설정', ceo: '미설정' });
    const t = render(<HospitalProfileProvider value={p}><CertificateDoc data={data} /></HospitalProfileProvider>).container.textContent!;
    expect(t).toContain('시험병원');
    expect(t).toContain('요양기관기호 12345678');
    expect(profileFromConfig(null, true).ykiho).toBe('확인 불가');
  });
  it('구조 가드 — 서식이 데모 상수를 읽지 않는다 · 미리보기 틀은 원장 행(source=db)만', () => {
    const dir = join(process.cwd(), 'src/components/document/forms');
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(new RegExp([['DEV', 'HOSPITAL', 'PROFILE'].join('_'), 'WRB' + '-DEMO'].join('|')));
    expect(readFileSync(join(process.cwd(), 'src/components/document/DocumentFrame.tsx'), 'utf8')).toContain("r.source === 'db'");
  });
});
