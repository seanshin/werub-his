import { HttpException,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AI_ORIGIN_TEXT, toFhirInterpretation, fhirQuantity, policyOf } from '@hospital-run/shared';
import { patientSearchRef } from './patient-search-param.util';
import { resolvePatientRef } from './patient-ref.util';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { FhirDualAuthGuard, FhirScope } from '../smart-auth/smart-auth.guard';
import { buildMedicationSearchWhere } from '../../common/medication-search';
import { SmartAuthService, SmartTokenPayload } from '../smart-auth/smart-auth.service';
import { FhirLabIngestService } from '../fhir-lab/fhir-lab-ingest.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PatientService } from '../patient/patient.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PreOrderService } from '../pre-order/pre-order.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { FhirPatientMapper } from './fhir-patient.mapper';
import { isPathologyEdiCode, PATHOLOGY_CATEGORY_CODING } from './pathology-category.util';
import { fhirServiceRequestStatus, orderStatusesForFhirSrSearch } from './service-request-status';
import { fhirIssuer } from '../../common/util/public-url';
import {
  FhirPatient,
  FhirBundle,
  FhirCapabilityStatement,
  FhirEncounter,
  FhirMedicationRequest,
  FhirCondition,
  FhirPractitioner,
  FhirOrganization,
  FhirAllergyIntolerance,
  FhirProcedure,
  FhirAppointment,
  FhirDiagnosticReport,
  FhirServiceRequest,
  FhirLocation,
  FhirCarePlan,
  FhirDocumentReference,
  FhirResource,
  FhirBundleEntry,
} from './types/fhir-r4.types';
import { fhirMedicationRequestStatus } from '../../common/fhir-medication-status';
import { fhirEncounterClass, fhirEncounterStatus, fhirEncounterStatusHistory } from '../../common/fhir-encounter';

@ApiTags('FHIR R4')
@Controller('fhir/R4')
export class FhirController {
  private readonly logger = new Logger(FhirController.name);

  constructor(
    private readonly patientService: PatientService,
    private readonly mapper: FhirPatientMapper,
    private readonly prisma: PrismaService,
    private readonly labIngest: FhirLabIngestService,
    private readonly smartAuth: SmartAuthService,
    private readonly preOrderService: PreOrderService,
    private readonly configRuntime: ConfigRuntimeService,
  ) {}

  // ── CapabilityStatement (Public) ──

  @Get('metadata')
  @ApiOperation({ summary: 'FHIR CapabilityStatement' })
  getCapabilityStatement(): FhirCapabilityStatement {
    return {
      resourceType: 'CapabilityStatement',
      status: 'active',
      kind: 'instance',
      fhirVersion: '4.0.1',
      format: ['json'],
      rest: [
        {
          mode: 'server',
          security: {
            service: [{
              coding: [{ system: 'http://terminology.hl7.org/CodeSystem/restful-security-service', code: 'SMART-on-FHIR', display: 'SMART-on-FHIR' }],
              text: '내부 직원 JWT 또는 SMART(client_credentials, system/*) Bearer 토큰',
            }],
            description: '내부 직원 JWT 또는 SMART Backend Services(client_credentials) 토큰. Bearer 필수.',
            // SMART OAuth URI 확장 — 외부 클라이언트(LIS) 디스커버리
            extension: [{
              url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
              extension: [
                { url: 'token', valueUri: `${fhirIssuer()}/oauth2/token` },
                { url: 'authorize', valueUri: `${fhirIssuer()}/oauth2/authorize` },
              ],
            }],
          },
          resource: [
            {
              type: 'Patient',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
                { code: 'create' },
                { code: 'update' },
              ],
              searchParam: [
                { name: 'name', type: 'string' },
                { name: 'identifier', type: 'token' },
                { name: 'birthdate', type: 'date' },
                { name: 'gender', type: 'token' },
              ],
            },
            {
              type: 'Encounter',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'subject', type: 'reference' },
                { name: 'patient', type: 'reference' }, // subject 의 Patient 한정 별칭 — 핸들러가 둘 다 읽는다
                { name: 'status', type: 'token' },
              ],
            },
            {
              type: 'MedicationRequest',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'subject', type: 'reference' },
                { name: 'patient', type: 'reference' }, // subject 의 Patient 한정 별칭 — 핸들러가 둘 다 읽는다
                { name: 'encounter', type: 'reference' },
              ],
            },
            {
              type: 'Condition',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'subject', type: 'reference' },
                { name: 'patient', type: 'reference' }, // subject 의 Patient 한정 별칭 — 핸들러가 둘 다 읽는다
              ],
            },
            {
              type: 'Practitioner',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'name', type: 'string' },
                { name: 'role', type: 'token' },
              ],
            },
            {
              type: 'Organization',
              interaction: [
                { code: 'read' },
              ],
            },
            {
              type: 'AllergyIntolerance',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'patient', type: 'reference' },
                { name: 'subject', type: 'reference' },
              ],
            },
            {
              type: 'Procedure',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'subject', type: 'reference' },
                { name: 'patient', type: 'reference' }, // subject 의 Patient 한정 별칭 — 핸들러가 둘 다 읽는다
                { name: 'status', type: 'token' },
              ],
            },
            {
              type: 'Appointment',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'patient', type: 'reference' },
                { name: 'subject', type: 'reference' },
                { name: 'status', type: 'token' },
                { name: 'date', type: 'date' },
              ],
            },
            {
              type: 'DiagnosticReport',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
                { code: 'create' }, // 외부 LIS 결과 수신(system/DiagnosticReport.write)
              ],
              searchParam: [
                { name: 'subject', type: 'reference' },
                { name: 'patient', type: 'reference' }, // subject 의 Patient 한정 별칭 — 핸들러가 둘 다 읽는다
                { name: 'status', type: 'token' },
                { name: 'based-on', type: 'reference' }, // 오더 기준 결과 대사
                { name: 'identifier', type: 'token' }, // 검체 바코드 기준 대사
              ],
            },
            {
              type: 'ServiceRequest',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'subject', type: 'reference' },
                { name: 'patient', type: 'reference' }, // subject 의 Patient 한정 별칭 — 핸들러가 둘 다 읽는다
                { name: 'status', type: 'token' },
                { name: 'category', type: 'token' }, // laboratory|LAB 필터
              ],
            },
            {
              type: 'Location',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'type', type: 'token' },
              ],
            },
            {
              type: 'Bundle',
              interaction: [
                { code: 'create' },
              ],
            },
            {
              type: 'CarePlan',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'subject', type: 'reference' },
                { name: 'patient', type: 'reference' }, // subject 의 Patient 한정 별칭 — 핸들러가 둘 다 읽는다
              ],
            },
            {
              type: 'DocumentReference',
              interaction: [
                { code: 'read' },
                { code: 'search-type' },
              ],
              searchParam: [
                { name: 'subject', type: 'reference' },
                { name: 'patient', type: 'reference' }, // subject 의 Patient 한정 별칭 — 핸들러가 둘 다 읽는다
                { name: 'type', type: 'token' },
              ],
            },
            {
              type: 'Immunization',
              interaction: [{ code: 'read' }, { code: 'search-type' }],
              searchParam: [{ name: 'patient', type: 'reference' }, { name: 'subject', type: 'reference' }],
            },
            {
              type: 'Medication',
              interaction: [{ code: 'read' }, { code: 'search-type' }],
              searchParam: [{ name: 'code', type: 'token' }, { name: 'name', type: 'string' }],
            },
            {
              type: 'Observation',
              interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }], // 외부 LIS 결과(system/Observation.write)
              searchParam: [{ name: 'patient', type: 'reference' }, { name: 'subject', type: 'reference' }, { name: 'code', type: 'token' }],
            },
          ],
        },
      ],
    };
  }

  // ── Patient Search ──

  @Get('Patient')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Patient', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Patient 검색' })
  async searchPatients(
    @Query('name') name?: string,
    @Query('identifier') identifier?: string,
    @Query('birthdate') birthdate?: string,
    @Query('gender') gender?: string,
  ): Promise<FhirBundle<FhirPatient>> {
    const result = await this.patientService.findAll({
      q: name,
      mrn: identifier,
      dobFrom: birthdate,
      dobTo: birthdate,
      gender: gender?.toUpperCase() as any,
      page: 1,
      limit: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: result.pagination.total,
      entry: result.data.map((p: any) => ({
        resource: this.mapper.toFhir(p),
      })),
    };
  }

  // ── Patient Read ──

  @Get('Patient/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Patient', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Patient 조회' })
  async getPatient(
    @Param('id') id: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirPatient> {
    const patient = await this.patientService.findById(id);
    if (!patient) throw new NotFoundException('Patient not found');
    this.smartAuth.assertPatientAccess(req.smartClient, 'Patient', patient.id);
    return this.mapper.toFhir(patient);
  }

  // ── Patient Create ──

  @Post('Patient')
  // 🔴 (2026-09-16 D4) 직원 JWT 만 확인하고 **역할·권한 판정이 없었다** — 인증된 전 직원이 환자를 생성할 수 있었다.
  //    `patient.controller` 의 같은 행위와 권한 정본을 맞춘다(RolesGuard 가 @RequirePermission 을 집행한다).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequirePermission(Permission.PATIENT_CREATE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Patient 생성' })
  async createPatient(
    @Body() fhirPatient: FhirPatient,
    @CurrentUser('id') userId: string,
  ): Promise<FhirPatient> {
    const dto = this.mapper.toCreateDto(fhirPatient);
    const created = await this.patientService.create(dto, userId);
    return this.mapper.toFhir(created);
  }

  // ── Patient Update ──

  @Put('Patient/:id')
  // 🔴 (2026-09-16 D4) 위와 같은 결함 — 인적정보 수정 권한 정본으로 맞춘다
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequirePermission(Permission.PATIENT_EDIT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Patient 업데이트' })
  async updatePatient(
    @Param('id') id: string,
    @Body() fhirPatient: FhirPatient,
    @CurrentUser('id') userId: string,
  ): Promise<FhirPatient> {
    const dto = this.mapper.toCreateDto(fhirPatient);
    const updated = await this.patientService.update(id, dto, userId);
    return this.mapper.toFhir(updated);
  }

  // ════════════════════════════════════════════
  // Encounter
  // ════════════════════════════════════════════

  /**
   * 🔴 (2026-09-03 트윈 요청) Encounter 만 JwtAuthGuard 단독이라 SMART 토큰이 401 이었다 —
   *    형제 리소스(MedicationRequest·AllergyIntolerance 등)와 같게 이중 가드로.
   *    노출은 여기서 열리지 않는다: 클라이언트별 scopes 부여(/admin/smart-clients·사람 승인)가 있어야
   *    system/Encounter.read 가 발급된다(대외 3조건 — 구현/설정/승인 분리).
   */
  @Get('Encounter')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Encounter', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Encounter 검색' })
  async searchEncounters(
    @Query('subject') subject?: string,
    @Query('status') status?: string,
    @Query('patient') patient?: string,
  ): Promise<FhirBundle<FhirEncounter>> {
    subject = patientSearchRef(subject, patient);
    const where: Record<string, unknown> = {};
    if (subject) {
      // subject can be "Patient/<id>" or just "<id>"
      const patientId = subject.replace(/^Patient\//, '');
      where.patientId = patientId;
    }
    if (status) {
      // R4 방문 상태로 찾는다 — 종료(finished)는 서명·정정 진료 둘 다(정정은 기록의 사실이지 방문 상태가 아니다)
      const statusMap: Record<string, string[]> = {
        'in-progress': ['DRAFT'],
        finished: ['SIGNED', 'AMENDED'],
      };
      if (statusMap[status]) where.status = { in: statusMap[status] };
    }

    const encounters = await this.prisma.encounter.findMany({
      where,
      include: {
        patient: { omit: PATIENT_SENSITIVE_OMIT },
        doctor: true,
        appointment: true,
        diagnoses: { include: { diagnosisCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: encounters.length,
      entry: encounters.map((enc) => ({
        resource: this.mapEncounterToFhir(enc),
      })),
    };
  }

  @Get('Encounter/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Encounter', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Encounter 조회' })
  async getEncounter(
    @Param('id') id: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirEncounter> {
    const enc = await this.prisma.encounter.findUnique({
      where: { id },
      include: {
        patient: { omit: PATIENT_SENSITIVE_OMIT },
        doctor: true,
        appointment: true,
        diagnoses: { include: { diagnosisCode: true } },
      },
    });
    if (!enc) throw new NotFoundException('Encounter not found');
    // 환자 스코프 토큰의 타 환자 단건 조회 차단 — 형제 :id 라우트(MedicationRequest 등)와 같은 규칙
    this.smartAuth.assertPatientAccess(req.smartClient, 'Encounter', enc.patientId);
    return this.mapEncounterToFhir(enc);
  }

  // ════════════════════════════════════════════
  // MedicationRequest
  // ════════════════════════════════════════════

  @Get('MedicationRequest')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('MedicationRequest', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR MedicationRequest 검색' })
  async searchMedicationRequests(
    @Query('subject') subject?: string,
    @Query('encounter') encounter?: string,
    @Query('patient') patient?: string,
  ): Promise<FhirBundle<FhirMedicationRequest>> {
    subject = patientSearchRef(subject, patient);
    const where: Record<string, unknown> = { type: 'MEDICATION' };
    if (subject) {
      const patientId = subject.replace(/^Patient\//, '');
      where.encounter = { patientId };
    }
    if (encounter) {
      const encounterId = encounter.replace(/^Encounter\//, '');
      where.encounterId = encounterId;
    }

    const prescriptions = await this.prisma.prescription.findMany({
      where,
      include: {
        medicationCode: true,
        encounter: {
          select: { id: true, patientId: true, doctorId: true, doctor: true, patient: { select: { mrn: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: prescriptions.length,
      entry: prescriptions
        .filter((rx) => rx.medicationCode)
        .map((rx) => ({
          resource: this.mapMedicationRequestToFhir(rx),
        })),
    };
  }

  @Get('MedicationRequest/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('MedicationRequest', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR MedicationRequest 조회' })
  async getMedicationRequest(
    @Param('id') id: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirMedicationRequest> {
    const rx = await this.prisma.prescription.findUnique({
      where: { id },
      include: {
        medicationCode: true,
        encounter: {
          select: { id: true, patientId: true, doctorId: true, doctor: true, patient: { select: { mrn: true } } },
        },
      },
    });
    if (!rx || !rx.medicationCode)
      throw new NotFoundException('MedicationRequest not found');
    this.smartAuth.assertPatientAccess(req.smartClient, 'MedicationRequest', rx.encounter?.patientId);
    return this.mapMedicationRequestToFhir(rx);
  }

  // ════════════════════════════════════════════
  // Condition (Diagnosis)
  // ════════════════════════════════════════════

  @Get('Condition')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Condition', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Condition 검색' })
  async searchConditions(
    @Query('subject') subject?: string,
    @Query('patient') patient?: string,
  ): Promise<FhirBundle<FhirCondition>> {
    subject = patientSearchRef(subject, patient);
    const where: Record<string, unknown> = {};
    if (subject) {
      const patientId = subject.replace(/^Patient\//, '');
      where.encounter = { patientId };
    }

    const diagnoses = await this.prisma.encounterDiagnosis.findMany({
      where,
      include: {
        diagnosisCode: true,
        encounter: { select: { id: true, patientId: true, createdAt: true } },
      },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: diagnoses.length,
      entry: diagnoses.map((d) => ({
        resource: this.mapConditionToFhir(d),
      })),
    };
  }

  @Get('Condition/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Condition', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Condition 조회' })
  async getCondition(
    @Param('id') id: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirCondition> {
    const diagnosis = await this.prisma.encounterDiagnosis.findUnique({
      where: { id },
      include: {
        diagnosisCode: true,
        encounter: { select: { id: true, patientId: true, createdAt: true } },
      },
    });
    if (!diagnosis) throw new NotFoundException('Condition not found');
    this.smartAuth.assertPatientAccess(req.smartClient, 'Condition', diagnosis.encounter?.patientId);
    return this.mapConditionToFhir(diagnosis);
  }

  // ════════════════════════════════════════════
  // Practitioner
  // ════════════════════════════════════════════

  @Get('Practitioner')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Practitioner 검색' })
  async searchPractitioners(
    @Query('name') name?: string,
    @Query('role') role?: string,
  ): Promise<FhirBundle<FhirPractitioner>> {
    const where: Record<string, unknown> = {
      role: { in: ['DOCTOR', 'NURSE'] },
      isActive: true,
    };
    if (name) {
      where.OR = [
        { familyName: { contains: name, mode: 'insensitive' } },
        { givenName: { contains: name, mode: 'insensitive' } },
      ];
    }
    if (role) {
      const roleUpper = role.toUpperCase();
      if (roleUpper === 'DOCTOR' || roleUpper === 'NURSE') {
        where.role = roleUpper;
      }
    }

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { familyName: 'asc' },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: users.length,
      entry: users.map((u: Record<string, unknown>) => ({
        resource: this.mapPractitionerToFhir(u),
      })),
    };
  }

  @Get('Practitioner/:id')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Practitioner 조회' })
  async getPractitioner(@Param('id') id: string): Promise<FhirPractitioner> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !['DOCTOR', 'NURSE'].includes(user.role))
      throw new NotFoundException('Practitioner not found');
    return this.mapPractitionerToFhir(user);
  }

  // ════════════════════════════════════════════
  // Organization
  // ════════════════════════════════════════════

  @Get('Organization')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Organization 조회' })
  async getOrganization(): Promise<FhirBundle<FhirOrganization>> {
    const org = this.buildOrganization();
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [{ resource: org }],
    };
  }

  @Get('Organization/:id')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Organization 조회' })
  async getOrganizationById(@Param('id') id: string): Promise<FhirOrganization> {
    if (id !== 'hospital-run')
      throw new NotFoundException('Organization not found');
    return this.buildOrganization();
  }

  // ════════════════════════════════════════════
  // AllergyIntolerance
  // ════════════════════════════════════════════

  @Get('AllergyIntolerance')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('AllergyIntolerance', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR AllergyIntolerance 검색' })
  async searchAllergyIntolerances(
    @Query('patient') patient?: string,
    @Query('subject') subject?: string,
  ): Promise<FhirBundle<FhirAllergyIntolerance>> {
    patient = patientSearchRef(patient, subject);
    const where: Record<string, unknown> = {};
    if (patient) {
      where.patientId = patient.replace(/^Patient\//, '');
    }

    const allergies = await this.prisma.allergy.findMany({
      where,
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: allergies.length,
      entry: allergies.map((a: Record<string, unknown>) => ({
        resource: this.mapAllergyToFhir(a),
      })),
    };
  }

  @Get('AllergyIntolerance/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('AllergyIntolerance', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR AllergyIntolerance 조회' })
  async getAllergyIntolerance(
    @Param('id') id: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirAllergyIntolerance> {
    const allergy = await this.prisma.allergy.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });
    if (!allergy) throw new NotFoundException('AllergyIntolerance not found');
    this.smartAuth.assertPatientAccess(req.smartClient, 'AllergyIntolerance', allergy.patientId);
    return this.mapAllergyToFhir(allergy);
  }

  // ════════════════════════════════════════════
  // Procedure
  // ════════════════════════════════════════════

  @Get('Procedure')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Procedure', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Procedure 검색' })
  async searchProcedures(
    @Query('subject') subject?: string,
    @Query('status') status?: string,
    @Query('patient') patient?: string,
  ): Promise<FhirBundle<FhirProcedure>> {
    subject = patientSearchRef(subject, patient);
    const where: Record<string, unknown> = {};
    if (subject) {
      where.patientId = subject.replace(/^Patient\//, '');
    }
    if (status) {
      const statusMap: Record<string, string> = {
        completed: 'COMPLETED',
        'in-progress': 'IN_PROGRESS',
        preparation: 'SCHEDULED',
      };
      if (statusMap[status]) where.status = statusMap[status];
    }

    const surgeries = await this.prisma.surgery.findMany({
      where,
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, surgeon: true },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: surgeries.length,
      entry: surgeries.map((s: Record<string, unknown>) => ({
        resource: this.mapProcedureToFhir(s),
      })),
    };
  }

  @Get('Procedure/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Procedure', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Procedure 조회' })
  async getProcedure(
    @Param('id') id: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirProcedure> {
    const surgery = await this.prisma.surgery.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, surgeon: true },
    });
    if (!surgery) throw new NotFoundException('Procedure not found');
    this.smartAuth.assertPatientAccess(req.smartClient, 'Procedure', surgery.patientId);
    return this.mapProcedureToFhir(surgery);
  }

  // ════════════════════════════════════════════
  // Appointment
  // ════════════════════════════════════════════

  @Get('Appointment')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Appointment 검색' })
  async searchAppointments(
    @Query('patient') patient?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('subject') subject?: string,
  ): Promise<FhirBundle<FhirAppointment>> {
    patient = patientSearchRef(patient, subject);
    const where: Record<string, unknown> = {};
    if (patient) {
      where.patientId = patient.replace(/^Patient\//, '');
    }
    if (status) {
      const statusMap: Record<string, string> = {
        booked: 'SCHEDULED',
        arrived: 'CHECKED_IN',
        fulfilled: 'COMPLETED',
        cancelled: 'CANCELLED',
        noshow: 'NO_SHOW',
      };
      if (statusMap[status]) where.status = statusMap[status];
    }
    if (date) {
      const dateStart = new Date(date);
      const dateEnd = new Date(date);
      dateEnd.setDate(dateEnd.getDate() + 1);
      where.scheduledAt = { gte: dateStart, lt: dateEnd };
    }

    const appointments = await this.prisma.appointment.findMany({
      where,
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, doctor: true },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: appointments.length,
      entry: appointments.map((a: Record<string, unknown>) => ({
        resource: this.mapAppointmentToFhir(a),
      })),
    };
  }

  @Get('Appointment/:id')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Appointment 조회' })
  async getAppointment(@Param('id') id: string): Promise<FhirAppointment> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, doctor: true },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return this.mapAppointmentToFhir(appointment);
  }

  // ════════════════════════════════════════════
  // DiagnosticReport
  // ════════════════════════════════════════════

  @Get('DiagnosticReport')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('DiagnosticReport', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR DiagnosticReport 검색' })
  async searchDiagnosticReports(
    @Query('subject') subject?: string,
    @Query('status') status?: string,
    @Query('based-on') basedOn?: string,
    @Query('identifier') identifier?: string,
    @Query('patient') patient?: string,
  ): Promise<FhirBundle<FhirDiagnosticReport>> {
    subject = patientSearchRef(subject, patient);
    const where: Record<string, unknown> = {};
    if (subject) {
      where.patientId = subject.replace(/^Patient\//, '');
    }
    if (status) {
      // final은 COMPLETED(예비)+VERIFIED(확정) 둘 다 — VERIFIED 누락으로 가장 권위있는 결과가 조회에서 빠지던 것 교정.
      const statusMap: Record<string, string | string[]> = {
        final: ['COMPLETED', 'VERIFIED'],
        partial: 'IN_PROGRESS',
        registered: 'PENDING',
        preliminary: 'COLLECTED',
      };
      const mapped = statusMap[status];
      if (mapped) where.status = Array.isArray(mapped) ? { in: mapped } : mapped;
    }
    // based-on=ServiceRequest/{orderId} — LIS가 제출한 오더 기준 결과 대사(reconciliation).
    if (basedOn) {
      where.orderId = basedOn.replace(/^ServiceRequest\//, '');
    }
    // identifier={검체 바코드} — 스테이징 수신(LabInterfaceResult)에서 오더를 역해소해 결과 대사.
    if (identifier) {
      const staged = await this.prisma.labInterfaceResult.findMany({
        where: { sampleBarcode: identifier },
        select: { matchedOrderId: true },
      });
      const orderIds = staged.map((s) => s.matchedOrderId).filter(Boolean) as string[];
      // 매칭 오더가 없으면(미적용/미매칭) 결과 없음으로 응답.
      where.orderId = orderIds.length ? { in: orderIds } : '00000000-0000-0000-0000-000000000000';
    }

    const labResults = await this.prisma.labResult.findMany({
      where,
      include: {
        patient: { omit: PATIENT_SENSITIVE_OMIT },
        technician: true,
        items: true,
        order: {
          include: {
            prescription: {
              include: { procedureCode: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: labResults.length,
      entry: labResults.map((lr: Record<string, unknown>) => ({
        resource: this.mapDiagnosticReportToFhir(lr),
      })),
    };
  }

  @Get('DiagnosticReport/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('DiagnosticReport', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR DiagnosticReport 조회' })
  async getDiagnosticReport(
    @Param('id') id: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirDiagnosticReport> {
    const labResult = await this.prisma.labResult.findUnique({
      where: { id },
      include: {
        patient: { omit: PATIENT_SENSITIVE_OMIT },
        technician: true,
        items: true,
        order: {
          include: {
            prescription: {
              include: { procedureCode: true },
            },
          },
        },
      },
    });
    if (!labResult) throw new NotFoundException('DiagnosticReport not found');
    return this.mapDiagnosticReportToFhir(labResult);
  }

  // ════════════════════════════════════════════
  // ServiceRequest
  // ════════════════════════════════════════════

  /**
   * 인바운드 ServiceRequest 수용 (LIS reflex 양방향 오더 — R-1).
   * 무단 처방 생성 금지 원칙: 정식 Prescription/Order가 아닌 **PreOrder(사전처방·승인 대기)**로
   * 수용하고, 발효는 담당의 승인 게이트(DUR 재검증) 경유. status=draft만 수용.
   * config `fhir.serviceRequestInbound.enabled`(기본 OFF) — 실가동은 A-1~3 합의 후.
   */
  @Post('ServiceRequest')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('ServiceRequest', 'write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR ServiceRequest 인바운드 수용 (LIS reflex → PreOrder 승인대기)' })
  async createServiceRequest(@Body() sr: Record<string, any>): Promise<Record<string, unknown>> {
    return this.ingestServiceRequest(sr);
  }

  /** 인바운드 ServiceRequest 수용 코어 — 직접 POST와 Bundle 경로가 공유(계약 단일화) */
  private async ingestServiceRequest(sr: Record<string, any>): Promise<Record<string, unknown>> {
    // message에 diagnostics 동봉 — Nest는 객체 페이로드 예외의 message를 generic으로 남겨
    // 전역 필터·Bundle 응답에서 사유가 유실됨(2026-07-15 LIS 실측: 'Bad Request Exception'만 노출)
    const oo = (diagnostics: string) => ({
      message: diagnostics,
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'processing', diagnostics }],
    });

    const enabled = String((await this.configRuntime.get('fhir.serviceRequestInbound.enabled')) ?? 'false') === 'true';
    if (!enabled) {
      throw new ForbiddenException(oo('인바운드 ServiceRequest 수용이 비활성 상태입니다 (fhir.serviceRequestInbound.enabled)'));
    }

    if (sr?.resourceType !== 'ServiceRequest') {
      throw new BadRequestException(oo('resourceType은 ServiceRequest여야 합니다'));
    }
    // 무단 처방 금지 — 승인 대기(draft)만 수용 (LIS 정합: active→draft)
    if (sr.status !== 'draft') {
      throw new BadRequestException(oo(`status=draft만 수용합니다 (수신: ${sr.status ?? '없음'}) — 발효는 HIS 의사 승인 게이트 경유`));
    }

    // 멱등키: LIS identifier — 재발신 시 기존 건 반환 (이중 수용 방지)
    const externalRef: string | undefined = sr.identifier?.[0]?.value
      ? String(sr.identifier[0].system ? `${sr.identifier[0].system}|${sr.identifier[0].value}` : sr.identifier[0].value).slice(0, 120)
      : undefined;
    if (externalRef) {
      const existing = await this.prisma.preOrder.findUnique({ where: { externalRef } });
      if (existing) return this.mapPreOrderAck(existing, sr, true);
    }

    // 환자 — 내부 UUID 우선, **차트번호(MRN)도 받는다**. 이름 매칭은 여전히 금지(연동 규칙).
    //
    // 🔴 외부 점검: LIS 는 유입 시 환자 식별자를 **MRN 우선**으로 잡기 때문에
    //    reflex ServiceRequest 의 `subject` 가 `Patient/<MRN>` 으로 온다. 종전엔 UUID 로만 찾아
    //    **400 `환자를 찾을 수 없습니다`** 로 거절했고(실호출 확인), 같은 요청의 subject 를 UUID 로
    //    바꾸면 통과했다. 식별자 종류가 다른 것을 "없는 환자"라고 말하지 않는다.
    //    안전: 아래에서 **원오더(basedOn)의 환자와 일치**하는지 다시 대조한다(교차 검증은 그대로다).
    //    해소 정본 `fhir/patient-ref.util.ts` — 결과 수신(fhir-lab-ingest)도 같은 것을 쓴다.
    const subject = await resolvePatientRef(this.prisma, sr.subject?.reference);
    if (subject.kind === 'absent') throw new BadRequestException(oo('subject(Patient/<id>)가 필요합니다'));
    if (subject.kind === 'unresolved') throw new BadRequestException(oo(`환자를 찾을 수 없습니다: ${subject.raw}`));
    const patientId = subject.patientId;

    // 원오더(basedOn) — reflex 근거이자 책임 처방의 해소 원천 (필수)
    const basedOnId = String(sr.basedOn?.[0]?.reference ?? '').replace(/^ServiceRequest\//, '');
    if (!basedOnId) throw new BadRequestException(oo('basedOn(원오더 ServiceRequest 참조)이 필요합니다 — reflex 근거·책임 처방의 해소'));
    const baseOrder = await this.prisma.order
      .findUnique({
        where: { id: basedOnId },
        include: { prescription: { select: { encounter: { select: { patientId: true, doctorId: true } } } } },
      })
      .catch(() => null);
    if (!baseOrder?.prescription?.encounter) throw new BadRequestException(oo(`원오더를 찾을 수 없습니다: ${basedOnId}`));
    if (baseOrder.prescription.encounter.patientId !== patientId) {
      throw new BadRequestException(oo('원오더의 환자와 subject가 일치하지 않습니다'));
    }
    const doctorId = baseOrder.prescription.encounter.doctorId;

    // LOINC → 원내 수가코드 해소 (R-4 매핑 기구축 — 미매핑은 명시 거절로 LIS에 신호)
    const loinc = (sr.code?.coding ?? []).find((c: { system?: string }) => (c.system ?? '').includes('loinc'));
    if (!loinc?.code) throw new BadRequestException(oo('code.coding에 LOINC 코드가 필요합니다'));
    const procedureCode = await this.prisma.procedureCode.findFirst({
      where: { loincCode: String(loinc.code) },
      select: { id: true, code: true, nameKo: true },
    });
    if (!procedureCode) {
      throw new BadRequestException(oo(`미매핑 LOINC: ${loinc.code} — HIS 수가코드 매핑 등록 필요 (R-4)`));
    }

    const reasonText = sr.reasonCode?.[0]?.text ?? sr.reasonCode?.[0]?.coding?.[0]?.display ?? null;
    const created = await this.preOrderService.create({
      patientId,
      doctorId,
      type: 'LAB',
      procedureCodeId: procedureCode.id,
      reason: `[LIS-REFLEX] ${reasonText ?? 'reflex order'}${sr.intent ? ` (intent=${sr.intent})` : ''}`,
      instructions: sr.code?.text ?? loinc.display ?? procedureCode.nameKo,
      scheduledDate: sr.occurrenceDateTime ? String(sr.occurrenceDateTime).slice(0, 10) : undefined,
      source: 'LIS_REFLEX',
      externalRef,
    });
    const preOrder = (created as { data: { id: string; status: string } }).data;
    this.logger.log(`LIS reflex 수용: SR→PreOrder ${preOrder.id} (LOINC ${loinc.code} → ${procedureCode.code}, 원오더 ${basedOnId})`);
    return this.mapPreOrderAck(preOrder, sr, false);
  }

  /** 인바운드 수용 ACK — HIS 채번(PreOrder id) 동봉. 정식 오더번호는 의사 승인 시 별도 채번됨을 명시 */
  private mapPreOrderAck(preOrder: { id: string; status: string }, sr: Record<string, any>, duplicate: boolean): Record<string, unknown> {
    return {
      resourceType: 'ServiceRequest',
      id: preOrder.id, // HIS 수용 채번 = PreOrder id (승인 후 정식 Order id 별도)
      status: 'draft',
      intent: sr.intent ?? 'reflex-order',
      identifier: [
        ...(sr.identifier ?? []),
        { system: 'urn:his:pre-order', value: preOrder.id },
      ],
      subject: sr.subject,
      basedOn: sr.basedOn,
      code: sr.code,
      extension: [{
        url: 'urn:his:acceptance',
        valueString: duplicate
          ? '이미 수용된 발신(멱등) — 기존 PreOrder 반환'
          : 'PreOrder(승인 대기) 수용 — 담당의 승인 시 정식 처방·오더 전환(DUR 재검증)',
      }],
    };
  }

  @Get('ServiceRequest')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('ServiceRequest', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR ServiceRequest 검색 (category=laboratory|LAB 필터 지원)' })
  async searchServiceRequests(
    @Query('subject') subject?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('_lastUpdated') lastUpdated?: string,
    @Query('_count') count?: string,
    @Query('patient') patient?: string,
  ): Promise<FhirBundle<FhirServiceRequest>> {
    subject = patientSearchRef(subject, patient);
    // category 필터 — laboratory/LAB → LAB만, imaging/RAD → IMAGING만, 미지정 → 둘 다(LIS 폴링은 category=laboratory 권장).
    const catNorm = (category ?? '').toLowerCase();
    const departments = catNorm.includes('lab')
      ? ['LAB']
      : (catNorm.includes('imag') || catNorm.includes('rad'))
        ? ['IMAGING']
        : ['LAB', 'IMAGING'];
    const where: Record<string, unknown> = {
      department: { in: departments },
      // 코드 미지정(시드/미완성) 처방 오더는 비노출 — LIS가 행위 불가(unmapped 소음)·HIS 청구도 미발행 대상
      prescription: { procedureCodeId: { not: null } },
    };
    if (subject) {
      const patientId = subject.replace(/^Patient\//, '');
      where.prescription = { procedureCodeId: { not: null }, encounter: { patientId } };
    }
    if (status) {
      // 🔴 매퍼(`fhirServiceRequestStatus`)와 같은 표의 역상 — active 는 ORDERED·RECEIVED·IN_PROGRESS 다(§3 X1)
      where.status = { in: orderStatusesForFhirSrSearch(status) };
    }
    // 증분 폴링(_lastUpdated=ge{ISO} 또는 {ISO}) — 취소 전파 포함 갱신분만 (LIS ICD A-1)
    if (lastUpdated) {
      const iso = lastUpdated.replace(/^(ge|gt)/, '');
      const since = new Date(iso);
      if (!Number.isNaN(since.getTime())) where.updatedAt = { gte: since };
    }
    const take = Math.min(Math.max(Number(count) || 100, 1), 200); // _count 기본 100·상한 200

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        prescription: {
          include: {
            procedureCode: true,
            medicationCode: true,
            encounter: {
              select: { id: true, patientId: true, doctorId: true, doctor: true, patient: { select: { mrn: true } } },
            },
          },
        },
      },
      orderBy: lastUpdated ? { updatedAt: 'asc' } : { createdAt: 'desc' }, // 증분 폴링은 오래된 갱신부터(순차 소비)
      take,
    });

    const pathologyPrefixes = await this.getPathologyPrefixes();
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: orders.length,
      entry: orders.map((o: Record<string, unknown>) => ({
        resource: this.mapServiceRequestToFhir(o, pathologyPrefixes),
      })),
    };
  }

  @Get('ServiceRequest/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('ServiceRequest', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR ServiceRequest 조회' })
  async getServiceRequest(
    @Param('id') id: string,
  ): Promise<FhirServiceRequest> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        prescription: {
          include: {
            procedureCode: true,
            medicationCode: true,
            encounter: {
              select: { id: true, patientId: true, doctorId: true, doctor: true, patient: { select: { mrn: true } } },
            },
          },
        },
      },
    });
    if (!order) {
      // R-5 폴링 폴백 — 인바운드 수용 ACK의 채번은 PreOrder id이므로, LIS가 그 키로 상태를 폴링할 수 있어야 한다.
      // 상태 매핑: PENDING/MODIFIED→draft(승인 대기) · APPROVED→active(+정식 Order 참조) · CANCELLED/EXPIRED→revoked
      const preOrder = await this.prisma.preOrder
        .findUnique({
          where: { id },
          include: { procedureCode: { select: { code: true, nameKo: true, loincCode: true } } },
        })
        .catch(() => null);
      if (preOrder) {
        // 승인 시 연결된 정식 Order 채번 동봉 (prescriptionId → Order)
        const realOrder = preOrder.prescriptionId
          ? await this.prisma.order.findFirst({ where: { prescriptionId: preOrder.prescriptionId }, select: { id: true } })
          : null;
        return this.mapPreOrderPollStatus(preOrder, realOrder?.id) as unknown as FhirServiceRequest;
      }
      throw new NotFoundException('ServiceRequest not found');
    }
    return this.mapServiceRequestToFhir(order, await this.getPathologyPrefixes());
  }

  /** PreOrder → 폴링용 ServiceRequest 상태 표현 (LIS reflex 승인/거절 확인) */
  private mapPreOrderPollStatus(preOrder: {
    id: string; status: string; patientId: string; source: string;
    updatedAt?: Date | null;
    procedureCode?: { code: string; nameKo: string; loincCode?: string | null } | null;
  }, realOrderId?: string): Record<string, unknown> {
    const status = preOrder.status === 'APPROVED' ? 'active'
      : preOrder.status === 'CANCELLED' || preOrder.status === 'EXPIRED' ? 'revoked'
      : 'draft'; // PENDING | MODIFIED
    return {
      resourceType: 'ServiceRequest',
      id: preOrder.id,
      ...(preOrder.updatedAt ? { meta: { lastUpdated: new Date(preOrder.updatedAt).toISOString() } } : {}),
      status,
      intent: 'reflex-order',
      subject: { reference: `Patient/${preOrder.patientId}` },
      identifier: [
        { system: 'urn:his:pre-order', value: preOrder.id },
        // 승인 시 정식 오더번호 동봉 — LIS가 이후 결과 연동에 사용
        ...(realOrderId ? [{ system: 'urn:his:order', value: realOrderId }] : []),
      ],
      ...(preOrder.procedureCode
        ? {
            code: {
              text: preOrder.procedureCode.nameKo,
              coding: [
                ...(preOrder.procedureCode.loincCode ? [{ system: 'http://loinc.org', code: preOrder.procedureCode.loincCode }] : []),
                { system: 'urn:his:procedure-code', code: preOrder.procedureCode.code },
              ],
            },
          }
        : {}),
    };
  }

  // ════════════════════════════════════════════
  // Location
  // ════════════════════════════════════════════

  @Get('Location')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Location 검색' })
  async searchLocations(
    @Query('type') type?: string,
  ): Promise<FhirBundle<FhirLocation>> {
    const locations: FhirLocation[] = [];

    // Wards
    if (!type || type === 'wa') {
      const wards = await this.prisma.ward.findMany({
        where: { isActive: true },
        include: { beds: true },
      });
      for (const ward of wards) {
        locations.push(this.mapWardToFhir(ward));
      }
    }

    // Beds
    if (!type || type === 'bd') {
      const beds = await this.prisma.bed.findMany({
        include: { ward: true },
        take: 200,
      });
      for (const bed of beds) {
        locations.push(this.mapBedToFhir(bed));
      }
    }

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: locations.length,
      entry: locations.map((loc) => ({ resource: loc })),
    };
  }

  @Get('Location/:id')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Location 조회' })
  async getLocation(@Param('id') id: string): Promise<FhirLocation> {
    // Try ward first
    const ward = await this.prisma.ward.findUnique({
      where: { id },
      include: { beds: true },
    });
    if (ward) return this.mapWardToFhir(ward);

    // Try bed
    const bed = await this.prisma.bed.findUnique({
      where: { id },
      include: { ward: true },
    });
    if (bed) return this.mapBedToFhir(bed);

    throw new NotFoundException('Location not found');
  }

  // ════════════════════════════════════════════
  // Bundle (Transaction)
  // ════════════════════════════════════════════

  @Post()
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Bundle', 'write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR Bundle Transaction 처리 (Patient 생성=직원 / 검사결과 Observation·DiagnosticReport=SMART)' })
  async processBundle(
    @Body() bundle: FhirBundle<FhirResource>,
    @CurrentUser('id') userId: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirBundle<FhirResource>> {
    if (bundle.type !== 'transaction') {
      throw new BadRequestException('Only transaction bundles are supported');
    }

    const smartClient = req.smartClient;
    const isSmart = !!smartClient;
    const clientId = smartClient?.client_id ?? (userId ? `staff:${userId}` : 'unknown');
    // (스코프 세분화) SMART 토큰은 Bundle.write만으로 임의 리소스 쓰기 불가 — 엔트리 리소스별 write 스코프 필요.
    const smartLacksWrite = (rt: string) => isSmart && !!smartClient && !this.smartAuth.hasScope(smartClient, rt, 'write');
    const entries = bundle.entry ?? [];

    // Observation 인덱싱(fullUrl·Observation/{id}) + DiagnosticReport.result[]로 소비된 참조 집합.
    const obsIndex = new Map<string, Record<string, any>>();
    for (const e of entries) {
      const r = e.resource as Record<string, any> | undefined;
      if (r?.resourceType === 'Observation') {
        const full = (e as { fullUrl?: string }).fullUrl;
        if (full) obsIndex.set(full, r);
        if (r.id) obsIndex.set(`Observation/${r.id}`, r);
      }
    }
    const consumedObs = new Set<string>();
    for (const e of entries) {
      const r = e.resource as Record<string, any> | undefined;
      if (r?.resourceType === 'DiagnosticReport' && Array.isArray(r.result)) {
        for (const ref of r.result) if (ref?.reference) consumedObs.add(ref.reference);
      }
    }

    const responseEntries: FhirBundleEntry<FhirResource>[] = [];

    for (const entry of entries) {
      const resource = entry.resource;
      const method = entry.request?.method ?? 'POST';
      const full = (entry as { fullUrl?: string }).fullUrl;

      try {
        const rt = resource && 'resourceType' in resource ? (resource as { resourceType: string }).resourceType : undefined;
        if (rt) {
          if (rt === 'Patient' && method === 'POST') {
            // SMART(system) 클라이언트는 Bundle을 통한 환자 생성 불가 — 검사결과 연계 전용.
            if (isSmart) throw new ForbiddenException('SMART 클라이언트는 Bundle로 Patient를 생성할 수 없습니다');
            const dto = this.mapper.toCreateDto(resource as FhirPatient);
            const created = await this.patientService.create(dto, userId);
            const fhirPatient = this.mapper.toFhir(created);
            responseEntries.push({
              resource: fhirPatient,
              response: { status: '201 Created', location: `Patient/${created.id}` },
            });
          } else if (rt === 'DiagnosticReport' && method === 'POST') {
            // (스코프 세분화) SMART은 DiagnosticReport.write 스코프 필요 — Bundle.write만으론 결과 쓰기 불가.
            if (smartLacksWrite('DiagnosticReport')) {
              responseEntries.push({ response: { status: '403 Forbidden', outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden', diagnostics: 'system/DiagnosticReport.write scope 필요' }] } } });
              continue;
            }
            // result[] 참조를 번들 내 Observation으로 해소 → 검사 스테이징 파이프라인 적재.
            const refs: string[] = Array.isArray((resource as Record<string, any>).result)
              ? (resource as Record<string, any>).result.map((x: { reference?: string }) => x?.reference).filter(Boolean)
              : [];
            const observations = refs.map((ref) => obsIndex.get(ref)).filter(Boolean) as Record<string, any>[];
            // (P2) 미해소 참조 경고 — result[] 중 번들 내에서 해소 안 된 참조는 무음 누락되면 위험(예: 위급 항목 유실).
            const unresolved = refs.length - observations.length;
            if (unresolved > 0) {
              this.logger.warn(`FHIR Bundle DiagnosticReport: result[] ${refs.length}건 중 ${unresolved}건 미해소(번들 내 Observation 부재) — 해당 항목 누락(client=${clientId})`);
            }
            const r = await this.labIngest.ingestReport(resource as Record<string, any>, observations, clientId);
            responseEntries.push({
              resource: { resourceType: 'DiagnosticReport', id: r.id } as unknown as FhirResource,
              response: {
                status: '201 Created',
                location: `DiagnosticReport/${r.id}`,
                ...(unresolved > 0 ? { outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'warning', code: 'incomplete', diagnostics: `result[] ${unresolved}건 미해소 — 항목 누락(번들에 Observation 포함 필요)` }] } } : {}),
              },
            });
          } else if (rt === 'Observation' && method === 'POST') {
            // DiagnosticReport에 소비된 Observation은 이미 반영됨 → 200 ack. 아니면 단건 스테이징.
            const key = full ?? `Observation/${(resource as Record<string, any>).id ?? ''}`;
            if (key && consumedObs.has(key)) {
              responseEntries.push({ response: { status: '200 OK' } });
            } else if (smartLacksWrite('Observation')) {
              // (스코프 세분화) 소비되지 않은 단건 Observation 쓰기는 Observation.write 필요.
              responseEntries.push({ response: { status: '403 Forbidden', outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden', diagnostics: 'system/Observation.write scope 필요' }] } } });
            } else {
              const r = await this.labIngest.ingestObservation(resource as Record<string, any>, clientId);
              responseEntries.push({
                resource: { resourceType: 'Observation', id: r.id } as unknown as FhirResource,
                response: { status: '201 Created', location: `Observation/${r.id}` },
              });
            }
          } else if (rt === 'ServiceRequest' && method === 'POST') {
            // LIS reflex 발신 — 직접 POST와 동일 코어(ingestServiceRequest) 공유. 조용한 유실 금지.
            if (smartLacksWrite('ServiceRequest')) {
              responseEntries.push({ response: { status: '403 Forbidden', outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden', diagnostics: 'system/ServiceRequest.write scope 필요' }] } } });
              continue;
            }
            const ack = await this.ingestServiceRequest(resource as Record<string, any>);
            responseEntries.push({
              resource: ack as unknown as FhirResource,
              response: { status: '201 Created', location: `ServiceRequest/${(ack as Record<string, unknown>).id}` },
            });
          } else {
            // 🔴미지원 리소스를 200 OK로 조용히 ack하던 결함 — 발신측이 성공으로 오인해 데이터 유실(2026-07-15 LIS 리허설에서 실증)
            responseEntries.push({
              response: {
                status: '400 Bad Request',
                outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-supported', diagnostics: `Bundle 미지원 리소스: ${rt} — 지원: Patient·DiagnosticReport·Observation·ServiceRequest(POST)` }] },
              },
            });
          }
        } else {
          responseEntries.push({
            response: { status: '400 Bad Request' },
          });
        }
      } catch (error: unknown) {
        // HttpException 페이로드의 OperationOutcome·사유를 그대로 전달 — 진단 유실 금지
        let status = '422 Unprocessable Entity';
        let outcome: { resourceType: 'OperationOutcome'; issue: { severity: string; code: string; diagnostics?: string }[] } | undefined;
        let message = error instanceof Error ? error.message : 'Unknown error';
        if (error instanceof HttpException) {
          status = `${error.getStatus()} ${error.getStatus() === 400 ? 'Bad Request' : error.getStatus() === 403 ? 'Forbidden' : 'Unprocessable Entity'}`;
          const resp = error.getResponse();
          if (resp && typeof resp === 'object') {
            const r = resp as Record<string, unknown>;
            if (r.resourceType === 'OperationOutcome') outcome = r as unknown as typeof outcome;
            if (typeof r.message === 'string') message = r.message;
          } else if (typeof resp === 'string') {
            message = resp;
          }
        }
        responseEntries.push({
          response: {
            status,
            ...(outcome ? { outcome } : { outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'processing', diagnostics: message }] } }),
          },
          resource: {
            resourceType: 'DocumentReference',
            status: 'current',
            description: message,
          } as FhirDocumentReference,
        });
      }
    }

    return {
      resourceType: 'Bundle',
      type: 'transaction-response',
      entry: responseEntries,
    };
  }

  // ════════════════════════════════════════════
  // CarePlan (RehabPlan + DietOrder)
  // ════════════════════════════════════════════

  @Get('CarePlan')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR CarePlan 검색' })
  async searchCarePlans(
    @Query('subject') subject?: string,
    @Query('patient') patient?: string,
  ): Promise<FhirBundle<FhirCarePlan>> {
    subject = patientSearchRef(subject, patient);
    const patientId = subject?.replace(/^Patient\//, '');
    const where = patientId ? { patientId } : {};

    const [rehabPlans, dietOrders] = await Promise.all([
      this.prisma.rehabPlan.findMany({
        where,
        include: {
          patient: { select: { familyName: true, givenName: true } },
          prescriber: { select: { familyName: true, givenName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.dietOrder.findMany({
        where,
        include: {
          patient: { select: { familyName: true, givenName: true } },
          orderer: { select: { familyName: true, givenName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const carePlans: FhirCarePlan[] = [
      ...rehabPlans.map((rp: Record<string, unknown>) => this.mapRehabPlanToCarePlan(rp)),
      ...dietOrders.map((d: Record<string, unknown>) => this.mapDietOrderToCarePlan(d)),
    ];

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: carePlans.length,
      entry: carePlans.map((cp) => ({ resource: cp })),
    };
  }

  @Get('CarePlan/:id')
  @UseGuards(FhirDualAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR CarePlan 조회' })
  async getCarePlan(@Param('id') id: string): Promise<FhirCarePlan> {
    // Try rehab plan first
    const rehabPlan = await this.prisma.rehabPlan.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true } },
        prescriber: { select: { familyName: true, givenName: true } },
        sessions: true,
      },
    });
    if (rehabPlan) return this.mapRehabPlanToCarePlan(rehabPlan);

    // Try diet order
    const dietOrder = await this.prisma.dietOrder.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true } },
        orderer: { select: { familyName: true, givenName: true } },
      },
    });
    if (dietOrder) return this.mapDietOrderToCarePlan(dietOrder);

    throw new NotFoundException('CarePlan not found');
  }

  // ════════════════════════════════════════════
  // DocumentReference (ConsentForm + LabResultAttachment)
  // ════════════════════════════════════════════

  @Get('DocumentReference')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('DocumentReference', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR DocumentReference 검색' })
  async searchDocumentReferences(
    @Query('subject') subject?: string,
    @Query('type') type?: string,
    @Query('patient') patient?: string,
  ): Promise<FhirBundle<FhirDocumentReference>> {
    subject = patientSearchRef(subject, patient);
    const patientId = subject?.replace(/^Patient\//, '');
    const docs: FhirDocumentReference[] = [];

    // ConsentForm documents
    if (!type || type === 'consent') {
      const consentWhere: Record<string, unknown> = {};
      if (patientId) consentWhere.patientId = patientId;

      const consents = await this.prisma.consentForm.findMany({
        where: consentWhere,
        include: { patient: { select: { familyName: true, givenName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      docs.push(...consents.map((c: Record<string, unknown>) => this.mapConsentToDocRef(c)));
    }

    // Lab result attachments
    if (!type || type === 'lab-attachment') {
      const attachWhere: Record<string, unknown> = {};
      if (patientId) {
        attachWhere.labResult = { patientId };
      }

      const attachments = await this.prisma.labResultAttachment.findMany({
        where: attachWhere,
        include: {
          labResult: { select: { id: true, patientId: true } },
          uploader: { select: { familyName: true, givenName: true } },
        },
        orderBy: { uploadedAt: 'desc' },
        take: 50,
      });
      docs.push(...attachments.map((a: Record<string, unknown>) => this.mapLabAttachmentToDocRef(a)));
    }

    /**
     * 🔴 트윈이 write-back 한 문서(SBAR 등)를 여기서 읽지 않아, 트윈은 `201` 로 받은 id 를
     *    다시 GET 하면 **404** 를 받았다(2026-09-02 실측 — 쓰기만 되고 읽히지 않던 원장).
     *    쓴 것을 돌려주지 않으면 write-back 은 반쪽이다.
     */
    if (!type || type === 'twin-document') {
      const twinWhere: Record<string, unknown> = {};
      if (patientId) twinWhere.patientId = patientId;
      const twinDocs = await this.prisma.twinDocumentReference.findMany({
        where: twinWhere,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      docs.push(...twinDocs.map((d) => this.mapTwinDocToDocRef(d)));
    }

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: docs.length,
      entry: docs.map((d) => ({ resource: d })),
    };
  }

  @Get('DocumentReference/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('DocumentReference', 'read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FHIR DocumentReference 조회' })
  async getDocumentReference(
    @Param('id') id: string,
    @Req() req: { smartClient?: SmartTokenPayload },
  ): Promise<FhirDocumentReference> {
    // Try consent form first
    const consent = await this.prisma.consentForm.findUnique({
      where: { id },
      include: { patient: { select: { familyName: true, givenName: true } } },
    });
    if (consent) {
      this.smartAuth.assertPatientAccess(req.smartClient, 'DocumentReference', consent.patientId);
      return this.mapConsentToDocRef(consent);
    }

    // Try lab attachment
    const attachment = await this.prisma.labResultAttachment.findUnique({
      where: { id },
      include: {
        labResult: { select: { id: true, patientId: true } },
        uploader: { select: { familyName: true, givenName: true } },
      },
    });
    if (attachment) {
      this.smartAuth.assertPatientAccess(req.smartClient, 'DocumentReference', attachment.labResult?.patientId);
      return this.mapLabAttachmentToDocRef(attachment);
    }

    // 트윈 write-back 문서 — 쓴 것을 돌려준다(종전엔 여기서 404 였다)
    const twinDoc = await this.prisma.twinDocumentReference.findUnique({ where: { id } });
    if (twinDoc) {
      this.smartAuth.assertPatientAccess(req.smartClient, 'DocumentReference', twinDoc.patientId);
      return this.mapTwinDocToDocRef(twinDoc);
    }

    throw new NotFoundException('DocumentReference not found');
  }

  // ════════════════════════════════════════════
  // Private Mapping Helpers
  // ════════════════════════════════════════════

  private mapEncounterToFhir(enc: any): FhirEncounter {
    // 상태·분류·상태 이력은 정본(`common/fhir-encounter.ts`) — 다른 반출 경로와 같은 값을 낸다
    const encounter: FhirEncounter = {
      resourceType: 'Encounter',
      id: enc.id,
      status: fhirEncounterStatus(enc.status),
      statusHistory: fhirEncounterStatusHistory(enc),
      class: fhirEncounterClass(enc),
      subject: {
        reference: `Patient/${enc.patientId}`,
        display: `${enc.patient.familyName}${enc.patient.givenName}`,
      },
      participant: [
        {
          individual: {
            reference: `Practitioner/${enc.doctorId}`,
            display: `${enc.doctor.familyName}${enc.doctor.givenName}`,
          },
        },
      ],
      period: {
        start: enc.createdAt.toISOString(),
        end: enc.signedAt?.toISOString(),
      },
    };

    // type from appointment
    if (enc.appointment?.type) {
      const typeMap: Record<string, string> = {
        INITIAL: '초진',
        FOLLOW_UP: '재진',
        URGENT: '응급',
        ROUTINE: '정기',
      };
      encounter.type = [
        {
          coding: [
            {
              system: 'urn:hospital-run:appointment-type',
              code: enc.appointment.type,
              display: typeMap[enc.appointment.type] ?? enc.appointment.type,
            },
          ],
        },
      ];
    }

    // reasonCode from subjective
    if (enc.subjective) {
      encounter.reasonCode = [{ text: enc.subjective }];
    }

    // diagnosis from encounter diagnoses
    if (enc.diagnoses?.length) {
      encounter.diagnosis = enc.diagnoses.map((d: any) => ({
        condition: {
          reference: `Condition/${d.id}`,
          display: d.diagnosisCode.nameKo,
        },
        use: {
          coding: [
            {
              system:
                'http://terminology.hl7.org/CodeSystem/diagnosis-role',
              code: d.type === 'PRIMARY' ? 'AD' : 'DD',
              display:
                d.type === 'PRIMARY'
                  ? 'Admission diagnosis'
                  : 'Discharge diagnosis',
            },
          ],
        },
      }));
    }

    return encounter;
  }

  private mapMedicationRequestToFhir(rx: any): FhirMedicationRequest {
    // 상태 정본 하나(common/fhir-medication-status) — DISCONTINUED → stopped

    const dosageText = [rx.dosage, rx.frequency, rx.duration ? `${rx.duration}일` : null]
      .filter(Boolean)
      .join(' ');

    return {
      resourceType: 'MedicationRequest',
      id: rx.id,
      status: fhirMedicationRequestStatus(rx.status) as FhirMedicationRequest['status'],
      intent: 'order',
      medicationCodeableConcept: {
        coding: [
          {
            system: 'urn:hospital-run:medication',
            code: rx.medicationCode.code,
            display: rx.medicationCode.nameKo,
          },
        ],
        text: rx.medicationCode.nameKo,
      },
      subject: {
        reference: `Patient/${rx.encounter?.patientId}`,
      },
      encounter: {
        reference: `Encounter/${rx.encounterId}`,
      },
      requester: {
        reference: `Practitioner/${rx.encounter?.doctorId}`,
        display: rx.encounter?.doctor
          ? `${rx.encounter.doctor.familyName}${rx.encounter.doctor.givenName}`
          : undefined,
      },
      dosageInstruction: dosageText
        ? [
            {
              text: dosageText,
              route: rx.route
                ? { text: rx.route }
                : undefined,
            },
          ]
        : undefined,
      authoredOn: rx.createdAt.toISOString(),
    };
  }

  private mapConditionToFhir(d: any): FhirCondition {
    const diagCode = d.diagnosisCode;

    // Use ICD-10 code if available, otherwise use KCD-8
    const codingSystem =
      diagCode.icd10Code
        ? 'http://hl7.org/fhir/sid/icd-10'
        : `urn:oid:2.16.840.1.113883.6.256`; // KCD-8 OID
    const codeValue = diagCode.icd10Code ?? diagCode.code;

    return {
      resourceType: 'Condition',
      id: d.id,
      clinicalStatus: {
        coding: [
          {
            system:
              'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
            display: 'Active',
          },
        ],
      },
      code: {
        coding: [
          {
            system: codingSystem,
            code: codeValue,
            display: diagCode.nameKo,
          },
          // Always include KCD-8 as secondary coding
          ...(diagCode.icd10Code
            ? [
                {
                  system: 'urn:oid:2.16.840.1.113883.6.256',
                  code: diagCode.code,
                  display: diagCode.nameKo,
                },
              ]
            : []),
        ],
        text: diagCode.nameKo,
      },
      subject: {
        reference: `Patient/${d.encounter.patientId}`,
      },
      encounter: {
        reference: `Encounter/${d.encounterId}`,
      },
      recordedDate: d.encounter.createdAt.toISOString(),
    };
  }

  // ── Practitioner Mapper ──

  private mapPractitionerToFhir(user: any): FhirPractitioner {
    const qualCode = user.role === 'DOCTOR' ? 'MD' : 'RN';
    const qualDisplay = user.role === 'DOCTOR' ? 'Doctor of Medicine' : 'Registered Nurse';

    return {
      resourceType: 'Practitioner',
      id: user.id,
      identifier: [
        {
          system: 'urn:oid:hospital-run:employee',
          value: user.id,
        },
      ],
      name: [
        {
          family: user.familyName,
          given: [user.givenName],
          text: `${user.familyName}${user.givenName}`,
        },
      ],
      telecom: [
        { system: 'email', value: user.email },
      ],
      qualification: [
        {
          code: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0360',
                code: qualCode,
                display: qualDisplay,
              },
            ],
          },
        },
      ],
      active: user.isActive,
    };
  }

  // ── Organization Builder ──

  private buildOrganization(): FhirOrganization {
    return {
      resourceType: 'Organization',
      id: 'hospital-run',
      name: 'Hospital RUN',
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/organization-type',
              code: 'prov',
              display: 'Healthcare Provider',
            },
          ],
        },
      ],
      telecom: [
        { system: 'phone', value: '+82-2-0000-0000' },
        { system: 'email', value: 'admin@hospitalrun.example' },
      ],
      address: [
        {
          line: ['서울특별시 강남구'],
          city: '서울',
          country: 'KR',
        },
      ],
      active: true,
    };
  }

  // ── AllergyIntolerance Mapper ──

  private mapAllergyToFhir(allergy: any): FhirAllergyIntolerance {
    const categoryMap: Record<string, string> = {
      DRUG: 'medication',
      FOOD: 'food',
      ENVIRONMENTAL: 'environment',
      LATEX: 'environment',
      OTHER: 'environment',
    };

    const criticalityMap: Record<string, FhirAllergyIntolerance['criticality']> = {
      MILD: 'low',
      MODERATE: 'low',
      SEVERE: 'high',
      LIFE_THREATENING: 'high',
    };

    const clinicalCode = allergy.isActive ? 'active' : 'inactive';

    const result: FhirAllergyIntolerance = {
      resourceType: 'AllergyIntolerance',
      id: allergy.id,
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
            code: clinicalCode,
            display: clinicalCode.charAt(0).toUpperCase() + clinicalCode.slice(1),
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
            code: allergy.verificationStatus === 'CONFIRMED' ? 'confirmed' : 'unconfirmed',
          },
        ],
      },
      category: [categoryMap[allergy.type] ?? 'environment'],
      criticality: criticalityMap[allergy.severity] ?? 'unable-to-assess',
      code: {
        coding: allergy.allergenCode
          ? [{ system: 'urn:hospital-run:allergen', code: allergy.allergenCode }]
          : undefined,
        text: allergy.allergen,
      },
      patient: {
        reference: `Patient/${allergy.patientId}`,
      },
      recordedDate: allergy.createdAt.toISOString(),
    };

    if (allergy.onsetDate) {
      result.onsetDateTime = allergy.onsetDate.toISOString().split('T')[0];
    }
    if (allergy.notes) {
      result.note = [{ text: allergy.notes }];
    }

    return result;
  }

  // ── Procedure Mapper ──

  private mapProcedureToFhir(surgery: any): FhirProcedure {
    const statusMap: Record<string, FhirProcedure['status']> = {
      SCHEDULED: 'preparation',
      IN_PROGRESS: 'in-progress',
      COMPLETED: 'completed',
      CANCELLED: 'not-done',
    };

    const result: FhirProcedure = {
      resourceType: 'Procedure',
      id: surgery.id,
      status: statusMap[surgery.status] ?? 'unknown',
      code: {
        coding: surgery.procedureCode
          ? [
              {
                system: 'urn:hospital-run:procedure',
                code: surgery.procedureCode,
                display: surgery.procedureName,
              },
            ]
          : undefined,
        text: surgery.procedureName,
      },
      subject: {
        reference: `Patient/${surgery.patientId}`,
        display: surgery.patient
          ? `${surgery.patient.familyName}${surgery.patient.givenName}`
          : undefined,
      },
      performer: [
        {
          actor: {
            reference: `Practitioner/${surgery.surgeonId}`,
            display: surgery.surgeon
              ? `${surgery.surgeon.familyName}${surgery.surgeon.givenName}`
              : undefined,
          },
        },
      ],
    };

    if (surgery.startedAt && surgery.endedAt) {
      result.performedPeriod = {
        start: surgery.startedAt.toISOString(),
        end: surgery.endedAt.toISOString(),
      };
    } else {
      result.performedDateTime = surgery.scheduledAt.toISOString();
    }

    if (surgery.opNote) {
      result.note = [{ text: surgery.opNote }];
    }

    return result;
  }

  // ── Appointment Mapper ──

  private mapAppointmentToFhir(appt: any): FhirAppointment {
    const statusMap: Record<string, FhirAppointment['status']> = {
      SCHEDULED: 'booked',
      CHECKED_IN: 'arrived',
      IN_PROGRESS: 'fulfilled',
      COMPLETED: 'fulfilled',
      CANCELLED: 'cancelled',
      NO_SHOW: 'noshow',
    };

    const endTime = new Date(appt.scheduledAt);
    endTime.setMinutes(endTime.getMinutes() + (appt.duration ?? 30));

    const result: FhirAppointment = {
      resourceType: 'Appointment',
      id: appt.id,
      status: statusMap[appt.status] ?? 'booked',
      start: appt.scheduledAt.toISOString(),
      end: endTime.toISOString(),
      minutesDuration: appt.duration ?? 30,
      participant: [
        {
          actor: {
            reference: `Patient/${appt.patientId}`,
            display: appt.patient
              ? `${appt.patient.familyName}${appt.patient.givenName}`
              : undefined,
          },
          status: 'accepted',
        },
        {
          actor: {
            reference: `Practitioner/${appt.doctorId}`,
            display: appt.doctor
              ? `${appt.doctor.familyName}${appt.doctor.givenName}`
              : undefined,
          },
          status: 'accepted',
        },
      ],
      created: appt.createdAt.toISOString(),
    };

    if (appt.type) {
      const typeMap: Record<string, string> = {
        INITIAL: '초진',
        FOLLOW_UP: '재진',
        URGENT: '응급',
        ROUTINE: '정기',
      };
      result.appointmentType = {
        coding: [
          {
            system: 'urn:hospital-run:appointment-type',
            code: appt.type,
            display: typeMap[appt.type] ?? appt.type,
          },
        ],
      };
    }

    if (appt.reason) {
      result.reasonCode = [{ text: appt.reason }];
    }

    return result;
  }

  // ── DiagnosticReport Mapper ──

  private mapDiagnosticReportToFhir(lr: any): FhirDiagnosticReport {
    const statusMap: Record<string, FhirDiagnosticReport['status']> = {
      PENDING: 'registered',
      COLLECTED: 'preliminary',
      IN_PROGRESS: 'partial',
      COMPLETED: 'final',
      VERIFIED: 'final', // 독립검증 확정 — final(누락 시 unknown이 되어 status=final 조회에서 제외되던 것)
    };

    const procedureCode = lr.order?.prescription?.procedureCode;

    const result: FhirDiagnosticReport = {
      resourceType: 'DiagnosticReport',
      id: lr.id,
      status: statusMap[lr.status] ?? 'unknown',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
              code: 'LAB',
              display: 'Laboratory',
            },
          ],
        },
      ],
      code: procedureCode
        ? {
            coding: [
              ...(procedureCode.loincCode ? [{ system: 'http://loinc.org', code: procedureCode.loincCode, display: procedureCode.nameKo }] : []),
              {
                system: 'urn:hospital-run:procedure',
                code: procedureCode.code,
                display: procedureCode.nameKo,
              },
            ],
            text: procedureCode.nameKo,
          }
        : { text: 'Lab Result' },
      subject: {
        reference: `Patient/${lr.patientId}`,
      },
      issued: lr.completedAt?.toISOString() ?? lr.createdAt.toISOString(),
      performer: [
        {
          reference: `Practitioner/${lr.technicianId}`,
          display: lr.technician
            ? `${lr.technician.familyName}${lr.technician.givenName}`
            : undefined,
        },
      ],
    };

    // Map LabResultItems as Observation references
    if (lr.items?.length) {
      result.result = lr.items.map((item: any) => ({
        reference: `Observation/${item.id}`,
        display: `${item.testName} ${item.value} ${item.unit}`,
      }));
    }

    if (lr.notes) {
      result.conclusion = lr.notes;
    }

    return result;
  }

  // ── ServiceRequest Mapper ──

  /** 병리 EDI 프리픽스 — config `fhir.pathologyEdiPrefixes`(JSON 배열) 우선, 기본 세트 폴백 */
  private async getPathologyPrefixes(): Promise<string[] | null> {
    const v = await this.configRuntime?.get('fhir.pathologyEdiPrefixes').catch(() => null);
    return Array.isArray(v) ? (v as string[]) : null;
  }

  private mapServiceRequestToFhir(order: any, pathologyPrefixes?: string[] | null): FhirServiceRequest {
    const priorityMap: Record<string, FhirServiceRequest['priority']> = {
      STAT: 'stat',
      ROUTINE: 'routine',
      PRN: 'urgent',
      STANDING: 'routine',
    };

    const rx = order.prescription;
    const code = rx?.procedureCode ?? rx?.medicationCode;

    const result: FhirServiceRequest = {
      resourceType: 'ServiceRequest',
      id: order.id,
      // LIS 증분 폴링 커서(H2) — 검색 필터(_lastUpdated)와 동일 소스(Order.updatedAt)
      ...(order.updatedAt ? { meta: { lastUpdated: new Date(order.updatedAt).toISOString() } } : {}),
      status: fhirServiceRequestStatus(order.status),
      intent: 'order',
      priority: priorityMap[order.priority] ?? 'routine',
      category: [
        {
          coding: [
            // 표준 FHIR category(v2-0074) — 외부 시스템(LIS)의 category 필터 지원
            {
              system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
              code: order.department === 'LAB' ? 'LAB' : 'RAD',
              display: order.department === 'LAB' ? 'Laboratory' : 'Radiology imaging',
            },
            {
              system: 'urn:hospital-run:order-department',
              code: order.department,
              display: order.department === 'LAB' ? 'Laboratory' : 'Imaging',
            },
            // 병리 라우팅 병기(LIS PathologyCase 자동 생성) — laboratory 폴링 필터에는 무영향(추가만)
            ...(order.department === 'LAB' && isPathologyEdiCode(order.prescription?.procedureCode?.code, pathologyPrefixes)
              ? [PATHOLOGY_CATEGORY_CODING]
              : []),
          ],
        },
      ],
      authoredOn: order.createdAt.toISOString(),
    };

    if (code) {
      result.code = {
        coding: [
          // 표준 LOINC 우선(검사 오더코드에 매핑돼 있을 때) — 외부 소비자가 LOINC로 오더 매칭.
          ...(code.loincCode ? [{ system: 'http://loinc.org', code: code.loincCode, display: code.nameKo }] : []),
          {
            system: 'urn:hospital-run:procedure',
            code: code.code,
            display: code.nameKo,
          },
        ],
        text: code.nameKo,
      };
    }

    if (rx?.encounter) {
      result.subject = {
        reference: `Patient/${rx.encounter.patientId}`,
        // MRN 동봉 — 외부(LIS·PACS) 환자 매칭 축(컷오버 정합). 이름은 미동봉(연동 규칙: 이름 매칭 금지)
        ...(rx.encounter.patient?.mrn
          ? { identifier: { system: 'urn:hospital-run:mrn', value: rx.encounter.patient.mrn } }
          : {}),
      };
      result.encounter = {
        reference: `Encounter/${rx.encounterId}`,
      };
      result.requester = {
        reference: `Practitioner/${rx.encounter.doctorId}`,
        display: rx.encounter.doctor
          ? `${rx.encounter.doctor.familyName}${rx.encounter.doctor.givenName}`
          : undefined,
      };
    }

    return result;
  }

  // ── Location Mappers ──

  private mapWardToFhir(ward: any): FhirLocation {
    return {
      resourceType: 'Location',
      id: ward.id,
      name: ward.name,
      description: `${ward.floor}층 병동`,
      status: ward.isActive ? 'active' : 'inactive',
      mode: 'instance',
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
              code: 'HU',
              display: 'Hospital unit',
            },
          ],
        },
      ],
      physicalType: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/location-physical-type',
            code: 'wa',
            display: 'Ward',
          },
        ],
      },
    };
  }

  private mapBedToFhir(bed: any): FhirLocation {
    const statusMap: Record<string, FhirLocation['status']> = {
      AVAILABLE: 'active',
      OCCUPIED: 'active',
      RESERVED: 'active',
      MAINTENANCE: 'suspended',
    };

    return {
      resourceType: 'Location',
      id: bed.id,
      name: `${bed.roomNumber}-${bed.bedNumber}`,
      description: bed.ward ? `${bed.ward.name} ${bed.roomNumber}호 ${bed.bedNumber}번 침대` : undefined,
      status: statusMap[bed.status] ?? 'active',
      mode: 'instance',
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
              code: 'BED',
              display: 'Bed',
            },
          ],
        },
      ],
      physicalType: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/location-physical-type',
            code: 'bd',
            display: 'Bed',
          },
        ],
      },
      partOf: bed.wardId
        ? { reference: `Location/${bed.wardId}` }
        : undefined,
    };
  }

  // ── CarePlan Mappers ──

  private mapRehabPlanToCarePlan(rp: any): FhirCarePlan {
    const statusMap: Record<string, FhirCarePlan['status']> = {
      ACTIVE: 'active',
      COMPLETED: 'completed',
      CANCELLED: 'revoked',
      PAUSED: 'on-hold',
    };

    const therapies = Array.isArray(rp.therapies) ? rp.therapies : [];

    return {
      resourceType: 'CarePlan',
      id: rp.id,
      status: statusMap[rp.status] ?? 'active',
      intent: 'plan',
      category: [
        {
          coding: [
            {
              system: 'urn:hospital-run:careplan-category',
              code: 'rehabilitation',
              display: '재활',
            },
          ],
        },
      ],
      title: `재활 계획 — ${rp.diagnosis}`,
      subject: {
        reference: `Patient/${rp.patientId}`,
        display: rp.patient
          ? `${rp.patient.familyName}${rp.patient.givenName}`
          : undefined,
      },
      period: {
        start: rp.startDate?.toISOString?.() ?? rp.startDate,
        end: rp.endDate?.toISOString?.() ?? rp.endDate ?? undefined,
      },
      author: {
        reference: `Practitioner/${rp.prescribedBy}`,
        display: rp.prescriber
          ? `${rp.prescriber.familyName}${rp.prescriber.givenName}`
          : undefined,
      },
      activity: therapies.map((t: Record<string, unknown>) => ({
        detail: {
          kind: 'ServiceRequest',
          code: { text: String(t.type ?? t.name ?? '') },
          status: 'scheduled',
          description: String(t.description ?? t.name ?? ''),
          scheduledString: rp.frequency,
        },
      })),
      note: rp.notes ? [{ text: rp.notes }] : undefined,
    };
  }

  private mapDietOrderToCarePlan(d: any): FhirCarePlan {
    const activities: FhirCarePlan['activity'] = [];

    if (d.dietType) {
      activities.push({
        detail: {
          kind: 'NutritionOrder',
          code: { text: d.dietType },
          status: d.isActive ? 'in-progress' : 'completed',
          description: [
            d.calorieTarget ? `열량: ${d.calorieTarget}kcal` : null,
            d.proteinTarget ? `단백질: ${d.proteinTarget}g` : null,
            d.fluidLimit ? `수분: ${d.fluidLimit}ml` : null,
            d.texture ? `형태: ${d.texture}` : null,
          ].filter(Boolean).join(', '),
        },
      });
    }

    return {
      resourceType: 'CarePlan',
      id: d.id,
      status: d.isActive ? 'active' : 'completed',
      intent: 'order',
      category: [
        {
          coding: [
            {
              system: 'urn:hospital-run:careplan-category',
              code: 'diet',
              display: '영양',
            },
          ],
        },
      ],
      title: `영양 계획 — ${d.dietType}`,
      subject: {
        reference: `Patient/${d.patientId}`,
        display: d.patient
          ? `${d.patient.familyName}${d.patient.givenName}`
          : undefined,
      },
      period: {
        start: d.startDate?.toISOString?.() ?? d.startDate,
        end: d.endDate?.toISOString?.() ?? d.endDate ?? undefined,
      },
      author: {
        reference: `Practitioner/${d.orderedBy}`,
        display: d.orderer
          ? `${d.orderer.familyName}${d.orderer.givenName}`
          : undefined,
      },
      activity: activities,
      note: d.notes ? [{ text: d.notes }] : undefined,
    };
  }

  // ── DocumentReference Mappers ──

  private mapConsentToDocRef(consent: any): FhirDocumentReference {
    return {
      resourceType: 'DocumentReference',
      id: consent.id,
      status: consent.isValid ? 'current' : 'superseded',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '59284-0',
            display: 'Consent Document',
          },
        ],
        text: consent.templateName,
      },
      category: [
        {
          coding: [
            {
              system: 'urn:hospital-run:document-category',
              code: 'consent',
              display: '동의서',
            },
          ],
        },
      ],
      subject: {
        reference: `Patient/${consent.patientId}`,
        display: consent.patient
          ? `${consent.patient.familyName}${consent.patient.givenName}`
          : undefined,
      },
      date: consent.createdAt?.toISOString?.() ?? consent.createdAt,
      description: `${consent.type} — ${consent.templateName}`,
      content: [
        {
          attachment: {
            contentType: 'application/json',
            title: consent.templateName,
            creation: consent.signedAt?.toISOString?.() ?? consent.createdAt?.toISOString?.(),
          },
        },
      ],
    };
  }

  /**
   * 트윈 write-back 문서 → FHIR DocumentReference.
   * 🔴 AI 생성물이면 그렇게 밝힌다(AI기본법 §31 · 표기는 shared 정본에서 온다) — 소비처가
   *    사람이 쓴 기록과 구분할 수 있어야 한다.
   */
  private mapTwinDocToDocRef(d: {
    id: string; patientId: string; status: string; docType: string | null; description: string | null;
    contentText: string | null; aiGenerated: boolean; authorFhirUser: string | null; createdAt: Date;
  }): FhirDocumentReference {
    const status: FhirDocumentReference['status'] =
      d.status === 'superseded' || d.status === 'entered-in-error' ? d.status : 'current';
    return {
      resourceType: 'DocumentReference',
      id: d.id,
      status,
      type: { text: d.docType ?? 'SBAR' },
      category: d.aiGenerated ? [{ text: AI_ORIGIN_TEXT }] : undefined,
      subject: { reference: `Patient/${d.patientId}` },
      date: d.createdAt.toISOString(),
      author: d.authorFhirUser ? [{ reference: d.authorFhirUser }] : undefined,
      description: d.aiGenerated
        ? `${AI_ORIGIN_TEXT} ${d.description ?? d.docType ?? 'SBAR'}`
        : (d.description ?? undefined),
      content: d.contentText
        ? [{ attachment: { contentType: 'text/plain', data: Buffer.from(d.contentText, 'utf-8').toString('base64'), creation: d.createdAt.toISOString() } }]
        : undefined,
    };
  }

  private mapLabAttachmentToDocRef(attachment: any): FhirDocumentReference {
    return {
      resourceType: 'DocumentReference',
      id: attachment.id,
      status: 'current',
      type: {
        coding: [
          {
            system: 'urn:hospital-run:document-type',
            code: attachment.type,
            display: attachment.type,
          },
        ],
        text: attachment.fileName,
      },
      category: [
        {
          coding: [
            {
              system: 'urn:hospital-run:document-category',
              code: 'lab-attachment',
              display: '검사 첨부',
            },
          ],
        },
      ],
      subject: {
        reference: `Patient/${attachment.labResult?.patientId}`,
      },
      date: attachment.uploadedAt?.toISOString?.() ?? attachment.uploadedAt,
      author: attachment.uploader
        ? [
            {
              display: `${attachment.uploader.familyName}${attachment.uploader.givenName}`,
            },
          ]
        : undefined,
      description: attachment.description ?? attachment.fileName,
      content: [
        {
          attachment: {
            contentType: attachment.mimeType,
            url: attachment.fileUrl,
            title: attachment.fileName,
            creation: attachment.uploadedAt?.toISOString?.() ?? attachment.uploadedAt,
          },
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Immunization Resource
  // ═══════════════════════════════════════════════════════════════

  @Get('Immunization')
  @UseGuards(FhirDualAuthGuard)
  @ApiOperation({ summary: 'FHIR Immunization 검색' })
  async searchImmunizations(@Query('patient') patient?: string, @Query('subject') subject?: string) {
    patient = patientSearchRef(patient, subject);
    const where: Record<string, unknown> = {};
    // FHIR 참조 정규화 — patient='Patient/<uuid>' 형식 허용(prefix 제거). 미제거 시 UUID 컬럼 질의 500
    if (patient) where.patientId = patient.replace(/^Patient\//, '');

    const vaccinations = await this.prisma.vaccination.findMany({
      where,
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT } },
      orderBy: { administeredAt: 'desc' },
      take: 100,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: vaccinations.length,
      entry: vaccinations.map(v => ({
        resource: this.mapVaccinationToImmunization(v),
      })),
    };
  }

  @Get('Immunization/:id')
  @UseGuards(FhirDualAuthGuard)
  @ApiOperation({ summary: 'FHIR Immunization 조회' })
  async getImmunization(@Param('id') id: string) {
    const vaccination = await this.prisma.vaccination.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });
    if (!vaccination) throw new NotFoundException('Immunization not found');
    return this.mapVaccinationToImmunization(vaccination);
  }

  /**
   * 🔴 **유령 필드가 넷 있었다**(2026-08-29 실측): `status`·`site`·`route`·`dose` 는
   *    `Vaccination` 모델에 **없다**. 매퍼 인자가 `any` 라 컴파일러가 잡지 못했다.
   *
   * 🔴 그중 `status` 는 **틀린 값을 내보냈다** — `undefined === 'COMPLETED'` 가 false 라
   *    모든 접종 기록이 `not-done`(접종하지 않음)으로 나갔다. 받는 시스템은 환자를
   *    **미접종으로 읽는다.** 나머지 셋은 `undefined` 라 조용히 빠졌을 뿐이다.
   *
   * 🔴 `site`·`route`·`dose` 는 **되살리지 않는다** — 저장하는 데가 없다.
   *    없는 것을 내보내려면 먼저 기록할 자리가 있어야 한다(지어내지 않는다).
   */
  private mapVaccinationToImmunization(v: {
    id: string; patientId: string; vaccineName: string; vaccineCode: string | null;
    doseNumber: number; administeredAt: Date; administeredBy: string | null;
    lotNumber: string | null; notes: string | null;
  }) {
    return {
      resourceType: 'Immunization',
      id: v.id,
      // 🔴 이 표에는 상태 컬럼이 없다 — **기록이 존재한다 = 접종했다**가 이 표의 의미다.
      //    (예정 접종은 `nextDueAt` 이라는 다른 사실이고 이 자원이 아니다)
      status: 'completed',
      vaccineCode: {
        coding: [
          { system: 'urn:oid:1.2.410.100110.40.4.5.1', code: v.vaccineCode ?? v.vaccineName, display: v.vaccineName },
        ],
        text: v.vaccineName,
      },
      patient: { reference: `Patient/${v.patientId}` },
      occurrenceDateTime: v.administeredAt?.toISOString?.() ?? v.administeredAt,
      lotNumber: v.lotNumber ?? undefined,
      // 🔴 **접종 차수는 임상적으로 중요한데 통째로 빠져 있었다** — 1차와 3차는 다른 사실이다.
      protocolApplied: [{ doseNumberPositiveInt: v.doseNumber }],
      performer: v.administeredBy ? [{ actor: { display: v.administeredBy } }] : undefined,
      note: v.notes ? [{ text: v.notes }] : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Medication Resource
  // ═══════════════════════════════════════════════════════════════

  @Get('Medication')
  @UseGuards(FhirDualAuthGuard)
  @ApiOperation({ summary: 'FHIR Medication 검색' })
  async searchMedications(@Query('code') code?: string, @Query('name') name?: string) {
    // 한/영 병용 P1(D2): name 파라미터는 공용 빌더(nameKo·nameEn·ingredient·code) — code 파라미터는 정확 일치 유지
    const where: Record<string, unknown> = {};
    if (code) where.code = code;
    if (name) Object.assign(where, buildMedicationSearchWhere(name));

    const medications = await this.prisma.medicationCode.findMany({
      where,
      take: 50,
    });

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: medications.length,
      entry: medications.map(m => ({
        resource: this.mapMedicationCodeToMedication(m),
      })),
    };
  }

  @Get('Medication/:id')
  @UseGuards(FhirDualAuthGuard)
  @ApiOperation({ summary: 'FHIR Medication 조회' })
  async getMedication(@Param('id') id: string) {
    const med = await this.prisma.medicationCode.findUnique({ where: { id } });
    if (!med) throw new NotFoundException('Medication not found');
    return this.mapMedicationCodeToMedication(med);
  }

  private mapMedicationCodeToMedication(m: any) {
    return {
      resourceType: 'Medication',
      id: m.id,
      code: {
        coding: [
          { system: 'urn:oid:1.2.410.100110.40.4.5.1', code: m.code, display: m.nameKo },
          // 한/영 병용 P3(D7): 죽은 atcCode 분기(모델에 필드 없음) 제거 — nameEn 있으면 영문 display coding 추가
          ...(m.nameEn ? [{ system: 'urn:oid:1.2.410.100110.40.4.5.1', code: m.code, display: m.nameEn }] : []),
        ],
        text: m.nameKo,
      },
      status: m.isActive !== false ? 'active' : 'inactive',
      // 🔴 종전 `m.formulation` 은 **모델에 없는 이름**이라 제형이 늘 빠졌다(실제는 `dosageForm`).
      form: m.dosageForm ? { text: m.dosageForm } : undefined,
      ingredient: m.ingredient ? [{ itemCodeableConcept: { text: m.ingredient } }] : undefined,
      // 🔴 `batch: { expirationDate: undefined }` 는 **빈 객체**만 내보냈다(로트·유효기간은
      //    이 표에 없다). 없는 것을 자리만 만들어 내보내지 않는다.
      extension: [
        ...(m.controlSchedule ? [{ url: 'urn:hospital-run:control-schedule', valueString: m.controlSchedule }] : []),
        // 🔴 종전 `m.highAlert` 도 없는 이름이라 **고위험 약물 표시가 FHIR 로 나간 적이 없다**(실제는 `highAlertFlag`)
        ...(m.highAlertFlag ? [{ url: 'urn:hospital-run:high-alert', valueBoolean: true }] : []),
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Observation Resource (Lab Results)
  // ═══════════════════════════════════════════════════════════════

  @Get('Observation')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Observation', 'read')
  @ApiOperation({ summary: 'FHIR Observation 검색 (검사결과·GCS/의식·Child-Pugh/복수)' })
  async searchObservations(
    @Query('patient') patient?: string,
    @Query('code') code?: string,
    @Query('date') date?: string,
    @Query('category') category?: string,
    @Query('subject') subject?: string,
  ) {
    patient = patientSearchRef(patient, subject);
    // FHIR 참조 정규화 — patient='Patient/<uuid>' 형식 허용(prefix 제거). 미제거 시 UUID 컬럼 질의 500
    if (patient) patient = patient.replace(/^Patient\//, '');
    const catNorm = (category ?? '').toLowerCase();
    const wantLab = !catNorm || catNorm.includes('lab');
    const wantVitalsSurvey = !catNorm || catNorm.includes('vital') || catNorm.includes('survey') || catNorm.includes('exam');
    const results: Record<string, unknown>[] = [];
    // date 파라미터(이후, gte) — 과거 선언만 하고 무시되어 클라이언트가 필터됐다고 오인하던 것 구현.
    const sinceDate = date ? new Date(date) : null;
    const since = sinceDate && !isNaN(sinceDate.getTime()) ? sinceDate : null;

    // 1) 검사결과(LabResultItem)
    if (wantLab) {
      const where: Record<string, unknown> = {};
      const labResultFilter: Record<string, unknown> = {};
      if (patient) labResultFilter.patientId = patient;
      if (since) labResultFilter.completedAt = { gte: since };
      if (Object.keys(labResultFilter).length) where.labResult = labResultFilter;
      // code 필터 — LOINC(loincCode)·내부코드(testCode)·검사명(testName) 어느 것으로도 매칭(표준 LOINC 질의 지원).
      if (code) where.OR = [{ loincCode: code }, { testCode: code }, { testName: code }];
      const items = await this.prisma.labResultItem.findMany({
        where, include: { labResult: { include: { patient: { omit: PATIENT_SENSITIVE_OMIT } } } }, take: 100,
      });
      results.push(...items.map((item) => this.mapLabResultItemToObservation(item)));
    }

    // 2) GCS/의식(FlowSheetEntry) + Child-Pugh/복수(InternalMedicineExam) — 트윈 위험점수(CURB-65·Child-Pugh)용.
    //    patient 지정 시에만(전역 스캔 방지). code 지정 시 아래 공통 필터로 최종 선별.
    if (patient && wantVitalsSurvey) {
      // 2-a) 활력징후 — 외래(PreVisitVitals). category=vital-signs 가 GCS 만 돌려주던 갭 봉합.
      const opdVitals = await this.prisma.preVisitVitals.findMany({
        where: { patientId: patient, ...(since ? { measuredAt: { gte: since } } : {}) },
        orderBy: { measuredAt: 'desc' }, take: 50,
      });
      for (const v of opdVitals) results.push(...this.mapVitalsToObservations(v as unknown as Record<string, unknown>, patient, `opd-${v.id}`, v.measuredAt));

      // 2-b) 활력징후 + GCS/의식 — 입원(FlowSheetEntry). 활력이 하나라도 있으면 관측치 생성.
      const flows = await this.prisma.flowSheetEntry.findMany({
        where: { admission: { patientId: patient }, ...(since ? { recordedAt: { gte: since } } : {}) },
        orderBy: { recordedAt: 'desc' }, take: 50,
      });
      for (const f of flows) results.push(...this.mapVitalsToObservations(f as unknown as Record<string, unknown>, patient, `ipd-${f.id}`, f.recordedAt));
      for (const f of flows) results.push(...this.mapFlowSheetToObservations(f, patient));

      const exams = await this.prisma.internalMedicineExam.findMany({
        where: { patientId: patient, OR: [{ childPughScore: { not: null } }, { childPughClass: { not: null } }, { ascites: { not: null } }, { meldScore: { not: null } }], ...(since ? { examinedAt: { gte: since } } : {}) },
        orderBy: { examinedAt: 'desc' }, take: 20,
      });
      for (const e of exams) results.push(...this.mapImExamToObservations(e, patient));

      // 유치기구(중심정맥관 등) — HAI 감시(HaiCase) 기반. VTE 위험점수(Caprini 중심정맥관 2점)용.
      // ⚠ 전체 기구가 아니라 감염감시 대상 라인만 — 완전한 device 레지스트리 아님(Device 리소스 부재).
      const devices = await this.prisma.haiCase.findMany({
        where: { patientId: patient, deviceType: { not: null }, ...(since ? { deviceInsertedAt: { gte: since } } : {}) },
        orderBy: { deviceInsertedAt: 'desc' }, take: 20,
      });
      for (const d of devices) results.push(...this.mapHaiDeviceToObservations(d, patient));
    }

    // code(LOINC/내부코드) 최종 필터 — 비검사 관측치에도 적용.
    // 🔴 혈압은 패널(85354-9) 아래 component 로 들어가므로 component.code 까지 봐야 `code=8480-6` 질의가 산다.
    const matchesCode = (o: Record<string, unknown>): boolean => {
      const top = ((o.code as { coding?: { code?: string }[] })?.coding ?? []).some((c) => c.code === code);
      if (top) return true;
      const components = (o.component as { code?: { coding?: { code?: string }[] } }[] | undefined) ?? [];
      return components.some((cp) => (cp.code?.coding ?? []).some((c) => c.code === code));
    };
    const filtered = code ? results.filter(matchesCode) : results;

    return { resourceType: 'Bundle', type: 'searchset', total: filtered.length, entry: filtered.map((r) => ({ resource: r })) };
  }

  /**
   * FHIR Vital Signs 단일값 항목 — 코드(LOINC)·표시단위·UCUM·정밀도는 전부 NUMERIC_POLICIES 정본에서 온다.
   * 혈압은 프로파일상 패널(85354-9)+component 라 아래 매핑에서 별도 처리한다.
   */
  private static readonly VITAL_SIGN_FIELDS: { field: string; policyKey: string; display: string }[] = [
    { field: 'heartRate', policyKey: 'heartRate', display: 'Heart rate' },
    { field: 'respiratoryRate', policyKey: 'respiratoryRate', display: 'Respiratory rate' },
    { field: 'temperature', policyKey: 'temperature', display: 'Body temperature' },
    { field: 'spo2', policyKey: 'spo2', display: 'Oxygen saturation in Arterial blood by Pulse oximetry' },
    { field: 'weight', policyKey: 'weight', display: 'Body weight' },
    { field: 'height', policyKey: 'height', display: 'Body height' },
    { field: 'bmi', policyKey: 'bmi', display: 'Body mass index (BMI) [Ratio]' },
  ];

  /**
   * 활력징후(외래 PreVisitVitals·입원 FlowSheetEntry) → FHIR Vital Signs Observation.
   *
   * 🔴 배경: `Observation?category=vital-signs` 가 GCS·의식수준만 돌려주고 실제 활력(체온·혈압·맥박·
   *    SpO₂·호흡수)은 **0건**이었다. 외부 SMART 앱·트윈은 "활력 기록이 없다"로 읽는다 — 값이 틀린 것보다
   *    조용한 부재가 위험하다. 코드/단위/정밀도는 화면·저장과 같은 정책 정본을 쓴다.
   */
  private mapVitalsToObservations(v: Record<string, unknown>, patientId: string, idSuffix: string, at?: Date | null): Record<string, unknown>[] {
    const base = {
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: at?.toISOString?.() ?? undefined,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
    };
    const out: Record<string, unknown>[] = [];

    for (const f of FhirController.VITAL_SIGN_FIELDS) {
      const policy = policyOf(f.policyKey);
      // LOINC 미등재 도메인은 내보내지 않는다(코드 없는 Observation 은 소비 불가)
      if (!policy?.loincCode) continue;
      const valueQuantity = fhirQuantity(v[f.field], { policyKey: f.policyKey });
      if (!valueQuantity) continue;
      out.push({
        resourceType: 'Observation', id: `${f.field}-${idSuffix}`, ...base,
        code: { coding: [{ system: 'http://loinc.org', code: policy.loincCode, display: f.display }], text: policy.label },
        valueQuantity,
      });
    }

    // 혈압 — FHIR Vital Signs 프로파일은 패널(85354-9) + 수축기/이완기 component 를 요구한다.
    const systolic = fhirQuantity(v.systolicBp, { policyKey: 'systolicBp' });
    const diastolic = fhirQuantity(v.diastolicBp, { policyKey: 'diastolicBp' });
    if (systolic || diastolic) {
      out.push({
        resourceType: 'Observation', id: `bp-${idSuffix}`, ...base,
        code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel with all children optional' }], text: '혈압' },
        component: [
          ...(systolic ? [{ code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }] }, valueQuantity: systolic }] : []),
          ...(diastolic ? [{ code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }] }, valueQuantity: diastolic }] : []),
        ],
      });
    }

    // 통증점수(NRS 0-10) — 활력이 아니라 survey 범주(LOINC 72514-3).
    if (v.painScore != null) {
      out.push({
        resourceType: 'Observation', id: `pain-${idSuffix}`, ...base,
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'survey', display: 'Survey' }] }],
        code: { coding: [{ system: 'http://loinc.org', code: '72514-3', display: 'Pain severity - 0-10 verbal numeric rating [Score] - Reported' }], text: '통증점수(NRS)' },
        valueInteger: v.painScore,
      });
    }
    return out;
  }

  /** FlowSheetEntry → GCS(LOINC 9269-2)·의식수준(LOINC 80288-4 ACVPU) Observation. */
  private mapFlowSheetToObservations(f: any, patientId: string): Record<string, unknown>[] {
    const base = {
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: f.recordedAt?.toISOString?.() ?? undefined,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
    };
    const out: Record<string, unknown>[] = [];
    if (f.gcsScore != null) {
      out.push({ resourceType: 'Observation', id: `gcs-${f.id}`, ...base,
        code: { coding: [{ system: 'http://loinc.org', code: '9269-2', display: 'Glasgow coma score total' }], text: 'GCS total' },
        valueInteger: f.gcsScore });
    }
    if (f.consciousness) {
      out.push({ resourceType: 'Observation', id: `loc-${f.id}`, ...base,
        code: { coding: [{ system: 'http://loinc.org', code: '80288-4', display: 'Level of consciousness' }], text: '의식수준(ACVPU)' },
        valueCodeableConcept: { coding: [{ system: 'urn:hospital-run:acvpu', code: f.consciousness }], text: f.consciousness } });
    }
    return out;
  }

  /** InternalMedicineExam → Child-Pugh 점수/등급·복수(ascites)·MELD Observation(Child-Pugh 위험점수용). */
  private mapImExamToObservations(e: any, patientId: string): Record<string, unknown>[] {
    const base = {
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: e.examinedAt?.toISOString?.() ?? undefined,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'survey', display: 'Survey' }] }],
    };
    const out: Record<string, unknown>[] = [];
    if (e.childPughScore != null) {
      out.push({ resourceType: 'Observation', id: `cps-${e.id}`, ...base,
        code: { coding: [{ system: 'urn:hospital-run:childpugh', code: 'child-pugh-score', display: 'Child-Pugh score' }], text: 'Child-Pugh 점수' },
        valueInteger: e.childPughScore });
    }
    if (e.childPughClass) {
      out.push({ resourceType: 'Observation', id: `cpc-${e.id}`, ...base,
        code: { coding: [{ system: 'urn:hospital-run:childpugh', code: 'child-pugh-class', display: 'Child-Pugh class' }], text: 'Child-Pugh 등급' },
        valueCodeableConcept: { coding: [{ system: 'urn:hospital-run:childpugh-class', code: e.childPughClass }], text: e.childPughClass } });
    }
    if (e.ascites) {
      out.push({ resourceType: 'Observation', id: `asc-${e.id}`, ...base,
        code: { coding: [{ system: 'urn:hospital-run:hepatic', code: 'ascites', display: 'Ascites grade' }], text: '복수 등급' },
        valueCodeableConcept: { coding: [{ system: 'urn:hospital-run:ascites', code: e.ascites }], text: e.ascites } });
    }
    if (e.meldScore != null) {
      out.push({ resourceType: 'Observation', id: `meld-${e.id}`, ...base,
        code: { coding: [{ system: 'urn:hospital-run:hepatic', code: 'meld-score', display: 'MELD score' }], text: 'MELD 점수' },
        valueInteger: e.meldScore });
    }
    return out;
  }

  /** HaiCase 유치기구 → 기구 존재 Observation(중심정맥관/유치도뇨/인공호흡 등). VTE 위험점수용. */
  private mapHaiDeviceToObservations(d: any, patientId: string): Record<string, unknown>[] {
    if (!d.deviceType) return [];
    const codeMap: Record<string, string> = {
      CENTRAL_LINE: 'central-line', FOLEY: 'urinary-catheter', VENTILATOR: 'ventilator', SURGICAL: 'surgical-device',
    };
    const code = codeMap[d.deviceType] ?? d.deviceType.toLowerCase();
    return [{
      resourceType: 'Observation',
      id: `dev-${d.id}`,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'survey', display: 'Survey' }] }],
      code: { coding: [{ system: 'urn:hospital-run:device', code, display: d.deviceType }], text: `유치기구: ${d.deviceType}` },
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: d.deviceInsertedAt?.toISOString?.() ?? undefined,
      valueCodeableConcept: { coding: [{ system: 'urn:hospital-run:device-status', code: 'present' }], text: d.deviceDays != null ? `present (${d.deviceDays}d)` : 'present' },
      // ⚠ 출처=HAI 감시(감염감시 대상 라인만) — 완전한 기구 레지스트리 아님.
      note: [{ text: 'source: HAI surveillance (not a complete device registry)' }],
    }];
  }

  @Get('Observation/:id')
  @UseGuards(FhirDualAuthGuard)
  @FhirScope('Observation', 'read')
  @ApiOperation({ summary: 'FHIR Observation 조회' })
  async getObservation(@Param('id') id: string) {
    // 검색이 반환하는 합성 id(gcs-/loc-/cps-/cpc-/asc-/meld-/dev-)나 비UUID는 LabResultItem이 아님 →
    // 비UUID로 Prisma를 치면 500이 되므로, 깨끗한 404로 처리(합성 관측치는 검색 전용).
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
      throw new NotFoundException('Observation not found (검색 반환 합성 id는 개별 조회 불가 — 검색을 사용하세요)');
    }
    const item = await this.prisma.labResultItem.findUnique({
      where: { id },
      include: { labResult: { include: { patient: { omit: PATIENT_SENSITIVE_OMIT } } } },
    });
    if (!item) throw new NotFoundException('Observation not found');
    return this.mapLabResultItemToObservation(item);
  }

  private mapLabResultItemToObservation(item: any) {
    const labResult = item.labResult;
    const numericValue = parseFloat(item.value);
    const isNumeric = !isNaN(numericValue) && item.value?.trim() !== '';

    return {
      resourceType: 'Observation',
      id: item.id,
      status: (labResult?.status === 'COMPLETED' || labResult?.status === 'VERIFIED') ? 'final' : labResult?.status === 'PENDING' ? 'registered' : 'preliminary',
      category: [{
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }],
      }],
      code: {
        coding: [
          // 표준 LOINC 우선(있을 때) — 외부 소비자는 LOINC로 매칭. 없으면 내부코드/testName.
          ...(item.loincCode ? [{ system: 'http://loinc.org', code: item.loincCode, display: item.testName }] : []),
          { system: 'urn:hospital-run:lab-test', code: item.testCode ?? item.testName, display: item.testName },
        ],
        text: item.testName,
      },
      subject: labResult?.patientId ? { reference: `Patient/${labResult.patientId}` } : undefined,
      effectiveDateTime: labResult?.completedAt?.toISOString?.() ?? labResult?.createdAt?.toISOString?.() ?? undefined,
      issued: labResult?.createdAt?.toISOString?.() ?? undefined,
      // 🔴 UCUM 은 확인된 단위에만 선언한다(fhirQuantity 정본) — 표시 단위(`/μL`·`mmHg`·`10^3/uL`)를
      //    UCUM code 자리에 넣으면 외부가 파싱 실패하거나 다른 단위로 읽는다. 모르면 unit 만 내보낸다.
      //    값은 **LIS 보고값 그대로**(policyKey 미지정) — 재반올림은 보고값 변조다.
      ...(isNumeric
        ? { valueQuantity: fhirQuantity(numericValue, { unit: item.unit }) }
        : item.value
        ? { valueString: item.value }
        : {}),
      interpretation: item.flag ? [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
          // 위급값(HH/LL) FHIR 표준 코드 전달 — 정본 toFhirInterpretation(lab-flags) 경유.
          code: toFhirInterpretation(item.flag),
          display: item.flag,
        }],
      }] : undefined,
      referenceRange: (item.normalMin != null || item.normalMax != null) ? [{
        // low/high 는 SimpleQuantity — 값과 같은 단위 규약(UCUM 확인분만 선언)
        low: fhirQuantity(item.normalMin, { unit: item.unit }),
        high: fhirQuantity(item.normalMax, { unit: item.unit }),
        text: `${item.normalMin ?? ''} - ${item.normalMax ?? ''}`,
      }] : undefined,
    };
  }
}
