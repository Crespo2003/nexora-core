export type Language = 'en' | 'zh' | 'bilingual';

export type UtilityProvider = 'tnb' | 'water' | 'iwk' | 'wifi' | 'aircond' | 'other';

export type CollectionStatus =
  | 'pending'
  | 'due'
  | 'paid'
  | 'partial'
  | 'outstanding'
  | 'overdue'
  | 'waived'
  | 'disputed';

export type PaymentMethod = 'bank_transfer' | 'cash' | 'duitnow' | 'touch_n_go' | 'cheque' | 'online_banking' | 'other';

export type TransactionType = 'payment' | 'adjustment' | 'waiver' | 'refund' | 'reversal';

export type UtilityAccount = {
  id: string;
  tenancyId: string;
  propertyId?: string;
  property: string;
  provider: UtilityProvider;
  accountNumber: string;
  accountNumberMasked: string;
  meterNumber: string;
  registeredName: string;
  billingAddress: string;
  recurringFee: number;
  accountStatus: 'active' | 'inactive' | 'changed';
  validFrom: string;
  validTo?: string;
};

export type TenancySummary = {
  id: string;
  tenant: string;
  tenantPhone: string;
  preferredLanguage: Language;
  landlord: string;
  landlordPhone: string;
  assignedAgent: string;
  property: string;
  unitNo: string;
  monthlyRental: number;
  expiryDate: string;
  status: string;
  rentalDueDay: number;
  gracePeriodDays: number;
  autoGenerateCollections: boolean;
  collectionStartMonth: string;
  collectionEndMonth: string;
};

export type CollectionPayment = {
  id: string;
  collectionId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  paymentReference: string;
  receiptNumber: string;
  notes: string;
  transactionType: TransactionType;
  createdAt: string;
};

export type SmartCollection = {
  id: string;
  tenancyId: string;
  collectionMonth: string;
  dueDate: string;
  rentalAmount: number;
  tnbAmount: number;
  waterAmount: number;
  iwkAmount: number;
  wifiAmount: number;
  aircondAmount: number;
  otherCharges: number;
  lateCharges: number;
  adjustments: number;
  status: CollectionStatus;
  notes: string;
  lastReminderDate?: string;
  reminderCount: number;
  paymentLedger: CollectionPayment[];
  utilityBillIds: string[];
};

export type UtilityBillExtraction = {
  provider: UtilityProvider | 'not_detected';
  accountNumber: string;
  meterNumber: string;
  registeredName: string;
  serviceAddress: string;
  billNumber: string;
  billDate: string;
  billingPeriod: string;
  dueDate: string;
  previousBalance: number | null;
  currentCharges: number | null;
  adjustments: number | null;
  tax: number | null;
  totalAmountDue: number | null;
  paymentStatus: string;
  referenceNumber: string;
  rawText: string;
  confidence: 'high' | 'medium' | 'low' | 'not_detected';
  sourceFilename: string;
};

export type GenerationResult = {
  success: boolean;
  created: Array<{ tenancyId: string; collectionMonth: string }>;
  skipped: Array<{ tenancyId: string; reason: string }>;
  failed: Array<{ tenancyId: string; reason: string }>;
};
