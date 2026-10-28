import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { serverMsg, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';

/**
 * 코드집 내보내기(F9) — 인증 심사·기관 제출용.
 *
 * 🔴 **조용히 자르지 않는다.** 수가는 166,744행이라 한 번에 다 담을 수 없다.
 *    그래서 **장 단위로 내보내고, 전체 건수와 다음 장 유무를 헤더로 함께 준다.**
 *    "받아보니 일부였다"를 나중에 알게 되면 그 코드집은 근거로 쓸 수 없다.
 */
export type ExportKind = 'diagnosis' | 'procedure' | 'medication';
const KINDS: ExportKind[] = ['diagnosis', 'procedure', 'medication'];

/** 한 장 상한 — 넘으면 자르고 **잘랐다고 말한다**(헤더 + 화면) */
export const EXPORT_PAGE_SIZE = 20000;

const COLUMNS: Record<ExportKind, string[]> = {
  diagnosis: ['codeSystem', 'code', 'nameKo', 'nameEn', 'category', 'chapter', 'icd10Code', 'icd11Code', 'origin', 'validFrom', 'validTo', 'successorCode', 'isActive'],
  procedure: ['code', 'nameKo', 'category', 'unitPrice', 'insuranceCovered', 'origin', 'validFrom', 'validTo', 'successorCode', 'isActive'],
  medication: ['code', 'nameKo', 'nameEn', 'ingredient', 'manufacturer', 'dosageForm', 'unit', 'unitPrice', 'insuranceCode', 'origin', 'validFrom', 'validTo', 'successorCode', 'isActive'],
};

const HEADER_KO: Record<string, string> = {
  codeSystem: '코드체계', code: '코드', nameKo: '한글명', nameEn: '영문명', category: '분류',
  chapter: '챕터', icd10Code: 'ICD-10', icd11Code: 'ICD-11', origin: '출처',
  validFrom: '적용일', validTo: '종료일', successorCode: '후속코드', isActive: '사용',
  unitPrice: '단가', insuranceCovered: '급여', ingredient: '성분', manufacturer: '제조사',
  dosageForm: '제형', unit: '단위', insuranceCode: '보험코드',
};

export interface ExportResult {
  csv: string;
  total: number;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  /** 화면이 그대로 말한다 — `notesMsg` 가 정본(화면 `<ServerText>`), `notes` 는 한국어 파생(2026-09-15 I2) */
  notes: string[];
  notesMsg: ServerMessage[];
}

@Injectable()
export class CodeExportService {
  private readonly logger = new Logger(CodeExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  private assertKind(k: string): ExportKind {
    if (!KINDS.includes(k as ExportKind)) throw new BadRequestException(`알 수 없는 코드 종류입니다: ${k}`);
    return k as ExportKind;
  }

  /** 🔴 CSV 주입 방지 — `=`·`+`·`-`·`@` 로 시작하는 값은 표계산기가 **수식으로 실행**한다 */
  private cell(v: unknown): string {
    if (v === null || v === undefined) return '';
    let s: string;
    if (v instanceof Date) s = v.toISOString().slice(0, 10);
    else if (typeof v === 'boolean') s = v ? 'Y' : 'N';
    else s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async export(
    kindRaw: string,
    opts: { origin?: string; active?: boolean; page?: number } = {},
  ): Promise<ExportResult> {
    const kind = this.assertKind(kindRaw);
    const page = Math.max(1, opts.page ?? 1);
    const cols = COLUMNS[kind];

    const where: Record<string, unknown> = {};
    if (opts.active !== undefined) where.isActive = opts.active;
    if (opts.origin) where.origin = opts.origin === 'UNKNOWN' ? null : opts.origin;

    const model = (
      kind === 'diagnosis' ? this.prisma.diagnosisCode
      : kind === 'procedure' ? this.prisma.procedureCode
      : this.prisma.medicationCode
    ) as {
      findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
      count: (a: unknown) => Promise<number>;
    };

    const [total, rows] = await Promise.all([
      model.count({ where }),
      model.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * EXPORT_PAGE_SIZE,
        take: EXPORT_PAGE_SIZE,
      }),
    ]);

    const header = cols.map((c) => this.cell(HEADER_KO[c] ?? c)).join(',');
    const body = rows.map((r) => cols.map((c) => this.cell(r[c])).join(',')).join('\n');
    // 🔴 BOM — 엑셀이 UTF-8 한글을 깨뜨리지 않게(깨진 코드집은 제출할 수 없다)
    const csv = `﻿${header}\n${body}\n`;

    const hasMore = page * EXPORT_PAGE_SIZE < total;
    const notesMsg: ServerMessage[] = [];
    if (hasMore || page > 1) {
      const range = {
        전체: total.toLocaleString(),
        시작: ((page - 1) * EXPORT_PAGE_SIZE + 1).toLocaleString(),
        끝: ((page - 1) * EXPORT_PAGE_SIZE + rows.length).toLocaleString(),
      };
      notesMsg.push(hasMore
        ? serverMsg('🔴 전체 {전체}건 중 {시작}–{끝}건입니다 — 다음 장이 있습니다(이대로 제출하면 일부만 제출됩니다).', range)
        : serverMsg('🔴 전체 {전체}건 중 {시작}–{끝}건입니다.', range));
    }
    if (total === 0) {
      notesMsg.push(serverMsg('조건에 맞는 코드가 없습니다 — 빈 파일이 나갑니다(코드가 없다는 뜻입니다).'));
    }
    const notes = notesMsg.map(renderServerMessageKo);

    this.logger.log(
      `코드집 내보내기 — ${kind} · 조건 ${JSON.stringify(where)} · 전체 ${total} · ${page}장 ${rows.length}건`,
    );

    return { csv, total, page, pageSize: EXPORT_PAGE_SIZE, returned: rows.length, hasMore, notes, notesMsg };
  }
}
