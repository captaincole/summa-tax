// Earned business logic — rules accumulated as CPAs flag edge cases. Both
// assessRiskAgent and ruleAgent import this so they reason consistently. New
// rules land as named sections; the prompt is meant to grow incrementally.
//
// Style: each rule states the default first, then overrides with examples.
// LLMs handle "default + exceptions" structure well.

export const CPA_RULES = `## Self-attestation-only categories

Some claims are inherently self-attestable — the taxpayer's word IS the evidence. No third-party document is required for filing; the IRS verifies against its own records, not against documents the filer produces.

Categories in this bucket today:
- Filing status (single, married filing jointly, married filing separately, head of household, qualifying surviving spouse)
- Marital status as of December 31
- Dependent relationships (the claim of relationship itself; e.g., "this person is my child")
- Mailing address (where the IRS sends paper correspondence)

**Default rule.** Trust the user's word. Tier \`low\` regardless of dollar consequence. A definitional IRS passage (e.g., "you are single if …") is sufficient grounding — don't demand corroborating facts that don't exist for the category.

**Override — contradicting evidence elsewhere in the return raises the tier.**
- Filing status "single" with a fact like \`identity.spouse_name\` populated → \`high\`. Real contradiction.
- Dependent claimed in scope but no \`dependents.*\` facts in the record → \`medium\`. Incomplete; ask for details.
- Mailing address X but a source document (W-2, 1099, brokerage statement) shows address Y → \`medium\`. Worth confirming with the user before locking in. The resolution path is a driver's license, utility bill, lease, or similar document confirming the current address — the user can attach one of those rather than re-record the fact.

The principle: self-attestation is the floor, contradicting evidence raises the bar.

## Residency claims (placeholder — full rules pending)

Residency for tax purposes (state of residence, part-year status, foreign residency) is a more involved category that will get its own rules block once we build it out with CPA input. Until then, apply this strict default:

- **Any** contradicting evidence in the record → tier \`high\` automatically. Do not soften like the mailing-address override above; residency disagreements have downstream filing-jurisdiction consequences that mailing-address ones don't.
- Examples that trip this:
  - Claim "full-year CA resident" with a W-2 from a non-CA address.
  - Claim "TX resident" with a CA-issued 1099.
  - Claim "non-resident alien" with a US address on the W-2.
- Without contradicting evidence, residency follows the assess agent's general tier reasoning — but flag dissenting considerations generously, since residency is the most common source of state-tax surprises.
`;
