import * as THREE from "three";
import { ungroupSelectedElement } from "../../src/scene-operations/ungroup-operations";
import { Brep, CompoundBrep, BrepGraph, Face, Vertex, Edge } from "../../src/geometry";
import { SceneElement } from "../../src/scene-operations/types";

// Mock the mesh-operations module
jest.mock("../../src/scene-operations/mesh-operations", () => ({
  createMeshFromBrep: jest.fn(() => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x0000ff })
    );
    return mesh;
  }),
}));

describe("ungroup-operations", () => {
  let brepGraph: BrepGraph;
  let objectsMap: Map<string, THREE.Object3D>;

  // Helper to create a simple Brep
  function createSimpleBrep(): Brep {
    const v1 = new Vertex(0, 0, 0);
    const v2 = new Vertex(1, 0, 0);
    const v3 = new Vertex(1, 1, 0);
    const face = new Face([v1, v2, v3]);
    return new Brep([v1, v2, v3], [], [face]);
  }

  // Helper to create a CompoundBrep
  function createCompoundBrep(childCount: number = 2): CompoundBrep {
    const children: Brep[] = [];
    for (let i = 0; i < childCount; i++) {
      const v1 = new Vertex(i, 0, 0);
      const v2 = new Vertex(i + 1, 0, 0);
      const v3 = new Vertex(i + 0.5, 1, 0);
      const face = new Face([v1, v2, v3]);
      children.push(new Brep([v1, v2, v3], [], [face]));
    }
    return new CompoundBrep(children);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    brepGraph = new BrepGraph();
    objectsMap = new Map<string, THREE.Object3D>();
  });

  describe("Basic Ungrouping", () => {
    it("should split CompoundBrep into individual elements", () => {
      const compound = createCompoundBrep(3);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      // Add compound to graph and objectsMap
      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      // Should create 3 new elements (one for each child)
      expect(result.updatedElements).toHaveLength(3);
    });

    it("should create mesh for each child BRep", () => {
      const createMeshMock = require("../../src/scene-operations/mesh-operations").createMeshFromBrep;
      const compound = createCompoundBrep(2);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      ungroupSelectedElement(elements, "compound_1", 10, brepGraph, objectsMap);

      expect(createMeshMock).toHaveBeenCalledTimes(2);
    });

    it("should assign unique nodeId to each child", () => {
      const compound = createCompoundBrep(3);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      const nodeIds = result.updatedElements.map((el) => el.nodeId);
      const uniqueIds = new Set(nodeIds);
      expect(uniqueIds.size).toBe(nodeIds.length);
    });

    it("should remove original compound element", () => {
      const compound = createCompoundBrep(2);
      const simpleBrep = createSimpleBrep();
      const elements: SceneElement[] = [
        {
          brep: simpleBrep,
          nodeId: "simple_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: false,
        },
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(1, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());
      objectsMap.set("simple_1", new THREE.Mesh());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      // Original compound should be removed
      expect(result.updatedElements.find((el) => el.nodeId === "compound_1")).toBeUndefined();
    });
  });

  describe("State Management", () => {
    it("should increment idCounter for each child", () => {
      const compound = createCompoundBrep(3);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      // Started at 10, incremented 3 times = 13
      expect(result.nextIdCounter).toBe(13);
    });

    it("should update objectsMap with new elements", () => {
      const compound = createCompoundBrep(2);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      // New objects should be in the map
      result.updatedElements.forEach((el) => {
        expect(objectsMap.has(el.nodeId)).toBe(true);
      });
    });

    it("should remove original from objectsMap", () => {
      const compound = createCompoundBrep(2);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      ungroupSelectedElement(elements, "compound_1", 10, brepGraph, objectsMap);

      expect(objectsMap.has("compound_1")).toBe(false);
    });

    it("should clear selectedElements after ungroup", () => {
      const compound = createCompoundBrep(2);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      expect(result.updatedSelectedElements).toHaveLength(0);
    });
  });

  describe("Graph Tracking", () => {
    it("should add graph node for each child", () => {
      const compound = createCompoundBrep(2);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      // Each new element should have a node in the graph
      result.updatedElements.forEach((el) => {
        expect(brepGraph.nodes.has(el.nodeId)).toBe(true);
      });
    });

    it("should create ungroup connection from parent", () => {
      const compound = createCompoundBrep(2);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      // Parent node should have connections to children
      const parentNode = brepGraph.nodes.get("compound_1");
      expect(parentNode?.connections.length).toBe(2);
      parentNode?.connections.forEach((conn) => {
        expect(conn.connectionType).toBe("ungroup");
      });
    });
  });

  describe("Position Handling", () => {
    it("should preserve world position for children", () => {
      const compound = createCompoundBrep(2);
      const compoundPosition = new THREE.Vector3(5, 10, 15);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: compoundPosition,
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      // All children should have the same position as the compound
      result.updatedElements.forEach((el) => {
        expect(el.position.x).toBe(5);
        expect(el.position.y).toBe(10);
        expect(el.position.z).toBe(15);
      });
    });

    it("should handle compound at non-origin position", () => {
      const compound = createCompoundBrep(2);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(-100, 200, 50),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      result.updatedElements.forEach((el) => {
        expect(el.position.x).toBe(-100);
        expect(el.position.y).toBe(200);
        expect(el.position.z).toBe(50);
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle compound with single child", () => {
      const compound = createCompoundBrep(1);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      expect(result.updatedElements).toHaveLength(1);
    });

    it("should handle compound with many children (10+)", () => {
      const compound = createCompoundBrep(15);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      expect(result.updatedElements).toHaveLength(15);
      expect(result.nextIdCounter).toBe(25); // 10 + 15
    });

    it("should return unchanged for non-compound element", () => {
      const simpleBrep = createSimpleBrep();
      const elements: SceneElement[] = [
        {
          brep: simpleBrep,
          nodeId: "simple_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("simple_1", new THREE.Mesh());

      const result = ungroupSelectedElement(
        elements,
        "simple_1",
        10,
        brepGraph,
        objectsMap
      );

      expect(result.updatedElements).toBe(elements);
      expect(result.nextIdCounter).toBe(10); // Unchanged
    });
  });

  describe("Validation", () => {
    it("should handle empty selection", () => {
      const elements: SceneElement[] = [];

      const result = ungroupSelectedElement(
        elements,
        null,
        10,
        brepGraph,
        objectsMap
      );

      expect(result.updatedElements).toBe(elements);
      expect(result.updatedSelectedElements).toHaveLength(0);
      expect(result.nextIdCounter).toBe(10);
    });

    it("should handle element not found", () => {
      const elements: SceneElement[] = [];

      const result = ungroupSelectedElement(
        elements,
        "nonexistent",
        10,
        brepGraph,
        objectsMap
      );

      expect(result.updatedElements).toBe(elements);
      expect(result.nextIdCounter).toBe(10);
    });

    it("should handle CompoundBrep with empty children array", () => {
      const compound = new CompoundBrep([]);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "empty_compound",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("empty_compound", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "empty_compound",
        10,
        brepGraph,
        objectsMap
      );

      // Should return unchanged since no children to ungroup
      expect(result.updatedElements).toBe(elements);
      expect(result.nextIdCounter).toBe(10);
    });
  });

  describe("Mesh userData", () => {
    it("should set userData.nodeId on created meshes", () => {
      const createMeshMock = require("../../src/scene-operations/mesh-operations").createMeshFromBrep;
      const mockMesh = new THREE.Mesh();
      createMeshMock.mockReturnValue(mockMesh);

      const compound = createCompoundBrep(1);
      const elements: SceneElement[] = [
        {
          brep: compound,
          nodeId: "compound_1",
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      brepGraph.addNode({ id: "compound_1", brep: compound, mesh: null, connections: [] });
      objectsMap.set("compound_1", new THREE.Group());

      const result = ungroupSelectedElement(
        elements,
        "compound_1",
        10,
        brepGraph,
        objectsMap
      );

      // Get the mesh from objectsMap
      const nodeId = result.updatedElements[0].nodeId;
      const mesh = objectsMap.get(nodeId);
      expect(mesh?.userData.nodeId).toBe(nodeId);
    });
  });
});
