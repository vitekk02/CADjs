import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
import { SceneElement, BooleanOperationOptions } from "./types";
import { createMeshFromGeometry } from "./mesh-operations";
import { OccWorkerClient } from "../services/OccWorkerClient";
import type { WorkerBooleanResult } from "../workers/occ-worker-types";
import { reconstructEdgeGeometry, reconstructFaceGeometry } from "../workers/geometry-reconstruction";

export async function unionSelectedElements(
  elements: SceneElement[],
  selectedElements: string[],
  idCounter: number,
  brepGraph: BrepGraph,
  objectsMap: Map<string, THREE.Object3D>,
  options?: BooleanOperationOptions,
): Promise<{
  updatedElements: SceneElement[];
  updatedSelectedElements: string[];
  nextIdCounter: number;
} | null> {
  // When options provided, build selectedElements from target+tools
  const effectiveSelected = options
    ? [options.targetId, ...options.toolIds]
    : selectedElements;

  if (effectiveSelected.length < 2) {
    return {
      updatedElements: elements,
      updatedSelectedElements: effectiveSelected,
      nextIdCounter: idCounter,
    };
  }

  const selectedElementsData = effectiveSelected
    .map((nodeId) => elements.find((el) => el.nodeId === nodeId))
    .filter((el): el is SceneElement => el !== undefined);
  const selectedNodeIds = [...effectiveSelected];

  const brepsToUnion: { brep: Brep; position: THREE.Vector3 }[] = [];

  selectedElementsData.forEach((element) => {
    if (
      "children" in element.brep &&
      Array.isArray((element.brep as any).children)
    ) {
      const compound = element.brep as CompoundBrep;
      compound.children.forEach((childBrep) => {
        brepsToUnion.push({
          brep: childBrep,
          position: element.position.clone(),
        });
      });
    } else {
      brepsToUnion.push({
        brep: element.brep,
        position: element.position.clone(),
      });
    }
  });

  try {
    // Build operands for the worker
    const operands = selectedElementsData.map((el) => {
      const isCompound = "children" in el.brep && Array.isArray((el.brep as any).children);
      return {
        brepJson: el.brep.toJSON(),
        position: { x: el.position.x, y: el.position.y, z: el.position.z },
        occBrep: el.occBrep,
        isCompound,
        compoundBrepJson: isCompound ? (el.brep as CompoundBrep).toJSON() : undefined,
      };
    });

    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerBooleanResult>({
      type: "boolean",
      payload: {
        operation: "union",
        operands,
        options: options ? {
          targetId: options.targetId,
          toolIds: options.toolIds,
          keepTools: options.keepTools,
        } : undefined,
      },
    });

    // Reconstruct result from worker
    const resultBrep = Brep.fromJSON(raw.brepJson);
    const worldCenter = new THREE.Vector3(raw.position.x, raw.position.y, raw.position.z);
    const resultEdgeGeometry = raw.edgePositions ? reconstructEdgeGeometry(raw.edgePositions) : undefined;
    const resultVertexPositions = raw.vertexPositions ?? undefined;
    const resultGeometry = raw.faceGeometry ? reconstructFaceGeometry(raw.faceGeometry) : undefined;
    const serializedOccBrep = raw.occBrep;

    if (!resultGeometry) {
      throw new Error("Union operation failed - no face geometry in result");
    }

    // keep originals for potential ungroup
    const originalBreps = brepsToUnion.map((item) => item.brep);
    const compound = new CompoundBrep(originalBreps);
    compound.setUnifiedBrep(resultBrep);

    const nextId = idCounter + 1;
    const nodeId = `node_${nextId}`;

    brepGraph.addNode({
      id: nodeId,
      brep: compound,
      mesh: null,
      connections: [],
    });

    selectedElementsData.forEach((element) => {
      brepGraph.addConnection(element.nodeId, {
        targetId: nodeId,
        connectionType: "union",
      });
    });

    const unionMesh = createMeshFromGeometry(resultGeometry, resultEdgeGeometry);
    unionMesh.position.set(0, 0, 0);

    const unionGroup = new THREE.Group();
    unionGroup.userData = { nodeId };
    unionGroup.add(unionMesh);
    unionGroup.position.copy(worldCenter);

    const newElement: SceneElement = {
      brep: compound,
      nodeId,
      position: worldCenter,
      selected: false,
      edgeGeometry: resultEdgeGeometry,
      vertexPositions: resultVertexPositions,
      occBrep: serializedOccBrep,
    };

    objectsMap.set(nodeId, unionGroup);
    selectedNodeIds.forEach((id) => {
      objectsMap.delete(id);
    });

    const updatedElements = [
      ...elements.filter((el) => !effectiveSelected.includes(el.nodeId)),
      newElement,
    ];

    return {
      updatedElements,
      updatedSelectedElements: [],
      nextIdCounter: nextId,
    };
  } catch (error) {
    console.error("Error during union operation:", error);
    return null;
  }
}
