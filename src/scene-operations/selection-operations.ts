import * as THREE from "three";
import { CompoundBrep } from "../geometry";
import { SceneElement, SceneMode } from "./types";
import { BODY, SELECTION } from "../theme";

export function handleSetMode(
  elements: SceneElement[],
  newMode: SceneMode,
  objectsMap: Map<string, THREE.Object3D>
): { updatedElements: SceneElement[]; mode: SceneMode } {
  const updatedElements = elements.map((element) => {
    const object = objectsMap.get(element.nodeId);
    if (object) {
      if (object instanceof THREE.Mesh) {
        const mat = object.material as THREE.MeshStandardMaterial;
        mat.color.set(BODY.default);
        mat.opacity = 1.0;
        mat.transparent = false;
        mat.needsUpdate = true;
      } else if (object instanceof THREE.Group) {
        object.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.color.set(BODY.default);
            mat.opacity = 1.0;
            mat.transparent = false;
            mat.needsUpdate = true;
          }
          if (child.userData.isEdgeOverlay) {
            const mat = (child as any).material;
            if (mat) {
              mat.opacity = 1.0;
              mat.transparent = false;
              mat.needsUpdate = true;
            }
          }
        });
      }
      // Hide helpers on mode switch
      object.traverse((child) => {
        if (
          child.userData.helperType === "edge" ||
          child.userData.helperType === "vertex"
        ) {
          child.visible = false;
        }
      });
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
      (object.material as THREE.MeshStandardMaterial).color.set(SELECTION.selected);
    } else if (object instanceof THREE.Group) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.selected);
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

  // Update visual state - reset to default body color
  nodesToDeselect.forEach((id) => {
    const object = objectsMap.get(id);
    if (object instanceof THREE.Mesh) {
      (object.material as THREE.MeshStandardMaterial).color.set(BODY.default);
    } else if (object instanceof THREE.Group) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
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
