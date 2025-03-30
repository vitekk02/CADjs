// src/scene-operations/union-operations.ts
import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
import { SceneElement } from "./types";
import { createMeshFromBrep } from "./mesh-operations";

export function unionSelectedElements(
  elements: SceneElement[],
  selectedElements: string[],
  idCounter: number,
  brepGraph: BrepGraph,
  objectsMap: Map<string, THREE.Object3D>
): {
  updatedElements: SceneElement[];
  updatedSelectedElements: string[];
  nextIdCounter: number;
} {
  if (selectedElements.length < 2) {
    return {
      updatedElements: elements,
      updatedSelectedElements: selectedElements,
      nextIdCounter: idCounter,
    };
  }

  // Get selected elements data
  const selectedElementsData = elements.filter((el) =>
    selectedElements.includes(el.nodeId)
  );
  const selectedNodeIds = [...selectedElements];

  // Create compound BREP
  const brepsToUnion: Brep[] = [];
  selectedElementsData.forEach((element) => {
    if (
      "children" in element.brep &&
      Array.isArray((element.brep as any).children)
    ) {
      const compound = element.brep as unknown as CompoundBrep;
      brepsToUnion.push(...compound.children);
    } else {
      brepsToUnion.push(element.brep);
    }
  });

  const compound = new CompoundBrep(brepsToUnion);
  const nextId = idCounter + 1;
  const nodeId = `node_${nextId}`;

  // Add to graph
  brepGraph.addNode({
    id: nodeId,
    brep: compound,
    mesh: null,
    connections: [],
  });

  selectedElementsData.forEach((element) => {
    brepGraph.addConnection(element.nodeId, {
      targetId: nodeId,
      connectionType: "union",
    });
  });

  // Create mesh
  const unionMesh = createMeshFromBrep(compound);
  unionMesh.position.set(0, 0, 0);

  // Calculate center
  const geometry = unionMesh.geometry;
  geometry.computeBoundingBox();
  const boundingBox = geometry.boundingBox;

  if (!boundingBox) {
    console.error("Failed to compute bounding box");
    return {
      updatedElements: elements,
      updatedSelectedElements: selectedElements,
      nextIdCounter: idCounter,
    };
  }

  const center = new THREE.Vector3();
  boundingBox.getCenter(center);

  // Re-center mesh
  const positionAttribute = geometry.getAttribute("position");
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i) - center.x;
    const y = positionAttribute.getY(i) - center.y;
    const z = positionAttribute.getZ(i) - center.z;
    positionAttribute.setXYZ(i, x, y, z);
  }
  positionAttribute.needsUpdate = true;

  // Recompute bounding data
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // Create group with mesh
  const unionGroup = new THREE.Group();
  unionGroup.userData = { nodeId };
  unionGroup.add(unionMesh);
  unionGroup.position.copy(center);

  // Create new element
  const newElement = {
    brep: compound,
    nodeId,
    position: center,
    selected: false,
  };

  // Update maps and clean up
  objectsMap.set(nodeId, unionGroup);
  selectedNodeIds.forEach((id) => {
    objectsMap.delete(id);
  });

  const updatedElements = [
    ...elements.filter((el) => !selectedElements.includes(el.nodeId)),
    newElement,
  ];

  return {
    updatedElements,
    updatedSelectedElements: [],
    nextIdCounter: nextId,
  };
}
