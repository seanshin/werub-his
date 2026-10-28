import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodeSynonymService } from '../../src/modules/code-master/code-synonym.service';
import { DIAGNOSIS_SYNONYM_SEED } from '../../src/modules/code-master/builtin-synonyms';
import {
  isShortLatinQuery,
  normalizeTerm,
  wordBoundaryPattern,
} from '../../src/common/code-search';

/**
 * C4/F5 — 약어를 치면 **없는 것이 아니라 전혀 다른 것**이 나오던 것(2026-08-26 운영 실측).
 *   `AMI`→248건(1위 "일반 성인 의학적 검사"=ex**AMI**nation) · `HTN`→11건(전부 "**벼락**"=lig**HTN**ing)
 *   `PE` →7,592건 · `RA`→5,525건 — 단어 단위로는 **전부 0건**이었다.
 *
 * 🔴 0건보다 나쁘다. 화면이 자신 있게 틀린 답을 준다.
 */
const SVC = join(process.cwd(), 'src/modules/code-master/code-synonym.service.ts');
const DICT = join(process.cwd(), 'src/modules/code-master/builtin-synonyms.ts');

/** 목은 정본이 실제로 부르는 모양 그대로 만든다(가정한 모양을 테스트하면 가드가 헛돈다) */
const mk = (opts: {
  synonyms?: { term: string; expandsTo: string | null; code: string | null; kind: string }[];
  boundary?: { id: string }[];
  wideCount?: number;
  synonymFails?: boolean;
  rawFails?: boolean;
}) => {
  const findMany = vi.fn().mockImplementation(() =>
    opts.synonymFails ? Promise.reject(new Error('db down')) : Promise.resolve(opts.synonyms ?? []),
  );
  const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
    if (opts.rawFails) return Promise.reject(new Error('raw down'));
    if (sql.includes('count(*)')) return Promise.resolve([{ n: BigInt(opts.wideCount ?? 0) }]);
    return Promise.resolve(opts.boundary ?? []);
  });
  return {
    prisma: {
      codeSynonym: { findMany, createMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      $queryRawUnsafe: queryRawUnsafe,
    } as never,
    queryRawUnsafe,
  };
};

describe('약어 검색 좁힘', () => {
  it('짧은 라틴 질의만 좁힘 대상이다 — 한글은 부분일치 노이즈가 적다', () => {
    expect(isShortLatinQuery('AMI')).toBe(true);
    expect(isShortLatinQuery('PE')).toBe(true);
    // 대조군 — 이것들을 좁히면 정상 검색이 망가진다
    expect(isShortLatinQuery('당뇨')).toBe(false);
    expect(isShortLatinQuery('diabetes')).toBe(false);
    expect(isShortLatinQuery('A')).toBe(false);
  });

  it('단어 경계 패턴은 정규식 메타문자를 이스케이프한다', () => {
    expect(wordBoundaryPattern('AMI')).toBe('\\yAMI\\y');
    expect(wordBoundaryPattern('a.b*')).toBe('\\ya\\.b\\*\\y');
  });

  it('🔴 좁혔는데 결과가 없으면 **자동으로 되넓히지 않는다** — 몇 건인지만 말한다', async () => {
    const { prisma } = mk({ boundary: [], wideCount: 7592 });
    const svc = new CodeSynonymService(prisma);
    const plan = await svc.plan('DiagnosisCode', 'PE');
    expect(plan.narrowed).toBe(true);
    expect(plan.boundaryIds).toEqual([]);
    expect(plan.widenedByRequest).toBe(false);
    expect(plan.wideCount).toBe(7592);
    expect(plan.narrowNote).toMatch(/단어 단위로는 찾지 못했습니다/);
  });

  it('사람이 넓혀 달라고 하면 넓히되 **넓혔다고 말한다**', async () => {
    const { prisma } = mk({ boundary: [], wideCount: 7592 });
    const svc = new CodeSynonymService(prisma);
    const plan = await svc.plan('DiagnosisCode', 'PE', { wide: true });
    expect(plan.widenedByRequest).toBe(true);
    expect(plan.boundaryIds).toBeNull();
    expect(plan.narrowNote).toMatch(/섞여/);
  });

  it('대조군 — 긴 질의는 좁히지도, 안내하지도 않는다(늘 붙는 안내는 읽히지 않는다)', async () => {
    const { prisma, queryRawUnsafe } = mk({});
    const svc = new CodeSynonymService(prisma);
    const plan = await svc.plan('DiagnosisCode', '당뇨병');
    expect(plan.narrowed).toBe(false);
    expect(plan.narrowNote).toBeNull();
    expect(queryRawUnsafe).not.toHaveBeenCalled();
    expect(CodeSynonymService.describe(plan)).toBeUndefined();
  });

  it('🔴 좁히지 **못했으면** 좁혔다고 말하지 않는다(넓은 결과를 좁은 척하면 더 나쁘다)', async () => {
    const { prisma } = mk({ rawFails: true });
    const svc = new CodeSynonymService(prisma);
    const plan = await svc.plan('DiagnosisCode', 'AMI');
    expect(plan.narrowed).toBe(false);
    expect(plan.boundaryIds).toBeNull();
  });
});

describe('동의어 확장', () => {
  it('승인된 확장어가 있으면 좁히지 않고 그 말로도 찾는다', async () => {
    const { prisma } = mk({
      synonyms: [{ term: 'HTN', expandsTo: '고혈압', code: null, kind: 'ABBREVIATION' }],
    });
    const svc = new CodeSynonymService(prisma);
    const plan = await svc.plan('DiagnosisCode', 'HTN');
    expect(plan.terms).toEqual(['HTN', '고혈압']);
    expect(plan.narrowed).toBe(false);
    expect(CodeSynonymService.describe(plan)?.synonyms[0].expandsTo).toBe('고혈압');
  });

  it('🔴 조회에 실패했다고 "동의어 없음"으로 번역하지 않는다 — 확장 없이 원 질의로 간다', async () => {
    const { prisma } = mk({ synonymFails: true });
    const svc = new CodeSynonymService(prisma);
    const plan = await svc.plan('DiagnosisCode', 'HTN');
    expect(plan.terms).toEqual(['HTN']);
    expect(plan.via).toEqual([]);
  });

  it('APPROVED 만 검색에 쓴다 — 조회 조건이 그렇게 되어 있다', () => {
    const src = readFileSync(SVC, 'utf8');
    expect(src).toMatch(/status:\s*'APPROVED'/);
  });

  it('정규화는 대소문자·공백·기호를 접는다', () => {
    expect(normalizeTerm('  G E R D ')).toBe('gerd');
    expect(normalizeTerm('COPD')).toBe(normalizeTerm('c.o.p.d'));
  });
});

describe('기본 사전', () => {
  const dict = readFileSync(DICT, 'utf8');

  it('🔴 전부 검토 전(PROPOSED)으로만 들어온다 — 배포가 검색을 바꾸지 않는다', () => {
    const src = readFileSync(SVC, 'utf8');
    expect(src).toMatch(/status:\s*'PROPOSED'/);
    // 대조군: 시드가 자기를 승인하는 자리가 없어야 한다
    expect(dict).not.toMatch(/APPROVED/);
  });

  it('🔴 어느 코드인지 지목하지 않는다 — 임상 판단은 사람이 한다', () => {
    const src = readFileSync(SVC, 'utf8');
    expect(src).toMatch(/code:\s*null,\s*\n\s*codeKey:\s*'',/);
  });

  it('🔴 확장어가 무엇을 찾는지 실측 건수를 함께 담았다(0건 확장어는 담지 않는다)', () => {
    expect(DIAGNOSIS_SYNONYM_SEED.length).toBeGreaterThan(20);
    for (const s of DIAGNOSIS_SYNONYM_SEED) {
      expect(s.measuredHits, `${s.term} → ${s.expandsTo}`).toBeGreaterThan(0);
      expect(s.expandsTo.trim()).not.toBe('');
      expect(normalizeTerm(s.expandsTo)).not.toBe(normalizeTerm(s.term));
    }
  });

  it('같은 term 이 두 번 들어 있지 않다(유니크 키가 term 이라 조용히 하나가 사라진다)', () => {
    const keys = DIAGNOSIS_SYNONYM_SEED.map((s) => normalizeTerm(s.term));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('🔴 이미 있는 항목은 건드리지 않는다 — 반려한 것을 되살리지 않는다', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      codeSynonym: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            DIAGNOSIS_SYNONYM_SEED.map((s) => ({
              termNorm: normalizeTerm(s.term),
              codeKey: '',
              status: 'REJECTED',
            })),
          ),
        createMany,
      },
    } as never;
    const svc = new CodeSynonymService(prisma);
    const res = await svc.loadBuiltinDictionary('u1');
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(DIAGNOSIS_SYNONYM_SEED.length);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('대조군 — 비어 있으면 전부 등재된다(무조건 건너뛰지 않는다)', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      codeSynonym: { findMany: vi.fn().mockResolvedValue([]), createMany },
    } as never;
    const svc = new CodeSynonymService(prisma);
    const res = await svc.loadBuiltinDictionary('u1');
    expect(res.created).toBe(DIAGNOSIS_SYNONYM_SEED.length);
    expect(createMany).toHaveBeenCalledOnce();
  });
});

describe('유니크 키', () => {
  it('🔴 NULL 은 유니크로 막히지 않아 codeKey 사본으로 접는다', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(/@@unique\(\[sourceTable, termNorm, codeKey\]\)/);
  });
});
