import * as THREE from "three";
import { CompoundBrep } from "../geometry";
import { SceneElement, SceneMode } from "./types";

export function handleSetMode(
  elements: SceneElement[],
  newMode: SceneMode,
  objectsMap: Map<string, THREE.Object3D>
): { updatedElements: SceneElement[]; mode: SceneMode } {
  const updatedElements = elements.map((element) => {
    const object = objectsMap.get(element.nodeId);
    if (object instanceof THREE.Mesh) {
      (object.material as THREE.MeshStandardMaterial).color.set(0x0000ff);
    }
    return { ...element, selected: false };
  });

  return { updatedElements, mode: newMode };
}

export function selectElement(
  elements: SceneElement[],
  selectedElements: string[],
  nodeId: string,
  objectsMap: Map<string, THREE.Object3D>
): { updatedElements: SceneElement[]; updatedSelectedElements: string[] } {
  const element = elements.find((el) => el.nodeId === nodeId);
  if (!element)
    return {
      updatedElements: elements,
      updatedSelectedElements: selectedElements,
    };

  let nodesToSelect: string[] = [nodeId];

  if (
    "children" in element.brep &&
    Array.isArray((element.brep as any).children)
  ) {
    elements.forEach((el) => {
      if (el.brep === element.brep) {
        nodesToSelect.push(el.nodeId);
      }
    });
  } else {
    const parentElements = elements.filter(
      (el) =>
        "children" in el.brep &&
        Array.isArray((el.brep as any).children) &&
        (el.brep as unknown as CompoundBrep).children.some(
          (child) => child === element.brep
        )
    );

    if (parentElements.length > 0) {
      parentElements.forEach((parent) => {
        nodesToSelect.push(parent.nodeId);

        elements.forEach((el) => {
          if (
            el.brep === parent.brep ||
            ("children" in parent.brep &&
              Array.isArray((parent.brep as any).children) &&
              (parent.brep as unknown as CompoundBrep).children.includes(
                el.brep
              ))
          ) {
            nodesToSelect.push(el.nodeId);
          }
        });
      });
    }
  }

  nodesToSelect = Array.from(new Set(nodesToSelect));

  nodesToSelect.forEach((id) => {
    const object = objectsMap.get(id);
    if (object instanceof THREE.Mesh) {
      (object.material as THREE.MeshStandardMaterial).color.set(0xff0000);
    } else if (object instanceof THREE.Group) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshStandardMaterial).color.set(0xff0000);
        }
      });
    }
  });

  const updatedElements = elements.map((el) => {
    if (nodesToSelect.includes(el.nodeId)) {
      return { ...el, selected: true };
    }
    return el;
  });

  const updatedSelectedElements = [...selectedElements];
  nodesToSelect.forEach((id) => {
    if (!updatedSelectedElements.includes(id)) {
      updatedSelectedElements.push(id);
    }
  });

  return { updatedElements, updatedSelectedElements };
}

export function deselectElement(
  elements: SceneElement[],
  selectedElements: string[],
  nodeId: string,
  objectsMap: Map<string, THREE.Object3D>
): { updatedElements: SceneElement[]; updatedSelectedElements: string[] } {
  const element = elements.find((el) => el.nodeId === nodeId);
  if (!element)
    return {
      updatedElements: elements,
      updatedSelectedElements: selectedElements,
    };

  let nodesToDeselect: string[] = [nodeId];

  if (
    "children" in element.brep &&
    Array.isArray((element.brep as any).children)
  ) {
    elements.forEach((el) => {
      if (el.brep === element.brep) {
        nodesToDeselect.push(el.nodeId);
      }
    });
  } else {
    // Check if this element belongs to any compound
    const parentElements = elements.filter(
      (el) =>
        "children" in el.brep &&
        Array.isArray((el.brep as any).children) &&
        (el.brep as unknown as CompoundBrep).children.some(
          (child) => child === element.brep
        )
    );

    if (parentElements.length > 0) {
      // Add the parent compound and all its siblings
      parentElements.forEach((parent) => {
        nodesToDeselect.push(parent.nodeId);

        // Add all elements that share this parent
        elements.forEach((el) => {
          if (
            el.brep === parent.brep ||
            ("children" in parent.brep &&
              Array.isArray((parent.brep as any).children) &&
              (parent.brep as unknown as CompoundBrep).children.includes(
                el.brep
              ))
          ) {
            nodesToDeselect.push(el.nodeId);
          }
        });
      });
    }
  }

  // Make unique
  nodesToDeselect = Array.from(new Set(nodesToDeselect));

  // Update visual state - set color back to blue
  nodesToDeselect.forEach((id) => {
    const object = objectsMap.get(id);
    if (object instanceof THREE.Mesh) {
      (object.material as THREE.MeshStandardMaterial).color.set(0x0000ff);
    } else if (object instanceof THREE.Group) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshStandardMaterial).color.set(0x0000ff);
        }
      });
    }
  });

  // Update elements selection state
  const updatedElements = elements.map((el) => {
    if (nodesToDeselect.includes(el.nodeId)) {
      return { ...el, selected: false };
    }
    return el;
  });

  // Update selected elements list - remove deselected nodes
  const updatedSelectedElements = selectedElements.filter(
    (id) => !nodesToDeselect.includes(id)
  );

  return { updatedElements, updatedSelectedElements };
}
