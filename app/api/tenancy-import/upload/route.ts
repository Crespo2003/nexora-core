import { createTenancyUploadHandler } from '../../../../lib/tenancy/tenancyUploadHandler';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = createTenancyUploadHandler();
