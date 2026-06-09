import { useEffect, useState } from 'react';
import { getSetupStatus, login, registerAdmin } from '../api.js';
import { setAuth } from '../authStore.js';

export default function LoginPage() {
  const [mode, setMode] = useState('loading'); // loading | login | setup
  const [dbConnected, setDbConnected] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSetupStatus()
      .then((s) => {
        setDbConnected(s.dbConnected);
        setMode(s.needsSetup ? 'setup' : 'login');
      })
      .catch(() => setMode('login'));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'setup'
          ? await registerAdmin({ name, email, password })
          : await login({ email, password });
      setAuth(res.token, res.user); // App listens for 'auth-changed'
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const isSetup = mode === 'setup';
  const field =
    'w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500';

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-9 h-9 bg-orange-600 rounded-lg flex items-center justify-center text-white font-bold">
            M
          </div>
          <div>
            <div className="text-stone-900 font-semibold">Metfold AR</div>
            <div className="text-stone-500 text-xs">Receivables Hub</div>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6">
          {mode === 'loading' ? (
            <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-stone-900">
                {isSetup ? 'Create the admin account' : 'Sign in'}
              </h1>
              <p className="text-sm text-stone-500 mt-1 mb-5">
                {isSetup
                  ? 'No accounts exist yet. Set up the first administrator — they can add other users afterwards.'
                  : 'Enter your credentials to access the dashboard.'}
              </p>

              {!dbConnected && (
                <div className="mb-4 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  Database not connected — sign-in needs MongoDB. Check MONGODB_URI in server/.env.
                </div>
              )}

              <form onSubmit={submit} className="space-y-3">
                {isSetup && (
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">
                      Full name
                    </label>
                    <input
                      className={field}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Admin"
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Email</label>
                  <input
                    className={field}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@metfold.com.au"
                    autoComplete="username"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Password</label>
                  <input
                    className={field}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isSetup ? 'At least 6 characters' : '••••••••'}
                    autoComplete={isSetup ? 'new-password' : 'current-password'}
                    required
                  />
                </div>

                {error && (
                  <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                >
                  {busy
                    ? isSetup
                      ? 'Creating…'
                      : 'Signing in…'
                    : isSetup
                    ? 'Create admin & sign in'
                    : 'Sign in'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-stone-400 mt-4">Metfold AR · Receivables Hub</p>
      </div>
    </div>
  );
}
