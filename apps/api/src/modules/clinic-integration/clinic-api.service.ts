import { Injectable, Logger, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { safeFetch, EgressBlockedError } from '../../common/util/safe-fetch';

export interface ClinicUser {
  id: string;
  email: string;
  username: string;
  profileImage?: string;
  role: string;           // Clinic role: OWNER | MANAGER | REGULAR
  hisRole?: string;       // Mapped HIS role: Doctor | Nurse | ...
  hisUserRole?: string;   // Prisma enum: DOCTOR | NURSE | ADMIN | ...
  department?: string;    // 소속 부서
  licenseNumber?: string; // 면허번호
  specialties?: string[]; // 전문과목
  hospitalId: string;
  hospitalName: string;
  hospitalCode: string;
  hospitalType?: string;  // hospital | clinic
}

interface NotificationPayload {
  recipients: string[];
  title: string;
  message: string;
  priority?: string;
  link?: string;
  category?: string;
}

interface UrgentNotificationPayload {
  channel: string;
  title: string;
  message: string;
  assignees: string[];
}

// 🔴 2026-08-20 G3(가-2): 종전 6개 호출부에 **타임아웃이 하나도 없었다**(무한 대기 = 그 자체가 결함).
//    safeFetch 로 이관하며 명시 타임아웃을 신설한다. 값은 종전 무제한 → 10s.
const CLINIC_TIMEOUT_MS = 10_000;

@Injectable()
export class ClinicApiService {
  private readonly logger = new Logger(ClinicApiService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly hospitalCode: string;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly drift?: DriftRecorderService,
  ) {
    this.baseUrl = this.config.get<string>('CLINIC_API_URL', ''); // P0-6: 미설정=클리닉 연동 비활성
    this.apiKey = this.config.get<string>('CLINIC_API_KEY', '');
    this.hospitalCode = this.config.get<string>('CLINIC_HOSPITAL_CODE', '');
  }

  /** SSRF 차단은 상류 장애와 다른 사실이다 — 삼키지 않고 명시적으로 남긴다(성공으로 둔갑 금지). */
  private logIfBlocked(where: string, error: unknown): void {
    if (error instanceof EgressBlockedError) {
      this.logger.error(`Clinic 송신 차단(SSRF 방어) — ${where}: ${error.message}. 전송되지 않았습니다.`);
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-Hospital-Code': this.hospitalCode,
    };
  }

  /**
   * SSO token verification: calls Clinic API to verify the one-time SSO token
   */
  async verifySsoToken(token: string): Promise<ClinicUser | null> {
    try {
      this.logger.log(`Verifying SSO token (prefix: ${token.substring(0, 8)}...)`);

      const response = await safeFetch(
        `${this.baseUrl}/api/clinic/sso/verify`,
        { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ token, service: 'his' }) },
        { timeoutMs: CLINIC_TIMEOUT_MS },
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({})) as Record<string, unknown>;
        this.logger.warn(`SSO verify failed: HTTP ${response.status} — ${(errBody.error as string) || 'unknown'}`);
        return null;
      }

      const data = await response.json() as Record<string, unknown>;
      if (!data.valid || !data.user) {
        this.logger.warn('SSO token invalid or user not found in response');
        return null;
      }

      const user = data.user as ClinicUser;
      this.logger.log(`SSO verified for user: ${user.email}`);
      return user;
    } catch (error: unknown) {
      this.logIfBlocked('SSO verify', error);
      this.logger.error(`SSO verify error: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Send notification to Clinic
   */
  async sendNotification(data: NotificationPayload): Promise<void> {
    try {
      this.logger.log(`Sending notification: "${data.title}" to ${data.recipients.length} recipients`);

      const response = await safeFetch(
        `${this.baseUrl}/api/clinic/his/notify`,
        { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ type: 'his_alert', ...data }) },
        { timeoutMs: CLINIC_TIMEOUT_MS },
      );

      if (!response.ok) {
        throw new HttpException(
          `Clinic notification failed: HTTP ${response.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logIfBlocked('notify', error);
      this.logger.error(`Notification error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to send notification to Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Send urgent notification (channel message + push)
   */
  async sendUrgentNotification(data: UrgentNotificationPayload): Promise<void> {
    try {
      this.logger.log(`Sending URGENT notification: "${data.title}" to channel ${data.channel}`);

      const response = await safeFetch(
        `${this.baseUrl}/api/clinic/his/notify/urgent`,
        { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(data) },
        { timeoutMs: CLINIC_TIMEOUT_MS },
      );

      if (!response.ok) {
        throw new HttpException(
          `Clinic urgent notification failed: HTTP ${response.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logIfBlocked('notify/urgent', error);
      this.logger.error(`Urgent notification error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to send urgent notification to Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  // ============================================================
  // Private helper
  // ============================================================

  private async callClinicApi(method: string, path: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}${path}`;
    const res = await safeFetch(
      url,
      { method, headers: this.getHeaders(), body: data ? JSON.stringify(data) : undefined },
      { timeoutMs: CLINIC_TIMEOUT_MS },
    );
    if (!res.ok) {
      /**
       * 🔴 **외부 시스템의 상태코드를 그대로 되던지지 않는다.**
       *    Clinic 이 500 을 주면 우리도 500 을 내보내 **우리 서버 오류로 읽혔다**
       *    (운영 실측: `GET /api/v1/clinic/channels` → 500 "Clinic API error: 500").
       *    화면·운영자가 "우리 버그"와 "연동처 장애"를 구분할 수 없다.
       *    PACS 선례대로 **연동처 장애는 502(Bad Gateway)** 로 말한다 —
       *    4xx(우리가 잘못 보냄)는 그대로 전달해 원인을 감추지 않는다.
       */
      const upstream = res.status;
      const status = upstream >= 500 ? HttpStatus.BAD_GATEWAY : upstream;
      throw new HttpException(
        {
          code: upstream >= 500 ? 'CLINIC_UNAVAILABLE' : 'CLINIC_REQUEST_REJECTED',
          message: upstream >= 500
            ? '외부 진료지원 시스템(Clinic)에 연결하지 못했습니다. 우리 서버 오류가 아니라 연동처 응답 실패입니다.'
            : `외부 진료지원 시스템(Clinic)이 요청을 거절했습니다 (${upstream}).`,
          upstreamStatus: upstream,
        },
        status,
      );
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  // ============================================================
  // Phase 2: Notifications / Channel
  // ============================================================

  /**
   * Send a message to a Clinic channel
   */
  async sendChannelMessage(data: { channelName: string; content: string; sender?: string }): Promise<void> {
    try {
      this.logger.log(`Sending channel message to "${data.channelName}"`);
      await this.callClinicApi('POST', '/api/clinic/his/channel/message', {
        type: 'his_message',
        ...data,
      });
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Channel message error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to send channel message to Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Send a handoff note between staff via Clinic
   */
  async sendHandoff(data: { department: string; content: string; fromUser: string; toUser: string }): Promise<void> {
    try {
      this.logger.log(`Sending handoff from ${data.fromUser} to ${data.toUser} in ${data.department}`);
      await this.callClinicApi('POST', '/api/clinic/his/channel/handoff', data);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Handoff error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to send handoff to Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Get list of available Clinic channels
   */
  async getChannels(): Promise<Record<string, unknown>[]> {
    try {
      this.logger.log('Fetching Clinic channels');
      const result = await this.callClinicApi('GET', '/api/clinic/his/channels');
      return (result.channels as Record<string, unknown>[]) || [];
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Get channels error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to fetch channels from Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  // ============================================================
  // Phase 3: Calendar / Attendance
  // ============================================================

  /**
   * Sync HIS calendar events to Clinic calendar
   */
  async syncCalendarEvents(events: Record<string, unknown>[]): Promise<{ synced: number }> {
    try {
      this.logger.log(`Syncing ${events.length} calendar events to Clinic`);
      const result = await this.callClinicApi('POST', '/api/clinic/his/calendar/sync', { events });
      return { synced: (result.synced as number) ?? events.length };
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Calendar sync error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to sync calendar events to Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Sync a surgery schedule entry to Clinic
   */
  async syncSurgerySchedule(surgery: Record<string, unknown> | object): Promise<void> {
    try {
      const s = surgery as Record<string, unknown>;
      this.logger.log(`Syncing surgery schedule: ${s['procedureName'] ?? s['id']}`);
      await this.callClinicApi('POST', '/api/clinic/his/calendar/surgery', surgery as Record<string, unknown>);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Surgery sync error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to sync surgery schedule to Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Get attendance records from Clinic
   */
  async getAttendance(): Promise<Record<string, unknown>[]> {
    try {
      this.logger.log('Fetching attendance from Clinic');
      const result = await this.callClinicApi('GET', '/api/clinic/his/attendance');
      return (result.records as Record<string, unknown>[]) || [];
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Attendance fetch error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to fetch attendance from Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Get leave balance for a specific user
   */
  async getLeaveBalance(userId: string): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`Fetching leave balance for user ${userId}`);
      return await this.callClinicApi('GET', `/api/clinic/his/leave/${userId}`);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Leave balance error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to fetch leave balance from Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Request leave via Clinic
   */
  async requestLeave(data: { userId: string; startDate: string; endDate: string; reason: string }): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`Requesting leave for user ${data.userId}: ${data.startDate} ~ ${data.endDate}`);
      return await this.callClinicApi('POST', '/api/clinic/his/leave/request', data);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Leave request error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to request leave via Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  // ============================================================
  // Phase 4: Approval (W.Sign) / Wiki (ShareSpace)
  // ============================================================

  /**
   * Request an approval via Clinic W.Sign
   */
  async requestApproval(data: {
    templateId: string;
    title: string;
    drafter: string;
    approvers: string[];
    content: Record<string, unknown>;
    callbackUrl: string;
  }): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`Requesting approval: "${data.title}" from ${data.drafter}`);
      return await this.callClinicApi('POST', '/api/clinic/his/wsign/request', data);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Approval request error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to request approval via Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Get approval document status
   */
  async getApprovalStatus(docId: string): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`Fetching approval status for doc ${docId}`);
      return await this.callClinicApi('GET', `/api/clinic/his/wsign/status/${docId}`);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Approval status error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to fetch approval status from Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * 결재선 추천 (조직도 기반) — Clinic organization/approvers 래핑
   */
  async getApprovers(drafterClinicUserId: string, docType?: string): Promise<Record<string, unknown>> {
    try {
      // Clinic은 userId 파라미터 요구
      const qs = new URLSearchParams({ userId: drafterClinicUserId, ...(docType ? { docType } : {}) }).toString();
      return await this.callClinicApi('GET', `/api/clinic/his/organization/approvers?${qs}`);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Approvers fetch error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to fetch approvers from Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Search Clinic Wiki (ShareSpace)
   */
  async searchWiki(query: string): Promise<Record<string, unknown>[]> {
    try {
      this.logger.log(`Searching wiki: "${query}"`);
      const result = await this.callClinicApi('GET', `/api/clinic/his/wiki/search?q=${encodeURIComponent(query)}`);
      return (result.pages as Record<string, unknown>[]) || [];
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Wiki search error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to search wiki on Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Get a single wiki page
   */
  async getWikiPage(pageId: string): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`Fetching wiki page ${pageId}`);
      return await this.callClinicApi('GET', `/api/clinic/his/wiki/page/${pageId}`);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Wiki page error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to fetch wiki page from Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Create a new wiki page on Clinic ShareSpace
   */
  async createWikiPage(data: { title: string; content: string; path: string }): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`Creating wiki page: "${data.title}" at ${data.path}`);
      return await this.callClinicApi('POST', '/api/clinic/his/wiki/page', data);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Wiki create error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to create wiki page on Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  // ============================================================
  // Phase 5: Webhook subscription management
  // ============================================================

  /**
   * Subscribe to Clinic webhook events
   */
  async subscribeWebhook(data: { url: string; events: string[]; secret: string }): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`Subscribing webhook: ${data.url} for events [${data.events.join(', ')}]`);
      return await this.callClinicApi('POST', '/api/clinic/his/webhooks', data);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Webhook subscribe error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to subscribe webhook on Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Unsubscribe from Clinic webhook
   */
  async unsubscribeWebhook(webhookId: string): Promise<void> {
    try {
      this.logger.log(`Unsubscribing webhook: ${webhookId}`);
      await this.callClinicApi('DELETE', `/api/clinic/his/webhooks/${webhookId}`);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Webhook unsubscribe error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to unsubscribe webhook on Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  // ============================================================
  // Phase 1: Staff (existing)
  // ============================================================

  /**
   * Fetch staff list from Clinic
   */
  /**
   * Push HIS staff list to Clinic (register as Clinic members)
   */
  /**
   * 🔴 상대 스키마는 **호출당 최대 500명**이다. 종전에는 재직자를 한 번에 다 보내서,
   *    재직자가 500명을 넘는 기관에서는 **전건이 400 으로 실패**했다(분할 전송 코드가 없었다 ·
   *    2026-09-11 외부 코드 대조). 나눠 보내고 결과를 합친다 — 한 묶음이 실패해도 어느 묶음인지 남긴다.
   */
  private static readonly STAFF_SYNC_CHUNK = 500;

  async pushStaffToClinic(staffList: Record<string, unknown>[]): Promise<Record<string, unknown>> {
    const chunkSize = ClinicApiService.STAFF_SYNC_CHUNK;
    if (staffList.length > chunkSize) {
      const merged: { registered: number; skipped: number; errors: unknown[]; details: unknown[] } = {
        registered: 0, skipped: 0, errors: [], details: [],
      };
      for (let i = 0; i < staffList.length; i += chunkSize) {
        const part = staffList.slice(i, i + chunkSize);
        const label = `${i + 1}~${i + part.length}`;
        try {
          const r = await this.pushStaffChunk(part);
          merged.registered += Number(r.registered ?? 0);
          merged.skipped += Number(r.skipped ?? 0);
          if (Array.isArray(r.errors)) merged.errors.push(...r.errors);
          if (Array.isArray(r.details)) merged.details.push(...r.details);
        } catch (e) {
          // 한 묶음 실패가 나머지를 막지 않는다. 다만 **어느 묶음이 실패했는지** 반드시 남긴다
          merged.errors.push({ chunk: label, message: e instanceof Error ? e.message : String(e) });
        }
      }
      return merged as unknown as Record<string, unknown>;
    }
    return this.pushStaffChunk(staffList);
  }

  private async pushStaffChunk(staffList: Record<string, unknown>[]): Promise<Record<string, unknown>> {
    try {
      const response = await safeFetch(
        `${this.baseUrl}/api/clinic/his/staff/sync`,
        { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ staff: staffList }) },
        { timeoutMs: CLINIC_TIMEOUT_MS },
      );
      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`Staff push failed: HTTP ${response.status} - ${errText}`);
        throw new HttpException({ code: 'CLINIC_SYNC_FAILED', message: `Clinic HTTP ${response.status}`, details: errText }, HttpStatus.BAD_GATEWAY);
      }
      return await response.json() as Record<string, unknown>;
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logIfBlocked('staff/sync', error);
      this.logger.error(`Staff push error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to push staff to Clinic', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * HIS 조직도 push — Clinic organization/sync (HIS 정본 단방향, 결재선 추천이 이를 참조)
   */
  async pushOrganizationToClinic(payload: { staff: Record<string, unknown>[] } | { departments: { name: string }[]; members: Record<string, unknown>[] }): Promise<Record<string, unknown>> {
    return this.callClinicApi('POST', '/api/clinic/his/organization/sync', payload);
  }

  async fetchClinicStaff(): Promise<Record<string, unknown>[]> {
    try {
      const response = await safeFetch(
        `${this.baseUrl}/api/clinic/his/staff`,
        { method: 'GET', headers: this.getHeaders() },
        { timeoutMs: CLINIC_TIMEOUT_MS },
      );

      if (!response.ok) {
        throw new HttpException(
          `Clinic staff fetch failed: HTTP ${response.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const data = await response.json() as Record<string, unknown>;
      /**
       * 🔴 관측점(axis C): 실패는 위에서 예외로 올라간다 — 남는 구멍은 **200인데 키 이름이 바뀐 경우**뿐.
       *    그때 `|| []` 가 "성공·직원 0명"을 만들고 계정 동기화가 조용히 no-op 이 된다(성공 로그까지 남긴다).
       */
      if (!Array.isArray(data.staff)) {
        this.drift?.record({
          kind: 'KEY_MISSING',
          producer: 'clinic.staff-list',
          consumer: 'clinic-api.fetchClinicStaff',
          detail: `200 응답에 staff 배열이 없음 · 실제 키: ${Object.keys(data).join(', ').slice(0, 200)}`,
        });
      }
      return (data.staff as Record<string, unknown>[]) || [];
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logIfBlocked('staff', error);
      this.logger.error(`Staff fetch error: ${error instanceof Error ? error.message : error}`);
      throw new HttpException('Failed to fetch staff from Clinic', HttpStatus.BAD_GATEWAY);
    }
  }
}
