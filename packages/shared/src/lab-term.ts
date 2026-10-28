/**
 * 검사 항목명 한/영 정본 — 기획 `medical-term-display-toggle.plan.md` P1.
 *
 * 배경(운영 실측 2026-09-04): `lab_result_items.testName` 은 단일 필드이고 어휘는 66종.
 * 저장 형태가 섞여 있다 — `WBC` · `WBC (백혈구)` · `공복혈당 (FBS)` · `칼륨` 이 공존한다.
 *
 * 🔴 사전(LAB_TERM_KO)은 **저장소의 시드·운영 데이터가 스스로 담고 있던 쌍에서 수확**했고,
 *    거기 없는 항목은 널리 확립된 임상 어휘(혈당·백혈구 급)만 더했다.
 *    AST·ALT·LDL·HDL·GGT·MCV 처럼 한국 임상 관례가 영문 약어 그대로인 것은
 *    **의도적으로 미등재**다 — 억지 한글명을 만들면 오히려 못 알아본다.
 * 🔴 미등재는 원문 그대로 — 번역을 지어내지 않는다.
 * 🔴 표시 전용 — 저장된 testName·검색·집계는 불변.
 */

const HANGUL = /[ㄱ-ㆎ가-힣]/;

const norm = (s: string) => s.trim().toLowerCase();

/** 영문(약어) → 한글. 키는 norm() 형 */
export const LAB_TERM_KO: Record<string, string> = {
  // ── 운영 데이터·시드의 병기 행에서 수확
  wbc: '백혈구',
  hemoglobin: '혈색소',
  hb: '혈색소',
  hematocrit: '적혈구용적률',
  hct: '적혈구용적률',
  platelet: '혈소판',
  plt: '혈소판',
  creatinine: '크레아티닌',
  bun: '혈중요소질소',
  glucose: '혈당',
  fbs: '공복혈당',
  k: '칼륨',
  na: '나트륨',
  crp: 'C-반응성 단백',
  tsh: '갑상선자극호르몬',
  hba1c: '당화혈색소',
  // ── 확립된 임상 어휘(검수 대상 — 시드/데이터 밖 추가분)
  rbc: '적혈구',
  ca: '칼슘',
  cl: '염소',
  albumin: '알부민',
  iron: '철',
  ferritin: '페리틴',
  'uric acid': '요산',
  phosphorus: '인',
  reticulocyte: '망상적혈구',
  'total cholesterol': '총콜레스테롤',
  tg: '중성지방',
  triglyceride: '중성지방',
  'free t4': '유리 T4',
};

/** 한글 → 영문 역인덱스(한글 단독 저장 행 — '칼륨' — 의 영문 병기용) */
const EN_BY_KO: Record<string, string> = {};
for (const [en, ko] of Object.entries(LAB_TERM_KO)) {
  // 같은 한글에 여러 영문(약어·전체명)이 있으면 짧은 쪽(약어)을 대표로
  const cur = EN_BY_KO[ko];
  if (!cur || en.length < cur.length) EN_BY_KO[ko] = en;
}

export interface LabTermParts {
  /** 영문(약어) — 모르면 null(지어내지 않음) */
  en: string | null;
  /** 한글 — 모르면 null */
  ko: string | null;
  /** 원문(저장값) — 표시 폴백의 최종 정본 */
  raw: string;
}

/**
 * 저장된 testName 을 분해한다 — `A (B)` 병기형·영문 단독·한글 단독 전부.
 * `AST (GOT)` 처럼 괄호 안도 영문이면 병기형이 아니라 원문 통째가 이름이다.
 */
export function parseLabTerm(raw: string): LabTermParts {
  const t = (raw ?? '').trim();
  if (!t) return { en: null, ko: null, raw: t };
  const m = /^(.+?)\s*\((.+)\)$/.exec(t);
  if (m) {
    const a = m[1].trim(); const b = m[2].trim();
    const aKo = HANGUL.test(a); const bKo = HANGUL.test(b);
    if (aKo !== bKo) {
      const ko = aKo ? a : b;
      const en = aKo ? b : a;
      return { en, ko, raw: t };
    }
    // 양쪽 다 영문(AST (GOT)) 또는 다 한글 — 병기형이 아니다. 통째로 사전을 본다.
  }
  if (HANGUL.test(t)) {
    const en = EN_BY_KO[t] ?? null;
    return { en: en ? en.toUpperCase() : null, ko: t, raw: t };
  }
  return { en: t, ko: LAB_TERM_KO[norm(t)] ?? null, raw: t };
}

/**
 * 직원 화면 표시 — 검사 항목은 영문 약어가 식별자라 한글은 **병기**로 붙는다.
 * KO/BOTH: `EN (한글)`(둘 다 알 때) · EN: 영문만(병기 저장 행도 영문으로 정돈) ·
 * 어느 쪽도 모르면 원문 그대로(미등재=무병기 — 지어내지 않는다).
 */
export function labTermText(raw: string, mode: 'KO' | 'EN' | 'BOTH'): string {
  const p = parseLabTerm(raw);
  if (mode === 'EN') return p.en ?? p.raw;
  if (p.en && p.ko) return `${p.en} (${p.ko})`;
  return p.raw;
}

/** 환자 포털 표시 — 일반인 대상이라 한글 우선 `한글 (EN)`. 모르면 원문 그대로 */
export function portalLabTermText(raw: string): string {
  const p = parseLabTerm(raw);
  if (p.ko && p.en) return `${p.ko} (${p.en})`;
  return p.ko ?? p.raw;
}
