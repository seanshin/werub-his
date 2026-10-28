/**
 * 데모 환자 이동 계획(2026-10-09) — **업무 원장의 지금 상태**에서 시뮬레이션 위치를 정한다(순수 함수).
 *
 * 🔴 실제 위치가 아니다 — 출처 SIMULATED 로만 쓰고, 화면이 "시뮬레이션"이라고 말한다. 실시간 실제 위치는 관측(QR 체크인·
 *    검진 스테이션·RTLS)이 있어야 한다.
 * 🔴 원장과 모순되게 놓지 않는다 — 대기 중인 환자를 진료실에, 퇴원한 환자를 병동에 두지 않는다.
 *    대기열 상태가 '대기'이면 접수·대기실(일부는 진료 전 검사)까지만, '진료 중'이면 그 진료실, 수납이 끝나면 떠난다.
 * 시간이 흐르면 위치가 바뀐다(접수 → 대기실 → 진료 전 검사 → 대기실 · 진료 뒤 수납 → 약국 → 떠남) — 실제 업무가
 * 상태를 바꾸면(호출·진료 시작·퇴원) 다음 주기에 따라간다.
 */

export interface ZoneRef { id: string; floor: number | null; spaceType: string; department: string | null; code: string | null }

export interface MovementInput {
  now: Date;
  zones: ZoneRef[];
  /** 진료실 이름 → 도면 구역 id(ClinicRoom) */
  clinicRoomZone: Map<string, string>;
  queue: Array<{ patientId: string; status: string; roomName: string | null; departmentName: string; checkedInAt: Date; completedAt: Date | null }>;
  inpatients: Array<{ patientId: string; wardFloor: number | null; roomNumber: string | null }>;
  er: Array<{ patientId: string }>;
  surgeries: Array<{ patientId: string }>;
  pacu: Array<{ patientId: string }>;
}

export interface PlannedPosition { zoneId: string; status: string; reason: string }

/** 결정적 해시(같은 환자는 같은 갈래를 탄다) */
export function demoHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const pickBy = (list: ZoneRef[], key: string): ZoneRef | null => (list.length ? list[demoHash(key) % list.length] : null);

export function planDemoPositions(input: MovementInput): Map<string, PlannedPosition> {
  const out = new Map<string, PlannedPosition>();
  const of = (type: string, floor?: number | null) => input.zones.filter((z) => z.spaceType === type && (floor == null || z.floor === floor));
  const anyOf = (type: string, preferFloor: number | null, key: string) => pickBy(of(type, preferFloor), key) ?? pickBy(of(type), key);
  const zoneFloor = new Map(input.zones.map((z) => [z.id, z.floor]));
  const set = (pid: string, z: ZoneRef | null, status: string, reason: string) => {
    if (z && !out.has(pid)) out.set(pid, { zoneId: z.id, status, reason });
  };

  // 우선순위 — 수술 중 > 회복실 > 응급 > 입원 > 외래(한 환자는 한 곳)
  for (const s of input.surgeries) set(s.patientId, anyOf('SURGERY', 1, s.patientId), 'in-surgery', 'SURGERY_IN_PROGRESS');
  for (const p of input.pacu) set(p.patientId, anyOf('RECOVERY', 1, p.patientId), 'in-recovery', 'PACU_ACTIVE');
  for (const e of input.er) set(e.patientId, anyOf('ER', 1, e.patientId), 'in-er', 'ER_ACTIVE');
  for (const a of input.inpatients) {
    if (a.wardFloor == null) continue; // 병동 층을 모르면 놓지 않는다(지어내지 않는다)
    set(a.patientId, pickBy(of('WARD_ROOM', a.wardFloor), `${a.patientId}:${a.roomNumber ?? ''}`), 'admitted', 'INPATIENT');
  }

  for (const q of input.queue) {
    const m = (input.now.getTime() - q.checkedInAt.getTime()) / 60000;
    const roomZone = q.roomName ? input.clinicRoomZone.get(q.roomName) ?? null : null;
    const clinicFloor = roomZone ? zoneFloor.get(roomZone) ?? null : 2;
    const waiting = () => {
      const onFloor = of('WAITING', clinicFloor);
      const sameDept = onFloor.filter((z) => z.department && z.department === q.departmentName);
      return pickBy(sameDept.length ? sameDept : onFloor, q.patientId) ?? pickBy(of('WAITING'), q.patientId);
    };
    if (q.status === 'WAITING' || q.status === 'CALLED') {
      if (m < 0) continue; // 미래 접수(시각 오류)는 놓지 않는다
      if (m < 5 && q.status === 'WAITING') { set(q.patientId, anyOf('RECEPTION', 1, q.patientId), 'reception', 'QUEUE_JUST_CHECKED_IN'); continue; }
      // 진료 전 검사 — 넷 중 하나가 접수 15~30분에 검사실을 다녀온다(대기 상태와 모순되지 않는 이동)
      if (q.status === 'WAITING' && demoHash(q.patientId) % 4 === 0 && m >= 15 && m < 30) {
        set(q.patientId, anyOf('LAB', clinicFloor, q.patientId), 'in-lab', 'QUEUE_PRE_VISIT_TEST');
        continue;
      }
      set(q.patientId, waiting(), 'waiting', q.status === 'CALLED' ? 'QUEUE_CALLED' : 'QUEUE_WAITING');
    } else if (q.status === 'IN_PROGRESS') {
      const z = roomZone ? input.zones.find((x) => x.id === roomZone) ?? null : null;
      set(q.patientId, z ?? waiting(), z ? 'in-treatment' : 'waiting', z ? 'QUEUE_IN_PROGRESS' : 'QUEUE_IN_PROGRESS_NO_ROOM_LINK');
    } else if (q.status === 'COMPLETED' && q.completedAt) {
      const after = (input.now.getTime() - q.completedAt.getTime()) / 60000;
      if (after >= 0 && after < 15) set(q.patientId, anyOf('CASHIER', 1, q.patientId), 'checkout', 'QUEUE_COMPLETED_CASHIER');
      else if (after >= 15 && after < 30) set(q.patientId, anyOf('PHARMACY', 1, q.patientId), 'pharmacy', 'QUEUE_COMPLETED_PHARMACY');
      // 30분 뒤엔 떠났다고 본다 — 위치를 두지 않는다
    }
  }
  return out;
}
