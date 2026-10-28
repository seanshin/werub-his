import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PacsProxyService } from './pacs-proxy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 영상 오더 ↔ PACS 워크리스트 연동.
 *
 * 🔴 종전 결함 셋을 여기서 정리한다:
 *  1. **거짓 성공 로그** — `createWorklistItem().catch(warn)` 으로 실패를 삼킨 뒤, 그 아래에서
 *     무조건 "PACS worklist registered" 를 찍었다. 등록 실패가 성공으로 보였고 남는 흔적도 없었다.
 *  2. **수행 메모 덮어쓰기** — accession 번호를 `notes` 에 통째로 써서, 사전처방 등에서 넘어온
 *     오더 메모가 지워졌다. 전용 컬럼(`accessionNumber`)으로 옮긴다.
 *  3. **취소 역전이 무발동** — 발행 payload 는 `{prescriptionId, orderIds[], reason}` 인데
 *     구독자는 `payload.department`·`payload.orderId` 를 기대해 **항상 조기 반환**했다.
 *     두 형태를 모두 받아 정규화하고, department 는 DB 에서 직접 읽는다.
 */
@Injectable()
export class PacsIntegrationListener {
  private readonly logger = new Logger(PacsIntegrationListener.name);

  constructor(
    private readonly pacsProxy: PacsProxyService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('order.created')
  async handleOrderCreated(payload: {
    orderId: string;
    type: string;
    patientId: string;
    procedureCodeId?: string;
    priority?: string;
  }) {
    if (payload.type !== 'IMAGING') return;

    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: {
        prescription: {
          include: {
            procedureCode: true,
            encounter: { include: { patient: { select: { mrn: true, familyName: true, givenName: true } } } },
          },
        },
      },
    });
    if (!order) return;

    const patient = order.prescription?.encounter?.patient;
    const procCode = order.prescription?.procedureCode;
    const accNo = `ACC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${payload.orderId.slice(0, 8).toUpperCase()}`;

    try {
      // 성공/실패를 **구분해서** 남긴다 — 삼키면 촬영실에 오더가 안 떠도 아무도 모른다.
      await this.pacsProxy.createWorklistItem({
        patient_id: patient?.mrn || '',
        patient_name: `${patient?.familyName || ''}${patient?.givenName || ''}`,
        accession_number: accNo,
        modality: this.detectModality(procCode?.code || ''),
        scheduled_date: new Date().toISOString(),
        study_description: procCode?.nameKo || '',
        priority: payload.priority === 'STAT' ? 'STAT' : 'ROUTINE',
      });
      await this.prisma.order.update({
        where: { id: payload.orderId },
        data: { accessionNumber: accNo, worklistStatus: 'REGISTERED', worklistError: null },
      });
      this.logger.log(`PACS worklist registered: ${accNo} for order ${payload.orderId}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      // 오더 자체는 유효하다 — 등록 실패만 표시하고 흐름은 막지 않는다(촬영실 수동 등록 가능).
      await this.prisma.order
        .update({
          where: { id: payload.orderId },
          data: { accessionNumber: accNo, worklistStatus: 'FAILED', worklistError: reason.slice(0, 500) },
        })
        .catch(() => undefined);
      this.logger.warn(`PACS worklist 등록 실패 order=${payload.orderId} acc=${accNo}: ${reason}`);
    }
  }

  /**
   * 워크리스트 실패분 재등록(§H.8·2026-08-04) — OPENPACS 자격이 살아난 뒤 FAILED 를 일괄 재시도.
   * 취소되지 않은 IMAGING 오더만 대상·기존 accessionNumber 재사용(촬영실 대조 일관성).
   * 결과는 건별 성공/실패로 반환 — "재시도했다"가 아니라 "몇 건이 살아났는가"를 말한다.
   */
  /** 재등록 대상 = 미등록 활성 오더 전체 — FAILED 뿐 아니라 리스너 도입 이전(null)·UNKNOWN 도 포함(운영 실측: FAILED 는 전부 취소분, 실갭은 null/UNKNOWN) */
  private static readonly RETRY_WHERE = {
    department: 'IMAGING' as const,
    status: { in: ['ORDERED', 'RECEIVED'] as never },
    OR: [{ worklistStatus: { in: ['FAILED', 'UNKNOWN'] } }, { worklistStatus: null }],
  };

  async countFailedWorklist() {
    return this.prisma.order.count({ where: PacsIntegrationListener.RETRY_WHERE as never });
  }

  async retryFailedWorklist(limit = 50) {
    const failed = await this.prisma.order.findMany({
      where: PacsIntegrationListener.RETRY_WHERE as never,
      include: {
        prescription: {
          include: {
            procedureCode: true,
            encounter: { include: { patient: { select: { mrn: true, familyName: true, givenName: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let ok = 0;
    const failures: { orderId: string; reason: string }[] = [];
    for (const order of failed) {
      const patient = order.prescription?.encounter?.patient;
      const procCode = order.prescription?.procedureCode;
      const accNo = order.accessionNumber
        ?? `ACC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${order.id.slice(0, 8).toUpperCase()}`;
      try {
        await this.pacsProxy.createWorklistItem({
          patient_id: patient?.mrn || '',
          patient_name: `${patient?.familyName || ''}${patient?.givenName || ''}`,
          accession_number: accNo,
          modality: this.detectModality(procCode?.code || ''),
          scheduled_date: new Date().toISOString(),
          study_description: procCode?.nameKo || '',
          priority: order.priority === 'STAT' ? 'STAT' : 'ROUTINE',
        });
        await this.prisma.order.update({
          where: { id: order.id },
          data: { accessionNumber: accNo, worklistStatus: 'REGISTERED', worklistError: null },
        });
        ok++;
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await this.prisma.order.update({ where: { id: order.id }, data: { worklistError: reason } }).catch((we) => {
          // 실패 사유를 오더에 못 남기면 화면은 옛 사유를 보여 준다 — 그 사실을 남긴다
          this.logger.warn(`PACS worklistError write failed order=${order.id}: ${we instanceof Error ? we.message : String(we)}`);
        });
        failures.push({ orderId: order.id, reason });
      }
    }
    this.logger.log(`PACS worklist 재등록: 대상 ${failed.length} → 성공 ${ok} · 실패 ${failures.length}`);
    return { attempted: failed.length, registered: ok, failures };
  }

  /**
   * 오더 취소 → PACS 워크리스트 취소.
   * 발행부가 단건(orderId)으로 주든 다건(orderIds[])으로 주든 받는다 — 계약 불일치로 **한 번도
   * 발동하지 않던** 이력이 있어 구독자 쪽에서 형태를 흡수한다.
   */
  @OnEvent('order.cancelled')
  async handleOrderCancelled(payload: {
    orderId?: string;
    orderIds?: string[];
    department?: string;
    prescriptionId?: string;
  }) {
    const ids = payload?.orderIds?.length ? payload.orderIds : payload?.orderId ? [payload.orderId] : [];
    if (ids.length === 0) return;

    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids }, department: 'IMAGING' },
      select: { id: true, accessionNumber: true, notes: true },
    });

    for (const order of orders) {
      // 컬럼 도입 이전 건은 notes 에 남아 있다 — 둘 다 본다.
      const accNo = order.accessionNumber ?? (order.notes?.startsWith('accession:') ? order.notes.replace('accession:', '') : '');
      if (!accNo) continue;
      try {
        await this.pacsProxy.cancelOrder({ accessionNumber: accNo, reason: 'HIS에서 오더 취소' });
        await this.prisma.order.update({ where: { id: order.id }, data: { worklistStatus: 'CANCELLED' } });
        this.logger.log(`PACS worklist 취소: ${accNo} (order ${order.id})`);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        await this.prisma.order
          .update({ where: { id: order.id }, data: { worklistError: `취소 실패: ${reason}`.slice(0, 500) } })
          .catch(() => undefined);
        this.logger.warn(`PACS worklist 취소 실패 order=${order.id} acc=${accNo}: ${reason}`);
      }
    }
  }

  private detectModality(code: string): string {
    if (!code) return 'OT';
    if (code.startsWith('HA') || code.toUpperCase().includes('CT')) return 'CT';
    if (code.startsWith('HE') || code.toUpperCase().includes('MR')) return 'MR';
    if (code.startsWith('HC') || code.includes('초음파')) return 'US';
    if (code.startsWith('G') || code.includes('X-ray') || code.includes('X선')) return 'CR';
    return 'OT';
  }
}
