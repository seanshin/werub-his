import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/* ---------- Types ---------- */

export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'likert5' | 'nps' | 'text';
}

export interface SurveyTemplate {
  id: string;
  name: string;
  description: string;
  targetDepartment: string | null;
  questions: SurveyQuestion[];
  isActive: boolean;
  createdAt: string;
}

export interface SurveyResponse {
  id: string;
  templateId: string;
  patientId: string;
  department: string;
  answers: Record<string, number | string>;
  submittedAt: string;
}

export interface CreateTemplateDto {
  name: string;
  description?: string;
  targetDepartment?: string;
  questions: Omit<SurveyQuestion, 'id'>[];
}

export interface DispatchDto {
  templateId: string;
  targetDepartments?: string[];
  channel?: 'SMS' | 'KIOSK' | 'APP';
}

export interface SubmitResponseDto {
  templateId: string;
  patientId: string;
  department: string;
  answers: Record<string, number | string>;
}

export interface CreateActionDto {
  department: string;
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  assignee?: string;
}

export interface DepartmentStat {
  department: string;
  nps: number | null;
  responseCount: number;
  itemScores: { questionId: string; questionText: string; avgScore: number }[];
}

export interface TrendPoint {
  period: string;
  nps: number | null;
  responseCount: number;
  /** 🔴 점수 문항 응답이 0건이면 null(산출 불가) — 1~5 척도라 `0` 은 어떤 실제 평가보다 나쁜 값이다 */
  avgScore: number | null;
  /** 평균의 분모(점수 문항에 답한 응답 수) — 비율·평균에는 분모를 병기한다 */
  scoredCount?: number;
}

export interface BenchmarkItem {
  category: string;
  hospital: number;
  national: number;
  gap: number;
}

/**
 * 벤치마크 응답 — 🔴 전국 평균은 **출처가 있어야 숫자다**.
 * 심평원 환자경험평가 등 공표 자료를 등재하기 전에는 `available:false` 로 없음을 밝힌다.
 */
export interface BenchmarkResult {
  available: boolean;
  reason?: string;
  source?: string;
  items: BenchmarkItem[];
}

/** 감성 분석 — 표본이 없으면 비율은 `null`(0 아님). */
export interface SentimentResult {
  positive: number | null;
  neutral: number | null;
  negative: number | null;
  scoredCount: number;
  commentCount: number;
  topPositive: string[];
  topNegative: string[];
  aiSummary: string | null;
  /**
   * 🔴 조회에 실패한 응답 원장(빈 배열 = 전부 읽었다).
   * 비어 있지 않으면 `scoredCount`·`commentCount`·비율은 **불완전한 표본** 위의 값이며,
   * 0 이어도 "응답이 없다"는 뜻이 아니다 — 화면은 이 배열을 보고 그렇게 말해야 한다.
   */
  unavailable: SentimentSource[];
}

/** 감성 분석이 읽는 응답 원장 */
export type SentimentSource = 'SURVEY_DISPATCH' | 'SATISFACTION_SURVEY';

export interface ActionItem {
  id: string;
  department: string;
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE';
  assignee?: string;
  createdAt: string;
}

/* ---------- Mock data ---------- */

const DEPARTMENTS = ['내과', '외과', '소아청소년과', '산부인과', '응급의학과', '정형외과', '안과', '이비인후과'];

const DEFAULT_QUESTIONS: SurveyQuestion[] = [
  { id: 'q1', text: '접수 및 수납 절차의 편리성', type: 'likert5' },
  { id: 'q2', text: '대기 시간의 적절성', type: 'likert5' },
  { id: 'q3', text: '의사의 친절도 및 설명 충분성', type: 'likert5' },
  { id: 'q4', text: '간호사의 친절도 및 응대', type: 'likert5' },
  { id: 'q5', text: '시설 청결도 및 쾌적성', type: 'likert5' },
  { id: 'q6', text: '검사·처치 과정 안내', type: 'likert5' },
  { id: 'q7', text: '전반적 만족도 (NPS)', type: 'nps' },
  { id: 'q8', text: '개선 의견을 자유롭게 적어주세요', type: 'text' },
];

/**
 * 🔴 표본이 없을 때 **숫자를 지어내지 않는다**(P15).
 * 여기 있던 `randomBetween()` 은 부서별 NPS·응답수·문항 점수·추이를 난수로 만들어
 * 화면에 '실적'으로 그렸다 — 새로고침할 때마다 값이 바뀌는데도 경영 지표로 읽혔다.
 * 표본 부재는 빈 목록으로 알린다(화면은 EmptyState).
 */

@Injectable()
export class SatisfactionService {
  private readonly logger = new Logger(SatisfactionService.name);

  private templates: SurveyTemplate[] = [
    {
      id: 'tmpl-001',
      name: '외래 환자 만족도 조사',
      description: '외래 방문 환자 대상 서비스 만족도 설문',
      targetDepartment: null,
      questions: DEFAULT_QUESTIONS,
      isActive: true,
      createdAt: '2026-01-15T09:00:00Z',
    },
    {
      id: 'tmpl-002',
      name: '입원 환자 만족도 조사',
      description: '퇴원 시 입원 서비스 전반 평가',
      targetDepartment: null,
      questions: [
        { id: 'q1', text: '입원 절차의 편리성', type: 'likert5' },
        { id: 'q2', text: '병실 환경 및 청결도', type: 'likert5' },
        { id: 'q3', text: '식사 만족도', type: 'likert5' },
        { id: 'q4', text: '의료진 설명 충분성', type: 'likert5' },
        { id: 'q5', text: '간호 서비스 만족도', type: 'likert5' },
        { id: 'q6', text: '퇴원 안내 적절성', type: 'likert5' },
        { id: 'q7', text: '전반적 만족도 (NPS)', type: 'nps' },
        { id: 'q8', text: '추가 의견', type: 'text' },
      ],
      isActive: true,
      createdAt: '2026-02-01T09:00:00Z',
    },
    {
      id: 'tmpl-003',
      name: '응급실 환자 만족도 조사',
      description: '응급실 이용 후 서비스 평가',
      targetDepartment: '응급의학과',
      questions: [
        { id: 'q1', text: '응급실 접수 신속성', type: 'likert5' },
        { id: 'q2', text: '대기 중 상태 안내', type: 'likert5' },
        { id: 'q3', text: '의료진 응대 태도', type: 'likert5' },
        { id: 'q4', text: '처치 과정 설명', type: 'likert5' },
        { id: 'q5', text: '전반적 만족도 (NPS)', type: 'nps' },
        { id: 'q6', text: '개선 의견', type: 'text' },
      ],
      isActive: true,
      createdAt: '2026-03-01T09:00:00Z',
    },
    {
      id: 'tmpl-004',
      name: '퇴원 환자 만족도 조사',
      description: '퇴원 시점 입원 전반 경험 평가 (자동 발송)',
      targetDepartment: null,
      questions: [
        { id: 'q1', text: '입·퇴원 절차의 신속성과 안내', type: 'likert5' },
        { id: 'q2', text: '병실 환경·청결·소음 관리', type: 'likert5' },
        { id: 'q3', text: '담당 의료진의 회진·설명 충분성', type: 'likert5' },
        { id: 'q4', text: '간호 서비스(투약·처치·응대)', type: 'likert5' },
        { id: 'q5', text: '통증 및 증상 관리의 적절성', type: 'likert5' },
        { id: 'q6', text: '식사·영양 서비스 만족도', type: 'likert5' },
        { id: 'q7', text: '퇴원 약·주의사항·추후 일정 안내', type: 'likert5' },
        { id: 'q8', text: '이 병원을 지인에게 추천하시겠습니까? (NPS)', type: 'nps' },
        { id: 'q9', text: '가장 좋았던 점과 개선할 점을 적어주세요', type: 'text' },
      ],
      isActive: true,
      createdAt: '2026-05-01T09:00:00Z',
    },
    {
      id: 'tmpl-005',
      name: '건강검진 만족도 조사',
      description: '종합검진 수검자 대상 경험 평가',
      targetDepartment: '건강검진센터',
      questions: [
        { id: 'q1', text: '예약·접수 과정의 편리성', type: 'likert5' },
        { id: 'q2', text: '검진 동선 및 대기 관리', type: 'likert5' },
        { id: 'q3', text: '검사 진행 안내의 친절성', type: 'likert5' },
        { id: 'q4', text: '탈의실·라운지 등 편의시설', type: 'likert5' },
        { id: 'q5', text: '결과 상담의 충분성', type: 'likert5' },
        { id: 'q6', text: '전반적 만족도 (NPS)', type: 'nps' },
        { id: 'q7', text: '개선 의견', type: 'text' },
      ],
      isActive: true,
      createdAt: '2026-05-02T09:00:00Z',
    },
    {
      id: 'tmpl-006',
      name: '소아청소년과 보호자 만족도',
      description: '소아 환자 보호자 대상 진료 경험 평가',
      targetDepartment: '소아청소년과',
      questions: [
        { id: 'q1', text: '아이의 두려움을 배려한 진료', type: 'likert5' },
        { id: 'q2', text: '보호자 대상 설명의 이해도', type: 'likert5' },
        { id: 'q3', text: '대기 환경(놀이공간 등) 적절성', type: 'likert5' },
        { id: 'q4', text: '간호·접수 직원의 친절도', type: 'likert5' },
        { id: 'q5', text: '전반적 만족도 (NPS)', type: 'nps' },
        { id: 'q6', text: '개선 의견', type: 'text' },
      ],
      isActive: true,
      createdAt: '2026-05-03T09:00:00Z',
    },
    {
      id: 'tmpl-007',
      name: '수술 환자 만족도 조사',
      description: '수술·시술 환자 대상 경험 평가',
      targetDepartment: '외과',
      questions: [
        { id: 'q1', text: '수술 전 설명·동의 과정', type: 'likert5' },
        { id: 'q2', text: '마취·통증 관리의 적절성', type: 'likert5' },
        { id: 'q3', text: '수술 후 회복 관리·안내', type: 'likert5' },
        { id: 'q4', text: '의료진의 안심시키는 태도', type: 'likert5' },
        { id: 'q5', text: '전반적 만족도 (NPS)', type: 'nps' },
        { id: 'q6', text: '개선 의견', type: 'text' },
      ],
      isActive: true,
      createdAt: '2026-05-04T09:00:00Z',
    },
    {
      id: 'tmpl-008',
      name: '비대면 진료 만족도',
      description: '원격(화상) 진료 이용자 대상 평가',
      targetDepartment: null,
      questions: [
        { id: 'q1', text: '화상 연결·앱 사용의 편리성', type: 'likert5' },
        { id: 'q2', text: '영상·음성 품질', type: 'likert5' },
        { id: 'q3', text: '의사 설명·소통의 충분성', type: 'likert5' },
        { id: 'q4', text: '처방·서류 발급의 신속성', type: 'likert5' },
        { id: 'q5', text: '전반적 만족도 (NPS)', type: 'nps' },
        { id: 'q6', text: '개선 의견', type: 'text' },
      ],
      isActive: true,
      createdAt: '2026-05-05T09:00:00Z',
    },
  ];

  private responses: SurveyResponse[] = [];
  private actions: ActionItem[] = [
    {
      id: 'act-001',
      department: '내과',
      title: '대기 시간 단축을 위한 예약 시스템 개선',
      description: '평균 대기 45분 → 목표 30분 이내. 시간대별 예약 슬롯 세분화 진행.',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      assignee: '김품질',
      createdAt: '2026-04-10T09:00:00Z',
    },
    {
      id: 'act-002',
      department: '외과',
      title: '수술 전 설명 프로세스 표준화',
      description: '환자 이해도 향상을 위한 시각 자료 추가 및 설명 체크리스트 도입.',
      priority: 'MEDIUM',
      status: 'OPEN',
      assignee: '박개선',
      createdAt: '2026-04-15T09:00:00Z',
    },
  ];

  constructor(private readonly medicalAi: MedicalAiService, private readonly prisma: PrismaService) {}

  /* 1. 설문 템플릿 목록 (기본 + DB 커스텀) */
  async getTemplates(): Promise<SurveyTemplate[]> {
    const custom = await this.prisma.surveyTemplateCustom.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } }).catch(() => []);
    const customMapped: SurveyTemplate[] = custom.map((c) => ({
      id: c.id, name: c.name, description: c.description ?? '', targetDepartment: c.targetDepartment,
      questions: (c.questions as unknown as SurveyQuestion[]) ?? [], isActive: c.isActive, createdAt: c.createdAt.toISOString(),
    }));
    return [...this.templates, ...customMapped];
  }

  /* 2. 설문 템플릿 생성 */
  async createTemplate(data: CreateTemplateDto): Promise<SurveyTemplate> {
    const questions = data.questions.map((q, i) => ({ ...q, id: `q${i + 1}` }));
    const c = await this.prisma.surveyTemplateCustom.create({
      data: { name: data.name, description: data.description ?? null, targetDepartment: data.targetDepartment ?? null, questions: questions as object },
    });
    this.logger.log(`Template created(DB): ${c.id} - ${c.name}`);
    return { id: c.id, name: c.name, description: c.description ?? '', targetDepartment: c.targetDepartment, questions, isActive: c.isActive, createdAt: c.createdAt.toISOString() };
  }

  /* 3. 설문 발송 — 토큰 생성(포털/태블릿/SMS 작성 링크). 환자 지정 1건. */
  async dispatchToken(data: {
    templateId: string; patientId?: string; patientName?: string; department?: string;
    channel?: 'PORTAL' | 'TABLET' | 'SMS' | 'KIOSK'; trigger?: 'MANUAL' | 'DISCHARGE' | 'OUTPATIENT'; deviceId?: string;
  }) {
    const tmpl = (await this.getTemplates()).find((t) => t.id === data.templateId);
    if (!tmpl) throw new NotFoundException('설문 템플릿 없음');
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 14 * 86400000); // 14일 유효
    const d = await this.prisma.surveyDispatch.create({
      data: {
        token, templateId: tmpl.id, templateName: tmpl.name,
        questions: tmpl.questions as object,
        patientId: data.patientId ?? null, patientName: data.patientName ?? null,
        department: data.department ?? tmpl.targetDepartment ?? null,
        channel: data.channel ?? 'PORTAL', trigger: data.trigger ?? 'MANUAL',
        deviceId: data.deviceId ?? null, expiresAt,
      },
    });
    this.logger.log(`Survey dispatched: ${d.id} (${tmpl.name}) via ${d.channel}`);
    return { id: d.id, token, url: `/survey/${token}`, templateName: tmpl.name, channel: d.channel };
  }

  /* 발송 목록 */
  async listDispatches(status?: string) {
    return this.prisma.surveyDispatch.findMany({
      where: status && status !== 'ALL' ? { status } : {},
      orderBy: { createdAt: 'desc' }, take: 100,
    });
  }

  /* 공개: 토큰으로 설문 조회 */
  async getByToken(token: string) {
    const d = await this.prisma.surveyDispatch.findUnique({ where: { token } });
    if (!d) throw new NotFoundException('설문을 찾을 수 없습니다');
    if (d.status === 'COMPLETED') return { status: 'COMPLETED', templateName: d.templateName };
    if (d.expiresAt && d.expiresAt < new Date()) return { status: 'EXPIRED', templateName: d.templateName };
    return { status: 'PENDING', templateName: d.templateName, patientName: d.patientName, department: d.department, questions: d.questions };
  }

  /* 공개: 토큰으로 응답 제출 */
  async submitByToken(token: string, answers: Record<string, number | string>) {
    const d = await this.prisma.surveyDispatch.findUnique({ where: { token } });
    if (!d) throw new NotFoundException('설문을 찾을 수 없습니다');
    if (d.status === 'COMPLETED') throw new BadRequestException('이미 제출된 설문입니다');
    const qs = (d.questions as unknown as SurveyQuestion[]) ?? [];
    const likert = qs.filter((q) => q.type === 'likert5').map((q) => Number(answers[q.id])).filter((n) => n > 0);
    const avg = likert.length ? Math.round((likert.reduce((a, b) => a + b, 0) / likert.length) * 10) / 10 : null;
    const npsQ = qs.find((q) => q.type === 'nps');
    const nps = npsQ ? Number(answers[npsQ.id]) : null;
    await this.prisma.surveyDispatch.update({
      where: { token },
      data: { status: 'COMPLETED', answers: answers as object, avgScore: avg, npsScore: Number.isFinite(nps as number) ? (nps as number) : null, submittedAt: new Date() },
    });
    // 환자 연결 시 SatisfactionSurvey에도 기록
    if (d.patientId) {
      const comment = qs.filter((q) => q.type === 'text').map((q) => answers[q.id]).filter(Boolean).join('\n');
      await this.prisma.satisfactionSurvey.create({
        data: {
          patientId: d.patientId,
          overallRating: nps != null && nps >= 0 ? Math.max(1, Math.round((nps as number) / 2)) : Math.round(avg ?? 4),
          comment: comment || null,
        },
      }).catch(() => {});
    }
    return { ok: true };
  }

  /* 4. 환자 응답 제출 (mock) */
  async submitResponse(data: SubmitResponseDto): Promise<SurveyResponse> {
    const response: SurveyResponse = {
      id: `resp-${Date.now()}`,
      templateId: data.templateId,
      patientId: data.patientId,
      department: data.department,
      answers: data.answers,
      submittedAt: new Date().toISOString(),
    };
    this.responses.push(response);
    return response;
  }

  /** NPS 계산(0~10 점수 배열 → -100~100) */
  // 🔴 2026-10-08 — 점수 응답 0 에 NPS `0` 을 냈다. NPS 0 은 "추천=비추천"이라는 **측정된 사실**이라
  //    표본 부재와 다르다(P1). 점수 응답이 없으면 null(산출 불가).
  private npsFrom(scores: (number | null)[]): number | null {
    const v = scores.filter((n): n is number => Number.isFinite(n as number));
    if (!v.length) return null;
    const prom = v.filter((n) => n >= 9).length;
    const det = v.filter((n) => n <= 6).length;
    return Math.round(((prom - det) / v.length) * 100);
  }

  /* 5. 부서별 통계 (실데이터, 없으면 폴백) */
  async getDepartmentStats(department?: string): Promise<DepartmentStat[]> {
    const rows = await this.prisma.surveyDispatch.findMany({
      where: { status: 'COMPLETED', ...(department ? { department } : {}) },
      select: { department: true, npsScore: true, questions: true, answers: true },
    });
    // 🔴 `.catch(() => [])` 를 두지 않는다 — 조회 실패가 빈 배열이 되면 화면은 "응답이 없습니다"라 말한다
    //    (DB 장애가 '설문 실적 0'). 실패는 그대로 전파해 호출자가 실패로 그리게 한다.

    // 🔴 표본 부재 → 빈 목록. 종전에는 8개 과의 NPS·응답수를 난수로 만들어 냈다.
    if (!rows.length) return [];

    const byDept = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.department || '미지정';
      (byDept.get(k) ?? byDept.set(k, []).get(k)!).push(r);
    }
    return [...byDept.entries()].map(([dept, drows]) => {
      const qAgg = new Map<string, { text: string; sum: number; count: number }>();
      for (const r of drows) {
        const qs = (r.questions as unknown as SurveyQuestion[]) ?? [];
        const ans = (r.answers as Record<string, number>) ?? {};
        for (const q of qs) {
          if (q.type !== 'likert5') continue;
          const v = Number(ans[q.id]);
          if (v > 0) {
            const e = qAgg.get(q.id) ?? { text: q.text, sum: 0, count: 0 };
            e.sum += v; e.count++; qAgg.set(q.id, e);
          }
        }
      }
      return {
        department: dept,
        nps: this.npsFrom(drows.map((r) => r.npsScore)),
        responseCount: drows.length,
        itemScores: [...qAgg.entries()].map(([id, e]) => ({ questionId: id, questionText: e.text, avgScore: Math.round((e.sum / e.count) * 10) / 10 })),
      };
    });
  }

  /* 6. 월별/분기별 추이 (실데이터, 없으면 폴백) */
  async getTrend(period?: 'monthly' | 'quarterly'): Promise<TrendPoint[]> {
    const rows = await this.prisma.surveyDispatch.findMany({
      where: { status: 'COMPLETED', submittedAt: { not: null } },
      select: { submittedAt: true, npsScore: true, avgScore: true },
      orderBy: { submittedAt: 'asc' },
    }); // 🔴 실패를 빈 배열로 접지 않는다(위와 같은 이유) — "추이를 산출할 응답이 없습니다"가 되어선 안 된다

    if (rows.length) {
      const bucket = new Map<string, { nps: (number | null)[]; avg: number[]; count: number }>();
      for (const r of rows) {
        const d = r.submittedAt as Date;
        const key = period === 'quarterly'
          ? `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
          : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const b = bucket.get(key) ?? { nps: [], avg: [], count: 0 };
        b.nps.push(r.npsScore); if (r.avgScore != null) b.avg.push(r.avgScore); b.count++;
        bucket.set(key, b);
      }
      return [...bucket.entries()].map(([p, b]) => ({
        period: p,
        nps: this.npsFrom(b.nps),
        responseCount: b.count,
        // 🔴 (2026-09-16 J3) 응답은 있는데 점수 문항이 하나도 없는 분기에 평균 `0` 을 냈다 —
        //    척도가 1~5 라 **어떤 실제 평가보다 나쁜 값**이다(I4 가 컨시어지 만족도에서 고친 것과 같은 자리).
        avgScore: b.avg.length ? Math.round((b.avg.reduce((a, c) => a + c, 0) / b.avg.length) * 10) / 10 : null,
        scoredCount: b.avg.length,
      }));
    }

    // 🔴 표본 부재 → 빈 목록. 종전에는 "2025-Q3 NPS 52 · 응답 420건" 같은
    //    존재한 적 없는 분기 실적과, 난수로 우상향하는 8개월 추이를 그렸다.
    return [];
  }

  /**
   * 7. AI 감성 분석
   *
   * 🔴 종전에는 **코멘트가 하나도 없을 때 예시 문장 4개를 지어내 AI 에 넣고**,
   *    그 요약을 "WeRU.B 분석 요약"으로 화면에 그렸다 — 아무도 하지 않은 말이
   *    환자 목소리로 읽혔다. 긍/부정 키워드 6개도 데이터와 무관한 고정 상수라
   *    모든 병원·모든 기간에 같은 값이 나왔다.
   *    표본이 없으면 **분석하지 않는다**.
   */
  async getSentiment(): Promise<SentimentResult> {
    // 실 코멘트 수집(완료 설문의 text 응답 + SatisfactionSurvey 코멘트)
    //
    // 🔴 종전에는 두 조회 모두 `.catch(() => [])` 였다. 원장 하나가 죽으면 표본이 통째로
    //    비고, 화면은 그것을 "분석할 응답이 없습니다"(EmptyState)로 그렸다 — **조회 실패가
    //    '설문 응답 0건'이라는 관측 사실로 읽혔다.** 실패는 삼키되 **무엇이 실패했는지를 함께
    //    실어 보낸다**(부분 성공은 살린다).
    const settled = await Promise.allSettled([
      this.prisma.surveyDispatch.findMany({ where: { status: 'COMPLETED' }, select: { questions: true, answers: true, avgScore: true } }),
      this.prisma.satisfactionSurvey.findMany({ where: { comment: { not: null } }, select: { comment: true, overallRating: true } }),
    ] as const);
    const unavailable: SentimentSource[] = [];
    const take = <T>(r: PromiseSettledResult<T[]>, src: SentimentSource): T[] => {
      if (r.status === 'fulfilled') return r.value;
      this.logger.error(`감성 분석 원장 조회 실패(${src}) — 표본이 불완전하다`, r.reason);
      unavailable.push(src);
      return [];
    };
    const dispatches = take(settled[0], 'SURVEY_DISPATCH');
    const surveys = take(settled[1], 'SATISFACTION_SURVEY');
    const comments: string[] = [];
    const scores: number[] = [];
    for (const d of dispatches) {
      const qs = (d.questions as unknown as SurveyQuestion[]) ?? [];
      const ans = (d.answers as Record<string, unknown>) ?? {};
      for (const q of qs) if (q.type === 'text' && ans[q.id]) comments.push(String(ans[q.id]));
      if (d.avgScore != null) scores.push(d.avgScore);
    }
    for (const s of surveys) { if (s.comment) comments.push(s.comment); scores.push(s.overallRating); }

    // 점수 분포 기반 긍/중/부정 — 표본이 없으면 비율은 없다(0 이 아니라 null).
    const total = scores.length;
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : null);
    const positive = pct(scores.filter((n) => n >= 4).length);
    const neutral = pct(scores.filter((n) => n === 3).length);
    const negative = pct(scores.filter((n) => n <= 2).length);

    // 코멘트가 있을 때만 AI 를 부른다 — 지어낸 문장을 넣지 않는다.
    let aiSummary: string | null = null;
    if (comments.length) {
      try {
        const result = await this.medicalAi.reference(
          `다음 환자 만족도 설문 텍스트 응답을 분석하여 주요 감성과 개선점을 요약해주세요: ${comments.slice(0, 50).join(' / ')}`,
          'patient-satisfaction',
        );
        aiSummary = result?.answer ?? null;
      } catch (err) {
        this.logger.warn('AI sentiment analysis unavailable', err);
      }
    }

    return {
      positive, neutral, negative,
      scoredCount: total,
      commentCount: comments.length,
      // 키워드는 실제 코멘트에서 뽑아야 한다 — 추출기가 없으므로 비운다(고정 상수 금지).
      topPositive: [],
      topNegative: [],
      aiSummary,
      unavailable,
    };
  }

  /**
   * 8. 벤치마크 (전국 평균 비교)
   *
   * 🔴 종전에는 10개 항목 전부가 하드코딩이었다 — 우리 병원 점수도, 전국 평균도,
   *    그 차이도. 화면은 "전반적 만족도 82.5 (전국 78.3 대비 +4.2)"를 근거 있는
   *    비교로 그렸지만 어느 쪽도 측정된 적이 없었다. 경영 보고에 그대로 쓰이면
   *    없는 우위를 있다고 말하게 된다.
   *
   * 전국 평균은 심평원 환자경험평가 공표자료 같은 **출처를 등재해야** 숫자가 된다
   * (이연 과제). 그전까지는 없음을 밝힌다.
   */
  async getBenchmark(): Promise<BenchmarkResult> {
    return {
      available: false,
      reason: '전국 평균 비교 기준(심평원 환자경험평가 등) 미등재 — 출처 없는 비교는 표시하지 않습니다.',
      items: [],
    };
  }

  /* 9. 개선 과제 등록 */
  async createAction(data: CreateActionDto): Promise<ActionItem> {
    const a = await this.prisma.surveyActionItem.create({
      data: { department: data.department, title: data.title, description: data.description, priority: data.priority, status: 'OPEN', assignee: data.assignee ?? null },
    });
    this.logger.log(`Action created(DB): ${a.id} - ${a.title}`);
    return { id: a.id, department: a.department, title: a.title, description: a.description ?? '', priority: a.priority as ActionItem['priority'], status: a.status as ActionItem['status'], assignee: a.assignee ?? undefined, createdAt: a.createdAt.toISOString() };
  }

  /* 내부: 개선 과제 목록 (controller에서 사용) */
  async getActions(): Promise<ActionItem[]> {
    const db = await this.prisma.surveyActionItem.findMany({ orderBy: { createdAt: 'desc' } }).catch(() => []);
    const dbMapped: ActionItem[] = db.map((a) => ({ id: a.id, department: a.department, title: a.title, description: a.description ?? '', priority: a.priority as ActionItem['priority'], status: a.status as ActionItem['status'], assignee: a.assignee ?? undefined, createdAt: a.createdAt.toISOString() }));
    return [...dbMapped, ...this.actions];
  }
}
