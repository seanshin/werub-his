import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { qiReportSealCheck } from '../quality-flow/qi-report.service';
import * as crypto from 'crypto';
import {
  PRINT_CANON_VERSION, diffPrintLines, dutyRosterPrintLines, goLivePrintLines, isServerBuiltDocumentType, joinPatientName,
  qiReportPrintLines, type PrintDiffEntry, type ServerBuiltDocumentType,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentService } from '../document/document.service';
import { DecisionPrintService } from '../decision-registry/decision-print.service';
import { DecisionService } from '../decision-registry/decision.service';
import { GoLiveService } from '../go-live/go-live.service';
import { DutyScheduleService } from '../duty-schedule/duty-schedule.service';
import type { PrintIssueDto } from './print-issuance.dto';

/** 발급 스냅샷 — 🔴 해시는 `lines.join('\n')` 의 sha256 · params 는 다시 만들 때 쓰는 조건 */
export interface PrintSnapshot {
  v: number;
  kind: ServerBuiltDocumentType;
  params: Record<string, string | null>;
  measuredAt: string;
  lines: string[];
  counts?: Record<string, number>;
}
type Built = { sourceId: string; snapshot: PrintSnapshot };

export const printLinesHash = (lines: readonly string[]) => crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');

/**
 * 서버 발급 인쇄본 — 2026-10-12 기획 `decision-print-remaining` P0·P1.
 *
 * 🔴 인쇄본의 QR·sha256 을 브라우저가 계산하면 어디에도 남지 않는다(G1) — 서버가 **지금 원장에서** 정본 줄(shared)을 만들어
 *    발급 원장(`IssuedDocument`)에 동결하고, 쪽 QR 은 진위확인 주소가 된다. 요청 본문의 내용은 받지 않는다(G2).
 *  · 종류: 결정 대장·의사결정서·개시 브리핑·당직표·QI 보고서(환자 정보 없는 인쇄본 — PHI 인쇄본은 사람 결정 D2 전 미등재)
 *  · 대조: 일치 / 이 판 이후 N건 바뀜 / 🔴 비교 불가(지금 원장을 못 읽으면 일치로 접지 않는다)
 */
@Injectable()
export class PrintIssuanceService {
  private readonly logger = new Logger(PrintIssuanceService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentService,
    private readonly decisionPrint: DecisionPrintService,
    private readonly decisions: DecisionService,
    private readonly goLive: GoLiveService,
    private readonly duty: DutyScheduleService,
  ) {}

  async build(kind: ServerBuiltDocumentType, p: { key?: string | null; month?: string | null; department?: string | null; reportId?: string | null }): Promise<Built> {
    const now = new Date().toISOString();
    switch (kind) {
      case 'DECISION_REGISTER':
      case 'DECISION_RECORD': {
        const rec = kind === 'DECISION_RECORD';
        if (rec && !p.key) throw new BadRequestException({ code: 'PRINT_ISSUE_KEY_REQUIRED', message: '의사결정서 발급에는 결정 키가 필요합니다' });
        const s = await this.decisionPrint.build(rec ? 'RECORD' : 'REGISTER', rec ? p.key : null);
        return { sourceId: rec ? s.key! : 'register', snapshot: { v: PRINT_CANON_VERSION, kind, params: { key: s.key }, measuredAt: s.measuredAt, lines: s.lines, counts: s.counts } };
      }
      case 'GOLIVE_BRIEFING': {
        const [rollup, dec] = await Promise.all([this.goLive.rollup(), this.decisions.list()]);
        const lines = goLivePrintLines(rollup.items, dec.items);
        return { sourceId: 'golive', snapshot: { v: PRINT_CANON_VERSION, kind, params: {}, measuredAt: now, lines } };
      }
      case 'DUTY_ROSTER': {
        if (!p.month) throw new BadRequestException({ code: 'PRINT_ISSUE_MONTH_REQUIRED', message: '당직표 발급에는 월(YYYY-MM)이 필요합니다' });
        const department = p.department && p.department !== '전체' ? p.department : null;
        const s = await this.duty.getSchedule(p.month, department ?? undefined);
        const lines = dutyRosterPrintLines(s.schedules);
        return { sourceId: `${p.month}:${department ?? 'ALL'}`.slice(0, 64), snapshot: { v: PRINT_CANON_VERSION, kind, params: { month: p.month, department }, measuredAt: now, lines } };
      }
      case 'QI_REPORT': {
        if (!p.reportId) throw new BadRequestException({ code: 'PRINT_ISSUE_REPORT_REQUIRED', message: 'QI 보고서 발급에는 보고서 id 가 필요합니다' });
        const r = await this.prisma.qiReportSnapshot.findUnique({ where: { id: p.reportId }, select: { id: true, sha256: true, status: true, body: true } });
        if (!r) throw new NotFoundException({ code: 'QI_REPORT_NOT_FOUND', message: 'QI 보고서가 없습니다' });
        // 🔴 본문 해시가 없는 보고서는 무엇을 봉인했는지 말할 수 없다 — 발급하지 않는다(빈 해시를 진본인 척하지 않는다)
        if (!r.sha256) throw new ConflictException({ code: 'QI_REPORT_UNSEALED', message: '본문 해시가 없는 보고서라 발급할 수 없습니다' });
        // 🔴 (C4) 저장된 본문이 봉인과 다르면 발급하지 않는다 — 인쇄본 QR 이 바뀐 본문을 진본이라 보증하게 된다
        if (qiReportSealCheck(r) === 'MISMATCH') throw new ConflictException({ code: 'QI_REPORT_SEAL_MISMATCH', message: '보고서 본문이 봉인(sha256)과 다릅니다 — 발급하지 않습니다' });
        return { sourceId: r.id, snapshot: { v: PRINT_CANON_VERSION, kind, params: { reportId: r.id }, measuredAt: now, lines: qiReportPrintLines(r) } };
      }
    }
  }

  async issue(dto: PrintIssueDto, userId: string) {
    const b = await this.build(dto.kind, dto);
    const hash = printLinesHash(b.snapshot.lines);
    const r = await this.documents.issueBuilt(dto.kind, b.sourceId, b.snapshot as unknown as Record<string, unknown>, hash, userId);
    return {
      issueNo: r.issueNo, documentType: dto.kind, issuedAt: r.issuedAt, hash: r.hash, verifyUrl: r.qrUrl,
      lines: b.snapshot.lines.length, measuredAt: b.snapshot.measuredAt, counts: b.snapshot.counts ?? null,
    };
  }

  /** 직원 대조 — 발급 판 ↔ 지금 원장 · 🔴 지금 원장을 못 읽으면 UNAVAILABLE(비교 불가) */
  async compare(issueNo: string) {
    const doc = await this.prisma.issuedDocument.findUnique({
      where: { issueNo },
      select: { issueNo: true, documentType: true, issuedAt: true, status: true, hash: true, snapshotJson: true, issuedBy: true },
    });
    if (!doc || !isServerBuiltDocumentType(doc.documentType)) {
      throw new NotFoundException({ code: 'PRINT_ISSUE_NOT_FOUND', message: '서버 발급 인쇄본 기록이 없습니다' });
    }
    const snap = doc.snapshotJson as unknown as Partial<PrintSnapshot> & { key?: string | null };
    const issuedLines = Array.isArray(snap?.lines) ? snap.lines.filter((l): l is string => typeof l === 'string') : null;
    const issuer = doc.issuedBy
      ? await this.prisma.user.findUnique({ where: { id: doc.issuedBy }, select: { familyName: true, givenName: true } })
        .then((u) => (u ? joinPatientName(u.familyName, u.givenName) : null))
      : null;
    const base = {
      issueNo: doc.issueNo, documentType: doc.documentType, issuedAt: doc.issuedAt, status: doc.status,
      hash: doc.hash, issuedBy: issuer, measuredAt: typeof snap?.measuredAt === 'string' ? snap.measuredAt : null,
      /** 동결된 줄로 다시 계산한 해시가 원장 해시와 같은가 — 다르면 원장 행이 바뀐 것이다 */
      hashIntact: issuedLines ? printLinesHash(issuedLines) === doc.hash : false,
      lines: issuedLines?.length ?? 0,
    };
    const unavailable = (reason: string) => ({ ...base, compare: { state: 'UNAVAILABLE' as const, reason, changed: [] as PrintDiffEntry[] } });
    if (!issuedLines || snap?.v !== PRINT_CANON_VERSION) return unavailable('SNAPSHOT_FORMAT');
    // v4.71.0 결정 인쇄본 스냅샷은 params 대신 key 를 직접 실었다 — 둘 다 읽는다
    const params = { ...(snap.params ?? {}), ...(snap.key !== undefined && !snap.params ? { key: snap.key } : {}) };
    let nowLines: string[];
    try {
      nowLines = (await this.build(doc.documentType, params)).snapshot.lines;
    } catch (e) {
      // 대상이 사라진 것은 비교 결과다(전부 바뀜) — 그 밖의 실패만 비교 불가
      if (e instanceof NotFoundException) return { ...base, compare: { state: 'CHANGED' as const, changed: diffPrintLines(issuedLines, []) } };
      this.logger.warn(`인쇄본 대조 — 지금 원장을 읽지 못함 ${issueNo}: ${e instanceof Error ? e.message : String(e)}`);
      return unavailable('LEDGER_READ_FAILED');
    }
    const changed = diffPrintLines(issuedLines, nowLines);
    return { ...base, compare: { state: changed.length ? ('CHANGED' as const) : ('MATCH' as const), changed } };
  }
}
