import { Face, Vertex, Edge, Brep } from "../geometry";
import * as THREE from "three";

export function extrudeThreeJsObject(
  originalObject: THREE.Mesh,
  extrusionDepth: number,
  direction: number
): THREE.Mesh {
  // Get original geometry and material
  const originalGeometry = originalObject.geometry;
  const originalMaterial = originalObject.material;
  let newGeometry: THREE.BufferGeometry;
  const originalPosition = originalObject.position.clone();

  // Handle specific geometry types
  if (originalGeometry instanceof THREE.PlaneGeometry) {
    // For planes, create a box with the same width/height
    const params = originalGeometry.parameters;
    newGeometry = new THREE.BoxGeometry(
      params.width,
      params.height,
      Math.abs(extrusionDepth)
    );
  } else if (originalGeometry instanceof THREE.CircleGeometry) {
    // For circles, create a cylinder
    const params = originalGeometry.parameters;
    newGeometry = new THREE.CylinderGeometry(
      params.radius,
      params.radius,
      Math.abs(extrusionDepth),
      params.segments
    );

    // Rotate to match circle orientation
    newGeometry.rotateX(Math.PI / 2);
  } else if (originalGeometry instanceof THREE.ShapeGeometry) {
    // For ShapeGeometry (used for custom 2D shapes), use ExtrudeGeometry

    // Extract the shape from the original geometry
    // This is the key part - we need to recreate the original 2D shape
    const shape = new THREE.Shape();

    // Get vertices from the original geometry
    const positions = originalGeometry.attributes.position;
    const uniquePoints = new Map<string, THREE.Vector2>();

    // Extract unique points from the vertices (in local coordinates)
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const key = `${x.toFixed(4)},${y.toFixed(4)}`;
      uniquePoints.set(key, new THREE.Vector2(x, y));
    }

    // Convert to array and sort points clockwise around center
    const points = Array.from(uniquePoints.values());
    const center = new THREE.Vector2();
    points.forEach((p) => center.add(p));
    center.divideScalar(points.length);

    // Sort clockwise
    points.sort((a, b) => {
      const angleA = Math.atan2(a.y - center.y, a.x - center.x);
      const angleB = Math.atan2(b.y - center.y, b.x - center.x);
      return angleA - angleB;
    });

    // Create the shape path
    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(points[i].x, points[i].y);
    }
    shape.closePath();

    // Create extruded geometry
    newGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.abs(extrusionDepth),
      bevelEnabled: false,
    });
  } else {
    // Fallback for other geometry types - use THREE.ExtrudeGeometry
    console.warn(
      "Using fallback extrusion for geometry type:",
      originalGeometry.type
    );

    // Try to extract a shape from the geometry
    // This is a simplified approach and may not work for all geometries
    const positions = originalGeometry.attributes.position;
    const shape = new THREE.Shape();

    // Find points on the XY plane (assuming Z is near zero for 2D shapes)
    const xyPoints: THREE.Vector2[] = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);

      if (Math.abs(z) < 0.01) {
        // Only consider points near the XY plane
        xyPoints.push(new THREE.Vector2(x, y));
      }
    }

    // Remove duplicate points
    const uniquePoints = new Map<string, THREE.Vector2>();
    xyPoints.forEach((p) => {
      const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      uniquePoints.set(key, p);
    });

    // Convert to array
    const points = Array.from(uniquePoints.values());

    // Need at least 3 points
    if (points.length >= 3) {
      // Sort points to form a valid shape (convex hull or similar)
      // For simplicity, sort by angle around the center
      const center = new THREE.Vector2();
      points.forEach((p) => center.add(p));
      center.divideScalar(points.length);

      // Sort clockwise
      points.sort((a, b) => {
        const angleA = Math.atan2(a.y - center.y, a.x - center.x);
        const angleB = Math.atan2(b.y - center.y, b.x - center.x);
        return angleA - angleB;
      });

      // Create shape
      shape.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i].x, points[i].y);
      }
      shape.closePath();

      // Create extruded geometry
      newGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: Math.abs(extrusionDepth),
        bevelEnabled: false,
      });
    } else {
      // Fallback to a simple box if we can't extract a shape
      newGeometry = new THREE.BoxGeometry(1, 1, Math.abs(extrusionDepth));
    }
  }

  // Create new mesh with the extruded geometry
  const extrudedMesh = new THREE.Mesh(newGeometry, originalMaterial);

  // Copy transform properties
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

  // Offset original vertices to center them
  const centerOffset = direction > 0 ? -halfDepth : halfDepth;
  // Create new vertices at extruded position
  const extrudedVertices = brep.vertices.map(
    (v) => new Vertex(v.x, v.y, v.z + centerOffset)
  );

  // Combine original and extruded vertices
  const allVertices = [...brep.vertices, ...extrudedVertices];

  // Create edges along extrusion direction
  const extrusionEdges = brep.vertices.map(
    (v, i) => new Edge(v, extrudedVertices[i])
  );

  // Create edges for the extruded face
  const extrudedFaceEdges = brep.edges
    .map((edge, i) => {
      // Find the indices of the original vertices
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

      // Create an edge between the corresponding extruded vertices
      return new Edge(extrudedVertices[startIndex], extrudedVertices[endIndex]);
    })
    .filter((edge): edge is Edge => edge !== null);

  // All edges
  const allEdges = [...brep.edges, ...extrusionEdges, ...extrudedFaceEdges];

  // Create faces for the sides
  const sideFaces: Face[] = [];

  // For each edge in the original face, create a side face
  brep.edges.forEach((edge, i) => {
    // Find corresponding indices
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

    // Create a quad face for this side
    // Order vertices correctly based on direction
    const sideVertices =
      direction > 0
        ? [
            edge.start,
            edge.end,
            extrudedVertices[endIndex],
            extrudedVertices[startIndex],
          ]
        : [
            edge.start,
            extrudedVertices[startIndex],
            extrudedVertices[endIndex],
            edge.end,
          ];

    sideFaces.push(new Face(sideVertices));
  });

  // Create the extruded face (with vertices in reverse order if needed)
  const originalFaceVertices = brep.faces[0].vertices;
  const extrudedFaceVertices = originalFaceVertices.map(
    (_, i) =>
      extrudedVertices[
        brep.vertices.findIndex(
          (v) =>
            v.x === originalFaceVertices[i].x &&
            v.y === originalFaceVertices[i].y &&
            v.z === originalFaceVertices[i].z
        )
      ]
  );

  // Reverse the order for correct orientation based on direction
  if (direction < 0) {
    extrudedFaceVertices.reverse();
  }

  const extrudedFace = new Face(extrudedFaceVertices);

  // All faces
  const allFaces = [...brep.faces, ...sideFaces, extrudedFace];

  return new Brep(allVertices, allEdges, allFaces);
}
