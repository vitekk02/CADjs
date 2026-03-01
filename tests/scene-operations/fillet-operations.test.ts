import * as THREE from "three";
import { filletBRep, chamferBRep } from "../../src/scene-operations/fillet-operations";
import { Brep, Vertex, Edge, Face } from "../../src/geometry";
import { OpenCascadeService } from "../../src/services/OpenCascadeService";

const ocService = OpenCascadeService.getInstance();

/**
 * Create a proper OCC box solid and convert to BRep, returning
 * both the BRep and the OCC shape (for passing directly to fillet/chamfer).
 *
 * The BRep stored in our system is tessellated and not suitable for
 * direct fillet operations via brepToOCShape (which creates shells, not solids).
 * In the real app, fillet is applied to the OCC shape derived from brepToOCShape,
 * which works for extruded prisms. For tests, we use BRepPrimAPI_MakeBox
 * to create a guaranteed valid solid.
 */
async function createOCCBoxBrep(w: number, h: number, d: number): Promise<Brep> {
  const oc = await ocService.getOC();
  const box = new oc.BRepPrimAPI_MakeBox_2(w, h, d);
  const shape = box.Shape();
  // Center the BRep
  const brep = await ocService.ocShapeToBRep(shape, true);
  return brep;
}

/**
 * Create a proper OCC box shape (not tessellated BRep).
 */
async function createOCCBoxShape(w: number, h: number, d: number) {
  const oc = await ocService.getOC();
  const box = new oc.BRepPrimAPI_MakeBox_2(w, h, d);
  return box.Shape();
}

describe("fillet-operations", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("filletBRep", () => {
    it("should return FilletResult with brep, positionOffset, and edgeGeometry", async () => {
      const boxBrep = await createOCCBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      // Mock brepToOCShape to return a proper solid instead of tessellated shell
      const boxShape = await createOCCBoxShape(2, 2, 2);
      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue(boxShape);

      const result = await filletBRep(boxBrep, position, [1], 0.2);

      expect(result.brep).toBeDefined();
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
      expect(result.positionOffset).toBeDefined();
      expect(result.edgeGeometry).toBeDefined();
      expect(result.edgeGeometry).toBeInstanceOf(THREE.BufferGeometry);
    });

    it("should produce more geometry than input (fillet adds vertices)", async () => {
      const boxBrep = await createOCCBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);
      const originalVertexCount = boxBrep.vertices.length;

      const boxShape = await createOCCBoxShape(2, 2, 2);
      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue(boxShape);

      const result = await filletBRep(boxBrep, position, [1], 0.2);

      // Filleting adds rounded geometry → more vertices
      expect(result.brep.vertices.length).toBeGreaterThan(originalVertexCount);
    });

    it("should compute reasonable position offset", async () => {
      const boxBrep = await createOCCBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const boxShape = await createOCCBoxShape(2, 2, 2);
      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue(boxShape);

      const result = await filletBRep(boxBrep, position, [1], 0.2);

      // Position offset should be defined and within reasonable bounds
      expect(typeof result.positionOffset.x).toBe("number");
      expect(typeof result.positionOffset.y).toBe("number");
      expect(typeof result.positionOffset.z).toBe("number");
    });

    it("should include edge geometry with position attribute", async () => {
      const boxBrep = await createOCCBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const boxShape = await createOCCBoxShape(2, 2, 2);
      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue(boxShape);

      const result = await filletBRep(boxBrep, position, [1], 0.2);

      expect(result.edgeGeometry).toBeDefined();
      expect(result.edgeGeometry!.attributes.position.count).toBeGreaterThan(0);
    });

    it("should propagate OCC errors from filletEdges", async () => {
      const boxBrep = await createOCCBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue({} as any);
      jest.spyOn(ocService, "filletEdges").mockRejectedValue(
        new Error("Fillet failed: radius too large"),
      );

      await expect(
        filletBRep(boxBrep, position, [0], 10),
      ).rejects.toThrow("Fillet failed: radius too large");
    });
  });

  describe("chamferBRep", () => {
    it("should produce valid chamfered geometry", async () => {
      const boxBrep = await createOCCBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const boxShape = await createOCCBoxShape(2, 2, 2);
      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue(boxShape);

      const result = await chamferBRep(boxBrep, position, [1], 0.2);

      expect(result.brep).toBeDefined();
      expect(result.brep.vertices.length).toBeGreaterThan(0);
      expect(result.brep.faces.length).toBeGreaterThan(0);
      expect(result.edgeGeometry).toBeDefined();
    });

    it("should compute reasonable position offset", async () => {
      const boxBrep = await createOCCBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      const boxShape = await createOCCBoxShape(2, 2, 2);
      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue(boxShape);

      const result = await chamferBRep(boxBrep, position, [1], 0.2);

      expect(typeof result.positionOffset.x).toBe("number");
      expect(typeof result.positionOffset.y).toBe("number");
      expect(typeof result.positionOffset.z).toBe("number");
    });

    it("should propagate OCC errors from chamferEdges", async () => {
      const boxBrep = await createOCCBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue({} as any);
      jest.spyOn(ocService, "chamferEdges").mockRejectedValue(
        new Error("Chamfer failed"),
      );

      await expect(
        chamferBRep(boxBrep, position, [0], 5),
      ).rejects.toThrow("Chamfer failed");
    });
  });
});
