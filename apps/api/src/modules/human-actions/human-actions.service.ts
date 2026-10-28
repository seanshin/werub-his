import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  HUMAN_ACTIONS, HUMAN_H4_DECISION_KEYS, humanActionState, RESTRAINT_CHECK_INTERVAL_KEY, normalizeRestraintCheckInterval, PAIN_REASSESS_RULE_KEY, HANDOFF_ACK_MODE_KEY, RISK_REASSESS_INTERVAL_KEY,
  type DecisionRecordState, type HumanActionId, type HumanActionValue, type HumanCheckValue,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { readHandoffAckMode, readPainReassessRule, readRestraintInterval, readRiskReassessIntervals } from '../nursing-rules/nursing-rules.read';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { decisionRecordKey, isSeedDecisionRecord } from '../decision-registry/decision.service';
import { ALERT_REGISTRY } from '../notification/alert-registry';
import { alertApprovalStatus } from '../notification/alert-approval';
import { FcmPushService } from '../notification/fcm-push.service';
import {
  PATIENT_PUSH_MASTER_KEY, PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY, normalizeQueueNearAhead, patientPushTypeKey,
} from '../notification/patient-push.contract';

const NAMES_CAP = 30;

/**
 * 사람 몫 할 일 — 확인 항목을 **정본에서 파생**한다(2026-10-26 · 명세 `docs/05-reference/human-actions-2026-10-26.md`).
 *  · 🔴 체크박스 원장을 두지 않는다 — "했다"는 사람이 적는 것이 아니라 결정 기록·설정·원장이 말한다
 *  · 결정은 실결정만 충족(개발 시드는 결정이 아니다) · 조회 실패는 그 확인 항목만 UNKNOWN(다른 항목은 그대로)
 *  · 읽기 전용 — 고치는 것은 각 화면에서
 */
@Injectable()
export class HumanActionsService {
  private readonly logger = new Logger(HumanActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /** 한 확인 항목 — 실패는 그 항목만 UNKNOWN */
  private async guard(code: string, target: string | undefined, fn: () => Promise<HumanCheckValue>): Promise<HumanCheckValue> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`사람 몫 확인 실패(${code}${target ? ` ${target}` : ''}): ${e instanceof Error ? e.message : String(e)}`);
      return { code, state: 'UNKNOWN', ...(target ? { target } : {}) };
    }
  }

  private decisionCheck(key: string): Promise<HumanCheckValue> {
    return this.guard('DECISION_REAL', key, async () => {
      const rec = (await this.config.get(decisionRecordKey(key))) as { choice?: string; legalReviewRef?: string; authorityClaim?: string; note?: string } | null;
      const decision: DecisionRecordState = !rec ? 'NONE' : isSeedDecisionRecord(rec) ? 'SEED' : 'REAL';
      return { code: 'DECISION_REAL', state: decision === 'REAL' ? 'MET' : 'UNMET', target: key, decision, choice: rec?.choice ?? null };
    });
  }

  private flagCheck(code: string, key: string): Promise<HumanCheckValue> {
    return this.guard(code, key, async () => ({ code, state: (await this.config.get(key)) === true ? 'MET' : 'UNMET', target: key }));
  }

  private async checksOf(id: HumanActionId): Promise<HumanCheckValue[]> {
    switch (id) {
      case 'H1':
        return Promise.all([
          this.decisionCheck('ops.rehearsalOutboxAtCutover'),
          // 참고 값 — 의결 전에 몇 건이 걸려 있는가(판정에 넣지 않는다)
          this.guard('OUTBOX_PENDING', undefined, async () => ({ code: 'OUTBOX_PENDING', state: 'INFO', count: await this.prisma.integrationOutbox.count({ where: { status: 'PENDING' } }) })),
        ]);
      case 'H2':
        return [await this.decisionCheck('billing.institutionType')];
      case 'H3':
        return [await this.guard('STAY_PRICE_CONFIGURED', 'inpatient.bedRateCodes', async () => {
          const codes = await this.config.get('inpatient.bedRateCodes');
          const rates = await this.config.get('inpatient.bedRates');
          const has = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0;
          // 둘 중 하나라도 있으면 상수(기본 일당)가 아닌 단가 출처가 생긴다
          return { code: 'STAY_PRICE_CONFIGURED', state: has(codes) || has(rates) ? 'MET' : 'UNMET', target: 'inpatient.bedRateCodes · inpatient.bedRates' };
        })];
      case 'H4':
        return Promise.all(HUMAN_H4_DECISION_KEYS.map((k) => this.decisionCheck(k)));
      case 'H5':
        return Promise.all([
          this.guard('ORDER_SETS_UNAPPROVED', undefined, async () => {
            const count = await this.prisma.orderSet.count({ where: { isActive: true, status: 'ACTIVE', approvedBy: null } });
            return { code: 'ORDER_SETS_UNAPPROVED', state: count === 0 ? 'MET' : 'UNMET', count };
          }),
          this.guard('TEMPLATES_UNAPPROVED', undefined, async () => {
            const count = await this.prisma.treatmentScheduleTemplate.count({ where: { isActive: true, status: 'ACTIVE', approvedBy: null } });
            return { code: 'TEMPLATES_UNAPPROVED', state: count === 0 ? 'MET' : 'UNMET', count };
          }),
        ]);
      case 'H6':
        return Promise.all([
          this.guard('QUEUE_NEAR_THRESHOLD', PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY, async () => {
            const n = normalizeQueueNearAhead(await this.config.get(PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY));
            return { code: 'QUEUE_NEAR_THRESHOLD', state: n == null ? 'UNMET' : 'MET', target: PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY, count: n };
          }),
          this.flagCheck('PUSH_MASTER_ON', PATIENT_PUSH_MASTER_KEY),
          this.flagCheck('PUSH_TYPE_ON', patientPushTypeKey('QUEUE_NEAR')),
          this.guard('ALERT_APPROVED', 'PATIENT_PUSH_QUEUE_NEAR', async () => {
            const def = ALERT_REGISTRY.find((d) => d.code === 'PATIENT_PUSH_QUEUE_NEAR');
            if (!def) return { code: 'ALERT_APPROVED', state: 'UNKNOWN', target: 'PATIENT_PUSH_QUEUE_NEAR' };
            const latest = await this.prisma.alertApproval.findFirst({ where: { code: def.code }, orderBy: { approvedAt: 'desc' }, select: { snapshot: true, revokedAt: true } });
            return { code: 'ALERT_APPROVED', state: alertApprovalStatus(def, latest) === 'APPROVED' ? 'MET' : 'UNMET', target: def.code };
          }),
          this.guard('FCM_CREDENTIALS', undefined, async () => {
            // 발송부가 보는 것과 같은 판정(FcmPushService.isEnabled) — 못 찾으면 확인 불가
            let fcm: FcmPushService | null = null;
            try { fcm = this.moduleRef?.get(FcmPushService, { strict: false }) ?? null; } catch { fcm = null; }
            if (!fcm) return { code: 'FCM_CREDENTIALS', state: 'UNKNOWN' };
            return { code: 'FCM_CREDENTIALS', state: fcm.isEnabled ? 'MET' : 'UNMET' };
          }),
        ]);
      case 'H7':
        return [await this.guard('CLINIC_ROOMS_LINKED', undefined, async () => {
          const [schedRooms, linked] = await Promise.all([
            this.prisma.clinicSchedule.findMany({ where: { isActive: true }, select: { roomName: true }, distinct: ['roomName'] }),
            this.prisma.clinicRoom.findMany({ where: { spaceNodeId: { not: null } }, select: { name: true } }),
          ]);
          const linkedNames = new Set(linked.map((r) => r.name));
          const unlinked = schedRooms.map((r) => r.roomName).filter((n) => !linkedNames.has(n)).sort();
          return {
            code: 'CLINIC_ROOMS_LINKED', state: unlinked.length === 0 ? 'MET' : 'UNMET',
            count: unlinked.length, names: unlinked.slice(0, NAMES_CAP), truncated: unlinked.length > NAMES_CAP,
          };
        })];
      case 'H11': {
        // 코드 기본값·개발 시드는 원내 규정이 아니다 — 사람이 입력한 형식 맞는 값만 충족(읽기 정본 readRestraintInterval)
        const r = await readRestraintInterval(this.config);
        return [{ code: 'RESTRAINT_INTERVAL_CONFIGURED', state: r.source === 'CONFIGURED' ? 'MET' : r.source === 'UNKNOWN' ? 'UNKNOWN' : 'UNMET', target: RESTRAINT_CHECK_INTERVAL_KEY, count: r.source === 'CONFIGURED' ? r.minutes : null }];
      }
      case 'H12': {
        // 코드 기본값·미설정은 원내 결정이 아니다 — 사람이 고른 값(DB·환경)만 충족 · 조회 실패는 그 항목만 확인 불가
        const [pain, mode, risk] = await Promise.all([readPainReassessRule(this.config), readHandoffAckMode(this.config), readRiskReassessIntervals(this.config)]);
        const st = (src: string): HumanCheckValue['state'] => (src === 'CONFIGURED' ? 'MET' : src === 'UNKNOWN' ? 'UNKNOWN' : 'UNMET');
        return [
          { code: 'PAIN_RULE_CONFIGURED', state: st(pain.source), target: PAIN_REASSESS_RULE_KEY },
          { code: 'HANDOFF_ACK_MODE_CONFIGURED', state: st(mode.source), target: HANDOFF_ACK_MODE_KEY },
          { code: 'RISK_INTERVALS_CONFIGURED', state: st(risk.source), target: RISK_REASSESS_INTERVAL_KEY },
        ];
      }
      case 'H10':
        // 참고 — 온라인 결제 대사 결정만 등록부에 있다(본인확인 강화는 후보 키뿐) · 판정은 사람이
        return [{ ...(await this.decisionCheck('billing.paymentRefReconciliation')), state: 'INFO' }];
      default:
        return [];
    }
  }

  async list(): Promise<{ items: HumanActionValue[]; generatedAt: string }> {
    const items = await Promise.all(HUMAN_ACTIONS.map(async (d) => {
      const checks = await this.checksOf(d.id);
      return { id: d.id, state: humanActionState(d.derivable, checks), checks };
    }));
    return { items, generatedAt: new Date().toISOString() };
  }
}
