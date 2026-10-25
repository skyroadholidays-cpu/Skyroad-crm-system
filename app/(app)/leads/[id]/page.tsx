import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { inSeries } from '@/lib/db-core';
import { fmtDate, fmtDateTime, todayIST, addDays } from '@/lib/dates';
import { inr } from '@/lib/money';
import { durationLabel } from '@/lib/quick-parse';
import * as T from '@/lib/templates';
import { getSupplierTemplate } from '@/lib/settings';
import {
  ALL_STATUSES, STAGE_LABEL, PACKAGE_LABEL, PAYMENT_KINDS, PAYMENT_MODES, QUOTE_STATUS, CHANNELS, ACTIVITY_LABEL, LOGGABLE,
  stageRank,
} from '@/lib/constants';
import { Card, Empty, Flash, Money, PageHeader, StageBadge, Stepper } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { CopyButton } from '@/components/client';
import { PriorityDot } from '@/components/LeadBits';
import {
  setStageAction, logInteractionAction, setFollowUpAction, requestQuotesAction, updateQuoteAction, removeQuoteAction,
  shareQuoteAction, confirmBookingAction, addPaymentAction, deletePaymentAction, deleteLeadAction, restoreLeadAction, purgeLeadAction,
} from '@/app/actions';

export const metadata = { title: 'Enquiry' };

function nextStep(l: C.LeadRow): { title: string; text: string; href: string } {
  switch (l.stage) {
    case 'new_query': return { title: 'Ask suppliers for rates', text: 'Tick the suppliers below, record the request, then press Gmail or WhatsApp to send the ready-made message.', href: '#suppliers' };
    case 'supplier_mailed': return { title: 'Waiting for supplier quotes', text: 'When a supplier replies, enter their price in the Suppliers table – the stage moves on by itself.', href: '#suppliers' };
    case 'quote_received': return { title: 'Send your quote / itinerary to the client', text: 'Enter your selling price and the itinerary link, then send it on WhatsApp.', href: '#quote' };
    case 'quote_shared':
    case 'follow_up': return { title: 'Follow up for a decision', text: 'Log each call or WhatsApp below. When the client says yes, press “Confirm booking”.', href: '#quote' };
    case 'booking_confirmed': return { title: 'Collect the advance', text: 'Record the advance payment – the stage updates automatically.', href: '#payments' };
    case 'advance_received': return { title: 'Collect the final payment', text: 'Send a payment reminder before travel and record the balance when it arrives.', href: '#payments' };
    case 'final_payment_received': return { title: 'Fully paid – share vouchers', text: 'The enquiry moves to Travelling on the start date and to Completed after the trip.', href: '#timeline' };
    case 'travelling': return { title: 'Client is travelling', text: 'Keep an eye on WhatsApp for any help they need.', href: '#timeline' };
    case 'completed': return { title: 'Trip completed', text: 'Ask for a Google review and a referral – happy clients are your best leads.', href: '#timeline' };
    default: return { title: 'Lost', text: l.lost_reason ? `Reason: ${l.lost_reason}. You can reopen it from “Change stage”.` : 'You can reopen it from “Change stage”.', href: '#stage' };
  }
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const l = await C.getLead(Number(id));
  if (!l) notFound();
  const [quotes, payments, activity, suppliers] = await inSeries(
    () => C.listQuotes(l.id), () => C.listPayments(l.id), () => C.listActivity(l.id), () => C.listSuppliers(false),
  );
  const tpl = await getSupplierTemplate();
  const today = todayIST();
  const deleted = !!l.deleted_at;
  const step = nextStep(l);
  const onLead = new Set(quotes.map((q) => q.supplier_id));
  const destWords = l.destination.toLowerCase().split(/[\s,+/]+/).filter((w) => w.length > 2);
  const matches = (s: C.SupplierRow) => !!s.destinations && destWords.some((w) => s.destinations!.toLowerCase().includes(w));
  const sortedSuppliers = [...suppliers].sort((a, b) => Number(matches(b)) - Number(matches(a)) || a.name.localeCompare(b.name));
  const waClient = T.digitsForWhatsApp(l.phone);
  const quoteMsg = T.clientQuote(l);
  const won = stageRank(l.stage) >= 6;

  return (
    <div className="stack">
      <PageHeader
        title={`${l.client_name} · ${l.destination}`}
        subtitle={<><PriorityDot p={l.priority} />{l.lead_no} &nbsp;<StageBadge stage={l.stage} /> &nbsp;<span className="muted small">received {fmtDateTime(l.created_at)}</span></>}
        actions={deleted ? undefined : <>
          {waClient && <a className="btn btn-wa" href={T.whatsappLink(l.phone, `Hi ${l.client_name.split(' ')[0]}, `)} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
          {l.phone && <a className="btn btn-ghost" href={`tel:${l.phone}`}>Call</a>}
          <Link href={`/leads/${l.id}/edit`} className="btn btn-ghost">Edit</Link>
          <ActionForm action={deleteLeadAction} confirm={`Delete ${l.lead_no}? It moves to Settings → Trash, where you can restore it or delete it forever.`}>
            <input type="hidden" name="id" value={l.id} />
            <SubmitButton className="btn btn-danger" pendingText="Deleting…">Delete</SubmitButton>
          </ActionForm>
        </>}
      />
      {sp.saved && <Flash>Saved.</Flash>}
      {sp.shared && <Flash>Quote saved and stage moved to “Quote / itinerary shared”. Send it with the WhatsApp button below. A follow-up has been set.</Flash>}
      {sp.confirmed && <Flash>Booking confirmed 🎉</Flash>}
      {sp.restored && <Flash>Restored.</Flash>}
      {deleted && (
        <div className="alert alert-warn">This enquiry was deleted {fmtDateTime(l.deleted_at)}.
          <ActionForm action={restoreLeadAction}><input type="hidden" name="id" value={l.id} /><SubmitButton className="btn btn-ghost btn-sm">Restore</SubmitButton></ActionForm>
          <ActionForm action={purgeLeadAction} confirm={`Delete ${l.lead_no} forever? Its supplier quotes, payments and timeline are removed too. This cannot be undone.`}><input type="hidden" name="id" value={l.id} /><SubmitButton className="btn btn-danger btn-sm" pendingText="Deleting…">Delete forever</SubmitButton></ActionForm>
        </div>
      )}

      <Card className="journey">
        <Stepper stage={l.stage} />
        <div className="next-step">
          <div><span className="section-label">Next step</span><strong>{step.title}</strong><p className="muted small" style={{ margin: 0 }}>{step.text}</p></div>
          <a href={step.href} className="btn btn-primary btn-sm">Go</a>
        </div>
      </Card>

      <div className="lead-grid">
        <div className="stack">
          <Card title="Trip details">
            <dl className="dl">
              <dt>Destination</dt><dd><strong>{l.destination}</strong>{l.trip_type ? <span className="muted"> · {l.trip_type === 'domestic' ? 'Domestic' : 'International'}</span> : null}</dd>
              <dt>Dates</dt><dd>{l.travel_start ? <>{fmtDate(l.travel_start)}{l.travel_end ? ` – ${fmtDate(l.travel_end)}` : ''} <span className="muted">{durationLabel(l.travel_start, l.travel_end)}</span></> : 'To be confirmed'}{l.flexible_dates ? <span className="pill" style={{ marginLeft: 6 }}>Flexible</span> : null}</dd>
              <dt>Travellers</dt><dd>{T.paxText(l)}</dd>
              <dt>Nights plan</dt><dd>{l.nights_plan || '—'}</dd>
              <dt>Package</dt><dd>{l.package_type ? PACKAGE_LABEL[l.package_type] ?? l.package_type : '—'}</dd>
              <dt>Inclusions</dt><dd>{l.inclusions.length ? <span className="tags">{l.inclusions.map((x) => <span key={x} className="tag">{x}</span>)}</span> : '—'}</dd>
              <dt>Hotel</dt><dd>{l.hotel_category || '—'}</dd>
              <dt>Rooms · meals</dt><dd>{l.rooms ? `${l.rooms} room${l.rooms === 1 ? '' : 's'}` : '—'}{l.meal_plan ? ` · ${l.meal_plan}` : ''}</dd>
              <dt>Budget</dt><dd>{l.budget ? <>{inr(l.budget)} {l.budget_basis === 'per_person' ? 'per person' : 'total'}</> : '—'}</dd>
              <dt>Special requests</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{l.requirements || '—'}</dd>
              {l.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{l.notes}</dd></>}
            </dl>
          </Card>

          <Card title={<span id="suppliers">Suppliers & quotes</span>} actions={<span className="muted small">{l.quotes_received}/{l.quotes_requested} quoted{l.best_quote ? ` · best ${inr(l.best_quote)}` : ''}</span>}>
            {quotes.length === 0 ? <p className="muted small" style={{ marginTop: 0 }}>No supplier has been asked yet.</p> : (
              <div className="quotes">
                {quotes.map((q) => {
                  const msg = T.supplierRequest(l, q.contact_person, tpl, q.supplier_name);
                  const waNo = q.whatsapp || q.phone;
                  return (
                    <div key={q.id} className={`quote q-${q.status}`}>
                      <div className="q-head">
                        <div><strong>{q.supplier_name}</strong><span className="sub">{CHANNELS[q.channel as keyof typeof CHANNELS]} · asked {fmtDateTime(q.requested_at)}{q.email ? ` · ${q.email}` : ''}</span></div>
                        <div className="q-amt">{q.amount ? <><span className="muted small">{q.currency} </span><strong>{q.currency === 'INR' ? inr(q.amount) : Number(q.amount).toLocaleString('en-IN')}</strong></> : <span className={`status ${q.status === 'declined' ? 's-overdue' : 's-pending'}`}>{QUOTE_STATUS[q.status]}</span>}
                          {q.status === 'selected' && <span className="status s-done" style={{ marginLeft: 6 }}>Selected</span>}</div>
                      </div>
                      {!deleted && (
                        <>
                          <div className="row q-send">
                            {q.email && <a className="btn btn-ghost btn-sm" href={T.gmailLink(q.email, msg.subject, msg.body)} target="_blank" rel="noopener noreferrer">Gmail</a>}
                            {q.email && <a className="btn btn-ghost btn-sm" href={T.mailtoLink(q.email, msg.subject, msg.body)}>Mail app</a>}
                            {T.digitsForWhatsApp(waNo) && <a className="btn btn-wa btn-sm" href={T.whatsappLink(waNo, msg.body)} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                            <CopyButton text={`${msg.subject}\n\n${msg.body}`} label="Copy message" />
                          </div>
                          <ActionForm action={updateQuoteAction} className="q-form">
                            <input type="hidden" name="id" value={q.id} />
                            <select name="status" defaultValue={q.status} aria-label="Status">
                              {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                            <input name="currency" defaultValue={q.currency} maxLength={3} aria-label="Currency" className="cur" />
                            <input name="amount" defaultValue={q.amount ?? ''} inputMode="decimal" placeholder="Quoted amount" aria-label="Amount" />
                            <input type="date" name="valid_until" defaultValue={q.valid_until ?? ''} aria-label="Valid until" title="Valid until" />
                            <input name="notes" defaultValue={q.notes ?? ''} placeholder="Hotels / notes" aria-label="Notes" className="grow" />
                            <SubmitButton className="btn btn-primary btn-sm">Save</SubmitButton>
                          </ActionForm>
                          <ActionForm action={removeQuoteAction} confirm={`Remove ${q.supplier_name} from this enquiry?`} className="q-remove">
                            <input type="hidden" name="id" value={q.id} />
                            <SubmitButton className="btn btn-link small" pendingText="…">Remove</SubmitButton>
                          </ActionForm>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!deleted && (
              <details className="ask" open={quotes.length === 0}>
                <summary>{quotes.length ? 'Ask more suppliers' : 'Ask suppliers for rates'}</summary>
                {suppliers.length === 0 ? (
                  <p className="small">No suppliers yet. <Link href={`/suppliers?next=/leads/${l.id}`}>Add your suppliers</Link> (name, email, WhatsApp, destinations) – you only do this once.</p>
                ) : (
                  <ActionForm action={requestQuotesAction} className="form">
                    <input type="hidden" name="lead_id" value={l.id} />
                    <div className="supplier-picks">
                      {sortedSuppliers.map((s) => (
                        <label key={s.id} className={`chip chip-check${matches(s) ? ' chip-match' : ''}`}>
                          <input type="checkbox" name="supplier_id" value={s.id} defaultChecked={!onLead.has(s.id) && matches(s) && quotes.length === 0} />
                          {s.name}{onLead.has(s.id) ? ' ✓' : ''}{s.destinations ? <span className="muted small"> · {s.destinations}</span> : null}
                        </label>
                      ))}
                    </div>
                    <div className="row">
                      <select name="channel" defaultValue="email" style={{ width: 'auto' }}>
                        {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>Sent by {v}</option>)}
                      </select>
                      <SubmitButton className="btn btn-primary">Record request</SubmitButton>
                      <Link href={`/suppliers?next=/leads/${l.id}`} className="btn btn-link small">+ New supplier</Link>
                    </div>
                    <p className="muted small" style={{ margin: 0 }}>Suppliers who cover {l.destination} are highlighted. After recording, use each supplier’s Gmail / WhatsApp button – the standard message is ready.</p>
                  </ActionForm>
                )}
                <details className="preview">
                  <summary>Preview the standard supplier message</summary>
                  {(() => { const m = T.supplierRequest(l, null, tpl); return <><p className="small"><strong>Subject:</strong> {m.subject}</p><pre className="msg">{m.body}</pre><CopyButton text={`${m.subject}\n\n${m.body}`} label="Copy message" /></>; })()}
                </details>
              </details>
            )}
          </Card>

          <Card title={<span id="quote">Quote to client & booking</span>}>
            <div className="kv" style={{ marginBottom: 12 }}>
              <div><span>Your price</span><strong>{l.quote_amount ? inr(l.quote_amount) : '—'}</strong></div>
              <div><span>Supplier cost</span><strong>{l.supplier_cost ? inr(l.supplier_cost) : '—'}</strong></div>
              <div><span>Margin</span><strong className={l.margin && Number(l.margin) < 0 ? 'neg' : 'pos'}>{l.margin ? inr(l.margin) : '—'}</strong></div>
              <div><span>Booking ref</span><strong>{l.booking_ref || '—'}</strong></div>
            </div>
            {l.itinerary_url && <p className="small"><a href={l.itinerary_url} target="_blank" rel="noopener noreferrer">Open itinerary ↗</a>{l.quote_shared_at ? <span className="muted"> · shared {fmtDateTime(l.quote_shared_at)}</span> : null}</p>}
            {l.quote_amount && (
              <div className="row">
                {waClient && <a className="btn btn-wa btn-sm" href={T.whatsappLink(l.phone, quoteMsg)} target="_blank" rel="noopener noreferrer">Send quote on WhatsApp</a>}
                {l.email && <a className="btn btn-ghost btn-sm" href={T.gmailLink(l.email, `Your ${l.destination} holiday – ${l.lead_no}`, quoteMsg)} target="_blank" rel="noopener noreferrer">Email quote</a>}
                <CopyButton text={quoteMsg} label="Copy quote message" />
                {won && <a className="btn btn-ghost btn-sm" href={T.whatsappLink(l.phone, T.bookingConfirmation(l))} target="_blank" rel="noopener noreferrer">Send confirmation</a>}
              </div>
            )}
            {!deleted && !won && (
              <div className="two-col tight">
                <ActionForm action={shareQuoteAction} className="form subform">
                  <p className="section-label">{l.quote_shared_at ? 'Update quote' : 'Share quote / itinerary'}</p>
                  <input type="hidden" name="id" value={l.id} />
                  <label className="field"><span className="field-label">Your selling price (₹) *</span>
                    <input name="quote_amount" defaultValue={l.quote_amount ?? ''} inputMode="decimal" required placeholder="1,45,000" /></label>
                  <label className="field"><span className="field-label">Itinerary link (Canva / PDF)</span>
                    <input name="itinerary_url" type="url" defaultValue={l.itinerary_url ?? ''} placeholder="https://www.canva.com/design/…" /></label>
                  <label className="field"><span className="field-label">Follow up on</span>
                    <input name="next_follow_up" type="date" defaultValue={addDays(today, 2)} /></label>
                  <SubmitButton>Save & mark as shared</SubmitButton>
                </ActionForm>
                <ActionForm action={confirmBookingAction} className="form subform">
                  <p className="section-label">Client said yes – confirm booking</p>
                  <input type="hidden" name="id" value={l.id} />
                  <label className="field"><span className="field-label">Booking reference</span>
                    <input name="booking_ref" defaultValue={l.booking_ref ?? ''} maxLength={40} placeholder={`SR-${l.destination.slice(0, 3).toUpperCase()}-${l.lead_no.slice(-3)}`} /></label>
                  <label className="field"><span className="field-label">Final package price (₹)</span>
                    <input name="quote_amount" defaultValue={l.quote_amount ?? ''} inputMode="decimal" /></label>
                  <div className="grid">
                    <label className="field field-wide"><span className="field-label">Advance received (₹)</span><input name="advance_amount" inputMode="decimal" placeholder="Optional" /></label>
                    <label className="field"><span className="field-label">On</span><input name="advance_date" type="date" defaultValue={today} max={today} /></label>
                    <label className="field"><span className="field-label">By</span>
                      <select name="advance_mode" defaultValue="UPI">{PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
                  </div>
                  <SubmitButton>Confirm booking</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>

          <Card title={<span id="payments">Client payments</span>} actions={l.quote_amount ? <span className="muted small">Package {inr(l.quote_amount)}</span> : undefined}>
            <div className="kv kv-3" style={{ marginBottom: 12 }}>
              <div><span>Received</span><strong className="pos">{inr(l.paid)}</strong></div>
              <div><span>Balance due</span><strong className={Number(l.balance_due) > 0 ? 'neg' : ''}>{l.balance_due === null ? '—' : inr(l.balance_due)}</strong></div>
              <div><span>Last payment</span><strong>{fmtDate(l.last_paid_on)}</strong></div>
            </div>
            {payments.length > 0 && (
              <table><tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{PAYMENT_KINDS[p.kind]}<span className="sub">{fmtDate(p.paid_on)}{p.mode ? ` · ${p.mode}` : ''}{p.reference ? ` · ${p.reference}` : ''}</span></td>
                    <td className="num"><Money value={p.amount} /></td>
                    <td className="num">{!deleted && (
                      <ActionForm action={deletePaymentAction} confirm={`Delete this payment of ${inr(p.amount)}?`}>
                        <input type="hidden" name="id" value={p.id} />
                        <SubmitButton className="btn btn-link small" pendingText="…">Delete</SubmitButton>
                      </ActionForm>)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
            {Number(l.balance_due) > 0 && waClient && <p><a className="btn btn-wa btn-sm" href={T.whatsappLink(l.phone, T.paymentReminder(l))} target="_blank" rel="noopener noreferrer">Send payment reminder</a></p>}
            {!deleted && (
              <ActionForm action={addPaymentAction} className="form subform">
                <input type="hidden" name="lead_id" value={l.id} />
                <input type="hidden" name="idem" value={randomUUID()} />
                <div className="grid grid-4">
                  <label className="field"><span className="field-label">Payment</span>
                    <select name="kind" defaultValue={Number(l.paid) > 0 ? 'final' : 'advance'}>
                      {Object.entries(PAYMENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></label>
                  <label className="field"><span className="field-label">Amount (₹)</span><input name="amount" inputMode="decimal" required defaultValue={Number(l.paid) > 0 && Number(l.balance_due) > 0 ? l.balance_due! : ''} /></label>
                  <label className="field"><span className="field-label">Date</span><input name="date" type="date" defaultValue={today} max={today} /></label>
                  <label className="field"><span className="field-label">Mode</span>
                    <select name="mode" defaultValue="UPI">{PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
                </div>
                <label className="field"><span className="field-label">Reference</span><input name="reference" maxLength={80} placeholder="UTR / receipt no. (optional)" /></label>
                <SubmitButton>Record payment</SubmitButton>
                <p className="muted small" style={{ margin: 0 }}>Remember to also add physical cash to the Cash Management System.</p>
              </ActionForm>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Client">
            <dl className="dl">
              <dt>Name</dt><dd>{l.client_name}</dd>
              <dt>Mobile</dt><dd>{l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : '—'}</dd>
              <dt>Email</dt><dd>{l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : '—'}</dd>
              <dt>City</dt><dd>{l.city || '—'}</dd>
              <dt>Source</dt><dd>{l.lead_source || '—'}</dd>
            </dl>
          </Card>

          {!deleted && (
            <Card title="Follow-up">
              <p style={{ marginTop: 0 }}>{l.next_follow_up
                ? <><strong className={l.follow_up_overdue ? 'neg' : ''}>{fmtDate(l.next_follow_up)}</strong>{l.follow_up_overdue ? ' (overdue)' : ''}{l.follow_up_note ? <span className="sub">{l.follow_up_note}</span> : null}</>
                : <span className="muted">No follow-up set</span>}</p>
              <ActionForm action={setFollowUpAction} className="form">
                <input type="hidden" name="id" value={l.id} />
                <div className="row nowrap">
                  <input type="date" name="next_follow_up" defaultValue={l.next_follow_up ?? addDays(today, 1)} aria-label="Follow-up date" />
                  <SubmitButton className="btn btn-ghost btn-sm">Set</SubmitButton>
                  {l.next_follow_up && <SubmitButton className="btn btn-link small" name="clear" value="1">Clear</SubmitButton>}
                </div>
                <input name="follow_up_note" defaultValue={l.follow_up_note ?? ''} placeholder="What to follow up on" maxLength={300} />
              </ActionForm>
              {waClient && stageRank(l.stage) <= 5 && <p className="small" style={{ marginBottom: 0 }}><a className="btn btn-wa btn-sm" href={T.whatsappLink(l.phone, T.clientFollowUp(l))} target="_blank" rel="noopener noreferrer">WhatsApp follow-up message</a></p>}
            </Card>
          )}

          {!deleted && (
            <Card title="Log a call / message">
              <ActionForm action={logInteractionAction} className="form">
                <input type="hidden" name="id" value={l.id} />
                <div className="seg">
                  {LOGGABLE.map((k, i) => (
                    <label key={k} className="seg-opt"><input type="radio" name="kind" value={k} defaultChecked={i === 0} />{ACTIVITY_LABEL[k]}</label>
                  ))}
                </div>
                <textarea name="body" rows={2} required placeholder="What was discussed?" maxLength={4000} />
                <label className="field"><span className="field-label">Next follow-up (optional)</span><input type="date" name="next_follow_up" /></label>
                <SubmitButton className="btn btn-primary btn-sm">Save to timeline</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {!deleted && (
            <Card title={<span id="stage">Change stage</span>}>
              <ActionForm action={setStageAction} className="form">
                <input type="hidden" name="id" value={l.id} />
                <select name="stage" defaultValue={l.status}>
                  {ALL_STATUSES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                <input name="lost_reason" placeholder="If lost: why? (price, dates, booked elsewhere…)" maxLength={300} />
                <input name="note" placeholder="Note (optional)" maxLength={300} />
                <SubmitButton className="btn btn-ghost btn-sm">Update stage</SubmitButton>
                <p className="muted small" style={{ margin: 0 }}>Most stages change on their own when you record the event. Use this only to correct or skip.</p>
              </ActionForm>
            </Card>
          )}

          <Card title={<span id="timeline">Timeline</span>}>
            {activity.length === 0 ? <Empty title="Nothing yet" /> : (
              <ul className="timeline">
                {activity.map((a) => (
                  <li key={a.id} className={`tl-${a.kind}`}>
                    <span className="tl-kind">{ACTIVITY_LABEL[a.kind] ?? a.kind}</span>
                    <div><span style={{ whiteSpace: 'pre-wrap' }}>{a.body}</span><span className="sub">{fmtDateTime(a.at)}{a.actor ? ` · ${a.actor}` : ''}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {!deleted && (
            <ActionForm action={deleteLeadAction} confirm={`Delete ${l.lead_no}? It moves to Settings → Trash, where you can restore it or delete it forever.`}>
              <input type="hidden" name="id" value={l.id} />
              <SubmitButton className="btn btn-link small danger" pendingText="Deleting…">Delete this enquiry</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </div>
  );
}
