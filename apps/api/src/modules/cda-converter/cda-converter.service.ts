import { Injectable, Logger } from '@nestjs/common';

/**
 * CDA R2 ↔ FHIR R4 양방향 변환기
 *
 * 지원 문서 유형:
 * - TRSF: 진료의뢰서/회신서
 * - PRSC: 처방전
 * - DIAG: 진단서
 * - EXAM: 검사결과지
 * - IMAG: 영상 판독문
 * - DSCH: 퇴원요약서
 */

export interface CdaHeader {
  documentId: string;
  documentType: string;   // TRSF, PRSC, DIAG, EXAM, IMAG, DSCH
  title: string;
  createdAt: string;
  authorName: string;
  authorOrg: string;
  patientId: string;
  patientName: string;
  patientDob: string;
  patientGender: string;
}

export interface FhirBundleInput {
  resourceType: 'Bundle';
  id?: string;
  type: string;
  entry: Array<{ resource: Record<string, unknown> }>;
  [key: string]: unknown;
}

interface FhirCodeableConcept {
  coding?: Array<{ system?: string; code?: string; display?: string }>;
  text?: string;
}

interface FhirQuantity {
  value?: number;
  unit?: string;
}

interface FhirDosageInstruction {
  text?: string;
}

interface FhirSection {
  title?: string;
  text?: { div?: string };
}

const DOC_TYPE_MAP: Record<string, { loinc: string; display: string; title: string }> = {
  TRSF: { loinc: '18761-7', display: 'Transfer summary note', title: '진료의뢰서' },
  PRSC: { loinc: '57833-6', display: 'Prescriptions', title: '처방전' },
  DIAG: { loinc: '29308-4', display: 'Diagnosis', title: '진단서' },
  EXAM: { loinc: '11502-2', display: 'Laboratory report', title: '검사결과지' },
  IMAG: { loinc: '18748-4', display: 'Diagnostic imaging study', title: '영상판독문' },
  DSCH: { loinc: '18842-5', display: 'Discharge summary', title: '퇴원요약서' },
};

@Injectable()
export class CdaConverterService {
  private readonly logger = new Logger('CdaConverter');

  // ═══════════════════════════════════════
  // FHIR R4 → CDA R2
  // ═══════════════════════════════════════

  fhirToCda(bundle: FhirBundleInput, documentType: string): string {
    const entries = bundle.entry ?? [];
    const patient = entries.find(e => e.resource?.resourceType === 'Patient')?.resource;
    const composition = entries.find(e => e.resource?.resourceType === 'Composition')?.resource;
    const practitioner = entries.find(e => e.resource?.resourceType === 'Practitioner')?.resource;
    const organization = entries.find(e => e.resource?.resourceType === 'Organization')?.resource;

    const docInfo = DOC_TYPE_MAP[documentType] ?? DOC_TYPE_MAP.TRSF;
    const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
    const docId = bundle.id ?? `HR-${Date.now()}`;

    const patientName = this.extractFhirName(patient);
    const patientDob = (patient?.birthDate as string ?? '').replace(/-/g, '');
    const patientGender = (patient?.gender as string) === 'male' ? 'M' : (patient?.gender as string) === 'female' ? 'F' : 'UN';

    const authorName = this.extractFhirName(practitioner);
    const orgName = (organization?.name as string) ?? '병원';

    // CDA 본문 섹션 생성
    const sections = this.buildCdaSections(entries, documentType);

    const cda = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <realmCode code="KR"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.3.8101.10.1.1"/>
  <id root="2.16.840.1.113883.3.8101" extension="${docId}"/>
  <code code="${docInfo.loinc}" codeSystem="2.16.840.1.113883.6.1" displayName="${docInfo.display}"/>
  <title>${docInfo.title}</title>
  <effectiveTime value="${now}"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="ko-KR"/>

  <recordTarget>
    <patientRole>
      <id extension="${(patient?.id as string) ?? ''}" root="2.16.840.1.113883.3.8101.1"/>
      <patient>
        <name><family>${this.escapeXml(patientName.family)}</family><given>${this.escapeXml(patientName.given)}</given></name>
        <administrativeGenderCode code="${patientGender}" codeSystem="2.16.840.1.113883.5.1"/>
        <birthTime value="${patientDob}"/>
      </patient>
    </patientRole>
  </recordTarget>

  <author>
    <time value="${now}"/>
    <assignedAuthor>
      <id root="2.16.840.1.113883.3.8101.2"/>
      <assignedPerson><name><family>${this.escapeXml(authorName.family)}</family><given>${this.escapeXml(authorName.given)}</given></name></assignedPerson>
      <representedOrganization><name>${this.escapeXml(orgName)}</name></representedOrganization>
    </assignedAuthor>
  </author>

  <custodian>
    <assignedCustodian>
      <representedCustodianOrganization>
        <name>${this.escapeXml(orgName)}</name>
      </representedCustodianOrganization>
    </assignedCustodian>
  </custodian>

  <component>
    <structuredBody>
${sections}
    </structuredBody>
  </component>
</ClinicalDocument>`;

    this.logger.log(`FHIR→CDA conversion: ${documentType}`); // PHI: 환자명 미기록
    return cda;
  }

  // ═══════════════════════════════════════
  // CDA R2 → FHIR R4
  // ═══════════════════════════════════════

  cdaToFhir(cdaXml: string): FhirBundleInput {
    const header = this.parseCdaHeader(cdaXml);
    const sections = this.parseCdaSections(cdaXml);

    const entries: Array<{ resource: Record<string, unknown> }> = [];

    // Composition
    const docInfo = DOC_TYPE_MAP[header.documentType] ?? DOC_TYPE_MAP.TRSF;
    entries.push({
      resource: {
        resourceType: 'Composition',
        id: header.documentId,
        status: 'final',
        type: { coding: [{ system: 'http://loinc.org', code: docInfo.loinc, display: docInfo.display }] },
        title: header.title,
        date: header.createdAt,
        author: [{ display: header.authorName }],
        section: sections.map(s => ({
          title: s.title,
          text: { div: s.text },
        })),
      },
    });

    // Patient
    entries.push({
      resource: {
        resourceType: 'Patient',
        id: header.patientId,
        name: [{ family: header.patientName.split('').slice(0, 1).join(''), given: [header.patientName.slice(1)] }],
        birthDate: header.patientDob ? this.formatDate(header.patientDob) : undefined,
        gender: header.patientGender === 'M' ? 'male' : header.patientGender === 'F' ? 'female' : 'unknown',
      },
    });

    // Organization
    if (header.authorOrg) {
      entries.push({
        resource: { resourceType: 'Organization', name: header.authorOrg },
      });
    }

    // 섹션별 리소스 추출
    for (const section of sections) {
      const resources = this.sectionToFhirResources(section, header.patientId);
      entries.push(...resources);
    }

    this.logger.log(`CDA→FHIR conversion: ${header.documentType}, ${entries.length} resources`);

    return {
      resourceType: 'Bundle',
      type: 'document',
      timestamp: new Date().toISOString(),
      entry: entries,
    };
  }

  // ═══════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════

  private extractFhirName(resource: Record<string, unknown> | undefined): { family: string; given: string } {
    if (!resource) return { family: '', given: '' };
    const names = (resource.name ?? []) as Array<{ family?: string; given?: string[] }>;
    return { family: names[0]?.family ?? '', given: names[0]?.given?.[0] ?? '' };
  }

  private buildCdaSections(entries: Array<{ resource: Record<string, unknown> }>, documentType: string): string {
    const lines: string[] = [];

    // Conditions
    const conditions = entries.filter(e => e.resource?.resourceType === 'Condition');
    if (conditions.length > 0) {
      lines.push(this.wrapSection('진단', conditions.map(c => {
        const codeObj = c.resource.code as FhirCodeableConcept | undefined;
        const coding = codeObj?.coding?.[0];
        return `${this.escapeXml(coding?.code ?? '')} ${this.escapeXml(coding?.display ?? codeObj?.text ?? '')}`;
      }).join('<br/>')));
    }

    // MedicationRequests
    const meds = entries.filter(e => e.resource?.resourceType === 'MedicationRequest');
    if (meds.length > 0) {
      lines.push(this.wrapSection('투약', meds.map(m => {
        const medConcept = m.resource.medicationCodeableConcept as FhirCodeableConcept | undefined;
        const dosages = m.resource.dosageInstruction as FhirDosageInstruction[] | undefined;
        return `${this.escapeXml(medConcept?.text ?? '')} ${this.escapeXml(dosages?.[0]?.text ?? '')}`;
      }).join('<br/>')));
    }

    // Observations
    const obs = entries.filter(e => e.resource?.resourceType === 'Observation');
    if (obs.length > 0) {
      lines.push(this.wrapSection('검사결과', obs.map(o => {
        const codeObj = o.resource.code as FhirCodeableConcept | undefined;
        const qty = o.resource.valueQuantity as FhirQuantity | undefined;
        const value = qty ? `${qty.value} ${qty.unit ?? ''}` : (o.resource.valueString as string) ?? '';
        return `${this.escapeXml(codeObj?.text ?? '')}: ${this.escapeXml(value)}`;
      }).join('<br/>')));
    }

    // AllergyIntolerances
    const allergies = entries.filter(e => e.resource?.resourceType === 'AllergyIntolerance');
    if (allergies.length > 0) {
      lines.push(this.wrapSection('알레르기', allergies.map(a => {
        const allergyCode = a.resource.code as FhirCodeableConcept | undefined;
        return `${this.escapeXml(allergyCode?.text ?? '')} (${this.escapeXml(String(a.resource.criticality ?? ''))})`;
      }).join('<br/>')));
    }

    // ServiceRequest (전원 사유)
    const sr = entries.find(e => e.resource?.resourceType === 'ServiceRequest');
    if (sr) {
      const reasonCodes = (sr.resource.reasonCode ?? []) as FhirCodeableConcept[];
      const reason = reasonCodes[0]?.text ?? '';
      if (reason) lines.push(this.wrapSection('전원 사유', this.escapeXml(reason)));
    }

    // Composition 본문
    const comp = entries.find(e => e.resource?.resourceType === 'Composition');
    if (comp) {
      const sections = (comp.resource.section ?? []) as FhirSection[];
      for (const s of sections) {
        if (s.text?.div && s.title && !lines.some(l => l.includes(s.title!))) {
          lines.push(this.wrapSection(s.title, this.escapeXml(s.text.div)));
        }
      }
    }

    if (lines.length === 0) {
      lines.push(this.wrapSection(DOC_TYPE_MAP[documentType]?.title ?? '문서', '내용 없음'));
    }

    return lines.join('\n');
  }

  private wrapSection(title: string, content: string): string {
    return `      <component>
        <section>
          <title>${this.escapeXml(title)}</title>
          <text>${content}</text>
        </section>
      </component>`;
  }

  /** 간이 CDA 헤더 파서 (정규식 기반 — 프로덕션에서는 XML 파서 사용) */
  parseCdaHeader(cdaXml: string): CdaHeader {
    const getTag = (tag: string) => {
      const match = cdaXml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 's'));
      return match?.[1]?.trim() ?? '';
    };
    const getAttr = (tag: string, attr: string) => {
      const match = cdaXml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 's'));
      return match?.[1] ?? '';
    };

    // Document type from LOINC code
    const loincCode = getAttr('code', 'code');
    const docType = Object.entries(DOC_TYPE_MAP).find(([, v]) => v.loinc === loincCode)?.[0] ?? 'TRSF';

    // Patient info
    const patientBlock = cdaXml.match(/<recordTarget>[\s\S]*?<\/recordTarget>/)?.[0] ?? '';
    const patientFamily = patientBlock.match(/<family>([^<]*)<\/family>/)?.[1] ?? '';
    const patientGiven = patientBlock.match(/<given>([^<]*)<\/given>/)?.[1] ?? '';
    const patientDob = patientBlock.match(/<birthTime[^>]*value="([^"]*)"/)?.[1] ?? '';
    const patientGender = patientBlock.match(/<administrativeGenderCode[^>]*code="([^"]*)"/)?.[1] ?? 'UN';
    const patientId = patientBlock.match(/<id[^>]*extension="([^"]*)"/)?.[1] ?? '';

    // Author
    const authorBlock = cdaXml.match(/<author>[\s\S]*?<\/author>/)?.[0] ?? '';
    const authorFamily = authorBlock.match(/<family>([^<]*)<\/family>/)?.[1] ?? '';
    const authorGiven = authorBlock.match(/<given>([^<]*)<\/given>/)?.[1] ?? '';
    const authorOrg = authorBlock.match(/<representedOrganization>[\s\S]*?<name>([^<]*)<\/name>/)?.[1] ?? '';

    return {
      documentId: getAttr('id', 'extension') || `CDA-${Date.now()}`,
      documentType: docType,
      title: getTag('title'),
      createdAt: this.formatDate(getAttr('effectiveTime', 'value')),
      authorName: `${authorFamily}${authorGiven}`,
      authorOrg,
      patientId,
      patientName: `${patientFamily}${patientGiven}`,
      patientDob,
      patientGender,
    };
  }

  /** CDA 섹션 파싱 */
  parseCdaSections(cdaXml: string): Array<{ title: string; text: string }> {
    const sections: Array<{ title: string; text: string }> = [];
    const sectionRegex = /<section>\s*<title>([^<]*)<\/title>\s*<text>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = sectionRegex.exec(cdaXml)) !== null) {
      sections.push({ title: match[1].trim(), text: match[2].trim() });
    }
    return sections;
  }

  /** 섹션 내용을 FHIR 리소스로 변환 */
  private sectionToFhirResources(section: { title: string; text: string }, patientId: string): Array<{ resource: Record<string, unknown> }> {
    const resources: Array<{ resource: Record<string, unknown> }> = [];
    const items = section.text.split(/<br\s*\/?>/);

    if (section.title.includes('진단') || section.title.includes('Diagnosis')) {
      for (const item of items) {
        const trimmed = item.replace(/<[^>]+>/g, '').trim();
        if (!trimmed) continue;
        const [code, ...rest] = trimmed.split(' ');
        resources.push({
          resource: {
            resourceType: 'Condition',
            code: { coding: [{ system: 'urn:oid:2.16.840.1.113883.6.256', code, display: rest.join(' ') }], text: trimmed },
            subject: { reference: `Patient/${patientId}` },
          },
        });
      }
    }

    if (section.title.includes('투약') || section.title.includes('Medication')) {
      for (const item of items) {
        const trimmed = item.replace(/<[^>]+>/g, '').trim();
        if (!trimmed) continue;
        resources.push({
          resource: {
            resourceType: 'MedicationRequest',
            status: 'active', intent: 'order',
            medicationCodeableConcept: { text: trimmed },
            subject: { reference: `Patient/${patientId}` },
          },
        });
      }
    }

    if (section.title.includes('알레르기') || section.title.includes('Allergy')) {
      for (const item of items) {
        const trimmed = item.replace(/<[^>]+>/g, '').trim();
        if (!trimmed) continue;
        resources.push({
          resource: {
            resourceType: 'AllergyIntolerance',
            code: { text: trimmed },
            patient: { reference: `Patient/${patientId}` },
          },
        });
      }
    }

    return resources;
  }

  private formatDate(raw: string): string {
    if (!raw || raw.length < 8) return raw;
    const clean = raw.replace(/[-:T]/g, '');
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }

  private escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
