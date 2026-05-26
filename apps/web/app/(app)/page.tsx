// Home-home — person-scope landing. Above any single return.
//
// No AppShell, no chat (no active return to chat about). Pure render —
// server component, no client state needed. Auth is gated by the parent
// (app)/layout.tsx.
//
// Sections:
//   1. Your returns      — real filings queried from listOwnerReturns; empty
//                          state shows a single big "Start your 2025 filing" CTA.
//   2. Continue with     — "Start a new filing" (action) + "Tax planning
//                          session" (locked placeholder).
//   3. Your tax picture  — four chart cards visually present but overlay-
//                          locked until the user has a filed return.
//
// Charts read mock data underneath the overlay because we don't capture
// year-over-year history yet. When we do, swap the consts for a Supabase
// query and drop the overlay.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listOwnerReturns, type TaxReturn } from "@/lib/returns";
import { deriveProfile, type UserProfile } from "@/lib/profile";
import { cn } from "@/lib/cn";
import { HomeTopBar } from "./HomeTopBar";
import { StartFilingButton } from "./StartFilingButton";

const CURRENT_TAX_YEAR = 2025;

// Mock historical data. Replace with a Supabase query when we capture
// year-over-year aggregates server-side. Rendered beneath a "locked"
// overlay so the user sees what's coming without us pretending it's real.
const INCOME = [
  { year: 2021, value: 145000 },
  { year: 2022, value: 162000 },
  { year: 2023, value: 178000 },
  { year: 2024, value: 192000 },
  { year: 2025, value: 186400 },
];
const EFFECTIVE_RATE = [
  { year: 2021, value: 22.4 },
  { year: 2022, value: 23.1 },
  { year: 2023, value: 24.0 },
  { year: 2024, value: 24.6 },
  { year: 2025, value: 23.8 },
];
const REFUND: { year: number; value: number | null }[] = [
  { year: 2021, value: 2100 },
  { year: 2022, value: -1400 },
  { year: 2023, value: 3200 },
  { year: 2024, value: 4210 },
  { year: 2025, value: null },
];
const CHARITABLE = [
  { year: 2021, value: 4200 },
  { year: 2022, value: 5800 },
  { year: 2023, value: 7500 },
  { year: 2024, value: 9100 },
  { year: 2025, value: 10500 },
];

export default async function HomeHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = deriveProfile(user);

  // Registered CPAs (anyone with a cpa_profiles row) who don't ALSO own a
  // filing get bounced to /cpa so they don't land on the taxpayer home.
  // cpa_profile existence is the right signal here, not membership count —
  // a CPA without invites yet still belongs on the CPA surface (which
  // renders an empty 'Nothing to review' state). Mixed-role users (CPA who
  // also owns their own return) stay on the taxpayer home.
  if (user?.id) {
    const { count: cpaProfileCount } = await supabase
      .from("cpa_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if ((cpaProfileCount ?? 0) > 0) {
      const { count: ownerCount } = await supabase
        .from("filing_members")
        .select("filing_id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("role", "owner")
        .is("revoked_at", null);
      if ((ownerCount ?? 0) === 0) redirect("/cpa");
    }
  }

  const returns = await listOwnerReturns(supabase);
  const hasCurrentYear = returns.some((r) => r.year === CURRENT_TAX_YEAR);
  const hasAnyFiledReturn = returns.some((r) => r.state === "filed");

  return (
    <div className="min-h-screen w-full bg-bg-base text-ink-primary flex flex-col">
      <HomeTopBar initials={profile.initials} />
      <main className="flex-1 px-6 lg:px-10 py-10 lg:py-14">
        <div className="max-w-6xl mx-auto space-y-14">
          <Greeting profile={profile} />

          <ReturnsSection
            returns={returns}
            hasCurrentYear={hasCurrentYear}
          />

          <ContinueWithSection
            hasCurrentYear={hasCurrentYear}
            hasAnyFiledReturn={hasAnyFiledReturn}
          />

          <TaxPictureSection locked={!hasAnyFiledReturn} />
        </div>
      </main>
    </div>
  );
}

function Greeting({ profile }: { profile: UserProfile }) {
  return (
    <header>
      <h1 className="font-serif text-4xl text-ink-primary">
        Hi, {profile.firstName}.
      </h1>
      <p className="text-ink-secondary text-[15px] mt-2.5">
        Your tax life, in one place.
      </p>
    </header>
  );
}

function ReturnsSection({
  returns,
  hasCurrentYear,
}: {
  returns: TaxReturn[];
  hasCurrentYear: boolean;
}) {
  if (returns.length === 0) {
    return (
      <Section title="Your returns">
        <EmptyReturnsCta />
      </Section>
    );
  }
  return (
    <Section
      title="Your returns"
      right={
        returns.some((r) => r.state === "filed") ? (
          <button className="text-sm text-ink-secondary hover:text-ink-primary">
            View archive →
          </button>
        ) : null
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {returns.map((r) => (
          <ReturnCard key={r.filingId} ret={r} />
        ))}
        {!hasCurrentYear && <NewReturnTile />}
      </div>
    </Section>
  );
}

function ContinueWithSection({
  hasCurrentYear,
  hasAnyFiledReturn,
}: {
  hasCurrentYear: boolean;
  hasAnyFiledReturn: boolean;
}) {
  return (
    <Section title="Continue with">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {hasCurrentYear ? (
          <DisabledWorkflowCard
            title={`Start ${CURRENT_TAX_YEAR} filing`}
            desc={`You already have a ${CURRENT_TAX_YEAR} return in progress. Open it from above.`}
            icon="+"
            note="Already in progress"
          />
        ) : (
          <StartFilingCard taxYear={CURRENT_TAX_YEAR} />
        )}
        <LockedWorkflowCard
          title="Tax planning session"
          desc="Look ahead — reduce next year's liability before December."
          icon="○"
          unlockText={
            hasAnyFiledReturn
              ? "Coming soon"
              : "Unlocked after your first filed return"
          }
        />
      </div>
    </Section>
  );
}

function TaxPictureSection({ locked }: { locked: boolean }) {
  return (
    <Section title="Your tax picture">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 relative">
        <ChartCard
          title="Income"
          subtitle="Wages + investment income, last 5 years"
          value={fmtCurrencyFull(INCOME[INCOME.length - 1].value)}
          valueLabel="2025 (in progress)"
        >
          <BarChart data={INCOME} colorClass="fill-accent" valueFormatter={fmtCurrencyShort} />
        </ChartCard>
        <ChartCard
          title="Effective tax rate"
          subtitle="Federal, after deductions"
          value={`${EFFECTIVE_RATE[EFFECTIVE_RATE.length - 1].value.toFixed(1)}%`}
          valueLabel="2025 (estimated)"
        >
          <LineChart data={EFFECTIVE_RATE} valueFormatter={(v) => `${v.toFixed(1)}%`} domain={[20, 26]} />
        </ChartCard>
        <ChartCard
          title="Federal refund / owed"
          subtitle="What came back or went out"
          value="Pending"
          valueLabel="2025 (calculating)"
        >
          <DivergentBarChart data={REFUND} valueFormatter={fmtSigned} />
        </ChartCard>
        <ChartCard
          title="Charitable giving"
          subtitle="Cash + non-cash donations"
          value={fmtCurrencyFull(CHARITABLE[CHARITABLE.length - 1].value)}
          valueLabel="2025 year-to-date"
        >
          <BarChart data={CHARITABLE} colorClass="fill-emerald-400" valueFormatter={fmtCurrencyShort} />
        </ChartCard>
        {locked && <LockOverlay text="Unlocked after your first filed return" />}
      </div>
    </Section>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.22em] text-ink-muted">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function ReturnCard({ ret }: { ret: TaxReturn }) {
  const isActive = ret.state === "active";
  const isFiled = ret.state === "filed";
  return (
    <a
      href={`/r/${ret.id}`}
      className={cn(
        "card p-5 transition-all flex flex-col gap-4 min-h-[160px]",
        isActive
          ? "ring-1 ring-accent/30 hover:ring-accent/50 hover:border-accent/30"
          : "hover:border-border-strong",
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">Tax Year {ret.year}</div>
          <div className="text-[15px] font-semibold text-ink-primary mt-1 tracking-tight">{ret.label}</div>
        </div>
        {isActive && (
          <span className="text-[10px] uppercase tracking-wider text-accent bg-accent/15 px-1.5 py-0.5 rounded">
            Active
          </span>
        )}
        {isFiled && (
          <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
            Filed
          </span>
        )}
      </div>

      <div className="mt-auto">
        {isActive ? (
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-ink-muted">In progress</span>
            <span className="text-ink-secondary">Open →</span>
          </div>
        ) : (
          <div className="text-[12px] text-ink-muted">Filed</div>
        )}
      </div>
    </a>
  );
}

// Big inline empty-state CTA when the user has no filings yet. Replaces the
// returns grid entirely — the page is supposed to look "empty until you
// start something" rather than dressing-up the void with placeholders.
function EmptyReturnsCta() {
  return (
    <div className="card p-8 sm:p-10 flex flex-col items-start gap-5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          Tax Year {CURRENT_TAX_YEAR}
        </div>
        <h3 className="font-serif text-2xl text-ink-primary mt-1.5">
          Start your {CURRENT_TAX_YEAR} filing
        </h3>
        <p className="text-ink-secondary text-[14px] mt-2 max-w-xl leading-relaxed">
          Thom will walk you through everything — wages, investments, deductions —
          and keep a citation for every fact. You can pause and pick up where
          you left off anytime.
        </p>
      </div>
      <StartFilingButton
        taxYear={CURRENT_TAX_YEAR}
        className="px-5 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
      >
        Start filing →
      </StartFilingButton>
    </div>
  );
}

function NewReturnTile() {
  return (
    <div className="border border-dashed border-border-subtle rounded-2xl p-5 flex flex-col items-center justify-center text-center gap-2 min-h-[160px] text-ink-muted">
      <span className="text-2xl opacity-40">+</span>
      <span className="text-sm">New returns open in {CURRENT_TAX_YEAR + 1}</span>
    </div>
  );
}

function StartFilingCard({ taxYear }: { taxYear: number }) {
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="w-9 h-9 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent text-base">
        +
      </div>
      <div>
        <div className="text-[15px] font-medium text-ink-primary">Start a new filing</div>
        <div className="text-[13px] text-ink-secondary leading-relaxed mt-1">
          Begin your {taxYear} return. Thom will guide intake from scratch.
        </div>
      </div>
      <StartFilingButton
        taxYear={taxYear}
        className="self-start mt-1 text-[12px] text-accent hover:text-accent-hover transition-colors"
      >
        Start {taxYear} filing →
      </StartFilingButton>
    </div>
  );
}

function DisabledWorkflowCard({
  title,
  desc,
  icon,
  note,
}: {
  title: string;
  desc: string;
  icon: string;
  note: string;
}) {
  return (
    <div className="card p-5 flex flex-col gap-3 opacity-60 cursor-not-allowed">
      <div className="w-9 h-9 rounded-lg bg-bg-elevated border border-border-subtle flex items-center justify-center text-ink-muted text-base">
        {icon}
      </div>
      <div>
        <div className="text-[15px] font-medium text-ink-primary">{title}</div>
        <div className="text-[13px] text-ink-secondary leading-relaxed mt-1">{desc}</div>
      </div>
      <div className="text-[11px] uppercase tracking-wider text-ink-muted">{note}</div>
    </div>
  );
}

function LockedWorkflowCard({
  title,
  desc,
  icon,
  unlockText,
}: {
  title: string;
  desc: string;
  icon: string;
  unlockText: string;
}) {
  return (
    <div className="card p-5 flex flex-col gap-3 relative overflow-hidden">
      <div className="w-9 h-9 rounded-lg bg-bg-elevated border border-border-subtle flex items-center justify-center text-ink-muted text-base">
        {icon}
      </div>
      <div>
        <div className="text-[15px] font-medium text-ink-primary">{title}</div>
        <div className="text-[13px] text-ink-secondary leading-relaxed mt-1">{desc}</div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <LockIcon className="w-3 h-3" />
        <span>{unlockText}</span>
      </div>
    </div>
  );
}

function LockOverlay({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center backdrop-blur-[2px] bg-bg-base/40 rounded-2xl">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-bg-elevated/90 border border-border-subtle text-ink-secondary text-[12px]">
        <LockIcon className="w-3.5 h-3.5" />
        <span>{text}</span>
      </div>
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ChartCard({
  title,
  subtitle,
  value,
  valueLabel,
  children,
}: {
  title: string;
  subtitle: string;
  value: string;
  valueLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">{title}</div>
          <div className="text-[13px] text-ink-secondary mt-1">{subtitle}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-semibold tracking-tight tabular-nums text-ink-primary">{value}</div>
          <div className="text-[11px] text-ink-muted mt-0.5">{valueLabel}</div>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

const CHART_W = 400;
const CHART_H = 140;
const CHART_PAD_X = 16;
const CHART_PAD_Y = 24;

function BarChart({
  data,
  colorClass,
  valueFormatter,
}: {
  data: { year: number; value: number }[];
  colorClass: string;
  valueFormatter: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value)) * 1.18;
  const slotW = (CHART_W - 2 * CHART_PAD_X) / data.length;
  const barW = slotW * 0.55;

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H + 24}`} className="w-full">
      {data.map((d, i) => {
        const x = CHART_PAD_X + slotW * i + (slotW - barW) / 2;
        const h = (d.value / max) * (CHART_H - 2 * CHART_PAD_Y);
        const y = CHART_H - CHART_PAD_Y - h;
        const isCurrent = i === data.length - 1;
        return (
          <g key={d.year}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={3}
              className={colorClass}
              opacity={isCurrent ? 0.55 : 1}
            />
            <text
              x={x + barW / 2}
              y={y - 6}
              textAnchor="middle"
              className="fill-ink-secondary text-[10px]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {valueFormatter(d.value)}
            </text>
            <text
              x={x + barW / 2}
              y={CHART_H + 14}
              textAnchor="middle"
              className="fill-ink-muted text-[10px]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {d.year}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({
  data,
  valueFormatter,
  domain,
}: {
  data: { year: number; value: number }[];
  valueFormatter: (v: number) => string;
  domain: [number, number];
}) {
  const [min, max] = domain;
  const slotW = (CHART_W - 2 * CHART_PAD_X) / (data.length - 1);

  const points = data.map((d, i) => {
    const x = CHART_PAD_X + slotW * i;
    const y = CHART_H - CHART_PAD_Y - ((d.value - min) / (max - min)) * (CHART_H - 2 * CHART_PAD_Y);
    return { x, y, d };
  });

  const linePath = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${CHART_H - CHART_PAD_Y} L ${points[0].x} ${CHART_H - CHART_PAD_Y} Z`;

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H + 24}`} className="w-full">
      <defs>
        <linearGradient id="home-line-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(124 92 255)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="rgb(124 92 255)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#home-line-fill)" />
      <path d={linePath} stroke="rgb(124 92 255)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p) => (
        <g key={p.d.year}>
          <circle cx={p.x} cy={p.y} r={3.5} className="fill-bg-base" stroke="rgb(124 92 255)" strokeWidth={1.5} />
          <text
            x={p.x}
            y={p.y - 10}
            textAnchor="middle"
            className="fill-ink-secondary text-[10px]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {valueFormatter(p.d.value)}
          </text>
          <text
            x={p.x}
            y={CHART_H + 14}
            textAnchor="middle"
            className="fill-ink-muted text-[10px]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {p.d.year}
          </text>
        </g>
      ))}
    </svg>
  );
}

function DivergentBarChart({
  data,
  valueFormatter,
}: {
  data: { year: number; value: number | null }[];
  valueFormatter: (v: number) => string;
}) {
  const present = data.filter((d): d is { year: number; value: number } => d.value !== null);
  const max = Math.max(...present.map((d) => Math.abs(d.value))) * 1.18;
  const baseline = CHART_H / 2;
  const halfH = (CHART_H - 2 * CHART_PAD_Y) / 2;
  const slotW = (CHART_W - 2 * CHART_PAD_X) / data.length;
  const barW = slotW * 0.55;

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H + 24}`} className="w-full">
      <line
        x1={CHART_PAD_X}
        y1={baseline}
        x2={CHART_W - CHART_PAD_X}
        y2={baseline}
        stroke="rgb(46 46 56)"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const x = CHART_PAD_X + slotW * i + (slotW - barW) / 2;
        const isPending = d.value === null;
        const v = d.value ?? 0;
        const h = (Math.abs(v) / max) * halfH;
        const y = v >= 0 ? baseline - h : baseline;
        const labelY = v >= 0 ? y - 6 : y + h + 11;

        return (
          <g key={d.year}>
            {!isPending && (
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={3}
                className={v >= 0 ? "fill-emerald-400" : "fill-red-400"}
              />
            )}
            {isPending && (
              <rect x={x} y={baseline - 2} width={barW} height={4} rx={2} className="fill-ink-faint/40" />
            )}
            {!isPending && (
              <text
                x={x + barW / 2}
                y={labelY}
                textAnchor="middle"
                className="fill-ink-secondary text-[10px]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {valueFormatter(v)}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={CHART_H + 14}
              textAnchor="middle"
              className="fill-ink-muted text-[10px]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {d.year}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function fmtCurrencyFull(n: number): string {
  return `$${n.toLocaleString()}`;
}
function fmtCurrencyShort(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n}`;
}
function fmtSigned(n: number): string {
  if (n > 0) return `+$${n.toLocaleString()}`;
  if (n < 0) return `-$${Math.abs(n).toLocaleString()}`;
  return "$0";
}
