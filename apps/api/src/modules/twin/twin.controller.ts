import { Controller, Get, Post, Body, Param, Logger, ServiceUnavailableException, ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, isUUID } from 'class-validator';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SmartAuthService } from '../smart-auth/smart-auth.service';
import { fhirIssuer } from '../../common/util/public-url';
import { safeFetch, EgressBlockedError } from '../../common/util/safe-fetch';

class AiConsentDto {
  @IsBoolean() consented!: boolean;
  @IsOptional() @IsString() method?: string;
}

/**
 * 🔴 트윈 CDS 결과 상태.
 * 종전에는 401·5xx·타임아웃·차단·미설정이 전부 `{cards:[]}` 였다 — 차트는 "위험 카드 없음"과
 * "트윈에 물어보지 못함"을 가를 수 없었다(P17: 근거 없이 안심).
 *   - OK           — 트윈이 답했다(cards 가 0장이면 진짜 0장)
 *   - NO_CONSENT   — 동의 없음(보내지 않음 — 화면은 동의 게이트를 따로 그린다)
 *   - UNCONFIGURED — TWIN_BASE_URL/TWIN_LAUNCH_SECRET 미설정(보내지 않음)
 *   - UNAVAILABLE  — 보냈으나 답을 못 받음/못 읽음 · 또는 환자 식별 실패
 */
export type TwinCdsStatus = 'OK' | 'NO_CONSENT' | 'UNCONFIGURED' | 'UNAVAILABLE';
export type TwinCdsReason =
  | 'NO_CONSENT' | 'SECRET_UNSET' | 'BASE_URL_UNSET'
  | 'UPSTREAM_ERROR' | 'BAD_RESPONSE' | 'EGRESS_BLOCKED' | 'NETWORK' | 'PATIENT_NOT_FOUND';
export interface TwinCdsResult {
  cards: unknown[];
  status: TwinCdsStatus;
  reason: TwinCdsReason | null;
  /** 상류 HTTP 상태(UPSTREAM_ERROR 일 때만) */
  upstreamStatus?: number;
}
function cdsNotChecked(status: Exclude<TwinCdsStatus, 'OK'>, reason: TwinCdsReason): TwinCdsResult {
  return { cards: [], status, reason };
}

// 디지털 트윈 런치 — HMAC 서명 URL 생성(서버사이드, 비밀 미노출)
@ApiTags('Digital Twin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/twin')
export class TwinController {
  private readonly logger = new Logger(TwinController.name);
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly smartAuth: SmartAuthService) {}

  /** PHI 접근 감사로그(비동기, 실패 무시) */
  private auditPhi(userId: string | undefined, action: 'READ' | 'UPDATE', resourceType: string, patientId: string, changes?: Record<string, { old: unknown; new: unknown }>) {
    if (!userId) return;
    void this.audit.log({ userId, action, resourceType, resourceId: patientId, changes }).catch(() => {});
  }

  /**
   * patientId 정규화 — UUID면 그대로, 아니면 MRN(차트번호 'P…')으로 환자 UUID 해석.
   * 트윈 앱·CDS가 차트번호를 넘겨도 UUID 컬럼 쿼리에서 Prisma 500(invalid UUID) 대신 정상/404 처리.
   */
  private async resolvePatientId(idOrMrn: string): Promise<string> {
    if (isUUID(idOrMrn)) return idOrMrn;
    const p = await this.prisma.patient.findFirst({ where: { mrn: idOrMrn }, select: { id: true } });
    if (!p) throw new NotFoundException('환자를 찾을 수 없습니다');
    return p.id;
  }

  /** 트윈/AI 활용 동의 확인 — 미동의/철회 시 차단(PHI 외부전송 게이트, 보안 C-3) */
  private async hasConsent(patientId: string): Promise<boolean> {
    const c = await this.prisma.patientAiConsent.findUnique({ where: { patientId } });
    return !!(c && c.consented && !c.revokedAt);
  }

  @Get('launch/:patientId')
  @ApiOperation({ summary: '디지털 트윈 보기 — 서명된 런치 URL 발급(5분 유효, 동의 필요)' })
  async launch(@Param('patientId') patientId: string, @CurrentUser('id') userId?: string) {
    patientId = await this.resolvePatientId(patientId);
    if (!(await this.hasConsent(patientId))) throw new ForbiddenException('트윈/AI 활용 동의가 필요합니다');
    const secret = this.config.get<string>('TWIN_LAUNCH_SECRET');
    if (!secret) throw new ServiceUnavailableException('트윈 연동이 설정되지 않았습니다');
    this.auditPhi(userId, 'READ', 'TwinLaunch', patientId);
    const base = this.config.get<string>('TWIN_BASE_URL') || ''; // P0-6: 미설정=트윈 비활성
    if (!base) throw new ServiceUnavailableException('트윈 연동이 설정되지 않았습니다(TWIN_BASE_URL)');
    const exp = Math.floor(Date.now() / 1000) + 300; // 5분
    const payload = `${patientId}.${exp}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const url = `${base.replace(/\/$/, '')}/patient/${patientId}?t=${payload}.${sig}`;
    return { data: { url, expiresAt: new Date(exp * 1000).toISOString() } };
  }

  @Get('smart-launch/:patientId')
  @ApiOperation({ summary: 'SMART EHR Launch(A4-2) — 로그인 의료진+환자 바인딩 후 트윈 SMART 앱 URL 발급(동의 필요)' })
  async smartLaunch(@Param('patientId') patientId: string, @CurrentUser('id') userId?: string) {
    patientId = await this.resolvePatientId(patientId);
    if (!(await this.hasConsent(patientId))) throw new ForbiddenException('트윈/AI 활용 동의가 필요합니다');
    this.auditPhi(userId, 'READ', 'TwinSmartLaunch', patientId);
    // launch context: 환자 + fhirUser(Practitioner/{의료진 id}) 바인딩
    const launch = await this.smartAuth.createLaunchContext(patientId, userId ? `Practitioner/${userId}` : undefined);
    const iss = fhirIssuer();
    const base = this.config.get<string>('TWIN_BASE_URL') || ''; // P0-6: 미설정=트윈 비활성
    if (!base) throw new ServiceUnavailableException('트윈 연동이 설정되지 않았습니다(TWIN_BASE_URL)');
    const url = `${base.replace(/\/$/, '')}/smart/launch?iss=${encodeURIComponent(iss)}&launch=${launch}`;
    return { data: { launch, iss, url } };
  }

  @Get('cds/patient-view/:patientId')
  @ApiOperation({ summary: 'CDS Hooks patient-view — 트윈 위험 카드(차트 표시, fail-soft · status 로 "카드 0"과 "확인 불가"를 가른다)' })
  async cdsPatientView(@Param('patientId') patientId: string): Promise<{ data: TwinCdsResult }> {
    const resolved = await this.resolvePatientId(patientId).catch(() => null);
    if (!resolved) return { data: cdsNotChecked('UNAVAILABLE', 'PATIENT_NOT_FOUND') }; // 미상 환자(fail-soft)
    patientId = resolved;
    if (!(await this.hasConsent(patientId))) return { data: cdsNotChecked('NO_CONSENT', 'NO_CONSENT') }; // 동의 없으면 보내지 않음
    const secret = this.config.get<string>('TWIN_LAUNCH_SECRET');
    if (!secret) return { data: cdsNotChecked('UNCONFIGURED', 'SECRET_UNSET') };
    const base = this.config.get<string>('TWIN_BASE_URL') || ''; // P0-6: 미설정=트윈 비활성
    if (!base) return { data: cdsNotChecked('UNCONFIGURED', 'BASE_URL_UNSET') };
    const auth = crypto.createHmac('sha256', secret).update('cds-hooks').digest('hex');
    try {
      const res = await safeFetch(
        `${base.replace(/\/$/, '')}/cds-services/twin-patient-view`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
          body: JSON.stringify({ hook: 'patient-view', context: { patientId } }),
        },
        { timeoutMs: 6000 },
      );
      if (!res.ok) {
        // 🔴 r3 B2: 401(고정 Bearer 불일치)·5xx 는 "위험 카드 없음"이 아니다 — 확인 불가로 말한다.
        this.logger.warn(`트윈 CDS 응답 ${res.status} — 위험 카드를 확인하지 못했습니다`);
        return { data: { ...cdsNotChecked('UNAVAILABLE', 'UPSTREAM_ERROR'), upstreamStatus: res.status } };
      }
      const json = (await res.json()) as { cards?: unknown };
      // CDS Hooks 응답에서 cards 는 필수 — 없거나 배열이 아니면 "0장"으로 읽지 않는다
      if (!Array.isArray(json?.cards)) return { data: cdsNotChecked('UNAVAILABLE', 'BAD_RESPONSE') };
      return { data: { cards: json.cards, status: 'OK', reason: null } };
    } catch (e) {
      // 🔴 차단은 "위험 카드 없음"과 다른 사실이다 — fail-soft(차트 영향 없음)는 유지하되 status 로 말한다.
      if (e instanceof EgressBlockedError) {
        this.logger.error(`트윈 CDS 송신 차단(SSRF 방어): ${e.message}. 요청이 나가지 않아 카드가 비어 있습니다(장애 아님).`);
        return { data: cdsNotChecked('UNAVAILABLE', 'EGRESS_BLOCKED') };
      }
      return { data: cdsNotChecked('UNAVAILABLE', 'NETWORK') }; // 트윈 장애·타임아웃 — 차트 영향 없음
    }
  }

  @Get('consent/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: '트윈/AI 활용 동의 조회(트윈 게이트·차트). 미기록 시 consented=false' })
  async getConsent(@Param('patientId') patientId: string) {
    patientId = await this.resolvePatientId(patientId);
    const c = await this.prisma.patientAiConsent.findUnique({ where: { patientId } });
    return { data: c
      ? { patientId, consented: c.consented && !c.revokedAt, consentedAt: c.consentedAt, revokedAt: c.revokedAt, method: c.method, recorded: true }
      : { patientId, consented: false, recorded: false } };
  }

  @Get('vitals/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: '활력징후 조회(일반병동 vitals + 최근 NEWS2) — 트윈 위험 확장' })
  async vitals(@Param('patientId') patientId: string, @CurrentUser('id') userId?: string) {
    patientId = await this.resolvePatientId(patientId);
    if (!(await this.hasConsent(patientId))) throw new ForbiddenException('트윈/AI 활용 동의가 필요합니다');
    this.auditPhi(userId, 'READ', 'TwinVitals', patientId);
    const [vitals, ews, patient] = await Promise.all([
      this.prisma.preVisitVitals.findMany({
        where: { patientId },
        orderBy: { measuredAt: 'desc' },
        take: 30,
        select: { systolicBp: true, diastolicBp: true, heartRate: true, temperature: true, spo2: true, respiratoryRate: true, painScore: true, weight: true, height: true, bmi: true, isAbnormal: true, measuredAt: true },
      }),
      // 🔴 조회 실패를 `null` 로만 접으면 수신 측(트윈 위험엔진)은 "조기경보 기록 없음"으로 읽는다.
      //    실패는 '위험 없음'이 아니다 — 값은 null 로 두되 `unavailable` 로 그 사실을 함께 낸다.
      this.prisma.earlyWarningScore.findFirst({
        where: { patientId },
        orderBy: { recordedAt: 'desc' },
        select: { totalScore: true, riskLevel: true, recordedAt: true },
      }).then((v) => ({ ok: true as const, v })).catch((e) => {
        this.logger.error(`트윈 EWS 조회 실패 patient=${patientId}: ${(e as Error).message}`);
        return { ok: false as const, v: null };
      }),
      // #7 흡연상태(사회력) — CVD 위험엔진(PCE·PREVENT·K-CVD) 입력.
      //    실패해도 'UNKNOWN'(모름)이 되므로 사실을 뒤바꾸지 않는다(3상 값이 이미 있다).
      this.prisma.patient.findUnique({ where: { id: patientId }, select: { smokingStatus: true } }).catch(() => null),
    ]);
    return { data: {
      patientId,
      vitalSigns: vitals.map((v) => ({ ...v, temperature: v.temperature != null ? Number(v.temperature) : null, weight: v.weight != null ? Number(v.weight) : null, height: v.height != null ? Number(v.height) : null, bmi: v.bmi != null ? Number(v.bmi) : null })),
      latestEws: ews.v,
      smokingStatus: patient?.smokingStatus ?? 'UNKNOWN', // CURRENT|FORMER|NEVER|UNKNOWN
      /** 🔴 조회에 실패해 비어 있는 항목 — `latestEws: null` 이 '기록 없음'인지 '조회 실패'인지 가른다 */
      unavailable: ews.ok ? [] : ['latestEws'],
    } };
  }

  @Get('imaging/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: '영상 study 매핑(A4-1) — MRN↔StudyInstanceUID. PACS 무수정, 트윈이 Orthanc 직접 조회용' })
  async imaging(@Param('patientId') patientId: string, @CurrentUser('id') userId?: string) {
    patientId = await this.resolvePatientId(patientId);
    if (!(await this.hasConsent(patientId))) throw new ForbiddenException('트윈/AI 활용 동의가 필요합니다');
    this.auditPhi(userId, 'READ', 'TwinImaging', patientId);
    const studies = await this.prisma.dicomStudy.findMany({
      where: { patientId },
      orderBy: { studyDate: 'desc' },
      select: { studyInstanceUid: true, modality: true, studyDate: true, description: true, seriesCount: true, instanceCount: true, bodyPart: true, reportStatus: true },
    });
    return { data: studies.map((s) => ({
      studyUid: s.studyInstanceUid, modality: s.modality, studyDate: s.studyDate,
      description: s.description, bodyPart: s.bodyPart, seriesCount: s.seriesCount, instanceCount: s.instanceCount, reportStatus: s.reportStatus,
      accession: null, // RadiologyOrder 연계 필요 시 보강
    })) };
  }

  @Post('consent/:patientId')
  @ApiOperation({ summary: '트윈/AI 활용 동의 기록/철회(직원)' })
  async setConsent(@Param('patientId') patientId: string, @Body() dto: AiConsentDto, @CurrentUser('id') userId: string) {
    patientId = await this.resolvePatientId(patientId);
    const now = new Date();
    const data = {
      consented: dto.consented, method: dto.method ?? 'VERBAL', recordedBy: userId,
      consentedAt: dto.consented ? now : null, revokedAt: dto.consented ? null : now,
    };
    const c = await this.prisma.patientAiConsent.upsert({ where: { patientId }, create: { patientId, ...data }, update: data });
    this.auditPhi(userId, 'UPDATE', 'TwinAiConsent', patientId, { consented: { old: null, new: dto.consented } });
    return { data: { patientId, consented: c.consented && !c.revokedAt } };
  }
}
