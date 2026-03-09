import { Brep } from "../geometry";
import * as THREE from "three";
import { SceneElement } from "../scene-operations/types";
import { OccWorkerClient } from "./OccWorkerClient";
import type { WorkerImportResult, WorkerExportResult } from "../workers/occ-worker-types";
import { reconstructEdgeGeometry } from "../workers/geometry-reconstruction";

export interface ImportResult {
  brep: Brep;
  position: THREE.Vector3;
  occBrep?: string;
  edgeGeometry?: THREE.BufferGeometry;
  vertexPositions?: Float32Array;
}

export class ImportExportService {
  private static instance: ImportExportService;

  private constructor() {}

  static getInstance(): ImportExportService {
    if (!ImportExportService.instance) {
      ImportExportService.instance = new ImportExportService();
    }
    return ImportExportService.instance;
  }

  // ── Export methods ──────────────────────────────────────────────────

  async exportSTEP(elements: SceneElement[]): Promise<Blob> {
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerExportResult>({
      type: "exportFile",
      payload: {
        elements: elements.map(el => ({
          brepJson: el.brep.toJSON(),
          position: { x: el.position.x, y: el.position.y, z: el.position.z },
          occBrep: el.occBrep,
        })),
        format: "step",
      },
    });
    return new Blob([raw.fileBytes], { type: "application/step" });
  }

  async exportSTL(elements: SceneElement[]): Promise<Blob> {
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerExportResult>({
      type: "exportFile",
      payload: {
        elements: elements.map(el => ({
          brepJson: el.brep.toJSON(),
          position: { x: el.position.x, y: el.position.y, z: el.position.z },
          occBrep: el.occBrep,
        })),
        format: "stl",
      },
    });
    return new Blob([raw.fileBytes], { type: "model/stl" });
  }

  async exportIGES(elements: SceneElement[]): Promise<Blob> {
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerExportResult>({
      type: "exportFile",
      payload: {
        elements: elements.map(el => ({
          brepJson: el.brep.toJSON(),
          position: { x: el.position.x, y: el.position.y, z: el.position.z },
          occBrep: el.occBrep,
        })),
        format: "iges",
      },
    });
    return new Blob([raw.fileBytes], { type: "application/iges" });
  }

  // ── Import methods ──────────────────────────────────────────────────

  async importSTEP(arrayBuffer: ArrayBuffer): Promise<ImportResult[]> {
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerImportResult>({
      type: "importFile",
      payload: {
        fileBytes: new Uint8Array(arrayBuffer),
        format: "step",
      },
    });
    return raw.elements.map(el => ({
      brep: Brep.fromJSON(el.brepJson),
      position: new THREE.Vector3(el.position.x, el.position.y, el.position.z),
      occBrep: el.occBrep,
      edgeGeometry: el.edgePositions ? reconstructEdgeGeometry(el.edgePositions) : undefined,
      vertexPositions: el.vertexPositions,
    }));
  }

  async importSTL(arrayBuffer: ArrayBuffer): Promise<ImportResult[]> {
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerImportResult>({
      type: "importFile",
      payload: {
        fileBytes: new Uint8Array(arrayBuffer),
        format: "stl",
      },
    });
    return raw.elements.map(el => ({
      brep: Brep.fromJSON(el.brepJson),
      position: new THREE.Vector3(el.position.x, el.position.y, el.position.z),
      occBrep: el.occBrep,
      edgeGeometry: el.edgePositions ? reconstructEdgeGeometry(el.edgePositions) : undefined,
      vertexPositions: el.vertexPositions,
    }));
  }
}
