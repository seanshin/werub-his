import { Injectable, NotFoundException, ConflictException, HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import * as E from '../../common/errors/domain-error-codes';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QuestionnaireService } from './questionnaire.service';
// 발송 판정 정본(SENT/SIMULATED/FAILED) — W6 CRM 리마인더 4종이 수렴한 채널·판정을 그대로 쓴다
import { CrmChannelService } from '../crm/crm-channel.service';
import { publicBaseUrl } from '../../common/util/public-url';
import { readSmsHeader } from '../config/hospital-facts';

/**
 * 🔴 W8 — 진료과 매핑이 없을 때 쓰는 **기본(진료과 무관) 사전문진표** 이름 정본.
 * 종전 폴백은 `orderBy: { name: 'asc' }` 의 **알파벳 첫 양식**이라 실제로는
 * `dept-internal-medicine`(내과 문진표)이 나갔다 — 산부인과 환자에게 내과 문진표를 보내면서
 * 화면은 "기본 사전문진표가 자동 적용됩니다"라고 안내하고 있었다(안내와 실제가 다름).
 * 과를 모를 때의 정답은 '아무 과 문진표'가 아니라 **과에 속하지 않는 일반 문진표**다.
 */
const DEFAULT_FORM_BY_VISIT: Record<string, string> = {
  INITIAL: 'questionnaire-initial',
  FOLLOW_UP: 'questionnaire-followup',
  PRE_OP: 'questionnaire-preop',
};
const DEFAULT_FORM_NAME = 'questionnaire-initial';

@Injectable()
export class QuestionnaireAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questionnaireService: QuestionnaireService,
    private readonly channel: CrmChannelService,
  ) {}

  // ── 진료과-양식 매핑 CRUD ──

  async getMappings(department?: string) {
    const where: Prisma.DepartmentFormMappingWhereInput = { isActive: true };
    if (department) where.departmentName = department;
    return this.prisma.departmentFormMapping.findMany({
      where,
      include: { formSchema: { select: { id: true, name: true, category: true, estimatedMinutes: true } } },
      orderBy: [{ departmentName: 'asc' }, { visitType: 'asc' }, { priority: 'asc' }],
    });
  }

  async createMapping(dto: { departmentName: string; formSchemaId: string; visitType?: string; priority?: number; createdBy: string }) {
    try {
      return await this.prisma.departmentFormMapping.create({
        data: {
          departmentName: dto.departmentName,
          formSchemaId: dto.formSchemaId,
          visitType: dto.visitType ?? 'ALL',
          priority: dto.priority ?? 1,
          createdBy: dto.createdBy,
        },
        include: { formSchema: { select: { name: true } } },
      });
    } catch (e: unknown) {
      if (e instanceof Object && 'code' in e && e.code === 'P2002') throw new ConflictException('동일한 진료과-양식-유형 매핑이 이미 존재합니다.');
      throw e;
    }
  }

  async updateMapping(id: string, dto: { visitType?: string; priority?: number; isActive?: boolean }) {
    return this.prisma.departmentFormMapping.update({ where: { id }, data: dto });
  }

  async deleteMapping(id: string) {
    return this.prisma.departmentFormMapping.update({ where: { id }, data: { isActive: false } });
  }

  // ── 진료과별 양식 조회 (예약 시 사용) ──

  async getFormsForDepartment(department: string, visitType: string) {
    const mappings = await this.prisma.departmentFormMapping.findMany({
      where: {
        departmentName: department,
        isActive: true,
        visitType: { in: [visitType, 'ALL'] },
      },
      include: { formSchema: { select: { id: true, name: true, category: true } } },
      orderBy: { priority: 'asc' },
    });
    return mappings.map(m => m.formSchema);
  }

  // ── 통계 ──

  async getStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [total, completed, expired, todaySent, todayCompleted, byDepartment] = await Promise.all([
      this.prisma.questionnaireToken.count(),
      this.prisma.questionnaireToken.count({ where: { status: 'COMPLETED' } }),
      this.prisma.questionnaireToken.count({ where: { status: { not: 'COMPLETED' }, expiresAt: { lt: now } } }),
      this.prisma.questionnaireToken.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.questionnaireToken.count({ where: { status: 'COMPLETED', completedAt: { gte: todayStart } } }),
      this.getDepartmentStats(),
    ]);

    const pending = total - completed - expired;
    return {
      total: { sent: total, completed, pending, expired },
      /**
       * 🔴 분모 0 = **산출 불가(null)**, 0% 가 아니다(W8 이연 회수·2026-08-14).
       *    발송이 한 건도 없는 것(=아직 아무 일도 안 일어났다)과, 발송했는데 아무도 안 쓴 것
       *    (=작성률 진짜 0% · 조치 필요)은 **다른 사실**이다. 0 으로 접으면 둘이 구분되지 않는다.
       *    W7/W8 다른 EP 전부 null 규약인데 여기만 갈라져 있었다(P12).
       */
      completionRate: total > 0 ? Math.round((completed / total) * 1000) / 10 : null,
      /** 🔴 null 일 때 화면이 말할 말 — `?? 0` 폴백 금지 신호 */
      completionRateUnavailableReason: total > 0 ? null : '발송된 문진이 없습니다(표본 0) — 작성률을 산출할 수 없습니다',
      today: { sent: todaySent, completed: todayCompleted, pending: todaySent - todayCompleted },
      byDepartment,
    };
  }

  private async getDepartmentStats() {
    // 예약 정보와 조인하여 진료과별 통계
    const tokens = await this.prisma.questionnaireToken.findMany({
      where: { appointmentId: { not: null } },
      select: {
        status: true,
        formSchema: { select: { name: true } },
      },
    });

    // 양식별 그룹핑
    const byForm = new Map<string, { sent: number; completed: number }>();
    for (const t of tokens) {
      const name = t.formSchema.name;
      const stat = byForm.get(name) ?? { sent: 0, completed: 0 };
      stat.sent++;
      if (t.status === 'COMPLETED') stat.completed++;
      byForm.set(name, stat);
    }

    return Array.from(byForm.entries()).map(([name, stat]) => ({
      formName: name,
      sent: stat.sent,
      completed: stat.completed,
      /** 🔴 분모 0 이면 산출 불가(null) — 위 completionRate 와 같은 규약 */
      rate: stat.sent > 0 ? Math.round((stat.completed / stat.sent) * 100) : null,
    }));
  }

  // ── 미작성 목록 ──

  async getPending(options?: { date?: 'today' | 'week'; limit?: number }) {
    const now = new Date();
    const where: Prisma.QuestionnaireTokenWhereInput = {
      status: { in: ['SENT', 'OPENED', 'IN_PROGRESS'] },
      expiresAt: { gt: now },
    };

    if (options?.date === 'today') {
      // 오늘 예약 환자의 미작성
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
      where.appointmentId = { not: null };
    }

    return this.prisma.questionnaireToken.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true, phone: true } },
        formSchema: { select: { name: true, category: true } },
      },
      orderBy: { expiresAt: 'asc' },
      take: options?.limit ?? 50,
    });
  }

  // ── 수동 발송 ──

  async sendToPatient(dto: { patientId: string; formSchemaId?: string; appointmentId?: string; sentVia?: string; createdBy: string }) {
    let formSchemaId = dto.formSchemaId;
    let visitType = 'INITIAL';

    // formSchemaId 미지정 → 예약의 진료과+유형으로 자동 선택
    if (!formSchemaId && dto.appointmentId) {
      const appt = await this.prisma.appointment.findUnique({
        where: { id: dto.appointmentId },
        include: { doctor: { select: { department: true } } },
      });
      if (appt?.type) visitType = appt.type;
      if (appt?.doctor?.department) {
        const forms = await this.getFormsForDepartment(appt.doctor.department, visitType);
        if (forms.length > 0) formSchemaId = forms[0].id;
      }
    }

    // 폴백: 진료과 무관 기본 사전문진표(방문유형 우선) — 🔴 '알파벳 첫 양식' 금지(상단 상수 주석)
    if (!formSchemaId) {
      const wanted = [...new Set([DEFAULT_FORM_BY_VISIT[visitType] ?? DEFAULT_FORM_NAME, DEFAULT_FORM_NAME])];
      const candidates = await this.prisma.formSchema.findMany({
        where: { name: { in: wanted }, isActive: true },
        select: { id: true, name: true },
      });
      const picked = wanted.map((n) => candidates.find((c) => c.name === n)).find(Boolean);
      if (!picked) {
        // 엉뚱한 과의 문진표를 대신 보내지 않는다 — 보낼 양식이 없다는 사실을 말한다.
        throw new NotFoundException(
          `기본 사전문진표(${wanted.join(' 또는 ')})가 없습니다 — 진료과 매핑도 없어 발송할 양식을 정할 수 없습니다.`,
        );
      }
      formSchemaId = picked.id;
    }

    return this.questionnaireService.generateToken({
      patientId: dto.patientId,
      formSchemaId,
      appointmentId: dto.appointmentId,
    });
  }

  // ── SMS/알림 발송 ──

  /**
   * 문진표 링크를 SMS 로 발송.
   *
   * 🔴 2026-08-14 W8(P16) — 종전 구현은 `SMS_API_KEY` 가 **있으면** 주석 `// TODO` 만 두고
   *    `{ sent: true, message: 'SMS 발송 완료' }` 를 돌려줬다. 키를 넣는 순간(=운영에 가까워질수록)
   *    한 통도 보내지 않고 전건이 "발송 완료"가 되는 구조였다. 키가 없을 때만 우연히 정직했다.
   *    → 발송 판정 정본(`CrmChannelService.send`)으로 수렴. SMS 제공자는 아직 붙어 있지 않으므로
   *      결과는 SIMULATED(=나가지 않음)이고, **그 사실을 그대로 반환한다**.
   */
  async sendViaSms(patientId: string, token: string, phone: string | null | undefined): Promise<{ delivery: 'SENT' | 'SIMULATED' | 'FAILED'; message: string }> {
    const url = `${publicBaseUrl()}/questionnaire/${token}`;

    if (!phone) {
      return { delivery: 'FAILED', message: '연락처가 없어 발송하지 못했습니다.' };
    }
    // 🔴 SMS 머리말은 정본 기관명(DB 행만) — 종전엔 '[Hospital RUN]' 상수였다. 미설정이면 머리말 없이 보낸다.
    //    조회 실패는 전파한다(발송 실패로 접지 않는다 — 보낼 수 없었던 이유가 다르다).
    const header = await readSmsHeader(this.prisma);
    const body = `${header}사전 문진표를 작성해주세요.\n${url}\n(48시간 유효)`;
    const r = await this.channel.send('SMS', phone, '사전 문진표 작성 안내', body).catch(() => ({ success: false, simulated: false }));
    const delivery = !r.success ? 'FAILED' : r.simulated ? 'SIMULATED' : 'SENT';
    return {
      delivery,
      message:
        delivery === 'SENT' ? 'SMS 를 발송했습니다.'
        : delivery === 'SIMULATED' ? 'SMS 발송 경로가 없어 실제로 보내지 않았습니다(기록만).'
        : 'SMS 발송에 실패했습니다.',
    };
  }

  /**
   * 미작성 문진표 리마인더 발송 (배치용)
   * 🔴 종전엔 보내지 않고도 `reminderSentAt` 을 세워서 **그 환자는 다시는 리마인더를 받지 못했다**
   *    (미발송의 영구화 — W6 검진 D-1 과 같은 형태). 실제로 나간 건만 마킹한다.
   */
  async sendReminders(): Promise<{ sent: number; simulated: number; failed: number; total: number }> {
    const now = new Date();
    const reminderThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24시간 이내 만료

    const pending = await this.prisma.questionnaireToken.findMany({
      where: {
        status: { in: ['SENT', 'OPENED'] },
        expiresAt: { gt: now, lt: reminderThreshold },
        reminderSentAt: null,
      },
      include: {
        patient: { select: { phone: true, familyName: true, givenName: true } },
      },
      take: 50,
    });

    const tally = { SENT: 0, SIMULATED: 0, FAILED: 0 };
    for (const p of pending) {
      const r = await this.sendViaSms(p.patientId, p.token, p.patient?.phone);
      tally[r.delivery]++;
      if (r.delivery === 'SENT') {
        await this.prisma.questionnaireToken.update({ where: { id: p.id }, data: { reminderSentAt: new Date() } });
      }
    }

    return { sent: tally.SENT, simulated: tally.SIMULATED, failed: tally.FAILED, total: pending.length };
  }

  // ── 재발송 ──

  /**
   * 🔴 종전 `resend()` 는 아무 데도 보내지 않고 `status:'SENT'` + `reminderSentAt` 을 찍었다.
   *    화면의 '재발송' 버튼은 늘 성공했고 환자는 아무것도 받지 못했다.
   *    → 실제로 보내고, **나간 경우에만** 발송 상태를 기록한다. 만료 연장은 링크 자체를 살리는
   *      작업이므로 발송 성패와 무관하게 수행한다(관리자가 직접 전달할 수 있어야 한다).
   */
  async resend(tokenId: string) {
    const token = await this.prisma.questionnaireToken.findUnique({
      where: { id: tokenId },
      include: { patient: { select: { familyName: true, givenName: true, phone: true } } },
    });
    if (!token) throw new NotFoundException('토큰을 찾을 수 없습니다.');

    // 만료 연장 (48시간)
    const newExpiry = new Date();
    newExpiry.setHours(newExpiry.getHours() + 48);
    await this.prisma.questionnaireToken.update({ where: { id: tokenId }, data: { expiresAt: newExpiry } });

    const r = await this.sendViaSms(token.patientId, token.token, token.patient?.phone);
    if (r.delivery === 'SENT') {
      await this.prisma.questionnaireToken.update({
        where: { id: tokenId },
        data: { status: 'SENT', sentVia: 'SMS', reminderSentAt: new Date() },
      });
    }

    return {
      token: token.token,
      url: `/questionnaire/${token.token}`,
      expiresAt: newExpiry,
      delivery: r.delivery,
      message: r.delivery === 'SENT' ? r.message : `${r.message} 링크를 직접 전달하세요.`,
    };
  }

  // ── 검토 완료 ──

  /**
   * 문진표 검토 완료 — 기획 FR-05-1 `발송됨 → 작성중 → 완료 → 검토됨`. '검토됨'은 status 값이 아니라 `reviewedAt`(+`reviewedBy`)로 표시한다(스키마 정본).
   * 🔴 (2026-09-14) 종전 구현은 상태를 보지 않고 `update` 만 했다 —
   *    ① 제출되지 않은(발송·작성중·만료) 문진표도 '검토됨'이 됐고(읽을 응답이 없는데 검토했다고 기록 — P16)
   *    ② 두 번째 사람이 누르면 **첫 검토자·시각을 덮어썼고**(일어난 사실의 소급 변경)
   *    ③ 없는 id 는 Prisma P2025 가 500 으로 나갔다.
   * 검토 완료는 "응답을 읽었다"는 표시일 뿐 임상 기록 확정이 아니다(화면이 그렇게 말한다).
   */
  async markReviewed(tokenId: string, reviewerId: string) {
    const t = await this.prisma.questionnaireToken.findUnique({
      where: { id: tokenId },
      select: { id: true, status: true, submissionId: true, reviewedAt: true },
    });
    if (!t) throw new NotFoundException('문진표를 찾을 수 없습니다');
    if (t.status !== 'COMPLETED' || !t.submissionId) {
      throw new DomainException(E.QUESTIONNAIRE_NOT_SUBMITTED, '제출되지 않은 문진표는 검토 완료로 표시할 수 없습니다', HttpStatus.CONFLICT, { status: t.status });
    }
    let alreadyReviewed = t.reviewedAt != null;
    if (!alreadyReviewed) {
      // 동시에 두 사람이 눌러도 첫 기록만 남는다(reviewedAt null 조건부)
      const r = await this.prisma.questionnaireToken.updateMany({
        where: { id: tokenId, reviewedAt: null, status: 'COMPLETED' },
        data: { reviewedBy: reviewerId, reviewedAt: new Date() },
      });
      alreadyReviewed = r.count === 0;
    }
    const fresh = await this.prisma.questionnaireToken.findUnique({
      where: { id: tokenId },
      select: { id: true, status: true, reviewedBy: true, reviewedAt: true, reviewer: { select: { familyName: true, givenName: true } } },
    });
    return {
      id: tokenId,
      status: fresh?.status ?? t.status,
      reviewedBy: fresh?.reviewedBy ?? null,
      reviewedAt: fresh?.reviewedAt ?? null,
      reviewerName: fresh?.reviewer ? `${fresh.reviewer.familyName}${fresh.reviewer.givenName}` : null,
      alreadyReviewed,
    };
  }
}
