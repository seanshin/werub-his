/**
 * 핸들러 접근 통제 스캐너 — "이 EP 를 **누가** 부를 수 있는가"의 정본.
 *
 * 🔴 왜 따로 만드는가(2026-09-16): 기존 `role-endpoint-scan.ts` 는 **nav(화면) 에서 출발**해
 *    "화면은 열렸는데 EP 가 닫혀 403" 만 찾는다. 그 스캔에서 `@Roles` 가 **아예 없는** 핸들러는
 *    `roles.length === 0 → roleOk = true` 로 **정상 취급**된다 — 즉 "너무 열린 EP" 는 구조적으로 안 보인다.
 *    그래서 원격진료 컨트롤러의 역할 누락 13개가 가드 전부를 통과한 채 운영에 올라가 있었다
 *    (READ·CRM 역할이 임상 세션 목록·통계를 조회할 수 있었다 · 2026-09-15 M2 에서 발견).
 *    이 스캐너는 **컨트롤러에서 출발**해 그 반대 방향(과다 개방)을 센다.
 *
 * 🔴 런타임 규약(`RolesGuard`)을 그대로 옮긴다:
 *    · 핸들러 `@Roles` 가 있으면 **클래스 `@Roles` 를 덮는다**(`handlerRoles ?? classRoles`).
 *    · `@Roles` 도 `@RequirePermission` 도 없으면 **인증된 전 직원 역할이 통과**한다.
 *    · `ADMIN` 은 역할 검사를 통과한다(권한 검사는 별도).
 *
 * 🔴 "게이트가 없다" 판정은 데코레이터만으로 하지 않는다 — 이 저장소는 역할 말고도
 *    권한(`@RequirePermission`)·기능키(`@RequireFeature`)·자격(`@RequireCred`)·상담원 등급(`@ConsultRole`)·
 *    SMART scope(`@FhirScope`)·재인증(`@RequireStepUp`)으로 막고, **가드 자체가 주체를 좁히는** 경우도 있다
 *    (포털·환자·딜러·상담원·FHIR 이중 인증). 첫 스캔은 이걸 빠뜨려 검진권 11EP 를 오탐으로 올렸다
 *    (`@RequireFeature('voucher.admin')` 로 이미 막혀 있었다) — 오탐은 자진 철회한다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API_SRC = join(process.cwd(), 'src');

/**
 * 주석 제거 — **문자열 안의 `/*` 를 주석 시작으로 읽지 않는다.**
 *
 * 🔴 (2026-09-16 실측) 종전 정규식판(`s.replace(/\/\*[\s\S]*?\*\//g, '')`)은
 *    `fhir.controller.ts` 86줄의 설명 문자열에 있는 `(system/*)` 를 주석 시작으로 읽고
 *    다음 JSDoc 종료(`*​/`)까지 **9,057자를 통째로 지웠다** — 그 안에 있던
 *    `GET/POST/PUT /fhir/R4/Patient` **4개 라우트가 스캔 분모에서 사라졌다**.
 *    같은 함수를 쓰는 기존 `role-endpoint-scan.ts` 도 이 구간을 못 본다(가드의 사각).
 *    분모가 틀리면 "역할 누락 0" 같은 결론이 통째로 거짓이 된다 — 그래서 문자열을 인식한다.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { // 줄 주석
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') { // 블록 주석
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { // 문자열·템플릿 — 통째로 보존(안의 `/*` 는 주석이 아니다)
      const q = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** 인증 주체를 세우는 가드(이게 없으면 무인증 공개 EP 다) */
const AUTH_GUARD =
  /JwtAuthGuard|FhirDualAuthGuard|PortalAuthGuard|PortalOrPatientGuard|PatientAccountAuthGuard|SmartAuthGuard|DistributorAuthGuard|OnboardingTokenGuard|AppAssertionGuard|ConsentDeviceStreamGuard|DisplayKeyStreamGuard|ConsultStaffStreamGuard|ConsultPortalStreamGuard|DailyPinGuard|CredGuard|BtgGuard/;

/**
 * 가드 스스로 주체를 좁히는 것들 — `@Roles` 가 없어도 "전 직원 개방"이 아니다.
 * (포털·환자·딜러 = 직원이 아님 · 상담원 = 등록 멤버십 · FHIR 이중 = 설정 역할 목록 판정)
 */
const SELF_SCOPING_GUARD =
  /FhirDualAuthGuard|SmartAuthGuard|PortalAuthGuard|PortalOrPatientGuard|PatientAccountAuthGuard|DistributorAuthGuard|OnboardingTokenGuard|AppAssertionGuard|ConsentDeviceStreamGuard|DisplayKeyStreamGuard|ConsultAgentGuard|ConsultStaffStreamGuard|ConsultPortalStreamGuard|DailyPinGuard|CredGuard|BtgGuard/;

/** 역할 말고 다른 축으로 막는 데코레이터 — 이게 있으면 "게이트 없음"이 아니다 */
const OTHER_GATE_DECORATORS =
  /@RequirePermission\(|@RequireFeature\(|@RequireCred\(|@ConsultRole\(|@FhirScope\(|@RequireStepUp\(/;

export interface AuthzHandler {
  /** `src/` 상대 경로 */
  file: string;
  /** `@Controller('...')` prefix */
  prefix: string;
  /** `GET patients/:id` 꼴 */
  ep: string;
  /** 메서드 이름 */
  fn: string;
  /** 클래스+핸들러 가드 문자열 */
  guards: string;
  /** 유효 역할(핸들러가 클래스를 덮는다) — 비어 있으면 역할 제한 없음 */
  roles: string;
  /** 역할 밖 게이트가 붙어 있는가 */
  otherGate: boolean;
  /** 인증 가드가 있는가 */
  authed: boolean;
  /** 가드 자체가 주체를 좁히는가 */
  selfScoped: boolean;
  /** 🔴 인증된 **전 직원 역할**이 통과하는가(= 과다 개방 후보) */
  openToEveryStaffRole: boolean;
  /** `@Throttle` 이 이 핸들러(또는 클래스)에 붙어 있는가 — 공개 쓰기의 자기 한도 */
  throttled: boolean;
  /** `@SkipThrottle` 로 전역 한도를 끈 자리인가(서버-서버 연동에서만 정당) */
  skipThrottle: boolean;
}

/**
 * `@Controller` 한 개의 **클래스 데코레이터 구간**을 뽑는다 — 한 파일에 클래스가 여럿일 때의 정본.
 *
 * 🔴 (2026-09-16 I1) 고정 창(`at - 800`·`at - 400`)으로 읽으면 **앞 클래스의 본문까지 끌어와**
 *    앞 클래스의 `@UseGuards`·`@Roles` 를 뒤 클래스 것으로 붙인다. 실측: 공개 문진표 클래스가
 *    앞 클래스의 `JwtAuthGuard` 를 주워 무인증 동결 목록에서 빠졌다(140 → 실제 144).
 * 🔴 되감기는 **데코레이터 줄과 빈 줄만** 넘는다 — 주석을 걷으면 데코레이터 사이에 빈 줄이 남기 때문이다
 *    (`@UseGuards` → JSDoc → `@Roles` → `@Controller` 배치). 빈 줄에서 멈추면 반대로
 *    인증된 컨트롤러가 무더기로 "공개"로 뒤집힌다(실측 140 → 296).
 *
 * @param src   주석을 걷어낸 파일 내용
 * @param at    이 `@Controller` 의 인덱스
 * @param prevAt 앞 `@Controller` 의 인덱스(없으면 0) — 이 아래로는 내려가지 않는다
 */
export function classDecoratorHead(src: string, at: number, prevAt = 0): string {
  const classEnd = src.indexOf('export class', at);
  let headStart = src.lastIndexOf('\n', at) + 1;
  for (;;) {
    const prevLineStart = src.lastIndexOf('\n', headStart - 2) + 1;
    if (prevLineStart >= headStart || prevLineStart < prevAt) break;
    const line = src.slice(prevLineStart, headStart);
    if (!/^\s*@/.test(line) && line.trim() !== '') break;
    headStart = prevLineStart;
  }
  return src.slice(headStart, classEnd > 0 ? classEnd : at);
}

export function scanHandlerAuthz(): AuthzHandler[] {
  const out: AuthzHandler[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) { walk(f); continue; }
      if (!e.endsWith('.controller.ts')) continue;
      const s = stripComments(readFileSync(f, 'utf8'));
      /**
       * 🔴 (2026-09-21 I) **경로 없는 `@Controller()` 를 놓치지 않는다.**
       *    종전 정규식은 `@Controller('...')` 만 잡았다 — 인자가 없는 `@Controller()` 는
       *    **컨트롤러 통째로** 분모에서 빠졌다(실측 4파일·핸들러 21개). 이 꼴은 라우트 전체를
       *    핸들러 데코레이터에 적는 컨트롤러가 쓴다(`@Get('api/v1/clinic-schedule')`).
       *    빠져 있던 것 중 **역할 미지정 6 · 무인증 6** 이 나왔다 — "역할 미지정 101" 이
       *    실제로는 그 6을 본 적이 없다는 뜻이다. 분모가 틀리면 결론이 통째로 거짓이 된다.
       */
      const marks = [...s.matchAll(/@Controller\(\s*(?:'([^']*)')?\s*\)/g)];
      for (let i = 0; i < marks.length; i++) {
        const at = marks[i].index!;
        const seg = s.slice(at, i + 1 < marks.length ? marks[i + 1].index! : s.length);
        // 클래스 데코레이터는 `@Controller` **앞뒤 모두**에 올 수 있다(@UseGuards 는 보통 앞, @Roles 는 뒤인 파일도 있다)
        const classEnd = s.indexOf('export class', at);
        /**
         * 🔴 (2026-09-16 I1) 종전 판은 `@Controller` 앞 **800자 고정 창**을 클래스 데코레이터로 읽었다.
         *    파일에 `@Controller` 가 둘 이상이면 그 창이 **앞 클래스의 본문까지 끌어와**
         *    앞 클래스의 `@UseGuards`·`@Roles` 를 뒤 클래스 것으로 붙였다.
         *    실측 피해: `questionnaire.controller.ts` 의 공개 클래스(`api/v1/questionnaires`)가
         *    앞 클래스의 `@UseGuards(JwtAuthGuard)` 를 주워 **인증된 것으로 오판**돼
         *    무인증 동결 목록(140)과 공개 쓰기 한도 목록에서 **통째로 빠져 있었다**
         *    (무인증 쓰기 2개 포함 — H1·H2 의 "140 전건 판정"이 그 3개를 본 적이 없다).
         *    이제 `@Controller` 바로 위의 **연속된 데코레이터 줄까지만** 거슬러 올라간다
         *    (핸들러 구간을 자르는 방식과 같다 · 이 저장소에 여러 줄 데코레이터는 0건).
         */
        const head = classDecoratorHead(s, at, i > 0 ? marks[i - 1].index! : 0);
        const classGuards = [...head.matchAll(/@UseGuards\(([^)]*)\)/g)].map((m) => m[1]).join(',');
        const classRoles = [...head.matchAll(/@Roles\(([^)]*)\)/g)].map((m) => m[1]).join(',');
        const classOther = OTHER_GATE_DECORATORS.test(head);
        /**
         * 🔴 핸들러 구간은 **다음 HTTP 데코레이터까지**로 자른다.
         *    첫 판은 `@Get(...)` 뒤 700자 안에서 메서드 시그니처를 찾는 꼴이었는데,
         *    데코레이터가 긴 핸들러(@ApiQuery 여러 줄 등)는 창을 넘겨 **조용히 스캔에서 빠졌다**
         *    — `/fhir/R4/Patient` 계열이 통째로 분모에서 사라졌다(3,264 vs 실제). 분모가 틀리면 결론도 틀린다.
         *    데코레이터는 `@Get` 앞뒤 어디에도 올 수 있으므로, 앞의 연속 데코레이터 줄까지 그 핸들러 몫으로 본다.
         */
        const httpRe = /@(Get|Post|Put|Patch|Delete|Sse)\(\s*'?([^')]*?)'?\s*\)/g;
        const marksH: { i: number; start: number; method: string; path: string }[] = [];
        let hm: RegExpExecArray | null;
        while ((hm = httpRe.exec(seg))) {
          // 이 데코레이터 앞의 연속된 데코레이터 줄까지 거슬러 올라간다
          let start = seg.lastIndexOf('\n', hm.index) + 1;
          for (;;) {
            const prevLineStart = seg.lastIndexOf('\n', start - 2) + 1;
            if (prevLineStart >= start || prevLineStart < 0) break;
            if (!/^\s*@/.test(seg.slice(prevLineStart, start))) break;
            start = prevLineStart;
          }
          marksH.push({ i: hm.index, start, method: hm[1], path: hm[2] });
        }
        for (let k = 0; k < marksH.length; k++) {
          const cur = marksH[k];
          const blk = seg.slice(cur.start, k + 1 < marksH.length ? marksH[k + 1].start : seg.length);
          const fn = blk.match(/\n\s*(?:public\s+|private\s+)?(?:async\s+)?(\w+)\s*\(/)?.[1] ?? '?';
          const hGuards = [...blk.matchAll(/@UseGuards\(([^)]*)\)/g)].map((x) => x[1]).join(',');
          const hRoles = [...blk.matchAll(/@Roles\(([^)]*)\)/g)].map((x) => x[1]).join(',');
          const guards = `${classGuards},${hGuards}`;
          // 런타임과 같게: 핸들러 @Roles 가 있으면 클래스 것을 덮는다
          const roles = hRoles || classRoles;
          const otherGate = classOther || OTHER_GATE_DECORATORS.test(blk);
          const authed = AUTH_GUARD.test(guards);
          const selfScoped = SELF_SCOPING_GUARD.test(guards);
          out.push({
            file: f.replace(API_SRC + '/', ''),
            // 경로 없는 `@Controller()` 는 프리픽스가 `/` 다(라우트 전문을 핸들러가 갖는다)
            prefix: '/' + (marks[i][1] ?? '').replace(/^\//, ''),
            ep: `${cur.method.toUpperCase()} ${cur.path || ''}`.trim(),
            fn,
            guards, roles, otherGate, authed, selfScoped,
            openToEveryStaffRole: authed && !selfScoped && !roles && !otherGate,
            // 🔴 클래스/핸들러 **양쪽**을 본다 — 파일에 `@Controller` 가 둘이면 첫 클래스의
            //    `@SkipThrottle` 을 두 번째 클래스 핸들러에 잘못 붙이는 오판이 나온다(위치로 자른 구간만 본다).
            throttled: /@Throttle\(/.test(head) || /@Throttle\(/.test(blk),
            skipThrottle: /@SkipThrottle\(/.test(head) || /@SkipThrottle\(/.test(blk),
          });
        }
      }
    }
  };
  /**
   * 🔴 (2026-09-21 I) **`src/modules` 밖의 컨트롤러도 센다.**
   *    종전엔 `src/modules` 만 훑어 `src/sentinel`·`src/common` 의 컨트롤러 3파일(핸들러 11개)이
   *    분모에 없었다 — 그중 `GET /api/v1/mode`(운영 모드 조회)는 역할 미지정인데
   *    동결 목록 어디에도 없었다. "모듈 아래에만 컨트롤러가 있다"는 가정은 규약이 아니다
   *    (부팅은 `app.module` 이 하고, 그쪽은 경로를 가리지 않는다).
   */
  walk(API_SRC);
  return out;
}

/**
 * 기준선 동결용 안정 키 — `"<file>|<prefix>|<METHOD path>"`.
 *
 * 🔴 (2026-09-16 I1) 종전 키는 `<file>|<METHOD path>` 라 **컨트롤러 프리픽스를 담지 않았다**.
 *    한 파일에 `@Controller` 가 둘이면 서로 다른 EP 가 **같은 키를 공유**한다(실측 10쌍 · 그중 5쌍은
 *    인증/무인증이 섞여 있다 — 예: `agent-session` 의 `/api/v1/agent`(인증) 와 `/api/v1/booking`(공개)).
 *    키가 겹치면 한쪽이 인증→무인증으로 바뀌고 다른 쪽이 반대로 바뀌어도 **두 목록의 값이 그대로**라
 *    동결이 거짓 안심이 된다. H2 도 이 때문에 판정을 한 번 철회했다.
 */
export function authzKey(h: Pick<AuthzHandler, 'file' | 'prefix' | 'ep'>): string {
  return `${h.file}|${h.prefix}|${h.ep}`;
}

/** 과다 개방 핸들러 — 기준선 동결용 안정 표현 */
export function openToEveryStaffRole(): string[] {
  return scanHandlerAuthz()
    .filter((h) => h.openToEveryStaffRole)
    .map(authzKey)
    .sort();
}
