import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 색만으로 상태를 말하는 지표 — 보조 채널 가드 (임상 UX 규약 §4.6 / §4.6-a)
 *
 * 정본: `docs/01-plan/features/clinical-ux-agent-era.plan.md` §4.6, §4.6-a
 * 부품 정본: `src/components/ui/display.tsx` (StatusShapeMark / AdaptiveBadge)
 *
 * 🔴 이 가드가 지키는 것은 **"색-only 지표가 없다"가 아니다.** 그런 기준선은
 *    장식(단계 점·진행 막대·구분선·스켈레톤)까지 끌어들여 화면을 기호로 뒤덮게 만든다.
 *    이 가드가 지키는 것은 **"이미 판정해서 보조 채널을 붙인 지점이 다시 색-only 로 돌아가지 않는 것"**이다.
 *
 * 🔴 여유(허용 개수·부분 일치)를 두지 않는다 — 이 저장소에서 여유가 신규 위반을 흡수한 실측이 있다.
 *    각 지점은 **고유 마커**로 정확히 하나만 찾고, 그 요소가 aria-label 과 title 을 **둘 다** 들고 있어야 한다.
 *    (title = 마우스 · aria-label = 스크린리더. `ui.a11y.statusShape` 가 꺼져 있어도 둘 다 작동한다.)
 *
 * 🔴 문구는 색이 아니라 **원 변수**에서 와야 한다. 그래서 각 지점마다 그 변수를 함께 못박는다 —
 *    `bg-red-500` 을 보고 "위험"이라 지어내는 것은 정본 주석이 금지한 것이다.
 */

const SRC = path.join(__dirname, '..', '..', 'src');

/**
 * 보조 채널을 붙인 지점.
 * - `file`   : src 기준 경로
 * - `marker` : 그 요소를 **유일하게** 지목하는 문자열(색 클래스 조합 = 판정식 그대로)
 * - `source` : 문구의 출처가 되어야 하는 원 변수(색이 아니다)
 * - `words`  : 그 지점이 말해야 하는 상태 문구(전부 등장해야 한다 — 3상태를 2상태로 접으면 실패)
 */
const SITES: { file: string; marker: string; source: string; words: string[] }[] = [
  {
    file: 'components/nursing/NursingNotePanel.tsx',
    marker: "SEVERITY_DOT[note.severity ?? ''] || 'bg-gray-400'",
    source: 'note.severity',
    words: ['미기재'],
  },
  {
    file: 'app/tablet/_components/TabletNotificationBell.tsx',
    marker: "SEV_DOT[n.severity ?? ''] ?? 'bg-blue-400'",
    source: 'n.severity',
    words: ['sevWord', '위급', '주의', '정보', '중요도 미기재'],
  },
  {
    file: 'app/(main)/dashboard/components/widgets/SafetyAlertsWidget.tsx',
    // 2026-10-02 — 같은 제목을 묶어 그린다(g.urgent = 묶음 안에 위급이 하나라도 있음 · severityKnown = 중요도 기재)
    marker: "g.urgent ? 'bg-red-500' : g.severityKnown ? 'bg-blue-400' : 'bg-gray-300'",
    source: 'g.urgent',
    words: ['위급', '일반', '미기재'],
  },
  {
    file: 'app/(main)/dashboard/components/PendingHandoffBanner.tsx',
    marker: "ILLNESS_DOT[h.illness ?? ''] ?? 'bg-gray-300'",
    source: 'h.illness',
    words: ['illnessWord', '위급', '불안정', '안정', '중증도 미기재'],
  },
  {
    file: 'app/(main)/nurse-station/page.tsx',
    marker: "w-2.5 h-2.5 rounded-full flex-shrink-0 ${RISK_DOT[risk] ?? 'bg-gray-300'}",
    source: 'risk',
    words: ['riskWord', '낙상 고위험', '낙상 중등도 위험', '낙상 저위험', '낙상 위험도 미평가'],
  },
  {
    file: 'app/(main)/nurse-station/page.tsx',
    marker: "w-2.5 h-2.5 rounded-full ${RISK_DOT[risk] ?? 'bg-gray-300'}",
    source: 'risk',
    words: ['riskWord', '낙상 고위험', '낙상 중등도 위험', '낙상 저위험', '낙상 위험도 미평가'],
  },
  {
    file: 'app/(main)/icu/page.tsx',
    marker: "STATUS_DOT[bed.status] ?? 'bg-gray-300'",
    source: 'bed.status',
    words: ['bedStatusWord', '사용 가능', '재실', '정비 중', '상태 미상'],
  },
  {
    file: 'app/(main)/patients/[id]/components/NursingRecordTab.tsx',
    // 🔴 2026-08-24 판정식 변경(색-only 로 되돌린 것이 아니다) — 종전 `io.type` 은 **서버에 없는 키**라
    //    점이 언제나 amber(배출) 였다. 원장 컬럼(intakeAmount/outputAmount)으로 갈리며,
    //    한 행이 섭취·배출을 함께 담는 경우(teal)와 금액이 없는 경우(gray)가 새로 생겼다.
    marker: "hasIn && !hasOut ? 'bg-blue-400'",
    source: 'kind',
    words: ['섭취', '배출', '섭취·배출', '금액 미기록'],
  },
  {
    file: 'app/portal/_health/HealthTab.tsx',
    marker: "p.finding === 'ABNORMAL' ? 'bg-amber-400' : p.finding === 'CRITICAL' ? 'bg-red-400' : 'bg-blue-300'",
    source: 'p.finding',
    // 2026-10-19 포털 A2 — 판정 단어는 정본 `_shared/judgment`(정상·이상·위급·판정 미상)로 옮겼다 — 막대 라벨이 그 정본을 거친다
    words: ['barLabel', 'JUDGMENT_LABEL[findingJudgment(p.finding)]'],
  },
  {
    file: 'app/(main)/surgery/[id]/page.tsx',
    marker: "active ? DOT_COLOR[color] + ' animate-pulse' : done ? DOT_COLOR[color] : 'bg-gray-200'",
    source: 'done',
    words: ['진행 중', '완료', '미도달', '기록 없음'],
  },
  {
    file: 'app/(main)/admin/staff-management/page.tsx',
    marker: "m.role === 'DOCTOR' ? 'bg-blue-500'",
    source: 'm.role',
    words: ['USER_ROLE_LABEL'],
  },
  {
    file: 'app/(main)/admin/facility/page.tsx',
    marker: "r.isActive ? 'bg-emerald-400' : 'bg-gray-300'",
    source: 'r.isActive',
    words: ['운영 중', '미운영'],
  },
  {
    file: 'app/(main)/his-checkup/programs/page.tsx',
    marker: "cms.isActive ? 'bg-green-400' : 'bg-gray-300'",
    source: 'cms.isActive',
    words: ['게시 중', '미게시'],
  },
  {
    file: 'app/(main)/simulator/page.tsx',
    marker: "(e.type === 'patient' || e.entityType === 'PATIENT') ? 'bg-blue-500' : 'bg-emerald-500'",
    source: 'e.type',
    words: ['환자', '직원'],
  },
];

/** 마커를 품은 자기닫힘 JSX 요소 하나를 통째로 잘라낸다(중괄호·따옴표 균형). */
function enclosingSelfClosingTag(src: string, markerIdx: number): string | null {
  // 뒤로: 마커를 감싸는 가장 가까운 여는 태그
  let open = -1;
  for (const tag of ['<span', '<div']) {
    const i = src.lastIndexOf(tag, markerIdx);
    if (i > open) open = i;
  }
  if (open < 0) return null;
  // 앞으로: depth 0 의 '>' 까지
  let depth = 0;
  let q: string | null = null;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (depth === 0 && c === '>') {
      if (src[i - 1] !== '/') return null; // 자식이 있는 요소 — 이 가드의 대상이 아니다
      return src.slice(open, i + 1);
    }
  }
  return null;
}

describe('§4.6 색-only 상태 지표 — 보조 채널 회귀 가드', () => {
  for (const site of SITES) {
    it(`${site.file} · ${site.source} — aria-label + title 이 살아 있다`, () => {
      const full = path.join(SRC, site.file);
      expect(fs.existsSync(full), `${site.file} 이 없다 — 파일이 옮겨졌다면 SITES 를 고친다`).toBe(true);
      const src = fs.readFileSync(full, 'utf8');

      const first = src.indexOf(site.marker);
      expect(
        first,
        `마커를 못 찾았다: ${site.marker}\n판정식이 바뀌었다면 SITES 의 marker 를 함께 고친다(색-only 로 되돌린 것이 아닌지 먼저 확인).`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        src.indexOf(site.marker, first + 1),
        `마커가 둘 이상이다: ${site.marker} — 가드가 엉뚱한 지점을 볼 수 있다. 마커를 더 좁힌다.`,
      ).toBe(-1);

      const tag = enclosingSelfClosingTag(src, first);
      expect(tag, `${site.file}: 마커를 감싸는 자기닫힘 요소를 찾지 못했다`).not.toBeNull();

      expect(tag!, `${site.file}: 색-only 로 되돌아갔다 — aria-label 이 없다(${site.source})`).toMatch(/aria-label=/);
      expect(tag!, `${site.file}: 색-only 로 되돌아갔다 — title 이 없다(${site.source})`).toMatch(/title=/);

      // 🔴 문구의 출처가 색이 아니라 원 변수여야 한다
      const attrs = tag!;
      expect(
        attrs.includes(site.source),
        `${site.file}: 보조 문구가 원 변수(${site.source})를 참조하지 않는다 — 색에서 의미를 추측한 것이 아닌지 확인한다`,
      ).toBe(true);

      for (const w of site.words) {
        expect(
          attrs.includes(w) || src.includes(w),
          `${site.file}: 상태 문구 '${w}' 가 사라졌다 — 상태를 접으면(미상→정상) 화면이 거짓말한다`,
        ).toBe(true);
      }
    });
  }

  it('정본 부품(display.tsx)은 손대지 않았다 — shape 미지정 시 아무것도 그리지 않는 규칙 유지', () => {
    const display = fs.readFileSync(path.join(SRC, 'components', 'ui', 'display.tsx'), 'utf8');
    expect(display).toMatch(/if \(!shape \|\| !s\.statusShape\) return null;/);
  });
});

/**
 * 🔴 코디네이터 보강(2026-08-20) — 문구뿐 아니라 **색도** 미평가와 저위험을 갈라야 한다.
 *
 * a11y 회수 때 `RISK_DOT` 의 문구는 갈랐지만 색은 `NONE`·`LOW` 가 **둘 다 초록**이었다.
 * `riskLevel()` 이 `fallRiskLevel ?? 'NONE'` 으로 접으므로 `NONE` 은 "위험 없음"이 아니라
 * **평가하지 않았다**는 뜻이다 — 모르는 것을 안전한 색으로 칠하면 화면이 실제보다 더 안전하게 말한다.
 *
 * 재주입: `NONE: 'bg-gray-300'` 을 `'bg-emerald-500'` 으로 되돌리면 실패한다.
 */
describe('낙상 위험도 — 미평가를 저위험과 같은 색으로 칠하지 않는다', () => {
  it('🔴 RISK_DOT 의 NONE 과 LOW 는 다른 색이다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'nurse-station', 'page.tsx'), 'utf8');
    const block = src.slice(src.indexOf('const RISK_DOT'), src.indexOf('const RISK_DOT') + 700);
    const pick = (k: string) => block.match(new RegExp(`\\b${k}:\\s*'([^']+)'`))?.[1];
    const none = pick('NONE');
    const low = pick('LOW');
    expect(none, 'NONE 색을 찾지 못했다').toBeTruthy();
    expect(none, '미평가(NONE)가 저위험(LOW)과 같은 색이다 — 모르는 것을 안전하게 칠한다').not.toBe(low);
    expect(none, '미평가는 안전색(emerald)이 아니어야 한다').not.toMatch(/emerald|green/);
  });
});
