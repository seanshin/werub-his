import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';
import { DraftBanner } from '../../src/components/ai/DraftBanner';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';

/**
 * 🔴 **초안≠확정 배너가 영어 화면에서 한국어로 남던 자리**(2026-09-10 운영 스크린샷 실측).
 *
 * 이 배너의 두 문장은 **문장 안에 변수**(서명 라벨·항목·시각)가 끼어 있어서, 조각으로 쪼개
 * 배선하면 어순이 깨진다. 그래서 i18n 코어에 **자리표시자 보간**(`tf`/`<Tf>`)을 만들고
 * 여기서 처음 쓴다. 이 스펙이 지키는 사실:
 *
 *   ① 한국어 화면의 글자가 **하나도 바뀌지 않는다**(배선은 표시만 바꾼다)
 *   ② 영어에서 조각이 아니라 **문장**으로 나온다 — 옛 결함 형태(`{서명}하세요` 조각)가 남지 않는다
 *   ③ `서명` 을 그대로 쓰지 않는다 — 카탈로그의 `서명` 은 **'Signed'(과거분사)** 라
 *      동사 자리에 넣으면 "then Signed" 가 된다(품사 오역 · 승인@버튼 선례)
 */

const PROV = {
  source: 'ASSISTANT' as const,
  fields: ['S', 'O'],
  appliedAt: new Date(2026, 8, 10, 14, 30).toISOString(),
  recorded: true as boolean | null,
  model: null as string | null,
};

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'ai', 'DraftBanner.tsx'), 'utf8');
const CODE = stripComments(SRC) as string;

describe('🔴 초안≠확정 배너 — 문장 배선(보간)', () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));

  it('① 한국어 렌더가 원문 그대로다 — 배선이 글자를 바꾸지 않는다', () => {
    render(<DraftBanner provenance={PROV} />);
    // 원문: `{fields} 에 {hhmm} 반영. 내용을 검토·수정한 뒤 서명하세요 — 서명해야 기록이 확정됩니다.`
    expect(screen.getByText(/S·O 에 14:30 반영\./)).toBeTruthy();
    expect(screen.getByText(/내용을 검토·수정한 뒤 서명하세요 — 서명해야 기록이 확정됩니다\./)).toBeTruthy();
    expect(screen.getByText(/서명 전 · 확정 아님/)).toBeTruthy();
  });

  it('② 영어에서 문장으로 나온다 — 한국어 조각이 남지 않는다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<DraftBanner provenance={PROV} />);
    const text = container.textContent ?? '';
    expect(text, '영어 화면에 한국어 조각이 남았다').not.toMatch(/반영|확정 아님|하세요/);
    expect(text).toMatch(/Applied to S·O at 14:30\./);
    expect(text).toMatch(/the record is final only after signing\./);
    // 🔴 품사 오역 재발 방지 — 동사 자리에 과거분사가 들어가면 "then Signed" 가 된다
    expect(text, "'Signed'(과거분사)가 동사 자리에 들어갔다").not.toMatch(/complete Signed|after Signed/);
  });

  it('③ 소스가 보간을 쓴다 — 조각 배선으로 되돌아가지 않는다', () => {
    expect(CODE, '<Tf> 보간이 사라졌다 — 조각 배선으로 회귀했다').toContain('<Tf');
    expect(CODE, '동작형 문맥 키를 쓰지 않는다 — `서명`은 Signed(과거분사)다').toContain("'서명@동작'");
    // 옛 형태(템플릿 리터럴로 문장을 조립하던 자리)가 돌아오지 않았는지
    expect(CODE, '문장을 다시 템플릿 리터럴로 조립하고 있다').not.toMatch(/해야 기록이 확정됩니다\.`/);
  });

  it('④ 대조군 — 항목·시각이 없을 때도 문장이 성립한다(빈 자리표시자가 남지 않는다)', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<DraftBanner provenance={{ ...PROV, fields: [], appliedAt: 'not-a-date' }} />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Applied\. Review and edit/);
    expect(text, '값이 안 온 자리표시자가 화면에 그대로 노출됐다').not.toMatch(/\{항목\}|\{시각\}/);
  });
});
