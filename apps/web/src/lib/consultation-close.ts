/**
 * 협진 종결 버튼을 누구에게 보이는가(2026-10-10) — 서버 `ConsultationService.close` 와 같은 규칙.
 * 의뢰한 의사 · 수신자(지정의 본인, 미지정이면 수신 과 소속 의사) · 관리자.
 * 🔴 종전엔 회신된 협진이면 누구에게나(간호사 포함) 버튼을 그렸고, 서버가 막으면 아무 말 없이 실패했다.
 */
export function canCloseConsult(
  c: { requestingDoctorId?: string | null; toDoctorId?: string | null; toDepartment?: string | null },
  user: { id?: string | null; role?: string | null; department?: string | null } | null | undefined,
): boolean {
  if (!user?.id || !user.role) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'DOCTOR') return false;
  if (c.requestingDoctorId === user.id) return true;
  if (c.toDoctorId) return c.toDoctorId === user.id;
  return !!c.toDepartment && c.toDepartment === user.department;
}

/**
 * 회신을 쓸 수 있는가(2026-10-10) — 서버 `ConsultationService.assertRecipient` 와 같은 규칙.
 * 관리자 · 지정의 본인 · 미지정이면 수신 과 소속. 의뢰한 의사라는 이유만으로는 회신하지 않는다.
 * 회신은 열린 협진(REQUESTED·ACCEPTED)에만.
 */
export function canReplyConsult(
  c: { status?: string | null; toDoctorId?: string | null; toDepartment?: string | null },
  user: { id?: string | null; role?: string | null; department?: string | null } | null | undefined,
): boolean {
  if (!user?.id || !user.role) return false;
  if (c.status !== 'REQUESTED' && c.status !== 'ACCEPTED') return false;
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'DOCTOR') return false;
  if (c.toDoctorId) return c.toDoctorId === user.id;
  return !!c.toDepartment && c.toDepartment === user.department;
}
