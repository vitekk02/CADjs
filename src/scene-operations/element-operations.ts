// src/scene-operations/element-operations.ts
import * as THREE from "three";
import { Brep, CompoundBrep, Edge, Face, Vertex } from "../geometry";
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

export function rotateElement(
  elements: SceneElement[],
  nodeId: string,
  angleInRadians: number,
  objectsMap: Map<string, THREE.Object3D>
): SceneElement[] {
  const elementIndex = elements.findIndex((el) => el.nodeId === nodeId);
  if (elementIndex === -1) return elements;

  const element = elements[elementIndex];
  const object = objectsMap.get(nodeId);
  const originalPosition = element.position.clone();

  if (object) {
    // Apply rotation to the visual representation
    object.rotation.z += angleInRadians;
  }

  // For the BREP model, rotate all vertices around the element's position
  let updatedBrep: Brep;

  if (
    "children" in element.brep &&
    Array.isArray((element.brep as any).children)
  ) {
    const compoundBrep = element.brep as unknown as CompoundBrep;
    const rotatedChildren = compoundBrep.children.map((childBrep) => {
      return rotateBrep(childBrep, element.position, angleInRadians);
    });

    updatedBrep = new CompoundBrep(rotatedChildren);
  } else {
    updatedBrep = rotateBrep(element.brep, element.position, angleInRadians);
  }

  return elements.map((el, idx) => {
    if (idx === elementIndex) {
      return {
        ...el,
        position: originalPosition, // Ensure position doesn't change
        brep: updatedBrep,
      };
    }
    return el;
  });
}

// Helper function to rotate a Brep around an origin point
function rotateBrep(
  brep: Brep,
  origin: THREE.Vector3,
  angleInRadians: number
): Brep {
  // Create rotation values
  const cosAngle = Math.cos(angleInRadians);
  const sinAngle = Math.sin(angleInRadians);

  // Rotate vertices around origin
  const rotatedVertices = brep.vertices.map((vertex) => {
    // Translate to origin
    const x = vertex.x - origin.x;
    const y = vertex.y - origin.y;

    // Apply rotation
    const newX = x * cosAngle - y * sinAngle;
    const newY = x * sinAngle + y * cosAngle;

    // Translate back
    return new Vertex(newX + origin.x, newY + origin.y, vertex.z);
  });

  // Create new edges with rotated vertices
  const rotatedEdges = brep.edges.map((edge) => {
    const startIndex = brep.vertices.findIndex((v) => v.equals(edge.start));
    const endIndex = brep.vertices.findIndex((v) => v.equals(edge.end));

    if (startIndex === -1 || endIndex === -1) {
      console.error("Could not find vertex in BREP during rotation");
      return new Edge(rotatedVertices[0], rotatedVertices[0]);
    }

    return new Edge(rotatedVertices[startIndex], rotatedVertices[endIndex]);
  });

  // Create faces with rotated vertices
  const rotatedFaces = brep.faces.map((face) => {
    const faceVertices = face.vertices.map((v) => {
      const index = brep.vertices.findIndex((vertex) => vertex.equals(v));
      if (index === -1) {
        console.error("Could not find face vertex in BREP during rotation");
        return rotatedVertices[0];
      }
      return rotatedVertices[index];
    });

    return new Face(faceVertices);
  });

  return new Brep(rotatedVertices, rotatedEdges, rotatedFaces);
}
