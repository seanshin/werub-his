import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 과별 화면 ↔ API 계약 가드 — 2026-08-18.
 *
 * 🔴 배경: 정신과·비뇨·정형·산부인과 화면이 **서버에 없는 EP**
 *    (`psychiatry/mse`·`urology/psa`·`orthopedics/rom`·`obgyn/prenatal` …)를 부르고
 *    `.catch(() => ({ data: [] }))` 로 404 를 삼켜, 탭이 개통 이래 **영구히 "기록 없음"** 이었다.
 *    404 는 눈에 띄지만 **정직하게 0을 반환하는 잘못된 질의는 안 띈다**(W6 교훈).
 *
 * 이 스펙은 화면이 부르는 경로를 **컨트롤러 라우트와 기계 대조**한다.
 * 새 탭이 없는 EP 를 부르면 여기서 실패한다.
 */

const WEB_SRC = join(process.cwd(), 'src');
const API_SRC = join(process.cwd(), '..', 'api', 'src', 'modules');

/**
 * 🔴 2026-08-26 확대: 종전 목록은 6개 전문진료 화면 중 **4개만** 조준했고,
 *    미조준 2곳(neurosurgery·pediatrics)에 정확히 이 유형의 결함이 살아 있었다
 *    (`neurosurgery/neuro-exam|gcs|motor-map` 3탭 전부 404 · `pediatrics/exams` 저장 100% 실패).
 *    **기준선을 부분집합으로 잡지 않는다** — 과별 화면은 전부 여기 등재한다.
 *
 * `pages` 가 배열인 이유: 결함은 대시보드에만 있지 않다. 소아 진료 **저장** 경로는
 * `encounter/new/components/*EncounterLayout.tsx` 에 있었고 대시보드만 보면 안 잡힌다.
 */
const PAGES: { module: string; pages: string[]; controller: string }[] = [
  { module: 'psychiatry', pages: ['app/(main)/psychiatry/page.tsx'], controller: 'psychiatry/psychiatry.controller.ts' },
  { module: 'urology', pages: ['app/(main)/urology/page.tsx'], controller: 'urology/urology.controller.ts' },
  { module: 'orthopedics', pages: ['app/(main)/orthopedics/page.tsx'], controller: 'orthopedics/orthopedics.controller.ts' },
  {
    module: 'obgyn',
    pages: ['app/(main)/obgyn/page.tsx', 'app/(main)/obgyn/DeliveryBoard.tsx'],
    controller: 'obgyn/obgyn.controller.ts',
  },
  {
    module: 'neurosurgery',
    pages: [
      'app/(main)/neurosurgery/page.tsx',
      'app/(main)/patients/[id]/encounter/new/components/NeurosurgeryEncounterLayout.tsx',
    ],
    controller: 'neurosurgery/neurosurgery.controller.ts',
  },
  {
    module: 'pediatrics',
    pages: [
      'app/(main)/pediatrics/page.tsx',
      'app/(main)/patients/[id]/components/PediatricsTab.tsx',
      'app/(main)/patients/[id]/encounter/new/components/PediatricsEncounterLayout.tsx',
    ],
    controller: 'pediatrics/pediatrics.controller.ts',
  },
  {
    module: 'internal-medicine',
    pages: [
      'app/(main)/internal-medicine/page.tsx',
      'app/(main)/patients/[id]/components/InternalMedicineTab.tsx',
    ],
    controller: 'internal-medicine/internal-medicine.controller.ts',
  },
  /**
   * 🔴 2026-08-26 확대 2 — 안과·이비인후과·피부과·치과·성형외과 5과가 미조준이었고,
   *    **성형외과에 정확히 이 유형의 결함이 살아 있었다**: 대시보드가 존재하지 않는
   *    `plastic/records/:patientId` · `plastic/photos/:patientId` 를 불러 개별 환자 조회
   *    두 탭이 개통 이래 100% 실패했다(운영 PlasticExam 217건·103명이 이 화면에 보인 적 없음).
   *    정본 라우트는 `exams/:patientId` 하나다.
   */
  {
    module: 'plastic',
    pages: ['app/(main)/plastic/page.tsx', 'app/(main)/patients/[id]/components/PlasticTab.tsx'],
    controller: 'plastic/plastic.controller.ts',
  },
  {
    module: 'ophthalmology',
    pages: ['app/(main)/ophthalmology/page.tsx', 'app/(main)/patients/[id]/components/OphthalmologyTab.tsx'],
    controller: 'ophthalmology/ophthalmology.controller.ts',
  },
  {
    module: 'ent',
    pages: ['app/(main)/ent/page.tsx', 'app/(main)/patients/[id]/components/EntTab.tsx'],
    controller: 'ent/ent.controller.ts',
  },
  {
    module: 'dermatology',
    pages: ['app/(main)/dermatology/page.tsx'],
    controller: 'dermatology/dermatology.controller.ts',
  },
  {
    module: 'dental',
    pages: ['app/(main)/dental/page.tsx'],
    controller: 'dental/dental.controller.ts',
  },
];

/** 컨트롤러의 `@Get('a/:b')` 등을 세그먼트 패턴으로 뽑는다(`:param` 은 와일드카드). */
function routesOf(controllerPath: string): string[][] {
  const src = readFileSync(controllerPath, 'utf8');
  const routes: string[][] = [];
  const re = /@(?:Get|Post|Put|Patch|Delete)\((?:'([^']*)'|"([^"]*)")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const path = m[1] ?? m[2] ?? '';
    routes.push(path === '' ? [] : path.split('/').filter(Boolean));
  }
  return routes;
}

/**
 * 화면이 호출하는 `/api/v1/<module>/...` 경로를 세그먼트로. `${...}` 는 파라미터로 본다.
 *
 * 🔴 **내 스캔 도구가 먼저 거짓말한다**(2026-08-26 실측 2건):
 *  · 줄바꿈에서 멈추지 않아 주석 안의 경로가 다음 줄까지 삼켜 있지도 않은 EP 를 신고했다 → `\n` 제외.
 *  · `` `…/lab-orders${patientId ? `?patientId=…` : ''}` `` 처럼 **리터럴에 템플릿이 붙은** 자리를
 *    한 세그먼트로 읽어 실재하는 `@Get('lab-orders')` 를 "없는 EP"로 신고했다 → 리터럴 접두만
 *    검증하고 그 뒤(동적 부분·쿼리스트링)는 **검증하지 않는다고 인정하고** 끊는다.
 */
function calledPathsOf(pagePath: string, module: string): string[][] {
  // 🔴 주석은 제외한다 — 봉합 주석은 "종전에 무엇을 불렀는가"(죽은 경로)를 그대로 적기 때문에,
  //    같이 훑으면 **고쳐진 파일이 실패**하고 그 실패를 피하려 설명을 지우게 된다.
  const src = readFileSync(pagePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  const re = new RegExp(`/api/v1/${module}/([^\`'"?\\n]*)`, 'g');
  const out: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const segs: string[] = [];
    for (const raw of m[1].split('/')) {
      if (!raw) continue;
      if (raw.startsWith('${')) { segs.push(':param'); continue; }
      const tpl = raw.indexOf('${');
      if (tpl > 0) { segs.push(raw.slice(0, tpl)); break; } // 리터럴 접두까지만 확인 가능
      segs.push(raw);
    }
    out.push(segs);
  }
  return out;
}

function matches(called: string[], route: string[]): boolean {
  if (called.length !== route.length) return false;
  return called.every((c, i) => route[i].startsWith(':') || route[i] === c);
}

describe('과별 화면이 부르는 EP 는 실제 컨트롤러에 있어야 한다', () => {
  for (const { module, pages, controller } of PAGES) {
    it(`${module} — 화면의 모든 호출 경로가 라우트와 대응한다`, () => {
      const controllerPath = join(API_SRC, controller);
      expect(existsSync(controllerPath), `컨트롤러 없음: ${controller}`).toBe(true);
      const routes = routesOf(controllerPath);

      const missing: string[] = [];
      let calledTotal = 0;
      for (const page of pages) {
        const pagePath = join(WEB_SRC, page);
        expect(existsSync(pagePath), `화면 파일 없음: ${page}`).toBe(true);
        const called = calledPathsOf(pagePath, module);
        calledTotal += called.length;
        for (const c of called) {
          if (!routes.some((r) => matches(c, r))) missing.push(`${page} → /api/v1/${module}/${c.join('/')}`);
        }
      }
      // 🔴 대조군 — 아무 경로도 못 찾으면 이 가드는 "통과"가 아니라 조준을 잃은 것이다.
      expect(calledTotal, `${module}: 호출 경로를 하나도 찾지 못했다(정규식/파일 경로 확인)`).toBeGreaterThan(0);

      expect(missing, `서버에 없는 EP 를 부른다:\n${missing.join('\n')}`).toEqual([]);
    });
  }
});

describe('환자별 탭 조회는 실패를 빈 목록으로 삼키지 않는다', () => {
  for (const { module, pages } of PAGES) {
    it(`${module} — 개별 환자 조회에 \`.catch(() => ({ data: [] }))\` 가 없다`, () => {
      // 🔴 조회 실패를 '기록 없음'으로 바꿔 말하면 환자 기록이 사라진 것처럼 보인다.
      //    대시보드 카드(오늘·통계·환자목록)와 달리 **환자 단위 임상기록**에는 이 폴백을 두지 않는다.
      const swallowed = pages.flatMap((page) =>
        readFileSync(join(WEB_SRC, page), 'utf8')
          .split('\n')
          .filter((l) => l.includes(`/api/v1/${module}/`) && l.includes('${patientId}') && l.includes('.catch('))
          .map((l) => `${page}: ${l.trim()}`),
      );
      expect(swallowed, `조회 실패를 빈 목록으로 삼킨다:\n${swallowed.join('\n')}`).toEqual([]);
    });
  }
});
