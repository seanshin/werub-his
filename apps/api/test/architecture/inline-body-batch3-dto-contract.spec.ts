/**
 * 🔴 (2026-09-15 U2) 인라인 @Body 3차 배치 24 핸들러 → class DTO 계약.
 * 수련(로그북·EPA·로테이션·증례) 4 · 감염관리(KONIS 보고·손위생·격리 해제) 3 · GLD(위원회·위원·회의·정책) 7 · 임상연구·IRB 10.
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 잘못된 본문 400(종전 Prisma 500·NaN 응답)  ② 대조군 — 화면이 실제로 보내는 모양은 통과·키 보존
 *  ③ DTO 밖 키는 지워진다(GLD 위원회 `{...data}` 대량 할당·KONIS 외부 전송 원 본문)  ④ 핸들러 시그니처가 DTO class 다(소스 대조)
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AddEpaAssessmentDto, AddLogbookEntryDto, AssignRotationDto } from '../../src/modules/education/dto/education-training.dto';
import { KonisReportDto } from '../../src/modules/infection-control/dto/konis-report.dto';
import { RecordHandHygieneDto, ReleaseIsolationDto } from '../../src/modules/infection-control/dto/hand-hygiene-release.dto';
import { CreateCommitteeDto, CreateMeetingDto, CreatePolicyDto, UpdateCommitteeDto, UpdateMeetingDto } from '../../src/modules/gld/gld.dto';
import { GldService } from '../../src/modules/gld/gld.service';
import {
  AddResearchDocumentDto,
  AddResearchSubjectDto,
  CreateResearchStudyDto,
  SubmitIrbAmendmentDto,
  WithdrawResearchSubjectDto,
} from '../../src/modules/research/research.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });
const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, meta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, meta(t)) as Promise<Record<string, unknown>>;
const U = '11111111-1111-4111-8111-111111111111';

describe('인라인 @Body 3차 배치 DTO 계약', () => {
  it('③ GLD 위원회 수정 — 본문의 id·createdAt·관계 중첩 쓰기(members)가 지워진다 · 화면 3모양 통과', async () => {
    const r = await ok({ name: '약사위원회', code: 'dtc', type: 'PHARMACY', quorum: 5, meetingCycle: '월간', id: U, createdAt: '2020-01-01', members: { create: [{ userId: U }] } }, UpdateCommitteeDto);
    expect(r).toMatchObject({ name: '약사위원회', code: 'dtc', type: 'PHARMACY', quorum: 5, meetingCycle: '월간' });
    expect(r).not.toHaveProperty('id');
    expect(r).not.toHaveProperty('createdAt');
    expect(r).not.toHaveProperty('members');
    // admin/governance/page.tsx — 위원장 해제는 null · 비활성화는 isActive:false
    expect(await ok({ chairId: null }, UpdateCommitteeDto)).toEqual({ chairId: null });
    expect(await ok({ isActive: false }, UpdateCommitteeDto)).toEqual({ isActive: false });
    await bad({ chairId: 'not-a-uuid' }, UpdateCommitteeDto);
    await bad({ quorum: 'abc' }, UpdateCommitteeDto);
    await bad({ name: 'x'.repeat(151) }, UpdateCommitteeDto); // VarChar(150) 초과는 종전 500
  });

  it('③ GLD 서비스 — DTO 를 거치지 않은 호출도 읽는 키만 Prisma data 로 간다(종전 `{ ...data }`)', async () => {
    const update = vi.fn().mockResolvedValue({ id: U });
    const svc = new GldService({ committee: { update } } as never);
    await svc.updateCommittee(U, { name: 'n', chairId: '', id: 'evil', members: { create: [] } } as never);
    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({ name: 'n', chairId: null });
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('members');
  });

  it('② GLD 생성 — 화면(admin/gld) 폼의 빈 문자열(chairId·committeeId·reviewDate·location)을 막지 않는다 · 의결 회의 attendees 보존', async () => {
    const committee = { name: 'QPS', type: 'QUALITY', meetingCycle: '월간', chairId: '' };
    expect(await ok(committee, CreateCommitteeDto)).toEqual(committee);
    const meeting = { committeeId: U, title: '9월 정기', scheduledAt: '2026-09-15T10:00', location: '', agenda: '' };
    expect(await ok(meeting, CreateMeetingDto)).toEqual(meeting);
    const decision = { committeeId: U, title: 'QPS 의결 회의', scheduledAt: new Date().toISOString(), attendees: [U] }; // admin/governance/page.tsx
    expect(await ok(decision, CreateMeetingDto)).toEqual(decision);
    const policy = { code: '', title: '손위생 정책', category: 'CLINICAL', committeeId: '', reviewDate: '', content: '' };
    expect(await ok(policy, CreatePolicyDto)).toEqual(policy);
    expect(await ok({ agenda: 'a', minutes: 'm', status: 'COMPLETED' }, UpdateMeetingDto)).toEqual({ agenda: 'a', minutes: 'm', status: 'COMPLETED' });
    await bad({ ...meeting, scheduledAt: 'tomorrow' }, CreateMeetingDto); // 종전 Invalid Date → 500
    await bad({ ...policy, reviewDate: '2026-13-45' }, CreatePolicyDto);
    await bad({ name: 'x' }, CreateCommitteeDto); // type NOT NULL — 종전 Prisma 500
  });

  it('①③ KONIS 보고 — 숫자가 아니면 400(종전 감염률 "NaN" 응답) · 외부 전송으로 가던 임의 키가 지워진다', async () => {
    const good = { facilityCode: '12345678', infectionType: 'CLABSI', unit: 'MICU', deviceDays: 120, patientDays: '300', eventsCount: 2, submittedBy: '감염관리실' };
    const r = await ok({ ...good, patientSsn: '900101-1234567', transmitNow: true }, KonisReportDto);
    expect(r).toMatchObject({ ...good, patientDays: 300 });
    expect(r).not.toHaveProperty('patientSsn');
    expect(r).not.toHaveProperty('transmitNow');
    await bad({ ...good, patientDays: 'abc' }, KonisReportDto);
    await bad({ ...good, eventsCount: -1 }, KonisReportDto);
  });

  it('② 손위생·격리 해제 — 화면 모양 통과 · 서비스가 강제하던 moment 1~5·action 2값 · 필수 직군 누락은 400', async () => {
    const web = { observedRole: 'NURSE', moment: 1, method: 'SANITIZER', action: 'PERFORMED' }; // infection/page.tsx
    expect(await ok(web, RecordHandHygieneDto)).toEqual(web);
    await bad({ ...web, moment: 6 }, RecordHandHygieneDto);
    await bad({ ...web, action: 'SKIPPED' }, RecordHandHygieneDto);
    await bad({ moment: 1, action: 'MISSED' }, RecordHandHygieneDto); // observedRole NOT NULL — 종전 500
    expect(await ok({ reason: '해제' }, ReleaseIsolationDto)).toEqual({ reason: '해제' }); // encounter/new/page.tsx
    await bad({ reason: 'x'.repeat(501) }, ReleaseIsolationDto);
  });

  it('① 수련 — 날짜·숫자·위임 수준 범위·VarChar 초과는 400(종전 Prisma 500)', async () => {
    const entry = { date: '2026-09-15', category: 'PROCEDURE', procedureName: '중심정맥관 삽입', patientAge: '67' };
    expect(await ok(entry, AddLogbookEntryDto)).toMatchObject({ ...entry, patientAge: 67 });
    await bad({ ...entry, date: 'abc' }, AddLogbookEntryDto);
    await bad({ ...entry, patientAge: 'old' }, AddLogbookEntryDto);
    await bad({ epaNumber: 'EPA-1', entrustmentLevel: 6 }, AddEpaAssessmentDto);
    await bad({ residentId: 'R1', startDate: '2026/09/01' }, AssignRotationDto);
  });

  it('② 임상연구 — 화면(research/page.tsx) 5개 폼 모양 통과 · 필수 사유 문장은 서비스가 계속 말한다(DTO 가 필수로 올리지 않음)', async () => {
    const study = { title: '연구', piUserId: U, department: '내과', studyType: 'INTERVENTIONAL', phase: '', sponsor: '', targetEnroll: 30, startDate: '2026-09-01', endDate: '', description: '' };
    expect(await ok(study, CreateResearchStudyDto)).toEqual(study);
    expect(await ok({}, CreateResearchStudyDto)).toEqual({}); // 빈 본문은 서비스의 '연구 제목은 필수입니다'로 간다
    const doc = { docType: 'PROTOCOL', version: '1.0', fileName: 'p.pdf', fileUrl: '/uploads/p.pdf' };
    expect(await ok(doc, AddResearchDocumentDto)).toEqual(doc);
    const subject = { patientId: U, consentDate: '2026-09-15', armGroup: 'A' };
    expect(await ok(subject, AddResearchSubjectDto)).toEqual(subject);
    const amend = { studyId: U, reason: '표본 수 변경', changes: { version: '2.0' } };
    expect(await ok(amend, SubmitIrbAmendmentDto)).toEqual(amend);
    expect(await ok({ reason: '동의 철회' }, WithdrawResearchSubjectDto)).toEqual({ reason: '동의 철회' });
    await bad({ ...study, targetEnroll: 'abc' }, CreateResearchStudyDto);
    await bad({ ...study, startDate: 'abc' }, CreateResearchStudyDto);
    await bad({ ...study, phase: 'PHASE-III-B' }, CreateResearchStudyDto); // VarChar(10)
    await bad({ ...doc, version: 'v1.0.0-rc.1' }, AddResearchDocumentDto); // VarChar(10)
  });

  it('④ 핸들러 시그니처가 DTO class 다', () => {
    const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src/modules', p), 'utf8');
    const edu = src('education/education.controller.ts');
    for (const t of ['AddLogbookEntryDto', 'AddEpaAssessmentDto', 'AssignRotationDto', 'AddCasePresentationDto']) expect(edu).toMatch(new RegExp(`@Body\\(\\) \\w+: ${t}\\b`));
    const ic = src('infection-control/infection-control.controller.ts');
    expect(ic).toMatch(/@Body\(\) data: KonisReportDto/);
    expect(ic).toMatch(/@Body\(\) body: RecordHandHygieneDto/);
    expect(ic).toMatch(/@Body\(\) body\?: ReleaseIsolationDto/);
    const gld = src('gld/gld.controller.ts');
    for (const t of ['CreateCommitteeDto', 'UpdateCommitteeDto', 'AddCommitteeMemberDto', 'CreateMeetingDto', 'UpdateMeetingDto', 'CreatePolicyDto', 'UpdatePolicyDto']) expect(gld).toMatch(new RegExp(`@Body\\(\\) body: ${t}\\b`));
    expect(gld).not.toMatch(/@Body\(\) body: any/);
    const rs = src('research/research.controller.ts');
    expect(rs).not.toMatch(/@Body\(\) body\??: (Record<|\{)/);
  });
});
