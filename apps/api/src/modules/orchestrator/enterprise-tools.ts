/**
 * 엔터프라이즈 도구 — 역할별 확장
 * 경영진, 의료진, 간호사, 약사, 행정, 검사기사용
 */
import { ALL_QUALITY_METRICS } from '../data-quality/quality-registry';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ToolDefinition, ToolResult } from './tool-registry';
import { localeTimeText } from '@hospital-run/shared';

export function createEnterpriseTools(prisma: PrismaService): ToolDefinition[] {
  const QUALITY_METRICS = ALL_QUALITY_METRICS; // 🔴 전 17도메인 정본(종전 9개만 나열해 8도메인 누락)
  return [
    // ══ 데이터 품질(C5 — data-quality-concierge P3) ══
    {
      name: 'QUALITY_SUMMARY',
      description: '병원 데이터 품질 지표 요약(미서명 진료·위급값 미확인·오더 방치 등)을 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['품질', '데이터 품질', '미서명', '방치', '누락', '위급값'],
      execute: async (): Promise<ToolResult> => {
        const results = await Promise.all(QUALITY_METRICS.map(async (m) => {
          try { return { label: m.label, value: (await m.compute(prisma)).value, severity: m.severityWhenOver }; }
          catch { return null; }
        }));
        const list = results.filter((r): r is NonNullable<typeof r> => !!r && r.value > 0);
        const crit = list.filter((r) => r.severity === 'CRITICAL');
        const summary = list.length
          ? `품질 이슈 ${list.length}종${crit.length ? ` (즉시 처리: ${crit.map((c) => `${c.label} ${c.value}건`).join(', ')})` : ''} — 상세는 관리자>데이터 품질`
          : '현재 임계 초과 품질 이슈가 없습니다';
        return { success: true, data: { metrics: list }, summary };
      },
    },
    {
      name: 'QUALITY_WORKLIST',
      description: '특정 도메인(patient/encounter/order/admission/lab/billing/consent/staff/appointment)의 품질 지표 목록을 조회합니다',
      category: 'db',
      parameters: [{ name: 'domain', type: 'string', description: '도메인 키' }],
      keywords: ['워크리스트', '품질 목록', '도메인 품질'],
      execute: async (params): Promise<ToolResult> => {
        const targets = QUALITY_METRICS.filter((m) => m.domain === String(params.domain ?? ''));
        if (!targets.length) return { success: false, data: null, summary: `도메인 '${params.domain}' 지표 없음` };
        const rows = await Promise.all(targets.map(async (m) => ({ label: m.label, value: (await m.compute(prisma)).value, drillDown: m.drillDown })));
        return { success: true, data: { rows }, summary: rows.map((r) => `${r.label}: ${r.value}건`).join(' · ') };
      },
    },
    // ══════════════════════════════════════════════
    // 경영진 도구
    // ══════════════════════════════════════════════
    {
      name: 'REVENUE_STATS',
      description: '매출/수납 통계를 조회합니다 (오늘, 주간, 월간)',
      category: 'db',
      parameters: [{ name: 'period', type: 'string', description: 'today/week/month' }],
      keywords: ['매출', '수입', '수익', '실적', '얼마', '벌었'],
      execute: async (params): Promise<ToolResult> => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);
        const start = params.period === 'month' ? monthAgo : params.period === 'week' ? weekAgo : today;
        const billings = await prisma.billing.findMany({ where: { createdAt: { gte: start } } });
        const total = billings.reduce((s, b) => s + b.totalAmount, 0);
        const paid = billings.filter(b => b.status === 'PAID').reduce((s, b) => s + (b.paidAmount ?? 0), 0);
        const unpaid = billings.filter(b => b.status === 'PENDING').length;
        return { success: true, data: { total, paid, unpaid, count: billings.length }, summary: `${params.period === 'month' ? '월간' : params.period === 'week' ? '주간' : '오늘'} 매출: ${total.toLocaleString()}원 (수납 ${paid.toLocaleString()}원, 미수납 ${unpaid}건)` };
      },
    },
    {
      name: 'KPI_DASHBOARD',
      description: '병원 KPI 지표를 조회합니다 (환자수, 병상가동률, 재원일수 등)',
      category: 'db',
      parameters: [],
      keywords: ['KPI', '지표', '현황', '가동률', '통계', '성과'],
      execute: async (): Promise<ToolResult> => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        const [encounters, beds, admissions, icuOccupied] = await Promise.all([
          prisma.encounter.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
          prisma.bed.findMany(),
          prisma.admission.count({ where: { status: 'ADMITTED' } }),
          prisma.icuAdmission.count({ where: { status: 'ADMITTED' } }),
        ]);
        const totalBeds = beds.length;
        const occupied = beds.filter(b => b.status === 'OCCUPIED').length;
        // 🔴 (2026-09-16 J3) 병상 가동률의 **세 번째 정본**이었다 — executive 는 null, dashboard 는 I4 가 고쳤는데
        //    이 AI 도구만 `0%` 를 냈다. 이 값은 사람이 아니라 **LLM 응답으로 들어간다** — 지어낸 0% 가 문장이 된다.
        const rate = totalBeds > 0 ? Math.round((occupied / totalBeds) * 100) : null;
        // 한글은 요약 템플릿 한 곳에만 둔다(조립 문장 기준선은 '한글+보간 템플릿' 수를 센다)
        const bedText = rate != null ? `${occupied}/${totalBeds} (${rate}%)` : '미등록(가동률 산출 불가)';
        return { success: true, data: { encounters, totalBeds, occupied, rate, admissions, icuOccupied }, summary: `오늘 진료 ${encounters}건 | 병상 ${bedText} | 입원 ${admissions}명 | ICU ${icuOccupied}명` };
      },
    },
    {
      name: 'DEPT_PERFORMANCE',
      description: '진료과별 실적(진료건수, 매출)을 비교합니다',
      category: 'db',
      parameters: [{ name: 'department', type: 'string', description: '특정 진료과 (생략 시 전체)' }],
      keywords: ['부서', '진료과', '비교', '실적', '과별'],
      execute: async (params): Promise<ToolResult> => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true, ...(params.department ? { department: { contains: params.department } } : {}) }, select: { id: true, department: true } });
        const deptMap = new Map<string, string[]>();
        for (const d of doctors) { const dept = d.department ?? '기타'; if (!deptMap.has(dept)) deptMap.set(dept, []); deptMap.get(dept)!.push(d.id); }
        const results: string[] = [];
        for (const [dept, ids] of deptMap) {
          const cnt = await prisma.encounter.count({ where: { doctorId: { in: ids }, createdAt: { gte: today } } });
          results.push(`${dept}: ${cnt}건`);
        }
        return { success: true, data: results, summary: `오늘 진료과별 실적:\n${results.join('\n')}` };
      },
    },

    // ══════════════════════════════════════════════
    // 의료진 도구
    // ══════════════════════════════════════════════
    {
      name: 'PATIENT_HISTORY',
      description: '환자의 진료 이력/문제목록/알레르기를 조회합니다',
      category: 'db',
      parameters: [{ name: 'patientName', type: 'string', description: '환자 이름 또는 MRN' }],
      keywords: ['이력', '기왕력', '과거', '병력', '문제목록', '알레르기'],
      execute: async (params, ctx): Promise<ToolResult> => {
        const pid = ctx.patientId;
        if (!pid) return { success: false, data: null, summary: '환자 ID가 필요합니다.' };
        const [encounters, allergies, problems] = await Promise.all([
          prisma.encounter.findMany({ where: { patientId: pid }, orderBy: { createdAt: 'desc' }, take: 5, select: { createdAt: true, assessment: true, doctor: { select: { familyName: true, givenName: true, department: true } } } }),
          prisma.allergy.findMany({ where: { patientId: pid, isActive: true }, select: { allergen: true, severity: true } }),
          prisma.problemList.findMany({ where: { patientId: pid, status: 'ACTIVE' }, select: { description: true, status: true } }),
        ]);
        const parts = [];
        if (allergies.length) parts.push(`알레르기: ${allergies.map(a => `${a.allergen}(${a.severity})`).join(', ')}`);
        if (problems.length) parts.push(`문제목록: ${problems.map((p: any) => p.description).join(', ')}`);
        if (encounters.length) parts.push(`최근 진료:\n${encounters.map(e => `- ${new Date(e.createdAt).toLocaleDateString('ko')} ${e.doctor.familyName}${e.doctor.givenName}(${e.doctor.department}): ${(e.assessment ?? '').slice(0, 50)}`).join('\n')}`);
        return { success: true, data: { encounters, allergies, problems }, summary: parts.join('\n') || '이력 없음' };
      },
    },
    {
      name: 'PRESCRIPTION_HISTORY',
      description: '환자의 처방 이력을 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['처방', '약 목록', '복용', '처방전', '뭐 먹'],
      execute: async (_, ctx): Promise<ToolResult> => {
        if (!ctx.patientId) return { success: false, data: null, summary: '환자 ID 필요' };
        const rxs = await prisma.prescription.findMany({
          where: { encounter: { patientId: ctx.patientId } },
          orderBy: { createdAt: 'desc' }, take: 10,
          include: { medicationCode: { select: { nameKo: true } }, procedureCode: { select: { nameKo: true } } },
        });
        const summary = rxs.map(r => `${r.medicationCode?.nameKo ?? r.procedureCode?.nameKo ?? '?'} ${r.dosage ?? ''} ${r.frequency ?? ''}`).join('\n');
        return { success: true, data: rxs, summary: summary || '처방 이력 없음' };
      },
    },

    // ══════════════════════════════════════════════
    // 간호사 도구
    // ══════════════════════════════════════════════
    {
      name: 'VITAL_TRENDS',
      description: '입원 환자의 바이탈 트렌드를 조회합니다',
      category: 'db',
      parameters: [{ name: 'admissionId', type: 'string', description: '입원 ID' }],
      keywords: ['바이탈', '혈압', '체온', '맥박', '활력', 'BP', 'HR'],
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!ctx.patientId) return { success: false, data: null, summary: '환자 ID 필요' };
        const adm = await prisma.admission.findFirst({ where: { patientId: ctx.patientId, status: 'ADMITTED' } });
        if (!adm) return { success: true, data: null, summary: '현재 입원 중이 아닙니다.' };
        const ios = await prisma.intakeOutput.findMany({ where: { admissionId: adm.id }, orderBy: { recordedAt: 'desc' }, take: 10 });
        return { success: true, data: ios, summary: `최근 I/O 기록 ${ios.length}건` };
      },
    },
    {
      name: 'MED_SCHEDULE',
      description: '입원 환자의 투약 스케줄(MAR)을 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['투약', 'MAR', '약 줄', '스케줄', '투여'],
      execute: async (_, ctx): Promise<ToolResult> => {
        if (!ctx.patientId) return { success: false, data: null, summary: '환자 ID 필요' };
        const meds = await prisma.medicationAdministration.findMany({
          where: { patientId: ctx.patientId, status: 'SCHEDULED' },
          orderBy: { scheduledAt: 'asc' }, take: 10,
          include: { prescription: { include: { medicationCode: { select: { nameKo: true } } } } },
        });
        const summary = meds.length > 0
          ? meds.map(m => `${localeTimeText(new Date(m.scheduledAt), 'ko-KR', { hour: '2-digit', minute: '2-digit' })} ${m.prescription.medicationCode?.nameKo ?? '?'} ${m.dose} ${m.route}`).join('\n')
          : '예정된 투약 없음';
        return { success: true, data: meds, summary };
      },
    },

    // ══════════════════════════════════════════════
    // 약사 도구
    // ══════════════════════════════════════════════
    {
      name: 'PHARMACY_QUEUE',
      description: '약국 처방 대기열을 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['약국', '대기', '조제', '처방 대기', '약 대기'],
      execute: async (): Promise<ToolResult> => {
        const orders = await prisma.order.findMany({
          where: { department: 'PHARMACY', status: { in: ['ORDERED', 'RECEIVED'] } },
          include: { prescription: { include: { encounter: { select: { patient: { select: { familyName: true, givenName: true } } } }, medicationCode: { select: { nameKo: true } } } } },
          orderBy: { createdAt: 'asc' }, take: 20,
        });
        const summary = `약국 대기 ${orders.length}건\n${orders.slice(0, 5).map(o => `- ${o.prescription?.encounter?.patient?.familyName}${o.prescription?.encounter?.patient?.givenName}: ${o.prescription?.medicationCode?.nameKo ?? '?'} [${o.status}]`).join('\n')}`;
        return { success: true, data: orders, summary };
      },
    },

    // ══════════════════════════════════════════════
    // 행정(자재) 도구
    // ══════════════════════════════════════════════
    {
      name: 'INVENTORY_ALERTS',
      description: '재고 부족/유효기간 임박 알림을 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['재고', '부족', '물품', '자재', '유효기간', '만료'],
      execute: async (): Promise<ToolResult> => {
        const items = await prisma.inventoryItem.findMany({ where: { isActive: true } });
        const lowStock = items.filter(i => i.currentStock <= i.safetyStock);
        const d30 = new Date(); d30.setDate(d30.getDate() + 30);
        const expiringLots = await prisma.inventoryLot.findMany({ where: { status: 'ACTIVE', expiryDate: { lte: d30 } }, include: { item: { select: { name: true } } }, take: 10 });
        const parts = [];
        if (lowStock.length) parts.push(`재고 부족 ${lowStock.length}건:\n${lowStock.slice(0, 5).map(i => `- ${i.name}: ${i.currentStock}/${i.safetyStock}`).join('\n')}`);
        if (expiringLots.length) parts.push(`유효기간 임박 ${expiringLots.length}건:\n${expiringLots.slice(0, 5).map(l => `- ${(l as any).item?.name}: ${l.lotNumber} (${l.expiryDate ? new Date(l.expiryDate).toLocaleDateString('ko') : '?'})`).join('\n')}`);
        return { success: true, data: { lowStock: lowStock.length, expiring: expiringLots.length }, summary: parts.join('\n\n') || '알림 없음 (정상)' };
      },
    },
    {
      name: 'PURCHASE_ORDER_STATUS',
      description: '발주 현황을 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['발주', '주문', '납품', '입고'],
      execute: async (): Promise<ToolResult> => {
        const pos = await prisma.purchaseOrder.findMany({
          where: { status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED'] } },
          include: { supplier: { select: { name: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        });
        const summary = pos.length > 0
          ? `진행중 발주 ${pos.length}건:\n${pos.map(p => `- ${p.orderNumber} ${(p as any).supplier?.name ?? '?'} ${p.totalAmount.toLocaleString()}원 [${p.status}]`).join('\n')}`
          : '진행중 발주 없음';
        return { success: true, data: pos, summary };
      },
    },

    // ══════════════════════════════════════════════
    // 공통 도구
    // ══════════════════════════════════════════════
    {
      name: 'STAFF_INFO',
      description: '직원/인사 정보를 조회합니다',
      category: 'db',
      parameters: [{ name: 'query', type: 'string', description: '이름 또는 부서' }],
      keywords: ['직원', '인사', '인력', '몇명', '출근'],
      execute: async (params): Promise<ToolResult> => {
        const where: Record<string, unknown> = { status: 'ACTIVE' };
        if (params.query) where.OR = [{ department: { contains: params.query } }, { givenName: { contains: params.query } }];
        const staff = await prisma.staff.findMany({ where, select: { familyName: true, givenName: true, department: true, position: true, category: true }, take: 20 });
        const byDept = new Map<string, number>();
        staff.forEach(s => byDept.set(s.department, (byDept.get(s.department) ?? 0) + 1));
        const summary = `직원 ${staff.length}명\n${Array.from(byDept).map(([d, c]) => `${d}: ${c}명`).join(', ')}`;
        return { success: true, data: staff, summary };
      },
    },
    {
      name: 'EQUIPMENT_STATUS',
      description: '의료장비 상태를 조회합니다',
      category: 'db',
      parameters: [],
      keywords: ['장비', '기기', '고장', '점검', '의료기기'],
      execute: async (): Promise<ToolResult> => {
        const equips = await prisma.equipment.findMany({ select: { name: true, status: true, location: true, nextInspection: true } });
        const byStatus = new Map<string, number>();
        equips.forEach(e => byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1));
        const label: Record<string, string> = { ACTIVE: '정상', MAINTENANCE: '점검중', INACTIVE: '비활성', RETIRED: '폐기' };
        const summary = `장비 ${equips.length}대: ${Array.from(byStatus).map(([s, c]) => `${label[s] ?? s} ${c}대`).join(', ')}`;
        return { success: true, data: equips, summary };
      },
    },
    {
      name: 'WAITING_QUEUE',
      description: '현재 대기 환자 현황을 조회합니다',
      category: 'db',
      parameters: [{ name: 'department', type: 'string', description: '진료과' }],
      keywords: ['대기', '대기열', '몇명', '기다리'],
      execute: async (params): Promise<ToolResult> => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const where: Record<string, unknown> = { status: 'WAITING', createdAt: { gte: today } };
        if (params.department) where.departmentName = { contains: params.department };
        const queue = await prisma.waitingQueue.findMany({ where, orderBy: { createdAt: 'asc' }, include: { patient: { select: { familyName: true, givenName: true } } } });
        const summary = `대기 환자 ${queue.length}명${params.department ? ` (${params.department})` : ''}\n${queue.slice(0, 5).map((q, i) => `${i + 1}. ${q.patient.familyName}${q.patient.givenName}`).join('\n')}`;
        return { success: true, data: queue, summary };
      },
    },
  ];
}
