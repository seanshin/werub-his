import { PrismaService } from '../infrastructure/prisma/prisma.service';

/**
 * 전문과 '오늘 현황' 정본 (2026-08-13 · 화면 점검 W4)
 *
 * 🔴 12개 전문과 화면의 상단 4타일과 '오늘 환자 목록'이 **쿼리가 아니라 서버 리터럴**이었다:
 *    `async getToday() { return []; }` · `{ todayAppointments: 0, completed: 0, inProgress: 0, waiting: 0 }`.
 *    오늘 내과 5건·정형 1·소아 1·정신 1·비뇨 1의 실예약이 있는데 전 과가 "오늘 예약 0 /
 *    오늘 예약된 환자가 없습니다"라고 말했다. 표본 부재가 아니라 **재본 적이 없는 값을 0이라 단정**한 것(P1-ⓐ).
 *
 * 🔴 라벨과 데이터원을 먼저 일치시킨다 — 화면이 묻는 것은 "오늘 예약/완료/진행/대기"이므로
 *    정본은 **Appointment**(진료 이력·시술 기록이 아니다). 종전 일부 과가 시술 기록을 '오늘 예약'으로
 *    표시해 40일 전 분만이 오늘 예약으로 뜨는 사고가 있었다 — 그 형태를 12과에 복제하지 않는다.
 */

/** 전문과 key → 의사 진료과(department) 이름. 별칭 포함(정본: specialty-counts 와 동일 어휘) */
export const SPECIALTY_DEPARTMENTS: Record<string, string[]> = {
  'internal-medicine': ['내과', '혈액종양내과', '가정의학과'],
  dental: ['치과'],
  ophthalmology: ['안과'],
  dermatology: ['피부과'],
  ent: ['이비인후과'],
  orthopedics: ['정형외과'],
  obgyn: ['산부인과'],
  pediatrics: ['소아청소년과'],
  psychiatry: ['정신건강의학과', '정신과'],
  neurosurgery: ['신경외과'],
  plastic: ['성형외과'],
  urology: ['비뇨의학과', '비뇨기과'],
  rehab: ['재활의학과'],
  radiation: ['방사선종양학과', '치료실(방사선)', '치료실(항암)'],
  dialysis: ['투석실', '치료실(투석)'],
};

export interface SpecialtyTodayStats {
  todayAppointments: number;
  completed: number;
  inProgress: number;
  waiting: number;
  /**
   * 🔴 노쇼는 목록·총계(`todayAppointments`)에는 들어가는데 완료·진행·대기 어디에도 없어
   *    화면이 "예약 1 / 완료 0 / 진행 0 / 대기 0" 을 그렸다 — 의사는 "아직 안 왔다(=곧 온다)"로 읽지만
   *    사실은 **이미 노쇼 확정**이다. 칸을 만들어 4칸 합 + 노쇼 = 총계가 되게 한다.
   */
  noShow: number;
}

function todayRangeKst(): { start: Date; end: Date } {
  // 컨테이너 OS 는 UTC 이고 pm2 TZ 가 KST 를 준다 — 로컬 자정 기준(기존 대시보드 규약과 동일)
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** 오늘 예약 목록 — 화면이 읽는 필드(patient·scheduledAt·status·reason)를 그대로 담는다 */
export async function specialtyTodayList(prisma: PrismaService, key: string, take = 100) {
  const departments = SPECIALTY_DEPARTMENTS[key];
  if (!departments?.length) return [];
  const { start, end } = todayRangeKst();
  return prisma.appointment.findMany({
    where: {
      scheduledAt: { gte: start, lt: end },
      status: { not: 'CANCELLED' },
      doctor: { department: { in: departments } },
    },
    orderBy: { scheduledAt: 'asc' },
    take,
    select: {
      id: true, scheduledAt: true, status: true, reason: true, type: true,
      patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
    },
  });
}

/** 오늘 현황 집계 — 목록과 **같은 모수**에서 센다(KPI > 목록 어긋남 방지) */
export async function specialtyTodayStats(prisma: PrismaService, key: string): Promise<SpecialtyTodayStats> {
  const departments = SPECIALTY_DEPARTMENTS[key];
  if (!departments?.length) return { todayAppointments: 0, completed: 0, inProgress: 0, waiting: 0, noShow: 0 };
  const { start, end } = todayRangeKst();
  const rows = await prisma.appointment.groupBy({
    by: ['status'],
    _count: { _all: true },
    where: {
      scheduledAt: { gte: start, lt: end },
      status: { not: 'CANCELLED' },
      doctor: { department: { in: departments } },
    },
  });
  const by = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return {
    todayAppointments: rows.reduce((n, r) => n + r._count._all, 0),
    completed: by('COMPLETED'),
    inProgress: by('IN_PROGRESS'),
    // 대기 = 아직 진료 전(예약·확정·접수) — 노쇼는 대기가 아니다
    waiting: by('SCHEDULED') + by('CONFIRMED') + by('CHECKED_IN'),
    noShow: by('NO_SHOW'),
  };
}

/**
 * 전문과 '기록이 있는 환자' 목록 정본 (2026-10-10).
 *
 * 🔴 14개 전문과의 `GET <과>/patients` 가 **그 과 기록 표 전체 행**을 `findMany`(상한 없음)로 읽어
 *    메모리에서 환자별로 접었다 — 기록이 쌓일수록 응답이 끝없이 커지고, 산부인과만 `take: 2000`(행)으로
 *    **말없이** 잘랐다(2,000행 밖의 환자는 목록에서 그냥 사라졌다).
 *    → 환자별 마지막 기록 시각으로 묶어(`groupBy`) 최근 순 `limit` 명만 돌려주고, 전체 환자 수와 잘림을 함께 말한다.
 */
export const SPECIALTY_PATIENT_LIMIT = 100;

export interface SpecialtyPatientRow {
  patientId: string;
  familyName: string | null;
  givenName: string | null;
  mrn: string | null;
  lastDate: Date;
}

export interface SpecialtyPatientPage<T extends SpecialtyPatientRow = SpecialtyPatientRow> {
  items: T[];
  /** 그 과에 기록이 있는 환자 전체 수(잘리기 전) */
  total: number;
  limit: number;
  truncated: boolean;
}

/**
 * @param groupBy 그 과 기록 표의 groupBy(`(a) => prisma.neuroExam.groupBy(a as never)`)
 * @param dateField 기록 시각 칸(examinedAt·measuredAt 등)
 */
export async function specialtyRecordPatients(
  prisma: PrismaService,
  groupBy: (args: object) => Promise<unknown>,
  dateField: string,
  limit = SPECIALTY_PATIENT_LIMIT,
): Promise<SpecialtyPatientPage> {
  const groups = (await groupBy({
    by: ['patientId'],
    _max: { [dateField]: true },
    orderBy: { _max: { [dateField]: 'desc' } },
  })) as Array<{ patientId: string; _max: Record<string, Date | null> }>;
  const page = groups.slice(0, limit);
  const patients = page.length
    ? await prisma.patient.findMany({
        where: { id: { in: page.map((g) => g.patientId) } },
        select: { id: true, familyName: true, givenName: true, mrn: true },
      })
    : [];
  const byId = new Map(patients.map((p) => [p.id, p]));
  const items: SpecialtyPatientRow[] = [];
  for (const g of page) {
    const p = byId.get(g.patientId);
    const last = g._max?.[dateField];
    if (!p || !last) continue; // 환자 행이 없거나 시각이 없는 묶음은 지어내지 않는다
    items.push({ patientId: p.id, familyName: p.familyName, givenName: p.givenName, mrn: p.mrn, lastDate: last });
  }
  return { items, total: groups.length, limit, truncated: groups.length > limit };
}

/** 컨트롤러 응답 모양 — `data` 는 종전과 같은 배열(소비처 호환) · 잘림은 `meta` */
export function specialtyPatientResponse<T extends SpecialtyPatientRow>(page: SpecialtyPatientPage<T>) {
  return { data: page.items, meta: { total: page.total, limit: page.limit, truncated: page.truncated } };
}
