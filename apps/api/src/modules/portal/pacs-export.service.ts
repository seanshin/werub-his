import { Injectable, Logger, HttpStatus, HttpException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PortalService } from './portal.service';
import { fernetDecrypt, FernetError } from '../../common/util/fernet';
import { PacsProxyService } from '../pacs-proxy/pacs-proxy.service';
import { assertPatientOwnsStudies } from './pacs-study-ownership';

/** 전역 필터 정합: HttpException 응답에 error=코드·message=문구 → {error:{code,message}}. */
function exportErr(code: string, message: string, status: HttpStatus): HttpException {
  return new HttpException({ error: code, message }, status);
}

export type ExportPurpose = 'SELF_VIEW' | 'SECOND_OPINION' | 'TRANSFER' | 'PERSONAL_ARCHIVE';
const PURPOSES: ExportPurpose[] = ['SELF_VIEW', 'SECOND_OPINION', 'TRANSFER', 'PERSONAL_ARCHIVE'];

export interface ExportError {
  error: { code: string; message: string };
}

/**
 * 환자포털 PACS 영상/판독 내보내기 소비자.
 * PACS(OpenPACS) patient-export API를 서버측에서만 호출(토큰·키 브라우저 미노출).
 * 흐름: 서명 토큰 → 요청 → 폴링 → 1회용 다운로드 → Fernet 복호 → 스트림.
 * 설계: docs/02-design/features/portal-imaging-export.design.md
 */
@Injectable()
export class PacsExportService {
  private readonly logger = new Logger(PacsExportService.name);

  constructor(
    private readonly configRuntime: ConfigRuntimeService,
    private readonly portal: PortalService,
    private readonly pacsProxy: PacsProxyService,
  ) {}

  private async cfg() {
    const enabled = (await this.configRuntime.get('pacs.exportEnabled')) as boolean;
    const secret = (await this.configRuntime.get('pacs.exportSecret')) as string;
    const base =
      ((await this.configRuntime.get('pacs.exportBaseUrl')) as string) ||
      process.env.PACS_API_URL ||
      'http://127.0.0.1:8000';
    if (!enabled || !secret) {
      throw exportErr('EXPORT_DISABLED', '영상 내보내기 기능이 활성화되지 않았습니다.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { secret, base: base.replace(/\/$/, '') };
  }

  /** 매 PACS 호출마다 신규 서명 토큰(HS256, scope=patient-export, mrn=세션 도출, 10분). */
  private sign(secret: string, mrn: string, purpose: string): string {
    return jwt.sign({ scope: 'patient-export', mrn, purpose }, secret, {
      algorithm: 'HS256',
      expiresIn: '10m',
    });
  }

  private async pacsFetch(base: string, path: string, token: string, init?: RequestInit) {
    return fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15000),
    });
  }

  /** FR-1 내보내기 요청 생성. */
  async requestExport(patientId: string, purpose: string, studyUids?: string[]): Promise<{ requestId: string; status: string }> {
    if (!PURPOSES.includes(purpose as ExportPurpose)) {
      throw exportErr('VALIDATION_ERROR', '유효하지 않은 목적 코드입니다.', HttpStatus.BAD_REQUEST);
    }
    const { secret, base } = await this.cfg();
    const mrn = await this.portal.getPatientMrn(patientId);

    // studyUids 지정 시 본인 study 소유 검증 — 정본 `pacs-study-ownership`(썸네일·판독 PDF 와 같은 함수).
    // 🔴 r1 #15-2: 종전에는 export 토큰으로 PACS 를 불러 실패(401·장애)를 빈 집합으로 삼켰다 → "본인 검사가 아니다"(403)
    //    라는 거짓 사실. 이제 서비스 계정으로 조회하고, 조회 실패는 503(확인 불가)·불일치만 403 이다.
    if (studyUids?.length) {
      await assertPatientOwnsStudies({
        mrn,
        studyUids,
        headers: await this.pacsProxy.serviceAuthHeaders(),
        forbiddenMessage: '본인의 검사가 아닌 항목이 포함되었습니다.',
      });
    }

    const token = this.sign(secret, mrn, purpose);
    const res = await this.pacsFetch(base, '/api/v1/patient-export/requests', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mrn, purpose, study_uids: studyUids ?? null }),
    });
    if (!res.ok) throw this.mapError(res.status);
    const data = (await res.json()) as { request_id?: string; id?: string; status?: string };
    const requestId = data.request_id ?? data.id;
    if (!requestId) throw exportErr('EXPORT_ERROR', 'PACS 응답이 올바르지 않습니다.', HttpStatus.BAD_GATEWAY);

    await this.portal.logAudit(patientId, 'IMAGING_EXPORT_REQUEST', '/portal/imaging/export/request', null,
      `purpose=${purpose}; studies=${studyUids?.length ?? 'all'}; requestId=${requestId}`);
    return { requestId, status: data.status ?? 'pending' };
  }

  /** FR-2 진행상태 폴링(서버가 PACS 1회 폴링). token·key는 반환하지 않음. */
  async pollStatus(patientId: string, requestId: string): Promise<{ status: string; progress?: number }> {
    const { secret, base } = await this.cfg();
    const mrn = await this.portal.getPatientMrn(patientId);
    const token = this.sign(secret, mrn, 'SELF_VIEW');
    const res = await this.pacsFetch(base, `/api/v1/patient-export/requests/${encodeURIComponent(requestId)}`, token);
    if (!res.ok) throw this.mapError(res.status);
    const data = (await res.json()) as { status?: string; progress?: number };
    return { status: data.status ?? 'pending', progress: data.progress };
  }

  /** FR-3 ready 시 1회용 수령 + Fernet 복호. 평문 ZIP Buffer 반환(스트림용). */
  async download(patientId: string, requestId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { secret, base } = await this.cfg();
    const mrn = await this.portal.getPatientMrn(patientId);
    const token = this.sign(secret, mrn, 'SELF_VIEW');

    // 1) 상태 확인 → download_token + package_key
    const statusRes = await this.pacsFetch(base, `/api/v1/patient-export/requests/${encodeURIComponent(requestId)}`, token);
    if (!statusRes.ok) throw this.mapError(statusRes.status);
    const meta = (await statusRes.json()) as { status?: string; download_token?: string; package_key?: string };
    if (meta.status === 'consumed' || meta.status === 'expired') {
      throw exportErr('EXPORT_CONSUMED', '이미 다운로드되었거나 만료되었습니다. 다시 요청해 주세요.', HttpStatus.GONE);
    }
    if (meta.status !== 'ready' || !meta.download_token || !meta.package_key) {
      throw exportErr('EXPORT_NOT_READY', '아직 준비되지 않았습니다.', HttpStatus.CONFLICT);
    }

    // 2) 1회용 다운로드(게이트웨이) — 암호화 패키지
    const dlRes = await this.pacsFetch(base, `/portal-export/${encodeURIComponent(meta.download_token)}`, token);
    if (!dlRes.ok) throw this.mapError(dlRes.status);
    const encrypted = Buffer.from(await dlRes.arrayBuffer());

    // 3) Fernet 복호(서버측, 키 브라우저 미노출)
    let buffer: Buffer;
    try {
      buffer = fernetDecrypt(encrypted.toString('utf8'), meta.package_key);
    } catch (e) {
      if (e instanceof FernetError) {
        throw exportErr('EXPORT_DECRYPT', '패키지 복호에 실패했습니다.', HttpStatus.BAD_GATEWAY);
      }
      throw e;
    }

    await this.portal.logAudit(patientId, 'IMAGING_EXPORT_DOWNLOAD', '/portal/imaging/export/download', null,
      `requestId=${requestId}; bytes=${buffer.length}`);
    return { buffer, filename: `imaging-export-${mrn}-${requestId.slice(0, 8)}.zip` };
  }

  private mapError(status: number): HttpException {
    const map: Record<number, { code: string; message: string; http: HttpStatus }> = {
      401: { code: 'EXPORT_AUTH', message: '인증 오류입니다. 다시 시도해 주세요.', http: HttpStatus.BAD_GATEWAY },
      403: { code: 'EXPORT_AUTH', message: '접근 권한이 없습니다.', http: HttpStatus.FORBIDDEN },
      404: { code: 'EXPORT_NOT_FOUND', message: '요청을 찾을 수 없습니다.', http: HttpStatus.NOT_FOUND },
      410: { code: 'EXPORT_CONSUMED', message: '다운로드가 만료되었습니다. 다시 요청해 주세요.', http: HttpStatus.GONE },
    };
    const m = map[status] ?? { code: 'EXPORT_ERROR', message: `PACS 오류(${status})`, http: HttpStatus.BAD_GATEWAY };
    return exportErr(m.code, m.message, m.http);
  }
}
