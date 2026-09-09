import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, AlertTriangle, ShoppingCart } from 'lucide-react';
import api from '../../lib/api';
import { formatBRL } from '../../lib/utils';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { TableRowSkeleton } from '../../components/ui/LoadingSkeleton';

interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Order {
  id: string;
  order_number: string;
  Customer_id: string;
  Customer_name?: string;
  status: 'pending' | 'confirmed' | 'production' | 'ready' | 'delivered' | 'cancelled';
  items: OrderItem[];
  total: number;
  delivery_date: string;
  payment_status: 'unpaid' | 'partial' | 'paid';
  created_at: string;
}

const Orders = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);

  const statuses = [
    { value: null, label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'production', label: 'In Production' },
    { value: 'ready', label: 'Ready' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  useEffect(() => {
    fetchOrders();
  }, [selectedStatus]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (selectedStatus) {
        params.append('status', selectedStatus);
      }
      if (searchTerm) {
        params.append('search', searchTerm);
      }
      const response = await api.get(`/baker/orders?${params.toString()}`);
      setOrders(response.orders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOrders();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'confirmed':
        return 'bg-blue-500/20 text-blue-400';
      case 'production':
        return 'bg-purple-500/20 text-purple-400';
      case 'ready':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'delivered':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'cancelled':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-surface-700 text-surface-300';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'partial':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'unpaid':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-surface-700 text-surface-300';
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'Pending',
      confirmed: 'Confirmed',
      production: 'In Production',
      ready: 'Ready',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };
    return labels[status] || status;
  };

  const getPaymentStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      paid: 'Paid',
      partial: 'Partial',
      unpaid: 'Unpaid',
    };
    return labels[status] || status;
  };

  if (error) {
    return (
      <div className="card bg-red-500/10 border-red-500/50">
        <div className="flex items-start gap-4">
          <AlertTriangle className="text-red-400 flex-shrink-0 mt-1" size={20} />
          <div className="flex-1">
            <h3 className="font-semibold text-red-400 mb-1">Failed to load orders</h3>
            <p className="text-sm text-red-300 mb-4">{error}</p>
            <button onClick={fetchOrders} className="btn-secondary text-sm">
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="page-title mb-2">Orders</h1>
          <p className="page-subtitle">Manage all Orders</p>
        </div>
        <button
          onClick={() => navigate('/app/orders/new')}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          New Order
        </button>
      </div>

      {/* Search and Filter */}
      <div className="card">
        <form onSubmit={handleSearch} className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-3 text-surface-500" />
            <input
              type="text"
              placeholder="Search by order number or Customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-10 w-full"
            />
          </div>
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>

        {/* Status Filter */}
        <div className="flex gap-2 flex-wrap">
          {statuses.map((status) => (
            <button
              key={status.value}
              onClick={() => setSelectedStatus(status.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                selectedStatus === status.value
                  ? 'bg-brand-500 text-surface-950'
                  : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
              }`}
            >
              {status.label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <TableRowSkeleton rows={5} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart size={28} />}
          title="No orders yet"
          description="Start by creating your first order to manage your Customers and deliveries."
          action={{
            label: 'Create first order',
            onClick: () => navigate('/app/orders/new'),
          }}
        />
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div
              key={order.id}
              onClick={() => navigate(`/app/orders/${order.id}`)}
              className="card-hover cursor-pointer p-4 flex items-center justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-4 mb-3">
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-white">
                      Order #{order.order_number}
                    </h3>
                    <p className="text-xs text-surface-400 mt-1">
                      {order.Customer_name || 'Customer'} • {new Date(order.created_at).toLocaleDateString('en-US')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white">{formatBRL(order.total)}</p>
                    <p className="text-xs text-surface-400 mt-1">
                      {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {/* Summary */}
                <p className="text-xs text-surface-500 mb-3 line-clamp-1">
                  Delivery: {new Date(order.delivery_date).toLocaleDateString('en-US')}
                </p>

                {/* Status Badges */}
                <div className="flex gap-2 flex-wrap">
                  <StatusBadge status={order.status as any} label={getStatusLabel(order.status)} />
                  <StatusBadge status={order.payment_status as any} label={getPaymentStatusLabel(order.payment_status)} />
                </div>
              </div>

              {/* Quick Actions */}
              <div className="ml-4 flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/app/orders/${order.id}`);
                  }}
                  className="btn-ghost text-sm px-3 py-1"
                >
                  Details
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Orders;
