/**
 * VoiceEMR — 한국어 수사·단위 정규화 (프로토타입·순수 함수·미배선)
 *
 * WeRU.B STT 가 숫자를 이미 정규화(Q12)하면 이 단계는 축소된다. 그 전까지 HIS-side 담당.
 * 설계: docs/02-design/voice-emr-pipeline-design.md §2.2
 */

const SINO: Record<string, number> = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const SINO_PLACE: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const NATIVE: Record<string, number> = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};

/** 한자어 수사 한 덩어리(예: "백삼십") → 130. 실패 시 null */
export function sinoToNumber(word: string): number | null {
  if (!word) return null;
  let total = 0;
  let current = 0;
  let matched = false;
  for (const ch of word) {
    if (ch in SINO) {
      current = SINO[ch];
      matched = true;
    } else if (ch in SINO_PLACE) {
      const place = SINO_PLACE[ch];
      total += (current === 0 ? 1 : current) * place;
      current = 0;
      matched = true;
    } else if (ch === '만') {
      total = (total + current) * 10000;
      current = 0;
      matched = true;
    } else {
      return null; // 비수사 문자 → 이 단어는 수사 아님
    }
  }
  return matched ? total + current : null;
}

const NUM_CHARS = /[영공일이삼사오육칠팔구십백천만]/;

/**
 * 텍스트 내 한국어 수사(한자어·고유어·소수 "점")를 아라비아 숫자로 치환.
 * 이미 숫자면 그대로 통과.
 */
export function normalizeKoreanNumber(text: string): string {
  let t = text;

  // 1) 소수: "<수사>점<수사>" → 정수.소수
  t = t.replace(/([영공일이삼사오육칠팔구십백천만]+)\s*점\s*([영공일이삼사오육칠팔구십백천만]+)/g, (_m, intPart, decPart) => {
    const i = sinoToNumber(intPart);
    // 소수부는 자릿수 그대로(오→5·이오→25)
    let dec = '';
    for (const ch of decPart) dec += ch in SINO ? String(SINO[ch]) : '';
    if (i === null || dec === '') return _m;
    return `${i}.${dec}`;
  });

  // 2) 한자어 수사 덩어리 → 숫자 (연속 수사 문자 런)
  //    ⚠ 단일 한자어 문자(사/이/오/구…)는 일반 단어(주사·사무 등)에 흔하므로,
  //    **자릿값 문자(십/백/천/만) 포함 런만** 변환한다(오변환 방지).
  t = t.replace(/[영공일이삼사오육칠팔구십백천만]+/g, (m, offset: number, full: string) => {
    // 🔴 종결·서술 어미의 '이'는 계사(copula) — "백사십이었어요"=140(142 아님). shared/clinical-text 와 동일 규약.
    let run = m, tail = '';
    if (run.length > 1 && run.endsWith('이') && /^(었|였|에요|어요|어서|야|니|라)/.test(full.slice(offset + m.length))) {
      run = run.slice(0, -1); tail = '이';
    }
    if (!/[십백천만]/.test(run)) return m; // 자릿값 없는 런(단일 digit 등)은 보존
    const n = sinoToNumber(run);
    return n === null ? m : String(n) + tail;
  });

  // 3) 고유어 관형 수사(+단위): "한 알"·"두 번"·"세 번"
  t = t.replace(/(하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉|열)\s*(알|정|번|회|개|캡슐|포|앰플|바이알)/g,
    (_m, num, unit) => `${NATIVE[num] ?? num}${unit}`);

  return t;
}

/** 단위 표기 정규화(구술 표기 → 표준 약어) */
export function normalizeUnits(text: string): string {
  return text
    .replace(/밀리그램|미리그램/g, 'mg')
    .replace(/마이크로그램/g, 'mcg')
    .replace(/그램/g, 'g')
    .replace(/시시/g, 'cc')
    .replace(/퍼센트/g, '%')
    .replace(/(?<=\d)\s*도(?![수])/g, '℃')
    .replace(/정맥\s*주사/g, 'IV')
    .replace(/근육\s*주사/g, 'IM')
    .replace(/피하\s*주사/g, 'SC');
}

/** 전체 정규화(수사→숫자→단위) */
export function normalizeNumeric(text: string): string {
  return normalizeUnits(normalizeKoreanNumber(text));
}

export const _internal = { SINO, NATIVE, NUM_CHARS };
