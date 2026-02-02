import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
} from "react";
import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";
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
import { SceneElement, SceneMode } from "../scene-operations/types";
import {
  createMeshFromBrep,
  getObject,
  getAllObjects,
} from "../scene-operations/mesh-operations";
import { ungroupSelectedElement } from "../scene-operations/ungroup-operations";
import {
  Sketch,
  SketchPlane,
  SketchPrimitive,
  SketchConstraint,
} from "../types/sketch-types";
import {
  createSketch as createSketchOp,
  addPrimitiveToSketch,
  addConstraintToSketch,
  removePrimitiveFromSketch,
  removeConstraintFromSketch,
} from "../scene-operations/sketch-operations";
import { SketchSolverService } from "../services/SketchSolverService";
import { OpenCascadeService } from "../services/OpenCascadeService";

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
  unionSelectedElements: () => void;
  differenceSelectedElements: () => void;
  intersectionSelectedElements: () => void;
  updateElementRotation: (nodeId: string, rotation: THREE.Euler) => void;
  getObject: (nodeId: string) => THREE.Object3D | undefined;
  getAllObjects: () => Map<string, THREE.Object3D>;
  createMeshFromBrep: (brep: Brep) => THREE.Mesh;
  ungroupSelectedElement: () => void;

  // Sketch-related state and methods
  activeSketch: Sketch | null;
  sketches: Sketch[];
  startSketch: (plane: SketchPlane) => string;
  addPrimitive: (primitive: SketchPrimitive) => void;
  addConstraint: (constraint: SketchConstraint) => void;
  addConstraintAndSolve: (constraint: SketchConstraint) => Promise<void>;
  removePrimitive: (primitiveId: string) => void;
  removeConstraint: (constraintId: string) => void;
  finishSketch: () => Promise<void>;
  cancelSketch: () => void;
  solveSketch: () => Promise<void>;
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
  const [mode, setMode] = useState<SceneMode>("draw");
  const [idCounter, setIdCounter] = useState(0);
  const [objectsMap] = useState<Map<string, THREE.Object3D>>(new Map());

  // Sketch state
  const [activeSketch, setActiveSketch] = useState<Sketch | null>(null);
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [previousMode, setPreviousMode] = useState<SceneMode>("draw");

  const handleSetMode = useCallback(
    (newMode: SceneMode) => {
      const result = handleSetModeOp(elements, newMode, objectsMap);
      setElements(result.updatedElements);
      setMode(result.mode);
      setSelectedElements([]);
    },
    [elements, objectsMap]
  );

  const addElement = useCallback(
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

  const removeElement = useCallback(
    (nodeId: string) => {
      const result = removeElementOp(
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

  const unionSelectedElementsImpl = useCallback(async () => {
    if (selectedElements.length < 2) return;

    try {
      const result = await unionSelectedElementsOp(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
      setIdCounter(result.nextIdCounter);
    } catch (error) {
      console.error("Union error:", error);
    }
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap]);

  const differenceSelectedElementsImpl = useCallback(async () => {
    if (selectedElements.length < 2) return;

    try {
      const result = await differenceSelectedElementsOp(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
      setIdCounter(result.nextIdCounter);
    } catch (error) {
      console.error("Difference error:", error);
    }
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap]);

  const intersectionSelectedElementsImpl = useCallback(async () => {
    if (selectedElements.length < 2) return;

    try {
      const result = await intersectionSelectedElementsOp(
        elements,
        selectedElements,
        idCounter,
        brepGraph,
        objectsMap
      );

      setElements(result.updatedElements);
      setSelectedElements(result.updatedSelectedElements);
      setIdCounter(result.nextIdCounter);
    } catch (error) {
      console.error("Intersection error:", error);
    }
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap]);

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

  const ungroupSelectedElementImpl = useCallback(() => {
    if (selectedElements.length !== 1) return;

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
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap]);

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
      setPreviousMode(mode);
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

  // Atomic add constraint and solve - avoids React batching issues
  const addConstraintAndSolve = useCallback(
    async (constraint: SketchConstraint) => {
      if (!activeSketch) {
        console.warn("No active sketch to add constraint to");
        return;
      }

      // Add constraint to sketch
      const addResult = addConstraintToSketch(activeSketch, constraint, idCounter);
      const sketchWithConstraint = addResult.sketch;

      console.log("Added constraint:", constraint.type, "to sketch with", sketchWithConstraint.primitives.length, "primitives");

      // Immediately solve the updated sketch
      try {
        const solver = SketchSolverService.getInstance();
        console.log("Solving sketch with", sketchWithConstraint.constraints.length, "constraints");
        const solveResult = await solver.solve(sketchWithConstraint);

        if (solveResult.success) {
          console.log("Solve succeeded, DOF:", solveResult.dof);
          setActiveSketch(solveResult.sketch);
        } else {
          console.warn("Sketch solve failed, keeping constraint anyway");
          setActiveSketch(sketchWithConstraint);
        }
        setIdCounter(addResult.nextId);
      } catch (error) {
        console.error("Sketch solve error:", error);
        // Still update with the constraint even if solve failed
        setActiveSketch(sketchWithConstraint);
        setIdCounter(addResult.nextId);
      }
    },
    [activeSketch, idCounter]
  );

  const removePrimitive = useCallback(
    (primitiveId: string) => {
      if (!activeSketch) {
        console.warn("No active sketch to remove primitive from");
        return;
      }

      const result = removePrimitiveFromSketch(activeSketch, primitiveId);
      setActiveSketch(result.sketch);
    },
    [activeSketch]
  );

  const removeConstraint = useCallback(
    (constraintId: string) => {
      if (!activeSketch) {
        console.warn("No active sketch to remove constraint from");
        return;
      }

      const result = removeConstraintFromSketch(activeSketch, constraintId);
      setActiveSketch(result.sketch);
    },
    [activeSketch]
  );

  const solveSketch = useCallback(async () => {
    // Get latest sketch state
    let sketchToSolve: Sketch | null = null;
    setActiveSketch((current) => {
      sketchToSolve = current;
      return current; // Don't change state, just read it
    });

    if (!sketchToSolve) {
      console.warn("No active sketch to solve");
      return;
    }

    try {
      const solver = SketchSolverService.getInstance();
      console.log("Solving sketch with", sketchToSolve.primitives.length, "primitives");
      const result = await solver.solve(sketchToSolve);

      if (result.success) {
        console.log("Solve succeeded, DOF:", result.dof);
        setActiveSketch(result.sketch);
      } else {
        console.warn("Sketch solve failed");
      }
    } catch (error) {
      console.error("Sketch solve error:", error);
    }
  }, []);

  const finishSketch = useCallback(async () => {
    if (!activeSketch) {
      console.warn("No active sketch to finish");
      return;
    }

    // Solve one more time before finishing
    try {
      const solver = SketchSolverService.getInstance();
      const result = await solver.solve(activeSketch);

      // Store the finished sketch
      setSketches((prev) => [...prev, result.sketch]);

      // Convert sketch to BRep and add as element
      const ocService = OpenCascadeService.getInstance();
      const brep = await ocService.sketchToBrep(result.sketch);

      if (brep.vertices.length > 0 || brep.edges.length > 0 || brep.faces.length > 0) {
        // Calculate center position from sketch primitives
        let sumX = 0, sumY = 0, count = 0;
        for (const prim of result.sketch.primitives) {
          if (prim.type === "point") {
            sumX += prim.x;
            sumY += prim.y;
            count++;
          }
        }
        const centerX = count > 0 ? sumX / count : 0;
        const centerY = count > 0 ? sumY / count : 0;

        // Add as element at the sketch's position
        const position = new THREE.Vector3(centerX, centerY, 0);
        addElement(brep, position);
        console.log("Added sketch as BRep element at", position.toArray());
      } else {
        console.warn("Sketch produced empty BRep");
      }

      // Clear active sketch and return to previous mode
      setActiveSketch(null);
      setMode(previousMode);
    } catch (error) {
      console.error("Error finishing sketch:", error);
      // Still clear the sketch on error
      setActiveSketch(null);
      setMode(previousMode);
    }
  }, [activeSketch, previousMode, addElement]);

  const cancelSketch = useCallback(() => {
    setActiveSketch(null);
    setMode(previousMode);
  }, [previousMode]);

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
        updateElementRotation,
        getObject: (nodeId) => getObjectImpl(nodeId),
        getAllObjects: () => getAllObjects(objectsMap),
        createMeshFromBrep,
        ungroupSelectedElement: ungroupSelectedElementImpl,
        // Sketch-related
        activeSketch,
        sketches,
        startSketch,
        addPrimitive,
        addConstraint,
        addConstraintAndSolve,
        removePrimitive,
        removeConstraint,
        finishSketch,
        cancelSketch,
        solveSketch,
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
