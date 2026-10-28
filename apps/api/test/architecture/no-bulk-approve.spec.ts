import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **언어팩 검수에 일괄 승인은 없다** (정본 `i18n-human-review.plan.md` §2.3 · §4).
 *
 * 왜: 이 저장소에서 무확인 일괄 적용은 이미 사고를 냈다(코드 매핑 `autoConfirm`).
 * 승인은 **글자 하나하나가 화면에 나가는 결정**이라 건별이어야 하고, 승인자는 자기가 무엇을
 * 승인했는지 말할 수 있어야 한다.
 *
 * 🔴 EP 만 막고 **서비스에 다건 메서드를 남기면 다음 갈래가 그것을 부른다** — 두 층을 함께 본다.
 */
const MOD_DIR = join(process.cwd(), 'src/modules/i18n-review');

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 주석·문서 문자열이 검사를 대신 통과시키지 않도록 코드만 남긴다(v4.11.0 에서 실제로 당한 함정) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('🔴 일괄 승인 EP·메서드가 없다', () => {
  const files = tsFiles(MOD_DIR);
  const ctrl = files.find((f) => f.endsWith('i18n-review.controller.ts'))!;
  const svc = files.find((f) => f.endsWith('i18n-review.service.ts'))!;

  it('스캐너 오라클 — 모듈 파일과 승인 라우트를 실제로 찾았다', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(ctrl).toBeTruthy();
    expect(svc).toBeTruthy();
    // 대조군: **건별 승인은 존재한다**(있는 것을 없다고 말하지 않는다)
    expect(stripComments(readFileSync(ctrl, 'utf8'))).toMatch(/@Post\('review\/:id\/approve'\)/);
  });

  it('승인·반려 라우트는 :id 단건뿐이다 — 배열·all·bulk 경로가 없다', () => {
    const src = stripComments(readFileSync(ctrl, 'utf8'));
    const routes = [...src.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*'([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(routes.length, '라우트를 하나도 못 찾았다(가드가 헛돈다)').toBeGreaterThanOrEqual(6);
    const decisionRoutes = routes.filter((r) => /approve|reject|merged|decide/i.test(r));
    expect(decisionRoutes.length).toBeGreaterThanOrEqual(4);
    /**
     * 결정 라우트는 두 모양뿐이다:
     *   ① `review/:id/<결정>` — 오버레이 행 하나
     *   ② `review/reject-key` — **키 하나**로 "번역하지 않음"을 남기는 자리(기획서 §2.4).
     *      제안 없이 판정하는 경로라 `:id` 가 없다. 대신 본문이 키 **하나**임을 아래에서 못박는다.
     */
    for (const r of decisionRoutes) {
      expect(r, `건별이 아닌 결정 라우트: ${r}`).toMatch(/review\/:id\/|^Post review\/reject-key$/);
      expect(r).not.toMatch(/bulk|batch|all|many|multi/i);
    }
  });

  it('🔴 키만으로 반려하는 경로도 건별이다 — 키 하나·사유 필수', () => {
    const dto = stripComments(readFileSync(join(MOD_DIR, 'dto/i18n-review.dto.ts'), 'utf8'));
    const body = /export class RejectKeyDto \{([\s\S]*?)\n\}/.exec(dto)?.[1];
    expect(body, 'RejectKeyDto 를 못 찾았다(가드가 헛돈다)').toBeTruthy();
    // 배열을 받는 순간 일괄 반려가 된다
    expect(body!).not.toMatch(/\[\]|IsArray|ArrayMinSize|keys\b|ids\b/);
    expect(body!).toMatch(/\bkey!: string;/);
    /**
     * 🔴 여기서만 사유가 **필수**다 — 교정값이 없어 사유가 곧 내용이기 때문이다(§2.1).
     *    `DecisionDto.reason` 이 optional 인 것과 충돌하지 않는다: 그쪽은 값이 이미 본문이다.
     */
    expect(body!).toMatch(/@IsString\(\)[^\n]*reason!: string;/);
    expect(body!, '사유를 선택으로 되돌리면 재검토 불가능한 판정이 남는다').not.toMatch(/@IsOptional\(\)[^\n]*reason/);
    // 대조군: 다른 판정 DTO 의 사유는 여전히 선택이다(억지로 전부 필수로 만들지 않았다)
    const decision = /export class DecisionDto \{([\s\S]*?)\n\}/.exec(dto)?.[1];
    expect(decision, 'DecisionDto 를 못 찾았다').toBeTruthy();
    expect(decision!).toMatch(/@IsOptional\(\)[^\n]*reason\?: string;/);
  });

  it('결정 핸들러는 id 하나만 받는다 — 바디에 ids/keys 배열을 받지 않는다', () => {
    const src = stripComments(readFileSync(ctrl, 'utf8'));
    // @Body() 로 받는 DTO 들에 배열 필드가 없어야 한다
    const bodyTypes = [...src.matchAll(/@Body\(\)\s*\w+:\s*(\w+)/g)].map((m) => m[1]);
    expect(bodyTypes.length, '@Body 를 하나도 못 찾았다').toBeGreaterThanOrEqual(1);
    const dto = stripComments(readFileSync(join(MOD_DIR, 'dto/i18n-review.dto.ts'), 'utf8'));
    for (const t of bodyTypes) {
      const body = new RegExp(`export class ${t} \\{([\\s\\S]*?)\\n\\}`).exec(dto)?.[1];
      expect(body, `${t} 정의를 못 찾았다`).toBeTruthy();
      expect(body!, `${t} 가 배열을 받는다 = 일괄 처리 표면`).not.toMatch(/\[\]|IsArray|ArrayMinSize/);
    }
  });

  it('서비스에도 다건 승인 메서드가 없다(EP 만 막으면 다음 갈래가 부른다)', () => {
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'));
      expect(src, `${f} 에 다건 승인 흔적`).not.toMatch(
        /(approveAll|approveMany|bulkApprove|decideMany|updateMany\s*\(|approve\w*\(\s*ids)/,
      );
      // status 를 통째로 갈아끼우는 쓰기(전건 승인과 같다)
      expect(src, `${f} 에 전건 상태 변경(updateMany)`).not.toMatch(/translationOverride\.updateMany/);
    }
  });
});
