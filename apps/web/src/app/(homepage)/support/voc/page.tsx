import { CmsCategoryPage } from '@/components/homepage/CmsCategoryPage';
import VocIntake from './VocIntake';

export default function VocPage() {
  return (
    <div className="space-y-8">
      <VocIntake />
      <CmsCategoryPage category="VOC" pageTitle="고객의 소리" pageDescription="칭찬, 건의, 불만 접수를 안내합니다" renderMode="list" />
    </div>
  );
}
