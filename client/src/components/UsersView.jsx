import { useCallback, useEffect, useState } from 'react';
import { listUsers, createUserApi, deleteUserApi } from '../api.js';

export default function UsersView({ currentUser }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user' });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listUsers();
      setUsers(res.users);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    setNotice(null);
    try {
      const res = await createUserApi(form);
      setNotice(`Created ${res.user.email} (${res.user.role}).`);
      setForm({ name: '', email: '', password: '', role: 'user' });
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    try {
      await deleteUserApi(u.id);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const field =
    'w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:border-orange-500';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Create user */}
      <div className="bg-white border border-stone-200 rounded-lg p-5 h-fit">
        <h2 className="font-semibold text-sm">Add a user</h2>
        <p className="text-xs text-stone-500 mt-0.5 mb-4">
          New users can access everything except this Users screen. Admins can manage users too.
        </p>
        <form onSubmit={create} className="space-y-3">
          <input
            className={field}
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className={field}
            type="email"
            placeholder="email@metfold.com.au"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            className={field}
            type="password"
            placeholder="Temp password (min 6 chars)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <select
            className={field}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>

          {formError && (
            <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-sm text-red-700">
              {formError}
            </div>
          )}
          {notice && (
            <div className="px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            className="w-full py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </form>
      </div>

      {/* User list */}
      <div className="lg:col-span-2 bg-white border border-stone-200 rounded-lg">
        <div className="px-4 py-3 border-b border-stone-200">
          <h2 className="font-semibold text-sm">Users</h2>
        </div>

        {error && (
          <div className="m-4 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left font-medium px-4 py-2">Name</th>
                <th className="text-left font-medium px-2 py-2">Email</th>
                <th className="text-left font-medium px-2 py-2">Role</th>
                <th className="text-left font-medium px-2 py-2">Last login</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(users || []).map((u) => (
                <tr key={u.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium">
                    {u.name}
                    {currentUser?.id === u.id && (
                      <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                        you
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-stone-600">{u.email}</td>
                  <td className="px-2 py-2.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        u.role === 'admin'
                          ? 'bg-orange-100 text-orange-800'
                          : 'bg-stone-100 text-stone-600'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-stone-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {currentUser?.id !== u.id && (
                      <button
                        onClick={() => remove(u)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-stone-400">
                    No users yet.
                  </td>
                </tr>
              )}
              {!users && !error && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-stone-400">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
