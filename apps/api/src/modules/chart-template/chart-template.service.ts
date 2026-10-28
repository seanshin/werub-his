import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SPECIALTY_PRESETS } from './specialty-presets';

/**
 * 🔴 E10 — 차트 에디터가 `role:'의사'`·`category:'초진'`(한글)을 저장할 수 있었다.
 *    진료 화면 목록(`getForMe`)은 `OR:[{role: user.role},{role:'DOCTOR'}]`(영문 enum)로 조회하므로
 *    한글 role 로 만든 템플릿은 **관리자 목록에는 보이지만 진료 화면에는 영원히 안 뜬다**.
 *    운영 실측 한글 role 0건 = 첫 사용 순간 발현하는 잠재 결함 → 서버에서 계약을 강제한다.
 */
export const CHART_TEMPLATE_ROLES: string[] = Object.values(UserRole);
export const CHART_TEMPLATE_CATEGORIES = [
  'OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'SURGERY', 'NURSING', 'LAB', 'CHECKUP', 'ICU', 'REHAB', 'OTHER',
] as const;

/** SOAP 슬롯 — 진료 화면 렌더러/합성기가 읽는 유일한 매핑 값 */
const SOAP_SLOTS = ['subjective', 'objective', 'assessment', 'plan'] as const;

interface ChartTemplateInput {
  name?: string;
  department?: string;
  role?: string;
  category?: string;
  description?: string;
  layout?: string;
  sections?: Prisma.InputJsonValue;
  isDefault?: boolean;
  isPersonal?: boolean;
  ownerId?: string;
  version?: string;
  changeNote?: string;
}

interface PresetSection {
  id: string;
  title: string;
  icon?: string;
  columns?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  fields: Array<Record<string, unknown>>;
}

interface Preset {
  name: string;
  department: string;
  role: string;
  category: string;
  layout: string;
  sections: PresetSection[];
}

// KCD 진단코드 → 진료과 매핑 (Phase 4: AI 추천)
const DIAGNOSIS_DEPT_MAP: Record<string, string> = {
  'J': '내과', 'I': '내과', 'E': '내과', 'K': '내과',
  'M': '정형외과', 'S': '외과', 'T': '외과',
  'F': '정신건강의학과', 'G': '신경외과',
  'N': '비뇨의학과', 'O': '산부인과',
  'P': '소아청소년과', 'H': '안과',
  'L': '피부과', 'C': '외과', 'D': '내과',
};

// 프리셋 정의
const PRESETS: Record<string, Preset> = {
  'internal-outpatient': {
    name: '내과 외래 진료', department: '내과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 증상 (S)', icon: 'chat', columns: 1, collapsible: true, defaultOpen: true, fields: [
        { id: 'f1', type: 'textarea', label: '주호소', placeholder: '환자가 호소하는 증상...', required: true, rows: 3, mappedTo: 'subjective', aiAssist: true },
        { id: 'f2', type: 'multiselect', label: '동반 증상', options: ['발열', '기침', '두통', '구토', '설사', '호흡곤란', '흉통', '복통', '어지러움'], mappedTo: 'symptoms' },
        { id: 'f3', type: 'pain-scale', label: '통증 강도 (NRS)', mappedTo: 'painScore' },
      ]},
      { id: 's2', title: '객관적 소견 (O)', icon: 'stethoscope', columns: 2, fields: [
        { id: 'f4', type: 'vitals', label: '활력징후', mappedTo: 'vitals' },
        { id: 'f5', type: 'textarea', label: '이학적 소견', rows: 4, mappedTo: 'objective' },
        { id: 'f6', type: 'lab-reference', label: '최근 검사결과', autoLoad: true },
      ]},
      { id: 's3', title: '평가/진단 (A)', fields: [
        { id: 'f7', type: 'diagnosis-search', label: '진단코드', codeSystem: 'KCD', multiple: true, mappedTo: 'assessment' },
      ]},
      { id: 's4', title: '치료계획 (P)', fields: [
        { id: 'f8', type: 'prescription', label: '약 처방', durCheck: true, orderSets: true },
        { id: 'f9', type: 'order', label: '검사/영상 오더', departments: ['LAB', 'IMAGING'] },
        { id: 'f10', type: 'textarea', label: '치료계획 메모', rows: 3, mappedTo: 'plan' },
      ]},
    ],
  },
  'surgery-opnote': {
    name: '외과 수술기록', department: '외과', role: 'DOCTOR', category: 'SURGERY', layout: 'single-page',
    sections: [
      { id: 's1', title: '수술 정보', columns: 2, fields: [
        { id: 'f1', type: 'text', label: '수술명', required: true, mappedTo: 'procedureName' },
        { id: 'f2', type: 'text', label: '수술 코드', mappedTo: 'procedureCode' },
        { id: 'f3', type: 'textarea', label: '수술 전 진단', mappedTo: 'preOpDiagnosis' },
        { id: 'f4', type: 'textarea', label: '수술 후 진단', mappedTo: 'postOpDiagnosis' },
      ]},
      { id: 's2', title: '수술 기록', fields: [
        { id: 'f5', type: 'textarea', label: '수술 소견', rows: 6, mappedTo: 'opNote' },
        { id: 'f6', type: 'textarea', label: '합병증', mappedTo: 'complications' },
        { id: 'f7', type: 'number', label: '추정 실혈량 (mL)', mappedTo: 'ebl' },
        { id: 'f8', type: 'text', label: '검체', mappedTo: 'specimens' },
        { id: 'f9', type: 'text', label: '삽입물/기기', mappedTo: 'implants' },
        { id: 'f10', type: 'text', label: '배액관', mappedTo: 'drains' },
      ]},
      { id: 's3', title: '시간 기록', columns: 2, fields: [
        { id: 'f11', type: 'time', label: '절개 시간', mappedTo: 'incisionTime' },
        { id: 'f12', type: 'time', label: '봉합 시간', mappedTo: 'closureTime' },
      ]},
    ],
  },
  'pediatrics': {
    name: '소아청소년과 진료', department: '소아청소년과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 증상', fields: [
        { id: 'f1', type: 'textarea', label: '주호소 (보호자 진술)', required: true, mappedTo: 'subjective' },
        { id: 'f2', type: 'textarea', label: '식이/수유', mappedTo: 'feeding' },
        { id: 'f3', type: 'textarea', label: '수면/배변', mappedTo: 'sleepBowel' },
      ]},
      { id: 's2', title: '성장 발달', columns: 3, fields: [
        { id: 'f4', type: 'number', label: '체중 (kg)', mappedTo: 'weight' },
        { id: 'f5', type: 'number', label: '신장 (cm)', mappedTo: 'height' },
        { id: 'f6', type: 'number', label: '두위 (cm)', mappedTo: 'headCircumference' },
        { id: 'f7', type: 'growth-chart', label: '성장 곡선' },
        { id: 'f8', type: 'checklist', label: '발달 체크', items: ['목 가누기', '뒤집기', '앉기', '기기', '걷기', '옹알이', '단어'] },
      ]},
      { id: 's3', title: '소견/진단', fields: [
        { id: 'f9', type: 'vitals', label: '활력징후', mappedTo: 'vitals' },
        { id: 'f10', type: 'textarea', label: '이학적 소견', mappedTo: 'objective' },
        { id: 'f11', type: 'diagnosis-search', label: '진단', mappedTo: 'assessment' },
      ]},
      { id: 's4', title: '치료', fields: [
        { id: 'f12', type: 'prescription', label: '처방' },
        { id: 'f13', type: 'textarea', label: '보호자 교육/설명', mappedTo: 'plan' },
      ]},
    ],
  },
  'emergency': {
    name: '응급실 진료', department: '응급의학과', role: 'DOCTOR', category: 'EMERGENCY', layout: 'single-page',
    sections: [
      { id: 's1', title: 'KTAS 트리아지', columns: 2, fields: [
        { id: 'f1', type: 'select', label: 'KTAS 등급', options: ['1등급 (소생)', '2등급 (긴급)', '3등급 (응급)', '4등급 (준응급)', '5등급 (비응급)'], required: true },
        { id: 'f2', type: 'text', label: '주호소', required: true, mappedTo: 'subjective' },
        { id: 'f3', type: 'vitals', label: '활력징후', mappedTo: 'vitals' },
      ]},
      { id: 's2', title: '처치 기록', fields: [
        { id: 'f4', type: 'timeline', label: '처치 타임라인' },
        { id: 'f5', type: 'textarea', label: '처치 내용', mappedTo: 'objective' },
      ]},
      { id: 's3', title: '평가/처분', fields: [
        { id: 'f6', type: 'diagnosis-search', label: '진단', mappedTo: 'assessment' },
        { id: 'f7', type: 'select', label: '최종 결정', options: ['귀가', '입원', '전원', 'ICU 입실', '수술'] },
        { id: 'f8', type: 'textarea', label: '계획', mappedTo: 'plan' },
      ]},
    ],
  },
  'nursing-assessment': {
    name: '간호 초기사정', department: '간호부', role: 'NURSE', category: 'NURSING', layout: 'accordion',
    sections: [
      { id: 's1', title: '의식/활동', columns: 2, fields: [
        { id: 'f1', type: 'select', label: '의식 수준', options: ['Alert', 'Verbal', 'Pain', 'Unresponsive'] },
        { id: 'f2', type: 'select', label: '이동능력', options: ['독립', '부분보조', '완전보조', '침상안정'] },
        { id: 'f3', type: 'score-calculator', label: '낙상 위험 (Morse)', calculator: 'MORSE' },
      ]},
      { id: 's2', title: '통증', fields: [
        { id: 'f4', type: 'pain-scale', label: '통증 (NRS)' },
        { id: 'f6', type: 'body-diagram', label: '통증 위치 마킹' },
      ]},
      { id: 's3', title: '피부/영양', columns: 2, fields: [
        { id: 'f7', type: 'select', label: '피부 상태', options: ['정상', '건조', '발적', '상처', '욕창'] },
        { id: 'f8', type: 'score-calculator', label: '욕창 위험 (Braden)', calculator: 'BRADEN_SCALE' },
        { id: 'f9', type: 'select', label: '영양 상태', options: ['양호', '불량', '영양실조 위험'] },
        { id: 'f10', type: 'checkbox', label: '알레르기 확인', mappedTo: 'allergyConfirmed' },
      ]},
    ],
  },
  'nursing-note-dar': {
    name: '간호일지 (DAR)', department: '간호부', role: 'NURSE', category: 'NURSING', layout: 'single-page',
    sections: [
      { id: 's1', title: 'Focus Charting', fields: [
        { id: 'f1', type: 'select', label: '근무조', options: ['D (주간)', 'E (준야)', 'N (심야)'] },
        { id: 'f2', type: 'text', label: 'Focus (초점)', placeholder: '통증, 발열, 수술 후 관리...' },
        { id: 'f3', type: 'textarea', label: 'D (Data) — 자료', rows: 3, placeholder: '주관적/객관적 자료...' },
        { id: 'f4', type: 'textarea', label: 'A (Action) — 간호중재', rows: 3, placeholder: '시행한 간호중재...' },
        { id: 'f5', type: 'textarea', label: 'R (Response) — 반응/평가', rows: 3, placeholder: '환자 반응 및 평가...' },
      ]},
    ],
  },
  'icu-record': {
    name: 'ICU 기록', department: 'ICU', role: 'DOCTOR', category: 'INPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '바이탈', columns: 3, fields: [
        { id: 'f1', type: 'vitals', label: '활력징후' },
        { id: 'f2', type: 'score-calculator', label: 'GCS', calculator: 'GCS' },
        { id: 'f3', type: 'select', label: '의식', options: ['Alert', 'Verbal', 'Pain', 'Unresponsive'] },
      ]},
      { id: 's2', title: 'I/O', columns: 2, fields: [
        { id: 'f4', type: 'number', label: '경구 섭취 (mL)' }, { id: 'f5', type: 'number', label: 'IV (mL)' },
        { id: 'f6', type: 'number', label: '소변 (mL)' }, { id: 'f7', type: 'number', label: '배액 (mL)' },
      ]},
      { id: 's3', title: '인공호흡기', columns: 3, fields: [
        { id: 'f8', type: 'select', label: '모드', options: ['AC', 'SIMV', 'PS', 'CPAP', 'T-piece'] },
        { id: 'f9', type: 'number', label: 'FiO2 (%)' }, { id: 'f10', type: 'number', label: 'PEEP' },
        { id: 'f11', type: 'number', label: 'TV (mL)' },
      ]},
      { id: 's4', title: '중증도', columns: 2, fields: [
        { id: 'f12', type: 'score-calculator', label: 'APACHE II', calculator: 'APACHE_II' },
        { id: 'f13', type: 'score-calculator', label: 'SOFA', calculator: 'SOFA' },
      ]},
    ],
  },
  'lab-result': {
    name: '검사결과 입력', department: '진단검사의학과', role: 'LAB_TECH', category: 'LAB', layout: 'single-page',
    sections: [
      { id: 's1', title: '검사 정보', columns: 2, fields: [
        { id: 'f1', type: 'text', label: '검사명', required: true },
        { id: 'f2', type: 'select', label: '검사 유형', options: ['혈액', '생화학', '면역', '미생물', '소변'] },
      ]},
      { id: 's2', title: '결과 입력', fields: [
        { id: 'f3', type: 'lab-reference', label: '검사 항목별 결과', mode: 'input' },
      ]},
      { id: 's3', title: 'QC / 비고', fields: [
        { id: 'f4', type: 'checkbox', label: 'QC 적합' },
        { id: 'f5', type: 'textarea', label: '비고' },
      ]},
    ],
  },
  'psychiatry': {
    name: '정신건강의학과 진료', department: '정신건강의학과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '정신상태검사 (MSE)', fields: [
        { id: 'f1', type: 'select', label: '외모/행동', options: ['단정', '보통', '부적절'] },
        { id: 'f2', type: 'select', label: '기분/감정', options: ['정상', '우울', '불안', '흥분', '무감동'] },
        { id: 'f3', type: 'select', label: '사고 내용', options: ['정상', '망상', '자살사고', '강박'] },
        { id: 'f4', type: 'textarea', label: '면담 내용', rows: 5, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '평가', fields: [
        { id: 'f5', type: 'diagnosis-search', label: '진단', mappedTo: 'assessment' },
        { id: 'f6', type: 'slider', label: 'GAF 점수', min: 0, max: 100 },
      ]},
      { id: 's3', title: '치료계획', fields: [
        { id: 'f7', type: 'prescription', label: '약물 처방' },
        { id: 'f8', type: 'textarea', label: '심리치료 계획', mappedTo: 'plan' },
        { id: 'f9', type: 'date', label: '다음 예약일' },
      ]},
    ],
  },
  'orthopedics': {
    name: '정형외과 진료', department: '정형외과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '증상', fields: [
        { id: 'f1', type: 'textarea', label: '주호소', mappedTo: 'subjective' },
        { id: 'f2', type: 'body-diagram', label: '통증 부위 마킹' },
        { id: 'f3', type: 'pain-scale', label: '통증 (NRS)' },
      ]},
      { id: 's2', title: '소견', columns: 2, fields: [
        { id: 'f4', type: 'textarea', label: 'ROM (관절가동범위)', mappedTo: 'objective' },
        { id: 'f5', type: 'textarea', label: '근력 검사' },
        { id: 'f6', type: 'photo-capture', label: '영상/사진' },
      ]},
      { id: 's3', title: '진단/치료', fields: [
        { id: 'f7', type: 'diagnosis-search', label: '진단', mappedTo: 'assessment' },
        { id: 'f8', type: 'prescription', label: '처방' },
        { id: 'f9', type: 'order', label: '검사 오더' },
        { id: 'f10', type: 'textarea', label: '재활 계획', mappedTo: 'plan' },
      ]},
    ],
  },
  'obstetrics': {
    name: '산부인과 산전 관리', department: '산부인과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '산과력', columns: 2, fields: [
        { id: 'f1', type: 'number', label: '재태 주수' },
        { id: 'f2', type: 'text', label: 'G/P (임신/출산력)', placeholder: 'G1P0' },
        { id: 'f3', type: 'date', label: '분만예정일' },
      ]},
      { id: 's2', title: '검사', fields: [
        { id: 'f4', type: 'vitals', label: '활력징후' },
        { id: 'f5', type: 'number', label: '자궁저고 (cm)' },
        { id: 'f6', type: 'select', label: '태아 심음', options: ['정상', '빈맥', '서맥', '불규칙'] },
        { id: 'f7', type: 'order', label: '초음파/검사 오더' },
      ]},
      { id: 's3', title: '계획', fields: [
        { id: 'f8', type: 'prescription', label: '처방 (엽산 등)' },
        { id: 'f9', type: 'textarea', label: '교육/설명', mappedTo: 'plan' },
      ]},
    ],
  },
  'blank': {
    name: '빈 템플릿', department: '', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '섹션 1', fields: [] },
    ],
  },
  // 전문과 프리셋 확충(Track 1) — 안과·이비인후·피부·신경외과·비뇨·치과·재활·성형·가정의학·신장 (clinical-chart 필드 임베드)
  ...SPECIALTY_PRESETS,
};

@Injectable()
export class ChartTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /** 역할/카테고리 계약 검증 — 한글·미지의 값은 저장 자체를 거부한다(만들어졌다고 착각시키지 않는다). */
  private assertContract(data: { role?: string; category?: string }) {
    if (data.role !== undefined && !CHART_TEMPLATE_ROLES.includes(data.role)) {
      throw new BadRequestException(
        `역할은 시스템 역할 코드여야 합니다(예: DOCTOR·NURSE). 받은 값: '${data.role}' — 한글 역할명으로 저장하면 진료 화면 목록에 나타나지 않습니다.`,
      );
    }
    if (data.category !== undefined && !(CHART_TEMPLATE_CATEGORIES as readonly string[]).includes(data.category)) {
      throw new BadRequestException(
        `카테고리는 ${CHART_TEMPLATE_CATEGORIES.join('·')} 중 하나여야 합니다. 받은 값: '${data.category}'`,
      );
    }
  }

  /**
   * 🔴 E3 — 에디터는 `soapMapping` 에 쓰고 렌더러/저장은 `mappedTo` 만 읽어, 에디터에서 고른
   *    "SOAP 매핑" 이 아무 데도 쓰이지 않았다(프리셋 실측: mappedTo 26곳 · soapMapping 0곳).
   *    매핑 키를 `mappedTo` 하나로 수렴하고, 레거시 키는 저장 시점에 흡수 후 제거한다(재유입 차단).
   */
  private normalizeSections(sections: unknown): Prisma.InputJsonValue | undefined {
    if (!Array.isArray(sections)) return undefined;
    return sections.map((section) => {
      const s = { ...(section as Record<string, unknown>) };
      if (Array.isArray(s.fields)) {
        s.fields = s.fields.map((field) => {
          const f = { ...(field as Record<string, unknown>) };
          const legacy = typeof f.soapMapping === 'string' ? f.soapMapping.trim() : '';
          const current = typeof f.mappedTo === 'string' ? f.mappedTo.trim() : '';
          if (!current && (SOAP_SLOTS as readonly string[]).includes(legacy)) f.mappedTo = legacy;
          delete f.soapMapping;
          if (f.mappedTo === '') delete f.mappedTo;
          return f;
        });
      }
      return s;
    }) as unknown as Prisma.InputJsonValue;
  }

  /**
   * 개인 템플릿 접근 경계.
   * 🔴 rollback IDOR — 형제 `update` 에는 소유 검증이 있었지만 `GET :id`·`versions`·`rollback`·
   *    `clone` 에는 없었다. rollback 은 update 와 똑같이 `sections` 를 덮어쓴다(보호가 반쪽).
   *    남의 개인 템플릿은 **없는 것과 똑같이 404** 로 답한다(존재 여부도 알려주지 않는다).
   */
  private assertAccessible<T extends { isPersonal: boolean; ownerId: string | null }>(t: T, userId?: string): T {
    if (t.isPersonal && userId && t.ownerId !== userId) throw new NotFoundException('Chart template not found');
    return t;
  }

  async findAll(filters: { department?: string; role?: string; category?: string }) {
    const where: Prisma.ChartTemplateWhereInput = { isActive: true, isPersonal: false };
    if (filters.department) where.department = { contains: filters.department };
    if (filters.role) where.role = filters.role;
    if (filters.category) where.category = filters.category;
    return this.prisma.chartTemplate.findMany({ where, orderBy: [{ isDefault: 'desc' }, { usageCount: 'desc' }], take: 300 });
  }

  /** userId 를 넘기면 남의 개인 템플릿은 404(없는 것과 동일). 내부 존재 확인용은 생략 가능. */
  async findById(id: string, userId?: string) {
    const t = await this.prisma.chartTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Chart template not found');
    return this.assertAccessible(t, userId);
  }

  async create(data: ChartTemplateInput & { name: string }, userId: string) {
    this.assertContract(data);
    return this.prisma.chartTemplate.create({
      data: {
        name: data.name,
        department: data.department ?? '',
        role: data.role ?? 'DOCTOR',
        category: data.category ?? 'OUTPATIENT',
        description: data.description,
        layout: data.layout ?? 'tabs',
        sections: this.normalizeSections(data.sections) ?? [],
        isDefault: data.isDefault ?? false,
        isPersonal: data.isPersonal ?? false,
        ownerId: data.ownerId ?? null,
        version: data.version ?? '1.0',
        createdBy: userId,
      },
    });
  }

  async update(id: string, data: ChartTemplateInput, userId?: string) {
    const current = await this.findById(id);
    // 개인 템플릿은 소유자만 수정 가능
    if (current.isPersonal && userId && current.ownerId !== userId) {
      throw new ForbiddenException('개인 템플릿은 소유자만 수정할 수 있습니다');
    }
    this.assertContract(data);
    if (data.sections) data.sections = this.normalizeSections(data.sections) ?? data.sections;

    // Phase 3: 수정 전 현재 상태를 버전 히스토리에 자동 스냅샷
    if (data.sections) {
      await this.prisma.chartTemplateVersion.create({
        data: {
          templateId: id,
          version: current.version,
          sections: current.sections as Prisma.InputJsonValue,
          changedBy: userId ?? null,
          changeNote: data.changeNote ?? null,
        },
      });
    }

    const newVersion = data.sections ? this.bumpVersion(current.version) : current.version;
    // changeNote는 버전에만 저장, 템플릿에는 전달하지 않음
    const { changeNote: _changeNote, ...updateData } = data;
    return this.prisma.chartTemplate.update({
      where: { id },
      data: { ...updateData, version: newVersion, ...(data.sections && { sections: data.sections }) },
    });
  }

  async delete(id: string) {
    return this.prisma.chartTemplate.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * 🔴 E12 — 종전 복사는 `isPersonal`/`ownerId` 를 옮기지 않아 **개인 템플릿의 복제본이 전체 공개**로
   *    떨어졌다(내 전용 서식이 전 병원 목록에 등장). 개인 템플릿의 복사본은 복사한 사람의 개인 것이다.
   */
  async clone(id: string, userId: string) {
    const src = await this.findById(id, userId);
    return this.prisma.chartTemplate.create({
      data: {
        name: `${src.name} (복사)`, department: src.department, role: src.role, category: src.category,
        description: src.description, layout: src.layout, sections: src.sections as Prisma.InputJsonValue,
        isPersonal: src.isPersonal,
        ownerId: src.isPersonal ? userId : null,
        version: '1.0', createdBy: userId,
      },
    });
  }

  getPresets() {
    return Object.entries(PRESETS).map(([key, preset]) => ({ key, name: preset.name, department: preset.department, role: preset.role, category: preset.category, sectionCount: preset.sections.length, fieldCount: preset.sections.reduce((s: number, sec: PresetSection) => s + (sec.fields?.length ?? 0), 0) }));
  }

  async createFromPreset(presetKey: string, userId: string, overrides?: { name?: string; department?: string }) {
    const preset = PRESETS[presetKey];
    if (!preset) throw new NotFoundException(`Preset ${presetKey} not found`);
    return this.create({ ...preset, sections: preset.sections as unknown as Prisma.InputJsonValue, ...overrides }, userId);
  }

  /** 내 템플릿 목록 (개인 소유 + 공용 중 역할/과 매칭) + 개인 설정 */
  async getForMe(userId: string, role: string, department?: string) {
    const where: Prisma.ChartTemplateWhereInput = {
      isActive: true,
      OR: [
        // 1. 내 개인 템플릿
        { isPersonal: true, ownerId: userId },
        // 2. 공용 템플릿 중 역할/과 매칭
        {
          isPersonal: false,
          OR: [{ role }, { role: 'DOCTOR' }],
          ...(department ? { department: { contains: department } } : {}),
        },
      ],
    };

    const [templates, preference] = await Promise.all([
      this.prisma.chartTemplate.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { usageCount: 'desc' }],
        take: 20,
      }),
      this.prisma.userChartPreference.findUnique({ where: { userId } }),
    ]);

    return {
      templates,
      preference: preference ?? { defaultTemplateId: null, favoriteTemplateIds: [], recentTemplateIds: [] },
    };
  }

  /** 개인 템플릿 생성 (공용 복제 -> 개인화) */
  async createPersonal(templateId: string, userId: string, customizations?: { name?: string; sections?: any }) {
    const src = await this.findById(templateId, userId);
    return this.prisma.chartTemplate.create({
      data: {
        name: customizations?.name ?? `${src.name} (개인)`,
        department: src.department,
        role: src.role,
        category: src.category,
        description: src.description,
        layout: src.layout,
        sections: this.normalizeSections(customizations?.sections) ?? (src.sections as Prisma.InputJsonValue),
        isPersonal: true,
        ownerId: userId,
        version: '1.0',
        createdBy: userId,
      },
    });
  }

  /** 내 설정 조회 */
  async getMySettings(userId: string) {
    const pref = await this.prisma.userChartPreference.findUnique({ where: { userId } });
    return pref ?? { defaultTemplateId: null, favoriteTemplateIds: [], recentTemplateIds: [] };
  }

  /** boardLayout JsonB 정규화 — 레거시(string[])와 신형({panels, pinned}) 모두 수용 */
  private parseBoardLayout(raw: unknown): { panels: string[] | null; pinned: string[] } {
    if (Array.isArray(raw)) return { panels: raw as string[], pinned: [] }; // 레거시(핀 도입 전)
    if (raw && typeof raw === 'object') {
      const o = raw as { panels?: unknown; pinned?: unknown };
      const panels = Array.isArray(o.panels) && o.panels.length ? (o.panels as string[]) : null;
      const pinned = Array.isArray(o.pinned) ? (o.pinned as string[]) : [];
      return { panels, pinned };
    }
    return { panels: null, pinned: [] };
  }

  /** 큰 화면 보기(board) 개인 레이아웃 조회 — 로밍 단말 동기화(패널 순서 + 핀 고정) */
  async getBoardLayout(userId: string) {
    const pref = await this.prisma.userChartPreference.findUnique({ where: { userId }, select: { boardLayout: true } });
    return this.parseBoardLayout(pref?.boardLayout);
  }

  /**
   * 큰 화면 보기(board) 개인 레이아웃 저장.
   * panels null/빈배열=역할 기본으로 초기화. pinned undefined=기존 핀 보존(부분 저장 호환),
   * []=핀 전체 해제. 둘 다 비면 DbNull(완전 초기화).
   */
  async setBoardLayout(userId: string, panels: string[] | null, pinned?: string[] | null) {
    const effectivePinned = pinned === undefined
      ? (await this.getBoardLayout(userId)).pinned // 미전달 = 기존 핀 보존
      : (pinned ?? []);
    const normPanels = panels && panels.length ? panels : null;
    const value: Prisma.InputJsonValue | typeof Prisma.DbNull =
      !normPanels && !effectivePinned.length
        ? Prisma.DbNull
        : { panels: normPanels ?? [], pinned: effectivePinned };
    await this.prisma.userChartPreference.upsert({
      where: { userId },
      update: { boardLayout: value },
      create: { userId, boardLayout: value === Prisma.DbNull ? undefined : value },
    });
    return { panels: normPanels, pinned: effectivePinned };
  }

  /** 기본 템플릿 설정 */
  async setDefaultTemplate(userId: string, templateId: string) {
    // 템플릿 존재 확인
    await this.findById(templateId);
    return this.prisma.userChartPreference.upsert({
      where: { userId },
      update: { defaultTemplateId: templateId },
      create: { userId, defaultTemplateId: templateId },
    });
  }

  /** 즐겨찾기 토글 */
  async toggleFavorite(userId: string, templateId: string) {
    // 템플릿 존재 확인
    await this.findById(templateId);
    const pref = await this.prisma.userChartPreference.findUnique({ where: { userId } });

    if (pref) {
      const favorites = pref.favoriteTemplateIds ?? [];
      const idx = favorites.indexOf(templateId);
      const newFavorites = idx >= 0
        ? favorites.filter((id) => id !== templateId)
        : [...favorites, templateId];

      return this.prisma.userChartPreference.update({
        where: { userId },
        data: { favoriteTemplateIds: newFavorites },
      });
    }

    return this.prisma.userChartPreference.create({
      data: { userId, favoriteTemplateIds: [templateId] },
    });
  }

  /** 사용 기록 (카운트 증가 + 최근 사용 업데이트) — 남의 개인 템플릿은 404 */
  async recordUsage(id: string, userId?: string) {
    await this.findById(id, userId);
    const result = await this.prisma.chartTemplate.update({
      where: { id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });

    // userId가 있으면 최근 사용 기록 업데이트
    if (userId) {
      const pref = await this.prisma.userChartPreference.findUnique({ where: { userId } });
      const recents = pref?.recentTemplateIds ?? [];
      // 중복 제거 후 최신을 앞에 추가, 최대 5개
      const newRecents = [id, ...recents.filter((r) => r !== id)].slice(0, 5);

      await this.prisma.userChartPreference.upsert({
        where: { userId },
        update: { recentTemplateIds: newRecents },
        create: { userId, recentTemplateIds: newRecents },
      });
    }

    return result;
  }

  /** 내 개인 템플릿 목록 */
  async findMyPersonal(userId: string) {
    return this.prisma.chartTemplate.findMany({
      where: { isActive: true, isPersonal: true, ownerId: userId },
      orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  // ── Phase 3: 버전 히스토리 + 롤백 ──

  /** 버전 히스토리 목록 (최신 20개) — 남의 개인 템플릿은 404 */
  async getVersionHistory(templateId: string, userId?: string) {
    await this.findById(templateId, userId); // 존재 + 접근 확인
    return this.prisma.chartTemplateVersion.findMany({
      where: { templateId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /** 특정 버전 상세 — 남의 개인 템플릿은 404 */
  async getVersion(templateId: string, versionId: string, userId?: string) {
    await this.findById(templateId, userId);
    const version = await this.prisma.chartTemplateVersion.findFirst({
      where: { id: versionId, templateId },
    });
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }

  /**
   * 이전 버전으로 롤백.
   * 🔴 rollback IDOR — 여긴 소유 검증이 없어 **남의 개인 템플릿 sections 를 통째로 덮어쓸 수 있었다**
   *    (형제 update 는 막고 있었으니 보호가 반쪽 — W7 my-codes 패턴 재발).
   */
  async rollbackToVersion(templateId: string, versionId: string, userId?: string) {
    const current = await this.findById(templateId, userId);
    const version = await this.getVersion(templateId, versionId, userId);

    // 현재 상태를 스냅샷으로 저장 (롤백 전)
    await this.prisma.chartTemplateVersion.create({
      data: {
        templateId,
        version: current.version,
        sections: current.sections as Prisma.InputJsonValue,
        changedBy: userId ?? null,
        changeNote: `v${version.version}으로 롤백 전 자동 저장`,
      },
    });

    // 롤백 실행
    const newVersion = this.bumpVersion(current.version);
    return this.prisma.chartTemplate.update({
      where: { id: templateId },
      data: {
        sections: version.sections as Prisma.InputJsonValue,
        version: newVersion,
      },
    });
  }

  // ── Phase 4: AI 템플릿 추천 ──

  /** KCD 진단코드 기반 템플릿 추천 */
  async recommendByDiagnosis(diagnosisCodes: string[]) {
    if (!diagnosisCodes?.length) {
      throw new BadRequestException('진단코드를 1개 이상 입력해주세요');
    }

    // 진단코드에서 첫 글자로 진료과 추출
    const departments = new Set<string>();
    for (const code of diagnosisCodes) {
      const firstChar = code.charAt(0).toUpperCase();
      const dept = DIAGNOSIS_DEPT_MAP[firstChar];
      if (dept) departments.add(dept);
    }

    if (departments.size === 0) {
      // 매칭 안 되면 기본 공용 템플릿 반환
      return this.prisma.chartTemplate.findMany({
        where: { isActive: true, isPersonal: false, isDefault: true },
        orderBy: { usageCount: 'desc' },
        take: 5,
      });
    }

    // 매칭된 과의 템플릿 검색
    return this.prisma.chartTemplate.findMany({
      where: {
        isActive: true,
        isPersonal: false,
        department: { in: [...departments] },
      },
      orderBy: [{ isDefault: 'desc' }, { usageCount: 'desc' }],
      take: 10,
    });
  }

  private bumpVersion(v: string): string {
    const parts = v.split('.').map(Number);
    parts[parts.length - 1]++;
    return parts.join('.');
  }
}
