import { Injectable } from '@nestjs/common';
import { fhirQuantity } from '@hospital-run/shared';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { fhirMedicationRequestStatus } from '../../common/fhir-medication-status';
import { fhirEncounterClass, fhirEncounterStatus, fhirEncounterStatusHistory } from '../../common/fhir-encounter';

@Injectable()
export class FhirFullService {
  constructor(private readonly prisma: PrismaService) {}

  async getEncounterAsResource(id: string) {
    const enc = await this.prisma.encounter.findUnique({ where: { id }, include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, doctor: true, diagnoses: { include: { diagnosisCode: true } } } });
    if (!enc) return null;
    return {
      resourceType: 'Encounter',
      id: enc.id,
      // 🔴 (2026-10-01) 종전 SIGNED 외 전부 in-progress — 정정(AMENDED)된 진료가 진행 중으로 나갔다. 정본으로.
      status: fhirEncounterStatus(enc.status),
      statusHistory: fhirEncounterStatusHistory(enc),
      class: fhirEncounterClass(enc),
      subject: { reference: `Patient/${enc.patientId}` },
      participant: [{ individual: { reference: `Practitioner/${enc.doctorId}`, display: `${enc.doctor.familyName}${enc.doctor.givenName}` } }],
      reasonCode: enc.diagnoses.map(d => ({ coding: [{ system: 'urn:oid:2.16.840.1.113883.6.256', code: d.diagnosisCode.code, display: d.diagnosisCode.nameKo }] })),
      period: { start: enc.createdAt.toISOString(), ...(enc.signedAt ? { end: enc.signedAt.toISOString() } : {}) },
    };
  }

  /** #7 흡연상태 FHIR Observation (LOINC 72166-2 Tobacco smoking status) — SNOMED CT value coding */
  async getSmokingStatusObservation(patientId: string) {
    const p = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true, smokingStatus: true, updatedAt: true } });
    if (!p) return null;
    const SNOMED: Record<string, { code: string; display: string }> = {
      CURRENT: { code: '449868002', display: 'Smokes tobacco daily' },
      FORMER: { code: '8517006', display: 'Ex-smoker' },
      NEVER: { code: '266919005', display: 'Never smoked tobacco' },
      UNKNOWN: { code: '266927001', display: 'Unknown if ever smoked' },
    };
    const v = SNOMED[p.smokingStatus ?? 'UNKNOWN'] ?? SNOMED.UNKNOWN;
    return {
      resourceType: 'Observation',
      id: `smoking-status-${p.id}`,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'social-history', display: 'Social History' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '72166-2', display: 'Tobacco smoking status' }] },
      subject: { reference: `Patient/${p.id}` },
      effectiveDateTime: (p.updatedAt ?? new Date()).toISOString(),
      valueCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code: v.code, display: v.display }], text: p.smokingStatus ?? 'UNKNOWN' },
    };
  }

  async getObservation(formSubmissionId: string) {
    const sub = await this.prisma.formSubmission.findUnique({ where: { id: formSubmissionId }, include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, formSchema: true } });
    if (!sub) return null;
    const data = (sub.data ?? {}) as Record<string, unknown>;
    return {
      resourceType: 'Bundle', type: 'collection',
      entry: Object.entries(data).map(([key, value]) => ({
        resource: {
          resourceType: 'Observation',
          id: `${sub.id}-${key}`,
          status: 'final',
          code: { text: key },
          subject: { reference: `Patient/${sub.patientId}` },
          // 🔴 폼 응답은 수치가 아닐 수 있다(선택지·서술·체크). 전부 valueQuantity 로 실으면
          //    FHIR Quantity.value(decimal) 규격 위반이라 외부 파서가 리소스를 통째로 버린다.
          ...this.formValue(value),
          effectiveDateTime: sub.submittedAt.toISOString(),
        },
      })),
    };
  }

  /** 폼 응답값 → FHIR value[x]. 수치=Quantity(단위 미상이라 unit 없음)·불리언=boolean·그 외=string. */
  private formValue(value: unknown): Record<string, unknown> {
    if (value == null) return {};
    if (typeof value === 'boolean') return { valueBoolean: value };
    const quantity = fhirQuantity(value);
    if (quantity) return { valueQuantity: quantity };
    if (typeof value === 'object') return { valueString: JSON.stringify(value) };
    return { valueString: String(value) };
  }

  async getMedicationRequest(prescriptionId: string) {
    const rx = await this.prisma.prescription.findUnique({ where: { id: prescriptionId }, include: { medicationCode: true, encounter: { select: { patientId: true, doctorId: true } } } });
    if (!rx || !rx.medicationCode) return null;
    return {
      resourceType: 'MedicationRequest',
      id: rx.id,
      status: fhirMedicationRequestStatus(rx.status),
      intent: 'order',
      medicationCodeableConcept: { coding: [{ system: 'urn:hospital-run:medication', code: rx.medicationCode.code, display: rx.medicationCode.nameKo }] },
      subject: { reference: `Patient/${rx.encounter?.patientId}` },
      requester: { reference: `Practitioner/${rx.encounter?.doctorId}` },
      dosageInstruction: [{ text: `${rx.dosage ?? ''} ${rx.frequency ?? ''} ${rx.duration ? rx.duration + '일' : ''}`.trim() }],
      authoredOn: rx.createdAt.toISOString(),
    };
  }
}
