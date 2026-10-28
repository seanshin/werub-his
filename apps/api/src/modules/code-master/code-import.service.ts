import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { dateOnlyValue } from '../../common/day-range';
import { serverMsg, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';

/**
 * 고시 개정 일괄 반영 — **차이를 먼저 보여주고, 사람이 적용한다.**
 *
 * 🔴 수가는 분기마다 개정된다(수가코드 166,744건). 지금까지는 한 건씩 손으로 고쳐야 했고,
 *    손으로 하는 일은 누락된다.
 *
 * 🔴 **파일을 올리면 바로 반영하지 않는다.** 미리보기(`preview`)는 **아무것도 저장하지 않고**
 *    신설·변경·폐지·동일·오류를 분모와 함께 낸다. 적용은 사람이 누른 뒤에만 일어난다.
 *
 * 🔴 **버전 가능 여부가 테이블마다 다르다**(2026-08-26 실측):
 *    · `ProcedureCode` … `@@unique([code, validFrom])` → **새 버전으로 쌓을 수 있다**
 *    · `DiagnosisCode`(`[codeSystem, code]`) · `MedicationCode`(`code`) … **코드당 1행 = 덮어쓴다**
 *    미리보기가 그 사실을 그대로 말한다 — "새 버전"이라 적어놓고 덮어쓰면 그것이 거짓말이다.
 */

export type ImportKind = 'diagnosis' | 'procedure' | 'medication';
export type RowVerdict = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'RETIRED' | 'ERROR';

export interface ImportRow {
  line: number;
  code: string;
  verdict: RowVerdict;
  /** 무엇이 달라지는가 — 사람이 읽는 문장(`changesMsg` 의 한국어 파생 · 같은 순서) */
  changes?: string[];
  /** 정본 `{ k, params }` — 화면 `<ServerText>` 가 조립한다(2026-09-15 I2) */
  changesMsg?: ServerMessage[];
  error?: string;
  errorMsg?: ServerMessage;
  parsed?: Record<string, unknown>;
}

export interface ImportPreview {
  kind: ImportKind;
  /** 이 반영이 적용될 시행일 */
  effectiveDate: string;
  /** 🔴 이 테이블이 버전을 쌓을 수 있는가. false 면 적용은 **덮어쓰기**다 */
  versioned: boolean;
  totalLines: number;
  counts: Record<RowVerdict, number>;
  rows: ImportRow[];
  /** 파일에 없는데 DB 에 살아 있는 코드 수 — 폐지 후보(사람이 정한다) */
  missingInFile: number;
  /**
   * 🔴 그 안에 **원내 코드가 섞여 있다.** 고시 파일에 없는 것이 당연한 코드를
   *    "폐지 후보"로 세면 사람이 원내 항목을 지운다.
   */
  localCount: number;
  /** `notesMsg` 의 한국어 파생(같은 순서) — 화면은 `notesMsg` 를 조립한다 */
  notes: string[];
  notesMsg: ServerMessage[];
}

/** 행 오류 — 정본 `errorMsg`, `error` 는 한국어 파생 */
const rowError = (m: ServerMessage) => ({ error: renderServerMessageKo(m), errorMsg: m });

const REQUIRED: Record<ImportKind, string[]> = {
  diagnosis: ['code', 'nameKo'],
  procedure: ['code', 'nameKo'],
  medication: ['code', 'nameKo'],
};

/**
 * 종류별로 **반영할 수 있는 열**. 🔴 진단코드에는 `unitPrice` 컬럼이 **없다**(실측) —
 * 파일에 있어도 반영할 수 없으므로, 조용히 무시하지 않고 미리보기에서 밝힌다.
 */
const ALLOWED_COLUMNS: Record<ImportKind, string[]> = {
  diagnosis: ['code', 'nameKo', 'category'],
  procedure: ['code', 'nameKo', 'category', 'unitPrice'],
  medication: ['code', 'nameKo', 'category', 'unitPrice'],
};

/** 비교를 위해 필요한 필드만 뽑는다 — 종류마다 모델이 달라 유니온 그대로는 읽을 수 없다 */
type CurrentRow = { nameKo: string; category: string | null; unitPrice?: number | null } | null;

@Injectable()
export class CodeImportService {
  private readonly logger = new Logger(CodeImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  private versioned(kind: ImportKind) {
    return kind === 'procedure'; // 실측: 이 테이블만 [code, validFrom] 유니크
  }

  /** CSV/TSV 파싱 — 헤더 필수. 🔴 열 이름을 추측하지 않는다(틀리면 조용히 잘못 반영된다). */
  private parse(content: string): { header: string[]; rows: string[][] } {
    // 🔴 엑셀 CSV 의 BOM 은 **따로 지우지 않는다** — 아래 `.trim()` 이 이미 지운다
    //    (ES 사양의 WhiteSpace 에 ZWNBSP 가 포함된다. 2026-08-26 실측으로 확인).
    //    처음엔 BOM 처리를 넣었다가 **재주입해도 가드가 실패하지 않아** 없는 결함이었음을 알았다.
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new BadRequestException('헤더와 최소 1행이 필요합니다');
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(sep).map((h) => h.trim());
    return { header, rows: lines.slice(1).map((l) => l.split(sep).map((c) => c.trim())) };
  }

  async preview(kind: ImportKind, content: string, effectiveDate: string): Promise<ImportPreview> {
    if (!REQUIRED[kind]) throw new BadRequestException(`알 수 없는 코드 종류: ${kind}`);
    const eff = dateOnlyValue(effectiveDate);
    if (!eff) throw new BadRequestException('시행일(effectiveDate)이 올바르지 않습니다 (YYYY-MM-DD)');

    const { header, rows } = this.parse(content);
    for (const req of REQUIRED[kind]) {
      if (!header.includes(req)) throw new BadRequestException(`필수 열이 없습니다: ${req} (헤더: ${header.join(', ')})`);
    }

    const allowed = ALLOWED_COLUMNS[kind];
    // 🔴 반영할 수 없는 열을 조용히 무시하지 않는다 — 올린 사람은 반영됐다고 믿는다
    const ignored = header.filter((h) => !allowed.includes(h));

    const idx = (name: string) => header.indexOf(name);
    const out: ImportRow[] = [];
    const counts: Record<RowVerdict, number> = { NEW: 0, CHANGED: 0, UNCHANGED: 0, RETIRED: 0, ERROR: 0 };
    const seen = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2; // 헤더가 1행
      const code = r[idx('code')] ?? '';
      if (!code) {
        out.push({ line, code: '', verdict: 'ERROR', ...rowError(serverMsg('code 가 비어 있습니다')) });
        counts.ERROR++; continue;
      }
      if (seen.has(code)) {
        // 🔴 파일 안 중복을 조용히 마지막 값으로 덮지 않는다
        out.push({ line, code, verdict: 'ERROR', ...rowError(serverMsg('같은 코드가 파일 안에 두 번 있습니다')) });
        counts.ERROR++; continue;
      }
      seen.add(code);

      const parsed: Record<string, unknown> = { code, nameKo: r[idx('nameKo')] ?? '' };
      if (!parsed.nameKo) {
        out.push({ line, code, verdict: 'ERROR', ...rowError(serverMsg('nameKo 가 비어 있습니다')) });
        counts.ERROR++; continue;
      }
      if (allowed.includes('unitPrice') && header.includes('unitPrice') && r[idx('unitPrice')]) {
        const n = Number(r[idx('unitPrice')].replace(/[, ]/g, ''));
        if (!Number.isFinite(n)) {
          out.push({ line, code, verdict: 'ERROR', ...rowError(serverMsg('unitPrice 를 숫자로 읽을 수 없습니다: {값}', { 값: r[idx('unitPrice')] })) });
          counts.ERROR++; continue;
        }
        parsed.unitPrice = n;
      }
      if (allowed.includes('category') && header.includes('category') && r[idx('category')]) parsed.category = r[idx('category')];

      const current = (await this.findCurrent(kind, code)) as CurrentRow;
      if (!current) {
        out.push({ line, code, verdict: 'NEW', parsed });
        counts.NEW++; continue;
      }
      // 값(명칭·수가·분류)은 데이터 — 번역하지 않는다. 문장 틀만 키로
      const changesMsg: ServerMessage[] = [];
      if (String(current.nameKo) !== String(parsed.nameKo)) {
        changesMsg.push(serverMsg('명칭: {이전} → {이후}', { 이전: String(current.nameKo), 이후: String(parsed.nameKo) }));
      }
      if (parsed.unitPrice !== undefined && Number(current.unitPrice ?? NaN) !== Number(parsed.unitPrice)) {
        changesMsg.push(serverMsg('수가: {이전} → {이후}', { 이전: current.unitPrice ?? '-', 이후: Number(parsed.unitPrice) }));
      }
      if (parsed.category !== undefined && String(current.category ?? '') !== String(parsed.category)) {
        changesMsg.push(serverMsg('분류: {이전} → {이후}', { 이전: current.category ?? '-', 이후: String(parsed.category) }));
      }
      if (changesMsg.length === 0) { out.push({ line, code, verdict: 'UNCHANGED' }); counts.UNCHANGED++; }
      else {
        out.push({ line, code, verdict: 'CHANGED', changes: changesMsg.map(renderServerMessageKo), changesMsg, parsed });
        counts.CHANGED++;
      }
    }

    const liveCodes = await this.countLive(kind);
    const missingInFile = Math.max(0, liveCodes - seen.size);
    const localCount = await this.countLocal(kind);

    const notesMsg: ServerMessage[] = [];
    notesMsg.push(
      this.versioned(kind)
        ? serverMsg('적용하면 **새 버전**으로 쌓입니다(이전 버전은 시행일 전날로 종료). 과거 기록의 값은 바뀌지 않습니다.')
        : serverMsg('🔴 이 코드 종류는 코드당 1행이라 적용하면 **현재 값을 덮어씁니다**(이력이 남지 않습니다 · 변경은 감사 원장에 기록됩니다).'),
    );
    notesMsg.push(serverMsg('🔴 파일에 없는 살아 있는 코드 {건수}건은 **자동으로 폐지하지 않습니다** — 폐지는 따로 고릅니다.', { 건수: missingInFile }));
    if (localCount > 0) {
      notesMsg.push(serverMsg('🔴 그중 **원내 등록 {건수}건**은 고시 파일에 없는 것이 정상입니다 — 폐지 후보로 읽지 마세요.', { 건수: localCount }));
    }
    if (ignored.length) {
      notesMsg.push(serverMsg('🔴 반영하지 않는 열 {개수}개: {열} — 이 코드 종류에는 해당 컬럼이 없습니다.', { 개수: ignored.length, 열: ignored.join(', ') }));
    }

    return {
      kind, effectiveDate, versioned: this.versioned(kind),
      totalLines: rows.length, counts, rows: out, missingInFile, localCount,
      notes: notesMsg.map(renderServerMessageKo), notesMsg,
    };
  }

  /**
   * 적용 — **미리보기에서 본 것만** 반영한다.
   *
   * 🔴 소급 변경 금지: 수가는 **새 버전**을 만들고 이전 버전을 시행일 전날로 종료한다.
   *    과거 진료의 수가는 그때 값 그대로 남는다.
   * 🔴 진단·약품은 코드당 1행이라 **덮어쓴다** — 미리보기가 그 사실을 이미 말했다.
   * 🔴 **파일에 없는 코드를 폐지하지 않는다.** 폐지는 사람이 따로 고르는 일이다(잘못 폐지하면 진료가 멈춘다).
   */
  async apply(kind: ImportKind, content: string, effectiveDate: string, userId: string) {
    const pv = await this.preview(kind, content, effectiveDate);
    if (pv.counts.ERROR > 0) {
      throw new BadRequestException({
        code: 'IMPORT_HAS_ERRORS',
        message: `오류 ${pv.counts.ERROR}건이 있어 적용하지 않습니다 — 파일을 고친 뒤 다시 올리세요`,
        preview: { counts: pv.counts },
      });
    }
    const eff = dateOnlyValue(effectiveDate)!;
    let created = 0, updated = 0, versioned = 0;

    for (const row of pv.rows) {
      if (row.verdict !== 'NEW' && row.verdict !== 'CHANGED') continue;
      const data = row.parsed as { code: string; nameKo: string; category?: string; unitPrice?: number };

      if (kind === 'procedure') {
        /**
         * 🔴 (2026-09-17 L1) 버전 교체가 **두 쓰기로 갈라져** 있었다 — 이전 버전을 시행일 전날로 닫고
         *    새 버전을 세운다. 앞만 커밋되고 뒤가 실패하면 그 수가는 **시행일 이후 유효한 버전이 하나도
         *    없는** 상태가 된다(청구 근거가 빈다). 한 코드의 버전 교체는 한 트랜잭션으로 묶는다
         *    — 파일 전체의 원자성은 아니지만(행 단위 재실행이 정본), 반쪽 버전은 남지 않는다.
         */
        const prevEnd = new Date(eff); prevEnd.setDate(prevEnd.getDate() - 1);
        const versioning = row.verdict === 'CHANGED';
        await this.prisma.$transaction(async (tx) => {
          if (versioning) {
            await tx.procedureCode.updateMany({
              where: { code: data.code, isActive: true, validTo: null },
              data: { validTo: prevEnd },
            });
          }
          await tx.procedureCode.upsert({
            where: { code_validFrom: { code: data.code, validFrom: eff } },
            create: { code: data.code, nameKo: data.nameKo, category: data.category, unitPrice: data.unitPrice, validFrom: eff, origin: 'HIRA' },
            update: { nameKo: data.nameKo, category: data.category, unitPrice: data.unitPrice, origin: 'HIRA' },
          });
        });
        if (versioning) versioned++; else created++;
        continue;
      }

      // 🔴 덮어쓰기 경로 — 이력이 남지 않는다는 것을 미리보기가 말했다
      if (kind === 'diagnosis') {
        if (row.verdict === 'NEW') {
          await this.prisma.diagnosisCode.create({ data: { code: data.code, nameKo: data.nameKo, category: data.category, validFrom: eff, origin: 'HIRA' } });
          created++;
        } else {
          await this.prisma.diagnosisCode.updateMany({ where: { code: data.code, isActive: true }, data: { nameKo: data.nameKo, category: data.category, origin: 'HIRA' } });
          updated++;
        }
      } else {
        if (row.verdict === 'NEW') {
          await this.prisma.medicationCode.create({ data: { code: data.code, nameKo: data.nameKo, category: data.category, unitPrice: data.unitPrice, validFrom: eff, origin: 'HIRA' } });
          created++;
        } else {
          await this.prisma.medicationCode.updateMany({ where: { code: data.code, isActive: true }, data: { nameKo: data.nameKo, category: data.category, unitPrice: data.unitPrice, origin: 'HIRA' } });
          updated++;
        }
      }
    }

    this.logger.log(
      `고시 반영 — ${kind} 시행일 ${effectiveDate} · 신설 ${created} · 갱신 ${updated} · 새버전 ${versioned} · ` +
      `동일 ${pv.counts.UNCHANGED} · 파일에 없는 살아있는 코드 ${pv.missingInFile}(폐지 안 함) · by ${userId}`,
    );
    return { kind, effectiveDate, created, updated, versioned, unchanged: pv.counts.UNCHANGED, missingInFile: pv.missingInFile, retired: 0 };
  }

  private async findCurrent(kind: ImportKind, code: string): Promise<CurrentRow> {
    if (kind === 'diagnosis') return this.prisma.diagnosisCode.findFirst({ where: { code, isActive: true } });
    if (kind === 'medication') return this.prisma.medicationCode.findFirst({ where: { code, isActive: true } });
    return this.prisma.procedureCode.findFirst({ where: { code, isActive: true }, orderBy: { validFrom: 'desc' } });
  }

  /** 🔴 원내 등록분 — 고시 파일에 없는 것이 정상이다 */
  private async countLocal(kind: ImportKind) {
    const where = { isActive: true, origin: 'LOCAL' };
    if (kind === 'diagnosis') return this.prisma.diagnosisCode.count({ where });
    if (kind === 'medication') return this.prisma.medicationCode.count({ where });
    return this.prisma.procedureCode.count({ where });
  }

  private async countLive(kind: ImportKind) {
    if (kind === 'diagnosis') return this.prisma.diagnosisCode.count({ where: { isActive: true } });
    if (kind === 'medication') return this.prisma.medicationCode.count({ where: { isActive: true } });
    return this.prisma.procedureCode.count({ where: { isActive: true } });
  }
}
