// src/scene-operations/ungroup-operations.ts
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

  // Find the selected element
  const element = elements.find((el) => el.nodeId === selectedElement);

  if (!element) {
    return {
      updatedElements: elements,
      updatedSelectedElements: [],
      nextIdCounter: idCounter,
    };
  }

  // Check if it's a compound BRep
  if (
    !("children" in element.brep) ||
    !Array.isArray((element.brep as any).children) ||
    (element.brep as CompoundBrep).children.length === 0
  ) {
    // Not a compound BRep or empty
    console.log("Not a compound brep or empty children array");
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

  // Create a new element for each BRep in the compound
  for (const brep of compound.children) {
    nextId++;
    const nodeId = `node_${nextId}`;

    // Create mesh
    const mesh = createMeshFromBrep(brep);
    mesh.position.copy(compoundPosition);
    mesh.userData = { nodeId };

    // Add to object map
    objectsMap.set(nodeId, mesh);

    // Create element
    const newElement = {
      brep,
      nodeId,
      position: compoundPosition.clone(),
      selected: false,
    };

    newElements.push(newElement);
    newNodeIds.push(nodeId);

    // Add to graph
    brepGraph.addNode({
      id: nodeId,
      brep,
      mesh: null,
      connections: [],
    });

    // Connect to original in graph
    brepGraph.addConnection(selectedElement, {
      targetId: nodeId,
      connectionType: "ungroup",
    });
  }

  // Remove the original compound from objectsMap
  objectsMap.delete(selectedElement);

  // Return updated state
  return {
    updatedElements: [
      ...elements.filter((el) => el.nodeId !== selectedElement),
      ...newElements,
    ],
    updatedSelectedElements: [],
    nextIdCounter: nextId,
  };
}
