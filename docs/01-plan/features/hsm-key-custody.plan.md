# HSM 키 수탁 · 블록체인 인증서 키 보안 기획서

> 블록체인 인증서·전자서명에 쓰이는 **개인키/마스터 시크릿을 HSM(Hardware Security Module)으로 수탁**하기 위한 HIS 내부 구조 변경 기획.
> 작성 2026-06-15 · v1.0 (현황 grounded).

> ## 🔴 정책 확정 (2026-06-15 최종) — HSM은 sign 전용, HIS는 내부 블록체인 인증서 + sign 호출
> **결정**: 전자서명용 HSM은 **sign이 클라우드 HSM(AWS KMS)으로 보유**한다. **HIS는 HSM(KMS/PKCS#11)을 직접 연동하지 않으며**, **내부 블록체인 인증서 기반으로 동작**하고 **HSM 서명이 필요한 기능만 sign에 호출**한다.
> - HIS 자체 키(JWKS·ENCRYPTION_KEY)는 **소프트웨어 유지**. (한때 HIS 자체 키도 KMS 보호로 검토·구현했으나 **철회** — HIS 직접 HSM 연동 금지. AwsKmsKeyCustody·managed 경로 제거.)
> - 아래 Phase 1~3 은 **HIS 소프트웨어 키 위생(추상화·회전·envelope)** 으로만 유효 — HSM 전환 아님.
> - **HIS가 할 일 = 이미 완료**: ① 내부 블록체인 인증서 운영(blockchain-cert·blockchain-anchor) ② sign 호출(sign-integration: submit·webhook·staff-token·enroll 핸드오프) ③ **sign이 회신하는 `keyCustody=HSM`·attestation 봉인 기록(Phase 4, 커밋 6fe4b3fe)**. HSM 서명의 부인방지 증거는 sign 책임, HIS는 기록만.
> - **HIS HsmKeyCustody/직접 KMS 연동 = 금지(구현분 철회).** 향후에도 HIS는 HSM을 직접 연동하지 않는다.
> 아래 본문의 "JWKS→HSM"·"ENCRYPTION_KEY→HSM" 전환 프레이밍은 **HIS 비대상**(소프트웨어 유지)으로 읽을 것.

## 배경 — 왜 HSM인가

블록체인 인증서·의료기록 전자서명의 **법적 부인방지(non-repudiation)**·PHI 암호화 키 보호는 "개인키가 추출 불가능한 하드웨어 안에서만 서명/복호된다"는 전제에 의존한다. 현재 HIS는 모든 키 연산을 **소프트웨어(메모리 로드)**로 수행하며, 키가 env/DB 평문에 존재한다 → 환경변수·DB 백업·메모리 덤프 유출 시 전 키 노출. 컴플라이언스(개인정보보호법 안전성확보조치, 의료법 전자서명, KISA 전자서명인증) 관점에서 HSM 또는 동급(KMS/KCMVP 검증 모듈) 수탁이 요구된다.

## 현재 상태 (코드 grounded)

### 이미 구현된 것 (양호)
- PHI 필드 암호화: AES-256-GCM 멱등 헬퍼 (`common/crypto/field-encryption.ts`, `kdf.ts` `deriveAesKey`). `ENCRYPTION_KDF_SALT` 강화 knob 존재.
- 인증서 생명주기: `blockchain-cert.service.ts` 발급/폐기/정지/갱신/CRL + PIN 잠금(`blockchain.pin*` 네임스페이스, terminal.pin과 무관).
- 인증서 감사: `CertificateAuditLog`(ISSUED/REVOKED/PIN_FAILED/…, 365일 보존).
- 해시체인 앵커: `blockchain-anchor.service.ts` Merkle 트리·배치 앵커(검증 가능).
- sign 연동 경계: `sign-integration.service.ts` SIMULATION(기본)/EXTERNAL(P1 게이트) 토글, JWKS·webhook·staff-token.

### 부족한 것 (HSM 갭)
| # | 갭 | 위치(근거) | 위험 |
|---|----|----------|------|
| G1 | **JWKS RS256 개인키가 DB 평문**(SystemConfig `sign.jwksPrivateSecret`) | `sign-integration.service.ts:159-174` | DB/백업 유출 시 의료진 staff-token 위조 가능 |
| G2 | **ENCRYPTION_KEY 단일 마스터 시크릿(env)** 에 전 PHI 암호화가 의존(SPOF) | `kdf.ts:13`, `encryption.service.ts:16` | 마스터 1개 유출 = 전 PHI 복호. 회전 메커니즘 없음 |
| G3 | **키 추상화 계층 부재** — 서명/복호가 `crypto.sign`·`scryptSync`를 직접 호출 | `sign-integration.service.ts:214`, `field-encryption.ts:29` | HSM/KMS 교체 시 호출부 산재로 변경 비용↑ |
| G4 | **인증서에 키 수탁 출처(keyCustody) 미기록** — SOFTWARE/CLIENT_SE/HSM 구분 없음 | `BlockchainCertificate` 모델 | "이 서명이 HSM 보호 키로 생성됐는가" 증명 불가 |
| G5 | **ENCRYPTION_KEY 회전 메커니즘 없음** | 전역 | 키 노출 시 무중단 회전·재암호화 경로 없음 |

> 범위 명확화: HIS는 **블록체인 인증서 개인키를 보관하지 않는다**(환자=클라이언트 로컬 SE, 의료진=클라이언트/ sign, HIS는 publicKey만 저장). 따라서 HIS 내부 HSM 1차 대상은 **JWKS RS256 개인키 + ENCRYPTION_KEY 마스터**이며, 환자/의료진 서명 인증서 개인키 수탁은 **sign 측 HSM 책임**(별도 요청서).

## 목표

1. HIS 내부 보관 개인키/마스터를 **HSM 또는 KMS(envelope) 로 수탁** — 키가 평문으로 디스크/메모리에 상주하지 않게.
2. **KeyCustodyProvider 추상화**로 SOFTWARE→HSM 교체를 호출부 변경 없이(드롭인) 가능하게.
3. 인증서/서명에 **키 수탁 출처·attestation 기록** → 부인방지 증거력 강화.
4. **마스터 키 회전(envelope rotation)** 무중단 경로 확보.
5. sign과의 **HSM 경계 계약** 확정(요청서 연동).

## 비범위 (Out of Scope)
- 블록체인 인증서 개인키 자체의 HSM 수탁(클라이언트 SE/ sign 책임 — 요청서로 위임).
- 실제 외부 퍼블릭 블록체인 연동(현 내부 해시체인 유지).
- 물리 HSM 장비 조달·설치(인프라 트랙, 본 기획은 SW 통합 추상화까지).

---

## Phase 1 — KeyCustodyProvider 추상화 (드롭인 기반, 무동작 변경) ✅ 구현 완료 (커밋 3ab9341e)

> 구현됨: `common/crypto/key-custody.ts`(인터페이스+SoftwareKeyCustody+싱글톤), `key-custody.service.ts`(RS256 keyRef 라이프사이클), `key-custody.module.ts`. sign-integration `keypair()` 제거→KeyCustodyService 위임(config 키·kid 동일·무중단), field-encryption·encryption.service·terminal-draft·onboarding 의 대칭키 획득을 `getKeyCustody().getSymmetricKey()` 경유로 전환. 검증: byte-identical(대칭키·RS256 결정적 서명·JWKS 검증·kid 산식). 아래는 원 설계.


호출부를 단일 인터페이스 뒤로 모아 이후 HSM/KMS 교체를 격리한다. **기본 구현은 현행 소프트웨어 그대로**(동작 무변경·회귀 0).

```ts
// common/crypto/key-custody.ts
export interface KeyCustodyProvider {
  kind(): 'SOFTWARE' | 'KMS' | 'HSM';
  sign(keyRef: string, alg: 'RSA-SHA256', data: Buffer): Promise<Buffer>; // 개인키 비추출 — 서명만 반환
  getPublicJwk(keyRef: string): Promise<JsonWebKey>;
  // envelope: 마스터(KEK)는 provider 내부, 데이터키(DEK)는 wrap/unwrap만 노출
  unwrapDataKey(wrappedDek: string): Promise<Buffer>;
  wrapDataKey(dek: Buffer): Promise<string>;
}
```

- `SoftwareKeyCustody`(기본): 현행 `crypto.sign`/`scryptSync` 래핑. `keyRef`=config 키명.
- 적용: `sign-integration` 서명·`field-encryption`/`encryption.service` 키 도출을 provider 경유로 전환(동작 동일).
- 산출: 인터페이스 + Software 구현 + 호출부 이관. **회귀 테스트로 서명/복호 바이트 동일성 검증**.

## Phase 2 — JWKS RS256 개인키 수탁 전환 (G1, P0) ✅ 회전 구현 (커밋 c8425801·배포)

> 구현됨: KeyCustodyService.rotateRs256/dropPreviousRs256 + publicJwks 양키(current+prev) 게시 → 무중단 회전. ADMIN POST /sign-integration/rotate-key·/drop-prev-key. 실 HSM 키 생성 전환은 G-1(조달) 후 HsmKeyCustody provider 교체. 아래는 원 설계.


- 현행: `sign-integration.service.ts:159-174` 가 RS256 키쌍 생성 후 **개인 PEM을 SystemConfig 평문 저장**.
- 변경: 개인키를 **HSM/KMS 안에서 생성**(비추출), HIS는 `keyRef`만 보관. `issueStaffToken`의 `crypto.sign(...privatePem)` → `keyCustody.sign(keyRef, ...)`.
- 공개키(JWKS `GET /sign-integration/jwks`)는 provider `getPublicJwk(keyRef)`로 노출(계약 무변경 — sign 측 검증 영향 없음).
- 전환 안전장치: 기존 평문 키와 신규 HSM 키를 **kid 병행 게시**(JWKS에 2키) → sign이 양쪽 검증 가능한 기간 확보 후 구키 폐기(무중단 회전).
- 산출: KMS/HSM provider(개발=Software, 운영=실 HSM/KMS), 평문 `jwksPrivateSecret` 폐기 절차.

## Phase 3 — ENCRYPTION_KEY → Envelope(HSM-wrapped DEK) (G2·G5, P0/P1) ✅ 키 관리 계층 구현 (커밋 5944ef9a·배포, 소비 게이트)

> 구현됨: EncryptionKeyRegistry 모델 + provider wrapDataKey/unwrapDataKey(SOFTWARE=마스터 도출 KEK·`:kek` 도메인 분리) + EnvelopeKeyService(ensureActiveDek/getDek/rotateDek/status) + ADMIN /admin/encryption-keys/status·rotate-dek. **field-encryption 소비(활성화)는 HSM 도입+PHI 백필 게이트 후**(consumed=false·현행 무변경). 아래는 원 설계.


- 현행: `ENCRYPTION_KEY`(env) → `scryptSync` → AES-256 DEK 직접 사용. 마스터 노출=전 PHI 복호, 회전 불가.
- 변경(봉투 암호화):
  - **KEK(master)** 를 HSM/KMS 내부에 보관(비추출).
  - **DEK** 는 랜덤 생성 후 KEK로 wrap → DB(`EncryptionKeyRegistry`)에 wrapped 형태로 저장. 복호 시 `unwrapDataKey`로 메모리 일시 사용.
  - `kdf.deriveAesKey` 는 호환 유지(레거시 ENCRYPTION_KEY 기반 데이터 복호용) + 신규 데이터는 envelope DEK 사용 → **점진 이관**(field-encryption 멱등성과 동일 전략).
- 회전: KEK 회전 = wrapped DEK 재-wrap만(데이터 재암호화 불필요), DEK 회전 = 신 DEK로 신규 암호화 + 백필. 무중단.
- 안전장치: `ENCRYPTION_KDF_SALT` 변경이 전 PHI 복호 불가를 유발하던 제약([[kdf]]) 을 envelope로 근본 해소.
- 산출: `EncryptionKeyRegistry` 모델(키ID·wrapped DEK·상태·생성일), envelope 헬퍼, 이관 백필 게이트(DRY-RUN).

## Phase 4 — 키 수탁 출처·Attestation 기록 (G4) ✅ 구현 완료 (커밋 6fe4b3fe)

> 구현됨: schema additive — BlockchainCertificate·DocumentSignature(`keyCustody` default SOFTWARE·`attestationRef`), ConsentForm(`signKeyCustody`·`signAttestationRef`·`signTsaToken`). sign webhook이 `keyCustody`·`signAttestationRef`·`tsaToken`(요청서 A1~A3) 수신 시 ConsentForm 기록(미수신 폴백). blockchain-cert.issue() keyCustody 기본 CLIENT_SE(개인키 클라 보관). 아래는 원 설계.


- `BlockchainCertificate`·`DocumentSignature`에 컬럼 추가(additive):
  - `keyCustody String` = `SOFTWARE | CLIENT_SE | HSM | EXTERNAL_SIGN`
  - `attestationRef String?` = HSM/SE attestation 또는 sign이 전달한 키 attestation 참조
- sign EXTERNAL 서명 수신 시 webhook의 attestation 필드(요청서 항목)를 기록 → "HSM 보호 키 서명" 증거 보존.
- CRL/검증 응답에 keyCustody 노출 → 감사·심사 대응.
- 산출: 스키마 additive 마이그레이션(db push 안전), 기록 경로, 검증 API 확장.

## Phase 5 — 운영·거버넌스
- 키 접근 감사: HSM/KMS 호출(서명·unwrap)을 `AuditService`로 기록(`safeLog` — 본 흐름 비차단, [[session_20260615_codeanalyzer_residual]]).
- 4-eyes: KEK 회전·키 폐기에 `ApprovalService` 재사용(요청자≠승인자).
- 개발/운영 토글: `keyCustody.provider`(SOFTWARE/KMS/HSM) — 개발 SOFTWARE, 운영 실 모듈([[dev_simulation_registry]] 패턴).
- 검증 모듈: 국내 KCMVP 검증 HSM 또는 FIPS 140-2 Level 3 이상(법무·인프라 확인).

---

## sign 경계 (요청서와 정합)
| 키 | 수탁 주체 | HSM 책임 |
|----|----------|----------|
| JWKS RS256(의료진 staff-token) | **HIS** | 본 기획 Phase 2 |
| ENCRYPTION_KEY 마스터(PHI) | **HIS** | 본 기획 Phase 3 |
| 감사인증서·타임스탬프 서명 | **sign** | 요청서 |

## 단계 게이트
- G-1(법무/인프라): HSM/KMS 조달 모델(온프레 HSM vs 클라우드 KMS vs KCMVP 모듈) 결정 — Phase 2/3 실키 전환 전.
- G-2(sign): 요청서 회신(키 수탁·attestation 필드 계약) — Phase 4 attestation 기록 전.
- Phase 1(추상화)·Phase 4 스키마 additive 는 게이트 무관하게 선행 가능(현행 동작 무변경).

## 리스크
- envelope 이관 중 키 혼재(레거시 ENCRYPTION_KEY ↔ envelope DEK) — field-encryption 멱등 전략 재사용으로 안전.
- JWKS 키 교체 시 sign 검증 단절 — kid 병행 게시로 무중단.
- HSM 도입은 **소프트웨어 키와 동일 바이트 호환 검증** 필수(회귀) — Phase 1 테스트가 게이트.
