import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SmartAuthGuard, FhirScope } from '../smart-auth/smart-auth.guard';
import { FhirLabIngestService } from './fhir-lab-ingest.service';

/**
 * 외부 LIS ↔ HIS FHIR 검사 결과 수신(SMART Backend Services).
 * 인증: SMART `system/DiagnosticReport.write` / `system/Observation.write` (client_credentials).
 * 수신 결과는 스테이징 큐(LabInterfaceResult)에 적재 — 직원 match→apply→verify 후 임상반영(자동 VERIFIED 아님).
 */
@ApiTags('FHIR R4 (LIS 검사 결과 수신)')
@ApiBearerAuth()
@UseGuards(SmartAuthGuard)
@Controller('fhir/R4')
export class FhirLabController {
  constructor(private readonly ingest: FhirLabIngestService) {}

  @Post('DiagnosticReport')
  @FhirScope('DiagnosticReport', 'write')
  @ApiOperation({ summary: '외부 LIS DiagnosticReport 수신 — contained[] Observation 결과 포함' })
  async createDiagnosticReport(
    @Body() body: Record<string, unknown>,
    @Req() req: { smartClient?: { client_id?: string } },
  ) {
    const r = await this.ingest.ingestDiagnosticReport(body, req.smartClient?.client_id ?? 'unknown');
    return {
      resourceType: 'DiagnosticReport',
      id: r.id,
      status: (body.status as string) ?? 'final',
      meta: { tag: [{ system: 'urn:hospital-run:lab', code: 'STAGED', display: `수신됨(${r.status}) — HIS 검증 후 반영` }] },
      _ingest: r,
    };
  }

  @Post('Observation')
  @FhirScope('Observation', 'write')
  @ApiOperation({ summary: '외부 LIS Observation 단건 수신' })
  async createObservation(
    @Body() body: Record<string, unknown>,
    @Req() req: { smartClient?: { client_id?: string } },
  ) {
    const r = await this.ingest.ingestObservation(body, req.smartClient?.client_id ?? 'unknown');
    return {
      resourceType: 'Observation',
      id: r.id,
      meta: { tag: [{ system: 'urn:hospital-run:lab', code: 'STAGED', display: `수신됨(${r.status}) — HIS 검증 후 반영` }] },
      _ingest: r,
    };
  }
}
