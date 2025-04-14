// src/contexts/CadCoreContext.tsx
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
import { SceneElement, SceneMode } from "../scene-operations/types";
import {
  createMeshFromBrep,
  getObject,
  getAllObjects,
} from "../scene-operations/mesh-operations";
import { ungroupSelectedElement } from "../scene-operations/ungroup-operations";

// Define the context type for core operations (no UI logic)
export interface CadCoreContextType {
  // State
  elements: SceneElement[];
  selectedElements: string[];
  brepGraph: BrepGraph;
  mode: SceneMode;
  idCounter: number;
  objectsMap: Map<string, THREE.Object3D>;

  // Core operations
  setMode: (mode: SceneMode) => void;
  addElement: (
    brep: Brep,
    position: THREE.Vector3,
    object?: THREE.Object3D
  ) => void;
  removeElement: (nodeId: string) => void;
  updateElementPosition: (nodeId: string, position: THREE.Vector3) => void;
  selectElement: (nodeId: string) => void;
  deselectElement: (nodeId: string) => void;
  deselectAll: () => void;
  unionSelectedElements: () => void;
  updateElementRotation: (nodeId: string, rotation: THREE.Euler) => void;

  // Object access
  getObject: (nodeId: string) => THREE.Object3D | undefined;
  getAllObjects: () => Map<string, THREE.Object3D>;

  // For creating objects
  createMeshFromBrep: (brep: Brep) => THREE.Mesh;
  ungroupSelectedElement: () => void;
}

export const CadCoreContext = createContext<CadCoreContextType | undefined>(
  undefined
);

// Provider component without UI-specific logic
export const CadCoreProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [elements, setElements] = useState<SceneElement[]>([]);
  const [selectedElements, setSelectedElements] = useState<string[]>([]);
  const [brepGraph] = useState<BrepGraph>(new BrepGraph());
  const [mode, setMode] = useState<SceneMode>("draw");
  const [idCounter, setIdCounter] = useState(0);
  const [objectsMap] = useState<Map<string, THREE.Object3D>>(new Map());

  // State update methods
  const handleSetMode = useCallback(
    (newMode: SceneMode) => {
      const result = handleSetModeOp(elements, newMode, objectsMap);
      setElements(result.updatedElements);
      setMode(result.mode);
      setSelectedElements([]);
    },
    [elements, objectsMap]
  );

  // Element manipulation methods
  const addElement = useCallback(
    (brep: Brep, position: THREE.Vector3, object?: THREE.Object3D) => {
      // Add debug logging to track the issue

      const result = addElementOp(
        elements,
        brep,
        position,
        idCounter,
        objectsMap,
        object
      );

      // Set the elements and increment the ID counter
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

  // In src/contexts/CoreContext.tsx
  const unionSelectedElementsImpl = useCallback(async () => {
    if (selectedElements.length < 2) return;

    // Show loading indicator
    // setIsOperationLoading(true);

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
      console.error("Error in union operation:", error);
    } finally {
      // setIsOperationLoading(false);
    }
  }, [elements, selectedElements, idCounter, brepGraph, objectsMap]);
  const updateElementRotation = useCallback(
    (nodeId: string, rotation: THREE.Euler) => {
      setElements((prevElements) =>
        prevElements.map((element) => {
          if (element.nodeId === nodeId) {
            // Update the object in the scene
            const obj = getObject(objectsMap, nodeId);
            if (obj) {
              obj.rotation.copy(rotation);
            }

            // Return the updated element
            return {
              ...element,
              rotation: rotation,
            };
          }
          return element;
        })
      );
    },
    [objectsMap]
  );

  const ungroupSelectedElementImpl = useCallback(() => {
    // Only works with one selected element
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

  return (
    <CadCoreContext.Provider
      value={{
        // State
        elements,
        selectedElements,
        brepGraph,
        mode,
        idCounter,
        objectsMap,

        // Core operations
        setMode: handleSetMode,
        addElement,
        removeElement,
        updateElementPosition,
        selectElement,
        deselectElement,
        deselectAll,
        unionSelectedElements: unionSelectedElementsImpl,

        updateElementRotation,
        // Object access methods
        getObject: (nodeId) => getObjectImpl(nodeId),
        getAllObjects: () => getAllObjects(objectsMap),
        createMeshFromBrep,
        ungroupSelectedElement: ungroupSelectedElementImpl,
      }}
    >
      {children}
    </CadCoreContext.Provider>
  );
};

// Custom hook for using the CAD core operations
export const useCadCore = () => {
  const context = useContext(CadCoreContext);
  if (context === undefined) {
    throw new Error("useCadCore must be used within a CadCoreProvider");
  }
  return context;
};
