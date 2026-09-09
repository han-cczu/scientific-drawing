import { clampNumber, isNormalizedHexColor, normalizeHexColor, resolveEndpoint } from "./geometry";
import { repairScene } from "./repairScene";
import {
  MAX_GEOMETRY_COORDINATE,
  MAX_GRID_CELLS,
  MAX_GRID_DIMENSION,
  MAX_NODE_SIZE,
  MAX_PAGE_DIMENSION,
  MAX_POLYLINE_POINTS,
  MAX_PROTOCOL_STRING_LENGTH,
  MAX_SCENE_EDGES,
  MAX_SCENE_ID_LENGTH,
  MAX_SCENE_NODES,
  MAX_STYLE_FONT_SIZE,
  MAX_STYLE_STROKE_WIDTH,
  MAX_TEXT_LENGTH,
  MAX_TICK_POSITIONS,
  assertScene,
  validateScene
} from "./sceneValidation";
import type { Scene, SceneEdge, SceneNode, SceneStyle } from "./scene";

type AnyRecord = Record<string, unknown>;

export type SceneImportOptions = {
  createId: (prefix: string) => string;
  createdAt: string;
  source: { title: string; engine: string; notes: string[] };
};

const NATIVE_NODE_TYPES = new Set(["text", "rect", "rounded_rect", "ellipse", "line", "arrow", "image", "grid", "feature_grid", "bracket", "operator"]);
const EXTERNAL_NODE_TYPES = new Set(["text_block", "ellipse_node", "operator_node", "grid_matrix", "feature_map_grid", "feature_map_banded", "bracket", "image_tile", "rounded_process", "terminator", "text_pill", "group_container", "audit_region", "process_box", "boundary_port", "junction_point"]);
const NATIVE_EDGE_TYPES = new Set(["arrow", "line", "join", "fork"]);
const EXTERNAL_EDGE_TYPES = new Set(["arrow_connector", "line_segment", "join_connector", "fork_connector", "boundary_arrow"]);

export class SceneFormatError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "SceneFormatError";
  }
}

/** Recognize the whole document, including empty scenes and older drafts without version/edges. */
export function normalizeSceneImport(input: unknown, options: SceneImportOptions): Scene {
  if (!isRecord(input)) {
    throw new SceneFormatError("$", "Scene JSON must be an object.");
  }
  if (input.version !== undefined && input.version !== "0.1") {
    throw new SceneFormatError("$.version", "Unsupported scene version; expected 0.1.");
  }
  const nodes = recordList(input.nodes, "$.nodes");
  const edges = input.edges === undefined ? [] : recordList(input.edges, "$.edges");
  for (const field of ["page", "metadata"] as const) {
    if (input[field] !== undefined && !isRecord(input[field])) {
      throw new SceneFormatError(`$.${field}`, "Must be an object.");
    }
  }
  const metadata = asRecord(input.metadata);
  const externalMarker = "created_by" in metadata || "style_profile" in metadata
    || nodes.some((node) => ["tick_positions", "row_colors", "column_shades", "colored_cells", "cell_labels"].some((field) => field in node));
  const externalVocabulary = nodes.some((node) => typeof node.type === "string" && EXTERNAL_NODE_TYPES.has(node.type) && node.type !== "bracket")
    || edges.some((edge) => typeof edge.type === "string" && EXTERNAL_EDGE_TYPES.has(edge.type));
  const nativeVocabulary = nodes.some((node) => typeof node.type === "string" && NATIVE_NODE_TYPES.has(node.type) && node.type !== "bracket")
    || edges.some((edge) => typeof edge.type === "string" && NATIVE_EDGE_TYPES.has(edge.type));
  if (externalVocabulary && nativeVocabulary) {
    throw new SceneFormatError("$.nodes", "Native and Visiomaster vocabularies cannot be mixed.");
  }
  const nativeMetadata = "id" in metadata || "engine" in metadata || "createdAt" in metadata;
  // Native documents may contain extra provenance fields. A valid native scene
  // and its vocabulary take precedence over optional external-format hints.
  const native = validateScene(input).ok || (!externalVocabulary
    && (nativeVocabulary || (!externalMarker && (input.version === "0.1" || nativeMetadata))));
  assertVocabulary(nodes, native ? NATIVE_NODE_TYPES : EXTERNAL_NODE_TYPES, "$.nodes", !native);
  assertVocabulary(edges, native ? NATIVE_EDGE_TYPES : EXTERNAL_EDGE_TYPES, "$.edges", !native);
  if (native) {
    // repairScene accepts historical field values, but assumes record-shaped collection items.
    // Fill time here so shared import is deterministic for the same options.
    const candidate = {
      ...input,
      version: "0.1",
      metadata: {
        ...metadata,
        createdAt: typeof metadata.createdAt === "string" && metadata.createdAt.trim()
          ? metadata.createdAt : options.createdAt
      },
      nodes,
      edges
    };
    return assertScene(repairScene(candidate as unknown as Scene));
  }
  const converted = normalizeVisiomasterScene(input, options);
  // Valid external defaults (including absent opacity) remain unchanged. Repair only
  // malformed field combinations/references that the shared validator cannot accept.
  return assertScene(validateScene(converted).ok ? converted : repairScene(converted));
}

function recordList(value: unknown, path: string): AnyRecord[] {
  if (!Array.isArray(value)) {
    throw new SceneFormatError(path, "Must be an array.");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) throw new SceneFormatError(`${path}[${index}]`, "Must be an object.");
    return item;
  });
}

function assertVocabulary(items: AnyRecord[], vocabulary: Set<string>, path: string, allowMissing: boolean) {
  items.forEach((item, index) => {
    if (allowMissing && item.type === undefined) return;
    if (typeof item.type !== "string" || !vocabulary.has(item.type)) {
      throw new SceneFormatError(`${path}[${index}].type`, "Unrecognized scene element type.");
    }
  });
}

function normalizeVisiomasterScene(input: AnyRecord, options: SceneImportOptions): Scene {
  const page = asRecord(input.page);
  const metadata = asRecord(input.metadata);
  const width = pageDimension(page.width, 1280);
  const height = pageDimension(page.height, 720);

  const rawNodes = Array.isArray(input.nodes) ? input.nodes.filter(isRecord).slice(0, MAX_SCENE_NODES) : [];
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();
  const nodes = rawNodes.map((node) => {
    const rawId = typeof node.id === "string" && node.id.trim() ? node.id : options.createId("node");
    const id = uniqueId(rawId.slice(0, MAX_SCENE_ID_LENGTH), usedIds);
    if (!idMap.has(rawId)) idMap.set(rawId, id);
    return convertVisiomasterNode(node, id);
  });
  const rawEdges = Array.isArray(input.edges) ? input.edges.filter(isRecord).slice(0, MAX_SCENE_EDGES) : [];
  const usedEdgeIds = new Set<string>();
  const edges = rawEdges.map((edge) => {
    const rawId = typeof edge.id === "string" && edge.id.trim() ? edge.id : options.createId("edge");
    return convertVisiomasterEdge(edge, nodes, idMap, uniqueId(rawId.slice(0, MAX_SCENE_ID_LENGTH), usedEdgeIds));
  });

  const scene: Scene = {
    version: "0.1",
    page: {
      width,
      height,
      background: safeColor(page.background, "#FFFFFF"),
      units: "px"
    },
    metadata: {
      id: options.createId("scene"),
      title: stringValue(metadata.title, options.source.title, MAX_PROTOCOL_STRING_LENGTH),
      createdAt: options.createdAt,
      engine: options.source.engine,
      notes: [...options.source.notes]
    },
    nodes,
    edges
  };
  return scene;
}

function convertVisiomasterNode(node: AnyRecord, id: string): SceneNode {

  const type = stringValue(node.type, "process_box");
  const style = mapStyle(asRecord(node.style));
  const base: SceneNode = {
    id,
    type: mapNodeType(type),
    x: coordinate(node.x, 0),
    y: coordinate(node.y, 0),
    w: positiveSize(node.w, 100),
    h: nonNegativeSize(node.h, 40),
    text: stringOptional(node.text, MAX_TEXT_LENGTH),
    symbol: stringOptional(node.symbol, MAX_TEXT_LENGTH),
    rows: intOptional(node.rows),
    cols: intOptional(node.cols ?? node.columns),
    rowColors: stringArray(node.row_colors, MAX_GRID_DIMENSION),
    columnShades: numberArray(node.column_shades, MAX_GRID_DIMENSION),
    cells: cellArray(node.colored_cells ?? node.cells, node.cell_labels ?? node.labels),
    orientation: orientationValue(node.orientation),
    tickPositions: numberArray(node.tick_positions, MAX_TICK_POSITIONS),
    style
  };
  base.source = stringOptional(node.source, MAX_PROTOCOL_STRING_LENGTH);

  if (base.type === "operator") {
    base.text = base.symbol || base.text || "";
  }
  if (type === "group_container" || type === "audit_region") {
    base.style.fill = base.style.fill ?? "none";
    base.style.stroke = base.style.stroke ?? "#111111";
  }
  return base;
}

function convertVisiomasterEdge(edge: AnyRecord, nodes: SceneNode[], idMap: Map<string, string>, id: string): SceneEdge {

  const from = endpointValue(edge.from, idMap);
  const to = endpointValue(edge.to, idMap);
  const explicitPoints = pointArray(edge.points);
  const fromPoint = pointValue(edge.from_point) ?? (from ? resolveEndpoint(from, nodes) : undefined);
  const toPoint = pointValue(edge.to_point) ?? (to ? resolveEndpoint(to, nodes) : undefined);
  const result: SceneEdge = {
    id,
    type: mapEdgeType(stringValue(edge.type, "arrow_connector")),
    from,
    to,
    fromPoint,
    toPoint,
    points: explicitPoints,
    label: stringOptional(edge.label, MAX_TEXT_LENGTH),
    style: mapStyle(asRecord(edge.style))
  };
  return result;
}

function mapNodeType(type: string): SceneNode["type"] {
  if (type === "text_block") {
    return "text";
  }
  if (type === "ellipse_node") {
    return "ellipse";
  }
  if (type === "operator_node") {
    return "operator";
  }
  if (type === "grid_matrix") {
    return "grid";
  }
  if (type === "feature_map_grid" || type === "feature_map_banded") {
    return "feature_grid";
  }
  if (type === "bracket") {
    return "bracket";
  }
  if (type === "image_tile") {
    return "image";
  }
  if (type === "rounded_process" || type === "terminator" || type === "text_pill" || type === "group_container") {
    return "rounded_rect";
  }
  return "rect";
}

function mapEdgeType(type: string): SceneEdge["type"] {
  if (type === "line_segment" || type === "join_connector") {
    return "line";
  }
  if (type === "fork_connector") {
    return "fork";
  }
  return "arrow";
}

function mapStyle(style: AnyRecord): SceneStyle {
  return {
    fill: optionalColor(style.fill, "#FFFFFF"),
    stroke: optionalColor(style.line ?? style.stroke, "#111111"),
    strokeWidth: strokeWidthOptional(style.line_weight_pt ?? style.strokeWidth),
    fontFamily: stringOptional(style.font_family ?? style.fontFamily, MAX_PROTOCOL_STRING_LENGTH),
    fontSize: fontSizeOptional(style.font_size_pt ?? style.fontSize),
    fontWeight: stringOptional(style.font_weight ?? style.fontWeight, MAX_PROTOCOL_STRING_LENGTH),
    color: optionalColor(style.text_color ?? style.color, "#111111"),
    opacity: numberOptional(style.opacity),
    dash: style.line_dash === "dash" ? "7 5" : undefined
  };
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): AnyRecord {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown, fallback: string, maxLength = MAX_PROTOCOL_STRING_LENGTH) {
  return (typeof value === "string" ? value : fallback).slice(0, maxLength);
}

function stringOptional(value: unknown, maxLength?: number) {
  if (typeof value !== "string") {
    return undefined;
  }
  return maxLength === undefined ? value : value.slice(0, maxLength);
}

function endpointValue(value: unknown, idMap: Map<string, string>) {
  if (typeof value !== "string") {
    return undefined;
  }
  const [rawId, rest] = value.split(":");
  const id = idMap.get(rawId) ?? rawId;
  return (rest ? `${id}:${rest}` : id).slice(0, MAX_PROTOCOL_STRING_LENGTH);
}

function uniqueId(baseId: string, usedIds: Set<string>) {
  let candidate = baseId;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    const suffixText = `-${suffix}`;
    const prefixLength = Math.max(1, MAX_SCENE_ID_LENGTH - suffixText.length);
    candidate = `${baseId.slice(0, prefixLength)}${suffixText}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coordinate(value: unknown, fallback: number) {
  return clampNumber(numberValue(value, fallback), -MAX_GEOMETRY_COORDINATE, MAX_GEOMETRY_COORDINATE);
}

function positiveSize(value: unknown, fallback: number) {
  const numeric = numberValue(value, fallback);
  if (numeric <= 0) {
    return fallback;
  }
  return clampNumber(numeric, 1, MAX_NODE_SIZE);
}

function nonNegativeSize(value: unknown, fallback: number) {
  const numeric = numberValue(value, fallback);
  if (numeric < 0) {
    return fallback;
  }
  return clampNumber(numeric, 0, MAX_NODE_SIZE);
}

function pageDimension(value: unknown, fallback: number) {
  const numeric = numberValue(value, fallback);
  if (numeric <= 0) {
    return fallback;
  }
  return Math.min(MAX_PAGE_DIMENSION, Math.max(1, Math.round(numeric)));
}

function numberOptional(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strokeWidthOptional(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? clampNumber(value, 0, MAX_STYLE_STROKE_WIDTH) : undefined;
}

function fontSizeOptional(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return clampNumber(value, 1, MAX_STYLE_FONT_SIZE);
}

function intOptional(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(MAX_GRID_DIMENSION, Math.max(1, Math.round(value)));
}

function stringArray(value: unknown, maxItems?: number) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const colors = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => safeColor(item, "#FFFFFF"));
  const result = maxItems === undefined ? colors : colors.slice(0, maxItems);
  return result.length > 0 ? result : undefined;
}

function numberArray(value: unknown, maxItems?: number) {
  const numbers = Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : undefined;
  return maxItems === undefined ? numbers : numbers?.slice(0, maxItems);
}

function pointValue(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }
  if (typeof value[0] !== "number" || !Number.isFinite(value[0]) || typeof value[1] !== "number" || !Number.isFinite(value[1])) {
    return undefined;
  }
  return { x: coordinate(value[0], 0), y: coordinate(value[1], 0) };
}

function pointArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map(pointValue)
    .filter((point): point is { x: number; y: number } => Boolean(point))
    .slice(0, MAX_POLYLINE_POINTS);
}

function cellArray(value: unknown, labels?: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const labelMap = cellLabelMap(labels);
  return value.flatMap((cell) => {
    if (Array.isArray(cell) && typeof cell[0] === "number" && Number.isFinite(cell[0]) && typeof cell[1] === "number" && Number.isFinite(cell[1])) {
      const label = labelMap.get(`${cell[0]}:${cell[1]}`);
      return [{
        row: cell[0],
        col: cell[1],
        fill: optionalColor(cell[2], "#FFFFFF"),
        text: stringOptional(cell[3], MAX_TEXT_LENGTH) ?? label?.text,
        color: optionalColor(cell[4], "#111111") ?? label?.color
      }];
    }
    if (isRecord(cell) && typeof cell.row === "number" && Number.isFinite(cell.row) && typeof cell.col === "number" && Number.isFinite(cell.col)) {
      const label = labelMap.get(`${cell.row}:${cell.col}`);
      return [{
        row: cell.row,
        col: cell.col,
        fill: optionalColor(cell.fill, "#FFFFFF"),
        text: stringOptional(cell.text ?? cell.label, MAX_TEXT_LENGTH) ?? label?.text,
        color: optionalColor(cell.color ?? cell.text_color, "#111111") ?? label?.color
      }];
    }
    return [];
  }).slice(0, MAX_GRID_CELLS);
}

function cellLabelMap(value: unknown) {
  const labels = new Map<string, { text?: string; color?: string }>();
  if (!Array.isArray(value)) {
    return labels;
  }
  for (const item of value.slice(0, MAX_GRID_CELLS)) {
    if (Array.isArray(item) && typeof item[0] === "number" && Number.isFinite(item[0]) && typeof item[1] === "number" && Number.isFinite(item[1])) {
      labels.set(`${item[0]}:${item[1]}`, {
        text: stringOptional(item[2], MAX_TEXT_LENGTH),
        color: optionalColor(item[3], "#111111")
      });
    } else if (isRecord(item) && typeof item.row === "number" && Number.isFinite(item.row) && typeof item.col === "number" && Number.isFinite(item.col)) {
      labels.set(`${item.row}:${item.col}`, {
        text: stringOptional(item.text ?? item.label, MAX_TEXT_LENGTH),
        color: optionalColor(item.color ?? item.text_color, "#111111")
      });
    }
  }

  return labels;
}

function orientationValue(value: unknown) {
  if (value === "left" || value === "right" || value === "up" || value === "down") {
    return value;
  }
  return undefined;
}

function optionalColor(value: unknown, fallback: string) {
  if (value === undefined) {
    return undefined;
  }
  return safeColor(value, fallback);
}

function safeColor(value: unknown, fallback: string) {
  if (value === "none") {
    return "none";
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = normalizeHexColor(value);
  return isNormalizedHexColor(normalized) ? normalized : fallback;
}
