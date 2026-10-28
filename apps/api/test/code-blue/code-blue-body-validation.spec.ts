/**
 * 🔴 (2026-09-14) 코드블루·RRT 컨트롤러 4곳이 `@Body() body: Record<string, unknown>` 라 ValidationPipe 가 통째로 건너뛰었다
 *    (잘못된 날짜 → Invalid Date 저장 시도 500 · 없는 outcome → Prisma 500 · 제세동 횟수 'abc' → NaN).
 * 지키는 것: ① 빈 본문·잘못된 타입은 400 ② 대조군 — web 화면이 실제로 보내는 모양은 필드 그대로 통과
 *           ③ web `/code-blue` 호출부가 보내는 키가 전부 DTO 에 있다(whitelist 가 조용히 지우지 않게 — 소스 기계 대조)
 *           ④ 서비스가 읽는 `dto.<키>` 가 전부 DTO 에 있다 ⑤ 핸들러 본문이 DTO class 다(Record 로 되돌리면 실패)
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ActivateRrtDto, CreateCodeBlueDto, RespondRrtDto, UpdateCodeBlueDto } from '../../src/modules/code-blue/dto/code-blue.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });
const PID = '00000000-0000-4000-8000-000000000001';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const read = (rel: string) => strip(fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8'));
const props = (cls: Function) =>
  new Set(getMetadataStorage().getTargetValidationMetadatas(cls, '', true, false).map((m) => m.propertyName));

describe('코드블루·RRT 본문 검증', () => {
  it('① 빈 본문·잘못된 타입은 400', async () => {
    await expect(pipe.transform({}, meta(CreateCodeBlueDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ patientId: PID, recognizedAt: '어제' }, meta(CreateCodeBlueDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ outcome: 'ALIVE' }, meta(UpdateCodeBlueDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ defibrillationCount: 'abc' }, meta(UpdateCodeBlueDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ trigger: 'PHONE' }, meta(ActivateRrtDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ outcome: 'HOME' }, meta(RespondRrtDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('② 대조군 — 화면이 보내는 모양은 필드 그대로 통과', async () => {
    const at = '2026-09-14T05:00:00.000Z';
    expect(await pipe.transform({ patientId: PID, location: '5병동', recognizedAt: at, notes: 'x' }, meta(CreateCodeBlueDto)))
      .toMatchObject({ patientId: PID, location: '5병동', recognizedAt: at, notes: 'x' });
    expect(await pipe.transform({ defibrillationCount: 2, endedAt: at, outcome: 'ROSC', notes: '' }, meta(UpdateCodeBlueDto)))
      .toMatchObject({ defibrillationCount: 2, endedAt: at, outcome: 'ROSC', notes: '' });
    expect(await pipe.transform({ patientId: PID, trigger: 'NEWS2', activatedAt: at, reason: 'SpO2' }, meta(ActivateRrtDto)))
      .toMatchObject({ patientId: PID, trigger: 'NEWS2', activatedAt: at, reason: 'SpO2' });
    expect(await pipe.transform({ respondedAt: at, responderTeam: 'RRT-A', outcome: 'WARD_STAY' }, meta(RespondRrtDto)))
      .toMatchObject({ respondedAt: at, responderTeam: 'RRT-A', outcome: 'WARD_STAY' });
  });

  it('③ web /code-blue 호출부가 보내는 키가 전부 DTO 에 있다', () => {
    const page = read('../web/src/app/(main)/code-blue/page.tsx');
    // post('/api/v1/code-blue', {…}) · post('/api/v1/code-blue/rrt', {…}) · patch(`…/code-blue/${…}`, {…}) · patch(`…/rrt/${…}`, {…}) · patch.mutate({ body: {…} })
    const keysIn = (objSrc: string) => [...objSrc.matchAll(/(?:^|[{,]\s*)(?:\.\.\.\([^)]*\{\s*)?([A-Za-z_]\w*)\s*[:,}]/g)].map((m) => m[1]);
    const grab = (re: RegExp) => [...page.matchAll(re)].flatMap((m) => keysIn(m[1]));
    // 본문 객체는 `});` 에서 끝난다(중첩 `{ outcome }` 전개를 넘기 위해 호출 종료까지 잡는다)
    const createKeys = grab(/apiClient\.post\('\/api\/v1\/code-blue',\s*(\{[\s\S]*?\})\s*\);/g);
    const rrtKeys = grab(/apiClient\.post\('\/api\/v1\/code-blue\/rrt',\s*(\{[\s\S]*?\})\s*\);/g);
    const updKeys = [
      ...grab(/apiClient\.patch\(`\/api\/v1\/code-blue\/\$\{ev\.id\}`,\s*(\{[\s\S]*?\})\s*\);/g),
      ...grab(/body:\s*(\{[^}]*\})/g),
    ];
    const respKeys = grab(/apiClient\.patch\(`\/api\/v1\/code-blue\/rrt\/\$\{row\.id\}`,\s*(\{[\s\S]*?\})\s*\);/g);
    // 표본이 0 이면 아래 대조는 빈 검사다
    expect(createKeys.length && rrtKeys.length && updKeys.length && respKeys.length, JSON.stringify({ createKeys, rrtKeys, updKeys, respKeys })).toBeTruthy();
    const missing = [
      ...createKeys.filter((k) => !props(CreateCodeBlueDto).has(k)).map((k) => `create:${k}`),
      ...rrtKeys.filter((k) => !props(ActivateRrtDto).has(k)).map((k) => `rrt:${k}`),
      ...updKeys.filter((k) => !props(UpdateCodeBlueDto).has(k)).map((k) => `update:${k}`),
      ...respKeys.filter((k) => !props(RespondRrtDto).has(k)).map((k) => `respond:${k}`),
    ];
    expect(missing, '화면이 보내는데 DTO 에 없는 키(whitelist 가 지운다)').toEqual([]);
  });

  it('④ 서비스가 읽는 dto.<키> 가 전부 DTO 에 있다', () => {
    const svc = read('src/modules/code-blue/code-blue.service.ts');
    const body = (name: string) => {
      const i = svc.indexOf(`async ${name}(`);
      const j = svc.indexOf('\n  async ', i + 10);
      return svc.slice(i, j < 0 ? undefined : j);
    };
    const used = (name: string) => new Set([...body(name).matchAll(/dto\.(\w+)/g)].map((m) => m[1]));
    const loopKeys = ['teamArrivedAt', 'cprStartedAt', 'roscAt', 'endedAt']; // updateCodeBlue 의 `dto[f]` 루프
    const cases: [string, Function, string[]][] = [
      ['createCodeBlue', CreateCodeBlueDto, []],
      ['updateCodeBlue', UpdateCodeBlueDto, loopKeys],
      ['activateRrt', ActivateRrtDto, []],
      ['respondRrt', RespondRrtDto, []],
    ];
    for (const [name, cls, extra] of cases) {
      const keys = [...used(name), ...extra];
      expect(keys.length, `${name} 에서 dto 키를 못 읽었다(스캔이 죽었다)`).toBeGreaterThan(0);
      expect(keys.filter((k) => !props(cls).has(k)), name).toEqual([]);
    }
  });

  it('⑤ 핸들러 본문이 DTO class 다', () => {
    const ctrl = read('src/modules/code-blue/code-blue.controller.ts');
    const bodyType = (m: string) => ctrl.match(new RegExp(`async ${m}\\([^{]*?@Body\\(\\)\\s*\\w+:\\s*(\\w+)`))?.[1] ?? null;
    expect(bodyType('create')).toBe(CreateCodeBlueDto.name);
    expect(bodyType('update')).toBe(UpdateCodeBlueDto.name);
    expect(bodyType('activateRrt')).toBe(ActivateRrtDto.name);
    expect(bodyType('respondRrt')).toBe(RespondRrtDto.name);
    expect(ctrl).not.toMatch(/@Body\(\)\s*\w+:\s*Record</);
  });
});
