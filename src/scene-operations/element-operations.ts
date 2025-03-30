// src/scene-operations/element-operations.ts
import * as THREE from "three";
import { Brep, CompoundBrep } from "../geometry";
import { SceneElement } from "./types";
import { createMeshFromBrep } from "./mesh-operations";
import { transformBrepVertices } from "../convertBRepToGeometry";

export function addElement(
  elements: SceneElement[],
  brep: Brep,
  position: THREE.Vector3,
  idCounter: number,
  objectsMap: Map<string, THREE.Object3D>,
  object?: THREE.Object3D
): { updatedElements: SceneElement[]; nextId: number; nodeId: string } {
  const nextId = idCounter + 1;
  const nodeId = `node_${nextId}`;

  if (!object) {
    object = createMeshFromBrep(brep);
    object.position.copy(position);
  }

  objectsMap.set(nodeId, object);

  const newElement = {
    brep,
    nodeId,
    position,
    selected: false,
  };

  return {
    updatedElements: [...elements, newElement],
    nextId,
    nodeId,
  };
}

export function removeElement(
  elements: SceneElement[],
  selectedElements: string[],
  nodeId: string,
  objectsMap: Map<string, THREE.Object3D>
): { updatedElements: SceneElement[]; updatedSelectedElements: string[] } {
  objectsMap.delete(nodeId);

  return {
    updatedElements: elements.filter((el) => el.nodeId !== nodeId),
    updatedSelectedElements: selectedElements.filter((id) => id !== nodeId),
  };
}

export function updateElementPosition(
  elements: SceneElement[],
  nodeId: string,
  position: THREE.Vector3,
  objectsMap: Map<string, THREE.Object3D>
): SceneElement[] {
  const elementIndex = elements.findIndex((el) => el.nodeId === nodeId);
  if (elementIndex === -1) return elements;

  const element = elements[elementIndex];
  const oldPosition = element.position.clone();

  const object = objectsMap.get(nodeId);
  if (object) {
    object.position.copy(position);
  }

  const positionDelta = new THREE.Vector3().subVectors(position, oldPosition);
  let updatedBrep: Brep;

  if (
    "children" in element.brep &&
    Array.isArray((element.brep as any).children)
  ) {
    const compoundBrep = element.brep as unknown as CompoundBrep;
    const transformedChildren = compoundBrep.children.map((childBrep) => {
      return transformBrepVertices(
        childBrep,
        new THREE.Vector3(0, 0, 0),
        positionDelta
      );
    });

    updatedBrep = new CompoundBrep(transformedChildren);
  } else {
    updatedBrep = transformBrepVertices(
      element.brep,
      new THREE.Vector3(0, 0, 0),
      positionDelta
    );
  }

  return elements.map((el, idx) => {
    if (idx === elementIndex) {
      return {
        ...el,
        position,
        brep: updatedBrep,
      };
    }
    return el;
  });
}
