import React, {
  createContext,
  useContext,
  useState,
  useRef,
  ReactNode,
  useCallback,
} from "react";
import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep, Vertex, Edge, cloneBrep } from "../geometry";
import {
  addElement as addElementOp,
  removeElement as removeElementOp,
  updateElementPosition as updateElementPositionOp,
} from "../scene-operations/element-operations";
import {
  handleSetMode as handleSetModeOp,
  selectElement as selectElementOp,
  deselectElement as deselectElementOp,
} from "../scene-operations/selection-operations";
import { unionSelectedElements as unionSelectedElementsOp } from "../scene-operations/union-operations";
import { differenceSelectedElements as differenceSelectedElementsOp } from "../scene-operations/difference-operations";
import { intersectionSelectedElements as intersectionSelectedElementsOp } from "../scene-operations/intersection-operations";
import { SceneElement, SceneMode, CombineOperationType, BooleanOperationOptions } from "../scene-operations/types";
import {
  createMeshFromBrep,
  createMeshFromGeometry,
  createMeshFromPath,
  getAllFaces,
  getObject,
  getAllObjects,
} from "../scene-operations/mesh-operations";
import { createGeometryFromBRep } from "../convertBRepToGeometry";
import { ungroupSelectedElement } from "../scene-operations/ungroup-operations";
import {
  Sketch,
  SketchPlane,
  SketchPrimitive,
  SketchConstraint,
  FeatureNode,
  OperationType,
  ConstraintResult,
} from "../types/sketch-types";
import {
  countOperationsOfType,
  applyBooleanOperationToTree,
  applyExtrudeToTree,
  applyFilletToTree,
  applySweepToTree,
  applyRevolveToTree,
  applyUngroupToTree,
  renameNode as renameNodeOp,
  removeNodeById as removeNodeByIdOp,
} from "../scene-operations/feature-tree-operations";
import {
  createSketch as createSketchOp,
  addPrimitiveToSketch,
  addConstraintToSketch,
  removePrimitiveFromSketch,
  removeConstraintFromSketch,
} from "../scene-operations/sketch-operations";
import { SketchSolverService } from "../services/SketchSolverService";
import { SketchToBrepService } from "../services/SketchToBrepService";
import { OccWorkerClient } from "../services/OccWorkerClient";
import type { WorkerProcessProfileResult } from "../workers/occ-worker-types";
import { reconstructEdgeGeometry } from "../workers/geometry-reconstruction";
import {
  UndoableSnapshot,
  MAX_UNDO_STEPS,
  MAX_SKETCH_UNDO_STEPS,
} from "../scene-operations/undo-types";
import { ImportExportService } from "../services/ImportExportService";
import { importElements as importElementsOp } from "../scene-operations/import-operations";
import { Measurement } from "../scene-operations/measure-types";
import { disposeMeasureOverlay } from "../scene-operations/measure-operations";

export interface CadCoreContextType {
  elements: SceneElement[];
  selectedElements: string[];
  brepGraph: BrepGraph;
  mode: SceneMode;
  idCounter: number;
  objectsMap: Map<string, THREE.Object3D>;

  setMode: (mode: SceneMode) => void;
  addElement: (brep: Brep, position: THREE.Vector3, object?: THREE.Object3D) => void;
  removeElement: (nodeId: string) => void;
  updateElementPosition: (nodeId: string, position: THREE.Vector3) => void;
  selectElement: (nodeId: string) => void;
  deselectElement: (nodeId: string) => void;
  deselectAll: () => void;
  unionSelectedElements: () => Promise<boolean>;
  differenceSelectedElements: () => Promise<boolean>;
  intersectionSelectedElements: () => Promise<boolean>;
  combineSelectedElements: (opType: CombineOperationType, options: BooleanOperationOptions) => Promise<boolean>;
  updateElementRotation: (nodeId: string, rotation: THREE.Euler) => void;
  getObject: (nodeId: string) => THREE.Object3D | undefined;
  getAllObjects: () => Map<string, THREE.Object3D>;
  createMeshFromBrep: (brep: Brep) => THREE.Object3D;
  ungroupSelectedElement: () => void;
  updateElementBrep: (nodeId: string, brep: Brep, newPosition?: THREE.Vector3, featureUpdate?: { type: OperationType; consumedElementId?: string }, edgeGeometry?: THREE.BufferGeometry, occBrep?: string, faceGeometry?: THREE.BufferGeometry, vertexPositions?: Float32Array) => void;
  loftElements: (profileNodeIds: string[], resultBrep: Brep, resultPosition: THREE.Vector3, edgeGeometry?: THREE.BufferGeometry, occBrep?: string, vertexPositions?: Float32Array, faceGeometry?: THREE.BufferGeometry) => void;
  duplicateSelectedElements: () => void;

  // Sketch-related state and methods
  activeSketch: Sketch | null;
  sketches: Sketch[];
  startSketch: (plane: SketchPlane) => string;
  addPrimitive: (primitive: SketchPrimitive) => void;
  updatePrimitive: (primitiveId: string, updates: Partial<SketchPrimitive>) => void;
  updatePrimitivesAndSolve: (updates: Map<string, { x: number; y: number }>) => Promise<void>;
  addConstraint: (constraint: SketchConstraint) => void;
  addConstraintAndSolve: (constraint: SketchConstraint) => Promise<ConstraintResult>;
  previewConstraint: (constraint: SketchConstraint) => Promise<ConstraintResult>;
  cancelConstraintPreview: () => void;
  commitConstraintPreview: () => void;
  removePrimitive: (primitiveId: string) => void;
  removeConstraint: (constraintId: string) => void;
  finishSketch: () => Promise<boolean>;
  cancelSketch: () => void;
  solveSketch: () => Promise<Sketch | null>;

  // Feature tree state and methods
  featureTree: FeatureNode[];
  toggleNodeVisibility: (nodeId: string) => void;
  toggleNodeExpanded: (nodeId: string) => void;
  renameNode: (nodeId: string, newName: string) => void;
  deleteNode: (nodeId: string) => void;
  sectionExpandedState: Record<string, boolean>;
  toggleSectionExpanded: (sectionId: string) => void;
  originVisibility: Record<string, boolean>;
  toggleOriginVisibility: (id: string) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoActionName: string | null;
  redoActionName: string | null;
  undoStack: UndoableSnapshot[];
  redoStack: UndoableSnapshot[];
  pushUndo: (actionName: string) => void;
  pushSketchUndo: () => void;
  undoSketch: () => void;
  redoSketch: () => void;
  canUndoSketch: boolean;
  canRedoSketch: boolean;

  // Import/Export
  importFile: (file: File) => Promise<void>;
  exportFile: (format: "step" | "stl" | "iges") => Promise<void>;

  // Measurements
  pinnedMeasurements: Measurement[];
  addPinnedMeasurement: (measurement: Measurement) => void;
  removePinnedMeasurement: (id: string) => void;
  clearPinnedMeasurements: () => void;

  // Operation lock
  isOperationPending: boolean;
}

export const CadCoreContext = createContext<CadCoreContextType | undefined>(
  undefined
);

export const CadCoreProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [elements, setElements] = useState<SceneElement[]>([]);
  const [selectedElements, setSelectedElements] = useState<string[]>([]);
  const [brepGraph] = useState<BrepGraph>(new BrepGraph());
  const [mode, setMode] = useState<SceneMode>("move");
  const [idCounter, setIdCounter] = useState(0);
  const [objectsMap] = useState<Map<string, THREE.Object3D>>(new Map());

  // Sketch state
  const [activeSketch, setActiveSketch] = useState<Sketch | null>(null);
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [previousMode, setPreviousMode] = useState<SceneMode>("move");

  // Pinned measurements state
  const [pinnedMeasurements, setPinnedMeasurements] = useState<Measurement[]>([]);

  // Feature tree state
  const [featureTree, setFeatureTree] = useState<FeatureNode[]>([]);
  const [sectionExpandedState, setSectionExpandedState] = useState<Record<string, boolean>>({
    "section-origin": false,
    "section-bodies": true,
    "section-sketches": true,
  });

  // Origin item visibility state
  const [originVisibility, setOriginVisibility] = useState<Record<string, boolean>>({
    "origin-xy": true,
    "origin-xz": true,
    "origin-yz": true,
    "origin-x-axis": true,
    "origin-y-axis": true,
    "origin-z-axis": true,
    "origin-point": true,
  });

  // Ref to track solve operation version to prevent race conditions
  const solveVersionRef = useRef(0);

  // Constraint preview state (snapshot-based preview with debounced solve)
  const previewConstraintSnapshotRef = useRef<Sketch | null>(null);
  const previewVersionRef = useRef(0);

  // Keep a ref to activeSketch for undo/redo (avoids stale closure issues)
  const activeSketchRef = useRef<Sketch | null>(activeSketch);
  activeSketchRef.current = activeSketch;

  // ── Undo/Redo state ──────────────────────────────────────────────
  const undoStackRef = useRef<UndoableSnapshot[]>([]);
  const redoStackRef = useRef<UndoableSnapshot[]>([]);
  const sketchUndoStackRef = useRef<Sketch[]>([]);
  const sketchRedoStackRef = useRef<Sketch[]>([]);
  const [undoRedoVersion, setUndoRedoVersion] = useState(0);
  const isOperationPendingRef = useRef(false);
  const [isOperationPending, setIsOperationPending] = useState(false);

  const setOperationPending = useCallback((pending: boolean) => {
    isOperationPendingRef.current = pending;
    setIsOperationPending(pending);
  }, []);

  const captureSnapshot = useCallback(
    (actionName: string): UndoableSnapshot => ({
      elements: [...elements],
      idCounter,
      featureTree: [...featureTree],
      sketches: [...sketches],
      actionName,
      timestamp: Date.now(),
    }),
    [elements, idCounter, featureTree, sketches]
  );

  const restoreSnapshot = useCallback(
    (snapshot: UndoableSnapshot) => {
      // Clear objectsMap and rebuild meshes from BReps
      const oldEntries = Array.from(objectsMap.entries());
      for (const [, obj] of oldEntries) {
        if (obj.parent) {
          obj.parent.remove(obj);
        }
      }
      objectsMap.clear();

      for (const el of snapshot.elements) {
        let mesh: THREE.Group;
        if (el.elementType === "path" && el.pathData) {
          mesh = createMeshFromPath(el.pathData.points);
        } else if (el.edgeGeometry) {
          const geom = el.faceGeometry ?? createGeometryFromBRep(getAllFaces(el.brep));
          mesh = createMeshFromGeometry(geom, el.edgeGeometry);
        } else {
          mesh = createMeshFromBrep(el.brep);
        }
        mesh.position.copy(el.position);
        if (el.rotation) {
          mesh.rotation.copy(el.rotation);
        }
        mesh.userData.nodeId = el.nodeId;
        objectsMap.set(el.nodeId, mesh);
      }

      // Batch set React state
      setElements(snapshot.elements);
      setIdCounter(snapshot.idCounter);
      setFeatureTree(snapshot.featureTree);
      setSketches(snapshot.sketches);
      setSelectedElements([]);
    },
    [objectsMap]
  );

  const pushUndo = useCallback(
    (actionName: string) => {
      const snapshot = captureSnapshot(actionName);
      undoStackRef.current = [...undoStackRef.current, snapshot];
      if (undoStackRef.current.length > MAX_UNDO_STEPS) {
        undoStackRef.current = undoStackRef.current.slice(
          undoStackRef.current.length - MAX_UNDO_STEPS
        );
      }
      redoStackRef.current = [];
      setUndoRedoVersion((v) => v + 1);
    },
    [captureSnapshot]
  );

  const undo = useCallback(() => {
    if (isOperationPendingRef.current) return;
    if (undoStackRef.current.length === 0) return;

    const snapshot = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);

    // Push current state to redo
    const currentSnapshot = captureSnapshot(snapshot.actionName);
    redoStackRef.current = [...redoStackRef.current, currentSnapshot];

    restoreSnapshot(snapshot);
    setUndoRedoVersion((v) => v + 1);
  }, [captureSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    if (isOperationPendingRef.current) return;
    if (redoStackRef.current.length === 0) return;

    const snapshot = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);

    // Push current state to undo
    const currentSnapshot = captureSnapshot(snapshot.actionName);
    undoStackRef.current = [...undoStackRef.current, currentSnapshot];

    restoreSnapshot(snapshot);
    setUndoRedoVersion((v) => v + 1);
  }, [captureSnapshot, restoreSnapshot]);

  // Sketch-level undo/redo (within active sketch)
  // Uses activeSketchRef to avoid stale closures — these functions are passed
  // through context into useSketchMode callbacks that may hold old references
  const pushSketchUndo = useCallback(() => {
    const sketch = activeSketchRef.current;
    if (!sketch) return;
    sketchUndoStackRef.current = [...sketchUndoStackRef.current, sketch];
    if (sketchUndoStackRef.current.length > MAX_SKETCH_UNDO_STEPS) {
      sketchUndoStackRef.current = sketchUndoStackRef.current.slice(
        sketchUndoStackRef.current.length - MAX_SKETCH_UNDO_STEPS
      );
    }
    sketchRedoStackRef.current = [];
    setUndoRedoVersion((v) => v + 1);
  }, []);

  const undoSketch = useCallback(() => {
    if (sketchUndoStackRef.current.length === 0) return;

    const snapshot = sketchUndoStackRef.current[sketchUndoStackRef.current.length - 1];
    sketchUndoStackRef.current = sketchUndoStackRef.current.slice(0, -1);

    // Push current state to redo
    const current = activeSketchRef.current;
    if (current) {
      sketchRedoStackRef.current = [...sketchRedoStackRef.current, current];
    }

    setActiveSketch(snapshot);
    setUndoRedoVersion((v) => v + 1);
  }, []);

  const redoSketch = useCallback(() => {
    if (sketchRedoStackRef.current.length === 0) return;

    const snapshot = sketchRedoStackRef.current[sketchRedoStackRef.current.length - 1];
    sketchRedoStackRef.current = sketchRedoStackRef.current.slice(0, -1);

    // Push current state to undo
    const current = activeSketchRef.current;
    if (current) {
      sketchUndoStackRef.current = [...sketchUndoStackRef.current, current];
    }

    setActiveSketch(snapshot);
    setUndoRedoVersion((v) => v + 1);
  }, []);

  // Derived undo/redo state (depends on undoRedoVersion to trigger re-renders)
  const canUndo = undoRedoVersion >= 0 && undoStackRef.current.length > 0;
  const canRedo = undoRedoVersion >= 0 && redoStackRef.current.length > 0;
  const undoActionName = canUndo
    ? undoStackRef.current[undoStackRef.current.length - 1].actionName
    : null;
  const redoActionName = canRedo
    ? redoStackRef.current[redoStackRef.current.length - 1].actionName
    : null;
  const canUndoSketch = undoRedoVersion >= 0 && sketchUndoStackRef.current.length > 0;
  const canRedoSketch = undoRedoVersion >= 0 && sketchRedoStackRef.current.length > 0;

  // ─── Pinned measurements ─────────────────────────────────────────
  const addPinnedMeasurement = useCallback((measurement: Measurement) => {
    setPinnedMeasurements((prev) => [...prev, { ...measurement, pinned: true }]);
  }, []);

  const removePinnedMeasurement = useCallback((id: string) => {
    setPinnedMeasurements((prev) => {
      const measurement = prev.find((m) => m.id === id);
      if (measurement) {
        for (const obj of measurement.overlayObjects) {
          disposeMeasureOverlay(obj);
        }
      }
      return prev.filter((m) => m.id !== id);
    });
  }, []);

  const clearPinnedMeasurements = useCallback(() => {
    setPinnedMeasurements((prev) => {
      for (const measurement of prev) {
        for (const obj of measurement.overlayObjects) {
          disposeMeasureOverlay(obj);
        }
      }
      return [];
    });
  }, []);

  const handleSetMode = useCallback(
    (newMode: SceneMode) => {
      // Block mode switch during async operations
      if (isOperationPendingRef.current) return;

      // Block leaving sketch mode without Finish/Cancel
      if (activeSketchRef.current && mode === "sketch" && newMode !== "sketch") return;

      // Save previous mode when entering sketch mode for proper restoration on cancel
      if (newMode === "sketch" && mode !== "sketch") {
        setPreviousMode(mode);
      }
      const result = handleSetModeOp(elements, newMode, objectsMap);
      setElements(result.updatedElements);
      setMode(result.mode);
      setSelectedElements([]);
    },
    [elements, objectsMap, mode]
  );

  // Internal add without undo push (used by finishSketch to avoid double-pushing)
  const addElementInternal = useCallback(
    (brep: Brep, position: THREE.Vector3, object?: THREE.Object3D) => {
      const result = addElementOp(
        elements,
        brep,
        position,
        idCounter,
        objectsMap,
        object
      );

      setElements(result.updatedElements);
      setIdCounter(result.nextId);

      return result.nodeId;
    },
    [elements, idCounter, objectsMap]
  );

  const addElement = useCallback(
    (brep: Brep, position: THREE.Vector3, object?: THREE.Object3D) => {
      pushUndo("Add Shape");
      return addElementInternal(brep, position, object);
    },
    [addElementInternal, pushUndo]
  );

  // Internal remove without undo push (used by deleteNodeImpl to avoid double-pushing)
  // Uses functional updater to avoid stale closure over `elements` — ensures
  // pending state updates (e.g. from updateElementBrep) are not overwritten.
  const removeElementInternal = useCallback(
    (nodeId: string) => {
      setElements((prevElements) => {
        const result = removeElementOp(
          prevElements,
          selectedElements,
          nodeId,
          objectsMap
        );
        setSelectedElements(result.updatedSelectedElements);
        return result.updatedElements;
      });
    },
    [selectedElements, objectsMap]
  );

  const removeElement = useCallback(
    (nodeId: string) => {
      pushUndo("Delete");
      removeElementInternal(nodeId);
    },
    [removeElementInternal, pushUndo]
  );

  const updateElementPosition = useCallback(
    (nodeId: string, position: THREE.Vector3) => {
      const updatedElements = updateElementPositionOp(
        elements,
        nodeId,
        position,
        objectsMap
      );
      setElements(updatedElements);
    },
    [elements, objectsMap]
  );

  const selectElement = useCallback(
    (nodeId: string) => {
      const result = selectElementOp(
        elements,
        selectedElements,
        nodeId,
        objectsMap
      );
      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
    },
    [elements, selectedElements, objectsMap]
  );

  const deselectElement = useCallback(
    (nodeId: string) => {
      const result = deselectElementOp(
        elements,
        selectedElements,
        nodeId,
        objectsMap
      );
      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
    },
    [elements, selectedElements, objectsMap]
  );

  const deselectAll = useCallback(() => {
    const result = handleSetModeOp(elements, mode, objectsMap);
    setElements(result.updatedElements);
    setSelectedElements([]);
  }, [elements, mode, objectsMap]);

  const unionSelectedElementsImpl = useCallback(async (): Promise<boolean> => {
    if (selectedElements.length < 2) return false;

    pushUndo("Union");
    setOperationPending(true);

    try {
      const consumedIds = [...selectedElements];
      const result = await unionSelectedElementsOp(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      if (!result) {
        console.error("Union operation failed");
        // Pop the undo snapshot on failure
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        setUndoRedoVersion((v) => v + 1);
        return false;
      }

      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
      setIdCounter(result.nextIdCounter);

      // Update feature tree
      const newNodeId = `node_${result.nextIdCounter}`;
      setFeatureTree((prev) => {
        const name = `Union ${countOperationsOfType(prev, "union") + 1}`;
        return applyBooleanOperationToTree(prev, consumedIds, newNodeId, "union", name);
      });
      return true;
    } catch (error) {
      console.error("Union error:", error);
      // Pop the undo snapshot on error
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      setUndoRedoVersion((v) => v + 1);
      return false;
    } finally {
      setOperationPending(false);
    }
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap, pushUndo]);

  const differenceSelectedElementsImpl = useCallback(async (): Promise<boolean> => {
    if (selectedElements.length < 2) return false;

    pushUndo("Difference");
    setOperationPending(true);

    try {
      const consumedIds = [...selectedElements];
      const result = await differenceSelectedElementsOp(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      if (!result) {
        console.error("Difference operation failed");
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        setUndoRedoVersion((v) => v + 1);
        return false;
      }

      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
      setIdCounter(result.nextIdCounter);

      // Update feature tree
      const newNodeId = `node_${result.nextIdCounter}`;
      setFeatureTree((prev) => {
        const name = `Difference ${countOperationsOfType(prev, "difference") + 1}`;
        return applyBooleanOperationToTree(prev, consumedIds, newNodeId, "difference", name);
      });
      return true;
    } catch (error) {
      console.error("Difference error:", error);
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      setUndoRedoVersion((v) => v + 1);
      return false;
    } finally {
      setOperationPending(false);
    }
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap, pushUndo]);

  const intersectionSelectedElementsImpl = useCallback(async (): Promise<boolean> => {
    if (selectedElements.length < 2) return false;

    pushUndo("Intersection");
    setOperationPending(true);

    try {
      const consumedIds = [...selectedElements];
      const result = await intersectionSelectedElementsOp(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      if (!result) {
        console.error("Intersection operation failed");
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        setUndoRedoVersion((v) => v + 1);
        return false;
      }

      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
      setIdCounter(result.nextIdCounter);

      // Update feature tree
      const newNodeId = `node_${result.nextIdCounter}`;
      setFeatureTree((prev) => {
        const name = `Intersection ${countOperationsOfType(prev, "intersection") + 1}`;
        return applyBooleanOperationToTree(prev, consumedIds, newNodeId, "intersection", name);
      });
      return true;
    } catch (error) {
      console.error("Intersection error:", error);
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      setUndoRedoVersion((v) => v + 1);
      return false;
    } finally {
      setOperationPending(false);
    }
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap, pushUndo]);

  const combineSelectedElementsImpl = useCallback(async (
    opType: CombineOperationType,
    options: BooleanOperationOptions,
  ): Promise<boolean> => {
    const effectiveSelected = [options.targetId, ...options.toolIds];
    if (effectiveSelected.length < 2) return false;

    const opLabel = opType === "join" ? "Join" : opType === "cut" ? "Cut" : "Intersect";
    pushUndo(opLabel);
    setOperationPending(true);

    try {
      let result;
      if (opType === "join") {
        result = await unionSelectedElementsOp(elements, effectiveSelected, idCounter, brepGraph, objectsMap, options);
      } else if (opType === "cut") {
        result = await differenceSelectedElementsOp(elements, effectiveSelected, idCounter, brepGraph, objectsMap, options);
      } else {
        result = await intersectionSelectedElementsOp(elements, effectiveSelected, idCounter, brepGraph, objectsMap, options);
      }

      if (!result) {
        console.error(`${opLabel} operation failed`);
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        setUndoRedoVersion((v) => v + 1);
        return false;
      }

      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
      setIdCounter(result.nextIdCounter);

      // Update feature tree
      const newNodeId = `node_${result.nextIdCounter}`;
      const featureOpType = opType === "join" ? "union" : opType === "cut" ? "difference" : "intersection";
      const consumedIds = options.keepTools ? [options.targetId] : effectiveSelected;
      setFeatureTree((prev) => {
        const name = `${opLabel} ${countOperationsOfType(prev, featureOpType) + 1}`;
        return applyBooleanOperationToTree(prev, consumedIds, newNodeId, featureOpType, name);
      });
      return true;
    } catch (error) {
      console.error(`${opLabel} error:`, error);
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      setUndoRedoVersion((v) => v + 1);
      return false;
    } finally {
      setOperationPending(false);
    }
  }, [elements, idCounter, brepGraph, objectsMap, pushUndo]);

  const updateElementRotation = useCallback(
    (nodeId: string, rotation: THREE.Euler) => {
      setElements((prevElements) =>
        prevElements.map((element) => {
          if (element.nodeId === nodeId) {
            const obj = getObject(objectsMap, nodeId);
            if (obj) {
              obj.rotation.copy(rotation);
            }
            return { ...element, rotation };
          }
          return element;
        })
      );
    },
    [objectsMap]
  );

  const updateElementBrep = useCallback(
    (nodeId: string, newBrep: Brep, newPosition?: THREE.Vector3, featureUpdate?: { type: OperationType; consumedElementId?: string }, edgeGeometry?: THREE.BufferGeometry, occBrep?: string, faceGeometry?: THREE.BufferGeometry, vertexPositions?: Float32Array) => {
      // Get the existing element to preserve position and rotation
      const existingElement = elements.find((el) => el.nodeId === nodeId);
      if (!existingElement) {
        console.warn(`Element ${nodeId} not found for brep update`);
        return;
      }

      const undoLabel = featureUpdate?.type === "extrude" ? "Extrude"
        : featureUpdate?.type === "difference" ? "Cut"
        : featureUpdate?.type === "fillet" ? "Fillet"
        : featureUpdate?.type === "chamfer" ? "Chamfer"
        : featureUpdate?.type === "sweep" ? "Sweep"
        : featureUpdate?.type === "revolve" ? "Revolve"
        : "Update Shape";
      pushUndo(undoLabel);

      // Use new position if provided, otherwise keep existing
      const position = newPosition || existingElement.position;

      // Create new mesh — use OCC edge geometry if available for clean edge overlay
      let mesh: THREE.Group;
      if (edgeGeometry) {
        let geom: THREE.BufferGeometry;
        if (faceGeometry) {
          // OCC-tessellated geometry (smooth, no internal edges) — used by cut extrude
          geom = faceGeometry;
        } else {
          // Fallback: tessellated BRep → many triangles (may show internal edges)
          const faces = getAllFaces(newBrep);
          geom = createGeometryFromBRep(faces);
        }
        mesh = createMeshFromGeometry(geom, edgeGeometry);
      } else {
        mesh = createMeshFromBrep(newBrep);
      }
      mesh.position.copy(position);
      if (existingElement.rotation) {
        mesh.rotation.copy(existingElement.rotation);
      }
      mesh.userData.nodeId = nodeId;

      // Get old object and remove from scene if it exists
      const oldObj = objectsMap.get(nodeId);
      if (oldObj && oldObj.parent) {
        const parent = oldObj.parent;
        parent.remove(oldObj);
        parent.add(mesh);
      }

      // Update objectsMap with new mesh
      objectsMap.set(nodeId, mesh);

      // Update the element state (store occBrep and edgeGeometry for lossless round-tripping)
      setElements((prevElements) =>
        prevElements.map((element) => {
          if (element.nodeId === nodeId) {
            return { ...element, brep: newBrep, position, occBrep, edgeGeometry, faceGeometry, vertexPositions };
          }
          return element;
        })
      );

      // Update feature tree if this is an extrude operation
      if (featureUpdate?.type === "extrude") {
        setFeatureTree((prev) => {
          const name = `Extrude ${countOperationsOfType(prev, "extrude") + 1}`;
          return applyExtrudeToTree(prev, nodeId, name);
        });
      }

      // Update feature tree if this is a fillet or chamfer operation
      if (featureUpdate?.type === "fillet" || featureUpdate?.type === "chamfer") {
        setFeatureTree((prev) => {
          const opType = featureUpdate.type as "fillet" | "chamfer";
          const label = opType === "fillet" ? "Fillet" : "Chamfer";
          const name = `${label} ${countOperationsOfType(prev, opType) + 1}`;
          return applyFilletToTree(prev, nodeId, name, opType);
        });
      }

      // Update feature tree if this is a sweep operation
      if (featureUpdate?.type === "sweep" && featureUpdate.consumedElementId) {
        setFeatureTree((prev) => {
          const name = `Sweep ${countOperationsOfType(prev, "sweep") + 1}`;
          return applySweepToTree(prev, nodeId, featureUpdate.consumedElementId!, name);
        });
      }

      // Update feature tree if this is a revolve operation
      if (featureUpdate?.type === "revolve") {
        setFeatureTree((prev) => {
          const name = `Revolve ${countOperationsOfType(prev, "revolve") + 1}`;
          return applyRevolveToTree(prev, nodeId, name);
        });
      }

      // Update feature tree if this is a cut (difference) operation
      if (featureUpdate?.type === "difference") {
        setFeatureTree((prev) => {
          const name = `Cut ${countOperationsOfType(prev, "difference") + 1}`;
          return applyExtrudeToTree(prev, nodeId, name);
        });
        // Remove the consumed profile element from scene if specified
        if (featureUpdate.consumedElementId) {
          removeElementInternal(featureUpdate.consumedElementId);
        }
      }
    },
    [elements, objectsMap, pushUndo]
  );

  const ungroupSelectedElementImpl = useCallback(() => {
    if (selectedElements.length !== 1) return;

    pushUndo("Ungroup");

    const nodeId = selectedElements[0];

    const result = ungroupSelectedElement(
      elements,
      nodeId,
      idCounter,
      brepGraph,
      objectsMap
    );

    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
    setIdCounter(result.nextIdCounter);

    // Update feature tree
    const numChildren = result.updatedElements.length - elements.length + 1;
    if (numChildren > 0) {
      const newChildIds: string[] = [];
      for (let i = 0; i < numChildren; i++) {
        newChildIds.push(`node_${idCounter + i + 1}`);
      }
      setFeatureTree((prev) => applyUngroupToTree(prev, nodeId, newChildIds));
    }
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap, pushUndo]);

  const loftElementsImpl = useCallback(
    (profileNodeIds: string[], resultBrep: Brep, resultPosition: THREE.Vector3, edgeGeometry?: THREE.BufferGeometry, occBrep?: string, vertexPositions?: Float32Array, faceGeometry?: THREE.BufferGeometry) => {
      if (profileNodeIds.length < 2) return;

      pushUndo("Loft");

      const consumedIds = [...profileNodeIds];

      // Create new mesh
      let mesh: THREE.Group;
      if (edgeGeometry) {
        let geom: THREE.BufferGeometry;
        if (faceGeometry) {
          geom = faceGeometry;
        } else {
          const faces = getAllFaces(resultBrep);
          geom = createGeometryFromBRep(faces);
        }
        mesh = createMeshFromGeometry(geom, edgeGeometry);
      } else {
        mesh = createMeshFromBrep(resultBrep);
      }

      const newIdCounter = idCounter + 1;
      const newNodeId = `node_${newIdCounter}`;

      mesh.position.copy(resultPosition);
      mesh.userData.nodeId = newNodeId;
      objectsMap.set(newNodeId, mesh);

      // Remove consumed elements and add new element
      const newElements = elements.filter(el => !consumedIds.includes(el.nodeId));
      const newElement: SceneElement = {
        brep: resultBrep,
        nodeId: newNodeId,
        position: resultPosition.clone(),
        selected: false,
        occBrep,
        edgeGeometry,
        vertexPositions,
      };
      newElements.push(newElement);

      // Remove consumed objects from objectsMap
      for (const nodeId of consumedIds) {
        const obj = objectsMap.get(nodeId);
        if (obj && obj.parent) {
          obj.parent.remove(obj);
        }
        objectsMap.delete(nodeId);
      }

      setElements(newElements);
      setSelectedElements([]);
      setIdCounter(newIdCounter);

      // Update feature tree — same pattern as union
      setFeatureTree((prev) => {
        const name = `Loft ${countOperationsOfType(prev, "loft") + 1}`;
        return applyBooleanOperationToTree(prev, consumedIds, newNodeId, "loft", name);
      });
    },
    [elements, idCounter, objectsMap, pushUndo]
  );

  const duplicateSelectedElementsImpl = useCallback(() => {
    if (selectedElements.length === 0) return;

    pushUndo("Duplicate");

    const newElements: SceneElement[] = [];
    let nextId = idCounter;

    for (const nodeId of selectedElements) {
      const element = elements.find(el => el.nodeId === nodeId);
      if (!element) continue;

      nextId++;
      const newNodeId = `node_${nextId}`;

      // Deep-clone geometry
      const newBrep = cloneBrep(element.brep);
      const newPosition = element.position.clone().add(new THREE.Vector3(1, 1, 0));
      const newRotation = element.rotation ? element.rotation.clone() : undefined;
      const newEdgeGeometry = element.edgeGeometry ? element.edgeGeometry.clone() : undefined;
      const newVertexPositions = element.vertexPositions ? new Float32Array(element.vertexPositions) : undefined;
      const newPathData = element.pathData
        ? { points: element.pathData.points.map(p => ({ ...p })) }
        : undefined;

      // Create mesh
      let mesh: THREE.Group;
      if (newEdgeGeometry) {
        const faces = getAllFaces(newBrep);
        const geom = createGeometryFromBRep(faces);
        mesh = createMeshFromGeometry(geom, newEdgeGeometry);
      } else if (newPathData) {
        mesh = createMeshFromPath(newPathData.points);
      } else {
        mesh = createMeshFromBrep(newBrep);
      }
      mesh.position.copy(newPosition);
      if (newRotation) mesh.rotation.copy(newRotation);
      mesh.userData.nodeId = newNodeId;

      // Add to scene if possible
      const oldObj = objectsMap.get(nodeId);
      if (oldObj && oldObj.parent) {
        oldObj.parent.add(mesh);
      }
      objectsMap.set(newNodeId, mesh);

      const newElement: SceneElement = {
        brep: newBrep,
        nodeId: newNodeId,
        position: newPosition,
        selected: false,
        rotation: newRotation,
        elementType: element.elementType,
        pathData: newPathData,
        occBrep: element.occBrep,
        edgeGeometry: newEdgeGeometry,
        vertexPositions: newVertexPositions,
        sketchPlane: element.sketchPlane,
      };
      newElements.push(newElement);
    }

    setElements(prev => [...prev, ...newElements]);
    setIdCounter(nextId);

    // Select only the new copies
    setSelectedElements(newElements.map(el => el.nodeId));

    // Add body nodes to feature tree
    setFeatureTree(prev => {
      let tree = [...prev];
      for (const newEl of newElements) {
        // Find the original element's node name
        const originalNodeId = selectedElements[newElements.indexOf(newEl)];
        let originalName = "Body";
        const findName = (nodes: FeatureNode[]): string | null => {
          for (const n of nodes) {
            if (n.elementId === originalNodeId) return n.name;
            if (n.children) {
              const found = findName(n.children);
              if (found) return found;
            }
          }
          return null;
        };
        const found = findName(tree);
        if (found) originalName = found;

        tree = [...tree, {
          id: `body_${newEl.nodeId}`,
          type: "body" as const,
          name: `Copy of ${originalName}`,
          visible: true,
          elementId: newEl.nodeId,
        }];
      }
      return tree;
    });
  }, [elements, selectedElements, idCounter, objectsMap, pushUndo]);

  const getObjectImpl = useCallback(
    (nodeId: string) => {
      return getObject(objectsMap, nodeId);
    },
    [objectsMap]
  );

  // Sketch methods
  const startSketch = useCallback(
    (plane: SketchPlane): string => {
      const result = createSketchOp(plane, idCounter);
      setActiveSketch(result.sketch);
      setIdCounter(result.nextId);
      // Only save previous mode if we're not already in sketch mode
      // This preserves the original mode when entering via plane selection UI
      if (mode !== "sketch") {
        setPreviousMode(mode);
      }
      setMode("sketch");
      return result.sketch.id;
    },
    [idCounter, mode]
  );

  const addPrimitive = useCallback(
    (primitive: SketchPrimitive) => {
      setActiveSketch((currentSketch) => {
        if (!currentSketch) {
          console.warn("No active sketch to add primitive to");
          return null;
        }

        console.log("Adding primitive:", primitive.type, primitive.id);
        const result = addPrimitiveToSketch(currentSketch, primitive, idCounter);
        console.log("Updated sketch has", result.sketch.primitives.length, "primitives");
        // Note: We can't update idCounter here since it's outside the functional update
        // but since we generate IDs in the hook, this is fine
        return result.sketch;
      });
    },
    [idCounter]
  );

  const updatePrimitive = useCallback(
    (primitiveId: string, updates: Partial<SketchPrimitive>) => {
      setActiveSketch((currentSketch) => {
        if (!currentSketch) {
          console.warn("No active sketch to update primitive in");
          return null;
        }

        const updatedPrimitives = currentSketch.primitives.map((p) => {
          if (p.id === primitiveId) {
            return { ...p, ...updates } as SketchPrimitive;
          }
          return p;
        });

        return {
          ...currentSketch,
          primitives: updatedPrimitives,
        };
      });
    },
    []
  );

  // Batch update primitives and solve in one atomic operation
  // This ensures the solver sees all position updates before solving
  // Uses version tracking to prevent race conditions from concurrent updates
  const updatePrimitivesAndSolve = useCallback(
    async (updates: Map<string, { x: number; y: number }>) => {
      // Increment version to track this operation
      const currentVersion = ++solveVersionRef.current;

      // Use a promise to get the updated sketch from inside the functional update
      const sketchPromise = new Promise<Sketch | null>((resolve) => {
        setActiveSketch((currentSketch) => {
          if (!currentSketch) {
            resolve(null);
            return null;
          }

          // Apply all position updates in one go
          const updatedPrimitives = currentSketch.primitives.map((p) => {
            const update = updates.get(p.id);
            if (update && p.type === "point") {
              return { ...p, x: update.x, y: update.y } as SketchPrimitive;
            }
            return p;
          });

          const updatedSketch = {
            ...currentSketch,
            primitives: updatedPrimitives,
          };

          resolve(updatedSketch);
          return updatedSketch;
        });
      });

      const sketchToSolve = await sketchPromise;
      if (!sketchToSolve) return;

      // Check if a newer operation started - if so, skip this solve
      if (solveVersionRef.current !== currentVersion) {
        return;
      }

      // Temporarily fix edited points so the solver pins them in place
      // (same pattern as drag: startDrag sets fixed=true, solver respects it)
      const editedPointIds = new Set(updates.keys());
      const sketchWithFixed: Sketch = {
        ...sketchToSolve,
        primitives: sketchToSolve.primitives.map((p) =>
          editedPointIds.has(p.id) && p.type === "point"
            ? { ...p, fixed: true } as SketchPrimitive
            : p
        ),
      };

      // Now solve with the updated sketch
      try {
        const solver = SketchSolverService.getInstance();
        const result = await solver.solve(sketchWithFixed);

        // Check version again after async solve completes
        if (solveVersionRef.current !== currentVersion) {
          return;
        }

        if (result.success) {
          // Strip the temporary fixed flags before storing
          const cleanSketch: Sketch = {
            ...result.sketch,
            primitives: result.sketch.primitives.map((p) =>
              editedPointIds.has(p.id) && p.type === "point"
                ? { ...p, fixed: false } as SketchPrimitive
                : p
            ),
          };
          setActiveSketch(cleanSketch);
        }
      } catch (error) {
        console.error("Sketch solve error during drag:", error);
      }
    },
    []
  );

  const addConstraint = useCallback(
    (constraint: SketchConstraint) => {
      if (!activeSketch) {
        console.warn("No active sketch to add constraint to");
        return;
      }

      const result = addConstraintToSketch(activeSketch, constraint, idCounter);
      setActiveSketch(result.sketch);
      setIdCounter(result.nextId);
    },
    [activeSketch, idCounter]
  );

  // Atomic add constraint and solve with rollback for redundant/conflicting constraints.
  // Returns a ConstraintResult indicating whether the constraint was applied, redundant, conflicting, or failed.
  const addConstraintAndSolve = useCallback(
    async (constraint: SketchConstraint): Promise<ConstraintResult> => {
      // Capture pre-constraint sketch for potential rollback
      let preConstraintSketch: Sketch | null = null;

      // We need to capture the sketch with the constraint added for solving
      // Use a Promise to get the value from inside the functional update
      const sketchPromise = new Promise<{ sketch: Sketch; nextId: number } | null>((resolve) => {
        setActiveSketch((currentSketch) => {
          if (!currentSketch) {
            console.warn("No active sketch to add constraint to");
            resolve(null);
            return null;
          }

          // Save pre-constraint state for rollback
          preConstraintSketch = currentSketch;

          const addResult = addConstraintToSketch(currentSketch, constraint, idCounter);
          console.log("Added constraint:", constraint.type, "to sketch with", addResult.sketch.primitives.length, "primitives");

          resolve({ sketch: addResult.sketch, nextId: addResult.nextId });
          return addResult.sketch;
        });
      });

      const result = await sketchPromise;
      if (!result) return { sketch: null, status: "failed" };

      const { sketch: sketchToSolve, nextId } = result;

      // Update counter first to prevent ID collision if exception occurs
      setIdCounter(nextId);

      // Now solve asynchronously
      try {
        const solver = SketchSolverService.getInstance();
        console.log("Solving sketch with", sketchToSolve.constraints.length, "constraints");
        const solveResult = await solver.solve(sketchToSolve);

        if (solveResult.success) {
          // Check for overconstrained status (redundant or conflicting)
          if (solveResult.status === "overconstrained") {
            const isRedundant = (solveResult.redundantConstraintIds?.length ?? 0) > 0;
            const isConflicting = (solveResult.conflictingConstraintIds?.length ?? 0) > 0;
            const status = isConflicting ? "conflicting" as const : "redundant" as const;

            console.warn(
              `Constraint ${constraint.type} is ${status}. Rolling back.`,
              isRedundant ? `Redundant IDs: ${solveResult.redundantConstraintIds}` : "",
              isConflicting ? `Conflicting IDs: ${solveResult.conflictingConstraintIds}` : "",
            );

            // Roll back to pre-constraint state
            if (preConstraintSketch) {
              setActiveSketch(preConstraintSketch);
            }

            return { sketch: null, status };
          }

          console.log("Solve succeeded, DOF:", solveResult.dof);
          setActiveSketch(solveResult.sketch);
          return { sketch: solveResult.sketch, status: "applied" };
        } else {
          console.warn("Sketch solve failed, keeping constraint anyway");
          return { sketch: null, status: "failed" };
        }
      } catch (error) {
        console.error("Sketch solve error:", error);
        return { sketch: null, status: "failed" };
      }
    },
    [idCounter]
  );

  // Preview a constraint without committing (snapshot-based, supports debounced iteration)
  const previewConstraint = useCallback(
    async (constraint: SketchConstraint): Promise<ConstraintResult> => {
      // On first call, save the current sketch as snapshot
      if (previewConstraintSnapshotRef.current === null) {
        const current = activeSketchRef.current;
        if (!current) return { sketch: null, status: "failed" };
        previewConstraintSnapshotRef.current = current;
      }

      const version = ++previewVersionRef.current;
      const snapshot = previewConstraintSnapshotRef.current;

      // Always start from the snapshot, add the new constraint
      const addResult = addConstraintToSketch(snapshot, constraint, idCounter);

      try {
        const solver = SketchSolverService.getInstance();
        const solveResult = await solver.solve(addResult.sketch);

        // Check for staleness after async solve
        if (previewVersionRef.current !== version) {
          return { sketch: null, status: "failed" };
        }

        if (solveResult.success) {
          if (solveResult.status === "overconstrained") {
            // Restore snapshot on overconstrained
            setActiveSketch(snapshot);
            const isConflicting = (solveResult.conflictingConstraintIds?.length ?? 0) > 0;
            return { sketch: null, status: isConflicting ? "conflicting" : "redundant" };
          }
          setActiveSketch(solveResult.sketch);
          return { sketch: solveResult.sketch, status: "applied" };
        } else {
          setActiveSketch(snapshot);
          return { sketch: null, status: "failed" };
        }
      } catch {
        if (previewVersionRef.current === version) {
          setActiveSketch(snapshot);
        }
        return { sketch: null, status: "failed" };
      }
    },
    [idCounter]
  );

  // Cancel an in-progress constraint preview, restoring the snapshot
  const cancelConstraintPreview = useCallback(() => {
    const snapshot = previewConstraintSnapshotRef.current;
    if (snapshot) {
      setActiveSketch(snapshot);
    }
    previewConstraintSnapshotRef.current = null;
    previewVersionRef.current++;
  }, []);

  // Commit the current preview state (push undo, clear snapshot)
  const commitConstraintPreview = useCallback(() => {
    const snapshot = previewConstraintSnapshotRef.current;
    if (snapshot) {
      // Push the pre-preview state as undo entry
      sketchUndoStackRef.current = [...sketchUndoStackRef.current, snapshot];
      if (sketchUndoStackRef.current.length > MAX_SKETCH_UNDO_STEPS) {
        sketchUndoStackRef.current = sketchUndoStackRef.current.slice(
          sketchUndoStackRef.current.length - MAX_SKETCH_UNDO_STEPS
        );
      }
      sketchRedoStackRef.current = [];
      setUndoRedoVersion((v) => v + 1);
    }
    previewConstraintSnapshotRef.current = null;
    previewVersionRef.current++;
  }, []);

  const removePrimitive = useCallback(
    (primitiveId: string) => {
      setActiveSketch((currentSketch) => {
        if (!currentSketch) {
          console.warn("No active sketch to remove primitive from");
          return null;
        }
        const result = removePrimitiveFromSketch(currentSketch, primitiveId);
        return result.sketch;
      });
    },
    []
  );

  const removeConstraint = useCallback(
    (constraintId: string) => {
      setActiveSketch((currentSketch) => {
        if (!currentSketch) {
          console.warn("No active sketch to remove constraint from");
          return null;
        }
        const result = removeConstraintFromSketch(currentSketch, constraintId);
        return result.sketch;
      });
    },
    []
  );

  const solveSketch = useCallback(async (): Promise<Sketch | null> => {
    // Get latest sketch state
    let sketchToSolve: Sketch | null = null;
    setActiveSketch((current) => {
      sketchToSolve = current;
      return current; // Don't change state, just read it
    });

    if (!sketchToSolve) {
      console.warn("No active sketch to solve");
      return null;
    }

    try {
      const solver = SketchSolverService.getInstance();
      console.log("Solving sketch with", sketchToSolve.primitives.length, "primitives");
      const result = await solver.solve(sketchToSolve);

      if (result.success) {
        console.log("Solve succeeded, DOF:", result.dof);
        setActiveSketch(result.sketch);
        return result.sketch;
      } else {
        console.warn("Sketch solve failed");
        return null;
      }
    } catch (error) {
      console.error("Sketch solve error:", error);
      return null;
    }
  }, []);

  const finishSketch = useCallback(async (): Promise<boolean> => {
    if (!activeSketch) {
      console.warn("No active sketch to finish");
      return false;
    }

    pushUndo("Finish Sketch");
    setOperationPending(true);

    // Clear sketch undo stacks
    sketchUndoStackRef.current = [];
    sketchRedoStackRef.current = [];

    // Solve one more time before finishing
    try {
      const solver = SketchSolverService.getInstance();
      const result = await solver.solve(activeSketch);
      const finishedSketch = result.sketch;

      // Store the finished sketch
      setSketches((prev) => [...prev, finishedSketch]);

      const sketchService = SketchToBrepService.getInstance();

      // Try profile detection first (handles T-junctions from trimming)
      const conversionResult = await sketchService.convertSketchToProfiles(finishedSketch);

      if (conversionResult.success && conversionResult.profiles.length > 0) {
        console.log(`Creating ${conversionResult.profiles.length} profile elements from sketch`);

        // Create a sketch node for the feature tree
        const sketchNode: FeatureNode = {
          id: finishedSketch.id,
          type: "sketch",
          name: `Sketch ${sketches.length + 1}`,
          visible: true,
          expanded: true,
          children: [],
          sourceSketchId: finishedSketch.id,
        };

        // Add each profile as a separate element
        // IMPORTANT: We need to track idCounter manually since React batches state updates
        let currentIdCounter = idCounter;
        const newElements: SceneElement[] = [...elements];

        for (let i = 0; i < conversionResult.profiles.length; i++) {
          const profile = conversionResult.profiles[i];

          if (profile.brep.faces.length > 0) {
            // Manually create nodeId and element to avoid stale state issues
            currentIdCounter++;
            const nodeId = `node_${currentIdCounter}`;

            // Use exact center position — grid snapping here would introduce
            // up to ±0.25 error per profile, breaking relative alignment
            const position = new THREE.Vector3(
              profile.center.x,
              profile.center.y,
              profile.center.z
            );

            // Compute clean OCC-based edge/vertex data for highlighting via worker
            let edgeGeometry: THREE.BufferGeometry | undefined;
            let vertexPositions: Float32Array | undefined;
            let occBrep: string | undefined;
            try {
              const client = OccWorkerClient.getInstance();
              const profileResult = await client.send<WorkerProcessProfileResult>({
                type: "processProfile",
                payload: {
                  brepJson: profile.brep.toJSON(),
                  occBrep: profile.occBrep,
                },
              });

              if (profileResult.edgePositions) {
                edgeGeometry = reconstructEdgeGeometry(profileResult.edgePositions);
              }
              if (profileResult.vertexPositions) {
                vertexPositions = profileResult.vertexPositions;
              }
              if (profileResult.occBrep) {
                occBrep = profileResult.occBrep;
              }
            } catch (e) {
              console.warn("Failed to compute profile edge geometry:", e);
            }

            // Create mesh from brep — use OCC edge geometry when available
            let mesh: THREE.Group;
            if (edgeGeometry) {
              const faces = getAllFaces(profile.brep);
              const faceGeometry = createGeometryFromBRep(faces);
              mesh = createMeshFromGeometry(faceGeometry, edgeGeometry);
            } else {
              mesh = createMeshFromBrep(profile.brep);
            }
            mesh.position.copy(position);
            mesh.userData.nodeId = nodeId;

            // Add to objectsMap
            objectsMap.set(nodeId, mesh);

            // Add to elements array
            const newElement: SceneElement = {
              brep: profile.brep,
              nodeId,
              position: position.clone(),
              selected: false,
              sketchPlane: finishedSketch.plane,
              edgeGeometry,
              vertexPositions,
              occBrep,
            };
            newElements.push(newElement);

            console.log(`Added profile ${i + 1}: area=${profile.area.toFixed(4)}, nodeId=${nodeId}, position=(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}), faces=${profile.brep.faces.length}`);

            // Add profile node as child of sketch
            const profileNode: FeatureNode = {
              id: profile.id,
              type: "profile",
              name: `Profile ${i + 1} (area: ${profile.area.toFixed(2)})`,
              visible: true,
              sourceSketchId: finishedSketch.id,
              elementId: nodeId,
            };
            sketchNode.children!.push(profileNode);
          }
        }

        // Batch update state
        setElements(newElements);
        setIdCounter(currentIdCounter);

        // Update feature tree
        setFeatureTree((prev) => [...prev, sketchNode]);
      } else if (!sketchService.isSketchClosed(finishedSketch)) {
        // No profiles found AND sketch is open → try wire path for sweep
        console.log("[finishSketch] Open sketch detected — creating path element for sweep");
        const wireResult = await sketchService.convertSketchToWire(finishedSketch);

        if (wireResult && wireResult.points.length >= 2) {
          const vertices = wireResult.points.map(p => new Vertex(p.x, p.y, p.z));
          const edges: Edge[] = [];
          for (let i = 0; i < vertices.length - 1; i++) {
            edges.push(new Edge(vertices[i], vertices[i + 1]));
          }
          const pathBrep = new Brep(vertices, edges, []);

          const currentId = idCounter + 1;
          const nodeId = `node_${currentId}`;
          const position = new THREE.Vector3(0, 0, 0);

          const mesh = createMeshFromPath(wireResult.points);
          mesh.position.copy(position);
          mesh.userData.nodeId = nodeId;
          objectsMap.set(nodeId, mesh);

          const pathElement: SceneElement = {
            brep: pathBrep,
            nodeId,
            position: position.clone(),
            selected: false,
            elementType: "path",
            pathData: { points: wireResult.points },
          };

          setElements((prev) => [...prev, pathElement]);
          setIdCounter(currentId);

          const sketchNode: FeatureNode = {
            id: finishedSketch.id,
            type: "sketch",
            name: `Sketch ${sketches.length + 1} (Path)`,
            visible: true,
            expanded: true,
            children: [{
              id: `${finishedSketch.id}_path`,
              type: "body",
              name: "Path",
              visible: true,
              sourceSketchId: finishedSketch.id,
              elementId: nodeId,
            }],
            sourceSketchId: finishedSketch.id,
          };
          setFeatureTree((prev) => [...prev, sketchNode]);

          console.log(`[finishSketch] Created path element: ${nodeId}, ${wireResult.points.length} points`);
        } else {
          console.warn("[finishSketch] Open sketch produced no valid wire");
        }
      } else {
        // Closed sketch but no profiles detected — fallback
        console.log("Closed sketch but no profiles — using fallback union method");
        const brep = await sketchService.convertSketchToBrep(finishedSketch);

        if (brep.vertices.length > 0 || brep.edges.length > 0 || brep.faces.length > 0) {
          const position = new THREE.Vector3(0, 0, 0);
          const nodeId = addElementInternal(brep, position);
          console.log("Added sketch as single BRep element, vertices:", brep.vertices.length, "faces:", brep.faces.length);

          const sketchNode: FeatureNode = {
            id: finishedSketch.id,
            type: "sketch",
            name: `Sketch ${sketches.length + 1}`,
            visible: true,
            expanded: true,
            children: [{
              id: `${finishedSketch.id}_body`,
              type: "body",
              name: "Body",
              visible: true,
              sourceSketchId: finishedSketch.id,
              elementId: nodeId,
            }],
            sourceSketchId: finishedSketch.id,
          };
          setFeatureTree((prev) => [...prev, sketchNode]);
        } else {
          console.warn("Sketch produced empty BRep - no vertices, edges, or faces");
        }
      }

      // Clear active sketch and return to previous mode
      setActiveSketch(null);
      setMode(previousMode);
      setOperationPending(false);
      return true;
    } catch (error) {
      console.error("Error finishing sketch:", error);
      // Pop the undo snapshot on error
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      setUndoRedoVersion((v) => v + 1);
      // Still clear the sketch on error
      setActiveSketch(null);
      setMode(previousMode);
      setOperationPending(false);
      return false;
    }
  }, [activeSketch, previousMode, addElementInternal, sketches.length, pushUndo]);

  const cancelSketch = useCallback(() => {
    // Clear sketch undo stacks
    sketchUndoStackRef.current = [];
    sketchRedoStackRef.current = [];
    setActiveSketch(null);
    setMode(previousMode);
  }, [previousMode]);

  // Feature tree methods
  const toggleNodeVisibility = useCallback((nodeId: string) => {
    // Helper to recursively update visibility
    const updateNode = (nodes: FeatureNode[]): FeatureNode[] => {
      return nodes.map((node) => {
        if (node.id === nodeId) {
          const newVisible = !node.visible;

          // Toggle visibility of the Three.js object if this node has an elementId
          if (node.elementId) {
            const obj = objectsMap.get(node.elementId);
            if (obj) {
              obj.visible = newVisible;
            }
          }

          // If this is a parent node (sketch), also toggle all children
          if (node.children) {
            const updatedChildren = node.children.map((child) => {
              if (child.elementId) {
                const obj = objectsMap.get(child.elementId);
                if (obj) {
                  obj.visible = newVisible;
                }
              }
              return { ...child, visible: newVisible };
            });
            return { ...node, visible: newVisible, children: updatedChildren };
          }

          return { ...node, visible: newVisible };
        }

        // Recursively check children
        if (node.children) {
          return { ...node, children: updateNode(node.children) };
        }
        return node;
      });
    };

    setFeatureTree((prev) => updateNode(prev));
  }, [objectsMap]);

  const toggleNodeExpanded = useCallback((nodeId: string) => {
    const updateNode = (nodes: FeatureNode[]): FeatureNode[] => {
      return nodes.map((node) => {
        if (node.id === nodeId) {
          return { ...node, expanded: !node.expanded };
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) };
        }
        return node;
      });
    };

    setFeatureTree((prev) => updateNode(prev));
  }, []);

  const renameNodeImpl = useCallback((nodeId: string, newName: string) => {
    setFeatureTree((prev) => renameNodeOp(prev, nodeId, newName));
  }, []);

  const deleteNodeImpl = useCallback((nodeId: string) => {
    pushUndo("Delete");

    // Find the node to get its elementId before removing
    function findNode(nodes: FeatureNode[]): FeatureNode | null {
      for (const node of nodes) {
        if (node.id === nodeId) return node;
        if (node.children) {
          const found = findNode(node.children);
          if (found) return found;
        }
      }
      return null;
    }

    const node = findNode(featureTree);
    if (!node) return;

    // Remove the element from the scene if it has one
    if (node.elementId) {
      removeElementInternal(node.elementId);
    }

    // Also remove children's elements
    if (node.children) {
      for (const child of node.children) {
        if (child.elementId) {
          removeElementInternal(child.elementId);
        }
      }
    }

    // Remove from feature tree
    setFeatureTree((prev) => removeNodeByIdOp(prev, nodeId).updatedTree);
  }, [featureTree, removeElementInternal, pushUndo]);

  const toggleSectionExpanded = useCallback((sectionId: string) => {
    setSectionExpandedState((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  const toggleOriginVisibility = useCallback((id: string) => {
    setOriginVisibility((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  // ── Import/Export ──────────────────────────────────────────────────

  const importFile = useCallback(async (file: File) => {
    const ieService = ImportExportService.getInstance();
    const buffer = await file.arrayBuffer();
    const ext = file.name.split(".").pop()?.toLowerCase();

    let results;
    if (ext === "step" || ext === "stp") {
      results = await ieService.importSTEP(buffer);
    } else if (ext === "stl") {
      results = await ieService.importSTL(buffer);
    } else {
      throw new Error(`Unsupported file format: .${ext}`);
    }

    pushUndo("Import");

    const result = importElementsOp(elements, results, idCounter, objectsMap);
    setElements(result.updatedElements);
    setIdCounter(result.nextId);

    // Add feature tree nodes for imported bodies
    const importNodes: FeatureNode[] = result.nodeIds.map((nodeId, i) => ({
      id: `import_${nodeId}`,
      type: "body" as const,
      name: results.length === 1 ? file.name : `${file.name} [${i + 1}]`,
      visible: true,
      elementId: nodeId,
    }));
    setFeatureTree((prev) => [...prev, ...importNodes]);
  }, [elements, idCounter, objectsMap, pushUndo]);

  const exportFile = useCallback(async (format: "step" | "stl" | "iges") => {
    if (elements.length === 0) return;

    const ieService = ImportExportService.getInstance();

    let blob: Blob;
    let filename: string;
    if (format === "step") {
      blob = await ieService.exportSTEP(elements);
      filename = "export.step";
    } else if (format === "stl") {
      blob = await ieService.exportSTL(elements);
      filename = "export.stl";
    } else {
      blob = await ieService.exportIGES(elements);
      filename = "export.iges";
    }

    // Trigger browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [elements]);

  return (
    <CadCoreContext.Provider
      value={{
        elements,
        selectedElements,
        brepGraph,
        mode,
        idCounter,
        objectsMap,
        setMode: handleSetMode,
        addElement,
        removeElement,
        updateElementPosition,
        selectElement,
        deselectElement,
        deselectAll,
        unionSelectedElements: unionSelectedElementsImpl,
        differenceSelectedElements: differenceSelectedElementsImpl,
        intersectionSelectedElements: intersectionSelectedElementsImpl,
        combineSelectedElements: combineSelectedElementsImpl,
        updateElementRotation,
        getObject: (nodeId) => getObjectImpl(nodeId),
        getAllObjects: () => getAllObjects(objectsMap),
        createMeshFromBrep,
        ungroupSelectedElement: ungroupSelectedElementImpl,
        updateElementBrep,
        loftElements: loftElementsImpl,
        duplicateSelectedElements: duplicateSelectedElementsImpl,
        // Sketch-related
        activeSketch,
        sketches,
        startSketch,
        addPrimitive,
        updatePrimitive,
        updatePrimitivesAndSolve,
        addConstraint,
        addConstraintAndSolve,
        previewConstraint,
        cancelConstraintPreview,
        commitConstraintPreview,
        removePrimitive,
        removeConstraint,
        finishSketch,
        cancelSketch,
        solveSketch,
        // Feature tree
        featureTree,
        toggleNodeVisibility,
        toggleNodeExpanded,
        renameNode: renameNodeImpl,
        deleteNode: deleteNodeImpl,
        sectionExpandedState,
        toggleSectionExpanded,
        originVisibility,
        toggleOriginVisibility,
        // Undo/redo
        undo,
        redo,
        canUndo,
        canRedo,
        undoActionName,
        redoActionName,
        undoStack: undoStackRef.current,
        redoStack: redoStackRef.current,
        pushUndo,
        pushSketchUndo,
        undoSketch,
        redoSketch,
        canUndoSketch,
        canRedoSketch,
        // Import/Export
        importFile,
        exportFile,
        // Measurements
        pinnedMeasurements,
        addPinnedMeasurement,
        removePinnedMeasurement,
        clearPinnedMeasurements,
        // Operation lock
        isOperationPending,
      }}
    >
      {children}
    </CadCoreContext.Provider>
  );
};

export const useCadCore = () => {
  const context = useContext(CadCoreContext);
  if (context === undefined) {
    throw new Error("useCadCore must be used within a CadCoreProvider");
  }
  return context;
};
