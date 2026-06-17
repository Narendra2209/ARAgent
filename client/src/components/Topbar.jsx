import { useEffect, useRef, useState } from 'react';
import { exportCsvUrl, importArAging } from '../api.js';
import { Spinner } from './Loader.jsx';

const TITLES = {
  dashboard: 'Dashboard',
  customers: 'Customers',
  invoices: 'Invoices',
  reminders: 'Overdue Reminders',
  calendar: 'Calendar',
  ai_inbox: 'AI Inbox',
  reports: 'Reports',
  users: 'Users',
  settings: 'Settings',
};

// Jump targets for the search palette / quick-add menu.
const JUMP = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'customers', label: 'Customers' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'reminders', label: 'Overdue Reminders' },
  { key: 'ai_inbox', label: 'AI Inbox' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
];

export default function Topbar({
  view,
  setView,
  asOfDate,
  source,
  branches,
  branch,
  onBranchChange,
  onSync,
  syncing,
  onRefresh,
  loading,
  user,
  onLogout,
}) {
  const [overlay, setOverlay] = useState(null); // 'search' | 'add' | 'notif' | null
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const isAdmin = user?.role === 'admin';

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setImporting(true);
    try {
      const res = await importArAging(file);
      alert(
        `Imported MYOB AR Aging as of ${res.asOfDate}: ${res.customerCount} customers, ` +
          `$${Number(res.totalReceivables).toLocaleString()} total.`
      );
      onRefresh?.();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  // ⌘K / Ctrl-K opens search; Escape closes any overlay.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOverlay('search');
      }
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (key) => {
    setOverlay(null);
    setQ('');
    setView?.(key);
  };

  const matches = JUMP.filter((j) => j.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <header className="bg-white border-b border-stone-200 px-6 py-3 flex items-center gap-4 relative">
      <div className="text-sm font-semibold text-stone-900">{TITLES[view] ?? 'Dashboard'}</div>

      {/* Search trigger */}
      <button
        onClick={() => setOverlay('search')}
        className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 rounded text-sm text-stone-500 transition w-64"
      >
        <span>🔍</span>
        <span>Search…</span>
        <span className="ml-auto mono text-xs text-stone-400 bg-white px-1.5 py-0.5 rounded border border-stone-200">⌘K</span>
      </button>

      <div className="hidden md:flex items-center gap-2">
        <label className="text-xs text-stone-500">As of:</label>
        <span className="text-sm mono">{asOfDate || '—'}</span>
        {source === 'mock' && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">sample data</span>
        )}
        {source === 'imported-xlsx' && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200" title="Figures from an imported MYOB AR Aging (Detailed) export">MYOB import</span>
        )}
      </div>

      {view === 'dashboard' && branches?.length > 0 && (
        <div className="hidden md:flex items-center gap-2">
          <label className="text-xs text-stone-500">Branch:</label>
          <select
            value={branch || ''}
            onChange={(e) => onBranchChange?.(e.target.value)}
            className="text-sm border border-stone-300 rounded px-2 py-1 bg-white"
          >
            <option value="">All branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={() => setOverlay(overlay === 'add' ? null : 'add')}
          className="text-sm px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded"
        >
          + New
        </button>

        {view === 'dashboard' && (
          <a href={exportCsvUrl(branch)} className="text-sm text-stone-600 hover:text-stone-900">Export CSV</a>
        )}
        {view === 'dashboard' && isAdmin && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onImportFile}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              title="Upload a MYOB AR Aging (Detailed) .xlsx export"
              className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {importing && <Spinner className="h-3.5 w-3.5 text-stone-500" />}
              {importing ? 'Importing…' : 'Import AR Aging'}
            </button>
          </>
        )}
        {/* Refresh / Sync MYOB buttons hidden (commented out for easy re-enable)
        <button onClick={onRefresh} disabled={loading} className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-50 inline-flex items-center gap-1.5">
          {loading && <Spinner className="h-3.5 w-3.5 text-stone-500" />}
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button onClick={onSync} disabled={syncing} className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-50 inline-flex items-center gap-1.5">
          {syncing && <Spinner className="h-3.5 w-3.5 text-stone-500" />}
          {syncing ? 'Syncing…' : 'Sync MYOB'}
        </button>
        */}

        <div className="w-px h-5 bg-stone-200" />
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-stone-200 rounded-full flex items-center justify-center text-xs font-medium">
            {(user?.name || user?.email || 'AR').slice(0, 2).toUpperCase()}
          </div>
          <div className="text-sm leading-tight">
            <div className="font-medium">{user?.name || 'Accounts Receivable'}</div>
            <div className="text-xs text-stone-500 capitalize">{user?.role || 'Metfold'}</div>
          </div>
          {onLogout && (
            <button onClick={onLogout} className="ml-2 text-sm text-stone-600 hover:text-stone-900">Logout</button>
          )}
        </div>
      </div>

      {/* ---- Quick add menu ---- */}
      {overlay === 'add' && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOverlay(null)} />
          <div className="absolute right-6 top-14 z-50 w-64 bg-white border border-stone-200 rounded-lg shadow-xl p-2">
            <button onClick={() => go('reminders')} className="w-full text-left px-3 py-2 hover:bg-stone-50 rounded text-sm">
              ✉️ Send overdue reminders
            </button>
            <button onClick={() => go('calendar')} className="w-full text-left px-3 py-2 hover:bg-stone-50 rounded text-sm">
              📅 Add calendar comment / follow-up
            </button>
            <button onClick={() => go('customers')} className="w-full text-left px-3 py-2 hover:bg-stone-50 rounded text-sm">
              👥 Find a customer
            </button>
          </div>
        </>
      )}

      {/* ---- Search palette ---- */}
      {overlay === 'search' && (
        <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-start justify-center pt-24 px-4" onClick={() => setOverlay(null)}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-200">
              <span className="text-stone-400">🔍</span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="flex-1 outline-none text-sm"
                placeholder="Jump to a screen…"
              />
              <button onClick={() => setOverlay(null)} className="text-xs text-stone-400">ESC</button>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto scroll-thin">
              <div className="px-2 py-1 text-xs text-stone-500 uppercase tracking-wide">Go to</div>
              {matches.map((m) => (
                <button key={m.key} onClick={() => go(m.key)} className="w-full text-left px-3 py-2 hover:bg-stone-50 rounded text-sm">
                  {m.label}
                </button>
              ))}
              {matches.length === 0 && <div className="px-3 py-3 text-sm text-stone-400">No matching screen.</div>}
              <p className="px-3 py-2 text-xs text-stone-400">
                Customer/invoice search is on the Customers and Invoices screens.
              </p>
            </div>
          </div>
        </div>
      )}

    </header>
  );
}
