// src/contexts/CadCoreContext.tsx
import React, { createContext, useContext, useState, ReactNode } from "react";
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

  // Object access
  getObject: (nodeId: string) => THREE.Object3D | undefined;
  getAllObjects: () => Map<string, THREE.Object3D>;

  // For creating objects
  createMeshFromBrep: (brep: Brep) => THREE.Mesh;
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
  const handleSetMode = (newMode: SceneMode) => {
    const result = handleSetModeOp(elements, newMode, objectsMap);
    setElements(result.updatedElements);
    setMode(result.mode);
    setSelectedElements([]);
  };

  // Element manipulation methods
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
      objectsMap,
      object
    );
    setElements(result.updatedElements);
    setIdCounter(result.nextId);
    return result.nodeId;
  };

  const removeElement = (nodeId: string) => {
    const result = removeElementOp(
      elements,
      selectedElements,
      nodeId,
      objectsMap
    );
    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
  };

  const updateElementPosition = (nodeId: string, position: THREE.Vector3) => {
    const updatedElements = updateElementPositionOp(
      elements,
      nodeId,
      position,
      objectsMap
    );
    setElements(updatedElements);
  };

  const selectElement = (nodeId: string) => {
    const result = selectElementOp(
      elements,
      selectedElements,
      nodeId,
      objectsMap
    );
    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
  };

  const deselectElement = (nodeId: string) => {
    const result = deselectElementOp(
      elements,
      selectedElements,
      nodeId,
      objectsMap
    );
    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
  };

  const deselectAll = () => {
    const result = handleSetModeOp(elements, mode, objectsMap);
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
      objectsMap
    );

    setElements(result.updatedElements);
    setSelectedElements(result.updatedSelectedElements);
    setIdCounter(result.nextIdCounter);
  };

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
        unionSelectedElements,

        // Object access methods
        getObject: (nodeId) => getObject(objectsMap, nodeId),
        getAllObjects: () => getAllObjects(objectsMap),
        createMeshFromBrep,
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
