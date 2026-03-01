import * as THREE from "three";
import { sweepBRep } from "../../src/scene-operations/sweep-operations";
import { Brep, Vertex, Edge, Face } from "../../src/geometry";
import { OpenCascadeService } from "../../src/services/OpenCascadeService";

const ocService = OpenCascadeService.getInstance();

/**
 * Create a flat rectangle BRep centered at origin in the XY plane.
 */
function createRectBrep(w: number, h: number): Brep {
  const hw = w / 2, hh = h / 2;
  const v = [
    new Vertex(-hw, -hh, 0), new Vertex(hw, -hh, 0),
    new Vertex(hw, hh, 0), new Vertex(-hw, hh, 0),
  ];
  const edges = [
    new Edge(v[0], v[1]), new Edge(v[1], v[2]),
    new Edge(v[2], v[3]), new Edge(v[3], v[0]),
  ];
  const faces = [new Face([v[0], v[1], v[2], v[3]])];
  return new Brep(v, edges, faces);
}

describe("sweep-operations", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("sweepBRep", () => {
    const straightPath = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 5 },
    ];

    const lPath = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 3, z: 0 },
    ];

    it("should sweep rectangle profile along straight path and return centered BRep", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await sweepBRep(profileBrep, position, straightPath);

      // Should produce valid 3D geometry
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);

      // BRep should be centered (bounding box center near origin)
      const xs = result.brep.vertices.map(v => v.x);
      const ys = result.brep.vertices.map(v => v.y);
      const zs = result.brep.vertices.map(v => v.z);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
      expect(centerX).toBeCloseTo(0, 0);
      expect(centerY).toBeCloseTo(0, 0);
      expect(centerZ).toBeCloseTo(0, 0);
    });

    it("should produce positionOffset along the sweep path direction", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await sweepBRep(profileBrep, position, straightPath);

      // For a straight Z-path of length 5 starting at origin,
      // the position offset Z should be around 2.5 (midpoint of path)
      expect(result.positionOffset.z).toBeCloseTo(2.5, 0);
      expect(result.positionOffset.x).toBeCloseTo(0, 0);
      expect(result.positionOffset.y).toBeCloseTo(0, 0);
    });

    it("should sweep profile along L-shaped path", async () => {
      const profileBrep = createRectBrep(1, 1);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await sweepBRep(profileBrep, position, lPath);

      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
    });

    it("should handle profile at non-origin position", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(5, 3, 0);

      // Path starts near the profile position
      const path = [
        { x: 5, y: 3, z: 0 },
        { x: 5, y: 3, z: 5 },
      ];

      const result = await sweepBRep(profileBrep, position, path);

      // Should produce valid geometry
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);

      // Position offset Z should reflect the sweep distance
      expect(result.positionOffset.z).toBeCloseTo(2.5, 0);
    });

    it("should include edge geometry in result", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await sweepBRep(profileBrep, position, straightPath);

      expect(result.edgeGeometry).toBeDefined();
      expect(result.edgeGeometry).toBeInstanceOf(THREE.BufferGeometry);
      expect(result.edgeGeometry!.attributes.position.count).toBeGreaterThan(0);
    });

    it("should return original BRep when profile has no faces", async () => {
      const emptyBrep = new Brep([], [], []);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await sweepBRep(emptyBrep, position, straightPath);

      expect(result.brep).toBe(emptyBrep);
      expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
    });

    it("should return original BRep when path has fewer than 2 points", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await sweepBRep(profileBrep, position, [{ x: 0, y: 0, z: 0 }]);

      expect(result.brep).toBe(profileBrep);
      expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
    });

    it("should return original BRep when buildPlanarFaceFromBoundary returns null", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      jest.spyOn(ocService, "buildPlanarFaceFromBoundary").mockResolvedValue(null as any);

      const result = await sweepBRep(profileBrep, position, straightPath);

      expect(result.brep).toBe(profileBrep);
      expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
    });

    it("should return original BRep when buildWireFromPoints returns null", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      jest.spyOn(ocService, "buildWireFromPoints").mockResolvedValue(null as any);

      const result = await sweepBRep(profileBrep, position, straightPath);

      expect(result.brep).toBe(profileBrep);
      expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
    });

    it("should return original BRep when sweepShape throws", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      jest.spyOn(ocService, "sweepShape").mockRejectedValue(new Error("Sweep failed"));

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const result = await sweepBRep(profileBrep, position, straightPath);

      expect(result.brep).toBe(profileBrep);
      expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[sweepBRep]"),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it("should handle edge geometry extraction failure gracefully", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      jest.spyOn(ocService, "shapeToEdgeLineSegments").mockRejectedValue(new Error("Edge fail"));

      const result = await sweepBRep(profileBrep, position, straightPath);

      // Should still return valid result without edge geometry
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
      expect(result.edgeGeometry).toBeUndefined();
    });

    it("should handle empty path array", async () => {
      const profileBrep = createRectBrep(2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await sweepBRep(profileBrep, position, []);

      expect(result.brep).toBe(profileBrep);
      expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
    });
  });
});
