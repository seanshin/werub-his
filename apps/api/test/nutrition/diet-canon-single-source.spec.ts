/**
 * 🔴 식이 코드 정본이 **둘**이었고 서로 다른 코드를 들고 있었다 — 배식에 직결.
 *
 * 2026-08-27 실측:
 *   · `apps/api/src/modules/nutrition/diet-types.ts` 는 자기 머리에 "단일 소스"라 적어 두고
 *     저염식 `LOW_SODIUM` · 간장식 `LIVER` 를 썼다. 저단백식은 목록에 **없었다**.
 *   · shared 정본·FE 3화면·`prisma/seed.ts` 가 실제로 쓰는 값은 `LOW_SALT`·`HEPATIC`·`LOW_PROTEIN`.
 *   · `LOW_SODIUM` 은 저장소 전체에서 **그 파일 단 한 줄**(소비처 0)이었다.
 *   → `normalizeDietLabel('LOW_SALT')` 가 라벨을 못 찾아 **영문 코드를 그대로** 냈다.
 *
 * 재주입: `diet-types.ts` 에 자기 코드 리터럴(`LOW_SODIUM` 등)을 다시 넣거나,
 *         shared 정본에서 `LOW_SALT`/`HEPATIC`/`LOW_PROTEIN` 을 빼면 이 파일이 실패한다.
 * 대조군: 정본에 없는 코드가 조용히 "정본"으로 통과하지 않는지 함께 본다
 *         (전부 통과하는 가드는 아무것도 보증하지 않는다).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  DIET_TYPE_LABEL,
  DIET_TYPE_CODES,
  DIET_TYPES,
  DIET_TYPE_CODE_ALIAS,
  dietCodeOf,
  dietTypeText,
  normalizeDietLabel,
} from '@hospital-run/shared';
import * as apiDietTypes from '../../src/modules/nutrition/diet-types';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const API_DIET_TYPES = path.join(REPO, 'apps/api/src/modules/nutrition/diet-types.ts');

/** 실제로 쓰이고 있는 것이 확인된 파일들 — 여기 있는 식이 코드는 전부 정본이 알아야 한다. */
const CONSUMER_FILES = [
  'apps/web/src/app/(main)/inpatient/page.tsx',
  'apps/web/src/app/(main)/workstation/nutrition/page.tsx',
  'apps/web/src/app/(main)/nutrition/components/NutritionAdvanced.tsx',
  'apps/api/prisma/seed.ts',
];

/** 식이 맥락에서만 코드로 읽는다 — 다른 도메인(장기이식 `LIVER` 등)과 섞이지 않게 목록을 못 박는다. */
const DIET_CODE_TOKENS = [
  'REGULAR', 'LOW_SALT', 'LOW_SODIUM', 'DIABETIC', 'LOW_FAT', 'SOFT', 'LIQUID', 'CLEAR_LIQUID',
  'NPO', 'RENAL', 'HEPATIC', 'HIGH_PROTEIN', 'LOW_PROTEIN', 'LOW_RESIDUE', 'PUREED',
  'TUBE_FEEDING', 'TPN',
];

describe('식이 코드 정본은 shared 하나다', () => {
  it('🔴 api 모듈은 자기 코드표를 갖지 않는다 — shared 재수출만 한다', () => {
    const src = fs.readFileSync(API_DIET_TYPES, 'utf8');
    // 주석은 사건 경위를 적어야 하므로 제외하고, 실행되는 코드만 본다.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const declared = DIET_CODE_TOKENS.filter((t) => new RegExp(`['"\`]${t}['"\`]`).test(code));
    expect(declared, `diet-types.ts 가 자기 코드 리터럴을 다시 선언했다: ${declared.join(', ')}`).toEqual([]);
    expect(code).toMatch(/from\s+'@hospital-run\/shared'/);
  });

  it('🔴 재수출된 표가 shared 정본과 같은 객체다(복사본이면 갈라진다)', () => {
    expect(apiDietTypes.DIET_LABEL).toBe(DIET_TYPE_LABEL);
    expect(apiDietTypes.DIET_TYPES).toBe(DIET_TYPES);
    expect(apiDietTypes.normalizeDietLabel).toBe(normalizeDietLabel);
  });

  it('코드 목록과 라벨표의 집합이 일치한다 — 한쪽만 늘리면 옵션이 조용히 빠진다', () => {
    expect([...DIET_TYPE_CODES].sort()).toEqual(Object.keys(DIET_TYPE_LABEL).sort());
    expect(DIET_TYPES.map((d) => d.code)).toEqual([...DIET_TYPE_CODES]);
    for (const d of DIET_TYPES) expect(d.label).toBe(DIET_TYPE_LABEL[d.code]);
  });
});

describe('🔴 실제로 쓰이는 코드가 전부 라벨을 찾는다', () => {
  it('FE 옵션·시드에 등장하는 식이 코드는 영문으로 새지 않는다', () => {
    const leaked: string[] = [];
    for (const rel of CONSUMER_FILES) {
      const p = path.join(REPO, rel);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const token of DIET_CODE_TOKENS) {
        if (!new RegExp(`['"\`]${token}['"\`]`).test(src)) continue;
        // 한글이 나와야 한다 = 라벨을 찾았다. 영문 원문이 그대로면 샌 것이다.
        if (dietTypeText(token) === token) leaked.push(`${rel}: ${token}`);
      }
    }
    expect(leaked, `라벨 없이 영문으로 새는 식이 코드: ${leaked.join(' / ')}`).toEqual([]);
  });

  it('갈라져 있던 저염식·간장식·저단백식이 모두 한글로 나온다', () => {
    expect(dietTypeText('LOW_SALT')).toBe('저염식');
    expect(dietTypeText('HEPATIC')).toBe('간장식');
    expect(dietTypeText('LOW_PROTEIN')).toBe('저단백식');
    expect(normalizeDietLabel('LOW_SALT')).toBe('저염식');
  });

  it('레거시 코드는 **읽기만** 된다 — 라벨은 찾되 선택지에는 없다', () => {
    for (const [legacy, canon] of Object.entries(DIET_TYPE_CODE_ALIAS)) {
      expect(dietTypeText(legacy)).toBe(DIET_TYPE_LABEL[canon]);
      expect(dietCodeOf(legacy)).toBe(canon);
      expect(DIET_TYPES.map((d) => d.code)).not.toContain(legacy);
    }
  });

  it('한글로 저장된 레거시 값도 그대로 살아 있다 — 기록을 지우지 않는다', () => {
    expect(dietTypeText('저단백식(CKD)')).toBe('저단백식(CKD)');
    expect(dietCodeOf('저염식')).toBe('LOW_SALT');
  });
});

describe('대조군 — 무조건 통과하지 않는다', () => {
  it('정본에 없는 코드는 정본으로 인정되지 않는다', () => {
    expect(dietCodeOf('MARS_DIET')).toBeNull();
    expect(dietCodeOf('')).toBeNull();
    expect(dietCodeOf(null)).toBeNull();
  });

  it('모르는 값은 뭉개지 않고 그대로 돌려준다(한글로 지어내지 않는다)', () => {
    expect(dietTypeText('MARS_DIET')).toBe('MARS_DIET');
  });

  it('가드가 쓰는 스캔 토큰 목록 자체가 비지 않았다', () => {
    expect(DIET_CODE_TOKENS.length).toBeGreaterThanOrEqual(16);
    expect(CONSUMER_FILES.filter((f) => fs.existsSync(path.join(REPO, f))).length).toBeGreaterThanOrEqual(3);
  });
});
