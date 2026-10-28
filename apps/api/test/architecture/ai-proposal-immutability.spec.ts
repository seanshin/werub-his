/**
 * 🔴 AI 제안은 **불변**이고 전이 원장은 **append-only** 다 — 저장소 전체 가드(2026-09-09 신설).
 *
 * 정본: `docs/01-plan/features/ai-judgment-governance.plan.md` §2.1·§5.
 *
 * 왜 필요한가: 제안 본문(`contentEnc`/`contentHash`)이 나중에 고쳐질 수 있으면
 * **"그때 AI 가 뭐라고 했는가"** 라는 사실 자체가 사라진다. 수용/거부 지표도, 사고 조사도,
 * PMS 보고도 전부 그 본문이 그때 그대로라는 전제 위에 서 있다.
 * 전이 원장이 수정·삭제될 수 있으면 "언제 보여줬고 누가 결정했는가"가 재구성 불가능해진다.
 *
 * 🔴 **조준을 좁힌다**: `aiProposal.update` 자체를 금지하지 않는다 — 상태 전이(GENERATED→…)는
 *    update 로 한다. 금지 대상은 그 update 의 `data` 가 **본문 필드를 건드리는 것**이다.
 *    (조준을 좁히다 대상이 0 이 되면 가드가 아무것도 보증하지 않으므로, 아래 대조군이
 *     "상태 전이 update 는 실제로 존재한다"를 함께 잡는다.)
 *
 * 재주입 역검증(2026-09-09 실행 · 치환 count==1 확인 후):
 *   · 서비스의 상태 전이 update data 에 `contentEnc:` 를 넣으면 → 실패
 *   · 전이 원장에 `aiProposalTransition.deleteMany(` 를 넣으면 → 실패
 *   · 서비스의 `aiProposal.updateMany(` 를 전부 지우면 → 대조군 실패(스캔이 죽었다는 신호)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
/** 🔴 `fs.globSync` 는 Node 22+ 다 — CI(Node 20)에서 가드가 죽는다. 재귀 readdir 로 순회한다. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'build', 'coverage', '.git']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 주석을 걷어낸다 — 🔴 이 저장소에서 **주석이 문자열 검사에 걸려** 가드가 다른 이유로
 * 통과/실패한 사례가 있었다(v4.11.0 에서 9건). 판정 대상은 코드뿐이다.
 */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const t = raw.trim();
    if (inBlock) {
      out.push('');
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      out.push('');
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) {
      out.push('');
      continue;
    }
    out.push(raw.replace(/\/\/.*$/, ''));
  }
  return out.join('\n');
}

const SCAN_ROOTS = ['apps/api/src', 'apps/web/src', 'apps/web/app', 'packages/shared/src', 'apps/api/prisma'];
const FILES = SCAN_ROOTS.flatMap((r) => walk(path.join(ROOT, r)));
const SOURCES = FILES.map((f) => ({ file: path.relative(ROOT, f), code: stripComments(fs.readFileSync(f, 'utf8')) }));

const SERVICE = path.join(ROOT, 'apps/api/src/modules/ai-proposal/ai-proposal.service.ts');

describe('🔴 AI 제안 불변성 · 전이 원장 append-only', () => {
  it('스캔이 실제로 파일을 읽었다(대조군 — 못 읽으면 아래가 전부 자동 통과한다)', () => {
    expect(FILES.length, '스캔 파일 수').toBeGreaterThan(500);
    expect(SOURCES.some((s) => s.file.endsWith('ai-proposal.service.ts')), '제안 서비스가 스캔에 들어왔다').toBe(true);
  });

  it('제안 본문(contentEnc/contentHash)을 update 하는 코드가 저장소에 없다', () => {
    const hits: string[] = [];
    for (const { file, code } of SOURCES) {
      for (const m of code.matchAll(/aiProposal\.update(?:Many)?\(([\s\S]{0,400})/g)) {
        if (/data\s*:[\s\S]{0,300}(contentEnc|contentHash)/.test(m[1])) hits.push(file);
      }
    }
    expect(hits, '제안 본문은 update 하지 않는다 — 수정은 SUPERSEDED + 새 버전이다').toEqual([]);
  });

  it('대조군 — 상태 전이용 update 는 실제로 존재한다(0 이면 위 검사가 무의미하다)', () => {
    const svc = stripComments(fs.readFileSync(SERVICE, 'utf8'));
    const updates = svc.match(/aiProposal\.updateMany\(\s*\{[\s\S]{0,200}?data:\s*\{\s*[\s\S]{0,80}?status/g) ?? [];
    expect(updates.length, '상태 전이 update 개수').toBeGreaterThanOrEqual(3);
  });

  it('전이 원장은 append-only — update/delete 경로가 저장소에 없다', () => {
    const hits: string[] = [];
    for (const { file, code } of SOURCES) {
      if (/aiProposalTransition\.(update|updateMany|delete|deleteMany|upsert)\(/.test(code)) hits.push(file);
    }
    expect(hits, '전이 행을 고치거나 지우지 않는다').toEqual([]);
  });

  it('대조군 — 전이 행을 만드는 코드는 실제로 존재한다', () => {
    const creators = SOURCES.filter((s) => /aiProposalTransition\.create\(/.test(s.code));
    expect(creators.length, '전이 create 를 가진 파일 수').toBeGreaterThanOrEqual(1);
  });

  it('스키마에서 전이 FK 는 Restrict — 제안을 지워 원장을 함께 날리지 않는다', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model AiProposalTransition'));
    expect(model.slice(0, model.indexOf('@@map'))).toMatch(/onDelete:\s*Restrict/);
  });

  it('🔴 제안 삭제 경로가 없다 — 원장은 지워서 정리하지 않는다(보존정책 소관)', () => {
    const hits: string[] = [];
    for (const { file, code } of SOURCES) {
      if (/aiProposal\.(delete|deleteMany)\(/.test(code)) hits.push(file);
    }
    expect(hits, '제안 삭제는 서비스 코드가 아니라 보존정책이 정한다').toEqual([]);
  });
});
