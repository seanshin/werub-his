import { Injectable, Logger, NotFoundException, BadRequestException, Optional, OnModuleInit } from '@nestjs/common';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClinicApiService } from './clinic-api.service';
import { publicBaseUrl } from '../../common/util/public-url';
import { assertEgressUrl, safeFetch, EgressBlockedError, type SafeFetchOptions } from '../../common/util/safe-fetch';
import { IntegrationOutboxService, type OutboxRowView } from '../integration/integration-outbox.service';
import { EAPPROVAL_OUTBOX, eapprovalCallbackRequest, eapprovalEgressOpts, eapprovalOutboxRef } from './eapproval-callback';

/** W.Sign 결과로 도달하는 릴레이 종결 상태 */
const TERMINAL_RESULTS: readonly string[] = ['APPROVED', 'REJECTED', 'WITHDRAWN'];

// ERP doc_type → W.Sign templateId
const TEMPLATE_MAP: Record<string, string> = {
  HR_LEAVE: 'leave',
  HR_PURCHASE: 'medical-purchase',
  GENERAL: 'general',
  MEDICAL: 'medical',
};

@Injectable()
export class ErpEapprovalService implements OnModuleInit {
  private readonly logger = new Logger(ErpEapprovalService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicApi: ClinicApiService,
    private readonly config: ConfigService,
    @Optional() private readonly drift?: DriftRecorderService,
    @Optional() private readonly outbox?: IntegrationOutboxService,
  ) {}

  /**
   * 전자결재 콜백 자동 재시도 — 즉시 3회가 실패하면 **기존 연동 아웃박스**에 적재한다.
   * 🔴 옆에 약한 재시도 엔진(크론·전용 컬럼)을 만들지 않는다 — 아웃박스가 백오프·상한·운영 모드 보류·관리 화면을 이미 갖고 있다.
   * 발송 직전 확인(preflight): 릴레이가 그 결과 그대로이고 아직 미전달일 때만 보낸다 — 그 사이 결과가 바뀌었거나
   *   Clinic 재수신으로 이미 전달됐으면 보내지 않고 CANCELLED(사유)로 남긴다(낡은 결과를 ERP 에 다시 보내지 않는다).
   * 발송 성공(onSent): 릴레이 `callbackDelivered=true`(그 결과일 때만 — 조건부).
   */
  onModuleInit() {
    this.outbox?.registerDomainHooks(EAPPROVAL_OUTBOX.domain, {
      preflight: (row) => this.outboxPreflight(row),
      onSent: (row) => this.outboxOnSent(row),
    });
  }

  private outboxRelayKey(row: OutboxRowView): { relayId: string; result: string } {
    const [relayId, result] = row.ref.split(':');
    return { relayId, result };
  }

  async outboxPreflight(row: OutboxRowView): Promise<{ send: true } | { send: false; reason: string }> {
    const { relayId, result } = this.outboxRelayKey(row);
    const relay = await this.prisma.eApprovalRelay.findUnique({ where: { id: relayId }, select: { result: true, callbackDelivered: true } });
    if (!relay) return { send: false, reason: '릴레이 없음' };
    if (relay.result !== result) return { send: false, reason: '결재 결과가 바뀜 — 새 결과가 따로 전달된다' };
    if (relay.callbackDelivered) return { send: false, reason: '이미 전달됨(재수신 경로 등)' };
    return { send: true };
  }

  async outboxOnSent(row: OutboxRowView): Promise<void> {
    const { relayId, result } = this.outboxRelayKey(row);
    await this.prisma.eApprovalRelay.updateMany({ where: { id: relayId, result, callbackDelivered: false }, data: { callbackDelivered: true } });
  }

  private hisBase() { return publicBaseUrl(); }

  /** ① 상신 릴레이 — ERP → HIS → W.Sign */
  async submit(data: {
    doc_type: string; title: string; drafter_clinic_user_id: string;
    approvers?: string[] | null; content: Record<string, unknown>;
    ref: { source_module: string; source_ref: string }; callback_url: string;
  }, idempotencyKey?: string) {
    const templateId = TEMPLATE_MAP[data.doc_type];
    if (!templateId) throw new BadRequestException(`미지원 doc_type: ${data.doc_type}`);
    if (!data.callback_url) throw new BadRequestException('callback_url 필수');
    if (!this.isCallbackUrlSafe(data.callback_url)) throw new BadRequestException('허용되지 않은 callback_url(내부망/비허용 호스트 차단)');

    // 멱등 — 동일 키/ref 재상신 방지
    const key = idempotencyKey || `${data.ref.source_module}:${data.ref.source_ref}`;
    // 🔴 (2026-09-15) 종전 `.catch(() => null)` — 멱등 조회 **실패**가 "중복 아님"이 되어 같은 결재를 다시 상신했다. 전파
    const dup = await this.prisma.eApprovalRelay.findUnique({ where: { idempotencyKey: key } });
    /**
     * 🔴 (2026-09-16 K1) 상신은 외부(Clinic)에 나갔는데 `approvalId` 매핑 저장이 실패하면 릴레이는
     *    PENDING·approvalId 없음으로 남는다. 그 뒤 재상신은 이 멱등 분기에 막히고, W.Sign 결과 webhook 은
     *    `approvalId` 로 릴레이를 찾으므로 **결재 결과가 영영 HIS 에 반영되지 않는다.**
     *    그 상태를 '정상 대기'처럼 돌려주지 않는다 — 매핑이 비었다는 사실을 응답이 말한다.
     */
    if (dup) {
      const mapped = !!dup.approvalId;
      if (!mapped && dup.status === 'PENDING') {
        this.logger.error(`ERP 상신 매핑 결손 — 재상신은 멱등으로 막히고 결과 webhook 은 매칭되지 않는다 relayId=${dup.id} key=${key}`);
      }
      return { ...this.toResponse(dup), ...(mapped ? {} : { mapped: false as const, mapping_error: 'APPROVAL_ID_MISSING' as const }) };
    }

    // 결재선: ERP 지정 없으면 조직도 자동 추천
    let approvers = data.approvers ?? [];
    let approvalLine: unknown[] = [];
    if (!approvers.length) {
      try {
        const rec = await this.clinicApi.getApprovers(data.drafter_clinic_user_id, data.doc_type);
        /**
         * 🔴 (2026-09-03 재검증) 정본(CLINIC-HIS-INTEGRATION v1.1.0 §7.3)의 키는
         *    `recommendedLine[].userId` 인데 여기가 `approvers[].clinicUserId` 를 읽어
         *    **자동 결재선 케이스 전건이 빈 결재선으로 상신**되고 있었다(키 부재라 catch 도 안 탄다).
         *    정본 키를 먼저, 옛 키는 폴백으로 두고 — 둘 다 없으면 관측 원장에 남긴다.
         */
        const canonical = Array.isArray(rec.recommendedLine)
          ? (rec.recommendedLine as { userId?: string }[]).map((a) => a.userId).filter((u): u is string => !!u)
          : [];
        const legacy = Array.isArray(rec.approvers)
          ? (rec.approvers as { clinicUserId?: string }[]).map((a) => a.clinicUserId).filter((u): u is string => !!u)
          : [];
        approvers = canonical.length ? canonical : legacy;
        approvalLine = approvers.map((u, i) => ({ clinic_user_id: u, step: i + 1 }));
        if (!approvers.length && rec && Object.keys(rec).length > 0) {
          this.drift?.record({
            kind: 'KEY_MISSING',
            producer: 'clinic.getApprovers',
            consumer: 'erp-eapproval.recommendLine',
            detail: `추천 응답에 recommendedLine/approvers 가 없음 — 빈 결재선으로 상신됨 · 실제 키: ${Object.keys(rec).join(', ').slice(0, 200)}`,
          });
        }
      } catch { /* 추천 실패 시 빈 결재선 — Clinic이 기본선 적용 가정 */ }
    } else {
      approvalLine = approvers.map((u, i) => ({ clinic_user_id: u, step: i + 1 }));
    }

    // 사전 매핑 레코드(상신 실패 대비)
    const relay = await this.prisma.eApprovalRelay.create({
      data: {
        docType: data.doc_type, title: data.title, refModule: data.ref.source_module, refId: data.ref.source_ref,
        drafterClinicUserId: data.drafter_clinic_user_id, callbackUrl: data.callback_url,
        approvalLine: approvalLine as object, idempotencyKey: key, status: 'PENDING',
      },
    });

    let submitted: { docId: string | null; viewUrl: string | null } | null = null;
    try {
      const res = await this.clinicApi.requestApproval({
        templateId, title: data.title, drafter: data.drafter_clinic_user_id,
        approvers, content: data.content, callbackUrl: `${this.hisBase()}/api/v1/webhooks/clinic`,
      });
      submitted = {
        docId: (res.docId as string) || (res.id as string) || null,
        viewUrl: (res.viewUrl as string) || (res.view_url as string) || null,
      };
    } catch (e) {
      // 🔴 (K4) 실패 표시까지 실패하면 릴레이가 PENDING 으로 남아 **재상신이 막힌다** — 삼키지 않고 남긴다
      // 🔴 호출을 한 줄로 유지한다 — 줄바꿈으로 나누면 상태 쓰기 스캐너가 이 쓰기를 못 본다(K4 실측)
      await this.prisma.eApprovalRelay.update({ where: { id: relay.id }, data: { status: 'ERROR' } })
        .catch((e2) => {
          this.logger.error(`ERP 결재 릴레이 실패 표시 실패(PENDING 으로 남음·재상신 차단) relay=${relay.id}: ${(e2 as Error).message}`);
        });
      throw e;
    }
    // 외부 상신은 끝났다 — 매핑은 로컬 쓰기이므로 일시 실패는 재시도한다(놓치면 결과가 돌아올 길이 없다)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const updated = await this.prisma.eApprovalRelay.update({
          where: { id: relay.id }, data: { approvalId: submitted.docId, viewUrl: submitted.viewUrl },
        });
        return this.toResponse(updated);
      } catch (e) {
        this.logger.error(`ERP 상신 매핑 저장 실패(시도 ${attempt}/3) relayId=${relay.id} docId=${submitted.docId ?? '-'}: ${e instanceof Error ? e.message : String(e)}`);
        if (attempt === 3) {
          throw new BadRequestException({
            code: 'EAPPROVAL_MAPPING_FAILED',
            message: '결재는 상신됐지만 문서 연결에 실패했습니다',
            details: { relayId: relay.id, approvalId: submitted.docId },
          });
        }
        await new Promise((r) => setTimeout(r, attempt * 200));
      }
    }
    // 위 루프는 반환하거나 던진다 — 도달하지 않는다(반환 타입에 undefined 가 섞이지 않게 못박는다)
    throw new BadRequestException({ code: 'EAPPROVAL_MAPPING_FAILED', message: '결재는 상신됐지만 문서 연결에 실패했습니다' });
  }

  /** ③ 상태 조회 릴레이 */
  async status(approvalId: string) {
    const relay = await this.prisma.eApprovalRelay.findUnique({ where: { approvalId } });
    if (!relay) throw new NotFoundException('결재 매핑 없음');
    let live: Record<string, unknown> = {};
    try { live = await this.clinicApi.getApprovalStatus(approvalId); } catch { /* 폴백: 저장값 */ }
    // 🔴 정본(§5.2) 상태 응답에 currentStep 은 없다 — approvalLine[] 의 단계별 status 에서 파생한다
    //    (미승인 첫 단계 = 현재 단계 · 전부 승인/정보 없음 = null. 없는 키를 계속 읽으면 항상 null 이었다)
    const lineSteps = Array.isArray(live.approvalLine) ? (live.approvalLine as { step?: number; status?: string }[]) : [];
    const derivedStep = lineSteps.find((s) => s.status !== 'approved')?.step ?? null;
    return {
      approval_id: approvalId, status: relay.status, result: relay.result,
      decided_at: relay.decidedAt, current_step: (live.currentStep as number | undefined) ?? derivedStep, view_url: relay.viewUrl,
      ref: { source_module: relay.refModule, source_ref: relay.refId },
    };
  }

  /** ④ 결재선 추천 */
  async approvers(drafterClinicUserId: string, docType?: string) {
    const rec = await this.clinicApi.getApprovers(drafterClinicUserId, docType);
    return rec;
  }

  /** ② W.Sign 결과 수신 → ERP 콜백 전달 (웹훅 핸들러에서 호출) */
  async handleWsignResult(docId: string, event: 'wsign.approved' | 'wsign.rejected' | 'wsign.withdrawn', payload: Record<string, unknown>) {
    const relay = await this.prisma.eApprovalRelay.findUnique({ where: { approvalId: docId } });
    if (!relay) { this.logger.warn(`W.Sign 결과 매핑 없음(docId=${docId}) — ERP 릴레이 외 문서`); return; }
    const result = event === 'wsign.approved' ? 'APPROVED' : event === 'wsign.withdrawn' ? 'WITHDRAWN' : 'REJECTED';
    /**
     * eventId 멱등 — 동일 종결 상태 재수신 시 콜백 재전달 생략(Clinic 재시도 3회 대비).
     *
     * 🔴 종전엔 "같은 결과를 이미 적었다"만으로 생략했다. 그런데 상태는
     *    **전달 전에** 종결로 바뀌므로, ERP 콜백이 3회 실패한 뒤 Clinic 이 같은 결과를 다시 보내도 여기서 멈춰
     *    **ERP 는 결재 결과를 영영 받지 못했다**(`callbackDelivered=false` 는 적히기만 하고 아무도 안 읽었다).
     *    생략은 **이미 전달된 경우에만** 한다 — 미전달이면 재수신이 곧 재전달 경로다.
     */
    if (TERMINAL_RESULTS.includes(relay.status) && relay.status === result) {
      if (relay.callbackDelivered) {
        this.logger.log(`W.Sign 결과 중복 수신(docId=${docId}, ${result}) — 전달 완료분이라 멱등 생략`);
        return;
      }
      this.logger.warn(`W.Sign 결과 재수신(docId=${docId}, ${result}) — ERP 콜백 미전달 상태라 재전달한다 relay=${relay.id}`);
    } else {
      // 새 결과는 아직 전달되지 않았다 — 원장이 그 사실을 말하게 한다(이전 결과의 `true` 를 물려받지 않는다)
      await this.prisma.eApprovalRelay.update({ where: { id: relay.id }, data: { status: result, result, decidedAt: new Date(), callbackDelivered: false } });
    }

    const body = {
      approval_id: docId,
      ref: { source_module: relay.refModule, source_ref: relay.refId },
      result,
      approved_by: payload.approvedBy ?? payload.approved_by ?? null,
      decided_at: new Date().toISOString(),
      event_id: (payload.eventId as string) || `EVT-${docId}-${Date.now()}`,
    };
    await this.deliverCallback(relay.id, relay.callbackUrl, body);
  }

  /** 콜백 egress 옵션 — 허용 호스트(EAPPROVAL_CALLBACK_HOSTS) 설정 시 강제. 정본 `eapproval-callback.ts`(재시도 경로와 같은 규칙) */
  private callbackEgressOpts(): SafeFetchOptions {
    return eapprovalEgressOpts(this.config.get<string>('EAPPROVAL_CALLBACK_HOSTS'));
  }

  /**
   * 콜백 URL 안전성 — 등록 시점(상신) 1차 검사.
   * 🔴 2026-08-20: 이 자리에 **safe-fetch 와 같은 일을 하는 두 번째 정규식**이 있었다(정본이 둘).
   *    그 사본은 safe-fetch 보다 좁아서 `100.64/10`(CGNAT)·IPv6 ULA(`fc00:`/`fd..`)·`fe80:`·
   *    `[::1]` 을 통과시켰다. 정본(`assertEgressUrl`) 하나로 수렴한다.
   *    실제 전송은 `deliverCallback` 이 `safeFetch` 로 **DNS 해석까지** 다시 본다(등록 후 DNS 변경 대비).
   */
  private isCallbackUrlSafe(raw: string): boolean {
    try {
      assertEgressUrl(raw, this.callbackEgressOpts());
      return true;
    } catch {
      return false;
    }
  }

  /** ERP 콜백 전달 — HMAC 서명 + 지수백오프 재시도(3회) */
  private async deliverCallback(relayId: string, url: string, body: object) {
    const secret = this.config.get<string>('EAPPROVAL_CALLBACK_SECRET') || '';
    if (!secret) { this.logger.error(`ERP 콜백 차단 — EAPPROVAL_CALLBACK_SECRET 미설정(서명 없는 전송 금지) relay=${relayId}`); return; }
    const raw = JSON.stringify(body);
    for (let i = 0; i < 3; i++) {
      try {
        // 🔴 safeFetch = 프로토콜·사설대역·**DNS 해석 결과**·리다이렉트(manual) 검증 + 타임아웃.
        //    콜백 URL 은 ERP 요청 본문에서 온 뒤 DB 에 저장된 값이라 이 저장소에서 가장 위험한 부류다.
        const res = await safeFetch(url, eapprovalCallbackRequest(raw, secret), this.callbackEgressOpts());
        if (res.ok) {
          // 🔴 (K4) 전달은 됐는데 표시가 실패하면 원장은 '미전달' 이다 — 재전송(ERP 중복 수신)으로 이어진다
          await this.prisma.eApprovalRelay
            .update({ where: { id: relayId }, data: { callbackDelivered: true } })
            .catch((e2) => {
              this.logger.error(`ERP 콜백 전달 표시 실패(전달은 성공·원장은 미전달로 남음) relay=${relayId}: ${(e2 as Error).message}`);
            });
          return;
        }
      } catch (e) {
        // 차단은 재시도해도 결과가 같다 — 반복하지 않고 즉시 실패로 끝낸다(성공으로 둔갑시키지 않는다).
        if (e instanceof EgressBlockedError) {
          this.logger.error(`ERP 콜백 차단(egress) relay=${relayId}: ${e.message}`);
          return;
        }
        this.logger.warn(`ERP 콜백 실패(${i + 1}/3): ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
    }
    // 원장은 `callbackDelivered=false` 로 남는다 — 같은 결과가 다시 오면(Clinic 재전송) 위 멱등 분기가 재전달한다.
    // (2026-10-01) 그리고 **자동 재시도**를 아웃박스에 맡긴다 — 종전엔 Clinic 재전송이 없으면 영영 끝이었다.
    const result = String((body as { result?: unknown }).result ?? '');
    if (!this.outbox) {
      this.logger.error(`ERP 콜백 최종 실패 relay=${relayId} — 미전달로 남김(자동 재시도 불가: 아웃박스 미주입 · 같은 결과 재수신 시 재전달)`);
      return;
    }
    try {
      const q = await this.outbox.enqueueDirect({
        domain: EAPPROVAL_OUTBOX.domain, event: EAPPROVAL_OUTBOX.event, format: EAPPROVAL_OUTBOX.format,
        ref: eapprovalOutboxRef(relayId, result), payload: body, targetUrl: url,
      });
      this.logger.error(`ERP 콜백 즉시 전달 3회 실패 relay=${relayId} — 미전달로 남기고 자동 재시도 대기열에 적재(${q})`);
    } catch (e) {
      // 적재 실패를 삼키지 않는다 — 미전달 + 자동 재시도도 없다는 사실을 남긴다
      this.logger.error(`ERP 콜백 최종 실패 relay=${relayId} — 자동 재시도 적재도 실패(같은 결과 재수신 시에만 재전달): ${(e as Error).message}`);
    }
  }

  private toResponse(r: { approvalId: string | null; status: string; viewUrl: string | null; approvalLine: unknown }) {
    return { approval_id: r.approvalId, status: r.status, view_url: r.viewUrl, approval_line: r.approvalLine ?? [] };
  }
}
