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

    let resultShape;

    if (brepsToUnion.length >= 1) {
      resultShape = await ocService.brepToOCShape(
        brepsToUnion[0].brep,
        brepsToUnion[0].position,
      );

      for (let i = 1; i < brepsToUnion.length; i++) {
        const nextShape = await ocService.brepToOCShape(
          brepsToUnion[i].brep,
          brepsToUnion[i].position,
        );
        const result = await ocService.booleanUnion(resultShape, nextShape);

        resultShape = result.shape;
      }
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
    const resultGeometry = await ocService.shapeToThreeGeometry(resultShape, 0.05, 0.3);
    const resultEdgeGeometry = await ocService.shapeToEdgeLineSegments(resultShape, 0.05);
    // Center geometry to match BRep centering pattern
    resultGeometry.translate(-worldCenter.x, -worldCenter.y, -worldCenter.z);
    resultEdgeGeometry.translate(-worldCenter.x, -worldCenter.y, -worldCenter.z);

    const unionMesh = createMeshFromGeometry(resultGeometry, resultEdgeGeometry);
    unionMesh.position.set(0, 0, 0);

    const unionGroup = new THREE.Group();
    unionGroup.userData = { nodeId };
    unionGroup.add(unionMesh);
    unionGroup.position.copy(worldCenter);

    const newElement = {
      brep: compound,
      nodeId,
      position: worldCenter,
      selected: false,
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
