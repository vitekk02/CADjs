import { useCallback, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import {
  Sketch,
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  SketchPrimitive,
  SketchConstraint,
  ConstraintType,
  ConstraintResultStatus,
  SketchPlane,
  SketchPlaneType,
  isSketchPoint,
  isSketchLine,
  isSketchCircle,
  isSketchArc,
  createSketchPlane,
  createSketchPlaneFromNormal,
} from "../types/sketch-types";
import { useSketchInference, InferencePoint, Guideline } from "./useSketchInference";
import {
  findAllIntersections,
  identifyTrimSegment,
  findClosestEndpoint,
  findNearestExtendTarget,
  findNearestArcExtendTarget,
  normalizeAngle,
  isAngleInArcRange,
  getArcAngles,
  IntersectionResult,
} from "../scene-operations/sketch-intersection-utils";
import {
  trimLineAtSegment,
  convertCircleToArc,
} from "../scene-operations/sketch-operations";

export type SketchSubMode = "select" | "line" | "rectangle" | "circle" | "arc" | "point" | "dimension" | "trim" | "extend";

// Info about a newly created line for dimension input
export interface PendingLineDimension {
  lineId: string;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  length: number;
  midpoint: THREE.Vector3;
}

// Context menu state for right-click constraints
export interface SketchContextMenu {
  visible: boolean;
  x: number;
  y: number;
  primitiveIds: string[];
  primitiveTypes: string[];
  constraintId?: string | null;
}

interface UseSketchModeResult {
  sketchSubMode: SketchSubMode;
  setSketchSubMode: (mode: SketchSubMode) => void;
  handleSketchMode: (event: MouseEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  cleanupSketchPreview: () => void;
  sketchObjects: THREE.Object3D[];
  startNewSketch: () => void;
  selectedPrimitives: string[];
  selectPrimitive: (id: string, addToSelection: boolean) => void;
  clearSelection: () => void;
  applyConstraint: (type: ConstraintType, value?: number) => void;
  isChaining: boolean;
  cancelCurrentOperation: () => void;
  currentInferencePoint: InferencePoint | null;
  guidelines: Guideline[];
  // New: For dimension input after line creation
  pendingLineDimension: PendingLineDimension | null;
  clearPendingLineDimension: () => void;
  applyLineLengthConstraint: (lineId: string, length: number) => Promise<void>;
  // Context menu for right-click constraints
  contextMenu: SketchContextMenu;
  closeContextMenu: () => void;
  applyConstraintToContextMenuPrimitives: (type: ConstraintType, value?: number) => Promise<void>;
  deleteConstraint: (constraintId: string) => void;
  // Plane selection (Fusion 360 style)
  isSelectingPlane: boolean;
  hoveredPlane: SketchPlaneType | null;
  enterPlaneSelectionMode: () => void;
  cancelPlaneSelection: () => void;
  selectPlaneAndStartSketch: (planeOrType: SketchPlane | SketchPlaneType, offset?: number) => void;
  cleanupSketchGrid: () => void;
  handlePlaneSelectionMouseMove: (event: MouseEvent) => void;
  handlePlaneSelectionClick: (event: MouseEvent) => void;
  setPlaneOffset: (v: number) => void;
  // Constraint feedback (redundant/conflicting rollback)
  constraintFeedback: { message: string; type: "redundant" | "conflicting" } | null;
}

/**
 * Configuration constants for sketch mode behavior.
 * All distance values are in world units.
 */
const SKETCH_CONFIG = {
  /** Distance in world units to snap to existing points when drawing */
  SNAP_DISTANCE: 0.3,
  /** Visual size of point primitives in world units */
  POINT_SIZE: 0.08,
  /** Maximum number of primitives that can be selected at once */
  MAX_SELECTION: 2,
  /** Distance in world units to snap to inference points (endpoints, midpoints, etc.) */
  INFERENCE_SNAP_DISTANCE: 0.4,
  /** Tolerance in radians for detecting horizontal/vertical alignment (~3.4 degrees) */
  ALIGNMENT_TOLERANCE: 0.06,
  /** Time threshold in milliseconds for detecting double-click */
  DOUBLE_CLICK_THRESHOLD: 300,
  /** Screen-space pixel radius for point selection (proximity check) */
  POINT_HIT_RADIUS_PX: 12,
  /** Extra pixels of tolerance for Line2 screen-space raycast */
  LINE_HIT_THRESHOLD: 8,
} as const;

/** Distance from a 2D point to a line segment (p1→p2) */
function pointToLineDistance(
  pt: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return Math.hypot(pt.x - p1.x, pt.y - p1.y);
  const t = Math.max(0, Math.min(1, ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / len2));
  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;
  return Math.hypot(pt.x - projX, pt.y - projY);
}

import { SKETCH as SKETCH_THEME, INFERENCE, SKETCH_PLANE as PLANE_THEME, BODY as BODY_THEME } from "../theme";

/** Helper: create a Line2 with LineMaterial for consistent thin-line rendering */
function createLine2FromPoints(
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
  });
  if (dashed) {
    material.defines.USE_DASH = "";
  }
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  return line;
}

/** Convert a pixel radius to sketch-space units based on current camera zoom */
function screenPxToSketchUnits(camera: THREE.Camera, renderer: THREE.WebGLRenderer, px: number): number {
  const p1 = new THREE.Vector3(0, 0, 0).project(camera);
  const p2 = new THREE.Vector3(1, 0, 0).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const pixelsPerUnit = Math.abs(p2.x - p1.x) * 0.5 * rect.width;
  return pixelsPerUnit > 0 ? px / pixelsPerUnit : 0.5;
}

/** Helper: create a constraint glyph sprite at a given position */
function createConstraintGlyph(
  text: string,
  position: THREE.Vector3,
  selected: boolean = false,
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;

  // Dark circle background (blue when selected)
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = selected ? "#0066ff" : "#333333";
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = "#3399ff";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Gold text (white when selected)
  ctx.fillStyle = selected ? "#ffffff" : "#ddaa00";
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 33);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(0.3, 0.3, 0.3);
  sprite.renderOrder = 1001;
  return sprite;
}

/** Colors for sketch visualization (hex values) — Fusion 360 style */
const COLORS = {
  /** Under-constrained geometry (needs more constraints) */
  underconstrained: SKETCH_THEME.underconstrained,
  /** Fully constrained geometry */
  constrained: SKETCH_THEME.constrained,
  /** Over-constrained geometry (conflicting constraints) */
  overconstrained: SKETCH_THEME.overconstrained,
  /** Preview while drawing */
  preview: SKETCH_THEME.preview,
  /** Point primitives (unconstrained) */
  point: SKETCH_THEME.point,
  /** Selected elements */
  selected: SKETCH_THEME.selected,
  /** Selected line primitives */
  selectedLine: SKETCH_THEME.selectedLine,
  /** Selected point primitives */
  selectedPoint: SKETCH_THEME.selectedPoint,
} as const;

export function useSketchMode(): UseSketchModeResult {
  const {
    activeSketch,
    addPrimitive,
    updatePrimitive,
    removePrimitive,
    updatePrimitivesAndSolve,
    addConstraintAndSolve,
    removeConstraint,
    startSketch,
    solveSketch,
    mode,
    elements,
    getObject,
    pushSketchUndo,
  } = useCadCore();

  const {
    scene,
    camera,
    renderer,
    getMouseIntersection,
    showGroundPlane,
    toggleGroundPlane,
    sceneReady,
    setCameraRotationEnabled,
    setDrawingPlane,
    projectionType,
    setProjectionType,
    navToolActiveRef,
    controlsRef,
  } = useCadVisualizer();

  const [sketchSubMode, setSketchSubMode] = useState<SketchSubMode>("line");
  const [selectedPrimitives, setSelectedPrimitives] = useState<string[]>([]);
  const sketchObjectsRef = useRef<THREE.Object3D[]>([]);

  // Inference system
  const {
    findInferencePoints,
    findNearestSnap,
    findGuidelines,
    isHorizontalAligned,
    isVerticalAligned,
  } = useSketchInference();

  const [currentInferencePoint, setCurrentInferencePoint] = useState<InferencePoint | null>(null);
  const [guidelines, setGuidelines] = useState<Guideline[]>([]);
  const inferenceObjectsRef = useRef<THREE.Object3D[]>([]);
  const guidelineObjectsRef = useRef<THREE.Object3D[]>([]);

  // Ctrl-key override: when held, suppress all inference (snapping, guidelines, auto H/V)
  const ctrlHeldRef = useRef(false);

  // Track current projection type via ref to avoid stale closures in callbacks
  const projectionTypeRef = useRef(projectionType);
  useEffect(() => { projectionTypeRef.current = projectionType; }, [projectionType]);

  // Body dimming state - stores original material properties for restoration
  const dimmedMaterialsRef = useRef<Map<string, { color: number; opacity: number; transparent: boolean }>>(new Map());

  /** Dim all existing 3D bodies so the sketch stands out */
  const dimSceneBodies = useCallback(() => {
    dimmedMaterialsRef.current.clear();
    elements.forEach((el) => {
      const obj = getObject(el.nodeId);
      if (!obj) return;
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && !child.userData.isSketchPrimitive && !child.userData.isEdgeOverlay) {
          const mat = child.material as THREE.MeshStandardMaterial;
          // Store original values
          const key = child.uuid;
          dimmedMaterialsRef.current.set(key, {
            color: mat.color.getHex(),
            opacity: mat.opacity,
            transparent: mat.transparent,
          });
          // Dim: reduce opacity and desaturate
          mat.transparent = true;
          mat.opacity = BODY_THEME.dimmedOpacity;
          mat.color.set(BODY_THEME.dimmedColor);
          mat.needsUpdate = true;
        }
        // Also dim edge overlays (LineSegments2 extends Mesh, check userData)
        if (child.userData.isEdgeOverlay) {
          const mat = (child as any).material;
          if (mat) {
            const key = child.uuid;
            dimmedMaterialsRef.current.set(key, {
              color: mat.color.getHex(),
              opacity: mat.opacity ?? 1,
              transparent: mat.transparent ?? false,
            });
            mat.transparent = true;
            mat.opacity = BODY_THEME.dimmedOpacity;
            mat.needsUpdate = true;
          }
        }
      });
    });
  }, [elements, getObject]);

  /** Restore all dimmed bodies to their original appearance */
  const restoreSceneBodies = useCallback(() => {
    elements.forEach((el) => {
      const obj = getObject(el.nodeId);
      if (!obj) return;
      obj.traverse((child) => {
        const key = child.uuid;
        const saved = dimmedMaterialsRef.current.get(key);
        if (!saved) return;
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.color.set(saved.color);
          mat.opacity = saved.opacity;
          mat.transparent = saved.transparent;
          mat.needsUpdate = true;
        }
        if (child.userData.isEdgeOverlay) {
          const mat = (child as any).material;
          if (mat) {
            mat.color.set(saved.color);
            mat.opacity = saved.opacity;
            mat.transparent = saved.transparent;
            mat.needsUpdate = true;
          }
        }
      });
    });
    dimmedMaterialsRef.current.clear();
  }, [elements, getObject]);

  // Drawing state refs
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const previewObjectRef = useRef<THREE.Object3D | null>(null);
  const centerPointRef = useRef<THREE.Vector3 | null>(null); // For circle/arc
  const idCounterRef = useRef(0);

  // Trim mode state
  const trimHighlightRef = useRef<THREE.Object3D | null>(null);
  const trimHoveredPrimRef = useRef<{ primId: string; startParam: number; endParam: number } | null>(null);

  // Extend mode state
  const extendHoveredRef = useRef<{
    primId: string;
    pointId: string;
    isStart: boolean;
    targetPoint: { x: number; y: number };
  } | null>(null);

  // Shared raycaster to avoid creating new one on every mouse event
  const raycasterRef = useRef(new THREE.Raycaster());

  // Shared utility for raycasting to reduce code duplication
  const raycastToObjects = useCallback(
    (event: MouseEvent, objects: THREE.Object3D[], recursive: boolean = false): THREE.Intersection[] => {
      if (!renderer || !camera) return [];
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycasterRef.current.setFromCamera(mouse, camera);
      raycasterRef.current.camera = camera; // Required for Line2 screen-space raycast
      raycasterRef.current.params.Line2 = { threshold: SKETCH_CONFIG.LINE_HIT_THRESHOLD };
      return raycasterRef.current.intersectObjects(objects, recursive);
    },
    [renderer, camera]
  );

  // Click-to-click line chaining state
  const [isChaining, setIsChaining] = useState(false);
  const chainStartPointRef = useRef<THREE.Vector3 | null>(null);
  const chainStartPointIdRef = useRef<string | null>(null);
  const chainStartIsExistingRef = useRef<boolean>(false);
  const lastClickTimeRef = useRef<number>(0);

  // Snap info refs for auto-constraints (stores the inference point at mousedown)
  const lastSnapRef = useRef<InferencePoint | null>(null);
  const chainStartSnapRef = useRef<InferencePoint | null>(null);

  // Pending line dimension (for showing dimension input after line creation)
  const [pendingLineDimension, setPendingLineDimension] = useState<PendingLineDimension | null>(null);

  // Context menu state for right-click constraints
  const [contextMenu, setContextMenu] = useState<SketchContextMenu>({
    visible: false,
    x: 0,
    y: 0,
    primitiveIds: [],
    primitiveTypes: [],
  });

  // Constraint feedback state (for redundant/conflicting rollback)
  const [constraintFeedback, setConstraintFeedback] = useState<{ message: string; type: "redundant" | "conflicting" } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selected constraint glyph (for deletion)
  const [selectedConstraintId, setSelectedConstraintId] = useState<string | null>(null);

  // Plane selection state (Fusion 360 style)
  const [isSelectingPlane, setIsSelectingPlane] = useState(false);
  const [hoveredPlane, setHoveredPlane] = useState<SketchPlaneType | null>(null);
  const planeObjectsRef = useRef<THREE.Object3D[]>([]);
  const planeOffsetRef = useRef(0);
  const offsetPreviewRef = useRef<THREE.Group | null>(null);
  const sketchHidGroundPlaneRef = useRef(false);

  // Drag-to-move state for primitives
  const isDraggingRef = useRef(false);
  const dragStartPointRef = useRef<THREE.Vector3 | null>(null);
  const draggedPrimitiveIdsRef = useRef<string[]>([]);
  const dragOriginalPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Ref to prevent stale closure issues with activeSketch during drag
  const activeSketchRef = useRef(activeSketch);

  // sketchTo3D converts 2D sketch coords to 3D — defined in render effect,
  // exposed via ref so click handler can project points to screen space
  const sketchTo3DRef = useRef<(x: number, y: number, zOffset?: number) => THREE.Vector3>(
    (x, y, zOffset = 0) => new THREE.Vector3(x, y, zOffset)
  );

  // Helper: show constraint feedback toast with auto-dismiss
  const showConstraintFeedback = useCallback((status: ConstraintResultStatus) => {
    if (status === "applied" || status === "failed") return;
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    const message = status === "redundant"
      ? "Constraint already satisfied"
      : "Constraint conflicts with existing constraints";
    setConstraintFeedback({ message, type: status });
    feedbackTimerRef.current = setTimeout(() => {
      setConstraintFeedback(null);
      feedbackTimerRef.current = null;
    }, 3000);
  }, []);

  // Use config constants
  const { INFERENCE_SNAP_DISTANCE, ALIGNMENT_TOLERANCE, DOUBLE_CLICK_THRESHOLD, SNAP_DISTANCE } = SKETCH_CONFIG;

  // Keep activeSketchRef in sync with activeSketch to avoid stale closures
  useEffect(() => {
    activeSketchRef.current = activeSketch;
  }, [activeSketch]);

  // Track Ctrl key for inference override (hold Ctrl to suppress snapping/guidelines/auto-constraints)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") ctrlHeldRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") ctrlHeldRef.current = false;
    };
    const onBlur = () => {
      ctrlHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Generate unique IDs for primitives
  const generateId = useCallback((prefix: string) => {
    idCounterRef.current += 1;
    return `${prefix}_${idCounterRef.current}`;
  }, []);

  // Snap to grid
  const snapToGrid = useCallback(
    (point: THREE.Vector3): THREE.Vector3 => {
      if (showGroundPlane) {
        const gridSize = 0.5;
        point.x = Math.round(point.x / gridSize) * gridSize;
        point.y = Math.round(point.y / gridSize) * gridSize;
      }
      return point;
    },
    [showGroundPlane]
  );

  // Convert a 3D world point to 2D sketch coordinates (inverse of sketchTo3D)
  const worldToSketch2D = useCallback(
    (point3D: THREE.Vector3, plane: SketchPlane): THREE.Vector3 => {
      const delta = point3D.clone().sub(plane.origin);
      return new THREE.Vector3(delta.dot(plane.xAxis), delta.dot(plane.yAxis), 0);
    },
    []
  );

  // Calculate distance from a point to a line segment (for pointOnLine constraint)
  const getDistanceToLine = useCallback(
    (px: number, py: number, lineId: string): number => {
      if (!activeSketch) return Infinity;

      const line = activeSketch.primitives.find(p => p.id === lineId);
      if (!line || !isSketchLine(line)) return Infinity;

      const p1 = activeSketch.primitives.find(p => p.id === line.p1Id);
      const p2 = activeSketch.primitives.find(p => p.id === line.p2Id);
      if (!p1 || !p2 || !isSketchPoint(p1) || !isSketchPoint(p2)) return Infinity;

      // Line segment from (x1, y1) to (x2, y2)
      const x1 = p1.x, y1 = p1.y;
      const x2 = p2.x, y2 = p2.y;

      // Vector from p1 to p2
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) {
        // Line is actually a point
        return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
      }

      // Calculate projection parameter t (clamped to [0, 1] for segment)
      let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));

      // Closest point on line segment
      const closestX = x1 + t * dx;
      const closestY = y1 + t * dy;

      return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
    },
    [activeSketch]
  );

  // Find nearby point to snap to
  const findNearbyPoint = useCallback(
    (point: THREE.Vector3): SketchPoint | null => {
      if (!activeSketch) return null;

      for (const primitive of activeSketch.primitives) {
        if (isSketchPoint(primitive)) {
          const dist = Math.sqrt(
            Math.pow(point.x - primitive.x, 2) +
            Math.pow(point.y - primitive.y, 2)
          );
          if (dist < SNAP_DISTANCE) {
            return primitive;
          }
        }
      }
      return null;
    },
    [activeSketch]
  );

  // Create or get point at location
  const getOrCreatePoint = useCallback(
    (point: THREE.Vector3, fixed: boolean = false): { id: string; isExisting: boolean } => {
      const nearbyPoint = findNearbyPoint(point);
      if (nearbyPoint) {
        return { id: nearbyPoint.id, isExisting: true };
      }

      const newPoint: SketchPoint = {
        id: generateId("pt"),
        type: "point",
        x: point.x,
        y: point.y,
        fixed,
      };
      pushSketchUndo();
      addPrimitive(newPoint);
      return { id: newPoint.id, isExisting: false };
    },
    [findNearbyPoint, addPrimitive, generateId, pushSketchUndo]
  );

  // Cleanup preview objects
  const cleanupSketchPreview = useCallback(() => {
    if (previewObjectRef.current && scene) {
      scene.remove(previewObjectRef.current);
      const obj = previewObjectRef.current;
      if (obj instanceof Line2 || obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
      previewObjectRef.current = null;
    }
    // Clean up trim/extend highlight
    if (trimHighlightRef.current && scene) {
      scene.remove(trimHighlightRef.current);
      if (trimHighlightRef.current instanceof THREE.Group) {
        trimHighlightRef.current.traverse((child) => {
          if (child instanceof Line2 || child instanceof THREE.Line || child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
      } else if (trimHighlightRef.current instanceof Line2 || trimHighlightRef.current instanceof THREE.Line) {
        trimHighlightRef.current.geometry.dispose();
        (trimHighlightRef.current.material as THREE.Material).dispose();
      }
      trimHighlightRef.current = null;
    }
    trimHoveredPrimRef.current = null;
    extendHoveredRef.current = null;
  }, [scene]);

  // Cleanup inference visualization objects
  const cleanupInferenceObjects = useCallback(() => {
    if (scene) {
      inferenceObjectsRef.current.forEach((obj) => {
        scene.remove(obj);
        if (obj instanceof THREE.Mesh || obj instanceof Line2 || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        } else if (obj instanceof THREE.Sprite) {
          (obj.material as THREE.SpriteMaterial).map?.dispose();
          obj.material.dispose();
        }
      });
      inferenceObjectsRef.current = [];

      guidelineObjectsRef.current.forEach((obj) => {
        scene.remove(obj);
        if (obj instanceof Line2 || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      guidelineObjectsRef.current = [];
    }
  }, [scene]);

  // Render inference point glyph
  const renderInferencePoint = useCallback(
    (inferencePoint: InferencePoint) => {
      if (!scene) return;

      cleanupInferenceObjects();

      // Create glyph based on inference type
      let geometry: THREE.BufferGeometry;
      let color: number;

      switch (inferencePoint.type) {
        case "endpoint":
          // Square glyph for endpoints (smaller)
          geometry = new THREE.BoxGeometry(0.09, 0.09, 0.02);
          color = INFERENCE.endpoint;
          break;
        case "midpoint":
          // Triangle glyph for midpoints (smaller)
          const triangleShape = new THREE.Shape();
          triangleShape.moveTo(0, 0.06);
          triangleShape.lineTo(-0.05, -0.03);
          triangleShape.lineTo(0.05, -0.03);
          triangleShape.lineTo(0, 0.06);
          geometry = new THREE.ShapeGeometry(triangleShape);
          color = INFERENCE.midpoint;
          break;
        case "center":
          // Circle glyph for centers (smaller)
          geometry = new THREE.CircleGeometry(0.05, 16);
          color = INFERENCE.center;
          break;
        case "quadrant":
          // Diamond glyph for quadrants (smaller)
          const diamondShape = new THREE.Shape();
          diamondShape.moveTo(0, 0.05);
          diamondShape.lineTo(-0.05, 0);
          diamondShape.lineTo(0, -0.05);
          diamondShape.lineTo(0.05, 0);
          diamondShape.lineTo(0, 0.05);
          geometry = new THREE.ShapeGeometry(diamondShape);
          color = INFERENCE.quadrant;
          break;
        case "intersection":
          // X glyph for intersections (smaller)
          geometry = new THREE.BoxGeometry(0.07, 0.07, 0.02);
          color = INFERENCE.intersection;
          break;
        default:
          geometry = new THREE.CircleGeometry(0.04, 8);
          color = INFERENCE.default;
      }

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      // Convert 2D inference position to 3D world coordinates
      const pos3D = sketchTo3DRef.current(inferencePoint.position.x, inferencePoint.position.y, 0.2);
      mesh.position.copy(pos3D);
      mesh.renderOrder = 1000;

      scene.add(mesh);
      inferenceObjectsRef.current.push(mesh);
    },
    [scene, cleanupInferenceObjects]
  );

  // Render guidelines
  const renderGuidelines = useCallback(
    (currentGuidelines: Guideline[]) => {
      if (!scene) return;

      // Clear old guidelines (but keep inference glyphs)
      guidelineObjectsRef.current.forEach((obj) => {
        scene.remove(obj);
        if (obj instanceof Line2 || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      guidelineObjectsRef.current = [];

      for (const guideline of currentGuidelines) {
        // Convert 2D guideline positions to 3D world coordinates
        const s3d = sketchTo3DRef.current(guideline.start.x, guideline.start.y, 0.01);
        const e3d = sketchTo3DRef.current(guideline.end.x, guideline.end.y, 0.01);
        const positions = [
          s3d.x, s3d.y, s3d.z,
          e3d.x, e3d.y, e3d.z,
        ];
        const line = createLine2FromPoints(positions, guideline.color, 1.0, true);
        line.material.transparent = true;
        line.material.opacity = 0.6;
        line.material.depthTest = false;
        line.renderOrder = 999;

        scene.add(line);
        guidelineObjectsRef.current.push(line);
      }
    },
    [scene]
  );


  // Create line preview using Line2 (inputs are 2D sketch coords, converted to 3D for rendering)
  const createLinePreview = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3): Line2 => {
      const s3d = sketchTo3DRef.current(start.x, start.y, 0.01);
      const e3d = sketchTo3DRef.current(end.x, end.y, 0.01);
      const positions = [s3d.x, s3d.y, s3d.z, e3d.x, e3d.y, e3d.z];
      const line = createLine2FromPoints(positions, COLORS.preview, 1.5);
      return line;
    },
    []
  );

  // Create rectangle preview using Line2 (corners are 2D sketch coords, converted to 3D for rendering)
  const createRectanglePreview = useCallback(
    (corner1: THREE.Vector3, corner2: THREE.Vector3): Line2 => {
      const bl = sketchTo3DRef.current(corner1.x, corner1.y, 0.01);
      const br = sketchTo3DRef.current(corner2.x, corner1.y, 0.01);
      const tr = sketchTo3DRef.current(corner2.x, corner2.y, 0.01);
      const tl = sketchTo3DRef.current(corner1.x, corner2.y, 0.01);
      const positions = [
        bl.x, bl.y, bl.z,
        br.x, br.y, br.z,
        tr.x, tr.y, tr.z,
        tl.x, tl.y, tl.z,
        bl.x, bl.y, bl.z, // close the loop
      ];
      return createLine2FromPoints(positions, COLORS.preview, 1.5);
    },
    []
  );

  // Create circle preview using Line2 (center is 2D sketch coords, converted to 3D for rendering)
  const createCirclePreview = useCallback(
    (center: THREE.Vector3, radius: number): Line2 => {
      const segments = 64;
      const positions: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const sx = center.x + Math.cos(angle) * radius;
        const sy = center.y + Math.sin(angle) * radius;
        const p3d = sketchTo3DRef.current(sx, sy, 0.01);
        positions.push(p3d.x, p3d.y, p3d.z);
      }
      return createLine2FromPoints(positions, COLORS.preview, 1.5);
    },
    []
  );

  // Create arc preview using Line2 (inputs are 2D sketch coords, converted to 3D for rendering)
  const createArcPreview = useCallback(
    (
      center: THREE.Vector3,
      start: THREE.Vector3,
      end: THREE.Vector3
    ): Line2 => {
      const radius = center.distanceTo(start);
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

      const segments = 32;
      const positions: number[] = [];
      const angleDiff = endAngle - startAngle;
      const normalizedDiff = angleDiff > 0 ? angleDiff : angleDiff + Math.PI * 2;

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const currentAngle = startAngle + normalizedDiff * t;
        const sx = center.x + Math.cos(currentAngle) * radius;
        const sy = center.y + Math.sin(currentAngle) * radius;
        const p3d = sketchTo3DRef.current(sx, sy, 0.01);
        positions.push(p3d.x, p3d.y, p3d.z);
      }

      return createLine2FromPoints(positions, COLORS.preview, 1.5);
    },
    []
  );

  // Auto-apply horizontal or vertical constraint if line is nearly aligned
  // Returns the post-solve sketch so callers can read final point positions
  const autoApplyHVConstraint = useCallback(
    async (lineId: string, p1: THREE.Vector3, p2: THREE.Vector3): Promise<Sketch | null> => {
      const horizontalTolerance = SKETCH_CONFIG.ALIGNMENT_TOLERANCE;
      const verticalTolerance = SKETCH_CONFIG.ALIGNMENT_TOLERANCE;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const angle = Math.abs(Math.atan2(dy, dx));

      // Check for horizontal (angle near 0 or π)
      if (angle < horizontalTolerance || Math.abs(angle - Math.PI) < horizontalTolerance) {
        const constraint: SketchConstraint = {
          id: generateId("const"),
          type: "horizontal",
          primitiveIds: [lineId],
          driving: true,
        };
        const result = await addConstraintAndSolve(constraint);
        if (result.status === "applied") {
          console.log("Auto-applied horizontal constraint to line", lineId);
          return result.sketch;
        }
        // Redundant/conflicting = silently skip (auto-constraints are best-effort)
        return null;
      }

      // Check for vertical (angle near π/2 or -π/2)
      if (Math.abs(angle - Math.PI / 2) < verticalTolerance || Math.abs(angle + Math.PI / 2) < verticalTolerance) {
        const constraint: SketchConstraint = {
          id: generateId("const"),
          type: "vertical",
          primitiveIds: [lineId],
          driving: true,
        };
        const result = await addConstraintAndSolve(constraint);
        if (result.status === "applied") {
          console.log("Auto-applied vertical constraint to line", lineId);
          return result.sketch;
        }
        // Redundant/conflicting = silently skip (auto-constraints are best-effort)
        return null;
      }

      return null;
    },
    [generateId, addConstraintAndSolve]
  );

  // Auto-apply coincident constraint when snapping to existing geometry
  const autoApplyCoincidentConstraint = useCallback(
    async (pointId: string, isExisting: boolean, snapInfo: InferencePoint | null) => {
      // Skip if point reuse already gives coincidence, or no snap info
      if (isExisting || !snapInfo || !activeSketch) return;

      const sourcePrim = activeSketch.primitives.find(p => p.id === snapInfo.sourceId);
      if (!sourcePrim) return;

      let constraint: SketchConstraint | null = null;

      if (snapInfo.type === "center" && isSketchCircle(sourcePrim)) {
        // Snapped to circle center → coincident with center point
        constraint = {
          id: generateId("const"),
          type: "coincident",
          primitiveIds: [pointId, sourcePrim.centerId],
          driving: true,
        };
      } else if (snapInfo.type === "midpoint" && isSketchLine(sourcePrim)) {
        // Snapped to line midpoint → midpoint constraint
        constraint = {
          id: generateId("const"),
          type: "midpoint",
          primitiveIds: [pointId, snapInfo.sourceId],
          driving: true,
        };
      } else if (snapInfo.type === "quadrant" && (isSketchCircle(sourcePrim) || isSketchArc(sourcePrim))) {
        // Snapped to quadrant → point-on-circle constraint
        constraint = {
          id: generateId("const"),
          type: "pointOnCircle",
          primitiveIds: [pointId, snapInfo.sourceId],
          driving: true,
        };
      } else if (snapInfo.type === "endpoint") {
        // Snapped to an endpoint — look up which point it is
        if (isSketchLine(sourcePrim)) {
          const p1 = activeSketch.primitives.find(p => p.id === sourcePrim.p1Id);
          const p2 = activeSketch.primitives.find(p => p.id === sourcePrim.p2Id);
          let targetPointId: string | null = null;
          if (p1 && isSketchPoint(p1)) {
            const dist = Math.hypot(p1.x - snapInfo.position.x, p1.y - snapInfo.position.y);
            if (dist < 0.01) targetPointId = p1.id;
          }
          if (!targetPointId && p2 && isSketchPoint(p2)) {
            const dist = Math.hypot(p2.x - snapInfo.position.x, p2.y - snapInfo.position.y);
            if (dist < 0.01) targetPointId = p2.id;
          }
          if (targetPointId && targetPointId !== pointId) {
            constraint = {
              id: generateId("const"),
              type: "coincident",
              primitiveIds: [pointId, targetPointId],
              driving: true,
            };
          }
        }
      }

      if (constraint) {
        const result = await addConstraintAndSolve(constraint);
        if (result.status === "applied") {
          console.log(`Auto-applied ${constraint.type} constraint to point`, pointId);
        }
        // Silently skip redundant/conflicting
      }
    },
    [activeSketch, generateId, addConstraintAndSolve]
  );

  // Auto-apply perpendicular constraint when new line is ~90° to an existing line
  const autoApplyPerpendicularConstraint = useCallback(
    async (lineId: string, p1: THREE.Vector3, p2: THREE.Vector3): Promise<boolean> => {
      if (!activeSketch) return false;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const angle = Math.atan2(dy, dx);
      const tolerance = SKETCH_CONFIG.ALIGNMENT_TOLERANCE;

      for (const prim of activeSketch.primitives) {
        if (!isSketchLine(prim) || prim.id === lineId) continue;

        const pt1 = activeSketch.primitives.find(p => p.id === prim.p1Id);
        const pt2 = activeSketch.primitives.find(p => p.id === prim.p2Id);
        if (!pt1 || !pt2 || !isSketchPoint(pt1) || !isSketchPoint(pt2)) continue;

        const existingAngle = Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
        let diff = Math.abs(angle - existingAngle);
        // Normalize to [0, π]
        diff = diff % Math.PI;
        if (diff > Math.PI / 2) diff = Math.PI - diff;

        // Check if angle difference is ~90°
        if (Math.abs(diff - Math.PI / 2) < tolerance) {
          const constraint: SketchConstraint = {
            id: generateId("const"),
            type: "perpendicular",
            primitiveIds: [lineId, prim.id],
            driving: true,
          };
          const result = await addConstraintAndSolve(constraint);
          if (result.status === "applied") {
            console.log("Auto-applied perpendicular constraint to line", lineId);
            return true;
          }
        }
      }
      return false;
    },
    [activeSketch, generateId, addConstraintAndSolve]
  );

  // Auto-apply tangent constraint when new line is tangent to a circle/arc
  const autoApplyTangentConstraint = useCallback(
    async (lineId: string, p1: THREE.Vector3, p2: THREE.Vector3): Promise<boolean> => {
      if (!activeSketch) return false;

      const ldx = p2.x - p1.x;
      const ldy = p2.y - p1.y;
      const lineLen = Math.sqrt(ldx * ldx + ldy * ldy);
      if (lineLen < 0.01) return false;

      for (const prim of activeSketch.primitives) {
        if (!isSketchCircle(prim) && !isSketchArc(prim)) continue;

        const centerPrim = activeSketch.primitives.find(p => p.id === prim.centerId);
        if (!centerPrim || !isSketchPoint(centerPrim)) continue;

        const radius = isSketchCircle(prim) ? prim.radius : (prim as SketchArc).radius;
        const cx = centerPrim.x;
        const cy = centerPrim.y;

        // Distance from center to the line (point-to-line-segment distance)
        const dist = pointToLineDistance({ x: cx, y: cy }, { x: p1.x, y: p1.y }, { x: p2.x, y: p2.y });

        // Check if distance ≈ radius (within 5% tolerance)
        if (Math.abs(dist - radius) < radius * 0.05 + 0.02) {
          const constraint: SketchConstraint = {
            id: generateId("const"),
            type: "tangent",
            primitiveIds: [lineId, prim.id],
            driving: true,
          };
          const result = await addConstraintAndSolve(constraint);
          if (result.status === "applied") {
            console.log("Auto-applied tangent constraint to line", lineId);
            return true;
          }
        }
      }
      return false;
    },
    [activeSketch, generateId, addConstraintAndSolve]
  );

  // ── Trim/Extend cleanup ──
  const cleanupTrimHighlight = useCallback(() => {
    if (trimHighlightRef.current && scene) {
      scene.remove(trimHighlightRef.current);
      if (trimHighlightRef.current instanceof THREE.Group) {
        trimHighlightRef.current.traverse((child) => {
          if (child instanceof Line2 || child instanceof THREE.Line || child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
      } else if (trimHighlightRef.current instanceof Line2 || trimHighlightRef.current instanceof THREE.Line) {
        trimHighlightRef.current.geometry.dispose();
        (trimHighlightRef.current.material as THREE.Material).dispose();
      }
      trimHighlightRef.current = null;
    }
    trimHoveredPrimRef.current = null;
    extendHoveredRef.current = null;
  }, [scene]);

  // ── Auto-apply constraints on trim intersection points ──
  const applyTrimConstraints = useCallback(
    async (
      newPoints: { id: string; x: number; y: number }[],
      intersections: IntersectionResult[],
    ) => {
      if (!activeSketch || newPoints.length === 0) return;

      for (const pt of newPoints) {
        // Match this point to the closest intersection by position
        let bestIx: IntersectionResult | null = null;
        let bestDist = 1e-3; // tolerance
        for (const ix of intersections) {
          const d = Math.hypot(pt.x - ix.point.x, pt.y - ix.point.y);
          if (d < bestDist) {
            bestDist = d;
            bestIx = ix;
          }
        }
        if (!bestIx) continue;

        // Look up the other primitive to determine constraint type
        const otherPrim = activeSketch.primitives.find(p => p.id === bestIx!.otherPrimId);
        if (!otherPrim) continue;

        let constraintType: "pointOnLine" | "pointOnCircle" | null = null;
        if (isSketchLine(otherPrim)) {
          constraintType = "pointOnLine";
        } else if (isSketchCircle(otherPrim) || isSketchArc(otherPrim)) {
          constraintType = "pointOnCircle";
        }
        if (!constraintType) continue;

        const constraint: SketchConstraint = {
          id: generateId("const"),
          type: constraintType,
          primitiveIds: [pt.id, bestIx.otherPrimId],
          driving: true,
        };
        const result = await addConstraintAndSolve(constraint);
        if (result.status === "applied") {
          console.log(`Auto-applied ${constraintType} constraint on trim point ${pt.id} → ${bestIx.otherPrimId}`);
        }
        // Silently skip redundant/conflicting
      }
    },
    [activeSketch, generateId, addConstraintAndSolve]
  );

  // ── Trim mode handler ──
  const handleTrimMode = useCallback(
    async (event: MouseEvent, point: THREE.Vector3) => {
      if (!activeSketch) return;

      const pt2d = worldToSketch2D(point, activeSketch.plane);
      if (!pt2d) return;
      const cursorPoint = { x: pt2d.x, y: pt2d.y };

      if (event.type === "mousemove") {
        cleanupTrimHighlight();

        // Find closest primitive to cursor
        let bestPrimId: string | null = null;
        let bestDist = (camera && renderer)
          ? screenPxToSketchUnits(camera, renderer, 15)
          : 0.5; // snap distance in sketch units, zoom-aware

        for (const prim of activeSketch.primitives) {
          if (isSketchPoint(prim)) continue;

          let dist = Infinity;
          if (isSketchLine(prim)) {
            const p1 = activeSketch.primitives.find(p => p.id === prim.p1Id && isSketchPoint(p)) as SketchPoint | undefined;
            const p2 = activeSketch.primitives.find(p => p.id === prim.p2Id && isSketchPoint(p)) as SketchPoint | undefined;
            if (p1 && p2) {
              dist = pointToLineDistance(cursorPoint, { x: p1.x, y: p1.y }, { x: p2.x, y: p2.y });
            }
          } else if (isSketchCircle(prim)) {
            const center = activeSketch.primitives.find(p => p.id === prim.centerId && isSketchPoint(p)) as SketchPoint | undefined;
            if (center) {
              dist = Math.abs(Math.hypot(cursorPoint.x - center.x, cursorPoint.y - center.y) - prim.radius);
            }
          } else if (isSketchArc(prim)) {
            const center = activeSketch.primitives.find(p => p.id === prim.centerId && isSketchPoint(p)) as SketchPoint | undefined;
            if (center) {
              const radialDist = Math.abs(Math.hypot(cursorPoint.x - center.x, cursorPoint.y - center.y) - prim.radius);
              const arcAngles = getArcAngles(activeSketch, prim);
              if (arcAngles) {
                const cursorAngle = Math.atan2(cursorPoint.y - center.y, cursorPoint.x - center.x);
                if (isAngleInArcRange(cursorAngle, arcAngles.startAngle, arcAngles.endAngle)) {
                  dist = radialDist;
                }
              }
            }
          }

          if (dist < bestDist) {
            bestDist = dist;
            bestPrimId = prim.id;
          }
        }

        if (bestPrimId) {
          const intersections = findAllIntersections(activeSketch, bestPrimId);
          const segment = identifyTrimSegment(activeSketch, bestPrimId, intersections, cursorPoint);

          if (segment && intersections.length > 0) {
            trimHoveredPrimRef.current = {
              primId: bestPrimId,
              startParam: segment.startParam,
              endParam: segment.endParam,
            };

            // Visualize the segment to be trimmed (in red) using Line2
            const prim = activeSketch.primitives.find(p => p.id === bestPrimId);
            if (prim && sketchTo3DRef.current) {
              let positions: number[] | null = null;

              if (isSketchLine(prim)) {
                const p1 = activeSketch.primitives.find(p => p.id === prim.p1Id && isSketchPoint(p)) as SketchPoint | undefined;
                const p2 = activeSketch.primitives.find(p => p.id === prim.p2Id && isSketchPoint(p)) as SketchPoint | undefined;
                if (p1 && p2) {
                  const s = segment.startParam;
                  const e = segment.endParam;
                  const sx = p1.x + s * (p2.x - p1.x);
                  const sy = p1.y + s * (p2.y - p1.y);
                  const ex = p1.x + e * (p2.x - p1.x);
                  const ey = p1.y + e * (p2.y - p1.y);
                  const start3d = sketchTo3DRef.current(sx, sy, 0.02);
                  const end3d = sketchTo3DRef.current(ex, ey, 0.02);
                  positions = [start3d.x, start3d.y, start3d.z, end3d.x, end3d.y, end3d.z];
                }
              } else if (isSketchCircle(prim) || isSketchArc(prim)) {
                const center = activeSketch.primitives.find(
                  p => p.id === (isSketchCircle(prim) ? prim.centerId : (prim as SketchArc).centerId) && isSketchPoint(p)
                ) as SketchPoint | undefined;
                if (center) {
                  const radius = isSketchCircle(prim) ? prim.radius : (prim as SketchArc).radius;
                  const sAngle = segment.startParam;
                  const eAngle = segment.endParam;
                  let angleDiff = eAngle - sAngle;
                  if (angleDiff <= 0) angleDiff += Math.PI * 2;
                  const segCount = Math.max(16, Math.ceil(angleDiff / (Math.PI / 16)));
                  positions = [];
                  for (let i = 0; i <= segCount; i++) {
                    const t = i / segCount;
                    const angle = sAngle + angleDiff * t;
                    const lx = center.x + Math.cos(angle) * radius;
                    const ly = center.y + Math.sin(angle) * radius;
                    const pt3d = sketchTo3DRef.current!(lx, ly, 0.02);
                    positions.push(pt3d.x, pt3d.y, pt3d.z);
                  }
                }
              }

              if (positions && positions.length >= 6) {
                const line = createLine2FromPoints(positions, SKETCH_THEME.trimHighlight, 3.0);
                line.renderOrder = 1000;
                if (scene) scene.add(line);
                trimHighlightRef.current = line;
              }
            }
          }
        }
      } else if (event.type === "mousedown") {
        if (!trimHoveredPrimRef.current) return;

        const { primId, startParam, endParam } = trimHoveredPrimRef.current;
        cleanupTrimHighlight();

        pushSketchUndo();

        const prim = activeSketch.primitives.find(p => p.id === primId);
        if (!prim) return;

        // Helper: find an existing SketchPoint near (x, y) to reuse instead of creating duplicates.
        // This ensures trimmed line endpoints and trimmed arc endpoints share the same point ID
        // at intersection locations, which is critical for profile detection (isSketchClosed / sortEdgesForWire).
        const findExistingPoint = (x: number, y: number, tolerance = 1e-3): SketchPoint | null => {
          for (const p of activeSketch.primitives) {
            if (isSketchPoint(p) && Math.hypot(p.x - x, p.y - y) < tolerance) {
              return p;
            }
          }
          return null;
        };

        const intersections = findAllIntersections(activeSketch, primId);

        if (isSketchLine(prim)) {
          const p1 = activeSketch.primitives.find(p => p.id === prim.p1Id && isSketchPoint(p)) as SketchPoint | undefined;
          const p2 = activeSketch.primitives.find(p => p.id === prim.p2Id && isSketchPoint(p)) as SketchPoint | undefined;
          if (!p1 || !p2) return;

          const isStartSegment = startParam < 1e-4;
          const isEndSegment = endParam > 1 - 1e-4;

          if (isStartSegment && isEndSegment) {
            // Only segment — remove entire line
            removePrimitive(primId);
          } else if (isStartSegment) {
            // Trim from start: remove original line, create new point at intersection + new shorter line
            const newX = p1.x + endParam * (p2.x - p1.x);
            const newY = p1.y + endParam * (p2.y - p1.y);
            removePrimitive(primId);
            const existing = findExistingPoint(newX, newY);
            const newPtId = existing ? existing.id : generateId("point");
            if (!existing) {
              addPrimitive({ id: newPtId, type: "point", x: newX, y: newY });
            }
            addPrimitive({
              id: generateId("line"),
              type: "line" as const,
              p1Id: newPtId,
              p2Id: prim.p2Id,
              construction: prim.construction,
            });
            const newPts = existing ? [] : [{ id: newPtId, x: newX, y: newY }];
            await applyTrimConstraints(newPts, intersections);
          } else if (isEndSegment) {
            // Trim from end: remove original line, create new point at intersection + new shorter line
            const newX = p1.x + startParam * (p2.x - p1.x);
            const newY = p1.y + startParam * (p2.y - p1.y);
            removePrimitive(primId);
            const existing = findExistingPoint(newX, newY);
            const newPtId = existing ? existing.id : generateId("point");
            if (!existing) {
              addPrimitive({ id: newPtId, type: "point", x: newX, y: newY });
            }
            addPrimitive({
              id: generateId("line"),
              type: "line" as const,
              p1Id: prim.p1Id,
              p2Id: newPtId,
              construction: prim.construction,
            });
            const newPts = existing ? [] : [{ id: newPtId, x: newX, y: newY }];
            await applyTrimConstraints(newPts, intersections);
          } else {
            // Middle segment: remove original line, create two new segments
            // Create new intersection points at split locations
            const splitPts: { id: string; x: number; y: number }[] = [];
            const newlyCreatedPts: { id: string; x: number; y: number }[] = [];
            const sortedParams = intersections.map(ix => ix.tSource)
              .filter(t => t > 1e-4 && t < 1 - 1e-4)
              .sort((a, b) => a - b);

            for (const t of sortedParams) {
              const x = p1.x + t * (p2.x - p1.x);
              const y = p1.y + t * (p2.y - p1.y);
              const existing = findExistingPoint(x, y);
              const id = existing ? existing.id : generateId("point");
              splitPts.push({ id, x, y });
              if (!existing) {
                newlyCreatedPts.push({ id, x, y });
              }
            }

            // Remove original line first
            removePrimitive(primId);

            // Add only newly created split points
            for (const pt of newlyCreatedPts) {
              addPrimitive({ id: pt.id, type: "point", x: pt.x, y: pt.y });
            }

            // Create line segments: p1→split1, split1→split2, ..., splitN→p2
            const orderedPtIds = [prim.p1Id, ...splitPts.map(p => p.id), prim.p2Id];
            const newLines: { id: string; p1Id: string; p2Id: string }[] = [];
            for (let i = 0; i < orderedPtIds.length - 1; i++) {
              newLines.push({
                id: generateId("line"),
                p1Id: orderedPtIds[i],
                p2Id: orderedPtIds[i + 1],
              });
            }

            // Find which segment to skip (the clicked one)
            const boundaries = [0, ...sortedParams, 1];
            let skipIdx = -1;
            for (let i = 0; i < boundaries.length - 1; i++) {
              if (Math.abs(boundaries[i] - startParam) < 1e-3 &&
                  Math.abs(boundaries[i + 1] - endParam) < 1e-3) {
                skipIdx = i;
                break;
              }
            }

            // Add all segments except the clicked one, track which point IDs are used
            const usedPtIds = new Set<string>();
            for (let i = 0; i < newLines.length; i++) {
              if (i === skipIdx) continue;
              usedPtIds.add(newLines[i].p1Id);
              usedPtIds.add(newLines[i].p2Id);
              addPrimitive({
                id: newLines[i].id,
                type: "line" as const,
                p1Id: newLines[i].p1Id,
                p2Id: newLines[i].p2Id,
                construction: prim.construction,
              });
            }

            // Apply constraints on newly created split points only
            await applyTrimConstraints(newlyCreatedPts, intersections);

          }
        } else if (isSketchCircle(prim)) {
          if (intersections.length >= 2) {
            const center = activeSketch.primitives.find(p => p.id === prim.centerId && isSketchPoint(p)) as SketchPoint | undefined;
            if (!center) return;

            // Deduplicate intersection angles (same logic as identifyCircleTrimSegment)
            const ANGLE_DEDUP_TOL = 0.01;
            const rawAngles = intersections.map(ix => normalizeAngle(ix.tSource)).sort((a, b) => a - b);
            const angles: number[] = [];
            for (const a of rawAngles) {
              if (angles.length === 0 || a - angles[angles.length - 1] > ANGLE_DEDUP_TOL) {
                angles.push(a);
              }
            }
            if (angles.length >= 2 && (angles[0] + 2 * Math.PI - angles[angles.length - 1]) < ANGLE_DEDUP_TOL) {
              angles.pop();
            }

            if (angles.length < 2) return;

            removePrimitive(primId);

            // Find which segment index is the clicked one
            const isAngleClose = (a: number, b: number) => {
              const diff = Math.abs(a - b);
              return diff < 0.02 || Math.abs(diff - 2 * Math.PI) < 0.02;
            };
            let skipIdx = -1;
            for (let i = 0; i < angles.length; i++) {
              const segStart = angles[i];
              const segEnd = angles[(i + 1) % angles.length];
              if (isAngleClose(normalizeAngle(startParam), segStart) &&
                  isAngleClose(normalizeAngle(endParam), segEnd)) {
                skipIdx = i;
                break;
              }
            }

            // Create intersection points on the circle (reuse existing nearby points)
            const anglePtIds: string[] = [];
            const newCirclePts: { id: string; x: number; y: number }[] = [];
            for (const angle of angles) {
              const x = center.x + prim.radius * Math.cos(angle);
              const y = center.y + prim.radius * Math.sin(angle);
              const existing = findExistingPoint(x, y);
              const ptId = existing ? existing.id : generateId("point");
              anglePtIds.push(ptId);
              if (!existing) {
                addPrimitive({
                  id: ptId,
                  type: "point" as const,
                  x,
                  y,
                });
                newCirclePts.push({ id: ptId, x, y });
              }
            }

            // Create surviving arcs (one per segment, skipping the clicked one)
            for (let i = 0; i < angles.length; i++) {
              if (i === skipIdx) continue;
              const arcStartPtId = anglePtIds[i];
              const arcEndPtId = anglePtIds[(i + 1) % angles.length];
              addPrimitive({
                id: generateId("arc"),
                type: "arc" as const,
                centerId: prim.centerId,
                startId: arcStartPtId,
                endId: arcEndPtId,
                radius: prim.radius,
                construction: prim.construction,
              });
            }

            // Apply constraints on newly created circle intersection points only
            await applyTrimConstraints(newCirclePts, intersections);

            // Split intersecting lines at the shared intersection points
            const lineIntersections = new Map<string, { tOther: number; ptId: string }[]>();
            for (const ix of intersections) {
              const otherPrim = activeSketch.primitives.find(p => p.id === ix.otherPrimId);
              if (!otherPrim || !isSketchLine(otherPrim)) continue;

              // Map this intersection to the corresponding anglePtId
              const ixAngle = normalizeAngle(ix.tSource);
              let matchedPtId: string | null = null;
              for (let j = 0; j < angles.length; j++) {
                if (Math.abs(ixAngle - angles[j]) < ANGLE_DEDUP_TOL) {
                  matchedPtId = anglePtIds[j];
                  break;
                }
              }
              if (!matchedPtId) continue;

              // Skip intersections at line endpoints
              if (ix.tOther < 1e-4 || ix.tOther > 1 - 1e-4) continue;

              if (!lineIntersections.has(ix.otherPrimId)) {
                lineIntersections.set(ix.otherPrimId, []);
              }
              lineIntersections.get(ix.otherPrimId)!.push({ tOther: ix.tOther, ptId: matchedPtId });
            }

            for (const [lineId, splits] of lineIntersections) {
              const linePrim = activeSketch.primitives.find(
                p => p.id === lineId && isSketchLine(p)
              ) as SketchLine | undefined;
              if (!linePrim) continue;

              splits.sort((a, b) => a.tOther - b.tOther);
              removePrimitive(lineId);

              const orderedPtIds = [linePrim.p1Id, ...splits.map(s => s.ptId), linePrim.p2Id];
              for (let i = 0; i < orderedPtIds.length - 1; i++) {
                addPrimitive({
                  id: generateId("line"),
                  type: "line" as const,
                  p1Id: orderedPtIds[i],
                  p2Id: orderedPtIds[i + 1],
                  construction: linePrim.construction,
                });
              }
            }
          }
        } else if (isSketchArc(prim)) {
          const center = activeSketch.primitives.find(p => p.id === prim.centerId && isSketchPoint(p)) as SketchPoint | undefined;
          const arcAngles = getArcAngles(activeSketch, prim);
          if (!center || !arcAngles) return;

          // Filter out boundary intersections (at arc's own start/end points)
          const BOUNDARY_TOL = 0.03;
          const sA = normalizeAngle(arcAngles.startAngle);
          const eA = normalizeAngle(arcAngles.endAngle);
          const filteredIntersections = intersections.filter(ix => {
            const ixAngle = normalizeAngle(ix.tSource);
            const dStart = Math.min(Math.abs(ixAngle - sA), 2 * Math.PI - Math.abs(ixAngle - sA));
            const dEnd = Math.min(Math.abs(ixAngle - eA), 2 * Math.PI - Math.abs(ixAngle - eA));
            return dStart > BOUNDARY_TOL && dEnd > BOUNDARY_TOL;
          });

          if (filteredIntersections.length === 0) {
            // No interior intersections — remove entire arc only
            // Don't remove start/end points — they may be shared with adjacent arcs
            removePrimitive(primId);
            await solveSketch();
            return;
          }

          const isAngleCloseArc = (a: number, b: number) => {
            const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
            return diff < 0.02 || Math.abs(diff - 2 * Math.PI) < 0.02;
          };

          const isStartSegment = isAngleCloseArc(startParam, arcAngles.startAngle);
          const isEndSegment = isAngleCloseArc(endParam, arcAngles.endAngle);

          if (isStartSegment && isEndSegment) {
            // Only segment — remove entire arc
            // Don't remove start/end points — they may be shared with adjacent arcs
            removePrimitive(primId);
          } else if (isStartSegment) {
            // Trim from start: remove original arc, create new point at intersection + new shorter arc
            // (Same pattern as line trim — avoids moving a shared point)
            const newX = center.x + prim.radius * Math.cos(endParam);
            const newY = center.y + prim.radius * Math.sin(endParam);
            removePrimitive(primId);
            const existing = findExistingPoint(newX, newY);
            const newPtId = existing ? existing.id : generateId("point");
            if (!existing) {
              addPrimitive({ id: newPtId, type: "point" as const, x: newX, y: newY });
            }
            addPrimitive({
              id: generateId("arc"),
              type: "arc" as const,
              centerId: prim.centerId,
              startId: newPtId,
              endId: prim.endId,
              radius: prim.radius,
              construction: prim.construction,
            });
            const newPts = existing ? [] : [{ id: newPtId, x: newX, y: newY }];
            await applyTrimConstraints(newPts, intersections);

            // Split intersecting lines at the arc trim point
            for (const ix of filteredIntersections) {
              const otherPrim = activeSketch.primitives.find(p => p.id === ix.otherPrimId);
              if (!otherPrim || !isSketchLine(otherPrim)) continue;
              if (ix.tOther < 1e-4 || ix.tOther > 1 - 1e-4) continue;
              const ixAngle = normalizeAngle(ix.tSource);
              const trimAngle = normalizeAngle(endParam);
              if (Math.abs(ixAngle - trimAngle) > 0.02 && Math.abs(ixAngle - trimAngle - 2 * Math.PI) > 0.02) continue;
              removePrimitive(ix.otherPrimId);
              const lineP = otherPrim as SketchLine;
              addPrimitive({ id: generateId("line"), type: "line" as const, p1Id: lineP.p1Id, p2Id: newPtId, construction: lineP.construction });
              addPrimitive({ id: generateId("line"), type: "line" as const, p1Id: newPtId, p2Id: lineP.p2Id, construction: lineP.construction });
            }
          } else if (isEndSegment) {
            // Trim from end: remove original arc, create new point at intersection + new shorter arc
            const newX = center.x + prim.radius * Math.cos(startParam);
            const newY = center.y + prim.radius * Math.sin(startParam);
            removePrimitive(primId);
            const existing = findExistingPoint(newX, newY);
            const newPtId = existing ? existing.id : generateId("point");
            if (!existing) {
              addPrimitive({ id: newPtId, type: "point" as const, x: newX, y: newY });
            }
            addPrimitive({
              id: generateId("arc"),
              type: "arc" as const,
              centerId: prim.centerId,
              startId: prim.startId,
              endId: newPtId,
              radius: prim.radius,
              construction: prim.construction,
            });
            const newPts = existing ? [] : [{ id: newPtId, x: newX, y: newY }];
            await applyTrimConstraints(newPts, intersections);

            // Split intersecting lines at the arc trim point
            for (const ix of filteredIntersections) {
              const otherPrim = activeSketch.primitives.find(p => p.id === ix.otherPrimId);
              if (!otherPrim || !isSketchLine(otherPrim)) continue;
              if (ix.tOther < 1e-4 || ix.tOther > 1 - 1e-4) continue;
              const ixAngle = normalizeAngle(ix.tSource);
              const trimAngle = normalizeAngle(startParam);
              if (Math.abs(ixAngle - trimAngle) > 0.02 && Math.abs(ixAngle - trimAngle - 2 * Math.PI) > 0.02) continue;
              removePrimitive(ix.otherPrimId);
              const lineP = otherPrim as SketchLine;
              addPrimitive({ id: generateId("line"), type: "line" as const, p1Id: lineP.p1Id, p2Id: newPtId, construction: lineP.construction });
              addPrimitive({ id: generateId("line"), type: "line" as const, p1Id: newPtId, p2Id: lineP.p2Id, construction: lineP.construction });
            }
          } else {
            // Middle segment: split arc into multiple surviving arcs
            // Build intersection angles within the arc range, sorted relative to arc start
            const arcStart = normalizeAngle(arcAngles.startAngle);
            const ixAngles = filteredIntersections
              .map(ix => normalizeAngle(ix.tSource))
              .filter(a => isAngleInArcRange(a, arcAngles.startAngle, arcAngles.endAngle))
              .sort((a, b) => {
                // Sort by angular distance from arc start (handles wrap-around)
                const da = normalizeAngle(a - arcStart);
                const db = normalizeAngle(b - arcStart);
                return da - db;
              });

            // Full angle list: arc start, intersections, arc end
            const allAngles = [arcStart, ...ixAngles, normalizeAngle(arcAngles.endAngle)];

            // Find which segment is clicked (direct boundary comparison)
            let skipIdx = -1;
            for (let i = 0; i < allAngles.length - 1; i++) {
              if (isAngleCloseArc(normalizeAngle(startParam), allAngles[i]) &&
                  isAngleCloseArc(normalizeAngle(endParam), allAngles[i + 1])) {
                skipIdx = i;
                break;
              }
            }

            // Remove original arc
            removePrimitive(primId);

            // Create intersection points (reuse existing nearby points)
            const anglePtIds: string[] = [];
            const newArcSplitPts: { id: string; x: number; y: number }[] = [];
            for (const angle of ixAngles) {
              const x = center.x + prim.radius * Math.cos(angle);
              const y = center.y + prim.radius * Math.sin(angle);
              const existing = findExistingPoint(x, y);
              const ptId = existing ? existing.id : generateId("point");
              anglePtIds.push(ptId);
              if (!existing) {
                addPrimitive({
                  id: ptId,
                  type: "point" as const,
                  x,
                  y,
                });
                newArcSplitPts.push({ id: ptId, x, y });
              }
            }

            // Full point ID list: original startId, intersection points, original endId
            const allPtIds = [prim.startId, ...anglePtIds, prim.endId];

            // Create surviving arcs (skip clicked segment)
            for (let i = 0; i < allPtIds.length - 1; i++) {
              if (i === skipIdx) continue;
              addPrimitive({
                id: generateId("arc"),
                type: "arc" as const,
                centerId: prim.centerId,
                startId: allPtIds[i],
                endId: allPtIds[i + 1],
                radius: prim.radius,
                construction: prim.construction,
              });
            }

            // Apply constraints on newly created arc split points only
            await applyTrimConstraints(newArcSplitPts, filteredIntersections);

            // Split intersecting lines at the shared intersection points
            const arcLineIntersections = new Map<string, { tOther: number; ptId: string }[]>();
            for (const ix of filteredIntersections) {
              const otherPrim = activeSketch.primitives.find(p => p.id === ix.otherPrimId);
              if (!otherPrim || !isSketchLine(otherPrim)) continue;

              const ixAngle = normalizeAngle(ix.tSource);
              let matchedPtId: string | null = null;
              for (let j = 0; j < ixAngles.length; j++) {
                if (Math.abs(ixAngle - ixAngles[j]) < 0.01) {
                  matchedPtId = anglePtIds[j];
                  break;
                }
              }
              if (!matchedPtId) continue;
              if (ix.tOther < 1e-4 || ix.tOther > 1 - 1e-4) continue;

              if (!arcLineIntersections.has(ix.otherPrimId)) {
                arcLineIntersections.set(ix.otherPrimId, []);
              }
              arcLineIntersections.get(ix.otherPrimId)!.push({ tOther: ix.tOther, ptId: matchedPtId });
            }

            for (const [lineId, splits] of arcLineIntersections) {
              const linePrim = activeSketch.primitives.find(
                p => p.id === lineId && isSketchLine(p)
              ) as SketchLine | undefined;
              if (!linePrim) continue;

              splits.sort((a, b) => a.tOther - b.tOther);
              removePrimitive(lineId);

              const orderedPtIds = [linePrim.p1Id, ...splits.map(s => s.ptId), linePrim.p2Id];
              for (let i = 0; i < orderedPtIds.length - 1; i++) {
                addPrimitive({
                  id: generateId("line"),
                  type: "line" as const,
                  p1Id: orderedPtIds[i],
                  p2Id: orderedPtIds[i + 1],
                  construction: linePrim.construction,
                });
              }
            }

          }
        }

        // Solve after trim
        await solveSketch();
      }
    },
    [activeSketch, worldToSketch2D, scene, camera, renderer, cleanupTrimHighlight, pushSketchUndo, solveSketch, removePrimitive, updatePrimitive, addPrimitive, generateId, applyTrimConstraints],
  );

  // ── Extend mode handler ──
  const handleExtendMode = useCallback(
    (event: MouseEvent, point: THREE.Vector3) => {
      if (!activeSketch) return;

      const pt2d = worldToSketch2D(point, activeSketch.plane);
      if (!pt2d) return;
      const cursorPoint = { x: pt2d.x, y: pt2d.y };

      const snapDist = (camera && renderer)
        ? screenPxToSketchUnits(camera, renderer, 15)
        : 0.5;

      if (event.type === "mousemove") {
        cleanupTrimHighlight();

        // Find closest line/arc endpoint
        const endpoint = findClosestEndpoint(activeSketch, cursorPoint, snapDist);
        if (!endpoint) return;

        const prim = activeSketch.primitives.find(p => p.id === endpoint.primitiveId);
        if (!prim) return;

        // Find extend target based on primitive type
        let target: { point: { x: number; y: number }; targetPrimId: string } | null = null;
        if (isSketchLine(prim)) {
          target = findNearestExtendTarget(activeSketch, endpoint.primitiveId, endpoint.isStart);
        } else if (isSketchArc(prim)) {
          target = findNearestArcExtendTarget(activeSketch, endpoint.primitiveId, endpoint.isStart);
        }
        if (!target) return;

        // Build preview: dashed line from endpoint to target + circle on endpoint
        if (sketchTo3DRef.current) {
          const endpointPrim = activeSketch.primitives.find(p => p.id === endpoint.pointId && isSketchPoint(p)) as SketchPoint | undefined;
          if (!endpointPrim) return;

          const group = new THREE.Group();

          // Dashed line from endpoint to target
          const from3d = sketchTo3DRef.current(endpointPrim.x, endpointPrim.y, 0.02);
          const to3d = sketchTo3DRef.current(target.point.x, target.point.y, 0.02);
          const positions = [from3d.x, from3d.y, from3d.z, to3d.x, to3d.y, to3d.z];
          const dashedLine = createLine2FromPoints(positions, SKETCH_THEME.extendPreview, 3.0, true);
          dashedLine.renderOrder = 1000;
          group.add(dashedLine);

          // Circle on endpoint
          const circleRadius = screenPxToSketchUnits(camera!, renderer!, 6);
          const circleGeom = new THREE.CircleGeometry(circleRadius, 24);
          const circleMat = new THREE.MeshBasicMaterial({
            color: SKETCH_THEME.extendPreview,
            depthTest: false,
            transparent: true,
            opacity: 0.8,
          });
          const circleMesh = new THREE.Mesh(circleGeom, circleMat);
          const circlePt3d = sketchTo3DRef.current(endpointPrim.x, endpointPrim.y, 0.03);
          circleMesh.position.set(circlePt3d.x, circlePt3d.y, circlePt3d.z);
          circleMesh.renderOrder = 1000;
          group.add(circleMesh);

          if (scene) scene.add(group);
          trimHighlightRef.current = group;

          extendHoveredRef.current = {
            primId: endpoint.primitiveId,
            pointId: endpoint.pointId,
            isStart: endpoint.isStart,
            targetPoint: target.point,
          };
        }
      } else if (event.type === "mousedown") {
        if (!extendHoveredRef.current) return;

        const { pointId, targetPoint } = extendHoveredRef.current;
        cleanupTrimHighlight();

        pushSketchUndo();
        updatePrimitive(pointId, { x: targetPoint.x, y: targetPoint.y });
        solveSketch();
      }
    },
    [activeSketch, worldToSketch2D, camera, renderer, scene, cleanupTrimHighlight, pushSketchUndo, solveSketch, updatePrimitive],
  );

  // Handle line drawing - Fusion 360 style click-to-click with chaining
  const handleLineDraw = useCallback(
    async (event: MouseEvent, point: THREE.Vector3) => {
      const now = Date.now();

      if (event.type === "mousedown") {
        // Check for double-click to end chain
        if (isChaining && chainStartPointRef.current) {
          const timeSinceLastClick = now - lastClickTimeRef.current;
          if (timeSinceLastClick < DOUBLE_CLICK_THRESHOLD) {
            // Double-click: finish the chain without creating a new line
            cleanupSketchPreview();
            setIsChaining(false);
            chainStartPointRef.current = null;
            chainStartPointIdRef.current = null;
            chainStartIsExistingRef.current = false;
            lastClickTimeRef.current = 0;
            return;
          }
        }

        lastClickTimeRef.current = now;

        if (!isChaining) {
          // First click: start the chain
          pushSketchUndo();
          const { id: p1Id, isExisting: p1IsExisting } = getOrCreatePoint(point);
          // Use actual snapped coordinates (not raw cursor position)
          const p1Prim = activeSketch?.primitives.find(p => p.id === p1Id);
          const actualP1 = (p1Prim && isSketchPoint(p1Prim))
            ? new THREE.Vector3(p1Prim.x, p1Prim.y, 0)
            : point.clone();
          chainStartPointRef.current = actualP1;
          chainStartPointIdRef.current = p1Id;
          chainStartIsExistingRef.current = p1IsExisting;
          chainStartSnapRef.current = lastSnapRef.current;
          setIsChaining(true);
        } else if (chainStartPointRef.current) {
          // Subsequent click: create line and continue chain
          pushSketchUndo();
          const startPoint = chainStartPointRef.current.clone();
          const { id: p2Id, isExisting: p2IsExisting } = getOrCreatePoint(point);

          // Look up actual snapped coordinates (not raw cursor position)
          const p2Prim = activeSketch?.primitives.find(p => p.id === p2Id);
          const actualP2 = (p2Prim && isSketchPoint(p2Prim))
            ? new THREE.Vector3(p2Prim.x, p2Prim.y, 0)
            : point.clone();

          // Only create line if not clicking the same point
          if (p2Id !== chainStartPointIdRef.current) {
            const lineId = generateId("ln");
            const line: SketchLine = {
              id: lineId,
              type: "line",
              p1Id: chainStartPointIdRef.current!,
              p2Id,
            };
            addPrimitive(line);

            // Auto-constraint priority chain (all suppressed by Ctrl)
            const suppressAuto = ctrlHeldRef.current;
            // H/V suppressed when connecting to existing geometry (user positioned intentionally)
            const suppressHV = suppressAuto || p2IsExisting || chainStartIsExistingRef.current;

            // 1. H/V (highest priority) — only when endpoints aren't reused
            let hvApplied = false;
            if (!suppressHV) {
              const hvSketchResult = await autoApplyHVConstraint(lineId, startPoint, actualP2);
              hvApplied = hvSketchResult !== null;
            }

            // 2. Perpendicular (only if no H/V) — still applies when connecting to existing geometry
            let perpApplied = false;
            if (!suppressAuto && !hvApplied) {
              perpApplied = await autoApplyPerpendicularConstraint(lineId, startPoint, actualP2);
            }

            // 3. Tangent (only if no H/V or perpendicular)
            if (!suppressAuto && !hvApplied && !perpApplied) {
              await autoApplyTangentConstraint(lineId, startPoint, actualP2);
            }

            // 4. Coincident (always, independent of directional constraints)
            if (!suppressAuto) {
              // Start point coincident (from chain start snap)
              await autoApplyCoincidentConstraint(
                chainStartPointIdRef.current!,
                chainStartIsExistingRef.current,
                chainStartSnapRef.current,
              );
              // End point coincident (from current snap)
              await autoApplyCoincidentConstraint(p2Id, p2IsExisting, lastSnapRef.current);
            }

            const solvedSketch = await solveSketch();

            // Use post-solve sketch to get final point position
            // (auto-constraints may have moved the point)
            const finalSketch = solvedSketch;
            let finalP2 = actualP2.clone();
            if (finalSketch) {
              const solvedPoint = finalSketch.primitives.find(p => p.id === p2Id);
              if (solvedPoint && isSketchPoint(solvedPoint)) {
                finalP2 = new THREE.Vector3(solvedPoint.x, solvedPoint.y, 0);
              }
            }

            // Set pending line dimension for dimension input using post-solve positions
            const lineLength = startPoint.distanceTo(finalP2);
            // Midpoint needs to be in 3D world coords for screen projection
            const mid2D = new THREE.Vector3()
              .addVectors(startPoint, finalP2)
              .multiplyScalar(0.5);
            const midpoint = sketchTo3DRef.current(mid2D.x, mid2D.y, 0);
            setPendingLineDimension({
              lineId,
              p1: startPoint.clone(),
              p2: finalP2.clone(),
              length: lineLength,
              midpoint,
            });

            // Continue chain from POST-SOLVE position
            chainStartPointRef.current = finalP2.clone();
            chainStartPointIdRef.current = p2Id;
            chainStartIsExistingRef.current = p2IsExisting;
            chainStartSnapRef.current = lastSnapRef.current;
          }
        }
      } else if (event.type === "mousemove") {
        // Show preview line from chain start to cursor
        if (!isChaining || !chainStartPointRef.current) return;

        cleanupSketchPreview();
        const preview = createLinePreview(chainStartPointRef.current, point);
        if (scene) {
          scene.add(preview);
          previewObjectRef.current = preview;
        }
      }
      // mouseup is not used in click-to-click mode
    },
    [
      scene,
      cleanupSketchPreview,
      createLinePreview,
      getOrCreatePoint,
      addPrimitive,
      solveSketch,
      generateId,
      isChaining,
      autoApplyHVConstraint,
      autoApplyCoincidentConstraint,
      autoApplyPerpendicularConstraint,
      autoApplyTangentConstraint,
      activeSketch,
      pushSketchUndo,
    ]
  );

  // Rectangle drawing start corner ref
  const rectStartRef = useRef<THREE.Vector3 | null>(null);

  // Handle rectangle drawing - 2-corner click-drag
  const handleRectangleDraw = useCallback(
    async (event: MouseEvent, point: THREE.Vector3) => {
      if (event.type === "mousedown") {
        isDrawingRef.current = true;
        rectStartRef.current = point.clone();
      } else if (event.type === "mousemove") {
        if (!isDrawingRef.current || !rectStartRef.current) return;

        cleanupSketchPreview();
        const preview = createRectanglePreview(rectStartRef.current, point);
        if (scene) {
          scene.add(preview);
          previewObjectRef.current = preview;
        }
      } else if (event.type === "mouseup") {
        if (!isDrawingRef.current || !rectStartRef.current) return;

        cleanupSketchPreview();

        const start = rectStartRef.current;
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);

        if (width > 0.05 && height > 0.05) {
          // Determine corners (BL, BR, TR, TL)
          const minX = Math.min(start.x, point.x);
          const maxX = Math.max(start.x, point.x);
          const minY = Math.min(start.y, point.y);
          const maxY = Math.max(start.y, point.y);

          pushSketchUndo();

          // Create 4 corner points directly via addPrimitive (not getOrCreatePoint, to avoid extra undo pushes)
          const blId = generateId("pt");
          const brId = generateId("pt");
          const trId = generateId("pt");
          const tlId = generateId("pt");

          const blPt: SketchPoint = { id: blId, type: "point", x: minX, y: minY };
          const brPt: SketchPoint = { id: brId, type: "point", x: maxX, y: minY };
          const trPt: SketchPoint = { id: trId, type: "point", x: maxX, y: maxY };
          const tlPt: SketchPoint = { id: tlId, type: "point", x: minX, y: maxY };

          addPrimitive(blPt);
          addPrimitive(brPt);
          addPrimitive(trPt);
          addPrimitive(tlPt);

          // Create 4 lines connecting corners sequentially
          const bottomId = generateId("ln");
          const rightId = generateId("ln");
          const topId = generateId("ln");
          const leftId = generateId("ln");

          const bottomLine: SketchLine = { id: bottomId, type: "line", p1Id: blId, p2Id: brId };
          const rightLine: SketchLine = { id: rightId, type: "line", p1Id: brId, p2Id: trId };
          const topLine: SketchLine = { id: topId, type: "line", p1Id: trId, p2Id: tlId };
          const leftLine: SketchLine = { id: leftId, type: "line", p1Id: tlId, p2Id: blId };

          addPrimitive(bottomLine);
          addPrimitive(rightLine);
          addPrimitive(topLine);
          addPrimitive(leftLine);

          // Auto-apply horizontal constraints on bottom + top lines
          const hBottom: SketchConstraint = {
            id: generateId("const"),
            type: "horizontal",
            primitiveIds: [bottomId],
            driving: true,
          };
          const hTop: SketchConstraint = {
            id: generateId("const"),
            type: "horizontal",
            primitiveIds: [topId],
            driving: true,
          };

          // Auto-apply vertical constraints on right + left lines
          const vRight: SketchConstraint = {
            id: generateId("const"),
            type: "vertical",
            primitiveIds: [rightId],
            driving: true,
          };
          const vLeft: SketchConstraint = {
            id: generateId("const"),
            type: "vertical",
            primitiveIds: [leftId],
            driving: true,
          };

          await addConstraintAndSolve(hBottom);
          await addConstraintAndSolve(hTop);
          await addConstraintAndSolve(vRight);
          await addConstraintAndSolve(vLeft);

          await solveSketch();
        }

        isDrawingRef.current = false;
        rectStartRef.current = null;
      }
    },
    [
      scene,
      cleanupSketchPreview,
      createRectanglePreview,
      addPrimitive,
      addConstraintAndSolve,
      solveSketch,
      generateId,
      pushSketchUndo,
    ]
  );

  // Handle circle drawing
  const handleCircleDraw = useCallback(
    async (event: MouseEvent, point: THREE.Vector3) => {
      if (event.type === "mousedown") {
        isDrawingRef.current = true;
        centerPointRef.current = point.clone();
      } else if (event.type === "mousemove") {
        if (!isDrawingRef.current || !centerPointRef.current) return;

        cleanupSketchPreview();
        const radius = centerPointRef.current.distanceTo(point);
        const preview = createCirclePreview(centerPointRef.current, radius);
        if (scene) {
          scene.add(preview);
          previewObjectRef.current = preview;
        }
      } else if (event.type === "mouseup") {
        if (!isDrawingRef.current || !centerPointRef.current) return;

        cleanupSketchPreview();

        const radius = centerPointRef.current.distanceTo(point);
        if (radius > 0.1) {
          // Create circle primitive
          pushSketchUndo();
          const { id: centerId } = getOrCreatePoint(centerPointRef.current);

          const circle: SketchCircle = {
            id: generateId("cir"),
            type: "circle",
            centerId,
            radius,
          };
          addPrimitive(circle);

          await solveSketch();
        }

        isDrawingRef.current = false;
        centerPointRef.current = null;
      }
    },
    [
      scene,
      cleanupSketchPreview,
      createCirclePreview,
      getOrCreatePoint,
      addPrimitive,
      solveSketch,
      generateId,
      pushSketchUndo,
    ]
  );

  // Handle arc drawing - 3-point arc (start, end, bulge) like Fusion 360
  const arcStepRef = useRef<number>(0);
  const arcStartPointRef = useRef<THREE.Vector3 | null>(null);
  const arcEndPointRef = useRef<THREE.Vector3 | null>(null);

  // Calculate arc center from 3 points (start, end, bulge point)
  const calculateArcFromThreePoints = useCallback(
    (
      start: THREE.Vector3,
      end: THREE.Vector3,
      bulge: THREE.Vector3
    ): { center: THREE.Vector3; radius: number } | null => {
      // Find the center of a circle passing through 3 points using circumcenter formula
      const ax = start.x, ay = start.y;
      const bx = end.x, by = end.y;
      const cx = bulge.x, cy = bulge.y;

      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(d) < 1e-10) {
        // Points are collinear
        return null;
      }

      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;

      const center = new THREE.Vector3(ux, uy, 0);
      const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);

      return { center, radius };
    },
    []
  );

  // Create 3-point arc preview using Line2 (inputs are 2D sketch coords, converted to 3D for rendering)
  const create3PointArcPreview = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3, bulge: THREE.Vector3): Line2 | null => {
      const result = calculateArcFromThreePoints(start, end, bulge);
      if (!result) {
        // Fallback to line preview if points are collinear
        const s3d = sketchTo3DRef.current(start.x, start.y, 0.01);
        const b3d = sketchTo3DRef.current(bulge.x, bulge.y, 0.01);
        const e3d = sketchTo3DRef.current(end.x, end.y, 0.01);
        const positions = [
          s3d.x, s3d.y, s3d.z,
          b3d.x, b3d.y, b3d.z,
          e3d.x, e3d.y, e3d.z,
        ];
        return createLine2FromPoints(positions, COLORS.preview, 1.5);
      }

      const { center, radius } = result;
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
      const bulgeAngle = Math.atan2(bulge.y - center.y, bulge.x - center.x);

      // Determine arc direction based on bulge point position
      let angleDiff = endAngle - startAngle;
      // Normalize to [0, 2π]
      while (angleDiff < 0) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI * 2) angleDiff -= Math.PI * 2;

      // Check if bulge is on the long arc or short arc
      let bulgeOnArc = bulgeAngle - startAngle;
      while (bulgeOnArc < 0) bulgeOnArc += Math.PI * 2;
      while (bulgeOnArc > Math.PI * 2) bulgeOnArc -= Math.PI * 2;

      // If bulge angle is not between start and end going the short way, use the long arc
      const useShortArc = bulgeOnArc <= angleDiff;
      const sweepAngle = useShortArc ? angleDiff : -(Math.PI * 2 - angleDiff);

      const segments = 32;
      const positions: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = startAngle + sweepAngle * t;
        const sx = center.x + Math.cos(angle) * radius;
        const sy = center.y + Math.sin(angle) * radius;
        const p3d = sketchTo3DRef.current(sx, sy, 0.01);
        positions.push(p3d.x, p3d.y, p3d.z);
      }

      return createLine2FromPoints(positions, COLORS.preview, 1.5);
    },
    [calculateArcFromThreePoints]
  );

  const handleArcDraw = useCallback(
    async (event: MouseEvent, point: THREE.Vector3) => {
      if (event.type === "mousedown") {
        if (arcStepRef.current === 0) {
          // First click: start point
          arcStartPointRef.current = point.clone();
          arcStepRef.current = 1;
        } else if (arcStepRef.current === 1) {
          // Second click: end point
          arcEndPointRef.current = point.clone();
          arcStepRef.current = 2;
        } else if (arcStepRef.current === 2) {
          // Third click: bulge point - create the arc
          cleanupSketchPreview();

          if (arcStartPointRef.current && arcEndPointRef.current) {
            const result = calculateArcFromThreePoints(
              arcStartPointRef.current,
              arcEndPointRef.current,
              point
            );

            if (result) {
              pushSketchUndo();
              const { center, radius } = result;
              const { id: centerId } = getOrCreatePoint(center);
              const { id: startId } = getOrCreatePoint(arcStartPointRef.current);
              const { id: endId } = getOrCreatePoint(arcEndPointRef.current);

              // Determine if start/end need swapping so the CCW rendering
              // convention produces the arc on the same side as the bulge point.
              const startAngle = Math.atan2(
                arcStartPointRef.current.y - center.y,
                arcStartPointRef.current.x - center.x
              );
              const endAngle = Math.atan2(
                arcEndPointRef.current.y - center.y,
                arcEndPointRef.current.x - center.x
              );
              const bulgeAngle = Math.atan2(
                point.y - center.y,
                point.x - center.x
              );

              // Normalize CCW sweep from start to end
              let angleDiff = endAngle - startAngle;
              while (angleDiff < 0) angleDiff += Math.PI * 2;
              while (angleDiff > Math.PI * 2) angleDiff -= Math.PI * 2;

              // Check if bulge falls within that CCW sweep
              let bulgeOffset = bulgeAngle - startAngle;
              while (bulgeOffset < 0) bulgeOffset += Math.PI * 2;
              while (bulgeOffset > Math.PI * 2) bulgeOffset -= Math.PI * 2;

              const bulgeOnCCW = bulgeOffset <= angleDiff;

              const arc: SketchArc = {
                id: generateId("arc"),
                type: "arc",
                centerId,
                startId: bulgeOnCCW ? startId : endId,
                endId: bulgeOnCCW ? endId : startId,
                radius,
              };
              addPrimitive(arc);
              await solveSketch();
            }
          }

          // Reset
          arcStepRef.current = 0;
          arcStartPointRef.current = null;
          arcEndPointRef.current = null;
        }
      } else if (event.type === "mousemove") {
        cleanupSketchPreview();

        if (arcStepRef.current === 1 && arcStartPointRef.current) {
          // Show line preview from start to cursor (for end point selection)
          const preview = createLinePreview(arcStartPointRef.current, point);
          if (scene) {
            scene.add(preview);
            previewObjectRef.current = preview;
          }
        } else if (arcStepRef.current === 2 && arcStartPointRef.current && arcEndPointRef.current) {
          // Show arc preview with cursor as bulge point
          const preview = create3PointArcPreview(arcStartPointRef.current, arcEndPointRef.current, point);
          if (scene && preview) {
            scene.add(preview);
            previewObjectRef.current = preview;
          }
        }
      }
    },
    [
      scene,
      cleanupSketchPreview,
      createLinePreview,
      create3PointArcPreview,
      calculateArcFromThreePoints,
      getOrCreatePoint,
      addPrimitive,
      solveSketch,
      generateId,
      pushSketchUndo,
    ]
  );

  // Handle point creation
  const handlePointDraw = useCallback(
    async (event: MouseEvent, point: THREE.Vector3) => {
      if (event.type === "mousedown") {
        pushSketchUndo();
        const newPoint: SketchPoint = {
          id: generateId("pt"),
          type: "point",
          x: point.x,
          y: point.y,
          fixed: false,
        };
        addPrimitive(newPoint);
        await solveSketch();
      }
    },
    [addPrimitive, solveSketch, generateId, pushSketchUndo]
  );

  // Cancel current drawing operation (Escape key)
  const cancelCurrentOperation = useCallback(() => {
    cleanupSketchPreview();

    // Reset line chaining
    if (isChaining) {
      setIsChaining(false);
      chainStartPointRef.current = null;
      chainStartPointIdRef.current = null;
      chainStartIsExistingRef.current = false;
      lastClickTimeRef.current = 0;
    }

    // Reset circle / rectangle drawing
    isDrawingRef.current = false;
    centerPointRef.current = null;
    rectStartRef.current = null;

    // Reset arc drawing
    arcStepRef.current = 0;
    arcStartPointRef.current = null;
    arcEndPointRef.current = null;
  }, [cleanupSketchPreview, isChaining]);

  // ============================================
  // Plane Selection Functions (Fusion 360 style)
  // ============================================

  // Sketch grid reference for cleanup
  const sketchGridRef = useRef<THREE.Group | null>(null);
  // Selection planes reference for cleanup
  const selectionPlanesRef = useRef<THREE.Group | null>(null);
  // Store original camera position to restore if cancelled
  const originalCameraPositionRef = useRef<THREE.Vector3 | null>(null);
  const originalCameraUpRef = useRef<THREE.Vector3 | null>(null);
  const originalControlsTargetRef = useRef<THREE.Vector3 | null>(null);
  // Store original projection type to restore when leaving sketch mode
  const originalProjectionRef = useRef<"perspective" | "orthographic" | null>(null);
  // Camera animation cancellation ref (shared by orient + plane selection animations)
  const cameraAnimFrameRef = useRef<number | null>(null);
  // Face highlight overlay for face-picking during plane selection
  const faceHighlightRef = useRef<THREE.Mesh | null>(null);

  // Orient camera to face a plane (for sketching)
  const orientCameraToPlane = useCallback(
    (plane: SketchPlane, onComplete?: () => void) => {
      if (!camera) return;

      // Cancel any in-flight camera animation
      if (cameraAnimFrameRef.current !== null) {
        cancelAnimationFrame(cameraAnimFrameRef.current);
        cameraAnimFrameRef.current = null;
      }

      const controls = controlsRef.current;
      const distance = 15;
      const duration = 500; // Animation duration in ms

      // Calculate target camera position: offset from plane origin along normal
      const targetPosition = plane.origin.clone().addScaledVector(plane.normal, distance);
      const targetUp = plane.yAxis.clone();
      const lookAtTarget = plane.origin.clone();

      // Animate camera position
      const startPosition = camera.position.clone();
      const startUp = camera.up.clone();
      const startControlsTarget = controls ? controls.target.clone() : new THREE.Vector3();
      const startTime = Date.now();

      const animateCamera = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3);

        camera.position.lerpVectors(startPosition, targetPosition, eased);
        camera.up.lerpVectors(startUp, targetUp, eased);
        if (controls) {
          controls.target.lerpVectors(startControlsTarget, lookAtTarget, eased);
          controls.update();
        }
        camera.lookAt(lookAtTarget);

        if (t < 1) {
          cameraAnimFrameRef.current = requestAnimationFrame(animateCamera);
        } else {
          cameraAnimFrameRef.current = null;
          onComplete?.();
        }
      };

      cameraAnimFrameRef.current = requestAnimationFrame(animateCamera);
    },
    [camera, controlsRef]
  );

  // Position camera at isometric view to see all 3 planes
  const positionCameraForPlaneSelection = useCallback(() => {
    if (!camera) return;

    // Cancel any in-flight camera animation
    if (cameraAnimFrameRef.current !== null) {
      cancelAnimationFrame(cameraAnimFrameRef.current);
      cameraAnimFrameRef.current = null;
    }

    const controls = controlsRef.current;

    // Save original camera position and controls target
    originalCameraPositionRef.current = camera.position.clone();
    originalCameraUpRef.current = camera.up.clone();
    if (controls) {
      originalControlsTargetRef.current = controls.target.clone();
    }

    const distance = 12;
    const duration = 400;

    // Isometric-like view position (can see all 3 planes)
    const targetPosition = new THREE.Vector3(distance * 0.7, distance * 0.5, distance * 0.7);
    const targetUp = new THREE.Vector3(0, 1, 0);
    const targetLookAt = new THREE.Vector3(0, 0, 0);

    const startPosition = camera.position.clone();
    const startUp = camera.up.clone();
    const startControlsTarget = controls ? controls.target.clone() : new THREE.Vector3();
    const startTime = Date.now();

    const animateCamera = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);

      camera.position.lerpVectors(startPosition, targetPosition, eased);
      camera.up.lerpVectors(startUp, targetUp, eased);
      if (controls) {
        controls.target.lerpVectors(startControlsTarget, targetLookAt, eased);
        controls.update();
      }
      camera.lookAt(targetLookAt);

      if (t < 1) {
        cameraAnimFrameRef.current = requestAnimationFrame(animateCamera);
      } else {
        cameraAnimFrameRef.current = null;
      }
    };

    cameraAnimFrameRef.current = requestAnimationFrame(animateCamera);
  }, [camera, controlsRef]);

  // Create the 3 selection planes in the scene
  const createSelectionPlanes = useCallback(() => {
    if (!scene) return;

    // Remove existing selection planes with proper disposal
    if (selectionPlanesRef.current) {
      scene.remove(selectionPlanesRef.current);
      // Dispose tracked resources first
      const trackedMaterials = selectionPlanesRef.current.userData.materials as THREE.Material[] | undefined;
      const trackedGeometries = selectionPlanesRef.current.userData.geometries as THREE.BufferGeometry[] | undefined;
      trackedMaterials?.forEach((m) => m.dispose());
      trackedGeometries?.forEach((g) => g.dispose());
      // Also traverse for any missed resources
      selectionPlanesRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
    }

    const planesGroup = new THREE.Group();
    // Track all materials and geometries for proper disposal
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    planesGroup.userData.isSelectionPlanes = true;
    const planeSize = 4;
    const halfSize = planeSize / 2;

    // Create cube corner visualization - planes positioned to form a corner
    // XY plane (Blue - Front face) - positioned at positive Z
    const xyGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
    geometries.push(xyGeometry);
    const xyMaterial = new THREE.MeshBasicMaterial({
      color: PLANE_THEME.xy,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(xyMaterial);
    const xyPlane = new THREE.Mesh(xyGeometry, xyMaterial);
    xyPlane.position.set(halfSize, halfSize, 0); // Position to form corner
    xyPlane.userData.planeType = "XY";
    xyPlane.userData.baseColor = PLANE_THEME.xy;
    xyPlane.userData.baseOpacity = 0.5;
    planesGroup.add(xyPlane);

    // XZ plane (Green - Top face) - positioned at positive Y
    const xzGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
    geometries.push(xzGeometry);
    const xzMaterial = new THREE.MeshBasicMaterial({
      color: PLANE_THEME.xz,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(xzMaterial);
    const xzPlane = new THREE.Mesh(xzGeometry, xzMaterial);
    xzPlane.rotation.x = -Math.PI / 2;
    xzPlane.position.set(halfSize, 0, halfSize); // Position to form corner
    xzPlane.userData.planeType = "XZ";
    xzPlane.userData.baseColor = PLANE_THEME.xz;
    xzPlane.userData.baseOpacity = 0.5;
    planesGroup.add(xzPlane);

    // YZ plane (Red - Right face) - positioned at positive X
    const yzGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
    geometries.push(yzGeometry);
    const yzMaterial = new THREE.MeshBasicMaterial({
      color: PLANE_THEME.yz,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(yzMaterial);
    const yzPlane = new THREE.Mesh(yzGeometry, yzMaterial);
    yzPlane.rotation.y = Math.PI / 2;
    yzPlane.position.set(0, halfSize, halfSize); // Position to form corner
    yzPlane.userData.planeType = "YZ";
    yzPlane.userData.baseColor = PLANE_THEME.yz;
    yzPlane.userData.baseOpacity = 0.5;
    planesGroup.add(yzPlane);

    // Add wireframe edges to make it look more like a cube
    const edgeMaterial = new THREE.LineBasicMaterial({ color: PLANE_THEME.edge, linewidth: 2 });
    materials.push(edgeMaterial);

    // Edge along X axis (from origin)
    const xEdgeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(planeSize, 0, 0),
    ]);
    geometries.push(xEdgeGeometry);
    const xEdgeMaterial = new THREE.LineBasicMaterial({ color: PLANE_THEME.xAxis });
    materials.push(xEdgeMaterial);
    const xEdge = new THREE.Line(xEdgeGeometry, xEdgeMaterial);
    planesGroup.add(xEdge);

    // Edge along Y axis (from origin)
    const yEdgeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, planeSize, 0),
    ]);
    geometries.push(yEdgeGeometry);
    const yEdgeMaterial = new THREE.LineBasicMaterial({ color: PLANE_THEME.yAxis });
    materials.push(yEdgeMaterial);
    const yEdge = new THREE.Line(yEdgeGeometry, yEdgeMaterial);
    planesGroup.add(yEdge);

    // Edge along Z axis (from origin)
    const zEdgeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, planeSize),
    ]);
    geometries.push(zEdgeGeometry);
    const zEdgeMaterial = new THREE.LineBasicMaterial({ color: PLANE_THEME.zAxis });
    materials.push(zEdgeMaterial);
    const zEdge = new THREE.Line(zEdgeGeometry, zEdgeMaterial);
    planesGroup.add(zEdge);

    // Edges at the top of the cube corner
    const topEdge1Geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, planeSize, 0),
      new THREE.Vector3(planeSize, planeSize, 0),
    ]);
    geometries.push(topEdge1Geometry);
    const topEdge1 = new THREE.Line(topEdge1Geometry, edgeMaterial);
    planesGroup.add(topEdge1);

    const topEdge2Geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, planeSize, 0),
      new THREE.Vector3(0, planeSize, planeSize),
    ]);
    geometries.push(topEdge2Geometry);
    const topEdge2 = new THREE.Line(topEdge2Geometry, edgeMaterial);
    planesGroup.add(topEdge2);

    // Edges at the right side
    const rightEdge1Geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(planeSize, 0, 0),
      new THREE.Vector3(planeSize, planeSize, 0),
    ]);
    geometries.push(rightEdge1Geometry);
    const rightEdge1 = new THREE.Line(rightEdge1Geometry, edgeMaterial);
    planesGroup.add(rightEdge1);

    // Edges at the front
    const frontEdge1Geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, planeSize),
      new THREE.Vector3(planeSize, 0, planeSize),
    ]);
    geometries.push(frontEdge1Geometry);
    const frontEdge1 = new THREE.Line(frontEdge1Geometry, edgeMaterial);
    planesGroup.add(frontEdge1);

    const frontEdge2Geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, planeSize),
      new THREE.Vector3(0, planeSize, planeSize),
    ]);
    geometries.push(frontEdge2Geometry);
    const frontEdge2 = new THREE.Line(frontEdge2Geometry, edgeMaterial);
    planesGroup.add(frontEdge2);

    // Add origin sphere
    const originGeometry = new THREE.SphereGeometry(0.15, 16, 16);
    geometries.push(originGeometry);
    const originMaterial = new THREE.MeshBasicMaterial({ color: PLANE_THEME.origin });
    materials.push(originMaterial);
    const originSphere = new THREE.Mesh(originGeometry, originMaterial);
    planesGroup.add(originSphere);

    // Store tracked resources for proper disposal
    planesGroup.userData.materials = materials;
    planesGroup.userData.geometries = geometries;

    scene.add(planesGroup);
    selectionPlanesRef.current = planesGroup;
  }, [scene]);

  // Remove selection planes from scene
  const removeSelectionPlanes = useCallback(() => {
    if (!scene || !selectionPlanesRef.current) return;

    scene.remove(selectionPlanesRef.current);
    selectionPlanesRef.current.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });
    selectionPlanesRef.current = null;
  }, [scene]);

  // Remove offset preview planes from scene
  const removeOffsetPreview = useCallback(() => {
    if (!scene || !offsetPreviewRef.current) return;
    scene.remove(offsetPreviewRef.current);
    offsetPreviewRef.current.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });
    offsetPreviewRef.current = null;
  }, [scene]);

  // Show translucent offset preview planes during plane selection
  const updateOffsetPreview = useCallback((offset: number) => {
    if (!scene || !selectionPlanesRef.current) return;

    // Remove existing preview
    removeOffsetPreview();

    if (offset === 0) return;

    const planeSize = 4;
    const halfSize = planeSize / 2;
    const previewGroup = new THREE.Group();
    previewGroup.userData.isOffsetPreview = true;

    const planeConfigs: { color: number; position: THREE.Vector3; rotation?: THREE.Euler }[] = [
      // XY offset plane — shifted along Z
      { color: PLANE_THEME.xy, position: new THREE.Vector3(halfSize, halfSize, offset) },
      // XZ offset plane — shifted along Y
      { color: PLANE_THEME.xz, position: new THREE.Vector3(halfSize, offset, halfSize), rotation: new THREE.Euler(-Math.PI / 2, 0, 0) },
      // YZ offset plane — shifted along X
      { color: PLANE_THEME.yz, position: new THREE.Vector3(offset, halfSize, halfSize), rotation: new THREE.Euler(0, Math.PI / 2, 0) },
    ];

    for (const cfg of planeConfigs) {
      const geo = new THREE.PlaneGeometry(planeSize, planeSize);
      const mat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(cfg.position);
      if (cfg.rotation) mesh.rotation.copy(cfg.rotation);
      previewGroup.add(mesh);
    }

    // Dashed lines connecting base plane corners to offset plane corners
    const dashMat = new THREE.LineDashedMaterial({
      color: PLANE_THEME.edge,
      dashSize: 0.15,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.4,
    });

    // XY plane corners — offset along Z
    const xyCorners = [
      [0, 0], [planeSize, 0], [planeSize, planeSize], [0, planeSize],
    ];
    for (const [cx, cy] of xyCorners) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(cx, cy, 0),
        new THREE.Vector3(cx, cy, offset),
      ]);
      const line = new THREE.Line(geo, dashMat);
      line.computeLineDistances();
      previewGroup.add(line);
    }

    // XZ plane corners — offset along Y
    const xzCorners = [
      [0, 0], [planeSize, 0], [planeSize, planeSize], [0, planeSize],
    ];
    for (const [cx, cz] of xzCorners) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(cx, 0, cz),
        new THREE.Vector3(cx, offset, cz),
      ]);
      const line = new THREE.Line(geo, dashMat);
      line.computeLineDistances();
      previewGroup.add(line);
    }

    // YZ plane corners — offset along X
    const yzCorners = [
      [0, 0], [planeSize, 0], [planeSize, planeSize], [0, planeSize],
    ];
    for (const [cy, cz] of yzCorners) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, cy, cz),
        new THREE.Vector3(offset, cy, cz),
      ]);
      const line = new THREE.Line(geo, dashMat);
      line.computeLineDistances();
      previewGroup.add(line);
    }

    scene.add(previewGroup);
    offsetPreviewRef.current = previewGroup;
  }, [scene, removeOffsetPreview]);

  // Create grid on the selected plane
  const createSketchGrid = useCallback(
    (plane: SketchPlane, gridSizeOverride?: number) => {
      if (!scene) return;

      // Remove existing sketch grid
      if (sketchGridRef.current) {
        scene.remove(sketchGridRef.current);
        sketchGridRef.current.traverse((obj) => {
          if (obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
            obj.geometry?.dispose();
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material?.dispose();
            }
          }
        });
        sketchGridRef.current = null;
      }

      // Create new grid group
      const gridGroup = new THREE.Group();
      gridGroup.userData.isSketchGrid = true;

      const gridSize = gridSizeOverride ?? 20;
      const gridDivisions = gridSize * 2;

      // Create grid lines using plane vectors (two-tone: major every 1 unit, minor every 0.5 unit)
      const step = gridSize / gridDivisions;
      const halfSize = gridSize / 2;

      const majorMaterial = new THREE.LineBasicMaterial({ color: PLANE_THEME.gridMajor });
      const minorMaterial = new THREE.LineBasicMaterial({ color: PLANE_THEME.gridMinor });

      const majorPoints: THREE.Vector3[] = [];
      const minorPoints: THREE.Vector3[] = [];

      for (let i = -halfSize; i <= halfSize; i += step) {
        // Determine if this is a major (integer) or minor (half-unit) line
        const isMajor = Math.abs(i - Math.round(i)) < 1e-6;
        const pts = isMajor ? majorPoints : minorPoints;

        // Lines along yAxis direction
        pts.push(plane.origin.clone().addScaledVector(plane.xAxis, i).addScaledVector(plane.yAxis, -halfSize));
        pts.push(plane.origin.clone().addScaledVector(plane.xAxis, i).addScaledVector(plane.yAxis, halfSize));
        // Lines along xAxis direction
        pts.push(plane.origin.clone().addScaledVector(plane.yAxis, i).addScaledVector(plane.xAxis, -halfSize));
        pts.push(plane.origin.clone().addScaledVector(plane.yAxis, i).addScaledVector(plane.xAxis, halfSize));
      }

      if (minorPoints.length > 0) {
        const minorGeometry = new THREE.BufferGeometry().setFromPoints(minorPoints);
        gridGroup.add(new THREE.LineSegments(minorGeometry, minorMaterial));
      }
      if (majorPoints.length > 0) {
        const majorGeometry = new THREE.BufferGeometry().setFromPoints(majorPoints);
        gridGroup.add(new THREE.LineSegments(majorGeometry, majorMaterial));
      }

      // Add origin axes indicator (red = xAxis, green = yAxis, ~1 unit each)
      const axisLength = Math.min(gridSize / 10, 1.0);
      const xAxisPoints = [
        plane.origin.clone(),
        plane.origin.clone().addScaledVector(plane.xAxis, axisLength),
      ];
      const yAxisPoints = [
        plane.origin.clone(),
        plane.origin.clone().addScaledVector(plane.yAxis, axisLength),
      ];
      const xAxisGeom = new THREE.BufferGeometry().setFromPoints(xAxisPoints);
      const yAxisGeom = new THREE.BufferGeometry().setFromPoints(yAxisPoints);
      const xAxisLine = new THREE.Line(xAxisGeom, new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2, depthTest: false }));
      const yAxisLine = new THREE.Line(yAxisGeom, new THREE.LineBasicMaterial({ color: 0x44ff44, linewidth: 2, depthTest: false }));
      xAxisLine.renderOrder = 999;
      yAxisLine.renderOrder = 999;
      gridGroup.add(xAxisLine);
      gridGroup.add(yAxisLine);

      scene.add(gridGroup);
      sketchGridRef.current = gridGroup;
    },
    [scene]
  );

  // Cleanup sketch grid
  const cleanupSketchGrid = useCallback(() => {
    if (!scene || !sketchGridRef.current) return;

    scene.remove(sketchGridRef.current);
    sketchGridRef.current.traverse((obj) => {
      if (obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });
    sketchGridRef.current = null;
  }, [scene]);

  // Handle mouse move during plane selection (for hover effects)
  // Collect body meshes from scene elements for face-picking
  const collectBodyMeshes = useCallback((): THREE.Mesh[] => {
    const meshes: THREE.Mesh[] = [];
    for (const el of elements) {
      const obj = getObject(el.nodeId);
      if (!obj) continue;
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper && !child.userData.isSketchPrimitive) {
          meshes.push(child);
        }
      });
    }
    return meshes;
  }, [elements, getObject]);

  // Get face normal in world space from an intersection
  const getFaceWorldNormal = useCallback((intersection: THREE.Intersection): THREE.Vector3 | null => {
    if (!intersection.face) return null;
    const normal = intersection.face.normal.clone();
    const mesh = intersection.object as THREE.Mesh;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    normal.applyMatrix3(normalMatrix).normalize();
    return normal;
  }, []);

  // Clean up face highlight overlay
  const cleanupFaceHighlight = useCallback(() => {
    if (faceHighlightRef.current && scene) {
      scene.remove(faceHighlightRef.current);
      faceHighlightRef.current.geometry.dispose();
      (faceHighlightRef.current.material as THREE.Material).dispose();
      faceHighlightRef.current = null;
    }
  }, [scene]);

  const handlePlaneSelectionMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isSelectingPlane) return;

      // Clean up previous face highlight
      cleanupFaceHighlight();

      if (selectionPlanesRef.current) {
        // Get plane meshes
        const planes = selectionPlanesRef.current.children.filter(
          (child) => child instanceof THREE.Mesh && child.userData.planeType
        ) as THREE.Mesh[];

        const intersects = raycastToObjects(event, planes, false);

        // Reset all planes to base color and opacity
        planes.forEach((plane) => {
          const material = plane.material as THREE.MeshBasicMaterial;
          material.color.setHex(plane.userData.baseColor);
          material.opacity = plane.userData.baseOpacity || 0.5;
        });

        if (intersects.length > 0) {
          const hitPlane = intersects[0].object as THREE.Mesh;
          const material = hitPlane.material as THREE.MeshBasicMaterial;
          material.color.setHex(PLANE_THEME.hover); // Bright yellow on hover
          material.opacity = 0.8;
          setHoveredPlane(hitPlane.userData.planeType as SketchPlaneType);
          return; // Plane hit takes priority over face hit
        }
      }

      // Also raycast against body faces
      const bodyMeshes = collectBodyMeshes();
      if (bodyMeshes.length > 0) {
        const bodyIntersects = raycastToObjects(event, bodyMeshes, false);
        if (bodyIntersects.length > 0) {
          const hit = bodyIntersects[0];
          const worldNormal = getFaceWorldNormal(hit);
          if (worldNormal && scene) {
            // Create a highlight disc on the face
            const highlightGeom = new THREE.CircleGeometry(2.0, 32);
            const highlightMat = new THREE.MeshBasicMaterial({
              color: 0x2e75b6,
              transparent: true,
              opacity: 0.4,
              side: THREE.DoubleSide,
              depthTest: false,
            });
            const highlight = new THREE.Mesh(highlightGeom, highlightMat);
            highlight.position.copy(hit.point).addScaledVector(worldNormal, 0.01);
            const quat = new THREE.Quaternion();
            quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
            highlight.quaternion.copy(quat);
            highlight.renderOrder = 1000;
            scene.add(highlight);
            faceHighlightRef.current = highlight;
            setHoveredPlane("face" as SketchPlaneType);
            return;
          }
        }
      }

      setHoveredPlane(null);
    },
    [isSelectingPlane, raycastToObjects, collectBodyMeshes, getFaceWorldNormal, cleanupFaceHighlight, scene]
  );

  // Handle click during plane selection
  const handlePlaneSelectionClick = useCallback(
    (event: MouseEvent) => {
      if (!isSelectingPlane) return;

      // Clean up face highlight
      cleanupFaceHighlight();

      if (selectionPlanesRef.current) {
        // Get plane meshes
        const planes = selectionPlanesRef.current.children.filter(
          (child) => child instanceof THREE.Mesh && child.userData.planeType
        ) as THREE.Mesh[];

        const intersects = raycastToObjects(event, planes, false);

        if (intersects.length > 0) {
          const hitPlane = intersects[0].object as THREE.Mesh;
          const planeType = hitPlane.userData.planeType as SketchPlaneType;
          selectPlaneAndStartSketch(planeType, planeOffsetRef.current || undefined);
          return;
        }
      }

      // Also check body faces
      const bodyMeshes = collectBodyMeshes();
      if (bodyMeshes.length > 0) {
        const bodyIntersects = raycastToObjects(event, bodyMeshes, false);
        if (bodyIntersects.length > 0) {
          const hit = bodyIntersects[0];
          const worldNormal = getFaceWorldNormal(hit);
          if (worldNormal) {
            // Find the element this mesh belongs to
            let elementNodeId: string | undefined;
            let parent = hit.object.parent;
            while (parent) {
              if (parent.userData?.nodeId) {
                elementNodeId = parent.userData.nodeId;
                break;
              }
              parent = parent.parent;
            }

            // Snap normal to nearest axis if close (tolerance for tessellated faces)
            const axes = [
              new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
              new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
              new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
            ];
            for (const axis of axes) {
              if (worldNormal.angleTo(axis) < 0.1) { // ~5.7 degrees
                worldNormal.copy(axis);
                break;
              }
            }

            const facePlane = createSketchPlaneFromNormal(worldNormal, hit.point, elementNodeId);
            selectPlaneAndStartSketch(facePlane, planeOffsetRef.current || undefined);
          }
        }
      }
    },
    [isSelectingPlane, raycastToObjects, collectBodyMeshes, getFaceWorldNormal, cleanupFaceHighlight]
  );

  // Set plane offset (called from UI input, read by handlePlaneSelectionClick)
  const setPlaneOffset = useCallback((v: number) => {
    planeOffsetRef.current = v;
    updateOffsetPreview(v);
  }, [updateOffsetPreview]);

  // Enter plane selection mode
  const enterPlaneSelectionMode = useCallback(() => {
    // Clean up any existing sketch grid first
    cleanupSketchGrid();

    setIsSelectingPlane(true);
    setHoveredPlane(null);
    createSelectionPlanes();
    positionCameraForPlaneSelection();
  }, [cleanupSketchGrid, createSelectionPlanes, positionCameraForPlaneSelection]);

  // Cancel plane selection
  const cancelPlaneSelection = useCallback(() => {
    setIsSelectingPlane(false);
    setHoveredPlane(null);
    removeOffsetPreview();
    removeSelectionPlanes();
    cleanupFaceHighlight();

    // Restore original camera position and controls target
    if (camera && originalCameraPositionRef.current && originalCameraUpRef.current) {
      camera.position.copy(originalCameraPositionRef.current);
      camera.up.copy(originalCameraUpRef.current);
      const controls = controlsRef.current;
      if (controls && originalControlsTargetRef.current) {
        controls.target.copy(originalControlsTargetRef.current);
        controls.update();
      }
      camera.lookAt(originalControlsTargetRef.current ?? new THREE.Vector3(0, 0, 0));
    }
  }, [camera, controlsRef, removeOffsetPreview, removeSelectionPlanes, cleanupFaceHighlight]);

  // Select a plane and start sketch
  const selectPlaneAndStartSketch = useCallback(
    (planeOrType: SketchPlane | SketchPlaneType, offset?: number) => {
      // Accept either a full SketchPlane or a SketchPlaneType string
      const plane: SketchPlane = typeof planeOrType === "string"
        ? createSketchPlane(planeOrType)
        : planeOrType;

      // Apply offset if provided (for offset planes)
      if (offset && typeof planeOrType === "string") {
        plane.origin.addScaledVector(plane.normal, offset);
        plane.type = "offset";
        plane.offset = offset;
      }

      // Exit plane selection mode
      setIsSelectingPlane(false);
      setHoveredPlane(null);
      removeOffsetPreview();
      removeSelectionPlanes();

      // Hide the default ground plane to prevent overlap with sketch grid
      if (showGroundPlane) {
        toggleGroundPlane();
        sketchHidGroundPlaneRef.current = true;
      }

      // Disable camera rotation in sketch mode (only allow pan/zoom)
      setCameraRotationEnabled(false);

      // Save current projection type to restore on sketch exit
      originalProjectionRef.current = projectionTypeRef.current;

      // Dim existing 3D bodies so sketch stands out
      dimSceneBodies();

      // Set the drawing plane for raycasting — pass normal and plane constant
      const planeConstant = -plane.normal.dot(plane.origin);
      setDrawingPlane(plane.normal, planeConstant);

      // Orient camera to the plane, then switch to orthographic after animation
      orientCameraToPlane(plane, () => {
        if (projectionTypeRef.current !== "orthographic") {
          setProjectionType("orthographic");
        }
      });

      // Create grid on the plane (smaller grid for face planes)
      const isFacePlane = plane.type === "face";
      createSketchGrid(plane, isFacePlane ? 10 : undefined);

      // Start sketch on selected plane
      startSketch(plane);
    },
    [removeOffsetPreview, removeSelectionPlanes, orientCameraToPlane, createSketchGrid, startSketch, showGroundPlane, toggleGroundPlane, setCameraRotationEnabled, dimSceneBodies, setDrawingPlane, setProjectionType]
  );

  // Start new sketch - enters plane selection mode
  const startNewSketch = useCallback(() => {
    enterPlaneSelectionMode();
  }, [enterPlaneSelectionMode]);

  // ============================================
  // End Plane Selection Functions
  // ============================================

  // Keyboard handler for sketch mode
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (mode !== "sketch") return;

      // Don't handle if typing in an input field
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case "escape":
          // Escape: cancel plane selection, current operation, or exit to select mode
          if (isSelectingPlane) {
            cancelPlaneSelection();
          } else if (isChaining || arcStepRef.current > 0 || isDrawingRef.current) {
            cancelCurrentOperation();
          } else {
            setSketchSubMode("select");
          }
          event.preventDefault();
          break;

        case "l":
          // L: Line tool
          cancelCurrentOperation();
          setSketchSubMode("line");
          event.preventDefault();
          break;

        case "c":
          // C: Circle tool
          cancelCurrentOperation();
          setSketchSubMode("circle");
          event.preventDefault();
          break;

        case "a":
          // A: Arc tool
          cancelCurrentOperation();
          setSketchSubMode("arc");
          event.preventDefault();
          break;

        case "p":
          // P: Point tool
          cancelCurrentOperation();
          setSketchSubMode("point");
          event.preventDefault();
          break;

        case "d":
          // D: Dimension tool
          cancelCurrentOperation();
          setSketchSubMode("dimension");
          event.preventDefault();
          break;

        case "r":
          // R: Rectangle tool
          cancelCurrentOperation();
          setSketchSubMode("rectangle");
          event.preventDefault();
          break;

        case "s":
          // S: Select tool
          cancelCurrentOperation();
          setSketchSubMode("select");
          event.preventDefault();
          break;

        case "t":
          // T: Trim tool
          cancelCurrentOperation();
          setSketchSubMode("trim");
          event.preventDefault();
          break;

        case "e":
          // E: Extend tool (only when not in extrude mode)
          cancelCurrentOperation();
          setSketchSubMode("extend");
          event.preventDefault();
          break;

        case "delete":
        case "backspace":
          // Delete selected constraint glyph
          if (selectedConstraintId) {
            pushSketchUndo();
            removeConstraint(selectedConstraintId);
            solveSketch();
            setSelectedConstraintId(null);
            event.preventDefault();
          }
          break;

        case "x":
          // X: Toggle construction mode on selected primitives
          if (activeSketch && selectedPrimitives.length > 0) {
            for (const primId of selectedPrimitives) {
              const prim = activeSketch.primitives.find(p => p.id === primId);
              if (prim && (isSketchLine(prim) || isSketchCircle(prim) || isSketchArc(prim))) {
                updatePrimitive(primId, { construction: !(prim as any).construction });
              }
            }
          }
          event.preventDefault();
          break;
      }
    },
    [mode, isChaining, isSelectingPlane, cancelCurrentOperation, cancelPlaneSelection, setSketchSubMode, activeSketch, selectedPrimitives, updatePrimitive, selectedConstraintId, pushSketchUndo, removeConstraint, solveSketch]
  );

  // Find all primitives connected to a given primitive (sharing points)
  const findConnectedPrimitives = useCallback(
    (primitiveId: string): string[] => {
      if (!activeSketch) return [primitiveId];

      const connected = new Set<string>();
      const visited = new Set<string>();
      const queue = [primitiveId];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const primitive = activeSketch.primitives.find((p) => p.id === currentId);
        if (!primitive) continue;

        // Get point IDs used by this primitive
        const pointIds: string[] = [];
        if (isSketchLine(primitive)) {
          pointIds.push(primitive.p1Id, primitive.p2Id);
          connected.add(currentId);
        } else if (isSketchCircle(primitive)) {
          pointIds.push(primitive.centerId);
          connected.add(currentId);
        } else if (isSketchArc(primitive)) {
          pointIds.push(primitive.centerId, primitive.startId, primitive.endId);
          connected.add(currentId);
        } else if (isSketchPoint(primitive)) {
          // For points, find primitives that use this point
          pointIds.push(currentId);
        }

        // Find other primitives that share these points
        for (const pointId of pointIds) {
          for (const other of activeSketch.primitives) {
            if (visited.has(other.id)) continue;

            let sharesPoint = false;
            if (isSketchLine(other)) {
              sharesPoint = other.p1Id === pointId || other.p2Id === pointId;
            } else if (isSketchCircle(other)) {
              sharesPoint = other.centerId === pointId;
            } else if (isSketchArc(other)) {
              sharesPoint = other.centerId === pointId || other.startId === pointId || other.endId === pointId;
            }

            if (sharesPoint) {
              queue.push(other.id);
            }
          }
        }
      }

      return Array.from(connected);
    },
    [activeSketch]
  );

  // Selection functions
  const selectPrimitive = useCallback(
    (id: string, addToSelection: boolean) => {
      setSelectedPrimitives((prev) => {
        if (addToSelection) {
          // Shift+click: toggle in/out of selection
          if (prev.includes(id)) {
            return prev.filter((p) => p !== id);
          }
          return [...prev, id];
        } else {
          // Regular click: select ONLY this primitive
          if (prev.length === 1 && prev[0] === id) {
            return [];
          }
          return [id];
        }
      });
    },
    []
  );

  const clearSelection = useCallback(() => {
    setSelectedPrimitives([]);
    setSelectedConstraintId(null);
  }, []);

  // Apply constraint to selected primitives
  const applyConstraint = useCallback(
    async (type: ConstraintType, value?: number) => {
      if (selectedPrimitives.length === 0 || !activeSketch) {
        console.warn("No primitives selected for constraint");
        return;
      }

      pushSketchUndo();

      // Get the actual primitive objects for type checking
      const getPrimitive = (id: string) => activeSketch.primitives.find(p => p.id === id);

      // Track last constraint result for feedback
      let lastResult: { status: ConstraintResultStatus } = { status: "applied" };

      // Single-primitive constraints that should be applied to each selected primitive
      const singlePrimitiveConstraints: ConstraintType[] = [
        "horizontal", "vertical", "radius", "diameter"
      ];

      if (singlePrimitiveConstraints.includes(type) && selectedPrimitives.length > 1) {
        // Apply constraint to each primitive separately
        console.log(`Applying ${type} constraint to ${selectedPrimitives.length} primitives`);
        for (const primitiveId of selectedPrimitives) {
          const constraint: SketchConstraint = {
            id: generateId("const"),
            type,
            primitiveIds: [primitiveId],
            value,
            driving: true,
          };
          console.log("Applying constraint:", constraint);
          const result = await addConstraintAndSolve(constraint);
          if (result.status !== "applied") lastResult = result;
        }
      } else if (type === "pointOnLine" && selectedPrimitives.length > 2) {
        // Special case: pointOnLine with multiple primitives
        // Find the point/circle and the CLOSEST line (not just the first one)
        let pointOrCircleId: string | null = null;
        const lineIds: string[] = [];

        for (const id of selectedPrimitives) {
          const prim = getPrimitive(id);
          if (!prim) continue;

          if (isSketchPoint(prim) || isSketchCircle(prim)) {
            if (!pointOrCircleId) pointOrCircleId = id;
          } else if (isSketchLine(prim)) {
            lineIds.push(id);
          }
        }

        if (pointOrCircleId && lineIds.length > 0) {
          // Get the point coordinates
          const pointOrCircle = getPrimitive(pointOrCircleId);
          let px = 0, py = 0;

          if (pointOrCircle) {
            if (isSketchPoint(pointOrCircle)) {
              px = pointOrCircle.x;
              py = pointOrCircle.y;
            } else if (isSketchCircle(pointOrCircle)) {
              // Get the circle's center point
              const centerPoint = activeSketch.primitives.find(p => p.id === pointOrCircle.centerId);
              if (centerPoint && isSketchPoint(centerPoint)) {
                px = centerPoint.x;
                py = centerPoint.y;
              }
            }
          }

          // Find the closest line to the point
          let closestLineId = lineIds[0];
          let minDistance = Infinity;

          for (const lineId of lineIds) {
            const distance = getDistanceToLine(px, py, lineId);
            if (distance < minDistance) {
              minDistance = distance;
              closestLineId = lineId;
            }
          }

          console.log(`pointOnLine: selected closest line ${closestLineId} at distance ${minDistance.toFixed(4)}`);

          const constraint: SketchConstraint = {
            id: generateId("const"),
            type,
            primitiveIds: [pointOrCircleId, closestLineId],
            value,
            driving: true,
          };
          console.log("Applying pointOnLine constraint:", constraint);
          lastResult = await addConstraintAndSolve(constraint);
        } else {
          console.warn("Could not find point/circle and line for pointOnLine constraint");
        }
      } else if (type === "pointOnCircle" && selectedPrimitives.length > 2) {
        // Special case: pointOnCircle with multiple primitives
        let pointId: string | null = null;
        let circleId: string | null = null;

        for (const id of selectedPrimitives) {
          const prim = getPrimitive(id);
          if (!prim) continue;

          if (isSketchPoint(prim)) {
            if (!pointId) pointId = id;
          } else if (isSketchCircle(prim) || isSketchArc(prim)) {
            if (!circleId) circleId = id;
          }
        }

        if (pointId && circleId) {
          const constraint: SketchConstraint = {
            id: generateId("const"),
            type,
            primitiveIds: [pointId, circleId],
            value,
            driving: true,
          };
          console.log("Applying pointOnCircle constraint:", constraint);
          lastResult = await addConstraintAndSolve(constraint);
        } else {
          console.warn("Could not find point and circle for pointOnCircle constraint");
        }
      } else if (type === "tangent" && selectedPrimitives.length > 2) {
        // Special case: tangent with multiple primitives
        let lineId: string | null = null;
        let circleId: string | null = null;

        for (const id of selectedPrimitives) {
          const prim = getPrimitive(id);
          if (!prim) continue;

          if (isSketchLine(prim)) {
            if (!lineId) lineId = id;
          } else if (isSketchCircle(prim)) {
            if (!circleId) circleId = id;
          }
        }

        if (lineId && circleId) {
          const constraint: SketchConstraint = {
            id: generateId("const"),
            type,
            primitiveIds: [lineId, circleId],
            value,
            driving: true,
          };
          console.log("Applying tangent constraint:", constraint);
          lastResult = await addConstraintAndSolve(constraint);
        } else {
          console.warn("Could not find line and circle for tangent constraint");
        }
      } else {
        // Apply constraint to all selected primitives together
        const constraint: SketchConstraint = {
          id: generateId("const"),
          type,
          primitiveIds: [...selectedPrimitives],
          value,
          driving: true,
        };
        console.log("Applying constraint:", constraint);
        lastResult = await addConstraintAndSolve(constraint);
      }

      // Show feedback for redundant/conflicting constraints
      showConstraintFeedback(lastResult.status);

      clearSelection();
    },
    [selectedPrimitives, activeSketch, generateId, addConstraintAndSolve, clearSelection, pushSketchUndo, showConstraintFeedback]
  );

  // Clear pending line dimension (called when user cancels or submits)
  const clearPendingLineDimension = useCallback(() => {
    setPendingLineDimension(null);
  }, []);

  // Apply length constraint to a specific line
  const applyLineLengthConstraint = useCallback(
    async (lineId: string, length: number) => {
      pushSketchUndo();
      const constraint: SketchConstraint = {
        id: generateId("const"),
        type: "distance",
        primitiveIds: [lineId],
        value: length,
        driving: true,
      };
      console.log("Applying length constraint to line:", lineId, "length:", length);
      const result = await addConstraintAndSolve(constraint);
      showConstraintFeedback(result.status);
      clearPendingLineDimension();
    },
    [generateId, addConstraintAndSolve, clearPendingLineDimension, pushSketchUndo, showConstraintFeedback]
  );

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu({
      visible: false,
      x: 0,
      y: 0,
      primitiveIds: [],
      primitiveTypes: [],
    });
  }, []);

  // Delete a constraint by ID (used by context menu)
  const deleteConstraint = useCallback(
    (constraintId: string) => {
      pushSketchUndo();
      removeConstraint(constraintId);
      solveSketch();
      setSelectedConstraintId(null);
      closeContextMenu();
    },
    [pushSketchUndo, removeConstraint, solveSketch, closeContextMenu]
  );

  // Apply constraint to primitives from context menu
  const applyConstraintToContextMenuPrimitives = useCallback(
    async (type: ConstraintType, value?: number) => {
      if (contextMenu.primitiveIds.length === 0) {
        console.warn("No primitives in context menu for constraint");
        closeContextMenu();
        return;
      }

      pushSketchUndo();

      // Track last constraint result for feedback
      let lastResult: { status: ConstraintResultStatus } = { status: "applied" };

      // Single-primitive constraints that should be applied to each primitive separately
      const singlePrimitiveConstraints: ConstraintType[] = [
        "horizontal", "vertical", "radius", "diameter"
      ];

      if (singlePrimitiveConstraints.includes(type) && contextMenu.primitiveIds.length > 1) {
        // Apply constraint to each primitive separately
        console.log(`Applying ${type} constraint to ${contextMenu.primitiveIds.length} primitives from context menu`);
        for (const primitiveId of contextMenu.primitiveIds) {
          const constraint: SketchConstraint = {
            id: generateId("const"),
            type,
            primitiveIds: [primitiveId],
            value,
            driving: true,
          };
          const result = await addConstraintAndSolve(constraint);
          if (result.status !== "applied") lastResult = result;
        }
      } else {
        // Apply constraint to all primitives together
        const constraint: SketchConstraint = {
          id: generateId("const"),
          type,
          primitiveIds: [...contextMenu.primitiveIds],
          value,
          driving: true,
        };
        console.log("Applying constraint from context menu:", constraint);
        lastResult = await addConstraintAndSolve(constraint);
      }

      // Show feedback for redundant/conflicting constraints
      showConstraintFeedback(lastResult.status);

      closeContextMenu();
    },
    [contextMenu.primitiveIds, generateId, addConstraintAndSolve, closeContextMenu, pushSketchUndo, showConstraintFeedback]
  );

  // Handle dragging primitives in select mode
  const handleDragMove = useCallback(
    (event: MouseEvent) => {
      // Use ref to avoid stale closure issues during drag
      const currentSketch = activeSketchRef.current;
      if (!isDraggingRef.current || !dragStartPointRef.current || !currentSketch) return;

      const point3D = getMouseIntersection(event);
      if (!point3D) return;

      // Convert to 2D sketch coords — dragStartPointRef is already in sketch coords
      const point = worldToSketch2D(point3D, currentSketch.plane);
      const deltaX = point.x - dragStartPointRef.current.x;
      const deltaY = point.y - dragStartPointRef.current.y;

      // Batch update: collect all position updates
      const updates: Map<string, { x: number; y: number }> = new Map();
      for (const primitiveId of draggedPrimitiveIdsRef.current) {
        const originalPos = dragOriginalPositionsRef.current.get(primitiveId);
        if (!originalPos) continue;

        updates.set(primitiveId, {
          x: originalPos.x + deltaX,
          y: originalPos.y + deltaY,
        });
      }

      // Apply all updates and solve in one go
      updatePrimitivesAndSolve(updates);
    },
    [getMouseIntersection, worldToSketch2D, updatePrimitivesAndSolve]
  );

  const handleDragEnd = useCallback(async () => {
    if (!isDraggingRef.current) return;

    // Unfix the dragged points so they can be moved by the solver in future operations
    for (const pointId of draggedPrimitiveIdsRef.current) {
      updatePrimitive(pointId, { fixed: false });
    }

    isDraggingRef.current = false;
    dragStartPointRef.current = null;
    draggedPrimitiveIdsRef.current = [];
    dragOriginalPositionsRef.current.clear();

    // Re-solve the sketch after moving to enforce constraints
    await solveSketch();
  }, [solveSketch, updatePrimitive]);

  const startDrag = useCallback(
    (event: MouseEvent, primitiveIds: string[]) => {
      if (!activeSketch) return;

      const point3D = getMouseIntersection(event);
      if (!point3D) return;

      // Store drag start in 2D sketch coordinates
      const point = worldToSketch2D(point3D, activeSketch.plane);

      // Collect all points that need to be moved
      const pointsToMove: string[] = [];

      for (const primitiveId of primitiveIds) {
        const primitive = activeSketch.primitives.find((p) => p.id === primitiveId);
        if (!primitive) continue;

        if (isSketchPoint(primitive)) {
          pointsToMove.push(primitiveId);
        } else if (isSketchLine(primitive)) {
          // Move both endpoints of the line
          if (!pointsToMove.includes(primitive.p1Id)) {
            pointsToMove.push(primitive.p1Id);
          }
          if (!pointsToMove.includes(primitive.p2Id)) {
            pointsToMove.push(primitive.p2Id);
          }
        } else if (isSketchCircle(primitive)) {
          // Move the center point
          if (!pointsToMove.includes(primitive.centerId)) {
            pointsToMove.push(primitive.centerId);
          }
        } else if (isSketchArc(primitive)) {
          // Move all arc points
          if (!pointsToMove.includes(primitive.centerId)) {
            pointsToMove.push(primitive.centerId);
          }
          if (!pointsToMove.includes(primitive.startId)) {
            pointsToMove.push(primitive.startId);
          }
          if (!pointsToMove.includes(primitive.endId)) {
            pointsToMove.push(primitive.endId);
          }
        }
      }

      // Store original positions and mark points as fixed during drag
      // This tells the solver to move OTHER points (like constrained circles)
      // to satisfy constraints, not the points being actively dragged
      dragOriginalPositionsRef.current.clear();
      for (const pointId of pointsToMove) {
        const pointPrimitive = activeSketch.primitives.find((p) => p.id === pointId);
        if (pointPrimitive && isSketchPoint(pointPrimitive)) {
          dragOriginalPositionsRef.current.set(pointId, {
            x: pointPrimitive.x,
            y: pointPrimitive.y,
          });
          // Mark as fixed so solver doesn't move this point
          updatePrimitive(pointId, { fixed: true });
        }
      }

      pushSketchUndo();
      isDraggingRef.current = true;
      dragStartPointRef.current = point.clone();
      draggedPrimitiveIdsRef.current = pointsToMove;
    },
    [activeSketch, getMouseIntersection, worldToSketch2D, updatePrimitive, pushSketchUndo]
  );

  // Handle select mode - raycast to find clicked primitive
  const handleSelectMode = useCallback(
    (event: MouseEvent, isRightClick: boolean = false) => {
      // Handle drag events
      if (event.type === "mousemove" && isDraggingRef.current) {
        handleDragMove(event);
        return;
      }
      if (event.type === "mouseup" && isDraggingRef.current) {
        handleDragEnd();
        return;
      }

      if (event.type !== "mousedown") return;

      // Get sketch objects
      const objects = sketchObjectsRef.current;
      if (objects.length === 0) {
        if (!isRightClick) {
          clearSelection();
        }
        closeContextMenu();
        return;
      }

      // Check for constraint glyph click (sprites with isConstraintGlyph userData)
      if (camera && renderer) {
        const glyphSprites = sketchObjectsRef.current.filter(
          (obj) => obj.userData.isConstraintGlyph && obj instanceof THREE.Sprite
        ) as THREE.Sprite[];

        if (glyphSprites.length > 0) {
          const rect = renderer.domElement.getBoundingClientRect();
          const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
          );
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(mouse, camera);
          const glyphHits = raycaster.intersectObjects(glyphSprites);

          if (glyphHits.length > 0) {
            const hitGlyph = glyphHits[0].object;
            const constraintId = hitGlyph.userData.constraintId as string;

            if (isRightClick) {
              // Right-click on glyph: open context menu with constraintId
              setContextMenu({
                visible: true,
                x: event.clientX,
                y: event.clientY,
                primitiveIds: [],
                primitiveTypes: [],
                constraintId,
              });
            } else {
              // Left-click: select the constraint glyph
              setSelectedConstraintId(constraintId);
              setSelectedPrimitives([]);
            }
            return;
          }
        }
      }

      // Helper: handle a found primitive (right-click context menu, drag, or select)
      const handleFoundPrimitive = (primitiveId: string, primitiveType: string) => {
        if (isRightClick) {
          let primitiveIds: string[];
          let primitiveTypes: string[];

          if (selectedPrimitives.includes(primitiveId)) {
            primitiveIds = [...selectedPrimitives];
            primitiveTypes = primitiveIds.map((id) => {
              const prim = activeSketch?.primitives.find((p) => p.id === id);
              return prim?.type || "unknown";
            });
          } else {
            primitiveIds = [primitiveId];
            primitiveTypes = [primitiveType];
          }

          setContextMenu({
            visible: true,
            x: event.clientX,
            y: event.clientY,
            primitiveIds,
            primitiveTypes,
          });
          return;
        }

        const addToSelection = event.shiftKey;

        if (selectedPrimitives.includes(primitiveId) && !addToSelection) {
          const connectedPrimitives = findConnectedPrimitives(primitiveId);
          startDrag(event, connectedPrimitives);
          return;
        }

        selectPrimitive(primitiveId, addToSelection);
      };

      // Screen-space point proximity check — points are too small for mesh
      // raycasting when Line2's threshold makes lines dominate. Project each
      // point to screen pixels and check distance to click position.
      if (renderer && camera && activeSketch) {
        const rect = renderer.domElement.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        let closestPointId: string | null = null;
        let closestDist = SKETCH_CONFIG.POINT_HIT_RADIUS_PX;

        for (const primitive of activeSketch.primitives) {
          if (!isSketchPoint(primitive)) continue;
          const pos3D = sketchTo3DRef.current(primitive.x, primitive.y, 0.1);
          const projected = pos3D.project(camera);
          const screenX = (projected.x * 0.5 + 0.5) * rect.width;
          const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
          const dist = Math.hypot(screenX - clickX, screenY - clickY);
          if (dist < closestDist) {
            closestDist = dist;
            closestPointId = primitive.id;
          }
        }

        if (closestPointId) {
          handleFoundPrimitive(closestPointId, "point");
          return;
        }
      }

      // Raycast for lines/circles/arcs (Line2 screen-space raycasting)
      const intersects = raycastToObjects(event, objects, true);

      if (intersects.length > 0) {
        for (const intersect of intersects) {
          let obj: THREE.Object3D | null = intersect.object;
          while (obj) {
            if (obj.userData.primitiveId) {
              handleFoundPrimitive(
                obj.userData.primitiveId as string,
                obj.userData.type as string,
              );
              return;
            }
            obj = obj.parent;
          }
        }
      }

      // Clicked on empty space
      if (isRightClick) {
        closeContextMenu();
      } else if (!event.shiftKey) {
        clearSelection();
      }
    },
    [raycastToObjects, selectPrimitive, clearSelection, closeContextMenu, selectedPrimitives, activeSketch, startDrag, handleDragMove, handleDragEnd, findConnectedPrimitives, renderer, camera]
  );

  // Main event handler
  const handleSketchMode = useCallback(
    (event: MouseEvent) => {
      if (mode !== "sketch") return;

      // Don't handle mouse events during plane selection (UI handles it)
      if (isSelectingPlane) {
        return;
      }

      // Handle right-click for context menu
      if (event.button === 2) {
        if (event.type === "mousedown") {
          handleSelectMode(event, true);
        }
        return;
      }

      // Only handle left-click for drawing; skip if nav tool active
      if (event.button !== 0 || event.altKey || navToolActiveRef.current) return;

      const point3D = getMouseIntersection(event);
      if (!point3D) return;

      // Convert 3D world intersection to 2D sketch coordinates
      let point = activeSketch
        ? worldToSketch2D(point3D, activeSketch.plane)
        : point3D.clone();

      // Apply grid snapping first
      point = snapToGrid(point);

      // Calculate inference points for snapping (suppressed when Ctrl held or in trim mode)
      if (activeSketch && event.type === "mousemove" && sketchSubMode !== "trim" && sketchSubMode !== "extend") {
        if (ctrlHeldRef.current) {
          // Ctrl held: clear any visible inference objects and skip snapping
          setCurrentInferencePoint(null);
          cleanupInferenceObjects();
          setGuidelines([]);
          renderGuidelines([]);
        } else {
          const inferencePoints = findInferencePoints(activeSketch);
          const nearestSnap = findNearestSnap(point, inferencePoints, INFERENCE_SNAP_DISTANCE);

          if (nearestSnap) {
            // Snap to inference point
            point = nearestSnap.position.clone();
            setCurrentInferencePoint(nearestSnap);
            renderInferencePoint(nearestSnap);
          } else {
            setCurrentInferencePoint(null);
            cleanupInferenceObjects();
          }

          // Calculate guidelines for horizontal/vertical alignment
          const currentGuidelines = findGuidelines(
            point,
            activeSketch,
            chainStartPointRef.current,
            ALIGNMENT_TOLERANCE
          );
          setGuidelines(currentGuidelines);
          renderGuidelines(currentGuidelines);
        }
      }

      // On mousedown, also check for snap (suppressed when Ctrl held or in trim mode)
      if (activeSketch && event.type === "mousedown" && !ctrlHeldRef.current && sketchSubMode !== "trim" && sketchSubMode !== "extend") {
        const inferencePoints = findInferencePoints(activeSketch);
        const nearestSnap = findNearestSnap(point, inferencePoints, INFERENCE_SNAP_DISTANCE);
        if (nearestSnap) {
          point = nearestSnap.position.clone();
          lastSnapRef.current = nearestSnap;
        } else {
          lastSnapRef.current = null;
        }
      }

      switch (sketchSubMode) {
        case "line":
          handleLineDraw(event, point);
          break;
        case "rectangle":
          handleRectangleDraw(event, point);
          break;
        case "circle":
          handleCircleDraw(event, point);
          break;
        case "arc":
          handleArcDraw(event, point);
          break;
        case "point":
          handlePointDraw(event, point);
          break;
        case "select":
        case "dimension":
          handleSelectMode(event, false);
          break;
        case "trim":
          handleTrimMode(event, point);
          break;
        case "extend":
          handleExtendMode(event, point);
          break;
      }
    },
    [
      mode,
      sketchSubMode,
      activeSketch,
      getMouseIntersection,
      worldToSketch2D,
      snapToGrid,
      handleLineDraw,
      handleRectangleDraw,
      handleCircleDraw,
      handleArcDraw,
      handlePointDraw,
      handleSelectMode,
      findInferencePoints,
      findNearestSnap,
      findGuidelines,
      renderInferencePoint,
      renderGuidelines,
      cleanupInferenceObjects,
      isSelectingPlane,
      handleTrimMode,
      handleExtendMode,
    ]
  );

  // Render sketch primitives to Three.js objects
  useEffect(() => {
    // Helper to cleanup objects
    const cleanupObjects = () => {
      sketchObjectsRef.current.forEach((obj) => {
        scene?.remove(obj);
        if (obj instanceof Line2 || obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        } else if (obj instanceof THREE.Sprite) {
          (obj.material as THREE.SpriteMaterial).map?.dispose();
          obj.material.dispose();
        }
      });
      sketchObjectsRef.current = [];
    };

    if (!scene || !sceneReady || !activeSketch) {
      // Clear sketch objects when no active sketch or scene not ready
      cleanupObjects();
      return;
    }

    // Clear old objects before rendering new ones
    cleanupObjects();

    const newObjects: THREE.Object3D[] = [];

    // Get color based on status, with construction line support
    const getColor = (primitiveId: string) => {
      const prim = activeSketch.primitives.find(p => p.id === primitiveId);
      const isConstruction = prim && (prim as any).construction;

      // Selected primitives get highlight color
      if (selectedPrimitives.includes(primitiveId)) {
        return isConstruction ? SKETCH_THEME.constructionSelected : COLORS.selected;
      }
      if (isConstruction) {
        return SKETCH_THEME.construction;
      }
      // Otherwise use status color
      return activeSketch.status === "fully_constrained"
        ? COLORS.constrained
        : activeSketch.status === "overconstrained"
        ? COLORS.overconstrained
        : COLORS.underconstrained;
    };

    // Check if a primitive is a construction element
    const isConstruction = (primitiveId: string): boolean => {
      const prim = activeSketch.primitives.find(p => p.id === primitiveId);
      return !!(prim && (prim as any).construction);
    };

    // Convert 2D sketch coordinates to 3D based on plane vectors
    const sketchTo3D = (x: number, y: number, zOffset: number = 0): THREE.Vector3 => {
      const plane = activeSketch.plane;
      return new THREE.Vector3()
        .copy(plane.origin)
        .addScaledVector(plane.xAxis, x)
        .addScaledVector(plane.yAxis, y)
        .addScaledVector(plane.normal, zOffset);
    };
    sketchTo3DRef.current = sketchTo3D;

    // Get point positions
    const getPointPosition = (pointId: string): THREE.Vector3 | null => {
      const point = activeSketch.primitives.find(
        (p) => p.id === pointId && isSketchPoint(p)
      ) as SketchPoint | undefined;
      if (point) {
        return sketchTo3D(point.x, point.y, 0);
      }
      return null;
    };

    // Build point map for profile detection
    const pointMap = new Map<string, { x: number; y: number }>();

    // Render each primitive
    for (const primitive of activeSketch.primitives) {
      const isSelected = selectedPrimitives.includes(primitive.id);
      const color = getColor(primitive.id);
      const constructionFlag = isConstruction(primitive.id);

      if (isSketchPoint(primitive)) {
        // Store point position for profile detection
        pointMap.set(primitive.id, { x: primitive.x, y: primitive.y });

        // Render point as small flat circle (Fusion 360 style)
        // Dim points during trim mode so they don't obscure edges
        const isTrimMode = sketchSubMode === "trim";
        const size = isTrimMode ? 0.04 : (isSelected ? 0.1 : 0.07);
        const geometry = new THREE.CircleGeometry(size, 16);
        const pointColor = isSelected ? COLORS.selectedPoint : COLORS.point;
        const material = new THREE.MeshBasicMaterial({
          color: pointColor,
          depthTest: false,
          ...(isTrimMode ? { transparent: true, opacity: 0.25 } : {}),
        });
        const mesh = new THREE.Mesh(geometry, material);
        const pos = sketchTo3D(primitive.x, primitive.y, 0.1);
        mesh.position.copy(pos);
        mesh.renderOrder = 999;
        mesh.userData = { primitiveId: primitive.id, type: "point", isSketchPrimitive: true };
        scene.add(mesh);
        newObjects.push(mesh);
      } else if (isSketchLine(primitive)) {
        const p1 = getPointPosition(primitive.p1Id);
        const p2 = getPointPosition(primitive.p2Id);
        if (p1 && p2) {
          // Apply plane-aware offset for visibility using sketchTo3D
          const p1Prim = activeSketch.primitives.find(p => p.id === primitive.p1Id && isSketchPoint(p)) as SketchPoint | undefined;
          const p2Prim = activeSketch.primitives.find(p => p.id === primitive.p2Id && isSketchPoint(p)) as SketchPoint | undefined;
          if (p1Prim && p2Prim) {
            const p1Offset = sketchTo3D(p1Prim.x, p1Prim.y, 0.05);
            const p2Offset = sketchTo3D(p2Prim.x, p2Prim.y, 0.05);
            p1.copy(p1Offset);
            p2.copy(p2Offset);
          }

          // Create Line2 for thin, crisp lines
          const positions = [p1.x, p1.y, p1.z, p2.x, p2.y, p2.z];
          const lineColor = isSelected ? COLORS.selectedLine : color;
          const lineWidth = isSelected ? 3.0 : 1.5;
          const line = createLine2FromPoints(positions, lineColor, lineWidth, constructionFlag);
          line.renderOrder = 999;
          line.userData = { primitiveId: primitive.id, type: "line", isSketchPrimitive: true };
          scene.add(line);
          newObjects.push(line);
        } else {
          console.warn("Could not find points for line:", primitive.p1Id, primitive.p2Id);
        }
      } else if (isSketchCircle(primitive)) {
        const centerPt = activeSketch.primitives.find(
          (p) => p.id === primitive.centerId && isSketchPoint(p)
        ) as SketchPoint | undefined;
        if (centerPt) {
          const segments = 64;
          const positions: number[] = [];
          for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const localX = centerPt.x + Math.cos(angle) * primitive.radius;
            const localY = centerPt.y + Math.sin(angle) * primitive.radius;
            const pt = sketchTo3D(localX, localY, 0.01);
            positions.push(pt.x, pt.y, pt.z);
          }
          const lineWidth = isSelected ? 3.0 : 1.5;
          const line = createLine2FromPoints(positions, color, lineWidth, constructionFlag);
          line.renderOrder = 999;
          line.userData = { primitiveId: primitive.id, type: "circle", isSketchPrimitive: true };
          scene.add(line);
          newObjects.push(line);
        } else {
          console.warn("Could not find center for circle:", primitive.centerId);
        }
      } else if (isSketchArc(primitive)) {
        // Get 2D coordinates from primitives for arc calculation
        const centerPrim2D = activeSketch.primitives.find(p => p.id === primitive.centerId && isSketchPoint(p)) as SketchPoint | undefined;
        const startPrim2D = activeSketch.primitives.find(p => p.id === primitive.startId && isSketchPoint(p)) as SketchPoint | undefined;
        const endPrim2D = activeSketch.primitives.find(p => p.id === primitive.endId && isSketchPoint(p)) as SketchPoint | undefined;
        if (centerPrim2D && startPrim2D && endPrim2D) {
          const radius = primitive.radius;
          const startAngle = Math.atan2(startPrim2D.y - centerPrim2D.y, startPrim2D.x - centerPrim2D.x);
          const endAngle = Math.atan2(endPrim2D.y - centerPrim2D.y, endPrim2D.x - centerPrim2D.x);
          const angleDiff = endAngle - startAngle;
          const normalizedDiff =
            angleDiff > 0 ? angleDiff : angleDiff + Math.PI * 2;

          const segments = 32;
          const positions: number[] = [];
          for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const currentAngle = startAngle + normalizedDiff * t;
            const localX = centerPrim2D.x + Math.cos(currentAngle) * radius;
            const localY = centerPrim2D.y + Math.sin(currentAngle) * radius;
            const pt = sketchTo3D(localX, localY, 0.05);
            positions.push(pt.x, pt.y, pt.z);
          }
          const lineWidth = isSelected ? 3.0 : 1.5;
          const line = createLine2FromPoints(positions, color, lineWidth, constructionFlag);
          line.userData = { primitiveId: primitive.id, type: "arc", isSketchPrimitive: true };
          scene.add(line);
          newObjects.push(line);
        }
      }
    }

    // ── Tier 3: Constraint glyphs on geometry ──
    const constraintGlyphMap: Record<string, string> = {
      horizontal: "H",
      vertical: "V",
      perpendicular: "\u27c2",
      parallel: "//",
      equal: "=",
      tangent: "T",
      midpoint: "M",
      coincident: "\u25cf",
      concentric: "\u25ce",
      symmetric: "S",
      pointOnLine: "\u25cf",
      pointOnCircle: "\u25cf",
      distance: "D",
      distanceX: "Dx",
      distanceY: "Dy",
      angle: "\u2220",
      radius: "R",
      diameter: "\u2300",
    };

    // Track glyph offset per primitive to stagger overlapping glyphs
    const glyphCountPerPrimitive = new Map<string, number>();

    for (const constraint of activeSketch.constraints) {
      const glyphText = constraintGlyphMap[constraint.type] || "?";
      const firstPrimId = constraint.primitiveIds[0];
      if (!firstPrimId) continue;

      const prim = activeSketch.primitives.find(p => p.id === firstPrimId);
      if (!prim) continue;

      // Calculate glyph position at the midpoint of the first referenced primitive
      let glyphPos: THREE.Vector3 | null = null;
      let perpOffset = new THREE.Vector3(0, 0, 0);

      if (isSketchLine(prim)) {
        const pt1 = pointMap.get(prim.p1Id);
        const pt2 = pointMap.get(prim.p2Id);
        if (pt1 && pt2) {
          const midX = (pt1.x + pt2.x) / 2;
          const midY = (pt1.y + pt2.y) / 2;
          glyphPos = sketchTo3D(midX, midY, 0.15);
          // Perpendicular offset direction
          const dx = pt2.x - pt1.x;
          const dy = pt2.y - pt1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            perpOffset = sketchTo3D(-dy / len * 0.25, dx / len * 0.25, 0);
          }
        }
      } else if (isSketchCircle(prim)) {
        const cp = pointMap.get(prim.centerId);
        if (cp) {
          glyphPos = sketchTo3D(cp.x + prim.radius * 0.7, cp.y + prim.radius * 0.7, 0.15);
        }
      } else if (isSketchPoint(prim)) {
        glyphPos = sketchTo3D(prim.x, prim.y, 0.15);
        perpOffset = sketchTo3D(0.2, 0.2, 0);
      }

      if (glyphPos) {
        // Stagger multiple glyphs on same primitive
        const count = glyphCountPerPrimitive.get(firstPrimId) || 0;
        glyphCountPerPrimitive.set(firstPrimId, count + 1);
        glyphPos.add(perpOffset.multiplyScalar(count === 0 ? 1 : 1));
        glyphPos.y += count * 0.35;

        const isSelected = constraint.id === selectedConstraintId;
        const sprite = createConstraintGlyph(glyphText, glyphPos, isSelected);
        sprite.userData.constraintId = constraint.id;
        sprite.userData.isConstraintGlyph = true;
        scene.add(sprite);
        newObjects.push(sprite);
      }
    }

    // ── Tier 6A: Dimension display with extension lines ──
    const dimensionTypes = new Set(["distance", "distanceX", "distanceY", "angle", "radius", "diameter"]);
    for (const constraint of activeSketch.constraints) {
      if (!dimensionTypes.has(constraint.type) || constraint.value === undefined) continue;

      const firstPrimId = constraint.primitiveIds[0];
      const prim = activeSketch.primitives.find(p => p.id === firstPrimId);
      if (!prim) continue;

      if (constraint.type === "distance" && isSketchLine(prim)) {
        // Line distance: show extension lines + dimension line with value
        const pt1 = pointMap.get(prim.p1Id);
        const pt2 = pointMap.get(prim.p2Id);
        if (!pt1 || !pt2) continue;

        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.01) continue;

        // Perpendicular direction for offset
        const perpX = -dy / len;
        const perpY = dx / len;
        const offset = 0.5; // Distance from geometry to dimension line

        // Extension line endpoints
        const ext1Start = sketchTo3D(pt1.x, pt1.y, 0.12);
        const ext1End = sketchTo3D(pt1.x + perpX * offset, pt1.y + perpY * offset, 0.12);
        const ext2Start = sketchTo3D(pt2.x, pt2.y, 0.12);
        const ext2End = sketchTo3D(pt2.x + perpX * offset, pt2.y + perpY * offset, 0.12);

        // Extension lines (thin)
        const dimColor = SKETCH_THEME.constraintGlyph;
        const ext1 = createLine2FromPoints(
          [ext1Start.x, ext1Start.y, ext1Start.z, ext1End.x, ext1End.y, ext1End.z],
          dimColor, 0.8
        );
        ext1.renderOrder = 1000;
        scene.add(ext1);
        newObjects.push(ext1);

        const ext2 = createLine2FromPoints(
          [ext2Start.x, ext2Start.y, ext2Start.z, ext2End.x, ext2End.y, ext2End.z],
          dimColor, 0.8
        );
        ext2.renderOrder = 1000;
        scene.add(ext2);
        newObjects.push(ext2);

        // Dimension line between extension line ends
        const dimLine = createLine2FromPoints(
          [ext1End.x, ext1End.y, ext1End.z, ext2End.x, ext2End.y, ext2End.z],
          dimColor, 1.0
        );
        dimLine.renderOrder = 1000;
        scene.add(dimLine);
        newObjects.push(dimLine);

        // Arrowheads at both ends of dimension line (small triangles)
        const arrowSize = 0.12;
        const dirX = dx / len;
        const dirY = dy / len;
        for (const [base, sign] of [[ext1End, 1], [ext2End, -1]] as [THREE.Vector3, number][]) {
          const tipX = base.x + sign * dirX * arrowSize;
          const tipY = base.y + sign * dirY * arrowSize;
          const wing1X = base.x - sign * dirX * 0.02 + perpX * arrowSize * 0.3;
          const wing1Y = base.y - sign * dirY * 0.02 + perpY * arrowSize * 0.3;
          const wing2X = base.x - sign * dirX * 0.02 - perpX * arrowSize * 0.3;
          const wing2Y = base.y - sign * dirY * 0.02 - perpY * arrowSize * 0.3;

          const arrowShape = new THREE.Shape();
          arrowShape.moveTo(tipX, tipY);
          arrowShape.lineTo(wing1X, wing1Y);
          arrowShape.lineTo(wing2X, wing2Y);
          arrowShape.closePath();
          const arrowGeo = new THREE.ShapeGeometry(arrowShape);
          const arrowMat = new THREE.MeshBasicMaterial({ color: dimColor, depthTest: false });
          const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
          arrowMesh.renderOrder = 1001;
          scene.add(arrowMesh);
          newObjects.push(arrowMesh);
        }

        // Value text sprite at midpoint of dimension line
        const dimMidX = (ext1End.x + ext2End.x) / 2;
        const dimMidY = (ext1End.y + ext2End.y) / 2;
        const dimMidZ = (ext1End.z + ext2End.z) / 2;
        const valueText = constraint.value.toFixed(2);
        const isDimSelected = constraint.id === selectedConstraintId;
        const valueSprite = createConstraintGlyph(valueText, new THREE.Vector3(dimMidX, dimMidY + 0.2, dimMidZ), isDimSelected);
        valueSprite.userData.constraintId = constraint.id;
        valueSprite.userData.isConstraintGlyph = true;
        valueSprite.scale.set(0.4, 0.4, 0.4);
        scene.add(valueSprite);
        newObjects.push(valueSprite);
      } else if ((constraint.type === "radius" || constraint.type === "diameter") && isSketchCircle(prim)) {
        // Radius/diameter: show leader line from center to edge with value
        const cp = pointMap.get(prim.centerId);
        if (!cp) continue;

        const edgeX = cp.x + prim.radius;
        const edgeY = cp.y;
        const dimColor = SKETCH_THEME.constraintGlyph;

        const leaderStart = sketchTo3D(cp.x, cp.y, 0.12);
        const leaderEnd = sketchTo3D(edgeX, edgeY, 0.12);
        const leader = createLine2FromPoints(
          [leaderStart.x, leaderStart.y, leaderStart.z, leaderEnd.x, leaderEnd.y, leaderEnd.z],
          dimColor, 1.0
        );
        leader.renderOrder = 1000;
        scene.add(leader);
        newObjects.push(leader);

        // Value label
        const labelPos = sketchTo3D((cp.x + edgeX) / 2, cp.y + 0.25, 0.15);
        const prefix = constraint.type === "radius" ? "R" : "\u2300";
        const isRadDimSelected = constraint.id === selectedConstraintId;
        const valueSprite = createConstraintGlyph(`${prefix}${constraint.value.toFixed(2)}`, labelPos, isRadDimSelected);
        valueSprite.userData.constraintId = constraint.id;
        valueSprite.userData.isConstraintGlyph = true;
        valueSprite.scale.set(0.4, 0.4, 0.4);
        scene.add(valueSprite);
        newObjects.push(valueSprite);
      }
    }

    // ── Tier 5: Closed profile fill detection ──
    // Build adjacency from non-construction lines
    const edges: Array<{ p1: string; p2: string; p1Coords: { x: number; y: number }; p2Coords: { x: number; y: number } }> = [];
    for (const prim of activeSketch.primitives) {
      if (isSketchLine(prim) && !(prim as any).construction) {
        const pt1 = pointMap.get(prim.p1Id);
        const pt2 = pointMap.get(prim.p2Id);
        if (pt1 && pt2) {
          edges.push({ p1: prim.p1Id, p2: prim.p2Id, p1Coords: pt1, p2Coords: pt2 });
        }
      }
    }

    // Simple closed-loop finder: for each edge, try to find a cycle
    if (edges.length >= 3) {
      const adjacency = new Map<string, Array<{ to: string; coords: { x: number; y: number } }>>();
      for (const e of edges) {
        if (!adjacency.has(e.p1)) adjacency.set(e.p1, []);
        if (!adjacency.has(e.p2)) adjacency.set(e.p2, []);
        adjacency.get(e.p1)!.push({ to: e.p2, coords: e.p2Coords });
        adjacency.get(e.p2)!.push({ to: e.p1, coords: e.p1Coords });
      }

      // Find minimal cycles using DFS (simplified approach)
      const foundCycles: string[][] = [];
      const cycleSignatures = new Set<string>();

      for (const startNode of adjacency.keys()) {
        const stack: Array<{ node: string; path: string[] }> = [{ node: startNode, path: [startNode] }];
        while (stack.length > 0) {
          const { node, path } = stack.pop()!;
          if (path.length > 10) continue; // Limit cycle length

          const neighbors = adjacency.get(node) || [];
          for (const { to: neighbor } of neighbors) {
            if (neighbor === startNode && path.length >= 3) {
              // Found a cycle
              const sorted = [...path].sort().join(",");
              if (!cycleSignatures.has(sorted)) {
                cycleSignatures.add(sorted);
                foundCycles.push([...path]);
              }
            } else if (!path.includes(neighbor)) {
              stack.push({ node: neighbor, path: [...path, neighbor] });
            }
          }
        }
      }

      // Render each detected closed profile with translucent fill
      for (const cycle of foundCycles) {
        const shapePoints: THREE.Vector2[] = [];
        for (const ptId of cycle) {
          const coords = pointMap.get(ptId);
          if (coords) {
            shapePoints.push(new THREE.Vector2(coords.x, coords.y));
          }
        }
        if (shapePoints.length >= 3) {
          // Check area to filter out degenerate/outer-boundary cycles
          let area = 0;
          for (let i = 0; i < shapePoints.length; i++) {
            const j = (i + 1) % shapePoints.length;
            area += shapePoints[i].x * shapePoints[j].y;
            area -= shapePoints[j].x * shapePoints[i].y;
          }
          area = Math.abs(area) / 2;
          if (area < 0.01) continue; // Skip tiny areas

          const shape = new THREE.Shape(shapePoints);
          const shapeGeometry = new THREE.ShapeGeometry(shape);
          const shapeMaterial = new THREE.MeshBasicMaterial({
            color: SKETCH_THEME.profileFill,
            transparent: true,
            opacity: SKETCH_THEME.profileFillOpacity,
            depthTest: false,
            side: THREE.DoubleSide,
          });
          const shapeMesh = new THREE.Mesh(shapeGeometry, shapeMaterial);
          // Position on the sketch plane using quaternion from normal
          const quat = new THREE.Quaternion();
          quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), activeSketch.plane.normal);
          shapeMesh.quaternion.copy(quat);
          shapeMesh.position.copy(activeSketch.plane.origin);
          shapeMesh.renderOrder = 997;
          scene.add(shapeMesh);
          newObjects.push(shapeMesh);
        }
      }
    }

    sketchObjectsRef.current = newObjects;
  }, [activeSketch, scene, sceneReady, selectedPrimitives, sketchSubMode, selectedConstraintId]);

  // Update LineMaterial resolution on window resize for correct line widths
  useEffect(() => {
    if (mode !== "sketch") return;

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      sketchObjectsRef.current.forEach((obj) => {
        if (obj instanceof Line2) {
          (obj.material as LineMaterial).resolution.set(w, h);
        }
      });
      guidelineObjectsRef.current.forEach((obj) => {
        if (obj instanceof Line2) {
          (obj.material as LineMaterial).resolution.set(w, h);
        }
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [mode]);

  // Clear selection when switching sub-modes or leaving sketch mode
  useEffect(() => {
    if (mode !== "sketch") {
      setSelectedPrimitives([]);
    }
  }, [mode]);

  useEffect(() => {
    // Clear selection when switching to a drawing sub-mode
    if (sketchSubMode !== "select") {
      setSelectedPrimitives([]);
    }
  }, [sketchSubMode]);

  // Cleanup inference objects, grid, and selection planes when leaving sketch mode
  useEffect(() => {
    if (mode !== "sketch") {
      // Cancel any in-flight camera animation
      if (cameraAnimFrameRef.current !== null) {
        cancelAnimationFrame(cameraAnimFrameRef.current);
        cameraAnimFrameRef.current = null;
      }

      cleanupInferenceObjects();
      cleanupSketchGrid();
      removeOffsetPreview();
      removeSelectionPlanes();
      setIsSelectingPlane(false);
      setHoveredPlane(null);
      setCurrentInferencePoint(null);
      setGuidelines([]);

      // Restore dimmed bodies
      restoreSceneBodies();

      // Restore ground plane if sketch mode was the one that hid it
      if (sketchHidGroundPlaneRef.current) {
        toggleGroundPlane();
        sketchHidGroundPlaneRef.current = false;
      }

      // Restore original camera position, orientation, and controls target
      if (camera && originalCameraPositionRef.current && originalCameraUpRef.current) {
        camera.position.copy(originalCameraPositionRef.current);
        camera.up.copy(originalCameraUpRef.current);
        const controls = controlsRef.current;
        if (controls && originalControlsTargetRef.current) {
          controls.target.copy(originalControlsTargetRef.current);
          controls.update();
        }
        camera.lookAt(originalControlsTargetRef.current ?? new THREE.Vector3(0, 0, 0));
        originalCameraPositionRef.current = null;
        originalCameraUpRef.current = null;
        originalControlsTargetRef.current = null;
      }

      // Restore original projection type
      if (originalProjectionRef.current !== null) {
        setProjectionType(originalProjectionRef.current);
        originalProjectionRef.current = null;
      }

      // Re-enable camera rotation when leaving sketch mode
      setCameraRotationEnabled(true);

      // Reset drawing plane to default XY
      setDrawingPlane(new THREE.Vector3(0, 0, 1));
    }
  }, [mode, camera, cleanupInferenceObjects, cleanupSketchGrid, removeOffsetPreview, removeSelectionPlanes, toggleGroundPlane, setCameraRotationEnabled, restoreSceneBodies, setDrawingPlane, setProjectionType]);

  return {
    sketchSubMode,
    setSketchSubMode,
    handleSketchMode,
    handleKeyDown,
    cleanupSketchPreview,
    sketchObjects: sketchObjectsRef.current,
    startNewSketch,
    selectedPrimitives,
    selectPrimitive,
    clearSelection,
    applyConstraint,
    isChaining,
    cancelCurrentOperation,
    currentInferencePoint,
    guidelines,
    // Dimension input after line creation
    pendingLineDimension,
    clearPendingLineDimension,
    applyLineLengthConstraint,
    // Context menu for right-click constraints
    contextMenu,
    closeContextMenu,
    applyConstraintToContextMenuPrimitives,
    deleteConstraint,
    // Plane selection (Fusion 360 style)
    isSelectingPlane,
    hoveredPlane,
    enterPlaneSelectionMode,
    cancelPlaneSelection,
    selectPlaneAndStartSketch,
    cleanupSketchGrid,
    handlePlaneSelectionMouseMove,
    handlePlaneSelectionClick,
    setPlaneOffset,
    // Constraint feedback (redundant/conflicting rollback)
    constraintFeedback,
  };
}
