import { ActionForm, SubmitButton } from './ActionForm';
import { saveSupplierAction } from '@/app/actions';
import type { SupplierRow } from '@/lib/crm';

export function SupplierForm({ s, next }: { s?: SupplierRow | null; next?: string }) {
  return (
    <ActionForm action={saveSupplierAction} className="form">
      {s && <input type="hidden" name="id" value={s.id} />}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="grid">
        <label className="field"><span className="field-label">Supplier / company name *</span><input name="name" defaultValue={s?.name ?? ''} required maxLength={120} /></label>
        <label className="field"><span className="field-label">Contact person</span><input name="contact_person" defaultValue={s?.contact_person ?? ''} maxLength={80} placeholder="Used in “Dear …”" /></label>
        <label className="field"><span className="field-label">Email</span><input name="email" type="email" defaultValue={s?.email ?? ''} maxLength={200} /></label>
        <label className="field"><span className="field-label">WhatsApp</span><input name="whatsapp" defaultValue={s?.whatsapp ?? ''} inputMode="tel" maxLength={30} placeholder="+66 81 234 5678" /></label>
        <label className="field"><span className="field-label">Phone</span><input name="phone" defaultValue={s?.phone ?? ''} inputMode="tel" maxLength={30} /></label>
        <label className="field"><span className="field-label">Destinations covered</span><input name="destinations" defaultValue={s?.destinations ?? ''} maxLength={300} placeholder="Thailand, Bali, Vietnam" /></label>
        <label className="field field-wide"><span className="field-label">Services</span><input name="services" defaultValue={s?.services ?? ''} maxLength={300} placeholder="Land packages, hotels, transfers, sightseeing" /></label>
        <label className="field field-wide"><span className="field-label">Notes</span><textarea name="notes" defaultValue={s?.notes ?? ''} rows={2} maxLength={2000} placeholder="Payment terms, commission, best contact time…" /></label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Indian numbers can be typed without +91. Add the country code for overseas suppliers.</p>
      <div className="form-actions"><SubmitButton>{s ? 'Save changes' : 'Add supplier'}</SubmitButton></div>
    </ActionForm>
  );
}
