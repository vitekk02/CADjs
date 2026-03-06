import { Brep } from "../geometry";
import { transformBrepVertices } from "../convertBRepToGeometry";
import * as THREE from "three";
import { OpenCascadeService } from "../services/OpenCascadeService";

export type RevolveDirection = "one" | "two" | "symmetric";

export interface RevolveResult {
  brep: Brep;
  positionOffset: { x: number; y: number; z: number };
  edgeGeometry?: THREE.BufferGeometry;
  vertexPositions?: Float32Array;
  occBrep?: string;
  faceGeometry?: THREE.BufferGeometry;
  errorReason?: string;
}

/**
 * Detect face vertices lying on the revolution axis and offset them by a tiny epsilon
 * toward the face interior. This works around an OCC limitation where BRepPrimAPI_MakeRevol
 * fails when an edge lies exactly on the axis (OCCT Bug #28003 / IsInvariant problem).
 *
 * Returns a rebuilt face with offset vertices, or null if no fix is needed/possible.
 */
async function offsetOnAxisVertices(
  face: any,
  axisOrigin: { x: number; y: number; z: number },
  axisDir: { x: number; y: number; z: number },
  oc: any,
): Promise<any | null> {
  const AXIS_TOL = 1e-6;
  const OFFSET_EPS = 1e-5;

  // 1. Gather all vertices, classify as on-axis or off-axis
  const vertexExplorer = new oc.TopExp_Explorer_2(
    face,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  const axisPnt = new oc.gp_Pnt_3(axisOrigin.x, axisOrigin.y, axisOrigin.z);
  const axisDirection = new oc.gp_Dir_4(axisDir.x, axisDir.y, axisDir.z);
  const axisAx1 = new oc.gp_Ax1_2(axisPnt, axisDirection);
  const axisLin = new oc.gp_Lin_2(axisAx1);

  const onAxis: { x: number; y: number; z: number }[] = [];
  const offAxis: { x: number; y: number; z: number }[] = [];

  while (vertexExplorer.More()) {
    const vertex = oc.TopoDS.Vertex_1(vertexExplorer.Current());
    const pnt = oc.BRep_Tool.Pnt(vertex);
    const x = pnt.X(), y = pnt.Y(), z = pnt.Z();
    pnt.delete();

    const testPnt = new oc.gp_Pnt_3(x, y, z);
    const dist = axisLin.Distance_1(testPnt);
    testPnt.delete();

    if (dist < AXIS_TOL) {
      // Deduplicate on-axis vertices (same vertex may appear multiple times)
      const isDup = onAxis.some(
        v => Math.abs(v.x - x) < 1e-10 && Math.abs(v.y - y) < 1e-10 && Math.abs(v.z - z) < 1e-10,
      );
      if (!isDup) onAxis.push({ x, y, z });
    } else {
      const isDup = offAxis.some(
        v => Math.abs(v.x - x) < 1e-10 && Math.abs(v.y - y) < 1e-10 && Math.abs(v.z - z) < 1e-10,
      );
      if (!isDup) offAxis.push({ x, y, z });
    }
    vertexExplorer.Next();
  }
  vertexExplorer.delete();
  axisPnt.delete();
  axisDirection.delete();
  axisAx1.delete();
  axisLin.delete();

  // No on-axis vertices, or ALL vertices on-axis → no fix needed/possible
  if (onAxis.length === 0 || offAxis.length === 0) {
    return null;
  }

  // 2. Compute offset direction: centroid of off-axis vertices → perpendicular to axis
  const centroid = {
    x: offAxis.reduce((s, v) => s + v.x, 0) / offAxis.length,
    y: offAxis.reduce((s, v) => s + v.y, 0) / offAxis.length,
    z: offAxis.reduce((s, v) => s + v.z, 0) / offAxis.length,
  };

  // Vector from axis to centroid: project centroid onto axis, subtract
  const toC = {
    x: centroid.x - axisOrigin.x,
    y: centroid.y - axisOrigin.y,
    z: centroid.z - axisOrigin.z,
  };
  const dotAlongAxis = toC.x * axisDir.x + toC.y * axisDir.y + toC.z * axisDir.z;
  const perpendicular = {
    x: toC.x - dotAlongAxis * axisDir.x,
    y: toC.y - dotAlongAxis * axisDir.y,
    z: toC.z - dotAlongAxis * axisDir.z,
  };
  const perpLen = Math.sqrt(perpendicular.x ** 2 + perpendicular.y ** 2 + perpendicular.z ** 2);
  if (perpLen < 1e-12) {
    return null; // centroid is on the axis — can't determine offset direction
  }
  const offsetDir = {
    x: perpendicular.x / perpLen,
    y: perpendicular.y / perpLen,
    z: perpendicular.z / perpLen,
  };

  // 3. Build a map from original vertex coords to adjusted coords
  const adjustMap = new Map<string, { x: number; y: number; z: number }>();
  for (const v of onAxis) {
    const key = `${v.x.toFixed(10)},${v.y.toFixed(10)},${v.z.toFixed(10)}`;
    adjustMap.set(key, {
      x: v.x + OFFSET_EPS * offsetDir.x,
      y: v.y + OFFSET_EPS * offsetDir.y,
      z: v.z + OFFSET_EPS * offsetDir.z,
    });
  }

  // 4. Walk the outer wire in order, collect adjusted vertex coordinates
  const outerWire = oc.BRepTools.OuterWire(oc.TopoDS.Face_1(face));
  const wireExplorer = new oc.BRepTools_WireExplorer_2(outerWire);
  const wirePoints: { x: number; y: number; z: number }[] = [];

  while (wireExplorer.More()) {
    const vertex = wireExplorer.CurrentVertex();
    const pnt = oc.BRep_Tool.Pnt(vertex);
    const x = pnt.X(), y = pnt.Y(), z = pnt.Z();
    pnt.delete();

    const key = `${x.toFixed(10)},${y.toFixed(10)},${z.toFixed(10)}`;
    const adjusted = adjustMap.get(key);
    wirePoints.push(adjusted ?? { x, y, z });
    wireExplorer.Next();
  }
  wireExplorer.delete();

  if (wirePoints.length < 3) {
    return null;
  }

  // 5. Rebuild wire and face from adjusted points
  const makeWire = new oc.BRepBuilderAPI_MakeWire_1();

  for (let i = 0; i < wirePoints.length; i++) {
    const p1 = wirePoints[i];
    const p2 = wirePoints[(i + 1) % wirePoints.length];
    const gp1 = new oc.gp_Pnt_3(p1.x, p1.y, p1.z);
    const gp2 = new oc.gp_Pnt_3(p2.x, p2.y, p2.z);
    const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(gp1, gp2);
    if (edgeBuilder.IsDone()) {
      makeWire.Add_1(edgeBuilder.Edge());
    }
    gp1.delete();
    gp2.delete();
    edgeBuilder.delete();
  }

  if (!makeWire.IsDone()) {
    makeWire.delete();
    return null;
  }

  const wire = makeWire.Wire();
  makeWire.delete();

  const makeFace = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
  if (!makeFace.IsDone()) {
    makeFace.delete();
    return null;
  }

  const newFace = makeFace.Face();
  makeFace.delete();
  return newFace;
}

/**
 * Revolve a flat BRep profile around an axis to create a solid of revolution.
 *
 * 1. Build clean planar face from profile BRep boundary (raw BRep coords)
 * 2. Translate face to position frame (same frame as the edge overlay axis)
 * 3. Revolve positioned face around the axis via OCC MakeRevol
 * 4. Get uncentered BRep, compute bounding box center = positionOffset
 * 5. Center BRep at origin via transformBrepVertices
 * 6. positionOffset = localCenter − profilePosition (converts absolute → relative)
 * 7. Caller applies: newPosition = profilePosition + positionOffset = localCenter
 */
export async function revolveBRep(
  profileBrep: Brep,
  profilePosition: THREE.Vector3,
  axisOrigin: { x: number; y: number; z: number },
  axisDir: { x: number; y: number; z: number },
  angleRadians?: number,
  sourceOccBrep?: string,
  direction: RevolveDirection = "one",
  angleRadians2?: number,
): Promise<RevolveResult> {
  if (!profileBrep.faces.length) {
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
  }

  try {
    const ocService = OpenCascadeService.getInstance();

    // 1. Build a clean planar face (at raw BRep coords — brepCenter frame)
    // Prefer deserializing sourceOccBrep (preserves analytic geometry like circles),
    // fall back to extracting boundary from tessellated BRep.
    let cleanFace;
    if (sourceOccBrep) {
      try {
        cleanFace = await ocService.deserializeShape(sourceOccBrep);
        // Ensure we have a Face, not a Shell/Compound wrapping one.
        // BRepBuilderAPI_Transform with copyGeom=true can change shape type
        // (e.g. Face → Shell), and BRepPrimAPI_MakeRevol requires a Face.
        if (cleanFace) {
          const oc2 = await ocService.getOC();
          if (cleanFace.ShapeType() !== oc2.TopAbs_ShapeEnum.TopAbs_FACE) {
            const explorer = new oc2.TopExp_Explorer_2(
              cleanFace,
              oc2.TopAbs_ShapeEnum.TopAbs_FACE,
              oc2.TopAbs_ShapeEnum.TopAbs_SHAPE,
            );
            if (explorer.More()) {
              cleanFace = oc2.TopoDS.Face_1(explorer.Current());
            } else {
              cleanFace = null;
            }
            explorer.delete();
          }
        }
      } catch {
        cleanFace = null;
      }
    }
    if (!cleanFace) {
      cleanFace = await ocService.buildPlanarFaceFromBoundary(profileBrep);
    }
    if (!cleanFace) {
      console.error("[revolveBRep] Failed to build clean face from profile");
      return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 }, errorReason: "Failed to build clean face from profile" };
    }

    // 2. Translate face from raw-BRep-coords frame to position frame.
    //
    // buildPlanarFaceFromBoundary calls brepToOCShape(brep) WITHOUT position,
    // so the face vertices are at raw BRep coords (centered at brepCenter).
    //
    // The axis comes from the edge overlay which uses
    // brepToOCShape(brep, element.position), so overlay coords are in
    // the "position frame" (vertices shifted from brepCenter → position).
    //
    // To put both in the same frame, translate the face by (position - brepCenter).
    const bxs = profileBrep.vertices.map(v => v.x);
    const bys = profileBrep.vertices.map(v => v.y);
    const bzs = profileBrep.vertices.map(v => v.z);
    const brepCenter = {
      x: (Math.min(...bxs) + Math.max(...bxs)) / 2,
      y: (Math.min(...bys) + Math.max(...bys)) / 2,
      z: (Math.min(...bzs) + Math.max(...bzs)) / 2,
    };

    const dx = profilePosition.x - brepCenter.x;
    const dy = profilePosition.y - brepCenter.y;
    const dz = profilePosition.z - brepCenter.z;

    const oc = await ocService.getOC();
    let positionedFace = cleanFace;

    // Only translate if shift is non-trivial
    if (Math.abs(dx) > 1e-10 || Math.abs(dy) > 1e-10 || Math.abs(dz) > 1e-10) {
      const trsf = new oc.gp_Trsf_1();
      const shiftVec = new oc.gp_Vec_4(dx, dy, dz);
      trsf.SetTranslation_1(shiftVec);
      shiftVec.delete();
      const transformer = new oc.BRepBuilderAPI_Transform_2(cleanFace, trsf, false);
      trsf.delete();
      positionedFace = transformer.Shape();
      transformer.delete();
    }

    // 2b. Pre-validate: check that the profile doesn't cross the revolution axis.
    //     Vertices ON the axis are fine (degenerate edges → cones, spheres).
    //     Vertices on opposite sides → self-intersecting geometry → OCC fails.
    try {
      const axisPnt = new oc.gp_Pnt_3(axisOrigin.x, axisOrigin.y, axisOrigin.z);
      const axisDirection = new oc.gp_Dir_4(axisDir.x, axisDir.y, axisDir.z);
      const axisAx1 = new oc.gp_Ax1_2(axisPnt, axisDirection);
      const axisLin = new oc.gp_Lin_2(axisAx1);

      // Compute a perpendicular reference vector for sign testing
      // Pick any vertex that is off-axis as the reference
      const vertexExplorer = new oc.TopExp_Explorer_2(
        positionedFace,
        oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      const vertexPoints: { x: number; y: number; z: number; dist: number }[] = [];
      while (vertexExplorer.More()) {
        const vertex = oc.TopoDS.Vertex_1(vertexExplorer.Current());
        const pnt = oc.BRep_Tool.Pnt(vertex);
        const x = pnt.X(), y = pnt.Y(), z = pnt.Z();
        pnt.delete();
        const testPnt = new oc.gp_Pnt_3(x, y, z);
        const dist = axisLin.Distance_1(testPnt);
        testPnt.delete();
        vertexPoints.push({ x, y, z, dist });
        vertexExplorer.Next();
      }
      vertexExplorer.delete();

      // Check if vertices are on opposite sides of the axis using cross product sign
      const offAxisVerts = vertexPoints.filter(v => v.dist > 1e-6);
      if (offAxisVerts.length >= 2) {
        // Compute cross product (v - axisOrigin) × axisDir for each off-axis vertex
        // The sign of this cross product (projected onto any consistent direction) tells us which side
        const signs: number[] = [];
        for (const v of offAxisVerts) {
          const vx = v.x - axisOrigin.x;
          const vy = v.y - axisOrigin.y;
          const vz = v.z - axisOrigin.z;
          // Cross product: (v - origin) × axisDir
          const cx = vy * axisDir.z - vz * axisDir.y;
          const cy = vz * axisDir.x - vx * axisDir.z;
          const cz = vx * axisDir.y - vy * axisDir.x;
          // Use the first off-axis vertex's cross product as reference direction
          if (signs.length === 0) {
            signs.push(1); // reference is positive
          } else {
            // Dot with reference cross product to get sign
            const refV = offAxisVerts[0];
            const rvx = refV.x - axisOrigin.x;
            const rvy = refV.y - axisOrigin.y;
            const rvz = refV.z - axisOrigin.z;
            const rcx = rvy * axisDir.z - rvz * axisDir.y;
            const rcy = rvz * axisDir.x - rvx * axisDir.z;
            const rcz = rvx * axisDir.y - rvy * axisDir.x;
            const dot = cx * rcx + cy * rcy + cz * rcz;
            signs.push(dot >= 0 ? 1 : -1);
          }
        }

        const hasPositive = signs.some(s => s > 0);
        const hasNegative = signs.some(s => s < 0);
        if (hasPositive && hasNegative) {
          axisPnt.delete();
          axisDirection.delete();
          axisAx1.delete();
          axisLin.delete();
          return {
            brep: profileBrep,
            positionOffset: { x: 0, y: 0, z: 0 },
            errorReason: "Profile crosses the revolution axis — select an axis that doesn't intersect the profile",
          };
        }
      }

      axisPnt.delete();
      axisDirection.delete();
      axisAx1.delete();
      axisLin.delete();
    } catch (e) {
      // Pre-validation is best-effort — don't block the revolve if it fails
      console.warn("[revolveBRep] Axis-profile pre-validation failed:", e);
    }

    // Helper: attempt revolve, with fallbacks:
    //   1. Direct revolve of the face
    //   2. Rebuild face from boundary → revolve (fixes deserialized face issues)
    //   3. Micro-offset on-axis vertices → revolve (fixes OCC bug with edges on axis)
    const revolveWithFallback = async (
      face: any,
      origin: { x: number; y: number; z: number },
      dir: { x: number; y: number; z: number },
      angle?: number,
    ) => {
      try {
        return await ocService.revolveShape(face, origin, dir, angle);
      } catch (revolveError) {
        // Fallback 1: rebuild face from boundary
        if (sourceOccBrep) {
          console.warn("[revolveBRep] Revolve failed with deserialized face, retrying with boundary face...", revolveError);
          try {
            const fallbackFace = await ocService.buildPlanarFaceFromBoundary(profileBrep);
            if (fallbackFace) {
              // Translate fallback face to position frame (same transform as above)
              let positionedFallback = fallbackFace;
              if (Math.abs(dx) > 1e-10 || Math.abs(dy) > 1e-10 || Math.abs(dz) > 1e-10) {
                const trsf2 = new oc.gp_Trsf_1();
                const shiftVec2 = new oc.gp_Vec_4(dx, dy, dz);
                trsf2.SetTranslation_1(shiftVec2);
                shiftVec2.delete();
                const transformer2 = new oc.BRepBuilderAPI_Transform_2(fallbackFace, trsf2, false);
                trsf2.delete();
                positionedFallback = transformer2.Shape();
                transformer2.delete();
              }
              return await ocService.revolveShape(positionedFallback, origin, dir, angle);
            }
          } catch (boundaryError) {
            console.warn("[revolveBRep] Boundary face fallback also failed:", boundaryError);
          }
        }

        // Fallback 2: micro-offset on-axis vertices (OCC bug with edges on axis)
        console.warn("[revolveBRep] Trying on-axis vertex offset workaround...");
        try {
          const offsetFace = await offsetOnAxisVertices(face, origin, dir, oc);
          if (offsetFace) {
            return await ocService.revolveShape(offsetFace, origin, dir, angle);
          }
        } catch (offsetError) {
          console.warn("[revolveBRep] On-axis offset fallback also failed:", offsetError);
        }

        throw revolveError;
      }
    };

    // 3. Revolve — face and axis are both in position frame, no axis shift needed
    let revolvedShape;

    if (direction === "one") {
      // Single-direction revolve (original behavior)
      revolvedShape = await revolveWithFallback(
        positionedFace,
        axisOrigin,
        axisDir,
        angleRadians,
      );
    } else {
      // Two-sided or symmetric: revolve in both directions then fuse
      let angle1: number | undefined;
      let angle2: number | undefined;

      if (direction === "symmetric") {
        // Symmetric: split the angle equally both ways
        if (angleRadians !== undefined) {
          const halfAngle = angleRadians / 2;
          // If the full angle is 2*PI (360°), do a single full revolution
          if (Math.abs(angleRadians - 2 * Math.PI) < 1e-6) {
            angle1 = undefined; // full revolution
          } else {
            angle1 = halfAngle;
            angle2 = halfAngle;
          }
        }
        // angleRadians undefined = full revolution, single revolve is sufficient
      } else {
        // Two sides: independent angles
        angle1 = angleRadians;
        angle2 = angleRadians2;
        // If both angles sum to >= 2*PI, use a single full revolution
        const a1 = angle1 ?? 2 * Math.PI;
        const a2 = angle2 ?? 2 * Math.PI;
        if (a1 + a2 >= 2 * Math.PI - 1e-6) {
          angle1 = undefined; // full revolution
          angle2 = undefined;
        }
      }

      // If only one side needed (no angle2, or full revolution), single revolve
      if (angle2 === undefined || angle2 < 1e-10) {
        revolvedShape = await revolveWithFallback(
          positionedFace,
          axisOrigin,
          axisDir,
          angle1,
        );
      } else {
        // Revolve positive side
        const shape1 = await revolveWithFallback(
          positionedFace,
          axisOrigin,
          axisDir,
          angle1,
        );

        // Revolve negative side (negated axis direction)
        const negDir = { x: -axisDir.x, y: -axisDir.y, z: -axisDir.z };
        const shape2 = await revolveWithFallback(
          positionedFace,
          axisOrigin,
          negDir,
          angle2,
        );

        // Fuse the two halves
        const fuseOp = new oc.BRepAlgoAPI_Fuse_1();
        fuseOp.SetFuzzyValue(1e-5);
        fuseOp.SetNonDestructive(true);
        fuseOp.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift);

        const args = new oc.TopTools_ListOfShape_1();
        args.Append_1(shape1);
        fuseOp.SetArguments(args);

        const tools = new oc.TopTools_ListOfShape_1();
        tools.Append_1(shape2);
        fuseOp.SetTools(tools);

        fuseOp.Build(new oc.Message_ProgressRange_1());

        if (!fuseOp.IsDone()) {
          fuseOp.delete();
          args.delete();
          tools.delete();
          throw new Error("BRepAlgoAPI_Fuse failed for two-sided revolve");
        }

        let fusedShape = fuseOp.Shape();
        fuseOp.delete();
        args.delete();
        tools.delete();

        // Fix the fused shape
        const fixer = new oc.ShapeFix_Shape_2(fusedShape);
        fixer.SetPrecision(1e-6);
        fixer.Perform(new oc.Message_ProgressRange_1());
        fusedShape = fixer.Shape();
        fixer.delete();

        // Try to orient as closed solid
        try {
          oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(fusedShape));
        } catch {
          // Not a closed solid — fine for partial revolutions
        }

        revolvedShape = fusedShape;
      }
    }

    // 4. Get uncentered BRep to compute bounding box center
    const uncenteredBrep = await ocService.ocShapeToBRep(revolvedShape, false);
    const xs = uncenteredBrep.vertices.map(v => v.x);
    const ys = uncenteredBrep.vertices.map(v => v.y);
    const zs = uncenteredBrep.vertices.map(v => v.z);
    const localCenter = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
    };

    // 5. Center BRep at origin
    const centerVec = new THREE.Vector3(localCenter.x, localCenter.y, localCenter.z);
    const originVec = new THREE.Vector3(0, 0, 0);
    const centeredBrep = transformBrepVertices(uncenteredBrep, centerVec, originVec);

    // The revolve was done in position frame (absolute world coords), so
    // localCenter is an absolute coordinate. The caller adds profilePosition
    // on top, so subtract it to get a relative offset:
    //   newPosition = profilePosition + (localCenter - profilePosition) = localCenter  ✓
    const positionOffset = {
      x: localCenter.x - profilePosition.x,
      y: localCenter.y - profilePosition.y,
      z: localCenter.z - profilePosition.z,
    };

    // Extract edge geometry, face geometry, and vertex positions, translated to centered local space
    let edgeGeometry: THREE.BufferGeometry | undefined;
    let faceGeometry: THREE.BufferGeometry | undefined;
    let vertexPositions: Float32Array | undefined;
    try {
      edgeGeometry = await ocService.shapeToEdgeLineSegments(revolvedShape, 0.003);
      edgeGeometry.translate(-localCenter.x, -localCenter.y, -localCenter.z);
    } catch (e) {
      console.warn("[revolveBRep] Edge geometry extraction failed:", e);
    }

    try {
      faceGeometry = await ocService.shapeToThreeGeometry(revolvedShape, 0.003, 0.1);
      faceGeometry.translate(-localCenter.x, -localCenter.y, -localCenter.z);
    } catch (e) {
      console.warn("[revolveBRep] Face geometry extraction failed:", e);
    }

    try {
      vertexPositions = await ocService.shapeToVertexPositions(revolvedShape);
      for (let i = 0; i < vertexPositions.length; i += 3) {
        vertexPositions[i] -= localCenter.x;
        vertexPositions[i + 1] -= localCenter.y;
        vertexPositions[i + 2] -= localCenter.z;
      }
    } catch (e) {
      console.warn("[revolveBRep] Vertex positions extraction failed:", e);
    }

    // Serialize revolve result in local space for lossless round-tripping
    let occBrep: string | undefined;
    try {
      const trsf = new oc.gp_Trsf_1();
      const vec = new oc.gp_Vec_4(-localCenter.x, -localCenter.y, -localCenter.z);
      trsf.SetTranslation_1(vec);
      vec.delete();
      const transformer = new oc.BRepBuilderAPI_Transform_2(revolvedShape, trsf, true);
      trsf.delete();
      const localShape = transformer.Shape();
      transformer.delete();
      occBrep = await ocService.serializeShape(localShape);
    } catch {
      // Serialization is best-effort
    }

    return { brep: centeredBrep, positionOffset, edgeGeometry, vertexPositions, occBrep, faceGeometry };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[revolveBRep] Revolve operation failed:", msg);
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 }, errorReason: msg };
  }
}
