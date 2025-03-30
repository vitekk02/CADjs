import * as THREE from "three";
import {
  createMeshFromBrep,
  getAllFaces,
  getObject,
  getAllObjects,
} from "../../src/scene-operations/mesh-operations";
import { Brep, CompoundBrep, Face, Vertex } from "../../src/geometry";

// Mock createGeometryFromBRep since it has complex THREE.js dependencies
jest.mock("../../src/convertBRepToGeometry", () => ({
  createGeometryFromBRep: jest.fn(() => new THREE.BufferGeometry()),
}));

describe("mesh-operations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createMeshFromBrep", () => {
    test("creates mesh from valid brep with faces", () => {
      // Create a simple Brep with one face
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 0, 0);
      const v3 = new Vertex(1, 1, 0);
      const v4 = new Vertex(0, 1, 0);
      const face = new Face([v1, v2, v3, v4]);
      const brep = new Brep([v1, v2, v3, v4], [], [face]);

      const mesh = createMeshFromBrep(brep);

      expect(mesh).toBeInstanceOf(THREE.Mesh);
      expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
        0x0000ff
      );
    });

    test("creates error mesh when brep has no faces", () => {
      // Create an empty brep
      const brep = new Brep([], [], []);

      const mesh = createMeshFromBrep(brep);

      expect(mesh).toBeInstanceOf(THREE.Mesh);
      expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
      expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
        0xff0000
      );
    });
  });

  describe("getAllFaces", () => {
    test("returns faces from simple brep", () => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 0, 0);
      const v3 = new Vertex(1, 1, 0);
      const face = new Face([v1, v2, v3]);
      const brep = new Brep([v1, v2, v3], [], [face]);

      const faces = getAllFaces(brep);

      expect(faces).toHaveLength(1);
      expect(faces[0]).toBe(face);
    });

    test("returns all faces from compound brep", () => {
      const v1 = new Vertex(0, 0, 0);
      const v2 = new Vertex(1, 0, 0);
      const v3 = new Vertex(1, 1, 0);
      const face1 = new Face([v1, v2, v3]);
      const brep1 = new Brep([v1, v2, v3], [], [face1]);

      const v4 = new Vertex(0, 0, 1);
      const v5 = new Vertex(1, 0, 1);
      const v6 = new Vertex(1, 1, 1);
      const face2 = new Face([v4, v5, v6]);
      const brep2 = new Brep([v4, v5, v6], [], [face2]);

      const compound = new CompoundBrep([brep1, brep2]);

      const faces = getAllFaces(compound);

      expect(faces).toHaveLength(2);
      expect(faces).toContain(face1);
      expect(faces).toContain(face2);
    });

    test("returns empty array for invalid brep", () => {
      // Create a brep-like object with no faces array
      const invalidBrep = { notFaces: [] } as unknown as Brep;

      const faces = getAllFaces(invalidBrep);

      expect(faces).toHaveLength(0);
    });
  });

  describe("getObject and getAllObjects", () => {
    let objectsMap: Map<string, THREE.Object3D>;

    beforeEach(() => {
      objectsMap = new Map<string, THREE.Object3D>();
      objectsMap.set("node_1", new THREE.Mesh());
      objectsMap.set("node_2", new THREE.Group());
    });

    test("getObject returns the correct object", () => {
      const object = getObject(objectsMap, "node_1");
      expect(object).toBeInstanceOf(THREE.Mesh);

      const object2 = getObject(objectsMap, "node_2");
      expect(object2).toBeInstanceOf(THREE.Group);

      const nonExistent = getObject(objectsMap, "non_existent");
      expect(nonExistent).toBeUndefined();
    });

    test("getAllObjects returns the complete map", () => {
      const allObjects = getAllObjects(objectsMap);
      expect(allObjects).toBe(objectsMap);
      expect(allObjects.size).toBe(2);
      expect(allObjects.has("node_1")).toBe(true);
      expect(allObjects.has("node_2")).toBe(true);
    });
  });
});
