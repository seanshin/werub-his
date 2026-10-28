import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { localeTimeText } from '@hospital-run/shared';

/**
 * 🔴 원장 격리(2026-09-28 · 기획 spatial-flow-vision-3d P4 선행) — 시뮬레이터는 **어떤 실원장에도 쓰지 않는다.**
 *
 * 종전:
 *   ① `start()` 가 `patientLocation.updateMany({ where: { leftAt: null } })` 로 **모든 환자의 현재 위치를 닫았다**
 *      (실제 환자의 "지금 어디 있나"가 시뮬레이션을 누르는 순간 사라진다).
 *   ② 실제 환자 id(시드 환자 30명·입원 환자)로 `journey.emit` — 접수·진료·입원·퇴원·수술 시작을 **그 환자의 여정 원장**
 *      (`patient_journey_events`: 환자 타임라인·환자 앱·여정 관제가 읽는 곳)에 발행했다. 표식(`simulated`)은 위치 원장만 갈랐다.
 * 지금: 상태·지표·최근 이벤트는 이 서비스 메모리에만 있다 · 가상 환자는 이름도 id 도 만들어 쓴다(실제 환자를 빌리지 않는다).
 * 실제 입원 현황은 **읽기만** 한다(병동 초기 점유 — 이름은 싣지 않는다).
 */

interface SimEntity {
  id: string;
  type: 'OUTPATIENT' | 'EMERGENCY' | 'INPATIENT';
  name: string;
  department: string;
  currentStep: string;
  currentZone: string;
  waitUntil: number; // simTime ms
  arrivedAt: number; // simTime ms (도착 — LOS 계산)
  waitingSince: number; // 현재 단계 진입 simTime (현재 대기 산출)
}

// 단계→상태 분류(대기/처리/이동)
const WAITING_STEPS = new Set(['CHECKED_IN', 'WAITING', 'ER_ARRIVED']);
const TREATING_STEPS = new Set(['ER_TREATING', 'TO_LAB', 'TO_IMAGING', 'LAB_DONE']);

interface SimConfig {
  speed: number;
  startTime: string;
  endTime: string;
  patientRate: number;
  emergencyRate: number;
  labProb: number;
  imagingProb: number;
}

@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private simTime = 0;
  private simStartTime = 0;
  private simEndTime = 0;
  private config: SimConfig = { speed: 10, startTime: '08:00', endTime: '18:00', patientRate: 20, emergencyRate: 3, labProb: 0.3, imagingProb: 0.2 };
  private entities = new Map<string, SimEntity>();
  private sessionId = '';
  private eventCount = 0;
  private patientIndex = 0;
  private lastPatientSpawn = 0;
  private lastErSpawn = 0;
  // 처리량·체류시간(LOS) 집계 — 종료(퇴원) 시 누적
  private discharged: Record<string, number> = { OUTPATIENT: 0, EMERGENCY: 0, INPATIENT: 0 };
  private losSumMs: Record<string, number> = { OUTPATIENT: 0, EMERGENCY: 0, INPATIENT: 0 };
  private peakZoneOccupancy = 0;
  private recentEvents: Array<{ eventType: string; title: string; at: string; severity: string; name: string }> = [];

  private departments = ['내과', '외과', '소아청소년과', '산부인과', '정형외과'];

  constructor(private readonly prisma: PrismaService) {}

  async start(opts: Partial<SimConfig> & { patientCount?: number; durationMinutes?: number }) {
    if (this.timer) throw new BadRequestException('시뮬레이션이 이미 실행 중입니다');

    // FE 컨트롤(patientCount·durationMinutes) → config 매핑(종전 무시되던 배선 봉합)
    // undefined 값은 병합 제외 — DTO 인스턴스가 미전송 옵션을 undefined own-prop으로 가져 기본값(startTime 등) 덮어쓰기 방지
    const { patientCount, durationMinutes, ...cfg } = opts;
    for (const [k, v] of Object.entries(cfg)) {
      if (v !== undefined) (this.config as unknown as Record<string, unknown>)[k] = v;
    }
    const durMin = durationMinutes && durationMinutes > 0 ? durationMinutes : undefined;
    if (patientCount && patientCount > 0 && durMin) {
      // 지정 기간 동안 patientCount명 도착하도록 시간당 외래 발생률 산출
      this.config.patientRate = Math.max(1, Math.round((patientCount / durMin) * 60));
    }

    this.sessionId = `sim-${Date.now()}`;
    this.entities.clear();
    this.eventCount = 0;
    this.patientIndex = 0;
    this.discharged = { OUTPATIENT: 0, EMERGENCY: 0, INPATIENT: 0 };
    this.losSumMs = { OUTPATIENT: 0, EMERGENCY: 0, INPATIENT: 0 };
    this.peakZoneOccupancy = 0;
    this.recentEvents = [];

    // 시뮬 시간 설정 (오늘 날짜 + 시작/종료 시간). durationMinutes 지정 시 종료 = 시작 + duration
    const today = new Date();
    const [sh, sm] = this.config.startTime.split(':').map(Number);
    const [eh, em] = this.config.endTime.split(':').map(Number);
    this.simStartTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm).getTime();
    this.simEndTime = durMin
      ? this.simStartTime + durMin * 60000
      : new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em).getTime();
    this.simTime = this.simStartTime;
    this.lastPatientSpawn = this.simTime;
    this.lastErSpawn = this.simTime;

    // 입원 환자 초기 배치
    await this.initInpatients();

    // 타이머 시작 (1초마다 tick)
    this.timer = setInterval(() => this.tick(), 1000);

    this.logger.log(`Simulator started: ${this.sessionId}, speed=${this.config.speed}x`);
    return this.getStatus();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.logger.log(`Simulator stopped: ${this.sessionId}, events=${this.eventCount}`);
    return this.getStatus();
  }

  pause() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    return this.getStatus();
  }

  resume() {
    if (!this.timer && this.sessionId) {
      this.timer = setInterval(() => this.tick(), 1000);
    }
    return this.getStatus();
  }

  setSpeed(speed: number) {
    this.config.speed = Math.max(1, Math.min(100, speed));
    return this.getStatus();
  }

  getStatus() {
    const simDate = new Date(this.simTime);
    return {
      sessionId: this.sessionId,
      status: this.timer ? 'running' : this.sessionId ? 'paused' : 'stopped',
      speed: this.config.speed,
      simulatedTime: localeTimeText(simDate, 'ko-KR', { hour: '2-digit', minute: '2-digit' }),
      simulatedTimestamp: simDate.toISOString(),
      totalEntities: this.entities.size,
      eventCount: this.eventCount,
      progress: this.simEndTime > this.simStartTime
        ? Math.round((this.simTime - this.simStartTime) / (this.simEndTime - this.simStartTime) * 100)
        : 0,
      metrics: this.metrics(),
      recentEvents: this.recentEvents,
      // 화면이 "시뮬레이션은 실원장에 쓰지 않는다"를 말할 근거 — 값이 바뀌면 화면 문구도 바뀌어야 한다
      writesLedger: false as const,
    };
  }

  async injectEvent(type: string, data: { triageLevel?: string; complaint?: string }) {
    if (!this.sessionId) throw new BadRequestException('시뮬레이션을 먼저 시작하세요');
    // FE 이벤트 타입(EMERGENCY_ARRIVAL 등) 전량 처리 — 종전 'emergency'만 처리돼 5/6 무동작이던 것 봉합
    switch ((type || '').toUpperCase()) {
      case 'EMERGENCY_ARRIVAL': case 'EMERGENCY':
        await this.spawnEmergencyPatient(data.triageLevel ?? 'LEVEL_3', data.complaint ?? '시뮬 응급');
        break;
      case 'SCHEDULED_VISIT':
        await this.spawnOutpatient();
        break;
      case 'ADMISSION': {
        // 대기/진료 중 외래 1명을 즉시 입원으로 전환(없으면 새 외래 생성 후)
        const cand = [...this.entities.values()].find((e) => e.type === 'OUTPATIENT');
        if (cand) { cand.type = 'INPATIENT'; cand.currentStep = 'WARD_RESTING'; cand.currentZone = 'F3-301'; cand.waitUntil = this.simTime + this.rand(60, 240) * 60000; await this.emitEvent(cand, 'ADMISSION', '입원(주입)', 'F3-301'); }
        else await this.spawnOutpatient();
        break;
      }
      case 'DISCHARGE': {
        const cand = [...this.entities.values()].find((e) => e.type !== 'INPATIENT');
        if (cand) { await this.emitEvent(cand, 'DISCHARGE', '퇴원(주입)', 'F1-LB'); this.recordExit(cand); }
        break;
      }
      case 'LAB_ORDER': {
        const cand = [...this.entities.values()].find((e) => e.type === 'OUTPATIENT' && e.currentStep === 'WAITING');
        if (cand) { cand.currentStep = 'TO_LAB'; cand.waitUntil = this.simTime; await this.emitEvent(cand, 'ORDER_CREATED', '검사 오더(주입)', 'F2-LAB'); }
        break;
      }
      case 'SURGERY_START': {
        const cand = [...this.entities.values()].find((e) => e.type === 'INPATIENT');
        if (cand) await this.emitEvent(cand, 'SURGERY_START', '수술 시작(주입)', 'F5-OR', 'WARNING');
        break;
      }
    }
    return this.getStatus();
  }

  // ── 엔진 ──

  private async tick() {
    // 시간 진행
    this.simTime += this.config.speed * 60 * 1000; // speed분 진행

    // 종료 체크
    if (this.simTime >= this.simEndTime) {
      this.stop();
      return;
    }

    // 외래 환자 생성
    const msPerPatient = 3600000 / this.config.patientRate;
    while (this.simTime - this.lastPatientSpawn >= msPerPatient) {
      this.lastPatientSpawn += msPerPatient;
      await this.spawnOutpatient();
    }

    // 응급 환자 생성
    const msPerEr = 3600000 / this.config.emergencyRate;
    while (this.simTime - this.lastErSpawn >= msPerEr) {
      this.lastErSpawn += msPerEr;
      const levels = ['LEVEL_2', 'LEVEL_3', 'LEVEL_3', 'LEVEL_4', 'LEVEL_4', 'LEVEL_5'];
      await this.spawnEmergencyPatient(levels[Math.floor(Math.random() * levels.length)], undefined);
    }

    // 각 엔티티 상태 진행
    for (const entity of [...this.entities.values()]) {
      if (entity.waitUntil <= this.simTime) {
        await this.advanceEntity(entity);
      }
    }
  }

  private async spawnOutpatient() {
    const patient = this.nextPatient();

    const dept = this.departments[Math.floor(Math.random() * this.departments.length)];
    const entity: SimEntity = {
      id: `sim-${this.patientIndex}`,
      type: 'OUTPATIENT',
      name: patient.name,
      department: dept,
      currentStep: 'ARRIVED',
      currentZone: 'F1-RC',
      waitUntil: this.simTime,
      arrivedAt: this.simTime,
      waitingSince: this.simTime,
    };
    this.entities.set(entity.id, entity);
    await this.emitEvent(entity, 'RECEPTION_CHECKIN', '접수 완료', 'F1-RC');
    entity.waitUntil = this.simTime + this.rand(2, 5) * 60000;
    entity.currentStep = 'CHECKED_IN';
  }

  private async spawnEmergencyPatient(triageLevel: string, complaint?: string) {
    const patient = this.nextPatient();

    const complaints = ['급성 흉통', '호흡곤란', '급성 복통', '교통사고', '고열', '낙상', '두통'];
    const cc = complaint ?? complaints[Math.floor(Math.random() * complaints.length)];

    const entity: SimEntity = {
      id: `sim-er-${this.patientIndex}`,
      type: 'EMERGENCY',
      name: patient.name,
      department: '응급의학과',
      currentStep: 'ER_ARRIVED',
      currentZone: 'F1-ER',
      waitUntil: this.simTime,
      arrivedAt: this.simTime,
      waitingSince: this.simTime,
    };
    this.entities.set(entity.id, entity);
    await this.emitEvent(entity, 'ER_ARRIVAL', `응급실 도착: ${cc}`, 'F1-ER', 'WARNING');
    await this.emitEvent(entity, 'ER_TRIAGE', `트리아지 ${triageLevel}`, 'F1-ER', triageLevel === 'LEVEL_1' ? 'CRITICAL' : 'WARNING');
    entity.waitUntil = this.simTime + this.rand(30, 120) * 60000;
    entity.currentStep = 'ER_TREATING';
  }

  private async initInpatients() {
    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED' },
      // 🔴 환자 신원은 읽지 않는다 — 병동 초기 점유만 본뜬다
      select: { id: true, bed: { select: { roomNumber: true, ward: { select: { name: true, floor: true } } } } },
      take: 10,
    });

    let n = 0;
    for (const adm of admissions) {
      if (!adm.bed) continue;
      const zoneCode = `F${adm.bed.ward.floor}-${adm.bed.roomNumber.substring(0, 3)}`;
      const entity: SimEntity = {
        id: `sim-inp-${adm.id.substring(0, 8)}`,
        type: 'INPATIENT',
        name: `SIM-IN-${String(++n).padStart(2, '0')}`,
        department: '내과',
        currentStep: 'WARD_RESTING',
        currentZone: zoneCode,
        waitUntil: this.simStartTime + this.rand(30, 90) * 60000, // 회진 시간
        arrivedAt: this.simStartTime,
        waitingSince: this.simStartTime,
      };
      this.entities.set(entity.id, entity);
      await this.emitEvent(entity, 'ROUND', `입원 중 (${adm.bed.ward.name} ${adm.bed.roomNumber})`, zoneCode);
    }
  }

  private async advanceEntity(entity: SimEntity) {
    switch (entity.type) {
      case 'OUTPATIENT': return this.advanceOutpatient(entity);
      case 'EMERGENCY': return this.advanceEmergency(entity);
      case 'INPATIENT': return this.advanceInpatient(entity);
    }
  }

  private async advanceOutpatient(e: SimEntity) {
    switch (e.currentStep) {
      case 'CHECKED_IN': {
        const waitZone = e.department === '내과' ? 'F2-IM-W' : e.department === '외과' ? 'F2-SG-W' : 'F2-IM-W';
        await this.emitEvent(e, 'RECEPTION_CALLED', `${e.department} 대기실 이동`, waitZone);
        e.currentZone = waitZone;
        e.waitUntil = this.simTime + this.rand(10, 30) * 60000;
        e.currentStep = 'WAITING';
        break;
      }
      case 'WAITING': {
        const clinicZone = e.department === '내과' ? 'F2-IM-201' : e.department === '외과' ? 'F2-SG-203' : 'F2-IM-202';
        await this.emitEvent(e, 'ENCOUNTER_START', `${e.department} 진료 시작`, clinicZone);
        e.currentZone = clinicZone;
        e.waitUntil = this.simTime + this.rand(10, 20) * 60000;
        // 다음 단계 결정
        const r = Math.random();
        if (r < this.config.labProb) e.currentStep = 'TO_LAB';
        else if (r < this.config.labProb + this.config.imagingProb) e.currentStep = 'TO_IMAGING';
        else e.currentStep = 'TO_CASHIER';
        break;
      }
      case 'TO_LAB': {
        await this.emitEvent(e, 'ORDER_CREATED', '검사 의뢰', 'F2-LAB');
        e.currentZone = 'F2-LAB';
        e.waitUntil = this.simTime + this.rand(10, 15) * 60000;
        e.currentStep = 'LAB_DONE';
        break;
      }
      case 'TO_IMAGING': {
        await this.emitEvent(e, 'ORDER_CREATED', '영상 의뢰', 'F2-IMG');
        e.currentZone = 'F2-IMG';
        e.waitUntil = this.simTime + this.rand(15, 20) * 60000;
        e.currentStep = 'LAB_DONE'; // same flow back
        break;
      }
      case 'LAB_DONE': {
        const clinicZone = e.department === '내과' ? 'F2-IM-201' : 'F2-SG-203';
        await this.emitEvent(e, 'LAB_RESULT', '검사 결과 확인', clinicZone);
        e.currentZone = clinicZone;
        e.waitUntil = this.simTime + this.rand(5, 10) * 60000;
        e.currentStep = 'TO_CASHIER';
        break;
      }
      case 'TO_CASHIER': {
        await this.emitEvent(e, 'ENCOUNTER_SIGNED', '진료 완료 → 수납', 'F1-CS');
        e.currentZone = 'F1-CS';
        e.waitUntil = this.simTime + this.rand(2, 5) * 60000;
        e.currentStep = 'TO_PHARMACY';
        break;
      }
      case 'TO_PHARMACY': {
        await this.emitEvent(e, 'BILLING_PAID', '수납 완료 → 약국', 'F1-PH');
        e.currentZone = 'F1-PH';
        e.waitUntil = this.simTime + this.rand(5, 10) * 60000;
        e.currentStep = 'DISCHARGED';
        break;
      }
      case 'DISCHARGED': {
        await this.emitEvent(e, 'DISCHARGE', '퇴원', 'F1-LB');
        this.recordExit(e);
        break;
      }
    }
  }

  private async advanceEmergency(e: SimEntity) {
    switch (e.currentStep) {
      case 'ER_TREATING': {
        // 50% 입원, 40% 퇴원, 10% 전원
        const r = Math.random();
        if (r < 0.5) {
          await this.emitEvent(e, 'ER_DISPOSITION', '응급실 → 입원', 'F3-301');
          await this.emitEvent(e, 'ADMISSION', '입원', 'F3-301');
          e.currentZone = 'F3-301';
          e.type = 'INPATIENT';
          e.currentStep = 'WARD_RESTING';
          e.waitUntil = this.simTime + this.rand(60, 240) * 60000;
        } else {
          await this.emitEvent(e, 'ER_DISPOSITION', '응급실 퇴원', 'F1-LB');
          await this.emitEvent(e, 'DISCHARGE', '퇴원', 'F1-LB');
          this.recordExit(e);
        }
        break;
      }
    }
  }

  private async advanceInpatient(e: SimEntity) {
    switch (e.currentStep) {
      case 'WARD_RESTING': {
        // 회진 → 다음 회진까지 대기
        await this.emitEvent(e, 'ROUND', '회진', e.currentZone);
        e.waitUntil = this.simTime + this.rand(120, 360) * 60000;
        break;
      }
    }
  }

  // ── helpers ──

  // 🔴 이름은 종전 그대로(호출부가 많다) — 이제 **메모리 이벤트 버퍼에만** 적는다. 여정·위치 원장에 발행하지 않는다.
  private async emitEvent(entity: SimEntity, eventType: string, title: string, zoneCode: string, severity?: string) {
    void zoneCode;
    this.eventCount++;
    // 최근 이벤트 링버퍼(FE '최근 이벤트' 표시 — 종전 백엔드 미제공이던 것)
    this.recentEvents.unshift({
      eventType, title, severity: severity ?? 'INFO', name: entity.name,
      at: localeTimeText(new Date(this.simTime), 'ko-KR', { hour: '2-digit', minute: '2-digit' }),
    });
    if (this.recentEvents.length > 15) this.recentEvents.pop();
  }

  /** 종료(퇴원) 기록 — 처리량·체류시간(LOS) 누적 후 엔티티 제거 */
  private recordExit(e: SimEntity) {
    this.discharged[e.type] = (this.discharged[e.type] ?? 0) + 1;
    this.losSumMs[e.type] = (this.losSumMs[e.type] ?? 0) + Math.max(0, this.simTime - e.arrivedAt);
    this.entities.delete(e.id);
  }

  /** 운영 지표 산출 — 존 점유·병목·대기/처리 분포·처리량·평균 체류·ER census */
  private metrics() {
    const list = [...this.entities.values()];
    // 존 점유
    const zoneMap = new Map<string, number>();
    for (const e of list) zoneMap.set(e.currentZone, (zoneMap.get(e.currentZone) ?? 0) + 1);
    const zoneOccupancy = [...zoneMap.entries()].map(([zone, count]) => ({ zone, count })).sort((a, b) => b.count - a.count);
    const peak = zoneOccupancy[0]?.count ?? 0;
    if (peak > this.peakZoneOccupancy) this.peakZoneOccupancy = peak;

    // 단계 분포
    let waiting = 0, treating = 0;
    for (const e of list) {
      if (WAITING_STEPS.has(e.currentStep)) waiting++;
      else if (TREATING_STEPS.has(e.currentStep)) treating++;
    }
    // 타입별 active + 체류
    const byType: Record<string, { active: number; discharged: number; avgLosMin: number | null }> = {};
    for (const t of ['OUTPATIENT', 'EMERGENCY', 'INPATIENT']) {
      const active = list.filter((e) => e.type === t).length;
      const dc = this.discharged[t] ?? 0;
      byType[t] = { active, discharged: dc, avgLosMin: dc ? Math.round(this.losSumMs[t] / dc / 60000) : null };
    }
    const activeLosSum = list.reduce((s, e) => s + (this.simTime - e.arrivedAt), 0);
    return {
      zoneOccupancy: zoneOccupancy.slice(0, 12),
      bottleneck: zoneOccupancy[0] ?? null,
      peakZoneOccupancy: this.peakZoneOccupancy,
      waiting, treating,
      erCensus: list.filter((e) => e.type === 'EMERGENCY').length,
      throughput: Object.values(this.discharged).reduce((a, b) => a + b, 0),
      byType,
      avgTimeInSystemMin: list.length ? Math.round(activeLosSum / list.length / 60000) : 0,
    };
  }

  /** 가상 환자 — 실제 환자를 빌리지 않는다(이름·id 모두 만든 것 · 언어 중립 식별자 — 서버가 한국어 이름을 조립하지 않는다) */
  private nextPatient() {
    this.patientIndex++;
    return { name: `SIM-${String(this.patientIndex).padStart(3, '0')}` };
  }

  private rand(min: number, max: number) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }
}
