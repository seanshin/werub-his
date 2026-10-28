import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanRoutes, nestedRoutes, type RouteRow } from './nested-route-scan';

/**
 * 중첩 경로 **소속 대조** 판정기 — 핸들러가 부모 id 를 받는 것만으로는 부족하다.
 * 그 id 가 **조회 조건에 닿는지**를 본다(D2 가 고친 12자리는 전부 "받고도 안 쓰던" 모양이었다).
 *
 * 🔴 스캐너 자신이 두 번 틀렸다 — 둘 다 **이름으로 찾다가 다른 것을 봤다**:
 *   ① 한 파일에 동명 핸들러 2개(`generatePdf`) → 위치(handlerLine)로 찾는다.
 *   ② 전역에서 메서드 이름만 맞춰 엉뚱한 서비스(`resolve` → checkup-protocol) → **컨트롤러가 주입한 타입**으로 찾는다.
 */

export interface Judgement {
  route: RouteRow;
  /** 대조에 쓰여야 할 부모 파라미터 */
  parent: string;
  /** 판정 */
  verdict: 'scoped' | 'unscoped' | 'unresolved';
  /** 근거(어디서 대조했는가 · 왜 못 풀었는가) */
  why: string;
}

const walk = (dir: string, suffix: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, suffix, out);
    else if (p.endsWith(suffix)) out.push(p);
  }
  return out;
};

/**
 * 부모 id 가 조회 조건에 닿는 모양 — where 안, 읽어온 레코드와의 비교, 중첩 where, **또는 가드 헬퍼 위임**.
 * 🔴 헬퍼를 안 따라가면 D2 가 고친 자리(`ensureBelongsToPatient(patientId, id)`)가 전부 미대조로 잡힌다.
 */
const scopesBy = (body: string, parent: string, fileSrc?: string): boolean => {
  const inWhere = new RegExp(`where:\\s*\\{[^}]*\\b${parent}\\b`).test(body);
  const compared = new RegExp(`\\.${parent}\\s*!==\\s*${parent}\\b|\\b${parent}\\s*!==\\s*\\w+\\.${parent}\\b`).test(body);
  const nestedWhere = new RegExp(`\\b\\w+:\\s*\\{\\s*${parent}\\s*\\}`).test(body); // admission: { patientId }
  if (inWhere || compared || nestedWhere) return true;
  if (!fileSrc) return false;
  // 가드 헬퍼: `this.<helper>(<parent>, …)` 을 같은 파일에서 찾아 그 안에서 대조하는지 본다(1단계)
  for (const m of body.matchAll(new RegExp(`this\\.(\\w+)\\(\\s*${parent}\\b`, 'g'))) {
    const helper = m[1];
    const i = fileSrc.search(new RegExp(`(?:private|protected|public)?\\s*(?:async\\s+)?${helper}\\s*\\(`));
    if (i < 0) continue;
    const j = fileSrc.indexOf('\n  async ', i + 5);
    const hBody = fileSrc.slice(i, j < 0 ? i + 1500 : j);
    if (new RegExp(`where:\\s*\\{[^}]*\\b${parent}\\b`).test(hBody)
      || new RegExp(`\\.${parent}\\s*!==`).test(hBody)
      || new RegExp(`\\b\\w+:\\s*\\{\\s*${parent}\\s*\\}`).test(hBody)) return true;
  }
  return false;
};

export function judgeNestedRoutes(modulesDir: string): Judgement[] {
  const rows = nestedRoutes(scanRoutes(modulesDir));
  const svcFiles = walk(modulesDir, '.service.ts');
  const svcSrc = new Map(svcFiles.map((f) => [f, readFileSync(f, 'utf8')] as const));
  /** 서비스 클래스명 → 파일 */
  const classFile = new Map<string, string>();
  for (const [f, src] of svcSrc) {
    for (const m of src.matchAll(/export class (\w+)/g)) classFile.set(m[1], f);
  }

  const out: Judgement[] = [];
  for (const route of rows) {
    const parent = route.params[0];
    const ctrlSrc = readFileSync(join(modulesDir, route.file), 'utf8');
    const lines = ctrlSrc.split('\n');
    const seg = lines.slice(route.handlerLine - 1, route.handlerLine + 26).join('\n');
    const afterSig = seg.split(')').slice(1).join(')');

    // 핸들러가 부모를 아예 안 쓰면 그 자리에서 unscoped
    if (!new RegExp(`\\b${parent}\\b`).test(afterSig)) {
      out.push({ route, parent, verdict: 'unscoped', why: '핸들러가 부모 파라미터를 쓰지 않는다' });
      continue;
    }
    // 핸들러 안에서 직접 prisma 로 대조하는 경우
    if (scopesBy(afterSig, parent, ctrlSrc)) {
      out.push({ route, parent, verdict: 'scoped', why: '핸들러에서 직접 대조' });
      continue;
    }

    // 위임 — `this.<field>.<method>(` 의 field 를 생성자에서 타입으로 찾는다
    const call = new RegExp(`this\\.(\\w+)\\.(\\w+)\\(`).exec(afterSig);
    if (!call) {
      out.push({ route, parent, verdict: 'unresolved', why: '위임 호출을 찾지 못했다' });
      continue;
    }
    const [, field, method] = call;
    const inject = new RegExp(`(?:private|public|readonly)[^,)]*\\b${field}\\s*:\\s*(\\w+)`).exec(ctrlSrc);
    const cls = inject?.[1];
    const file = cls ? classFile.get(cls) : undefined;
    if (!file) {
      out.push({ route, parent, verdict: 'unresolved', why: `주입 타입을 찾지 못했다(${field})` });
      continue;
    }
    const src = svcSrc.get(file)!;
    const i = src.indexOf(`async ${method}(`);
    if (i < 0) {
      out.push({ route, parent, verdict: 'unresolved', why: `${relative(modulesDir, file)}에 ${method} 없음` });
      continue;
    }
    const j = src.indexOf('\n  async ', i + 5);
    const body = src.slice(i, j < 0 ? i + 3000 : j);
    // 서비스가 부모를 **다른 이름**으로 받을 수 있다(예: patientId → scopePatientId) — 시그니처 2번째 인자까지 본다
    const scoped = scopesBy(body, parent, src) || /where:\s*\{[^}]*\b(scopePatientId|patientId|admissionId|encounterId|worksheetId|contentId|templateId|assessmentId|consentId)\b/.test(body);
    out.push({
      route, parent,
      verdict: scoped ? 'scoped' : 'unscoped',
      why: `${relative(modulesDir, file)}:${method}`,
    });
  }
  return out;
}
