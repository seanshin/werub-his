import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException, RequestMethod } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { WorkstationSetupService } from '../../src/modules/workstation-setup/workstation-setup.service';
import { WorkstationSetupController } from '../../src/modules/workstation-setup/workstation-setup.controller';
import { SetStationOrderCodesDto } from '../../src/modules/workstation-setup/dto/workstation-setup.dto';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

/**
 * S9 — 검사·영상 워크스테이션 배너가
 * "이 설정을 고칠 화면은 아직 없습니다"라고 말했고, 그 말이 사실이었다
 * (`workstation_configs.order_codes` 를 쓰는 EP 가 기초검사 자리에만 있었다).
 *
 * 계약:
 *  ① 조회는 **큐와 같은 대조**를 돌려준다 — 여기서 "맞음"이면 큐도 그 코드로 거른다(P12).
 *  ② 마스터에 없는 코드는 **막지 않는다**(원내 코드 선등록 전 강제 → 거짓 데이터) — 무엇이 안 맞는지 보인다.
 *  ③ 기초검사 자리는 어휘가 달라(검사 종류) 대조도·덮어쓰기도 하지 않는다.
 */

// 수가 마스터 — 같은 code 가 두 행(버전)인 경우를 일부러 남긴다
const MASTER = [
  { code: 'E6591', nameKo: '당화혈색소' },
  { code: 'E6591', nameKo: '당화혈색소(구)' },
  { code: 'HA441', nameKo: '흉부 일반촬영' },
];

function makePrisma(station: Record<string, unknown> | null) {
  const state = { station };
  return {
    state,
    workstationConfig: {
      findUnique: vi.fn(async () => state.station),
      update: vi.fn(async ({ data }: { data: { orderCodes: unknown } }) => {
        state.station = { ...(state.station as object), orderCodes: data.orderCodes };
        return state.station;
      }),
    },
    // 🔴 목은 정본의 실제 반환 모양 — where.code.in 으로 거르고 select 한 필드만 준다
    procedureCode: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        MASTER.filter((m) => where.code.in.includes(m.code)).map((m) => ({ code: m.code, nameKo: m.nameKo }))),
    },
  };
}

const imaging = { stationId: 'img-xray', label: '일반촬영', category: 'IMAGING', department: 'IMAGING', orderCodes: ['CXR', 'HA441'] };
const diag = { stationId: 'diag-ekg', label: '심전도실', category: 'DIAGNOSTIC', department: 'DIAG', orderCodes: ['EKG'] };

describe('논리 스테이션 검사항목 설정(S9)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: WorkstationSetupService;

  beforeEach(() => {
    prisma = makePrisma({ ...imaging });
    svc = new WorkstationSetupService(prisma as never);
  });

  it('조회 — 마스터 일치/불일치를 가른다(같은 code 여러 행은 하나로)', async () => {
    const r = await svc.getStationOrderCodes('img-xray');
    expect(r.orderCodes).toEqual(['CXR', 'HA441']);
    expect(r.matched).toEqual([{ code: 'HA441', nameKo: '흉부 일반촬영' }]);
    expect(r.unknownCodes).toEqual(['CXR']);
    expect(r.usesProcedureCodes).toBe(true);
  });

  it('🔴 조회 대조 = 큐 대조 — 관리 화면이 "일치"라 하는 코드를 큐 건강도도 일치로 센다', async () => {
    prisma.state.station = { ...imaging, orderCodes: ['E6591', 'CBC'] };
    const editor = await svc.getStationOrderCodes('img-xray');
    const health = await new WorkstationService(prisma as never).getStationConfigHealth('img-xray');
    expect(editor.matched.map((m) => m.code)).toEqual(['E6591']);
    expect(health.matchedCodes).toBe(editor.matched.length);
    expect(health.configMismatch).toBe(false);
  });

  it('저장 — 공백·중복만 정리하고 마스터에 없는 코드도 막지 않는다', async () => {
    const r = await svc.setStationOrderCodes('img-xray', [' E6591 ', 'E6591', '', 'LOCAL-01']);
    expect(prisma.workstationConfig.update).toHaveBeenCalledWith({
      where: { stationId: 'img-xray' },
      data: { orderCodes: ['E6591', 'LOCAL-01'] },
    });
    expect(r.matched.map((m) => m.code)).toEqual(['E6591']);
    expect(r.unknownCodes).toEqual(['LOCAL-01']);
  });

  it('🔴 기초검사 자리 — 수가 마스터로 대조하지 않고(거짓 경고) 덮어쓰지도 않는다', async () => {
    prisma.state.station = { ...diag };
    const r = await svc.getStationOrderCodes('diag-ekg');
    expect(r.usesProcedureCodes).toBe(false);
    expect(r.unknownCodes).toBeNull();
    expect(prisma.procedureCode.findMany).not.toHaveBeenCalled();
    await expect(svc.setStationOrderCodes('diag-ekg', ['E6591'])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.workstationConfig.update).not.toHaveBeenCalled();
  });

  it('없는 스테이션은 404', async () => {
    prisma.state.station = null;
    await expect(svc.getStationOrderCodes('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setStationOrderCodes('nope', ['E6591'])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DTO 는 class — ValidationPipe 가 실제로 검사한다(배열 아님·빈 문자열 거부)', async () => {
    const bad1 = await validate(plainToInstance(SetStationOrderCodesDto, { orderCodes: 'E6591' }));
    const bad2 = await validate(plainToInstance(SetStationOrderCodesDto, { orderCodes: [''] }));
    const ok = await validate(plainToInstance(SetStationOrderCodesDto, { orderCodes: ['E6591', 'LOCAL-01'] }));
    expect(bad1.length).toBeGreaterThan(0);
    expect(bad2.length).toBeGreaterThan(0);
    expect(ok).toEqual([]); // 대조군 — 정상 입력은 통과
  });

  it('EP — GET/PUT logical-stations/:stationId/order-codes · ADMIN 전용', () => {
    const proto = WorkstationSetupController.prototype as unknown as Record<string, object>;
    const get = proto.getStationOrderCodes;
    const put = proto.setStationOrderCodes;
    expect(Reflect.getMetadata(PATH_METADATA, get)).toBe('logical-stations/:stationId/order-codes');
    expect(Reflect.getMetadata(METHOD_METADATA, get)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, put)).toBe('logical-stations/:stationId/order-codes');
    expect(Reflect.getMetadata(METHOD_METADATA, put)).toBe(RequestMethod.PUT);
    expect(Reflect.getMetadata(ROLES_KEY, get)).toEqual([UserRole.ADMIN]);
    expect(Reflect.getMetadata(ROLES_KEY, put)).toEqual([UserRole.ADMIN]);
  });
});
