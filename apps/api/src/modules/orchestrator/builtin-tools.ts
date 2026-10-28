/**
 * 내장 도구 정의
 * 각 도구는 ToolDefinition 인터페이스를 구현
 */
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ToolDefinition, ToolContext, ToolResult } from './tool-registry';
import { localeTimeText } from '@hospital-run/shared';

export function createBuiltinTools(prisma: PrismaService, deps: {
  triage: (symptom: string) => Promise<any>;
  reference: (question: string, category?: string) => Promise<any>;
  getHospitalContext: () => Promise<string>;
}): ToolDefinition[] {
  return [
    // ── Medical API 도구 ──
    {
      name: 'TRIAGE',
      description: '환자 증상을 분석하여 적합한 진료과를 추천합니다',
      category: 'medical',
      parameters: [{ name: 'symptom', type: 'string', description: '환자 증상', required: true }],
      keywords: ['아프', '통증', '열', '기침', '두통', '어지러', '증상', '아파', '쑤시', '불편'],
      execute: async (params, ctx): Promise<ToolResult> => {
        const data = await deps.triage(params.symptom || ctx.userMessage);
        if (!data?.recommendations?.length) return { success: false, data: null, summary: '증상 분석에 실패했습니다.' };
        const summary = data.recommendations.map((r: any) => `${r.rank}순위: ${r.department} (${Math.round(r.confidence * 100)}%) - ${r.reason}`).join('\n');
        const emergency = data.emergency_warning ? `⚠️ 응급: ${data.emergency_warning}\n` : '';
        return { success: true, data, summary: `${emergency}진료과 추천:\n${summary}` };
      },
    },
    {
      name: 'MEDICAL_REFERENCE',
      description: '약물 정보, 의학 가이드라인, 질환 정보를 검색합니다',
      category: 'medical',
      parameters: [{ name: 'question', type: 'string', description: '의학 질문', required: true }, { name: 'category', type: 'string', description: 'drug/guideline/disease' }],
      keywords: ['약', '약물', '부작용', '복용', '금기', '상호작용', '가이드라인', '치료', '질환'],
      execute: async (params): Promise<ToolResult> => {
        const data = await deps.reference(params.question, params.category);
        if (!data?.answer) return { success: false, data: null, summary: '참고 정보를 찾지 못했습니다.' };
        const sources = data.sources?.map((s: any) => s.title).join(', ') ?? '';
        return { success: true, data, summary: `${data.answer}\n\n참고: ${sources}` };
      },
    },

    // ── DB 도구 ──
    {
      name: 'SCHEDULE',
      description: '의사의 진료 시간표를 조회합니다',
      category: 'db',
      parameters: [{ name: 'query', type: 'string', description: '의사 이름 또는 진료과' }],
      keywords: ['진료시간', '진료표', '몇시', '언제', '스케줄', '시간표'],
      execute: async (params, ctx): Promise<ToolResult> => {
        const q = params.query || ctx.department || '';
        const schedules = await prisma.clinicSchedule.findMany({
          where: q ? { doctor: { OR: [{ givenName: { contains: q } }, { department: { contains: q } }] } } : {},
          include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
          take: 15,
        });
        const dayN = ['일', '월', '화', '수', '목', '금', '토'];
        const summary = schedules.map((s: any) => `${s.doctor.familyName}${s.doctor.givenName}(${s.doctor.department}): ${dayN[s.dayOfWeek]}요일 ${s.period === 'AM' ? '오전' : '오후'} ${s.startTime}~${s.endTime}`).join('\n');
        return { success: true, data: schedules, summary: summary || '진료표 정보가 없습니다.' };
      },
    },
    {
      name: 'DOCTORS',
      description: '진료과별 의료진 목록을 조회합니다',
      category: 'db',
      parameters: [{ name: 'department', type: 'string', description: '진료과 이름' }],
      keywords: ['선생님', '의사', '누구', '어떤 분', '의료진', '소개', '전문'],
      execute: async (params, ctx): Promise<ToolResult> => {
        const dept = params.department || ctx.department || '';
        const doctors = await prisma.user.findMany({
          where: { role: 'DOCTOR', isActive: true, ...(dept ? { department: { contains: dept } } : {}) },
          select: { familyName: true, givenName: true, department: true, specialty: true },
        });
        const summary = doctors.map((d: any) => `${d.familyName}${d.givenName} 선생님 (${d.department}${d.specialty ? ' / ' + d.specialty : ''})`).join('\n');
        return { success: true, data: doctors, summary: summary || '의료진 정보가 없습니다.' };
      },
    },
    {
      name: 'APPOINTMENTS',
      description: '환자의 예약 내역을 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['예약', '내 예약', '예약 확인', '일정'],
      execute: async (_, ctx): Promise<ToolResult> => {
        if (!ctx.patientId) return { success: false, data: null, summary: '환자 정보가 필요합니다.' };
        const appts = await prisma.appointment.findMany({
          where: { patientId: ctx.patientId, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
          orderBy: { scheduledAt: 'asc' }, take: 5,
        });
        const summary = appts.length > 0
          ? appts.map((a: any) => `${new Date(a.scheduledAt).toLocaleDateString('ko')} ${localeTimeText(new Date(a.scheduledAt), 'ko-KR', { hour: '2-digit', minute: '2-digit' })} — ${a.doctor.familyName}${a.doctor.givenName}(${a.doctor.department})`).join('\n')
          : '예약 내역이 없습니다.';
        return { success: true, data: appts, summary };
      },
    },
    {
      name: 'LAB_RESULTS',
      description: '환자의 검사 결과를 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['검사', '결과', '혈액', '피검사', '수치', '나왔'],
      execute: async (_, ctx): Promise<ToolResult> => {
        if (!ctx.patientId) return { success: false, data: null, summary: '환자 정보가 필요합니다.' };
        const labs = await prisma.labResult.findMany({
          where: { patientId: ctx.patientId, status: 'COMPLETED' },
          include: { items: { select: { testName: true, value: true, unit: true, flag: true } } },
          orderBy: { completedAt: 'desc' }, take: 3,
        });
        const summary = labs.length > 0
          ? labs.map((l: any) => `[${l.completedAt ? new Date(l.completedAt).toLocaleDateString('ko') : ''}] ${l.items.map((i: any) => `${i.testName}: ${i.value}${i.unit}${i.flag !== 'N' ? ` (${i.flag})` : ''}`).join(', ')}`).join('\n')
          : '검사 결과가 없습니다.';
        return { success: true, data: labs, summary };
      },
    },
    {
      name: 'BILLING',
      description: '환자의 진료비/수납 내역을 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['진료비', '수납', '비용', '얼마', '청구', '결제'],
      execute: async (_, ctx): Promise<ToolResult> => {
        if (!ctx.patientId) return { success: false, data: null, summary: '환자 정보가 필요합니다.' };
        const bills = await prisma.billing.findMany({
          where: { patientId: ctx.patientId },
          orderBy: { createdAt: 'desc' }, take: 3,
        });
        const summary = bills.length > 0
          ? bills.map((b: any) => `${new Date(b.createdAt).toLocaleDateString('ko')} — 총 ${b.totalAmount.toLocaleString()}원 (본인부담 ${b.patientCopay.toLocaleString()}원) [${b.status === 'PAID' ? '수납완료' : '미수납'}]`).join('\n')
          : '수납 내역이 없습니다.';
        return { success: true, data: bills, summary };
      },
    },

    // ── 시스템 도구 ──
    {
      name: 'HOSPITAL_INFO',
      description: '병원 기본 정보(진료시간, 위치, 전화번호)를 안내합니다',
      category: 'system',
      parameters: [],
      keywords: ['병원', '위치', '주소', '전화', '진료시간', '영업', '운영', '찾아가'],
      execute: async (): Promise<ToolResult> => {
        const info = await deps.getHospitalContext();
        return { success: true, data: info, summary: info };
      },
    },
  ];
}
