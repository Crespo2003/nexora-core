import { formatMYR } from '../formatters';
import { formatNexoraDate } from '../dates/formatDate';

export type WhatsAppTemplateType =
  | 'rental_due_soon'
  | 'rental_overdue'
  | 'partial_payment'
  | 'utility_outstanding'
  | 'payment_promised'
  | 'payment_confirmation'
  | 'receipt_issued'
  | 'renewal_approaching'
  | 'notice_required'
  | 'tenancy_expiry'
  | 'general_follow_up';

export type WhatsAppLanguage = 'en' | 'zh' | 'bilingual';

export type WhatsAppTemplateVariables = Partial<{
  tenant_name: string;
  landlord_name: string;
  contact_name: string;
  property_name: string;
  unit_number: string;
  monthly_rental: unknown;
  amount_due: unknown;
  outstanding_amount: unknown;
  due_date: unknown;
  tenancy_expiry_date: unknown;
  payment_reference: string;
  agent_name: string;
  agent_phone: string;
  workspace_name: string;
}>;

export const whatsappTemplateTypes: WhatsAppTemplateType[] = [
  'rental_due_soon', 'rental_overdue', 'partial_payment', 'utility_outstanding', 'payment_promised',
  'payment_confirmation', 'receipt_issued', 'renewal_approaching', 'notice_required', 'tenancy_expiry',
  'general_follow_up'
];

const moneyKeys = new Set(['monthly_rental', 'amount_due', 'outstanding_amount']);
const dateKeys = new Set(['due_date', 'tenancy_expiry_date']);

type FormattedVars = Record<keyof WhatsAppTemplateVariables, string>;

/** Never fabricates a value: unknown money is blank (never zero) and unknown dates are blank. */
function formatVariable(key: keyof WhatsAppTemplateVariables, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (moneyKeys.has(key)) return formatMYR(value, '');
  if (dateKeys.has(key)) return formatNexoraDate(value, '');
  const text = String(value).trim();
  return text;
}

function formatAll(variables: WhatsAppTemplateVariables): FormattedVars {
  const keys: (keyof WhatsAppTemplateVariables)[] = [
    'tenant_name', 'landlord_name', 'contact_name', 'property_name', 'unit_number', 'monthly_rental',
    'amount_due', 'outstanding_amount', 'due_date', 'tenancy_expiry_date', 'payment_reference',
    'agent_name', 'agent_phone', 'workspace_name'
  ];
  const result = {} as FormattedVars;
  keys.forEach((key) => { result[key] = formatVariable(key, variables[key]); });
  return result;
}

/** Resolves the greeting name without ever inventing one. */
function greetingName(fv: FormattedVars): string {
  return fv.contact_name || fv.tenant_name || fv.landlord_name || '';
}

/** A `label: value` line that disappears entirely when the value is unknown, per Nexora rule. */
function line(labelEn: string, labelZh: string, value: string, lang: 'en' | 'zh'): string {
  if (!value) return '';
  return lang === 'zh' ? `${labelZh}：${value}` : `${labelEn}: ${value}`;
}

function propertyLine(fv: FormattedVars, lang: 'en' | 'zh'): string {
  const parts = [fv.property_name, fv.unit_number].filter(Boolean);
  if (!parts.length) return '';
  return lang === 'zh' ? `产业：${parts.join(' ')}` : `Property: ${parts.join(' ')}`;
}

function signature(fv: FormattedVars): string {
  const parts = [fv.agent_name, fv.workspace_name].filter(Boolean);
  if (!parts.length) return '';
  return `\n${parts.join(' - ')}`;
}

function greet(fv: FormattedVars, lang: 'en' | 'zh'): string {
  const name = greetingName(fv);
  if (lang === 'zh') return name ? `您好 ${name}，` : '您好，';
  return name ? `Hi ${name},` : 'Hi,';
}

function assemble(lines: string[]): string {
  return lines.filter((entry) => entry.trim().length > 0).join('\n');
}

type TemplateDefinition = { en: (fv: FormattedVars) => string; zh: (fv: FormattedVars) => string };

const templates: Record<WhatsAppTemplateType, TemplateDefinition> = {
  rental_due_soon: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'This is a friendly reminder that your rental payment is coming up soon.',
      propertyLine(fv, 'en'), line('Monthly rental', '月租', fv.monthly_rental, 'en'), line('Due date', '到期日', fv.due_date, 'en'),
      '', 'Kindly make payment by the due date. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '温馨提醒您租金即将到期。',
      propertyLine(fv, 'zh'), line('月租', '月租', fv.monthly_rental, 'zh'), line('到期日', '到期日', fv.due_date, 'zh'),
      '', '请在到期日前完成付款，谢谢。', signature(fv)
    ])
  },
  rental_overdue: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'Our records show your rental payment is now overdue.',
      propertyLine(fv, 'en'), line('Amount due', '应付金额', fv.amount_due, 'en'), line('Due date', '到期日', fv.due_date, 'en'),
      '', 'Kindly arrange payment as soon as possible. If you have already paid, please share proof of payment. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '我们的记录显示您的租金已逾期。',
      propertyLine(fv, 'zh'), line('应付金额', '应付金额', fv.amount_due, 'zh'), line('到期日', '到期日', fv.due_date, 'zh'),
      '', '请尽快安排付款。若您已经付款，请提供付款证明。谢谢。', signature(fv)
    ])
  },
  partial_payment: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'Thank you for your recent payment. There is a remaining balance on your account.',
      propertyLine(fv, 'en'), line('Outstanding balance', '未结余额', fv.outstanding_amount, 'en'), line('Due date', '到期日', fv.due_date, 'en'),
      '', 'Kindly settle the remaining balance at your earliest convenience. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '感谢您最近的付款，您的账户仍有余额未结清。',
      propertyLine(fv, 'zh'), line('未结余额', '未结余额', fv.outstanding_amount, 'zh'), line('到期日', '到期日', fv.due_date, 'zh'),
      '', '请尽快结清剩余余额。谢谢。', signature(fv)
    ])
  },
  utility_outstanding: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'This is a reminder about an outstanding utility bill.',
      propertyLine(fv, 'en'), line('Amount due', '应付金额', fv.amount_due, 'en'), line('Due date', '到期日', fv.due_date, 'en'),
      '', 'Kindly settle the utility bill by the due date. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '温馨提醒您有未结的水电账单。',
      propertyLine(fv, 'zh'), line('应付金额', '应付金额', fv.amount_due, 'zh'), line('到期日', '到期日', fv.due_date, 'zh'),
      '', '请在到期日前结清水电账单。谢谢。', signature(fv)
    ])
  },
  payment_promised: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'Thank you for confirming your payment plan.',
      propertyLine(fv, 'en'), line('Amount due', '应付金额', fv.amount_due, 'en'), line('Promised date', '承诺日期', fv.due_date, 'en'),
      '', 'We look forward to receiving your payment by the date above. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '感谢您确认付款安排。',
      propertyLine(fv, 'zh'), line('应付金额', '应付金额', fv.amount_due, 'zh'), line('承诺日期', '承诺日期', fv.due_date, 'zh'),
      '', '期待您在上述日期前完成付款。谢谢。', signature(fv)
    ])
  },
  payment_confirmation: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'We confirm that your payment has been received.',
      propertyLine(fv, 'en'), line('Amount received', '已收金额', fv.amount_due, 'en'), line('Reference', '参考编号', fv.payment_reference, 'en'),
      '', 'Thank you for your payment.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '我们确认已收到您的付款。',
      propertyLine(fv, 'zh'), line('已收金额', '已收金额', fv.amount_due, 'zh'), line('参考编号', '参考编号', fv.payment_reference, 'zh'),
      '', '感谢您的付款。', signature(fv)
    ])
  },
  receipt_issued: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'Your receipt has been issued.',
      propertyLine(fv, 'en'), line('Amount', '金额', fv.amount_due, 'en'), line('Receipt reference', '收据编号', fv.payment_reference, 'en'),
      '', 'Please let us know if you need any further documentation. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '您的收据已开出。',
      propertyLine(fv, 'zh'), line('金额', '金额', fv.amount_due, 'zh'), line('收据编号', '收据编号', fv.payment_reference, 'zh'),
      '', '如需其他文件，请告知我们。谢谢。', signature(fv)
    ])
  },
  renewal_approaching: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'Your tenancy renewal date is approaching.',
      propertyLine(fv, 'en'), line('Tenancy expiry', '租约到期日', fv.tenancy_expiry_date, 'en'), line('Monthly rental', '月租', fv.monthly_rental, 'en'),
      '', 'Please let us know if you would like to renew or if you have any questions. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '您的租约续约日期即将到来。',
      propertyLine(fv, 'zh'), line('租约到期日', '租约到期日', fv.tenancy_expiry_date, 'zh'), line('月租', '月租', fv.monthly_rental, 'zh'),
      '', '如需续约或有任何疑问，请告知我们。谢谢。', signature(fv)
    ])
  },
  notice_required: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'This is a reminder regarding the notice period for your tenancy.',
      propertyLine(fv, 'en'), line('Tenancy expiry', '租约到期日', fv.tenancy_expiry_date, 'en'),
      '', 'Kindly confirm your intentions in writing within the notice period stated in your agreement. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '提醒您留意租约中的通知期规定。',
      propertyLine(fv, 'zh'), line('租约到期日', '租约到期日', fv.tenancy_expiry_date, 'zh'),
      '', '请在租约所列的通知期内以书面方式确认您的意向。谢谢。', signature(fv)
    ])
  },
  tenancy_expiry: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'This is a reminder that your tenancy is due to expire.',
      propertyLine(fv, 'en'), line('Tenancy expiry', '租约到期日', fv.tenancy_expiry_date, 'en'),
      '', 'Please contact us to discuss next steps. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '提醒您租约即将到期。',
      propertyLine(fv, 'zh'), line('租约到期日', '租约到期日', fv.tenancy_expiry_date, 'zh'),
      '', '请联系我们商讨下一步安排。谢谢。', signature(fv)
    ])
  },
  general_follow_up: {
    en: (fv) => assemble([
      greet(fv, 'en'), '', 'This is a follow-up regarding your tenancy.',
      propertyLine(fv, 'en'),
      '', 'Please let us know if you have any questions. Thank you.', signature(fv)
    ]),
    zh: (fv) => assemble([
      greet(fv, 'zh'), '', '就您的租约进行跟进。',
      propertyLine(fv, 'zh'),
      '', '如有任何疑问，请告知我们。谢谢。', signature(fv)
    ])
  }
};

/**
 * Renders a bilingual-ready WhatsApp message. Unknown/blank variables are omitted entirely
 * rather than shown as an empty placeholder, and money/date variables always render in the
 * Nexora RM 12,500.00 and DD/MM/YYYY formats.
 */
export function renderWhatsAppTemplate(
  templateType: WhatsAppTemplateType,
  language: WhatsAppLanguage,
  variables: WhatsAppTemplateVariables
): string {
  const definition = templates[templateType];
  if (!definition) return '';
  const fv = formatAll(variables);
  const english = definition.en(fv);
  const chinese = definition.zh(fv);
  if (language === 'zh') return chinese;
  if (language === 'bilingual') return `${english}\n\n---\n\n${chinese}`;
  return english;
}
