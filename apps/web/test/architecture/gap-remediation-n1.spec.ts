import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * N-W1 배선 가드(FE) — 사망진단서·출생증명서 서식과 작성·접수 동선.
 * import 는 세지 않는다 · JSX 는 [\s/>] 경계(접미사 치환 무동작 함정 — 재주입 실측 2회).
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const body = (s: string) =>
  s.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
   .replace(/\/\*[\s\S]*?\*\//g, '')
   .replace(/^\s*\/\/.*$/gm, '');

describe('N-W1 — print 서식 배선', () => {
  const print = read('app/print/[issueNo]/page.tsx');
  it('DEATH_CERT·BIRTH_CERT 가 각 서식 컴포넌트로 디스패치된다', () => {
    const b = body(print);
    expect(b).toMatch(/<DeathCertificateDoc[\s/>]/);
    expect(b).toMatch(/<BirthCertificateDoc[\s/>]/);
  });

  it('사망진단서 서식 — 사인체인 가~라를 그리고, 없는 원천(기간·부검)은 지어내지 않는다', () => {
    const doc = read('components/document/forms/DeathCertificateDoc.tsx');
    expect(doc).toContain('(가) 직접 사인');
    expect(doc).toContain('(라) (다)의 원인');
    expect(doc).toContain('시체검안서'); // certKind 전환(같은 서식 한 장)
  });

  it('출생증명서 서식 — 부(父)·신생아 성명은 공란으로 정직 표기(원천 부재)', () => {
    const doc = read('components/document/forms/BirthCertificateDoc.tsx');
    expect(doc).toContain('기록 없음');
    expect(doc).toContain('모의 성명으로 갈음');
  });
});

describe('N-W1 — 작성 워크스테이션·접수 동선', () => {
  const page = read('app/(main)/workstation/certificates/page.tsx');
  const b = body(page);

  it('BGROUP 큐가 신설 2종을 조회한다(누락 시 요청이 큐에서 조용히 빠진다)', () => {
    expect(b).toMatch(/'DEATH_CERT',\s*'BIRTH_CERT'/);
  });

  it('48시간 규칙은 제안 배지로만 — 확정은 의사(자동 단정 금지)', () => {
    expect(page).toContain('확정은 의사');
    expect(page).toContain('판정 불가');
  });

  it('창구 접수가 실제 EP 를 부른다(신청 경로 없는 죽은 기능 방지)', () => {
    expect(b).toMatch(/apiClient\.post\('\/api\/v1\/staff\/document-requests'/);
    expect(page).toContain('창구의 대면 책임'); // 시스템 미검증을 화면이 밝힌다
  });

  it('다태아는 순번을 사람이 고른다 — 단태아만 자동 지정', () => {
    expect(b).toMatch(/newborns\.length === 1 \? .*birthOrder : undefined/);
  });
});

describe('N-W1 — 포털 노출 규칙', () => {
  const portal = read('app/portal/_services/ServicesTab.tsx');
  it('사망진단서는 포털 신청 목록에서 제외된다(사망자 본인 계정 성립 불가 — 창구 접수)', () => {
    expect(body(portal)).toMatch(/filter\(\[\s*\[?k\]?\s*\]?\s*=>\s*k !== 'DEATH_CERT'\)|filter\(\(\[k\]\) => k !== 'DEATH_CERT'\)/);
  });
  it('출생증명서는 신청 가능(CERT_TYPES 등재)', () => {
    expect(portal).toMatch(/CERT_TYPES = \[[^\]]*'BIRTH_CERT'/);
  });
});
