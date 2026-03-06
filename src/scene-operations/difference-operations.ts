import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
import { SceneElement } from "./types";
import { createMeshFromGeometry } from "./mesh-operations";
import { OpenCascadeService } from "../services/OpenCascadeService";

// boolean difference - first selected is base, rest are subtracted from it
export async function differenceSelectedElements(
  elements: SceneElement[],
  selectedElements: string[],
  idCounter: number,
  brepGraph: BrepGraph,
  objectsMap: Map<string, THREE.Object3D>,
): Promise<{
  updatedElements: SceneElement[];
  updatedSelectedElements: string[];
  nextIdCounter: number;
} | null> {
  if (selectedElements.length < 2) {
    return {
      updatedElements: elements,
      updatedSelectedElements: selectedElements,
      nextIdCounter: idCounter,
    };
  }

  const selectedElementsData = selectedElements
    .map((nodeId) => elements.find((el) => el.nodeId === nodeId))
    .filter((el): el is SceneElement => el !== undefined);

  if (selectedElementsData.length < 2) {
    return {
      updatedElements: elements,
      updatedSelectedElements: selectedElements,
      nextIdCounter: idCounter,
    };
  }

  const selectedNodeIds = [...selectedElements];

  const baseElement = selectedElementsData[0];
  const toolElements = selectedElementsData.slice(1);

  let baseBrepData: { brep: Brep; position: THREE.Vector3 };
  if (
    "children" in baseElement.brep &&
    Array.isArray((baseElement.brep as CompoundBrep).children)
  ) {
    const compound = baseElement.brep as CompoundBrep;
    const unifiedBrep = await compound.getUnifiedBRep();
    baseBrepData = {
      brep: unifiedBrep,
      position: baseElement.position.clone(),
    };
  } else {
    baseBrepData = {
      brep: baseElement.brep,
      position: baseElement.position.clone(),
    };
  }

  const toolBreps: { brep: Brep; position: THREE.Vector3 }[] = [];
  for (const toolElement of toolElements) {
    if (
      "children" in toolElement.brep &&
      Array.isArray((toolElement.brep as CompoundBrep).children)
    ) {
      const compound = toolElement.brep as CompoundBrep;
      const unifiedBrep = await compound.getUnifiedBRep();
      toolBreps.push({
        brep: unifiedBrep,
        position: toolElement.position.clone(),
      });
    } else {
      toolBreps.push({
        brep: toolElement.brep,
        position: toolElement.position.clone(),
      });
    }
  }

  try {
    const ocService = OpenCascadeService.getInstance();
    const oc = await ocService.getOC();

    // Use lossless occBrep path when available
    let resultShape = baseElement.occBrep
      ? await ocService.occBrepToOCShape(baseElement.occBrep, baseElement.position)
      : await ocService.brepToOCShape(baseBrepData.brep, baseBrepData.position);

    for (let i = 0; i < toolElements.length; i++) {
      const toolEl = toolElements[i];
      const toolShape = toolEl.occBrep
        ? await ocService.occBrepToOCShape(toolEl.occBrep, toolEl.position)
        : await ocService.brepToOCShape(toolBreps[i].brep, toolBreps[i].position);

      const result = await ocService.booleanDifference(resultShape, toolShape);
      resultShape = result.shape;
    }

    if (!resultShape) {
      throw new Error("Difference operation failed - no result shape");
    }

    // bbox for positioning
    const bBox = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(resultShape, bBox, false);

    const xMin = bBox.CornerMin().X();
    const yMin = bBox.CornerMin().Y();
    const zMin = bBox.CornerMin().Z();
    const xMax = bBox.CornerMax().X();
    const yMax = bBox.CornerMax().Y();
    const zMax = bBox.CornerMax().Z();

    const worldCenter = new THREE.Vector3(
      (xMin + xMax) / 2,
      (yMin + yMax) / 2,
      (zMin + zMax) / 2,
    );

    const resultBrep = await ocService.ocShapeToBRep(resultShape);

    if (resultBrep.vertices.length > 0) {
      const xs = resultBrep.vertices.map((v) => v.x);
      const ys = resultBrep.vertices.map((v) => v.y);
      const zs = resultBrep.vertices.map((v) => v.z);

      const uniqueYs = [...new Set(ys.map((y) => y.toFixed(3)))].sort(
        (a, b) => parseFloat(a) - parseFloat(b),
      );
      const uniqueXs = [...new Set(xs.map((x) => x.toFixed(3)))].sort(
        (a, b) => parseFloat(a) - parseFloat(b),
      );
    }

    // store original breps for potential undo
    const allBreps = [baseBrepData.brep, ...toolBreps.map((t) => t.brep)];
    const compound = new CompoundBrep(allBreps);
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
        connectionType: "difference",
      });
    });

    // Build mesh directly from OCC shape for smooth tessellation (indexed geometry + true edges)
    const resultGeometry = await ocService.shapeToThreeGeometry(resultShape, 0.003, 0.1);
    const resultEdgeGeometry = await ocService.shapeToEdgeLineSegments(resultShape, 0.003);
    const resultVertexPositions = await ocService.shapeToVertexPositions(resultShape);
    // Center geometry to match BRep centering pattern
    resultGeometry.translate(-worldCenter.x, -worldCenter.y, -worldCenter.z);
    resultEdgeGeometry.translate(-worldCenter.x, -worldCenter.y, -worldCenter.z);
    for (let i = 0; i < resultVertexPositions.length; i += 3) {
      resultVertexPositions[i] -= worldCenter.x;
      resultVertexPositions[i + 1] -= worldCenter.y;
      resultVertexPositions[i + 2] -= worldCenter.z;
    }

    // Serialize for lossless round-tripping
    let serializedOccBrep: string | undefined;
    try {
      const trsf = new oc.gp_Trsf_1();
      trsf.SetTranslation_1(new oc.gp_Vec_4(-worldCenter.x, -worldCenter.y, -worldCenter.z));
      const localShape = new oc.BRepBuilderAPI_Transform_2(resultShape, trsf, true).Shape();
      serializedOccBrep = await ocService.serializeShape(localShape);
    } catch { /* best-effort */ }

    const resultObj = createMeshFromGeometry(resultGeometry, resultEdgeGeometry);
    resultObj.position.set(0, 0, 0);

    const resultGroup = new THREE.Group();
    resultGroup.userData = { nodeId };
    resultGroup.add(resultObj);

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
    selectedNodeIds.forEach((id) => {
      objectsMap.delete(id);
    });

    const updatedElements = [
      ...elements.filter((el) => !selectedElements.includes(el.nodeId)),
      newElement,
    ];

    return {
      updatedElements,
      updatedSelectedElements: [],
      nextIdCounter: nextId,
    };
  } catch (error) {
    console.error("Error during difference operation:", error);
    return null;
  }
}
