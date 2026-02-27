import { Brep } from "../geometry";
import * as THREE from "three";
import { OpenCascadeService } from "../services/OpenCascadeService";

export function extrudeThreeJsObject(
  originalObject: THREE.Mesh,
  extrusionDepth: number,
  direction: number
): THREE.Mesh {
  const originalGeometry = originalObject.geometry;
  const originalMaterial = originalObject.material;
  let newGeometry: THREE.BufferGeometry;
  const originalPosition = originalObject.position.clone();

  if (originalGeometry instanceof THREE.PlaneGeometry) {
    const params = originalGeometry.parameters;
    newGeometry = new THREE.BoxGeometry(
      params.width,
      params.height,
      Math.abs(extrusionDepth)
    );
  } else if (originalGeometry instanceof THREE.CircleGeometry) {
    const params = originalGeometry.parameters;
    newGeometry = new THREE.CylinderGeometry(
      params.radius,
      params.radius,
      Math.abs(extrusionDepth),
      params.segments
    );

    newGeometry.rotateX(Math.PI / 2);
  } else if (originalGeometry instanceof THREE.ShapeGeometry) {
    const shape = new THREE.Shape();
    const positions = originalGeometry.attributes.position;
    const uniquePoints = new Map<string, THREE.Vector2>();

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const key = `${x.toFixed(4)},${y.toFixed(4)}`;
      uniquePoints.set(key, new THREE.Vector2(x, y));
    }

    const points = Array.from(uniquePoints.values());
    const center = new THREE.Vector2();
    points.forEach((p) => center.add(p));
    center.divideScalar(points.length);

    points.sort((a, b) => {
      const angleA = Math.atan2(a.y - center.y, a.x - center.x);
      const angleB = Math.atan2(b.y - center.y, b.x - center.x);
      return angleA - angleB;
    });

    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(points[i].x, points[i].y);
    }
    shape.closePath();

    newGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.abs(extrusionDepth),
      bevelEnabled: false,
    });
  } else {
    // fallback for other geometry types
    console.warn("fallback extrusion:", originalGeometry.type);

    const positions = originalGeometry.attributes.position;
    const shape = new THREE.Shape();
    const xyPoints: THREE.Vector2[] = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);

      if (Math.abs(z) < 0.01) {
        xyPoints.push(new THREE.Vector2(x, y));
      }
    }

    const uniquePoints = new Map<string, THREE.Vector2>();
    xyPoints.forEach((p) => {
      const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      uniquePoints.set(key, p);
    });

    const points = Array.from(uniquePoints.values());

    if (points.length >= 3) {
      const center = new THREE.Vector2();
      points.forEach((p) => center.add(p));
      center.divideScalar(points.length);

      points.sort((a, b) => {
        const angleA = Math.atan2(a.y - center.y, a.x - center.x);
        const angleB = Math.atan2(b.y - center.y, b.x - center.x);
        return angleA - angleB;
      });

      shape.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i].x, points[i].y);
      }
      shape.closePath();

      newGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: Math.abs(extrusionDepth),
        bevelEnabled: false,
      });
    } else {
      newGeometry = new THREE.BoxGeometry(1, 1, Math.abs(extrusionDepth));
    }
  }

  const extrudedMesh = new THREE.Mesh(newGeometry, originalMaterial);

  extrudedMesh.position.copy(originalPosition);
  extrudedMesh.rotation.copy(originalObject.rotation);
  extrudedMesh.scale.x = originalObject.scale.x;
  extrudedMesh.scale.y = originalObject.scale.y;

  // if (direction > 0) {
  //   // When extruding in positive direction, move back to maintain position of bottom face
  //   // Adjust the geometry rather than the object position
  //   extrudedMesh.geometry.translate(0, 0, extrusionDepth / 2);
  // } else {
  //   // When extruding in negative direction, we need to adjust after the rotation
  //   // Since the mesh has been rotated 180° around X axis, we need to
  //   // adjust the geometry to maintain the original face position
  //   extrudedMesh.geometry.translate(0, 0, -extrusionDepth / 2);
  // }

  return extrudedMesh;
}

/**
 * Result of extrusion operation, including position offset for the new center.
 */
export interface ExtrusionResult {
  brep: Brep;
  /** Position offset to apply to element.position to account for new center */
  positionOffset: { x: number; y: number; z: number };
  edgeGeometry?: THREE.BufferGeometry;
}

/**
 * Extrude a flat BRep into a 3D solid using OpenCascade's BRepPrimAPI_MakePrism.
 *
 * The result BRep is CENTERED (architecture requirement), and a position
 * offset is returned so the caller can update the element's world position.
 *
 * @param brep - The flat BRep to extrude (centered, flat along any axis)
 * @param extrusionDepth - The depth to extrude
 * @param direction - Direction: 1 for positive, -1 for negative along the flat normal
 * @returns Promise resolving to the extruded BRep and position offset
 */
export async function extrudeBRep(
  brep: Brep,
  extrusionDepth: number,
  direction: number
): Promise<ExtrusionResult> {
  // Only extrude if we have faces and vertices
  if (!brep.faces.length || !brep.vertices.length) {
    return { brep, positionOffset: { x: 0, y: 0, z: 0 } };
  }

  // Detect which axis the shape is flat along
  const xs = brep.vertices.map((v) => v.x);
  const ys = brep.vertices.map((v) => v.y);
  const zs = brep.vertices.map((v) => v.z);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  const rangeY = Math.max(...ys) - Math.min(...ys);
  const rangeZ = Math.max(...zs) - Math.min(...zs);

  let normal: { x: number; y: number; z: number };
  if (rangeX < 0.01) {
    normal = { x: 1, y: 0, z: 0 };
  } else if (rangeY < 0.01) {
    normal = { x: 0, y: 1, z: 0 };
  } else if (rangeZ < 0.01) {
    normal = { x: 0, y: 0, z: 1 };
  } else {
    console.warn("Attempted to extrude a non-flat BRep");
    return { brep, positionOffset: { x: 0, y: 0, z: 0 } };
  }

  try {
    const ocService = OpenCascadeService.getInstance();

    // Build a clean planar face from the BRep's boundary edges
    // (The stored BRep is tessellated into triangles, not suitable for direct extrusion)
    const cleanFace = await ocService.buildPlanarFaceFromBoundary(brep);

    if (!cleanFace) {
      console.error("Failed to build clean face from BRep boundary");
      return { brep, positionOffset: { x: 0, y: 0, z: 0 } };
    }

    // Extrude using OpenCascade's BRepPrimAPI_MakePrism along the flat normal
    const extrudedShape = await ocService.extrudeShape(
      cleanFace,
      extrusionDepth,
      direction,
      normal
    );

    // Convert back to BRep WITH centering - architecture requires centered BReps
    const centeredBrep = await ocService.ocShapeToBRep(extrudedShape, true);

    // Extract clean topological edges from OCC shape
    const edgeGeometry = await ocService.shapeToEdgeLineSegments(extrudedShape, 0.05);

    // Position offset along the extrusion normal
    const halfOffset = (extrusionDepth / 2) * direction;
    const positionOffset = {
      x: normal.x * halfOffset,
      y: normal.y * halfOffset,
      z: normal.z * halfOffset,
    };

    // Translate edge geometry to local space (centered)
    edgeGeometry.translate(
      -normal.x * halfOffset,
      -normal.y * halfOffset,
      -normal.z * halfOffset,
    );

    return { brep: centeredBrep, positionOffset, edgeGeometry };
  } catch (error) {
    console.error("OpenCascade extrusion failed:", error);
    // Return original BRep on failure
    return { brep, positionOffset: { x: 0, y: 0, z: 0 } };
  }
}
