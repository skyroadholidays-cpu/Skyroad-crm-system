'use client';
import { useState } from 'react';
import { ActionForm, SubmitButton } from './ActionForm';
import type { FormState } from '@/app/actions';
import { parseEnquiry, durationLabel, slotsFound, ORDER, SLOT_LABEL, ORDER_TEMPLATE, ORDER_PLACEHOLDER, type ParsedEnquiry, type Slot } from '@/lib/quick-parse';
import { LEAD_SOURCES, HOTEL_CATEGORIES, PACKAGE_TYPES, INCLUSIONS, PRIORITIES, inclusionsForPackage } from '@/lib/constants';

export interface LeadFormValues {
  id?: number;
  client_name?: string; phone?: string | null; email?: string | null; city?: string | null; lead_source?: string | null;
  priority?: string; destination?: string; trip_type?: string | null; travel_start?: string | null; travel_end?: string | null;
  flexible_dates?: boolean; adults?: number; children?: number; child_ages?: string | null; infants?: number;
  nights_plan?: string | null; hotel_category?: string | null; package_type?: string | null; inclusions?: string[];
  budget?: string | null; budget_basis?: string; requirements?: string | null; next_follow_up?: string | null;
  follow_up_note?: string | null; notes?: string | null;
}

type V = Required<{ [K in keyof LeadFormValues]: any }>;

export function LeadForm({ action, mode, values, today, idem }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>; mode: 'create' | 'edit'; values: LeadFormValues; today: string; idem?: string;
}) {
  const [v, setV] = useState<V>({
    id: values.id, client_name: values.client_name ?? '', phone: values.phone ?? '', email: values.email ?? '', city: values.city ?? '',
    lead_source: values.lead_source ?? '', priority: values.priority ?? 'normal', destination: values.destination ?? '',
    trip_type: values.trip_type ?? '', travel_start: values.travel_start ?? '', travel_end: values.travel_end ?? '',
    flexible_dates: !!values.flexible_dates, adults: values.adults ?? 2, children: values.children ?? 0, child_ages: values.child_ages ?? '',
    infants: values.infants ?? 0, nights_plan: values.nights_plan ?? '', hotel_category: values.hotel_category ?? '',
    package_type: values.package_type ?? '', inclusions: values.inclusions ?? [], budget: values.budget ?? '',
    budget_basis: values.budget_basis ?? 'total', requirements: values.requirements ?? '', next_follow_up: values.next_follow_up ?? '',
    follow_up_note: values.follow_up_note ?? '', notes: values.notes ?? '',
  });
  const [paste, setPaste] = useState('');
  const [filled, setFilled] = useState<string | null>(null);
  const [found, setFound] = useState<Record<Slot, boolean> | null>(null);
  const set = (k: keyof V) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  function fill() {
    const r: ParsedEnquiry = parseEnquiry(paste, today);
    const keys = Object.keys(r) as (keyof ParsedEnquiry)[];
    setFound(slotsFound(r));
    if (!keys.length) { setFilled('Nothing recognised – use the 6-line order shown, or fill the fields below.'); return; }
    setV((p) => {
      const n = { ...p } as any;
      for (const k of keys) n[k] = k === 'inclusions' ? [...new Set([...(p.inclusions as string[]), ...(r.inclusions ?? [])])] : r[k];
      if (!p.notes) n.notes = `Original enquiry:\n${paste.trim()}`;
      return n;
    });
    const missing = ORDER.filter((k) => !slotsFound(r)[k]).map((k) => SLOT_LABEL[k].toLowerCase());
    setFilled(missing.length ? `Filled the form – please add the ${missing.join(', ')} below.` : 'All 6 items filled – check them below and save.');
  }

  const toggleInc = (x: string) => setV((p) => ({ ...p, inclusions: p.inclusions.includes(x) ? p.inclusions.filter((i: string) => i !== x) : [...p.inclusions, x] }));
  const dur = durationLabel(v.travel_start || null, v.travel_end || null);

  return (
    <ActionForm action={action} className="form lead-form">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      {idem && <input type="hidden" name="idem" value={idem} />}

      {mode === 'create' && (
        <section className="paste-box">
          <label className="field field-wide">
            <span className="field-label">Quick add – one item per line, in this order</span>
            <ol className="order-guide">
              {ORDER.map((k, i) => (
                <li key={k} className={found ? (found[k] ? 'ok' : 'miss') : ''}>
                  <span className="og-n">{found ? (found[k] ? '✓' : '!') : i + 1}</span>{SLOT_LABEL[k]}
                </li>
              ))}
            </ol>
            <textarea value={paste} onChange={(e) => { setPaste(e.target.value); setFound(null); }} rows={6}
                      placeholder={ORDER_PLACEHOLDER} className="order-textarea" />
          </label>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={fill} disabled={!paste.trim()}>Fill the form ↓</button>
            {!paste && <button type="button" className="btn btn-link small" onClick={() => setPaste(ORDER_TEMPLATE)}>Start from an example</button>}
            {filled && <span className={`small ${found && ORDER.some((k) => !found[k]) ? 'warn-text' : 'ok-text'}`}>{filled}</span>}
          </div>
          <p className="muted small" style={{ margin: 0 }}>Name can include the phone · Dates like “1 Dec to 6 Dec” or “flexible” · Destination can include nights (“Thailand – 2N Krabi, 3N Phuket”) · Travellers like “2 adults 1 child” or “2+1” · Package: customised, hotel, transfers, flights or visa. One line also works with “ | ” between items.</p>
        </section>
      )}

      <p className="section-label">Client</p>
      <div className="grid">
        <label className="field"><span className="field-label">Client name *</span>
          <input name="client_name" value={v.client_name} onChange={set('client_name')} required maxLength={120} autoComplete="off" /></label>
        <label className="field"><span className="field-label">Mobile / WhatsApp</span>
          <input name="phone" value={v.phone} onChange={set('phone')} inputMode="tel" maxLength={30} placeholder="98765 43210" /></label>
        <label className="field"><span className="field-label">Email</span>
          <input name="email" type="email" value={v.email} onChange={set('email')} maxLength={200} /></label>
        <label className="field"><span className="field-label">City</span>
          <input name="city" value={v.city} onChange={set('city')} maxLength={80} /></label>
        <label className="field"><span className="field-label">Lead source</span>
          <select name="lead_source" value={v.lead_source} onChange={set('lead_source')}>
            <option value="">— Choose —</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            {v.lead_source && !LEAD_SOURCES.includes(v.lead_source) && <option value={v.lead_source}>{v.lead_source}</option>}
          </select></label>
        <fieldset className="field">
          <span className="field-label">Priority</span>
          <div className="seg">
            {PRIORITIES.map((p) => (
              <label key={p.key} className={`seg-opt p-${p.key}${v.priority === p.key ? ' on' : ''}`}>
                <input type="radio" name="priority" value={p.key} checked={v.priority === p.key} onChange={set('priority')} />{p.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <p className="section-label">Trip</p>
      <div className="grid">
        <label className="field"><span className="field-label">Destination *</span>
          <input name="destination" value={v.destination} onChange={set('destination')} required maxLength={120} placeholder="e.g. Thailand" /></label>
        <label className="field"><span className="field-label">Trip type</span>
          <select name="trip_type" value={v.trip_type} onChange={set('trip_type')}>
            <option value="">—</option><option value="international">International</option><option value="domestic">Domestic</option>
          </select></label>
        <label className="field"><span className="field-label">Travel start</span>
          <input type="date" name="travel_start" value={v.travel_start}
                 onChange={(e) => setV((p) => ({ ...p, travel_start: e.target.value, travel_end: p.travel_end && e.target.value && p.travel_end < e.target.value ? '' : p.travel_end }))} /></label>
        <label className="field"><span className="field-label">Travel end {dur && <span className="muted">· {dur}</span>}</span>
          <input type="date" name="travel_end" value={v.travel_end} min={v.travel_start || undefined} onChange={set('travel_end')} /></label>
        <label className="check flex-check"><input type="checkbox" name="flexible_dates" checked={v.flexible_dates} onChange={(e) => setV((p) => ({ ...p, flexible_dates: e.target.checked }))} /> Dates are flexible</label>
        <label className="field"><span className="field-label">Nights / itinerary plan</span>
          <input name="nights_plan" value={v.nights_plan} onChange={set('nights_plan')} maxLength={300} placeholder="2N Krabi, 3N Phuket" /></label>
      </div>
      <div className="grid grid-4">
        <label className="field"><span className="field-label">Adults</span>
          <input type="number" name="adults" min={0} max={999} value={v.adults} onChange={set('adults')} /></label>
        <label className="field"><span className="field-label">Children</span>
          <input type="number" name="children" min={0} max={999} value={v.children} onChange={set('children')} /></label>
        {Number(v.children) > 0 && (
          <label className="field"><span className="field-label">Child ages</span>
            <input name="child_ages" value={v.child_ages} onChange={set('child_ages')} maxLength={80} placeholder="6, 9" /></label>
        )}
        <label className="field"><span className="field-label">Infants (under 2)</span>
          <input type="number" name="infants" min={0} max={999} value={v.infants} onChange={set('infants')} /></label>
      </div>

      <p className="section-label">Package</p>
      <fieldset className="type-picker pkg-picker">
        {Object.entries(PACKAGE_TYPES).map(([k, label]) => (
          <label key={k} className={`type-opt${v.package_type === k ? ' on' : ''}`}>
            <input type="radio" name="package_type" value={k} checked={v.package_type === k}
                   onChange={() => setV((p) => ({ ...p, package_type: k, inclusions: inclusionsForPackage(p.inclusions, p.package_type, k) }))} />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="incl">
        <span className="field-label">Inclusions needed</span>
        <div className="chips">
          {INCLUSIONS.map((x) => (
            <label key={x} className={`chip chip-check${v.inclusions.includes(x) ? ' chip-on' : ''}`}>
              <input type="checkbox" name="inclusions" value={x} checked={v.inclusions.includes(x)} onChange={() => toggleInc(x)} />{x}
            </label>
          ))}
        </div>
      </div>
      <div className="grid">
        <label className="field"><span className="field-label">Hotel category</span>
          <select name="hotel_category" value={v.hotel_category} onChange={set('hotel_category')}>
            <option value="">— Choose —</option>
            {HOTEL_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
            {v.hotel_category && !HOTEL_CATEGORIES.includes(v.hotel_category) && <option value={v.hotel_category}>{v.hotel_category}</option>}
          </select></label>
        <div className="field">
          <span className="field-label">Client budget (₹)</span>
          <div className="row nowrap">
            <input name="budget" value={v.budget} onChange={set('budget')} inputMode="decimal" placeholder="1,50,000" style={{ flex: 1 }} />
            <select name="budget_basis" value={v.budget_basis} onChange={set('budget_basis')} style={{ width: 'auto' }}>
              <option value="total">total</option><option value="per_person">per person</option>
            </select>
          </div>
        </div>
        <label className="field field-wide"><span className="field-label">Special requests</span>
          <textarea name="requirements" value={v.requirements} onChange={set('requirements')} rows={2} maxLength={2000} placeholder="Pool villa, vegetarian meals, anniversary surprise…" /></label>
      </div>

      <p className="section-label">Next step</p>
      <div className="grid">
        <label className="field"><span className="field-label">Follow-up on</span>
          <input type="date" name="next_follow_up" value={v.next_follow_up} onChange={set('next_follow_up')} /></label>
        <label className="field"><span className="field-label">Follow-up note</span>
          <input name="follow_up_note" value={v.follow_up_note} onChange={set('follow_up_note')} maxLength={300} placeholder="Send options by evening" /></label>
        <label className="field field-wide"><span className="field-label">Internal notes</span>
          <textarea name="notes" value={v.notes} onChange={set('notes')} rows={3} maxLength={4000} /></label>
      </div>

      <div className="form-actions">
        <SubmitButton>{mode === 'create' ? 'Save enquiry' : 'Save changes'}</SubmitButton>
        {mode === 'create' && <SubmitButton className="btn btn-ghost" name="and_new" value="1">Save & add another</SubmitButton>}
      </div>
    </ActionForm>
  );
}
