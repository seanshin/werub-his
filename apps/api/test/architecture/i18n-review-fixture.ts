import { TranslationOverrideStatus } from '@prisma/client';
import { codeEntriesFor } from '../../src/modules/i18n-review/catalog-source';
import { I18nReviewService } from '../../src/modules/i18n-review/i18n-review.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * 언어팩 사람 검수 가드 공용 픽스처.
 *
 * 🔴 **목(mock)은 정본의 실제 반환 모양을 쓴다** — 내가 가정한 모양을 테스트하면 가드가 헛돈다
 *    (이 저장소가 수술기록 `ebl` 에서 실제로 당한 것: 단위 테스트는 통과했고 실파이프는 400 이었다).
 *    그래서 이 가짜 Prisma 는 ① `select` 를 실제로 적용하고(선언 안 한 필드는 **주지 않는다**)
 *    ② 날짜를 `Date` 로 ③ 상태를 `@prisma/client` 의 enum 값으로 돌려준다.
 * 🔴 카탈로그 키도 지어내지 않는다 — 정본(`codeEntriesFor`)에서 실제 키를 꺼내 쓴다.
 */

export interface FakeOverride {
  id: string;
  locale: string;
  key: string;
  area: string;
  draftValue: string;
  baseValue: string | null;
  status: TranslationOverrideStatus;
  note: string | null;
  proposedBy: string | null;
  proposedAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  mergedAt: Date | null;
  updatedAt: Date;
}

export interface FakeTransition {
  id: string;
  overrideId: string;
  fromStatus: TranslationOverrideStatus | null;
  toStatus: TranslationOverrideStatus;
  actorId: string | null;
  at: Date;
  reason: string | null;
}

/** 코드에 실제 번역이 있는 키 하나 — 지어낸 키로 테스트하면 "카탈로그에 없는 키" 분기로 새어 나간다 */
export function realTranslatedKey(locale: string): { key: string; area: string; value: string } {
  for (const ce of codeEntriesFor(locale).values()) {
    if (ce.value) return { key: ce.key, area: ce.area, value: ce.value };
  }
  throw new Error(`${locale} 카탈로그에 번역된 키가 없다 — 픽스처 전제가 깨졌다`);
}

function pick<T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [k, on] of Object.entries(select)) if (on) out[k] = row[k];
  return out as Partial<T>;
}

function matchesWhere(row: Record<string, unknown>, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    const v = row[k];
    if (cond && typeof cond === 'object' && 'in' in (cond as Record<string, unknown>)) {
      if (!(cond as { in: unknown[] }).in.includes(v)) return false;
    } else if (cond !== undefined && v !== cond) return false;
  }
  return true;
}

export interface FakeState {
  overrides: FakeOverride[];
  transitions: FakeTransition[];
  users: Array<{ id: string; familyName: string; givenName: string }>;
  /** `i18n.reviewers` 설정값. `throw` 로 두면 조회가 **실패**한다(없음과 다른 사실) */
  reviewersConfig: Record<string, string[]> | null | 'throw';
  /** 서비스가 실제로 넘긴 where 절 — "APPROVED 만 조회했는가"를 가드가 직접 본다 */
  overrideFindManyWhere: Array<Record<string, unknown>>;
}

export function makeFakePrisma(state: FakeState) {
  let seq = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const api = {
    systemConfig: {
      findUnique: async () => {
        if (state.reviewersConfig === 'throw') throw new Error('DB unavailable');
        if (state.reviewersConfig == null) return null;
        return { value: state.reviewersConfig };
      },
    },
    translationOverride: {
      findMany: async (args?: { where?: Record<string, unknown>; select?: Record<string, boolean>; orderBy?: unknown }) => {
        if (args?.where) state.overrideFindManyWhere.push(args.where);
        return state.overrides
          .filter((o) => matchesWhere(o as unknown as Record<string, unknown>, args?.where))
          .map((o) => pick(o as unknown as Record<string, unknown>, args?.select));
      },
      findUnique: async (args: { where: { id?: string; locale_key?: { locale: string; key: string } } }) => {
        const w = args.where;
        const hit = w.id
          ? state.overrides.find((o) => o.id === w.id)
          : state.overrides.find((o) => o.locale === w.locale_key!.locale && o.key === w.locale_key!.key);
        return hit ? { ...hit } : null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const row: FakeOverride = {
          id: nextId(),
          locale: '',
          key: '',
          area: '',
          draftValue: '',
          baseValue: null,
          status: TranslationOverrideStatus.PROPOSED,
          note: null,
          proposedBy: null,
          proposedAt: new Date(),
          reviewedBy: null,
          reviewedAt: null,
          mergedAt: null,
          updatedAt: new Date(),
          ...(args.data as Partial<FakeOverride>),
        };
        state.overrides.push(row);
        return { ...row };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.overrides.find((o) => o.id === args.where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, args.data, { updatedAt: new Date() });
        return { ...row };
      },
    },
    translationOverrideTransition: {
      create: async (args: { data: Record<string, unknown> }) => {
        const row: FakeTransition = {
          id: nextId(),
          overrideId: '',
          fromStatus: null,
          toStatus: TranslationOverrideStatus.PROPOSED,
          actorId: null,
          at: new Date(),
          reason: null,
          ...(args.data as Partial<FakeTransition>),
        };
        state.transitions.push(row);
        return { ...row };
      },
      findMany: async (args?: { where?: Record<string, unknown>; select?: Record<string, boolean>; orderBy?: { at?: 'asc' | 'desc' } }) => {
        const rows = state.transitions.filter((t) => matchesWhere(t as unknown as Record<string, unknown>, args?.where));
        rows.sort((a, b) => (args?.orderBy?.at === 'desc' ? b.at.getTime() - a.at.getTime() : a.at.getTime() - b.at.getTime()));
        return rows.map((t) => pick(t as unknown as Record<string, unknown>, args?.select));
      },
    },
    user: {
      findMany: async (args: { where: { id: { in: string[] } }; select?: Record<string, boolean> }) =>
        state.users.filter((u) => args.where.id.in.includes(u.id)).map((u) => pick(u as unknown as Record<string, unknown>, args.select)),
    },
    // 🔴 실제 `$transaction(fn)` 은 tx 클라이언트를 넘긴다 — 같은 API 표면을 넘겨야 목이 헛돌지 않는다
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(api),
  };
  return api;
}

export function emptyState(over: Partial<FakeState> = {}): FakeState {
  return {
    overrides: [],
    transitions: [],
    users: [],
    reviewersConfig: null,
    overrideFindManyWhere: [],
    ...over,
  };
}

export function makeService(state: FakeState): I18nReviewService {
  return new I18nReviewService(makeFakePrisma(state) as unknown as PrismaService);
}

export function overrideRow(over: Partial<FakeOverride> & { locale: string; key: string }): FakeOverride {
  return {
    id: '00000000-0000-4000-9000-000000000001',
    area: 'common',
    draftValue: '검수자가 고친 값',
    baseValue: null,
    status: TranslationOverrideStatus.PROPOSED,
    note: null,
    proposedBy: null,
    proposedAt: new Date('2026-09-09T01:00:00Z'),
    reviewedBy: null,
    reviewedAt: null,
    mergedAt: null,
    updatedAt: new Date('2026-09-09T01:00:00Z'),
    ...over,
  };
}
