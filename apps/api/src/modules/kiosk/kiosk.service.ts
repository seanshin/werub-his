import { billingOutstanding } from '@hospital-run/shared';
import { Injectable, BadRequestException, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WaitingQueueService } from '../waiting-queue/waiting-queue.service';
import { BillingService } from '../billing/billing.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PublicAccessLogService } from '../public-access/public-access-log.service';
import { dobMatches } from './kiosk-verify';

@Injectable()
export class KioskService {
  private readonly logger = new Logger(KioskService.name);

  /**
   * 🔴 본인확인 실패는 **한 가지 응답**으로만 답한다.
   *    종전에는 등록번호 부존재를 404, 생년월일 불일치를 400 으로 갈라 놓아
   *    **유효한 MRN 을 무료로 열거할 수 있었다**(`P2026-####` 는 순차 추정도 된다).
   *    무인증 공개 단말이고 계정 잠금도 없으므로 이 구분 자체가 취약점이다.
   *    (같은 결함을 공개 예약 챗에서도 같은 날 봉합했다.)
   */
  private static readonly VERIFY_FAIL = '등록번호 또는 생년월일이 일치하지 않습니다. 접수 창구를 이용해 주세요.';

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: WaitingQueueService,
    private readonly billing: BillingService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly accessLog?: PublicAccessLogService,
  ) {}

  /** 등록번호(MRN)+생년월일 본인확인 → 환자 반환 */
  private async verifyPatient(mrn: string, dob: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { mrn: (mrn ?? '').trim() },
      select: { id: true, familyName: true, givenName: true, dateOfBirth: true },
    });
    // 🔴 두 실패를 구분하지 않는다 — 구분하는 순간 MRN 열거 오라클이 된다
    const ok = !!patient && dobMatches(patient.dateOfBirth.toISOString().slice(0, 10).replace(/-/g, ''), dob);
    // 🔴 무인증이라 AuditLog(User FK)에 담을 수 없다 → 공개 접근 원장에 남긴다.
    //    등록번호 원문은 적지 않는다(해시). 통과한 경우에만 환자를 지목한다.
    await this.accessLog?.record({
      channel: 'KIOSK', action: 'verify', path: '/api/v1/kiosk', result: ok ? 'OK' : 'FAIL',
      subject: mrn, patientId: ok ? patient!.id : null,
    });
    if (!ok) {
      this.logger.warn(`키오스크 본인확인 실패 mrn=${(mrn ?? '').slice(0, 3)}*** (사유는 응답에서 구분하지 않는다)`);
      throw new UnauthorizedException(KioskService.VERIFY_FAIL);
    }
    return patient!;
  }

  /** 무인증 키오스크 접수 — 금일 예약 기반 대기열 등록 */
  async checkIn(mrn: string, dob: string) {
    const patient = await this.verifyPatient(mrn, dob);
    const name = `${patient.familyName}${patient.givenName}`;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);

    const appt = await this.prisma.appointment.findFirst({
      where: { patientId: patient.id, scheduledAt: { gte: start, lt: end }, status: 'SCHEDULED' },
      orderBy: { scheduledAt: 'asc' },
      include: { doctor: { select: { id: true, familyName: true, givenName: true, department: true } } },
    });
    if (!appt) return { checkedIn: false, patientName: name, message: '금일 예약 내역이 없습니다. 접수 창구를 이용해 주세요.' };

    const dept = appt.doctor?.department ?? '내과';
    const doctorName = appt.doctor ? `${appt.doctor.familyName}${appt.doctor.givenName}` : null;
    const existing = await this.prisma.waitingQueue.findFirst({
      where: { patientId: patient.id, checkedInAt: { gte: start }, status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] } },
    });
    if (existing) return { checkedIn: true, already: true, patientName: name, department: existing.departmentName, doctorName, queueNumber: existing.queueNumber };

    const res = await this.queue.checkIn({ patientId: patient.id, doctorId: appt.doctorId, departmentName: dept, visitType: 'FOLLOW_UP', appointmentId: appt.id });
    return { checkedIn: true, patientName: name, department: dept, doctorName, queueNumber: res.queueNumber };
  }

  /** 정본 shared `billingOutstanding`(키오스크가 먼저 맞게 세고 있었다 — 같은 식을 모두가 쓰게 옮겼다 · P4-1) */
  private outstandingOf(b: { patientCopay: number; discountAmount: number | null; paidAmount: number | null }): number {
    return billingOutstanding(b) ?? 0;
  }

  /** 무인증 미납 조회 — 본인확인 후 미납 청구 목록·합계 */
  async getBilling(mrn: string, dob: string) {
    const patient = await this.verifyPatient(mrn, dob);
    const rows = await this.prisma.billing.findMany({
      where: { patientId: patient.id, status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] } },
      include: { encounter: { select: { visitType: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    const billings = rows
      .map((b) => ({ id: b.id, date: b.createdAt.toISOString().slice(0, 10), visitType: b.encounter?.visitType ?? '-', totalAmount: b.totalAmount, patientCopay: b.patientCopay, paidAmount: b.paidAmount ?? 0, outstanding: this.outstandingOf(b) }))
      .filter((b) => b.outstanding > 0);
    return { patientName: `${patient.familyName}${patient.givenName}`, billings, totalOutstanding: billings.reduce((s, b) => s + b.outstanding, 0), count: billings.length };
  }

  /** 무인증 결제 — 본인확인 후 미납 전액 결제(카드/간편) */
  async pay(mrn: string, dob: string, method: string) {
    const patient = await this.verifyPatient(mrn, dob);
    const rows = await this.prisma.billing.findMany({
      where: { patientId: patient.id, status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] } },
    });
    const payable = rows.map((b) => ({ id: b.id, outstanding: this.outstandingOf(b) })).filter((b) => b.outstanding > 0);
    if (payable.length === 0) throw new BadRequestException('미납 금액이 없습니다.');

    // 🔴 이 단말에는 PG·VAN 연동이 없다. 종전에는 그런데도 승인번호를 `KIOSK-<timestamp>` 로
    //    **지어내 수납을 확정**하고 있었다 — 실제로 돈이 오가지 않았는데 원장에는 '수납 완료'가 남는다.
    //    (실행하지 않고 성공 상태만 기록 — 이 저장소가 P16 이라 부르는 것이고, 여기서는 금전 기록이다.)
    //    전송을 흉내내지 않는다: 승인 응답을 받을 경로가 생기기 전까지 **확정하지 않는다.**
    const enabled = (await this.config?.get('kiosk.payment.enabled')) === true;
    await this.accessLog?.record({
      channel: 'KIOSK', action: 'pay', path: '/api/v1/kiosk/pay',
      result: enabled ? 'OK' : 'BLOCKED', patientId: patient.id,
      detail: { payableCount: payable.length, gate: enabled ? 'ON' : 'OFF' },
    });
    if (!enabled) {
      const total = payable.reduce((s, p) => s + p.outstanding, 0);
      throw new BadRequestException(
        `이 단말에서는 수납이 되지 않습니다. 수납 창구를 이용해 주세요.\n미납 ${payable.length}건 · ${total.toLocaleString()}원`,
      );
    }

    const pm = method === 'SIMPLE' ? 'SIMPLE_PAY' : 'CARD';
    let totalPaid = 0;
    for (const p of payable) {
      // 🔴 게이트를 켜더라도 승인번호를 만들어 넣지 않는다 — 승인 정보는 결제 단말이 주는 것이다.
      //    연동이 붙으면 그 응답의 승인번호를 여기로 넘긴다(그 전까지 이 경로는 도달하지 않는다).
      await this.billing.pay(p.id, { amount: p.outstanding, paymentMethod: pm });
      totalPaid += p.outstanding;
    }
    this.logger.log(`키오스크 수납 ${payable.length}건 ${totalPaid}원 patient=${patient.id}`);
    return { paid: true, patientName: `${patient.familyName}${patient.givenName}`, paidCount: payable.length, totalPaid, method: pm };
  }
}
