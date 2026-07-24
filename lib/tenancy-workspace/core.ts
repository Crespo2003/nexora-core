import type { CollectionRecord, TimelineEvent } from './types';
import { formatMYR } from '../formatters';

export function calculateDaysRemaining(expiryDate: string, today = new Date()) {
  const expiry = new Date(`${expiryDate}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return 0;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.ceil((expiry.getTime() - start) / 86_400_000);
}

export function formatWorkspaceMoney(value: number | string | null | undefined) {
  return formatMYR(value);
}

export function confidencePercent(confidence: unknown) {
  if (typeof confidence === 'number') {
    return Math.round((confidence <= 1 ? confidence * 100 : confidence));
  }
  if (typeof confidence === 'string') {
    const value = Number.parseFloat(confidence);
    if (Number.isFinite(value)) return Math.round(value <= 1 ? value * 100 : value);
    if (confidence === 'high') return 90;
    if (confidence === 'medium') return 70;
    if (confidence === 'low') return 40;
  }
  return 0;
}

export function collectionOutstanding(collections: CollectionRecord[]) {
  return collections.reduce((sum, collection) => sum + Number(collection.outstanding_balance || 0), 0);
}

export function sortTimeline(events: TimelineEvent[]) {
  return [...events].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function titleForActivity(type: string) {
  const labels: Record<string, string> = {
    tenancy_created: 'Tenancy created',
    collection_generated: 'Collection generated',
    reminder_sent: 'Reminder sent',
    reminder_created: 'Reminder generated',
    payment_recorded: 'Payment received',
    document_uploaded: 'Document uploaded',
    extraction_completed: 'AI extraction completed',
    extraction_corrected: 'Extraction correction saved',
    tenancy_auto_populated: 'Tenancy fields populated',
    utility_account_created: 'Utility account added',
    utility_account_updated: 'Utility updated',
    utility_account_changed: 'Utility account changed',
    utility_updated: 'Utility bill updated',
    payment_refunded: 'Payment refunded',
    payment_reversed: 'Payment reversed'
  };
  return labels[type] ?? type.replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase());
}
