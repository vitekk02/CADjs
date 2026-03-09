import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { OccWorkerClient } from "../services/OccWorkerClient";
import type { WorkerEdgeAnalysisResult, WorkerEdgeLengthResult, WorkerEdgeDirectionResult, EulerJSON } from "../workers/occ-worker-types";
import { isDescendantOf } from "../scene-operations/mesh-operations";
import { isElement3D, SceneElement } from "../scene-operations/types";
import { computePointDistance, computeAngleBetweenVectors, findNearestVertex, disposeMeasureOverlay } from "../scene-operations/measure-operations";
import { MeasureSubMode, Measurement } from "../scene-operations/measure-types";
import { MEASURE, BODY, SELECTION, FILLET } from "../theme";

interface EdgeSegmentData {
  edgeIndex: number;
  segments: Float32Array;
  midpoint: { x: number; y: number; z: number };
}

interface MeasureState {
  subMode: MeasureSubMode;
  // Distance sub-mode
  firstPoint: THREE.Vector3 | null;
  // Edge-length sub-mode
  hoveredEdgeIndex: number | null;
  hoveredElementId: string | null;
  // Angle sub-mode
  firstEdge: { elementId: string; edgeIndex: number } | null;
  secondEdge: { elementId: string; edgeIndex: number } | null;
  // Status text
  statusText: string;
}

// ─── Helper: create a Line2 from flat positions array ────────────────
function createLine2(
  positions: number[],
  color: number,
  linewidth: number,
  dashed: boolean = false,
): Line2 {
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color,
    linewidth,
    dashed,
    ...(dashed ? { dashSize: 0.15, gapSize: 0.1 } : {}),
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    depthTest: false,
  });
  if (dashed) {
    material.defines.USE_DASH = "";
  }
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.renderOrder = 999;
  line.userData.isMeasureOverlay = true;
  return line;
}

// ─── Helper: create a value label sprite ─────────────────────────────
function createValueSprite(
  text: string,
  position: THREE.Vector3,
  color: number = MEASURE.text,
  bgColor: string = "#222222",
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;

  // Measure text to size background
  ctx.font = "bold 28px sans-serif";
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const padX = 16;
  const padY = 8;
  const bgWidth = Math.min(textWidth + padX * 2, 256);
  const bgX = (256 - bgWidth) / 2;

  // Background
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(bgX, padY, bgWidth, 64 - padY * 2, 6);
  ctx.fill();

  // Text
  const hexStr = "#" + new THREE.Color(color).getHexString();
  ctx.fillStyle = hexStr;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(1.2, 0.3, 1);
  sprite.renderOrder = 1001;
  sprite.userData.isMeasureOverlay = true;
  return sprite;
}

// ─── Helper: create a small sphere marker ────────────────────────────
function createPointMarker(position: THREE.Vector3, color: number = MEASURE.point): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.04, 12, 12);
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.renderOrder = 1000;
  mesh.userData.isMeasureOverlay = true;
  return mesh;
}

// Tag overlay objects with their parent measurement ID (for click-to-select)
function tagOverlays(overlays: THREE.Object3D[], measurementId: string) {
  for (const obj of overlays) {
    obj.userData.measurementId = measurementId;
    obj.traverse((child) => {
      child.userData.measurementId = measurementId;
    });
  }
}

export function useMeasureMode() {
  const { elements, getObject, pinnedMeasurements, addPinnedMeasurement, removePinnedMeasurement } = useCadCore();
  const { camera, renderer, scene, forceSceneUpdate, navToolActiveRef } = useCadVisualizer();

  const [state, setState] = useState<MeasureState>({
    subMode: "distance",
    firstPoint: null,
    hoveredEdgeIndex: null,
    hoveredElementId: null,
    firstEdge: null,
    secondEdge: null,
    statusText: "Click first point",
  });

  // Overlay objects for cleanup
  const overlayObjectsRef = useRef<THREE.Object3D[]>([]);
  // Preview overlay (dashed line during distance measurement)
  const previewObjectsRef = useRef<THREE.Object3D[]>([]);
  // Edge overlays for edge-length and angle sub-modes
  const edgeOverlayGroupRef = useRef<THREE.Group | null>(null);
  const edgeSegmentsRef = useRef<EdgeSegmentData[]>([]);
  // Currently active OCC shape element (for edge overlay)
  const activeElementRef = useRef<string | null>(null);
  // Completed measurements (temporary, not pinned)
  const measurementsRef = useRef<Measurement[]>([]);
  // Hovered body for highlighting
  const hoveredBodyRef = useRef<string | null>(null);
  // Measurement ID counter
  const measureIdRef = useRef(0);
  // Selected measurement — state for UI, ref for stable callbacks
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const selectedMeasurementIdRef = useRef<string | null>(null);
  // Keep ref in sync with state
  selectedMeasurementIdRef.current = selectedMeasurementId;
  // Ref for pinnedMeasurements to avoid dependency churn in callbacks
  const pinnedMeasurementsRef = useRef(pinnedMeasurements);
  pinnedMeasurementsRef.current = pinnedMeasurements;
  // Version counter to trigger UI re-renders when measurementsRef changes
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const bumpVersion = useCallback(() => setMeasurementVersion((v) => v + 1), []);

  // ─── Cleanup helpers ───────────────────────────────────────────────

  const cleanupPreview = useCallback(() => {
    for (const obj of previewObjectsRef.current) {
      disposeMeasureOverlay(obj);
    }
    previewObjectsRef.current = [];
  }, []);

  const cleanupEdgeOverlay = useCallback(() => {
    if (scene && edgeOverlayGroupRef.current) {
      scene.remove(edgeOverlayGroupRef.current);
      edgeOverlayGroupRef.current.traverse((child) => {
        if (child instanceof Line2) {
          child.geometry.dispose();
          (child.material as LineMaterial).dispose();
        }
      });
      edgeOverlayGroupRef.current = null;
    }
    edgeSegmentsRef.current = [];
    activeElementRef.current = null;
  }, [scene]);

  const cleanupOverlays = useCallback(() => {
    for (const obj of overlayObjectsRef.current) {
      disposeMeasureOverlay(obj);
    }
    overlayObjectsRef.current = [];
  }, []);

  const cleanupMeasurements = useCallback(() => {
    for (const m of measurementsRef.current) {
      for (const obj of m.overlayObjects) {
        disposeMeasureOverlay(obj);
      }
    }
    measurementsRef.current = [];
    bumpVersion();
  }, [bumpVersion]);

  const resetBodyHover = useCallback(() => {
    if (hoveredBodyRef.current) {
      const obj = getObject(hoveredBodyRef.current);
      if (obj) {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
          }
        });
      }
      hoveredBodyRef.current = null;
    }
  }, [getObject]);

  // ─── Selection visual helpers ───────────────────────────────────────

  const highlightMeasurement = useCallback((measurement: Measurement) => {
    for (const obj of measurement.overlayObjects) {
      if (obj instanceof Line2) {
        (obj.material as LineMaterial).color.set(SELECTION.selected);
        (obj.material as LineMaterial).linewidth = 2.5;
      }
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.isMeasureOverlay) {
          (child.material as THREE.MeshBasicMaterial).color.set(SELECTION.selected);
        }
      });
    }
    forceSceneUpdate();
  }, [forceSceneUpdate]);

  const unhighlightMeasurement = useCallback((measurement: Measurement) => {
    const isPinned = measurement.pinned;
    const lineColor = isPinned ? MEASURE.pinnedLine
      : measurement.type === "angle" ? MEASURE.angleArc
        : measurement.type === "edge-length" ? MEASURE.edgeHighlight
          : MEASURE.line;
    const lineWidth = measurement.type === "edge-length" ? 2.0 : 1.5;
    const pointColor = isPinned ? MEASURE.pinnedLine : MEASURE.point;

    for (const obj of measurement.overlayObjects) {
      if (obj instanceof Line2) {
        (obj.material as LineMaterial).color.set(lineColor);
        (obj.material as LineMaterial).linewidth = lineWidth;
      }
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.isMeasureOverlay) {
          (child.material as THREE.MeshBasicMaterial).color.set(pointColor);
        }
      });
    }
    forceSceneUpdate();
  }, [forceSceneUpdate]);

  const findMeasurementById = useCallback((id: string): Measurement | null => {
    const temp = measurementsRef.current.find((m) => m.id === id);
    if (temp) return temp;
    return pinnedMeasurementsRef.current.find((m) => m.id === id) ?? null;
  }, []);

  const selectMeasurement = useCallback((id: string | null) => {
    // Deselect previous
    const prevId = selectedMeasurementIdRef.current;
    if (prevId) {
      const prev = findMeasurementById(prevId);
      if (prev) unhighlightMeasurement(prev);
    }
    // Select new
    if (id) {
      const next = findMeasurementById(id);
      if (next) highlightMeasurement(next);
    }
    selectedMeasurementIdRef.current = id;
    setSelectedMeasurementId(id);
  }, [findMeasurementById, highlightMeasurement, unhighlightMeasurement]);

  // ─── Build edge overlays for an element ────────────────────────────

  const buildEdgeOverlays = useCallback(
    async (nodeId: string) => {
      if (!scene) return;
      if (activeElementRef.current === nodeId) return; // already built
      cleanupEdgeOverlay();

      const element = elements.find((el) => el.nodeId === nodeId);
      if (!element) return;

      try {
        const client = OccWorkerClient.getInstance();
        const rotation = (element.rotation && (element.rotation.x !== 0 || element.rotation.y !== 0 || element.rotation.z !== 0))
          ? { x: element.rotation.x, y: element.rotation.y, z: element.rotation.z, order: element.rotation.order } as EulerJSON
          : undefined;

        const analysisResult = await client.send<WorkerEdgeAnalysisResult>({
          type: "edgeAnalysis",
          payload: {
            brepJson: element.brep.toJSON(),
            position: { x: element.position.x, y: element.position.y, z: element.position.z },
            occBrep: element.occBrep,
            rotation,
            allEdges: true,
          },
        });

        const edgeData = analysisResult.edges;
        edgeSegmentsRef.current = edgeData;
        activeElementRef.current = nodeId;

        const group = new THREE.Group();
        group.userData.isMeasureEdgeOverlay = true;

        for (const edge of edgeData) {
          // Convert pair-format to continuous strip for LineGeometry
          const pairs = edge.segments;
          const strip: number[] = [];
          for (let i = 0; i < pairs.length; i += 6) {
            if (strip.length === 0) strip.push(pairs[i], pairs[i + 1], pairs[i + 2]);
            strip.push(pairs[i + 3], pairs[i + 4], pairs[i + 5]);
          }

          const geometry = new LineGeometry();
          geometry.setPositions(strip);

          const material = new LineMaterial({
            color: MEASURE.edgeHighlight,
            linewidth: FILLET.edgeWidth,
            transparent: true,
            opacity: 0,
            depthTest: false,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
          });

          const line = new Line2(geometry, material);
          line.computeLineDistances();
          line.userData.edgeIndex = edge.edgeIndex;
          line.userData.isMeasureEdge = true;
          line.renderOrder = 999;

          group.add(line);
        }

        scene.add(group);
        edgeOverlayGroupRef.current = group;
        forceSceneUpdate();
      } catch (error) {
        console.error("[useMeasureMode] Failed to build edge overlays:", error);
      }
    },
    [elements, scene, forceSceneUpdate, cleanupEdgeOverlay],
  );

  // ─── Render a distance measurement annotation ──────────────────────

  const renderDistanceAnnotation = useCallback(
    (pointA: THREE.Vector3, pointB: THREE.Vector3, distance: number, pinned: boolean = false): THREE.Object3D[] => {
      if (!scene) return [];
      const objects: THREE.Object3D[] = [];
      const color = pinned ? MEASURE.pinnedLine : MEASURE.line;
      const textColor = pinned ? MEASURE.pinnedText : MEASURE.text;

      // Main measurement line
      const line = createLine2(
        [pointA.x, pointA.y, pointA.z, pointB.x, pointB.y, pointB.z],
        color, 1.5,
      );
      scene.add(line);
      objects.push(line);

      // Point markers at both ends
      const markerA = createPointMarker(pointA);
      const markerB = createPointMarker(pointB);
      scene.add(markerA);
      scene.add(markerB);
      objects.push(markerA, markerB);

      // Value label at midpoint
      const mid = pointA.clone().add(pointB).multiplyScalar(0.5);
      // Offset the label slightly perpendicular to the line direction
      const dir = pointB.clone().sub(pointA).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const perp = dir.clone().cross(up);
      if (perp.length() < 0.01) {
        perp.set(1, 0, 0);
      }
      perp.normalize().multiplyScalar(0.15);
      const labelPos = mid.clone().add(perp);

      const label = createValueSprite(
        distance.toFixed(3),
        labelPos,
        textColor,
      );
      scene.add(label);
      objects.push(label);

      forceSceneUpdate();
      return objects;
    },
    [scene, forceSceneUpdate],
  );

  // ─── Render an edge length annotation ──────────────────────────────

  const renderEdgeLengthAnnotation = useCallback(
    (edgeData: EdgeSegmentData, length: number, pinned: boolean = false): THREE.Object3D[] => {
      if (!scene) return [];
      const objects: THREE.Object3D[] = [];
      const color = pinned ? MEASURE.pinnedLine : MEASURE.edgeHighlight;
      const textColor = pinned ? MEASURE.pinnedText : MEASURE.text;

      // Highlighted edge line
      const positions: number[] = [];
      for (let i = 0; i < edgeData.segments.length; i++) {
        positions.push(edgeData.segments[i]);
      }
      if (positions.length >= 6) {
        const edgeLine = createLine2(positions, color, 2.0);
        scene.add(edgeLine);
        objects.push(edgeLine);
      }

      // Value label at midpoint
      const labelPos = new THREE.Vector3(
        edgeData.midpoint.x,
        edgeData.midpoint.y + 0.2,
        edgeData.midpoint.z,
      );
      const label = createValueSprite(
        `L: ${length.toFixed(3)}`,
        labelPos,
        textColor,
      );
      scene.add(label);
      objects.push(label);

      forceSceneUpdate();
      return objects;
    },
    [scene, forceSceneUpdate],
  );

  // ─── Render an angle annotation ────────────────────────────────────

  const renderAngleAnnotation = useCallback(
    (vertex: THREE.Vector3, dirA: THREE.Vector3, dirB: THREE.Vector3, angleDeg: number, pinned: boolean = false): THREE.Object3D[] => {
      if (!scene) return [];
      const objects: THREE.Object3D[] = [];
      const color = pinned ? MEASURE.pinnedLine : MEASURE.angleArc;
      const textColor = pinned ? MEASURE.pinnedText : MEASURE.text;

      // Draw direction lines from vertex
      const lineLen = 0.5;
      const endA = vertex.clone().add(dirA.clone().normalize().multiplyScalar(lineLen));
      const endB = vertex.clone().add(dirB.clone().normalize().multiplyScalar(lineLen));

      const lineA = createLine2(
        [vertex.x, vertex.y, vertex.z, endA.x, endA.y, endA.z],
        color, 1.5,
      );
      scene.add(lineA);
      objects.push(lineA);

      const lineB = createLine2(
        [vertex.x, vertex.y, vertex.z, endB.x, endB.y, endB.z],
        color, 1.5,
      );
      scene.add(lineB);
      objects.push(lineB);

      // Draw arc between the two directions
      const arcRadius = 0.3;
      const angleRad = angleDeg * (Math.PI / 180);
      const segments = Math.max(8, Math.ceil(angleDeg / 5));

      // Build a local coordinate frame: dirA is the reference, dirB defines the plane
      const nA = dirA.clone().normalize();
      const nB = dirB.clone().normalize();
      // Compute the rotation axis
      const axis = nA.clone().cross(nB).normalize();
      if (axis.length() < 0.001) {
        // Parallel edges — no arc to draw
        const labelPos = vertex.clone().add(nA.clone().multiplyScalar(0.35));
        const label = createValueSprite(
          `${angleDeg.toFixed(1)}°`,
          labelPos,
          textColor,
        );
        scene.add(label);
        objects.push(label);
        forceSceneUpdate();
        return objects;
      }

      const arcPositions: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * angleRad;
        // Rotate nA around axis by angle t
        const q = new THREE.Quaternion().setFromAxisAngle(axis, t);
        const pt = nA.clone().applyQuaternion(q).multiplyScalar(arcRadius).add(vertex);
        arcPositions.push(pt.x, pt.y, pt.z);
      }

      if (arcPositions.length >= 6) {
        const arcLine = createLine2(arcPositions, color, 1.5);
        scene.add(arcLine);
        objects.push(arcLine);
      }

      // Angle value label at arc midpoint
      const midAngle = angleRad / 2;
      const qMid = new THREE.Quaternion().setFromAxisAngle(axis, midAngle);
      const labelDir = nA.clone().applyQuaternion(qMid).normalize();
      const labelPos = vertex.clone().add(labelDir.multiplyScalar(arcRadius + 0.2));
      const label = createValueSprite(
        `${angleDeg.toFixed(1)}°`,
        labelPos,
        textColor,
      );
      scene.add(label);
      objects.push(label);

      // Vertex marker
      const marker = createPointMarker(vertex);
      scene.add(marker);
      objects.push(marker);

      forceSceneUpdate();
      return objects;
    },
    [scene, forceSceneUpdate],
  );

  // ─── Get pickable 3D objects ───────────────────────────────────────

  const getPickableObjects = useCallback((): THREE.Object3D[] => {
    const objects: THREE.Object3D[] = [];
    elements.forEach((el) => {
      if (isElement3D(el)) {
        const obj = getObject(el.nodeId);
        if (obj) objects.push(obj);
      }
    });
    return objects;
  }, [elements, getObject]);

  const findElementByHit = useCallback(
    (hitObject: THREE.Object3D): SceneElement | null => {
      for (const el of elements) {
        if (!isElement3D(el)) continue;
        const obj = getObject(el.nodeId);
        if (obj && isDescendantOf(hitObject, obj)) {
          return el;
        }
      }
      return null;
    },
    [elements, getObject],
  );

  // ─── Handle mouse down ─────────────────────────────────────────────

  const handleMouseDown = useCallback(
    async (event: MouseEvent) => {
      if (!camera || !renderer || event.button !== 0 || event.altKey || navToolActiveRef.current) return;

      const raycaster = new THREE.Raycaster();
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);

      // ── Click-to-select: raycast against measurement overlays first ──
      const measureOverlayObjects: THREE.Object3D[] = [];
      for (const m of measurementsRef.current) {
        measureOverlayObjects.push(...m.overlayObjects);
      }
      for (const m of pinnedMeasurementsRef.current) {
        measureOverlayObjects.push(...m.overlayObjects);
      }
      if (measureOverlayObjects.length > 0) {
        (raycaster.params as any).Line2 = { threshold: 6 };
        const measureHits = raycaster.intersectObjects(measureOverlayObjects, true);
        if (measureHits.length > 0) {
          const hitMeasureId = measureHits[0].object.userData.measurementId as string | undefined;
          if (hitMeasureId) {
            selectMeasurement(hitMeasureId === selectedMeasurementIdRef.current ? null : hitMeasureId);
            return;
          }
        }
      }

      // Deselect measurement if clicking on non-measurement area
      if (selectedMeasurementIdRef.current) {
        selectMeasurement(null);
      }

      if (state.subMode === "distance") {
        // ── Distance sub-mode ──
        const objects = getPickableObjects();
        const intersects = raycaster.intersectObjects(objects, true);

        if (intersects.length === 0) return;

        const hit = intersects[0];
        const hitElement = findElementByHit(hit.object);
        if (!hitElement) return;

        // Try to snap to nearest vertex
        let worldPoint = hit.point.clone();
        const snap = findNearestVertex(worldPoint, hitElement, 0.15);
        if (snap) {
          worldPoint = snap.position;
        }

        if (!state.firstPoint) {
          // First click — place first point marker
          cleanupPreview();
          const marker = createPointMarker(worldPoint);
          if (scene) {
            scene.add(marker);
            overlayObjectsRef.current.push(marker);
          }

          setState((prev) => ({
            ...prev,
            firstPoint: worldPoint,
            statusText: "Click second point",
          }));
          forceSceneUpdate();
        } else {
          // Second click — compute distance and render annotation
          cleanupPreview();
          cleanupOverlays();

          const distance = computePointDistance(state.firstPoint, worldPoint);
          const overlays = renderDistanceAnnotation(state.firstPoint, worldPoint, distance);

          measureIdRef.current++;
          const measureId = `measure-${measureIdRef.current}`;
          tagOverlays(overlays, measureId);
          const measurement: Measurement = {
            type: "distance",
            id: measureId,
            pointA: state.firstPoint.clone(),
            pointB: worldPoint.clone(),
            distance,
            pinned: false,
            overlayObjects: overlays,
          };
          measurementsRef.current.push(measurement);
          bumpVersion();

          setState((prev) => ({
            ...prev,
            firstPoint: null,
            statusText: `Distance: ${distance.toFixed(3)} — Click first point for new measurement`,
          }));
        }
      } else if (state.subMode === "edge-length") {
        // ── Edge Length sub-mode ──
        if (!edgeOverlayGroupRef.current) return;

        const edgeObjects: THREE.Object3D[] = [];
        edgeOverlayGroupRef.current.traverse((child) => {
          if (child instanceof Line2) {
            edgeObjects.push(child);
          }
        });

        (raycaster.params as any).Line2 = { threshold: 8 };
        const edgeIntersects = raycaster.intersectObjects(edgeObjects);
        if (edgeIntersects.length === 0) return;

        const edgeIndex = edgeIntersects[0].object.userData.edgeIndex as number;
        const elementId = activeElementRef.current;
        if (!elementId) return;

        const element = elements.find((el) => el.nodeId === elementId);
        if (!element) return;

        try {
          const client = OccWorkerClient.getInstance();
          const rotation = (element.rotation && (element.rotation.x !== 0 || element.rotation.y !== 0 || element.rotation.z !== 0))
            ? { x: element.rotation.x, y: element.rotation.y, z: element.rotation.z, order: element.rotation.order } as EulerJSON
            : undefined;

          const lengthResult = await client.send<WorkerEdgeLengthResult>({
            type: "edgeLength",
            payload: {
              brepJson: element.brep.toJSON(),
              position: { x: element.position.x, y: element.position.y, z: element.position.z },
              edgeIndex,
              occBrep: element.occBrep,
              rotation,
            },
          });

          const length = lengthResult.length;

          const edgeData = edgeSegmentsRef.current.find((e) => e.edgeIndex === edgeIndex);
          if (!edgeData) return;

          const overlays = renderEdgeLengthAnnotation(edgeData, length);

          measureIdRef.current++;
          const measureId = `measure-${measureIdRef.current}`;
          tagOverlays(overlays, measureId);
          const measurement: Measurement = {
            type: "edge-length",
            id: measureId,
            elementNodeId: elementId,
            edgeIndex,
            edgeSegments: edgeData.segments,
            midpoint: edgeData.midpoint,
            length,
            pinned: false,
            overlayObjects: overlays,
          };
          measurementsRef.current.push(measurement);
          bumpVersion();

          setState((prev) => ({
            ...prev,
            statusText: `Edge length: ${length.toFixed(3)} — Hover and click another edge`,
          }));
        } catch (error) {
          console.error("[useMeasureMode] Edge length measurement failed:", error);
        }
      } else if (state.subMode === "angle") {
        // ── Angle sub-mode ──
        if (!edgeOverlayGroupRef.current) return;

        const edgeObjects: THREE.Object3D[] = [];
        edgeOverlayGroupRef.current.traverse((child) => {
          if (child instanceof Line2) {
            edgeObjects.push(child);
          }
        });

        (raycaster.params as any).Line2 = { threshold: 8 };
        const edgeIntersects = raycaster.intersectObjects(edgeObjects);
        if (edgeIntersects.length === 0) return;

        const edgeIndex = edgeIntersects[0].object.userData.edgeIndex as number;
        const elementId = activeElementRef.current;
        if (!elementId) return;

        if (!state.firstEdge) {
          // First edge selection
          // Highlight the selected edge
          edgeOverlayGroupRef.current.children.forEach((child) => {
            if (child instanceof Line2 && child.userData.isMeasureEdge) {
              const mat = child.material as LineMaterial;
              if (child.userData.edgeIndex === edgeIndex) {
                mat.color.set(MEASURE.edgeHighlight);
                mat.opacity = 1.0;
              }
            }
          });

          setState((prev) => ({
            ...prev,
            firstEdge: { elementId, edgeIndex },
            statusText: "Click second edge for angle measurement",
          }));
          forceSceneUpdate();
        } else {
          // Second edge — compute angle
          try {
            const element = elements.find((el) => el.nodeId === state.firstEdge!.elementId);
            if (!element) return;

            const client = OccWorkerClient.getInstance();
            const rotation = (element.rotation && (element.rotation.x !== 0 || element.rotation.y !== 0 || element.rotation.z !== 0))
              ? { x: element.rotation.x, y: element.rotation.y, z: element.rotation.z, order: element.rotation.order } as EulerJSON
              : undefined;

            const [resultA, resultB] = await Promise.all([
              client.send<WorkerEdgeDirectionResult>({
                type: "edgeDirection",
                payload: {
                  brepJson: element.brep.toJSON(),
                  position: { x: element.position.x, y: element.position.y, z: element.position.z },
                  edgeIndex: state.firstEdge.edgeIndex,
                  occBrep: element.occBrep,
                  rotation,
                },
              }),
              client.send<WorkerEdgeDirectionResult>({
                type: "edgeDirection",
                payload: {
                  brepJson: element.brep.toJSON(),
                  position: { x: element.position.x, y: element.position.y, z: element.position.z },
                  edgeIndex: edgeIndex,
                  occBrep: element.occBrep,
                  rotation,
                },
              }),
            ]);

            const dirA = resultA.direction;
            const dirB = resultB.direction;

            const vecA = new THREE.Vector3(dirA.x, dirA.y, dirA.z);
            const vecB = new THREE.Vector3(dirB.x, dirB.y, dirB.z);

            // Find intersection point (use midpoint of first edge as vertex approximation)
            const edgeA = edgeSegmentsRef.current.find((e) => e.edgeIndex === state.firstEdge!.edgeIndex);
            const edgeB = edgeSegmentsRef.current.find((e) => e.edgeIndex === edgeIndex);
            let vertex: THREE.Vector3;
            if (edgeA && edgeB) {
              // Use the endpoint of edge A closest to edge B's midpoint as the vertex
              const aStart = new THREE.Vector3(edgeA.segments[0], edgeA.segments[1], edgeA.segments[2]);
              const aEnd = new THREE.Vector3(
                edgeA.segments[edgeA.segments.length - 3],
                edgeA.segments[edgeA.segments.length - 2],
                edgeA.segments[edgeA.segments.length - 1],
              );
              const bStart = new THREE.Vector3(edgeB.segments[0], edgeB.segments[1], edgeB.segments[2]);
              const bEnd = new THREE.Vector3(
                edgeB.segments[edgeB.segments.length - 3],
                edgeB.segments[edgeB.segments.length - 2],
                edgeB.segments[edgeB.segments.length - 1],
              );

              // Find the pair of endpoints that are closest
              const pairs = [
                { point: aStart, dist: Math.min(aStart.distanceTo(bStart), aStart.distanceTo(bEnd)) },
                { point: aEnd, dist: Math.min(aEnd.distanceTo(bStart), aEnd.distanceTo(bEnd)) },
                { point: bStart, dist: Math.min(bStart.distanceTo(aStart), bStart.distanceTo(aEnd)) },
                { point: bEnd, dist: Math.min(bEnd.distanceTo(aStart), bEnd.distanceTo(aEnd)) },
              ];
              pairs.sort((a, b) => a.dist - b.dist);
              vertex = pairs[0].point;
            } else {
              vertex = new THREE.Vector3(
                edgeA?.midpoint.x ?? 0,
                edgeA?.midpoint.y ?? 0,
                edgeA?.midpoint.z ?? 0,
              );
            }

            // Flip directions so they point FROM vertex ALONG edges (toward midpoints).
            // getEdgeDirectionAtMidpoint returns parametric tangent which may point
            // toward or away from the vertex — ensure consistent "away from vertex".
            if (edgeA) {
              const midA = new THREE.Vector3(edgeA.midpoint.x, edgeA.midpoint.y, edgeA.midpoint.z);
              let toMidA = midA.clone().sub(vertex);
              if (toMidA.lengthSq() < 1e-8) {
                // Midpoint coincides with vertex; use far endpoint instead
                toMidA.set(
                  edgeA.segments[edgeA.segments.length - 3] - vertex.x,
                  edgeA.segments[edgeA.segments.length - 2] - vertex.y,
                  edgeA.segments[edgeA.segments.length - 1] - vertex.z,
                );
              }
              if (vecA.dot(toMidA) < 0) {
                vecA.negate();
              }
            }
            if (edgeB) {
              const midB = new THREE.Vector3(edgeB.midpoint.x, edgeB.midpoint.y, edgeB.midpoint.z);
              let toMidB = midB.clone().sub(vertex);
              if (toMidB.lengthSq() < 1e-8) {
                toMidB.set(
                  edgeB.segments[edgeB.segments.length - 3] - vertex.x,
                  edgeB.segments[edgeB.segments.length - 2] - vertex.y,
                  edgeB.segments[edgeB.segments.length - 1] - vertex.z,
                );
              }
              if (vecB.dot(toMidB) < 0) {
                vecB.negate();
              }
            }

            // Compute angle AFTER flipping directions to get the interior angle
            const angleDeg = computeAngleBetweenVectors(vecA, vecB);

            const overlays = renderAngleAnnotation(vertex, vecA, vecB, angleDeg);

            measureIdRef.current++;
            const measureId = `measure-${measureIdRef.current}`;
            tagOverlays(overlays, measureId);
            const measurement: Measurement = {
              type: "angle",
              id: measureId,
              vertex: vertex.clone(),
              directionA: vecA.clone(),
              directionB: vecB.clone(),
              angleDegrees: angleDeg,
              pinned: false,
              overlayObjects: overlays,
            };
            measurementsRef.current.push(measurement);
            bumpVersion();

            // Reset edge highlight
            edgeOverlayGroupRef.current?.children.forEach((child) => {
              if (child instanceof Line2 && child.userData.isMeasureEdge) {
                (child.material as LineMaterial).opacity = 0;
              }
            });

            setState((prev) => ({
              ...prev,
              firstEdge: null,
              secondEdge: null,
              statusText: `Angle: ${angleDeg.toFixed(1)}° — Click first edge for new angle`,
            }));
          } catch (error) {
            console.error("[useMeasureMode] Angle measurement failed:", error);
          }
        }
      }
    },
    [
      camera, renderer, scene, state.subMode, state.firstPoint, state.firstEdge,
      elements, getPickableObjects, findElementByHit,
      cleanupPreview, cleanupOverlays,
      renderDistanceAnnotation, renderEdgeLengthAnnotation, renderAngleAnnotation,
      forceSceneUpdate, selectMeasurement, bumpVersion,
    ],
  );

  // ─── Handle mouse move ─────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!camera || !renderer) return;

      const raycaster = new THREE.Raycaster();
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);

      if (state.subMode === "distance") {
        // Show live preview line when first point is set
        if (state.firstPoint) {
          const objects = getPickableObjects();
          const intersects = raycaster.intersectObjects(objects, true);
          if (intersects.length > 0) {
            const hit = intersects[0];
            const hitElement = findElementByHit(hit.object);
            let worldPoint = hit.point.clone();
            if (hitElement) {
              const snap = findNearestVertex(worldPoint, hitElement, 0.15);
              if (snap) worldPoint = snap.position;
            }

            cleanupPreview();
            const dist = computePointDistance(state.firstPoint, worldPoint);

            // Dashed preview line
            const previewLine = createLine2(
              [state.firstPoint.x, state.firstPoint.y, state.firstPoint.z, worldPoint.x, worldPoint.y, worldPoint.z],
              MEASURE.lineHover, 1.0, true,
            );
            if (scene) {
              scene.add(previewLine);
              previewObjectsRef.current.push(previewLine);
            }

            // Live distance label
            const mid = state.firstPoint.clone().add(worldPoint).multiplyScalar(0.5);
            mid.y += 0.15;
            const label = createValueSprite(`${dist.toFixed(3)}`, mid, MEASURE.lineHover);
            if (scene) {
              scene.add(label);
              previewObjectsRef.current.push(label);
            }

            forceSceneUpdate();
          }
        } else {
          // Highlight hovered body
          const objects = getPickableObjects();
          const intersects = raycaster.intersectObjects(objects, true);
          if (intersects.length > 0) {
            const hitElement = findElementByHit(intersects[0].object);
            if (hitElement && hitElement.nodeId !== hoveredBodyRef.current) {
              resetBodyHover();
              hoveredBodyRef.current = hitElement.nodeId;
              const obj = getObject(hitElement.nodeId);
              if (obj) {
                obj.traverse((child) => {
                  if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
                    (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.hover);
                  }
                });
              }
              forceSceneUpdate();
            } else if (!hitElement && hoveredBodyRef.current) {
              resetBodyHover();
              forceSceneUpdate();
            }
          } else if (hoveredBodyRef.current) {
            resetBodyHover();
            forceSceneUpdate();
          }
        }
      } else if (state.subMode === "edge-length" || state.subMode === "angle") {
        // Edge hover — build overlays for hovered body if needed, then highlight edge
        const objects = getPickableObjects();
        const intersects = raycaster.intersectObjects(objects, true);

        if (intersects.length > 0) {
          const hitElement = findElementByHit(intersects[0].object);
          if (hitElement) {
            // Build edge overlays if this is a new element
            if (activeElementRef.current !== hitElement.nodeId) {
              buildEdgeOverlays(hitElement.nodeId);
            }

            // Raycast against edge overlays
            if (edgeOverlayGroupRef.current) {
              const edgeObjects: THREE.Object3D[] = [];
              edgeOverlayGroupRef.current.traverse((child) => {
                if (child instanceof THREE.LineSegments) {
                  edgeObjects.push(child);
                }
              });

              (raycaster.params as any).Line2 = { threshold: 8 };
              const edgeIntersects = raycaster.intersectObjects(edgeObjects);

              let newHovered: number | null = null;
              if (edgeIntersects.length > 0) {
                newHovered = edgeIntersects[0].object.userData.edgeIndex as number;
              }

              if (newHovered !== state.hoveredEdgeIndex) {
                // Update edge highlighting
                edgeOverlayGroupRef.current.children.forEach((child) => {
                  if (child instanceof Line2 && child.userData.isMeasureEdge) {
                    const idx = child.userData.edgeIndex;
                    const mat = child.material as LineMaterial;

                    // Keep first edge highlighted in angle mode
                    if (state.subMode === "angle" && state.firstEdge && idx === state.firstEdge.edgeIndex) {
                      mat.color.set(MEASURE.edgeHighlight);
                      mat.opacity = 1.0;
                    } else if (idx === newHovered) {
                      mat.color.set(MEASURE.lineHover);
                      mat.opacity = 1.0;
                    } else {
                      mat.opacity = 0;
                    }
                  }
                });

                setState((prev) => ({
                  ...prev,
                  hoveredEdgeIndex: newHovered,
                  hoveredElementId: hitElement.nodeId,
                }));
                forceSceneUpdate();
              }
            }

            // Body hover highlight
            if (hitElement.nodeId !== hoveredBodyRef.current) {
              resetBodyHover();
              hoveredBodyRef.current = hitElement.nodeId;
              const obj = getObject(hitElement.nodeId);
              if (obj) {
                obj.traverse((child) => {
                  if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
                    (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.hover);
                  }
                });
              }
            }
          }
        } else {
          // Nothing hovered — reset
          if (edgeOverlayGroupRef.current) {
            edgeOverlayGroupRef.current.children.forEach((child) => {
              if (child instanceof Line2 && child.userData.isMeasureEdge) {
                const mat = child.material as LineMaterial;
                // Keep first edge highlighted in angle mode
                if (state.subMode === "angle" && state.firstEdge &&
                  child.userData.edgeIndex === state.firstEdge.edgeIndex) {
                  mat.color.set(MEASURE.edgeHighlight);
                  mat.opacity = 1.0;
                } else {
                  mat.opacity = 0;
                }
              }
            });
          }
          if (state.hoveredEdgeIndex !== null) {
            setState((prev) => ({ ...prev, hoveredEdgeIndex: null, hoveredElementId: null }));
          }
          if (hoveredBodyRef.current) {
            resetBodyHover();
          }
          forceSceneUpdate();
        }
      }
    },
    [
      camera, renderer, scene,
      state.subMode, state.firstPoint, state.hoveredEdgeIndex, state.firstEdge,
      elements, getPickableObjects, findElementByHit, getObject,
      buildEdgeOverlays, cleanupPreview, resetBodyHover, forceSceneUpdate,
    ],
  );

  // ─── Switch sub-mode ───────────────────────────────────────────────

  const setSubMode = useCallback(
    (newSubMode: MeasureSubMode) => {
      cleanupPreview();
      cleanupOverlays();
      cleanupEdgeOverlay();
      resetBodyHover();

      setState({
        subMode: newSubMode,
        firstPoint: null,
        hoveredEdgeIndex: null,
        hoveredElementId: null,
        firstEdge: null,
        secondEdge: null,
        statusText: newSubMode === "distance"
          ? "Click first point"
          : newSubMode === "edge-length"
            ? "Hover over an edge and click"
            : "Click first edge",
      });

      forceSceneUpdate();
    },
    [cleanupPreview, cleanupOverlays, cleanupEdgeOverlay, resetBodyHover, forceSceneUpdate],
  );

  // ─── Clear temporary measurements ─────────────────────────────────

  const clearTemporaryMeasurements = useCallback(() => {
    cleanupMeasurements();
    setSelectedMeasurementId(null);
    forceSceneUpdate();
  }, [cleanupMeasurements, forceSceneUpdate]);

  // ─── Pin a measurement (selected or by ID, or last if neither) ─────

  const pinMeasurement = useCallback((id?: string): boolean => {
    const targetId = id ?? selectedMeasurementIdRef.current;
    // Fallback to last temporary measurement if no ID and no selection
    const resolvedId = targetId ?? (measurementsRef.current.length > 0
      ? measurementsRef.current[measurementsRef.current.length - 1].id
      : null);
    if (!resolvedId) return false;

    const measurement = measurementsRef.current.find((m) => m.id === resolvedId);
    if (!measurement || measurement.pinned) return false;

    // Change colors to pinned (blue)
    for (const obj of measurement.overlayObjects) {
      if (obj instanceof Line2) {
        (obj.material as LineMaterial).color.set(MEASURE.pinnedLine);
      }
    }

    measurementsRef.current = measurementsRef.current.filter((m) => m.id !== resolvedId);
    addPinnedMeasurement(measurement);
    if (selectedMeasurementIdRef.current === resolvedId) {
      selectedMeasurementIdRef.current = null;
      setSelectedMeasurementId(null);
    }
    bumpVersion();
    return true;
  }, [addPinnedMeasurement, bumpVersion]);

  // ─── Unpin a measurement (selected or by ID) ───────────────────────

  const unpinMeasurement = useCallback((id?: string): boolean => {
    const targetId = id ?? selectedMeasurementIdRef.current;
    if (!targetId) return false;
    const measurement = pinnedMeasurementsRef.current.find((m) => m.id === targetId);
    if (!measurement) return false;

    // Remove pinned measurement (disposes old overlays + removes from scene)
    removePinnedMeasurement(measurement.id);

    // Re-create overlay objects as temporary (unpinned) with fresh renders
    let newOverlays: THREE.Object3D[] = [];
    if (measurement.type === "distance") {
      newOverlays = renderDistanceAnnotation(measurement.pointA, measurement.pointB, measurement.distance, false);
    } else if (measurement.type === "edge-length") {
      const edgeData: EdgeSegmentData = {
        edgeIndex: measurement.edgeIndex,
        segments: measurement.edgeSegments,
        midpoint: measurement.midpoint,
      };
      newOverlays = renderEdgeLengthAnnotation(edgeData, measurement.length, false);
    } else if (measurement.type === "angle") {
      newOverlays = renderAngleAnnotation(measurement.vertex, measurement.directionA, measurement.directionB, measurement.angleDegrees, false);
    }

    measureIdRef.current++;
    const newId = `measure-${measureIdRef.current}`;
    tagOverlays(newOverlays, newId);

    const newMeasurement: Measurement = {
      ...measurement,
      id: newId,
      pinned: false,
      overlayObjects: newOverlays,
    };
    measurementsRef.current.push(newMeasurement);
    if (selectedMeasurementIdRef.current === targetId) {
      selectedMeasurementIdRef.current = null;
      setSelectedMeasurementId(null);
    }
    bumpVersion();
    forceSceneUpdate();
    return true;
  }, [removePinnedMeasurement, renderDistanceAnnotation, renderEdgeLengthAnnotation, renderAngleAnnotation, forceSceneUpdate, bumpVersion]);

  // ─── Delete a measurement (selected or by ID) ──────────────────────

  const deleteMeasurement = useCallback((id?: string): boolean => {
    const targetId = id ?? selectedMeasurementIdRef.current;
    if (!targetId) return false;

    // Check temporary measurements first
    const tempIdx = measurementsRef.current.findIndex((m) => m.id === targetId);
    if (tempIdx !== -1) {
      const measurement = measurementsRef.current[tempIdx];
      for (const obj of measurement.overlayObjects) {
        disposeMeasureOverlay(obj);
      }
      measurementsRef.current.splice(tempIdx, 1);
      if (selectedMeasurementIdRef.current === targetId) {
        selectedMeasurementIdRef.current = null;
        setSelectedMeasurementId(null);
      }
      bumpVersion();
      forceSceneUpdate();
      return true;
    }

    // Check pinned measurements
    const pinned = pinnedMeasurementsRef.current.find((m) => m.id === targetId);
    if (pinned) {
      removePinnedMeasurement(pinned.id);
      if (selectedMeasurementIdRef.current === targetId) {
        selectedMeasurementIdRef.current = null;
        setSelectedMeasurementId(null);
      }
      forceSceneUpdate();
      return true;
    }

    return false;
  }, [removePinnedMeasurement, forceSceneUpdate, bumpVersion]);

  // ─── Keyboard handler ──────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;

      switch (event.key) {
        case "Escape":
          if (state.subMode === "distance" && state.firstPoint) {
            // Cancel current distance measurement
            cleanupPreview();
            cleanupOverlays();
            setState((prev) => ({
              ...prev,
              firstPoint: null,
              statusText: "Click first point",
            }));
            forceSceneUpdate();
          } else if (state.subMode === "angle" && state.firstEdge) {
            // Cancel angle first edge
            if (edgeOverlayGroupRef.current) {
              edgeOverlayGroupRef.current.children.forEach((child) => {
                if (child instanceof Line2 && child.userData.isMeasureEdge) {
                  (child.material as LineMaterial).opacity = 0;
                }
              });
            }
            setState((prev) => ({
              ...prev,
              firstEdge: null,
              statusText: "Click first edge",
            }));
            forceSceneUpdate();
          }
          break;
        case "d":
        case "D":
          setSubMode("distance");
          break;
        case "e":
        case "E":
          setSubMode("edge-length");
          break;
        case "a":
        case "A":
          setSubMode("angle");
          break;
        // "P" (pin) and "C" (clear) are handled in simpleCadScene where
        // addPinnedMeasurement from CoreContext is available.
      }
    },
    [
      state.subMode, state.firstPoint, state.firstEdge,
      cleanupPreview, cleanupOverlays,
      setSubMode, forceSceneUpdate,
    ],
  );

  // ─── Full cleanup ──────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    cleanupPreview();
    cleanupOverlays();
    cleanupEdgeOverlay();
    cleanupMeasurements();
    resetBodyHover();
    setSelectedMeasurementId(null);

    setState({
      subMode: "distance",
      firstPoint: null,
      hoveredEdgeIndex: null,
      hoveredElementId: null,
      firstEdge: null,
      secondEdge: null,
      statusText: "Click first point",
    });
  }, [cleanupPreview, cleanupOverlays, cleanupEdgeOverlay, cleanupMeasurements, resetBodyHover]);

  return {
    subMode: state.subMode,
    statusText: state.statusText,
    firstPoint: state.firstPoint,
    firstEdge: state.firstEdge,
    handleMouseDown,
    handleMouseMove,
    handleKeyDown,
    setSubMode,
    clearTemporaryMeasurements,
    cleanup,
    measurements: measurementsRef.current,
    selectedMeasurementId,
    selectMeasurement,
    pinMeasurement,
    unpinMeasurement,
    deleteMeasurement,
  };
}
