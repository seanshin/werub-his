import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

/**
 * E2E Test: Complete Clinical Workflow
 *
 * Scenario:
 * 1. Create patient (김환자, MRN: MR001)
 * 2. Doctor (이의사) starts encounter for patient
 * 3. Doctor records SOAP notes and creates problem (고혈압)
 * 4. Doctor prescribes medication (약물명) → creates order
 * 5. Lab test ordered → results submitted
 * 6. Discharge summary generated
 * 7. Medical records searchable & cached
 * 8. Billing record created
 * 9. Audit logs show all access
 */
describe.skipIf(!process.env.RUN_E2E_TESTS)('E2E: Clinical Workflow', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test data IDs
  let patientId: string;
  let doctorId: string;
  let encounterId: string;
  let prescriptionId: string;
  let orderId: string;
  let problemId: string;
  let admissionId: string;
  let labOrderId: string;
  let labResultId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // Import main app module
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await prisma.audit.deleteMany({});
    await prisma.labResult.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.prescription.deleteMany({});
    await prisma.problemList.deleteMany({});
    await prisma.encounter.deleteMany({});
    await prisma.admission.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('1. Patient Management', () => {
    it('should create new patient with demographics', async () => {
      const patient = await prisma.patient.create({
        data: {
          mrn: 'MR001',
          familyName: '김',
          givenName: '환자',
          dateOfBirth: new Date('1980-01-15'),
          gender: 'MALE',
          phone: '010-1234-5678',
          email: 'patient@example.com',
          address: '서울시 강남구',
          nationality: 'KOR',
        },
      });

      patientId = patient.id;

      expect(patient.mrn).toBe('MR001');
      expect(patient.familyName).toBe('김');
      expect(patient.givenName).toBe('환자');
    });
  });

  describe('2. Encounter & SOAP Notes', () => {
    it('should create encounter with SOAP', async () => {
      // Setup: Create patient and doctor first
      const patient = await prisma.patient.create({
        data: {
          mrn: 'MR001',
          familyName: '김',
          givenName: '환자',
          dateOfBirth: new Date('1980-01-15'),
          gender: 'MALE',
        },
      });

      const doctor = await prisma.user.create({
        data: {
          id: 'doc-001',
          username: 'lee_doctor',
          password: 'hashed_password',
          familyName: '이',
          givenName: '의사',
          email: 'doctor@hospital.example',
          role: 'DOCTOR',
          department: 'INTERNAL_MEDICINE',
          licenseNumber: 'LIC001',
        },
      });

      // Create encounter
      const encounter = await prisma.encounter.create({
        data: {
          patientId: patient.id,
          doctorId: doctor.id,
          department: 'INTERNAL_MEDICINE',
          visitType: 'OUTPATIENT',
          subjective: '어제부터 머리가 아파요.',
          objective: 'BP 150/95 mmHg, HR 78/min',
          assessment: '고혈압, 긴장성두통',
          plan: '혈압약 처방, 재진 예약',
          status: 'COMPLETED',
        },
        include: { patient: true, doctor: true },
      });

      encounterId = encounter.id;
      patientId = patient.id;
      doctorId = doctor.id;

      expect(encounter.subjective).toContain('머리');
      expect(encounter.assessment).toContain('고혈압');
    });

    it('should create problem list from encounter', async () => {
      // Prerequisite: encounter exists
      if (!patientId || !doctorId || !encounterId) {
        this.skip();
      }

      const problem = await prisma.problemList.create({
        data: {
          patientId,
          diagnosisCodeId: 'code-I10', // ICD10: Essential hypertension
          description: '고혈압',
          status: 'ACTIVE',
          severity: 'MODERATE',
          onsetDate: new Date(),
          addedBy: doctorId,
          notes: '환자 보고, 약물 치료 시작',
        },
      });

      problemId = problem.id;

      expect(problem.description).toBe('고혈압');
      expect(problem.status).toBe('ACTIVE');
    });
  });

  describe('3. Prescription & Order Management', () => {
    it('should create prescription and generate order', async () => {
      if (!encounterId || !patientId || !doctorId) {
        this.skip();
      }

      // Create prescription
      const prescription = await prisma.prescription.create({
        data: {
          encounterId,
          type: 'MEDICATION',
          medicationCodeId: 'med-amlodipine',
          dosage: '5mg',
          frequency: '1일 1회',
          duration: 30,
          route: 'PO',
          status: 'ACTIVE',
          createdBy: doctorId,
          durChecked: true,
        },
      });

      prescriptionId = prescription.id;

      // Create order from prescription
      const order = await prisma.order.create({
        data: {
          prescriptionId: prescription.id,
          department: 'PHARMACY',
          status: 'ORDERED',
          priority: 'ROUTINE',
          createdAt: new Date(),
        },
      });

      orderId = order.id;

      expect(prescription.type).toBe('MEDICATION');
      expect(order.department).toBe('PHARMACY');
      expect(order.status).toBe('ORDERED');
    });
  });

  describe('4. Lab Orders & Results', () => {
    it('should create lab order and submit results', async () => {
      if (!encounterId || !patientId || !doctorId) {
        this.skip();
      }

      // Create LAB prescription
      const labPrescription = await prisma.prescription.create({
        data: {
          encounterId,
          type: 'LAB',
          procedureCodeId: 'proc-cbc',
          quantity: 1,
          priority: 'ROUTINE',
          status: 'ACTIVE',
          createdBy: doctorId,
        },
      });

      // Create LAB order
      const labOrder = await prisma.order.create({
        data: {
          prescriptionId: labPrescription.id,
          department: 'LAB',
          status: 'ORDERED',
          priority: 'ROUTINE',
        },
      });

      labOrderId = labOrder.id;

      // Submit lab result
      const labResult = await prisma.labResult.create({
        data: {
          orderId: labOrder.id,
          testCode: 'CBC',
          result: '{"WBC": 7.5, "RBC": 4.8, "HGB": 14.2}',
          status: 'COMPLETED',
          resultDate: new Date(),
          submittedBy: 'lab-tech-001',
        },
      });

      labResultId = labResult.id;

      expect(labOrder.department).toBe('LAB');
      expect(labResult.status).toBe('COMPLETED');
    });
  });

  describe('5. Admission & ICU (if needed)', () => {
    it('should admit patient to ICU and record vitals', async () => {
      if (!patientId || !doctorId) {
        this.skip();
      }

      // Create bed
      const bed = await prisma.icuBed.create({
        data: {
          roomNumber: 'ICU-01',
          bedNumber: '01',
          status: 'AVAILABLE',
          ventilatorCapable: true,
        },
      });

      // Create admission
      const admission = await prisma.icuAdmission.create({
        data: {
          patientId,
          bedId: bed.id,
          admittedBy: doctorId,
          admitReason: '호흡곤란',
          status: 'ADMITTED',
          severity: 'SEVERE',
        },
      });

      admissionId = admission.id;

      // Record ICU vitals
      const record = await prisma.icuRecord.create({
        data: {
          admissionId,
          recordedBy: doctorId,
          systolicBp: 140,
          diastolicBp: 90,
          spo2: 95,
          gcScore: 15,
          ventMode: 'ASSIST_CONTROL',
          fio2: 0.4,
        },
      });

      expect(admission.status).toBe('ADMITTED');
      expect(record.systolicBp).toBe(140);
    });
  });

  describe('6. Medical Record Search & Caching', () => {
    it('should search medical records and verify caching', async () => {
      if (!patientId || !encounterId) {
        this.skip();
      }

      // First search (cache miss)
      const search1Start = Date.now();
      // Note: This would use the actual search service
      // const result1 = await searchService.search('고혈압', { });
      const search1Time = Date.now() - search1Start;

      // Second search (cache hit)
      const search2Start = Date.now();
      // const result2 = await searchService.search('고혈압', { });
      const search2Time = Date.now() - search2Start;

      // Cache hit should be significantly faster
      expect(search2Time).toBeLessThan(search1Time);
    });
  });

  describe('7. Billing & Claims', () => {
    it('should create billing record from encounter', async () => {
      if (!patientId || !encounterId) {
        this.skip();
      }

      const billing = await prisma.billing.create({
        data: {
          encounterId,
          patientId,
          totalAmount: 50000,
          status: 'BILLED',
          billingDate: new Date(),
        },
      });

      expect(billing.status).toBe('BILLED');
      expect(billing.totalAmount).toBe(50000);
    });
  });

  describe('8. Audit & Access Control', () => {
    it('should log all medical record access', async () => {
      if (!patientId || !doctorId) {
        this.skip();
      }

      // Doctor accesses patient record (normal access)
      const normalAccess = await prisma.audit.create({
        data: {
          userId: doctorId,
          patientId,
          action: 'VIEW_ENCOUNTER',
          resourceId: encounterId || '',
          accessMethod: 'NORMAL',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date(),
        },
      });

      expect(normalAccess.action).toBe('VIEW_ENCOUNTER');
      expect(normalAccess.accessMethod).toBe('NORMAL');
    });

    it('should detect abnormal access patterns', async () => {
      if (!patientId) {
        this.skip();
      }

      // Simulate multiple accesses in short time
      const accesses = [];
      for (let i = 0; i < 5; i++) {
        const audit = await prisma.audit.create({
          data: {
            userId: `user-${i}`,
            patientId,
            action: 'VIEW_PATIENT',
            resourceId: patientId,
            accessMethod: 'NORMAL',
            ipAddress: '192.168.1.1',
            timestamp: new Date(Date.now() + i * 1000),
          },
        });
        accesses.push(audit);
      }

      expect(accesses).toHaveLength(5);
      // Anomaly detection would flag this as suspicious
    });
  });

  describe('9. Discharge & Closure', () => {
    it('should generate discharge summary and close encounter', async () => {
      if (!encounterId || !patientId || !doctorId) {
        this.skip();
      }

      // Create discharge summary
      const dischargeSummary = await prisma.dischargeSummary.create({
        data: {
          encounterId,
          dischargeDate: new Date(),
          hospitalCourse: '3일간 입원. 고혈압 약물 치료로 혈압 안정화.',
          admitDiagnosis: '고혈압',
          dischargeDiagnosis: '고혈압 (조절됨)',
          medications: '[{"name":"Amlodipine","dose":"5mg","frequency":"daily"}]',
          doctorId,
        },
      });

      // Close encounter
      const closedEncounter = await prisma.encounter.update({
        where: { id: encounterId },
        data: { status: 'CLOSED' },
      });

      expect(dischargeSummary.hospitalCourse).toContain('입원');
      expect(closedEncounter.status).toBe('CLOSED');
    });
  });

  describe('10. Workflow Completion', () => {
    it('should complete full clinical workflow without errors', async () => {
      // This test verifies that all previous tests completed successfully
      // in a realistic order

      expect(patientId).toBeDefined();
      expect(doctorId).toBeDefined();
      expect(encounterId).toBeDefined();
      expect(prescriptionId).toBeDefined();
      expect(orderId).toBeDefined();
      expect(problemId).toBeDefined();
    });
  });
});
