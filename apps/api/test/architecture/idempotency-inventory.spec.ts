import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import {
  IDEMPOTENCY_SEALED_METHODS,
  IDEMPOTENCY_TOTAL_BASELINE,
  IDEMPOTENCY_UNGUARDED_TOTAL,
} from './idempotency-inventory.baseline';
import { IDEMPOTENCY_JUDGMENTS } from './idempotency-judgment';
import { methodBodyOf, scanIdempotency, scanIdempotencySource } from './idempotency-scan';
import { hasNoUnique, schemaFacts } from './prisma-schema-facts';

/**
 * 🔴 재시도·멱등 — 중복을 막지 않는 자리가 **조용히 늘지 않는다**(2026-09-16 J4).
 *
 * 이 저장소가 반복해 당한 모양: 사전처방 재승인 → 처방·오더 한 벌 더 · 조제 취소 반쪽 → 이중 불출 ·
 * 재고 부서청구 재승인 → 이중 차감 · outbox 재시도 표시 실패 → 같은 발송 영원히 반복 ·
 * 항암 사이클 개시 실패 뒤 재시도 → **조제 지시 한 벌 더**(I2 가 기록만 남긴 자리, 이 갈래가 봉합).
 *
 * 🔴 (2026-09-28 재판정 a13360) 무방비 자리마다 **기계가 대조할 수 있는 판정**을 요구한다(`idempotency-judgment.ts`).
 *    종전엔 판정이 문서에만 있어, 거짓 면제 근거 두 갈래(청구·재고 문서번호)가 아무 가드에도 걸리지 않았다.
 */
const MODULES = path.resolve(__dirname, '../../src/modules');
const SRC = path.resolve(__dirname, '../../src');

const readModule = (rel: string) => readFileSync(path.join(MODULES, rel), 'utf8');

/** `src` 전역에서 `.<name>(` 호출을 찾는다(정의 줄 `async name(` 은 `.` 이 없어 제외된다) */
function callSitesInSrc(name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\.${name}\\s*\\(`);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && re.test(readFileSync(p, 'utf8'))) out.push(path.relative(SRC, p));
    }
  };
  walk(SRC);
  return out;
}

describe('🔴 재시도·멱등 — 무방비 자리는 늘지 않는다(정확값 동결)', () => {
  const rows = scanIdempotency(MODULES);
  const unguarded = rows.filter((r) => r.guards.length === 0);
  const key = (f: string, m: string) => `${f}#${m}`;

  it('대조군 — 스캐너가 살아 있다(자리를 실제로 찾는다)', () => {
    expect(rows.length).toBeGreaterThan(50);
    // 교차 서비스 생성도 본다 — 첫 판은 prisma 직접 호출만 보아 항암 조제 지시를 놓쳤다
    expect(rows.some((r) => r.models.some((m) => m.startsWith('svc:')))).toBe(true);
  });

  it('대조군 — 메서드 본문을 실제로 읽는다(파라미터 타입 리터럴에 걸려 본문을 건너뛰지 않는다)', () => {
    // 🔴 첫 판은 `opts?: { overrideGate?: boolean }` 를 본문 시작으로 읽어 startCycle 본문을 통째로 건너뛰었다.
    const chemo = rows.filter((r) => r.file.includes('chemo') && r.method === 'startCycle');
    expect(chemo, 'startCycle 을 못 찾으면 스캐너가 본문을 못 읽는 것이다').toHaveLength(1);
  });

  it('전체 자리 수가 기준선과 같다', () => {
    expect(rows.length).toBe(IDEMPOTENCY_TOTAL_BASELINE);
  });

  it('무방비 자리 수가 기준선과 정확히 같다(늘면 새 위반 · 줄면 기준선을 내려라)', () => {
    expect(unguarded.length).toBe(IDEMPOTENCY_UNGUARDED_TOTAL);
    expect(IDEMPOTENCY_JUDGMENTS.length, '판정 등록부 건수도 같은 수다').toBe(IDEMPOTENCY_UNGUARDED_TOTAL);
  });

  it('🔴 무방비 자리와 판정 등록부가 1:1 이다(누락도 유령도 중복도 실패한다)', () => {
    const scanned = unguarded.map((r) => key(r.file, r.method)).sort();
    const judged = IDEMPOTENCY_JUDGMENTS.map((j) => key(j.file, j.method)).sort();
    expect(new Set(judged).size, '같은 자리를 두 번 판정했다').toBe(judged.length);
    expect(scanned.filter((k) => !judged.includes(k)), '판정 없는 무방비 자리 — 한 건씩 판정해 등록부에 넣어라').toEqual([]);
    expect(judged.filter((k) => !scanned.includes(k)), '스캐너에 없는 판정 — 봉합됐거나 이름이 바뀌었다(리팩터가 계측을 가리는 자리다)').toEqual([]);
  });

  it('🔴 봉합한 자리는 무방비로 돌아오지 않고, 스캐너에서 사라지지도 않는다(메서드 단위)', () => {
    const un = new Set(unguarded.map((r) => key(r.file, r.method)));
    for (const [file, method] of IDEMPOTENCY_SEALED_METHODS) {
      expect(un.has(key(file, method)), `${file}#${method} 가 무방비로 돌아왔다`).toBe(false);
      expect(
        rows.some((r) => r.file === file && r.method === method),
        `${file}#${method} 를 스캐너가 더는 보지 못한다 — 봉합이 아니라 계측이 가려진 것일 수 있다(캠페인 사각 #9)`,
      ).toBe(true);
    }
  });

  it('🔴 제어문을 메서드로 세지 않는다(허수가 기준선에 오르지 않는다)', () => {
    expect(rows.filter((r) => ['if', 'for', 'while', 'switch', 'catch', 'return'].includes(r.method))).toEqual([]);
  });

  it('대조군 — 제어문 제외가 진짜 메서드까지 지우지 않았다', () => {
    for (const [file, method] of [['checkup/checkup.service.ts', 'checkIn'], ['billing/billing.service.ts', 'pay']] as const) {
      expect(rows.some((r) => r.file === file && r.method === method), `${file}#${method} 가 사라졌다`).toBe(true);
    }
  });

  describe('스캐너 픽스처 대조군(스캐너 자신을 검사한다)', () => {
    it('🔴 트랜잭션 클라이언트 이름이 `tx` 가 아니어도(`txc`) 쓰기를 본다', () => {
      const rows2 = scanIdempotencySource('x.service.ts', `class X {
  async f() {
    return this.prisma.$transaction(async (txc) => {
      await txc.prescription.create({ data: {} });
    });
  }
}
`);
      expect(rows2.map((r) => r.method)).toEqual(['f']);
    });

    it('🔴 CSSD 재고 원장(`supplyTransaction`)을 결과 모델로 센다', () => {
      const rows2 = scanIdempotencySource('x.service.ts', `class X {
  async g() {
    await this.prisma.supplyTransaction.create({ data: {} });
  }
}
`);
      expect(rows2.map((r) => r.models)).toEqual([['supplyTransaction']]);
    });

    it('대조군 — 여러 벌이 정상인 로그 모델은 여전히 세지 않는다', () => {
      const rows2 = scanIdempotencySource('x.service.ts', `class X {
  async h() {
    await this.prisma.auditLog.create({ data: {} });
  }
}
`);
      expect(rows2).toEqual([]);
    });
  });
});

describe('🔴 멱등 판정 등록부 — 면제는 기계가 대조할 수 있는 근거를 들고 있다', () => {
  const facts = schemaFacts();

  it('모든 판정이 실재하는 Prisma 모델을 가리킨다', () => {
    for (const j of IDEMPOTENCY_JUDGMENTS) {
      expect(facts[j.model], `${j.file}#${j.method} 의 model ${j.model} 이 schema.prisma 에 없다`).toBeTruthy();
    }
  });

  it('🔴 dbUnique 면제는 스키마에 그 제약이 **실제로 있고 nullable 이 아니다**', () => {
    for (const j of IDEMPOTENCY_JUDGMENTS.filter((x) => x.verdict === 'dbUnique')) {
      expect(j.uniques?.length, `${j.file}#${j.method} — dbUnique 인데 근거 제약이 비었다`).toBeGreaterThan(0);
      const f = facts[j.model];
      for (const u of j.uniques!) {
        if (u.startsWith('[')) {
          const want = u.slice(1, -1).split(',').map((s) => s.trim());
          const hit = f.compositeUniques.find((c) => c.length === want.length && c.every((x, i) => x === want[i]));
          expect(hit, `${j.model} 에 @@unique(${u}) 가 없다`).toBeTruthy();
          for (const field of want) {
            expect(f.fields[field], `${j.model}.${field} 가 nullable 이다 — NULL 은 유니크에서 서로 충돌하지 않는다`).toBe(false);
          }
        } else {
          expect(u in f.singleUniques, `${j.model}.${u} 에 @unique 가 없다`).toBe(true);
          expect(f.singleUniques[u], `${j.model}.${u} 가 nullable @unique 다 — 심판이 되지 못한다(claims.claim_number 가 그랬다)`).toBe(false);
        }
      }
    }
  });

  it('🔴 코드 앵커가 **그 메서드 본문 안에**(주석 제외) 실제로 있다', () => {
    for (const j of IDEMPOTENCY_JUDGMENTS.filter((x) => x.codeAnchor)) {
      const body = methodBodyOf(readModule(j.file), j.method);
      expect(body, `${j.file}#${j.method} 본문을 잘라내지 못했다(동명 메서드이거나 경계가 깨졌다)`).toBeTruthy();
      expect(new RegExp(j.codeAnchor!).test(body!), `${j.file}#${j.method} 에 앵커 /${j.codeAnchor}/ 가 없다 — 판정의 전제가 코드에서 사라졌다`).toBe(true);
    }
    // (2026-10-01) 판정마다 큰 서비스 파일을 읽어 메서드 본문을 잘라낸다 — 단독 1.6초 · 전체 병렬 실행에선 기본 5초를 넘겨
    //   단언 없이 STACK_TRACE_ERROR(시간 초과)로 끊겼다(두 번 연속 실측). 단언은 그대로 · 시간 상한만 올린다.
  }, 30_000);

  it('🔴 앵커는 메서드 이름·시그니처처럼 **늘 있는 것**이 아니다(항상 통과하는 앵커 금지)', () => {
    for (const j of IDEMPOTENCY_JUDGMENTS.filter((x) => x.codeAnchor)) {
      const body = methodBodyOf(readModule(j.file), j.method)!;
      const header = body.slice(0, body.indexOf('{', body.indexOf(')')) + 1);
      expect(new RegExp(j.codeAnchor!).test(header), `${j.file}#${j.method} — 앵커가 메서드 머리(이름·파라미터)에서 맞는다`).toBe(false);
    }
  }, 30_000); // 위와 같은 이유(전체 병렬 실행 시간 초과)

  it('🔴 자연키 없음(noNaturalKey)을 전제로 한 면제는 스키마에 유니크가 하나도 없다', () => {
    for (const j of IDEMPOTENCY_JUDGMENTS.filter((x) => x.noNaturalKey)) {
      expect(hasNoUnique(j.model), `${j.model} 에 유니크가 생겼다 — "자연키가 없다"를 전제로 한 면제를 다시 판정해야 한다`).toBe(true);
    }
  });

  it('🔴 deadCode 면제는 src 전역 호출부가 정말 0 이다', () => {
    for (const j of IDEMPOTENCY_JUDGMENTS.filter((x) => x.noCallers)) {
      expect(callSitesInSrc(j.method), `${j.method} 가 다시 불린다 — 죽은 코드 면제가 무효다`).toEqual([]);
    }
  });

  it('🔴 humanDecision 은 결정 등록부에 실제로 있는 키를 가리킨다(화면에서 고를 수 있다)', () => {
    const keys = new Set(DECISION_REGISTRY.map((d) => d.key));
    const human = IDEMPOTENCY_JUDGMENTS.filter((x) => x.verdict === 'humanDecision');
    expect(human.length, '표본 — 사람 결정 자리가 0 이면 이 검사가 작동하는지 알 수 없다').toBeGreaterThan(0);
    for (const j of human) {
      expect(j.decisionKey, `${j.file}#${j.method} — humanDecision 인데 decisionKey 가 없다`).toBeTruthy();
      expect(keys.has(j.decisionKey!), `${j.decisionKey} 가 결정 등록부에 없다 — 테스트 파일 안 목록은 아무도 못 고른다`).toBe(true);
    }
  });

  it('모든 판정에 기계 대조 근거가 하나 이상 있다(note 만 있는 면제는 없다)', () => {
    for (const j of IDEMPOTENCY_JUDGMENTS) {
      const hasEvidence = Boolean(j.uniques?.length) || Boolean(j.codeAnchor) || Boolean(j.noCallers) || Boolean(j.noNaturalKey);
      expect(hasEvidence, `${j.file}#${j.method} — 근거가 문장뿐이다`).toBe(true);
      expect(j.note.length, `${j.file}#${j.method} — note 가 너무 짧다`).toBeGreaterThan(20);
    }
  });

  describe('대조군', () => {
    it('스키마 파서가 nullable @unique 를 실제로 구분한다 — claims.claimNumber 가 산 표본이다', () => {
      // 🔴 표본을 일부러 남긴다: 전건이 non-nullable 이면 이 검사가 작동하는지 알 수 없다.
      expect(facts.Claim.singleUniques.claimNumber, 'claims.claim_number 는 String? @unique 다').toBe(true);
      expect(facts.InventoryItem.singleUniques.code, 'inventory_items.code 는 non-null @unique 다').toBe(false);
      expect(facts.MealOrder.compositeUniques, '복합 유니크 표본').toContainEqual(['admissionId', 'date', 'mealType']);
    });

    it('앵커 검사가 없는 문자열에는 실패한다(항상 통과하는 검사가 아니다)', () => {
      const body = methodBodyOf(readModule('inventory/inventory.service.ts'), 'createItem')!;
      expect(/code: data\.code/.test(body)).toBe(true);
      expect(/code: __절대_없는_앵커__/.test(body)).toBe(false);
    });

    it('🔴 앵커는 **메서드 밖**의 같은 코드로 대신 통과하지 않는다', () => {
      // `code: data.code` 는 createItem·createStorage·createSupplier 에 모두 있다 — 파일 전체에서 찾으면
      // createItem 의 그 줄을 지워도 초록이다.
      const src = readModule('inventory/inventory.service.ts');
      expect((src.match(/code: data\.code/g) ?? []).length, '파일 전체에는 같은 앵커가 여럿이다').toBeGreaterThan(1);
      expect((methodBodyOf(src, 'createItem')!.match(/code: data\.code/g) ?? []).length, '본문 안에서는 하나다').toBe(1);
    });

    it('🔴 앵커가 주석으로 대신 통과하지 않는다(주석은 지운 판에서 찾는다)', () => {
      // cssd-po.receive 의 주석에는 옛 코드 `['APPROVED','RECEIVED']` 가 적혀 있다 — 표본을 일부러 남긴 자리다.
      const src = readModule('cssd/cssd-po.service.ts');
      expect(/\['APPROVED','RECEIVED'\]/.test(src), '주석에 옛 코드가 남아 있어야 이 대조군이 뜻을 갖는다').toBe(true);
      const body = methodBodyOf(src, 'receive')!;
      expect(/\['APPROVED','RECEIVED'\]/.test(body), '주석이 지워진 판이어야 한다').toBe(false);
      expect(/po\.status !== 'APPROVED'/.test(body), '진짜 코드는 남아 있어야 한다').toBe(true);
    });

    it('없는 메서드·동명 메서드는 고르지 않고 null 이다(이름으로 엉뚱한 자리를 집지 않는다)', () => {
      expect(methodBodyOf(readModule('inventory/inventory.service.ts'), '__없는_메서드__')).toBeNull();
      expect(methodBodyOf(`class X {\n  a() { return 1; }\n  a() { return 2; }\n}\n`, 'a')).toBeNull();
    });

    it('호출부 탐색이 살아 있는 메서드는 실제로 찾는다', () => {
      expect(callSitesInSrc('createInpatientStayBilling').length).toBeGreaterThan(0);
    });
  });
});
