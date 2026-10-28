import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'MASTER'); // 🔴 기관과 무관한 표준 템플릿 — REAL 에서도 허용
/**
 * 임상도구(clinical-chart) 필드를 담은 전문과 차트 템플릿 시드 — 추가·멱등(비파괴)
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-clinical-tool-templates.ts
 *
 * clinical-chart 필드는 ChartRenderer가 lib/clinical-charts 엔진으로 렌더(78종).
 * field: { id, type:'clinical-chart', label, clinicalChartId }
 * ownerId=null(공용)·findFirst 후 update/create 로 멱등 보장.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

type Field = Record<string, unknown>;
type Section = { id: string; title: string; columns?: number; fields: Field[] };
interface Tpl { name: string; department: string; role: string; category: string; layout: string; description: string; sections: Section[] }

const cc = (id: string, label: string, clinicalChartId: string): Field => ({ id, type: 'clinical-chart', label, clinicalChartId });
const ta = (id: string, label: string, mappedTo?: string): Field => ({ id, type: 'textarea', label, ...(mappedTo ? { mappedTo } : {}) });

const TEMPLATES: Tpl[] = [
  {
    name: '뇌졸중 평가 차트', department: '신경과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    description: '급성 뇌졸중 중증도·의식·기능 예후 임상도구 통합',
    sections: [
      { id: 's1', title: '주관적/병력', fields: [ ta('hpi', '현병력(발생시각·증상)', 'subjective'), ta('rf', '위험인자', 'subjective') ] },
      { id: 's2', title: '임상 평가', fields: [
        cc('nihss', 'NIHSS (뇌졸중 중증도)', 'NIHSS'),
        cc('gcs', 'GCS (의식수준)', 'GCS'),
        cc('mrs', 'mRS (기능 예후)', 'MRS'),
      ] },
      { id: 's3', title: '평가/계획', fields: [ ta('assessment', '평가', 'assessment'), ta('plan', '계획(혈전용해/재관류 등)', 'plan') ] },
    ],
  },
  {
    name: '항암 평가 차트', department: '종양내과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    description: '수행능력·체표면적·카보플라틴 용량 임상도구 통합',
    sections: [
      { id: 's1', title: '주관적/병력', fields: [ ta('hpi', '현병력·치료경과', 'subjective'), ta('tox', '독성/부작용', 'subjective') ] },
      { id: 's2', title: '임상 평가', fields: [
        cc('ecog', 'ECOG 수행능력', 'ECOG'),
        cc('bsa', '체표면적 BSA', 'BSA_MOSTELLER'),
        cc('calvert', 'Carboplatin 용량(Calvert)', 'CALVERT'),
      ] },
      { id: 's3', title: '평가/계획', fields: [ ta('assessment', '평가', 'assessment'), ta('plan', '레지멘/용량 계획', 'plan') ] },
    ],
  },
  {
    name: 'COPD 외래 차트', department: '호흡기내과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    description: 'COPD 중증도·호흡곤란·폐렴 중증도 임상도구 통합',
    sections: [
      { id: 's1', title: '주관적/병력', fields: [ ta('hpi', '현병력·악화력', 'subjective') ] },
      { id: 's2', title: '임상 평가', fields: [
        cc('gold', 'GOLD 기류제한', 'GOLD'),
        cc('mmrc', 'mMRC 호흡곤란', 'MMRC'),
        cc('curb', 'CURB-65 (폐렴 동반 시)', 'CURB65'),
      ] },
      { id: 's3', title: '평가/계획', fields: [ ta('assessment', '평가', 'assessment'), ta('plan', '흡입제/관리 계획', 'plan') ] },
    ],
  },
  {
    name: '정신과 선별 차트', department: '정신건강의학과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    description: '우울·불안 선별도구 통합 (선별이며 진단 아님)',
    sections: [
      { id: 's1', title: '주관적/면담', fields: [ ta('hpi', '현병력·면담 요약', 'subjective') ] },
      { id: 's2', title: '선별 평가', fields: [
        cc('phq9', 'PHQ-9 (우울)', 'PHQ9'),
        cc('gad7', 'GAD-7 (불안)', 'GAD7'),
      ] },
      { id: 's3', title: '평가/계획', fields: [ ta('assessment', '평가', 'assessment'), ta('plan', '계획(안전 평가 포함)', 'plan') ] },
    ],
  },
  {
    name: '중증도 평가 차트(응급/중환자)', department: '응급의학과', role: 'DOCTOR', category: 'EMERGENCY', layout: 'tabs',
    description: '조기경보·패혈증 선별·의식 임상도구 통합',
    sections: [
      { id: 's1', title: '주관적/내원경위', fields: [ ta('hpi', '내원 경위·주증상', 'subjective') ] },
      { id: 's2', title: '임상 평가', fields: [
        cc('news2', 'NEWS2 (조기경보)', 'NEWS2'),
        cc('qsofa', 'qSOFA (패혈증 선별)', 'QSOFA'),
        cc('gcs', 'GCS (의식)', 'GCS'),
      ] },
      { id: 's3', title: '평가/처치', fields: [ ta('assessment', '평가', 'assessment'), ta('plan', '처치/배치 계획', 'plan') ] },
    ],
  },
  {
    name: '만성콩팥병(CKD) 차트', department: '신장내과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    description: 'CKD 병기·신기능·급성신손상 임상도구 통합',
    sections: [
      { id: 's1', title: '주관적/병력', fields: [ ta('hpi', '현병력·기저질환', 'subjective') ] },
      { id: 's2', title: '임상 평가', fields: [
        cc('ckd', 'KDIGO CKD GFR 범주', 'CKD_GFR'),
        cc('crcl', 'Cockcroft-Gault 신기능', 'COCKCROFT'),
        cc('aki', 'AKI 병기(급성 시)', 'AKI'),
      ] },
      { id: 's3', title: '평가/계획', fields: [ ta('assessment', '평가', 'assessment'), ta('plan', '약물 보정/관리 계획', 'plan') ] },
    ],
  },
];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    ?? await prisma.user.findFirst();
  if (!admin) throw new Error('createdBy 로 쓸 사용자가 없습니다');
  let created = 0, updated = 0;
  for (const t of TEMPLATES) {
    const existing = await prisma.chartTemplate.findFirst({ where: { department: t.department, name: t.name, ownerId: null } });
    const data = {
      name: t.name, department: t.department, role: t.role, category: t.category, layout: t.layout,
      description: t.description, sections: t.sections as unknown as object, isActive: true, isDefault: false,
    };
    if (existing) {
      await prisma.chartTemplate.update({ where: { id: existing.id }, data: { sections: data.sections, description: data.description, layout: data.layout } });
      updated++;
    } else {
      await prisma.chartTemplate.create({ data: { ...data, ownerId: null, createdBy: admin.id } });
      created++;
    }
  }
  console.log(`임상도구 템플릿 시드 완료 — 생성 ${created} / 갱신 ${updated} (총 ${TEMPLATES.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
