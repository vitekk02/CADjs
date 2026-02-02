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
  isSketchPoint,
  isSketchLine,
  isSketchCircle,
  isSketchArc,
  createSketchPlane,
} from "../types/sketch-types";

export type SketchSubMode = "select" | "line" | "circle" | "arc" | "point";

interface UseSketchModeResult {
  sketchSubMode: SketchSubMode;
  setSketchSubMode: (mode: SketchSubMode) => void;
  handleSketchMode: (event: MouseEvent) => void;
  cleanupSketchPreview: () => void;
  sketchObjects: THREE.Object3D[];
  startNewSketch: () => void;
  selectedPrimitives: string[];
  selectPrimitive: (id: string, addToSelection: boolean) => void;
  clearSelection: () => void;
  applyConstraint: (type: ConstraintType, value?: number) => void;
}

const SNAP_DISTANCE = 0.3;
const POINT_SIZE = 0.15; // Increased for visibility
const MAX_SELECTION = 2; // Maximum primitives that can be selected

// Colors for sketch visualization
const COLORS = {
  underconstrained: 0x00ff00, // Green
  constrained: 0x000000, // Black
  overconstrained: 0xff0000, // Red
  preview: 0x0088ff, // Blue preview
  point: 0xff6600, // Orange points (more visible)
  selected: 0xff9900, // Orange selected
  selectedLine: 0xff6600, // Orange for selected lines
  selectedPoint: 0xffcc00, // Yellow for selected points
};

export function useSketchMode(): UseSketchModeResult {
  const {
    activeSketch,
    addPrimitive,
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
    sceneReady,
  } = useCadVisualizer();

  const [sketchSubMode, setSketchSubMode] = useState<SketchSubMode>("line");
  const [selectedPrimitives, setSelectedPrimitives] = useState<string[]>([]);
  const sketchObjectsRef = useRef<THREE.Object3D[]>([]);

  // Drawing state refs
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const previewObjectRef = useRef<THREE.Object3D | null>(null);
  const centerPointRef = useRef<THREE.Vector3 | null>(null); // For circle/arc
  const idCounterRef = useRef(0);

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

  // Handle line drawing
  const handleLineDraw = useCallback(
    (event: MouseEvent, point: THREE.Vector3) => {
      if (event.type === "mousedown") {
        isDrawingRef.current = true;
        startPointRef.current = point.clone();
      } else if (event.type === "mousemove") {
        if (!isDrawingRef.current || !startPointRef.current) return;

        cleanupSketchPreview();
        const preview = createLinePreview(startPointRef.current, point);
        if (scene) {
          scene.add(preview);
          previewObjectRef.current = preview;
        }
      } else if (event.type === "mouseup") {
        if (!isDrawingRef.current || !startPointRef.current) return;

        cleanupSketchPreview();

        // Create line primitive
        const p1Id = getOrCreatePoint(startPointRef.current);
        const p2Id = getOrCreatePoint(point);

        const line: SketchLine = {
          id: generateId("ln"),
          type: "line",
          p1Id,
          p2Id,
        };
        addPrimitive(line);

        // Solve after adding
        solveSketch();

        isDrawingRef.current = false;
        startPointRef.current = null;
      }
    },
    [
      scene,
      cleanupSketchPreview,
      createLinePreview,
      getOrCreatePoint,
      addPrimitive,
      solveSketch,
      generateId,
    ]
  );

  // Handle circle drawing
  const handleCircleDraw = useCallback(
    (event: MouseEvent, point: THREE.Vector3) => {
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

          solveSketch();
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

  // Handle arc drawing (3-click: center, start, end)
  const arcStepRef = useRef<number>(0);
  const arcStartPointRef = useRef<THREE.Vector3 | null>(null);

  const handleArcDraw = useCallback(
    (event: MouseEvent, point: THREE.Vector3) => {
      if (event.type === "mousedown") {
        if (arcStepRef.current === 0) {
          // First click: center
          centerPointRef.current = point.clone();
          arcStepRef.current = 1;
        } else if (arcStepRef.current === 1) {
          // Second click: start point
          arcStartPointRef.current = point.clone();
          arcStepRef.current = 2;
        } else if (arcStepRef.current === 2) {
          // Third click: end point
          cleanupSketchPreview();

          if (centerPointRef.current && arcStartPointRef.current) {
            const centerId = getOrCreatePoint(centerPointRef.current);
            const startId = getOrCreatePoint(arcStartPointRef.current);
            const endId = getOrCreatePoint(point);
            const radius = centerPointRef.current.distanceTo(
              arcStartPointRef.current
            );

            const arc: SketchArc = {
              id: generateId("arc"),
              type: "arc",
              centerId,
              startId,
              endId,
              radius,
            };
            addPrimitive(arc);

            solveSketch();
          }

          // Reset
          arcStepRef.current = 0;
          centerPointRef.current = null;
          arcStartPointRef.current = null;
        }
      } else if (event.type === "mousemove") {
        cleanupSketchPreview();

        if (arcStepRef.current === 1 && centerPointRef.current) {
          // Show radius preview
          const preview = createLinePreview(centerPointRef.current, point);
          if (scene) {
            scene.add(preview);
            previewObjectRef.current = preview;
          }
        } else if (
          arcStepRef.current === 2 &&
          centerPointRef.current &&
          arcStartPointRef.current
        ) {
          // Show arc preview
          const preview = createArcPreview(
            centerPointRef.current,
            arcStartPointRef.current,
            point
          );
          if (scene) {
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
      createArcPreview,
      getOrCreatePoint,
      addPrimitive,
      solveSketch,
      generateId,
    ]
  );

  // Handle point creation
  const handlePointDraw = useCallback(
    (event: MouseEvent, point: THREE.Vector3) => {
      if (event.type === "mousedown") {
        const newPoint: SketchPoint = {
          id: generateId("pt"),
          type: "point",
          x: point.x,
          y: point.y,
          fixed: false,
        };
        addPrimitive(newPoint);
        solveSketch();
      }
    },
    [addPrimitive, solveSketch, generateId]
  );

  // Selection functions
  const selectPrimitive = useCallback(
    (id: string, addToSelection: boolean) => {
      setSelectedPrimitives((prev) => {
        if (addToSelection) {
          // Shift+click: add to selection (max 2)
          if (prev.includes(id)) {
            // Already selected, deselect it
            return prev.filter((p) => p !== id);
          }
          if (prev.length >= MAX_SELECTION) {
            // Max selection reached, replace the second one
            return [prev[0], id];
          }
          return [...prev, id];
        } else {
          // Regular click: select only this one
          if (prev.length === 1 && prev[0] === id) {
            // Clicking the same element, deselect
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
  }, []);

  // Apply constraint to selected primitives
  const applyConstraint = useCallback(
    async (type: ConstraintType, value?: number) => {
      if (selectedPrimitives.length === 0) {
        console.warn("No primitives selected for constraint");
        return;
      }

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
    [selectedPrimitives, generateId, addConstraintAndSolve, clearSelection]
  );

  // Handle select mode - raycast to find clicked primitive
  const handleSelectMode = useCallback(
    (event: MouseEvent) => {
      if (event.type !== "mousedown") return;
      if (!renderer || !camera || !scene) return;

      // Calculate mouse position in normalized device coordinates
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      // Create raycaster
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // Get sketch objects
      const objects = sketchObjectsRef.current;
      if (objects.length === 0) {
        clearSelection();
        return;
      }

      // Intersect with sketch objects
      const intersects = raycaster.intersectObjects(objects, true);

      if (intersects.length > 0) {
        // Find the first intersected object with a primitiveId
        for (const intersect of intersects) {
          let obj: THREE.Object3D | null = intersect.object;
          while (obj) {
            if (obj.userData.primitiveId) {
              const primitiveId = obj.userData.primitiveId as string;
              const addToSelection = event.shiftKey;
              selectPrimitive(primitiveId, addToSelection);
              return;
            }
            obj = obj.parent;
          }
        }
      }

      // Clicked on empty space, clear selection (unless shift is held)
      if (!event.shiftKey) {
        clearSelection();
      }
    },
    [renderer, camera, scene, selectPrimitive, clearSelection]
  );

  // Main event handler
  const handleSketchMode = useCallback(
    (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (mode !== "sketch") return;

      let point = getMouseIntersection(event);
      if (!point) return;

      point = snapToGrid(point);

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
          handleSelectMode(event);
          break;
      }
    },
    [
      mode,
      sketchSubMode,
      getMouseIntersection,
      snapToGrid,
      handleLineDraw,
      handleCircleDraw,
      handleArcDraw,
      handlePointDraw,
      handleSelectMode,
    ]
  );

  // Start a new sketch on XY plane
  const startNewSketch = useCallback(() => {
    const plane = createSketchPlane("XY");
    startSketch(plane);
  }, [startSketch]);

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

    // Get point positions
    const getPointPosition = (pointId: string): THREE.Vector3 | null => {
      const point = activeSketch.primitives.find(
        (p) => p.id === pointId && isSketchPoint(p)
      ) as SketchPoint | undefined;
      if (point) {
        return new THREE.Vector3(point.x, point.y, 0);
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
        mesh.position.set(primitive.x, primitive.y, 0.1);
        mesh.renderOrder = 999;
        mesh.userData = { primitiveId: primitive.id, type: "point", isSketchPrimitive: true };
        scene.add(mesh);
        newObjects.push(mesh);
      } else if (isSketchLine(primitive)) {
        const p1 = getPointPosition(primitive.p1Id);
        const p2 = getPointPosition(primitive.p2Id);
        if (p1 && p2) {
          // Render line as a tube/cylinder for better visibility
          p1.z = 0.05;
          p2.z = 0.05;

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
        const center = getPointPosition(primitive.centerId);
        if (center) {
          const segments = 64;
          const points: THREE.Vector3[] = [];
          for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push(
              new THREE.Vector3(
                center.x + Math.cos(angle) * primitive.radius,
                center.y + Math.sin(angle) * primitive.radius,
                0.01 // Z offset
              )
            );
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

  return {
    sketchSubMode,
    setSketchSubMode,
    handleSketchMode,
    cleanupSketchPreview,
    sketchObjects: sketchObjectsRef.current,
    startNewSketch,
    selectedPrimitives,
    selectPrimitive,
    clearSelection,
    applyConstraint,
  };
}
