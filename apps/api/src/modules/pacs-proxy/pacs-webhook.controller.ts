import { Controller, Post, Headers, Body, Logger, Optional } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PacsReportCompletedDto, PacsStudyReceivedDto, PacsStudyUpdatedDto } from './dto/pacs-webhook.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

/**
 * OpenPACS → HIS 웹훅 수신 (서버-서버, X-Webhook-Secret).
 * 오더 상태·판독 소견을 쓰므로 fail-closed — 시크릿 미구성이면 401(종전: 미구성 시 검증 생략=무인증 개방).
 * 키는 SystemConfig `pacs.webhookSecret`(env PACS_WEBHOOK_SECRET 폴백)에서 상수시간 비교.
 */
@ApiTags('PACS Webhooks')
@ApiHeader({ name: 'X-Webhook-Secret', required: true })
@Controller('api/v1/pacs')
export class PacsWebhookController {
  private readonly logger = new Logger(PacsWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationAuth: IntegrationAuthService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly drift?: DriftRecorderService,
  ) {}

  /**
   * 🔴 (2026-09-03) accession 의 정본은 `order.accessionNumber` 다 — 생산자(worklist 등록)가
   *    2026-08 "notes 덮어쓰기" 결함 수정으로 전용 컬럼에 옮겼는데, 이 웹훅 3곳만 계속
   *    `notes contains` 로 찾아 **매칭 0 → 판독 완료가 영영 HIS 에 안 들어오는데 200 을 돌려줬다**
   *    (PACS 는 성공으로 알고 재시도하지 않는다). 취소 경로의 규칙과 같게 **둘 다** 본다
   *    (컬럼 도입 이전 건은 notes 에 남아 있다).
   */
  private orderByAccession(accession: string) {
    return {
      OR: [
        { accessionNumber: accession },
        { notes: { contains: accession } },
      ],
    };
  }

  /** 매칭 실패는 침묵하지 않는다 — 로그+감시자 원장(판독이 어느 오더에도 붙지 않은 사건) */
  private recordMiss(hook: string, accession: string) {
    this.logger.warn(`PACS 웹훅 ${hook}: accession '${accession}' 이 어느 오더에도 매칭되지 않았습니다 — 판독/상태가 HIS 에 반영되지 못했습니다`);
    this.drift?.record({
      kind: 'KEY_MISSING',
      producer: 'openpacs.webhook.accession_number',
      consumer: 'pacs-webhook.orderLookup',
      detail: `${hook}: accession '${accession}' 이 order.accessionNumber/notes 어디에도 없음`,
    });
  }

  @Post('webhook/study-received')
  @ApiOperation({ summary: 'PACS 웹훅: 영상 수신 알림' })
  async onStudyReceived(
    @Headers('x-webhook-secret') secret: string,
    @Body() body: PacsStudyReceivedDto,
  ) {
    await this.integrationAuth.assertPacsWebhookKey(secret);

    const order = await this.prisma.order.findFirst({
      where: this.orderByAccession(body.accession_number),
    });
    if (order) {
      // 🔴 (2026-09-16 H4) 오더 전이와 영상결과 기록은 한 트랜잭션 — 한쪽만 커밋되면 오더는 촬영 중인데
      //    영상결과에는 수신 시각이 없다. PACS 웹훅은 재전송을 보장하지 않으므로 그 갈라짐이 그대로 굳는다.
      const at = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'IN_PROGRESS', startedAt: at },
        });
        await tx.imagingResult.updateMany({
          where: { orderId: order.id },
          data: { acquiredAt: at },
        });
      });
      this.logger.log(`Study received for accession ${body.accession_number}`);
    } else {
      this.recordMiss('study-received', body.accession_number);
    }

    return { data: { received: true, matched: !!order } };
  }

  @Post('webhook/report-completed')
  @ApiOperation({ summary: 'PACS 웹훅: 판독 완료 알림' })
  async onReportCompleted(
    @Headers('x-webhook-secret') secret: string,
    @Body() body: PacsReportCompletedDto,
  ) {
    await this.integrationAuth.assertPacsWebhookKey(secret);

    const order = await this.prisma.order.findFirst({
      where: this.orderByAccession(body.accession_number),
      include: { prescription: { include: { encounter: true } } },
    });
    if (order) {
      // 🔴 (2026-09-16 H4) 오더 완료와 판독 내용은 한 트랜잭션 — 종전엔 오더를 먼저 COMPLETED 로 커밋해,
      //    뒤가 실패하면 **소견 없이 닫힌 오더**가 남았다(웹훅 재전송 보장 없음 = 판독문이 영영 안 들어온다).
      const at = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'COMPLETED', completedAt: at },
        });
        await tx.imagingResult.updateMany({
          where: { orderId: order.id },
          data: {
            finding: body.finding || null,
            impression: body.impression || null,
            // §6 회수(2026-08-25): DTO 로 받아 놓고 버리던 판독의 표시명 보존.
            // 🔴 이름→User 추측 매핑은 하지 않는다 — radiologistId 는 원내 판독 경로만 채운다
            radiologistName: body.radiologist_name ? String(body.radiologist_name).slice(0, 100) : null,
            status: 'REPORTED',
            reportedAt: at,
          },
        });
      });

      // Emit event for notification system
      this.eventEmitter.emit('imaging.report_completed', {
        orderId: order.id,
        accessionNumber: body.accession_number,
        patientId: order.prescription?.encounter?.patientId,
        encounterId: order.prescription?.encounterId,
        finding: body.finding,
        impression: body.impression,
      });

      this.logger.log(`Report completed for accession ${body.accession_number}`);
    } else {
      this.recordMiss('report-completed', body.accession_number);
    }

    return { data: { received: true, matched: !!order } };
  }

  @Post('webhook/study-updated')
  @ApiOperation({ summary: 'PACS 웹훅: 영상 상태 변경' })
  async onStudyUpdated(
    @Headers('x-webhook-secret') secret: string,
    @Body() body: PacsStudyUpdatedDto,
  ) {
    await this.integrationAuth.assertPacsWebhookKey(secret);

    const order = await this.prisma.order.findFirst({
      where: this.orderByAccession(body.accession_number),
    });
    if (!order) this.recordMiss('study-updated', body.accession_number);
    if (order && body.status) {
      const statusMap: Record<string, string> = {
        ACQUIRED: 'IN_PROGRESS',
        REPORTED: 'COMPLETED',
        CANCELLED: 'CANCELLED',
      };
      const mappedStatus = statusMap[body.status.toUpperCase()];
      if (mappedStatus) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: mappedStatus as any },
        });
      }
      this.logger.log(`Study updated for accession ${body.accession_number}: ${body.status}`);
    }

    return { data: { received: true, matched: !!order } };
  }
}
