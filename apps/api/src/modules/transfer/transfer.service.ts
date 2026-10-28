import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';
import { assertStateTransition, stateChangedConflict, TransitionMap } from '../../common/state-transition';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { safeFetch } from '../../common/util/safe-fetch';
import { toTransferClinicalView, toDiagnosisView } from './transfer-clinical-view';
import { fhirMedicationRequestStatus } from '../../common/fhir-medication-status';

interface BundleEntry { resource: Record<string, unknown> }

/** 전원 상태 어휘 — 스키마 주석(TransferRecord.status) 그대로. 새 값을 지어내지 않는다 */
export type TransferStatus = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'IN_TRANSIT' | 'COMPLETED';

/** 전원 스냅샷 섹션 라벨 — 실패를 사람이 읽는 문장으로 옮길 때 쓴다(문서·화면 공통) */
const SECTION_LABEL: Record<string, string> = {
  diagnoses: '진단',
  medications: '투약',
  allergies: '알레르기',
};

interface FhirCodeableConcept {
  coding?: Array<{ system?: string; code?: string; display?: string }>;
  text?: string;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger('TransferService');

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════

  async create(
    dto: { patientId: string; toOrgId: string; urgency: string; reason: string; transferType: string },
    userId: string,
  ) {
    const selfOrg = await this.prisma.organization.findFirst({ where: { isSelf: true } });
    if (!selfOrg) throw new NotFoundException('자기 기관 정보가 설정되지 않았습니다');

    /**
     * 🔴 전원 스냅샷의 실패를 **빈 목록으로 접지 않는다**(2026-08-21).
     *
     *    종전 `.catch(() => [])` 는 조회 실패를 `[]` 로 만들어 그대로 `transfer_records` 에 박고
     *    FHIR Bundle 로 **수신 기관에 전송**했다. 받는 쪽에서 `allergies: []` 는
     *    "알레르기 없음"으로 읽힌다 — 조회가 실패했다는 사실은 어디에도 남지 않았다.
     *    이 컬럼들은 `Json?` 이므로 **`null`(미상)** 과 `[]`(없음)을 구분할 수 있다.
     *    실패한 섹션은 `null` + `metadata.snapshotFailed` 로 무엇이 비었는지 밝힌다.
     */
    const snapshotFailed: string[] = [];
    const snap = async <T>(section: string, q: Promise<T[]>): Promise<T[] | null> =>
      q.catch((e) => {
        this.logger.error(`전원 스냅샷 조회 실패(${section}) patient=${dto.patientId}: ${(e as Error).message}`);
        snapshotFailed.push(section);
        return null;
      });

    const [diagnoses, medications, allergies] = await Promise.all([
      snap('diagnoses', this.prisma.encounterDiagnosis.findMany({
        where: { encounter: { patientId: dto.patientId } },
        include: { diagnosisCode: true },
        take: 20,
      })),
      snap('medications', this.prisma.prescription.findMany({
        where: { encounter: { patientId: dto.patientId } },
        // 🔴 (2026-09-15) 약품 코드를 담지 않아 스냅샷에 **약 이름이 어디에도 없었다** — 번들 MedicationRequest text 가 전부 ''.
        //    진단(diagnosisCode)과 같이 코드 행을 곁들인다(키 추가만 — 기존 키 모양은 그대로)
        include: { medicationCode: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })),
      snap('allergies', this.prisma.allergy.findMany({
        where: { patientId: dto.patientId },
      })),
    ]);

    const record = await this.prisma.transferRecord.create({
      data: {
        patientId: dto.patientId,
        fromOrgId: selfOrg.id,
        toOrgId: dto.toOrgId,
        transferType: dto.transferType,
        urgency: dto.urgency,
        reason: dto.reason,
        status: 'REQUESTED',
        requestedBy: userId,
        // null = 조회 실패(미상) · [] = 실제로 없음
        diagnoses: diagnoses as any,
        medications: medications as any,
        allergies: allergies as any,
        ...(snapshotFailed.length
          ? { metadata: { snapshotFailed, snapshotFailedAt: new Date().toISOString() } as any }
          : {}),
      },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
    });

    await this.generateBundle(record.id);
    this.logger.log(`Transfer request created: ${record.id} (${selfOrg.name} → ${record.toOrg.name})`);
    return record;
  }

  async getIncoming() {
    return this.prisma.transferRecord.findMany({
      where: { toOrg: { isSelf: true } },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async findAll(status?: string) {
    const where = status ? { status } : {};
    return this.prisma.transferRecord.findMany({
      where,
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.transferRecord.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
    });
    if (!record) throw new NotFoundException('전원 기록을 찾을 수 없습니다');
    // 저장 JSON 은 쓰는 경로마다 모양이 달라 화면이 직접 읽으면 갈라진다 — 읽기 정본을 곁들인다(원본 필드는 그대로)
    return { ...record, clinical: toTransferClinicalView(record) };
  }

  /**
   * 전원 기록 전이 정본 — 어휘는 스키마 주석 그대로(REQUESTED·ACCEPTED·REJECTED·IN_TRANSIT·COMPLETED).
   * 🔴 (2026-09-15 D1) 종전엔 accept·reject·complete·sendBundle 이 **현재 상태를 보지 않았다**.
   *    거절한 전원을 다시 수락할 수 있었고, 완료된 전원을 거절로 뒤집을 수 있었으며, 거절된 전원의
   *    환자 임상 Bundle 이 수신 기관으로 **다시 나갔다**(대외 발신은 되돌릴 수 없다).
   */
  private static readonly TRANSITIONS: TransitionMap<TransferStatus> = {
    REQUESTED: ['ACCEPTED', 'REJECTED', 'IN_TRANSIT'],
    ACCEPTED: ['IN_TRANSIT', 'COMPLETED', 'REJECTED'],
    IN_TRANSIT: ['COMPLETED'],
    REJECTED: [],
    COMPLETED: [],
  };
  private static readonly TX_CTX = { code: 'TRANSFER', message: '지금 상태에서는 할 수 없는 전원 처리입니다' };

  /** 전이 검사 + 조건부 갱신 하나로 — 이미 목표 상태면 쓰지 않고 그대로 돌려준다(시각·행위자 보존) */
  private async transition(id: string, next: TransferStatus, data: Prisma.TransferRecordUncheckedUpdateInput) {
    const cur = await this.prisma.transferRecord.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw new NotFoundException('전원 기록을 찾을 수 없습니다');
    const from = cur.status as TransferStatus;
    if (from === next) return this.findOne(id);
    assertStateTransition(TransferService.TRANSITIONS, from, next, TransferService.TX_CTX);
    const upd = await this.prisma.transferRecord.updateMany({
      where: { id, status: from },
      data: { status: next, ...(data as Prisma.TransferRecordUncheckedUpdateManyInput) },
    });
    if (upd.count === 0) stateChangedConflict(TransferService.TX_CTX, from);
    return this.prisma.transferRecord.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
    });
  }

  async accept(id: string, userId: string) {
    return this.transition(id, 'ACCEPTED', { acceptedBy: userId, acceptedAt: new Date() });
  }

  async reject(id: string, reason?: string) {
    return this.transition(id, 'REJECTED', { responseNote: reason });
  }

  async complete(id: string) {
    return this.transition(id, 'COMPLETED', { completedAt: new Date() });
  }

  async getBundle(id: string) {
    const record = await this.findOne(id);
    return record.fhirBundle ?? { message: 'Bundle이 아직 생성되지 않았습니다' };
  }

  // ═══════════════════════════════════════════════
  // Phase 3: Bundle 전송 (HTTP + retry)
  // ═══════════════════════════════════════════════

  async sendBundle(id: string) {
    const record = await this.prisma.transferRecord.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
    });
    if (!record) throw new NotFoundException('전원 기록을 찾을 수 없습니다');
    if (!record.fhirBundle) throw new BadRequestException('FHIR Bundle이 생성되지 않았습니다');
    // 🔴 거절·완료된 전원의 환자 임상 정보를 다시 내보내지 않는다(대외 발신은 되돌릴 수 없다).
    //    같은 상태로의 재전송(IN_TRANSIT→IN_TRANSIT)은 재시도이므로 허용한다.
    if (record.status !== 'IN_TRANSIT') {
      assertStateTransition(
        TransferService.TRANSITIONS,
        record.status as TransferStatus,
        'IN_TRANSIT',
        TransferService.TX_CTX,
      );
    }

    const toOrg = record.toOrg;
    if (!toOrg.fhirEndpoint) {
      // FHIR 엔드포인트 없는 기관 → 내부 전원 처리만
      this.logger.warn(`Organization ${toOrg.name} has no FHIR endpoint — marking IN_TRANSIT`);
      return this.prisma.transferRecord.update({
        where: { id },
        data: { status: 'IN_TRANSIT', transferredAt: new Date() },
        include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
      });
    }

    // SMART 토큰 획득
    let accessToken: string | null = null;
    if (toOrg.smartClientId && toOrg.smartSecret) {
      try {
        accessToken = await this.acquireSmartToken(toOrg.fhirEndpoint, toOrg.smartClientId, toOrg.smartSecret);
      } catch (err) {
        this.logger.warn(`Failed to acquire SMART token for ${toOrg.name}: ${(err as Error).message}`);
      }
    }

    // Bundle HTTP 전송 (최대 3회 retry)
    const sendResult = await this.httpSendWithRetry(
      toOrg.fhirEndpoint,
      record.fhirBundle as Record<string, unknown>,
      accessToken,
      3,
    );

    const newStatus = sendResult.success ? 'IN_TRANSIT' : 'REQUESTED';
    const metadata = {
      ...(record.metadata as Record<string, unknown> ?? {}),
      lastSendAttempt: new Date().toISOString(),
      sendResult: {
        success: sendResult.success,
        statusCode: sendResult.statusCode,
        attempts: sendResult.attempts,
        error: sendResult.error,
      },
    };

    const updated = await this.prisma.transferRecord.update({
      where: { id },
      data: {
        status: newStatus,
        transferredAt: sendResult.success ? new Date() : undefined,
        metadata: metadata as any,
      },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
    });

    if (sendResult.success) {
      this.logger.log(`Bundle sent successfully for transfer ${id} to ${toOrg.name}`);
    } else {
      this.logger.error(`Bundle send failed for transfer ${id}: ${sendResult.error}`);
    }

    return { ...updated, sendResult };
  }

  /** SMART-on-FHIR Client Credentials 토큰 획득 */
  private async acquireSmartToken(fhirEndpoint: string, clientId: string, clientSecret: string): Promise<string> {
    const baseUrl = new URL(fhirEndpoint).origin;
    const tokenUrl = `${baseUrl}/oauth2/token`;

    const response = await safeFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'patient/*.read patient/*.write',
      }),
    }); // SSRF 검증(G2)

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  /** HTTP Bundle 전송 with retry */
  private async httpSendWithRetry(
    fhirEndpoint: string,
    bundle: Record<string, unknown>,
    accessToken: string | null,
    maxRetries: number,
  ): Promise<{ success: boolean; statusCode?: number; attempts: number; error?: string }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/fhir+json',
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await safeFetch(fhirEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(bundle),
        }, { timeoutMs: 30_000 }); // SSRF 검증(G2)

        if (response.ok || response.status === 201) {
          return { success: true, statusCode: response.status, attempts: attempt };
        }

        // 4xx = 재시도 불필요
        if (response.status >= 400 && response.status < 500) {
          const errorText = await response.text().catch(() => '');
          return { success: false, statusCode: response.status, attempts: attempt, error: errorText.slice(0, 500) };
        }

        // 5xx = 재시도
        this.logger.warn(`Bundle send attempt ${attempt}/${maxRetries} got ${response.status}`);
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.warn(`Bundle send attempt ${attempt}/${maxRetries} failed: ${msg}`);
        if (attempt === maxRetries) {
          return { success: false, attempts: attempt, error: msg };
        }
      }

      // Exponential backoff
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }

    return { success: false, attempts: maxRetries, error: 'Max retries exceeded' };
  }

  // ═══════════════════════════════════════════════
  // Phase 3: Bundle 수신 + 환자 매칭 + 데이터 이관
  // ═══════════════════════════════════════════════

  /** 외부 FHIR Bundle 수신 처리 */
  async receiveBundle(bundle: Record<string, unknown>, sourceClientId?: string) {
    if (bundle.resourceType !== 'Bundle') {
      throw new BadRequestException('Invalid FHIR Bundle');
    }

    const entries: BundleEntry[] = (bundle.entry ?? []) as BundleEntry[];
    if (entries.length === 0) {
      throw new BadRequestException('Empty Bundle');
    }

    // 리소스별 분류
    const resources = this.classifyBundleEntries(entries);

    // 환자 매칭/등록
    const patient = await this.matchOrCreatePatient(resources.patient, sourceClientId);

    // 진료 데이터 이관
    const importResult = await this.importClinicalData(patient.id, resources);

    // TransferRecord 생성 (수신)
    const selfOrg = await this.prisma.organization.findFirst({ where: { isSelf: true } });
    const sourceOrg = sourceClientId
      ? await this.prisma.smartClient.findUnique({ where: { clientId: sourceClientId }, select: { orgId: true } })
      : null;

    let transferRecord = null;
    if (selfOrg) {
      transferRecord = await this.prisma.transferRecord.create({
        data: {
          patientId: patient.id,
          fromOrgId: sourceOrg?.orgId ?? selfOrg.id,
          toOrgId: selfOrg.id,
          transferType: 'INCOMING_REFERRAL',
          status: 'REQUESTED',
          urgency: this.extractUrgency(resources.serviceRequest),
          reason: this.extractReason(resources.composition, resources.serviceRequest),
          // 수신 자료 보존 — 이 값이 없으면 전원 상세의 진단·투약 섹션이 조용히 사라진다(P1-ⓑ)
          diagnoses: importResult.receivedDiagnoses.length ? (importResult.receivedDiagnoses as any) : undefined,
          medications: importResult.receivedMedications.length ? (importResult.receivedMedications as any) : undefined,
          allergies: importResult.receivedAllergies.length ? (importResult.receivedAllergies as any) : undefined,
          fhirBundle: bundle as any,
          fhirBundleId: (bundle as any).id ?? null,
        },
        include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
      });
    }

    // 로그 문구도 사실대로 — 진단·투약·알레르기 모두 '수신 보존'이다(원내 목록 자동 편입 없음)
    this.logger.log(`Bundle received: patient=${patient.id}, diagnoses(보존)=${importResult.conditions}, meds(보존)=${importResult.medications}, allergies(보존)=${importResult.allergies}`);

    return {
      transferRecord,
      patient,
      importResult,
    };
  }

  /** Bundle 엔트리를 리소스 타입별로 분류 */
  private classifyBundleEntries(entries: BundleEntry[]) {
    const result: {
      composition: Record<string, unknown> | null;
      patient: Record<string, unknown> | null;
      conditions: Record<string, unknown>[];
      medications: Record<string, unknown>[];
      allergies: Record<string, unknown>[];
      observations: Record<string, unknown>[];
      serviceRequest: Record<string, unknown> | null;
      organizations: Record<string, unknown>[];
    } = {
      composition: null, patient: null, conditions: [], medications: [],
      allergies: [], observations: [], serviceRequest: null, organizations: [],
    };

    for (const entry of entries) {
      const r = entry.resource;
      if (!r?.resourceType) continue;
      switch (r.resourceType) {
        case 'Composition': result.composition = r; break;
        case 'Patient': result.patient = r; break;
        case 'Condition': result.conditions.push(r); break;
        case 'MedicationRequest': result.medications.push(r); break;
        case 'AllergyIntolerance': result.allergies.push(r); break;
        case 'Observation': result.observations.push(r); break;
        case 'ServiceRequest': result.serviceRequest = r; break;
        case 'Organization': result.organizations.push(r); break;
      }
    }

    return result;
  }

  /** 환자 매칭 — MRN/이름+생년월일 기반 */
  private async matchOrCreatePatient(
    fhirPatient: Record<string, unknown> | null,
    sourceClientId?: string,
  ) {
    if (!fhirPatient) throw new BadRequestException('Bundle에 Patient 리소스가 없습니다');

    const identifiers = (fhirPatient.identifier ?? []) as Array<{ system?: string; value?: string }>;
    const names = (fhirPatient.name ?? []) as Array<{ family?: string; given?: string[] }>;
    const birthDate = fhirPatient.birthDate as string | undefined;
    const gender = (fhirPatient.gender as string)?.toUpperCase();

    // 1. MRN으로 매칭
    const mrnId = identifiers.find(id => id.system?.includes('mrn') || id.system?.includes('MRN'));
    if (mrnId?.value) {
      const existing = await this.prisma.patient.findFirst({ where: { mrn: mrnId.value } });
      if (existing) {
        this.logger.log(`Patient matched by MRN: ${mrnId.value} → ${existing.id}`);
        return existing;
      }
    }

    // 2. 이름 + 생년월일로 매칭
    const familyName = names[0]?.family;
    const givenName = names[0]?.given?.[0];
    if (familyName && givenName && birthDate) {
      const dob = new Date(birthDate);
      const existing = await this.prisma.patient.findFirst({
        where: { familyName, givenName, dateOfBirth: dob },
      });
      if (existing) {
        this.logger.log(`Patient matched by name+DOB → ${existing.id}`); // PHI: 이름 미기록
        return existing;
      }
    }

    // 3. 매칭 실패 → 신규 등록
    const newMrn = `TRF-${Date.now().toString(36).toUpperCase()}`;
    const patient = await this.prisma.patient.create({
      data: {
        mrn: newMrn,
        familyName: familyName ?? '미확인',
        givenName: givenName ?? '',
        dateOfBirth: birthDate ? new Date(birthDate) : new Date('1900-01-01'),
        gender: gender === 'MALE' || gender === 'FEMALE' ? gender : 'UNKNOWN',
        patientSource: 'TRANSFER_IN',
        externalPatientId: (fhirPatient.id as string) ?? null,
        phone: this.extractTelecom(fhirPatient, 'phone'),
        email: this.extractTelecom(fhirPatient, 'email'),
      } as any,
    });

    this.logger.log(`New patient created from transfer: ${patient.id} (MRN: ${newMrn})`);
    return patient;
  }

  /** 임상 데이터 이관 */
  private async importClinicalData(
    patientId: string,
    resources: ReturnType<typeof this.classifyBundleEntries>,
  ) {
    let conditions = 0, medications = 0, allergies = 0;
    // 🔴 종전엔 진단·투약을 **세기만 하고 저장하지 않으면서** `conditions=N, meds=N` 을 반환·로깅했다.
    //    전원 온 환자의 진단·복약력이 어느 화면에도 없는데 시스템은 "이관됨"이라 말한 것이다(2026-08-13 W6).
    //    타원 자료를 원내 활성 처방·문제목록으로 자동 편입하면 임상 내용을 날조하는 것이므로,
    //    **수신 자료 그대로 TransferRecord 에 보존**한다(전원 상세 화면이 이 값을 읽는다).
    const receivedDiagnoses: { code?: string; system?: string; text: string; onsetDateTime?: string }[] = [];
    const receivedMedications: { text: string; dosage?: string; status?: string }[] = [];
    const receivedAllergies: { name: string; severity: string; category?: string; criticality?: string }[] = [];

    // Conditions → 수신 자료로 보존
    for (const cond of resources.conditions) {
      const codeObj = cond.code as FhirCodeableConcept | undefined;
      const code = codeObj?.coding?.[0];
      const text = codeObj?.text ?? code?.display ?? '';
      if (text) {
        receivedDiagnoses.push({
          code: code?.code, system: code?.system, text,
          onsetDateTime: (cond.onsetDateTime as string) ?? undefined,
        });
        conditions++;
      }
    }

    // Allergies → 수신 자료로 보존
    // 🔴 (2026-09-15) 종전엔 `allergy.create({ recordedBy: patientId })` 로 원내 알레르기 목록에 직접 넣었다 — recordedBy 는
    //    users(id) 외래키라 **환자 id 는 항상 FK 위반**이었고 `catch { /* skip */ }` 가 삼켜, 전원 받은 환자의 알레르기가
    //    어디에도 남지 않았다(운영 실측: 전원 수신 알레르기 0행). 이 경로는 기관 간 자동 수신이라 기록할 직원이 없다.
    //    진단·투약과 같이 **수신 자료 그대로 TransferRecord.allergies 에 보존**하고, 원내 알레르기 목록 편입은 직원 확인 몫으로 둔다.
    for (const allergy of resources.allergies) {
      const allergyCode = allergy.code as FhirCodeableConcept | undefined;
      const allergen = allergyCode?.text ?? allergyCode?.coding?.[0]?.display ?? '';
      const category = ((allergy.category as string[]) ?? [])[0];
      const criticality = allergy.criticality as string | undefined;
      if (allergen) {
        receivedAllergies.push({
          name: allergen,
          // 수신 criticality 원문을 그대로 둔다(high/low/unable-to-assess) — 원내 중증도 어휘로 번역해 판정하지 않는다
          severity: criticality ?? '',
          category,
          criticality,
        });
        allergies++;
      }
    }

    // Medications → 수신 자료로 보존(원내 활성 처방으로 만들지 않는다 — 임상 판단이 필요한 행위)
    for (const med of resources.medications) {
      const medConcept = med.medicationCodeableConcept as FhirCodeableConcept | undefined;
      const medName = medConcept?.text ?? '';
      if (medName) {
        const dosage = Array.isArray(med.dosageInstruction)
          ? ((med.dosageInstruction as Record<string, unknown>[])[0]?.text as string | undefined)
          : undefined;
        receivedMedications.push({ text: medName, dosage, status: med.status as string | undefined });
        medications++;
      }
    }

    return { conditions, medications, allergies, receivedDiagnoses, receivedMedications, receivedAllergies };
  }

  private extractTelecom(patient: Record<string, unknown>, system: string): string | undefined {
    const telecoms = (patient.telecom ?? []) as Array<{ system?: string; value?: string }>;
    return telecoms.find(t => t.system === system)?.value;
  }

  private extractUrgency(serviceRequest: Record<string, unknown> | null): string {
    if (!serviceRequest) return 'ROUTINE';
    const priority = (serviceRequest.priority as string)?.toUpperCase();
    if (priority === 'STAT' || priority === 'EMERGENT') return 'EMERGENT';
    if (priority === 'URGENT') return 'URGENT';
    return 'ROUTINE';
  }

  private extractReason(
    composition: Record<string, unknown> | null,
    serviceRequest: Record<string, unknown> | null,
  ): string {
    // Composition의 전원 사유 섹션
    const sections = (composition?.section ?? []) as Array<{ title?: string; text?: { div?: string } }>;
    const reasonSection = sections.find(s => s.title?.includes('전원') || s.title?.includes('reason'));
    if (reasonSection?.text?.div) return reasonSection.text.div;

    // ServiceRequest의 reasonCode
    const reasons = (serviceRequest?.reasonCode ?? []) as Array<{ text?: string }>;
    if (reasons[0]?.text) return reasons[0].text;

    return '외부 전원 수신';
  }

  // ═══════════════════════════════════════════════
  // Phase 3: 통계
  // ═══════════════════════════════════════════════

  async getStats() {
    const [total, byStatus, byType, byOrg, recentMonth] = await Promise.all([
      this.prisma.transferRecord.count(),
      this.prisma.transferRecord.groupBy({ by: ['status'], _count: true }),
      this.prisma.transferRecord.groupBy({ by: ['transferType'], _count: true }),
      this.prisma.transferRecord.findMany({
        select: { toOrg: { select: { name: true } }, fromOrg: { select: { name: true } }, transferType: true },
      }),
      this.prisma.transferRecord.count({
        where: { requestedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    const orgCounts: Record<string, number> = {};
    byOrg.forEach(t => {
      const name = t.transferType === 'OUTGOING_REFERRAL' ? t.toOrg.name : t.fromOrg.name;
      orgCounts[name] = (orgCounts[name] ?? 0) + 1;
    });

    return {
      total,
      recentMonth,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
      byType: Object.fromEntries(byType.map(t => [t.transferType, t._count])),
      topOrgs: Object.entries(orgCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }

  // ═══════════════════════════════════════════════
  // Bundle 생성
  // ═══════════════════════════════════════════════

  async generateBundle(id: string) {
    const record = await this.prisma.transferRecord.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromOrg: true, toOrg: true },
    });
    if (!record) return;

    /**
     * 🔴 알레르기 조회 실패를 `[]` 로 접으면 **수신 기관이 "알레르기 없음"으로 읽는다**(2026-08-21).
     *    문서 번들에서 AllergyIntolerance 가 하나도 없는 것과 조회에 실패한 것은 다른 사실이다.
     *    실패하면 목록을 비우되 **그 사실을 문서 안에 적는다**(Composition 섹션 + meta).
     */
    const allergyRes = await this.prisma.allergy.findMany({
      where: { patientId: record.patientId },
    }).then((v) => ({ ok: true as const, v })).catch((e) => {
      this.logger.error(`전원 번들 알레르기 조회 실패 transfer=${id}: ${(e as Error).message}`);
      return { ok: false as const, v: [] as Awaited<ReturnType<typeof this.prisma.allergy.findMany>> };
    });
    const allergies = allergyRes.v;
    /** 조회 실패로 **비어 있는** 섹션 — 없어서 빈 것과 구분한다 */
    const unavailableSections = [
      ...(allergyRes.ok ? [] : ['allergies']),
      ...(record.diagnoses === null ? ['diagnoses'] : []),
      ...(record.medications === null ? ['medications'] : []),
    ];

    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      timestamp: new Date().toISOString(),
      entry: [
        {
          resource: {
            resourceType: 'Composition',
            status: 'final',
            type: { coding: [{ system: 'http://loinc.org', code: '18761-7', display: 'Transfer summary note' }] },
            title: `전원 의뢰서 — ${record.patient.familyName}${record.patient.givenName}`,
            date: new Date().toISOString(),
            subject: { reference: `Patient/${record.patient.fhirId ?? record.patient.id}` },
            section: [
              { title: '전원 사유', text: { div: record.reason } },
              { title: '임상 요약', text: { div: record.clinicalSummary ?? '' } },
              // 🔴 비어 있는 이유를 문서가 밝힌다 — 없는 것이 아니라 **모르는 것**이다
              ...(unavailableSections.length ? [{
                title: '조회 실패 섹션(미상)',
                text: { div: `${unavailableSections.map((s) => SECTION_LABEL[s] ?? s).join(', ')} — 송신 기관에서 조회에 실패해 이 문서에 담기지 않았습니다. **없음으로 읽지 마십시오.**` },
              }] : []),
            ],
          },
        },
        {
          resource: {
            resourceType: 'Patient',
            id: record.patient.fhirId ?? record.patient.id,
            identifier: [{ system: 'urn:hospital-run:mrn', value: record.patient.mrn }],
            name: [
              { family: record.patient.familyName, given: [record.patient.givenName] },
              ...(record.patient.nameEn ? [{ family: record.patient.nameEn.split(' ').pop(), given: [record.patient.nameEn.split(' ')[0]], use: 'official' }] : []),
            ],
            gender: record.patient.gender?.toLowerCase(),
            birthDate: record.patient.dateOfBirth?.toISOString().slice(0, 10),
            telecom: record.patient.phone ? [{ system: 'phone', value: record.patient.phone }] : [],
          },
        },
        { resource: { resourceType: 'Organization', id: record.fromOrg.id, name: record.fromOrg.name, identifier: [{ system: 'urn:hira:org', value: record.fromOrg.code }] } },
        { resource: { resourceType: 'Organization', id: record.toOrg.id, name: record.toOrg.name, identifier: [{ system: 'urn:hira:org', value: record.toOrg.code }] } },
        {
          resource: {
            resourceType: 'ServiceRequest',
            status: 'active',
            intent: 'order',
            priority: record.urgency?.toLowerCase(),
            category: [{ text: record.transferType }],
            reasonCode: [{ text: record.reason }],
            subject: { reference: `Patient/${record.patient.id}` },
            requester: { reference: `Organization/${record.fromOrg.id}` },
            performer: [{ reference: `Organization/${record.toOrg.id}` }],
          },
        },
      ] as Array<{ resource: Record<string, unknown> }>,
      meta: {
        transferId: record.id, generatedAt: new Date().toISOString(),
        // 기계 판독용 — 빈 섹션이 '없음'인지 '미상'인지 수신 시스템이 구분할 수 있게 한다
        unavailableSections,
      },
    };

    // 🔴 (2026-09-15 P11) 종전엔 `{code, name}` 을 가정해 송신 스냅샷(EncounterDiagnosis·Prescription 행)에서
    //    code·text 가 전부 비어 나갔다. 읽기 정본(transfer-clinical-view)을 지난다. 이름이 없으면 빈 문자열이 아니라
    //    '원문 없음' — 수신 측이 빈 개념을 조용히 버리거나 "없음"으로 읽지 않게 한다(이름을 지어내지 않는다).
    const NO_SOURCE_TEXT = '원문 없음';
    const clinical = toTransferClinicalView(record);
    if (clinical.diagnoses) {
      (record.diagnoses as unknown[]).forEach((raw) => {
        const dx = toDiagnosisView(raw);
        const name = dx.nameKo ?? dx.nameEn;
        bundle.entry.push({
          resource: {
            resourceType: 'Condition',
            id: (raw as { id?: string } | null)?.id,
            code: {
              coding: dx.code ? [{ system: 'urn:oid:2.16.840.1.113883.6.256', code: dx.code, ...(name ? { display: name } : {}) }] : [],
              text: name ?? NO_SOURCE_TEXT,
            },
            subject: { reference: `Patient/${record.patient.id}` },
          },
        });
      });
    }

    if (clinical.medications) {
      for (const med of clinical.medications) {
        const name = med.nameKo ?? med.nameEn;
        bundle.entry.push({
          resource: {
            resourceType: 'MedicationRequest',
            // 🔴 종전엔 전부 'active' — 스냅샷에 남은 처방 상태로(DISCONTINUED → stopped · 모르면 unknown)
            status: fhirMedicationRequestStatus(med.status),
            intent: 'order',
            medicationCodeableConcept: { text: name ?? NO_SOURCE_TEXT },
            dosageInstruction: med.dosage ? [{ text: `${med.dosage} ${med.frequency ?? ''}`.trim() }] : [],
            subject: { reference: `Patient/${record.patient.id}` },
          },
        });
      }
    }

    for (const allergy of allergies) {
      bundle.entry.push({
        resource: {
          resourceType: 'AllergyIntolerance',
          clinicalStatus: { coding: [{ code: 'active' }] },
          type: allergy.type === 'DRUG' ? 'allergy' : 'intolerance',
          category: [allergy.type === 'FOOD' ? 'food' : 'medication'],
          code: { text: allergy.allergen },
          patient: { reference: `Patient/${record.patient.id}` },
          criticality: allergy.severity === 'SEVERE' ? 'high' : 'low',
        },
      });
    }

    await this.prisma.transferRecord.update({
      where: { id },
      data: { fhirBundle: bundle as any },
    });

    return bundle;
  }
}
