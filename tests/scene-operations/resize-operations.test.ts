import * as THREE from "three";
import { extrudeBRep, extrudeThreeJsObject } from "../../src/scene-operations/resize-operations";
import { Brep, Vertex, Edge, Face } from "../../src/geometry";
import { OpenCascadeService } from "../../src/services/OpenCascadeService";

describe("resize-operations", () => {
  describe("extrudeBRep", () => {
    describe("Basic Extrusion", () => {
      it("should extrude 2D rectangle to 3D box", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);
        const v4 = new Vertex(0, 1, 0);

        const edges = [
          new Edge(v1, v2),
          new Edge(v2, v3),
          new Edge(v3, v4),
          new Edge(v4, v1),
        ];

        const face = new Face([v1, v2, v3, v4]);
        const brep = new Brep([v1, v2, v3, v4], edges, [face]);

        const extruded = await extrudeBRep(brep, 2, 1);

        expect(extruded.brep.vertices.length).toBeGreaterThan(0);
        expect(extruded.brep.faces.length).toBeGreaterThan(0);

        // Z-range should match extrusion depth
        const zValues = extruded.brep.vertices.map((v) => v.z);
        const zRange = Math.max(...zValues) - Math.min(...zValues);
        expect(zRange).toBeCloseTo(2, 0);
      });

      it("should extrude 2D triangle to 3D prism", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(0.5, 1, 0);

        const edges = [
          new Edge(v1, v2),
          new Edge(v2, v3),
          new Edge(v3, v1),
        ];

        const face = new Face([v1, v2, v3]);
        const brep = new Brep([v1, v2, v3], edges, [face]);

        const extruded = await extrudeBRep(brep, 2, 1);

        expect(extruded.brep.vertices.length).toBeGreaterThan(0);
        expect(extruded.brep.faces.length).toBeGreaterThan(0);
      });

      it("should handle positive depth (extrude up)", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);

        const edges = [new Edge(v1, v2), new Edge(v2, v3), new Edge(v3, v1)];
        const face = new Face([v1, v2, v3]);
        const brep = new Brep([v1, v2, v3], edges, [face]);

        const extruded = await extrudeBRep(brep, 2, 1);

        const zValues = extruded.brep.vertices.map((v) => v.z);
        const minZ = Math.min(...zValues);
        const maxZ = Math.max(...zValues);

        expect(maxZ - minZ).toBeCloseTo(2, 0);

        // Position offset should be +1 in Z (depth/2 * direction)
        expect(extruded.positionOffset.z).toBeCloseTo(1, 0);
        expect(extruded.positionOffset.x).toBeCloseTo(0);
        expect(extruded.positionOffset.y).toBeCloseTo(0);
      });

      it("should handle negative direction", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);

        const edges = [new Edge(v1, v2), new Edge(v2, v3), new Edge(v3, v1)];
        const face = new Face([v1, v2, v3]);
        const brep = new Brep([v1, v2, v3], edges, [face]);

        const extruded = await extrudeBRep(brep, 2, -1);

        // Should still create valid geometry
        expect(extruded.brep.vertices.length).toBeGreaterThan(0);
        expect(extruded.brep.faces.length).toBeGreaterThan(0);

        // Position offset should be -1 in Z (depth/2 * direction = -1)
        expect(extruded.positionOffset.z).toBeCloseTo(-1, 0);
      });
    });

    describe("Geometry Validation", () => {
      it("should produce a 3D solid with Z extent matching depth", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);
        const v4 = new Vertex(0, 1, 0);
        const v5 = new Vertex(0.5, 0.5, 0);

        const edges = [
          new Edge(v1, v2),
          new Edge(v2, v3),
          new Edge(v3, v4),
          new Edge(v4, v5),
          new Edge(v5, v1),
        ];

        const face = new Face([v1, v2, v3, v4, v5]);
        const brep = new Brep([v1, v2, v3, v4, v5], edges, [face]);

        const extruded = await extrudeBRep(brep, 2, 1);

        expect(extruded.brep.vertices.length).toBeGreaterThan(0);
        expect(extruded.brep.faces.length).toBeGreaterThan(0);

        const zValues = extruded.brep.vertices.map((v) => v.z);
        const zRange = Math.max(...zValues) - Math.min(...zValues);
        expect(zRange).toBeCloseTo(2, 0);
      });

      it("should center geometry around Z=0", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);

        const edges = [new Edge(v1, v2), new Edge(v2, v3), new Edge(v3, v1)];
        const face = new Face([v1, v2, v3]);
        const brep = new Brep([v1, v2, v3], edges, [face]);

        const extruded = await extrudeBRep(brep, 4, 1);

        const zValues = extruded.brep.vertices.map((v) => v.z);
        const minZ = Math.min(...zValues);
        const maxZ = Math.max(...zValues);

        // BRep is centered, so Z range should be roughly symmetric around 0
        // The centering uses bounding box center, so (minZ+maxZ)/2 ≈ 0
        const zCenter = (minZ + maxZ) / 2;
        expect(zCenter).toBeCloseTo(0, 0);
      });

      it("should include edge geometry in result", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);
        const v4 = new Vertex(0, 1, 0);

        const edges = [
          new Edge(v1, v2), new Edge(v2, v3),
          new Edge(v3, v4), new Edge(v4, v1),
        ];
        const face = new Face([v1, v2, v3, v4]);
        const brep = new Brep([v1, v2, v3, v4], edges, [face]);

        const extruded = await extrudeBRep(brep, 2, 1);

        expect(extruded.edgeGeometry).toBeDefined();
        expect(extruded.edgeGeometry).toBeInstanceOf(THREE.BufferGeometry);
        expect(extruded.edgeGeometry!.attributes.position.count).toBeGreaterThan(0);
      });
    });

    describe("Edge Cases", () => {
      it("should handle very small depth (0.001)", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);

        const edges = [new Edge(v1, v2), new Edge(v2, v3), new Edge(v3, v1)];
        const face = new Face([v1, v2, v3]);
        const brep = new Brep([v1, v2, v3], edges, [face]);

        const extruded = await extrudeBRep(brep, 0.001, 1);

        expect(extruded.brep.vertices.length).toBeGreaterThan(0);

        const zValues = extruded.brep.vertices.map((v) => v.z);
        const thickness = Math.max(...zValues) - Math.min(...zValues);
        expect(thickness).toBeCloseTo(0.001, 2);
      });

      it("should handle large depth (1000)", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);

        const edges = [new Edge(v1, v2), new Edge(v2, v3), new Edge(v3, v1)];
        const face = new Face([v1, v2, v3]);
        const brep = new Brep([v1, v2, v3], edges, [face]);

        const extruded = await extrudeBRep(brep, 1000, 1);

        const zValues = extruded.brep.vertices.map((v) => v.z);
        const thickness = Math.max(...zValues) - Math.min(...zValues);
        expect(thickness).toBeCloseTo(1000, -1);
      });

      it("should handle complex polygon (hexagon)", async () => {
        const vertices: Vertex[] = [];
        const edges: Edge[] = [];

        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          vertices.push(new Vertex(Math.cos(angle), Math.sin(angle), 0));
        }

        for (let i = 0; i < 6; i++) {
          edges.push(new Edge(vertices[i], vertices[(i + 1) % 6]));
        }

        const face = new Face(vertices);
        const brep = new Brep(vertices, edges, [face]);

        const extruded = await extrudeBRep(brep, 2, 1);

        expect(extruded.brep.vertices.length).toBeGreaterThan(0);
        expect(extruded.brep.faces.length).toBeGreaterThan(0);

        const zValues = extruded.brep.vertices.map((v) => v.z);
        const zRange = Math.max(...zValues) - Math.min(...zValues);
        expect(zRange).toBeCloseTo(2, 0);
      });
    });

    describe("Error Handling", () => {
      it("should handle empty BRep", async () => {
        const brep = new Brep([], [], []);

        const result = await extrudeBRep(brep, 2, 1);

        expect(result.brep).toBe(brep);
        expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
      });

      it("should handle BRep with no faces", async () => {
        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const edge = new Edge(v1, v2);
        const brep = new Brep([v1, v2], [edge], []);

        const result = await extrudeBRep(brep, 2, 1);

        expect(result.brep).toBe(brep);
        expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
      });

      it("should handle already-3D BRep (warn and return unchanged)", async () => {
        const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);
        const v4 = new Vertex(0, 0, 1);

        const face = new Face([v1, v2, v3]);
        const brep = new Brep([v1, v2, v3, v4], [], [face]);

        const result = await extrudeBRep(brep, 2, 1);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("non-flat")
        );
        expect(result.brep).toBe(brep);
        expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });

        consoleSpy.mockRestore();
      });

      it("should return original BRep on OpenCascade error", async () => {
        const consoleSpy = jest.spyOn(console, "error").mockImplementation();

        const v1 = new Vertex(0, 0, 0);
        const v2 = new Vertex(1, 0, 0);
        const v3 = new Vertex(1, 1, 0);

        const edges = [new Edge(v1, v2), new Edge(v2, v3), new Edge(v3, v1)];
        const face = new Face([v1, v2, v3]);
        const brep = new Brep([v1, v2, v3], edges, [face]);

        // Spy on buildPlanarFaceFromBoundary to simulate OCC failure
        const ocService = OpenCascadeService.getInstance();
        const spy = jest.spyOn(ocService, "buildPlanarFaceFromBoundary")
          .mockRejectedValueOnce(new Error("OC Error"));

        const result = await extrudeBRep(brep, 2, 1);

        expect(consoleSpy).toHaveBeenCalled();
        expect(result.brep).toBe(brep);
        expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });

        spy.mockRestore();
        consoleSpy.mockRestore();
      });
    });
  });

  describe("extrudeThreeJsObject", () => {
    describe("PlaneGeometry", () => {
      it("should extrude plane to box", () => {
        const planeGeom = new THREE.PlaneGeometry(2, 3);
        const mesh = new THREE.Mesh(
          planeGeom,
          new THREE.MeshStandardMaterial({ color: 0xff0000 })
        );
        mesh.position.set(1, 2, 3);

        const extruded = extrudeThreeJsObject(mesh, 5, 1);

        expect(extruded.geometry).toBeInstanceOf(THREE.BoxGeometry);
      });

      it("should preserve plane dimensions", () => {
        const planeGeom = new THREE.PlaneGeometry(4, 6);
        const mesh = new THREE.Mesh(planeGeom, new THREE.MeshStandardMaterial());

        const extruded = extrudeThreeJsObject(mesh, 2, 1);
        const boxGeom = extruded.geometry as THREE.BoxGeometry;

        expect(boxGeom.parameters.width).toBe(4);
        expect(boxGeom.parameters.height).toBe(6);
        expect(boxGeom.parameters.depth).toBe(2);
      });
    });

    describe("CircleGeometry", () => {
      it("should extrude circle to cylinder", () => {
        const circleGeom = new THREE.CircleGeometry(3, 32);
        const mesh = new THREE.Mesh(circleGeom, new THREE.MeshStandardMaterial());

        const extruded = extrudeThreeJsObject(mesh, 4, 1);

        expect(extruded.geometry).toBeInstanceOf(THREE.CylinderGeometry);
      });

      it("should preserve circle radius and segments", () => {
        const circleGeom = new THREE.CircleGeometry(5, 64);
        const mesh = new THREE.Mesh(circleGeom, new THREE.MeshStandardMaterial());

        const extruded = extrudeThreeJsObject(mesh, 3, 1);
        const cylGeom = extruded.geometry as THREE.CylinderGeometry;

        expect(cylGeom.parameters.radiusTop).toBe(5);
        expect(cylGeom.parameters.radiusBottom).toBe(5);
        expect(cylGeom.parameters.radialSegments).toBe(64);
      });
    });

    describe("ShapeGeometry", () => {
      it("should extrude arbitrary shape", () => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(2, 0);
        shape.lineTo(2, 2);
        shape.lineTo(0, 2);
        shape.closePath();

        const shapeGeom = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(shapeGeom, new THREE.MeshStandardMaterial());

        const extruded = extrudeThreeJsObject(mesh, 3, 1);

        expect(extruded.geometry).toBeInstanceOf(THREE.ExtrudeGeometry);
      });
    });

    describe("Generic Geometry", () => {
      it("should handle BufferGeometry", () => {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
          0, 0, 0,
          1, 0, 0,
          1, 1, 0,
          0, 1, 0,
        ]);
        geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());

        const extruded = extrudeThreeJsObject(mesh, 2, 1);

        expect(extruded.geometry).toBeDefined();
      });

      it("should preserve position after extrusion", () => {
        const planeGeom = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(planeGeom, new THREE.MeshStandardMaterial());
        mesh.position.set(5, 10, 15);

        const extruded = extrudeThreeJsObject(mesh, 3, 1);

        expect(extruded.position.x).toBe(5);
        expect(extruded.position.y).toBe(10);
        expect(extruded.position.z).toBe(15);
      });

      it("should preserve rotation after extrusion", () => {
        const planeGeom = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(planeGeom, new THREE.MeshStandardMaterial());
        mesh.rotation.set(Math.PI / 4, Math.PI / 2, 0);

        const extruded = extrudeThreeJsObject(mesh, 3, 1);

        expect(extruded.rotation.x).toBeCloseTo(Math.PI / 4);
        expect(extruded.rotation.y).toBeCloseTo(Math.PI / 2);
        expect(extruded.rotation.z).toBeCloseTo(0);
      });

      it("should preserve X and Y scale after extrusion", () => {
        const planeGeom = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(planeGeom, new THREE.MeshStandardMaterial());
        mesh.scale.set(2, 3, 1);

        const extruded = extrudeThreeJsObject(mesh, 3, 1);

        expect(extruded.scale.x).toBe(2);
        expect(extruded.scale.y).toBe(3);
      });

      it("should use absolute value for extrusion depth", () => {
        const planeGeom = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(planeGeom, new THREE.MeshStandardMaterial());

        const extruded = extrudeThreeJsObject(mesh, -5, 1);
        const boxGeom = extruded.geometry as THREE.BoxGeometry;

        expect(boxGeom.parameters.depth).toBe(5);
      });
    });

    describe("Material Handling", () => {
      it("should preserve material", () => {
        const planeGeom = new THREE.PlaneGeometry(2, 2);
        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(planeGeom, material);

        const extruded = extrudeThreeJsObject(mesh, 3, 1);

        expect(extruded.material).toBe(material);
      });
    });
  });
});
