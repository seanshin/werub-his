/**
 * 언어 팩 등재부 — **새 언어는 여기 한 줄**(작성법은 이 폴더의 README.md).
 * 빌트인 팩(en/ja/ar)은 영역 카탈로그에서 자동 조립되므로 여기 없다(`messages/registry.ts`).
 *
 * 🔴 등재 순서는 화면 선택지 순서다(ko 다음부터). 사용 빈도·기관 특성 순으로 둔다.
 */
import { registerLocalePack } from '../pack';
import { ZH_PACK } from './zh';
import { RU_PACK } from './ru';
import { VI_PACK } from './vi';
import { KK_PACK } from './kk';
import { MN_PACK } from './mn';
import { TH_PACK } from './th';

registerLocalePack(ZH_PACK);
registerLocalePack(RU_PACK);
registerLocalePack(VI_PACK);
registerLocalePack(KK_PACK);
registerLocalePack(MN_PACK);
registerLocalePack(TH_PACK);
