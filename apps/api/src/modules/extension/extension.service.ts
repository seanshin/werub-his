import { Injectable } from '@nestjs/common';

/**
 * Extension/Slot 시스템 (O3 패턴)
 * - Extension: UI에 삽입 가능한 컴포넌트 정의
 * - Slot: 확장이 삽입될 위치
 *
 * 🔴 2026-08-14 W8(P16) — **이 레지스트리는 "설치된 확장"이 아니다.**
 *    ① 등재된 3건의 `component`(@hospital-run/ext-*) 는 **패키지가 존재하지 않고**,
 *       프런트엔드에 슬롯을 읽어 렌더하는 코드도 없다(`/api/v1/extensions/slots` 를 부르는 곳은
 *       관리 목록 화면 하나뿐). 그런데 화면은 이것들을 초록 '활성' 배지로 그렸다.
 *    ② 레지스트리는 **프로세스 메모리**다 — 토글·등록은 서버 재시작이면 사라진다.
 *    고칠 수 없는 사실(패키지 부재·미영속)을 지우는 대신 **응답이 그대로 말하게** 한다:
 *    `installed`(렌더러 배선 여부) · `persisted`(재시작 생존 여부) · `runtime`.
 *    ※ 영속이 필요하면 Extension 모델 신설이 정답이다(스키마 변경 필요 — 이 배치 범위 밖).
 */

export interface Extension {
  id: string;
  name: string;
  slot: string;
  component: string;  // 프론트엔드 컴포넌트 경로
  order: number;
  enabled: boolean;
  config?: Record<string, unknown>;
}

/** 응답용 — 사용 설정(enabled)과 실제 동작(installed/persisted)을 구분해서 내보낸다 */
export interface ExtensionView extends Extension {
  /** 이 확장을 실제로 그려주는 렌더러가 배선돼 있는가 — 현재 프런트엔드에 슬롯 렌더러가 없다 */
  installed: boolean;
  /** 서버 재시작 후에도 남는가 — 인메모리 레지스트리이므로 false */
  persisted: boolean;
  /** 화면이 쓸 단일 라벨. enabled 만 보고 '활성'이라 쓰면 안 된다. */
  effectiveStatus: 'ACTIVE' | 'NOT_INSTALLED' | 'DISABLED';
}

/**
 * 렌더러가 배선된 컴포넌트 목록(정본).
 * 🔴 비어 있는 것이 현재의 **사실**이다 — 채우지 않은 채 '활성'이라 말하지 않는다.
 * 슬롯 렌더러를 실제로 만들면 여기에 컴포넌트 키를 등재한다.
 */
const INSTALLED_COMPONENTS = new Set<string>();

@Injectable()
export class ExtensionService {
  /** 🔴 프로세스 메모리 — 재시작 시 소실(persisted:false 로 응답에 명시) */
  private extensions: Extension[] = [
    { id: 'ext-vital-widget', name: '바이탈 위젯', slot: 'patient-chart-sidebar', component: '@hospital-run/ext-vitals', order: 1, enabled: true },
    { id: 'ext-allergy-banner', name: '알레르기 배너', slot: 'patient-header', component: '@hospital-run/ext-allergy', order: 1, enabled: true },
    { id: 'ext-lab-trend', name: '검사 추이 차트', slot: 'patient-chart-main', component: '@hospital-run/ext-lab-trend', order: 2, enabled: true },
  ];

  /** 레지스트리 전체의 운영 사실 — 화면 상단 배너가 이 값을 그대로 말한다 */
  registryStatus() {
    const all = this.extensions;
    return {
      persisted: false,
      storage: 'IN_MEMORY' as const,
      total: all.length,
      installed: all.filter((e) => INSTALLED_COMPONENTS.has(e.component)).length,
      rendererWired: INSTALLED_COMPONENTS.size > 0,
      note: '확장 레지스트리는 프로세스 메모리에만 있습니다(서버 재시작 시 초기화). 슬롯 렌더러가 배선되어 있지 않아 등재된 확장은 실제 화면에 그려지지 않습니다.',
    };
  }

  private view(e: Extension): ExtensionView {
    const installed = INSTALLED_COMPONENTS.has(e.component);
    return {
      ...e,
      installed,
      persisted: false,
      effectiveStatus: !e.enabled ? 'DISABLED' : installed ? 'ACTIVE' : 'NOT_INSTALLED',
    };
  }

  getSlots() {
    const slots = [...new Set(this.extensions.map(e => e.slot))];
    return slots.map(slot => ({
      slot,
      extensions: this.extensions.filter(e => e.slot === slot && e.enabled).sort((a, b) => a.order - b.order).map(e => this.view(e)),
    }));
  }

  getExtensionsForSlot(slot: string) {
    return this.extensions.filter(e => e.slot === slot && e.enabled).sort((a, b) => a.order - b.order).map(e => this.view(e));
  }

  getAllExtensions() { return this.extensions.map(e => this.view(e)); }

  toggleExtension(id: string) {
    const ext = this.extensions.find(e => e.id === id);
    if (!ext) return undefined;
    ext.enabled = !ext.enabled;
    return this.view(ext);
  }

  registerExtension(ext: Omit<Extension, 'id'>) {
    const newExt = { ...ext, id: `ext-${Date.now()}` };
    this.extensions.push(newExt);
    return this.view(newExt);
  }
}
