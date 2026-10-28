/**
 * 검수 결과 → **카탈로그 파일 형식 텍스트** (정본 `i18n-human-review.plan.md` §2.5).
 *
 * 🔴 **자동 커밋하지 않는다** — 코드 변경은 사람의 행위다. 이 함수는 붙여넣으면 컴파일되는
 *    TS 조각을 만들 뿐이고, 반영 여부는 개발자가 커밋으로 남긴다(그 뒤 화면에서 `MERGED` 표시).
 * 🔴 순수 함수로 둔다 — 가드(`export-shape.spec`)가 DI 없이 실제 출력물을 파싱해 검증한다.
 */

export interface ExportEntry {
  key: string;
  value: string;
}

/**
 * TS 단일 인용부호 문자열 리터럴로 이스케이프.
 * 🔴 여기가 새면 "붙여넣으면 컴파일된다"가 거짓이 된다 — 카탈로그 값에는 따옴표·줄바꿈이 실제로 있다.
 */
export function tsQuote(s: string): string {
  return `'${s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`;
}

/** 영역 코드 → TS 식별자 조각(nav → NAV, ws2 → WS2) */
function ident(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
}

export interface BuildExportInput {
  locale: string;
  /** 단일 영역이면 그 코드, 여러 영역이면 'ALL' */
  area: string;
  entries: ExportEntry[];
  generatedAt: string;
  /** 승인분 중 코드 값과 이미 같은 것(= 반영이 끝난 것) 수 — 분모 정직성 */
  alreadyInCode: number;
}

/**
 * 카탈로그 파일과 **같은 모양**의 텍스트를 만든다.
 * 파일 하나로 붙여넣어도 컴파일되고, 기존 `messages/<area>.ts` 에 표만 옮겨 붙여도 된다.
 */
export function buildExportText(input: BuildExportInput): string {
  const { locale, area, entries, generatedAt, alreadyInCode } = input;
  const name = `REVIEW_OVERLAY_${ident(locale)}_${ident(area)}`;
  const lines: string[] = [];
  lines.push('/**');
  lines.push(` * 언어팩 사람 검수 — 승인분 내보내기 · locale=${locale} · area=${area} · ${entries.length}건`);
  lines.push(` * 생성 ${generatedAt} (정본 docs/01-plan/features/i18n-human-review.plan.md §2.5)`);
  lines.push(' *');
  lines.push(' * 🔴 이것은 **초안 텍스트이지 코드가 아니다** — 사람이 카탈로그 파일');
  lines.push(` *    (packages/shared/src/i18n/messages/<area>.ts · packs/${locale}.ts)에 반영하고`);
  lines.push(' *    커밋해야 정본이 된다. 자동 커밋은 하지 않는다.');
  lines.push(' * 🔴 반영 후 /admin/ui-locale/review 에서 해당 키를 "코드 반영됨"(MERGED)으로 표시한다.');
  lines.push(` * 🔴 이 중 ${alreadyInCode}건은 **이미 코드 값과 같다**(반영이 끝났거나 코드가 먼저 바뀐 것).`);
  lines.push(' */');
  lines.push("import type { MessageCatalog } from '../t';");
  lines.push('');
  lines.push(`export const ${name}: MessageCatalog = {`);
  lines.push(`  ${tsQuote(locale)}: {`);
  for (const e of entries) lines.push(`    ${tsQuote(e.key)}: ${tsQuote(e.value)},`);
  lines.push('  },');
  lines.push('};');
  lines.push('');
  lines.push('/** 사람 검수 완료 키 — 등재되면 렌더 부품이 AI 초안 티를 달지 않는다 */');
  lines.push(`export const ${name}_VERIFIED: ReadonlySet<string> = new Set([`);
  for (const e of entries) lines.push(`  ${tsQuote(e.key)},`);
  lines.push(']);');
  lines.push('');
  return lines.join('\n');
}
