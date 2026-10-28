/**
 * 대화 원문을 AI 서버로 보내기 전에 지울 **아는 이름**을 세션에서 모은다(§13.2 P0-3 · D5).
 *
 * 🔴 정본 `redactForAiEgress` 는 **호출부가 준 이름만** 지운다(추측 금지). 그래서 "누구의 대화인가"를
 *    아는 것은 여기 — `ScribeSession.patientId`·`doctorId` — 의 몫이다.
 * 🔴 조회 실패를 "이름 없음"으로 번역하지 않는다. 환자·의사 행이 없으면 **던진다**(`EgressNamesUnavailableError`) —
 *    호출부는 그 사실을 응답에 실어 화면이 말하게 하고, **비식별 없이 보내지 않는다**.
 *    (`.catch(() => [])` 로 접으면 대화가 실명 그대로 나간다 — 실패를 없음으로 번역하는 바로 그 코드다.)
 */
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

export class EgressNamesUnavailableError extends Error {
  readonly code = 'SCRIBE_EGRESS_NAMES_UNAVAILABLE' as const;
  constructor(readonly missing: ('patient' | 'doctor')[]) {
    super(`egress names unavailable: ${missing.join(',')}`);
    this.name = 'EgressNamesUnavailableError';
  }
}

export interface EgressNames {
  /** 환자 표기 전부(성명·띄어쓴 성명·한글 호칭·이름만) — 대화에서 실제로 불리는 형태들 */
  patientNames: string[];
  /** 의료진 표기 전부 */
  staffNames: string[];
  /** 병원 발급 번호(MRN) */
  recordNumbers: string[];
  /** 되돌릴 정본 표기(성+이름) — 여러 표기가 한 사람임을 호출부가 안다 */
  rehydrateTo: { patient: string; staff: string };
}

/** 한 사람의 표기 변형 — 2글자 미만은 정본이 어차피 버린다(오탐) */
function variants(familyName: string | null | undefined, givenName: string | null | undefined, extra?: string | null): string[] {
  const f = (familyName ?? '').trim();
  const g = (givenName ?? '').trim();
  const out = new Set<string>();
  if (f || g) out.add(`${f}${g}`);
  if (f && g) out.add(`${f} ${g}`);
  if (g) out.add(g); // "철수 씨" — 대화에서는 이름만 불린다
  if (extra?.trim()) out.add(extra.trim());
  return [...out].filter((v) => v.length >= 2);
}

type PrismaLike = Pick<PrismaService, 'patient' | 'user'>;

export async function loadEgressNames(
  prisma: PrismaLike,
  ids: { patientId: string; doctorId: string },
): Promise<EgressNames> {
  const [patient, doctor] = await Promise.all([
    prisma.patient.findUnique({
      where: { id: ids.patientId },
      select: { familyName: true, givenName: true, koreanName: true, mrn: true },
    }),
    prisma.user.findUnique({
      where: { id: ids.doctorId },
      select: { familyName: true, givenName: true },
    }),
  ]);
  const missing: ('patient' | 'doctor')[] = [];
  if (!patient) missing.push('patient');
  if (!doctor) missing.push('doctor');
  if (!patient || !doctor) throw new EgressNamesUnavailableError(missing);
  return {
    patientNames: variants(patient.familyName, patient.givenName, patient.koreanName),
    staffNames: variants(doctor.familyName, doctor.givenName),
    recordNumbers: patient.mrn ? [patient.mrn] : [],
    rehydrateTo: {
      patient: `${(patient.familyName ?? '').trim()}${(patient.givenName ?? '').trim()}`,
      staff: `${(doctor.familyName ?? '').trim()}${(doctor.givenName ?? '').trim()}`,
    },
  };
}
