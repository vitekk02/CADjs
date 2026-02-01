import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { ShapeType, useCadVisualizer } from "../contexts/VisualizerContext";

interface UseDrawModeResult {
  handleDrawMode: (event: MouseEvent) => void;
  previewMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  isDrawingRef: React.MutableRefObject<boolean>;
  startPointRef: React.MutableRefObject<THREE.Vector3 | null>;
  cleanupPreview: () => void;
}

export function useDrawMode(): UseDrawModeResult {
  const {
    camera,
    renderer,
    scene,
    getMouseIntersection,
    drawShape,
    forceSceneUpdate,
    customShapeInProgress,
    handleCustomShapePoint,
    customShapePoints,
    createCustomShapePreview,
    showGroundPlane,
  } = useCadVisualizer();

  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const lastClickTimeRef = useRef<number | null>(null);
  const { currentShape } = useCadVisualizer();

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

  const handleDrawMode = (event: MouseEvent) => {
    if (event.button !== 0) return;

    let point = getMouseIntersection(event);
    if (!point) return;

    if (showGroundPlane) {
      point = snapToGrid(point);
    }

    if (event.type === "mousedown") {
      if (currentShape === "custom") {
        if (!customShapeInProgress) {
          isDrawingRef.current = true;
          startPointRef.current = point.clone();
          handleCustomShapePoint(point);
        } else {
          const isDoubleClick =
            lastClickTimeRef.current &&
            Date.now() - lastClickTimeRef.current < 300;

          if (isDoubleClick) {
            handleCustomShapePoint(point, true);
            isDrawingRef.current = false;
            startPointRef.current = null;
            cleanupPreview();
          } else {
            handleCustomShapePoint(point);
          }
          lastClickTimeRef.current = Date.now();
        }
      } else {
        isDrawingRef.current = true;
        startPointRef.current = point.clone();
      }
    } else if (event.type === "mousemove") {
      if (!isDrawingRef.current || !startPointRef.current) return;

      if (previewMeshRef.current && scene) {
        scene.remove(previewMeshRef.current);
        previewMeshRef.current = null;
      }

      const start = startPointRef.current;
      const material = new THREE.MeshBasicMaterial({
        color: 0x0088ff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      });

      let previewMesh: THREE.Mesh;

      switch (currentShape) {
        case "rectangle":
          const width = point.x - start.x;
          const height = point.y - start.y;
          const rectGeometry = new THREE.PlaneGeometry(
            Math.abs(width),
            Math.abs(height)
          );
          previewMesh = new THREE.Mesh(rectGeometry, material);
          previewMesh.position.set(
            start.x + width / 2,
            start.y + height / 2,
            0
          );
          break;

        case "triangle":
          const direction = new THREE.Vector3().subVectors(point, start);
          const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
          const height2 = direction.length() * 0.866;
          const thirdPoint = new THREE.Vector3().addVectors(
            start,
            new THREE.Vector3().addVectors(
              new THREE.Vector3().copy(direction).multiplyScalar(0.5),
              new THREE.Vector3().copy(perpendicular).multiplyScalar(height2)
            )
          );

          const triangleGeometry = new THREE.BufferGeometry();
          triangleGeometry.setFromPoints([
            new THREE.Vector3(start.x, start.y, start.z),
            new THREE.Vector3(point.x, point.y, point.z),
            new THREE.Vector3(thirdPoint.x, thirdPoint.y, thirdPoint.z),
          ]);
          triangleGeometry.setIndex([0, 1, 2]);
          triangleGeometry.computeVertexNormals();

          previewMesh = new THREE.Mesh(triangleGeometry, material);
          break;

        case "circle":
          const radius = new THREE.Vector3().subVectors(point, start).length();
          const circleGeometry = new THREE.CircleGeometry(radius, 32);
          previewMesh = new THREE.Mesh(circleGeometry, material);
          previewMesh.position.copy(start);
          break;

        case "custom":
          if (previewMeshRef.current && scene) {
            scene.remove(previewMeshRef.current);
            previewMeshRef.current = null;
          }

          if (customShapePoints.length > 0 && scene) {
            const previewMesh = createCustomShapePreview(point);
            scene.add(previewMesh);
            previewMeshRef.current = previewMesh;
          }
          break;

        default:
          const defaultGeometry = new THREE.PlaneGeometry(1, 1);
          previewMesh = new THREE.Mesh(defaultGeometry, material);
          break;
      }

      if (scene && previewMesh) {
        scene.add(previewMesh);
        previewMeshRef.current = previewMesh;
      }
    } else if (event.type === "mouseup") {
      if (!isDrawingRef.current || !startPointRef.current) return;

      cleanupPreview();

      drawShape(startPointRef.current, point);

      isDrawingRef.current = false;
      startPointRef.current = null;
      forceSceneUpdate();
    }
  };

  const cleanupPreview = () => {
    if (previewMeshRef.current && scene) {
      scene.remove(previewMeshRef.current);

      if (previewMeshRef.current.geometry) {
        previewMeshRef.current.geometry.dispose();
      }

      if (previewMeshRef.current.material) {
        if (Array.isArray(previewMeshRef.current.material)) {
          previewMeshRef.current.material.forEach((m) => m.dispose());
        } else {
          previewMeshRef.current.material.dispose();
        }
      }

      previewMeshRef.current = null;
    }
  };

  return {
    handleDrawMode,
    previewMeshRef,
    isDrawingRef,
    startPointRef,
    cleanupPreview,
  };
}
