import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render } from '@testing-library/react';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * 🔴 연동 기관 화면 FE↔서버 필드 계약 + `<T>` 의 빈 키 방어 — 외부 실측 S18(2026-09-13).
 *
 * 외부 설치본에서 `/admin/organizations` 가 **열리지 않고 오류 화면**이었다:
 *   `Cannot read properties of undefined (reading 'lastIndexOf')`
 *
 * 원인은 두 겹이다 — 한 겹만 고치면 다음 자리에서 같은 일이 난다.
 *   ① 서버 정본 키는 `Organization.orgType` 인데 화면이 `org.type` 으로 읽었다.
 *      `organization.service.ts` `findAll()` 은 `findMany` 결과를 **가공 없이** 돌려주므로 응답 키 = 모델 키다.
 *      `TYPE_LABEL[undefined] ?? undefined` → `<T k={undefined} />`.
 *      (쓰기 경로는 DTO 별칭 `type` 으로 이미 봉합돼 있었다 — **읽기 경로만 남아 있었다**)
 *   ② `T` 의 "빈 키 방어" 주석이 `tOf(k, locale)` **뒤에** 있었다. 주석이 말하는 방어가
 *      실제로는 아무것도 막지 못하고, `tOf` 안의 `key.lastIndexOf('@')` 가 먼저 터져
 *      **라벨 하나 때문에 페이지 전체가 죽었다.**
 *
 * 계약 가드의 원칙: 화면이 선언한 필드는 **전부** 서버 모델에 있어야 한다(`type` 하나만 겨누지 않는다 —
 * 다음 어긋남은 다른 이름으로 온다). 되돌리면 실패해야 한다(대조군 포함).
 */

const WEB = process.cwd();
const API = resolve(WEB, '..', 'api');
const SCHEMA = resolve(API, 'prisma', 'schema.prisma');
const SERVICE = resolve(API, 'src', 'modules', 'organization', 'organization.service.ts');
const PAGES = {
  admin: { path: join(WEB, 'src', 'app', '(main)', 'admin', 'organizations', 'page.tsx'), iface: 'Organization' },
  transfer: { path: join(WEB, 'src', 'app', '(main)', 'transfer', 'request', 'page.tsx'), iface: 'Org' },
} as const;

/** 🔴 주석을 지우고 본다 — 내가 쓴 설명문("`type` 으로 읽어…")이 코드 검사에 걸리면 가드가 헛돈다 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (p: string) => stripComments(readFileSync(p, 'utf8'));

/** Prisma `model Organization { ... }` 의 스칼라·관계 필드 이름 — 서버가 목록으로 내보내는 키 정본 */
function organizationModelFields(): string[] {
  const src = readFileSync(SCHEMA, 'utf8');
  const m = src.match(/^model Organization \{([\s\S]*?)^\}/m);
  expect(m, 'schema.prisma 에 model Organization 이 있어야 한다').toBeTruthy();
  return (m![1].split('\n') as string[])
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/)[0]);
}

/** FE `interface <name> { ... }` 가 선언한 필드 이름(한 줄·여러 줄 모두) */
function interfaceFields(src: string, name: string): string[] {
  const m = src.match(new RegExp(`interface\\s+${name}\\s*\\{([^}]*)\\}`));
  expect(m, `interface ${name} 선언을 찾지 못했다`).toBeTruthy();
  return m![1]
    .split(/[;\n]/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/\?.*$|:.*$/, '').trim())
    .filter(Boolean);
}

describe('연동 기관 — FE 가 읽는 키가 서버 모델에 있는가(S18)', () => {
  const model = organizationModelFields();

  it('서버 정본은 `orgType` 이고 `type` 이라는 필드는 없다', () => {
    expect(model).toContain('orgType');
    expect(model).not.toContain('type');
  });

  it('목록 응답은 모델을 가공 없이 돌려준다(응답 키 = 모델 키 라는 이 가드의 전제)', () => {
    const src = read(SERVICE);
    const m = src.match(/async findAll\(\)\s*\{([\s\S]*?)\n  \}/);
    expect(m, 'findAll() 을 찾지 못했다').toBeTruthy();
    const body = m![1];
    expect(body).toContain('organization.findMany(');
    // select·map 으로 키를 바꾸기 시작하면 이 가드의 전제가 깨진다 — 그때는 계약을 응답 DTO 로 옮겨야 한다
    expect(/\bselect\s*:/.test(body), 'findAll 이 select 로 키를 고른다 — 계약 정본을 다시 정하라').toBe(false);
    expect(/\.map\(/.test(body), 'findAll 이 map 으로 모양을 바꾼다 — 계약 정본을 다시 정하라').toBe(false);
  });

  for (const [name, { path, iface }] of Object.entries(PAGES)) {
    it(`${name} 화면의 기관 인터페이스가 선언한 필드는 전부 서버 모델에 있다`, () => {
      const fields = interfaceFields(read(path), iface);
      expect(fields.length, `${name}: 인터페이스가 비어 있다`).toBeGreaterThan(0);
      expect(fields).toContain('orgType');
      const phantom = fields.filter((f) => !model.includes(f));
      expect(phantom, `${name}: 서버가 주지 않는 필드를 읽는다`).toEqual([]);
    });
  }

  it('관리 화면이 기관 유형을 정본 키로 읽고 쓴다', () => {
    const src = read(PAGES.admin.path);
    expect(src).toContain('TYPE_LABEL[org.orgType]');
    // 등록 폼도 정본 키로 보낸다(DTO 의 `type` 별칭은 옛 호출자용 호환일 뿐 정본이 아니다)
    expect(src).toContain("orgType: 'HOSPITAL'");
    expect(/\borg\.type\b/.test(src), '`org.type` 이 남아 있다').toBe(false);
    expect(/\bform\.type\b/.test(src), '`form.type` 이 남아 있다').toBe(false);
  });

  it('전원 요청 화면도 `.type` 으로 읽지 않는다', () => {
    const src = read(PAGES.transfer.path);
    expect(/\b(selectedOrg|o)\.type\b/.test(src), '기관 유형을 `.type` 으로 읽는다').toBe(false);
    expect(src).toContain('selectedOrg.orgType');
  });
});

describe('`<T>` 의 빈 키 방어가 tOf 앞에 있는가 — 런타임 재현', () => {
  it('키가 undefined 여도 던지지 않고 아무것도 그리지 않는다(외부가 본 오류 그대로 재현하는 입력)', () => {
    // 🔴 계약 불일치는 런타임에 `undefined` 를 보낸다 — 타입(string)을 믿지 않는다
    const { container } = render(<T k={undefined as unknown as string} />);
    expect(container.textContent).toBe('');
  });

  it('키가 null 이어도 던지지 않는다', () => {
    const { container } = render(<T k={null as unknown as string} />);
    expect(container.textContent).toBe('');
  });

  it('Tf 도 같다', () => {
    const { container } = render(<Tf k={undefined as unknown as string} params={{}} />);
    expect(container.textContent).toBe('');
  });

  it('대조군 — 정상 키는 그대로 그린다(방어가 멀쩡한 키까지 지우지 않는다)', () => {
    const { container } = render(<T k="연동 기관 관리" />);
    expect(container.textContent).toBe('연동 기관 관리');
  });
});
