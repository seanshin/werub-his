/**
 * 🔴 (2026-09-15 B6) 인라인 @Body 6차 배치 32 핸들러(포털 10·원가 8·전자인증서 7·이식 7) → class DTO 계약.
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 대조군 — 화면(web 포털·모바일·관리 화면)이 **실제로 보내는 키**는 DTO 가 모두 안다(소스에서 키를 뽑아 기계 대조 — whitelist 조용한 삭제 방지)
 *  ② 대량 할당 — 원가 수동 배부의 금액·출처, 동의 서명의 ipAddress 는 지워진다
 *  ③ 판정 없는 교차시험은 400(종전: 결과 NEGATIVE 로 저장돼 이식 적합성 게이트 통과)
 *  ④ 핸들러 시그니처가 DTO class 다(소스 대조)
 */
import 'reflect-metadata';
import * as path from 'node:path';
import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { bodyMeta, dtoKeys, literalKeys, pipe, read } from './dto-contract-helpers';
import {
  CreateCostCenterDto, CreateManualCostAllocationDto, CostPeriodDto, UpdateCostCenterDto,
} from '../../src/modules/cost-analysis/dto/cost-analysis.dto';
import {
  BlockchainCertPolicyDto, CertPinEventDto, CertReasonDto, IssueMyCertificateDto, RenewCertificateDto,
} from '../../src/modules/blockchain-cert/dto/blockchain-cert-write.dto';
import {
  RecordTransplantCrossmatchDto, UpdateTransplantCrossmatchDto, UpdateTransplantRejectionOutcomeDto, RecordTransplantHlaDto,
} from '../../src/modules/transplant/dto/transplant.dto';
import {
  PortalAiAskDto, PortalCheckupQuestionnaireDto, PortalSelfCheckInDto, PortalSignRegistrationConsentDto, PortalSubmitQuestionnaireDto,
  PortalTelehealthBookDto, PortalTelehealthRateDto, RecordSmbgDto,
} from '../../src/modules/portal/dto/portal-patient-write.dto';

const meta = bodyMeta;
const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, meta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, meta(t)) as Promise<Record<string, unknown>>;
const U = '11111111-1111-4111-8111-111111111111';

describe('B6 요청 본문 DTO 계약', () => {
  describe('① 화면이 보내는 키를 DTO 가 모두 안다(whitelist 조용한 삭제 방지)', () => {
    const cases: Array<[string, string, string[], new () => object]> = [
      ['apps/web/src/app/portal/_services/ServicesTab.tsx', "apiClient.post('/api/v1/portal/telehealth-book',", ['doctorId', 'scheduledAt', 'sessionType', 'chiefComplaint'], PortalTelehealthBookDto],
      ['apps/mobile/app/(tabs)/telehealth-book.tsx', "apiClient.post('/api/v1/portal/telehealth-book',", ['doctorId', 'scheduledAt', 'sessionType', 'chiefComplaint'], PortalTelehealthBookDto],
      ['apps/web/src/app/portal/_home/SelfCheckIn.tsx', "'/api/v1/portal/check-in',", ['departmentName', 'doctorId', 'reason', 'visitType'], PortalSelfCheckInDto],
      ['apps/web/src/app/portal/_health/HealthTab.tsx', 'checkup-visits/${visitId}/questionnaire`,', ['questionnaireId', 'answers'], PortalCheckupQuestionnaireDto],
    ];
    for (const [file, anchor, expected, dto] of cases) {
      it(`${path.basename(file)} → ${dto.name}`, () => {
        const sent = literalKeys(read(file), anchor);
        // 추출기 자체 대조군 — 알려진 키를 실제로 뽑았는가(추출이 비면 아래 검사는 증거가 아니다)
        expect(sent.sort()).toEqual([...expected].sort());
        const known = dtoKeys(dto);
        expect(sent.filter((k) => !known.has(k))).toEqual([]);
      });
    }

    it('모바일 문진표 제출은 tokenId·formSchemaId·responses 를 보낸다 — 종전 컨트롤러 타입(appointmentId)이 거짓이었다', async () => {
      const src = read('apps/mobile/app/(tabs)/questionnaire.tsx');
      expect(src).toMatch(/\{ tokenId: questionnaire\.tokenId, responses: answers \}/);
      expect(src).toMatch(/\{ formSchemaId: questionnaire\.formSchemaId, responses: answers \}/);
      const r = await ok({ tokenId: U, responses: { q1: 'y' } }, PortalSubmitQuestionnaireDto);
      expect(r).toMatchObject({ tokenId: U, responses: { q1: 'y' } });
      const r2 = await ok({ formSchemaId: U, responses: {} }, PortalSubmitQuestionnaireDto);
      expect(r2.formSchemaId).toBe(U);
    });

    it('포털 동의 서명·자가측정·AI 질문·평가 — 화면 본문 모양 통과', async () => {
      await expect(ok({ signedBy: '홍길동', signMethod: 'PORTAL' }, PortalSignRegistrationConsentDto)).resolves.toMatchObject({ signedBy: '홍길동' });
      await expect(ok({ code: 'SBP', value: 120 }, RecordSmbgDto)).resolves.toMatchObject({ code: 'SBP', value: 120 });
      await expect(ok({ question: '약 언제 먹나요' }, PortalAiAskDto)).resolves.toBeTruthy();
      await expect(ok({ rating: 5, feedback: '' }, PortalTelehealthRateDto)).resolves.toMatchObject({ rating: 5 });
    });

    it('원가 — 화면 수동 배분 `{costCenterId, driverId, quantity, period}`·중심점 생성(`parentId: null`) 통과', async () => {
      const src = read('apps/web/src/app/(main)/cost-analysis/page.tsx');
      expect(src).toMatch(/setManualForm\(\{ costCenterId: '', driverId: '', quantity: 0 \}\)/);
      expect(src).toMatch(/JSON\.stringify\(\{ \.\.\.body, period \}\)/);
      await expect(ok({ costCenterId: U, driverId: U, quantity: 3, period: '2026-Q3' }, CreateManualCostAllocationDto)).resolves.toMatchObject({ driverId: U, quantity: 3 });
      await expect(ok({ code: 'CC-1', name: '응급', type: 'DIRECT_CARE', department: '응급의학과', parentId: null }, CreateCostCenterDto)).resolves.toMatchObject({ parentId: null });
      await expect(ok({ code: 'CC-1', name: '응급', type: 'DIRECT_CARE', department: '응급의학과' }, UpdateCostCenterDto)).resolves.toBeTruthy();
      await expect(ok({ period: '2026-Q3' }, CostPeriodDto)).resolves.toBeTruthy();
    });

    it('전자인증서 — 발급(publicKey·종전 publicKeyPem)·갱신·PIN·정책 화면 본문 통과', async () => {
      await expect(ok({ publicKey: 'pem', algorithm: 'ECDSA_P256' }, IssueMyCertificateDto)).resolves.toMatchObject({ publicKey: 'pem' });
      await expect(ok({ publicKeyPem: 'pem', algorithm: 'ECDSA_P256' }, IssueMyCertificateDto)).resolves.toMatchObject({ publicKeyPem: 'pem' });
      await expect(ok({ publicKey: 'pem' }, RenewCertificateDto)).resolves.toBeTruthy();
      await expect(ok({ certId: U }, CertPinEventDto)).resolves.toBeTruthy();
      const policy = {
        allowedAlgorithms: ['ECDSA_P256'], pinLength: 6, pinLockAttempts: 5, pinLockMinutes: 10, pinAutoSuspendAttempts: 10,
        anchorInterval: '1h', patientCertPolicy: 'manual', autoIssuePolicy: { DOCTOR: true },
      };
      await expect(ok(policy, BlockchainCertPolicyDto)).resolves.toMatchObject(policy);
      // 화면 정책 저장 키 = DTO 키
      const keys = literalKeys(read('apps/web/src/app/(main)/admin/blockchain-cert/page.tsx'), "apiClient.put('/api/v1/blockchain-cert/policy',");
      expect(keys.sort()).toEqual(Object.keys(policy).sort());
    });
  });

  describe('② 대량 할당은 지워진다', () => {
    it('원가 수동 배부 — 본문의 amount·source·costDriverId 가 서비스에 닿지 않는다', async () => {
      const r = await ok({ costCenterId: U, driverId: U, quantity: 1, period: '2026-Q3', amount: 999999, source: 'AUTO', costDriverId: U }, CreateManualCostAllocationDto);
      expect(r).not.toHaveProperty('amount');
      expect(r).not.toHaveProperty('source');
      expect(r).not.toHaveProperty('costDriverId');
      await bad({ costCenterId: U, driverId: U, quantity: 0, period: '2026-Q3' }, CreateManualCostAllocationDto);
    });

    it('포털 동의 서명 — 본문의 ipAddress·agreed·patientId 가 지워진다 · 컨트롤러가 본문을 펼치지 않는다', async () => {
      const r = await ok({ signedBy: '홍길동', ipAddress: '1.2.3.4', agreed: false, patientId: U }, PortalSignRegistrationConsentDto);
      expect(r).not.toHaveProperty('ipAddress');
      expect(r).not.toHaveProperty('agreed');
      expect(r).not.toHaveProperty('patientId');
      const ctl = read('apps/api/src/modules/portal/portal.controller.ts');
      // 주석(종전 코드를 설명하는 `{ ...body }`)이 검사에 걸리지 않게 걷어낸다
      const sign = ctl
        .slice(ctl.indexOf('async signRegistrationConsent('), ctl.indexOf('async revokeRegistrationConsent('))
        .replace(/\/\/[^\n]*/g, '');
      expect(sign).toMatch(/signedBy: body\.signedBy/);
      expect(sign).not.toMatch(/\.\.\.body/);
    });
  });

  describe('③ 판정·어휘', () => {
    it('🔴 상세 교차시험 — 판정(finalResult) 없으면 400 · 어휘 밖 400', async () => {
      await bad({ recipientId: U }, RecordTransplantCrossmatchDto);
      await bad({ recipientId: U, finalResult: 'maybe' }, RecordTransplantCrossmatchDto);
      await expect(ok({ recipientId: U, finalResult: 'INCOMPATIBLE' }, RecordTransplantCrossmatchDto)).resolves.toBeTruthy();
    });
    it('교차시험 결과는 게이트가 읽는 대문자 어휘만 · 거부반응 결과 어휘 · PRA 정수', async () => {
      await bad({ result: 'negative' }, UpdateTransplantCrossmatchDto);
      await expect(ok({ result: 'NEGATIVE' }, UpdateTransplantCrossmatchDto)).resolves.toBeTruthy();
      await bad({ outcome: 'DONE' }, UpdateTransplantRejectionOutcomeDto);
      await bad({ pra: 12.5 }, RecordTransplantHlaDto);
    });
    it('전자인증서 — 빈 사유 400 · 정책 형 오류 400 · 빈 certId 400', async () => {
      await bad({ reason: '' }, CertReasonDto);
      await bad({ reason: 'x'.repeat(201) }, CertReasonDto);
      await bad({ pinLength: 'abc' }, BlockchainCertPolicyDto);
      await bad({}, CertPinEventDto);
      await bad({ algorithm: 'ECDSA_P256' }, IssueMyCertificateDto);
    });
    it('포털 — 평점 범위·원격 유형 어휘·체크인 진료과 필수', async () => {
      await bad({ rating: 6 }, PortalTelehealthRateDto);
      await bad({ doctorId: U, scheduledAt: '2026-09-16T09:00:00+09:00', sessionType: 'CHAT' }, PortalTelehealthBookDto);
      await bad({}, PortalSelfCheckInDto);
    });
  });

  it('④ 핸들러 시그니처가 DTO class 다', () => {
    const tp = read('apps/api/src/modules/transplant/transplant.controller.ts');
    expect(tp).not.toMatch(/@Body\(\s*'/);
    expect(tp).not.toMatch(/@Body\(\) body: Record</);
    const ca = read('apps/api/src/modules/cost-analysis/cost-analysis.controller.ts');
    expect(ca).toMatch(/@Body\(\) body: CreateManualCostAllocationDto/);
    expect(ca).not.toMatch(/@Body\(\s*'/);
    const svc = read('apps/api/src/modules/cost-analysis/cost-analysis.service.ts');
    expect(svc).not.toMatch(/data: data as never/);
    const bc = read('apps/api/src/modules/blockchain-cert/blockchain-cert.controller.ts');
    expect(bc).not.toMatch(/@Body\(\s*'/);
    expect(read('apps/api/src/modules/portal/portal.controller.ts')).toMatch(/@Body\(\) body: PortalSubmitQuestionnaireDto/);
  });
});
