import { Face, Vertex, Edge, Brep } from "../geometry";
import * as THREE from "three";

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

export function extrudeBRep(
  brep: Brep,
  extrusionDepth: number,
  direction: number
): Brep {
  // Only extrude if we have faces and vertices
  if (!brep.faces.length || !brep.vertices.length) {
    return brep;
  }

  // Check if it's already a 3D brep
  const zValues = brep.vertices.map((v) => v.z);
  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);
  const isFlat = Math.abs(maxZ - minZ) < 0.01;

  if (!isFlat) {
    console.warn("Attempted to extrude a non-flat BRep");
    return brep;
  }

  // Calculate half depth to center the result
  const halfDepth = extrusionDepth / 2;

  // To center the extruded shape, we need to offset both top and bottom faces
  // For positive direction: original face moves to +halfDepth, extruded face to -halfDepth
  // For negative direction: original face moves to -halfDepth, extruded face to +halfDepth
  const originalOffset = direction > 0 ? halfDepth : -halfDepth;
  const extrudedOffset = direction > 0 ? -halfDepth : halfDepth;

  // Offset original vertices
  const offsetOriginalVertices = brep.vertices.map(
    (v) => new Vertex(v.x, v.y, v.z + originalOffset)
  );

  // Create new vertices at extruded position
  const extrudedVertices = brep.vertices.map(
    (v) => new Vertex(v.x, v.y, v.z + extrudedOffset)
  );

  // Combine all vertices (offset originals + extruded)
  const allVertices = [...offsetOriginalVertices, ...extrudedVertices];

  // Create edges for the offset original face (top face)
  const offsetOriginalEdges = brep.edges.map((edge) => {
    const startIndex = brep.vertices.findIndex(
      (v) => v.x === edge.start.x && v.y === edge.start.y && v.z === edge.start.z
    );
    const endIndex = brep.vertices.findIndex(
      (v) => v.x === edge.end.x && v.y === edge.end.y && v.z === edge.end.z
    );
    return new Edge(offsetOriginalVertices[startIndex], offsetOriginalVertices[endIndex]);
  });

  // Create edges along extrusion direction (connecting top and bottom)
  const extrusionEdges = offsetOriginalVertices.map(
    (v, i) => new Edge(v, extrudedVertices[i])
  );

  // Create edges for the extruded face (bottom face)
  const extrudedFaceEdges = brep.edges
    .map((edge) => {
      const startIndex = brep.vertices.findIndex(
        (v) =>
          v.x === edge.start.x && v.y === edge.start.y && v.z === edge.start.z
      );
      const endIndex = brep.vertices.findIndex(
        (v) => v.x === edge.end.x && v.y === edge.end.y && v.z === edge.end.z
      );

      if (startIndex === -1 || endIndex === -1) {
        console.error("Could not find edge vertices");
        return null;
      }

      return new Edge(extrudedVertices[startIndex], extrudedVertices[endIndex]);
    })
    .filter((edge): edge is Edge => edge !== null);

  // All edges
  const allEdges = [...offsetOriginalEdges, ...extrusionEdges, ...extrudedFaceEdges];

  // Create faces for the sides
  const sideFaces: Face[] = [];

  // For each edge in the original face, create a side face
  brep.edges.forEach((edge) => {
    const startIndex = brep.vertices.findIndex(
      (v) =>
        v.x === edge.start.x && v.y === edge.start.y && v.z === edge.start.z
    );
    const endIndex = brep.vertices.findIndex(
      (v) => v.x === edge.end.x && v.y === edge.end.y && v.z === edge.end.z
    );

    if (startIndex === -1 || endIndex === -1) {
      return;
    }

    // Create a quad face for this side using offset original and extruded vertices
    const sideVertices =
      direction > 0
        ? [
            offsetOriginalVertices[startIndex],
            offsetOriginalVertices[endIndex],
            extrudedVertices[endIndex],
            extrudedVertices[startIndex],
          ]
        : [
            offsetOriginalVertices[startIndex],
            extrudedVertices[startIndex],
            extrudedVertices[endIndex],
            offsetOriginalVertices[endIndex],
          ];

    sideFaces.push(new Face(sideVertices));
  });

  // Create the top face (offset original face)
  const originalFaceVertices = brep.faces[0].vertices;
  const topFaceVertices = originalFaceVertices.map((v) => {
    const index = brep.vertices.findIndex(
      (bv) => bv.x === v.x && bv.y === v.y && bv.z === v.z
    );
    return offsetOriginalVertices[index];
  });
  const topFace = new Face(topFaceVertices);

  // Create the bottom face (extruded face with reversed winding)
  const bottomFaceVertices = originalFaceVertices.map((v) => {
    const index = brep.vertices.findIndex(
      (bv) => bv.x === v.x && bv.y === v.y && bv.z === v.z
    );
    return extrudedVertices[index];
  });

  // Reverse the order for correct orientation based on direction
  if (direction > 0) {
    bottomFaceVertices.reverse();
  }

  const bottomFace = new Face(bottomFaceVertices);

  // All faces: top, bottom, and sides
  const allFaces = [topFace, bottomFace, ...sideFaces];

  return new Brep(allVertices, allEdges, allFaces);
}
