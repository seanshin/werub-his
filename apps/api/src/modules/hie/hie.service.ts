import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { CdaConverterService, FhirBundleInput } from '../cda-converter/cda-converter.service';
import {
  HIE_GATEWAY,
  HIE_STATUS,
  classifyHieTransmission,
  hieNotTransmittedLog,
  localHieRef,
  type TransmitResult,
} from './hie-transmission';
import { fhirMedicationRequestStatus } from '../../common/fhir-medication-status';

export interface SendHieOptions {
  documentType: string; // TRSF, PRSC, DIAG, EXAM, IMAG, DSCH
  targetOrgId: string;
  format?: 'CDA_R2' | 'FHIR_R4';
  requestedBy?: string; // PHI 반출 요청자(감사 귀속) — 컨트롤러에서 인증 사용자 주입
}

@Injectable()
export class HieService {
  private readonly logger = new Logger('HIE');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cdaConverter: CdaConverterService,
    @Optional() private readonly drift?: DriftRecorderService,
  ) {}

  /** 진료정보 전송 — FHIR Bundle 생성 → CDA 변환 → 교류 이력 저장 */
  async sendPatientSummary(patientId: string, options: SendHieOptions) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        encounters: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            diagnoses: { include: { diagnosisCode: true } },
            prescriptions: { include: { medicationCode: true } },
            doctor: true,
          },
        },
        allergiesRel: { where: { isActive: true } },
      },
    });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');

    const selfOrg = await this.prisma.organization.findFirst({ where: { isSelf: true } });
    const targetOrg = await this.prisma.organization.findUnique({ where: { id: options.targetOrgId } });

    // FHIR Bundle 생성
    const fhirBundle = this.buildPatientBundle(patient, selfOrg, options.documentType);

    // CDA 변환
    const cdaDocument = this.cdaConverter.fhirToCda(fhirBundle, options.documentType);

    // 교류 이력 저장
    const exchange = await this.prisma.hieExchange.create({
      data: {
        patientId,
        direction: 'SEND',
        documentType: options.documentType,
        documentTitle: `${patient.familyName}${patient.givenName} ${this.getDocTypeLabel(options.documentType)}`,
        targetOrgId: options.targetOrgId,
        format: options.format ?? 'CDA_R2',
        status: HIE_STATUS.PENDING,
        cdaDocument,
        fhirBundle: fhirBundle as any,
        requestedBy: options.requestedBy ?? null, // PHI 반출 감사 귀속(누가 내보냈는지)
      },
      include: { targetOrg: true },
    });

    // 전송 시도 (건강정보고속도로 게이트웨이) — 미구축이면 '나가지 않았다'를 그대로 기록한다
    const sendResult = await this.transmitToHie(exchange.id, cdaDocument, targetOrg, options.requestedBy);

    // 🔴 종전: `status: sendResult.success ? 'SENT' : 'FAILED'` — 전송 코드가 없는데도 전건 'SENT'
    //    였다(2026-08-14 W8). 상태·전송여부·시각은 이제 실제 결과에서만 나온다.
    const status =
      sendResult.outcome === 'SENT'
        ? HIE_STATUS.SENT
        : sendResult.outcome === 'FAILED'
          ? HIE_STATUS.SEND_FAILED
          : HIE_STATUS.LOCAL_RECORDED;
    const info = classifyHieTransmission({ direction: 'SEND', status, sentAt: sendResult.at ?? null });

    return {
      exchangeId: exchange.id,
      status,
      transmitted: info.transmitted,
      /** 나가지 않았으면 null — 모르는 시각을 박지 않는다 */
      sentAt: sendResult.at ?? null,
      transmissionState: info.state,
      transmissionLabel: info.label,
      transmissionNote: info.note,
      /** 미전송·실패는 다시 보낼 수 있다(같은 EP 재호출) */
      retransmittable: info.retransmittable,
      channel: HIE_GATEWAY.name,
      documentType: options.documentType,
      targetOrg: targetOrg?.name ?? options.targetOrgId,
      fhirResourceCount: fhirBundle.entry.length,
      cdaLength: cdaDocument.length,
      sendResult,
    };
  }

  /** 외부 진료정보 수신 */
  async receiveExternalRecord(input: { cdaDocument?: string; fhirBundle?: Record<string, unknown>; sourceOrgId?: string }) {
    let fhirBundle: FhirBundleInput;
    let cdaDocument: string | null = null;

    if (input.cdaDocument) {
      // CDA → FHIR 변환
      cdaDocument = input.cdaDocument;
      fhirBundle = this.cdaConverter.cdaToFhir(input.cdaDocument);
    } else if (input.fhirBundle) {
      fhirBundle = input.fhirBundle as FhirBundleInput;
    } else {
      throw new NotFoundException('CDA 또는 FHIR Bundle 데이터가 필요합니다');
    }

    // 환자 매칭
    const patientResource = fhirBundle.entry?.find(e => e.resource?.resourceType === 'Patient')?.resource;
    const patientName = ((patientResource?.name as any[])?.[0]?.family ?? '') + ((patientResource?.name as any[])?.[0]?.given?.[0] ?? '');

    // 기존 환자 검색
    let patient = null;
    if (patientResource) {
      const family = (patientResource.name as any[])?.[0]?.family;
      const given = (patientResource.name as any[])?.[0]?.given?.[0];
      if (family && given) {
        patient = await this.prisma.patient.findFirst({ where: { familyName: family, givenName: given } });
      }
    }

    // 교류 이력 저장
    const header = cdaDocument ? this.cdaConverter.parseCdaHeader(cdaDocument) : null;
    const exchange = await this.prisma.hieExchange.create({
      data: {
        patientId: patient?.id ?? (await this.getDefaultPatientId()),
        direction: 'RECEIVE',
        documentType: header?.documentType ?? 'TRSF',
        documentTitle: header?.title ?? `외부 수신 문서 — ${patientName}`,
        sourceOrgId: input.sourceOrgId,
        format: cdaDocument ? 'CDA_R2' : 'FHIR_R4',
        status: HIE_STATUS.RECEIVED,
        cdaDocument,
        fhirBundle: fhirBundle as any,
        receivedAt: new Date(),
      },
    });

    this.logger.log(`HIE received: ${exchange.documentType} (exchange=${exchange.id})`); // PHI: 환자명 미기록

    return {
      exchangeId: exchange.id,
      status: 'RECEIVED',
      documentType: exchange.documentType,
      patientMatched: !!patient,
      patientName,
      fhirResourceCount: fhirBundle.entry?.length ?? 0,
    };
  }

  /** 교류 이력 목록 */
  async getExchangeLog(patientId?: string, direction?: string, page = 1, limit = 20) {
    const where: Record<string, unknown> = {};
    if (patientId) where.patientId = patientId;
    if (direction) where.direction = direction;

    const [logs, total] = await Promise.all([
      this.prisma.hieExchange.findMany({
        where,
        include: {
          patient: { select: { familyName: true, givenName: true, mrn: true } },
          targetOrg: { select: { name: true, code: true } },
          sourceOrg: { select: { name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hieExchange.count({ where }),
    ]);

    // 🔴 저장값은 변형하지 않고 **읽는 쪽에서** 전송 여부를 판정한다.
    //    게이트웨이가 존재한 적이 없으므로 과거 'SENT' 행은 '전송 근거 없음'으로 읽힌다.
    return {
      logs: logs.map((l) => ({ ...l, transmission: classifyHieTransmission(l) })),
      total,
      page,
      limit,
    };
  }

  /** 교류 이력 상세 */
  async getExchangeDetail(id: string) {
    const exchange = await this.prisma.hieExchange.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        targetOrg: { select: { name: true, code: true } },
        sourceOrg: { select: { name: true, code: true } },
      },
    });
    if (!exchange) throw new NotFoundException('교류 이력을 찾을 수 없습니다');
    return { ...exchange, transmission: classifyHieTransmission(exchange) };
  }

  /** 교류 통계 */
  async getStats() {
    const [total, byDirection, byDocType, byStatus, recentMonth] = await Promise.all([
      this.prisma.hieExchange.count(),
      this.prisma.hieExchange.groupBy({ by: ['direction'], _count: true }),
      this.prisma.hieExchange.groupBy({ by: ['documentType'], _count: true }),
      this.prisma.hieExchange.groupBy({ by: ['status'], _count: true }),
      this.prisma.hieExchange.count({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    // 🔴 '전송 건수'는 상태값을 세지 않고 **전송 판정**으로 센다. 게이트웨이 미구축인 동안
    //    실제 전송은 0 이고, 과거 'SENT' 행은 근거 없음(unverified)으로 분리된다.
    const byState: Record<string, number> = {};
    for (const s of byStatus) {
      const count = typeof s._count === 'number' ? s._count : 0;
      const { state } = classifyHieTransmission({ direction: 'SEND', status: s.status });
      byState[state] = (byState[state] ?? 0) + count;
    }

    return {
      total, recentMonth,
      byDirection: Object.fromEntries(byDirection.map(d => [d.direction, d._count])),
      byDocType: Object.fromEntries(byDocType.map(d => [d.documentType, d._count])),
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
      /** 전송 판정별 집계(SENT=실제 도달 근거 있음 · UNVERIFIED=근거 없음 · LOCAL_ONLY=미전송) */
      byTransmissionState: byState,
      /** 게이트웨이 가동 여부 — false 인 동안 어떤 건도 '전송 완료'로 읽히지 않는다 */
      gatewayImplemented: HIE_GATEWAY.implemented,
      gatewayName: HIE_GATEWAY.name,
      manualFallback: HIE_GATEWAY.manualFallback,
    };
  }

  // ═══════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════

  private buildPatientBundle(patient: any, selfOrg: any, documentType: string): FhirBundleInput {
    const entries: Array<{ resource: Record<string, unknown> }> = [];

    // Patient
    entries.push({
      resource: {
        resourceType: 'Patient',
        id: patient.fhirId ?? patient.id,
        name: [{ family: patient.familyName, given: [patient.givenName] }],
        gender: patient.gender?.toLowerCase(),
        birthDate: patient.dateOfBirth?.toISOString().slice(0, 10),
      },
    });

    // Organization
    if (selfOrg) {
      entries.push({
        resource: { resourceType: 'Organization', id: selfOrg.id, name: selfOrg.name },
      });
    }

    // Conditions from recent encounters
    for (const enc of (patient.encounters ?? [])) {
      for (const diag of (enc.diagnoses ?? [])) {
        entries.push({
          resource: {
            resourceType: 'Condition',
            code: {
              coding: [{ system: 'urn:oid:2.16.840.1.113883.6.256', code: diag.diagnosisCode?.code, display: diag.diagnosisCode?.nameKo }],
              text: diag.diagnosisCode?.nameKo ?? '',
            },
            subject: { reference: `Patient/${patient.id}` },
          },
        });
      }

      // MedicationRequests
      for (const rx of (enc.prescriptions ?? [])) {
        if (rx.medicationCode) {
          entries.push({
            resource: {
              resourceType: 'MedicationRequest',
              // 🔴 종전엔 취소된 약까지 전부 'active' — 상태 정본으로(DISCONTINUED → stopped)
              status: fhirMedicationRequestStatus(rx.status), intent: 'order',
              medicationCodeableConcept: { text: rx.medicationCode.nameKo },
              dosageInstruction: rx.dosage ? [{ text: `${rx.dosage} ${rx.frequency ?? ''}`.trim() }] : [],
              subject: { reference: `Patient/${patient.id}` },
            },
          });
        }
      }

      // Practitioner
      if (enc.doctor) {
        const exists = entries.some(e => e.resource.id === enc.doctor.id && e.resource.resourceType === 'Practitioner');
        if (!exists) {
          entries.push({
            resource: {
              resourceType: 'Practitioner',
              id: enc.doctor.id,
              name: [{ family: enc.doctor.familyName, given: [enc.doctor.givenName] }],
            },
          });
        }
      }
    }

    // Allergies — 호출부(:43)가 allergiesRel 을 항상 include 한다(관계 배열은 빈 배열로라도 온다).
    for (const allergy of ((patient as any).allergiesRel ?? [])) {
      entries.push({
        resource: {
          resourceType: 'AllergyIntolerance',
          code: { text: allergy.allergen },
          criticality: allergy.severity === 'SEVERE' ? 'high' : 'low',
          patient: { reference: `Patient/${patient.id}` },
        },
      });
    }

    // Composition
    /**
     * 🔴 (2026-09-03 재검증) 종전 `(this as any).getDocLoinc?.()` 는 **존재하지 않는 메서드**의 유령 호출이라
     *    6종 문서 전부 18761-7(전원의뢰 요약)로 나갔다 — 제목은 '퇴원요약서'인데 코드는 전원의뢰.
     *    확인된 코드만 매핑하고(모르는 코드는 지어내지 않는다), 미확정 종류는 기본값 사용을 원장에 남긴다.
     */
    entries.unshift({
      resource: {
        resourceType: 'Composition',
        status: 'final',
        type: { coding: [{ system: 'http://loinc.org', code: this.getDocLoinc(documentType) }] },
        title: `${patient.familyName}${patient.givenName} ${this.getDocTypeLabel(documentType)}`,
        date: new Date().toISOString(),
        subject: { reference: `Patient/${patient.id}` },
      },
    });

    return { resourceType: 'Bundle', type: 'document', timestamp: new Date().toISOString(), entry: entries };
  }

  /**
   * 🔴 교류 문서 전송 — **게이트웨이 연동은 존재하지 않는다**(2026-08-14 W8).
   *
   * 종전에는 `Would transmit CDA …` 로그 한 줄 뒤에 `status:'SENT'` · `sentAt:now` 를 적고
   * "교류 문서 전송 완료 (게이트웨이 연동 대기)" 를 반환했다 — 메시지로 미구축을 자인하면서
   * 상태는 전송 완료였다. CDA 는 법정 진료기록 반출이라 이 대장이 곧 거짓 반출기록이 된다.
   *
   * 지금은 나가지 않았다는 사실만 적는다: `LOCAL_RECORDED` · `sentAt` 은 건드리지 않아 null 유지 ·
   * errorMessage 에 조치 안내. 실제 게이트웨이가 붙는 날 고칠 자리는 여기와
   * `HIE_GATEWAY.implemented` 뿐이다.
   */
  private async transmitToHie(
    exchangeId: string,
    cdaDocument: string,
    targetOrg: any,
    requestedBy?: string,
  ): Promise<TransmitResult & { localRef?: string; manualFallback?: string }> {
    const now = new Date();

    if (!HIE_GATEWAY.implemented) {
      const localRef = localHieRef(now);
      const reason = targetOrg?.fhirEndpoint
        ? `${HIE_GATEWAY.name} 연동 미구축 — 수신 endpoint(${targetOrg.name})는 등록돼 있으나 전송 코드가 없음`
        : `${HIE_GATEWAY.name} 연동 미구축 — 전송 코드 없음 · 수신 기관 endpoint 미등록`;
      const note = hieNotTransmittedLog(now, { requestedBy, reason });

      await this.prisma.hieExchange.update({
        where: { id: exchangeId },
        // sentAt 은 쓰지 않는다 — 나가지 않았으므로 null 이 사실이다.
        data: { status: HIE_STATUS.LOCAL_RECORDED, errorMessage: note },
      });
      this.logger.warn(
        `HIE 미전송(local only) exchange=${exchangeId} bytes=${cdaDocument.length} · ${reason}`,
      ); // PHI: 환자·문서 내용 미기록

      return {
        outcome: 'NOT_TRANSMITTED',
        reason,
        localRef,
        manualFallback: HIE_GATEWAY.manualFallback,
      };
    }

    // ── 실제 게이트웨이 연동이 붙는 자리(implemented=true 로 바뀐 뒤에만 실행된다) ──
    /* c8 ignore start — 연동 미구축 구간 */
    try {
      const externalRef = await this.postToGateway(cdaDocument, targetOrg);
      const at = new Date();
      await this.prisma.hieExchange.update({
        where: { id: exchangeId },
        data: { status: HIE_STATUS.SENT, sentAt: at },
      });
      return { outcome: 'SENT', externalRef, at };
    } catch (err) {
      await this.prisma.hieExchange.update({
        where: { id: exchangeId },
        data: { status: HIE_STATUS.SEND_FAILED, errorMessage: (err as Error).message },
      });
      return { outcome: 'FAILED', reason: (err as Error).message };
    }
    /* c8 ignore stop */
  }

  /** 게이트웨이 POST — 연동 미구축. 호출되면 그것이 결함이므로 조용히 성공하지 않는다. */
  private async postToGateway(_cdaDocument: string, _targetOrg: any): Promise<string> {
    throw new Error(`${HIE_GATEWAY.name} 연동이 구현되지 않았습니다`);
  }

  private getDocTypeLabel(type: string): string {
    const map: Record<string, string> = {
      TRSF: '진료의뢰서', PRSC: '처방전', DIAG: '진단서',
      EXAM: '검사결과지', IMAG: '영상판독문', DSCH: '퇴원요약서',
    };
    return map[type] ?? '문서';
  }

  /**
   * 문서 종류별 Composition LOINC — 🔴 확인된 코드만 등재한다(모르는 코드는 지어내지 않는다).
   * 2026-09-03 loinc.org 대조로 6종 전부 확정(출처 URL 은 기획서 §관측점 확대):
   *   PRSC=57833-6(Prescription for medication, Document) · DIAG=80571-3(Certificate — 일반 증명서
   *   문서 코드. 문서 온톨로지 post-coordination 은 미적용, 종류 코드로만 사용).
   * 미등재 신규 종류가 생기면 기본값으로 접되 원장에 남긴다(제목·코드 불일치를 조용히 두지 않는다).
   */
  private getDocLoinc(type: string): string {
    const map: Record<string, string> = {
      TRSF: '18761-7', // Transfer summary note
      DSCH: '18842-5', // Discharge summary
      EXAM: '11502-2', // Laboratory report
      IMAG: '18748-4', // Diagnostic imaging study
      PRSC: '57833-6', // Prescription for medication (Document)
      DIAG: '80571-3', // Certificate
    };
    const code = map[type];
    if (!code) {
      this.drift?.record({
        kind: 'KEY_MISSING',
        producer: 'hie.docTypeLoincMap',
        consumer: 'hie.buildComposition',
        detail: `문서 종류 '${type}' 의 LOINC 미등재 — 기본값 18761-7(전원의뢰)로 반출됨(제목과 코드가 어긋난다)`,
      });
      return '18761-7';
    }
    return code;
  }

  private async getDefaultPatientId(): Promise<string> {
    const p = await this.prisma.patient.findFirst({ select: { id: true } });
    return p?.id ?? '00000000-0000-0000-0000-000000000000';
  }
}
