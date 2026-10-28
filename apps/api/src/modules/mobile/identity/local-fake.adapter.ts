import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  IdentityProviderAdapter,
  IdentityProviderHealth,
  IdentityStartInput,
  ProviderCallbackInput,
  ProviderStartResult,
  VerifiedIdentity,
} from './identity-provider.types';

/**
 * 개발·CI 전용 결정적 fake — **운영에서는 절대 선택되지 않는다**(`usableInProduction=false`).
 *
 * 🔴 합성 CI 는 본인확인기관 형식(88자 Base64)을 흉내내되, **접두를 고정**해
 *    운영 데이터에 섞여 들어와도 한눈에 구분되고 지표로 셀 수 있게 한다.
 *    (형식만 맞고 발급기관 서명이 없는 값이라는 사실을 숨기지 않는다)
 */
export const FAKE_CI_PREFIX = 'LOCALFAKE';

@Injectable()
export class LocalFakeIdentityAdapter implements IdentityProviderAdapter {
  readonly name = 'LOCAL_FAKE';
  readonly usableInProduction = false;

  private readonly store = new Map<string, VerifiedIdentity>();

  async start(input: IdentityStartInput): Promise<ProviderStartResult> {
    const providerTxRef = `fake-${input.verificationId}`;
    return {
      // 실제 공급자 화면 대신, 개발자가 결과를 고를 수 있는 내부 페이지로 보낸다
      authUrl: `${input.callbackUrl}?state=${encodeURIComponent(input.stateNonce)}&tx=${providerTxRef}&fake=1`,
      providerTxRef,
    };
  }

  async completeCallback(input: ProviderCallbackInput): Promise<{ providerTxRef: string }> {
    const providerTxRef = input.raw.tx ?? `fake-${input.verificationId}`;
    const seed = input.raw.seed ?? input.verificationId;
    // 본인확인기관 CI 와 **같은 형식**(86자 Base64 + `==`)이라야 가입 경로가 끝까지 돈다.
    // 다만 접두를 고정해 운영 데이터에 섞여도 한눈에 구분되고 지표로 셀 수 있다.
    let body = FAKE_CI_PREFIX;
    let round = 0;
    while (body.length < 86) {
      body += createHash('sha256').update(`${FAKE_CI_PREFIX}:${seed}:${round++}`).digest('base64').replace(/=+$/, '');
    }
    const ci = `${body.slice(0, 86)}==`;
    this.store.set(providerTxRef, {
      ci,
      name: input.raw.name ?? '홍길동',
      birthDate: input.raw.birthDate ?? '1990-01-01',
      gender: (input.raw.gender as 'MALE' | 'FEMALE') ?? 'MALE',
      phone: input.raw.phone ?? '01000000000',
      providerTxRef,
    });
    return { providerTxRef };
  }

  async fetchVerifiedResult(providerTxRef: string): Promise<VerifiedIdentity> {
    const hit = this.store.get(providerTxRef);
    if (!hit) throw new Error('LOCAL_FAKE: 결과가 없습니다.');
    return hit;
  }

  async cancel(providerTxRef: string): Promise<void> {
    this.store.delete(providerTxRef);
  }

  async health(): Promise<IdentityProviderHealth> {
    return { provider: this.name, available: true, reason: null };
  }
}
