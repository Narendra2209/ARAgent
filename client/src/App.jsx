import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchArAging, fetchHealth, checkEmailHealth, syncCustomers } from './api.js';
import { getStoredUser, getToken, clearAuth } from './authStore.js';
import LoginPage from './components/LoginPage.jsx';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Dashboard from './components/Dashboard.jsx';
import StatusView from './components/StatusView.jsx';
import Loader from './components/Loader.jsx';
import CustomersView from './components/CustomersView.jsx';
import CustomerDetail from './components/CustomerDetail.jsx';
import InvoicesView from './components/InvoicesView.jsx';
import RemindersView from './components/RemindersView.jsx';
import CalendarView from './components/CalendarView.jsx';
import AiInboxView from './components/AiInboxView.jsx';
import ReportsView from './components/ReportsView.jsx';
import SettingsView from './components/SettingsView.jsx';
import UsersView from './components/UsersView.jsx';

export default function App() {
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));

  // Stay in sync with login/logout/expiry events fired by authStore + api.js.
  useEffect(() => {
    const onAuthChange = () => setUser(getToken() ? getStoredUser() : null);
    window.addEventListener('auth-changed', onAuthChange);
    return () => window.removeEventListener('auth-changed', onAuthChange);
  }, []);

  if (!user) return <LoginPage />;
  return <Hub user={user} onLogout={clearAuth} />;
}

function Hub({ user, onLogout }) {
  const isAdmin = user.role === 'admin';
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);
  const [mailHealth, setMailHealth] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [branch, setBranch] = useState(''); // '' = all branches
  const [customerId, setCustomerId] = useState(null); // open full-page customer

  // All signed-in users may use every screen, including Users.
  const safeView = view;

  // Navigating via the sidebar/top bar leaves any open customer page.
  const goView = useCallback((v) => {
    setCustomerId(null);
    setView(v);
  }, []);

  const runReport = useCallback(async (branchArg, { refresh = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchArAging(branchArg, { refresh }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch the report whenever the chosen branch changes.
  const onBranchChange = useCallback(
    (next) => {
      setBranch(next);
      runReport(next);
    },
    [runReport]
  );

  const onSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      // Customer sync is best-effort: a hiccup here (e.g. MYOB's single API seat
      // momentarily busy → ECONNRESET) must NOT abort the AR aging refresh, which
      // is the figure the dashboard actually shows. Swallow its error and carry on.
      try {
        await syncCustomers();
      } catch (e) {
        console.warn('Customer sync failed; continuing to AR aging refresh:', e.message);
      }
      await runReport(branch, { refresh: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }, [runReport, branch]);

  // On login (Hub only mounts once the user is authenticated) automatically
  // pull LIVE data from MYOB, so the dashboard never opens on a stale snapshot.
  // Guarded with a ref so it runs once per session — not on every re-render or
  // branch change (which would needlessly hit MYOB's single API seat).
  const didInitialSync = useRef(false);
  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null));
    checkEmailHealth().then(setMailHealth).catch(() => setMailHealth(null));
    if (didInitialSync.current) return;
    didInitialSync.current = true;
    onSync();
  }, [onSync]);

  return (
    <div className="flex h-screen overflow-hidden bg-stone-100 text-stone-900">
      <Sidebar
        view={safeView}
        setView={goView}
        customerCount={data?.kpis?.customerCount}
        health={health}
        mailHealth={mailHealth}
        user={user}
        isAdmin={isAdmin}
        onLogout={onLogout}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          view={safeView}
          setView={goView}
          asOfDate={data?.asOfDate}
          source={data?.source}
          branches={data?.branches}
          branch={branch}
          onBranchChange={onBranchChange}
          onSync={onSync}
          syncing={syncing}
          onReload={() => runReport(branch)}
          loading={loading}
          user={user}
          onLogout={onLogout}
        />

        <main className="flex-1 overflow-y-auto scroll-thin px-6 py-5 bg-stone-50">
          {customerId ? (
            <CustomerDetail
              customerId={customerId}
              onBack={() => setCustomerId(null)}
              onSendReminder={() => {
                setCustomerId(null);
                setView('reminders');
              }}
            />
          ) : (
            <>
              {safeView === 'dashboard' && (
                <div className="relative min-h-[60vh]">
                  {error && (
                    <div className="mb-4 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
                      <strong>Couldn’t load the report.</strong> {error}
                      <div className="mt-1 text-xs text-red-700">
                        Check MYOB settings in server/.env, or set USE_MOCK_DATA=true for sample data.
                      </div>
                    </div>
                  )}
                  {/* First load (incl. the auto-sync on login): full inline loader. */}
                  {(loading || syncing) && !data && <Loader message="Loading AR Aging report from MYOB…" />}
                  {data && (
                    <Dashboard
                      data={data}
                      onGoToReminders={() => setView('reminders')}
                      onOpenCustomer={setCustomerId}
                    />
                  )}
                  {/* Refresh / Sync MYOB while data is already shown: overlay spinner. */}
                  {(loading || syncing) && data && (
                    <Loader overlay message={syncing ? 'Syncing from MYOB…' : 'Refreshing from MYOB…'} />
                  )}
                </div>
              )}

              {safeView === 'status' && <StatusView />}
              {safeView === 'customers' && <CustomersView onOpenCustomer={setCustomerId} />}
              {safeView === 'invoices' && <InvoicesView onOpenCustomer={setCustomerId} />}
              {safeView === 'reminders' && <RemindersView />}
              {safeView === 'calendar' && <CalendarView />}
              {safeView === 'ai_inbox' && <AiInboxView />}
              {safeView === 'reports' && <ReportsView />}
              {safeView === 'settings' && <SettingsView />}
              {safeView === 'users' && <UsersView currentUser={user} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
