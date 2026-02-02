import * as THREE from "three";
import { Brep, BrepGraph } from "../geometry";

export type SceneMode = "draw" | "move" | "union" | "difference" | "intersection" | "resize" | "sketch";

export interface SceneElement {
  brep: Brep;
  nodeId: string;
  position: THREE.Vector3;
  selected?: boolean;
  rotation?: THREE.Euler;
}

export interface SceneState {
  elements: SceneElement[];
  selectedElements: string[];
  brepGraph: BrepGraph;
  mode: SceneMode;
  idCounter: number;
  objectsMap: Map<string, THREE.Object3D>;
}
