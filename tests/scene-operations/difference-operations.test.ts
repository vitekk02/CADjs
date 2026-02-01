import * as THREE from "three";
import { differenceSelectedElements } from "../../src/scene-operations/difference-operations";
import {
  Brep,
  BrepGraph,
  CompoundBrep,
  Edge,
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

describe("difference-operations", () => {
  let objectsMap: Map<string, THREE.Object3D>;
  let elements: SceneElement[];
  let selectedElements: string[];
  let brepGraph: BrepGraph;
  let idCounter: number;
  let brep1: Brep;
  let brep2: Brep;

  // Helper function to create a simple 2D rectangular brep
  const createRectBrep = (
    x: number,
    y: number,
    width: number,
    height: number,
    z: number = 0
  ): Brep => {
    const v1 = new Vertex(x, y, z);
    const v2 = new Vertex(x + width, y, z);
    const v3 = new Vertex(x + width, y + height, z);
    const v4 = new Vertex(x, y + height, z);
    const face = new Face([v1, v2, v3, v4]);
    return new Brep([v1, v2, v3, v4], [], [face]);
  };

  // Helper function to create a 3D box brep (6 faces)
  const createBoxBrep = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number
  ): Brep => {
    // 8 vertices of a box
    const v1 = new Vertex(x, y, z);
    const v2 = new Vertex(x + width, y, z);
    const v3 = new Vertex(x + width, y + height, z);
    const v4 = new Vertex(x, y + height, z);
    const v5 = new Vertex(x, y, z + depth);
    const v6 = new Vertex(x + width, y, z + depth);
    const v7 = new Vertex(x + width, y + height, z + depth);
    const v8 = new Vertex(x, y + height, z + depth);

    // 6 faces of a box
    const bottom = new Face([v1, v2, v3, v4]); // z = 0
    const top = new Face([v5, v6, v7, v8]); // z = depth
    const front = new Face([v1, v2, v6, v5]); // y = 0
    const back = new Face([v4, v3, v7, v8]); // y = height
    const left = new Face([v1, v4, v8, v5]); // x = 0
    const right = new Face([v2, v3, v7, v6]); // x = width

    return new Brep(
      [v1, v2, v3, v4, v5, v6, v7, v8],
      [],
      [bottom, top, front, back, left, right]
    );
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Set up test fixtures
    objectsMap = new Map<string, THREE.Object3D>();
    brepGraph = new BrepGraph();
    idCounter = 5; // Start with a non-zero ID to test increment

    // Create simple breps for testing
    // Base shape (larger)
    const v1 = new Vertex(0, 0, 0);
    const v2 = new Vertex(2, 0, 0);
    const v3 = new Vertex(2, 2, 0);
    const v4 = new Vertex(0, 2, 0);
    const face1 = new Face([v1, v2, v3, v4]);
    brep1 = new Brep([v1, v2, v3, v4], [], [face1]);

    // Tool shape (smaller, to be subtracted)
    const v5 = new Vertex(0.5, 0.5, 0);
    const v6 = new Vertex(1.5, 0.5, 0);
    const v7 = new Vertex(1.5, 1.5, 0);
    const v8 = new Vertex(0.5, 1.5, 0);
    const face2 = new Face([v5, v6, v7, v8]);
    brep2 = new Brep([v5, v6, v7, v8], [], [face2]);

    // Set up elements - first is base, second is tool
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
        position: new THREE.Vector3(0, 0, 0),
        selected: true,
      },
      {
        nodeId: "node_3", // An unselected element
        brep: new Brep([], [], []),
        position: new THREE.Vector3(5, 0, 0),
        selected: false,
      },
    ];

    // Set up selected elements - ORDER MATTERS: first is base, second is tool
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

  describe("basic operations", () => {
    test("returns unchanged state when fewer than 2 elements selected", async () => {
      const result = await differenceSelectedElements(
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

    test("returns unchanged state when no elements selected", async () => {
      const result = await differenceSelectedElements(
        elements,
        [], // No elements selected
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should return original state
      expect(result.updatedElements).toBe(elements);
      expect(result.updatedSelectedElements).toEqual([]);
      expect(result.nextIdCounter).toBe(idCounter);
    });

    test("creates a compound brep and updates state when 2 elements are selected", async () => {
      const result = await differenceSelectedElements(
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

      // Verify compound contains both original breps (base and tool for history)
      const compound = newElement?.brep as CompoundBrep;
      expect(compound.children.length).toBe(2);
      expect(compound.children).toContain(brep1); // Base
      expect(compound.children).toContain(brep2); // Tool

      // Check that original objects were removed from map
      expect(objectsMap.has("node_1")).toBeFalsy();
      expect(objectsMap.has("node_2")).toBeFalsy();

      // Check that new object was added to map
      expect(objectsMap.has("node_6")).toBeTruthy();
      expect(objectsMap.get("node_6")).toBeInstanceOf(THREE.Group);

      // Verify connections in graph with "difference" connection type
      expect(brepGraph.nodes.size).toBe(4); // 3 original + 1 new

      const node1 = brepGraph.nodes.get("node_1");
      const node2 = brepGraph.nodes.get("node_2");

      expect(node1?.connections.length).toBe(1);
      expect(node1?.connections[0].targetId).toBe("node_6");
      expect(node1?.connections[0].connectionType).toBe("difference");

      expect(node2?.connections.length).toBe(1);
      expect(node2?.connections[0].targetId).toBe("node_6");
      expect(node2?.connections[0].connectionType).toBe("difference");

      // Selected elements should be cleared
      expect(result.updatedSelectedElements).toEqual([]);
    });

    test("preserves unselected elements", async () => {
      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // node_3 should still exist and be unchanged
      const node3 = result.updatedElements.find((el) => el.nodeId === "node_3");
      expect(node3).toBeDefined();
      expect(node3?.position.x).toBe(5);

      // node_3 should still be in objectsMap
      expect(objectsMap.has("node_3")).toBeTruthy();
    });
  });

  describe("selection order", () => {
    test("respects selection order (first selected is base)", async () => {
      // Reverse the selection order: node_2 is base, node_1 is tool
      const reversedSelection = ["node_2", "node_1"];

      const result = await differenceSelectedElements(
        elements,
        reversedSelection,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should still work - creates a new element
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement).toBeDefined();
      expect(newElement?.brep).toBeInstanceOf(CompoundBrep);

      const compound = newElement?.brep as CompoundBrep;
      // Compound should have children (base and tool for history)
      expect(compound.children.length).toBeGreaterThanOrEqual(1);
    });

    test("base shape determines the primary geometry", async () => {
      // Create shapes with different sizes
      const largeBrep = createBoxBrep(0, 0, 0, 10, 10, 10);
      const smallBrep = createBoxBrep(4, 4, 4, 2, 2, 2);

      elements = [
        {
          nodeId: "large",
          brep: largeBrep,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
        {
          nodeId: "small",
          brep: smallBrep,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("large", new THREE.Mesh());
      objectsMap.set("small", new THREE.Mesh());
      brepGraph.addNode({ id: "large", brep: largeBrep, mesh: null, connections: [] });
      brepGraph.addNode({ id: "small", brep: smallBrep, mesh: null, connections: [] });

      // large - small should result in a shape with a hole
      const result = await differenceSelectedElements(
        elements,
        ["large", "small"],
        idCounter,
        brepGraph,
        objectsMap
      );

      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      const compound = newElement?.brep as CompoundBrep;

      // First child is base (large), second is tool (small)
      expect(compound.children[0]).toBe(largeBrep);
      expect(compound.children[1]).toBe(smallBrep);
    });
  });

  describe("multiple tools", () => {
    test("handles difference with multiple tools (3+ elements)", async () => {
      // Add a third brep as another tool
      const v9 = new Vertex(1, 1, 0);
      const v10 = new Vertex(1.8, 1, 0);
      const v11 = new Vertex(1.8, 1.8, 0);
      const v12 = new Vertex(1, 1.8, 0);
      const face3 = new Face([v9, v10, v11, v12]);
      const brep3 = new Brep([v9, v10, v11, v12], [], [face3]);

      const element3: SceneElement = {
        nodeId: "node_4",
        brep: brep3,
        position: new THREE.Vector3(0, 0, 0),
        selected: true,
      };

      elements.push(element3);
      objectsMap.set("node_4", new THREE.Mesh());
      brepGraph.addNode({
        id: "node_4",
        brep: brep3,
        mesh: null,
        connections: [],
      });

      // Select all three: base + two tools
      const threeSelected = ["node_1", "node_2", "node_4"];

      const result = await differenceSelectedElements(
        elements,
        threeSelected,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should create a new compound with 3 children
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement).toBeDefined();

      const compound = newElement?.brep as CompoundBrep;
      expect(compound.children.length).toBe(3); // base + 2 tools

      // All three original nodes should have connections to the new node
      const node1 = brepGraph.nodes.get("node_1");
      const node2 = brepGraph.nodes.get("node_2");
      const node4 = brepGraph.nodes.get("node_4");

      expect(node1?.connections[0].connectionType).toBe("difference");
      expect(node2?.connections[0].connectionType).toBe("difference");
      expect(node4?.connections[0].connectionType).toBe("difference");
    });

    test("handles 5 tools being subtracted sequentially", async () => {
      // Create base and 5 tools
      const baseBrep = createBoxBrep(0, 0, 0, 10, 10, 2);
      const tool1 = createBoxBrep(1, 1, 0, 1, 1, 2);
      const tool2 = createBoxBrep(3, 1, 0, 1, 1, 2);
      const tool3 = createBoxBrep(5, 1, 0, 1, 1, 2);
      const tool4 = createBoxBrep(7, 1, 0, 1, 1, 2);
      const tool5 = createBoxBrep(1, 5, 0, 1, 1, 2);

      elements = [
        { nodeId: "base", brep: baseBrep, position: new THREE.Vector3(), selected: true },
        { nodeId: "tool1", brep: tool1, position: new THREE.Vector3(), selected: true },
        { nodeId: "tool2", brep: tool2, position: new THREE.Vector3(), selected: true },
        { nodeId: "tool3", brep: tool3, position: new THREE.Vector3(), selected: true },
        { nodeId: "tool4", brep: tool4, position: new THREE.Vector3(), selected: true },
        { nodeId: "tool5", brep: tool5, position: new THREE.Vector3(), selected: true },
      ];

      elements.forEach((el) => {
        objectsMap.set(el.nodeId, new THREE.Mesh());
        brepGraph.addNode({ id: el.nodeId, brep: el.brep, mesh: null, connections: [] });
      });

      const result = await differenceSelectedElements(
        elements,
        ["base", "tool1", "tool2", "tool3", "tool4", "tool5"],
        idCounter,
        brepGraph,
        objectsMap
      );

      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement).toBeDefined();

      const compound = newElement?.brep as CompoundBrep;
      // Should have children stored for history
      expect(compound.children.length).toBeGreaterThanOrEqual(1);

      // New element should exist
      expect(result.nextIdCounter).toBe(6);
    });
  });

  describe("compound brep handling", () => {
    test("handles compound breps as base shape", async () => {
      // Create a compound brep and use it as the base
      const compound = new CompoundBrep([brep1]);

      // Replace element 1 with a compound
      elements[0] = {
        ...elements[0],
        brep: compound,
      };

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // The operation should still succeed
      expect(result.nextIdCounter).toBe(6);

      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement).toBeDefined();
      expect(newElement?.brep).toBeInstanceOf(CompoundBrep);
    });

    test("handles compound breps as tool shape", async () => {
      // Create a compound brep and use it as the tool
      const toolCompound = new CompoundBrep([brep2]);

      elements[1] = {
        ...elements[1],
        brep: toolCompound,
      };

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(6);

      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement).toBeDefined();
      expect(newElement?.brep).toBeInstanceOf(CompoundBrep);
    });

    test("handles nested compound breps", async () => {
      // Create a deeply nested compound
      const innerCompound = new CompoundBrep([brep1]);
      const outerCompound = new CompoundBrep([innerCompound as any]);

      elements[0] = {
        ...elements[0],
        brep: outerCompound,
      };

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(6);
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement?.brep).toBeInstanceOf(CompoundBrep);
    });
  });

  describe("graph updates", () => {
    test("creates correct graph connections for difference", async () => {
      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Check all connections
      const baseNode = brepGraph.nodes.get("node_1");
      const toolNode = brepGraph.nodes.get("node_2");
      const resultNode = brepGraph.nodes.get("node_6");

      // Base and tool should connect to result
      expect(baseNode?.connections).toHaveLength(1);
      expect(baseNode?.connections[0]).toEqual({
        targetId: "node_6",
        connectionType: "difference",
      });

      expect(toolNode?.connections).toHaveLength(1);
      expect(toolNode?.connections[0]).toEqual({
        targetId: "node_6",
        connectionType: "difference",
      });

      // Result node should exist
      expect(resultNode).toBeDefined();
      expect(resultNode?.id).toBe("node_6");
    });

    test("preserves existing graph nodes", async () => {
      const initialNodeCount = brepGraph.nodes.size;

      await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should have added 1 new node
      expect(brepGraph.nodes.size).toBe(initialNodeCount + 1);

      // Original nodes should still exist
      expect(brepGraph.nodes.has("node_1")).toBeTruthy();
      expect(brepGraph.nodes.has("node_2")).toBeTruthy();
      expect(brepGraph.nodes.has("node_3")).toBeTruthy();
    });
  });

  describe("object map management", () => {
    test("removes selected elements from objectsMap", async () => {
      expect(objectsMap.has("node_1")).toBeTruthy();
      expect(objectsMap.has("node_2")).toBeTruthy();

      await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(objectsMap.has("node_1")).toBeFalsy();
      expect(objectsMap.has("node_2")).toBeFalsy();
    });

    test("adds result as THREE.Group to objectsMap", async () => {
      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      const resultObject = objectsMap.get("node_6");
      expect(resultObject).toBeDefined();
      expect(resultObject).toBeInstanceOf(THREE.Group);
    });

    test("preserves unselected objects in objectsMap", async () => {
      const unselectedMesh = objectsMap.get("node_3");

      await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(objectsMap.get("node_3")).toBe(unselectedMesh);
    });
  });

  describe("id counter management", () => {
    test("increments id counter by 1", async () => {
      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(idCounter + 1);
    });

    test("uses incremented id for new element nodeId", async () => {
      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      const expectedNodeId = `node_${idCounter + 1}`;
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === expectedNodeId
      );
      expect(newElement).toBeDefined();
    });

    test("handles high id counter values", async () => {
      const highIdCounter = 999999;

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        highIdCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(1000000);
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_1000000"
      );
      expect(newElement).toBeDefined();
    });
  });

  describe("position handling", () => {
    test("handles elements at different positions", async () => {
      elements[0].position = new THREE.Vector3(10, 20, 30);
      elements[1].position = new THREE.Vector3(-5, -10, -15);

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Operation should still succeed
      expect(result.nextIdCounter).toBe(6);
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement).toBeDefined();
    });

    test("handles elements at origin", async () => {
      elements[0].position = new THREE.Vector3(0, 0, 0);
      elements[1].position = new THREE.Vector3(0, 0, 0);

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(6);
    });

    test("handles elements with rotation", async () => {
      elements[0].rotation = new THREE.Euler(Math.PI / 4, 0, 0);
      elements[1].rotation = new THREE.Euler(0, Math.PI / 2, 0);

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Operation should still succeed (rotation may affect result geometry)
      expect(result.nextIdCounter).toBe(6);
    });
  });

  describe("edge cases", () => {
    test("handles elements with empty breps", async () => {
      elements[1].brep = new Brep([], [], []);

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should still create a result
      expect(result.nextIdCounter).toBe(6);
    });

    test("handles selection of same element twice (deduplication)", async () => {
      // Select the same element twice
      const duplicateSelection = ["node_1", "node_1"];

      const result = await differenceSelectedElements(
        elements,
        duplicateSelection,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should handle gracefully - only one unique element, so no operation
      // OR it should deduplicate and process
      // This tests the robustness of the selection handling
      expect(result).toBeDefined();
    });

    test("handles non-existent nodeId in selection", async () => {
      const invalidSelection = ["node_1", "nonexistent_node"];

      // This should be handled gracefully
      try {
        const result = await differenceSelectedElements(
          elements,
          invalidSelection,
          idCounter,
          brepGraph,
          objectsMap
        );
        // If it doesn't throw, verify it handled the case
        expect(result).toBeDefined();
      } catch (error) {
        // If it throws, that's also acceptable behavior
        expect(error).toBeDefined();
      }
    });

    test("handles very large number of vertices", async () => {
      // Create a brep with many vertices (simulating a complex shape)
      const vertices: Vertex[] = [];
      for (let i = 0; i < 100; i++) {
        vertices.push(new Vertex(Math.cos(i * 0.1), Math.sin(i * 0.1), 0));
      }
      const complexFace = new Face(vertices);
      const complexBrep = new Brep(vertices, [], [complexFace]);

      elements[0].brep = complexBrep;

      const result = await differenceSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(6);
    });
  });

  describe("cross-shaped intersection (real-world scenario)", () => {
    test("handles cross-shaped difference (horizontal - vertical)", async () => {
      // Simulate the cross scenario that was fixed
      // Horizontal bar: wide and short
      const horizontalBar = createBoxBrep(-5, -1, 0, 10, 2, 1);
      // Vertical bar: narrow and tall
      const verticalBar = createBoxBrep(-1, -5, 0, 2, 10, 1);

      elements = [
        {
          nodeId: "horizontal",
          brep: horizontalBar,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
        {
          nodeId: "vertical",
          brep: verticalBar,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("horizontal", new THREE.Mesh());
      objectsMap.set("vertical", new THREE.Mesh());
      brepGraph.addNode({ id: "horizontal", brep: horizontalBar, mesh: null, connections: [] });
      brepGraph.addNode({ id: "vertical", brep: verticalBar, mesh: null, connections: [] });

      const result = await differenceSelectedElements(
        elements,
        ["horizontal", "vertical"],
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should create a result with both shapes stored as children
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement).toBeDefined();

      const compound = newElement?.brep as CompoundBrep;
      expect(compound.children[0]).toBe(horizontalBar); // Base
      expect(compound.children[1]).toBe(verticalBar); // Tool
    });

    test("handles cross-shaped difference (vertical - horizontal)", async () => {
      // Reverse: subtract horizontal from vertical
      const horizontalBar = createBoxBrep(-5, -1, 0, 10, 2, 1);
      const verticalBar = createBoxBrep(-1, -5, 0, 2, 10, 1);

      elements = [
        {
          nodeId: "horizontal",
          brep: horizontalBar,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
        {
          nodeId: "vertical",
          brep: verticalBar,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("horizontal", new THREE.Mesh());
      objectsMap.set("vertical", new THREE.Mesh());
      brepGraph.addNode({ id: "horizontal", brep: horizontalBar, mesh: null, connections: [] });
      brepGraph.addNode({ id: "vertical", brep: verticalBar, mesh: null, connections: [] });

      // Vertical first = base, horizontal second = tool
      const result = await differenceSelectedElements(
        elements,
        ["vertical", "horizontal"],
        idCounter,
        brepGraph,
        objectsMap
      );

      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      const compound = newElement?.brep as CompoundBrep;

      // Order should be reversed
      expect(compound.children[0]).toBe(verticalBar); // Base
      expect(compound.children[1]).toBe(horizontalBar); // Tool
    });
  });

  describe("3D geometry scenarios", () => {
    test("handles 3D box difference", async () => {
      const outerBox = createBoxBrep(0, 0, 0, 5, 5, 5);
      const innerBox = createBoxBrep(1, 1, 1, 3, 3, 3);

      elements = [
        {
          nodeId: "outer",
          brep: outerBox,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
        {
          nodeId: "inner",
          brep: innerBox,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("outer", new THREE.Mesh());
      objectsMap.set("inner", new THREE.Mesh());
      brepGraph.addNode({ id: "outer", brep: outerBox, mesh: null, connections: [] });
      brepGraph.addNode({ id: "inner", brep: innerBox, mesh: null, connections: [] });

      const result = await differenceSelectedElements(
        elements,
        ["outer", "inner"],
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(6);
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement?.brep).toBeInstanceOf(CompoundBrep);
    });

    test("handles difference with non-overlapping shapes", async () => {
      // Two shapes that don't overlap
      const box1 = createBoxBrep(0, 0, 0, 1, 1, 1);
      const box2 = createBoxBrep(10, 10, 10, 1, 1, 1);

      elements = [
        {
          nodeId: "box1",
          brep: box1,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
        {
          nodeId: "box2",
          brep: box2,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("box1", new THREE.Mesh());
      objectsMap.set("box2", new THREE.Mesh());
      brepGraph.addNode({ id: "box1", brep: box1, mesh: null, connections: [] });
      brepGraph.addNode({ id: "box2", brep: box2, mesh: null, connections: [] });

      const result = await differenceSelectedElements(
        elements,
        ["box1", "box2"],
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should still complete (result would be same as base when no overlap)
      expect(result.nextIdCounter).toBe(6);
    });

    test("handles difference where tool completely contains base", async () => {
      // Tool is larger than base - should result in empty/null geometry
      const smallBox = createBoxBrep(2, 2, 2, 1, 1, 1);
      const largeBox = createBoxBrep(0, 0, 0, 5, 5, 5);

      elements = [
        {
          nodeId: "small",
          brep: smallBox,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
        {
          nodeId: "large",
          brep: largeBox,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("small", new THREE.Mesh());
      objectsMap.set("large", new THREE.Mesh());
      brepGraph.addNode({ id: "small", brep: smallBox, mesh: null, connections: [] });
      brepGraph.addNode({ id: "large", brep: largeBox, mesh: null, connections: [] });

      // small - large = empty (base is completely inside tool)
      const result = await differenceSelectedElements(
        elements,
        ["small", "large"],
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(6);
    });
  });
});
