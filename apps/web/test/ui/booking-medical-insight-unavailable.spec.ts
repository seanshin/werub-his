import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 예약 챗 '참고 안내' 카드가 미가용을 **말한다** — 외부 점검.
 *
 * 종전 `MedicalInsightCard` 는 `answer` 가 없으면 `return null` — 상류가 401/404 로 늘 실패해도 화면은 침묵했고
 * 환자는 "원래 없는 것"으로 읽었다. 서버는 이제 `medicalInsight.source` 3상태를 payload 에 싣고(문장은 붙이지 않는다),
 * 이 카드가 `UNAVAILABLE` 을 읽어 한 줄로 말한다. 답은 지어내지 않는다.
 *
 * (homepage) 그룹은 i18n 프로바이더가 없는 한국어 공개 페이지라 문구가 페이지 규약(정적 한국어)을 따른다 — 이 가드는
 * 그 문구가 아니라 **분기의 존재와 순서**를 본다: `UNAVAILABLE` 분기가 `!insight?.answer → null` 보다 **앞**에 있어야 한다.
 */
const PAGE = join(process.cwd(), 'src', 'app', '(homepage)', 'booking', 'page.tsx');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('booking MedicalInsightCard — UNAVAILABLE 을 침묵으로 옮기지 않는다', () => {
  const src = strip(readFileSync(PAGE, 'utf8'));
  const start = src.indexOf('function MedicalInsightCard(');
  const end = src.indexOf('function UiDirectiveRenderer(');
  const card = src.slice(start, end);

  it('대조군 — 카드 본문을 실제로 잘라냈다', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(card).toContain('return null');
  });

  it('🔴 UNAVAILABLE 분기가 있고, answer 없음 → null 보다 앞에 온다(뒤에 있으면 도달 불가 코드다)', () => {
    const unavailable = card.indexOf("insight?.source === 'UNAVAILABLE'");
    const silent = card.indexOf('if (!insight?.answer) return null');
    expect(unavailable).toBeGreaterThan(0);
    expect(silent).toBeGreaterThan(unavailable);
  });

  it('🔴 미가용 분기는 답을 지어내지 않는다 — answer 를 그리지 않고 표식만 낸다', () => {
    const branch = card.slice(card.indexOf("insight?.source === 'UNAVAILABLE'"), card.indexOf('if (!insight?.answer) return null'));
    expect(branch).toContain('data-medical-insight="unavailable"');
    expect(branch).not.toMatch(/insight\.answer/);
  });

  it('payload 타입이 출처 3상태를 안다(서버 계약과 같은 어휘)', () => {
    expect(src).toMatch(/source\?: 'AI' \| 'FALLBACK' \| 'UNAVAILABLE'/);
  });
});
