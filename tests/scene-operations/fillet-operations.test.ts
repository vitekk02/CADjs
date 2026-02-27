import * as THREE from "three";
import { filletBRep, chamferBRep } from "../../src/scene-operations/fillet-operations";
import { Brep, Vertex, Edge, Face } from "../../src/geometry";
import { OpenCascadeService } from "../../src/services/OpenCascadeService";

// Use jest.spyOn on the real singleton (jest.mock doesn't intercept because
// setup.ts loads the real module via setupFilesAfterEnv before test-file mocks apply)
const ocService = OpenCascadeService.getInstance();

/**
 * Create a simple 3D box BRep centered at origin with dimensions w x h x d.
 */
function createBoxBrep(w: number, h: number, d: number): Brep {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const v = [
    new Vertex(-hw, -hh, -hd), new Vertex(hw, -hh, -hd),
    new Vertex(hw, hh, -hd), new Vertex(-hw, hh, -hd),
    new Vertex(-hw, -hh, hd), new Vertex(hw, -hh, hd),
    new Vertex(hw, hh, hd), new Vertex(-hw, hh, hd),
  ];
  const edges = [
    new Edge(v[0], v[1]), new Edge(v[1], v[2]), new Edge(v[2], v[3]), new Edge(v[3], v[0]),
    new Edge(v[4], v[5]), new Edge(v[5], v[6]), new Edge(v[6], v[7]), new Edge(v[7], v[4]),
    new Edge(v[0], v[4]), new Edge(v[1], v[5]), new Edge(v[2], v[6]), new Edge(v[3], v[7]),
  ];
  const faces = [
    new Face([v[0], v[1], v[2], v[3]]),
    new Face([v[4], v[5], v[6], v[7]]),
    new Face([v[0], v[1], v[5], v[4]]),
    new Face([v[2], v[3], v[7], v[6]]),
    new Face([v[0], v[3], v[7], v[4]]),
    new Face([v[1], v[2], v[6], v[5]]),
  ];
  return new Brep(v, edges, faces);
}

/**
 * Create a mock OC bounding box returning the given min/max corners.
 */
function createMockBoundingBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  return {
    CornerMin: () => ({ X: () => minX, Y: () => minY, Z: () => minZ }),
    CornerMax: () => ({ X: () => maxX, Y: () => maxY, Z: () => maxZ }),
  };
}

/**
 * Set up spies to return given bounding box and result BRep.
 */
function setupSpies(
  bboxMin: [number, number, number],
  bboxMax: [number, number, number],
  resultBrep?: Brep,
) {
  const bndBox = createMockBoundingBox(...bboxMin, ...bboxMax);
  const mockEdgeGeom = new THREE.BufferGeometry();
  mockEdgeGeom.translate = jest.fn().mockReturnValue(mockEdgeGeom);

  const brep = resultBrep ?? createBoxBrep(2, 2, 2);

  jest.spyOn(ocService, "getOC").mockResolvedValue({
    Bnd_Box_1: jest.fn(() => bndBox),
    BRepBndLib: { Add: jest.fn() },
  } as any);
  jest.spyOn(ocService, "brepToOCShape").mockResolvedValue({} as any);
  jest.spyOn(ocService, "filletEdges").mockResolvedValue({} as any);
  jest.spyOn(ocService, "chamferEdges").mockResolvedValue({} as any);
  jest.spyOn(ocService, "ocShapeToBRep").mockResolvedValue(brep);
  jest.spyOn(ocService, "shapeToEdgeLineSegments").mockResolvedValue(mockEdgeGeom);

  return { mockEdgeGeom, brep };
}

describe("fillet-operations", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("filletBRep", () => {
    it("should return FilletResult with brep, positionOffset, and edgeGeometry", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(1, 2, 3);
      const { brep: resultBrep, mockEdgeGeom } = setupSpies(
        [0, 1, 2], [2, 3, 4], // bbox center = (1, 2, 3) = position → offset 0
      );

      const result = await filletBRep(inputBrep, position, [0], 0.5);

      expect(result.brep).toBe(resultBrep);
      expect(result.positionOffset).toBeDefined();
      expect(result.edgeGeometry).toBe(mockEdgeGeom);
    });

    it("should pass all edge indices to filletEdges", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);
      setupSpies([-1, -1, -1], [1, 1, 1]);

      await filletBRep(inputBrep, position, [1, 3, 5], 0.3);

      expect(ocService.filletEdges).toHaveBeenCalledTimes(1);
      expect(ocService.filletEdges).toHaveBeenCalledWith(
        expect.anything(),
        [1, 3, 5],
        0.3,
      );
    });

    it("should compute zero position offset when bbox center equals position", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(1, 2, 3);
      // bbox center = (1, 2, 3) → matches position
      setupSpies([0.5, 1.5, 2.5], [1.5, 2.5, 3.5]);

      const result = await filletBRep(inputBrep, position, [0], 0.5);

      expect(result.positionOffset.x).toBeCloseTo(0);
      expect(result.positionOffset.y).toBeCloseTo(0);
      expect(result.positionOffset.z).toBeCloseTo(0);
    });

    it("should compute non-zero position offset when bbox center differs from position", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);
      // bbox center = (1, 1, 1) → offset = (1, 1, 1)
      setupSpies([-1, -1, -1], [3, 3, 3]);

      const result = await filletBRep(inputBrep, position, [0], 0.5);

      expect(result.positionOffset.x).toBeCloseTo(1);
      expect(result.positionOffset.y).toBeCloseTo(1);
      expect(result.positionOffset.z).toBeCloseTo(1);
    });

    it("should translate edge geometry by negative world center", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);
      // bbox center = (2, 3, 4)
      const { mockEdgeGeom } = setupSpies([1, 2, 3], [3, 4, 5]);

      await filletBRep(inputBrep, position, [0], 0.5);

      expect(mockEdgeGeom.translate).toHaveBeenCalledWith(-2, -3, -4);
    });

    it("should propagate OCC errors from filletEdges", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue({} as any);
      jest.spyOn(ocService, "filletEdges").mockRejectedValue(
        new Error("Fillet failed: radius too large"),
      );

      await expect(
        filletBRep(inputBrep, position, [0], 10),
      ).rejects.toThrow("Fillet failed: radius too large");
    });
  });

  describe("chamferBRep", () => {
    it("should call chamferEdges (not filletEdges) with correct parameters", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);
      setupSpies([-1, -1, -1], [1, 1, 1]);

      await chamferBRep(inputBrep, position, [2, 4], 0.3);

      expect(ocService.chamferEdges).toHaveBeenCalledTimes(1);
      expect(ocService.chamferEdges).toHaveBeenCalledWith(
        expect.anything(),
        [2, 4],
        0.3,
      );
      expect(ocService.filletEdges).not.toHaveBeenCalled();
    });

    it("should compute position offset correctly", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(5, 5, 5);
      // bbox center = (5.5, 5.5, 5.5) → offset = (0.5, 0.5, 0.5)
      setupSpies([5, 5, 5], [6, 6, 6]);

      const result = await chamferBRep(inputBrep, position, [0], 0.2);

      expect(result.positionOffset.x).toBeCloseTo(0.5);
      expect(result.positionOffset.y).toBeCloseTo(0.5);
      expect(result.positionOffset.z).toBeCloseTo(0.5);
    });

    it("should propagate OCC errors from chamferEdges", async () => {
      const inputBrep = createBoxBrep(2, 2, 2);
      const position = new THREE.Vector3(0, 0, 0);

      jest.spyOn(ocService, "brepToOCShape").mockResolvedValue({} as any);
      jest.spyOn(ocService, "chamferEdges").mockRejectedValue(
        new Error("Chamfer failed"),
      );

      await expect(
        chamferBRep(inputBrep, position, [0], 5),
      ).rejects.toThrow("Chamfer failed");
    });
  });
});
