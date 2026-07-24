import type { WorkspaceRole } from '../rbac/permissions';
import { maskCrmContact } from './permissions';

export const CRM_READ_ROLES: WorkspaceRole[] = ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'];
export const CRM_WRITE_ROLES: WorkspaceRole[] = ['owner', 'admin', 'agent'];

export function crmError(status: number, code: string, details?: Record<string, unknown>) {
  return Response.json({
    success: false,
    error: code,
    message: {
      en: 'The CRM request could not be completed.',
      zh: '无法完成 CRM 请求。',
    },
    ...details,
  }, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}

export function protectCrmContact<T extends Record<string, unknown>>(row: T, role: WorkspaceRole) {
  if (!['finance', 'viewer'].includes(role)) return row;
  return {
    ...row,
    phone_original: maskCrmContact(String(row.phone_original ?? '')),
    phone_normalized: maskCrmContact(String(row.phone_normalized ?? '')),
    whatsapp_number: maskCrmContact(String(row.whatsapp_number ?? '')),
    email: maskCrmContact(String(row.email ?? '')),
    address: '',
    identification_number: '',
    registration_number: '',
    notes: '',
  };
}

export function safePage(searchParams: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(searchParams.get('page') ?? 1) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(searchParams.get('pageSize') ?? 25) || 25)));
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

export function escapePostgrestSearch(value: string) {
  return value.replace(/[,%()]/g, ' ').slice(0, 100);
}

export function createRecordNumber(prefix: string) {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const random = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}
