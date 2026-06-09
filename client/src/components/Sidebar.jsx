import { fmtNum } from '../format.js';

const NAV = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'customers', label: 'Customers' },
  // { key: 'invoices', label: 'Invoices' },
  { key: 'reminders', label: 'Overdue Reminders' },
  // { key: 'ai_inbox', label: 'AI Inbox', badge: 'preview' },
  { key: 'calendar', label: 'Calendar' },
  // { key: 'reports', label: 'Reports', badge: 'preview' },
  { key: 'users', label: 'Users' },
  { key: 'settings', label: 'Settings' },
];

function StatusDot({ ok }) {
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-stone-500'}`}
    />
  );
}

export default function Sidebar({
  view,
  setView,
  customerCount,
  health,
  mailHealth,
  user,
  isAdmin,
  onLogout,
}) {
  return (
    <aside className="w-56 bg-stone-900 text-stone-300 flex flex-col flex-shrink-0">
      <div className="px-5 py-5 border-b border-stone-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-orange-600 rounded flex items-center justify-center text-white font-bold text-sm">
            M
          </div>
          <div>
            <div className="text-white font-semibold text-sm">Metfold AR</div>
            <div className="text-stone-500 text-xs">Receivables Hub</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition ${active ? 'bg-stone-800 text-white' : 'hover:bg-stone-800'
                }`}
            >
              <span
                className={`w-1 h-4 rounded-r bg-orange-500 ${active ? 'opacity-100' : 'opacity-0'}`}
              />
              <span>{item.label}</span>
              {item.key === 'customers' && customerCount != null && (
                <span className="ml-auto mono text-xs text-stone-500">
                  {fmtNum(customerCount)}
                </span>
              )}
              {item.badge && (
                <span className="ml-auto text-[10px] uppercase tracking-wide bg-stone-700 text-stone-300 px-1.5 py-0.5 rounded">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {user && (
        <div className="px-3 py-3 border-t border-stone-800">
          <div className="flex items-center gap-2 px-2">
            <div className="w-7 h-7 bg-stone-700 rounded-full flex items-center justify-center text-xs font-medium text-white flex-shrink-0">
              {(user.name || user.email || '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white truncate">{user.name}</div>
              <div className="text-xs text-stone-500 truncate">{user.role}</div>
            </div>
            <button
              onClick={onLogout}
              className="text-xs text-stone-400 hover:text-white"
              title="Sign out"
            >
              Logout
            </button>
          </div>
        </div>
      )}

      <div className="px-3 py-3 border-t border-stone-800">
        <div className="text-xs text-stone-500 mb-2 px-2">Data sources</div>
        <div className="px-2 space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <StatusDot ok={health?.myobConfigured} />
            <span className="text-stone-400">MYOB Advanced</span>
            <span className="ml-auto text-stone-600 mono">
              {health ? (health.mode === 'live' ? 'live' : 'mock') : '…'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <StatusDot ok={mailHealth?.tokenOk} />
            <span className="text-stone-400">Outlook / Mail</span>
            <span className="ml-auto text-stone-600 mono">
              {mailHealth ? (mailHealth.tokenOk ? 'ready' : 'check') : '…'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <StatusDot ok={health?.dbConnected} />
            <span className="text-stone-400">Database</span>
            <span className="ml-auto text-stone-600 mono">
              {health ? (health.dbConnected ? 'on' : 'off') : '…'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
