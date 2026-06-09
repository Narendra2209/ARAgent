/** Amber notice shown on screens that are UI-only (no backend wired yet). */
export default function PreviewBanner({ children }) {
  return (
    <div className="mb-4 px-4 py-2.5 rounded bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-start gap-2">
      <span className="text-[10px] uppercase tracking-wide font-semibold bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded mt-0.5">
        Preview
      </span>
      <span>{children || 'This screen is a design preview — the data shown is sample data and the buttons are not wired up yet.'}</span>
    </div>
  );
}
