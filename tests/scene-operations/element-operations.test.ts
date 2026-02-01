import * as THREE from "three";
import {
  addElement,
  removeElement,
  updateElementPosition,
} from "../../src/scene-operations/element-operations";
import { Brep, CompoundBrep, Face, Vertex } from "../../src/geometry";
import { SceneElement } from "../../src/scene-operations/types";

// Mock dependencies
jest.mock("../../src/scene-operations/mesh-operations", () => ({
  createMeshFromBrep: jest.fn(
    () =>
      new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ color: 0x0000ff })
      )
  ),
}));

jest.mock("../../src/convertBRepToGeometry", () => ({
  transformBrepVertices: jest.fn((brep) => brep),
  createGeometryFromBRep: jest.fn(() => new THREE.BufferGeometry()),
}));

describe("element-operations", () => {
  let objectsMap: Map<string, THREE.Object3D>;
  let elements: SceneElement[];
  let selectedElements: string[];
  let simpleBrep: Brep;
  let compoundBrep: CompoundBrep;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup test fixtures
    objectsMap = new Map<string, THREE.Object3D>();
    elements = [];
    selectedElements = [];

    // Create a simple brep
    const v1 = new Vertex(0, 0, 0);
    const v2 = new Vertex(1, 0, 0);
    const v3 = new Vertex(1, 1, 0);
    const face = new Face([v1, v2, v3]);
    simpleBrep = new Brep([v1, v2, v3], [], [face]);

    // Create a compound brep
    const brep1 = new Brep([v1, v2, v3], [], [face]);
    const v4 = new Vertex(0, 0, 1);
    const v5 = new Vertex(1, 0, 1);
    const v6 = new Vertex(1, 1, 1);
    const face2 = new Face([v4, v5, v6]);
    const brep2 = new Brep([v4, v5, v6], [], [face2]);
    compoundBrep = new CompoundBrep([brep1, brep2]);
  });

  describe("addElement", () => {
    test("adds an element with auto-created mesh", () => {
      const position = new THREE.Vector3(1, 2, 3);
      const idCounter = 0;

      const result = addElement(
        elements,
        simpleBrep,
        position,
        idCounter,
        objectsMap
      );

      // Check if elements array is updated correctly
      expect(result.updatedElements).toHaveLength(1);
      expect(result.updatedElements[0].nodeId).toBe("node_1");
      expect(result.updatedElements[0].brep).toBe(simpleBrep);
      expect(result.updatedElements[0].position).toBe(position);
      expect(result.updatedElements[0].selected).toBe(false);

      // Check if object was created and added to map
      expect(objectsMap.size).toBe(1);
      expect(objectsMap.has("node_1")).toBe(true);

      // Check if id counter is incremented
      expect(result.nextId).toBe(1);
    });

    test("adds an element with provided mesh", () => {
      const position = new THREE.Vector3(1, 2, 3);
      const idCounter = 5;
      const customMesh = new THREE.Mesh(
        new THREE.SphereGeometry(),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );

      const result = addElement(
        elements,
        simpleBrep,
        position,
        idCounter,
        objectsMap,
        customMesh
      );

      expect(result.nodeId).toBe("node_6");
      expect(objectsMap.get("node_6")).toBe(customMesh);
    });
  });

  describe("removeElement", () => {
    beforeEach(() => {
      // Setup pre-existing elements
      elements = [
        {
          nodeId: "node_1",
          brep: simpleBrep,
          position: new THREE.Vector3(0, 0, 0),
          selected: false,
        },
        {
          nodeId: "node_2",
          brep: simpleBrep,
          position: new THREE.Vector3(1, 0, 0),
          selected: true,
        },
      ];
      selectedElements = ["node_2"];

      // Add objects to objectsMap
      objectsMap.set("node_1", new THREE.Mesh());
      objectsMap.set("node_2", new THREE.Mesh());
    });

    test("removes element from elements array and objects map", () => {
      const result = removeElement(
        elements,
        selectedElements,
        "node_1",
        objectsMap
      );

      expect(result.updatedElements).toHaveLength(1);
      expect(result.updatedElements[0].nodeId).toBe("node_2");
      expect(objectsMap.has("node_1")).toBe(false);
      expect(objectsMap.has("node_2")).toBe(true);
    });

    test("removes element from selected elements if it was selected", () => {
      const result = removeElement(
        elements,
        selectedElements,
        "node_2",
        objectsMap
      );

      expect(result.updatedSelectedElements).toHaveLength(0);
      expect(result.updatedElements).toHaveLength(1);
      expect(result.updatedElements[0].nodeId).toBe("node_1");
    });
  });

  describe("updateElementPosition", () => {
    let transformBrepVerticesMock: jest.Mock;

    beforeEach(() => {
      // Get reference to mock function
      transformBrepVerticesMock =
        require("../../src/convertBRepToGeometry").transformBrepVertices;

      // Create a simple implementation
      transformBrepVerticesMock.mockImplementation((brep) => {
        return brep; // Just return the same brep for testing
      });

      // Setup pre-existing elements
      elements = [
        {
          nodeId: "node_1",
          brep: simpleBrep,
          position: new THREE.Vector3(0, 0, 0),
          selected: false,
        },
        {
          nodeId: "node_2",
          brep: compoundBrep,
          position: new THREE.Vector3(1, 0, 0),
          selected: true,
        },
      ];

      // Add objects to objectsMap
      objectsMap.set("node_1", new THREE.Mesh());
      objectsMap.set("node_2", new THREE.Group());
    });

    test("updates position for a simple brep element", () => {
      const newPosition = new THREE.Vector3(5, 5, 5);
      const updatedElements = updateElementPosition(
        elements,
        "node_1",
        newPosition,
        objectsMap
      );

      // Check if position is updated
      const updatedElement = updatedElements.find(
        (el) => el.nodeId === "node_1"
      );
      expect(updatedElement?.position).toEqual(newPosition);

      // Check if object position is updated
      const object = objectsMap.get("node_1");
      expect(object?.position.equals(newPosition)).toBe(true);

      // BRep vertices are NOT transformed - only position property is updated
      // transformBrepVertices is NOT called in updateElementPosition
    });

    test("updates position for a compound brep element", () => {
      const newPosition = new THREE.Vector3(10, 10, 10);
      const updatedElements = updateElementPosition(
        elements,
        "node_2",
        newPosition,
        objectsMap
      );

      // Check if position is updated
      const updatedElement = updatedElements.find(
        (el) => el.nodeId === "node_2"
      );
      expect(updatedElement?.position).toEqual(newPosition);

      // Check if object position is updated
      const object = objectsMap.get("node_2");
      expect(object?.position.equals(newPosition)).toBe(true);

      // BRep vertices are NOT transformed for compound breps either
      // The position property is updated, not the geometry
    });

    test("returns original elements array when element not found", () => {
      const newPosition = new THREE.Vector3(5, 5, 5);
      const updatedElements = updateElementPosition(
        elements,
        "non_existent",
        newPosition,
        objectsMap
      );

      // Should return the original elements unchanged
      expect(updatedElements).toBe(elements);
      expect(transformBrepVerticesMock).not.toHaveBeenCalled();
    });
  });
});
