import * as THREE from "three";
import { Brep, BrepGraph } from "../geometry";
import { SketchPlane } from "../types/sketch-types";

export type SceneMode = "move" | "union" | "difference" | "intersection" | "sketch" | "extrude" | "fillet" | "sweep" | "loft" | "revolve";

export interface SceneElement {
  brep: Brep;
  nodeId: string;
  position: THREE.Vector3;
  selected?: boolean;
  rotation?: THREE.Euler;
  elementType?: "profile" | "path";
  pathData?: { points: { x: number; y: number; z: number }[] };
  occBrep?: string;
  edgeGeometry?: THREE.BufferGeometry;
  sketchPlane?: SketchPlane;
}

export function isElement3D(el: SceneElement): boolean {
  const brep = el.brep;
  const vertices = "children" in brep && Array.isArray((brep as any).children)
    ? (brep as any)._unifiedBRep?.vertices ?? brep.vertices
    : brep.vertices;
  if (!vertices || vertices.length === 0) return false;
  const xs = vertices.map((v: any) => v.x);
  const ys = vertices.map((v: any) => v.y);
  const zs = vertices.map((v: any) => v.z);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  const rangeY = Math.max(...ys) - Math.min(...ys);
  const rangeZ = Math.max(...zs) - Math.min(...zs);
  const thickAxes = (rangeX > 0.01 ? 1 : 0) + (rangeY > 0.01 ? 1 : 0) + (rangeZ > 0.01 ? 1 : 0);
  return thickAxes >= 2;
}

export interface SceneState {
  elements: SceneElement[];
  selectedElements: string[];
  brepGraph: BrepGraph;
  mode: SceneMode;
  idCounter: number;
  objectsMap: Map<string, THREE.Object3D>;
}
