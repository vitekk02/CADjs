import { useCallback, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import {
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  SketchPrimitive,
  SketchConstraint,
  ConstraintType,
  SketchPlaneType,
  isSketchPoint,
  isSketchLine,
  isSketchCircle,
  isSketchArc,
  createSketchPlane,
} from "../types/sketch-types";
import { useSketchInference, InferencePoint, Guideline } from "./useSketchInference";

export type SketchSubMode = "select" | "line" | "circle" | "arc" | "point" | "dimension";

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
  // Plane selection (Fusion 360 style)
  isSelectingPlane: boolean;
  hoveredPlane: SketchPlaneType | null;
  enterPlaneSelectionMode: () => void;
  cancelPlaneSelection: () => void;
  selectPlaneAndStartSketch: (planeType: SketchPlaneType) => void;
  cleanupSketchGrid: () => void;
  handlePlaneSelectionMouseMove: (event: MouseEvent) => void;
  handlePlaneSelectionClick: (event: MouseEvent) => void;
}

/**
 * Configuration constants for sketch mode behavior.
 * All distance values are in world units.
 */
const SKETCH_CONFIG = {
  /** Distance in world units to snap to existing points when drawing */
  SNAP_DISTANCE: 0.3,
  /** Visual size of point primitives in world units */
  POINT_SIZE: 0.15,
  /** Maximum number of primitives that can be selected at once */
  MAX_SELECTION: 2,
  /** Distance in world units to snap to inference points (endpoints, midpoints, etc.) */
  INFERENCE_SNAP_DISTANCE: 0.4,
  /** Tolerance in radians for detecting horizontal/vertical alignment (~8.6 degrees) */
  ALIGNMENT_TOLERANCE: 0.15,
  /** Time threshold in milliseconds for detecting double-click */
  DOUBLE_CLICK_THRESHOLD: 300,
} as const;

/** Colors for sketch visualization (hex values) */
const COLORS = {
  /** Under-constrained geometry (needs more constraints) */
  underconstrained: 0x00ff00, // Green
  /** Fully constrained geometry */
  constrained: 0x000000, // Black
  /** Over-constrained geometry (conflicting constraints) */
  overconstrained: 0xff0000, // Red
  /** Preview while drawing */
  preview: 0x0088ff, // Blue
  /** Point primitives */
  point: 0xff6600, // Orange
  /** Selected elements */
  selected: 0xff9900, // Orange
  /** Selected line primitives */
  selectedLine: 0xff6600, // Orange
  /** Selected point primitives */
  selectedPoint: 0xffcc00, // Yellow
} as const;

export function useSketchMode(): UseSketchModeResult {
  const {
    activeSketch,
    addPrimitive,
    updatePrimitive,
    updatePrimitivesAndSolve,
    addConstraintAndSolve,
    startSketch,
    solveSketch,
    mode,
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

  // Drawing state refs
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const previewObjectRef = useRef<THREE.Object3D | null>(null);
  const centerPointRef = useRef<THREE.Vector3 | null>(null); // For circle/arc
  const idCounterRef = useRef(0);

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
      return raycasterRef.current.intersectObjects(objects, recursive);
    },
    [renderer, camera]
  );

  // Click-to-click line chaining state
  const [isChaining, setIsChaining] = useState(false);
  const chainStartPointRef = useRef<THREE.Vector3 | null>(null);
  const chainStartPointIdRef = useRef<string | null>(null);
  const lastClickTimeRef = useRef<number>(0);

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

  // Plane selection state (Fusion 360 style)
  const [isSelectingPlane, setIsSelectingPlane] = useState(false);
  const [hoveredPlane, setHoveredPlane] = useState<SketchPlaneType | null>(null);
  const planeObjectsRef = useRef<THREE.Object3D[]>([]);

  // Drag-to-move state for primitives
  const isDraggingRef = useRef(false);
  const dragStartPointRef = useRef<THREE.Vector3 | null>(null);
  const draggedPrimitiveIdsRef = useRef<string[]>([]);
  const dragOriginalPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Ref to prevent stale closure issues with activeSketch during drag
  const activeSketchRef = useRef(activeSketch);

  // Use config constants
  const { INFERENCE_SNAP_DISTANCE, ALIGNMENT_TOLERANCE, DOUBLE_CLICK_THRESHOLD, SNAP_DISTANCE } = SKETCH_CONFIG;

  // Keep activeSketchRef in sync with activeSketch to avoid stale closures
  useEffect(() => {
    activeSketchRef.current = activeSketch;
  }, [activeSketch]);

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
    (point: THREE.Vector3, fixed: boolean = false): string => {
      const nearbyPoint = findNearbyPoint(point);
      if (nearbyPoint) {
        return nearbyPoint.id;
      }

      const newPoint: SketchPoint = {
        id: generateId("pt"),
        type: "point",
        x: point.x,
        y: point.y,
        fixed,
      };
      addPrimitive(newPoint);
      return newPoint.id;
    },
    [findNearbyPoint, addPrimitive, generateId]
  );

  // Cleanup preview objects
  const cleanupSketchPreview = useCallback(() => {
    if (previewObjectRef.current && scene) {
      scene.remove(previewObjectRef.current);
      if (previewObjectRef.current instanceof THREE.Line) {
        previewObjectRef.current.geometry.dispose();
        (previewObjectRef.current.material as THREE.Material).dispose();
      } else if (previewObjectRef.current instanceof THREE.Mesh) {
        previewObjectRef.current.geometry.dispose();
        (previewObjectRef.current.material as THREE.Material).dispose();
      }
      previewObjectRef.current = null;
    }
  }, [scene]);

  // Cleanup inference visualization objects
  const cleanupInferenceObjects = useCallback(() => {
    if (scene) {
      inferenceObjectsRef.current.forEach((obj) => {
        scene.remove(obj);
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      inferenceObjectsRef.current = [];

      guidelineObjectsRef.current.forEach((obj) => {
        scene.remove(obj);
        if (obj instanceof THREE.Line) {
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
          // Square glyph for endpoints
          geometry = new THREE.BoxGeometry(0.15, 0.15, 0.05);
          color = 0x00ff00; // Green
          break;
        case "midpoint":
          // Triangle glyph for midpoints
          const triangleShape = new THREE.Shape();
          triangleShape.moveTo(0, 0.1);
          triangleShape.lineTo(-0.08, -0.05);
          triangleShape.lineTo(0.08, -0.05);
          triangleShape.lineTo(0, 0.1);
          geometry = new THREE.ShapeGeometry(triangleShape);
          color = 0xffff00; // Yellow
          break;
        case "center":
          // Circle glyph for centers
          geometry = new THREE.CircleGeometry(0.08, 16);
          color = 0xff00ff; // Magenta
          break;
        case "quadrant":
          // Diamond glyph for quadrants
          const diamondShape = new THREE.Shape();
          diamondShape.moveTo(0, 0.08);
          diamondShape.lineTo(-0.08, 0);
          diamondShape.lineTo(0, -0.08);
          diamondShape.lineTo(0.08, 0);
          diamondShape.lineTo(0, 0.08);
          geometry = new THREE.ShapeGeometry(diamondShape);
          color = 0x00ffff; // Cyan
          break;
        case "intersection":
          // X glyph for intersections
          geometry = new THREE.BoxGeometry(0.12, 0.12, 0.05);
          color = 0xff8800; // Orange
          break;
        default:
          geometry = new THREE.CircleGeometry(0.06, 8);
          color = 0xffffff; // White
      }

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(inferencePoint.position);
      mesh.position.z = 0.2; // Above sketch elements
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
        if (obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      guidelineObjectsRef.current = [];

      for (const guideline of currentGuidelines) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          guideline.start,
          guideline.end,
        ]);
        const material = new THREE.LineDashedMaterial({
          color: guideline.color,
          dashSize: 0.1,
          gapSize: 0.05,
          transparent: true,
          opacity: 0.7,
          depthTest: false,
        });
        const line = new THREE.Line(geometry, material);
        line.computeLineDistances(); // Required for dashed lines
        line.renderOrder = 999;

        scene.add(line);
        guidelineObjectsRef.current.push(line);
      }
    },
    [scene]
  );


  // Create line preview
  const createLinePreview = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3): THREE.Line => {
      const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
      const material = new THREE.LineBasicMaterial({
        color: COLORS.preview,
        linewidth: 2,
      });
      return new THREE.Line(geometry, material);
    },
    []
  );

  // Create circle preview
  const createCirclePreview = useCallback(
    (center: THREE.Vector3, radius: number): THREE.Line => {
      const segments = 64;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push(
          new THREE.Vector3(
            center.x + Math.cos(angle) * radius,
            center.y + Math.sin(angle) * radius,
            center.z
          )
        );
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: COLORS.preview,
        linewidth: 2,
      });
      return new THREE.Line(geometry, material);
    },
    []
  );

  // Create arc preview
  const createArcPreview = useCallback(
    (
      center: THREE.Vector3,
      start: THREE.Vector3,
      end: THREE.Vector3
    ): THREE.Line => {
      const radius = center.distanceTo(start);
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

      const segments = 32;
      const points: THREE.Vector3[] = [];
      let angle = startAngle;
      const angleDiff = endAngle - startAngle;
      const normalizedDiff = angleDiff > 0 ? angleDiff : angleDiff + Math.PI * 2;

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const currentAngle = startAngle + normalizedDiff * t;
        points.push(
          new THREE.Vector3(
            center.x + Math.cos(currentAngle) * radius,
            center.y + Math.sin(currentAngle) * radius,
            center.z
          )
        );
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: COLORS.preview,
        linewidth: 2,
      });
      return new THREE.Line(geometry, material);
    },
    []
  );

  // Auto-apply horizontal or vertical constraint if line is nearly aligned
  const autoApplyHVConstraint = useCallback(
    async (lineId: string, p1: THREE.Vector3, p2: THREE.Vector3) => {
      const horizontalTolerance = 0.15; // radians, ~8.6 degrees
      const verticalTolerance = 0.15;

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
        await addConstraintAndSolve(constraint);
        console.log("Auto-applied horizontal constraint to line", lineId);
        return true;
      }

      // Check for vertical (angle near π/2 or -π/2)
      if (Math.abs(angle - Math.PI / 2) < verticalTolerance || Math.abs(angle + Math.PI / 2) < verticalTolerance) {
        const constraint: SketchConstraint = {
          id: generateId("const"),
          type: "vertical",
          primitiveIds: [lineId],
          driving: true,
        };
        await addConstraintAndSolve(constraint);
        console.log("Auto-applied vertical constraint to line", lineId);
        return true;
      }

      return false;
    },
    [generateId, addConstraintAndSolve]
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
            lastClickTimeRef.current = 0;
            return;
          }
        }

        lastClickTimeRef.current = now;

        if (!isChaining) {
          // First click: start the chain
          chainStartPointRef.current = point.clone();
          chainStartPointIdRef.current = getOrCreatePoint(point);
          setIsChaining(true);
        } else if (chainStartPointRef.current) {
          // Subsequent click: create line and continue chain
          const startPoint = chainStartPointRef.current.clone();
          const p2Id = getOrCreatePoint(point);

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

            // Auto-apply H/V constraint if nearly aligned
            await autoApplyHVConstraint(lineId, startPoint, point);

            await solveSketch();

            // Set pending line dimension for dimension input
            const lineLength = startPoint.distanceTo(point);
            const midpoint = new THREE.Vector3()
              .addVectors(startPoint, point)
              .multiplyScalar(0.5);
            setPendingLineDimension({
              lineId,
              p1: startPoint.clone(),
              p2: point.clone(),
              length: lineLength,
              midpoint,
            });

            // Continue chain from the new point
            chainStartPointRef.current = point.clone();
            chainStartPointIdRef.current = p2Id;
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
          const centerId = getOrCreatePoint(centerPointRef.current);

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

  // Create 3-point arc preview
  const create3PointArcPreview = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3, bulge: THREE.Vector3): THREE.Line | null => {
      const result = calculateArcFromThreePoints(start, end, bulge);
      if (!result) {
        // Fallback to line preview if points are collinear
        const geometry = new THREE.BufferGeometry().setFromPoints([start, bulge, end]);
        const material = new THREE.LineBasicMaterial({ color: COLORS.preview, linewidth: 2 });
        return new THREE.Line(geometry, material);
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
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = startAngle + sweepAngle * t;
        points.push(
          new THREE.Vector3(
            center.x + Math.cos(angle) * radius,
            center.y + Math.sin(angle) * radius,
            0
          )
        );
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: COLORS.preview, linewidth: 2 });
      return new THREE.Line(geometry, material);
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
              const { center, radius } = result;
              const centerId = getOrCreatePoint(center);
              const startId = getOrCreatePoint(arcStartPointRef.current);
              const endId = getOrCreatePoint(arcEndPointRef.current);

              const arc: SketchArc = {
                id: generateId("arc"),
                type: "arc",
                centerId,
                startId,
                endId,
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
    ]
  );

  // Handle point creation
  const handlePointDraw = useCallback(
    async (event: MouseEvent, point: THREE.Vector3) => {
      if (event.type === "mousedown") {
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
    [addPrimitive, solveSketch, generateId]
  );

  // Cancel current drawing operation (Escape key)
  const cancelCurrentOperation = useCallback(() => {
    cleanupSketchPreview();

    // Reset line chaining
    if (isChaining) {
      setIsChaining(false);
      chainStartPointRef.current = null;
      chainStartPointIdRef.current = null;
      lastClickTimeRef.current = 0;
    }

    // Reset circle drawing
    isDrawingRef.current = false;
    centerPointRef.current = null;

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

  // Orient camera to face a plane (for sketching)
  const orientCameraToPlane = useCallback(
    (planeType: SketchPlaneType) => {
      if (!camera) return;

      const distance = 15;
      const duration = 500; // Animation duration in ms

      // Calculate target camera position based on plane
      let targetPosition: THREE.Vector3;
      let targetUp: THREE.Vector3;

      switch (planeType) {
        case "XY":
          // Looking at XY plane from +Z (front view in standard convention)
          targetPosition = new THREE.Vector3(0, 0, distance);
          targetUp = new THREE.Vector3(0, 1, 0);
          break;
        case "XZ":
          // Looking at XZ plane from +Y (top view)
          targetPosition = new THREE.Vector3(0, distance, 0);
          targetUp = new THREE.Vector3(0, 0, -1);
          break;
        case "YZ":
          // Looking at YZ plane from +X (right/side view)
          targetPosition = new THREE.Vector3(distance, 0, 0);
          targetUp = new THREE.Vector3(0, 1, 0);
          break;
      }

      // Animate camera position
      const startPosition = camera.position.clone();
      const startUp = camera.up.clone();
      const startTime = Date.now();

      const animateCamera = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3);

        camera.position.lerpVectors(startPosition, targetPosition, eased);
        camera.up.lerpVectors(startUp, targetUp, eased);
        camera.lookAt(0, 0, 0);

        if (t < 1) {
          requestAnimationFrame(animateCamera);
        }
      };

      animateCamera();
    },
    [camera]
  );

  // Position camera at isometric view to see all 3 planes
  const positionCameraForPlaneSelection = useCallback(() => {
    if (!camera) return;

    // Save original camera position
    originalCameraPositionRef.current = camera.position.clone();
    originalCameraUpRef.current = camera.up.clone();

    const distance = 12;
    const duration = 400;

    // Isometric-like view position (can see all 3 planes)
    const targetPosition = new THREE.Vector3(distance * 0.7, distance * 0.5, distance * 0.7);
    const targetUp = new THREE.Vector3(0, 1, 0);

    const startPosition = camera.position.clone();
    const startUp = camera.up.clone();
    const startTime = Date.now();

    const animateCamera = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);

      camera.position.lerpVectors(startPosition, targetPosition, eased);
      camera.up.lerpVectors(startUp, targetUp, eased);
      camera.lookAt(0, 0, 0);

      if (t < 1) {
        requestAnimationFrame(animateCamera);
      }
    };

    animateCamera();
  }, [camera]);

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
      color: 0x4488ff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(xyMaterial);
    const xyPlane = new THREE.Mesh(xyGeometry, xyMaterial);
    xyPlane.position.set(halfSize, halfSize, 0); // Position to form corner
    xyPlane.userData.planeType = "XY";
    xyPlane.userData.baseColor = 0x4488ff;
    xyPlane.userData.baseOpacity = 0.5;
    planesGroup.add(xyPlane);

    // XZ plane (Green - Top face) - positioned at positive Y
    const xzGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
    geometries.push(xzGeometry);
    const xzMaterial = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
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
    xzPlane.userData.baseColor = 0x44ff88;
    xzPlane.userData.baseOpacity = 0.5;
    planesGroup.add(xzPlane);

    // YZ plane (Red - Right face) - positioned at positive X
    const yzGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
    geometries.push(yzGeometry);
    const yzMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6644,
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
    yzPlane.userData.baseColor = 0xff6644;
    yzPlane.userData.baseOpacity = 0.5;
    planesGroup.add(yzPlane);

    // Add wireframe edges to make it look more like a cube
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    materials.push(edgeMaterial);

    // Edge along X axis (from origin)
    const xEdgeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(planeSize, 0, 0),
    ]);
    geometries.push(xEdgeGeometry);
    const xEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xff4444 });
    materials.push(xEdgeMaterial);
    const xEdge = new THREE.Line(xEdgeGeometry, xEdgeMaterial);
    planesGroup.add(xEdge);

    // Edge along Y axis (from origin)
    const yEdgeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, planeSize, 0),
    ]);
    geometries.push(yEdgeGeometry);
    const yEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x44ff44 });
    materials.push(yEdgeMaterial);
    const yEdge = new THREE.Line(yEdgeGeometry, yEdgeMaterial);
    planesGroup.add(yEdge);

    // Edge along Z axis (from origin)
    const zEdgeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, planeSize),
    ]);
    geometries.push(zEdgeGeometry);
    const zEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x4488ff });
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
    const originMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
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

  // Create grid on the selected plane
  const createSketchGrid = useCallback(
    (planeType: SketchPlaneType) => {
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

      const gridSize = 20;
      const gridDivisions = 40;

      // Create grid lines manually for proper plane orientation
      const step = gridSize / gridDivisions;
      const halfSize = gridSize / 2;

      // Grid line material
      const gridMaterial = new THREE.LineBasicMaterial({ color: 0x555555 });

      const gridPoints: THREE.Vector3[] = [];

      switch (planeType) {
        case "XY":
          // Grid on XY plane (Z=0)
          for (let i = -halfSize; i <= halfSize; i += step) {
            // Vertical lines (parallel to Y)
            gridPoints.push(new THREE.Vector3(i, -halfSize, 0));
            gridPoints.push(new THREE.Vector3(i, halfSize, 0));
            // Horizontal lines (parallel to X)
            gridPoints.push(new THREE.Vector3(-halfSize, i, 0));
            gridPoints.push(new THREE.Vector3(halfSize, i, 0));
          }
          break;
        case "XZ":
          // Grid on XZ plane (Y=0)
          for (let i = -halfSize; i <= halfSize; i += step) {
            // Lines parallel to Z
            gridPoints.push(new THREE.Vector3(i, 0, -halfSize));
            gridPoints.push(new THREE.Vector3(i, 0, halfSize));
            // Lines parallel to X
            gridPoints.push(new THREE.Vector3(-halfSize, 0, i));
            gridPoints.push(new THREE.Vector3(halfSize, 0, i));
          }
          break;
        case "YZ":
          // Grid on YZ plane (X=0)
          for (let i = -halfSize; i <= halfSize; i += step) {
            // Lines parallel to Z
            gridPoints.push(new THREE.Vector3(0, i, -halfSize));
            gridPoints.push(new THREE.Vector3(0, i, halfSize));
            // Lines parallel to Y
            gridPoints.push(new THREE.Vector3(0, -halfSize, i));
            gridPoints.push(new THREE.Vector3(0, halfSize, i));
          }
          break;
      }

      const gridGeometry = new THREE.BufferGeometry().setFromPoints(gridPoints);
      const gridLines = new THREE.LineSegments(gridGeometry, gridMaterial);
      gridGroup.add(gridLines);

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
  const handlePlaneSelectionMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isSelectingPlane || !selectionPlanesRef.current) return;

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
        material.color.setHex(0xffff44); // Bright yellow on hover
        material.opacity = 0.8;
        setHoveredPlane(hitPlane.userData.planeType as SketchPlaneType);
      } else {
        setHoveredPlane(null);
      }
    },
    [isSelectingPlane, raycastToObjects]
  );

  // Handle click during plane selection
  const handlePlaneSelectionClick = useCallback(
    (event: MouseEvent) => {
      if (!isSelectingPlane || !selectionPlanesRef.current) return;

      // Get plane meshes
      const planes = selectionPlanesRef.current.children.filter(
        (child) => child instanceof THREE.Mesh && child.userData.planeType
      ) as THREE.Mesh[];

      const intersects = raycastToObjects(event, planes, false);

      if (intersects.length > 0) {
        const hitPlane = intersects[0].object as THREE.Mesh;
        const planeType = hitPlane.userData.planeType as SketchPlaneType;
        selectPlaneAndStartSketch(planeType);
      }
    },
    [isSelectingPlane, raycastToObjects]
  );

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
    removeSelectionPlanes();

    // Restore original camera position
    if (camera && originalCameraPositionRef.current && originalCameraUpRef.current) {
      camera.position.copy(originalCameraPositionRef.current);
      camera.up.copy(originalCameraUpRef.current);
      camera.lookAt(0, 0, 0);
    }
  }, [camera, removeSelectionPlanes]);

  // Select a plane and start sketch
  const selectPlaneAndStartSketch = useCallback(
    (planeType: SketchPlaneType) => {
      // Exit plane selection mode
      setIsSelectingPlane(false);
      setHoveredPlane(null);
      removeSelectionPlanes();

      // Hide the default ground plane to prevent overlap with sketch grid
      if (showGroundPlane) {
        toggleGroundPlane();
      }

      // Disable camera rotation in sketch mode (only allow pan/zoom)
      setCameraRotationEnabled(false);

      // Orient camera to the plane
      orientCameraToPlane(planeType);

      // Create grid on the plane
      createSketchGrid(planeType);

      // Start sketch on selected plane
      const plane = createSketchPlane(planeType);
      startSketch(plane);
    },
    [removeSelectionPlanes, orientCameraToPlane, createSketchGrid, startSketch, showGroundPlane, toggleGroundPlane, setCameraRotationEnabled]
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

        case "s":
          // S: Select tool
          cancelCurrentOperation();
          setSketchSubMode("select");
          event.preventDefault();
          break;
      }
    },
    [mode, isChaining, isSelectingPlane, cancelCurrentOperation, cancelPlaneSelection, setSketchSubMode]
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
          // Shift+click: add to selection (single primitive)
          if (prev.includes(id)) {
            return prev.filter((p) => p !== id);
          }
          return [...prev, id];
        } else {
          // Regular click: select this primitive and all connected ones
          if (prev.length > 0 && prev.includes(id)) {
            // Clicking already selected element, deselect all
            return [];
          }
          // Select the connected shape
          return findConnectedPrimitives(id);
        }
      });
    },
    [findConnectedPrimitives]
  );

  const clearSelection = useCallback(() => {
    setSelectedPrimitives([]);
  }, []);

  // Apply constraint to selected primitives
  const applyConstraint = useCallback(
    async (type: ConstraintType, value?: number) => {
      if (selectedPrimitives.length === 0 || !activeSketch) {
        console.warn("No primitives selected for constraint");
        return;
      }

      // Get the actual primitive objects for type checking
      const getPrimitive = (id: string) => activeSketch.primitives.find(p => p.id === id);

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
          await addConstraintAndSolve(constraint);
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
          await addConstraintAndSolve(constraint);
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
          await addConstraintAndSolve(constraint);
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
          await addConstraintAndSolve(constraint);
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
        await addConstraintAndSolve(constraint);
      }

      clearSelection();
    },
    [selectedPrimitives, activeSketch, generateId, addConstraintAndSolve, clearSelection]
  );

  // Clear pending line dimension (called when user cancels or submits)
  const clearPendingLineDimension = useCallback(() => {
    setPendingLineDimension(null);
  }, []);

  // Apply length constraint to a specific line
  const applyLineLengthConstraint = useCallback(
    async (lineId: string, length: number) => {
      const constraint: SketchConstraint = {
        id: generateId("const"),
        type: "distance",
        primitiveIds: [lineId],
        value: length,
        driving: true,
      };
      console.log("Applying length constraint to line:", lineId, "length:", length);
      await addConstraintAndSolve(constraint);
      clearPendingLineDimension();
    },
    [generateId, addConstraintAndSolve, clearPendingLineDimension]
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

  // Apply constraint to primitives from context menu
  const applyConstraintToContextMenuPrimitives = useCallback(
    async (type: ConstraintType, value?: number) => {
      if (contextMenu.primitiveIds.length === 0) {
        console.warn("No primitives in context menu for constraint");
        closeContextMenu();
        return;
      }

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
          await addConstraintAndSolve(constraint);
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
        await addConstraintAndSolve(constraint);
      }

      closeContextMenu();
    },
    [contextMenu.primitiveIds, generateId, addConstraintAndSolve, closeContextMenu]
  );

  // Handle dragging primitives in select mode
  const handleDragMove = useCallback(
    (event: MouseEvent) => {
      // Use ref to avoid stale closure issues during drag
      const currentSketch = activeSketchRef.current;
      if (!isDraggingRef.current || !dragStartPointRef.current || !currentSketch) return;

      const point = getMouseIntersection(event);
      if (!point) return;

      // Calculate delta from drag start
      const delta = new THREE.Vector3().subVectors(point, dragStartPointRef.current);

      // Get delta in sketch coordinates based on plane type
      let deltaX: number, deltaY: number;
      switch (currentSketch.plane.type) {
        case "XZ":
          deltaX = delta.x;
          deltaY = delta.z;
          break;
        case "YZ":
          deltaX = delta.y;
          deltaY = delta.z;
          break;
        case "XY":
        default:
          deltaX = delta.x;
          deltaY = delta.y;
          break;
      }

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
    [getMouseIntersection, updatePrimitivesAndSolve]
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

      const point = getMouseIntersection(event);
      if (!point) return;

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

      isDraggingRef.current = true;
      dragStartPointRef.current = point.clone();
      draggedPrimitiveIdsRef.current = pointsToMove;
    },
    [activeSketch, getMouseIntersection, updatePrimitive]
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

      // Use shared raycasting utility
      const intersects = raycastToObjects(event, objects, true);

      if (intersects.length > 0) {
        // Find the first intersected object with a primitiveId
        for (const intersect of intersects) {
          let obj: THREE.Object3D | null = intersect.object;
          while (obj) {
            if (obj.userData.primitiveId) {
              const primitiveId = obj.userData.primitiveId as string;
              const primitiveType = obj.userData.type as string;

              if (isRightClick) {
                // Right-click: open context menu
                // If the primitive is already selected, use all selected primitives
                // Otherwise, use just this primitive
                let primitiveIds: string[];
                let primitiveTypes: string[];

                if (selectedPrimitives.includes(primitiveId)) {
                  // Use all selected primitives
                  primitiveIds = [...selectedPrimitives];
                  primitiveTypes = primitiveIds.map((id) => {
                    const prim = activeSketch?.primitives.find((p) => p.id === id);
                    return prim?.type || "unknown";
                  });
                } else {
                  // Use just the clicked primitive
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

              // Left-click: select primitive or start dragging
              const addToSelection = event.shiftKey;

              // If clicking on already selected primitive, start dragging
              if (selectedPrimitives.includes(primitiveId) && !addToSelection) {
                // Find all connected primitives for dragging (moves the whole shape)
                const connectedPrimitives = findConnectedPrimitives(primitiveId);
                startDrag(event, connectedPrimitives);
                return;
              }

              // Otherwise, select the primitive
              selectPrimitive(primitiveId, addToSelection);
              return;
            }
            obj = obj.parent;
          }
        }
      }

      // Clicked on empty space
      if (isRightClick) {
        // Close context menu on right-click empty space
        closeContextMenu();
      } else if (!event.shiftKey) {
        // Clear selection on left-click empty space (unless shift is held)
        clearSelection();
      }
    },
    [raycastToObjects, selectPrimitive, clearSelection, closeContextMenu, selectedPrimitives, activeSketch, startDrag, handleDragMove, handleDragEnd, findConnectedPrimitives]
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

      // Only handle left-click for drawing
      if (event.button !== 0) return;

      let point = getMouseIntersection(event);
      if (!point) return;

      // Apply grid snapping first
      point = snapToGrid(point);

      // Calculate inference points for snapping
      if (activeSketch && event.type === "mousemove") {
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

      // On mousedown, also check for snap
      if (activeSketch && event.type === "mousedown") {
        const inferencePoints = findInferencePoints(activeSketch);
        const nearestSnap = findNearestSnap(point, inferencePoints, INFERENCE_SNAP_DISTANCE);
        if (nearestSnap) {
          point = nearestSnap.position.clone();
        }
      }

      switch (sketchSubMode) {
        case "line":
          handleLineDraw(event, point);
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
      }
    },
    [
      mode,
      sketchSubMode,
      activeSketch,
      getMouseIntersection,
      snapToGrid,
      handleLineDraw,
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
    ]
  );

  // Render sketch primitives to Three.js objects
  useEffect(() => {
    // Helper to cleanup objects
    const cleanupObjects = () => {
      sketchObjectsRef.current.forEach((obj) => {
        scene?.remove(obj);
        if (obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        } else if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
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

    // Get color based on status
    const getColor = (primitiveId: string) => {
      // Selected primitives get highlight color
      if (selectedPrimitives.includes(primitiveId)) {
        return COLORS.selected;
      }
      // Otherwise use status color
      return activeSketch.status === "fully_constrained"
        ? COLORS.constrained
        : activeSketch.status === "overconstrained"
        ? COLORS.overconstrained
        : COLORS.underconstrained;
    };

    // Convert 2D sketch coordinates to 3D based on plane type
    const sketchTo3D = (x: number, y: number, zOffset: number = 0): THREE.Vector3 => {
      const planeType = activeSketch.plane.type;
      switch (planeType) {
        case "XZ":
          return new THREE.Vector3(x, zOffset, y);
        case "YZ":
          return new THREE.Vector3(zOffset, x, y);
        case "XY":
        default:
          return new THREE.Vector3(x, y, zOffset);
      }
    };

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

    // Render each primitive
    for (const primitive of activeSketch.primitives) {
      const isSelected = selectedPrimitives.includes(primitive.id);
      const color = getColor(primitive.id);

      if (isSketchPoint(primitive)) {
        // Render point as larger sphere for visibility
        const size = isSelected ? 0.25 : 0.2; // Bigger when selected
        const geometry = new THREE.SphereGeometry(size, 16, 16);
        const pointColor = isSelected ? COLORS.selectedPoint : 0xff0000;
        const material = new THREE.MeshBasicMaterial({ color: pointColor });
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
          // Apply plane-aware offset for visibility
          const planeType = activeSketch.plane.type;
          if (planeType === "XZ") {
            p1.y = 0.05;
            p2.y = 0.05;
          } else if (planeType === "YZ") {
            p1.x = 0.05;
            p2.x = 0.05;
          } else {
            p1.z = 0.05;
            p2.z = 0.05;
          }

          // Create a tube geometry for the line (more visible than Line)
          const direction = new THREE.Vector3().subVectors(p2, p1);
          const length = direction.length();
          const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

          const thickness = isSelected ? 0.08 : 0.05; // Thicker when selected
          const tubeGeometry = new THREE.CylinderGeometry(thickness, thickness, length, 8);
          const lineColor = isSelected ? COLORS.selectedLine : 0x00ff00;
          const tubeMaterial = new THREE.MeshBasicMaterial({ color: lineColor });
          const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);

          // Position and rotate the tube
          tube.position.copy(midpoint);
          tube.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.clone().normalize()
          );

          tube.renderOrder = 999;
          tube.userData = { primitiveId: primitive.id, type: "line", isSketchPrimitive: true };
          scene.add(tube);
          newObjects.push(tube);
        } else {
          console.warn("Could not find points for line:", primitive.p1Id, primitive.p2Id);
        }
      } else if (isSketchCircle(primitive)) {
        const centerPt = activeSketch.primitives.find(
          (p) => p.id === primitive.centerId && isSketchPoint(p)
        ) as SketchPoint | undefined;
        if (centerPt) {
          const segments = 64;
          const points: THREE.Vector3[] = [];
          for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const localX = centerPt.x + Math.cos(angle) * primitive.radius;
            const localY = centerPt.y + Math.sin(angle) * primitive.radius;
            points.push(sketchTo3D(localX, localY, 0.01));
          }
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineBasicMaterial({ color, linewidth: 2 });
          const line = new THREE.Line(geometry, material);
          line.renderOrder = 999;
          line.userData = { primitiveId: primitive.id, type: "circle", isSketchPrimitive: true };
          scene.add(line);
          newObjects.push(line);
        } else {
          console.warn("Could not find center for circle:", primitive.centerId);
        }
      } else if (isSketchArc(primitive)) {
        const center = getPointPosition(primitive.centerId);
        const start = getPointPosition(primitive.startId);
        const end = getPointPosition(primitive.endId);
        if (center && start && end) {
          const radius = primitive.radius;
          const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
          const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
          const angleDiff = endAngle - startAngle;
          const normalizedDiff =
            angleDiff > 0 ? angleDiff : angleDiff + Math.PI * 2;

          const segments = 32;
          const arcPoints: THREE.Vector3[] = [];
          for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const currentAngle = startAngle + normalizedDiff * t;
            arcPoints.push(
              new THREE.Vector3(
                center.x + Math.cos(currentAngle) * radius,
                center.y + Math.sin(currentAngle) * radius,
                0.05 // Z offset to avoid z-fighting
              )
            );
          }
          const geometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
          const material = new THREE.LineBasicMaterial({ color, linewidth: 2 });
          const line = new THREE.Line(geometry, material);
          line.userData = { primitiveId: primitive.id, type: "arc", isSketchPrimitive: true };
          scene.add(line);
          newObjects.push(line);
        }
      }
    }

    sketchObjectsRef.current = newObjects;
  }, [activeSketch, scene, sceneReady, selectedPrimitives]);

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
      cleanupInferenceObjects();
      cleanupSketchGrid();
      removeSelectionPlanes();
      setIsSelectingPlane(false);
      setHoveredPlane(null);
      setCurrentInferencePoint(null);
      setGuidelines([]);

      // Restore ground plane if it was hidden
      if (!showGroundPlane) {
        toggleGroundPlane();
      }

      // Re-enable camera rotation when leaving sketch mode
      setCameraRotationEnabled(true);
    }
  }, [mode, cleanupInferenceObjects, cleanupSketchGrid, removeSelectionPlanes, showGroundPlane, toggleGroundPlane, setCameraRotationEnabled]);

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
    // Plane selection (Fusion 360 style)
    isSelectingPlane,
    hoveredPlane,
    enterPlaneSelectionMode,
    cancelPlaneSelection,
    selectPlaneAndStartSketch,
    cleanupSketchGrid,
    handlePlaneSelectionMouseMove,
    handlePlaneSelectionClick,
  };
}
