import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDB, getOrganizationForUser, getLocationForUser, getLocationsForUser } from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/rbac.js';

const router = Router();
const db = getDB();
router.use(authMiddleware, requireAuth);

router.get('/', (req: AuthRequest, res) => {
  const organization = getOrganizationForUser(req.user!.id);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  const location = getLocationForUser(req.user!.id, organization.location_id);
  res.json({ organization, location, locations: getLocationsForUser(req.user!.id), step: organization.onboarding_step || 1, status: organization.onboarding_status || 'completed', completed: Boolean(organization.onboarding_completed) });
});

function validateInput(input: any, locationInput: any): string | null {
  if (input.name !== undefined && (!String(input.name).trim() || String(input.name).length > 160)) return 'Organization name is invalid';
  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(String(input.currency).toUpperCase())) return 'Currency must be a three-letter code';
  if (input.locale !== undefined && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(String(input.locale))) return 'Locale is invalid';
  if (input.timezone !== undefined) { try { new Intl.DateTimeFormat('en-US', { timeZone: String(input.timezone) }); } catch { return 'Timezone is invalid'; } }
  if (input.taxType !== undefined && !['VAT', 'GST', 'Sales Tax', 'Other'].includes(input.taxType)) return 'Tax type is invalid';
  if (input.taxRate !== undefined && (!Number.isFinite(Number(input.taxRate)) || Number(input.taxRate) < 0 || Number(input.taxRate) > 100)) return 'Tax rate must be between 0 and 100';
  if (locationInput.name !== undefined && !String(locationInput.name).trim()) return 'Location name is required';
  return null;
}

function updateOnboarding(req: AuthRequest, res: any) {
  const organization = getOrganizationForUser(req.user!.id);
  if (!organization || organization.role !== 'owner') return res.status(403).json({ error: 'Organization owner permission required' });
  const { step, complete, organization: input = {}, location: locationInput = {} } = req.body;
  const validationError = validateInput(input, locationInput);
  if (validationError) return res.status(400).json({ error: validationError });
  const orgFields: Record<string, string> = {
    name: 'name', legalName: 'legal_name', businessType: 'business_type', businessEmail: 'business_email', businessPhone: 'business_phone', website: 'website',
    country: 'country', stateProvince: 'state_province', city: 'city', address: 'address', addressLine1: 'address_line1', addressLine2: 'address_line2', postalCode: 'postal_code',
    currency: 'currency', timezone: 'timezone', locale: 'locale', measurementSystem: 'measurement_system', taxModel: 'tax_model', taxName: 'tax_name', taxType: 'tax_type', taxRate: 'tax_rate', taxInclusive: 'tax_inclusive',
  };
  const updates: string[] = ['updated_at = ?'];
  const values: any[] = [new Date().toISOString()];
  for (const [key, column] of Object.entries(orgFields)) if (input[key] !== undefined) { updates.push(`${column} = ?`); values.push(input[key]); }
  const nextStep = Math.max(1, Math.min(10, Number(step || organization.onboarding_step || 1)));
  updates.push('onboarding_step = ?', 'onboarding_status = ?', 'onboarding_completed = ?');
  values.push(complete ? 10 : nextStep, complete ? 'completed' : 'in_progress', complete ? 1 : 0, organization.id);
  db.prepare(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  db.prepare(`INSERT INTO audit_log (id, user_id, organization_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), req.user!.id, organization.id, complete ? 'onboarding.completed' : 'onboarding.updated', 'organization', organization.id, JSON.stringify({ step: complete ? 10 : nextStep }), new Date().toISOString());

  const location = getLocationForUser(req.user!.id, organization.location_id);
  if (location && Object.keys(locationInput).length > 0) {
    const locationFields: Record<string, string> = { name: 'name', code: 'code', address: 'address', addressLine1: 'address_line1', addressLine2: 'address_line2', country: 'country', stateProvince: 'state_province', city: 'city', postalCode: 'postal_code', phone: 'phone', timezone: 'timezone' };
    const locationUpdates: string[] = [];
    const locationValues: any[] = [];
    for (const [key, column] of Object.entries(locationFields)) if (locationInput[key] !== undefined) { locationUpdates.push(`${column} = ?`); locationValues.push(locationInput[key]); }
    if (locationUpdates.length) { locationValues.push(new Date().toISOString(), location.id, organization.id); db.prepare(`UPDATE locations SET ${locationUpdates.join(', ')}, updated_at = ? WHERE id = ? AND organization_id = ?`).run(...locationValues); }
  }
  res.json({ organization: getOrganizationForUser(req.user!.id), location: getLocationForUser(req.user!.id, organization.location_id) });
}

router.put('/', requirePermission('settings.manage'), updateOnboarding);
router.patch('/', requirePermission('settings.manage'), updateOnboarding);
router.post('/complete', requirePermission('settings.manage'), (req: AuthRequest, res) => {
  req.body = { ...req.body, complete: true, step: 10 };
  updateOnboarding(req, res);
});

export default router;
