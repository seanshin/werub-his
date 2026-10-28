#!/usr/bin/env node
/**
 * LoopSpec 인스턴스 ↔ 스키마 기계 검증 (L0 역기술 파일럿 · 2026-08-20)
 *
 * 🔴 스키마 원본은 이 저장소 밖에 있다(`~/Downloads/loopspec.schema.json`) — 복사하지 않는다.
 *    (계획서 `loop-platform-adoption.plan.md` §0: 외부 설계서 원문은 저장소 밖이 정본)
 *
 * 두 번 돌린다:
 *   run A — 파일 그대로. 실물에 대응물이 없거나 하드락(설계서 §6.2)인 필드는 **비어 있다.**
 *           여기서 나오는 에러 목록이 곧 "스키마가 요구하지만 우리 실물이 채울 수 없는 것"이다.
 *   run B — run A 에 자리표시 오버레이를 덮는다. 통과하면 "나머지 역기술은 스키마와 형식상 맞다"가 증명된다.
 *           🔴 오버레이 값은 **전부 가짜**다 — 이 파일 밖으로 나가면 안 된다.
 *
 * 사용: node scripts/loopspec-validate.mjs [스키마경로] [인스턴스경로]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const YAML = require('js-yaml');

const schemaPath = process.argv[2] ?? resolve(homedir(), 'Downloads/loopspec.schema.json');
const instPath = process.argv[3] ?? resolve(process.cwd(), 'docs/01-plan/features/loopspec-pilot-interpret-lab.yaml');

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const instance = YAML.load(readFileSync(instPath, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

/** 🔴 전부 가짜 값 — 사람 게이트/하드락 자리를 메워 "나머지가 맞는가"만 보기 위한 것 */
const OVERLAY = {
  metadata: { version: '2026.08.1', owners: { clinical: '__PLACEHOLDER__', engineering: '__PLACEHOLDER__' } },
  spec: {
    risk: { tier: 2 },
    context: { auth: { mode: 'on_behalf_of' } },
    budgets: { latency: { p95_ms: 30000 } },
    rollout: { kill_switch: { auto_trip: [{ threshold: 0.5 }] } },
  },
};

function deepMerge(base, over) {
  if (Array.isArray(base) && Array.isArray(over)) {
    return base.map((v, i) => (over[i] === undefined ? v : deepMerge(v, over[i])));
  }
  if (base && over && typeof base === 'object' && typeof over === 'object' && !Array.isArray(base)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
    return out;
  }
  return over === undefined ? base : over;
}

function run(label, doc) {
  const ok = validate(doc);
  const errs = ok ? [] : validate.errors;
  console.log(`\n=== ${label} === ${ok ? 'PASS' : `FAIL (${errs.length}건)`}`);
  for (const e of errs) {
    const where = e.instancePath || '(root)';
    const extra = e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : '';
    console.log(`  - ${where} ${e.message}${extra}`);
  }
  return { ok, errs };
}

console.log(`schema   : ${schemaPath}`);
console.log(`instance : ${instPath}`);
const a = run('run A — 실물 근거만(하드락·미보유 필드 비움)', instance);
const b = run('run B — 자리표시 오버레이 적용(형식 확인용 · 값은 전부 가짜)', deepMerge(instance, OVERLAY));

console.log(`\n요약: run A ${a.ok ? 'PASS' : `FAIL ${a.errs.length}`} · run B ${b.ok ? 'PASS' : `FAIL ${b.errs.length}`}`);
process.exit(0);
