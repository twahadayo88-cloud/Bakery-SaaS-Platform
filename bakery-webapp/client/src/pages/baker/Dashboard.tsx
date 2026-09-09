import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Plus, TrendingUp, TrendingDown, AlertTriangle, Package, ShoppingCart, Users, ChefHat } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatBRL } from '../../lib/utils';
import { StatCardSkeleton } from '../../components/ui/LoadingSkeleton';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  confirmed: 'bg-blue-500/20 text-blue-400',
  production: 'bg-purple-500/20 text-purple-400',
  ready: 'bg-emerald-500/20 text-emerald-400',
  delivered: 'bg-surface-700 text-surface-300',
  cancelled: 'bg-red-500/20 text-red-400',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  production: 'Production',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/baker/dashboard');
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="h-8 bg-surface-800 rounded w-1/3 animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card bg-red-500/10 border-red-500/50">
        <div className="flex items-start gap-4">
          <AlertTriangle className="text-red-400 flex-shrink-0 mt-1" size={20} />
          <div className="flex-1">
            <h3 className="font-semibold text-red-400 mb-1">Error loading dashboard</h3>
            <p className="text-sm text-red-300 mb-4">{error}</p>
            <button onClick={fetchDashboard} className="btn-secondary text-sm">Try again</button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return <div className="text-surface-400">No data available</div>;

  const { stats, recentOrders, todaysOrders, productPerformance } = data;
  const revenueChange = stats.revenueChange || 0;

  const chartData = (productPerformance || []).map((p: any) => ({
    name: p.name,
    vendas: p.revenue || p.quantity || 0,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="page-title mb-2">
            {getGreeting()}, {user?.name?.split(' ')[0]}!
          </h1>
          <p className="page-subtitle">Here is your business summary for today.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate('/app/orders/new')} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> New Request
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="stat-card card-hover">
          <p className="text-surface-400 text-sm font-medium">Revenue this month</p>
          <div className="mt-2">
            <p className="text-2xl font-bold text-white">{formatBRL(stats.monthRevenue || 0)}</p>
            <div className="flex items-center gap-1 mt-2">
              {revenueChange >= 0 ? (
                <TrendingUp size={16} className="text-emerald-500" />
              ) : (
                <TrendingDown size={16} className="text-red-500" />
              )}
              <span className={`text-sm font-medium ${revenueChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {revenueChange >= 0 ? '+' : ''}{revenueChange}%
              </span>
            </div>
          </div>
        </div>

        <div className="stat-card card-hover">
          <p className="text-surface-400 text-sm font-medium">Pending Orders</p>
          <p className="text-2xl font-bold text-white mt-2">{stats.pendingOrders || 0}</p>
          <p className="text-xs text-surface-500 mt-2">Awaiting confirmation</p>
        </div>

        <div className="stat-card card-hover">
          <p className="text-surface-400 text-sm font-medium">Customers</p>
          <p className="text-2xl font-bold text-white mt-2">{stats.totalCustomers || 0}</p>
        </div>

        <div className="stat-card card-hover">
          <p className="text-surface-400 text-sm font-medium">Products</p>
          <p className="text-2xl font-bold text-white mt-2">{stats.totalProducts || 0}</p>
        </div>

        <div className={`stat-card card-hover ${(stats.lowStockCount || 0) > 0 ? 'border-yellow-500/50' : ''}`}>
          <p className="text-surface-400 text-sm font-medium">Low Inventory</p>
          <p className={`text-2xl font-bold mt-2 ${(stats.lowStockCount || 0) > 0 ? 'text-yellow-400' : 'text-emerald-400'}`}>
            {stats.lowStockCount || 0}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Top Products */}
        <div className="lg:col-span-2 card">
          <h3 className="text-lg font-semibold text-white mb-6">Best Selling Products</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
                <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #404040', borderRadius: '8px' }}
                  labelStyle={{ color: '#e5e7eb' }}
                />
                <Bar dataKey="vendas" fill="#f59e0b" radius={[8, 8, 0, 0]}>
                  {chartData.map((_: any, index: number) => (
                    <Cell key={`cell-${index}`} fill="#f59e0b" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-surface-400">No data available</div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <button onClick={() => navigate('/app/orders/new')} className="w-full btn-secondary text-left flex items-center gap-3">
              <ShoppingCart size={18} className="text-brand-400" /> New Order
            </button>
            <button onClick={() => navigate('/app/products')} className="w-full btn-secondary text-left flex items-center gap-3">
              <ChefHat size={18} className="text-brand-400" /> New Product
            </button>
            <button onClick={() => navigate('/app/Customers')} className="w-full btn-secondary text-left flex items-center gap-3">
              <Users size={18} className="text-brand-400" /> New Customer
            </button>
            <button onClick={() => navigate('/app/inventory')} className="w-full btn-secondary text-left flex items-center gap-3">
              <Package size={18} className="text-brand-400" /> Manage Inventory
            </button>
          </div>
        </div>
      </div>

      {/* Today's Orders */}
      {todaysOrders && todaysOrders.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-6">Today's Orders</h3>
          <div className="space-y-3">
            {todaysOrders.map((order: any) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors cursor-pointer"
                onClick={() => navigate(`/app/orders/${order.id}`)}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">#{order.order_number}</p>
                    <p className="text-xs text-surface-400">{order.Customer_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-sm font-semibold text-white">{formatBRL(order.total || 0)}</p>
                  <span className={`badge text-xs ${statusColors[order.status] || 'bg-surface-700 text-surface-300'}`}>
                    {statusLabels[order.status] || order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Orders */}
      {recentOrders && recentOrders.length > 0 && (
        <div className="card">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold text-white">Recent Orders</h3>
            <button onClick={() => navigate('/app/orders')} className="text-sm text-brand-400 hover:text-brand-300">
              View all →
            </button>
          </div>
          <div className="space-y-3">
            {recentOrders.map((order: any) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors cursor-pointer"
                onClick={() => navigate(`/app/orders/${order.id}`)}
              >
                <div>
                  <p className="text-sm font-medium text-white">#{order.order_number}</p>
                  <p className="text-xs text-surface-400">{order.Customer_name}</p>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-sm font-semibold text-white">{formatBRL(order.total || 0)}</p>
                  <span className={`badge text-xs ${statusColors[order.status] || 'bg-surface-700 text-surface-300'}`}>
                    {statusLabels[order.status] || order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Production Summary */}
      {todaysOrders && todaysOrders.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-6">What to Produce Today</h3>
          <div className="space-y-3">
            {(() => {
              const itemSummary: Record<string, number> = {};
              todaysOrders.forEach((order: any) => {
                // Items would need to be loaded from order details
                // This is a simplified version
              });

              return (
                <div className="text-center py-4 text-surface-400 text-sm">
                  <p>View the items on the Production page</p>
                  <button
                    onClick={() => navigate('/app/production')}
                    className="text-brand-400 hover:text-brand-300 mt-2 underline"
                  >
                    Go to Production Queue →
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Upcoming Deliveries */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Upcoming Deliveries</h3>
        <div className="grid grid-cols-7 gap-2">
          {(() => {
            const days = [];
            for (let i = 0; i < 7; i++) {
              const date = new Date(Date.now() + i * 86400000);
              const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).substring(0, 3);
              const dayNum = date.getDate();
              const isToday = i === 0;

              days.push(
                <div
                  key={i}
                  className={`p-3 rounded-lg text-center ${
                    isToday
                      ? 'bg-brand-500/20 border border-brand-500/50'
                      : 'bg-surface-800 border border-surface-700'
                  }`}
                >
                  <p className="text-xs text-surface-400 uppercase">{dayName}</p>
                  <p className={`text-lg font-bold ${isToday ? 'text-brand-400' : 'text-white'}`}>
                    {dayNum}
                  </p>
                </div>
              );
            }
            return days;
          })()}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
