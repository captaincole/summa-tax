// Branded primitive types for form fields + accounting slots.
//
// Each type is a phantom-branded primitive: zero runtime cost (the brand
// only exists in the type-checker), but TS treats them as nominally distinct
// so `SSN` can't be assigned to `Money` and vice versa. Bindings can return
// these directly into form fields whose declared valueType matches the
// underlying primitive.
//
// Every brand carries a default `format(value)` used by the renderer when
// writing into PDF widgets. Per-form overrides live next to each form's
// bindings (see FormSpec.formatters) and take precedence over the default.
//
// New brands are added here as the accounting layer grows. Bindings that
// need a freshly-introduced shape should reference the brand in their
// return type so the renderer/formatter path stays exhaustive.

// ─── Money ───────────────────────────────────────────────────────────────
// Whole dollars. Storage convention is `number` of dollars (not cents) so
// JSON round-trips and arithmetic don't need conversion helpers. Negatives
// are valid (refunds, losses, owe-amounts).

export type Money = number & { readonly __brand: "Money" };

export const money = (n: number): Money => n as Money;

export const Money = {
  /**
   * Default IRS / FTB convention: comma-grouped whole dollars
   * ("79,000"). Renderers historically wrote blank for zero; the form
   * engine writes "0" so the field reads as "computed, value is zero"
   * rather than "we forgot to fill it." Per-form overrides can swap
   * conventions (blank-for-zero, no commas, etc.) via `FormSpec.formatters`.
   */
  format: (m: Money): string => {
    if (!Number.isFinite(m)) return "";
    if (m === 0) return "0";
    return Math.round(m).toLocaleString("en-US", { maximumFractionDigits: 0 });
  },
};

// ─── SSN ─────────────────────────────────────────────────────────────────
// Canonical storage is the 9-digit string with NO separators ("123456789").
// Every per-form presentation derives from the bare digits. ITINs use the
// same brand — both are 9 digits and the IRS treats them interchangeably
// on filing forms. If a future form distinguishes, split the brand then.

export type SSN = string & { readonly __brand: "SSN" };

export const ssn = (s: string): SSN => {
  const digits = s.replace(/\D/g, "");
  if (digits.length !== 9) {
    throw new Error(`SSN must be 9 digits, got "${s}" (${digits.length} digits).`);
  }
  return digits as SSN;
};

export const SSN = {
  /** Default human-readable presentation: "123-45-6789". */
  format: (s: SSN): string =>
    `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}`,
  /** Bare digits ("123456789") — identity, since canonical IS digit-only. */
  digits: (s: SSN): string => s,
};

// ─── EIN ─────────────────────────────────────────────────────────────────
// Employer identification number — canonical storage is 9 bare digits.
// Default presentation matches the IRS format "##-#######".

export type EIN = string & { readonly __brand: "EIN" };

export const ein = (s: string): EIN => {
  const digits = s.replace(/\D/g, "");
  if (digits.length !== 9) {
    throw new Error(`EIN must be 9 digits, got "${s}" (${digits.length} digits).`);
  }
  return digits as EIN;
};

export const EIN = {
  /** Default presentation: "36-1234567". */
  format: (e: EIN): string => `${e.slice(0, 2)}-${e.slice(2)}`,
  /** Bare digits — identity. */
  digits: (e: EIN): string => e,
};

// ─── Phone ───────────────────────────────────────────────────────────────
// Canonical storage is 10 bare digits ("7039530253"). Default presentation
// is dashed "###-###-####"; per-form overrides can switch to parens
// ("(703) 953-0253") or digit-only depending on the widget's convention.

export type Phone = string & { readonly __brand: "Phone" };

export const phone = (s: string): Phone => {
  const digits = s.replace(/\D/g, "");
  if (digits.length !== 10) {
    throw new Error(`Phone must be 10 digits, got "${s}" (${digits.length} digits).`);
  }
  return digits as Phone;
};

export const Phone = {
  /** Default human-readable presentation: "703-953-0253". */
  format: (p: Phone): string =>
    `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`,
  /** Bare digits — identity. */
  digits: (p: Phone): string => p,
  /** Parens style: "(703) 953-0253". */
  parens: (p: Phone): string =>
    `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`,
};

// ─── ISODate ─────────────────────────────────────────────────────────────
// "YYYY-MM-DD". Renderer formats per-form (some want "MM/DD/YYYY").

export type ISODate = string & { readonly __brand: "ISODate" };

export const isoDate = (s: string): ISODate => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`ISODate must be YYYY-MM-DD, got "${s}".`);
  }
  return s as ISODate;
};

export const ISODate = {
  format: (d: ISODate): string => d,
  /** "MM/DD/YYYY" — the format every IRS/FTB PDF widget expects. */
  usSlash: (d: ISODate): string => {
    const [y, m, day] = d.split("-");
    return `${m}/${day}/${y}`;
  },
};

// ─── FilingStatus ────────────────────────────────────────────────────────
// Discriminated value, not a brand. Long form matches the AI decision
// vocabulary (`decisions.scope.filing_status`) and the tax-table API's
// column names — keep them aligned so resolvers / table lookups don't
// need a translation table.

export type FilingStatus =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | "head_of_household"
  | "qualifying_surviving_spouse";
