/**
 * 🔴 (2026-09-15 N4-B8) 인라인 @Body 8차 배치 26 핸들러(비대면 6·CSSD 7·외부서명 3·원격진료 3·창구 동의 2·병리 2·환자 푸시 2·접수 정정 1) → class DTO 계약.
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 대조군 — 화면·앱이 **실제로 보내는 키**는 DTO 가 모두 안다(소스에서 키를 뽑아 기계 대조 — whitelist 조용한 삭제 방지)
 *  ② 대량 할당 — 품목 수정의 `stock`(입출고 원장 우회)·병리 슬라이드의 임의 키·창구 동의의 `signMethod` 는 본문에서 지워진다
 *  ③ 불리언·수치 위조 — 외부서명 `inPerson:"false"` · 동의 `agreed:"false"` 는 400 · 처방 수량/일수 0·문자열은 400
 *  ④ 어휘 — 조제 유형·세션 유형·공급 유형·서명 채널은 서비스·스키마가 쓰는 값만
 *  ⑤ 창구 동의 서명 방식은 서버가 HIS 로 정한다(컨트롤러 동작)
 */
import 'reflect-metadata';
import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { bodyMeta, dtoKeys, literalKeys, pipe, read } from './dto-contract-helpers';
import {
  RemoteDoctorReplyDto, RemotePrescribeDto, RemotePrescriptionItemDto, SetRemoteDepartmentConfigDto,
} from '../../src/modules/remote-consultation/dto/remote-consultation-write.dto';
import { CreateTelehealthSessionDto } from '../../src/modules/telehealth/dto/telehealth-write.dto';
import { RequestDocumentSignDto, SubmitSignRequestDto } from '../../src/modules/sign-integration/dto/sign-integration-write.dto';
import {
  CreateRegistrationConsentsDto, UpdateRegistrationConsentDto,
} from '../../src/modules/registration-consent/dto/registration-consent-write.dto';
import { RegistrationConsentController } from '../../src/modules/registration-consent/registration-consent.controller';
import { AddPathologySlideDto } from '../../src/modules/pathology/dto/pathology-slide-image.dto';
import { RegisterPatientPushTokenDto } from '../../src/modules/patient-auth/dto/patient-push-token.dto';
import {
  CreateInstrumentItemDto, SupplyInstrumentItemDto, UpdateInstrumentItemDto,
} from '../../src/modules/cssd/dto/cssd-inventory-write.dto';

const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, bodyMeta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, bodyMeta(t)) as Promise<Record<string, unknown>>;
const U = '11111111-1111-4111-8111-111111111111';

describe('B8 요청 본문 DTO 계약', () => {
  describe('① 화면·앱이 보내는 키를 DTO 가 모두 안다(whitelist 조용한 삭제 방지)', () => {
    const RC = 'apps/web/src/app/(main)/remote-consult/page.tsx';
    const cases: Array<[string, string, string[], new () => object]> = [
      [RC, 'replyMut.mutate(', ['content', 'isMedicalAdvice', 'isSimpleInquiry'], RemoteDoctorReplyDto],
      [RC, 'const [meds, setMeds] = useState([', ['medicationCodeId', 'dosage', 'frequency', 'duration', 'quantity', 'route', 'instructions'], RemotePrescriptionItemDto],
      [RC, "apiClient.patch('/api/v1/remote-consultations/config/departments',", ['enabled', 'infectiousMode'], SetRemoteDepartmentConfigDto],
      ['apps/web/src/app/(main)/telehealth/page.tsx', 'const [form, setForm] = useState(', ['patientId', 'doctorId', 'scheduledAt', 'sessionType', 'chiefComplaint'], CreateTelehealthSessionDto],
      ['apps/web/src/app/(main)/consent/page.tsx', "'/api/v1/sign-integration/request-sign',", ['consentFormId', 'documentType', 'sourceId', 'snapshot', 'channel', 'patientId', 'consentType'], RequestDocumentSignDto],
      ['apps/web/src/app/(main)/cssd/page.tsx', 'const [f, setF] = useState(', ['name', 'category', 'spec', 'unit', 'stock', 'safetyStock', 'location', 'erpItemCode'], CreateInstrumentItemDto],
      ['apps/web/src/app/(main)/cssd/page.tsx', '/supply`,', ['type', 'qty', 'reason'], SupplyInstrumentItemDto],
      ['apps/mobile/src/hooks/usePushNotifications.ts', "'/api/v1/patient-auth/device/push-token',", ['fcmToken', 'platform', 'deviceId'], RegisterPatientPushTokenDto],
    ];
    for (const [file, anchor, expected, dto] of cases) {
      it(`${file.split('/').slice(-2).join('/')} ${anchor.slice(0, 40)} → ${dto.name}`, () => {
        const sent = literalKeys(read(file), anchor);
        // 추출기 자체 대조군 — 알려진 키를 실제로 뽑았는가(추출이 비면 아래 검사는 증거가 아니다)
        expect([...sent].sort()).toEqual([...expected].sort());
        const known = dtoKeys(dto);
        expect(sent.filter((k) => !known.has(k))).toEqual([]);
      });
    }

    it('대조군 — 화면이 보내는 실제 모양이 통과한다(비대면 처방·원격진료 예약·공급)', async () => {
      await expect(ok({ medications: [{ medicationCodeId: U, dosage: '1정', frequency: '1일 3회', duration: 7, quantity: 21, route: '경구', instructions: '' }], dispensingType: 'EXTERNAL' }, RemotePrescribeDto)).resolves.toBeTruthy();
      await expect(ok({ patientId: U, doctorId: '', scheduledAt: '2026-09-16T10:00', sessionType: 'VIDEO', chiefComplaint: '' }, CreateTelehealthSessionDto)).resolves.toBeTruthy();
      await expect(ok({ type: 'ADJUST', qty: 0 }, SupplyInstrumentItemDto)).resolves.toBeTruthy();
      await expect(ok({ enabled: null, infectiousMode: false }, SetRemoteDepartmentConfigDto)).resolves.toBeTruthy();
    });
  });

  describe('② 대량 할당 — 본문이 정하면 안 되는 키는 지워진다', () => {
    it('🔴 품목 수정의 stock 은 지워진다(재고는 입출고 거래로만 — 원장 우회 차단)', async () => {
      const r = await ok({ name: '겸자', stock: 999 }, UpdateInstrumentItemDto);
      expect(r).not.toHaveProperty('stock');
      expect(r.name).toBe('겸자');
    });
    it('🔴 병리 슬라이드의 임의 키는 지워진다(clinicalInfo JSON 에 펼쳐 저장되던 자리)', async () => {
      const r = await ok({ blockNo: 'A1', slideNo: '1', stainType: 'H&E', diagnosis: '조작', createdAt: '2000-01-01' }, AddPathologySlideDto);
      expect(Object.keys(r).sort()).toEqual(['blockNo', 'slideNo', 'stainType']);
    });
    it('🔴 창구 동의의 signMethod 는 지워진다(서명 방식은 서버가 정한다)', async () => {
      const r = await ok({ agreed: true, signMethod: 'BLOCKCHAIN' }, UpdateRegistrationConsentDto);
      expect(r).not.toHaveProperty('signMethod');
      const b = await ok({ consents: [{ type: 'PRIVACY', agreed: true, signMethod: 'BLOCKCHAIN' }] }, CreateRegistrationConsentsDto);
      expect((b.consents as Record<string, unknown>[])[0]).not.toHaveProperty('signMethod');
    });
  });

  describe('③ 불리언·수치 위조는 400', () => {
    it('🔴 외부서명 inPerson:"false" → 400(참으로 읽혀 고위험 동의 본인확인이 INPERSON 으로 내려가던 자리)', async () => {
      await bad({ issueNo: 'X-1', inPerson: 'false' }, SubmitSignRequestDto);
      await bad({ inPerson: 'false' }, RequestDocumentSignDto);
    });
    it('창구 동의 agreed:"false" → 400', async () => {
      await bad({ agreed: 'false' }, UpdateRegistrationConsentDto);
      await bad({ consents: [{ type: 'PRIVACY', agreed: 'false' }] }, CreateRegistrationConsentsDto);
    });
    it('비대면 처방 수량 0·일수 문자열·빈 목록 → 400', async () => {
      const item = { medicationCodeId: U, dosage: '1정', frequency: 'TID', duration: 7, quantity: 21, route: 'PO' };
      await bad({ medications: [{ ...item, quantity: 0 }] }, RemotePrescribeDto);
      await bad({ medications: [{ ...item, duration: '칠일' }] }, RemotePrescribeDto);
      await bad({ medications: [] }, RemotePrescribeDto);
    });
    it('공급 수량 문자열 → 400 (직원 원격진료 평가 EP 는 2026-09-15 제거 — 평가는 포털 본인 경로만)', async () => {
      await bad({ type: 'IN', qty: '다섯' }, SupplyInstrumentItemDto);
    });
  });

  describe('④ 어휘', () => {
    it('조제 유형·세션 유형·공급 유형·서명 채널', async () => {
      const item = { medicationCodeId: U, dosage: '1정', frequency: 'TID', duration: 7, quantity: 21, route: 'PO' };
      await bad({ medications: [item], dispensingType: 'MAIL' }, RemotePrescribeDto);
      await bad({ patientId: U, scheduledAt: '2026-09-16T10:00', sessionType: 'CHAT' }, CreateTelehealthSessionDto);
      await bad({ type: 'OUT', qty: 1 }, SupplyInstrumentItemDto);
      await bad({ issueNo: 'X-1', channel: 'EMAIL' }, SubmitSignRequestDto);
    });
  });

  describe('⑤ 창구 동의 서명 방식은 서버가 HIS 로 정한다', () => {
    it('개별 수정 — 본문이 비어도 PORTAL 로 떨어지지 않는다', async () => {
      const updateConsent = vi.fn().mockResolvedValue({});
      const ctl = new RegistrationConsentController({ updateConsent } as never);
      await ctl.updateConsent(U, 'PRIVACY', { agreed: true, signedBy: '홍길동' } as never);
      expect(updateConsent.mock.calls[0][2]).toMatchObject({ agreed: true, signedBy: '홍길동', signMethod: 'HIS' });
    });
    it('일괄 등록 — 항목마다 HIS', async () => {
      const createBulk = vi.fn().mockResolvedValue([]);
      const ctl = new RegistrationConsentController({ createBulk } as never);
      await ctl.createBulk(U, { consents: [{ type: 'PRIVACY', agreed: true }] } as never, 'staff-1');
      expect(createBulk.mock.calls[0][1].consents[0].signMethod).toBe('HIS');
    });
  });
});
