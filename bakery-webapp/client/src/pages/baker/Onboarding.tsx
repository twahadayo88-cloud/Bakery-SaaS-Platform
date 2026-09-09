import React, { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader, SkipForward } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const countryDefaults: Record<string, { currency: string; locale: string; timezone: string; measurementSystem: string }> = {
  US: { currency: 'USD', locale: 'en-US', timezone: 'America/New_York', measurementSystem: 'imperial' },
  GB: { currency: 'GBP', locale: 'en-GB', timezone: 'Europe/London', measurementSystem: 'metric' },
  PK: { currency: 'PKR', locale: 'en-PK', timezone: 'Asia/Karachi', measurementSystem: 'metric' },
  BR: { currency: 'BRL', locale: 'en-US', timezone: 'America/Sao_Paulo', measurementSystem: 'metric' },
};

const steps = ['Business', 'Region', 'Localization', 'Tax', 'Location', 'Staff', 'Products', 'Inventory', 'Complete'];

export default function Onboarding() {
  const navigate = useNavigate();
  const { organization, refreshContext } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>({ organization: {}, location: {} });

  useEffect(() => {
    api.get('/onboarding').then((result: any) => {
      setData({ organization: result.organization || {}, location: result.location || {} });
      setStep(Math.max(1, Math.min(9, result.step || 1)));
    }).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load onboarding')).finally(() => setLoading(false));
  }, []);

  const updateOrganization = (key: string, value: any) => setData((current: any) => ({ ...current, organization: { ...current.organization, [key]: value } }));
  const updateLocation = (key: string, value: any) => setData((current: any) => ({ ...current, location: { ...current.location, [key]: value } }));

  const save = async (nextStep: number, complete = false) => {
    try {
      setSaving(true); setError('');
      const result = await api.put('/onboarding', { step: nextStep, complete, organization: data.organization, location: data.location });
      setData({ organization: result.organization || data.organization, location: result.location || data.location });
      if (complete) {
        await refreshContext();
        navigate('/dashboard', { replace: true });
      } else setStep(nextStep);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save onboarding'); }
    finally { setSaving(false); }
  };

  const handleCountry = (country: string) => {
    const defaults = countryDefaults[country];
    setData((current: any) => ({ ...current, organization: { ...current.organization, country, ...(defaults || {}) }, location: { ...current.location, country, ...(defaults ? { timezone: defaults.timezone } : {}) } }));
  };

  if (loading) return <div className="min-h-screen bg-surface-950 flex items-center justify-center text-surface-400"><Loader className="animate-spin" /></div>;

  const field = (label: string, key: string, value: any, onChange: (value: string) => void, type = 'text') => (
    <label className="block text-sm text-surface-300"><span className="block mb-2">{label}</span><input type={type} className="input w-full" value={value || ''} onChange={(event) => onChange(event.target.value)} /></label>
  );

  return <div className="min-h-screen bg-surface-950 text-white py-8 px-4"><div className="max-w-3xl mx-auto">
    <div className="mb-8"><p className="text-brand-400 text-sm font-semibold">bakery-webapp setup</p><h1 className="text-3xl font-bold mt-2">Set up your business</h1><p className="text-surface-400 mt-2">Complete the essentials now. You can update everything later.</p></div>
    <div className="flex gap-2 mb-8 overflow-x-auto">{steps.map((label, index) => <div key={label} className={`flex items-center gap-2 text-xs whitespace-nowrap ${index + 1 <= step ? 'text-brand-400' : 'text-surface-600'}`}><span className="w-6 h-6 rounded-full border flex items-center justify-center">{index + 1 < step ? <Check size={14} /> : index + 1}</span>{label}</div>)}</div>
    {error && <div className="card border-red-500/30 text-red-300 mb-6">{error}</div>}
    <div className="card space-y-6">
      {step === 1 && <><h2 className="text-xl font-semibold">Business information</h2>{field('Business name', 'name', data.organization.name, (value) => updateOrganization('name', value))}{field('Legal business name', 'legalName', data.organization.legal_name, (value) => updateOrganization('legalName', value))}<div className="grid md:grid-cols-2 gap-4">{field('Business type', 'businessType', data.organization.business_type, (value) => updateOrganization('businessType', value))}{field('Business email', 'businessEmail', data.organization.business_email, (value) => updateOrganization('businessEmail', value), 'email')}</div>{field('Website', 'website', data.organization.website, (value) => updateOrganization('website', value), 'url')}</>}
      {step === 2 && <><h2 className="text-xl font-semibold">Country and region</h2><label className="block text-sm text-surface-300"><span className="block mb-2">Country</span><select className="input w-full" value={data.organization.country || 'US'} onChange={(event) => handleCountry(event.target.value)}><option value="US">United States</option><option value="GB">United Kingdom</option><option value="PK">Pakistan</option><option value="BR">Brazil</option><option value="CA">Canada</option><option value="AU">Australia</option></select></label>{field('State / Province / Region', 'stateProvince', data.organization.state_province, (value) => updateOrganization('stateProvince', value))}{field('City', 'city', data.organization.city, (value) => updateOrganization('city', value))}{field('Address line 1', 'addressLine1', data.organization.address_line1 || data.organization.address, (value) => updateOrganization('addressLine1', value))}{field('Address line 2', 'addressLine2', data.organization.address_line2, (value) => updateOrganization('addressLine2', value))}{field('Postal code', 'postalCode', data.organization.postal_code, (value) => updateOrganization('postalCode', value))}</>}
      {step === 3 && <><h2 className="text-xl font-semibold">Localization</h2><div className="grid md:grid-cols-2 gap-4">{field('Currency', 'currency', data.organization.currency, (value) => updateOrganization('currency', value.toUpperCase()))}{field('Locale', 'locale', data.organization.locale, (value) => updateOrganization('locale', value))}{field('Timezone', 'timezone', data.organization.timezone, (value) => updateOrganization('timezone', value))}<label className="block text-sm text-surface-300"><span className="block mb-2">Measurement system</span><select className="input w-full" value={data.organization.measurement_system || 'metric'} onChange={(event) => updateOrganization('measurementSystem', event.target.value)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label></div></>}
      {step === 4 && <><h2 className="text-xl font-semibold">Tax setup</h2><div className="grid md:grid-cols-2 gap-4"><label className="block text-sm text-surface-300"><span className="block mb-2">Tax type</span><select className="input w-full" value={data.organization.tax_type || 'Other'} onChange={(event) => updateOrganization('taxType', event.target.value)}><option>VAT</option><option>GST</option><option>Sales Tax</option><option>Other</option></select></label>{field('Tax name', 'taxName', data.organization.tax_name, (value) => updateOrganization('taxName', value))}{field('Tax rate (%)', 'taxRate', data.organization.tax_rate, (value) => updateOrganization('taxRate', Number(value)), 'number')}</div><label className="flex items-center gap-2 text-sm text-surface-300"><input type="checkbox" checked={Boolean(data.organization.tax_inclusive)} onChange={(event) => updateOrganization('taxInclusive', event.target.checked ? 1 : 0)} /> Prices include tax</label><p className="text-xs text-surface-500">You can skip tax setup and configure it later.</p></>}
      {step === 5 && <><h2 className="text-xl font-semibold">Primary location</h2>{field('Location name', 'name', data.location.name || `${data.organization.name || 'Business'} - Main`, (value) => updateLocation('name', value))}{field('Location phone', 'phone', data.location.phone, (value) => updateLocation('phone', value), 'tel')}{field('Timezone', 'timezone', data.location.timezone || data.organization.timezone, (value) => updateLocation('timezone', value))}<p className="text-sm text-surface-500">Your first location is already created and will remain the active default location.</p></>}
      {step >= 6 && step <= 8 && <><h2 className="text-xl font-semibold">{steps[step - 1]}</h2><p className="text-surface-400">This optional setup can be completed later from the main workspace.</p><button type="button" onClick={() => save(step + 1)} className="btn-secondary flex items-center gap-2"><SkipForward size={16} />Skip for now</button></>}
      {step === 9 && <><div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center"><Check size={28} /></div><h2 className="text-2xl font-bold">Your business is ready</h2><p className="text-surface-400">{data.organization.name} is configured with {data.organization.currency || 'your currency'} and {data.organization.timezone || 'your timezone'}.</p></>}
      <div className="flex justify-between pt-4 border-t border-surface-800"><button type="button" className="btn-secondary flex items-center gap-2" disabled={step === 1 || saving} onClick={() => setStep(step - 1)}><ChevronLeft size={18} />Back</button>{step === 9 ? <button type="button" className="btn-primary flex items-center gap-2" disabled={saving} onClick={() => save(10, true)}>{saving ? <Loader size={18} className="animate-spin" /> : <Check size={18} />}Enter dashboard</button> : <button type="button" className="btn-primary flex items-center gap-2" disabled={saving} onClick={() => save(step + 1)}>{saving ? <Loader size={18} className="animate-spin" /> : <ChevronRight size={18} />}Continue</button>}</div>
    </div>
  </div></div>;
}
