import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { DraftBanner } from '../../src/components/ai/DraftBanner';

/**
 * 초안 ≠ 확정 — AI 초안이 폼에 들어간 뒤에도 그 사실이 보이는가(§7.6·§7.6-b · 2026-08-19).
 * 🔴 실측: 적용 버튼을 누르는 순간 AI 글과 사람 글이 같아졌다(진료 AI 보조·스크라이브·퇴원요약·VoC·동의서).
 */
describe('DraftBanner — 서명 전 초안임을 말한다', () => {
  const base = { source: 'ASSISTANT' as const, fields: ['A', 'P'], appliedAt: '2026-08-19T10:00:00+09:00', model: null };

  it('AI 병기 표기 · 적용 필드 · "서명 전 · 확정 아님" 을 한 배너에 말한다', () => {
    const { container } = render(<DraftBanner provenance={{ ...base, recorded: true }} />);
    const t = container.textContent ?? '';
    expect(t).toContain(AI_ORIGIN_TEXT);
    expect(t).toContain('서명 전 · 확정 아님');
    expect(t).toContain('A·P');
    expect(t).toContain('감사기록에 남았습니다');
  });

  it('🔴 감사 기록 실패를 성공처럼 말하지 않는다', () => {
    const { container } = render(<DraftBanner provenance={{ ...base, recorded: false }} />);
    expect(container.textContent).toContain('남기지 못했습니다');
    expect(container.textContent).not.toContain('감사기록에 남았습니다');
  });

  it('스키마 프로비넌스로 남는 자원(recorded=null)은 감사기록을 주장하지 않는다', () => {
    const { container } = render(<DraftBanner provenance={{ ...base, recorded: null }} signLabel="발송" />);
    expect(container.textContent).toContain('AI 보조 표식으로 남습니다');
    expect(container.textContent).toContain('발송 전 · 확정 아님');
  });

  it('프로비넌스가 없으면 아무것도 그리지 않는다(초안이 아닌 글에 초안 표식을 붙이지 않는다)', () => {
    const { container } = render(<DraftBanner provenance={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('🔴 AI 초안을 폼에 넣는 화면은 DraftBanner 를 쓴다(적용 지점 목록 — 지우면 실패)', () => {
  const SRC = path.join(__dirname, '..', '..', 'src');
  const APPLY_SITES = [
    'app/(main)/patients/[id]/encounter/new/page.tsx',            // 진료 AI 보조·스크라이브 → SOAP
    'app/(main)/inpatient/[admissionId]/discharge-summary/page.tsx', // 자동 퇴원요약
    'app/(main)/workstation/discharge/page.tsx',                    // 워크스테이션 자동 생성
    'app/(main)/admin/voc/page.tsx',                                // VoC 답변 초안
    'app/(main)/workstation/consent/page.tsx',                      // 동의서 위험·대안·설명 자동 작성
  ];
  it.each(APPLY_SITES)('%s', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(src, `${rel} 이 DraftBanner 를 쓰지 않는다`).toMatch(/<DraftBanner\b/);
  });
});
