import { endpointReferencesNode } from "./geometry";
import type { SceneEdge, SceneNode } from "./scene";

export function visibleSceneNodes(nodes: SceneNode[]) {
  /*
   * ========================================================================
   * 步骤1：过滤可见节点
   * ========================================================================
   * 目标：
   *   1) 隐藏节点不参与画布和导出渲染
   *   2) 保留原有图层顺序
   */

  // 1.1 返回未隐藏节点
  return nodes.filter((node) => !node.hidden);
}

export function visibleSceneEdges(edges: SceneEdge[], nodes: SceneNode[]) {
  /*
   * ========================================================================
   * 步骤1：过滤可见连线
   * ========================================================================
   * 目标：
   *   1) 引用隐藏节点的连线不渲染
   *   2) 显式坐标连线不受节点可见性影响
   */

  // 1.1 收集隐藏节点 id
  const hiddenNodeIds = new Set(nodes.filter((node) => node.hidden).map((node) => node.id));

  // 1.2 返回可见连线
  return edges.filter((edge) => {
    for (const nodeId of hiddenNodeIds) {
      if (endpointReferencesNode(edge.from, nodeId) || endpointReferencesNode(edge.to, nodeId)) {
        return false;
      }
    }
    return true;
  });
}
