export type TaxType = 'VAT' | 'GST' | 'Sales Tax' | 'Other';
export type DiscountType = 'fixed' | 'percentage';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';

export interface TaxSettings {
  name?: string | null;
  type?: TaxType | string | null;
  rate?: number | null;
  inclusive?: boolean | number | null;
}

export interface DiscountInput {
  type?: DiscountType;
  value?: number;
}

export interface MoneyBreakdown {
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: ProviderPaymentInput): Promise<ProviderPaymentResult>;
  refundPayment(transactionId: string, amountMinor?: number): Promise<ProviderPaymentResult>;
}

export interface ProviderPaymentInput {
  transactionId?: string;
  amountMinor: number;
  currency: string;
  paymentMethod?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderPaymentResult {
  transactionId: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  provider: string;
  metadata?: Record<string, unknown>;
}

export class MAnnualPaymentProvider implements PaymentProvider {
  readonly name = 'mAnnual';

  async createPayment(input: ProviderPaymentInput): Promise<ProviderPaymentResult> {
    return { ...input, transactionId: input.transactionId || `mAnnual-${Date.now()}`, status: 'paid', provider: this.name };
  }

  async refundPayment(transactionId: string, amountMinor = 0): Promise<ProviderPaymentResult> {
    return { transactionId, status: 'refunded', amountMinor, currency: 'XXX', provider: this.name };
  }
}

export function toMinorUnits(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100);
}

export function fromMinorUnits(value: number): number {
  return value / 100;
}

export function calculateDiscount(subtotalMinor: number, discount: DiscountInput = {}): number {
  const value = Math.max(0, Number(discount.value || 0));
  if (discount.type === 'percentage') return Math.min(subtotalMinor, Math.round(subtotalMinor * Math.min(value, 100) / 100));
  return Math.min(subtotalMinor, toMinorUnits(value));
}

export function calculateTax(taxableMinor: number, settings: TaxSettings = {}): number {
  const rate = Math.max(0, Number(settings.rate || 0));
  if (!rate || taxableMinor <= 0) return 0;
  if (Boolean(settings.inclusive)) return Math.max(0, taxableMinor - Math.round(taxableMinor / (1 + rate / 100)));
  return Math.round(taxableMinor * rate / 100);
}

export function calculateOrderTotals(subtotalMinor: number, discount: DiscountInput, tax: TaxSettings): MoneyBreakdown {
  const discountMinor = calculateDiscount(subtotalMinor, discount);
  const taxableMinor = Math.max(0, subtotalMinor - discountMinor);
  const taxMinor = calculateTax(taxableMinor, tax);
  return {
    subtotalMinor,
    discountMinor,
    taxableMinor,
    taxMinor,
    totalMinor: Boolean(tax.inclusive) ? taxableMinor : taxableMinor + taxMinor,
  };
}

export function generateInvoiceNumber(organizationId: string, sequence: number): string {
  return `INV-${organizationId.slice(0, 8).toUpperCase()}-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`;
}