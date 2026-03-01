import { useCallback, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type NamedView =
  | "front"
  | "back"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "isometric";

interface ViewDefinition {
  position: THREE.Vector3;
  up: THREE.Vector3;
}

const CAMERA_DISTANCE = 10;

const VIEW_DEFINITIONS: Record<NamedView, ViewDefinition> = {
  front: {
    position: new THREE.Vector3(0, 0, CAMERA_DISTANCE),
    up: new THREE.Vector3(0, 1, 0),
  },
  back: {
    position: new THREE.Vector3(0, 0, -CAMERA_DISTANCE),
    up: new THREE.Vector3(0, 1, 0),
  },
  top: {
    position: new THREE.Vector3(0, CAMERA_DISTANCE, 0),
    up: new THREE.Vector3(0, 0, -1),
  },
  bottom: {
    position: new THREE.Vector3(0, -CAMERA_DISTANCE, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  left: {
    position: new THREE.Vector3(-CAMERA_DISTANCE, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  },
  right: {
    position: new THREE.Vector3(CAMERA_DISTANCE, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  },
  isometric: {
    position: new THREE.Vector3(
      CAMERA_DISTANCE * 0.577,
      CAMERA_DISTANCE * 0.577,
      CAMERA_DISTANCE * 0.577
    ),
    up: new THREE.Vector3(0, 1, 0),
  },
};

/** Ease-out quadratic: decelerating to zero velocity */
function easeOutQuad(t: number): number {
  return t * (2 - t);
}

export function useCameraAnimation(
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitControls | null
) {
  const animFrameRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);

  const cancelAnimation = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    isAnimatingRef.current = false;
  }, []);

  const animateToView = useCallback(
    (viewName: NamedView) => {
      if (!camera || !controls) return;

      cancelAnimation();

      const target = VIEW_DEFINITIONS[viewName];
      const startPos = camera.position.clone();
      const endPos = target.position.clone();

      // Use quaternion slerp for smooth up-vector transition
      const startUp = camera.up.clone();
      const endUp = target.up.clone();

      const startTime = performance.now();
      const duration = 400; // ms

      // Cancel animation on user orbit interaction
      const onControlChange = () => {
        cancelAnimation();
        controls.removeEventListener("start", onControlChange);
      };
      controls.addEventListener("start", onControlChange);

      isAnimatingRef.current = true;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = easeOutQuad(t);

        camera.position.lerpVectors(startPos, endPos, eased);
        camera.up.copy(startUp).lerp(endUp, eased).normalize();

        controls.target.set(0, 0, 0);
        controls.update();

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          isAnimatingRef.current = false;
          controls.removeEventListener("start", onControlChange);
        }
      };

      animFrameRef.current = requestAnimationFrame(animate);
    },
    [camera, controls, cancelAnimation]
  );

  const fitAll = useCallback(
    (
      elements: Array<{ nodeId: string }>,
      getObject: (nodeId: string) => THREE.Object3D | undefined
    ) => {
      if (!camera || !controls || elements.length === 0) return;

      cancelAnimation();

      const box = new THREE.Box3();
      let hasGeometry = false;

      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (obj) {
          box.expandByObject(obj);
          hasGeometry = true;
        }
      }

      if (!hasGeometry) return;

      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);

      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const fov = camera.fov * (Math.PI / 180);
      const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

      // Animate to fit position
      const startPos = camera.position.clone();
      const direction = camera.position.clone().sub(controls.target).normalize();
      const endPos = center.clone().add(direction.multiplyScalar(distance));

      const startTarget = controls.target.clone();
      const endTarget = center.clone();

      const startTime = performance.now();
      const duration = 400;

      isAnimatingRef.current = true;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = easeOutQuad(t);

        camera.position.lerpVectors(startPos, endPos, eased);
        controls.target.lerpVectors(startTarget, endTarget, eased);
        controls.update();

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          isAnimatingRef.current = false;
        }
      };

      animFrameRef.current = requestAnimationFrame(animate);
    },
    [camera, controls, cancelAnimation]
  );

  return { animateToView, fitAll, isAnimating: isAnimatingRef.current };
}
