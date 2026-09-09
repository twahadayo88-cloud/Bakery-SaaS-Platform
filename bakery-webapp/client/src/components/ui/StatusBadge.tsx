import React from 'react';

export type StatusType =
  | 'active'
  | 'pending'
  | 'confirmed'
  | 'production'
  | 'ready'
  | 'delivered'
  | 'cancelled'
  | 'paid'
  | 'unpaid'
  | 'partial'
  | 'trialing'
  | 'past_due'
  | 'failed'
  | 'completed'
  | 'refunded'
  | 'preparing'
  | 'inactive'
  | 'archived';

const statusColorMap: Record<StatusType, { bg: string; text: string }> = {
  // Positive statuses - Green
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  paid: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  delivered: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  ready: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },

  // Warning statuses - Amber
  pending: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  trialing: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  partial: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  preparing: { bg: 'bg-amber-500/20', text: 'text-amber-400' },

  // Negative statuses - Red
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400' },
  unpaid: { bg: 'bg-red-500/20', text: 'text-red-400' },
  past_due: { bg: 'bg-red-500/20', text: 'text-red-400' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400' },
  refunded: { bg: 'bg-red-500/20', text: 'text-red-400' },

  // Info statuses - Blue
  confirmed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  production: { bg: 'bg-blue-500/20', text: 'text-blue-400' },

  // Neutral statuses - Gray
  inactive: { bg: 'bg-surface-700', text: 'text-surface-300' },
  archived: { bg: 'bg-surface-700', text: 'text-surface-300' },
};

const statusLabelMap: Record<StatusType, string> = {
  active: 'Active',
  pending: 'Pending',
  confirmed: 'Confirmed',
  production: 'Production',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  paid: 'Paid',
  unpaid: 'Unpaid',
  partial: 'Partial',
  trialing: 'Trial',
  past_due: 'Past Due',
  failed: 'Failed',
  completed: 'Completed',
  refunded: 'Refunded',
  preparing: 'Preparing',
  inactive: 'Inactive', // <- yahan 'I' capital tha, theek kar diya
  archived: 'Archived',
};

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  className = '',
}: StatusBadgeProps) {
  const colors = statusColorMap[status] || statusColorMap.inactive;
  const displayLabel = label || statusLabelMap[status];

  return (
    <span
      className={`badge text-xs font-medium ${colors.bg} ${colors.text} ${className}`}
    >
      {displayLabel}
    </span>
  );
}