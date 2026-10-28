import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * ATC ↔ 제품코드(EDI) 매핑 반영 — 사람이 준 표준 파일 기반.
 *
 * 🔴 근거 파일: 「약제급여목록 및 급여상한금액표」 ATC 매핑(사람 제공, 2026-08-26).
 *    실측(25,187행): **한 제품코드에 ATC 둘 이상 = 0건** — 결정적 1:1 매핑이다.
 *    우리 약품 마스터 24,022건과 **18,062건(75.2%)** 이 겹친다.
 *
 * 🔴 **정본은 `TerminologyMapping` 하나다.** `MedicationCode` 에 ATC 필드를 새로 만들지 않았다 —
 *    표준 매핑 정본이 이미 있고 감사·유효기간·출처를 갖고 있다. 새로 만들면 정본이 둘이 된다.
 *
 * 🔴 **파일의 기준일을 `targetVersion` 에 남긴다.** 이 파일은 특정 시점 고시 기준이고,
 *    그 뒤에 바뀐 코드가 있다 — "현재 유효"라고 말하지 않는다.
 * 🔴 **덮어쓰지 않는다.** 이미 있는 매핑은 건드리지 않고 `unchanged` 로 센다.
 */
export type AtcRowVerdict = 'NEW' | 'UNCHANGED' | 'CONFLICT' | 'UNMATCHED' | 'ERROR';

export interface AtcImportRow {
  line: number;
  code: string;
  atc: string;
  atcName: string;
  verdict: AtcRowVerdict;
  detail?: string;
}

export interface AtcImportPreview {
  version: string;
  totalLines: number;
  counts: Record<AtcRowVerdict, number>;
  rows: AtcImportRow[];
  truncatedAt: number | null;
  notes: string[];
}

/** 미리보기 행 상한 — 자르면 잘랐다고 말한다 */
const ROW_LIMIT = 200;

/** ATC 코드 형태 — 5수준(A10BA02). 🔴 형태가 아니면 받지 않는다(오타가 정본이 된다) */
const ATC_RE = /^[A-Z]\d{2}[A-Z]{2}\d{2}$/;

@Injectable()
export class AtcMappingImportService {
  private readonly logger = new Logger(AtcMappingImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** CSV/TSV — 헤더 필수. 🔴 열 이름을 추측하지 않는다 */
  private parse(content: string) {
    // 🔴 엑셀 CSV 의 BOM 은 **따로 지우지 않는다** — 아래 `.trim()` 이 이미 지운다
    //    (ES 사양의 WhiteSpace 에 ZWNBSP 가 포함된다. 2026-08-26 실측으로 확인).
    //    처음엔 BOM 처리를 넣었다가 **재주입해도 가드가 실패하지 않아** 없는 결함이었음을 알았다.
    const lines = (content ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new BadRequestException('헤더와 최소 1행이 필요합니다');
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(sep).map((h) => h.trim());
    const need = ['code', 'atc'];
    for (const n of need) {
      if (!header.includes(n)) {
        throw new BadRequestException(
          `필수 열이 없습니다: ${n} (헤더: ${header.join(', ')}) — 제품코드 열은 'code', ATC 열은 'atc' 로 주세요`,
        );
      }
    }
    return { header, sep, rows: lines.slice(1).map((l) => l.split(sep).map((c) => c.trim())) };
  }

  async preview(content: string, version: string): Promise<AtcImportPreview> {
    if (!/^\d{4}-\d{2}$/.test(version ?? '')) {
      throw new BadRequestException('기준 버전(version)은 YYYY-MM 형식이어야 합니다 — 파일의 고시 기준월');
    }
    const { header, rows } = this.parse(content);
    const iCode = header.indexOf('code');
    const iAtc = header.indexOf('atc');
    const iName = header.indexOf('atcName');

    const codes = [...new Set(rows.map((r) => r[iCode]).filter(Boolean))];
    // 우리 마스터에 있는 코드만 반영 대상 — 없는 것은 지어내지 않는다
    const meds = await this.prisma.medicationCode.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const medBy = new Map(meds.map((m) => [m.code, m]));

    const existing = await this.prisma.terminologyMapping.findMany({
      where: { sourceTable: 'medication_codes', targetSystem: 'ATC', sourceId: { in: meds.map((m) => m.id) } },
      select: { sourceId: true, targetCode: true },
    });
    const exBy = new Map(existing.map((e) => [e.sourceId, e.targetCode]));

    const counts: Record<AtcRowVerdict, number> = { NEW: 0, UNCHANGED: 0, CONFLICT: 0, UNMATCHED: 0, ERROR: 0 };
    const out: AtcImportRow[] = [];

    rows.forEach((r, i) => {
      const line = i + 2;
      const code = r[iCode] ?? '';
      const atc = (r[iAtc] ?? '').toUpperCase();
      const atcName = iName >= 0 ? (r[iName] ?? '') : '';

      const push = (verdict: AtcRowVerdict, detail?: string) => {
        counts[verdict] += 1;
        if (out.length < ROW_LIMIT) out.push({ line, code, atc, atcName, verdict, detail });
      };

      if (!code || !atc) return push('ERROR', '제품코드 또는 ATC 가 비어 있습니다');
      // 🔴 형태가 아니면 받지 않는다 — 오타가 표준 코드로 자리잡는다
      if (!ATC_RE.test(atc)) return push('ERROR', `ATC 형태가 아닙니다(A10BA02 형): ${atc}`);

      const med = medBy.get(code);
      // 🔴 "우리에 없는 코드"는 오류가 아니다 — 파일이 우리보다 넓을 뿐이다
      if (!med) return push('UNMATCHED', '이 제품코드가 약품 마스터에 없습니다');

      const prev = exBy.get(med.id);
      if (!prev) return push('NEW');
      if (prev === atc) return push('UNCHANGED');
      // 🔴 이미 다른 ATC 가 있으면 **덮지 않는다** — 사람이 판단할 일이다
      return push('CONFLICT', `이미 ${prev} 로 매핑돼 있습니다 — 덮어쓰지 않습니다`);
    });

    const notes: string[] = [
      `기준 ${version} 파일입니다 — 그 뒤에 바뀐 코드는 반영되지 않습니다. "현재 유효"를 뜻하지 않습니다.`,
      `🔴 우리 마스터에 없는 제품코드 ${counts.UNMATCHED.toLocaleString()}건은 반영하지 않습니다(파일이 우리보다 넓습니다).`,
    ];
    if (counts.CONFLICT > 0) {
      notes.push(`🔴 이미 다른 ATC 가 있는 ${counts.CONFLICT}건은 **덮어쓰지 않습니다** — 어느 쪽이 맞는지는 사람이 정합니다.`);
    }
    if (counts.ERROR > 0) {
      notes.push(`🔴 형식 오류 ${counts.ERROR}건이 있습니다 — 오류가 하나라도 있으면 적용할 수 없습니다.`);
    }

    return {
      version,
      totalLines: rows.length,
      counts,
      rows: out,
      truncatedAt: rows.length > ROW_LIMIT ? ROW_LIMIT : null,
      notes,
    };
  }

  /** 적용 — 🔴 **미리보기에서 본 것만**. 오류가 하나라도 있으면 적용하지 않는다. */
  async apply(content: string, version: string, userId: string) {
    const pv = await this.preview(content, version);
    if (pv.counts.ERROR > 0) {
      throw new BadRequestException(`형식 오류 ${pv.counts.ERROR}건이 있어 적용할 수 없습니다 — 파일을 고쳐 주세요`);
    }

    const { header, rows } = this.parse(content);
    const iCode = header.indexOf('code');
    const iAtc = header.indexOf('atc');
    const iName = header.indexOf('atcName');

    const codes = [...new Set(rows.map((r) => r[iCode]).filter(Boolean))];
    const meds = await this.prisma.medicationCode.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const medBy = new Map(meds.map((m) => [m.code, m]));

    let created = 0;
    let skipped = 0;
    for (const r of rows) {
      const code = r[iCode];
      const atc = (r[iAtc] ?? '').toUpperCase();
      const med = medBy.get(code);
      if (!med || !ATC_RE.test(atc)) { skipped += 1; continue; }
      try {
        await this.prisma.terminologyMapping.create({
          data: {
            sourceTable: 'medication_codes',
            sourceId: med.id,
            sourceCode: code,
            targetSystem: 'ATC',
            targetCode: atc,
            targetDisplay: (iName >= 0 ? r[iName] : '') || atc,
            // 🔴 기준일을 남긴다 — 이 매핑이 언제 기준인지 모르면 다음 사람이 현재로 읽는다
            targetVersion: version,
            equivalence: 'equivalent',
            mapSource: 'FILE',
            notes: `약제급여목록 ATC 매핑 파일(${version}) 반영`,
            createdBy: userId,
          },
        });
        created += 1;
      } catch {
        // 유니크 충돌 = 이미 있다. 🔴 덮어쓰지 않는다
        skipped += 1;
      }
    }

    this.logger.log(`ATC 매핑 반영 — 기준 ${version} · 신규 ${created} · 건너뜀 ${skipped} · by ${userId}`);
    return {
      version,
      created,
      skipped,
      notice:
        `기준 ${version} 파일로 ${created.toLocaleString()}건을 새로 매핑했습니다. ` +
        '이미 있던 매핑은 덮어쓰지 않았습니다.',
    };
  }
}
