import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { DocumentSpec, ScenarioSpec } from "./types.js"
import { renderW2 } from "./renderers/w2.js"
import { renderForm1099Consolidated } from "./renderers/1099consolidated.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, "../..")
const SCENARIOS_DIR = join(PROJECT_ROOT, "fixtures/scenarios")
const DOCS_DIR = join(PROJECT_ROOT, "fixtures/docs")

type RenderArgs = { scenarioIds?: string[] }

const renderDocument = async (
  doc: DocumentSpec,
  scenario: ScenarioSpec,
): Promise<Uint8Array> => {
  switch (doc.kind) {
    case "W-2":
      return renderW2(doc, scenario.taxpayer, scenario.taxYear)
    case "1099-Consolidated":
      return renderForm1099Consolidated(doc, scenario.taxpayer, scenario.taxYear)
    default: {
      const _exhaustive: never = doc
      throw new Error(`No renderer for document kind: ${(doc as DocumentSpec).kind}`)
    }
  }
}

const loadScenario = async (id: string): Promise<ScenarioSpec> => {
  const path = join(SCENARIOS_DIR, `${id}.ts`)
  const mod = await import(path)
  if (!mod.scenario) {
    throw new Error(`Scenario file ${path} did not export 'scenario'`)
  }
  return mod.scenario as ScenarioSpec
}

const renderScenario = async (scenario: ScenarioSpec): Promise<void> => {
  await mkdir(DOCS_DIR, { recursive: true })
  for (const doc of scenario.documents) {
    const bytes = await renderDocument(doc, scenario)
    const outPath = join(DOCS_DIR, doc.outputFilename)
    await writeFile(outPath, bytes)
    console.log(`  ✓ ${doc.kind}: ${doc.outputFilename}`)
  }
}

const parseArgs = (argv: string[]): RenderArgs => {
  const args: RenderArgs = {}
  for (const arg of argv.slice(2)) {
    const [k, v] = arg.startsWith("--") ? arg.slice(2).split("=") : [arg, undefined]
    if (k === "scenario" && v) args.scenarioIds = [v]
  }
  return args
}

const defaultScenarioIds = ["01-base-case", "03-investments-dividends"]

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv)
  const ids = args.scenarioIds ?? defaultScenarioIds
  for (const id of ids) {
    console.log(`Rendering scenario: ${id}`)
    const scenario = await loadScenario(id)
    await renderScenario(scenario)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
