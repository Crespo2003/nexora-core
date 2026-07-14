export type TenancyWorkspaceStatus = 'active' | 'expired' | 'terminated' | 'draft';
export type OccupancyStatus = 'occupied' | 'vacant';

export type TenancyRecord = {
  id: string;
  workspace_id: string;
  tenant: string;
  tenant_id_no: string;
  tenant_phone: string;
  tenant_email: string;
  tenant_nationality: string;
  tenant_emergency_contact: string;
  tenant_company: string;
  tenant_occupation: string;
  tenant_identity_expiry: string | null;
  landlord: string;
  landlord_id_no: string;
  landlord_phone: string;
  landlord_email: string;
  landlord_bank_account: string;
  landlord_emergency_contact: string;
  landlord_preferred_language: 'en' | 'zh' | 'bilingual';
  insurance_expiry: string | null;
  property: string;
  unit_no: string;
  property_address: string;
  property_type: string;
  occupancy_status: OccupancyStatus;
  monthly_rental: number;
  security_deposit: number;
  utility_deposit: number;
  access_card_deposit: number;
  car_park_remote_deposit: number;
  rental_due_day: number;
  commencement_date: string;
  expiry_date: string;
  move_in_date: string | null;
  renewal_reminder: string | null;
  renewal_option: string;
  notice_period: string;
  special_clauses: string;
  notes: string;
  preferred_language: 'en' | 'zh' | 'bilingual';
  status: TenancyWorkspaceStatus;
  created_at: string;
  updated_at: string;
};

export type CollectionRecord = {
  id: string;
  tenancy_id: string;
  collection_month: string;
  due_date: string;
  rental_amount: number;
  tnb_amount: number;
  water_amount: number;
  iwk_amount: number;
  wifi_amount: number;
  aircond_amount: number;
  other_charges: number;
  late_charges: number;
  adjustments: number;
  total_due: number;
  amount_paid: number;
  outstanding_balance: number;
  payment_status: string;
  overpayment_credit: number;
  updated_at: string;
};

export type UtilityAccountRecord = {
  id: string;
  tenancy_id: string | null;
  provider: string;
  account_number: string;
  account_number_masked: string;
  meter_number: string;
  registered_name: string;
  recurring_fee: number;
  account_status: string;
  updated_at: string;
  history: Array<Record<string, unknown>>;
};

export type DocumentRecord = {
  id: string;
  original_filename: string;
  document_type: string;
  mime_type: string;
  file_size: number;
  processing_status: string;
  processing_attempts: number;
  last_processing_error: string;
  uploaded_at: string;
  extraction: DocumentExtractionRecord | null;
};

export type DocumentExtractionRecord = {
  id: string;
  document_id: string;
  extracted_json: Record<string, unknown>;
  confidence_json: Record<string, unknown>;
  ai_summary: string;
  raw_text: string;
  extraction_status: string;
  updated_at: string;
};

export type TimelineEvent = {
  id: string;
  type: string;
  title: string;
  detail: string;
  createdAt: string;
};

export type WorkspaceWarning = {
  code: string;
  severity: 'info' | 'warning' | 'danger';
  message: string;
};

export type CollectionPaymentRecord = {
  id: string;
  rental_collection_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  payment_reference: string;
  transaction_type: string;
  created_at: string;
};

export type WorkspaceDashboard = {
  rentalDue: number;
  utilitiesDue: number;
  outstanding: number;
  expiringSoon: number;
  renewals: number;
  documentsMissing: number;
};

export type TenancyWorkspaceData = {
  tenancy: TenancyRecord;
  collections: CollectionRecord[];
  currentCollection: CollectionRecord | null;
  utilityAccounts: UtilityAccountRecord[];
  utilityBills: Array<Record<string, unknown>>;
  documents: DocumentRecord[];
  collectionPayments: CollectionPaymentRecord[];
  warnings: WorkspaceWarning[];
  dashboard: WorkspaceDashboard;
  timeline: TimelineEvent[];
  role: string;
};

export type TenancySearchResult = {
  id: string;
  tenant: string;
  landlord: string;
  property: string;
  unitNo: string;
  occupancyStatus: OccupancyStatus;
  status: string;
  expiryDate: string;
  outstanding: number;
};
