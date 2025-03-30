import * as THREE from "three";
import { Brep, BrepGraph } from "../geometry";

export type SceneMode = "draw" | "move" | "union";

export interface SceneElement {
  brep: Brep;
  nodeId: string;
  position: THREE.Vector3;
  selected?: boolean;
}

export interface SceneState {
  elements: SceneElement[];
  selectedElements: string[];
  brepGraph: BrepGraph;
  mode: SceneMode;
  idCounter: number;
  objectsMap: Map<string, THREE.Object3D>;
}
