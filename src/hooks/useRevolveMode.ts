import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { Brep } from "../geometry";
import { revolveBRep } from "../scene-operations/revolve-operations";
import { collectPickableMeshes } from "../scene-operations/mesh-operations";
import { REVOLVE, BODY, SELECTION, FILLET } from "../theme";
import { isSketchLine, isSketchPoint } from "../types/sketch-types";
import type { SketchPoint } from "../types/sketch-types";

export type RevolvePhase = "SELECT_PROFILE" | "SELECT_AXIS" | "SET_ANGLE";

interface RevolveState {
  phase: RevolvePhase;
  selectedElement: string | null;
  axisEdgeStart: THREE.Vector3 | null;
  axisEdgeEnd: THREE.Vector3 | null;
  angle: number;
  isApplying: boolean;
  showDimensionInput: boolean;
  dimensionInputPosition: { x: number; y: number };
}

interface EdgeSegmentData {
  edgeIndex: number;
  segments: Float32Array;
  midpoint: { x: number; y: number; z: number };
}

/**
 * Hook for Fusion 360-style revolve mode.
 * State machine: SELECT_PROFILE → SELECT_AXIS → SET_ANGLE
 */
export function useRevolveMode() {
  const {
    elements,
    sketches,
    getObject,
    updateElementBrep,
  } = useCadCore();
  const { camera, renderer, scene, forceSceneUpdate, navToolActiveRef } = useCadVisualizer();
  const { showToast } = useToast();

  const [state, setState] = useState<RevolveState>({
    phase: "SELECT_PROFILE",
    selectedElement: null,
    axisEdgeStart: null,
    axisEdgeEnd: null,
    angle: 360,
    isApplying: false,
    showDimensionInput: false,
    dimensionInputPosition: { x: 0, y: 0 },
  });

  const hoveredElementRef = useRef<string | null>(null);
  const edgeSegmentsRef = useRef<EdgeSegmentData[]>([]);
  const edgeOverlayGroupRef = useRef<THREE.Group | null>(null);
  const hoveredEdgeRef = useRef<number | null>(null);
  const axisLineRef = useRef<THREE.Line | null>(null);
  const sketchLineOverlayRef = useRef<THREE.Group | null>(null);
  const bodyEdgeOverlayRef = useRef<THREE.Group | null>(null);

  /**
   * Check if a BRep is flat (2D profile candidate for revolve)
   */
  const isFlatShape = useCallback((brep: Brep): boolean => {
    if (!brep.vertices || brep.vertices.length === 0) return false;
    const xs = brep.vertices.map(v => v.x);
    const ys = brep.vertices.map(v => v.y);
    const zs = brep.vertices.map(v => v.z);
    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeY = Math.max(...ys) - Math.min(...ys);
    const rangeZ = Math.max(...zs) - Math.min(...zs);
    return rangeX < 0.01 || rangeY < 0.01 || rangeZ < 0.01;
  }, []);

  /**
   * Reset hover highlight for profile selection
   */
  const resetHover = useCallback(() => {
    if (hoveredElementRef.current) {
      const obj = getObject(hoveredElementRef.current);
      if (obj) {
        obj.traverse(child => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            if (hoveredElementRef.current !== state.selectedElement) {
              (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
            }
          }
        });
      }
      hoveredElementRef.current = null;
    }
  }, [getObject, state.selectedElement]);

  /**
   * Build per-edge overlay lines from element's edge geometry
   */
  const buildEdgeOverlay = useCallback(async (nodeId: string) => {
    const element = elements.find(el => el.nodeId === nodeId);
    if (!element) return;

    const ocService = (await import("../services/OpenCascadeService")).OpenCascadeService.getInstance();

    let edgeDataArr: Array<{ edgeIndex: number; segments: Float32Array; midpoint: { x: number; y: number; z: number } }> | null = null;

    const hasOccBrep = !!element.occBrep;
    const shape = hasOccBrep
      ? await ocService.occBrepToOCShape(element.occBrep!, element.position)
      : await ocService.brepToOCShape(element.brep, element.position);
    edgeDataArr = await ocService.getEdgeLineSegmentsPerEdge(shape, 0.003, hasOccBrep, true);

    if (!edgeDataArr || edgeDataArr.length === 0) return;

    edgeSegmentsRef.current = edgeDataArr.map(e => ({
      edgeIndex: e.edgeIndex,
      segments: e.segments,
      midpoint: e.midpoint,
    }));

    // Create overlay group
    const group = new THREE.Group();
    group.userData.isHelper = true;

    for (const edge of edgeSegmentsRef.current) {
      // Convert pair-format to continuous strip for LineGeometry
      const pairs = edge.segments;
      const strip: number[] = [];
      for (let i = 0; i < pairs.length; i += 6) {
        if (strip.length === 0) strip.push(pairs[i], pairs[i + 1], pairs[i + 2]);
        strip.push(pairs[i + 3], pairs[i + 4], pairs[i + 5]);
      }
      const geom = new LineGeometry();
      geom.setPositions(strip);
      const mat = new LineMaterial({
        color: REVOLVE.axisLine,
        linewidth: FILLET.edgeWidth,
        depthTest: false,
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      });
      const line = new Line2(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 999;
      line.userData.edgeIndex = edge.edgeIndex;
      group.add(line);
    }

    // Add to scene
    const obj = getObject(nodeId);
    if (obj && obj.parent) {
      obj.parent.add(group);
    } else if (scene) {
      scene.add(group);
    }
    edgeOverlayGroupRef.current = group;
    forceSceneUpdate();
  }, [elements, getObject, scene, forceSceneUpdate]);

  /**
   * Build overlay lines for sketch lines from completed sketches
   */
  const buildSketchLineOverlays = useCallback(() => {
    if (!scene) return;

    const group = new THREE.Group();
    group.userData.isHelper = true;

    for (const sketch of sketches) {
      const plane = sketch.plane;
      const points = new Map<string, SketchPoint>();
      for (const prim of sketch.primitives) {
        if (isSketchPoint(prim)) {
          points.set(prim.id, prim);
        }
      }

      for (const prim of sketch.primitives) {
        if (!isSketchLine(prim)) continue;
        const p1 = points.get(prim.p1Id);
        const p2 = points.get(prim.p2Id);
        if (!p1 || !p2) continue;

        // Convert 2D sketch coords to 3D world
        const start3d = plane.origin.clone()
          .add(plane.xAxis.clone().multiplyScalar(p1.x))
          .add(plane.yAxis.clone().multiplyScalar(p1.y));
        const end3d = plane.origin.clone()
          .add(plane.xAxis.clone().multiplyScalar(p2.x))
          .add(plane.yAxis.clone().multiplyScalar(p2.y));

        if (start3d.distanceTo(end3d) < 1e-6) continue;

        const geom = new LineGeometry();
        geom.setPositions([start3d.x, start3d.y, start3d.z, end3d.x, end3d.y, end3d.z]);
        const mat = new LineMaterial({
          color: REVOLVE.sketchLineAxis,
          linewidth: FILLET.edgeWidth,
          depthTest: false,
          resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
        });
        const line = new Line2(geom, mat);
        line.computeLineDistances();
        line.renderOrder = 999;
        line.userData.sketchLineStart = start3d;
        line.userData.sketchLineEnd = end3d;
        line.userData.axisSourceType = "sketchLine";
        group.add(line);
      }
    }

    if (group.children.length > 0) {
      scene.add(group);
      sketchLineOverlayRef.current = group;
      forceSceneUpdate();
    }
  }, [sketches, scene, forceSceneUpdate]);

  /**
   * Build overlay lines for linear edges of other 3D bodies
   */
  const buildOtherBodyEdgeOverlays = useCallback(async (selectedNodeId: string) => {
    if (!scene) return;

    const ocService = (await import("../services/OpenCascadeService")).OpenCascadeService.getInstance();
    const group = new THREE.Group();
    group.userData.isHelper = true;

    // Filter to 3D elements (not flat) excluding the selected profile
    const otherElements = elements.filter(
      el => el.nodeId !== selectedNodeId && !isFlatShape(el.brep)
    );

    for (const el of otherElements) {
      const hasOccBrep = !!el.occBrep;
      let shape;
      try {
        shape = hasOccBrep
          ? await ocService.occBrepToOCShape(el.occBrep!, el.position)
          : await ocService.brepToOCShape(el.brep, el.position);
      } catch {
        continue;
      }

      let edgeDataArr;
      try {
        edgeDataArr = await ocService.getEdgeLineSegmentsPerEdge(shape, 0.003, hasOccBrep, true);
      } catch {
        continue;
      }
      if (!edgeDataArr) continue;

      for (const edge of edgeDataArr) {
        // Linear edges have exactly 2 points (6 floats)
        if (edge.segments.length !== 6) continue;

        const start = new THREE.Vector3(edge.segments[0], edge.segments[1], edge.segments[2]);
        const end = new THREE.Vector3(edge.segments[3], edge.segments[4], edge.segments[5]);

        if (start.distanceTo(end) < 1e-6) continue;

        const geom = new LineGeometry();
        geom.setPositions([start.x, start.y, start.z, end.x, end.y, end.z]);
        const mat = new LineMaterial({
          color: REVOLVE.bodyEdgeAxis,
          linewidth: FILLET.edgeWidth,
          depthTest: false,
          resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
        });
        const line = new Line2(geom, mat);
        line.computeLineDistances();
        line.renderOrder = 999;
        line.userData.bodyEdgeStart = start;
        line.userData.bodyEdgeEnd = end;
        line.userData.axisSourceType = "bodyEdge";
        group.add(line);
      }
    }

    if (group.children.length > 0) {
      scene.add(group);
      bodyEdgeOverlayRef.current = group;
      forceSceneUpdate();
    }
  }, [elements, scene, isFlatShape, forceSceneUpdate]);

  /**
   * Remove all overlay groups (profile edges, sketch lines, body edges)
   */
  const removeEdgeOverlay = useCallback(() => {
    const disposeGroup = (group: THREE.Group) => {
      group.children.forEach(child => {
        if (child instanceof Line2) {
          child.geometry.dispose();
          (child.material as LineMaterial).dispose();
        } else if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
      group.parent?.remove(group);
    };
    if (edgeOverlayGroupRef.current) {
      disposeGroup(edgeOverlayGroupRef.current);
      edgeOverlayGroupRef.current = null;
    }
    if (sketchLineOverlayRef.current) {
      disposeGroup(sketchLineOverlayRef.current);
      sketchLineOverlayRef.current = null;
    }
    if (bodyEdgeOverlayRef.current) {
      disposeGroup(bodyEdgeOverlayRef.current);
      bodyEdgeOverlayRef.current = null;
    }
    edgeSegmentsRef.current = [];
    hoveredEdgeRef.current = null;
  }, []);

  /**
   * Remove axis visualization line
   */
  const removeAxisLine = useCallback(() => {
    if (axisLineRef.current) {
      axisLineRef.current.geometry.dispose();
      if (axisLineRef.current.material instanceof THREE.Material) axisLineRef.current.material.dispose();
      axisLineRef.current.parent?.remove(axisLineRef.current);
      axisLineRef.current = null;
    }
  }, []);

  /**
   * Show axis visualization line
   */
  const showAxisLine = useCallback((start: THREE.Vector3, end: THREE.Vector3) => {
    removeAxisLine();
    const dir = end.clone().sub(start).normalize();
    const extendedStart = start.clone().sub(dir.clone().multiplyScalar(5));
    const extendedEnd = end.clone().add(dir.clone().multiplyScalar(5));

    const geom = new THREE.BufferGeometry().setFromPoints([extendedStart, extendedEnd]);
    const mat = new THREE.LineBasicMaterial({
      color: REVOLVE.axisLine,
      linewidth: 2,
      depthTest: false,
    });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 999;
    line.userData.isHelper = true;
    if (scene) scene.add(line);
    axisLineRef.current = line;
    forceSceneUpdate();
  }, [scene, forceSceneUpdate, removeAxisLine]);

  /**
   * Select a world origin axis (X, Y, or Z) as the revolve axis
   */
  const selectOriginAxis = useCallback((axis: "X" | "Y" | "Z") => {
    if (state.phase !== "SELECT_AXIS") return;

    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(
      axis === "X" ? 1 : 0,
      axis === "Y" ? 1 : 0,
      axis === "Z" ? 1 : 0,
    );

    removeEdgeOverlay();
    showAxisLine(start, end);

    setState(prev => ({
      ...prev,
      phase: "SET_ANGLE",
      axisEdgeStart: start,
      axisEdgeEnd: end,
      showDimensionInput: true,
      dimensionInputPosition: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    }));
  }, [state.phase, removeEdgeOverlay, showAxisLine]);

  /**
   * Perform the revolve operation
   */
  const performRevolve = useCallback(async (angleDegrees?: number) => {
    const { selectedElement, axisEdgeStart, axisEdgeEnd } = state;
    if (!selectedElement || !axisEdgeStart || !axisEdgeEnd) return;

    const element = elements.find(el => el.nodeId === selectedElement);
    if (!element) return;

    setState(prev => ({ ...prev, isApplying: true }));

    try {
      const finalAngle = angleDegrees ?? state.angle;
      const angleRadians = (finalAngle / 180) * Math.PI;

      // Compute axis direction from edge endpoints
      const axisDir = {
        x: axisEdgeEnd.x - axisEdgeStart.x,
        y: axisEdgeEnd.y - axisEdgeStart.y,
        z: axisEdgeEnd.z - axisEdgeStart.z,
      };
      const len = Math.sqrt(axisDir.x ** 2 + axisDir.y ** 2 + axisDir.z ** 2);
      if (len < 1e-10) {
        showToast("Invalid axis: edge has zero length", "error");
        setState(prev => ({ ...prev, isApplying: false }));
        return;
      }
      axisDir.x /= len;
      axisDir.y /= len;
      axisDir.z /= len;

      const axisOrigin = {
        x: axisEdgeStart.x,
        y: axisEdgeStart.y,
        z: axisEdgeStart.z,
      };

      const result = await revolveBRep(
        element.brep,
        element.position,
        axisOrigin,
        axisDir,
        Math.abs(finalAngle - 360) < 0.01 ? undefined : angleRadians,
        element.occBrep,
      );

      if (result.brep === element.brep) {
        showToast("Revolve failed", "error");
        setState(prev => ({ ...prev, isApplying: false }));
        return;
      }

      // Compute new position
      const newPosition = new THREE.Vector3(
        element.position.x + result.positionOffset.x,
        element.position.y + result.positionOffset.y,
        element.position.z + result.positionOffset.z,
      );

      // Cleanup before updating
      removeEdgeOverlay();
      removeAxisLine();

      updateElementBrep(
        selectedElement,
        result.brep,
        newPosition,
        { type: "revolve" },
        result.edgeGeometry,
        result.occBrep,
        result.faceGeometry,
        result.vertexPositions,
      );

      showToast(`Revolved ${finalAngle}°`, "success");

      // Reset state
      setState({
        phase: "SELECT_PROFILE",
        selectedElement: null,
        axisEdgeStart: null,
        axisEdgeEnd: null,
        angle: 360,
        isApplying: false,
        showDimensionInput: false,
        dimensionInputPosition: { x: 0, y: 0 },
      });
    } catch (error) {
      console.error("[useRevolveMode] Revolve failed:", error);
      showToast("Revolve failed", "error");
      setState(prev => ({ ...prev, isApplying: false }));
    }
  }, [state, elements, updateElementBrep, showToast, removeEdgeOverlay, removeAxisLine]);

  /**
   * Try to pick an axis from sketch line or body edge overlays.
   * Returns the start/end if hit, or null.
   */
  const pickExtraOverlayAxis = useCallback((raycaster: THREE.Raycaster): { start: THREE.Vector3; end: THREE.Vector3 } | null => {
    // Priority 2: sketch line overlays
    if (sketchLineOverlayRef.current && sketchLineOverlayRef.current.children.length > 0) {
      const hits = raycaster.intersectObjects(sketchLineOverlayRef.current.children, false);
      if (hits.length > 0) {
        const obj = hits[0].object;
        const start = obj.userData.sketchLineStart as THREE.Vector3;
        const end = obj.userData.sketchLineEnd as THREE.Vector3;
        if (start && end) return { start: start.clone(), end: end.clone() };
      }
    }

    // Priority 3: other body edge overlays
    if (bodyEdgeOverlayRef.current && bodyEdgeOverlayRef.current.children.length > 0) {
      const hits = raycaster.intersectObjects(bodyEdgeOverlayRef.current.children, false);
      if (hits.length > 0) {
        const obj = hits[0].object;
        const start = obj.userData.bodyEdgeStart as THREE.Vector3;
        const end = obj.userData.bodyEdgeEnd as THREE.Vector3;
        if (start && end) return { start: start.clone(), end: end.clone() };
      }
    }

    return null;
  }, []);

  /**
   * Handle mouse down
   */
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!renderer || !camera || event.button !== 0 || event.altKey || navToolActiveRef.current) return;
    if (state.isApplying) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    if (state.phase === "SELECT_PROFILE") {
      // Raycast to find flat profiles
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const flatElements = elements.filter(el => isFlatShape(el.brep));
      const meshes = collectPickableMeshes(flatElements, (nodeId) => getObject(nodeId));
      const intersects = raycaster.intersectObjects(meshes, false);

      if (intersects.length > 0) {
        let parentObj = intersects[0].object;
        while (parentObj.parent && !parentObj.userData.nodeId) {
          parentObj = parentObj.parent;
        }
        const nodeId = parentObj.userData.nodeId as string;
        if (!nodeId) return;

        // Highlight selected profile
        const obj = getObject(nodeId);
        if (obj) {
          obj.traverse(child => {
            if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
              (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.selected);
            }
          });
        }

        setState(prev => ({
          ...prev,
          phase: "SELECT_AXIS",
          selectedElement: nodeId,
        }));

        // Build all overlays for axis selection
        buildEdgeOverlay(nodeId);
        buildSketchLineOverlays();
        buildOtherBodyEdgeOverlays(nodeId);
      }
    } else if (state.phase === "SELECT_AXIS") {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      (raycaster.params as any).Line2 = { threshold: 8 };

      // Priority 1: profile edge overlay
      if (edgeOverlayGroupRef.current && edgeSegmentsRef.current.length > 0) {
        const intersects = raycaster.intersectObjects(
          edgeOverlayGroupRef.current.children,
          false,
        );

        if (intersects.length > 0) {
          const edgeIndex = intersects[0].object.userData.edgeIndex as number;
          const edgeData = edgeSegmentsRef.current.find(e => e.edgeIndex === edgeIndex);
          if (!edgeData || edgeData.segments.length < 6) return;

          const start = new THREE.Vector3(
            edgeData.segments[0],
            edgeData.segments[1],
            edgeData.segments[2],
          );
          const lastIdx = edgeData.segments.length - 3;
          const end = new THREE.Vector3(
            edgeData.segments[lastIdx],
            edgeData.segments[lastIdx + 1],
            edgeData.segments[lastIdx + 2],
          );

          removeEdgeOverlay();
          showAxisLine(start, end);

          setState(prev => ({
            ...prev,
            phase: "SET_ANGLE",
            axisEdgeStart: start,
            axisEdgeEnd: end,
            showDimensionInput: true,
            dimensionInputPosition: { x: event.clientX, y: event.clientY },
          }));
          return;
        }
      }

      // Priority 2 & 3: sketch lines and body edges
      const extraHit = pickExtraOverlayAxis(raycaster);
      if (extraHit) {
        removeEdgeOverlay();
        showAxisLine(extraHit.start, extraHit.end);

        setState(prev => ({
          ...prev,
          phase: "SET_ANGLE",
          axisEdgeStart: extraHit.start,
          axisEdgeEnd: extraHit.end,
          showDimensionInput: true,
          dimensionInputPosition: { x: event.clientX, y: event.clientY },
        }));
      }
    }
  }, [
    renderer, camera, state, elements, getObject, isFlatShape,
    buildEdgeOverlay, buildSketchLineOverlays, buildOtherBodyEdgeOverlays,
    removeEdgeOverlay, showAxisLine, pickExtraOverlayAxis, showToast,
  ]);

  /**
   * Reset hover color on all extra overlay groups
   */
  const resetExtraOverlayHover = useCallback(() => {
    if (sketchLineOverlayRef.current) {
      sketchLineOverlayRef.current.children.forEach(child => {
        if (child instanceof Line2) {
          (child.material as LineMaterial).color.set(REVOLVE.sketchLineAxis);
        }
      });
    }
    if (bodyEdgeOverlayRef.current) {
      bodyEdgeOverlayRef.current.children.forEach(child => {
        if (child instanceof Line2) {
          (child.material as LineMaterial).color.set(REVOLVE.bodyEdgeAxis);
        }
      });
    }
  }, []);

  /**
   * Handle mouse move (hover highlighting)
   */
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!renderer || !camera) return;
    if (state.isApplying) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    if (state.phase === "SELECT_PROFILE") {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const flatElements = elements.filter(el => isFlatShape(el.brep));
      const meshes = collectPickableMeshes(flatElements, (nodeId) => getObject(nodeId));
      const intersects = raycaster.intersectObjects(meshes, false);

      resetHover();

      if (intersects.length > 0) {
        let parentObj = intersects[0].object;
        while (parentObj.parent && !parentObj.userData.nodeId) {
          parentObj = parentObj.parent;
        }
        const nodeId = parentObj.userData.nodeId as string;
        if (!nodeId) return;

        hoveredElementRef.current = nodeId;
        const obj = getObject(nodeId);
        if (obj) {
          obj.traverse(child => {
            if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
              (child.material as THREE.MeshStandardMaterial).color.set(BODY.hover);
            }
          });
        }
        renderer.domElement.style.cursor = "pointer";
      } else {
        renderer.domElement.style.cursor = "default";
      }
      forceSceneUpdate();
    } else if (state.phase === "SELECT_AXIS") {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      (raycaster.params as any).Line2 = { threshold: 8 };

      // Reset all overlay colors to defaults
      if (edgeOverlayGroupRef.current) {
        edgeOverlayGroupRef.current.children.forEach(child => {
          if (child instanceof Line2) {
            (child.material as LineMaterial).color.set(REVOLVE.axisLine);
          }
        });
      }
      resetExtraOverlayHover();

      let foundHover = false;

      // Priority 1: profile edges
      if (edgeOverlayGroupRef.current) {
        const intersects = raycaster.intersectObjects(
          edgeOverlayGroupRef.current.children,
          false,
        );
        if (intersects.length > 0) {
          const edgeIndex = intersects[0].object.userData.edgeIndex as number;
          hoveredEdgeRef.current = edgeIndex;
          edgeOverlayGroupRef.current.children.forEach(child => {
            if (child instanceof Line2 && child.userData.edgeIndex === edgeIndex) {
              (child.material as LineMaterial).color.set(REVOLVE.axisHover);
            }
          });
          foundHover = true;
        }
      }

      // Priority 2: sketch lines
      if (!foundHover && sketchLineOverlayRef.current && sketchLineOverlayRef.current.children.length > 0) {
        const hits = raycaster.intersectObjects(sketchLineOverlayRef.current.children, false);
        if (hits.length > 0) {
          ((hits[0].object as Line2).material as LineMaterial).color.set(REVOLVE.axisHover);
          foundHover = true;
        }
      }

      // Priority 3: body edges
      if (!foundHover && bodyEdgeOverlayRef.current && bodyEdgeOverlayRef.current.children.length > 0) {
        const hits = raycaster.intersectObjects(bodyEdgeOverlayRef.current.children, false);
        if (hits.length > 0) {
          ((hits[0].object as Line2).material as LineMaterial).color.set(REVOLVE.axisHover);
          foundHover = true;
        }
      }

      if (foundHover) {
        renderer.domElement.style.cursor = "pointer";
      } else {
        hoveredEdgeRef.current = null;
        renderer.domElement.style.cursor = "default";
      }
      forceSceneUpdate();
    }
  }, [renderer, camera, state, elements, getObject, isFlatShape, resetHover, resetExtraOverlayHover, forceSceneUpdate]);

  /**
   * Handle keydown (Enter to confirm, Escape to cancel)
   */
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Enter") {
      if (state.phase === "SET_ANGLE") {
        performRevolve();
      }
    } else if (event.key === "Escape") {
      cleanup();
    }
  }, [state.phase, performRevolve]);

  /**
   * Cleanup all revolve mode state
   */
  const cleanup = useCallback(() => {
    resetHover();
    removeEdgeOverlay();
    removeAxisLine();

    // Reset selected element color
    if (state.selectedElement) {
      const obj = getObject(state.selectedElement);
      if (obj) {
        obj.traverse(child => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
          }
        });
      }
    }

    if (renderer) {
      renderer.domElement.style.cursor = "default";
    }

    setState({
      phase: "SELECT_PROFILE",
      selectedElement: null,
      axisEdgeStart: null,
      axisEdgeEnd: null,
      angle: 360,
      isApplying: false,
      showDimensionInput: false,
      dimensionInputPosition: { x: 0, y: 0 },
    });
    forceSceneUpdate();
  }, [resetHover, removeEdgeOverlay, removeAxisLine, state.selectedElement, getObject, renderer, forceSceneUpdate]);

  return {
    phase: state.phase,
    selectedElement: state.selectedElement,
    isApplying: state.isApplying,
    angle: state.angle,
    showDimensionInput: state.showDimensionInput,
    dimensionInputPosition: state.dimensionInputPosition,
    setAngle: (angle: number) => setState(prev => ({ ...prev, angle })),
    handleMouseDown,
    handleMouseMove,
    handleKeyDown,
    performRevolve,
    selectOriginAxis,
    cleanup,
  };
}
