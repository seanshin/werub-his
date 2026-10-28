import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HIS_MODES } from '@hospital-run/shared';
import { execSync } from 'node:child_process';

/**
 * 🔴 운영 로그인 화면에 직원 계정과 **공용 비밀번호**가 노출되던 것 (iOS 앱 요청서 WEB-SEC-01).
 *
 * 실측 2026-08-24: `/login` 과 `/staff/login` 두 화면이 테스트 계정 목록을 렌더했고
 * 비밀번호 `staff1234!` 가 소스에 문자열로 있었다. 게다가 목록 정본이 두 벌이었다
 * (`(auth)/login` 인라인 74항목 vs `lib/test-accounts` 87항목 — P12).
 *
 * **숨긴 것과 없는 것은 다른 사실이다.** 조건부 렌더만 하면 번들에 남아 그대로 검색된다.
 * 그래서 진입점을 빌드 시 접히는 상수 분기 안의 `dynamic(import())` 하나로 좁힌다.
 */
const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('테스트 계정은 운영 번들에 실리지 않는다', () => {
  const files = walk(SRC);

  it('`lib/test-accounts` 를 부르는 곳은 개발 전용 패널 하나뿐이다', () => {
    const importers = files
      .filter((f) => /from '@\/lib\/test-accounts'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(SRC + '/', ''));
    expect(importers).toEqual(['components/dev/TestAccountPanel.tsx']);
  });

  it('진입점은 빌드 시 접히는 상수 분기 안의 dynamic import 다 (조건부 렌더가 아니다)', () => {
    const entry = readFileSync(join(SRC, 'lib', 'dev-test-accounts.ts'), 'utf8');
    // 🔴 함수 호출(`allowsSeedLogin(...)`)이면 상수로 접히지 않아 모듈이 번들에 남는다 — 리터럴 비교여야 한다
    expect(entry).toContain("process.env.NEXT_PUBLIC_HIS_MODE === 'DEV'");
    expect(entry).toContain("process.env.NEXT_PUBLIC_HIS_MODE === 'REHEARSAL'");
    // 주석에는 언급해도 되지만 **실제 코드로 부르면** 안 된다 — 주석을 뺀 본문으로 판정한다
    const code = entry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/allowsSeedLogin\s*\(/);
    expect(code).not.toMatch(/from '@hospital-run\/shared'/);
    expect(entry).toMatch(/SHOW_TEST_ACCOUNTS\s*\n?\s*\?\s*dynamic\(\(\) => import\(/);
  });

  /**
   * 🔴 상수로 접히려면 리터럴을 써야 하는데, 그러면 **정본이 둘이 된다**(shared `HIS_MODES` vs 이 리터럴).
   *    이 저장소가 반복해서 당한 P12 다 — 기계로 대조해서 갈라지면 즉시 실패하게 한다.
   */
  it('진입점의 모드 리터럴이 shared 정본과 어긋나지 않는다', () => {
    const entry = readFileSync(join(SRC, 'lib', 'dev-test-accounts.ts'), 'utf8');
    const used = new Set([...entry.matchAll(/NEXT_PUBLIC_HIS_MODE === '([A-Z]+)'/g)].map((m) => m[1]));
    for (const m of used) expect(HIS_MODES, `${m} 는 shared 정본에 없는 모드다`).toContain(m);
    // 시드 로그인을 허용하는 모드는 REAL 을 뺀 전부여야 한다(모드를 새로 만들면 여기서 잡힌다)
    expect([...used].sort()).toEqual(HIS_MODES.filter((m) => m !== 'REAL').sort());
  });

  it('next.config 의 치환 게이트도 같은 모드로 판정한다 (두 곳이 갈라지면 stub 이 안 끼워진다)', () => {
    const cfg = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(cfg).toContain("buildMode !== 'DEV' && buildMode !== 'REHEARSAL'");
  });

  it('`lib/test-patients` 를 부르는 곳은 개발 전용 패널 하나뿐이다', () => {
    const importers = files
      .filter((f) => /from '@\/lib\/test-patients'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(SRC + '/', ''));
    expect(importers).toEqual(['components/dev/TestPatientPanel.tsx']);
  });

  it('환자 패널 진입점도 같은 상수 분기 안의 dynamic import 다', () => {
    const entry = readFileSync(join(SRC, 'lib', 'dev-test-accounts.ts'), 'utf8');
    expect(entry).toMatch(/TestPatientPanel = SHOW_TEST_ACCOUNTS\s*\n?\s*\?\s*dynamic\(\(\) => import\(/);
  });

  /**
   * 🔴 2026-08-25 — `/portal` 로그인과 `(homepage)/booking` 은 시드 환자의 **MRN+생년월일**을
   *    조건 없이 하드코딩해 **운영 배포본에도 노출**하고 있었다. 비밀번호가 아니어도 그것이
   *    이 시스템의 환자 본인확인 자격 전부다. 직원 계정만 막고 여기를 열어두면 반쪽만 닫힌 것이다.
   */
  it('시드 환자 생년월일이 개발 전용 정본 밖에 없다', () => {
    const leaks = files
      .filter((f) => /1958-03-15|2019-06-15|1990-09-03/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(SRC + '/', ''));
    expect(leaks).toEqual(['lib/test-patients.ts']);
  });

  it('공용 비밀번호 리터럴이 개발 전용 파일 밖에 없다', () => {
    // 🔴 (2026-09-14) 관리자 직원 관리 화면 예외를 없앴다 — 그 화면이 '초기 비밀번호 기본값'·'기본값' 버튼으로 같은 문자열을 들고 있었고
    //    (G12 실측: 번역 카탈로그 공용 청크로 모든 사용자에게 내려갔다), 이제 서버가 일회용 임의 비밀번호를 발급한다.
    const leaks = files
      .filter((f) => /staff1234/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(SRC + '/', ''));
    expect(leaks).toEqual(['lib/test-accounts.ts']);
  });

  it('🔴 (2026-09-14) 공용 번역 카탈로그(shared i18n messages)에 공용 비밀번호 리터럴이 없다 — 카탈로그는 모든 사용자 청크로 내려간다', () => {
    const MSG = join(SRC, '../../../packages/shared/src/i18n/messages');
    const leaks = readdirSync(MSG).filter((f) => f.endsWith('.ts') && /staff1234/.test(readFileSync(join(MSG, f), 'utf8')));
    expect(leaks).toEqual([]);
    // 대조군 — 디렉터리를 실제로 읽었다(0 파일이면 위 검사는 빈 검사)
    expect(readdirSync(MSG).filter((f) => f.endsWith('.ts')).length).toBeGreaterThan(20);
  });

  /**
   * 🔴 **개발기에서는 반대로 "보여야" 한다.** 2026-08-25 사람 신고 — WEB-SEC-01 봉합 이후
   *    `NEXT_PUBLIC_SHOW_TEST_ACCOUNTS` 를 **어디에도 정의하지 않아** 개발 로그인 화면에서도
   *    시드 계정 패널이 사라져 있었다. 종전 가드는 "운영에 없다"만 봤기 때문에
   *    **어디에도 없는 상태**를 통과시켰다 — 안전한 쪽으로 틀린 것도 사실이 아니다.
   */
  it('개발 실행(next dev)에서는 패널이 켜져 있다 — `.env.development` 가 그 자리다', () => {
    const envDev = join(process.cwd(), '.env.development');
    expect(existsSync(envDev)).toBe(true);
    const body = readFileSync(envDev, 'utf8');
    expect(body).toMatch(/^NEXT_PUBLIC_HIS_MODE=DEV$/m);
    // 딜러 포털 계정도 같은 자리에서 켠다(값이 없으면 목록이 빈 배열이라 패널이 통째로 안 뜬다)
    expect(body).toMatch(/^NEXT_PUBLIC_DEALER_TEST_ACCOUNTS=\[/m);
  });

  it('개발 전용 파일은 운영에서 로드되지 않는 이름이다 (`.env.development`)', () => {
    // `next build`(NODE_ENV=production)는 `.env.production`/`.env.local`/`.env` 만 읽는다.
    // 🔴 같은 값을 `.env` 나 `.env.production` 에 적으면 운영 번들로 샌다 — 그 자리를 막는다.
    for (const leaky of ['.env', '.env.production', '.env.local']) {
      const f = join(process.cwd(), leaky);
      if (!existsSync(f)) continue;
      // 🔴 여기에 DEV·REHEARSAL 을 적으면 **모든 운영 빌드**가 시드를 실어 나른다.
      //    리허설 서버는 `deploy.sh --mode rehearsal` 로 그 배포에서만 켠다.
      expect(readFileSync(f, 'utf8')).not.toMatch(/NEXT_PUBLIC_HIS_MODE\s*=\s*(DEV|REHEARSAL)/);
    }
  });

  /**
   * 빌드 산출물이 있으면 **실제로 사라졌는지** 확인한다(소스 규약만으로는 증명이 아니다).
   *
   * 🔴 2026-08-25 — 종전 구현은 `.next` 가 있기만 하면 검사했는데, **개발 실행도 `.next` 를 만든다.**
   *    개발에서는 패널이 (의도대로) 실려 있으므로 이 가드가 개발 산출물을 운영으로 읽고 실패했다.
   *    운영 빌드의 표식은 `.next/BUILD_ID` 다(개발 실행은 만들지 않는다 — 실측 확인).
   *    건너뛸 때는 **어느 경우로 건너뛰었는지** 남긴다 — 조용히 통과시키지 않는다.
   */
  it('운영 빌드 산출물(.next/BUILD_ID 존재)이 있으면 그 안에 테스트 계정이 없다', () => {
    const next = join(process.cwd(), '.next');
    if (!existsSync(next)) {
      console.warn('[no-test-accounts] .next 없음 — 산출물 검사 건너뜀(빌드 후 재실행 필요)');
      return;
    }
    if (!existsSync(join(next, 'BUILD_ID'))) {
      console.warn('[no-test-accounts] .next 는 있으나 BUILD_ID 가 없다 = 개발 실행 산출물 — 운영 검사 건너뜀');
      return;
    }
    // 계정 목록의 존재를 그 목록에만 있는 이메일로 판정한다.
    // (공용 비밀번호 문자열 자체는 관리자 화면의 '신규 직원 초기 비밀번호 기본값'에도 있는데,
    //  그것은 계정 목록 노출과 다른 사안이라 여기서 섞지 않는다 — 요청서 회신에 따로 올렸다)
    // 🔴 어떤 모드로 빌드한 산출물인지는 **말해줘야 안다.** 기본은 REAL 로 본다(안전측) —
    //    리허설 산출물을 그냥 두면 이 가드가 실패하는데, 그것은 오탐이 아니라
    //    "이 산출물은 시드 계정을 싣고 있다"는 참인 경고다. 의도한 리허설 빌드를 검사할 때는
    //    `NEXT_PUBLIC_HIS_MODE=REHEARSAL` 을 주고 돌린다(그때는 **있어야** 통과한다 = 대조군).
    const builtMode = process.env.NEXT_PUBLIC_HIS_MODE ?? 'REAL';
    const seedExpected = builtMode === 'DEV' || builtMode === 'REHEARSAL';

    // 직원 계정 목록에만 있는 이메일 · 시드 환자 목록에만 있는 생년월일 둘 다로 판정한다.
    // (공용 비밀번호 문자열 자체는 관리자 화면의 '신규 직원 초기 비밀번호 기본값'에도 있는데,
    //  그것은 계정 목록 노출과 다른 사안이라 여기서 섞지 않는다 — 요청서 회신에 따로 올렸다)
    for (const needle of ['cho.ganho@hospital.example.org', '1958-03-15']) {
      const hit = execSync(
        `grep -rl ${JSON.stringify(needle)} ${JSON.stringify(join(next, 'static'))} 2>/dev/null || true`,
        { encoding: 'utf8' },
      ).trim();
      if (seedExpected) {
        // 대조군 — 리허설로 빌드했는데 **없으면** 그것도 결함이다(검수를 못 한다)
        expect(hit, `${builtMode} 빌드인데 ${needle} 가 없다 — 시드 로그인이 동작하지 않는다`).not.toBe('');
      } else {
        expect(hit, `운영(REAL) 산출물에 ${needle} 가 남아 있다`).toBe('');
      }
    }
  });
});

describe('🔴 (2026-09-14 G12) 빌드 상한 밖의 시드 계정 안내가 없다', () => {
  it('CRM 화면에 시드 계정 이메일·비밀번호 카드가 없다', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/app/(main)/crm/page.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(src).not.toMatch(/crm\.(manager|checkup|intl|campaign)@/);
    expect(src).not.toMatch(/Password1234!/);
  });
});
