import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
import { SceneElement, BooleanOperationOptions } from "./types";
import { createMeshFromGeometry } from "./mesh-operations";
import { OccWorkerClient } from "../services/OccWorkerClient";
import type { WorkerBooleanResult } from "../workers/occ-worker-types";
import { reconstructEdgeGeometry, reconstructFaceGeometry } from "../workers/geometry-reconstruction";

// boolean intersection - returns common volume of all shapes
export async function intersectionSelectedElements(
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

  const brepsToIntersect: { brep: Brep; position: THREE.Vector3 }[] = [];

  for (const element of selectedElementsData) {
    if (
      "children" in element.brep &&
      Array.isArray((element.brep as CompoundBrep).children)
    ) {
      const compound = element.brep as CompoundBrep;
      const unifiedBrep = await compound.getUnifiedBRep();
      brepsToIntersect.push({
        brep: unifiedBrep,
        position: element.position.clone(),
      });
    } else {
      brepsToIntersect.push({
        brep: element.brep,
        position: element.position.clone(),
      });
    }
  }

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
        rotation: el.rotation
          ? { x: el.rotation.x, y: el.rotation.y, z: el.rotation.z, order: el.rotation.order }
          : undefined,
      };
    });

    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerBooleanResult>({
      type: "boolean",
      payload: {
        operation: "intersection",
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
      throw new Error("Intersection operation failed - no face geometry in result");
    }

    const originalBreps = brepsToIntersect.map((item) => item.brep);
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
        connectionType: "intersection",
      });
    });

    const resultMesh = createMeshFromGeometry(resultGeometry, resultEdgeGeometry);
    resultMesh.position.set(0, 0, 0);

    const resultGroup = new THREE.Group();
    resultGroup.userData = { nodeId };
    resultGroup.add(resultMesh);
    resultGroup.position.copy(worldCenter);

    const newElement: SceneElement = {
      brep: compound,
      nodeId,
      position: worldCenter,
      selected: false,
      edgeGeometry: resultEdgeGeometry,
      vertexPositions: resultVertexPositions,
      occBrep: serializedOccBrep,
    };

    objectsMap.set(nodeId, resultGroup);

    // keepTools: only remove target, preserve tool bodies
    const idsToRemove = options?.keepTools
      ? [options.targetId]
      : selectedNodeIds;
    idsToRemove.forEach((id) => {
      objectsMap.delete(id);
    });

    const updatedElements = [
      ...elements.filter((el) => !idsToRemove.includes(el.nodeId)),
      newElement,
    ];

    return {
      updatedElements,
      updatedSelectedElements: [],
      nextIdCounter: nextId,
    };
  } catch (error) {
    console.error("Error during intersection operation:", error);
    return null;
  }
}
