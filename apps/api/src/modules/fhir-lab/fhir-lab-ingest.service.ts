import { Injectable, BadRequestException, Optional, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LabService } from '../lab/lab.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AuditService } from '../audit/audit.service';
import { resolvePatientRef } from '../fhir/patient-ref.util';

/**
 * 외부 LIS의 FHIR 결과(DiagnosticReport/Observation)를 HIS 검사 파이프라인에 수신.
 *
 * 안전원칙: 외부 결과는 **자동으로 임상사용(VERIFIED) 상태가 되지 않는다.** 분석기 인터페이스와 동일하게
 * LabInterfaceResult(스테이징 큐)에 적재되어, HIS 직원이 match→apply→verify를 거쳐야 LabResult로 확정된다.
 * (독립검증 원칙 — VERIFIED는 HIS 내부 확인자만 부여) 위급값은 apply 시점 파이프라인에서 자동 감지·통보된다.
 */
@Injectable()
export class FhirLabIngestService {
  private readonly logger = new Logger(FhirLabIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly labService?: LabService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** FHIR 수신 전용 가상 계측기(클라이언트별) — LabInterfaceResult.instrumentId FK 충족. */
  private async getVirtualInstrumentId(clientId: string): Promise<string> {
    const serial = `FHIR:${clientId}`;
    // @@unique([interfaceType, serialNumber]) 기반 upsert — 동시 최초 수신의 중복 계측기 생성 경합 제거(원자).
    const inst = await this.prisma.labInstrument.upsert({
      where: { interfaceType_serialNumber: { interfaceType: 'API', serialNumber: serial } },
      create: {
        name: `외부 LIS (FHIR ${clientId.slice(0, 8)})`,
        category: 'SPECIAL',
        interfaceType: 'API',
        serialNumber: serial,
        isActive: true,
      },
      update: {},
      select: { id: true },
    });
    return inst.id;
  }

  /** FHIR Observation → 파이프라인 parsedItem(applyInterfaceResult 계약). */
  private mapObservation(obs: Record<string, any>): Record<string, unknown> {
    const coding = obs?.code?.coding?.[0] ?? {};
    const vq = obs?.valueQuantity ?? {};
    const rr = obs?.referenceRange?.[0] ?? {};
    const rawValue = vq.value != null ? vq.value : (obs?.valueString ?? obs?.valueInteger ?? obs?.valueBoolean ?? '');
    const isLoinc = typeof coding.system === 'string' && /loinc/i.test(coding.system);
    return {
      testCode: coding.code ?? '',
      testName: coding.display ?? coding.code ?? '',
      loincCode: isLoinc ? coding.code : undefined,
      loincSystem: isLoinc ? coding.system : undefined,
      value: rawValue != null ? String(rawValue) : '',
      unit: vq.unit ?? vq.code ?? '',
      normalMin: rr?.low?.value ?? null,
      normalMax: rr?.high?.value ?? null,
      interpretation: obs?.interpretation?.[0]?.coding?.[0]?.code ?? undefined,
      observationStatus: obs?.status ?? undefined,
    };
  }

  private extractBarcode(body: Record<string, any>): string | undefined {
    const ident = Array.isArray(body?.identifier) ? body.identifier[0]?.value : body?.identifier?.value;
    if (ident) return String(ident);
    const spec = Array.isArray(body?.specimen) ? body.specimen[0]?.reference : body?.specimen?.reference;
    if (spec) return String(spec).replace(/^Specimen\//, '');
    return undefined;
  }

  async ingestDiagnosticReport(body: Record<string, any>, clientId: string) {
    if (body?.resourceType !== 'DiagnosticReport') throw new BadRequestException('resourceType must be DiagnosticReport');
    const contained = Array.isArray(body.contained)
      ? body.contained.filter((r: Record<string, unknown>) => r?.resourceType === 'Observation')
      : [];
    if (contained.length === 0) {
      throw new BadRequestException(
        'DiagnosticReport.contained[]에 Observation 결과가 필요합니다(참조 result[]만으로는 값을 수신할 수 없습니다).',
      );
    }
    const parsedItems = contained.map((o: Record<string, any>) => this.mapObservation(o));
    return this.stage(body, parsedItems, clientId);
  }

  async ingestObservation(body: Record<string, any>, clientId: string) {
    if (body?.resourceType !== 'Observation') throw new BadRequestException('resourceType must be Observation');
    return this.stage(body, [this.mapObservation(body)], clientId);
  }

  /**
   * Bundle 트랜잭션 경로 — DiagnosticReport 엔트리 + 별도 엔트리로 온 Observation들(참조 해소됨)을 함께 스테이징.
   * (단건 POST와 달리 결과가 contained가 아니라 result[] 참조로 오는 LIS 표준 출력 대응)
   */
  async ingestReport(report: Record<string, any>, observations: Record<string, any>[], clientId: string) {
    if (report?.resourceType !== 'DiagnosticReport') throw new BadRequestException('resourceType must be DiagnosticReport');
    const contained = Array.isArray(report.contained)
      ? report.contained.filter((r: Record<string, unknown>) => r?.resourceType === 'Observation')
      : [];
    const allObs = [...observations, ...contained];
    if (allObs.length === 0) throw new BadRequestException('DiagnosticReport에 연결된 Observation 결과가 없습니다');
    return this.stage(report, allObs.map((o) => this.mapObservation(o)), clientId);
  }

  private async stage(body: Record<string, any>, parsedItems: Record<string, unknown>[], clientId: string) {
    const instrumentId = await this.getVirtualInstrumentId(clientId);

    // 결과의 대상 환자(subject) — 오환자 결속 방지의 정본 기준. UUID·MRN 모두 정본으로 해소한다.
    // 🔴 종전엔 UUID 가 아니면 subject 를 **없는 것**으로 보았다. LIS 는 MRN 우선이라
    //    이 대조가 평소 늘 꺼져 있었고, basedOn 만으로 MATCHED 가 됐다. 보냈는데 못 찾은 subject 는 "대조 불가"다.
    const subjectRef = Array.isArray(body.subject) ? body.subject[0]?.reference : body.subject?.reference;
    const subject = await resolvePatientRef(this.prisma, subjectRef);
    const subjectPatientId = subject.kind === 'resolved' ? subject.patientId : null;
    let unresolvedNote: string | undefined;
    const sampleBarcode = this.extractBarcode(body);

    // 오더 결속 — basedOn(ServiceRequest/{orderId}) 우선. ⚠ 오더 환자 == subject 환자 대조(오환자 결속 차단).
    let matchedOrderId: string | undefined;
    let status = 'RECEIVED';
    const basedOnRef = Array.isArray(body.basedOn) ? body.basedOn[0]?.reference : body.basedOn?.reference;
    const orderRef = String(basedOnRef ?? '').replace(/^ServiceRequest\//, '');
    if (/^[0-9a-fA-F-]{36}$/.test(orderRef)) {
      const order = await this.prisma.order.findFirst({
        where: { id: orderRef, department: 'LAB' },
        select: { id: true, prescription: { select: { encounter: { select: { patientId: true } } } } },
      });
      if (order) {
        const orderPatient = order.prescription?.encounter?.patientId ?? null;
        // subject와 오더 환자가 다르면 결속하지 않음(RECEIVED로 남겨 직원 확인) — 오환자 결과 자동반영 차단.
        if (subject.kind === 'unresolved') {
          // 보간하지 않는다(서버 조립 문장 동결) — 보낸 subject 원문은 rawData 에 그대로 있다
          unresolvedNote = '대상 환자(subject)를 찾지 못해 오더 환자와 대조할 수 없습니다 — 직원이 환자를 확인하세요';
          this.logger.warn(`FHIR 결과 subject 미해소: ${subject.raw} — order ${orderRef} 미결속(대조 불가)`);
        } else if (!subjectPatientId || !orderPatient || orderPatient === subjectPatientId) {
          matchedOrderId = order.id; status = 'MATCHED';
        } else {
          this.logger.warn(`FHIR 결과 오더-환자 불일치: order ${orderRef} 환자≠subject ${subjectPatientId} — 미결속(직원 확인)`);
        }
      }
    }
    // basedOn 미결속 시 — subject 환자의 열린 LAB 오더로 결속(바코드 substring 휴리스틱 폐기: 오환자 위험).
    if (!matchedOrderId && subjectPatientId) {
      const order = await this.prisma.order.findFirst({
        where: {
          department: 'LAB',
          status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] },
          prescription: { encounter: { patientId: subjectPatientId } },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (order) { matchedOrderId = order.id; status = 'MATCHED'; }
    }

    // 멱등 — 같은 계측기·검체 바코드의 '미적용' 스테이징행이 있으면 재사용(재전송/정정이 중복행을 쌓던 것 방지).
    //   APPLIED 행은 재검사(정상)이므로 신규 생성(적용 완료된 것은 막지 않음).
    const stageData: {
      instrumentId: string; rawData: Prisma.InputJsonValue; parsedItems: Prisma.InputJsonValue;
      sampleBarcode: string | undefined; matchedOrderId: string | undefined; fileName: string;
      status: string; errorMessage?: string;
    } = {
      instrumentId,
      rawData: body as unknown as Prisma.InputJsonValue,
      parsedItems: parsedItems as unknown as Prisma.InputJsonValue,
      sampleBarcode: sampleBarcode ?? undefined,
      matchedOrderId,
      fileName: `FHIR:${body.resourceType}`,
      status,
      ...(unresolvedNote ? { errorMessage: unresolvedNote } : {}),
    };
    // 중복 결과 가드(LIS 스모크 관찰) — 이미 최종 결과(COMPLETED/VERIFIED)가 반영된 오더에 동일 검사가
    // 재수신되면, DR이 정정 의도(status=amended|corrected)가 아닌 한 자동반영을 막고 DUPLICATE로 표시.
    // 실수 재전송이 조용히 중복 결과로 쌓이는 것 방지. 정정 의도는 직원 amend 경로로 정상 처리.
    const drStatus = String(body.status ?? '').toLowerCase();
    const isCorrection = drStatus === 'amended' || drStatus === 'corrected';
    if (matchedOrderId && !isCorrection) {
      const finalized = await this.prisma.labResult.findUnique({
        where: { orderId: matchedOrderId },
        select: { status: true },
      }); // 🔴 (2026-09-15) 종전 `.catch(() => null)` — 조회 실패가 "기존 결과 없음"이 되어 중복 가드를 건너뛰고 자동반영했다. 전파
      if (finalized && ['COMPLETED', 'VERIFIED'].includes(finalized.status)) {
        stageData.status = 'DUPLICATE';
        stageData.errorMessage = `중복 결과 — 오더 ${matchedOrderId}에 이미 ${finalized.status} 결과 존재. 정정이면 DR status=amended/corrected로 재전송하세요`;
        this.logger.warn(`FHIR 중복 결과 차단 — 오더 ${matchedOrderId} 이미 ${finalized.status}·DR status=${drStatus || '없음'}(정정 아님)`);
      }
    }
    // 동일 검체·미적용 스테이징 재사용(멱등). DUPLICATE도 검체 기준으론 재사용해 스테이징 폭증 방지.
    const dupe = sampleBarcode
      ? await this.prisma.labInterfaceResult.findFirst({
          where: { instrumentId, sampleBarcode, status: { not: 'APPLIED' } },
          select: { id: true },
        })
      : null;
    const rec = dupe
      ? await this.prisma.labInterfaceResult.update({ where: { id: dupe.id }, data: stageData, select: { id: true } })
      : await this.prisma.labInterfaceResult.create({ data: stageData, select: { id: true } });
    await this.prisma.labInstrument.update({ where: { id: instrumentId }, data: { lastSyncAt: new Date() } }).catch(() => {});

    // 감사 — 외부 시스템(LIS) 검사결과 수신 추적성. audit_logs.userId는 User FK(UUID)라 외부 클라이언트 id로
    // 삽입 불가 → 시스템 서비스계정(lab.fhirAutoApplyUserId)이 설정된 경우에만 그 명의로 기록(clientId는 changes에).
    // 미설정 시 외부 출처는 가상 계측기(FHIR:{clientId}) provenance로 대체(항상 보존). best-effort.
    if (this.audit && this.config) {
      try {
        const sysUserId = await this.config.get('lab.fhirAutoApplyUserId');
        if (sysUserId) {
          void this.audit.log({
            userId: String(sysUserId),
            action: 'CREATE',
            resourceType: 'LabInterfaceResult',
            resourceId: rec.id,
            changes: {
              sourceClient: { old: null, new: clientId },
              matchedOrder: { old: null, new: matchedOrderId ?? null },
              items: { old: null, new: parsedItems.length },
              sampleBarcode: { old: null, new: sampleBarcode ?? null },
            },
          }).catch(() => {});
        }
      } catch { /* 감사 실패는 비차단 */ }
    }

    // 자동 반영(apply) — 기본 OFF(안전상 직원 검증 유지). config lab.fhirAutoApply=ON + 시스템 서비스계정 설정 +
    // 오더 매칭된 경우에만 자동 apply(위급값 감지 포함). best-effort — 실패해도 스테이징은 유지.
    let applied = false;
    if (matchedOrderId && stageData.status !== 'DUPLICATE' && this.labService && this.config) {
      try {
        const gate = String(await this.config.get('lab.fhirAutoApply') ?? 'OFF').toUpperCase();
        const sysUserId = await this.config.get('lab.fhirAutoApplyUserId');
        if (gate === 'ON' && sysUserId) {
          // (P2) 시스템 서비스계정 활성검증 — 비활성/미존재 id를 기술자로 기록하거나 FK 위반 무음실패 방지.
          const sysUser = await this.prisma.user.findUnique({
            where: { id: String(sysUserId) }, select: { id: true, isActive: true },
          });
          if (!sysUser || !sysUser.isActive) {
            this.logger.warn(`FHIR 자동반영 시스템계정(lab.fhirAutoApplyUserId=${sysUserId})이 없거나 비활성 — 자동반영 생략(스테이징 유지)`);
          } else {
            // (P2) replay 안전 — 이미 독립검증(VERIFIED)된 결과는 자동으로 되돌리지 않음(재전송이 확정검증을 무음 revert하던 것 차단).
            const existing = await this.prisma.labResult.findUnique({ where: { orderId: matchedOrderId }, select: { status: true } });
            if (existing?.status === 'VERIFIED') {
              this.logger.warn(`FHIR 자동반영 생략 — 오더 ${matchedOrderId} 결과가 이미 VERIFIED(재전송의 확정검증 revert 방지). 정정은 직원 amend 경로로.`);
            } else {
              await this.labService.applyInterfaceResult(rec.id, sysUser.id);
              applied = true;
            }
          }
        }
      } catch (e) {
        this.logger.warn(`FHIR 결과 자동 반영 실패(스테이징 유지): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { id: rec.id, status: applied ? 'APPLIED' : status, matchedOrderId: matchedOrderId ?? null, items: parsedItems.length, applied };
  }
}
