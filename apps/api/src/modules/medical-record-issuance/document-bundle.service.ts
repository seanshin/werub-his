import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { ZipArchive } from 'archiver';
import type { Response } from 'express';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentService } from '../document/document.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { DEFAULT_FEE_RULES, FeeRule, computeFeeWith } from './fee-rules';
import { INSURANCE_DOC_SETS, InsuranceDocSet, resolveInsuranceDocSet } from './insurance-doc-sets';

/**
 * F-4 실손보험 청구 서류 패키지 (patient-portal-enhancement 설계 §4)
 *
 * - 세트 신청: DocumentRequest N건 생성(bundle_id 공통) + 자동발급 분기(AUTO type 은 신청 즉시 snapshot→issue→READY).
 * - RECEIPT 는 DocumentRequest 미생성 — zip 다운로드 시 영수증 IssuedDocument(멱등)를 PDF 로 동봉.
 * - 모듈 배치: MedicalRecordIssuanceModule(기존 포털 다운로드 컨트롤러와 동일 컨텍스트).
 *   ⚠️ PortalModule imports 는 절대 불변(간접 순환 부트 장애 이력) — 본 서비스는 Prisma 직접 쿼리 +
 *   DocumentModule/ConfigRuntimeModule(leaf, 무순환)만 사용. BillingModule 재사용 불가(순환)라
 *   영수증/세부내역 데이터는 billing 테이블 직접 조회로 인라인(F-3 interim-bill 인라인 선례).
 */
@Injectable()
export class DocumentBundleService {
  private readonly logger = new Logger(DocumentBundleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly events: EventEmitter2,
  ) {}

  /** config portal.insuranceDocBundle(기본 false) — OFF 면 404(기능 부재와 동일 취급, FE 는 카드 미렌더) */
  private async assertEnabled() {
    if ((await this.configRuntime.get('portal.insuranceDocBundle')) !== true) {
      throw new NotFoundException('실손보험 서류 세트가 비활성화되어 있습니다.');
    }
  }

  /** 수수료 규칙 — IssuanceService.getFeeRules 와 동일 소스(SystemConfig 'medical_record.fee_rules' 오버라이드) */
  private async getFeeRules(): Promise<{ rules: Record<string, FeeRule>; source: 'CONFIG' | 'DEFAULT' }> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'medical_record.fee_rules' } }).catch(() => null);
    if (cfg && cfg.value && typeof cfg.value === 'object') {
      return { rules: { ...DEFAULT_FEE_RULES, ...(cfg.value as Record<string, FeeRule>) }, source: 'CONFIG' };
    }
    return { rules: DEFAULT_FEE_RULES, source: 'DEFAULT' };
  }

  private endOfDay(d: Date): Date {
    const e = new Date(d);
    e.setHours(23, 59, 59, 999);
    return e;
  }

  // ─────────────────────────── 세트 정의 + 수수료 고지 (신청 전 미리보기)

  /** 세트 구성·수수료 합산 — 신청 전 고지용(설계 §4.2). config OFF 404 → FE 카드 미렌더 게이트 겸용 */
  async getSets() {
    await this.assertEnabled();
    const { rules, source } = await this.getFeeRules();
    const sets = Object.entries(INSURANCE_DOC_SETS).map(([setType, def]) => {
      const components = def.components.map((c) => ({
        type: c.type,
        label: c.label,
        mode: c.mode,
        fee: c.mode === 'RECEIPT_ATTACH' ? 0 : computeFeeWith(rules, source, c.type, 1, 1).total,
      }));
      return {
        setType,
        label: def.label,
        components,
        totalFee: components.reduce((s, c) => s + c.fee, 0),
        notice: def.notice,
      };
    });
    return { sets };
  }

  // ─────────────────────────── 번들 신청 (자동발급 분기 포함)

  async requestBundle(patientId: string, dto: { setType: string; periodFrom: string; periodTo: string }) {
    await this.assertEnabled();
    const set = resolveInsuranceDocSet(dto.setType);
    if (!set) throw new BadRequestException({ code: 'INVALID_SET', message: '지원하지 않는 세트 유형입니다.' });
    const from = new Date(dto.periodFrom);
    const to = new Date(dto.periodTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException({ code: 'INVALID_PERIOD', message: '조회 기간이 올바르지 않습니다.' });
    }

    // 빈 번들 방지 — 기간 내 대상 진료비 내역 선검증(세부내역·영수증·내원확인의 공통 원천)
    const billings = await this.findBundleBillings(patientId, from, to, set.inpatient);
    if (!billings.length) {
      throw new BadRequestException({
        code: 'NO_BILLING_IN_PERIOD',
        message: set.inpatient ? '선택한 기간에 입원 진료비 내역이 없습니다.' : '선택한 기간에 외래 진료비 내역이 없습니다.',
      });
    }

    const { rules, source } = await this.getFeeRules();
    const bundleId = randomUUID();
    const created: { id: string; type: string; status: string; fee: number; label: string }[] = [];

    for (const comp of set.components) {
      if (comp.mode === 'RECEIPT_ATTACH') continue; // 영수증은 요청 미생성 — 다운로드 시 동봉(§4.3)
      const breakdown = computeFeeWith(rules, source, comp.type, 1, 1);
      const row = await this.prisma.documentRequest.create({
        data: {
          patientId,
          type: comp.type,
          purpose: set.purpose,
          periodFrom: from,
          periodTo: to,
          deliveryMethod: 'PORTAL',
          copies: 1,
          bundleId,
          fee: breakdown.total,
          feeBreakdown: breakdown as object,
          slaDueAt: new Date(Date.now() + 3 * 86400000),
        },
      });
      created.push({ id: row.id, type: row.type, status: row.status, fee: row.fee ?? 0, label: comp.label });
    }

    // 자동발급 분기 — 직원 개입 없이 snapshot→issue→READY (설계 §4.2: 선례 없는 신규 분기)
    for (const comp of set.components) {
      if (comp.mode !== 'AUTO') continue;
      const target = created.find((c) => c.type === comp.type);
      if (!target) continue;
      const snapshot =
        comp.type === 'DETAILED_BILL'
          ? await this.buildDetailedBillSnapshot(patientId, from, to, set)
          : await this.buildAttendanceCertSnapshot(patientId, from, to, set);
      const issued = await this.documents.issue(
        { documentType: comp.type, sourceId: target.id, patientId, formVersion: 'v1', snapshot: snapshot as Record<string, unknown> },
        undefined, // 자동발급 — 직원 발급자 없음
      );
      await this.prisma.documentRequest.update({
        where: { id: target.id },
        data: { status: 'READY', issuedDocumentId: issued.issueNo, completedAt: new Date() },
      });
      target.status = 'READY';
    }

    const allReady = created.every((c) => c.status === 'READY');
    if (allReady) {
      // 전 구성 READY(외래 세트 등 전량 자동발급) — 알림은 notification.listener 핸들러가 발송(관례 §0)
      this.events.emit('portal.document_bundle_ready', { bundleId, patientId });
    }
    // STAFF 작성분 잔여 시에는 직원 발급(issue) 시점의 document.ready 이벤트로 번들 완성 검사(listener)

    return {
      bundleId,
      setType: dto.setType,
      requests: created.map(({ id, type, status, fee, label }) => ({ id, type, label, status, fee })),
      totalFee: created.reduce((s, c) => s + c.fee, 0),
      receiptIncluded: set.components.some((c) => c.mode === 'RECEIPT_ATTACH'),
      allReady,
    };
  }

  // ─────────────────────────── 번들 상태 조회

  /** 번들 상세 — bundle 내 전 요청 patientId=세션 환자 검증(불일치·부재 모두 404) */
  async getBundle(patientId: string, bundleId: string) {
    await this.assertEnabled();
    const requests = await this.ownedBundleRequests(patientId, bundleId);
    const set = this.inferSet(requests.map((r) => r.type));
    const labelOf = (t: string) => set?.components.find((c) => c.type === t)?.label ?? t;
    const readyCount = requests.filter((r) => r.status === 'READY' || r.status === 'DELIVERED').length;
    return {
      bundleId,
      purpose: requests[0].purpose,
      periodFrom: requests[0].periodFrom,
      periodTo: requests[0].periodTo,
      requests: requests.map((r) => ({
        id: r.id, type: r.type, label: labelOf(r.type), status: r.status, fee: r.fee,
        issuedDocumentId: r.issuedDocumentId, rejectReason: r.rejectReason,
      })),
      totalFee: requests.reduce((s, r) => s + (r.fee ?? 0), 0),
      readyCount,
      allReady: readyCount === requests.length,
      receiptIncluded: !!set?.components.some((c) => c.mode === 'RECEIPT_ATTACH'),
    };
  }

  // ─────────────────────────── zip 다운로드 (READY분 부분 다운로드 허용 + 영수증 동봉)

  /** READY 구성 PDF + 영수증 PDF(멱등 발급)를 zip 스트림으로. 보호자 위임 세션은 403(설계 §6.6) */
  async streamBundleZip(patientId: string, bundleId: string, res: Response, opts?: { isGuardianAccess?: boolean }) {
    await this.assertEnabled();
    if (opts?.isGuardianAccess) {
      throw new ForbiddenException('보호자 권한으로는 보험 청구 서류를 내려받을 수 없습니다. 본인 계정으로 이용해 주세요.');
    }
    const requests = await this.ownedBundleRequests(patientId, bundleId);
    const set = this.inferSet(requests.map((r) => r.type));
    const from = requests[0].periodFrom;
    const to = requests[0].periodTo;

    const entries: { name: string; pdf: Buffer }[] = [];
    const pending: string[] = [];
    const labelOf = (t: string) => set?.components.find((c) => c.type === t)?.label ?? t;

    for (const r of requests) {
      if ((r.status === 'READY' || r.status === 'DELIVERED') && r.issuedDocumentId) {
        try {
          const pdf = await this.documents.generatePdf(r.issuedDocumentId);
          entries.push({ name: `${labelOf(r.type)}_${r.issuedDocumentId}.pdf`, pdf });
        } catch (e) {
          this.logger.warn(`bundle pdf render failed: ${r.issuedDocumentId} — ${e instanceof Error ? e.message : String(e)}`);
          pending.push(`${labelOf(r.type)} (PDF 생성 실패 — 잠시 후 다시 시도해 주세요)`);
        }
      } else {
        pending.push(`${labelOf(r.type)} (${r.status === 'REJECTED' ? '반려' : '발급 대기 중'})`);
      }
    }

    // 영수증 동봉 — DocumentRequest 미생성분. 기간 내 수납 건별 IssuedDocument(RECEIPT) 멱등 발급 → PDF
    if (set?.components.some((c) => c.mode === 'RECEIPT_ATTACH') && from && to) {
      const billings = await this.findBundleBillings(patientId, from, to, set.inpatient);
      for (const b of billings) {
        // 🔴 (2026-10-14 수납·청구 결함 발굴 P2-5) 영수증은 **낸 돈**의 증빙이다 — 종전엔 취소만 빼고 미납·보류·전액 환불 청구도
        //    영수증으로 동봉해 보험사에 "납부"로 나갔다. 받은 돈(납부 − 환불)이 없으면 동봉하지 않고 그 사실을 남긴다.
        const received = (b.paidAmount ?? 0) - (b.refundAmount ?? 0);
        if (received <= 0) {
          const dk = b.createdAt.toISOString().slice(0, 10);
          pending.push(`진료비 영수증(${dk}) ` + ((b.refundAmount ?? 0) > 0 ? '(전액 환불 — 영수증 없음)' : '(미납 — 영수증 없음)'));
          continue;
        }
        try {
          const issueNo = await this.issueReceiptIdempotent(patientId, b);
          const pdf = await this.documents.generatePdf(issueNo);
          const dateKey = b.createdAt.toISOString().slice(0, 10);
          entries.push({ name: `진료비영수증_${dateKey}_${issueNo}.pdf`, pdf });
        } catch (e) {
          this.logger.warn(`bundle receipt pdf failed: billing=${b.id} — ${e instanceof Error ? e.message : String(e)}`);
          pending.push(`진료비 영수증(${b.createdAt.toISOString().slice(0, 10)}) (PDF 생성 실패)`);
        }
      }
    }

    if (!entries.length) {
      throw new BadRequestException({ code: 'NOTHING_READY', message: '아직 내려받을 수 있는 서류가 없습니다. 발급 완료 후 다시 시도해 주세요.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="insurance-docs-${bundleId.slice(0, 8)}.zip"`);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err: Error) => {
      this.logger.error(`bundle zip stream error: ${err.message}`);
      res.destroy(err);
    });
    archive.pipe(res);
    for (const e of entries) archive.append(e.pdf, { name: e.name });
    if (pending.length) {
      const note = [
        '실손보험 청구 서류 세트 — 부분 다운로드 안내',
        '',
        '아직 준비되지 않아 이번 파일에 포함되지 않은 서류:',
        ...pending.map((p) => ` - ${p}`),
        '',
        '발급이 완료되면 포털 > 서비스 > 서류발급에서 다시 내려받을 수 있습니다.',
      ].join('\n');
      archive.append(Buffer.from(note, 'utf-8'), { name: '안내(미포함 서류).txt' });
    }
    await archive.finalize();
  }

  // ─────────────────────────── 내부 헬퍼

  /** 소유 검증 — bundleId 의 전 요청이 세션 환자 소유가 아니면 404(존재 노출 금지) */
  private async ownedBundleRequests(patientId: string, bundleId: string) {
    const requests = await this.prisma.documentRequest.findMany({
      where: { bundleId },
      orderBy: { createdAt: 'asc' },
    });
    if (!requests.length || requests.some((r) => r.patientId !== patientId)) {
      throw new NotFoundException('서류 번들을 찾을 수 없습니다.');
    }
    return requests;
  }

  /** 번들 구성 type 으로 세트 정의 역추정(입원확인서 포함=입원 세트) — setType 은 별도 영속 컬럼 없음 */
  private inferSet(types: string[]): InsuranceDocSet | null {
    if (types.includes('ADMISSION_CERT')) return INSURANCE_DOC_SETS.INSURANCE_INPATIENT;
    if (types.includes('ATTENDANCE_CERT') || types.includes('DETAILED_BILL')) return INSURANCE_DOC_SETS.INSURANCE_OUTPATIENT;
    return null;
  }

  /** 기간 내 대상 수납(취소 제외) — 외래 세트=비입원 진료, 입원 세트=입원 진료 */
  private async findBundleBillings(patientId: string, from: Date, to: Date, inpatient: boolean) {
    return this.prisma.billing.findMany({
      where: {
        patientId,
        status: { not: 'CANCELLED' },
        createdAt: { gte: from, lte: this.endOfDay(to) },
        encounter: inpatient ? { visitType: 'INPATIENT' } : { visitType: { not: 'INPATIENT' } },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        items: true,
        encounter: {
          select: {
            id: true, createdAt: true, visitType: true,
            doctor: { select: { familyName: true, givenName: true, department: true } },
          },
        },
      },
    });
  }

  private async patientHeader(patientId: string) {
    const p = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true },
    });
    return {
      name: `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim(),
      mrn: p?.mrn ?? null,
      birth: p?.dateOfBirth ?? null,
      sex: p?.gender ?? null,
    };
  }

  /**
   * 진료비 세부산정내역서 스냅샷 — 영수증 fullCopay 5열 분해 재사용(설계 §4.2):
   * 항목별 급여 일부본인부담(본인/공단) · 급여 전액본인부담(100/100) · 비급여 분리.
   * 분류 규칙은 법정 영수증 렌더(print/receipt)와 동일: NON_COVERED → 비급여, fullCopay → 전액본인부담,
   * 그 외 copayRate 로 본인/공단 분해.
   */
  private async buildDetailedBillSnapshot(patientId: string, from: Date, to: Date, set: InsuranceDocSet) {
    const billings = await this.findBundleBillings(patientId, from, to, set.inpatient);
    const patient = await this.patientHeader(patientId);
    const grand = { amount: 0, insurerShare: 0, copayPartial: 0, copayFull: 0, nonCovered: 0 };
    const rows = billings.map((b) => {
      const totals = { amount: 0, insurerShare: 0, copayPartial: 0, copayFull: 0, nonCovered: 0 };
      const items = b.items.map((it) => {
        const amt = it.amount;
        const isNonCov = it.insuranceCategory === 'NON_COVERED';
        const isFull = !isNonCov && it.fullCopay;
        const rate = Number(it.copayRate);
        const copayPartial = isNonCov || isFull ? 0 : Math.round(amt * (Number.isFinite(rate) ? rate : 0));
        const line = {
          name: it.codeName,
          category: it.codeType,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: amt,
          insurerShare: isNonCov || isFull ? 0 : amt - copayPartial,
          copayPartial,
          copayFull: isFull ? amt : 0,
          nonCovered: isNonCov ? amt : 0,
        };
        totals.amount += line.amount;
        totals.insurerShare += line.insurerShare;
        totals.copayPartial += line.copayPartial;
        totals.copayFull += line.copayFull;
        totals.nonCovered += line.nonCovered;
        return line;
      });
      grand.amount += totals.amount;
      grand.insurerShare += totals.insurerShare;
      grand.copayPartial += totals.copayPartial;
      grand.copayFull += totals.copayFull;
      grand.nonCovered += totals.nonCovered;
      return {
        billingId: b.id,
        date: (b.encounter?.createdAt ?? b.createdAt).toISOString(),
        department: b.encounter?.doctor?.department ?? null,
        doctor: `${b.encounter?.doctor?.familyName ?? ''}${b.encounter?.doctor?.givenName ?? ''}`.trim() || null,
        visitType: b.encounter?.visitType ?? null,
        items,
        totals,
        billedCopay: b.patientCopay,
        discountAmount: b.discountAmount,
        paidAmount: b.paidAmount,
      };
    });
    return {
      kind: 'DETAILED_BILL',
      visitScope: set.inpatient ? 'INPATIENT' : 'OUTPATIENT',
      patient,
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      billings: rows,
      grandTotal: grand,
    };
  }

  /** 통원확인서 스냅샷 — 기간 내 수납된 내원 이력(일자·과·의사). 수납 원천이라 허위 내원 불가 */
  private async buildAttendanceCertSnapshot(patientId: string, from: Date, to: Date, set: InsuranceDocSet) {
    const billings = await this.findBundleBillings(patientId, from, to, set.inpatient);
    const patient = await this.patientHeader(patientId);
    const seen = new Set<string>();
    const visits: { date: string; department: string | null; doctor: string | null }[] = [];
    for (const b of billings) {
      const encId = b.encounter?.id ?? b.id;
      if (seen.has(encId)) continue;
      seen.add(encId);
      visits.push({
        date: (b.encounter?.createdAt ?? b.createdAt).toISOString(),
        department: b.encounter?.doctor?.department ?? null,
        doctor: `${b.encounter?.doctor?.familyName ?? ''}${b.encounter?.doctor?.givenName ?? ''}`.trim() || null,
      });
    }
    return {
      kind: 'ATTENDANCE_CERT',
      patient,
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      visits,
      visitCount: visits.length,
    };
  }

  /**
   * 영수증 IssuedDocument 멱등 발급 — billing.service.issueReceipt 와 동일 규약 인라인
   * (BillingModule import 는 간접 순환 금지 대상 — 설계 §2.1 인라인 선례).
   * 동일 billing 의 ORIGINAL 이 있으면 재사용(신규 채번 방지 — 기존 발급과도 정합).
   */
  private async issueReceiptIdempotent(
    patientId: string,
    b: Awaited<ReturnType<DocumentBundleService['findBundleBillings']>>[number],
  ): Promise<string> {
    const existing = await this.prisma.issuedDocument.findFirst({
      where: { documentType: 'RECEIPT', sourceId: b.id, status: 'ORIGINAL' },
      orderBy: { issuedAt: 'desc' },
      select: { issueNo: true, snapshotJson: true },
    });
    // 🔴 (P2-5) 첫 발급 뒤 금액이 바뀌었으면(추가 납부·환불·감면) 그 사본을 재사용하지 않는다 —
    //    종전엔 첫 발급 금액이 고정돼 환불 뒤에도 "납부한 금액 15,000" 이 나갔다.
    const prevSnap = (existing?.snapshotJson ?? null) as Record<string, unknown> | null;
    const same = (k: string, v: unknown) => (prevSnap?.[k] ?? null) === (v ?? null);
    if (existing && same('paidAmount', b.paidAmount) && same('refundAmount', b.refundAmount) && same('discountAmount', b.discountAmount) && same('status', b.status)) {
      return existing.issueNo;
    }
    const patient = await this.patientHeader(patientId);
    const snapshot = {
      status: b.status,
      refundAmount: b.refundAmount,
      billingId: b.id,
      mrn: patient.mrn,
      treatedOn: (b.encounter?.createdAt ?? b.createdAt).toISOString(),
      department: b.encounter?.doctor?.department ?? null,
      totalAmount: b.totalAmount,
      insuranceCovered: b.insuranceCovered,
      patientCopay: b.patientCopay,
      discountAmount: b.discountAmount,
      paidAmount: b.paidAmount,
      receiptNo: b.receiptNo,
      copayCategory: b.copayCategory,
      eligibilityStatus: b.eligibilityStatus,
      issuedAtKst: new Date().toISOString(),
    };
    const issued = await this.documents.issue(
      { documentType: 'RECEIPT', sourceId: b.id, patientId, formVersion: 'v1', snapshot },
      undefined,
    );
    return issued.issueNo;
  }
}
