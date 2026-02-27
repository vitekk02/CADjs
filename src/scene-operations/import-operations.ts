import * as THREE from "three";
import { Brep } from "../geometry";
import { SceneElement } from "./types";
import { createMeshFromBrep } from "./mesh-operations";
import { ImportResult } from "../services/ImportExportService";

export function importElements(
  elements: SceneElement[],
  imports: ImportResult[],
  idCounter: number,
  objectsMap: Map<string, THREE.Object3D>,
): { updatedElements: SceneElement[]; nextId: number; nodeIds: string[] } {
  const newElements = [...elements];
  const nodeIds: string[] = [];
  let currentId = idCounter;

  for (const imp of imports) {
    currentId += 1;
    const nodeId = `node_${currentId}`;
    nodeIds.push(nodeId);

    const mesh = createMeshFromBrep(imp.brep);
    mesh.position.copy(imp.position);
    objectsMap.set(nodeId, mesh);

    newElements.push({
      brep: imp.brep,
      nodeId,
      position: imp.position,
      selected: false,
    });
  }

  return {
    updatedElements: newElements,
    nextId: currentId,
    nodeIds,
  };
}
