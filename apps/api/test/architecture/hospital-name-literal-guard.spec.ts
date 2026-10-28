/**
 * 병원명 소스 리터럴 기준선 — 기획서 `docs/01-plan/features/hospital-identity-canon.plan.md` §5 설계대로.
 *
 * 🔴 왜: 가상 병원명(`위루비병원`·`WERUBYHOSP`)과 데모 기관 상수가 코드 100여 파일에 박혀 있어
 *    **다른 기관(UAE 포함)에 설치할 수 없다**. 정본은 설정(`hospital.*`)·`HOSPITAL` 상수 하나여야 한다.
 *    지금 전부 고칠 수는 없다(기관 정체성 결정 `identity.*` 대기) — 그래서 **파일별 정확 기준선**으로 동결한다:
 *    늘면 실패(신규 하드코딩 차단), 줄었는데 기준선을 안 낮춰도 실패(여유가 신규 위반을 흡수하지 않게).
 *
 * 세는 규칙:
 *  - 대상: apps/web/src · apps/api/src · apps/homepage/src · packages/shared/src · apps/mobile/{app,src} 의 .ts/.tsx/.js/.jsx
 *  - 제외: 테스트(`*.spec.*`·`*.test.*`·`__tests__`) — 픽스처는 제품 문자열이 아니다
 *  - 먼저 걷는 것: 이메일(`x@hospital.example.org`)·도메인(`hospital.example.org`)·자산 경로(`/images/werubyhosp/`) — 식별자·주소이지 표기가 아니다
 *  - 주석은 세지 않는다(문자열 검사가 주석에 걸리는 함정 — 판정 규칙 3)
 *  - 표기 변형: `우리들[ ]녹지[국제병원]`·`위루비병원`·대문자 단어 `WERUBYHOSP`·`Weruby`·`Weruby`
 *  - 보조: `DEV_HOSPITAL_PROFILE` 사용 파일(법정 서식 데모 기관 상수 — release-gate G11 과 같은 대상)
 * 파일 목록·수를 통째로 동결한다 — 수 합계만 동결하면 하나 고치고 하나 만들어도 통과한다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '../../../..');
const ROOTS = ['apps/web/src', 'apps/api/src', 'apps/homepage/src', 'packages/shared/src', 'apps/mobile/app', 'apps/mobile/src'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '__tests__']);

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !/\.(spec|test)\.(ts|tsx|js|jsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

export function stripNonLabel(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\s;{}(,])\/\/.*$/gm, '$1')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '')
    .replace(/(https?:\/\/)?([\w-]+\.)*werubyhosp\.[a-z.]+[\w/.-]*/gi, '')
    .replace(/[\w./-]*\/werubyhosp\/[\w./-]*/gi, '');
}

const NAME_RE = /위루비\s*병원|위루비병원|\bWERUBYHOSP\b|Weruby|Weruby/g;

export function countHospitalName(src: string): number {
  return (stripNonLabel(src).match(NAME_RE) ?? []).length;
}

function scan(): { files: number; names: Record<string, number>; demoProfile: string[] } {
  const all = ROOTS.flatMap((r) => walk(path.join(REPO, r)));
  const names: Record<string, number> = {};
  const demoProfile: string[] = [];
  for (const f of all) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(REPO, f).split(path.sep).join('/');
    const n = countHospitalName(src);
    if (n > 0) names[rel] = n;
    if (/\bDEV_HOSPITAL_PROFILE\b/.test(stripNonLabel(src))) demoProfile.push(rel);
  }
  return { files: all.length, names, demoProfile: demoProfile.sort() };
}

// 2026-09-14 실측 — 고칠 때마다 낮춘다(올리지 않는다). 정당 잔존은 아래 ALLOW 에 사유와 함께.
const BASELINE: Record<string, number> = {
  'apps/web/src/app/(auth)/login/page.tsx': 7,
  'apps/web/src/app/(homepage)/about/csr/page.tsx': 1,
  'apps/web/src/app/(homepage)/about/directions/page.tsx': 2,
  'apps/web/src/app/(homepage)/about/facility/page.tsx': 1,
  'apps/web/src/app/(homepage)/about/gallery/page.tsx': 1,
  'apps/web/src/app/(homepage)/about/layout.tsx': 1,
  'apps/web/src/app/(homepage)/about/page.tsx': 3,
  'apps/web/src/app/(homepage)/booking/page.tsx': 4,
  'apps/web/src/app/(homepage)/care/centers/layout.tsx': 1,
  'apps/web/src/app/(homepage)/care/departments/[slug]/page.tsx': 1,
  'apps/web/src/app/(homepage)/care/departments/layout.tsx': 1,
  'apps/web/src/app/(homepage)/care/departments/page.tsx': 1,
  'apps/web/src/app/(homepage)/care/doctors/[userId]/page.tsx': 2,
  'apps/web/src/app/(homepage)/care/doctors/doctors-list-client.tsx': 1,
  'apps/web/src/app/(homepage)/care/doctors/layout.tsx': 1,
  'apps/web/src/app/(homepage)/care/non-covered/page.tsx': 1,
  'apps/web/src/app/(homepage)/care/page.tsx': 1,
  'apps/web/src/app/(homepage)/guide/certificate/page.tsx': 1,
  'apps/web/src/app/(homepage)/guide/emergency/page.tsx': 1,
  'apps/web/src/app/(homepage)/guide/funeral/page.tsx': 1,
  'apps/web/src/app/(homepage)/health-info/[slug]/layout.tsx': 1,
  'apps/web/src/app/(homepage)/international/insurance/page.tsx': 1,
  'apps/web/src/app/(homepage)/international/interoperability/page.tsx': 1,
  'apps/web/src/app/(homepage)/international/page.tsx': 3,
  'apps/web/src/app/(homepage)/international/partners/page.tsx': 1,
  'apps/web/src/app/(homepage)/layout.tsx': 8,
  'apps/web/src/app/(homepage)/news/[slug]/layout.tsx': 1,
  'apps/web/src/app/(homepage)/news/layout.tsx': 1,
  'apps/web/src/app/(homepage)/news/news-list-client.tsx': 1,
  'apps/web/src/app/(homepage)/news/recruit/recruit-list-client.tsx': 1,
  'apps/web/src/app/(homepage)/privacy/page.tsx': 1,
  'apps/web/src/app/(homepage)/search/search-client.tsx': 1,
  'apps/web/src/app/(homepage)/terms/page.tsx': 1,
  'apps/web/src/app/(main)/admin/analytics/page.tsx': 1,
  'apps/web/src/app/(main)/admin/blockchain-cert/page.tsx': 1,
  'apps/web/src/app/(main)/admin/homepage/seo/page.tsx': 1,
  'apps/web/src/app/(main)/admin/status/page.tsx': 1,
  'apps/web/src/app/(main)/consent/templates/page.tsx': 1,
  // 2026-10-02 SessionInfo 1 → 0(기관명 대신 버전만 · 기관 정체성 정본은 설정)
  'apps/web/src/app/(main)/departments/page.tsx': 1,
  'apps/web/src/app/(main)/doctors/page.tsx': 1,
  'apps/web/src/app/(main)/his-news/page.tsx': 1,
  'apps/web/src/app/(main)/patients/[id]/components/PatientHeader.tsx': 1,
  'apps/web/src/app/(main)/print/consent/[id]/page.tsx': 4,
  'apps/web/src/app/(main)/print/opinion/[encounterId]/page.tsx': 1,
  'apps/web/src/app/(main)/reception/components/ReceptionTicket.tsx': 4,
  'apps/web/src/app/(main)/recruit/page.tsx': 1,
  'apps/web/src/app/consent-device/page.tsx': 2,
  'apps/web/src/app/distributor/page.tsx': 1,
  'apps/web/src/app/en/layout.tsx': 5,
  'apps/web/src/app/en/page.tsx': 1,
  'apps/web/src/app/guide/[id]/page.tsx': 1,
  'apps/web/src/app/ja/layout.tsx': 4,
  'apps/web/src/app/layout.tsx': 1,
  'apps/web/src/app/manifest.ts': 1,
  'apps/web/src/app/portal/_auth/LoginForm.tsx': 1,
  'apps/web/src/app/portal/page.tsx': 2,
  'apps/web/src/app/questionnaire/[token]/page.tsx': 1,
  'apps/web/src/app/staff/approvals/page.tsx': 1,
  'apps/web/src/app/staff/login/page.tsx': 3,
  'apps/web/src/app/staff/page.tsx': 1,
  'apps/web/src/app/survey/[token]/page.tsx': 1,
  'apps/web/src/app/tablet/layout.tsx': 1,
  'apps/web/src/app/tablet/page.tsx': 1,
  'apps/web/src/app/verify/page.tsx': 1,
  'apps/web/src/app/zh/layout.tsx': 4,
  'apps/web/src/components/homepage/CmsCategoryPage.tsx': 1,
  'apps/web/src/components/homepage/Footer.tsx': 2,
  'apps/web/src/components/homepage/GNB.tsx': 2,
  'apps/web/src/components/homepage/hospital-facts.ts': 2,
  'apps/web/src/components/layout/Sidebar.tsx': 4,
  'apps/web/src/components/print/PrintGuard.tsx': 2,
  'apps/web/src/components/print/PrintLayout.tsx': 3,
  'apps/web/src/components/signature/ConsentSignView.tsx': 1,
  'apps/web/src/lib/crypto/webauthn.ts': 1,
  'apps/api/src/modules/auth/passkey/passkey.service.ts': 1,
  'apps/api/src/modules/blockchain-cert/blockchain-cert.service.ts': 1,
  'apps/api/src/modules/decision-registry/decision.registry.ts': 11,
  'apps/api/src/modules/crm/crm-channel.service.ts': 1, // 공개판: 기본 서명 병원명이 위루비 표기로 바뀌어 센다
  'apps/api/src/modules/pharmacy/pharmacy.service.ts': 1,
  'apps/api/src/modules/voucher/totp.ts': 1,
  'apps/api/src/modules/voucher/voucher-email.service.ts': 4,
  'apps/homepage/src/app/about/csr/page.tsx': 1,
  'apps/homepage/src/app/about/directions/page.tsx': 2,
  'apps/homepage/src/app/about/facility/page.tsx': 1,
  'apps/homepage/src/app/about/gallery/page.tsx': 1,
  'apps/homepage/src/app/about/layout.tsx': 1,
  'apps/homepage/src/app/about/page.tsx': 3,
  'apps/homepage/src/app/booking/page.tsx': 4,
  'apps/homepage/src/app/care/centers/layout.tsx': 1,
  'apps/homepage/src/app/care/departments/[slug]/page.tsx': 2,
  'apps/homepage/src/app/care/departments/layout.tsx': 1,
  'apps/homepage/src/app/care/departments/page.tsx': 1,
  'apps/homepage/src/app/care/doctors/[userId]/page.tsx': 2,
  'apps/homepage/src/app/care/doctors/doctors-list-client.tsx': 1,
  'apps/homepage/src/app/care/doctors/layout.tsx': 1,
  'apps/homepage/src/app/care/non-covered/page.tsx': 1,
  'apps/homepage/src/app/care/page.tsx': 1,
  'apps/homepage/src/app/en/layout.tsx': 5,
  'apps/homepage/src/app/en/page.tsx': 1,
  'apps/homepage/src/app/guide/certificate/page.tsx': 1,
  'apps/homepage/src/app/guide/emergency/page.tsx': 1,
  'apps/homepage/src/app/guide/funeral/page.tsx': 1,
  'apps/homepage/src/app/health-info/[slug]/layout.tsx': 1,
  'apps/homepage/src/app/international/insurance/page.tsx': 1,
  'apps/homepage/src/app/international/interoperability/page.tsx': 1,
  'apps/homepage/src/app/international/page.tsx': 3,
  'apps/homepage/src/app/international/partners/page.tsx': 1,
  'apps/homepage/src/app/ja/layout.tsx': 4,
  'apps/homepage/src/app/layout.tsx': 7,
  'apps/homepage/src/app/news/[slug]/layout.tsx': 1,
  'apps/homepage/src/app/news/layout.tsx': 1,
  'apps/homepage/src/app/news/news-list-client.tsx': 1,
  'apps/homepage/src/app/news/recruit/recruit-list-client.tsx': 1,
  'apps/homepage/src/app/privacy/page.tsx': 1,
  'apps/homepage/src/app/search/search-client.tsx': 1,
  'apps/homepage/src/app/terms/page.tsx': 1,
  'apps/homepage/src/app/zh/layout.tsx': 4,
  'apps/homepage/src/components/homepage/CmsCategoryPage.tsx': 1,
  'apps/homepage/src/components/homepage/Footer.tsx': 3,
  'apps/homepage/src/components/homepage/GNB.tsx': 2,
  'apps/homepage/src/lib/site-info.ts': 2,
  'packages/shared/src/i18n/messages/admin4.ts': 2,
};

// 2026-10-13 C6 — 서식이 설정 원장(행만)을 읽게 바뀌어 데모 기관 상수 사용 파일 0(상수 자체가 없다)
const DEMO_PROFILE_BASELINE: string[] = [
  'apps/api/src/modules/decision-registry/decision.registry.ts', // 결정 설명 문장이 그 이름을 말한다(사용 아님)
];

describe('병원명 소스 리터럴 기준선', () => {
  const r = scan();

  it('스캔이 실제로 파일을 읽었다(하한 — 비면 가드가 아니다)', () => {
    expect(r.files).toBeGreaterThan(2000);
  });

  it('검출기 대조군 — 표기는 잡고 이메일·도메인·자산 경로·주석은 안 잡는다', () => {
    expect(countHospitalName(`<p>위루비병원</p>`)).toBe(1);
    expect(countHospitalName(`const t = 'WERUBYHOSP 안내';`)).toBe(1);
    expect(countHospitalName(`const e = 'x@hospital.example.org'; const u = 'https://www.hospital.example.org/a'; <img src="/images/werubyhosp/logo.svg" />`)).toBe(0);
    expect(countHospitalName(`// 위루비병원 주석\n/* WERUBYHOSP */`)).toBe(0);
  });

  it('🔴 파일별 병원명 리터럴 수가 기준선과 정확히 같다(늘면 신규 하드코딩 · 줄면 기준선을 낮춘다)', () => {
    if (process.env.PRINT_HOSPITAL_NAME_BASELINE) console.log(JSON.stringify({ names: r.names, demoProfile: r.demoProfile }, null, 2));
    expect(r.names).toEqual(BASELINE);
  });

  it('🔴 법정 서식 데모 기관 상수(DEV_HOSPITAL_PROFILE) 사용 파일 목록 동결', () => {
    expect(r.demoProfile).toEqual(DEMO_PROFILE_BASELINE);
  });
});
