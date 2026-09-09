import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus, X, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { formatBRL } from '../../lib/utils';

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  cost: number;
}

interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

const OrderCreate = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Customer
  const [Customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [CustomerSearch, setCustomerSearch] = useState('');
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
  });

  // Step 2: Items
  const [products, setProducts] = useState<Product[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [productSearch, setProductSearch] = useState('');

  // Step 3: Delivery
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (step === 1) {
      fetchCustomers();
    } else if (step === 2) {
      fetchProducts();
    }
  }, [step]);

  const fetchCustomers = async () => {
    try {
      const response = await api.get('/baker/Customers');
      setCustomers(response.Customers || []);
    } catch (err) {
      setError('Failed to load Customers');
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await api.get('/baker/products');
      setProducts(response.products || []);
    } catch (err) {
      setError('Failed to load products');
    }
  };

  const handleAddCustomer = async () => {
    if (!newCustomer.name || !newCustomer.email) {
      setError('Name and email are required');
      return;
    }

    try {
      setLoading(true);
      const response = await api.post('/baker/Customers', newCustomer);
      const created = response;
      setSelectedCustomer(created);
      setShowNewCustomerForm(false);
      setNewCustomer({ name: '', email: '', phone: '', address: '', city: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Customer');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    if (!selectedProduct || itemQuantity <= 0) {
      setError('Select a valid product and quantity');
      return;
    }

    const newItem: OrderItem = {
      productId: selectedProduct.id,
      quantity: itemQuantity,
      unitPrice: selectedProduct.price,
      total: selectedProduct.price * itemQuantity,
    };

    setOrderItems([...orderItems, newItem]);
    setSelectedProduct(null);
    setItemQuantity(1);
    setError(null);
  };

  const handleRemoveItem = (index: number) => {
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  const handleSubmitOrder = async () => {
    if (!selectedCustomer) {
      setError('Select a Customer');
      return;
    }

    if (orderItems.length === 0) {
      setError('Add at least one item');
      return;
    }

    if (!deliveryDate) {
      setError('Select a delivery date');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const orderData = {
        CustomerId: selectedCustomer.id,
        items: orderItems,
        deliveryDate,
        deliveryType,
        deliveryAddress,
        notes,
      };

      const response = await api.post('/baker/orders', orderData);
      const createdOrder = response;
      navigate(`/app/orders/${createdOrder.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order');
    } finally {
      setLoading(false);
    }
  };

  const totalPrice = orderItems.reduce((sum, item) => sum + item.total, 0);
  const filteredCustomers = Customers.filter(
    (c) =>
      c.name.toLowerCase().includes(CustomerSearch.toLowerCase()) ||
      c.email.toLowerCase().includes(CustomerSearch.toLowerCase())
  );
  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={() => (step > 1 ? setStep(step - 1) : navigate('/app/orders'))}
          className="btn-ghost p-2"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="page-title">New Order</h1>
          <p className="page-subtitle">Step {step} of 4</p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="card mb-8">
        <div className="flex items-center justify-between mb-6">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex flex-col items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold mb-2 ${
                  s === step
                    ? 'bg-brand-500 text-surface-950'
                    : s < step
                    ? 'bg-emerald-500 text-white'
                    : 'bg-surface-800 text-surface-400'
                }`}
              >
                {s < step ? '✓' : s}
              </div>
              <p className="text-xs text-surface-400">
                {s === 1 ? 'Customer' : s === 2 ? 'Items' : s === 3 ? 'Delivery' : 'Confirm'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="card bg-red-500/10 border-red-500/50 mb-6 flex items-start gap-3">
          <AlertTriangle className="text-red-400 flex-shrink-0 mt-1" size={18} />
          <div>
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Step 1: Customer Selection */}
      {step === 1 && (
        <div className="card space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Select Customer</h2>

            {selectedCustomer ? (
              <div className="bg-surface-800 p-4 rounded-lg border border-surface-700 mb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-white">{selectedCustomer.name}</p>
                    <p className="text-sm text-surface-400">{selectedCustomer.email}</p>
                    {selectedCustomer.phone && (
                      <p className="text-sm text-surface-400">{selectedCustomer.phone}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedCustomer(null)}
                    className="text-surface-400 hover:text-red-400 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <input
                    type="text"
                    placeholder="Search Customer..."
                    value={CustomerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="input w-full"
                  />
                </div>

                {filteredCustomers.length > 0 ? (
                  <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                    {filteredCustomers.map((Customer) => (
                      <button
                        key={Customer.id}
                        onClick={() => setSelectedCustomer(Customer)}
                        className="w-full text-left p-3 bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors"
                      >
                        <p className="font-semibold text-white">{Customer.name}</p>
                        <p className="text-sm text-surface-400">{Customer.email}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-surface-400 text-sm mb-4">No Customers found</p>
                )}

                <button
                  onClick={() => setShowNewCustomerForm(!showNewCustomerForm)}
                  className="btn-secondary w-full flex items-center justify-center gap-2"
                >
                  <Plus size={18} />
                  Add New Customer
                </button>
              </>
            )}

            {showNewCustomerForm && !selectedCustomer && (
              <div className="mt-6 p-4 border border-brand-500/30 rounded-lg bg-brand-500/5">
                <h3 className="font-semibold text-white mb-4">New Customer</h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Nome completo"
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    className="input w-full"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    className="input w-full"
                  />
                  <input
                    type="tel"
                    placeholder="Phone (optional)"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    className="input w-full"
                  />
                  <input
                    type="text"
                    placeholder="Address (optional)"
                    value={newCustomer.address}
                    onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                    className="input w-full"
                  />
                  <input
                    type="text"
                    placeholder="City (optional)"
                    value={newCustomer.city}
                    onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })}
                    className="input w-full"
                  />
                  <button
                    onClick={handleAddCustomer}
                    disabled={loading}
                    className="btn-primary w-full"
                  >
                    Create Customer
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!selectedCustomer}
            className={`w-full py-2 rounded-lg font-semibold transition-colors ${
              selectedCustomer
                ? 'btn-primary'
                : 'bg-surface-700 text-surface-400 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Add Items */}
      {step === 2 && (
        <div className="card space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Add Items</h2>

            {/* Product Selection */}
            <div className="space-y-3 mb-6">
              <input
                type="text"
                placeholder="Search product..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="input w-full"
              />

              {filteredProducts.length > 0 && (
                <select
                  value={selectedProduct?.id || ''}
                  onChange={(e) => {
                    const product = products.find((p) => p.id === e.target.value);
                    setSelectedProduct(product || null);
                  }}
                  className="input w-full"
                >
                  <option value="">Select product...</option>
                  {filteredProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} - {formatBRL(product.price)}
                    </option>
                  ))}
                </select>
              )}

              {selectedProduct && (
                <div className="flex gap-3">
                  <input
                    type="number"
                    min="1"
                    value={itemQuantity}
                    onChange={(e) => setItemQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="input w-20"
                    placeholder="Qty"
                  />
                  <button
                    onClick={handleAddItem}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    <Plus size={18} />
                    Add
                  </button>
                </div>
              )}
            </div>

            {/* Items List */}
            {orderItems.length > 0 ? (
              <div className="space-y-2 mb-6">
                <h3 className="font-semibold text-white text-sm mb-3">Order Items</h3>
                {orderItems.map((item, index) => {
                  const product = products.find((p) => p.id === item.productId);
                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-surface-800 rounded-lg"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">{product?.name}</p>
                        <p className="text-xs text-surface-400">
                          {item.quantity}x {formatBRL(item.unitPrice)} = {formatBRL(item.total)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveItem(index)}
                        className="text-surface-400 hover:text-red-400 transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-surface-400 text-sm mb-6">No items added</p>
            )}

            {/* Total */}
            <div className="bg-surface-800 p-4 rounded-lg mb-6">
              <div className="flex justify-between items-center">
                <span className="text-surface-400">Total</span>
                <span className="text-2xl font-bold text-white">
                  {formatBRL(totalPrice)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="btn-secondary flex-1">
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={orderItems.length === 0}
              className={`flex-1 py-2 rounded-lg font-semibold transition-colors ${
                orderItems.length > 0
                  ? 'btn-primary'
                  : 'bg-surface-700 text-surface-400 cursor-not-allowed'
              }`}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Delivery Details */}
      {step === 3 && (
        <div className="card space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Delivery Details</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Delivery Date
                </label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Delivery Type
                </label>
                <select
                  value={deliveryType}
                  onChange={(e) => setDeliveryType(e.target.value as 'pickup' | 'delivery')}
                  className="input w-full"
                >
                  <option value="pickup">Pickup</option>
                  <option value="delivery">Delivery</option>
                </select>
              </div>

              {deliveryType === 'delivery' && (
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Delivery Address
                  </label>
                  <textarea
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="input w-full"
                    rows={3}
                    placeholder="Street, number, neighborhood..."
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input w-full"
                  rows={3}
                  placeholder="Special instructions, allergies, etc..."
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="btn-secondary flex-1">
              Back
            </button>
            <button onClick={() => setStep(4)} className="btn-primary flex-1">
              Review
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Confirm */}
      {step === 4 && (
        <div className="card space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-6">Review Order</h2>

            {/* Customer Summary */}
            <div className="bg-surface-800 p-4 rounded-lg mb-6">
              <p className="text-xs text-surface-500 mb-1">Customer</p>
              <p className="font-semibold text-white">{selectedCustomer?.name}</p>
            </div>

            {/* Items Summary */}
            <div className="bg-surface-800 p-4 rounded-lg mb-6">
              <p className="text-xs text-surface-500 mb-3">Items</p>
              <div className="space-y-2">
                {orderItems.map((item, index) => {
                  const product = products.find((p) => p.id === item.productId);
                  return (
                    <div key={index} className="flex justify-between text-sm">
                      <span className="text-surface-300">
                        {product?.name} x{item.quantity}
                      </span>
                      <span className="text-white font-medium">
                        {formatBRL(item.total)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-surface-700 mt-3 pt-3 flex justify-between">
                <span className="font-semibold text-white">Total</span>
                <span className="font-bold text-brand-400">{formatBRL(totalPrice)}</span>
              </div>
            </div>

            {/* Delivery Summary */}
            <div className="bg-surface-800 p-4 rounded-lg">
              <p className="text-xs text-surface-500 mb-3">Delivery</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-surface-400">Date</span>
                  <span className="text-white">{new Date(deliveryDate).toLocaleDateString('en-US')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Type</span>
                  <span className="text-white">
                    {deliveryType === 'pickup' ? 'Pickup' : 'Delivery'}
                  </span>
                </div>
                {deliveryAddress && (
                  <div className="flex justify-between">
                    <span className="text-surface-400">Address</span>
                    <span className="text-white text-right">{deliveryAddress}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(3)} className="btn-secondary flex-1">
              Back
            </button>
            <button
              onClick={handleSubmitOrder}
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? 'Creating...' : 'Confirm Order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderCreate;
