/**
 * 포뮬러리 CSV 일괄 등재 — 파싱·행 판정(순수 함수). DB 조회 결과를 받아 행마다 무엇이 일어날지 정한다.
 *
 * 🔴 규칙
 *  - 코드 매칭은 **마스터 코드 정확 일치만**(대소문자·공백 포함 원문 trim 후 동일). 이름·퍼지 매칭으로 자동 선택하지 않는다.
 *  - 한 코드가 여러 마스터 행과 맞으면(수가 적용일 버전·간호 코드체계) **고르지 않고** 행 오류로 돌려준다 — 열(validFrom·codeSystem)로 좁히게.
 *  - 부분 실패는 행 단위로 말한다. 한 행이 틀렸다고 파일 전체를 실패로 말하지 않고, 틀린 행을 성공으로 세지도 않는다.
 *  - 프리셋 키는 shared `FORMULARY_PRESETS` 에 있는 키만(정본에 없는 키를 받아 두면 처방 화면이 그릴 수 없다).
 */
export const CSV_MAX_BYTES = 1_000_000;
export const CSV_MAX_ROWS = 2000;

/** 인식하는 열 — 머리글은 대소문자·앞뒤 공백 무시 */
export const CSV_COLUMNS = ['code', 'codeSystem', 'validFrom', 'presetKey', 'note'] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

export type CsvRowAction = 'CREATE' | 'REACTIVATE' | 'UNCHANGED' | 'ERROR';

/** 행 오류 사유 코드 — 화면이 문구로 옮긴다 */
export type CsvRowError =
  | 'MISSING_CODE'
  | 'MISSING_PRESET_KEY'
  | 'NOT_FOUND'
  | 'MASTER_INACTIVE'
  | 'AMBIGUOUS'
  | 'BAD_VALID_FROM'
  | 'UNKNOWN_PRESET'
  | 'DUPLICATE_IN_FILE'
  | 'APPLY_FAILED';

export interface ParsedCsv {
  header: string[];
  /** 인식한 열 → 머리글 인덱스 */
  columns: Partial<Record<CsvColumn, number>>;
  /** 인식하지 못한 머리글(무시됨 — 결과에 그대로 말한다) */
  unknownColumns: string[];
  /** 데이터 행(파일 줄 번호는 머리글=1 기준 1-based) */
  rows: { line: number; cells: string[] }[];
}

/** RFC 4180 수준 파서 — 따옴표 필드·"" 이스케이프·CRLF·BOM. 빈 줄은 건너뛴다. */
export function parseCsvText(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const pushRow = () => {
    row.push(field);
    field = '';
    if (row.some((v) => v.trim() !== '')) out.push(row); // 모든 칸이 빈 줄은 데이터가 아니다
    row = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) pushRow();
  return out;
}

export function readCsv(text: string): ParsedCsv {
  const grid = parseCsvText(text);
  const header = (grid[0] ?? []).map((h) => h.trim());
  const columns: Partial<Record<CsvColumn, number>> = {};
  const unknownColumns: string[] = [];
  header.forEach((h, idx) => {
    const col = CSV_COLUMNS.find((c) => c.toLowerCase() === h.toLowerCase());
    if (col && columns[col] === undefined) columns[col] = idx;
    else if (h) unknownColumns.push(h);
  });
  return { header, columns, unknownColumns, rows: grid.slice(1).map((cells, k) => ({ line: k + 2, cells })) };
}

export const cell = (p: ParsedCsv, cells: string[], col: CsvColumn): string =>
  p.columns[col] === undefined ? '' : (cells[p.columns[col] as number] ?? '').trim();

export const VALID_FROM_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 마스터 후보(정확 일치로 찾은 행들) */
export interface MasterCandidate {
  id: string;
  code: string;
  nameKo: string;
  isActive: boolean;
  codeSystem?: string | null;
  validFrom?: Date | string | null;
}

/**
 * 후보 중 하나로 좁힌다 — 고르지 못하면 사유를 돌려준다.
 * 활성 행이 하나면 그 행, 활성이 없으면 MASTER_INACTIVE, 활성이 둘 이상이면 AMBIGUOUS(열로 좁혀야 한다).
 */
export function pickMaster(
  candidates: readonly MasterCandidate[],
  filter: { codeSystem?: string; validFrom?: string },
): { ok: true; master: MasterCandidate } | { ok: false; error: 'NOT_FOUND' | 'MASTER_INACTIVE' | 'AMBIGUOUS' } {
  const day = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).toISOString().slice(0, 10));
  const narrowed = candidates.filter(
    (c) => (!filter.codeSystem || c.codeSystem === filter.codeSystem) && (!filter.validFrom || day(c.validFrom) === filter.validFrom),
  );
  if (!narrowed.length) return { ok: false, error: 'NOT_FOUND' };
  const active = narrowed.filter((c) => c.isActive);
  if (!active.length) return { ok: false, error: 'MASTER_INACTIVE' };
  if (active.length > 1) return { ok: false, error: 'AMBIGUOUS' };
  return { ok: true, master: active[0] };
}

/** 이미 등재된 항목의 상태로 행 동작을 정한다 — `add()` 정본과 같은 규칙(ACTIVE 는 그대로, 그 밖 상태는 재활성화) */
export function actionForExisting(status: string | null | undefined): Exclude<CsvRowAction, 'ERROR'> {
  if (status == null) return 'CREATE';
  return status === 'ACTIVE' ? 'UNCHANGED' : 'REACTIVATE';
}
