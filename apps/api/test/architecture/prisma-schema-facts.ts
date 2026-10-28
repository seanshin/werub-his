import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * `prisma/schema.prisma` 에서 **유니크 제약과 필드 nullability** 만 읽어 오는 최소 파서(2026-09-28 재판정 a13360).
 *
 * 🔴 왜 필요한가 — 멱등 면제 근거 대부분이 "DB 유니크가 막는다"인데, 그 근거가 **문서에만** 있었다
 *    (`docs/04-report/idempotency-triage-2026-09-16.md`). 문서는 스키마가 바뀌어도 아무 말을 하지 않는다
 *    (2026-09-16 캠페인 계측 사각 #4 — "면제 목록이 이름만이면 그 자리의 대조 코드를 지워도 통과한다").
 * 🔴 nullability 를 함께 읽는 이유 — `claims.claim_number` 는 `String?` 에 `@unique` 다. PostgreSQL 유니크 인덱스에서
 *    **NULL 끼리는 충돌하지 않는다.** 게다가 생성 시 채워지지도 않는다. "claimNumber @unique 가 막는다"는 종전 면제
 *    근거는 그래서 사실이 아니었다 — 이 파서가 그런 거짓 근거를 테스트에서 걸리게 한다.
 * 🔴 `@@unique(fields: [...])` 형태는 읽지 않는다(2026-09-28 스키마 실측 0건). 생기면 대조군이 먼저 실패하게
 *    스펙이 복합 유니크 표본(`MealOrder`)을 못박는다.
 */
export interface ModelFacts {
  /** 단일 필드 @unique — 필드명 → nullable 여부 */
  singleUniques: Record<string, boolean>;
  /** @@unique([a, b]) — 필드 목록 */
  compositeUniques: string[][];
  /** 필드명 → nullable 여부(`Type?`) */
  fields: Record<string, boolean>;
}

const SCHEMA = path.resolve(__dirname, '../../prisma/schema.prisma');

let cache: Record<string, ModelFacts> | null = null;

export function schemaFacts(): Record<string, ModelFacts> {
  if (cache) return cache;
  const src = readFileSync(SCHEMA, 'utf8');
  const out: Record<string, ModelFacts> = {};
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const facts: ModelFacts = { singleUniques: {}, compositeUniques: [], fields: {} };
    for (const raw of m[2].split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      const comp = line.match(/^@@unique\(\s*\[([^\]]+)\]/);
      if (comp) {
        facts.compositeUniques.push(comp[1].split(',').map((s) => s.trim()).filter(Boolean));
        continue;
      }
      if (line.startsWith('@@')) continue;
      const f = line.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?/);
      if (!f) continue;
      facts.fields[f[1]] = Boolean(f[4]);
      if (/@unique\b/.test(line)) facts.singleUniques[f[1]] = Boolean(f[4]);
    }
    out[m[1]] = facts;
  }
  cache = out;
  return out;
}

/** 모델에 유니크 제약이 하나도 없는가(= 재제출을 구분할 자연키가 스키마에 없다) */
export function hasNoUnique(model: string): boolean {
  const f = schemaFacts()[model];
  if (!f) throw new Error(`schema.prisma 에 model ${model} 이 없다`);
  return Object.keys(f.singleUniques).length === 0 && f.compositeUniques.length === 0;
}
