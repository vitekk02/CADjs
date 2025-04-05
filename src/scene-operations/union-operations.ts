import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
import { SceneElement } from "./types";
import { createMeshFromBrep } from "./mesh-operations";
import { OpenCascadeService } from "../services/OpenCascadeService";

export async function unionSelectedElements(
  elements: SceneElement[],
  selectedElements: string[],
  idCounter: number,
  brepGraph: BrepGraph,
  objectsMap: Map<string, THREE.Object3D>
): Promise<{
  updatedElements: SceneElement[];
  updatedSelectedElements: string[];
  nextIdCounter: number;
}> {
  if (selectedElements.length < 2) {
    return {
      updatedElements: elements,
      updatedSelectedElements: selectedElements,
      nextIdCounter: idCounter,
    };
  }

  // Get selected elements data
  const selectedElementsData = elements.filter((el) =>
    selectedElements.includes(el.nodeId)
  );
  const selectedNodeIds = [...selectedElements];

  // Create an array to hold BReps and their positions
  const brepsToUnion: { brep: Brep; position: THREE.Vector3 }[] = [];

  // Collect all breps with their positions
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
    // Get OpenCascade service
    const ocService = OpenCascadeService.getInstance();
    const oc = await ocService.getOC();

    // Initialize variables to hold shapes
    let resultShape;

    console.log(
      "Available vector constructors:",
      Object.keys(oc).filter((key) => key.startsWith("gp_Vec"))
    );
    // Process each brep
    console.log("Breps to union:", brepsToUnion);

    if (brepsToUnion.length >= 1) {
      // Start with the first shape
      resultShape = await ocService.brepToOCShape(
        brepsToUnion[0].brep,
        brepsToUnion[0].position
      );

      // Union with subsequent shapes
      for (let i = 1; i < brepsToUnion.length; i++) {
        const nextShape = await ocService.brepToOCShape(
          brepsToUnion[i].brep,
          brepsToUnion[i].position
        );
        const result = await ocService.booleanUnion(resultShape, nextShape);

        resultShape = result.shape;
      }
    }

    if (!resultShape) {
      throw new Error("Union operation failed - no result shape");
    }

    console.log("Result shape:", resultShape);

    // Convert the unified shape back to our BRep format
    const unifiedBrep = await ocService.ocShapeToBRep(resultShape);
    console.log("Unified BRep:", unifiedBrep);

    // Create a compound that contains both the original breps (for ungroup) and the unified brep
    const originalBreps = brepsToUnion.map((item) => item.brep);
    const compound = new CompoundBrep(originalBreps);
    compound.setUnifiedBrep(unifiedBrep);

    const nextId = idCounter + 1;
    const nodeId = `node_${nextId}`;

    // Add to graph
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

    // Create mesh from the unified BRep
    const unionMesh = createMeshFromBrep(unifiedBrep);
    unionMesh.position.set(0, 0, 0);

    // Calculate the geometric center of the mesh
    const geometry = unionMesh.geometry;
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    const center = new THREE.Vector3();
    boundingBox?.getCenter(center);

    // Re-center the geometry itself
    const positionAttribute = geometry.getAttribute("position");
    for (let i = 0; i < positionAttribute.count; i++) {
      const x = positionAttribute.getX(i) - center.x;
      const y = positionAttribute.getY(i) - center.y;
      const z = positionAttribute.getZ(i) - center.z;
      positionAttribute.setXYZ(i, x, y, z);
    }
    positionAttribute.needsUpdate = true;

    // Update scene object and element
    const unionGroup = new THREE.Group();
    unionGroup.userData = { nodeId };
    unionGroup.add(unionMesh);
    unionGroup.position.copy(center); // Position at the calculated center

    const newElement = {
      brep: compound,
      nodeId,
      position: center,
      selected: false,
    };

    // Update maps and clean up
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
    console.error("Error in OpenCascade union operation:", error);

    // Fallback to the original implementation if OpenCascade fails
    const compound = new CompoundBrep(brepsToUnion.map((item) => item.brep));
    const nextId = idCounter + 1;
    const nodeId = `node_${nextId}`;

    // Add to graph
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

    // Create mesh using the simple method
    const unionMesh = createMeshFromBrep(compound);
    unionMesh.position.set(0, 0, 0);

    // Calculate center
    const geometry = unionMesh.geometry;
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;

    if (!boundingBox) {
      console.error("Failed to compute bounding box");
      return {
        updatedElements: elements,
        updatedSelectedElements: selectedElements,
        nextIdCounter: idCounter,
      };
    }

    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    // Re-center mesh
    const positionAttribute = geometry.getAttribute("position");
    for (let i = 0; i < positionAttribute.count; i++) {
      const x = positionAttribute.getX(i) - center.x;
      const y = positionAttribute.getY(i) - center.y;
      const z = positionAttribute.getZ(i) - center.z;
      positionAttribute.setXYZ(i, x, y, z);
    }
    positionAttribute.needsUpdate = true;

    // Recompute bounding data
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // Create group with mesh
    const unionGroup = new THREE.Group();
    unionGroup.userData = { nodeId };
    unionGroup.add(unionMesh);
    unionGroup.position.copy(center);

    // Create new element
    const newElement = {
      brep: compound,
      nodeId,
      position: center,
      selected: false,
    };

    // Update maps and clean up
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
  }
}
