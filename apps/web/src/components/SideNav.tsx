import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";

interface SideNavProps {
  open: boolean;
  onClose: () => void;
  taxpayerFirstName: string | null;
  onReset: () => void;
  resetting: boolean;
  onSignOut: () => void;
}

// `mobileOnly: true` items are hidden at lg+ where the equivalent UI lives in
// the route's right rail (e.g. the activity card sits next to chat on desktop).
const SECTIONS: {
  to: string;
  label: string;
  icon: string;
  mobileOnly?: boolean;
}[] = [
  { to: "/", label: "Chat", icon: "◐" },
  { to: "/documents", label: "Tax Documents", icon: "▤" },
  { to: "/activity", label: "Activity", icon: "◇", mobileOnly: true },
];

export function SideNav({
  open,
  onClose,
  taxpayerFirstName,
  onReset,
  resetting,
  onSignOut,
}: SideNavProps) {
  return (
    <>
      {/* Mobile backdrop — only rendered when drawer is open. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 shrink-0",
          "bg-bg-subtle border-r border-border-subtle",
          "flex flex-col",
          "transform transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:translate-x-0 lg:w-56",
        )}
      >
        <div className="px-5 pt-6 pb-4">
          <div className="text-ink-muted text-[10px] uppercase tracking-[0.24em]">
            Wheel of Time
          </div>
          <div className="mt-1 font-serif text-lg text-ink-primary">
            Thom Merrilin
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.to === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "nav-item",
                  isActive && "nav-item-active",
                  s.mobileOnly && "lg:hidden",
                )
              }
            >
              <span className="text-ink-muted text-base leading-none w-4 text-center">
                {s.icon}
              </span>
              <span>{s.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-border-subtle">
          <div className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">
            Session
          </div>
          <div className="mt-1 text-sm text-ink-primary truncate">
            {taxpayerFirstName ?? "Demo"}
          </div>
          <button
            onClick={onReset}
            disabled={resetting}
            className="mt-3 w-full text-xs text-ink-secondary hover:text-ink-primary
                       border border-border-subtle hover:border-border-strong
                       rounded-lg py-2 transition-colors disabled:opacity-50"
          >
            {resetting ? "Resetting…" : "Reset session"}
          </button>
          <button
            onClick={onSignOut}
            className="mt-2 w-full text-xs text-ink-secondary hover:text-ink-primary
                       border border-border-subtle hover:border-border-strong
                       rounded-lg py-2 transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
