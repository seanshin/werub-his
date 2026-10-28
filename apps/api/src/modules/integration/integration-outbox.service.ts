import { Injectable, Logger, OnModuleInit, OnModuleDestroy, BadRequestException, Optional } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { assertEgressUrl, safeFetch, EgressBlockedError } from '../../common/util/safe-fetch';
import { allowsOutboundSend } from '@hospital-run/shared';
import { HisModeService } from '../../common/his-mode/his-mode.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { EAPPROVAL_OUTBOX, eapprovalCallbackRequest, eapprovalEgressOpts } from '../clinic-integration/eapproval-callback';

/** 아웃박스 행(발송 훅이 보는 모양) */
export interface OutboxRowView { id: string; domain: string; event: string; ref: string; payload: unknown; attempts: number }
/**
 * 도메인 훅(2026-10-01 · 전자결재 콜백 자동 재시도) — 발신 모듈이 등록한다.
 *  · `preflight`: 발송 **직전에** 이 행이 아직 보낼 것인지 묻는다(그 사이 원장이 바뀌었으면 보내지 않는다 — 낡은 결과 재전송 금지).
 *    보내지 않으면 행은 `CANCELLED` + 사유 — SENT 로 적지 않는다(나가지 않은 것을 보냈다고 말하지 않는다).
 *  · `onSent`: 발송 성공 뒤 원장 표시(예: 릴레이 `callbackDelivered`). 실패해도 발송은 성공이다 — 로그로 남긴다.
 */
export interface OutboxDomainHooks {
  preflight?: (row: OutboxRowView) => Promise<{ send: true } | { send: false; reason: string }>;
  onSent?: (row: OutboxRowView) => Promise<void>;
}

/**
 * HIS 가 외부로 발신하는 이벤트 카탈로그(his_webhooks 구독 가능 이벤트).
 *
 * 🔴 **이 목록은 어휘다 — 장식이 아니다.** 구독 등록 DTO 가 `@IsIn([...HIS_EVENT_CATALOG, '*'])` 로 쓰므로
 *    여기 없는 이벤트는 **이름으로 구독할 수 없다**(400). `'*'` 는 PHI 급 이벤트를 팬아웃에서 빼므로
 *    "전부 받는다"의 대체재도 아니다.
 *
 * 🔴 2026-09-21 외부(ERP) 실측 §3: **실제 발신 28 · 카탈로그 19** — 9종(`cost.period_closed` ·
 *    `equipment.*` 4 · `vendor.*` 2 · `voucher.*` 2)을 발신하고 있었는데 ERP 는 핸들러까지 갖추고도
 *    이름을 적을 수 없었다. 손으로 센 목록이 발신부와 갈라진 결과다.
 *
 * 🔴 **다시 갈라지지 않게 두 방향으로 묶는다(손으로 세지 않는다):**
 *    · 발신 ⊆ 카탈로그 — `enqueue(domain, event: HisEvent, …)` 가 이 목록의 **타입**을 받는다.
 *      카탈로그에 없는 이벤트를 발신하면 **tsc 가 실패**한다(발신 헬퍼도 같은 타입을 받는다).
 *    · 카탈로그 ⊆ 발신 — `test/integration/his-event-catalog-parity.spec.ts` 가 `enqueue()` 호출을 전수
 *      스캔해 **아무도 발신하지 않는 죽은 어휘**를 잡고, 위 타입이 `string` 으로 풀리지 않았는지도 본다.
 */
export const HIS_EVENT_CATALOG = [
  'staff.created', 'staff.changed', 'staff.resigned', 'staff.qualification_changed', 'staff.schedule_changed', 'staff.attendance_recorded',
  'billing.line_recorded', 'billing.adjusted', 'billing.settled',
  'billing.interim_recorded', 'billing.interim_paid', 'billing.discharge_settlement', // A-6 중간정산/퇴원정산(2026-07-22)
  'billing.interim_refunded', // 2026-10-22 중간정산 환불(ERP 회신 R5 계약 · 부분 환불 · refundId 멱등)
  'billing.interim_voided', // 2026-10-22 수납 전 중간정산 무효(발생이 무전표라 회계 영향 없음 · ERP 가 구독해야 받는다)
  'claim.submitted', 'claim.reviewed',
  'stock.changed', 'inventory.changed', 'pharmacy.dispensed', 'cssd.po.approved',
  'sign.completed', // e-sign #6 — 전자서명 완료 통지(완료본 URL+토큰 동봉)
  // ── 2026-09-21 §3 회수: 발신하고 있었는데 카탈로그에 없어 이름으로 구독할 수 없던 9종
  'cost.period_closed', // 원가·손익 마감 → ERP 관리회계(finance)
  'equipment.acquired', 'equipment.maintenance', 'equipment.status_changed', 'equipment.out_of_service', // 자산 → ERP assets
  'vendor.changed', 'vendor.synced', // 검진권 딜러 거래처 마스터 → ERP finance
  'voucher.line_recorded', 'voucher.settled', // 검진권 자금 이벤트(임상 billing.* 와 분리된 event_type)
] as const;
/** 발신 가능한 이벤트 = 카탈로그 원소 하나. `string` 으로 넓히면 parity 가드가 실패한다. */
export type HisEvent = (typeof HIS_EVENT_CATALOG)[number];
const WH_REF_SEP = '::wh:';

/**
 * 발송 직전 페이로드 갱신기 — 적재 시점이 아니라 **발송 시점**에 정해져야 하는 값(만료가 있는 토큰 등)을 다시 만든다.
 * 행에 저장된 페이로드는 바꾸지 않는다(원장 그대로) — 나가는 본문만 새 값을 싣는다.
 */
export type OutboxPayloadRefresher = (payload: Record<string, unknown>) => Record<string, unknown>;

/** P0-2: chartNo(가명화 전 MRN) 동봉 이벤트 — '*' 와일드카드 구독에서 제외(명시 구독만 팬아웃) */
export const PHI_GRADE_EVENTS = new Set<string>([
  'billing.line_recorded', 'billing.interim_recorded', 'billing.interim_paid', 'billing.discharge_settlement', 'billing.interim_voided', 'billing.interim_refunded',
]);

/** 이벤트 → 사람이 읽는 라벨·색상(Slack attachment color) */
const EVENT_META: Record<string, { label: string; color: string }> = {
  'staff.created': { label: '직원 등록', color: '#36a64f' },
  'staff.qualification_changed': { label: '직원 자격 변경', color: '#3aa3e3' },
  'staff.schedule_changed': { label: '근무표 변경', color: '#3aa3e3' },
  'staff.attendance_recorded': { label: '근태 기록', color: '#3aa3e3' },
  'billing.line_recorded': { label: '진료비 발생', color: '#2eb67d' },
  'billing.adjusted': { label: '진료비 조정', color: '#daa038' },
  'billing.settled': { label: '진료비 정산', color: '#2eb67d' },
  'billing.interim_recorded': { label: '중간정산 발생', color: '#2eb67d' },
  'billing.interim_paid': { label: '중간정산 수납', color: '#2eb67d' },
  'billing.interim_voided': { label: '중간정산 무효', color: '#daa038' },
  'billing.interim_refunded': { label: '중간정산 환불', color: '#daa038' },
  'billing.discharge_settlement': { label: '퇴원 정산', color: '#2eb67d' },
  'claim.submitted': { label: '청구 제출', color: '#2eb67d' },
  'claim.reviewed': { label: '청구 심사', color: '#daa038' },
  'stock.changed': { label: '재고 변동', color: '#3aa3e3' },
  'inventory.changed': { label: '재고 변동', color: '#3aa3e3' },
  'pharmacy.dispensed': { label: '조제 완료', color: '#3aa3e3' },
  'cssd.po.approved': { label: '구매요청 승인', color: '#2eb67d' },
  'sign.completed': { label: '전자서명 완료', color: '#2eb67d' },
  'cost.period_closed': { label: '원가 마감', color: '#daa038' },
  'equipment.acquired': { label: '자산 취득', color: '#2eb67d' },
  'equipment.maintenance': { label: '자산 정비', color: '#3aa3e3' },
  'equipment.status_changed': { label: '자산 상태 변경', color: '#daa038' },
  'equipment.out_of_service': { label: '자산 가동 중지', color: '#d93f3f' },
  'vendor.changed': { label: '거래처 변경', color: '#3aa3e3' },
  'vendor.synced': { label: '거래처 동기화', color: '#3aa3e3' },
  'voucher.line_recorded': { label: '검진권 거래 발생', color: '#2eb67d' },
  'voucher.settled': { label: '검진권 정산', color: '#2eb67d' },
  'webhook.ping': { label: '웹훅 테스트', color: '#999999' },
};

/** HIS 이벤트 → Slack 호환(W.Channel) 리치카드 메시지. payload 상위 키를 fields 로 노출(PHI 과다노출 방지: 12개 한정·문자열화). */
export function buildSlackMessage(event: string, ref: string, payload: unknown): object {
  const meta = EVENT_META[event] ?? { label: event, color: '#888888' };
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const fields = Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, 12)
    .map(([k, v]) => ({ title: k, value: String(v).slice(0, 200), short: true }));
  const titleLink = typeof p.url === 'string' ? p.url : (typeof p.link === 'string' ? p.link : undefined);
  return {
    text: `[HIS] ${meta.label}`,
    attachments: [{
      color: meta.color,
      title: meta.label,
      ...(titleLink ? { title_link: titleLink } : {}),
      fields,
      footer: `HIS · ${event} · ${ref}`,
    }],
  };
}

// ERP 연동 아웃박스 — 전 도메인 공통 전송보장(재시도/멱등). HIS→ERP 웹훅을 신뢰성 있게 발송.
// HIS 도메인 → ERP 수신 도메인 매핑(ERP ALLOWED_DOMAINS: finance/materials/assets/procurement/hr)
const ERP_DOMAIN: Record<string, string> = {
  cssd: 'materials', inventory: 'materials', pharmacy: 'materials',
  billing: 'finance', claim: 'finance', equipment: 'assets', hr: 'hr',
  cost: 'finance', // 원가·손익 마감(cost.period_closed) → ERP 관리회계(finance)
  voucher: 'finance', // 검진권 딜러 거래처 마스터(AP 정산 상대) → ERP finance
};

@Injectable()
export class IntegrationOutboxService implements OnModuleInit, OnModuleDestroy {
  /** 보류 로그를 상태가 바뀔 때만 남기기 위한 직전 상태(모드:대기건수) */
  private lastHoldStamp = '';

  private readonly logger = new Logger(IntegrationOutboxService.name);
  private timer?: ReturnType<typeof setInterval>;
  private dispatching = false;
  private readonly refreshers = new Map<string, OutboxPayloadRefresher>();
  constructor(private readonly prisma: PrismaService, private readonly configRuntime: ConfigRuntimeService,
    private readonly hisMode: HisModeService,
    @Optional() private readonly drift?: DriftRecorderService,
  ) {}

  // 디스패처를 @Interval 데코레이터가 아닌 plain setInterval로 구동.
  // (@nestjs/schedule v6.1.3의 정적-provider 게이팅 이슈로 @Interval 미발화 사례 → 항상 실행 보장)
  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.dispatching) return; // 직전 사이클 미완 시 중첩 방지
      this.dispatching = true;
      void this.dispatch()
        .catch((e) => this.logger.warn(`outbox dispatch 실패: ${(e as Error).message}`))
        .finally(() => { this.dispatching = false; });
    }, 20000);
    this.logger.log('outbox 디스패처 시작(setInterval 20s)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 🔴 (2026-09-28 §3 #30) `sign.completed` 의 완료본 URL 토큰(24시간)이 **적재 시점**에 발급됐다.
   *    리허설 보류(PENDING)나 FAILED 후 수동 재시도로 하루 넘게 지나 나가면 ERP 는 만료된 URL 을 받았다.
   *    발신 모듈이 이벤트별로 갱신기를 등록하면 디스패처가 **발송 직전에** 부른다.
   */
  registerPayloadRefresher(event: HisEvent, fn: OutboxPayloadRefresher) {
    this.refreshers.set(event, fn);
  }

  private readonly domainHooks = new Map<string, OutboxDomainHooks>();
  registerDomainHooks(domain: string, hooks: OutboxDomainHooks) {
    this.domainHooks.set(domain, hooks);
  }

  /**
   * 대상 지정 적재(2026-10-01) — ERP 기본 수신부·구독 팬아웃을 거치지 않고 **정해진 주소 한 곳**으로(전자결재 콜백처럼 수신처가 원장에 있는 것).
   * (domain, ref) 가 이미 있으면: PENDING·SENT 는 그대로 둔다(중복 발송 금지) · FAILED·CANCELLED 는 새 본문으로 다시 PENDING(재시도 횟수 0).
   * 반환: 적재/되살림/이미 있음.
   */
  async enqueueDirect(row: { domain: string; event: string; ref: string; payload: object; targetUrl: string; format?: string }): Promise<'QUEUED' | 'REVIVED' | 'EXISTS'> {
    // 한 트랜잭션 — 되살림은 현재 상태가 FAILED·CANCELLED 일 때만(조건부 · DB 가 경합을 판정) · 없으면 생성 ·
    // 동시에 같은 키로 들어오면 유니크(domain,ref)가 둘째를 막는다(P2002 = 이미 있음 — 중복 발송 없음)
    try {
      return await this.prisma.$transaction(async (tx) => {
        const revived = await tx.integrationOutbox.updateMany({
          where: { domain: row.domain, ref: row.ref, status: { in: ['FAILED', 'CANCELLED'] } },
          data: { status: 'PENDING', payload: row.payload, targetUrl: row.targetUrl, attempts: 0, nextAttemptAt: new Date(), lastError: null },
        });
        if (revived.count > 0) return 'REVIVED' as const;
        const exists = await tx.integrationOutbox.findUnique({ where: { domain_ref: { domain: row.domain, ref: row.ref } }, select: { id: true } });
        if (exists) return 'EXISTS' as const;
        await tx.integrationOutbox.create({ data: { ...row, format: row.format ?? null } });
        return 'QUEUED' as const;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return 'EXISTS';
      throw e;
    }
  }

  /** 갱신 실패는 적재 시점 값으로 보낸다 — 발송을 막지 않되, 그 사실을 남긴다 */
  private outgoingPayload(id: string, event: string, payload: unknown): unknown {
    const fn = this.refreshers.get(event);
    if (!fn || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    try {
      return fn(payload as Record<string, unknown>);
    } catch (e) {
      this.logger.warn(`outbox 발송 시점 갱신 실패 — 적재 시점 값으로 보냄 id=${id} event=${event}: ${(e as Error).message}`);
      return payload;
    }
  }

  /**
   * P0-1 egress 가명화 게이트(배치중립 N3) — 외부로 나가는 페이로드의 chartNo(MRN 원본)를
   * patientRef = HMAC-SHA256(chartNo, integration.pseudonymKey) 앞 16hex로 치환.
   * - config `integration.pseudonymizeChartNo` 기본 OFF(ERP 병행 개시 합의 후 ON)
   * - 결정적 토큰(환자당 안정) — ERP 매핑 이관·대사 가능. 원본·토큰 동시 포함 금지(이중발행 금지)
   * - ON인데 키 미설정이면 chartNo 제거만(유출보다 정보손실 — fail-closed) + 경고
   */
  private async pseudonymizePayload(payload: object): Promise<object> {
    try {
      const on = String((await this.configRuntime.get('integration.pseudonymizeChartNo')) ?? 'false') === 'true';
      if (!on) return payload;
      const p = payload as Record<string, unknown>;
      if (p.chartNo === undefined) {
        /**
         * 🔴 관측점(axis C): 이 게이트는 `chartNo` 라는 이름 하나에 얹혀 있다 — 발신부가
         *    `mrn`/`patientMrn`/`chart_no` 로 실으면 가명화가 조용히 건너뛰어져 원본이 나간다.
         *    페이로드를 바꾸지는 않는다(외부 계약·미지 키 보존) — 원장에 적어 사람이 본다.
         */
        const alias = ['mrn', 'patientMrn', 'chart_no', 'chartNumber'].find((k) => typeof p[k] === 'string' && p[k]);
        if (alias) {
          this.drift?.record({
            kind: 'KEY_MISSING',
            producer: 'outbox.enqueue.payload',
            consumer: 'integration-outbox.pseudonymize',
            detail: `가명화 대상 키 'chartNo' 가 없는데 별칭 '${alias}' 로 환자식별자가 실림 — 가명화가 건너뛰어짐`,
          });
        }
        return payload;
      }
      const { chartNo, ...rest } = p;
      if (typeof chartNo !== 'string' || !chartNo) return rest; // null/빈값 — 필드만 제거
      const key = (await this.configRuntime.get('integration.pseudonymKey')) as string | undefined;
      if (!key) {
        this.logger.warn('pseudonymizeChartNo ON인데 integration.pseudonymKey 미설정 — chartNo 제거(fail-closed)');
        return rest;
      }
      return { ...rest, patientRef: createHmac('sha256', key).update(chartNo).digest('hex').slice(0, 16) };
    } catch (e) {
      this.logger.warn(`가명화 게이트 오류 — 원본 발신 차단 위해 chartNo 제거: ${(e as Error).message}`);
      const { chartNo: _drop, ...rest } = payload as Record<string, unknown>;
      return rest;
    }
  }

  /** 이벤트 적재. ERP(webhook ON 시) + his_webhooks 구독 팬아웃. ref=멱등키. */
  async enqueue(domain: string, event: HisEvent, ref: string, rawPayload: object) {
    const payload = await this.pseudonymizePayload(rawPayload);
    try {
      const rows: { domain: string; event: string; ref: string; payload: object; targetUrl: string; secret?: string; format?: string }[] = [];
      // ① ERP 기본 수신부(설정 시)
      const enabled = await this.configRuntime.get('erp.webhookEnabled');
      const base = (await this.configRuntime.get('erp.webhookUrl')) as string;
      // test.* 는 게이트/키회전 검증 전용 — ERP 기본 수신부로 라우팅하지 않는다(ERP 에서 DEAD 로 쌓이던 것 방지).
      // 명시적으로 test.ping 을 구독한 웹훅(②)은 그대로 받으므로 검증은 계속 가능. (2026-07 ERP 라이브니스 회신)
      if (enabled && base && !event.startsWith('test.')) {
        const erpDomain = ERP_DOMAIN[domain] ?? domain;
        rows.push({ domain, event, ref, payload, targetUrl: `${base.replace(/\/$/, '')}/api/v1/integrations/his/${erpDomain}/webhook` });
      }
      // ② his_webhooks 구독 팬아웃 — ERP 토글과 독립. ref 에 ::wh:<id> 접미로 outbox UNIQUE 유지.
      const subs = await this.prisma.hisWebhook.findMany({ where: { isActive: true }, select: { id: true, targetUrl: true, events: true, secret: true, format: true } })
        .catch(() => [] as { id: string; targetUrl: string; events: string[]; secret: string; format: string }[]);
      for (const w of subs) {
        if (!(w.events.includes('*') || w.events.includes(event))) continue;
        // P0-2: PHI급 이벤트는 '*' 만으로 팬아웃 금지 — 명시 구독만(무심코 등록한 구독자에 환자 데이터 유출 방지)
        if (PHI_GRADE_EVENTS.has(event) && !w.events.includes(event)) continue;
        rows.push({ domain, event, ref: `${ref}${WH_REF_SEP}${w.id}`, payload, targetUrl: w.targetUrl, secret: w.secret, format: w.format });
      }
      if (!rows.length) return;
      // (domain,ref) UNIQUE 멱등키 — skipDuplicates 로 중복 무해 skip
      try {
        await this.prisma.integrationOutbox.createMany({ data: rows, skipDuplicates: true });
      } catch (batchErr) {
        // 배치 중 1행 불량(컬럼 길이 등)이 정상 행까지 유실시키지 않도록 행 단위 폴백
        this.logger.warn(`outbox createMany 실패 → 행 단위 폴백: ${(batchErr as Error).message?.trim().split('\n').pop()}`);
        for (const row of rows) {
          await this.prisma.integrationOutbox.create({ data: row }).catch((e) => {
            const err = e as { code?: string; message?: string };
            if (err.code === 'P2002') return; // 멱등 중복 — 무해
            this.logger.warn(`outbox 행 적재 실패(${row.event} ${row.ref.slice(0, 80)}): ${err.message?.trim().split('\n').pop()}`);
          });
        }
      }
    } catch (e) { this.logger.warn(`outbox enqueue 실패: ${(e as Error).message}`); }
  }

  /** 디스패처 — PENDING 발송, 실패 시 지수백오프 재시도. onModuleInit의 setInterval이 20초마다 호출. */
  async dispatch() {
    /**
     * 🔴 리얼 모드가 아니면 **외부로 나가지 않는다**(2026-08-26).
     *    종전에는 리허설 모드가 `CrmChannelService`(문자·메일·포털)만 막았고 **이 웹훅은 그대로 나갔다** —
     *    리허설에서 눌러본 이벤트가 협력사·ERP 수신부에 실제로 도착했다는 뜻이다.
     *
     * 🔴 **행을 건드리지 않는다.** `SENT` 로 적으면 나가지도 않은 것을 보냈다고 말하는 것이고,
     *    재시도(`retry`)로 넘기면 **실패하지 않은 것을 실패로** 세어 `attempts` 를 태우고 결국 FAILED 가 된다.
     *    사실은 **보류**다 — 상태는 PENDING 그대로 두고, 모드가 REAL 이 되면 그대로 나간다.
     */
    const mode = await this.hisMode.effective();
    if (!allowsOutboundSend(mode)) {
      const held = await this.prisma.integrationOutbox
        .count({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } } })
        .catch(() => -1);
      /**
       * 🔴 **같은 사실을 20초마다 반복하면 진짜 신호가 묻힌다.**
       *    이 한 줄이 하루 4,300줄을 차지해 로그의 대부분이었다(운영 실측 3,947/일).
       *    보류는 정상 동작이므로 **상태가 바뀔 때만** 말한다 —
       *    모드가 달라지거나 대기 건수가 달라졌을 때. 건수를 세지 못하면 세지 못했다고 말한다(0 으로 적지 않는다).
       */
      const stamp = `${mode}:${held}`;
      if (stamp !== this.lastHoldStamp) {
        this.lastHoldStamp = stamp;
        this.logger.log(
          `outbox dispatch 보류 — ${mode} 모드에서는 외부 발송을 하지 않는다 ` +
          `(대기 ${held < 0 ? '집계 실패' : `${held}건`} · 상태는 PENDING 유지 · 변할 때만 다시 알립니다)`,
        );
      }
      return;
    }

    const now = new Date();
    const rows = await this.prisma.integrationOutbox.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' }, take: 20,
    }).catch((e) => { this.logger.warn(`outbox findMany 실패: ${(e as Error).message}`); return []; });
    if (!rows.length) return;
    this.logger.log(`outbox dispatch: ${rows.length}건 발송 시작`);
    const key = (await this.configRuntime.get('erp.integrationKey')) as string;
    // ERP 인박스 서명 시크릿(정적 X-Integration-Key와 별도·안전채널 전달). 설정 시에만 서명 헤더 부착(관측→강제 무중단 전환)
    const inboundSecret = process.env.INBOUND_WEBHOOK_SECRET || ((await this.configRuntime.get('integration.inboundWebhookSecret')) as string) || '';

    for (const r of rows) {
      try {
        const hooks = this.domainHooks.get(r.domain);
        if (hooks?.preflight) {
          const pf = await hooks.preflight(r);
          if (!pf.send) {
            await this.prisma.integrationOutbox.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'CANCELLED', lastError: pf.reason.slice(0, 290) } });
            this.logger.log(`outbox 발송 취소 id=${r.id} domain=${r.domain}: ${pf.reason}`);
            continue;
          }
        }
        if (r.format === EAPPROVAL_OUTBOX.format) {
          // 전자결재 콜백 — 즉시 전달과 **같은** 본문·서명·egress(정본 eapproval-callback.ts). ERP 봉투로 감싸지 않는다.
          const secret = process.env.EAPPROVAL_CALLBACK_SECRET || '';
          if (!secret) throw new Error('EAPPROVAL_CALLBACK_SECRET 미설정 — 서명 없는 전송 금지');
          const res = await safeFetch(r.targetUrl, eapprovalCallbackRequest(JSON.stringify(r.payload), secret), eapprovalEgressOpts(process.env.EAPPROVAL_CALLBACK_HOSTS));
          if (!res.ok) { await this.retry(r.id, r.attempts, r.maxAttempts, `HTTP ${res.status}`); continue; }
          await this.prisma.integrationOutbox.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'SENT', sentAt: new Date(), attempts: r.attempts + 1 } });
          await hooks?.onSent?.(r).catch((e) => this.logger.error(`outbox 발송 후 원장 표시 실패(발송은 성공) id=${r.id}: ${(e as Error).message}`));
          continue;
        }
        const baseRef = r.ref.split(WH_REF_SEP)[0]; // his_webhooks 팬아웃 행은 ::wh:<id> 접미 제거 → 수신측 멱등키 일관
        const payload = this.outgoingPayload(r.id, r.event, r.payload); // 만료 토큰 등은 발송 시점 값으로
        // SLACK(W.Channel) 포맷이면 리치카드, 아니면 ERP envelope(event_type/event_id/source_ref/payload)
        const body = r.format === 'SLACK'
          ? JSON.stringify(buildSlackMessage(r.event, baseRef, payload))
          : JSON.stringify({ event_type: r.event, event_id: baseRef, source_ref: baseRef, payload });
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (r.secret) {
          // his_webhooks 구독: 본문 HMAC-SHA256 서명(수신측 위변조 검증) + timestamp 바인딩(리플레이 방어, ERP #3)
          headers['X-HIS-Signature'] = `sha256=${createHmac('sha256', r.secret).update(body).digest('hex')}`;
          const wts = Math.floor(Date.now() / 1000).toString();
          headers['X-Sign-Timestamp'] = wts;
          headers['X-Timestamp'] = wts; // 별칭(하위호환)
          headers['X-HIS-Signature-Ts'] = `sha256=${createHmac('sha256', r.secret).update(`${wts}.${body}`).digest('hex')}`;
        } else if (key) {
          headers['X-Integration-Key'] = key; // ERP 기본 수신부
        }
        // ERP 인박스 서명(HMAC+timestamp+nonce·재시도 시 재서명) — his_webhooks(SLACK/자체secret) 외 ERP 발신에 부착
        if (inboundSecret && !r.secret && r.format !== 'SLACK') {
          const ts = Math.floor(Date.now() / 1000).toString();
          headers['X-Timestamp'] = ts;
          headers['X-Sign-Timestamp'] = ts; // ERP 지정 헤더명 별칭(ERP #3 — sign 등 웹훅 timestamp 바인딩)
          headers['X-Nonce'] = randomBytes(16).toString('hex'); // 매 발송/재시도 신규 → verbatim 재전송 방지
          headers['X-Signature'] = createHmac('sha256', inboundSecret).update(`${ts}.${body}`).digest('hex');
        }
        // P0-2/G3: 발송 시점 재검증 — 등록 후 DNS 변경(rebinding) 대비.
        // 🔴 2026-08-20: 여기가 `if (r.secret) await assertEgressResolved(...)` 였다 — **fail-open 형태**
        //    (`if(expected && …)`). secret 없는 행은 검증도 리다이렉트 방어도 없이 나갔다.
        //    이제 두 부류 모두 safeFetch 를 통과한다. 다른 것은 **사설망 허용 여부 하나**뿐:
        //    ERP 기본 수신부(config 신뢰·원내 주소)는 allowPrivate, 등록 웹훅(secret 보유·사람 입력)은 아니다.
        //    safeFetch 는 redirect:'manual' 이라 302 로 내부망을 찌르는 우회도 함께 막힌다.
        const res = await safeFetch(
          r.targetUrl,
          { method: 'POST', headers, body },
          { timeoutMs: 8000, allowPrivate: !r.secret },
        );
        if (res.ok) {
          await this.prisma.integrationOutbox.update({ where: { id: r.id }, data: { status: 'SENT', sentAt: new Date(), attempts: r.attempts + 1 } });
          if (r.secret) await this.prisma.hisWebhook.updateMany({ where: { targetUrl: r.targetUrl, isActive: true }, data: { lastDeliveryAt: new Date() } }).catch(() => {});
        } else {
          await this.retry(r.id, r.attempts, r.maxAttempts, `HTTP ${res.status}`);
        }
      } catch (e) {
        await this.retry(r.id, r.attempts, r.maxAttempts, (e as Error).message);
      }
    }
  }

  /** 관리자 — 도메인별/상태별 통계 */
  async adminStats() {
    // 🔴 PENDING 이 쌓여 있는데 이유를 말하지 않으면 화면이 "밀려 있다"로만 읽힌다.
    //    리허설/개발 모드면 **보류 중**이라는 사실을 함께 낸다.
    const mode = await this.hisMode.effective();
    const outboundHeldByMode = !allowsOutboundSend(mode);
    const byStatus = await this.prisma.integrationOutbox.groupBy({ by: ['status'], _count: { id: true } });
    const byDomain = await this.prisma.integrationOutbox.groupBy({ by: ['domain', 'status'], _count: { id: true } });
    const failed = await this.prisma.integrationOutbox.findMany({ where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, domain: true, event: true, ref: true, attempts: true, lastError: true, createdAt: true } });
    // 이벤트별 라이브니스 — 마지막 발송 시각·경과일. 무수신 자동경보 대신 가시성 제공(2026-07 ERP 라이브니스 회신:
    // 무수신 6종은 정상 저빈도로 확정 → 운영자가 이벤트별 마지막 발송을 직접 보고 판단).
    const byEvent = await this.prisma.integrationOutbox.groupBy({
      by: ['event'], _max: { createdAt: true }, _count: { id: true },
    });
    const nowMs = Date.now();
    const liveness = byEvent
      .map((e) => {
        const last = e._max.createdAt;
        const staleDays = last ? Math.floor((nowMs - new Date(last).getTime()) / 86_400_000) : null;
        return { event: e.event, count: e._count.id, lastSentAt: last, staleDays };
      })
      .sort((a, b) => (b.staleDays ?? -1) - (a.staleDays ?? -1));
    return {
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count.id])),
      byDomain: byDomain.map((d) => ({ domain: d.domain, status: d.status, count: d._count.id })),
      liveness,
      failed,
      // 🔴 PENDING 이 밀린 것인지 **모드 때문에 보류된 것**인지 화면이 구분해 말할 수 있게 한다
      mode,
      outboundHeldByMode,
    };
  }

  /** 관리자 — 실패 건 재시도(PENDING 복귀) */
  async retryFailed(id?: string) {
    const where = id ? { id } : { status: 'FAILED' };
    const r = await this.prisma.integrationOutbox.updateMany({ where, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    return { requeued: r.count };
  }

  // ─────────────────────────── his_webhooks 구독 등록 관리(ADMIN) ───────────────────────────
  eventCatalog() { return [...HIS_EVENT_CATALOG]; }

  async listWebhooks() {
    return this.prisma.hisWebhook.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, targetUrl: true, events: true, format: true, isActive: true, description: true, lastDeliveryAt: true, createdAt: true },
    }); // secret 미노출
  }

  private validEvents(events: unknown): string[] {
    if (!Array.isArray(events)) return [];
    const ok = new Set<string>([...HIS_EVENT_CATALOG, '*']);
    return events.filter((e): e is string => typeof e === 'string' && ok.has(e));
  }

  private validFormat(f: unknown): 'RAW' | 'SLACK' { return f === 'SLACK' ? 'SLACK' : 'RAW'; }

  async createWebhook(dto: { name: string; targetUrl: string; events: string[]; secret?: string; description?: string; format?: string }, createdBy?: string) {
    if (!dto.name?.trim() || !dto.targetUrl?.trim()) throw new Error('name·targetUrl 필수');
    if (!/^https?:\/\//i.test(dto.targetUrl)) throw new Error('targetUrl 은 http(s) 절대 URL 이어야 합니다.');
    try { assertEgressUrl(dto.targetUrl); } // P0-2: 사설/loopback/링크로컬 차단(G2)
    catch (e) { throw new BadRequestException(`허용되지 않은 targetUrl: ${(e as Error).message}`); }
    const events = this.validEvents(dto.events);
    if (!events.length) throw new Error('유효한 이벤트를 1개 이상 지정하세요(카탈로그 또는 *).');
    const secret = dto.secret?.trim() || createHmac('sha256', `${dto.targetUrl}:${Date.now()}`).update('seed').digest('hex');
    return this.prisma.hisWebhook.create({
      data: { name: dto.name.trim(), targetUrl: dto.targetUrl.trim(), events, secret, format: this.validFormat(dto.format), description: dto.description ?? null, createdBy: createdBy ?? null },
      select: { id: true, name: true, targetUrl: true, events: true, format: true, isActive: true, secret: true }, // 생성 시 1회 secret 반환
    });
  }

  async updateWebhook(id: string, dto: { name?: string; targetUrl?: string; events?: string[]; isActive?: boolean; description?: string; secret?: string; format?: string }) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.targetUrl !== undefined) { if (!/^https?:\/\//i.test(dto.targetUrl)) throw new Error('targetUrl 은 http(s) 여야 합니다.'); try { assertEgressUrl(dto.targetUrl); } catch (e) { throw new BadRequestException(`허용되지 않은 targetUrl: ${(e as Error).message}`); } data.targetUrl = dto.targetUrl.trim(); }
    if (dto.events !== undefined) { const e = this.validEvents(dto.events); if (!e.length) throw new Error('유효 이벤트 필요'); data.events = e; }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.secret) data.secret = dto.secret.trim();
    if (dto.format !== undefined) data.format = this.validFormat(dto.format);
    return this.prisma.hisWebhook.update({ where: { id }, data, select: { id: true, name: true, targetUrl: true, events: true, format: true, isActive: true } });
  }

  async deleteWebhook(id: string) {
    await this.prisma.hisWebhook.delete({ where: { id } });
    return { deleted: true };
  }

  /** 등록 웹훅 테스트 발송(즉시, ping 이벤트) */
  async testWebhook(id: string) {
    const w = await this.prisma.hisWebhook.findUnique({ where: { id } });
    if (!w) throw new Error('웹훅을 찾을 수 없습니다.');
    const pingPayload = { ok: true, at: new Date().toISOString() };
    const body = w.format === 'SLACK'
      ? JSON.stringify(buildSlackMessage('webhook.ping', `ping:${id}`, pingPayload))
      : JSON.stringify({ event_type: 'webhook.ping', event_id: `ping:${id}`, source_ref: `ping:${id}`, payload: pingPayload });
    const sig = `sha256=${createHmac('sha256', w.secret).update(body).digest('hex')}`;
    try {
      // P0-2/G3: 테스트 발송도 동일 가드(safeFetch = 해석 검증 + redirect:'manual' + 타임아웃).
      const res = await safeFetch(
        w.targetUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HIS-Signature': sig }, body },
        { timeoutMs: 8000 },
      );
      if (res.ok) await this.prisma.hisWebhook.update({ where: { id }, data: { lastDeliveryAt: new Date() } });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      // 차단은 "테스트 실패"와 구분해서 말한다 — ok:false 로 뭉뚱그리면 운영자가 원인을 못 찾는다.
      if (e instanceof EgressBlockedError) return { ok: false, blocked: true, error: e.message };
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * 🔴 **재시도 표시가 실패하면 그 사실을 남긴다**(2026-09-16 E4).
   *    종전엔 두 update 가 `.catch(() => {})` 였다. 표시에 실패하면 행은 `attempts`·`nextAttemptAt` 이
   *    그대로인 PENDING 으로 남아 **20초마다 같은 발송을 영원히 재시도**하고(백오프도 상한도 안 걸린다),
   *    `FAILED` 로 넘어가지 못해 관리 화면의 실패 목록에도 끝내 안 뜬다 — 즉 **아무도 모르는 무한 루프**다.
   *    표시 실패를 고칠 길은 이 자리에 없지만(DB 가 흔들리는 중이다), 로그로는 반드시 남긴다.
   */
  private async markRetry(id: string, data: Record<string, unknown>, what: string) {
    try {
      await this.prisma.integrationOutbox.update({ where: { id }, data });
    } catch (e) {
      this.logger.error(`outbox ${what} 표시 실패 id=${id}: ${(e as Error).message} — 이 행은 재시도 상태가 갱신되지 않아 같은 발송을 반복할 수 있습니다`);
    }
  }

  private async retry(id: string, attempts: number, maxAttempts: number, error: string) {
    const n = attempts + 1;
    if (n >= maxAttempts) {
      await this.markRetry(id, { status: 'FAILED', attempts: n, lastError: error.slice(0, 290) }, '최종 실패');
      this.logger.error(`outbox 최종 실패(${n}/${maxAttempts}) id=${id}: ${error}`);
      return;
    }
    const delayMs = Math.min(60 * 60000, 1000 * Math.pow(2, n)); // 2^n초, 최대 1시간
    const next = new Date(Date.now() + delayMs);
    await this.markRetry(id, { attempts: n, lastError: error.slice(0, 290), nextAttemptAt: next }, '재시도 예약');
  }
}
