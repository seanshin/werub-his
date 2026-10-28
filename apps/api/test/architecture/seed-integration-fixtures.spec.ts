import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PATHOLOGY_EDI_PREFIXES } from '../../src/modules/fhir/pathology-category.util';

/**
 * 🔴 **시드가 만든 데이터로 연동을 시험할 수 있는가** — 시드 소스 구조 가드.
 *
 * 전부 형제 프로젝트가 기준 커밋 `e9d303984f80` 으로 새 설치본을 세워 **실제로 불러 보고** 보내온 것이다
 * (인바운드 §24 · R20 · R55 · R62). 시드를 실행하지 않고 소스 모양만 본다(운영 DB 접속·시드 실행 금지).
 *
 * 되돌리면 이 테스트가 실패해야 한다 — 그러지 않으면 가드가 아니다.
 */
const SEED = join(process.cwd(), 'prisma', 'seed.ts');
const src = () => readFileSync(SEED, 'utf-8');

describe('시드 — 연동 시험이 가능한 픽스처인가', () => {
  it('🔴 수납 라인이 진료 UUID 를 코드 자리에 넣지 않는다 (ERP 가 전량 거부했다)', () => {
    const s = src();
    // 옛 코드: codeType: 'DIAGNOSIS', codeId: makeUuid('e0c00000', b.encIdx)  ← buildLines 가 못 풀어 UUID 를 그대로 송신
    expect(s, "수납 라인이 codeType 'DIAGNOSIS' 로 되돌아갔다").not.toMatch(/billingId:\s*billId,\s*codeType:\s*'DIAGNOSIS'/);
    expect(s, '수납 라인 codeId 가 진료 UUID 로 되돌아갔다').not.toMatch(/codeId:\s*makeUuid\('e0c00000'/);
    // 정본 연결 — 수가 마스터 행 id 를 가리킨다
    expect(s, '수납 라인이 수가 마스터 행을 가리키지 않는다').toMatch(/codeId:\s*l\.fee\.id/);
  });

  it('🔴 수납 총액이 라인 합계에서 파생된다 (불변식 31 을 시드가 스스로 지킨다)', () => {
    const s = src();
    expect(s, '총액이 라인에서 파생되지 않는다').toMatch(/const total = lines\.reduce\(/);
    expect(s, '보험부담이 총액−본인부담에서 나오지 않는다').toMatch(/const insurance = total - copay/);
    // 옛 코드의 어림수가 되살아나지 않았는가
    expect(s, '수납 어림수(85000·120000)가 되살아났다').not.toMatch(/total:\s*85000,\s*insurance:\s*68000/);
  });

  it('🔴 검사 오더에 수가 코드가 붙는다 (없으면 FHIR ServiceRequest 에 한 건도 안 나간다)', () => {
    const s = src();
    // 외래·응급 두 갈래 모두 처방에 코드를 싣는다
    expect(s, '외래 검사 처방에 procedureCodeId 가 없다').toMatch(/createdBy:\s*doctorKim,\s*procedureCodeId/);
    expect(s, '응급 검사 처방에 procedureCodeId 가 없다').toMatch(/createdBy:\s*kangEunggupId,\s*procedureCodeId:\s*erProcedureCodeId/);
    // 12 패널 전부 code 를 갖는다 — 하나라도 빠지면 그 오더만 조용히 안 보인다
    const panels = s.match(/\{ patientIdx: \d+, encIdx: \d+,/g) ?? [];
    const withCode = s.match(/\{ patientIdx: \d+, encIdx: \d+, code: '[A-Z0-9]+',/g) ?? [];
    expect(panels.length, '검사 패널을 하나도 찾지 못했다 — 스캐너가 헛돈다').toBeGreaterThanOrEqual(12);
    expect(withCode.length, `code 없는 검사 패널이 있다(${panels.length - withCode.length}건)`).toBe(panels.length);
  });

  it('🔴 병리 코드가 시드 마스터에 있다 — 접두는 코드 정본에서 온다(여기서 지어내지 않는다)', () => {
    const s = src();
    const seeded = [...s.matchAll(/\{ code: '([A-Z0-9]+)',[^}]*category: '병리진단료'/g)].map((m) => m[1]);
    expect(seeded.length, '병리 코드가 시드에 없다 — 병리 처방을 낼 수 없다').toBeGreaterThanOrEqual(1);
    for (const code of seeded) {
      expect(
        DEFAULT_PATHOLOGY_EDI_PREFIXES.some((p) => code.startsWith(p)),
        `${code} 는 병리 접두(${DEFAULT_PATHOLOGY_EDI_PREFIXES.join('·')}) 밖이라 FHIR 이 병리로 분류하지 않는다`,
      ).toBe(true);
    }
    // 🔴 확인하지 않은 수가를 적지 않는다 — 병리 항목에 단가가 붙으면 그 숫자가 정책이 된다
    const pathoLines = s.split('\n').filter((l) => l.includes("category: '병리진단료'"));
    for (const l of pathoLines) {
      expect(l, `병리 코드에 확인하지 않은 단가가 들어갔다: ${l.trim()}`).not.toMatch(/unitPrice:\s*\d/);
    }
  });

  it('🔴 시드가 외부 오더 수용(FHIR 인바운드)을 켜지 않는다 — 위원회 의결 표면이다', () => {
    const s = src();
    expect(s, '시드가 fhir.serviceRequestInbound.enabled 를 다시 켠다').not.toMatch(
      /key:\s*'fhir\.serviceRequestInbound\.enabled',\s*value:\s*true/,
    );
    // 대조군 — 게이트 기록(DEV-SEED)은 남아 있어야 한다(개통 버튼 한 번으로 켤 수 있게)
    expect(s, '연동 게이트 시드까지 사라졌다 — 데모가 개통을 시험할 수 없다').toContain("track: 'LIS_REFLEX'");
  });

  it('🔴 DUR 게이트 어휘가 3상(OFF|WARN|BLOCK)이다 — 시드가 구 boolean 을 넣지 않는다', () => {
    const s = src();
    expect(s, 'DUR 게이트가 구 boolean 으로 되돌아갔다(어휘는 시드에서 갈라진다)').toMatch(
      /key:\s*'pharmacy\.durGate\.enforce',[^}]*value:\s*'BLOCK'/,
    );
  });

  it('대조군 — 시드 파일을 실제로 읽었다(빈 문자열로 통과하지 않는다)', () => {
    expect(src().length).toBeGreaterThan(100_000);
    expect(DEFAULT_PATHOLOGY_EDI_PREFIXES.length, '병리 접두 정본이 비었다').toBeGreaterThan(0);
  });
});
