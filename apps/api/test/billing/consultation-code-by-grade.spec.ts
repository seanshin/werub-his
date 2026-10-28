/**
 * 진찰료 코드 = 요양기관 종별 정본(2026-10-20 · 운영 진찰료 단가 정리).
 *  · 🔴 종전: 청구 생성·계산 패널·예상 진료비·원격진료·FFS 견적이 종별과 무관하게 상급종합 코드 AA157/AA257 —
 *    운영 수가 마스터엔 AA157 이 없고 AA257 은 0원이라 초진 진찰료 누락·재진 0원 라인(실측 7건)이 났다
 *  · 이제 `billing.institution.grade`(미설정 = 의원 — 시스템의 나머지와 같은 기본) → 종별 코드 · 모르는 값은 짐작하지 않는다(null)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { consultationFeeCodes, CONSULTATION_FEE_CODES_BY_GRADE, ALL_CONSULTATION_FEE_CODES } from '@hospital-run/shared';
import { consultationCodeFor } from '../../src/modules/billing/consultation-code';

describe('🔴 종별 → 진찰료 코드', () => {
  it('고시 명칭과 같은 표(운영 수가 마스터 대조) · 미설정 = 의원 · 소문자 허용 · 표 밖 = null', () => {
    expect(CONSULTATION_FEE_CODES_BY_GRADE).toEqual({
      CLINIC: { initial: 'AA154', followUp: 'AA254' },
      HOSPITAL: { initial: 'AA155', followUp: 'AA255' },
      GENERAL: { initial: 'AA156', followUp: 'AA256' },
      TERTIARY: { initial: 'AA157', followUp: 'AA257' },
    });
    for (const unset of [null, undefined, '', '  ']) expect(consultationFeeCodes(unset)).toEqual({ initial: 'AA154', followUp: 'AA254' });
    expect(consultationFeeCodes('tertiary')).toEqual({ initial: 'AA157', followUp: 'AA257' });
    expect(consultationFeeCodes('DENTAL')).toBeNull();
    expect(consultationCodeFor(undefined, false)).toBe('AA254');
    expect(consultationCodeFor('HOSPITAL', true)).toBe('AA155');
    expect(consultationCodeFor('??', true)).toBeNull();
  });
  it('영수증 분류용 집합 = 표의 코드 8개 전부(옛 청구의 AA157·AA257 포함)', () => {
    expect([...ALL_CONSULTATION_FEE_CODES].sort()).toEqual(['AA154', 'AA155', 'AA156', 'AA157', 'AA254', 'AA255', 'AA256', 'AA257']);
  });
  it('🔴 구조 — api 소스에 진찰료 코드 리터럴이 남지 않는다(다섯 소비처 모두 종별 정본 경유)', () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
          if (/['"]AA(15[4-7]|25[4-7])['"]/.test(code)) hits.push(p);
        }
      }
    };
    walk('src');
    expect(hits).toEqual([]);
    for (const f of ['src/modules/billing/billing.service.ts', 'src/modules/billing-advanced/billing-advanced.service.ts', 'src/modules/telehealth/telehealth.service.ts']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/consultationCodeFor\(/);
    }
  });
});
