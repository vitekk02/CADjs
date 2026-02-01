import * as THREE from "three";
import { SceneElement } from "./types";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
import { createMeshFromBrep } from "./mesh-operations";

export function ungroupSelectedElement(
  elements: SceneElement[],
  selectedElement: string | null,
  idCounter: number,
  brepGraph: BrepGraph,
  objectsMap: Map<string, THREE.Object3D>
): {
  updatedElements: SceneElement[];
  updatedSelectedElements: string[];
  nextIdCounter: number;
} {
  if (!selectedElement) {
    return {
      updatedElements: elements,
      updatedSelectedElements: [],
      nextIdCounter: idCounter,
    };
  }

  const element = elements.find((el) => el.nodeId === selectedElement);

  if (!element) {
    return {
      updatedElements: elements,
      updatedSelectedElements: [],
      nextIdCounter: idCounter,
    };
  }

  if (
    !("children" in element.brep) ||
    !Array.isArray((element.brep as any).children) ||
    (element.brep as CompoundBrep).children.length === 0
  ) {
    return {
      updatedElements: elements,
      updatedSelectedElements: [],
      nextIdCounter: idCounter,
    };
  }

  const compound = element.brep as CompoundBrep;
  const compoundPosition = element.position.clone();
  const compoundObject = objectsMap.get(selectedElement);
  let nextId = idCounter;
  const newElements: SceneElement[] = [];
  const newNodeIds: string[] = [];

  for (const brep of compound.children) {
    nextId++;
    const nodeId = `node_${nextId}`;

    const mesh = createMeshFromBrep(brep);
    mesh.position.copy(compoundPosition);
    mesh.userData = { nodeId };

    objectsMap.set(nodeId, mesh);

    const newElement = {
      brep,
      nodeId,
      position: compoundPosition.clone(),
      selected: false,
    };

    newElements.push(newElement);
    newNodeIds.push(nodeId);

    brepGraph.addNode({
      id: nodeId,
      brep,
      mesh: null,
      connections: [],
    });

    brepGraph.addConnection(selectedElement, {
      targetId: nodeId,
      connectionType: "ungroup",
    });
  }

  objectsMap.delete(selectedElement);

  return {
    updatedElements: [
      ...elements.filter((el) => el.nodeId !== selectedElement),
      ...newElements,
    ],
    updatedSelectedElements: [],
    nextIdCounter: nextId,
  };
}
