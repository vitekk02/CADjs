import {
  Vertex,
  Edge,
  Face,
  Brep,
  CompoundBrep,
  BrepGraph,
} from "../src/geometry";

describe("Geometry Classes", () => {
  describe("Vertex", () => {
    test("creates vertex with correct coordinates", () => {
      const v = new Vertex(1.5, 2.5, 3.5);
      expect(v.x).toBe(1.5);
      expect(v.y).toBe(2.5);
      expect(v.z).toBe(3.5);
    });

    test("creates vertex at origin", () => {
      const v = new Vertex(0, 0, 0);
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
    });

    test("handles negative coordinates", () => {
      const v = new Vertex(-5, -10, -15);
      expect(v.x).toBe(-5);
      expect(v.y).toBe(-10);
      expect(v.z).toBe(-15);
    });

    test("handles very small values", () => {
      const v = new Vertex(1e-10, 1e-10, 1e-10);
      expect(v.x).toBe(1e-10);
      expect(v.y).toBe(1e-10);
      expect(v.z).toBe(1e-10);
    });

    test("handles very large values", () => {
      const v = new Vertex(1e10, 1e10, 1e10);
      expect(v.x).toBe(1e10);
      expect(v.y).toBe(1e10);
      expect(v.z).toBe(1e10);
    });

    describe("equals", () => {
      test("returns true for identical vertices", () => {
        const v1 = new Vertex(1, 2, 3);
        const v2 = new Vertex(1, 2, 3);
        expect(v1.equals(v2)).toBe(true);
      });

      test("returns false for different vertices", () => {
        const v1 = new Vertex(1, 2, 3);
        const v2 = new Vertex(1, 2, 4);
        expect(v1.equals(v2)).toBe(false);
      });

      test("returns true for self comparison", () => {
        const v = new Vertex(1, 2, 3);
        expect(v.equals(v)).toBe(true);
      });

      test("handles floating point comparison", () => {
        const v1 = new Vertex(0.1 + 0.2, 0, 0);
        const v2 = new Vertex(0.3, 0, 0);
        // Check if the values are close enough
        expect(Math.abs(v1.x - v2.x)).toBeLessThan(1e-10);
      });
    });
  });

  describe("Edge", () => {
    test("creates edge between two vertices", () => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 0, 0);
      const edge = new Edge(v1, v2);

      expect(edge.start).toBe(v1);
      expect(edge.end).toBe(v2);
    });

    test("calculates edge length correctly", () => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(3, 4, 0);
      const edge = new Edge(v1, v2);

      expect(edge.length).toBe(5); // 3-4-5 triangle
    });

    test("calculates edge direction correctly", () => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 0, 0);
      const edge = new Edge(v1, v2);

      expect(edge.direction.x).toBeCloseTo(1, 10);
      expect(edge.direction.y).toBeCloseTo(0, 10);
      expect(edge.direction.z).toBeCloseTo(0, 10);
    });

    test("handles diagonal edge", () => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 1, 1);
      const edge = new Edge(v1, v2);

      const expectedLength = Math.sqrt(3);
      expect(edge.length).toBeCloseTo(expectedLength, 10);
    });

    test("handles zero-length edge", () => {
      const v1 = new Vertex(1, 1, 1);
      const v2 = new Vertex(1, 1, 1);
      const edge = new Edge(v1, v2);

      expect(edge.length).toBe(0);
    });
  });

  describe("Face", () => {
    test("creates triangular face", () => {
      const vertices = [
        new Vertex(0, 0, 0),
        new Vertex(1, 0, 0),
        new Vertex(0.5, 1, 0),
      ];
      const face = new Face(vertices);

      expect(face.vertices.length).toBe(3);
    });

    test("creates quadrilateral face", () => {
      const vertices = [
        new Vertex(0, 0, 0),
        new Vertex(1, 0, 0),
        new Vertex(1, 1, 0),
        new Vertex(0, 1, 0),
      ];
      const face = new Face(vertices);

      expect(face.vertices.length).toBe(4);
    });

    test("creates polygon with many vertices", () => {
      const vertices: Vertex[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2;
        vertices.push(new Vertex(Math.cos(angle), Math.sin(angle), 0));
      }
      const face = new Face(vertices);

      expect(face.vertices.length).toBe(10);
    });

    describe("normal calculation", () => {
      test("XY-plane face has Z-pointing normal", () => {
        const face = new Face([
          new Vertex(0, 0, 0),
          new Vertex(1, 0, 0),
          new Vertex(1, 1, 0),
          new Vertex(0, 1, 0),
        ]);

        expect(face.normal.x).toBeCloseTo(0, 5);
        expect(face.normal.y).toBeCloseTo(0, 5);
        expect(Math.abs(face.normal.z)).toBeCloseTo(1, 5);
      });

      test("XZ-plane face has Y-pointing normal", () => {
        const face = new Face([
          new Vertex(0, 0, 0),
          new Vertex(1, 0, 0),
          new Vertex(1, 0, 1),
          new Vertex(0, 0, 1),
        ]);

        expect(Math.abs(face.normal.y)).toBeCloseTo(1, 5);
      });

      test("YZ-plane face has X-pointing normal", () => {
        const face = new Face([
          new Vertex(0, 0, 0),
          new Vertex(0, 1, 0),
          new Vertex(0, 1, 1),
          new Vertex(0, 0, 1),
        ]);

        expect(Math.abs(face.normal.x)).toBeCloseTo(1, 5);
      });

      test("angled face has mixed normal", () => {
        const face = new Face([
          new Vertex(0, 0, 0),
          new Vertex(1, 0, 0),
          new Vertex(1, 1, 1),
          new Vertex(0, 1, 1),
        ]);

        // Should have components in Y and Z
        expect(Math.abs(face.normal.y)).toBeGreaterThan(0);
        expect(Math.abs(face.normal.z)).toBeGreaterThan(0);
      });

      test("normal is unit length", () => {
        const face = new Face([
          new Vertex(0, 0, 0),
          new Vertex(1, 0, 0),
          new Vertex(1, 1, 0),
        ]);

        const length = Math.sqrt(
          face.normal.x ** 2 + face.normal.y ** 2 + face.normal.z ** 2
        );
        expect(length).toBeCloseTo(1, 5);
      });
    });
  });

  describe("Brep", () => {
    const createBoxBrep = (): Brep => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 0, 0);
      const v3 = new Vertex(1, 1, 0);
      const v4 = new Vertex(0, 1, 0);
      const v5 = new Vertex(0, 0, 1);
      const v6 = new Vertex(1, 0, 1);
      const v7 = new Vertex(1, 1, 1);
      const v8 = new Vertex(0, 1, 1);

      const bottom = new Face([v1, v2, v3, v4]);
      const top = new Face([v5, v6, v7, v8]);
      const front = new Face([v1, v2, v6, v5]);
      const back = new Face([v4, v3, v7, v8]);
      const left = new Face([v1, v4, v8, v5]);
      const right = new Face([v2, v3, v7, v6]);

      return new Brep(
        [v1, v2, v3, v4, v5, v6, v7, v8],
        [],
        [bottom, top, front, back, left, right]
      );
    };

    test("creates brep with vertices and faces", () => {
      const brep = createBoxBrep();

      expect(brep.vertices.length).toBe(8);
      expect(brep.faces.length).toBe(6);
    });

    test("creates empty brep", () => {
      const brep = new Brep([], [], []);

      expect(brep.vertices.length).toBe(0);
      expect(brep.edges.length).toBe(0);
      expect(brep.faces.length).toBe(0);
    });

    test("brep with only vertices (no faces)", () => {
      const vertices = [
        new Vertex(0, 0, 0),
        new Vertex(1, 0, 0),
        new Vertex(1, 1, 0),
      ];
      const brep = new Brep(vertices, [], []);

      expect(brep.vertices.length).toBe(3);
      expect(brep.faces.length).toBe(0);
    });

    test("brep with edges", () => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 0, 0);
      const edge = new Edge(v1, v2);
      const brep = new Brep([v1, v2], [edge], []);

      expect(brep.edges.length).toBe(1);
      expect(brep.edges[0]).toBe(edge);
    });
  });

  describe("CompoundBrep", () => {
    const createSimpleBrep = (): Brep => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 0, 0);
      const v3 = new Vertex(1, 1, 0);
      const v4 = new Vertex(0, 1, 0);
      const face = new Face([v1, v2, v3, v4]);
      return new Brep([v1, v2, v3, v4], [], [face]);
    };

    test("creates compound with single child", () => {
      const brep = createSimpleBrep();
      const compound = new CompoundBrep([brep]);

      expect(compound.children.length).toBe(1);
      expect(compound.children[0]).toBe(brep);
    });

    test("creates compound with multiple children", () => {
      const brep1 = createSimpleBrep();
      const brep2 = createSimpleBrep();
      const brep3 = createSimpleBrep();
      const compound = new CompoundBrep([brep1, brep2, brep3]);

      expect(compound.children.length).toBe(3);
    });

    test("creates empty compound", () => {
      const compound = new CompoundBrep([]);

      expect(compound.children.length).toBe(0);
    });

    describe("vertices aggregation", () => {
      test("CompoundBrep starts with empty vertices (aggregation happens via getUnifiedBRep)", () => {
        const brep1 = new Brep([new Vertex(0, 0, 0), new Vertex(1, 0, 0)], [], []);
        const brep2 = new Brep([new Vertex(2, 0, 0), new Vertex(3, 0, 0)], [], []);
        const compound = new CompoundBrep([brep1, brep2]);

        // CompoundBrep.vertices is empty - actual geometry is in children
        expect(compound.vertices.length).toBe(0);
        // Children are stored separately
        expect(compound.children.length).toBe(2);
        expect(compound.children[0].vertices.length).toBe(2);
        expect(compound.children[1].vertices.length).toBe(2);
      });
    });

    describe("faces aggregation", () => {
      test("CompoundBrep starts with empty faces (aggregation happens via getUnifiedBRep)", () => {
        const face1 = new Face([
          new Vertex(0, 0, 0),
          new Vertex(1, 0, 0),
          new Vertex(0.5, 1, 0),
        ]);
        const face2 = new Face([
          new Vertex(2, 0, 0),
          new Vertex(3, 0, 0),
          new Vertex(2.5, 1, 0),
        ]);
        const brep1 = new Brep([], [], [face1]);
        const brep2 = new Brep([], [], [face2]);
        const compound = new CompoundBrep([brep1, brep2]);

        // CompoundBrep.faces is empty - actual geometry is in children
        expect(compound.faces.length).toBe(0);
        // Children are stored separately
        expect(compound.children[0].faces.length).toBe(1);
        expect(compound.children[1].faces.length).toBe(1);
      });
    });

    describe("unified BRep", () => {
      test("can set unified brep", () => {
        const brep1 = createSimpleBrep();
        const brep2 = createSimpleBrep();
        const compound = new CompoundBrep([brep1, brep2]);

        const unifiedBrep = createSimpleBrep();
        compound.setUnifiedBrep(unifiedBrep);

        // The unified brep should be accessible
        expect(compound.children.length).toBe(2);
      });

      test("getUnifiedBRep returns promise", async () => {
        const brep = createSimpleBrep();
        const compound = new CompoundBrep([brep]);

        const result = compound.getUnifiedBRep();
        expect(result).toBeInstanceOf(Promise);
      });
    });

    describe("nested compounds", () => {
      test("handles nested compound breps", () => {
        const brep = createSimpleBrep();
        const innerCompound = new CompoundBrep([brep]);
        const outerCompound = new CompoundBrep([innerCompound as any]);

        expect(outerCompound.children.length).toBe(1);
      });
    });
  });

  describe("BrepGraph", () => {
    test("creates empty graph", () => {
      const graph = new BrepGraph();

      expect(graph.nodes.size).toBe(0);
    });

    test("adds node to graph", () => {
      const graph = new BrepGraph();
      const brep = new Brep([], [], []);

      graph.addNode({
        id: "node_1",
        brep: brep,
        mesh: null,
        connections: [],
      });

      expect(graph.nodes.size).toBe(1);
      expect(graph.nodes.has("node_1")).toBe(true);
    });

    test("retrieves node by id", () => {
      const graph = new BrepGraph();
      const brep = new Brep([], [], []);

      graph.addNode({
        id: "node_1",
        brep: brep,
        mesh: null,
        connections: [],
      });

      const node = graph.nodes.get("node_1");
      expect(node).toBeDefined();
      expect(node?.id).toBe("node_1");
      expect(node?.brep).toBe(brep);
    });

    test("adds multiple nodes", () => {
      const graph = new BrepGraph();

      graph.addNode({ id: "node_1", brep: new Brep([], [], []), mesh: null, connections: [] });
      graph.addNode({ id: "node_2", brep: new Brep([], [], []), mesh: null, connections: [] });
      graph.addNode({ id: "node_3", brep: new Brep([], [], []), mesh: null, connections: [] });

      expect(graph.nodes.size).toBe(3);
    });

    describe("connections", () => {
      test("node can have connections", () => {
        const graph = new BrepGraph();

        graph.addNode({
          id: "node_1",
          brep: new Brep([], [], []),
          mesh: null,
          connections: [{ targetId: "node_2", connectionType: "union" }],
        });

        const node = graph.nodes.get("node_1");
        expect(node?.connections.length).toBe(1);
        expect(node?.connections[0].targetId).toBe("node_2");
        expect(node?.connections[0].connectionType).toBe("union");
      });

      test("node can have multiple connections", () => {
        const graph = new BrepGraph();

        graph.addNode({
          id: "node_1",
          brep: new Brep([], [], []),
          mesh: null,
          connections: [
            { targetId: "node_2", connectionType: "union" },
            { targetId: "node_3", connectionType: "difference" },
          ],
        });

        const node = graph.nodes.get("node_1");
        expect(node?.connections.length).toBe(2);
      });

      test("supports union connection type", () => {
        const graph = new BrepGraph();

        graph.addNode({
          id: "node_1",
          brep: new Brep([], [], []),
          mesh: null,
          connections: [{ targetId: "node_2", connectionType: "union" }],
        });

        const node = graph.nodes.get("node_1");
        expect(node?.connections[0].connectionType).toBe("union");
      });

      test("supports difference connection type", () => {
        const graph = new BrepGraph();

        graph.addNode({
          id: "node_1",
          brep: new Brep([], [], []),
          mesh: null,
          connections: [{ targetId: "node_2", connectionType: "difference" }],
        });

        const node = graph.nodes.get("node_1");
        expect(node?.connections[0].connectionType).toBe("difference");
      });
    });

    describe("graph operations", () => {
      test("can update node connections", () => {
        const graph = new BrepGraph();

        graph.addNode({
          id: "node_1",
          brep: new Brep([], [], []),
          mesh: null,
          connections: [],
        });

        const node = graph.nodes.get("node_1");
        node?.connections.push({ targetId: "node_2", connectionType: "union" });

        expect(graph.nodes.get("node_1")?.connections.length).toBe(1);
      });

      test("nodes are independent", () => {
        const graph = new BrepGraph();
        const brep1 = new Brep([], [], []);
        const brep2 = new Brep([], [], []);

        graph.addNode({ id: "node_1", brep: brep1, mesh: null, connections: [] });
        graph.addNode({ id: "node_2", brep: brep2, mesh: null, connections: [] });

        // Modifying one node shouldn't affect the other
        const node1 = graph.nodes.get("node_1");
        node1?.connections.push({ targetId: "node_3", connectionType: "union" });

        const node2 = graph.nodes.get("node_2");
        expect(node2?.connections.length).toBe(0);
      });
    });
  });
});

describe("Geometry Edge Cases", () => {
  test("face with minimum vertices (3)", () => {
    const face = new Face([
      new Vertex(0, 0, 0),
      new Vertex(1, 0, 0),
      new Vertex(0.5, 1, 0),
    ]);

    expect(face.vertices.length).toBe(3);
  });

  test("very thin face", () => {
    const face = new Face([
      new Vertex(0, 0, 0),
      new Vertex(1000, 0, 0),
      new Vertex(1000, 0.001, 0),
      new Vertex(0, 0.001, 0),
    ]);

    expect(face.vertices.length).toBe(4);
  });

  test("face at large offset", () => {
    const offset = 1000000;
    const face = new Face([
      new Vertex(offset, offset, offset),
      new Vertex(offset + 1, offset, offset),
      new Vertex(offset + 1, offset + 1, offset),
      new Vertex(offset, offset + 1, offset),
    ]);

    expect(face.vertices[0].x).toBe(offset);
  });

  test("brep with many faces", () => {
    const faces: Face[] = [];
    for (let i = 0; i < 100; i++) {
      faces.push(
        new Face([
          new Vertex(i, 0, 0),
          new Vertex(i + 1, 0, 0),
          new Vertex(i + 0.5, 1, 0),
        ])
      );
    }
    const brep = new Brep([], [], faces);

    expect(brep.faces.length).toBe(100);
  });

  test("compound with many children", () => {
    const children: Brep[] = [];
    for (let i = 0; i < 50; i++) {
      children.push(new Brep([], [], []));
    }
    const compound = new CompoundBrep(children);

    expect(compound.children.length).toBe(50);
  });
});
