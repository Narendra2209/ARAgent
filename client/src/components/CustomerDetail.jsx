import { useEffect, useState } from 'react';
import {
  fetchCustomerDetail,
  updateCustomer,
  fetchComments,
  createComment,
  deleteComment,
} from '../api.js';
import { fmtMoney, fmtRelative } from '../format.js';

/** Today's date as YYYY-MM-DD (local) — pins a comment to the calendar day. */
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
import TierBadge, { tierLabel } from './TierBadge.jsx';

/** "07 Mar 2026, 9:15 AM" — full timestamp for the follow-up line. */
function fmtDateTime(dateLike) {
  if (!dateLike) return '—';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const SEGMENTS = [
  { key: 'current', label: 'Current', color: 'bg-emerald-500' },
  { key: 'b1_30', label: '1–30', color: 'bg-amber-400' },
  { key: 'b31_60', label: '31–60', color: 'bg-amber-500' },
  { key: 'b61_90', label: '61–90', color: 'bg-orange-500' },
  { key: 'b90plus', label: '90+', color: 'bg-red-600' },
];

const ageColor = (age) =>
  age >= 90 ? 'text-red-700' : age >= 60 ? 'text-orange-700' : age >= 30 ? 'text-amber-700' : 'text-emerald-700';

/** Full-page customer view: header + aging, communication/notes, contact, invoices. */
export default function CustomerDetail({ customerId, onBack, onSendReminder }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // Editable contact (email/phone) — seeded from the loaded detail.
  const [contactEdit, setContactEdit] = useState({ email: '', phone: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [contactError, setContactError] = useState(null);
  // Comments / notes for this customer (shared with the Calendar).
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState(null);

  useEffect(() => {
    if (!customerId) return;
    setData(null);
    setError(null);
    setContactSaved(false);
    setContactError(null);
    let alive = true;
    fetchCustomerDetail(customerId)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setContactEdit({ email: d.contact?.email || '', phone: d.contact?.phone || '' });
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [customerId]);

  // Load this customer's comments whenever the drawer opens for a new customer.
  useEffect(() => {
    if (!customerId) return;
    let alive = true;
    setComments([]);
    setCommentText('');
    setCommentError(null);
    fetchComments({ customerId })
      .then((r) => alive && setComments(r.comments || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [customerId]);

  const addComment = async () => {
    if (!commentText.trim()) return;
    setPostingComment(true);
    setCommentError(null);
    try {
      const { comment } = await createComment({
        date: todayYmd(),
        body: commentText.trim(),
        type: 'note',
        customerId,
        customerName: data?.customer?.customerName || '',
      });
      setComments((cs) => [comment, ...cs]);
      setCommentText('');
    } catch (e) {
      setCommentError(e.message);
    } finally {
      setPostingComment(false);
    }
  };

  const removeComment = async (id) => {
    try {
      await deleteComment(id);
      setComments((cs) => cs.filter((c) => c._id !== id));
    } catch (e) {
      setCommentError(e.message);
    }
  };

  const saveContact = async () => {
    setSavingContact(true);
    setContactError(null);
    setContactSaved(false);
    try {
      await updateCustomer(customerId, {
        emailOverride: contactEdit.email,
        phoneOverride: contactEdit.phone,
      });
      setData((d) =>
        d
          ? {
              ...d,
              contact: {
                ...(d.contact || {}),
                email: contactEdit.email,
                phone: contactEdit.phone,
                usingDefaultEmail: contactEdit.email ? false : d.contact?.usingDefaultEmail,
              },
            }
          : d
      );
      setContactSaved(true);
      setTimeout(() => setContactSaved(false), 1800);
    } catch (e) {
      setContactError(e.message);
    } finally {
      setSavingContact(false);
    }
  };

  if (!customerId) return null;

  const c = data?.customer;
  const denom = c ? SEGMENTS.reduce((s, seg) => s + Math.abs(c[seg.key] || 0), 0) || 1 : 1;
  const sortedComments = [...comments].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-500 mb-3">
        <button onClick={onBack} className="hover:text-stone-900">Customers</button>
        <span>/</span>
        <span className="text-stone-900">{c?.customerName || 'Customer'}</span>
      </div>

      {error && (
        <div className="px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}
      {!data && !error && (
        <div className="px-6 py-16 text-center text-stone-400">Loading customer…</div>
      )}

      {data && (
        <>
          {/* Header card */}
          <div className="bg-white border border-stone-200 rounded-lg p-5 mb-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-semibold">{c.customerName}</h1>
                  {c.tier && <TierBadge tier={c.tier} withLabel />}
                </div>
                <div className="flex items-center gap-3 mt-2 text-sm text-stone-600">
                  <span className="mono">{customerId}</span>
                  <span>·</span>
                  <span>Avg oldest {c.oldestDays || 0} days</span>
                  {/* Branch is omitted entirely for customers outside the split. */}
                  {data.contact?.branch ? (
                    <>
                      <span>·</span>
                      <span>Branch {data.contact.branch}</span>
                    </>
                  ) : null}
                  {data.contact?.creditLimit ? (
                    <>
                      <span>·</span>
                      <span>Credit limit {fmtMoney(data.contact.creditLimit)}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onBack}
                  className="text-sm px-3 py-1.5 border border-stone-300 rounded hover:bg-stone-50"
                >
                  ← Back
                </button>
                {onSendReminder && (
                  <button
                    onClick={() => onSendReminder(customerId)}
                    className="text-sm px-3 py-1.5 bg-stone-900 text-white rounded hover:bg-stone-800"
                  >
                    Send reminder
                  </button>
                )}
              </div>
            </div>

            {/* Outstanding + aging bar */}
            <div className="mt-5">
              <div className="flex justify-between text-xs text-stone-500 mb-1.5">
                <span>
                  Outstanding:{' '}
                  <span className="text-stone-900 font-semibold mono">{fmtMoney(c.total)}</span>
                </span>
                <span>
                  Oldest: <span className="mono">{c.oldestDays || 0}d</span>
                </span>
              </div>
              <div className="flex h-2 rounded overflow-hidden bg-stone-100">
                {SEGMENTS.map((seg) => {
                  const w = (Math.abs(c[seg.key] || 0) / denom) * 100;
                  if (w <= 0) return null;
                  return <div key={seg.key} className={seg.color} style={{ width: `${w}%` }} />;
                })}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 mt-3 text-xs">
                {SEGMENTS.map((seg) => (
                  <div key={seg.key} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-sm ${seg.color}`} />
                    {seg.label}
                    <span className="ml-auto mono font-medium">{fmtMoney(c[seg.key] || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Two-column body */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            {/* Left: notes/comments + follow-up history */}
            <div className="xl:col-span-2 space-y-5">
              {/* Notes & comments */}
              <div className="bg-white border border-stone-200 rounded-lg p-5">
                <h3 className="font-semibold text-sm mb-2">Notes &amp; comments</h3>
                <textarea
                  rows={3}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a note about this customer (call summary, agreement, reminder)…"
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:border-orange-500"
                />
                {commentError && <div className="mt-1 text-xs text-red-700">{commentError}</div>}
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[11px] text-stone-400">Saved notes also appear on the Calendar.</span>
                  <button
                    onClick={addComment}
                    disabled={postingComment || !commentText.trim()}
                    className="text-xs px-3 py-1.5 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:opacity-50"
                  >
                    {postingComment ? 'Adding…' : 'Add comment'}
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {sortedComments.map((cm) => (
                    <div key={cm._id} className="bg-stone-50 border border-stone-200 rounded-lg p-3 text-sm">
                      <div className="flex items-center justify-between text-xs text-stone-500">
                        <span>{cm.createdBy || 'You'} · {fmtDateTime(cm.createdAt)}</span>
                        <button
                          onClick={() => removeComment(cm._id)}
                          className="text-stone-400 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                      <div className="mt-1 text-stone-700 whitespace-pre-wrap">{cm.body}</div>
                    </div>
                  ))}
                  {comments.length === 0 && <div className="text-xs text-stone-400">No comments yet.</div>}
                </div>
              </div>

              {/* Follow-up history (from the email log) */}
              <div className="bg-white border border-stone-200 rounded-lg p-5">
                <h3 className="font-semibold text-sm mb-2">Follow-up history</h3>
                {data.lastFollowUp ? (
                  <div className="space-y-2">
                    {(data.followUps || [data.lastFollowUp]).slice(0, 8).map((f, i) => (
                      <div key={i} className="bg-stone-50 border border-stone-200 rounded-lg p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${f.status === 'sent' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            <span className="font-medium">Reminder {f.status === 'sent' ? 'sent' : 'failed'}</span>
                            {f.testMode && (
                              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-stone-200 text-stone-600">test</span>
                            )}
                          </div>
                          <span className="text-xs text-stone-500" title={fmtDateTime(f.sentAt)}>{fmtRelative(f.sentAt)}</span>
                        </div>
                        {f.subject && <div className="mt-1 text-stone-700">{f.subject}</div>}
                        <div className="mt-1 text-xs text-stone-500">
                          {fmtDateTime(f.sentAt)} · by <span className="text-stone-700">{f.sentBy || 'AR system'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-stone-500">No follow-up has been sent to this customer yet.</div>
                )}
              </div>
            </div>

            {/* Right: contact + open invoices */}
            <div className="space-y-5">
              {/* Contact — editable */}
              <div className="bg-white border border-stone-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">Contact</h3>
                  {data.contact?.usingDefaultEmail && !contactEdit.email && (
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                      using default email
                    </span>
                  )}
                </div>
                {data.contact?.name && <div className="text-sm font-medium mb-2">{data.contact.name}</div>}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-stone-500">Email</label>
                    <input
                      type="email"
                      value={contactEdit.email}
                      onChange={(e) => setContactEdit((s) => ({ ...s, email: e.target.value }))}
                      placeholder="email@…"
                      className="w-full mt-1 px-2 py-1.5 border border-stone-300 rounded text-sm focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500">Phone</label>
                    <input
                      type="tel"
                      value={contactEdit.phone}
                      onChange={(e) => setContactEdit((s) => ({ ...s, phone: e.target.value }))}
                      placeholder="phone"
                      className="w-full mt-1 px-2 py-1.5 border border-stone-300 rounded text-sm focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  {contactError && <div className="text-xs text-red-700">{contactError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveContact}
                      disabled={savingContact}
                      className="text-xs px-3 py-1.5 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:opacity-50"
                    >
                      {savingContact ? 'Saving…' : 'Save contact'}
                    </button>
                    {contactSaved && <span className="text-xs text-emerald-700">✓ Saved</span>}
                  </div>
                </div>
              </div>

              {/* Open invoices */}
              <div className="bg-white border border-stone-200 rounded-lg">
                <div className="px-4 py-3 border-b border-stone-200">
                  <h3 className="font-semibold text-sm">
                    Open invoices <span className="text-stone-400 font-normal">({data.invoiceCount})</span>
                  </h3>
                </div>
                <div className="divide-y divide-stone-100 max-h-96 overflow-y-auto scroll-thin">
                  {data.invoices.map((inv, i) => (
                    <div key={inv.refNbr || i} className="px-4 py-2.5 hover:bg-stone-50">
                      <div className="flex justify-between items-baseline">
                        <span className="text-sm font-medium mono">{inv.refNbr || '—'}</span>
                        <span className="text-sm mono font-medium">{fmtMoney(inv.balance)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-stone-500 mt-0.5">
                        <span>{inv.date || '—'}</span>
                        <span className={ageColor(inv.age)}>{inv.age > 0 ? `${inv.age} days` : 'current'}</span>
                      </div>
                    </div>
                  ))}
                  {data.invoices.length === 0 && (
                    <div className="px-4 py-8 text-center text-stone-400 text-sm">No open invoices.</div>
                  )}
                </div>
              </div>

              <p className="text-xs text-stone-400">
                Tier <strong>{c.tier}</strong>
                {tierLabel(c.tier) ? ` (${tierLabel(c.tier)})` : ''} is computed automatically from balance
                and overdue age, as of {data.asOfDate}.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
