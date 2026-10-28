import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { todayDateOnly } from '../../common/day-range';
import { IdentityService } from '../mobile/identity/identity.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { Gender } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EncryptionService } from './services/encryption.service';
import { signingSecret } from '../../common/util/signing-secret';
import { encryptLegacyPid, hashNationalIdLegacy } from '../../common/crypto/legacy-pid-crypto';
import { DEFAULT_GUARDIAN_SCOPE } from '../portal/guardian-scope';
import { loadPortalSeedAccounts } from './portal-seed-accounts';

@Injectable()
export class PatientAuthService {
  private readonly logger = new Logger(PatientAuthService.name);
  private readonly jwtSecret: string;
  private readonly BCRYPT_ROUNDS = 12;
  private readonly ACCESS_TOKEN_TTL = '1h';
  private readonly REFRESH_TOKEN_DAYS = 30;
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCK_DURATION_MINUTES = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    // 🔴 @Optional — 아직 어댑터가 없는 환경에서도 서버가 뜬다. 다만 미주입이면
    //    `verificationId` 경로가 **조용히 통과하지 않고** 명시적으로 거절한다(위 signup 참조).
    @Optional() @Inject(forwardRef(() => IdentityService)) private readonly identity?: IdentityService,
  ) {
    this.jwtSecret = signingSecret('patient-auth');
  }


  /**
   * 본인확인 결과(CI) 형식 검증 — **지어낸 값으로 계정이 만들어지지 않게 한다**.
   *
   * 🔴 실측 2026-08-24: 웹 포털 가입 화면이 `ci: \`web-${phone}-${Date.now()}\`` 를 보내고 있었다.
   *    CI 는 본인확인기관이 발급하는 연계정보다. 지어낸 값을 넣으면
   *    ① 본인확인을 한 적이 없는데 **한 것으로 기록되고**(P16)
   *    ② 같은 사람이 매번 다른 CI 를 갖게 되어 **중복 계정 탐지가 통째로 무력화**된다.
   *    (운영 `patient_accounts` 6건 중 `web-` 접두 **0건** — 구조는 열려 있었고 통과 이력은 없다)
   *
   * 여기서 하는 것은 **형식 검사뿐**이다. 발급기관 서명 검증은 본인확인 서비스 연동
   * (요청서 EXT-ID-01)이 들어와야 가능하다 — **형식이 맞다고 본인확인이 된 것은 아니다.**
   * 그 한계를 숨기지 않고, 연동 전까지는 이 경로로 가입이 열리지 않는 것이 기본값이다.
   *
   * 본인확인기관 CI 는 SHA-256 기반 88자 Base64 문자열이다(끝 `=` 패딩 포함).
   */
  private assertVerifiedCi(ci: string) {
    const mode = String(process.env.PATIENT_SIGNUP_IDENTITY ?? 'REQUIRED').toUpperCase();
    const looksReal = /^[A-Za-z0-9+/]{86}==$/.test(ci);
    if (looksReal) return;
    if (mode === 'LEGACY_ALLOW') {
      // 조용히 통과시키지 않는다 — 무엇을 통과시켰는지 남긴다(CI 원문은 남기지 않는다)
      this.logger.warn(`🚨 미검증 CI 로 가입 허용(LEGACY_ALLOW) — len=${ci.length}`);
      return;
    }
    throw new BadRequestException({
      code: 'IDENTITY_VERIFICATION_REQUIRED',
      message:
        '휴대폰 본인확인을 거치지 않은 가입은 처리할 수 없습니다. 본인확인 서비스 연동 전이므로 병원 창구에서 계정을 발급받으세요.',
    });
  }

  /** 가입 경로가 지금 열려 있는가 — 화면이 폼을 열기 전에 묻는다(막힌 폼을 다 채우게 하지 않는다) */
  signupAvailability(): { available: boolean; reason: string | null; alternative: string } {
    const mode = String(process.env.PATIENT_SIGNUP_IDENTITY ?? 'REQUIRED').toUpperCase();
    if (mode === 'LEGACY_ALLOW') return { available: true, reason: null, alternative: '' };
    return {
      available: false,
      reason: 'IDENTITY_PROVIDER_NOT_CONFIGURED',
      alternative: '병원 창구에서 계정을 발급받거나, 본인확인이 가능한 환자 앱에서 가입하세요.',
    };
  }

  /** 회원가입 */
  async signup(dto: {
    verificationId?: string;
    ci?: string; name: string; dateOfBirth: string; gender: string; phone: string;
    password: string; pin: string; nationalId?: string;
    address?: { zipCode: string; roadAddress: string; jibunAddress: string; detail: string };
    consents: Record<string, boolean>;
  }, binding?: { installationId?: string; appKeyId?: string }) {
    /**
     * 0. 본인확인 — 🔴 **클라이언트가 주장하는 값이 아니라 서버가 검증한 거래를 믿는다.**
     *
     * 권장 경로: `verificationId` 를 소비해 CI 와 인적사항을 **서버 결과로 덮어쓴다**.
     *   (이름·생년·성별을 요청 값으로 두면 본인확인은 A 로 하고 계정은 B 로 만들 수 있다)
     * 연동 전 경로: `ci` 형식만 검증한다. 형식이 맞다고 본인확인이 된 것은 아니다.
     */
    let ci: string;
    let verifiedPatientId: string | null = null;
    if (dto.verificationId) {
      if (!this.identity) {
        throw new BadRequestException({
          code: 'IDENTITY_PROVIDER_NOT_CONFIGURED',
          message: '본인확인 모듈이 연결되지 않았습니다.',
        });
      }
      const verified = await this.identity.consumeForSignup(dto.verificationId, binding ?? {});
      ci = verified.ci;
      dto = {
        ...dto,
        name: verified.name || dto.name,
        dateOfBirth: verified.birthDate || dto.dateOfBirth,
        gender: verified.gender || dto.gender,
        phone: verified.phone || dto.phone,
      };
      verifiedPatientId = verified.patientId;
    } else {
      this.assertVerifiedCi(dto.ci ?? '');
      ci = dto.ci as string;
    }
    void verifiedPatientId;

    // 1. CI 중복 확인
    const existingAccount = await this.prisma.patientAccount.findFirst({ where: { ci: this.encryption.encrypt(ci) } });
    if (existingAccount) throw new ConflictException('이미 가입된 계정이 있습니다.');

    // 2. 비밀번호 복잡도 검증
    if (!/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/.test(dto.password)) {
      throw new BadRequestException('비밀번호는 영문+숫자+특수문자 8자 이상이어야 합니다.');
    }
    if (!/^\d{6}$/.test(dto.pin)) {
      throw new BadRequestException('PIN은 6자리 숫자여야 합니다.');
    }

    // 3. 필수 동의 확인
    const requiredConsents = ['privacyCollect', 'sensitiveHealth', 'thirdParty', 'uniqueId', 'treatment', 'hie'];
    for (const key of requiredConsents) {
      if (!dto.consents[key]) throw new BadRequestException(`${key} 동의는 필수입니다.`);
    }

    // 4. 기존 환자 매칭 (CI → 이름+생년+성별)
    const nameParts = dto.name.length >= 2 ? { familyName: dto.name[0], givenName: dto.name.slice(1) } : { familyName: dto.name, givenName: '' };
    // 🔴 (2026-09-16 J1) 종전엔 환자·계정·동의 이력·주소가 각각 커밋됐다. 계정만 커밋되고 동의 기록이
    //    실패하면 **필수 동의(개인정보 수집·민감정보) 이력이 없는 계정**이 남는데, 위 `existingAccount`
    //    검사가 **재가입을 '이미 가입된 계정'으로 막는다** — 그 환자는 영영 정상 가입 상태가 될 수 없고
    //    동의 이력은 법정 기록이다. 네 쓰기를 한 트랜잭션에(해시는 CPU 작업이라 트랜잭션 밖에서 먼저).
    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);
    const pinHash = await bcrypt.hash(dto.pin, this.BCRYPT_ROUNDS);

    const { patient, account } = await this.prisma.$transaction(async (tx) => {
    let patient = await tx.patient.findFirst({
      where: { familyName: nameParts.familyName, givenName: nameParts.givenName, dateOfBirth: new Date(dto.dateOfBirth), gender: dto.gender as Gender, validTo: null },
    });

    if (!patient) {
      // 신규 Patient 생성
      const systemUser = await tx.user.findFirst({ where: { role: 'ADMIN' } });
      const mrn = `APP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
      patient = await tx.patient.create({
        data: {
          mrn, familyName: nameParts.familyName, givenName: nameParts.givenName,
          dateOfBirth: new Date(dto.dateOfBirth), gender: dto.gender as Gender,
          phone: dto.phone, ci: this.encryption.encrypt(ci),
          // 🔴 nationalId 는 정본(PatientService)과 같은 **원시 hex 키**로 통일 — 파생 키로 쓰면
          //    직원 차트가 복호 못 한다(key_rotation 두 갈래). hash 도 원시 키 HMAC 로 동시 기록.
          nationalId: dto.nationalId ? encryptLegacyPid(dto.nationalId.replace(/-/g, '')) : null,
          nationalIdHash: dto.nationalId ? hashNationalIdLegacy(dto.nationalId) : null,
          createdBy: systemUser!.id, updatedBy: systemUser!.id,
        },
      });
    } else {
      // 기존 환자에 CI 저장
      await tx.patient.update({
        where: { id: patient.id },
        data: { ci: this.encryption.encrypt(ci), phone: dto.phone },
      });
    }

    // 5. 계정 생성 (해시는 트랜잭션 밖에서 미리 계산 — bcrypt 는 CPU 작업이라 트랜잭션을 길게 잡으면 안 된다)
    const account = await tx.patientAccount.create({
      data: {
        patientId: patient.id,
        phone: dto.phone,
        phoneVerified: true,
        ci: this.encryption.encrypt(ci),
        passwordHash,
        pinHash,
        previousPasswords: JSON.stringify([passwordHash]),
        marketingConsent: dto.consents.marketing ?? false,
      },
    });

    // 6. 동의 이력 저장
    const consentTypes: Record<string, string> = {
      privacyCollect: 'PRIVACY_COLLECT', sensitiveHealth: 'SENSITIVE_HEALTH',
      uniqueId: 'UNIQUE_ID', thirdParty: 'THIRD_PARTY',
      treatment: 'TREATMENT', hie: 'HIE',
      marketing: 'MARKETING', research: 'RESEARCH',
      emrView: 'EMR_VIEW', telehealth: 'TELEHEALTH',
      nationalIdProcess: 'NATIONAL_ID', location: 'LOCATION',
    };
    for (const [key, type] of Object.entries(consentTypes)) {
      if (dto.consents[key] !== undefined) {
        await tx.patientConsent.create({
          data: { accountId: account.id, type, version: '1.0', agreed: dto.consents[key], agreedAt: dto.consents[key] ? new Date() : null },
        });
      }
    }

    // 7. 주소 저장
    if (dto.address) {
      await tx.patientAddress.create({
        data: {
          patientId: patient.id, type: 'HOME',
          zipCode: dto.address.zipCode, roadAddress: dto.address.roadAddress,
          jibunAddress: dto.address.jibunAddress, detail: dto.address.detail,
          fullAddress: `${dto.address.roadAddress} ${dto.address.detail}`.trim(),
          isPrimary: true,
        },
      });
    }

      return { patient, account };
    });

    // 8. 인증서 발급 — HIS 자체 발급 폐지(sign 단독 발급). 환자 인증서는 sign 이 서명 시점에
    //    발급/사용(sign-requests). 가입 시 HIS 가 자체 인증서를 minting 하지 않음.

    // 9. 토큰 발급
    const tokens = this.generateTokens(account.id, patient.id, dto.phone);
    this.logger.log(`Patient signup → mrn=${patient.mrn}`); // PHI: 전화번호 미기록

    return { accountId: account.id, patientId: patient.id, ...tokens };
  }

  /**
   * 외국인 검진권 구매자 셀프 포털 계정 프로비저닝(claim 흐름·G2).
   * CI/국내 동의 불요. 로그인 ID는 여권번호(phone 컬럼 대용). 이미 계정 있으면 비번 미변경·토큰없이 반환.
   */
  async provisionForeignAccount(params: { patientId: string; loginId: string; password: string; pin?: string; email?: string }) {
    const existing = await this.prisma.patientAccount.findUnique({ where: { patientId: params.patientId } });
    if (existing) {
      // 기존 계정은 비번을 덮어쓰지 않음(탈취 방지) — 토큰 없이 반환, 본인 로그인 유도
      return { accountId: existing.id, patientId: params.patientId, existing: true as const };
    }
    if (params.password.length < 8) throw new BadRequestException('비밀번호는 8자 이상이어야 합니다.');
    const dupLogin = await this.prisma.patientAccount.findUnique({ where: { phone: params.loginId } });
    if (dupLogin) throw new ConflictException('이미 등록된 로그인 ID(여권번호)입니다. 로그인해주세요.');
    if (params.pin && !/^\d{6}$/.test(params.pin)) throw new BadRequestException('PIN은 6자리 숫자여야 합니다.');

    const passwordHash = await bcrypt.hash(params.password, this.BCRYPT_ROUNDS);
    const pinHash = params.pin ? await bcrypt.hash(params.pin, this.BCRYPT_ROUNDS) : null;
    const account = await this.prisma.patientAccount.create({
      data: {
        patientId: params.patientId, phone: params.loginId, phoneVerified: false,
        passwordHash, pinHash, previousPasswords: JSON.stringify([passwordHash]), email: params.email,
      },
    });
    const tokens = this.generateTokens(account.id, params.patientId, params.loginId);
    this.logger.log(`Foreign voucher account provisioned: patient=${params.patientId}`);
    return { accountId: account.id, patientId: params.patientId, existing: false as const, ...tokens };
  }

  /** 테스트 계정 시드 (dev용) */
  async seedTestAccounts() {
    // 🔴 시드 데이터는 src 밖(prisma/seeds JSON) — 본문에 두면 dist 에 생년월일·공용 비밀번호가 남는다(G12)
    const seed = loadPortalSeedAccounts();
    const testPatients = seed.patients;

    const passwordHash = await bcrypt.hash(seed.password, this.BCRYPT_ROUNDS);
    const created: string[] = [];

    for (const tp of testPatients) {
      // 이미 존재하면 스킵
      const existing = await this.prisma.patientAccount.findUnique({ where: { phone: tp.phone } });
      if (existing) { created.push(`${tp.name}: already exists`); continue; }

      // 환자 매칭
      const familyName = tp.name[0];
      const givenName = tp.name.slice(1);
      let patient = await this.prisma.patient.findFirst({
        where: { mrn: tp.mrn, validTo: null },
      });
      if (!patient) {
        patient = await this.prisma.patient.findFirst({
          where: { familyName, givenName, validTo: null },
        });
      }
      if (!patient) {
        const systemUser = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
        patient = await this.prisma.patient.create({
          data: {
            mrn: tp.mrn, familyName, givenName,
            dateOfBirth: new Date(tp.dob), gender: tp.gender as Gender,
            phone: tp.phone,
            createdBy: systemUser!.id, updatedBy: systemUser!.id,
          },
        });
      }

      await this.prisma.patientAccount.create({
        data: {
          patientId: patient.id, phone: tp.phone, phoneVerified: true,
          passwordHash, status: 'ACTIVE',
        },
      });
      created.push(`${tp.name} (${tp.phone}): created`);
    }

    return { created, password: seed.password };
  }

  /** 외래 여정 시나리오 시드 (dev용) — 한지영 환자에 풍부한 여정 데이터 생성 */
  async seedOutpatientJourney() {
    // 한지영 환자 찾기
    const account = await this.prisma.patientAccount.findUnique({ where: { phone: '010-6789-0123' } });
    if (!account) return { error: '한지영 계정 없음. seed-test-accounts 먼저 실행' };

    const patientId = account.patientId;
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);

    // 1. 오늘 여정 이벤트 생성 (접수 → 대기 → 검사 오더)
    const events = [
      { eventType: 'RECEPTION_CHECKIN', title: '접수 완료', description: '정신건강의학과 접수 완료', dept: '정신건강의학과', minutesAgo: 45 },
      { eventType: 'RECEPTION_CALLED', title: '진료 호출', description: '1차 진료 호출 — 2진료실', dept: '정신건강의학과', minutesAgo: 30 },
      { eventType: 'ENCOUNTER_START', title: '진료 시작', description: '정신건강의학과 진료 시작 — 문정신 선생님', dept: '정신건강의학과', minutesAgo: 28 },
      { eventType: 'ORDER_CREATED', title: '검사 오더', description: '혈액검사(CBC, 갑상선기능) 오더 발행', dept: '진단검사의학과', minutesAgo: 20 },
      { eventType: 'ENCOUNTER_SIGNED', title: '진료 완료', description: '1차 진료 완료 — 검사 후 재진', dept: '정신건강의학과', minutesAgo: 18 },
      { eventType: 'ORDER_CREATED', title: '검사 오더', description: '심전도 검사(ECG) 오더 발행', dept: '심장내과 검사실', minutesAgo: 15 },
      { eventType: 'LAB_RESULT', title: '검사 완료', description: 'CBC 결과 완료 — 정상', dept: '진단검사의학과', minutesAgo: 5 },
    ];

    for (const e of events) {
      const eventAt = new Date(now.getTime() - e.minutesAgo * 60000);
      await this.prisma.patientJourneyEvent.create({
        data: {
          dataOrigin: 'DEMO', // 여정 P1 — 데모 사건임을 원장에 남긴다(리허설 데이터와 섞이지 않게)
          patientId,
          eventType: e.eventType,
          eventAt,
          title: e.title,
          description: e.description,
          department: e.dept,
          severity: e.eventType === 'RECEPTION_CALLED' ? 'WARNING' : 'INFO',
        },
      });
    }

    // 2. 오늘 예약 2건 생성 (다과 진료 시나리오)
    const doctor = await this.prisma.user.findFirst({ where: { givenName: '정신' } });
    const internalDoc = await this.prisma.user.findFirst({ where: { givenName: '내과' } });
    const systemUser = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });

    if (doctor) {
      // 오전 정신과 예약 (접수 완료)
      await this.prisma.appointment.create({
        data: {
          patientId,
          doctorId: doctor.id,
          scheduledAt: new Date(today.getTime() + 9 * 3600000 + 30 * 60000), // 9:30
          duration: 30,
          type: 'FOLLOW_UP',
          status: 'CHECKED_IN',
          createdBy: systemUser!.id,
        },
      }).catch(() => {}); // 중복 무시
    }

    if (internalDoc) {
      // 오후 내과 예약 (예정)
      await this.prisma.appointment.create({
        data: {
          patientId,
          doctorId: internalDoc.id,
          scheduledAt: new Date(today.getTime() + 14 * 3600000), // 14:00
          duration: 20,
          type: 'INITIAL',
          status: 'SCHEDULED',
          createdBy: systemUser!.id,
        },
      }).catch(() => {});
    }

    // 3. 처방 + 오더 + 검사결과 생성
    const encounter = await this.prisma.encounter.findFirst({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });
    const encounterId = encounter?.id;
    const techUser = systemUser!;

    if (encounterId) {
      // 3-1. 혈액검사 처방 → Order(LAB) → LabResult(COMPLETED) + items
      const rxCBC = await this.prisma.prescription.create({
        data: { encounterId, type: 'LAB', dosage: null, frequency: null, status: 'ACTIVE', createdBy: systemUser!.id },
      });
      const orderCBC = await this.prisma.order.create({
        data: { prescriptionId: rxCBC.id, department: 'LAB', status: 'COMPLETED', priority: 'ROUTINE', completedAt: new Date(now.getTime() - 5 * 60000) },
      });
      await this.prisma.labResult.create({
        data: {
          orderId: orderCBC.id, patientId, technicianId: techUser.id,
          status: 'COMPLETED', collectedAt: new Date(now.getTime() - 18 * 60000), completedAt: new Date(now.getTime() - 5 * 60000),
          items: {
            create: [
              { testName: 'WBC', value: '6.8', unit: '10³/µL', normalMin: 4.0, normalMax: 10.0, flag: 'NORMAL' },
              { testName: 'RBC', value: '4.5', unit: '10⁶/µL', normalMin: 4.0, normalMax: 5.5, flag: 'NORMAL' },
              { testName: 'Hemoglobin', value: '13.2', unit: 'g/dL', normalMin: 12.0, normalMax: 16.0, flag: 'NORMAL' },
              { testName: 'Platelet', value: '250', unit: '10³/µL', normalMin: 150, normalMax: 400, flag: 'NORMAL' },
            ],
          },
        },
      });

      // 3-2. 갑상선기능 처방 → Order(LAB) → LabResult(IN_PROGRESS)
      const rxThyroid = await this.prisma.prescription.create({
        data: { encounterId, type: 'LAB', dosage: null, frequency: null, status: 'ACTIVE', createdBy: systemUser!.id },
      });
      const orderThyroid = await this.prisma.order.create({
        data: { prescriptionId: rxThyroid.id, department: 'LAB', status: 'IN_PROGRESS', priority: 'ROUTINE', receivedAt: new Date(now.getTime() - 15 * 60000) },
      });
      await this.prisma.labResult.create({
        data: {
          orderId: orderThyroid.id, patientId, technicianId: techUser.id,
          status: 'IN_PROGRESS', collectedAt: new Date(now.getTime() - 15 * 60000),
        },
      });

      // 3-3. 심전도(ECG) 처방 → DiagnosticTest(ORDERED)
      await this.prisma.diagnosticTest.create({
        data: {
          patientId, testType: 'ECG', testName: '심전도 (12-lead ECG)',
          requestedBy: doctor?.id ?? techUser.id,
          status: 'ORDERED',
          scheduledAt: new Date(now.getTime() + 10 * 60000),
        },
      });

      // 3-4. 흉부 X-ray 처방 → Order(IMAGING) → ImagingResult(ORDERED)
      const rxXray = await this.prisma.prescription.create({
        data: { encounterId, type: 'IMAGING', dosage: null, frequency: null, status: 'ACTIVE', createdBy: systemUser!.id },
      });
      const orderXray = await this.prisma.order.create({
        data: { prescriptionId: rxXray.id, department: 'IMAGING', status: 'ORDERED', priority: 'ROUTINE' },
      });
      await this.prisma.imagingResult.create({
        data: {
          orderId: orderXray.id, patientId, radiologistId: techUser.id,
          modality: 'X-ray', bodyPart: '흉부 (Chest PA)',
          status: 'ORDERED',
        },
      });

      // 3-5. 혈당검사 처방 → Order(LAB) → LabResult(PENDING) — 채혈 대기
      const rxGlucose = await this.prisma.prescription.create({
        data: { encounterId, type: 'LAB', dosage: null, frequency: null, status: 'ACTIVE', createdBy: systemUser!.id },
      });
      const orderGlucose = await this.prisma.order.create({
        data: { prescriptionId: rxGlucose.id, department: 'LAB', status: 'ORDERED', priority: 'ROUTINE' },
      });
      await this.prisma.labResult.create({
        data: {
          orderId: orderGlucose.id, patientId, technicianId: techUser.id,
          status: 'PENDING',
        },
      });
    }

    // 4. 대기열 상태를 검사 후 재대기로 업데이트
    const queue = await this.prisma.waitingQueue.findFirst({
      where: { patientId, status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (queue) {
      await this.prisma.waitingQueue.update({
        where: { id: queue.id },
        data: {
          status: 'WAITING',
          callCount: 1,
          calledAt: new Date(now.getTime() - 30 * 60000),
          startedAt: new Date(now.getTime() - 28 * 60000),
        },
      });
    }

    return {
      patientId,
      orders: encounterId ? '5건 (CBC완료, 갑상선진행, ECG예정, 흉부X-ray대기, 혈당채혈대기)' : '0건 (encounter 없음)',
      message: '한지영: 정신과 접수→진료→검사5건→재대기 시나리오 생성',
    };
  }

  /** 건강검진 여정 시나리오 시드 (dev용) — 윤서연 환자 */
  async seedCheckupJourney() {
    const account = await this.prisma.patientAccount.findUnique({ where: { phone: '010-0123-4567' } });
    if (!account) return { error: '윤서연 계정 없음. seed-test-accounts 먼저 실행' };

    const patientId = account.patientId;
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);

    // 0. 기존 데이터 정리 (재실행 안전)
    // 🔴 (2026-10-01 여정 P1) 데모가 쓴 사건만 지운다 — 종전엔 그 환자의 오늘 여정 **전부**(실제 사건 포함)를 지웠다.
    //    관계표(FK)를 먼저 지운다. 데모 경로는 REAL 모드에서 막혀 있다(controller assertSeedAllowed).
    const demoWhere = { patientId, eventAt: { gte: today }, dataOrigin: 'DEMO' };
    await this.prisma.patientJourneyEventObject.deleteMany({ where: { event: demoWhere } });
    await this.prisma.patientJourneyEvent.deleteMany({ where: demoWhere });
    const oldVisits = await this.prisma.checkupVisit.findMany({ where: { patientId, status: { in: ['CHECKED_IN', 'IN_PROGRESS'] } }, select: { id: true } });
    for (const v of oldVisits) {
      await this.prisma.checkupResultItem.deleteMany({ where: { visitId: v.id } });
      await this.prisma.checkupVisit.delete({ where: { id: v.id } }).catch(() => {});
    }
    await this.prisma.waitingQueue.deleteMany({ where: { patientId, departmentName: '건강검진센터' } });

    // 1. 검진 프로그램 찾기/생성
    let program = await this.prisma.checkupProgram.findFirst({ where: { category: 'PLUS' } });
    if (!program) {
      program = await this.prisma.checkupProgram.create({
        data: {
          code: 'CK-PLUS-W', name: '정밀 건강검진 (여성)', category: 'PLUS', gender: 'FEMALE',
          price: 580000, discountRate: 0, duration: 240, isActive: true,
          items: JSON.stringify([
            { name: '채혈 (혈액검사 20종)', category: 'LAB', order: 1, fasting: true },
            { name: '흉부 X-ray', category: 'IMAGING', order: 2 },
            { name: '심전도 (ECG)', category: 'DIAGNOSTIC', order: 3 },
            { name: '복부 초음파', category: 'IMAGING', order: 4 },
            { name: '위내시경', category: 'DIAGNOSTIC', order: 5, fasting: true },
            { name: '유방 초음파', category: 'IMAGING', order: 6 },
            { name: '골밀도 검사 (DEXA)', category: 'DIAGNOSTIC', order: 7 },
            { name: '신체계측 + 체성분', category: 'PHYSICAL', order: 0 },
          ]),
          // createdBy is managed by the system
        },
      });
    }

    // 2. 검진 방문 생성 (IN_PROGRESS)
    const visit = await this.prisma.checkupVisit.create({
      data: {
        patientId, programId: program.id,
        scheduledDate: todayDateOnly(), status: 'IN_PROGRESS',
        totalPrice: program.price,
        checkedInAt: new Date(now.getTime() - 90 * 60000), // 1.5시간 전 접수
      },
    });

    // 3. 검사 항목별 결과 생성 (일부 완료, 일부 대기)
    const items = [
      { category: 'PHYSICAL', testName: '신장', value: '163.2', unit: 'cm', finding: 'NORMAL', done: true },
      { category: 'PHYSICAL', testName: '체중', value: '52.8', unit: 'kg', finding: 'NORMAL', done: true },
      { category: 'PHYSICAL', testName: '체질량지수(BMI)', value: '19.8', unit: 'kg/m²', finding: 'NORMAL', done: true },
      { category: 'PHYSICAL', testName: '혈압', value: '118/72', unit: 'mmHg', finding: 'NORMAL', done: true },
      { category: 'LAB', testName: '혈색소(Hb)', value: '13.1', unit: 'g/dL', referenceRange: '12.0-16.0', finding: 'NORMAL', done: true },
      { category: 'LAB', testName: '공복혈당', value: '95', unit: 'mg/dL', referenceRange: '70-100', finding: 'NORMAL', done: true },
      { category: 'LAB', testName: '총콜레스테롤', value: '228', unit: 'mg/dL', referenceRange: '0-200', finding: 'ABNORMAL', done: true },
      { category: 'LAB', testName: 'HDL 콜레스테롤', value: '62', unit: 'mg/dL', referenceRange: '40-', finding: 'NORMAL', done: true },
      { category: 'LAB', testName: 'LDL 콜레스테롤', value: '148', unit: 'mg/dL', referenceRange: '0-130', finding: 'ABNORMAL', done: true },
      { category: 'LAB', testName: 'AST(GOT)', value: '22', unit: 'U/L', referenceRange: '0-40', finding: 'NORMAL', done: true },
      { category: 'LAB', testName: 'ALT(GPT)', value: '18', unit: 'U/L', referenceRange: '0-35', finding: 'NORMAL', done: true },
      { category: 'LAB', testName: 'TSH', value: '2.1', unit: 'mIU/L', referenceRange: '0.27-4.20', finding: 'NORMAL', done: true },
      { category: 'IMAGING', testName: '흉부 X-ray', value: '정상', unit: '', finding: 'NORMAL', done: true },
      { category: 'DIAGNOSTIC', testName: '심전도 (ECG)', value: '정상 동율동', unit: '', finding: 'NORMAL', done: true },
      { category: 'IMAGING', testName: '복부 초음파', value: '', unit: '', finding: 'PENDING', done: false },
      { category: 'DIAGNOSTIC', testName: '위내시경', value: '', unit: '', finding: 'PENDING', done: false },
      { category: 'IMAGING', testName: '유방 초음파', value: '', unit: '', finding: 'PENDING', done: false },
      { category: 'DIAGNOSTIC', testName: '골밀도 검사 (DEXA)', value: '', unit: '', finding: 'PENDING', done: false },
    ];

    for (const item of items) {
      await this.prisma.checkupResultItem.create({
        data: {
          visitId: visit.id, category: item.category, testName: item.testName,
          value: item.value || null, unit: item.unit || null,
          referenceRange: null,
          finding: item.finding,
          completedAt: item.done ? new Date(now.getTime() - (Math.random() * 60 + 10) * 60000) : null,
        },
      });
    }

    // 4. 여정 이벤트 생성
    const checkupEvents = [
      { eventType: 'RECEPTION_CHECKIN', title: '검진 접수', description: '건강검진센터 접수 완료 — 정밀 건강검진(여성)', dept: '건강검진센터', minutesAgo: 90 },
      { eventType: 'ORDER_CREATED', title: '채혈 시작', description: '혈액검사 20종 채혈 완료', dept: '건강검진센터 채혈실', minutesAgo: 80 },
      { eventType: 'LAB_RESULT', title: '신체계측 완료', description: '신장 163.2cm / 체중 52.8kg / BMI 19.8', dept: '건강검진센터', minutesAgo: 75 },
      { eventType: 'LAB_RESULT', title: '혈액검사 완료', description: '혈액검사 12종 결과 완료 — 총콜레스테롤↑ LDL↑', dept: '진단검사의학과', minutesAgo: 40 },
      { eventType: 'IMAGING_RESULT', title: '흉부 X-ray 완료', description: '흉부 X-ray — 정상', dept: '영상의학과', minutesAgo: 35 },
      { eventType: 'LAB_RESULT', title: '심전도 완료', description: '심전도(ECG) — 정상 동율동', dept: '건강검진센터', minutesAgo: 25 },
      { eventType: 'ORDER_CREATED', title: '초음파 대기', description: '복부 초음파 검사 대기 — 3층 초음파실', dept: '영상의학과', minutesAgo: 10 },
    ];

    for (const e of checkupEvents) {
      await this.prisma.patientJourneyEvent.create({
        data: {
          dataOrigin: 'DEMO', // 여정 P1 — 데모 사건임을 원장에 남긴다(리허설 데이터와 섞이지 않게)
          patientId, eventType: e.eventType, title: e.title,
          eventAt: new Date(now.getTime() - e.minutesAgo * 60000),
          description: e.description, department: e.dept,
          severity: e.eventType.includes('RESULT') ? 'INFO' : 'INFO',
        },
      });
    }

    // 5. 대기열에 검진센터 대기 추가
    const adminUser = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
    await this.prisma.waitingQueue.create({
      data: {
        patientId, doctorId: adminUser!.id,
        departmentName: '건강검진센터', queueNumber: 3,
        type: 'WALK_IN', visitType: 'INITIAL', status: 'WAITING',
        reason: '정밀 건강검진',
        checkedInAt: new Date(now.getTime() - 90 * 60000),
      },
    }).catch(() => {});

    return {
      patientId,
      visitId: visit.id,
      completed: items.filter(i => i.done).length,
      pending: items.filter(i => !i.done).length,
      message: `윤서연: 검진 ${items.filter(i => i.done).length}/${items.length}항목 완료, 초음파/내시경/골밀도 대기`,
    };
  }

  /** 로그인 */
  async login(phone: string, password: string, deviceId: string, platform: string, ipAddress?: string, fcmToken?: string) {
    const account = await this.prisma.patientAccount.findUnique({ where: { phone }, include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } });
    if (!account) throw new UnauthorizedException('등록되지 않은 번호입니다.');
    if (account.status === 'WITHDRAWN') throw new UnauthorizedException('탈퇴한 계정입니다.');
    if (account.status === 'SUSPENDED') throw new UnauthorizedException('정지된 계정입니다.');
    this.assertNotLocked(account);

    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) {
      const attempts = await this.recordFailedAttempt(account);
      throw new UnauthorizedException(`비밀번호가 틀렸습니다. (${this.MAX_FAILED_ATTEMPTS - attempts}회 남음)`);
    }

    // 성공 → 실패 횟수 초기화
    await this.prisma.patientAccount.update({
      where: { id: account.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ipAddress },
    });

    // 토큰 발급 + 기기 등록
    const tokens = this.generateTokens(account.id, account.patientId, phone);
    const refreshHash = await bcrypt.hash(tokens.refreshToken, 10);
    await this.prisma.patientDevice.upsert({
      where: { accountId_deviceId: { accountId: account.id, deviceId } },
      create: { accountId: account.id, deviceId, platform, refreshTokenHash: refreshHash, ...(fcmToken ? { fcmToken } : {}) },
      update: { platform, refreshTokenHash: refreshHash, lastActiveAt: new Date(), isActive: true, ...(fcmToken ? { fcmToken } : {}) },
    });

    return {
      accountId: account.id, patientId: account.patientId,
      patientName: `${account.patient.familyName}${account.patient.givenName}`,
      mrn: account.patient.mrn,
      ...tokens,
    };
  }

  /**
   * 계정 잠금 판정 — 비밀번호·PIN 로그인이 **같은 카운터**(`failedAttempts`·`lockedUntil`)를 쓴다.
   * 🔴 PIN 로그인은 잠금을 보지도, 실패를 세지도 않았다 —
   *    비밀번호 5회 오류로 잠긴 계정이 PIN 으로는 그대로 들어왔고, 6자리 PIN 대입에 상한이 IP 스로틀뿐이었다.
   */
  private assertNotLocked(account: { lockedUntil: Date | null }): void {
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      const remaining = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(`계정이 잠겼습니다. ${remaining}분 후 다시 시도해주세요.`);
    }
  }

  /** 실패 1회 누적 — 한도에 닿으면 잠근다. 누적 후 실패 횟수를 돌려준다 */
  private async recordFailedAttempt(account: { id: string; failedAttempts: number }): Promise<number> {
    const attempts = account.failedAttempts + 1;
    const updates: { failedAttempts: number; lockedUntil?: Date } = { failedAttempts: attempts };
    if (attempts >= this.MAX_FAILED_ATTEMPTS) {
      updates.lockedUntil = new Date(Date.now() + this.LOCK_DURATION_MINUTES * 60 * 1000);
    }
    await this.prisma.patientAccount.update({ where: { id: account.id }, data: updates });
    return attempts;
  }

  /** PIN 로그인 */
  async loginWithPin(phone: string, pin: string, deviceId: string) {
    const account = await this.prisma.patientAccount.findUnique({ where: { phone } });
    if (!account || !account.pinHash) throw new UnauthorizedException('PIN 로그인을 사용할 수 없습니다.');
    if (account.status !== 'ACTIVE') throw new UnauthorizedException('계정이 비활성 상태입니다.');
    this.assertNotLocked(account);

    // 기기 바인딩 확인
    const device = await this.prisma.patientDevice.findUnique({
      where: { accountId_deviceId: { accountId: account.id, deviceId } },
    });
    if (!device?.isActive) throw new UnauthorizedException('등록되지 않은 기기입니다. 비밀번호로 로그인해주세요.');

    const valid = await bcrypt.compare(pin, account.pinHash);
    if (!valid) {
      await this.recordFailedAttempt(account);
      throw new UnauthorizedException('PIN이 틀렸습니다.');
    }

    const tokens = this.generateTokens(account.id, account.patientId, phone);
    const refreshHash = await bcrypt.hash(tokens.refreshToken, 10);
    // 성공 → 실패 횟수 초기화(비밀번호 로그인과 같은 규칙) · 기기 refresh 와 한 트랜잭션
    await this.prisma.$transaction([
      this.prisma.patientAccount.update({
        where: { id: account.id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
      this.prisma.patientDevice.update({
        where: { id: device.id },
        data: { refreshTokenHash: refreshHash, lastActiveAt: new Date() },
      }),
    ]);

    return { accountId: account.id, patientId: account.patientId, ...tokens };
  }

  /**
   * 토큰 갱신 — 🔴 **refresh 도 회전한다**(AUTH-P-02).
   *
   * 종전에는 새 access token 만 돌려주고 refresh 는 30일 내내 같은 값이었다.
   * 한 번 새면 30일 동안 쓸 수 있었고, 재사용을 탐지할 근거도 없었다.
   * 이제 매번 새 refresh 를 발급하고 **직전 것을 기억**해, 이미 회전된 토큰이 다시 오면
   * 도난으로 보고 **그 기기 세션만** 끊는다(다른 기기는 살려둔다 — 스탭 세션과 같은 판정).
   */
  async refreshToken(
    refreshToken: string,
    binding?: { installationId?: string; deviceId?: string },
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; refreshExpiresAt: string; deviceId: string }> {
    let payload: { sub: string; type: string; pid?: string; phone?: string; patientId?: string };
    try { payload = jwt.verify(refreshToken, this.jwtSecret) as typeof payload; } catch { throw new UnauthorizedException('만료된 토큰입니다.'); }
    if (payload.type !== 'patient-refresh') throw new UnauthorizedException('유효하지 않은 토큰입니다.');

    const devices = await this.prisma.patientDevice.findMany({
      where: { accountId: payload.sub, isActive: true },
    });

    let current: (typeof devices)[number] | null = null;
    let reusedOn: (typeof devices)[number] | null = null;
    for (const d of devices) {
      if (d.refreshTokenHash && (await bcrypt.compare(refreshToken, d.refreshTokenHash))) { current = d; break; }
      if (d.prevRefreshHash && (await bcrypt.compare(refreshToken, d.prevRefreshHash))) { reusedOn = d; }
    }

    // 🔴 이미 회전된 토큰이 다시 왔다 = 도난 의심. 해당 기기만 폐기하고 그 사실을 코드로 말한다.
    if (!current && reusedOn) {
      await this.prisma.patientDevice.update({
        where: { id: reusedOn.id },
        data: { isActive: false, refreshTokenHash: null, prevRefreshHash: null },
      });
      this.logger.warn(`🚨 환자 refresh 재사용 — 기기 폐기 account=${payload.sub} device=${reusedOn.deviceId}`);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: '이전 토큰이 다시 사용되어 이 기기의 로그인을 해제했습니다.',
      });
    }
    if (!current) throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: '기기 인증에 실패했습니다.' });

    // 다른 기기가 남의 refresh 를 쓰지 못한다
    if (binding?.deviceId && binding.deviceId !== current.deviceId) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: '기기 결합이 일치하지 않습니다.' });
    }

    const tokens = this.generateTokens(payload.sub, payload.pid ?? '', payload.phone ?? '');
    const newHash = await bcrypt.hash(tokens.refreshToken, 10);
    await this.prisma.patientDevice.update({
      where: { id: current.id },
      data: {
        refreshTokenHash: newHash,
        prevRefreshHash: current.refreshTokenHash,
        lastActiveAt: new Date(),
        ...(binding?.installationId ? { installationId: binding.installationId } : {}),
      },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      refreshExpiresAt: new Date(Date.now() + this.REFRESH_TOKEN_DAYS * 86400_000).toISOString(),
      deviceId: current.deviceId,
    };
  }

  /** 로그아웃 */
  async logout(accountId: string, deviceId?: string) {
    if (deviceId) {
      await this.prisma.patientDevice.updateMany({
        where: { accountId, deviceId },
        data: { isActive: false, refreshTokenHash: null },
      });
    } else {
      await this.prisma.patientDevice.updateMany({
        where: { accountId },
        data: { isActive: false, refreshTokenHash: null },
      });
    }
  }

  /** 비밀번호 변경 */
  async changePassword(accountId: string, currentPassword: string, newPassword: string) {
    const account = await this.prisma.patientAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException();

    const valid = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!valid) throw new UnauthorizedException('현재 비밀번호가 틀렸습니다.');

    // 이전 3개 비밀번호 재사용 확인
    const previous: string[] = account.previousPasswords ? JSON.parse(JSON.stringify(account.previousPasswords)) : [];
    for (const prev of previous.slice(-3)) {
      if (await bcrypt.compare(newPassword, prev)) {
        throw new BadRequestException('최근 사용한 비밀번호는 재사용할 수 없습니다.');
      }
    }

    const newHash = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);
    previous.push(newHash);

    await this.prisma.patientAccount.update({
      where: { id: accountId },
      data: { passwordHash: newHash, previousPasswords: previous, passwordChangedAt: new Date() },
    });

    // 모든 기기 로그아웃
    await this.logout(accountId);
    return { success: true };
  }

  /** JWT 토큰 검증 */
  async verifyAccessToken(token: string): Promise<{ accountId: string; patientId: string }> {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as { sub: string; type: string; pid: string };
      if (payload.type !== 'patient') throw new Error();
      return { accountId: payload.sub, patientId: payload.pid };
    } catch {
      throw new UnauthorizedException('인증이 만료되었습니다.');
    }
  }

  /** PIN 설정/변경 */
  async setPin(accountId: string, password: string, pin: string) {
    const account = await this.prisma.patientAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException();
    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) throw new UnauthorizedException('비밀번호가 틀렸습니다.');
    if (!/^\d{6}$/.test(pin)) throw new BadRequestException('PIN은 6자리 숫자여야 합니다.');
    const pinHash = await bcrypt.hash(pin, this.BCRYPT_ROUNDS);
    await this.prisma.patientAccount.update({ where: { id: accountId }, data: { pinHash } });
    return { success: true };
  }

  /** 등록 기기 목록 */
  async getDevices(accountId: string) {
    return this.prisma.patientDevice.findMany({
      where: { accountId },
      select: { id: true, deviceId: true, deviceName: true, platform: true, appVersion: true, lastActiveAt: true, isActive: true, createdAt: true },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  /** 기기 삭제 (원격 로그아웃) */
  async removeDevice(accountId: string, deviceDbId: string) {
    // 🔴 (2026-09-15) 0건(없는 id·다른 계정 기기)도 success:true 였다 — "원격 로그아웃됨"을 믿게 하지 않는다
    const r = await this.prisma.patientDevice.updateMany({
      where: { id: deviceDbId, accountId },
      data: { isActive: false, refreshTokenHash: null },
    });
    return r.count > 0
      ? { success: true as const, updated: r.count }
      : { success: false as const, updated: 0, reason: 'DEVICE_NOT_REGISTERED' as const };
  }

  /**
   * FCM 토큰 갱신 — 🔴 (2026-09-15) 종전엔 `updateMany` 가 0건이어도(등록 안 된 기기·다른 계정의 deviceId) `success: true` 였다.
   *    호출자는 "푸시가 이 기기로 온다"고 믿지만 토큰은 어디에도 저장되지 않았다(알림 도달 정직성). 갱신 건수를 그대로 말한다.
   *    등록(없으면 생성)은 `registerPushToken`(POST device/push-token — 모바일 앱이 쓰는 경로)이다.
   */
  async updateFcmToken(accountId: string, deviceId: string, fcmToken: string) {
    const r = await this.prisma.patientDevice.updateMany({
      where: { accountId, deviceId },
      data: { fcmToken },
    });
    return r.count > 0
      ? { success: true as const, updated: r.count }
      : { success: false as const, updated: 0, reason: 'DEVICE_NOT_REGISTERED' as const };
  }

  // ══════════════════════════════════════════
  // 보호자 워크플로우
  // ══════════════════════════════════════════

  /** 보호자 등록 신청 */
  async requestGuardian(accountId: string, dto: {
    guardianAccountId: string; dependentMrn: string; relationship: string;
    legalBasis: string; documentUrl?: string;
  }) {
    // 피부양자 MRN → PatientAccount 조회
    const dependentPatient = await this.prisma.patient.findFirst({
      where: { mrn: dto.dependentMrn, validTo: null },
      select: { id: true },
    });
    if (!dependentPatient) throw new BadRequestException('해당 MRN의 환자를 찾을 수 없습니다.');

    const dependentAccount = await this.prisma.patientAccount.findUnique({
      where: { patientId: dependentPatient.id },
    });
    if (!dependentAccount) throw new BadRequestException('피부양자의 앱 계정이 없습니다.');

    // 중복 확인
    const existing = await this.prisma.patientGuardian.findUnique({
      where: { guardianAccountId_dependentAccountId: { guardianAccountId: accountId, dependentAccountId: dependentAccount.id } },
    });
    if (existing) throw new ConflictException('이미 등록된 보호자 관계입니다.');

    // 자기 자신 확인
    if (accountId === dependentAccount.id) throw new BadRequestException('본인을 피부양자로 등록할 수 없습니다.');

    return this.prisma.patientGuardian.create({
      data: {
        guardianAccountId: accountId,
        dependentAccountId: dependentAccount.id,
        relationship: dto.relationship,
        legalBasis: dto.legalBasis,
        documentUrl: dto.documentUrl,
        isApproved: false,
      },
    });
  }

  /** 내 보호자/피부양자 목록 */
  async getGuardianRelations(accountId: string) {
    const [asGuardian, asDependent] = await Promise.all([
      this.prisma.patientGuardian.findMany({
        where: { guardianAccountId: accountId },
        include: {
          dependent: {
            select: { id: true, phone: true, patient: { select: { familyName: true, givenName: true, mrn: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.patientGuardian.findMany({
        where: { dependentAccountId: accountId },
        include: {
          guardian: {
            select: { id: true, phone: true, patient: { select: { familyName: true, givenName: true, mrn: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { asGuardian, asDependent };
  }

  /** 가족 계정 목록(전환 가능한 피부양자) — 승인·미만료 링크만 flat 반환(포털 전환용) */
  async getFamilyAccounts(accountId: string) {
    const now = new Date();
    const links = await this.prisma.patientGuardian.findMany({
      where: {
        guardianAccountId: accountId,
        isApproved: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        dependent: { select: { id: true, patient: { select: { familyName: true, givenName: true, mrn: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((l) => ({
      id: l.dependentAccountId, // 전환 대상 계정 id
      relationship: l.relationship,
      familyName: l.dependent?.patient?.familyName ?? '',
      givenName: l.dependent?.patient?.givenName ?? '',
      mrn: l.dependent?.patient?.mrn ?? '',
      isApproved: l.isApproved,
      expiresAt: l.expiresAt,
    }));
  }

  /** 가족 계정 전환 — 승인·미만료·본인이 보호자인 링크만. 피부양자 컨텍스트 액세스 토큰 발급(switchedFrom 감사표식·리프레시 미발급). */
  async switchToFamilyAccount(guardianAccountId: string, dependentAccountId: string): Promise<{ accessToken: string; patientId: string }> {
    const link = await this.prisma.patientGuardian.findUnique({
      where: { guardianAccountId_dependentAccountId: { guardianAccountId, dependentAccountId } },
    });
    if (!link || !link.isApproved) throw new UnauthorizedException('승인된 가족 계정이 아닙니다.');
    if (link.expiresAt && link.expiresAt < new Date()) throw new UnauthorizedException('가족 계정 접근이 만료되었습니다.');
    const account = await this.prisma.patientAccount.findUnique({
      where: { id: dependentAccountId },
      select: { id: true, patientId: true, phone: true },
    });
    if (!account) throw new BadRequestException('대상 가족 계정을 찾을 수 없습니다.');
    const accessToken = jwt.sign(
      { sub: account.id, pid: account.patientId, phone: account.phone, type: 'patient', switchedFrom: guardianAccountId },
      this.jwtSecret, { expiresIn: this.ACCESS_TOKEN_TTL },
    );
    return { accessToken, patientId: account.patientId };
  }

  /** 보호자 관계 해제 */
  async removeGuardian(accountId: string, guardianId: string) {
    const relation = await this.prisma.patientGuardian.findUnique({ where: { id: guardianId } });
    if (!relation) throw new BadRequestException('보호자 관계를 찾을 수 없습니다.');
    if (relation.guardianAccountId !== accountId && relation.dependentAccountId !== accountId) {
      throw new BadRequestException('본인의 보호자 관계만 해제할 수 있습니다.');
    }
    await this.prisma.patientGuardian.delete({ where: { id: guardianId } });
    return { success: true };
  }

  /** 승인 대기 보호자 목록 (관리자) */
  async getPendingGuardians() {
    return this.prisma.patientGuardian.findMany({
      where: { isApproved: false, rejectedReason: null },
      include: {
        guardian: {
          select: { id: true, phone: true, patient: { select: { familyName: true, givenName: true, mrn: true } } },
        },
        dependent: {
          select: { id: true, phone: true, patient: { select: { familyName: true, givenName: true, mrn: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 보호자 승인 (관리자) */
  async approveGuardian(guardianId: string, approvedBy: string, accessScope?: Record<string, boolean>, expiresAt?: string) {
    const relation = await this.prisma.patientGuardian.findUnique({ where: { id: guardianId } });
    if (!relation) throw new BadRequestException('보호자 관계를 찾을 수 없습니다.');
    if (relation.isApproved) throw new BadRequestException('이미 승인된 관계입니다.');

    return this.prisma.patientGuardian.update({
      where: { id: guardianId },
      data: {
        isApproved: true,
        approvedBy,
        approvedAt: new Date(),
        accessScope: accessScope ?? DEFAULT_GUARDIAN_SCOPE,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
  }

  /** 보호자 거부 (관리자) */
  async rejectGuardian(guardianId: string, reason: string) {
    const relation = await this.prisma.patientGuardian.findUnique({ where: { id: guardianId } });
    if (!relation) throw new BadRequestException('보호자 관계를 찾을 수 없습니다.');

    return this.prisma.patientGuardian.update({
      where: { id: guardianId },
      data: { rejectedReason: reason },
    });
  }

  // ══════════════════════════════════════════
  // 알림 관리
  // ══════════════════════════════════════════

  /** 알림 목록 (페이지네이션) */
  async getNotifications(accountId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.patientNotification.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.patientNotification.count({ where: { accountId } }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** 미읽음 수 */
  async getUnreadCount(accountId: string) {
    return this.prisma.patientNotification.count({ where: { accountId, isRead: false } });
  }

  /** 읽음 처리 (단건) */
  async markNotificationRead(accountId: string, notificationId: string) {
    const notif = await this.prisma.patientNotification.findFirst({
      where: { id: notificationId, accountId },
    });
    if (!notif) throw new BadRequestException('알림을 찾을 수 없습니다.');

    return this.prisma.patientNotification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** 전체 읽음 처리 */
  async markAllNotificationsRead(accountId: string) {
    const { count } = await this.prisma.patientNotification.updateMany({
      where: { accountId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: count };
  }

  /** 알림 설정 조회 */
  async getNotificationSettings(accountId: string) {
    const settings = await this.prisma.notificationSetting.findMany({
      where: { accountId },
      orderBy: { type: 'asc' },
    });

    // 저장된 행 + 기본 type 합집합 — 일부만 저장하면 나머지 기본 항목이 목록에서 사라지던 문제(2026-07-07 검증 발견)
    // MEDICATION_REMINDER(F-2)는 opt-in — 기본 표시는 되되 꺼짐(행 저장 시에만 cron 발송 대상)
    const defaultTypes = ['APPOINTMENT_REMINDER', 'LAB_RESULT', 'DOCUMENT_READY', 'BILLING', 'QUESTIONNAIRE', 'SYSTEM'];
    const saved = new Set(settings.map(s => s.type));
    const defaults = [
      ...defaultTypes.map(type => ({ type, enabled: true, pushEnabled: true, smsEnabled: false })),
      { type: 'MEDICATION_REMINDER', enabled: false, pushEnabled: true, smsEnabled: false },
    ].filter(d => !saved.has(d.type));
    return [...settings, ...defaults].sort((a, b) => a.type.localeCompare(b.type));
  }

  /** 알림 설정 변경 */
  async updateNotificationSettings(accountId: string, settings: Array<{ type: string; enabled: boolean; pushEnabled: boolean; smsEnabled: boolean }>) {
    const results = [];
    for (const s of settings) {
      const result = await this.prisma.notificationSetting.upsert({
        where: { accountId_type: { accountId, type: s.type } },
        create: { accountId, type: s.type, enabled: s.enabled, pushEnabled: s.pushEnabled, smsEnabled: s.smsEnabled },
        update: { enabled: s.enabled, pushEnabled: s.pushEnabled, smsEnabled: s.smsEnabled },
      });
      results.push(result);
    }
    return results;
  }

  private generateTokens(accountId: string, patientId: string, phone: string) {
    const expiresAt = new Date(Date.now() + 3600000);
    const accessToken = jwt.sign(
      { sub: accountId, pid: patientId, phone, type: 'patient' },
      this.jwtSecret, { expiresIn: this.ACCESS_TOKEN_TTL },
    );
    const refreshToken = jwt.sign(
      { sub: accountId, pid: patientId, phone, type: 'patient-refresh' },
      this.jwtSecret, { expiresIn: `${this.REFRESH_TOKEN_DAYS}d` },
    );
    return { accessToken, refreshToken, expiresAt: expiresAt.toISOString() };
  }

  /** 동의서 테스트 데이터 시드 — 김영수(입원), 한지영(외래) */
  async seedConsentData() {
    const results: string[] = [];

    // 김영수 — 수술 동의서 (PENDING, 환자 서명 대기)
    const kim = await this.prisma.patientAccount.findUnique({ where: { phone: '010-1234-5678' } });
    if (kim) {
      const doctor = await this.prisma.user.findFirst({ where: { givenName: '내과' } });
      const nurse = await this.prisma.user.findFirst({ where: { role: 'NURSE' } });

      // 수술 동의서
      const template1 = await this.prisma.consentTemplate.findFirst({ where: { type: 'SURGERY' } });
      await this.prisma.consentForm.create({
        data: {
          patientId: kim.patientId,
          type: 'SURGERY',
          consentType: 'SURGERY',
          templateName: '심장 스텐트 삽입술 동의서',
          templateId: template1?.id,
          content: {
            title: '심장 스텐트 삽입술 동의서',
            sections: [
              { heading: '수술명', text: '경피적 관상동맥 스텐트 삽입술 (PCI)' },
              { heading: '목적', text: '관상동맥 협착 부위에 스텐트를 삽입하여 혈류를 개선합니다.' },
              { heading: '방법', text: '대퇴동맥 또는 요골동맥을 통해 카테터를 삽입하고, 협착 부위에 풍선확장 후 스텐트를 유치합니다.' },
            ],
          } as any,
          risks: '출혈, 감염, 혈관 손상, 스텐트 혈전증, 관상동맥 박리, 심근경색, 뇌졸중, 사망 (0.1-0.5%)',
          alternatives: '약물 치료 (항혈소판제, 스타틴), 관상동맥 우회술(CABG)',
          doctorId: doctor?.id,
          status: 'PENDING',
        },
      });
      results.push('김영수: 수술 동의서 (PENDING)');

      // 전신마취 동의서
      await this.prisma.consentForm.create({
        data: {
          patientId: kim.patientId,
          type: 'ANESTHESIA',
          consentType: 'ANESTHESIA',
          templateName: '전신마취 동의서',
          content: {
            title: '전신마취 동의서',
            sections: [
              { heading: '마취 방법', text: '전신마취 (기관삽관)' },
              { heading: '목적', text: '수술 중 통증 차단 및 의식 소실 유도' },
            ],
          } as any,
          risks: '구역/구토, 인후통, 치아 손상, 악성고열, 아나필락시스, 호흡부전',
          alternatives: '국소마취, 부위마취 (수술 특성상 전신마취 필요)',
          doctorId: doctor?.id,
          status: 'PENDING',
        },
      });
      results.push('김영수: 전신마취 동의서 (PENDING)');

      // 수혈 동의서 (이미 환자 서명 완료)
      await this.prisma.consentForm.create({
        data: {
          patientId: kim.patientId,
          type: 'TRANSFUSION',
          consentType: 'TRANSFUSION',
          templateName: '수혈 동의서',
          content: { title: '수혈 동의서', sections: [{ heading: '수혈 사유', text: '수술 중 예상 출혈량 500mL 이상' }] } as any,
          risks: '발열, 알러지, 용혈반응, 감염 (극히 드묾)',
          doctorId: doctor?.id,
          patientSignature: '김영수',
          patientSignedAt: new Date(Date.now() - 2 * 3600000),
          patientSignedBy: '김영수',
          signedBy: '김영수',
          signedAt: new Date(Date.now() - 2 * 3600000),
          status: 'SIGNED',
          isValid: true,
        },
      });
      results.push('김영수: 수혈 동의서 (SIGNED)');
    }

    // 한지영 — 일반 치료 동의서 (PENDING)
    const han = await this.prisma.patientAccount.findUnique({ where: { phone: '010-6789-0123' } });
    if (han) {
      const psyDoc = await this.prisma.user.findFirst({ where: { givenName: '정신' } });
      await this.prisma.consentForm.create({
        data: {
          patientId: han.patientId,
          type: 'TREATMENT',
          consentType: 'TREATMENT',
          templateName: '항불안제 투약 동의서',
          content: {
            title: '항불안제 투약 동의서',
            sections: [
              { heading: '약물', text: '알프라졸람 (Alprazolam) 0.25mg' },
              { heading: '목적', text: '범불안장애 증상 완화' },
              { heading: '주의사항', text: '졸음, 어지러움이 나타날 수 있으며, 운전을 삼가해주세요.' },
            ],
          } as any,
          risks: '졸음, 의존성, 기억력 저하, 운동능력 저하',
          alternatives: '인지행동치료(CBT), SSRI 계열 항우울제',
          doctorId: psyDoc?.id,
          status: 'PENDING',
        },
      });
      results.push('한지영: 항불안제 투약 동의서 (PENDING)');
    }

    return { created: results };
  }

  /** FCM 푸시 토큰 등록/갱신 */
  async registerPushToken(accountId: string, deviceId: string, fcmToken: string, platform: string) {
    await this.prisma.patientDevice.upsert({
      where: { accountId_deviceId: { accountId, deviceId } },
      create: { accountId, deviceId, platform, fcmToken, isActive: true },
      update: { fcmToken, platform, lastActiveAt: new Date(), isActive: true },
    });
  }
}