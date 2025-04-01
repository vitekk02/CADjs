// src/hooks/useDrawMode.ts
import { useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { ShapeType, useCadVisualizer } from "../contexts/VisualizerContext";

interface UseDrawModeResult {
  // Event handler for draw mode
  handleDrawMode: (event: MouseEvent) => void;

  // Preview mesh ref
  previewMeshRef: React.MutableRefObject<THREE.Mesh | null>;

  // Drawing state
  isDrawingRef: React.MutableRefObject<boolean>;
  startPointRef: React.MutableRefObject<THREE.Vector3 | null>;

  // Cleanup function
  cleanupPreview: () => void;
}

export function useDrawMode(): UseDrawModeResult {
  const { drawShape, forceSceneUpdate } = useCadVisualizer();
  const { camera, renderer, scene, getMouseIntersection } = useCadVisualizer();

  // Refs to track drawing state
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);

  // Get current shape from visualizer context
  const { currentShape } = useCadVisualizer();

  // Handle drawing operations
  const handleDrawMode = (event: MouseEvent) => {
    if (event.button !== 0) return; // Left mouse button only

    const point = getMouseIntersection(event);
    if (!point) return;

    if (event.type === "mousedown") {
      isDrawingRef.current = true;
      startPointRef.current = point.clone();
    } else if (event.type === "mousemove") {
      // Only show preview when drawing
      if (!isDrawingRef.current || !startPointRef.current) return;

      // Remove any existing preview
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
          const perpendicular = new THREE.Vector3(
            -direction.y,
            direction.x,
            0
          ).normalize();
          const height2 = direction.length() * 0.866; // Height for equilateral triangle
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

        default:
          // Default fallback to rectangle
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

      // Clean up preview
      cleanupPreview();

      // Complete the drawing operation
      console.log("Drawing shape from", startPointRef.current, "to", point);

      drawShape(startPointRef.current, point);
      console.log("Drawing complete, created element");

      // Reset state
      isDrawingRef.current = false;
      startPointRef.current = null;

      // Force the scene to update (might be needed)
      forceSceneUpdate();
    }
  };

  // Clean up preview mesh
  const cleanupPreview = () => {
    if (previewMeshRef.current && scene) {
      scene.remove(previewMeshRef.current);

      // Properly dispose of geometry and materials
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
