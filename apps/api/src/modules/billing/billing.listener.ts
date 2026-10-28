import { JourneyService } from '../journey/journey.service';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

@Injectable()
export class BillingListener {
  private readonly logger = new Logger(BillingListener.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigRuntimeService,
    /** 여정 정본 발행기(2026-10-01 P0-6 — 직접 쓰기 이관) */
    @Optional() private readonly journey?: JourneyService,
  ) {}

  @OnEvent('encounter.signed')
  async handleEncounterSigned(payload: { encounterId: string; patientId: string }) {
    // 1. 수납 자동 생성 — 일시 실패 재시도(3회·지수백오프) + 정정 재서명 시 수동검토 알림.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.billingService.createFromEncounter(payload.encounterId);
        this.logger.log(`Billing created for encounter ${payload.encounterId}`);
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists')) {
          // #2: 정정(AMENDED) 후 재서명 등으로 청구 기존재. 추가 처방을 어떻게 반영할지:
          //   - 옵트인 config `billing.autoRecalcOnAmend`=true: PENDING(미납) 청구에 미청구 처방만 증분 추가(멱등).
          //     자동 갱신이 적용되지 않으면(납부 진행·추가 없음) 종전대로 수동 검토 이벤트.
          //   - 기본(off): 이중청구 방지 위해 수동 검토 이벤트만.
          const autoRecalc = await this.config.get('billing.autoRecalcOnAmend');
          if (autoRecalc === true || autoRecalc === 'true') {
            try {
              const r = await this.billingService.recalcFromEncounter(payload.encounterId);
              if (r.status === 'recalculated') {
                this.logger.log(`Billing 자동 재계산 ${payload.encounterId}: +${r.addedLines} 라인`);
                break;
              }
              // 자동 적용 불가(납부 진행 등) → 수동 검토로 폴백
              this.logger.warn(`Billing 자동 재계산 미적용(${r.reason}) — 수동 검토 ${payload.encounterId}`);
            } catch (re: unknown) {
              this.logger.error(`Billing 자동 재계산 실패 ${payload.encounterId}: ${re instanceof Error ? re.message : String(re)}`);
            }
          }
          this.eventEmitter.emit('billing.amend_review_needed', { encounterId: payload.encounterId, patientId: payload.patientId });
          // 저니 영속화(관측성·논블로킹) — 청구 검토 대기 큐(billing/review-queue)에서 조회 가능.
          this.journey?.emit({
              patientId: payload.patientId,
              eventType: 'BILLING_AMEND_REVIEW',
              title: '청구 정정 검토 필요',
              description: '정정(AMENDED) 후 재서명 — 추가 처방의 청구 반영을 수동 확인하세요.',
              refType: 'ENCOUNTER',
              refId: payload.encounterId,
              severity: 'WARNING',
            });
          this.logger.warn(`Billing 기존재(정정 재서명 가능성) — 수동 검토 이벤트 발행 ${payload.encounterId}`);
          break;
        }
        this.logger.error(`Billing 생성 실패(시도 ${attempt}/3) ${payload.encounterId}: ${msg}`);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 500));
          continue;
        }
        // 🔴 3회 실패 — 종전에는 **로그 한 줄로 끝났다.** 그런데 바로 아래에서 대기열을
        //    `CASHIER_WAITING` 으로 넘긴다: 원무는 부를 환자가 있는데 **청구 내역이 없다.**
        //    실패를 남기지 않으면 "환자가 안 낸 것"과 "우리가 못 만든 것"을 구분할 수 없다.
        //    막지 않는다(진료는 이미 끝났다) — 줄어드는 목록으로 남긴다.
        this.journey?.emit({
            patientId: payload.patientId,
            eventType: 'BILLING_CREATE_FAILED',
            title: '청구 생성 실패',
            description: `자동 청구 생성이 3회 실패했습니다. 수납 화면에서 수동으로 청구를 만들어야 합니다. (사유: ${msg})`,
            refType: 'ENCOUNTER',
            refId: payload.encounterId,
            severity: 'CRITICAL',
          });
        this.eventEmitter.emit('billing.create_failed', { encounterId: payload.encounterId, patientId: payload.patientId, reason: msg });
      }
    }

    // 2. WaitingQueue 상태를 CASHIER_WAITING으로 변경
    try {
      const queue = await this.prisma.waitingQueue.findFirst({
        where: {
          encounterId: payload.encounterId,
          status: { in: ['IN_CONSULTATION', 'COMPLETED'] },
        },
      });

      if (queue) {
        await this.prisma.waitingQueue.update({
          where: { id: queue.id },
          data: { status: 'CASHIER_WAITING' },
        });
        this.logger.log(`WaitingQueue ${queue.id} → CASHIER_WAITING`);
      }
    } catch (err: unknown) {
      this.logger.error(`Failed to update WaitingQueue for encounter ${payload.encounterId}`, err instanceof Error ? err.stack : String(err));
    }
  }
}
