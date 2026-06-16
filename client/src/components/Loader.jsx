/** Spinning loader used while data is being pulled from MYOB. */
export function Spinner({ className = 'h-6 w-6 text-orange-600' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/**
 * Full loader with a message. `overlay` renders it as a centred card over
 * existing content (used while refreshing/syncing when data is already shown);
 * otherwise it renders inline (first load, empty screen).
 */
export default function Loader({ message = 'Loading…', overlay = false }) {
  const body = (
    <div className="flex items-center gap-3 text-stone-700">
      <Spinner />
      <span className="text-sm font-medium">{message}</span>
    </div>
  );

  if (overlay) {
    return (
      <div className="absolute inset-0 z-20 flex items-start justify-center pt-24 bg-stone-50/70 backdrop-blur-[1px]">
        <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-5 py-4">{body}</div>
      </div>
    );
  }
  return <div className="px-4 py-16 flex justify-center">{body}</div>;
}
