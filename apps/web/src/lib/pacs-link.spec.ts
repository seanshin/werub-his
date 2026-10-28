import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 브라우저가 여는 PACS 링크 계약 — 2026-08-02.
 *
 * 🔴 `/pacs/` 는 **Orthanc** 이고 자체 Basic 인증이 걸려 있다
 *    (`WWW-Authenticate: Basic realm="Orthanc Secure Area"`, 실측 401).
 *    링크를 열면 브라우저가 HIS 로그인과 무관한 아이디/비밀번호 창을 띄운다 — 사용자에게는
 *    "왜 또 로그인?" 으로 보이고, 자격을 모르니 진입 자체가 막힌다.
 *    브라우저가 여는 뷰어는 **OHIF(`/viewer/`)** 여야 한다(실측 200, 인증 창 없음).
 *
 * 서버 호출(`/api/v1/pacs/*`)은 HIS 프록시라 무관하다.
 */
const SRC = join(process.cwd(), 'src');

/**
 * 🔴 주석은 코드가 아니다.
 *
 * 이 가드의 첫 판은 주석에 적힌 `/api/v1/portal/imaging/upload`·'불러오지 못' 때문에
 * **결함을 재주입해도 초록이었다**(2026-08-18 역검증에서 적발). 단언은 코드 줄만 본다.
 */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    // 줄 끝 주석도 뗀다(`http://` 는 앞이 공백이 아니라 살아남는다)
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('PACS 뷰어 링크', () => {
  const files = walk(SRC).filter((f) => !f.endsWith('pacs-link.spec.ts'));

  it('소스를 실제로 훑었다', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('🔴 브라우저가 여는 raw /pacs/ 링크가 없다 — Orthanc Basic 인증 창이 뜬다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      for (const line of src.split('\n')) {
        // 주석·HIS 프록시 경로(/api/v1/pacs/)는 제외
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//')) continue;
        if (/['"`]\/pacs\//.test(line) && !line.includes('/api/v1/pacs/')) {
          offenders.push(`${f.replace(SRC, 'src')}: ${t.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('공용 헬퍼는 OHIF 로 연다', () => {
    const helper = readFileSync(join(SRC, 'lib/pacs.ts'), 'utf-8');
    expect(helper).toContain("'/viewer/'");
    expect(helper).not.toMatch(/window\.open\(['"`]\/pacs\//);
  });

  /**
   * 🔴 `/pacs-api/` 직접 호출 확산 차단 (2026-08-13 · 화면 점검 W3 후속).
   *
   * PACS 는 **HIS 프록시(`/api/v1/pacs/*`·`/api/v1/portal/imaging/*`)로만** 부른다 —
   * 직접 호출은 HIS 의 JWT·RBAC·감사를 통째로 우회하고, 실패를 삼키면 "영상이 없습니다"로
   * 위장된다(간호 영상 조회에서 이미 겪은 결함).
   * 위 `/pacs/` 정규식은 `/pacs-api/` 를 **잡지 못한다**(`/pacs-` ≠ `/pacs/`) — 그래서 이 갭이
   * 테스트 그린인 채로 남아 있었다. **내가 만든 가드도 점검 대상이다.**
   *
   * 기준선은 **줄어들기만 한다.** 여기에 새 파일을 추가하지 말 것.
   *
   * 이관 이력:
   *  - 2026-08-18 ① 포털 영상 목록  → `GET /api/v1/portal/imaging/studies`
   *  - 2026-08-18 ② 포털 영상 업로드 → `POST /api/v1/portal/imaging/upload`(멀티파트 중계)
   *  - 2026-08-18 ③ 포털 썸네일     → `GET /api/v1/portal/imaging/study/:uid/thumbnail`(바이너리)
   *  - 2026-08-18 ④ 판독 WS wado    → `GET /api/v1/pacs/wado`(바이너리)
   *
   * 남은 1건(pacs-portal)은 **PACS 자체 계정 로그인**이 발급원이라 EP 교체만으로는 안 된다 —
   * `my-patients` 스코프가 PACS 쪽 로그인 신원에서 나오기 때문. 이관 설계가 따로 필요하다.
   *
   * 🔴 2026-08-18 재실측 결론 = **현행 유지(c)**. 근거:
   *  - HIS 프록시에 `my-patients` 대응 EP 가 없다(운영 실측 `GET /api/v1/pacs/my-patients` → 404).
   *    만들려면 "이 HIS 의사의 환자"를 HIS 가 정의해야 한다(주치의/오더 발행의/진료과) — 결정이 먼저다.
   *  - `/workstation/reading` 은 **HIS ImagingResult(status=ACQUIRED) 판독 대기열에 소견을 쓰는**
   *    영상의학과 화면이고, 이 화면은 **주치의가 PACS 원장의 판독 완료본을 읽는** 화면이다.
   *    소재만 겹칠 뿐 대체 관계가 아니다 — 접으면 주치의의 읽기 경로가 사라진다(통폐합 기각).
   *  - 두 화면 모두 Sidebar 도달(DOCTOR_ADMIN)·screen-code 등재 상태다(죽은 화면 아님).
   * 그래서 이관 대신 **화면이 사실을 말하게** 만들고, 아래 가드로 동결한다.
   */
  const PACS_API_BASELINE = new Set([
    'src/app/(main)/pacs-portal/page.tsx',        // 별도 PACS 로그인(localStorage 'pacs-token')의 발급원
  ]);

  it('🔴 `/pacs-api/` 직접 호출이 기준선 밖으로 늘지 않는다 — PACS 는 HIS 프록시로만', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.replace(SRC, 'src');
      if (PACS_API_BASELINE.has(rel)) continue;
      const src = readFileSync(f, 'utf-8');
      for (const line of src.split('\n')) {
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//')) continue;
        if (/['"`]\/pacs-api\//.test(line)) offenders.push(`${rel}: ${t.slice(0, 80)}`);
      }
    }
    expect(offenders, 'PACS 직접 호출은 HIS 인증·감사를 우회한다 — /api/v1/pacs/* 프록시를 쓸 것').toEqual([]);
  });

  /**
   * 🔴 이관된 화면이 **프록시를 실제로 부르는지**까지 본다.
   *
   * 기준선에서 이름을 지우는 것만으로는 아무것도 보증하지 않는다 — 호출을 통째로 지워도
   * 기준선 테스트는 초록이다(**통과하는 테스트가 아무것도 보증하지 않을 수 있다**).
   */
  const MIGRATED: { file: string; must: string[] }[] = [
    { file: 'src/app/portal/imaging/page.tsx', must: ['/api/v1/portal/imaging/studies', '/api/v1/portal/imaging/upload'] },
    { file: 'src/app/portal/_health/HealthTab.tsx', must: ['/api/v1/portal/imaging/study/', 'thumbnail'] },
    /**
     * 🔴 2026-08-18 재실측으로 **삭제**: 판독 WS 의 `/api/v1/pacs/wado` 호출은 오직
     *    WeRU.B 사전판독(`image_url` 방식)에 넘길 URL 을 만들기 위한 것이었다. 그런데
     *      · `ImagingResult` 에 StudyInstanceUID 컬럼이 없어 `studyUID=` 는 늘 비어 있었고
     *      · 그 경로는 HIS 인증을 요구해 외부 AI 가 가져갈 수도 없다
     *    → 사전판독은 성립한 적이 없다. 화면이 그 사실을 말하도록 호출을 걷어냈다
     *      (가드를 초록으로 만들려고 죽은 호출을 남겨두는 것은 연출이다).
     *    이 화면의 PACS 진입은 `openPacsViewer()`(OHIF) 가 담당한다 — 위 `/pacs/` 가드가 지킨다.
     *    사전판독이 살아나면 `pacs-proxy.fetchWadoImage()` → `ai/vision/medical/analyze`(바이트)
     *    경로로 돌아오며, 그때 이 표에 다시 등재한다. 현행 계약은
     *    `test/ui/reading-pre-read-honesty.spec.ts` 가 지킨다.
     */
  ];

  it.each(MIGRATED)('$file 은 PACS 를 HIS 프록시로 부른다', ({ file, must }) => {
    const src = codeOnly(readFileSync(join(SRC, file.replace(/^src\//, '')), 'utf-8'));
    for (const needle of must) expect(src, `${file} 에 ${needle} 호출이 없다`).toContain(needle);
  });

  /**
   * 🔴 조회 실패를 "없음"으로 바꿔 말하지 않는다.
   *
   * 서버(W9)는 PACS 장애를 503 으로 정직하게 말하는데 화면이 그 말을 빈 목록·회색 아이콘으로
   * 덮으면 환자는 "내 영상이 사라졌다"고 읽는다(P17). 실패 분기가 살아 있는지 본다.
   */
  it.each([
    { rel: 'src/app/portal/imaging/page.tsx', state: 'loadError' },
    { rel: 'src/app/portal/_health/HealthTab.tsx', state: 'isError' },
  ])('$rel 은 영상 조회 실패를 "없음"이 아니라 "불러오지 못함"으로 말한다', ({ rel, state }) => {
    const src = codeOnly(readFileSync(join(SRC, rel.replace(/^src\//, '')), 'utf-8'));
    expect(src, `${rel}: 실패 상태(${state})를 아예 다루지 않는다`).toContain(state);
    expect(src, `${rel}: 실패 분기 문구가 없다`).toMatch(/불러오지 못/);
    expect(src, `${rel}: 영상이 없는 것이 아님을 말하지 않는다`).toMatch(/영상이 없는 것이 아/);
  });

  /**
   * 🔴 아무도 쓰지 않는 localStorage 키로 로그인 여부를 판정하지 않는다 (2026-08-18).
   *
   * `/portal/imaging` 은 `portal-token`·`portal-patient-id` 가 있어야 화면을 그렸는데
   * **`portal-patient-id` 는 이 저장소 어디에서도 저장되지 않는다.** 그래서 로그인한 환자에게도
   * 이 화면은 언제나 "포털 로그인이 필요합니다"였다 — 목록 이관 성과도 화면에 닿지 못했다.
   * (읽기 전용 키가 정당하게 필요하면 이 목록에 근거와 함께 등재한다.)
   */
  const READ_ONLY_LOCAL_KEYS = new Set<string>([]);

  it('🔴 읽기만 하고 아무도 저장하지 않는 localStorage 키가 없다 — 영원히 거짓인 조건', () => {
    const reads = new Map<string, Set<string>>();
    const writes = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/localStorage\.getItem\(\s*['"]([^'"]+)['"]/g)) {
        if (!reads.has(m[1])) reads.set(m[1], new Set());
        reads.get(m[1])!.add(f.replace(SRC, 'src'));
      }
      for (const m of src.matchAll(/localStorage\.setItem\(\s*['"]([^'"]+)['"]/g)) writes.add(m[1]);
    }
    const orphans = [...reads.entries()]
      .filter(([k]) => !writes.has(k) && !READ_ONLY_LOCAL_KEYS.has(k))
      .map(([k, v]) => `${k} ← ${[...v].join(', ')}`);
    expect(orphans, '저장되지 않는 키를 읽으면 그 조건은 영원히 거짓이다(화면이 통째로 죽는다)').toEqual([]);
  });

  it('기준선은 1건 이하로만 유지된다 — 새 직접 호출 화면을 등재하지 않는다', () => {
    expect(PACS_API_BASELINE.size).toBeLessThanOrEqual(1);
  });

  /**
   * 🔴 별도 로그인을 요구하면 **왜 필요한지 화면이 말해야 한다** (2026-08-18).
   *
   * 종전 `/pacs-portal` 은 이유 없이 로그인 창만 띄웠다. 사용자는 HIS 계정을 넣고 실패한 뒤
   * "고장 났다"고 읽는다 — 실제로는 PACS 계정이 따로 있어야 하고, 그 계정은 영상팀이 발급한다.
   */
  describe('별도 PACS 로그인 화면(pacs-portal)', () => {
    const src = codeOnly(readFileSync(join(SRC, 'app/(main)/pacs-portal/page.tsx'), 'utf-8'));

    it('왜 HIS 계정이 아닌 별도 로그인인지 화면이 말한다', () => {
      expect(src, '별도 로그인 사유 문구가 코드에 없다').toMatch(/HIS 계정으로 로그인되지 않습니다/);
      expect(src, '누가 계정을 발급하는지 말하지 않는다').toMatch(/영상팀/);
      expect(src, '계정이 없을 때의 대안 경로를 말하지 않는다').toMatch(/환자 차트/);
    });

    it('PACS 가 닿지 않으면 "로그인해도 실패한다"고 미리 말한다', () => {
      // 🔴 부분 문자열 단언은 깨진 값을 숨긴다(`/api/v1/pacs/health-XXX` 도 통과했었다) — 따옴표까지 본다.
      expect(src, 'PACS 가용성을 HIS 프록시 health 로 확인하지 않는다').toMatch(/'\/api\/v1\/pacs\/health'/);
      expect(src, '가용성 실패를 화면이 말하지 않는다').toMatch(/로그인해도 실패합니다/);
    });

    it('조회·판독지 실패를 "없음"으로 바꿔 말하지 않는다', () => {
      expect(src, '조회 실패 분기가 없다').toMatch(/영상이 없는 것이 아니라 불러오지 못했습니다/);
      expect(src, '판독지 실패를 "없음"과 갈라 말하지 않는다').toMatch(/판독지가 없는 것이 아닙니다/);
    });

    it('🔴 인증이 필요한 PACS 경로를 헤더 없는 앵커로 열지 않는다 — 항상 401 인 버튼이 된다', () => {
      // `<a href={`${PACS_API}/...`}>` 는 Authorization 헤더를 실을 수 없다(실측: 해당 경로 무인증 401).
      expect(src, 'PACS 경로를 href 로 직접 연다 — 토큰이 실리지 않아 항상 실패한다')
        .not.toMatch(/href=\{`\$\{PACS_API\}/);
      expect(src, '판독지 PDF 를 토큰과 함께 받아오지 않는다').toContain('Authorization: `Bearer ${pacsToken}`');
    });

    it('🔴 PACS 가 준 viewer_url 을 그대로 열지 않는다 — 공용 헬퍼(OHIF)로만 연다', () => {
      // 소스 가드는 런타임 값을 볼 수 없다. `viewer_url` 이 `/pacs/`(Orthanc) 이면 Basic 인증 창이 뜬다.
      expect(src, 'PACS 응답의 viewer_url 을 링크로 연다').not.toMatch(/href=\{[^}]*viewer_url/);
      expect(src, 'window.open 으로 viewer_url 을 연다').not.toMatch(/window\.open\([^)]*viewer_url/);
      expect(src, '공용 뷰어 헬퍼를 쓰지 않는다').toContain('openPacsViewer(');
    });
  });

  it('기준선 파일이 이관되면 목록에서 지운다(동결값이 실제보다 크면 알린다)', () => {
    const stale = [...PACS_API_BASELINE].filter((rel) => {
      const p = join(SRC, rel.replace(/^src\//, ''));
      try {
        return !/['"`]\/pacs-api\//.test(readFileSync(p, 'utf-8'));
      } catch {
        return true; // 파일이 사라졌으면 기준선에서도 지운다
      }
    });
    expect(stale, '이관 완료된 파일은 PACS_API_BASELINE 에서 제거할 것').toEqual([]);
  });
});
