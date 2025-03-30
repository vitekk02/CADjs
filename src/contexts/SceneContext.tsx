// src/contexts/SceneContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useRef,
} from "react";
import * as THREE from "three";
import { Brep, BrepGraph, CompoundBrep } from "../geometry";

// Import the extracted operations
import {
  createMeshFromBrep,
  getAllFaces,
  getObject,
  getAllObjects,
} from "../scene-operations/mesh-operations";
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

// Define the context type
interface SceneContextType {
  // State
  elements: SceneElement[];
  selectedElements: string[];
  brepGraph: BrepGraph;
  mode: SceneMode;
  idCounter: number;

  // State update methods
  setMode: (mode: SceneMode) => void;

  // Element manipulation methods
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

  // Object access methods
  getObject: (nodeId: string) => THREE.Object3D | undefined;
  getAllObjects: () => Map<string, THREE.Object3D>;

  currentShape: "rectangle" | "triangle" | "circle";
  setCurrentShape: (shape: "rectangle" | "triangle" | "circle") => void;
}

const SceneContext = createContext<SceneContextType | undefined>(undefined);

// Provider component
export const SceneProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  // State hooks
  const [elements, setElements] = useState<SceneElement[]>([]);
  const [selectedElements, setSelectedElements] = useState<string[]>([]);
  const [brepGraph] = useState<BrepGraph>(new BrepGraph());
  const [mode, setMode] = useState<SceneMode>("draw");
  const [idCounter, setIdCounter] = useState(0);
  const [currentShape, setCurrentShape] = useState<
    "rectangle" | "triangle" | "circle"
  >("rectangle");

  // Ref to store Three.js objects
  const objectsRef = useRef<Map<string, THREE.Object3D>>(new Map());

  // Update mode and deselect all elements
  const handleSetMode = (newMode: SceneMode) => {
    const result = handleSetModeOp(elements, newMode, objectsRef.current);

    setElements(result.updatedElements);
    setMode(result.mode);
    setSelectedElements([]);
  };

  // Method to add a new element
  const addElement = (
    brep: Brep,
    position: THREE.Vector3,
    object?: THREE.Object3D
  ) => {
    const result = addElementOp(
      elements,
      brep,
      position,
      idCounter,
      objectsRef.current,
      object
    );

    setElements(result.updatedElements);
    setIdCounter(result.nextId);
  };

  // Method to remove an element
  const removeElement = (nodeId: string) => {
    const result = removeElementOp(
      elements,
      selectedElements,
      nodeId,
      objectsRef.current
    );

    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
  };

  // Method to update element position
  const updateElementPosition = (nodeId: string, position: THREE.Vector3) => {
    const updatedElements = updateElementPositionOp(
      elements,
      nodeId,
      position,
      objectsRef.current
    );

    setElements(updatedElements);
  };

  const selectElement = (nodeId: string) => {
    const result = selectElementOp(
      elements,
      selectedElements,
      nodeId,
      objectsRef.current
    );

    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
  };

  const deselectElement = (nodeId: string) => {
    const result = deselectElementOp(
      elements,
      selectedElements,
      nodeId,
      objectsRef.current
    );

    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
  };

  const deselectAll = () => {
    // Use the handleSetMode operation which already deselects all elements
    // but keep the current mode
    const result = handleSetModeOp(elements, mode, objectsRef.current);

    setElements(result.updatedElements);
    setSelectedElements([]);
  };

  const unionSelectedElements = () => {
    if (selectedElements.length < 2) return;

    const result = unionSelectedElementsOp(
      elements,
      selectedElements,
      idCounter,
      brepGraph,
      objectsRef.current
    );

    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
    setIdCounter(result.nextIdCounter);

    // Force scene update
    setTimeout(() => {
      window.dispatchEvent(new Event("sceneUpdate"));
    }, 0);
  };

  return (
    <SceneContext.Provider
      value={{
        // State
        elements,
        selectedElements,
        brepGraph,
        mode,
        idCounter,

        // State setter methods
        setMode: handleSetMode,

        // Element manipulation methods
        addElement,
        removeElement,
        updateElementPosition,
        selectElement,
        deselectElement,
        deselectAll,
        unionSelectedElements,

        // Object access methods
        getObject: (nodeId) => getObject(objectsRef.current, nodeId),
        getAllObjects: () => getAllObjects(objectsRef.current),
        currentShape,
        setCurrentShape,
      }}
    >
      {children}
    </SceneContext.Provider>
  );
};

// Custom hook for using the scene context
export const useScene = () => {
  const context = useContext(SceneContext);
  if (context === undefined) {
    throw new Error("useScene must be used within a SceneProvider");
  }
  return context;
};

// Re-export the types from scene-operations for convenience
export type { SceneElement, SceneMode };
