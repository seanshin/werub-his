/**
 * 외부 시스템이 보낸 `subject: Patient/<ref>` 해소 정본 — 내부 UUID 또는 차트번호(MRN).
 *
 * 🔴 LIS 는 유입 시 환자 식별자를 **MRN 우선**으로 잡는다. 수신부가 UUID 만 받으면 두 가지가 갈린다:
 *    reflex 수신은 "없는 환자"로 거절했고, 결과 수신은 subject 를 **없는 것으로 보고**
 *    오더 환자 == subject 대조를 건너뛰어 basedOn 만으로 결속했다.
 *    같은 식별자에 수신부 둘이 다르게 반응하지 않도록 여기 하나로 푼다.
 *
 * 세 상태를 구분한다 — `absent`(보내지 않음) · `resolved` · `unresolved`(보냈는데 못 찾음).
 * 🔴 `unresolved` 를 `absent` 로 접지 않는다. 대조할 수 없는 것을 "대조할 필요 없음"으로 말하게 된다.
 * 이름 매칭은 하지 않는다(연동 규칙).
 */
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

export type PatientRefResolution =
  | { kind: 'absent' }
  | { kind: 'resolved'; patientId: string }
  | { kind: 'unresolved'; raw: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePatientRef(
  prisma: Pick<PrismaService, 'patient'>,
  reference: unknown,
): Promise<PatientRefResolution> {
  const raw = String(reference ?? '').replace(/^Patient\//, '').trim();
  if (!raw) return { kind: 'absent' };
  const patient = UUID_RE.test(raw)
    ? await prisma.patient.findUnique({ where: { id: raw }, select: { id: true } })
    : await prisma.patient.findFirst({ where: { mrn: raw }, select: { id: true } });
  return patient ? { kind: 'resolved', patientId: patient.id } : { kind: 'unresolved', raw };
}
