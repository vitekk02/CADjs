import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
import { SceneElement } from "./types";
import { createMeshFromGeometry } from "./mesh-operations";
import { OpenCascadeService } from "../services/OpenCascadeService";

// boolean intersection - returns common volume of all shapes
export async function intersectionSelectedElements(
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

  const selectedElementsData = elements.filter((el) =>
    selectedElements.includes(el.nodeId),
  );
  const selectedNodeIds = [...selectedElements];

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
    const ocService = OpenCascadeService.getInstance();
    const oc = await ocService.getOC();

    // Use lossless occBrep path when available
    const el0 = selectedElementsData[0];
    let resultShape = el0.occBrep
      ? await ocService.occBrepToOCShape(el0.occBrep, el0.position)
      : await ocService.brepToOCShape(brepsToIntersect[0].brep, brepsToIntersect[0].position);

    for (let i = 1; i < selectedElementsData.length; i++) {
      const el = selectedElementsData[i];
      const nextShape = el.occBrep
        ? await ocService.occBrepToOCShape(el.occBrep, el.position)
        : await ocService.brepToOCShape(brepsToIntersect[i].brep, brepsToIntersect[i].position);

      const result = await ocService.booleanIntersection(
        resultShape,
        nextShape,
      );
      resultShape = result.shape;
    }

    if (!resultShape) {
      throw new Error("Intersection operation failed - no result shape");
    }

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
    console.error("Error during intersection operation:", error);
    return null;
  }
}
