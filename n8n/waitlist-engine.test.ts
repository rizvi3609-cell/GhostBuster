import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

type WorkflowNode = Readonly<{
  name: string
  parameters: Readonly<Record<string, unknown>>
  credentials?: Readonly<Record<string, Readonly<{ id: string; name: string }>>>
}>

type Workflow = Readonly<{
  name: string
  nodes: readonly WorkflowNode[]
  connections: Readonly<Record<string, unknown>>
  settings: Readonly<Record<string, unknown>>
}>

const raw = readFileSync(new URL("./waitlist-engine.json", import.meta.url), "utf8")
const workflows = JSON.parse(raw) as Workflow[]

function workflow(name: string): Workflow {
  const match = workflows.find((item) => item.name === name)
  if (!match) throw new Error(`Missing workflow: ${name}`)
  return match
}

function nodeNames(item: Workflow): string[] {
  return item.nodes.map((node) => node.name)
}

describe("n8n waitlist engine export", () => {
  it("contains campaign-start, wave-engine, and error workflows", () => {
    expect(workflows.map((item) => item.name)).toEqual([
      "Ghost-Buster — Campaign Start",
      "Ghost-Buster — Wave Engine",
      "Ghost-Buster — Error Handler",
      "Ghost-Buster — Inbound Router",
      "Ghost-Buster — Status Reconciler",
      "Ghost-Buster — Manual Reply",
    ])
  })

  it("verifies the signature before campaign reads or writes", () => {
    const item = workflow("Ghost-Buster — Campaign Start")
    const names = nodeNames(item)
    expect(names.indexOf("Verify Shared Secret Signature")).toBeLessThan(
      names.indexOf("Re-read Campaign and Kill Switch"),
    )
    const verifier = item.nodes.find(
      (node) => node.name === "Verify Shared Secret Signature",
    )
    const code = String(verifier?.parameters.jsCode)
    expect(code).toContain("timingSafeEqual")
    expect(code).toContain("<= 300")
    expect(code).toContain("GHOSTBUSTER_SHARED_SECRET")
  })

  it("contains every required wave-engine safety node", () => {
    const names = nodeNames(workflow("Ghost-Buster — Wave Engine"))
    expect(names).toEqual(
      expect.arrayContaining([
        "Check Kill Switch",
        "Re-read Campaign State",
        "Campaign Still Claimable?",
        "Check Quiet Hours",
        "Atomic Reserve Next Wave",
        "Recheck Five Send Preconditions",
        "Send via Twilio Messaging Service",
        "Record Twilio Result",
        "Complete Wave",
        "Wait Wave Delay",
      ]),
    )
  })

  it("loops every quiet-hours and wave wait back through a state re-read", () => {
    const connections = JSON.stringify(
      workflow("Ghost-Buster — Wave Engine").connections,
    )
    expect(connections).toContain(
      '"Defer to Allowed Window":{"main":[[{"node":"Re-read Campaign State"',
    )
    expect(connections).toContain(
      '"Wait Wave Delay":{"main":[[{"node":"Re-read Campaign State"',
    )
  })

  it("verifies Twilio signatures before inbound or status database writes", () => {
    const inbound = workflow("Ghost-Buster — Inbound Router")
    const inboundNames = nodeNames(inbound)
    expect(inboundNames.indexOf("Verify Twilio Signature")).toBeLessThan(
      inboundNames.indexOf("Insert Inbound Idempotency Log"),
    )
    const verifier = inbound.nodes.find((node) => node.name === "Verify Twilio Signature")
    expect(String(verifier?.parameters.jsCode)).toContain("createHmac('sha1'")
    expect(String(verifier?.parameters.jsCode)).toContain("timingSafeEqual")

    const statusNames = nodeNames(workflow("Ghost-Buster — Status Reconciler"))
    expect(statusNames.indexOf("Verify Twilio Status Signature")).toBeLessThan(
      statusNames.indexOf("Advance SMS Status Without Regression"),
    )
  })

  it("deduplicates inbound messages before normalization, lookup, or claiming", () => {
    const names = nodeNames(workflow("Ghost-Buster — Inbound Router"))
    expect(names.indexOf("Insert Inbound Idempotency Log")).toBeLessThan(
      names.indexOf("Normalize Phone and Classify Keyword"),
    )
    expect(names).toEqual(
      expect.arrayContaining([
        "Resolve Patient",
        "Apply Opt Out Immediately",
        "Find Most Recent Active Campaign",
        "Atomic Claim",
        "Store Unhandled Message",
      ]),
    )
  })

  it("logs kill-switch aborts before campaign or wave termination", () => {
    expect(nodeNames(workflow("Ghost-Buster — Campaign Start"))).toContain(
      "Log Campaign Start Kill Switch Abort",
    )
    expect(nodeNames(workflow("Ghost-Buster — Wave Engine"))).toContain(
      "Log Wave Kill Switch Abort",
    )
  })

  it("authenticates and reserves manual replies before Twilio sending", () => {
    const names = nodeNames(workflow("Ghost-Buster — Manual Reply"))
    expect(names.indexOf("Verify Manual Reply Signature")).toBeLessThan(
      names.indexOf("Reserve Manual Reply and Check Preconditions"),
    )
    expect(names.indexOf("Reserve Manual Reply and Check Preconditions")).toBeLessThan(
      names.indexOf("Send Manual Reply via Twilio"),
    )
    expect(names.indexOf("Send Manual Reply via Twilio")).toBeLessThan(
      names.indexOf("Record Manual Reply and Audit"),
    )
  })

  it("references only placeholder credential IDs and contains no plaintext key", () => {
    expect(raw).not.toMatch(/github_pat_|authToken|service_role_key|sk_live_/i)
    const credentialIds = workflows.flatMap((item) =>
      item.nodes.flatMap((node) =>
        Object.values(node.credentials ?? {}).map((credential) => credential.id),
      ),
    )
    expect(credentialIds).toEqual(
      expect.arrayContaining([
        "GHOSTBUSTER_POSTGRES_CREDENTIAL_ID",
        "TWILIO_HTTP_BASIC_CREDENTIAL_ID",
      ]),
    )
    expect(
      workflows
        .filter((item) => item.name !== "Ghost-Buster — Error Handler")
        .every((item) => item.settings.errorWorkflow),
    ).toBe(true)
  })
})
