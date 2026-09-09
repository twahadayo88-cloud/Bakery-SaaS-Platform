export interface OrganizationFormatting {
  currency?: string;
  locale?: string;
  timezone?: string;
}

const defaultFormatting: Required<OrganizationFormatting> = {
  currency: 'BRL',
  locale: 'en-US',
  timezone: 'UTC',
};

function getFormatting(overrides?: OrganizationFormatting): Required<OrganizationFormatting> {
  let stored: OrganizationFormatting = {};
  try {
    stored = typeof localStorage === 'undefined'
      ? {}
      : JSON.parse(localStorage.getItem('jb_organization_formatting') || '{}');
  } catch {
    stored = {};
  }
  return { ...defaultFormatting, ...stored, ...overrides };
}

export function setOrganizationFormatting(formatting: OrganizationFormatting): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('jb_organization_formatting', JSON.stringify(formatting));
  }
}

export function formatCurrency(value: number | null | undefined, options?: OrganizationFormatting): string {
  const formatting = getFormatting(options);
  return new Intl.NumberFormat(formatting.locale, {
    style: 'currency',
    currency: formatting.currency,
  }).format(value ?? 0);
}

export function formatBRL(value: number | null | undefined): string {
  return formatCurrency(value);
}

export function formatNumber(value: number | null | undefined, decimals: number = 2, options?: OrganizationFormatting): string {
  const formatting = getFormatting(options);
  return (value ?? 0).toLocaleString(formatting.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDate(value: string | number | Date, options?: OrganizationFormatting): string {
  const formatting = getFormatting(options);
  return new Intl.DateTimeFormat(formatting.locale, {
    dateStyle: 'medium',
    timeZone: formatting.timezone,
  }).format(new Date(value));
}

export function formatTime(value: string | number | Date, options?: OrganizationFormatting): string {
  const formatting = getFormatting(options);
  return new Intl.DateTimeFormat(formatting.locale, {
    timeStyle: 'short',
    timeZone: formatting.timezone,
  }).format(new Date(value));
}

export function toMinorUnits(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

export function fromMinorUnits(value: number): number {
  return value / 100;
}
