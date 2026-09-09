import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, AlertTriangle, Search, Users } from 'lucide-react';
import api from '../../lib/api';
import { formatBRL } from '../../lib/utils';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  total_orders: number;
  total_spent: number;
  status: 'active' | 'inactive';
}

const Customers = () => {
  const [loading, setLoading] = useState(true);
  const [Customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    status: 'active' as 'active' | 'inactive',
  });

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/baker/Customers');
      setCustomers(response.Customers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Customers');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.email) {
      setError('Name and email are required');
      return;
    }

    try {
      setLoading(true);

      if (editingId) {
        await api.put(`/baker/Customers/${editingId}`, formData);
      } else {
        await api.post('/baker/Customers', formData);
      }

      setFormData({
        name: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        status: 'active',
      });
      setEditingId(null);
      setShowModal(false);
      await fetchCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Customer');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (Customer: Customer) => {
    setFormData({
      name: Customer.name,
      email: Customer.email,
      phone: Customer.phone || '',
      address: Customer.address || '',
      city: Customer.city || '',
      status: Customer.status,
    });
    setEditingId(Customer.id);
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure?')) return;

    try {
      await api.delete(`/baker/Customers/${id}`);
      await fetchCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete Customer');
    }
  };

  const filteredCustomers = Customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="page-title mb-2">Customers</h1>
          <p className="page-subtitle">Manage Customer base</p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setFormData({
              name: '',
              email: '',
              phone: '',
              address: '',
              city: '',
              status: 'active',
            });
            setShowModal(true);
          }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          New Customer
        </button>
      </div>

      {error && (
        <div className="card bg-red-500/10 border-red-500/50 flex items-start gap-3">
          <AlertTriangle className="text-red-400 flex-shrink-0 mt-1" size={18} />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Search */}
      <div className="card">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-3 text-surface-500" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10 w-full"
          />
        </div>
      </div>

      {/* Customers List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : filteredCustomers.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="No Customers found"
          description="Start by adding your first Customers to manage orders."
          action={{
            label: 'Add first Customer',
            onClick: () => setShowModal(true),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCustomers.map((Customer) => (
            <div key={Customer.id} className="card-hover p-4 flex flex-col">
              <h3 className="font-semibold text-white mb-1">{Customer.name}</h3>
              <p className="text-sm text-surface-400 mb-3">{Customer.email}</p>

              {Customer.phone && (
                <p className="text-sm text-surface-400 mb-3">{Customer.phone}</p>
              )}

              <div className="flex-1 space-y-2 py-3 border-t border-surface-700">
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Orders</span>
                  <span className="text-white font-semibold">{Customer.total_orders}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Total Spent</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatBRL(Customer.total_spent)}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handleEdit(Customer)}
                  className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
                >
                  <Edit2 size={16} />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(Customer.id)}
                  className="btn-danger flex items-center justify-center gap-2 text-sm px-3"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="mt-3 pt-3 border-t border-surface-700">
                <StatusBadge status={Customer.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card max-w-md w-full">
            <h2 className="text-xl font-semibold text-white mb-6">
              {editingId ? 'Edit Customer' : 'New Customer'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                placeholder="Full name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input w-full"
                required
              />

              <input
                type="email"
                placeholder="Email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="input w-full"
                required
              />

              <input
                type="tel"
                placeholder="Phone (optional)"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="input w-full"
              />

              <input
                type="text"
                placeholder="Address (optional)"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="input w-full"
              />

              <input
                type="text"
                placeholder="City (optional)"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="input w-full"
              />

              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="input w-full"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1"
                >
                  {editingId ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;
