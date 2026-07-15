/**
 * Type definitions for the containment-zoom engine.
 *
 * Provides static types for the pure, DOM-free layers.js module that transforms
 * CodeMap nodes and edges into renderable graph data with edge lifting.
 */

/**
 * A graph node representing a package, module, or class.
 *
 * Package and module ids are dotted paths (e.g., `repo.web`, `repo.web.base`).
 * Class ids are `${moduleId}:${ClassName}` (e.g., `repo.web.base:Base`).
 * Class nodes carry a `module` field for containment tracking.
 */
export interface Node {
  /** Unique identifier for the node. */
  id: string;

  /** Node kind: typically "package", "module", or "class". */
  kind: string;

  /** Parent node id (optional; present for packages and modules). */
  parent?: string | null;

  /** Module id (optional; present for class nodes to track containment). */
  module?: string;

  /** Additional properties from CodeMap extraction. */
  [key: string]: any;
}

/**
 * An edge in the CodeMap connecting two nodes.
 *
 * Edges may be real (from extraction) or synthesized (contains links generated
 * by buildDisplayGraph). The engine treats all kinds uniformly during lifting.
 */
export interface Edge {
  /** Source node id. */
  source: string;

  /** Target node id. */
  target: string;

  /** Edge kind: import, uses, registers, contains, or other. */
  kind: string;

  /** Additional properties from CodeMap extraction. */
  [key: string]: any;
}

/**
 * A displayable link in the rendered graph.
 *
 * Includes a lifted flag indicating whether either endpoint was moved to a
 * visible ancestor during containment zoom. Lifted links signal the presence
 * of class-level relations beneath the edge.
 */
export interface Link {
  /** Source node id (may be lifted from original edge). */
  source: string;

  /** Target node id (may be lifted from original edge). */
  target: string;

  /** Link kind: import, uses, registers, contains, or other. */
  kind: string;

  /** True if either endpoint was lifted to a visible ancestor. */
  lifted: boolean;
}

/**
 * Resolve a node id to the id of its nearest visible ancestor on the frontier.
 *
 * Non-class nodes (packages, modules) are always visible and resolve to
 * themselves. A class resolves to itself when its module is in the expanded set;
 * otherwise it resolves to its module. Returns null when the id is unknown or a
 * collapsed class's module is missing from the map (indicating an orphaned class
 * that should be dropped from edges).
 *
 * Args:
 *   nodeId: Id to resolve.
 *   nodesById: All CodeMap nodes keyed by id.
 *   expanded: Set of module ids whose classes are currently visible.
 *
 * Returns:
 *   The visible ancestor id, or null if the id is unknown or orphaned.
 */
export function nearestVisibleAncestor(
  nodeId: string,
  nodesById: Map<string, Node>,
  expanded: Set<any>
): string | null;

/**
 * Build the displayable graph for the current expansion state.
 *
 * Produces the visible frontier (packages and modules always; classes only when
 * their module is expanded), synthesized contains links (module→class) for every
 * visible class, and every real edge with endpoints lifted to their nearest
 * visible ancestors. Self-loops produced by lifting are dropped; parallel links
 * are deduped by source|target|kind with lifted OR-merged across raw edges that
 * share a dedup key. Dropped edges are those whose endpoints are unknown,
 * orphaned classes, or self-loops.
 *
 * The returned nodes are references into the input node array (no copies).
 * The rendering shell owns any copying or position state.
 *
 * Args:
 *   nodes: Full CodeMap node set.
 *   edges: Full CodeMap edge set.
 *   expanded: Set of module ids whose classes are currently visible.
 *
 * Returns:
 *   An object with nodes (visible frontier) and links (deduped, lifted edges
 *   plus synthesized contains links).
 */
export function buildDisplayGraph(
  nodes: Node[],
  edges: Edge[],
  expanded: Set<any>
): {
  nodes: Node[];
  links: Link[];
};
