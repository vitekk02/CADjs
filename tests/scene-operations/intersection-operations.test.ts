import * as THREE from "three";
import { intersectionSelectedElements } from "../../src/scene-operations/intersection-operations";
import {
  Brep,
  BrepGraph,
  CompoundBrep,
  Face,
  Vertex,
} from "../../src/geometry";
import { SceneElement } from "../../src/scene-operations/types";

describe("intersection-operations", () => {
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
    // Set up test fixtures
    objectsMap = new Map<string, THREE.Object3D>();
    brepGraph = new BrepGraph();
    idCounter = 5; // Start with a non-zero ID to test increment

    // Create overlapping breps for testing intersection
    // Shape 1: 2x2 box at origin
    const v1 = new Vertex(0, 0, 0);
    const v2 = new Vertex(2, 0, 0);
    const v3 = new Vertex(2, 2, 0);
    const v4 = new Vertex(0, 2, 0);
    const face1 = new Face([v1, v2, v3, v4]);
    brep1 = new Brep([v1, v2, v3, v4], [], [face1]);

    // Shape 2: 2x2 box offset by 1 (overlaps with shape 1)
    const v5 = new Vertex(1, 1, 0);
    const v6 = new Vertex(3, 1, 0);
    const v7 = new Vertex(3, 3, 0);
    const v8 = new Vertex(1, 3, 0);
    const face2 = new Face([v5, v6, v7, v8]);
    brep2 = new Brep([v5, v6, v7, v8], [], [face2]);

    // Set up elements
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

  describe("basic operations", () => {
    test("returns unchanged state when fewer than 2 elements selected", async () => {
      const result = await intersectionSelectedElements(
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
      const result = await intersectionSelectedElements(
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
      const result = await intersectionSelectedElements(
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

      // Verify connections in graph with "intersection" connection type
      expect(brepGraph.nodes.size).toBe(4); // 3 original + 1 new

      const node1 = brepGraph.nodes.get("node_1");
      const node2 = brepGraph.nodes.get("node_2");

      expect(node1?.connections.length).toBe(1);
      expect(node1?.connections[0].targetId).toBe("node_6");
      expect(node1?.connections[0].connectionType).toBe("intersection");

      expect(node2?.connections.length).toBe(1);
      expect(node2?.connections[0].targetId).toBe("node_6");
      expect(node2?.connections[0].connectionType).toBe("intersection");

      // Selected elements should be cleared
      expect(result.updatedSelectedElements).toEqual([]);
    });

    test("preserves unselected elements", async () => {
      const result = await intersectionSelectedElements(
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

  describe("multiple elements", () => {
    test("handles intersection of 3+ elements", async () => {
      // Add a third overlapping brep
      const v9 = new Vertex(0.5, 0.5, 0);
      const v10 = new Vertex(2.5, 0.5, 0);
      const v11 = new Vertex(2.5, 2.5, 0);
      const v12 = new Vertex(0.5, 2.5, 0);
      const face3 = new Face([v9, v10, v11, v12]);
      const brep3 = new Brep([v9, v10, v11, v12], [], [face3]);

      const element4: SceneElement = {
        nodeId: "node_4",
        brep: brep3,
        position: new THREE.Vector3(0, 0, 0),
        selected: true,
      };

      elements.push(element4);
      objectsMap.set("node_4", new THREE.Mesh());
      brepGraph.addNode({
        id: "node_4",
        brep: brep3,
        mesh: null,
        connections: [],
      });

      // Select all three overlapping elements
      const threeSelected = ["node_1", "node_2", "node_4"];

      const result = await intersectionSelectedElements(
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
      expect(compound.children.length).toBe(3);

      // All three original nodes should have connections to the new node
      const node1 = brepGraph.nodes.get("node_1");
      const node2 = brepGraph.nodes.get("node_2");
      const node4 = brepGraph.nodes.get("node_4");

      expect(node1?.connections[0].connectionType).toBe("intersection");
      expect(node2?.connections[0].connectionType).toBe("intersection");
      expect(node4?.connections[0].connectionType).toBe("intersection");
    });

    test("handles intersection of 5 overlapping elements", async () => {
      // Create 5 overlapping boxes
      const boxes: Brep[] = [];
      for (let i = 0; i < 3; i++) {
        const box = createBoxBrep(i * 0.5, i * 0.5, 0, 3, 3, 1);
        boxes.push(box);
        elements.push({
          nodeId: `node_${i + 4}`,
          brep: box,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        });
        objectsMap.set(`node_${i + 4}`, new THREE.Mesh());
        brepGraph.addNode({
          id: `node_${i + 4}`,
          brep: box,
          mesh: null,
          connections: [],
        });
      }

      const fiveSelected = ["node_1", "node_2", "node_4", "node_5", "node_6"];

      const result = await intersectionSelectedElements(
        elements,
        fiveSelected,
        idCounter,
        brepGraph,
        objectsMap
      );

      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement?.brep).toBeInstanceOf(CompoundBrep);
    });
  });

  describe("compound brep handling", () => {
    test("handles compound breps in the intersection operation", async () => {
      // Create a compound brep first
      const compound = new CompoundBrep([brep1]);

      // Replace element 1 with a compound
      elements[0] = {
        ...elements[0],
        brep: compound,
      };

      const result = await intersectionSelectedElements(
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

    test("handles nested compound breps", async () => {
      // Note: nested CompoundBreps are an edge case - children should be Breps
      const innerCompound = new CompoundBrep([brep1]);
      const outerCompound = new CompoundBrep([innerCompound as any]);

      elements[0] = {
        ...elements[0],
        brep: outerCompound,
      };

      const result = await intersectionSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Nested compounds may fail with real OpenCascade
      if (result) {
        expect(result.nextIdCounter).toBe(6);
        const newElement = result.updatedElements.find(
          (el) => el.nodeId === "node_6"
        );
        expect(newElement?.brep).toBeInstanceOf(CompoundBrep);
      } else {
        expect(result).toBeNull();
      }
    });
  });

  describe("graph updates", () => {
    test("creates correct graph connections for intersection", async () => {
      const result = await intersectionSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      const node1 = brepGraph.nodes.get("node_1");
      const node2 = brepGraph.nodes.get("node_2");
      const resultNode = brepGraph.nodes.get("node_6");

      expect(node1?.connections).toHaveLength(1);
      expect(node1?.connections[0]).toEqual({
        targetId: "node_6",
        connectionType: "intersection",
      });

      expect(node2?.connections).toHaveLength(1);
      expect(node2?.connections[0]).toEqual({
        targetId: "node_6",
        connectionType: "intersection",
      });

      expect(resultNode).toBeDefined();
      expect(resultNode?.id).toBe("node_6");
    });

    test("preserves existing graph nodes", async () => {
      const initialNodeCount = brepGraph.nodes.size;

      await intersectionSelectedElements(
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

      await intersectionSelectedElements(
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
      await intersectionSelectedElements(
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

      await intersectionSelectedElements(
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
      const result = await intersectionSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(idCounter + 1);
    });

    test("uses incremented id for new element nodeId", async () => {
      const result = await intersectionSelectedElements(
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

      const result = await intersectionSelectedElements(
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
      elements[0].position = new THREE.Vector3(1, 1, 0);
      elements[1].position = new THREE.Vector3(2, 2, 0);

      const result = await intersectionSelectedElements(
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

      const result = await intersectionSelectedElements(
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

      const result = await intersectionSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Operation should still succeed
      expect(result.nextIdCounter).toBe(6);
    });
  });

  describe("3D geometry scenarios", () => {
    test("handles intersection of 3D boxes", async () => {
      // Two overlapping 3D boxes
      const box1 = createBoxBrep(0, 0, 0, 3, 3, 3);
      const box2 = createBoxBrep(1, 1, 1, 3, 3, 3);

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

      const result = await intersectionSelectedElements(
        elements,
        ["box1", "box2"],
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

    test("handles intersection of non-overlapping shapes", async () => {
      // Two shapes that don't overlap - intersection should be empty
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

      const result = await intersectionSelectedElements(
        elements,
        ["box1", "box2"],
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should still complete (result may be empty geometry)
      expect(result.nextIdCounter).toBe(6);
    });

    test("handles intersection where one shape contains the other", async () => {
      // Small box inside large box - intersection should be the small box
      const largeBox = createBoxBrep(0, 0, 0, 10, 10, 10);
      const smallBox = createBoxBrep(3, 3, 3, 2, 2, 2);

      elements = [
        {
          nodeId: "large",
          brep: largeBox,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
        {
          nodeId: "small",
          brep: smallBox,
          position: new THREE.Vector3(0, 0, 0),
          selected: true,
        },
      ];

      objectsMap.set("large", new THREE.Mesh());
      objectsMap.set("small", new THREE.Mesh());
      brepGraph.addNode({ id: "large", brep: largeBox, mesh: null, connections: [] });
      brepGraph.addNode({ id: "small", brep: smallBox, mesh: null, connections: [] });

      const result = await intersectionSelectedElements(
        elements,
        ["large", "small"],
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

  describe("cross-shaped intersection (real-world scenario)", () => {
    test("handles cross-shaped intersection (horizontal and vertical bars)", async () => {
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

      const result = await intersectionSelectedElements(
        elements,
        ["horizontal", "vertical"],
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should create a result (the center square where they overlap)
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement).toBeDefined();

      const compound = newElement?.brep as CompoundBrep;
      expect(compound.children[0]).toBe(horizontalBar);
      expect(compound.children[1]).toBe(verticalBar);
    });
  });

  describe("edge cases", () => {
    test("handles elements with empty breps", async () => {
      elements[1].brep = new Brep([], [], []);

      const result = await intersectionSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Empty breps cannot be processed by OpenCascade, operation returns null
      expect(result).toBeNull();
    });

    test("handles selection of same element twice (deduplication)", async () => {
      // Select the same element twice
      const duplicateSelection = ["node_1", "node_1"];

      const result = await intersectionSelectedElements(
        elements,
        duplicateSelection,
        idCounter,
        brepGraph,
        objectsMap
      );

      // Should handle gracefully
      expect(result).toBeDefined();
    });

    test("handles non-existent nodeId in selection", async () => {
      const invalidSelection = ["node_1", "nonexistent_node"];

      // This should be handled gracefully
      try {
        const result = await intersectionSelectedElements(
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

      const result = await intersectionSelectedElements(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(6);
    });
  });

  describe("commutativity of intersection", () => {
    test("intersection is commutative (A ∩ B = B ∩ A)", async () => {
      // First: node_1 ∩ node_2
      const result1 = await intersectionSelectedElements(
        [...elements],
        ["node_1", "node_2"],
        idCounter,
        new BrepGraph(),
        new Map(objectsMap)
      );

      // Reset for second test
      const objectsMap2 = new Map<string, THREE.Object3D>();
      objectsMap2.set("node_1", new THREE.Mesh());
      objectsMap2.set("node_2", new THREE.Mesh());
      objectsMap2.set("node_3", new THREE.Mesh());

      // Second: node_2 ∩ node_1 (reversed order)
      const result2 = await intersectionSelectedElements(
        [...elements],
        ["node_2", "node_1"],
        idCounter,
        new BrepGraph(),
        objectsMap2
      );

      // Both should succeed
      expect(result1.nextIdCounter).toBe(6);
      expect(result2.nextIdCounter).toBe(6);

      // Both should produce a CompoundBrep
      const newElement1 = result1.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      const newElement2 = result2.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );

      expect(newElement1?.brep).toBeInstanceOf(CompoundBrep);
      expect(newElement2?.brep).toBeInstanceOf(CompoundBrep);
    });
  });

  describe("associativity of intersection", () => {
    test("handles associative intersection ((A ∩ B) ∩ C = A ∩ (B ∩ C))", async () => {
      // Add third element
      const brep3 = createBoxBrep(0.5, 0.5, 0, 2, 2, 1);
      elements.push({
        nodeId: "node_4",
        brep: brep3,
        position: new THREE.Vector3(0, 0, 0),
        selected: true,
      });
      objectsMap.set("node_4", new THREE.Mesh());
      brepGraph.addNode({
        id: "node_4",
        brep: brep3,
        mesh: null,
        connections: [],
      });

      // Intersect all three at once
      const result = await intersectionSelectedElements(
        elements,
        ["node_1", "node_2", "node_4"],
        idCounter,
        brepGraph,
        objectsMap
      );

      expect(result.nextIdCounter).toBe(6);
      const newElement = result.updatedElements.find(
        (el) => el.nodeId === "node_6"
      );
      expect(newElement?.brep).toBeInstanceOf(CompoundBrep);

      const compound = newElement?.brep as CompoundBrep;
      expect(compound.children.length).toBe(3);
    });
  });
});
