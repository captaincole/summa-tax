// Fact catalog — central registry of every "kind" of fact the engine knows
// about. Each kind defines:
//   - Its category + key-shape convention (one regex, one file)
//   - Its value-shape type
//   - A typed read helper (getXFacts) used by form derivations
//   - A typed key builder (makeXFactKey) used by ingest tools
//
// New fact kinds: add a module under ./kinds/ and re-export it here. Keeps
// the convention discoverable in one place and prevents convention drift
// across forms.

export * from "./kinds/trade.js";
export * from "./kinds/wages.js";
export * from "./kinds/dividends.js";
