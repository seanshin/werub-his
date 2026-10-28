import { describe, it, expect, beforeEach } from 'vitest';
import { CdaConverterService } from '../../src/modules/cda-converter/cda-converter.service';

describe('CdaConverterService', () => {
  let service: CdaConverterService;

  beforeEach(() => {
    service = new CdaConverterService();
  });

  describe('fhirToCda', () => {
    const sampleBundle = {
      resourceType: 'Bundle' as const,
      type: 'document',
      id: 'test-bundle-001',
      entry: [
        { resource: { resourceType: 'Composition', status: 'final', title: '전원 의뢰서', section: [{ title: '전원 사유', text: { div: '상급 병원 치료 필요' } }] } },
        { resource: { resourceType: 'Patient', id: 'patient-001', name: [{ family: '김', given: ['환자'] }], gender: 'male', birthDate: '1990-03-15' } },
        { resource: { resourceType: 'Organization', name: '우리병원' } },
        { resource: { resourceType: 'Practitioner', name: [{ family: '이', given: ['의사'] }] } },
        { resource: { resourceType: 'Condition', code: { coding: [{ system: 'urn:oid:2.16.840.1.113883.6.256', code: 'J06.9', display: '급성 상기도감염' }], text: '급성 상기도감염' }, subject: { reference: 'Patient/patient-001' } } },
        { resource: { resourceType: 'MedicationRequest', status: 'active', intent: 'order', medicationCodeableConcept: { text: '아스피린 100mg' }, dosageInstruction: [{ text: '1일 1회' }], subject: { reference: 'Patient/patient-001' } } },
        { resource: { resourceType: 'AllergyIntolerance', code: { text: '페니실린' }, criticality: 'high', patient: { reference: 'Patient/patient-001' } } },
      ],
    };

    it('FHIR Bundle → CDA R2 변환 성공', () => {
      const cda = service.fhirToCda(sampleBundle, 'TRSF');

      expect(cda).toContain('<?xml version="1.0"');
      expect(cda).toContain('ClinicalDocument');
      expect(cda).toContain('realmCode code="KR"');
      expect(cda).toContain('18761-7'); // Transfer summary LOINC
    });

    it('환자 정보 포함', () => {
      const cda = service.fhirToCda(sampleBundle, 'TRSF');

      expect(cda).toContain('<family>김</family>');
      expect(cda).toContain('<given>환자</given>');
      expect(cda).toContain('code="M"'); // gender
      expect(cda).toContain('19900315'); // birthdate
    });

    it('진단/투약/알레르기 섹션 포함', () => {
      const cda = service.fhirToCda(sampleBundle, 'TRSF');

      expect(cda).toContain('진단');
      expect(cda).toContain('J06.9');
      expect(cda).toContain('투약');
      expect(cda).toContain('아스피린');
      expect(cda).toContain('알레르기');
      expect(cda).toContain('페니실린');
    });

    it('[보안] 환자명·진단 특수문자 XSS/XML 이스케이프', () => {
      const malicious = {
        resourceType: 'Bundle' as const, type: 'document', id: 'b',
        entry: [
          { resource: { resourceType: 'Composition', status: 'final', title: 'x', section: [] } },
          { resource: { resourceType: 'Patient', id: 'p', name: [{ family: '<script>', given: ['A&B'] }], gender: 'male', birthDate: '1990-01-01' } },
          { resource: { resourceType: 'Condition', code: { text: '<injected>tag</injected>' } } },
        ],
      };
      const cda = service.fhirToCda(malicious as any, 'TRSF');
      // 원시 태그/앰퍼샌드가 그대로 들어가지 않고 이스케이프됨
      expect(cda).not.toContain('<script>');
      expect(cda).toContain('&lt;script&gt;');
      expect(cda).toContain('A&amp;B');
      expect(cda).not.toContain('<injected>');
    });

    it('문서 유형별 LOINC 코드', () => {
      const cdaDiag = service.fhirToCda(sampleBundle, 'DIAG');
      expect(cdaDiag).toContain('29308-4'); // Diagnosis LOINC

      const cdaDsch = service.fhirToCda(sampleBundle, 'DSCH');
      expect(cdaDsch).toContain('18842-5'); // Discharge summary
    });

    it('의사/기관 정보 포함', () => {
      const cda = service.fhirToCda(sampleBundle, 'TRSF');

      expect(cda).toContain('우리병원');
      expect(cda).toContain('<family>이</family>');
    });
  });

  describe('cdaToFhir', () => {
    const sampleCda = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <id root="2.16.840.1.113883.3.8101" extension="CDA-TEST-001"/>
  <code code="18761-7" codeSystem="2.16.840.1.113883.6.1" displayName="Transfer summary note"/>
  <title>진료의뢰서</title>
  <effectiveTime value="20260601"/>
  <recordTarget>
    <patientRole>
      <id extension="patient-ext-001" root="2.16.840.1.113883.3.8101.1"/>
      <patient>
        <name><family>박</family><given>환자</given></name>
        <administrativeGenderCode code="F" codeSystem="2.16.840.1.113883.5.1"/>
        <birthTime value="19850515"/>
      </patient>
    </patientRole>
  </recordTarget>
  <author>
    <time value="20260601"/>
    <assignedAuthor>
      <assignedPerson><name><family>최</family><given>의사</given></name></assignedPerson>
      <representedOrganization><name>가상대병원</name></representedOrganization>
    </assignedAuthor>
  </author>
  <component>
    <structuredBody>
      <component><section><title>진단</title><text>J06.9 급성 상기도감염<br/>I10 본태성 고혈압</text></section></component>
      <component><section><title>투약</title><text>아스피린 100mg 1일 1회<br/>암로디핀 5mg 1일 1회</text></section></component>
      <component><section><title>알레르기</title><text>페니실린 (high)</text></section></component>
    </structuredBody>
  </component>
</ClinicalDocument>`;

    it('CDA R2 → FHIR Bundle 변환 성공', () => {
      const bundle = service.cdaToFhir(sampleCda);

      expect(bundle.resourceType).toBe('Bundle');
      expect(bundle.type).toBe('document');
      expect(bundle.entry.length).toBeGreaterThan(0);
    });

    it('Composition 생성', () => {
      const bundle = service.cdaToFhir(sampleCda);
      const comp = bundle.entry.find(e => e.resource.resourceType === 'Composition');

      expect(comp).toBeDefined();
      expect(comp!.resource.title).toBe('진료의뢰서');
    });

    it('Patient 추출', () => {
      const bundle = service.cdaToFhir(sampleCda);
      const patient = bundle.entry.find(e => e.resource.resourceType === 'Patient');

      expect(patient).toBeDefined();
      expect((patient!.resource.name as any[])[0].family).toBe('박');
      expect(patient!.resource.gender).toBe('female');
    });

    it('Condition 리소스 생성 (진단)', () => {
      const bundle = service.cdaToFhir(sampleCda);
      const conditions = bundle.entry.filter(e => e.resource.resourceType === 'Condition');

      expect(conditions.length).toBe(2);
      expect((conditions[0].resource.code as any).coding[0].code).toBe('J06.9');
    });

    it('MedicationRequest 리소스 생성 (투약)', () => {
      const bundle = service.cdaToFhir(sampleCda);
      const meds = bundle.entry.filter(e => e.resource.resourceType === 'MedicationRequest');

      expect(meds.length).toBe(2);
    });

    it('AllergyIntolerance 리소스 생성', () => {
      const bundle = service.cdaToFhir(sampleCda);
      const allergies = bundle.entry.filter(e => e.resource.resourceType === 'AllergyIntolerance');

      expect(allergies.length).toBe(1);
      expect((allergies[0].resource.code as any).text).toContain('페니실린');
    });
  });

  describe('parseCdaHeader', () => {
    it('CDA 헤더 파싱', () => {
      const cda = `<ClinicalDocument xmlns="urn:hl7-org:v3">
        <id extension="DOC-001" root="test"/>
        <code code="18761-7" codeSystem="2.16.840.1.113883.6.1"/>
        <title>진료의뢰서</title>
        <effectiveTime value="20260601120000"/>
        <recordTarget><patientRole><id extension="P-001" root="test"/>
          <patient><name><family>김</family><given>환자</given></name>
          <administrativeGenderCode code="M" codeSystem="2.16.840.1.113883.5.1"/>
          <birthTime value="19900101"/></patient></patientRole></recordTarget>
        <author><time value="20260601"/><assignedAuthor>
          <assignedPerson><name><family>이</family><given>의사</given></name></assignedPerson>
          <representedOrganization><name>테스트병원</name></representedOrganization>
        </assignedAuthor></author>
      </ClinicalDocument>`;

      const header = service.parseCdaHeader(cda);

      expect(header.documentId).toBe('DOC-001');
      expect(header.documentType).toBe('TRSF');
      expect(header.title).toBe('진료의뢰서');
      expect(header.patientName).toBe('김환자');
      expect(header.patientGender).toBe('M');
      expect(header.authorName).toBe('이의사');
      expect(header.authorOrg).toBe('테스트병원');
    });
  });

  describe('양방향 변환 일관성', () => {
    it('FHIR → CDA → FHIR 왕복', () => {
      const originalBundle = {
        resourceType: 'Bundle' as const,
        type: 'document',
        entry: [
          { resource: { resourceType: 'Patient', id: 'p1', name: [{ family: '홍', given: ['길동'] }], gender: 'male', birthDate: '1975-08-20' } },
          { resource: { resourceType: 'Condition', code: { coding: [{ code: 'I10', display: '본태성 고혈압' }], text: '본태성 고혈압' }, subject: { reference: 'Patient/p1' } } },
        ],
      };

      const cda = service.fhirToCda(originalBundle, 'TRSF');
      const roundTrip = service.cdaToFhir(cda);

      // 환자 이름 보존
      const patient = roundTrip.entry.find(e => e.resource.resourceType === 'Patient');
      expect((patient!.resource.name as any[])[0].family).toBe('홍');

      // 진단 보존
      const conditions = roundTrip.entry.filter(e => e.resource.resourceType === 'Condition');
      expect(conditions.length).toBeGreaterThanOrEqual(1);
    });
  });
});
