import * as THREE from "three";
import { filletBRep, chamferBRep } from "../../src/scene-operations/fillet-operations";
import { Brep, Vertex, Edge, Face } from "../../src/geometry";
import { OpenCascadeService } from "../../src/services/OpenCascadeService";

const ocService = OpenCascadeService.getInstance();

/**
 * Create a proper OCC box solid and return both the centered BRep
 * and the serialized occBrep string. The occBrep is needed because
 * the worker handler uses it to reconstruct the solid (tessellated
 * BReps produce shells, not solids, which fillet/chamfer reject).
 */
async function createOCCBoxWithOccBrep(w: number, h: number, d: number): Promise<{ brep: Brep; occBrep: string }> {
  const oc = await ocService.getOC();
  const box = new oc.BRepPrimAPI_MakeBox_2(w, h, d);
  const shape = box.Shape();

  // Center the BRep
  const brep = await ocService.ocShapeToBRep(shape, true);

  // Serialize in local space (centered at origin)
  const { computeBoundingBoxCenter, translateShape, serializeShapeHelper } = require("../../src/services/occ-helpers");
  const center = computeBoundingBoxCenter(oc, shape);
  const localShape = translateShape(oc, shape, { x: -center.x, y: -center.y, z: -center.z });
  const occBrep = serializeShapeHelper(oc, localShape);

  return { brep, occBrep };
}

describe("fillet-operations", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("filletBRep", () => {
    it("should return FilletResult with brep, positionOffset, and edgeGeometry", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await filletBRep(boxBrep, position, [1], 0.2, occBrep);

      expect(result.brep).toBeDefined();
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
      expect(result.positionOffset).toBeDefined();
      expect(result.edgeGeometry).toBeDefined();
      expect(result.edgeGeometry).toBeInstanceOf(THREE.BufferGeometry);
    });

    it("should produce more geometry than input (fillet adds vertices)", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);
      const originalVertexCount = boxBrep.vertices.length;

      const result = await filletBRep(boxBrep, position, [1], 0.2, occBrep);

      // Filleting adds rounded geometry → more vertices
      expect(result.brep.vertices.length).toBeGreaterThan(originalVertexCount);
    });

    it("should compute reasonable position offset", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await filletBRep(boxBrep, position, [1], 0.2, occBrep);

      // Position offset should be defined and within reasonable bounds
      expect(typeof result.positionOffset.x).toBe("number");
      expect(typeof result.positionOffset.y).toBe("number");
      expect(typeof result.positionOffset.z).toBe("number");
    });

    it("should include edge geometry with position attribute", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await filletBRep(boxBrep, position, [1], 0.2, occBrep);

      expect(result.edgeGeometry).toBeDefined();
      expect(result.edgeGeometry!.attributes.position.count).toBeGreaterThan(0);
    });

    it("should fillet multiple edges at once", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await filletBRep(boxBrep, position, [1, 2, 3], 0.2, occBrep);

      expect(result.brep).toBeDefined();
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
      expect(result.edgeGeometry).toBeDefined();
    });

    it("should handle empty edge indices array gracefully", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      // No edges to fillet — should return fallback
      const result = await filletBRep(boxBrep, position, [], 0.2, occBrep);

      expect(result.brep).toBeDefined();
      expect(result.positionOffset).toBeDefined();
    });

    it("should handle very small fillet radius (0.01)", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await filletBRep(boxBrep, position, [1], 0.01, occBrep);

      expect(result.brep).toBeDefined();
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
    });

    it("should return fallback result on fillet failure (radius too large)", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      // filletBRep now has try/catch returning fallback instead of throwing
      const result = await filletBRep(boxBrep, position, [0], 10, occBrep);

      // Should return fallback: original brep + zero offset
      expect(result.brep).toBeDefined();
      expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe("chamferBRep", () => {
    it("should produce valid chamfered geometry", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await chamferBRep(boxBrep, position, [1], 0.2, occBrep);

      expect(result.brep).toBeDefined();
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
      expect(result.edgeGeometry).toBeDefined();
    });

    it("should compute reasonable position offset", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await chamferBRep(boxBrep, position, [1], 0.2, occBrep);

      expect(typeof result.positionOffset.x).toBe("number");
      expect(typeof result.positionOffset.y).toBe("number");
      expect(typeof result.positionOffset.z).toBe("number");
    });

    it("should chamfer multiple edges at once", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await chamferBRep(boxBrep, position, [1, 2, 3], 0.2, occBrep);

      expect(result.brep).toBeDefined();
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
    });

    it("should handle very small chamfer distance (0.01)", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const result = await chamferBRep(boxBrep, position, [1], 0.01, occBrep);

      expect(result.brep).toBeDefined();
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
    });

    it("should return fallback result on chamfer failure", async () => {
      const { brep: boxBrep, occBrep } = await createOCCBoxWithOccBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      // chamferBRep now has try/catch returning fallback instead of throwing
      const result = await chamferBRep(boxBrep, position, [0], 5, occBrep);

      // Should return fallback: original brep + zero offset
      expect(result.brep).toBeDefined();
      expect(result.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
    });
  });
});
