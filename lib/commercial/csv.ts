export type CsvPreview = { headers: string[]; rows: Record<string, string>[]; errors: Array<{ row: number; message: string }>; duplicates: number[] };

export function previewCommercialCsv(csv: string, required: string[], identityFields: string[]): CsvPreview {
  const lines = parseCsv(csv);
  if (!lines.length) return { headers: [], rows: [], errors: [{ row: 0, message: 'empty-file' }], duplicates: [] };
  const headers = lines[0].map((item) => sanitizeCsvText(item).toLowerCase());
  const errors: CsvPreview['errors'] = [];
  if (headers.length !== new Set(headers).size) errors.push({ row: 1, message: 'duplicate-column' });
  if (lines.length > 501) errors.push({ row: 0, message: 'row-limit-exceeded:500' });
  required.filter((field) => !headers.includes(field)).forEach((field) => errors.push({ row: 1, message: `missing-column:${field}` }));
  const rows = lines.slice(1, 501).map((line, sourceIndex) => ({ line, sourceIndex })).filter(({ line }) => line.some(Boolean)).map(({ line, sourceIndex }) => ({
    ...Object.fromEntries(headers.map((header, index) => [header, sanitizeCsvText(line[index] ?? '')])),
    __rowNumber: String(sourceIndex + 2)
  }));
  const seen = new Set<string>();
  const duplicates: number[] = [];
  rows.forEach((row) => {
    const rowNumber = Number(row.__rowNumber);
    required.filter((field) => !row[field]).forEach((field) => errors.push({ row: rowNumber, message: `required:${field}` }));
    const key = identityFields.map((field) => row[field]?.toLowerCase()).join('|');
    if (key && seen.has(key)) duplicates.push(rowNumber); else if (key) seen.add(key);
  });
  return { headers, rows, errors, duplicates };
}

export function toCsv(rows: Record<string, unknown>[], allowedFields: string[]) {
  const escape = (value: unknown) => { const raw = Array.isArray(value) ? value.join('; ') : String(value ?? ''); const text = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw; return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [allowedFields.join(','), ...rows.map((row) => allowedFields.map((field) => escape(row[field])).join(','))].join('\n');
}

export function sanitizeCsvText(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 5000);
}

export function validateCommercialImportRow(resource: string, row: Record<string, string>) {
  const errors: string[] = [];
  const numericFields = ['min_built_up','max_built_up','min_land_area','max_land_area','target_rental','max_rental','target_purchase_price','max_purchase_price','built_up','land_area','asking_rental','asking_sale_price','maintenance_fee','frontage','ceiling_height','parking'];
  numericFields.forEach((field) => { if (row[field] && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)) errors.push(`invalid-number:${field}`); });
  const uuidFields = ['company_id','brand_id','contact_id'];
  uuidFields.forEach((field) => { if (row[field] && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row[field])) errors.push(`invalid-id:${field}`); });
  const enums: Record<string, string[]> = {
    transaction_type: ['rent','sale','either'], confidentiality_level: ['normal','internal_only','restricted','highly_confidential'],
    urgency: ['immediate','within_30_days','within_60_days','within_90_days','exploratory'],
    requirement_type: ['retail','restaurant','cafe','showroom','commercial_bungalow','office','warehouse','industrial','land','mall_lot','shoplot','hotel','mixed_use','other'],
    status: resource === 'listings' ? ['draft','active','under_offer','reserved','rented','sold','temporarily_unavailable','expired','archived'] : []
  };
  Object.entries(enums).forEach(([field, allowed]) => { if (allowed.length && row[field] && !allowed.includes(row[field])) errors.push(`invalid-value:${field}`); });
  if (row.min_built_up && row.max_built_up && Number(row.min_built_up) > Number(row.max_built_up)) errors.push('invalid-range:built_up');
  if (row.min_land_area && row.max_land_area && Number(row.min_land_area) > Number(row.max_land_area)) errors.push('invalid-range:land_area');
  return errors;
}

function parseCsv(value: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"' && quoted && value[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && value[index + 1] === '\n') index += 1; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row); return rows;
}
