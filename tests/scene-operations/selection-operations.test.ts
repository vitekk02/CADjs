import * as THREE from "three";
import {
  handleSetMode,
  selectElement,
  deselectElement,
} from "../../src/scene-operations/selection-operations";
import { CompoundBrep } from "../../src/geometry";

describe("selection-operations", () => {
  let objectsMap: Map<string, THREE.Object3D>;
  let elements: any[];
  let selectedElements: string[];

  beforeEach(() => {
    objectsMap = new Map<string, THREE.Object3D>();
    elements = [
      {
        nodeId: "node_1",
        brep: { faces: [] },
        position: new THREE.Vector3(),
        selected: false,
      },
      {
        nodeId: "node_2",
        brep: { faces: [] },
        position: new THREE.Vector3(),
        selected: false,
      },
    ];
    selectedElements = [];
    // Create minimal THREE.Mesh objects for testing
    elements.forEach((el) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ color: 0x0000ff })
      );
      objectsMap.set(el.nodeId, mesh);
    });
  });

  test("handleSetMode deselects all and sets new mode", () => {
    // Pre-select an element
    elements[0].selected = true;
    selectedElements.push("node_1");

    const newMode = "move";
    const result = handleSetMode(elements, newMode, objectsMap);
    // All elements should be deselected
    result.updatedElements.forEach((el) => expect(el.selected).toBe(false));
    expect(result.mode).toBe(newMode);
  });

  test("selectElement updates element selection", () => {
    const result = selectElement(
      elements,
      selectedElements,
      "node_1",
      objectsMap
    );
    const updatedElement = result.updatedElements.find(
      (el) => el.nodeId === "node_1"
    );
    expect(updatedElement?.selected).toBe(true);
    expect(result.updatedSelectedElements).toContain("node_1");
  });

  test("deselectElement updates element selection", () => {
    // First select and then deselect node_1
    let result = selectElement(
      elements,
      selectedElements,
      "node_1",
      objectsMap
    );
    expect(result.updatedSelectedElements).toContain("node_1");

    result = deselectElement(
      result.updatedElements,
      result.updatedSelectedElements,
      "node_1",
      objectsMap
    );
    const updatedElement = result.updatedElements.find(
      (el) => el.nodeId === "node_1"
    );
    expect(updatedElement?.selected).toBe(false);
    expect(result.updatedSelectedElements).not.toContain("node_1");
  });
});
