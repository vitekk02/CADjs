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
