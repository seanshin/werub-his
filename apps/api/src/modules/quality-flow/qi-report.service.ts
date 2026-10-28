import { createHash } from 'node:crypto';
import { canonicalJson } from '../../common/util/canonical-json';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QiService } from '../qi/qi.service';
import { QualityService } from '../quality/quality.service';
import { ACTIVE_MEASUREMENT, primaryPerPeriod } from '../quality/measurement-read';
import { CommitteeAgendaService } from '../order-governance/committee-agenda.service';
import { monthRangeLocal } from '../../common/day-range';

/**
 * QI 보고서 원장(QI 흐름 2026-10-08).
 *
 * 🔴 종전 `POST /qi/report` 는 즉석 JSON 을 돌려줄 뿐이었다 — 보존·재현·인쇄·위원회 연결이 없었고 부르는 화면도 0 이었다.
 *  · 만들 때 본문과 **읽은 측정 행 id** 를 함께 남긴다(같은 보고서를 다시 그릴 수 있다) · 본문 sha256
 *  · 위원회(QPS) 안건으로 올리면 SUBMITTED — 의결은 위원회 몫(보고 접수/개선 활동 요구는 선택지일 뿐 원장을 바꾸지 않는다)
 */
/** QI 보고서 봉인 방식(C4) — 이 표식이 있는 보고서만 저장된 본문으로 봉인을 다시 계산할 수 있다 */
export const QI_REPORT_SEAL_CANON = 'canon-json-v1';
export const qiReportSealHash = (content: unknown) => createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');
/**
 * 저장된 본문 ↔ 봉인 — MATCH 일치 · MISMATCH 본문이 봉인과 다르다(바뀌었다) · LEGACY 2026-10-13 전 봉인(다시 계산할 수 없다) · UNSEALED 해시 없음.
 * 🔴 LEGACY 를 일치라 말하지 않는다.
 */
export function qiReportSealCheck(r: { body: unknown; sha256: string | null }): 'MATCH' | 'MISMATCH' | 'LEGACY' | 'UNSEALED' {
  if (!r.sha256) return 'UNSEALED';
  const canon = (r.body as { sealCanon?: unknown } | null)?.sealCanon;
  if (canon !== QI_REPORT_SEAL_CANON) return 'LEGACY';
  return qiReportSealHash(r.body) === r.sha256 ? 'MATCH' : 'MISMATCH';
}

@Injectable()
export class QiReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qi: QiService,
    private readonly quality: QualityService,
    private readonly agendas: CommitteeAgendaService,
  ) {}

  async create(period: string, actorId: string) {
    const { end } = monthRangeLocal(period);
    if (end > new Date()) throw new BadRequestException({ code: 'QI_REPORT_MONTH_OPEN', message: '끝난 달만 보고서로 만듭니다', period });
    const body = await this.qi.generateQiReport(period);
    const precedence = await this.quality.precedence();
    const rows = await this.prisma.qiMeasurement.findMany({ where: { period, ...ACTIVE_MEASUREMENT }, select: { id: true, indicatorId: true, period: true, sourceKey: true, source: true } });
    const byInd = new Map<string, typeof rows>();
    for (const r of rows) byInd.set(r.indicatorId, [...(byInd.get(r.indicatorId) ?? []), r]);
    const used = [...byInd.values()].map((list) => primaryPerPeriod(list, precedence)[0]).filter(Boolean);
    const measurementIds = used.map((u) => ({ id: u!.primary.id, source: u!.primary.source ?? null, alternateId: u!.alternate?.id ?? null }));
    // 인증 자체 평가(원장) — 기준별 최근 평가의 판정·확인 여부 수(자가 평가와 확인을 가른다)
    const standards = await this.prisma.accreditationStandard.findMany({
      where: { isActive: true }, select: { id: true, framework: true, assessments: { orderBy: { assessedAt: 'desc' }, take: 1, select: { judgment: true, verifiedAt: true } } },
    });
    const accreditationSelfAssessment = {
      standards: standards.length,
      assessed: standards.filter((x) => x.assessments.length > 0).length,
      verified: standards.filter((x) => x.assessments[0]?.verifiedAt).length,
      byJudgment: standards.reduce<Record<string, number>>((acc, x) => { const j = x.assessments[0]?.judgment; if (j) acc[j] = (acc[j] ?? 0) + 1; return acc; }, {}),
    };
    // 🔴 (2026-10-13 결함 발굴 C4) 봉인은 키 정렬 JSON 으로 — 종전 `JSON.stringify` 해시는 JSONB 가 키 순서를 바꿔 저장해
    //    저장된 본문으로 다시 계산할 수 없었다(봉인을 아무도 검산할 수 없었다). 봉인 방식 표식은 본문 안에(해시가 덮는다).
    const content = { ...body, precedence, measurementIds, accreditationSelfAssessment, sealCanon: QI_REPORT_SEAL_CANON };
    const sha256 = qiReportSealHash(content);
    return this.prisma.qiReportSnapshot.create({
      data: { period, title: `QI 보고서 ${period}`, body: content as never, measurementIds: measurementIds as never, createdBy: actorId, sha256 },
    });
  }

  async list(period?: string) {
    return this.prisma.qiReportSnapshot.findMany({
      where: period ? { period } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, period: true, title: true, status: true, createdBy: true, createdAt: true, submittedAt: true, agendaId: true, sha256: true },
    });
  }

  async get(id: string) {
    const r = await this.prisma.qiReportSnapshot.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('보고서를 찾을 수 없습니다');
    return { ...r, sealCheck: qiReportSealCheck(r) };
  }

  /** QPS 안건으로 — 선택지는 원장을 바꾸지 않는다(보고 접수 · 개선 활동 요구 · 보완 요청) */
  async submit(id: string, actorId: string, note?: string) {
    const r = await this.get(id);
    if (r.status === 'SUBMITTED') throw new ConflictException({ code: 'QI_REPORT_SUBMITTED', message: '이미 위원회에 올린 보고서입니다', agendaId: r.agendaId });
    const s = (r.body as { summary?: { keyFindings?: string[] } })?.summary;
    const body = [
      `QI 보고서 ${r.period} — 질 지표 화면에서 올린 보고입니다(본문 sha256 ${r.sha256?.slice(0, 12) ?? '-'}…).`,
      ...(s?.keyFindings ?? []).map((f) => '· ' + f),
      note?.trim() ? '제안 사유: ' + note.trim() : null,
    ].filter(Boolean).join('\n');
    // 🔴 동시 제출 두 번이 안건 둘을 만들지 않게 — DRAFT 인 것만 먼저 선점한다(DB 가 판정)
    const claimed = await this.prisma.qiReportSnapshot.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    if (claimed.count !== 1) throw new ConflictException({ code: 'QI_REPORT_SUBMITTED', message: '이미 위원회에 올린 보고서입니다' });
    let agenda: { id: string };
    try {
      ({ agenda } = await this.agendas.submit({
      surfaceKey: 'review:qi-report', source: 'QI_REPORT', key: r.id, title: r.title, body,
      options: [
        { value: 'ACCEPT', label: '보고 접수', effect: '보고서를 접수로 기록합니다 — 원장·설정은 바뀌지 않습니다.', enact: null },
        { value: 'REQUEST_ACTION', label: '미달 지표 개선 활동 요구', effect: '담당자가 질 지표 화면에서 개선 활동(PDCA)을 시작하도록 요구합니다 — 활동 개시는 담당자가 합니다.', enact: null },
        { value: 'REVISE', label: '보완 후 재보고', effect: '보고서를 보완해 다시 올리도록 합니다.', enact: null },
      ],
    }, actorId));
    } catch (e) {
      // 안건을 못 만들었으면 선점을 되돌린다(올라가지 않은 보고서를 "올림"으로 남기지 않는다)
      await this.prisma.qiReportSnapshot.updateMany({ where: { id, status: 'SUBMITTED', agendaId: null }, data: { status: 'DRAFT', submittedAt: null } });
      throw e;
    }
    await this.prisma.qiReportSnapshot.update({ where: { id }, data: { agendaId: agenda.id } });
    return { reportId: id, agendaId: agenda.id };
  }
}
