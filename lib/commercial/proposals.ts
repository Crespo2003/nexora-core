import { formatMYR } from '../formatters';

export type ProposalListing = {
  title: string;
  area?: string;
  builtUp?: number | null;
  askingRental?: number | null;
  askingSalePrice?: number | null;
  score?: number | null;
};

export function formatProposalText(listings: ProposalListing[], language: 'en' | 'zh' | 'bilingual') {
  const english = ['Nexora commercial property shortlist', '', ...listings.map((item, index) => `${index + 1}. ${item.title}\nArea: ${item.area || 'To verify'} | Size: ${size(item.builtUp)} | Price: ${price(item)} | Match: ${item.score ?? '-'}%`), '', 'Please let me know which properties you would like to view.'].join('\n');
  const chinese = ['Nexora 商业物业推荐清单', '', ...listings.map((item, index) => `${index + 1}. ${item.title}\n地区：${item.area || '待确认'} | 面积：${size(item.builtUp)} | 价格：${price(item)} | 匹配：${item.score ?? '-'}%`), '', '请告诉我您想安排看房的物业。'].join('\n');
  if (language === 'en') return english;
  if (language === 'zh') return chinese;
  return `${english}\n\n---\n\n${chinese}`;
}

function size(value?: number | null) { return value == null ? 'To verify / 待确认' : `${value.toLocaleString('en-MY')} sq ft`; }
function price(item: ProposalListing) {
  const value = item.askingRental ?? item.askingSalePrice;
  return value == null ? 'To verify / 待确认' : formatMYR(value);
}
