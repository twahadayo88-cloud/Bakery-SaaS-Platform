import React, { useState, useEffect } from 'react';
import { DollarSign, Plus, AlertTriangle, Filter, CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';
import { formatBRL } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';

interface Payment {
  id: string;
  order_number?: string;
  Customer_name?: string;
  amount: number;
  method: 'pix' | 'cash' | 'card';
  reference?: string;
  notes?: string;
  created_at: string;
}

interface PaymentSummary {
  total_received: number;
  pix_total: number;
  cash_total: number;
  card_total: number;
  month_total: number;
  payments: Payment[];
}

const Payments = () => {
  const { organization } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PaymentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    orderId: '',
    CustomerId: '',
    amount: '',
    method: 'pix' as const,
    reference: '',
    notes: '',
  });

  const currencyCode = organization?.currency || 'BRL';

  useEffect(() => {
    fetchPayments();
  }, []);

  const resetForm = () => {
    setFormData({
      orderId: '',
      CustomerId: '',
      amount: '',
      method: 'pix',
      reference: '',
      notes: '',
    });
  };

  const closePaymentModal = () => {
    setShowModal(false);
    setFormError(null);
  };

  const fetchPayments = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/baker/payments');
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const numericAmount = Number(formData.amount);
    if (!formData.amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('Enter a valid payment amount greater than 0.');
      return;
    }

    if (!formData.method) {
      setFormError('Select a payment method.');
      return;
    }

    try {
      setIsSubmitting(true);
      await api.post('/baker/payments', {
        orderId: formData.orderId || undefined,
        CustomerId: formData.CustomerId || undefined,
        amount: numericAmount,
        method: formData.method,
        reference: formData.reference || undefined,
        notes: formData.notes || undefined,
      });

      resetForm();
      closePaymentModal();
      setSuccessMessage('Payment added successfully.');
      await fetchPayments();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'pix':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'cash':
        return 'bg-blue-500/20 text-blue-400';
      case 'card':
        return 'bg-purple-500/20 text-purple-400';
      default:
        return 'bg-surface-700 text-surface-300';
    }
  };

  const getMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      pix: 'PIX',
      cash: 'Cash',
      card: 'Card',
    };
    return labels[method] || method;
  };

  const filteredPayments = selectedMethod
    ? (data?.payments || []).filter((p) => p.method === selectedMethod)
    : (data?.payments || []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-surface-800 rounded w-1/4 animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card animate-pulse h-24"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="page-title mb-2">Payments</h1>
          <p className="page-subtitle">Track all received Payments</p>
        </div>
        <button
          onClick={() => {
            setFormError(null);
            setSuccessMessage(null);
            resetForm();
            setShowModal(true);
          }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          Register New Payment
        </button>
      </div>

      {successMessage && (
        <div className="card bg-emerald-500/10 border-emerald-500/50 flex items-start gap-3">
          <CheckCircle2 className="text-emerald-400 flex-shrink-0 mt-1" size={18} />
          <p className="text-sm text-emerald-300">{successMessage}</p>
        </div>
      )}

      {error && (
        <div className="card bg-red-500/10 border-red-500/50 flex items-start gap-3">
          <AlertTriangle className="text-red-400 flex-shrink-0 mt-1" size={18} />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="stat-card">
            <p className="text-surface-400 text-sm font-medium">Total Received</p>
            <p className="text-2xl font-bold text-white mt-2">
              {formatBRL(data.total_received)}
            </p>
          </div>

          <div className="stat-card">
            <p className="text-surface-400 text-sm font-medium">PIX</p>
            <p className="text-2xl font-bold text-emerald-400 mt-2">
              {formatBRL(data.pix_total)}
            </p>
          </div>

          <div className="stat-card">
            <p className="text-surface-400 text-sm font-medium">Cash</p>
            <p className="text-2xl font-bold text-blue-400 mt-2">
              {formatBRL(data.cash_total)}
            </p>
          </div>

          <div className="stat-card">
            <p className="text-surface-400 text-sm font-medium">Card</p>
            <p className="text-2xl font-bold text-purple-400 mt-2">
              {formatBRL(data.card_total)}
            </p>
          </div>

          <div className="stat-card">
            <p className="text-surface-400 text-sm font-medium">This Month</p>
            <p className="text-2xl font-bold text-brand-400 mt-2">
              {formatBRL(data.month_total)}
            </p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={18} className="text-surface-500" />
          <span className="text-sm text-surface-500">Filter by method</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedMethod(null)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedMethod === null
                ? 'bg-brand-500 text-surface-950'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setSelectedMethod('pix')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedMethod === 'pix'
                ? 'bg-emerald-500 text-white'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            PIX
          </button>
          <button
            onClick={() => setSelectedMethod('cash')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedMethod === 'cash'
                ? 'bg-blue-500 text-white'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            Cash
          </button>
          <button
            onClick={() => setSelectedMethod('card')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedMethod === 'card'
                ? 'bg-purple-500 text-white'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            Card
          </button>
        </div>
      </div>

      {/* Payments List */}
      {filteredPayments.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-surface-400 mb-4">No payments found</p>
          <button
            onClick={() => {
              setFormError(null);
              setSuccessMessage(null);
              resetForm();
              setShowModal(true);
            }}
            className="btn-primary"
          >
            Register First Payment
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPayments.map((payment) => (
            <div key={payment.id} className="card-hover p-4 flex items-center justify-between">
              <div className="flex-1 flex items-center gap-4">
                <div className={`p-3 rounded-lg ${getMethodColor(payment.method)}`}>
                  <DollarSign size={20} />
                </div>

                <div className="flex-1">
                  <h3 className="font-semibold text-white">
                    {payment.Customer_name || 'Customer'}
                  </h3>
                  <p className="text-xs text-surface-500 mt-1">
                    {new Date(payment.created_at).toLocaleDateString('en-US')} •{' '}
                    {getMethodLabel(payment.method)}
                  </p>
                  {payment.notes && (
                    <p className="text-xs text-surface-400 mt-1">{payment.notes}</p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <p className="text-lg font-bold text-emerald-400">
                  {formatBRL(payment.amount)}
                </p>
                <span className={`badge text-xs font-medium ${getMethodColor(payment.method)}`}>
                  {getMethodLabel(payment.method)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card max-w-md w-full">
            <h2 className="text-xl font-semibold text-white mb-6">Add Payment</h2>

            {formError && (
              <div className="card bg-red-500/10 border-red-500/50 flex items-start gap-3 mb-4">
                <AlertTriangle className="text-red-400 flex-shrink-0 mt-1" size={18} />
                <p className="text-sm text-red-300">{formError}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-surface-500 mb-2">
                  Order (optional)
                </label>
                <input
                  type="text"
                  placeholder="Order ID"
                  value={formData.orderId}
                  onChange={(e) => setFormData({ ...formData, orderId: e.target.value })}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm text-surface-500 mb-2">
                  Customer (optional)
                </label>
                <input
                  type="text"
                  placeholder="Customer ID or name"
                  value={formData.CustomerId}
                  onChange={(e) => setFormData({ ...formData, CustomerId: e.target.value })}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm text-surface-500 mb-2">
                  Amount ({currencyCode}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-surface-500 mb-2">Method *</label>
                <select
                  value={formData.method}
                  onChange={(e) => setFormData({ ...formData, method: e.target.value as any })}
                  className="input w-full"
                  required
                >
                  <option value="pix">PIX</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-surface-500 mb-2">
                  Reference (optional)
                </label>
                <input
                  type="text"
                  placeholder="ID PIX, cheque, etc"
                  value={formData.reference}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm text-surface-500 mb-2">
                  Notes (optional)
                </label>
                <textarea
                  placeholder="Additional notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="input w-full"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closePaymentModal}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Add Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Payments;
