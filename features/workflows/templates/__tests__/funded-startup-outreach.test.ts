import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import { validateGraph } from "@/features/workflows/lib/validate-graph"
import { nodeRegistry, type NodeType } from "@/features/workflows/nodes/node-registry"
import type { WorkflowGraph } from "@/lib/db/schema"

describe("Funded Startup Outreach Template DAG", () => {
  const templatePath = path.resolve(
    process.cwd(),
    "features/workflows/templates/funded-startup-outreach.json"
  )

  it("loads and parses funded-startup-outreach.json", () => {
    assert.ok(fs.existsSync(templatePath), "Template JSON file must exist on disk")
    const raw = fs.readFileSync(templatePath, "utf-8")
    const parsed = JSON.parse(raw)

    assert.equal(parsed.name, "Funded Startup Lead Generation & Outreach Engine")
    assert.ok(parsed.graph, "Template must contain a graph object")
    assert.ok(Array.isArray(parsed.graph.nodes), "Graph must contain nodes array")
    assert.ok(Array.isArray(parsed.graph.edges), "Graph must contain edges array")
  })

  it("passes Navix structural graph validation with zero errors", () => {
    const raw = fs.readFileSync(templatePath, "utf-8")
    const template = JSON.parse(raw)
    const graph = template.graph as WorkflowGraph

    const problems = validateGraph(graph)
    assert.deepEqual(
      problems,
      [],
      `Graph validation reported problems: ${problems.join("; ")}`
    )
  })

  it("verifies all node types exist in the node registry", () => {
    const raw = fs.readFileSync(templatePath, "utf-8")
    const template = JSON.parse(raw)
    const nodes = template.graph.nodes

    for (const node of nodes) {
      const type = node.data.type as NodeType
      assert.ok(
        type in nodeRegistry,
        `Node type '${type}' on node '${node.id}' must be registered in nodeRegistry`
      )
    }
  })

  it("verifies sequential DAG topology (start -> open-url -> extract -> enrich-and-stage-leads)", () => {
    const raw = fs.readFileSync(templatePath, "utf-8")
    const template = JSON.parse(raw)
    const edges = template.graph.edges

    assert.equal(edges.length, 3, "Template DAG must contain exactly 3 connecting edges")
    assert.equal(edges[0].source, "start_1")
    assert.equal(edges[0].target, "open-url_1")
    assert.equal(edges[1].source, "open-url_1")
    assert.equal(edges[1].target, "extract_1")
    assert.equal(edges[2].source, "extract_1")
    assert.equal(edges[2].target, "enrich-and-stage-leads_1")
  })
})
