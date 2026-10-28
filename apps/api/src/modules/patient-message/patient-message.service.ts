import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { firstPatientPushResult, type PatientPushResult } from '../notification/patient-push.contract';
import { assignmentOf, messageScopeFor, scopeWhere, type Assignment, type MessageScope } from './patient-message.policy';

/** 받은편지함 한 번에 훑는 최대 메시지 행 — 넘으면 `truncated: true` 로 **잘랐다고 말한다** */
export const INBOX_SCAN_LIMIT = 500;

export interface StaffActor {
  id: string;
  role: string;
}

export interface InboxThread {
  patientId: string;
  patientName: string;
  mrn: string | null;
  /** DOCTOR 관점: MINE(내 지정 포함)·UNASSIGNED(담당 미지정만). 전건 열람 역할은 지정 의사 목록으로 본다 */
  assignment: Assignment | null;
  assignedDoctors: Array<{ id: string; name: string }>;
  /** 담당 미지정 메시지가 섞여 있는가 — 🔴 누가 받는지 모르는 메시지다 */
  hasUnassigned: boolean;
  unreadFromPatient: number;
  lastMessageAt: string;
  lastSender: 'PATIENT' | 'DOCTOR' | string;
}

@Injectable()
export class PatientMessageService {
  private readonly logger = new Logger(PatientMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journey: JourneyService,
    private readonly events: EventEmitter2,
  ) {}

  private scopeOrThrow(actor: StaffActor): MessageScope {
    const scope = messageScopeFor(actor.role);
    if (!scope) throw new ForbiddenException('Patient messages are not readable for this role');
    return scope;
  }

  /**
   * 받은편지함 — 환자별 묶음. 🔴 본문은 싣지 않는다(환자 지목 열람=스레드 조회에서만 · 감사 원장에 남는다).
   */
  async inbox(actor: StaffActor) {
    const scope = this.scopeOrThrow(actor);
    const rows = await this.prisma.patientMessage.findMany({
      where: scopeWhere(scope, actor.id),
      orderBy: { createdAt: 'desc' },
      take: INBOX_SCAN_LIMIT + 1,
      select: {
        patientId: true, doctorId: true, sender: true, isRead: true, createdAt: true,
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
      },
    });
    const truncated = rows.length > INBOX_SCAN_LIMIT;
    const scanned = truncated ? rows.slice(0, INBOX_SCAN_LIMIT) : rows;

    const threads = new Map<string, InboxThread>();
    for (const r of scanned) {
      let t = threads.get(r.patientId);
      if (!t) {
        t = {
          patientId: r.patientId,
          patientName: `${r.patient?.familyName ?? ''}${r.patient?.givenName ?? ''}`,
          mrn: r.patient?.mrn ?? null,
          assignment: null,
          assignedDoctors: [],
          hasUnassigned: false,
          unreadFromPatient: 0,
          lastMessageAt: r.createdAt.toISOString(),
          lastSender: r.sender,
        };
        threads.set(r.patientId, t);
      }
      if (r.doctorId == null) t.hasUnassigned = true;
      else if (r.doctor && !t.assignedDoctors.some((d) => d.id === r.doctor!.id)) {
        t.assignedDoctors.push({ id: r.doctor.id, name: `${r.doctor.familyName}${r.doctor.givenName}` });
      }
      if (r.sender === 'PATIENT' && !r.isRead) t.unreadFromPatient += 1;
      if (scope === 'MINE_AND_UNASSIGNED') {
        const a = assignmentOf(r.doctorId, actor.id);
        if (a === 'MINE') t.assignment = 'MINE';
        else if (t.assignment == null) t.assignment = a;
      }
    }
    return { scope, truncated, scanLimit: INBOX_SCAN_LIMIT, threads: [...threads.values()] };
  }

  /**
   * 환자 한 명의 스레드(범위 안). 열면 **범위 안 · 나에게 지정된** 환자 메시지를 읽음 처리한다.
   * 🔴 담당 미지정 메시지는 열람만으로 읽음 처리하지 않는다 — 한 사람이 열어 봤다고 "누군가 받았다"가 되지 않게.
   *    (답변한 의사가 담당으로 기록될 때 함께 읽음이 된다)
   * 🔴 DOCTOR 행의 isRead(환자가 읽었는가)는 여기서 건드리지 않는다 — 방향이 다른 사실이다.
   */
  async thread(actor: StaffActor, patientId: string) {
    const scope = this.scopeOrThrow(actor);
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, familyName: true, givenName: true, mrn: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const messages = await this.prisma.patientMessage.findMany({
      where: { patientId, ...scopeWhere(scope, actor.id) },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { doctor: { select: { id: true, familyName: true, givenName: true, department: true } } },
    });

    let markedRead = 0;
    if (actor.role === 'DOCTOR') {
      const r = await this.prisma.patientMessage.updateMany({
        where: { patientId, sender: 'PATIENT', doctorId: actor.id, isRead: false },
        data: { isRead: true },
      });
      markedRead = r.count;
    }

    return {
      scope,
      patient: { id: patient.id, name: `${patient.familyName}${patient.givenName}`, mrn: patient.mrn },
      canReply: actor.role === 'DOCTOR' && messages.some((m) => m.sender === 'PATIENT'),
      // 화면이 로그인 역할을 스스로 판정하지 않게(역할×EP 스캔에서 빠지는 자기게이팅) 서버가 사유를 준다
      replyBlocked: actor.role !== 'DOCTOR' ? 'NOT_DOCTOR' as const
        : messages.some((m) => m.sender === 'PATIENT') ? null : 'NO_PATIENT_MESSAGE' as const,
      markedRead,
      messages: messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        assignment: assignmentOf(m.doctorId, actor.id),
        doctor: m.doctor ? { id: m.doctor.id, name: `${m.doctor.familyName}${m.doctor.givenName}`, department: m.doctor.department } : null,
        // 환자→의사 방향만 의미가 있다(직원이 열었는가). 의사→환자 행은 환자 열람 여부를 모른다 → null
        readByStaff: m.sender === 'PATIENT' ? m.isRead : null,
      })),
    };
  }

  /**
   * 의사 답변 — `sender: 'DOCTOR'` 로 저장. 스레드(범위 안 환자 메시지)가 없으면 답할 수 없다.
   * 담당 미지정 메시지에 답하면 답한 의사가 담당으로 기록된다(명시 행위 — 임의 배정 아님).
   * 환자 앱 알림은 대외 발신 정본(`PatientPushGateService`)이 판정하고 결과를 그대로 돌려준다.
   */
  async reply(actor: StaffActor, patientId: string, content: string, notifyPatient?: boolean) {
    if (actor.role !== 'DOCTOR') throw new ForbiddenException('Only doctors can reply to patient messages');
    const inScope = await this.prisma.patientMessage.findMany({
      where: { patientId, sender: 'PATIENT', OR: [{ doctorId: actor.id }, { doctorId: null }] },
      select: { id: true, doctorId: true },
    });
    if (inScope.length === 0) {
      throw new ForbiddenException('No patient message addressed to you or unassigned for this patient');
    }

    const text = content.trim();
    const { created, claimed } = await this.prisma.$transaction(async (tx) => {
      const claimedRows = await tx.patientMessage.updateMany({
        where: { patientId, sender: 'PATIENT', doctorId: null },
        data: { doctorId: actor.id },
      });
      await tx.patientMessage.updateMany({
        where: { patientId, sender: 'PATIENT', doctorId: actor.id, isRead: false },
        data: { isRead: true },
      });
      const row = await tx.patientMessage.create({
        data: { patientId, doctorId: actor.id, sender: 'DOCTOR', content: text },
      });
      return { created: row, claimed: claimedRows.count };
    });

    this.journey.emit({
      patientId,
      eventType: 'PATIENT_MESSAGE_REPLIED',
      title: '담당의 메시지 답변',
      doctorId: actor.id,
      refType: 'PatientMessage',
      refId: created.id,
    });

    let patientPush: PatientPushResult;
    try {
      const results = await this.events.emitAsync('patient.message_replied', {
        patientId,
        messageId: created.id,
        notifyPatient: notifyPatient === true,
      });
      patientPush = firstPatientPushResult(results);
    } catch (e) {
      this.logger.warn(`patient.message_replied push failed: ${e instanceof Error ? e.message : String(e)}`);
      patientPush = firstPatientPushResult([{ attempted: true, sent: false, reason: 'ERROR', pushChannel: null }]);
    }

    return {
      id: created.id,
      sender: created.sender,
      createdAt: created.createdAt.toISOString(),
      claimedUnassigned: claimed,
      patientPush,
    };
  }
}
