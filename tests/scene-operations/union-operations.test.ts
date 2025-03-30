import * as THREE from "three";
import { unionSelectedElements } from "../../src/scene-operations/union-operations";
import {
  Brep,
  BrepGraph,
  CompoundBrep,
  Face,
  Vertex,
} from "../../src/geometry";
import { SceneElement } from "../../src/scene-operations/types";

// Mock dependencies
jest.mock("../../src/scene-operations/mesh-operations", () => ({
  createMeshFromBrep: jest.fn(() => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x0000ff })
    );

    // Set up geometry with a bounding box for testing
    mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1)
    );

    return mesh;
  }),
}));

describe("union-operations", () => {
  let objectsMap: Map<string, THREE.Object3D>;
  let elements: SceneElement[];
  let selectedElements: string[];
  let brepGraph: BrepGraph;
  let idCounter: number;
  let brep1: Brep;
  let brep2: Brep;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Set up test fixtures
    objectsMap = new Map<string, THREE.Object3D>();
    brepGraph = new BrepGraph();
    idCounter = 5; // Start with a non-zero ID to test increment

    // Create simple breps for testing
    const v1 = new Vertex(0, 0, 0);
    const v2 = new Vertex(1, 0, 0);
    const v3 = new Vertex(1, 1, 0);
    const face1 = new Face([v1, v2, v3]);
    brep1 = new Brep([v1, v2, v3], [], [face1]);

    const v4 = new Vertex(0.5, 0.5, 0);
    const v5 = new Vertex(1.5, 0.5, 0);
    const v6 = new Vertex(1, 1.5, 0);
    const face2 = new Face([v4, v5, v6]);
    brep2 = new Brep([v4, v5, v6], [], [face2]);

    // Set up elements and add them to the objects map
    elements = [
      {
        nodeId: "node_1",
        brep: brep1,
        position: new THREE.Vector3(0, 0, 0),
        selected: true,
      },
      {
        nodeId: "node_2",
        brep: brep2,
        position: new THREE.Vector3(1, 0, 0),
        selected: true,
      },
      {
        nodeId: "node_3", // An unselected element
        brep: new Brep([], [], []),
        position: new THREE.Vector3(2, 0, 0),
        selected: false,
      },
    ];

    // Set up selected elements
    selectedElements = ["node_1", "node_2"];

    // Add objects to the map
    objectsMap.set("node_1", new THREE.Mesh());
    objectsMap.set("node_2", new THREE.Mesh());
    objectsMap.set("node_3", new THREE.Mesh());

    // Add nodes to graph
    elements.forEach((el) => {
      brepGraph.addNode({
        id: el.nodeId,
        brep: el.brep,
        mesh: null,
        connections: [],
      });
    });
  });

  test("returns unchanged state when fewer than 2 elements selected", () => {
    const result = unionSelectedElements(
      elements,
      ["node_1"], // Only one element selected
      idCounter,
      brepGraph,
      objectsMap
    );

    // Should return original state
    expect(result.updatedElements).toBe(elements);
    expect(result.updatedSelectedElements).toEqual(["node_1"]);
    expect(result.nextIdCounter).toBe(idCounter);
    expect(objectsMap.size).toBe(3); // No changes to objects map
  });

  test("creates a compound brep and updates state when elements are selected", () => {
    const result = unionSelectedElements(
      elements,
      selectedElements,
      idCounter,
      brepGraph,
      objectsMap
    );

    // Check the ID counter was incremented
    expect(result.nextIdCounter).toBe(6);

    // Check that a new element was created with a CompoundBrep
    expect(result.updatedElements.length).toBe(2); // One new element + node_3

    const newElement = result.updatedElements.find(
      (el) => el.nodeId === "node_6"
    );
    expect(newElement).toBeDefined();
    expect(newElement?.brep).toBeInstanceOf(CompoundBrep);

    // Verify compound contains both original breps
    const compound = newElement?.brep as CompoundBrep;
    expect(compound.children.length).toBe(2);
    expect(compound.children).toContain(brep1);
    expect(compound.children).toContain(brep2);

    // Check that original objects were removed from map
    expect(objectsMap.has("node_1")).toBeFalsy();
    expect(objectsMap.has("node_2")).toBeFalsy();

    // Check that new object was added to map
    expect(objectsMap.has("node_6")).toBeTruthy();
    expect(objectsMap.get("node_6")).toBeInstanceOf(THREE.Group);

    // Verify connections in graph
    expect(brepGraph.nodes.size).toBe(4); // 3 original + 1 new

    const node1 = brepGraph.nodes.get("node_1");
    const node2 = brepGraph.nodes.get("node_2");

    expect(node1?.connections.length).toBe(1);
    expect(node1?.connections[0].targetId).toBe("node_6");
    expect(node1?.connections[0].connectionType).toBe("union");

    expect(node2?.connections.length).toBe(1);
    expect(node2?.connections[0].targetId).toBe("node_6");
    expect(node2?.connections[0].connectionType).toBe("union");

    // Selected elements should be cleared
    expect(result.updatedSelectedElements).toEqual([]);
  });

  test("handles compound breps in the union operation", () => {
    // Create a compound brep first
    const compound = new CompoundBrep([brep1, brep2]);

    // Replace element 1 with a compound
    elements[0] = {
      ...elements[0],
      brep: compound,
    };

    const result = unionSelectedElements(
      elements,
      selectedElements,
      idCounter,
      brepGraph,
      objectsMap
    );

    // The resulting compound should have 3 breps (brep1, brep2, brep2)
    const newElement = result.updatedElements.find(
      (el) => el.nodeId === "node_6"
    );
    const resultCompound = newElement?.brep as CompoundBrep;

    expect(resultCompound.children.length).toBe(3);
    // brep1 and brep2 from the existing compound, plus brep2 again from the second element
    expect(resultCompound.children).toContain(brep1);
    expect(resultCompound.children).toContain(brep2);
  });
});
