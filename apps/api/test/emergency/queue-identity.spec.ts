import { describe, it, expect, vi } from 'vitest';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';

/**
 * 응급실 대기열 신원 계약 — 2026-08-12 (화면 점검 W1 · 패턴 P11).
 *
 * 🔴 응급실 워크리스트에 **환자 이름이 통째로 없었다.** KTAS 1 '급성 심근경색 의심' 카드에
 *    주소증만 있고 누구인지 알 수 없었다(운영 실측 96건 전부).
 *    서버는 `patientName`(문자열 하나)를 주는데 화면은 `patient.familyName` 을 읽었고,
 *    `?? ''` 폴백이라 **에러 없이 빈 칸**이 됐다.
 *
 * 응급실은 동명이인·신원미상이 실제로 발생한다 → 이름과 **MRN 을 함께** 준다.
 * 이름이 없으면 빈 문자열이 아니라 `(신원 미상)` 이라고 말한다.
 */

function svc(patient: Record<string, unknown>) {
  const prisma = {
    emergencyVisit: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'v1',
          patientId: 'p1',
          patient,
          chiefComplaint: '흉통',
          triageLevel: 'LEVEL_1',
          arrivalAt: new Date('2026-08-12T00:00:00Z'),
          disposition: 'DISCHARGE',
        },
      ]),
    },
  };
  return new EmergencyService(prisma as never);
}

describe('응급실 대기열 — 환자 신원', () => {
  it('🔴 이름·MRN·도착시각을 모두 준다(하나라도 빠지면 환자를 특정할 수 없다)', async () => {
    const [item] = await svc({ familyName: '김', givenName: '영수', mrn: 'P2026-0001' }).getEmergencyQueue();
    expect(item.patientName).toBe('김영수');
    expect(item.mrn).toBe('P2026-0001');
    expect(item.arrivalAt).toBeInstanceOf(Date);
    expect(typeof item.waitingMinutes).toBe('number');
  });

  it('🔴 이름이 없으면 빈 문자열이 아니라 "(신원 미상)" — 무명 카드를 만들지 않는다', async () => {
    const [item] = await svc({ familyName: null, givenName: null, mrn: 'UNK-001' }).getEmergencyQueue();
    expect(item.patientName).toBe('(신원 미상)');
    expect(item.mrn).toBe('UNK-001');
  });

  it('🔴 처분(disposition)을 함께 준다 — 없으면 화면이 완료 환자를 전부 대기로 센다', async () => {
    const [item] = await svc({ familyName: '김', givenName: '영수', mrn: 'M1' }).getEmergencyQueue();
    expect(item.disposition, '이 값이 없어 미종결 4건이 "대기 96명"으로 보였다').toBe('DISCHARGE');
  });

  it('성만 있어도 그 성을 쓴다(미상으로 뭉개지 않는다)', async () => {
    const [item] = await svc({ familyName: '김', givenName: null, mrn: 'M1' }).getEmergencyQueue();
    expect(item.patientName).toBe('김');
  });
});
