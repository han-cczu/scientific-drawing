import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeImportedScene as importClient } from "../src/editor/visiomasterAdapter";
import { normalizeImportedScene as importServer } from "../server/src/scene/visiomasterAdapter";
import type { Scene, SceneNodeType } from "../src/shared/scene";
import { validateScene } from "../src/shared/sceneValidation";
import { normalizeSceneImport } from "../src/shared/sceneImport";

function nativeScene(type?: SceneNodeType): Scene {
  return {
    version: "0.1",
    page: { width: 320, height: 180, background: "#FFFFFF", units: "px" },
    metadata: { id: "original", title: "Original", createdAt: "2026-01-01T00:00:00.000Z", engine: "original", notes: ["keep"] },
    nodes: type ? [{ id: "node", type, x: 10, y: 20, w: 80, h: 40, text: "keep", style: { fill: "#AABBCC" } }] : [],
    edges: []
  };
}

const nodeTypes: SceneNodeType[] = ["ellipse", "rounded_rect", "text", "rect", "line", "arrow", "image", "grid", "feature_grid", "bracket", "operator"];

for (const [name, normalize] of [["client", importClient], ["server", importServer]] as const) {
  describe(`${name} native scene import`, () => {
    for (const type of nodeTypes) {
      it(`preserves ${type} when it is the first node`, () => {
        const source = nativeScene(type);
        assert.equal(validateScene(source).ok, true);
        const result = normalize(source);
        assert.equal(result.nodes[0].type, type);
        assert.equal(JSON.stringify(result.metadata), JSON.stringify(source.metadata));
        assert.equal(result.nodes[0].text, "keep");
        assert.equal(validateScene(result).ok, true);
      });
    }

    it("preserves an empty native scene and its metadata", () => {
      const source = nativeScene();
      assert.equal(JSON.stringify(normalize(source)), JSON.stringify(source));
    });

    it("rejects unknown native protocol versions rather than silently downgrading", () => {
      assert.throws(() => normalize({ ...nativeScene("ellipse"), version: "0.2" }), /version/i);
    });

    it("imports external semantic node types", () => {
      const result = normalize({ page: { width: 320, height: 180 }, nodes: [{ id: "ellipse", type: "ellipse_node", x: 0, y: 0, w: 20, h: 20 }] });
      assert.equal(result.nodes[0].type, "ellipse");
      assert.equal(validateScene(result).ok, true);
    });

    it("repairs older native drafts without version or edges", () => {
      const { version, edges, ...draft } = nativeScene("ellipse");
      const result = normalize(draft);
      assert.equal(result.nodes[0].type, "ellipse");
      assert.equal(result.metadata.id, draft.metadata.id);
      assert.deepEqual(result.edges, []);
      assert.equal(result.version, "0.1");
    });

    it("preserves native scenes that have extra source metadata", () => {
      const source = nativeScene("bracket");
      const input = { ...source, metadata: { ...source.metadata, created_by: "old-import" } };
      assert.equal(validateScene(input).ok, true);
      assert.equal(normalize(input).metadata.id, source.metadata.id);
      assert.equal(normalize(input).nodes[0].type, "bracket");
    });

    it("rejects malformed roots and list items with a locatable error", () => {
      assert.throws(() => normalize({}), /\$\.nodes/);
      assert.throws(() => normalize({ ...nativeScene(), nodes: [null] }), /\$\.nodes\[0\]/);
      assert.throws(() => normalize({ ...nativeScene(), edges: [1] }), /\$\.edges\[0\]/);
      assert.throws(() => normalize({ ...nativeScene(), nodes: [{ type: "unknown-shape" }] }), /\$\.nodes\[0\]\.type/);
      assert.throws(() => normalize({ ...nativeScene(), nodes: [{ type: { toString: null } }] }), /\$\.nodes\[0\]\.type/);
    });

    it("rejects mixed vocabularies regardless of which element appears first", () => {
      const native = nativeScene("ellipse").nodes[0];
      const external = { ...native, id: "external", type: "process_box" };
      for (const nodes of [[native, external], [external, native]]) {
        assert.throws(() => normalize({ ...nativeScene(), nodes }), /vocabularies/);
      }
    });
  });
}

describe("shared scene import", () => {
  it("converts AI schema 0.1 and every external shape identically across entry points", () => {
    const types = ["text_block", "ellipse_node", "operator_node", "grid_matrix", "feature_map_grid", "feature_map_banded", "bracket", "image_tile", "rounded_process", "terminator", "text_pill", "group_container", "audit_region", "process_box", "boundary_port", "junction_point"];
    const source = {
      version: "0.1",
      metadata: { title: "Parity", created_by: "ai_reconstruction", style_profile: "paper_white" },
      page: { width: 500, height: 300, background: "white" },
      nodes: types.map((type, index) => ({
        id: `node-${index}`, type, x: index * 10, y: 0, w: 40, h: 20,
        text: "node", symbol: "+", rows: 2, columns: 2, row_colors: ["#ABC", "red"],
        colored_cells: [[0, 0, "#ABC"]], cell_labels: [[0, 0, "7", "#234"]],
        tick_positions: [0.5], orientation: "left", source: "/uploads/image.png",
        style: { line: "#123", line_weight_pt: 2, font_size_pt: 12, line_dash: "dash" }
      })),
      edges: ["arrow_connector", "line_segment", "join_connector", "fork_connector", "boundary_arrow"].map((type, index) => ({
        id: `edge-${index}`, type, from: "node-0:right@0.5", to: "node-1:left@0.5",
        points: [[10, 20], [30, 40]], style: { line: "#123", line_weight_pt: 2 }
      }))
    };
    const before = structuredClone(source);
    const client = importClient(source);
    const server = importServer(source);
    assert.deepEqual({ page: client.page, nodes: client.nodes, edges: client.edges }, { page: server.page, nodes: server.nodes, edges: server.edges });
    assert.equal(validateScene(client).ok, true);
    assert.equal(validateScene(server).ok, true);
    assert.equal(client.metadata.title, "Parity");
    assert.equal(client.metadata.engine, "scientific-drawing.visiomaster-adapter");
    assert.equal(server.metadata.engine, "scientific-drawing.openai-reconstruction");
    assert.deepEqual(client.metadata.notes, ["Imported from Visiomaster-style scene.json."]);
    assert.deepEqual(server.metadata.notes, ["Generated from Visiomaster-style AI scene."]);
    assert.deepEqual(source, before);
  });

  it("keeps source defaults, generated IDs and timestamps explicit and deterministic", () => {
    const options = {
      createId: (prefix: string) => `${prefix}-fixed`,
      createdAt: "2026-01-01T00:00:00.000Z",
      source: { title: "Explicit title", engine: "explicit-engine", notes: ["explicit-note"] }
    };
    const source = { nodes: [{ type: "process_box" }], edges: [{ type: "line_segment", points: [[0, 0], [1, 1]] }] };
    const result = normalizeSceneImport(source, options);
    assert.deepEqual(normalizeSceneImport(source, options), result);
    assert.equal(result.nodes[0].id, "node-fixed");
    assert.equal(result.edges[0].id, "edge-fixed");
    assert.deepEqual(result.metadata, { id: "scene-fixed", title: options.source.title, createdAt: options.createdAt, engine: options.source.engine, notes: options.source.notes });
    const emptyExternal = { version: "0.1", metadata: { created_by: "ai_reconstruction" }, nodes: [] };
    assert.equal(importClient(emptyExternal).metadata.title, "Imported Visiomaster Scene");
    assert.equal(importServer(emptyExternal).metadata.title, "AI Reconstruction");
  });

  it("keeps duplicate and truncated ID references consistent in both entry points", () => {
    const sharedPrefix = "n".repeat(300);
    const source = {
      nodes: [
        { id: sharedPrefix + "-a", type: "process_box" },
        { id: sharedPrefix + "-b", type: "process_box" },
        { id: sharedPrefix + "-a", type: "process_box" }
      ],
      edges: [
        { id: "edge", from: sharedPrefix + "-a", to: sharedPrefix + "-b" },
        { id: "edge", from: sharedPrefix + "-b", to: sharedPrefix + "-a" }
      ]
    };
    const client = importClient(source);
    const server = importServer(source);
    assert.deepEqual(client.nodes, server.nodes);
    assert.deepEqual(client.edges, server.edges);
    assert.equal(new Set(client.nodes.map((node) => node.id)).size, 3);
    assert.equal(new Set(client.edges.map((edge) => edge.id)).size, 2);
    assert.equal(client.edges[0].from, client.nodes[0].id);
    assert.equal(client.edges[1].from, client.nodes[1].id);
  });
});
