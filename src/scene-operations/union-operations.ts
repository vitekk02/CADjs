import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
import { SceneElement } from "./types";
import { createMeshFromGeometry } from "./mesh-operations";
import { OpenCascadeService } from "../services/OpenCascadeService";

export async function unionSelectedElements(
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
    const ocService = OpenCascadeService.getInstance();
    const oc = await ocService.getOC();

    // Convert each element to an OCC shape, preferring lossless occBrep path
    const elementToShape = async (el: SceneElement) => {
      if (el.occBrep) {
        return ocService.occBrepToOCShape(el.occBrep, el.position);
      }
      // Fallback: flatten CompoundBrep children or use brep directly
      if ("children" in el.brep && Array.isArray((el.brep as any).children)) {
        const compound = el.brep as CompoundBrep;
        let shape = await ocService.brepToOCShape(compound.children[0], el.position);
        for (let i = 1; i < compound.children.length; i++) {
          const next = await ocService.brepToOCShape(compound.children[i], el.position);
          const result = await ocService.booleanUnion(shape, next);
          shape = result.shape;
        }
        return shape;
      }
      return ocService.brepToOCShape(el.brep, el.position);
    };

    let resultShape = await elementToShape(selectedElementsData[0]);

    for (let i = 1; i < selectedElementsData.length; i++) {
      const nextShape = await elementToShape(selectedElementsData[i]);
      const result = await ocService.booleanUnion(resultShape, nextShape);
      resultShape = result.shape;
    }

    if (!resultShape) {
      throw new Error("Union operation failed - no result shape");
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

    const unifiedBrep = await ocService.ocShapeToBRep(resultShape);

    // keep originals for potential ungroup
    const originalBreps = brepsToUnion.map((item) => item.brep);
    const compound = new CompoundBrep(originalBreps);
    compound.setUnifiedBrep(unifiedBrep);

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
      ...elements.filter((el) => !selectedElements.includes(el.nodeId)),
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
