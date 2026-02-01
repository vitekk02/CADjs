import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { Brep, Edge, Face, Vertex } from "../src/geometry";
import { useScene } from "../src/contexts/SceneContext";
import { createTriangleBRep } from "../src/models/2d/triangle";
import { createCircleBRep } from "../src/models/2d/circle";

const SkicScene: React.FC = () => {
  const {
    elements,
    selectedElements,
    mode,
    addElement,
    updateElementPosition,
    selectElement,
    deselectElement,
    unionSelectedElements,
    getObject,
    currentShape,
    setCurrentShape,
  } = useScene();

  const mountRef = useRef<HTMLDivElement>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const previewShapeRef = useRef<THREE.Mesh | null>(null);

  const moveOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const initialMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const selectedMoveNodeIdRef = useRef<string | null>(null);

  const [forceUpdate, setForceUpdate] = useState(0);

  const createTriangle = (start: THREE.Vector3, end: THREE.Vector3) => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const perpendicular = new THREE.Vector3(
      -direction.y,
      direction.x,
      0
    ).normalize();
    const height = direction.length() * 0.866;
    const thirdPoint = new THREE.Vector3().addVectors(
      start,
      new THREE.Vector3().addVectors(
        new THREE.Vector3().copy(direction).multiplyScalar(0.5),
        new THREE.Vector3().copy(perpendicular).multiplyScalar(height)
      )
    );

    const brep = createTriangleBRep(start, end, thirdPoint);

    const center = new THREE.Vector3()
      .add(start)
      .add(end)
      .add(thirdPoint)
      .divideScalar(3);

    const vertices = [
      new THREE.Vector3(start.x, start.y, start.z),
      new THREE.Vector3(end.x, end.y, end.z),
      new THREE.Vector3(thirdPoint.x, thirdPoint.y, thirdPoint.z),
    ];

    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(vertices);
    geometry.computeVertexNormals();
    geometry.setIndex([0, 1, 2]);

    const material = new THREE.MeshStandardMaterial({
      color: 0x0000ff,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(new THREE.Vector3(0, 0, 0));

    addElement(brep, center, mesh);
  };

  const createCircle = (center: THREE.Vector3, radius: number) => {
    const brep = createCircleBRep(center, radius);

    const geometry = new THREE.CircleGeometry(radius, 32);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0000ff,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);

    addElement(brep, center, mesh);
  };

  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x808080);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 10);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current?.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.mouseButtons = {
      LEFT: null, // reserve left-click
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.RIGHT,
    };
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.enablePan = true;
    controlsRef.current = controls;

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      controls.dispose();
    };
  }, []);

  useEffect(() => {
    const handleShapeTypeChange = (event: CustomEvent) => {
      setCurrentShape(event.detail);
    };

    window.addEventListener(
      "shapeTypeChange",
      handleShapeTypeChange as EventListener
    );
    return () => {
      window.removeEventListener(
        "shapeTypeChange",
        handleShapeTypeChange as EventListener
      );
    };
  }, []);

  useEffect(() => {
    if (mode !== "draw") return;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!renderer || !camera || !scene) return;
    const raycaster = new THREE.Raycaster();
    const drawingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    const getMouseIntersection = (event: MouseEvent): THREE.Vector3 | null => {
      if (event.button !== 0) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const intersection = new THREE.Vector3();
      const result = raycaster.ray.intersectPlane(drawingPlane, intersection);
      return result ? intersection : null;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const point = getMouseIntersection(event);
      if (point) {
        isDrawingRef.current = true;
        startPointRef.current = point.clone();
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!isDrawingRef.current || !startPointRef.current) return;
      const currentPoint = getMouseIntersection(event);
      if (!currentPoint) return;
      const start = startPointRef.current;

      if (previewShapeRef.current) {
        scene.remove(previewShapeRef.current);
        previewShapeRef.current = null;
      }

      let previewMesh: THREE.Mesh;
      const previewMaterial = new THREE.MeshBasicMaterial({
        color: 0x0000ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      });

      switch (currentShape) {
        case "rectangle":
          const width = currentPoint.x - start.x;
          const height = currentPoint.y - start.y;
          const rectGeometry = new THREE.PlaneGeometry(
            Math.abs(width),
            Math.abs(height)
          );
          previewMesh = new THREE.Mesh(rectGeometry, previewMaterial);
          previewMesh.position.set(
            start.x + width / 2,
            start.y + height / 2,
            0
          );
          break;

        case "triangle":
          const direction = new THREE.Vector3().subVectors(currentPoint, start);
          const perpendicular = new THREE.Vector3(
            -direction.y,
            direction.x,
            0
          ).normalize();
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
            new THREE.Vector3(currentPoint.x, currentPoint.y, currentPoint.z),
            new THREE.Vector3(thirdPoint.x, thirdPoint.y, thirdPoint.z),
          ]);
          triangleGeometry.setIndex([0, 1, 2]);
          triangleGeometry.computeVertexNormals();

          previewMesh = new THREE.Mesh(triangleGeometry, previewMaterial);
          break;

        case "circle":
          const radius = new THREE.Vector3()
            .subVectors(currentPoint, start)
            .length();
          const circleGeometry = new THREE.CircleGeometry(radius, 32);
          previewMesh = new THREE.Mesh(circleGeometry, previewMaterial);
          previewMesh.position.copy(start);
          break;

        default:
          const defaultGeometry = new THREE.PlaneGeometry(1, 1);
          previewMesh = new THREE.Mesh(defaultGeometry, previewMaterial);
          previewMesh.position.copy(start);
      }

      previewShapeRef.current = previewMesh;
      scene.add(previewMesh);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!isDrawingRef.current || !startPointRef.current) return;
      const endPoint = getMouseIntersection(event);
      if (!endPoint) return;
      isDrawingRef.current = false;

      if (previewShapeRef.current) {
        scene.remove(previewShapeRef.current);
        previewShapeRef.current = null;
      }
      const start = startPointRef.current;
      const end = endPoint;

      switch (currentShape) {
        case "rectangle":
          const minX = Math.min(start.x, end.x);
          const maxX = Math.max(start.x, end.x);
          const minY = Math.min(start.y, end.y);
          const maxY = Math.max(start.y, end.y);

          const v1 = new Vertex(minX, minY, 0);
          const v2 = new Vertex(maxX, minY, 0);
          const v3 = new Vertex(maxX, maxY, 0);
          const v4 = new Vertex(minX, maxY, 0);
          const e1 = new Edge(v1, v2);
          const e2 = new Edge(v2, v3);
          const e3 = new Edge(v3, v4);
          const e4 = new Edge(v4, v1);
          const face = new Face([v1, v2, v3, v4]);
          const brep = new Brep([v1, v2, v3, v4], [e1, e2, e3, e4], [face]);

          const position = new THREE.Vector3(
            (minX + maxX) / 2,
            (minY + maxY) / 2,
            0
          );

          const width = maxX - minX;
          const height = maxY - minY;
          const geometry = new THREE.PlaneGeometry(width, height);
          const material = new THREE.MeshStandardMaterial({
            color: 0x0000ff,
            side: THREE.DoubleSide,
          });
          const rectMesh = new THREE.Mesh(geometry, material);
          rectMesh.position.copy(position);

          addElement(brep, position, rectMesh);
          break;

        case "triangle":
          createTriangle(start, end);
          break;

        case "circle":
          const radius = new THREE.Vector3().subVectors(end, start).length();
          createCircle(start, radius);
          break;
      }

      startPointRef.current = null;
    };

    const canvas = renderer.domElement;
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
    };
  }, [mode, addElement, currentShape]);

  useEffect(() => {
    if (mode !== "move") return;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    const raycaster = new THREE.Raycaster();
    const drawingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const threshold = 5;

    const getMouseIntersection = (event: MouseEvent): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const intersection = new THREE.Vector3();
      const result = raycaster.ray.intersectPlane(drawingPlane, intersection);
      return result ? intersection : null;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      initialMousePosRef.current = { x: event.clientX, y: event.clientY };
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);

      const objects: THREE.Object3D[] = [];
      elements.forEach((el) => {
        const obj = getObject(el.nodeId);
        if (obj) objects.push(obj);
      });

      const intersects = raycaster.intersectObjects(objects, true);

      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        for (const el of elements) {
          const obj = getObject(el.nodeId);
          if (
            obj === pickedObject ||
            (pickedObject.parent && obj === pickedObject.parent)
          ) {
            selectedMoveNodeIdRef.current = el.nodeId;
            const intersection = new THREE.Vector3();
            raycaster.ray.intersectPlane(drawingPlane, intersection);
            moveOffsetRef.current.copy(el.position).sub(intersection);
            event.stopPropagation();
            break;
          }
        }
      }
      isDraggingRef.current = false;
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!selectedMoveNodeIdRef.current) return;

      if (initialMousePosRef.current) {
        const dx = event.clientX - initialMousePosRef.current.x;
        const dy = event.clientY - initialMousePosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > threshold) {
          isDraggingRef.current = true;
        }
      }

      if (isDraggingRef.current) {
        const intersection = getMouseIntersection(event);
        if (!intersection) return;

        const newPosition = intersection.clone().add(moveOffsetRef.current);

        // Update position using the context method
        updateElementPosition(selectedMoveNodeIdRef.current, newPosition);
      }
    };

    const onMouseUp = () => {
      selectedMoveNodeIdRef.current = null;
      initialMousePosRef.current = null;
      isDraggingRef.current = false;
    };

    const canvas = renderer.domElement;
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
    };
  }, [mode, elements, updateElementPosition, getObject]);

  // --- Union Mode ---
  useEffect(() => {
    if (mode !== "union") return;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    const raycaster = new THREE.Raycaster();

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);

      const objects: THREE.Object3D[] = [];
      elements.forEach((el) => {
        const obj = getObject(el.nodeId);
        if (obj) objects.push(obj);
      });

      const intersects = raycaster.intersectObjects(objects, true);

      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        for (const el of elements) {
          const obj = getObject(el.nodeId);
          if (
            obj === pickedObject ||
            (pickedObject.parent && obj === pickedObject.parent)
          ) {
            if (selectedElements.includes(el.nodeId)) {
              deselectElement(el.nodeId);
            } else {
              selectElement(el.nodeId);
            }
            break;
          }
        }
      }
    };

    const canvas = renderer.domElement;
    canvas.addEventListener("mousedown", onMouseDown);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
    };
  }, [
    mode,
    elements,
    selectedElements,
    selectElement,
    deselectElement,
    getObject,
  ]);

  // listen for forced updates
  useEffect(() => {
    const handleSceneUpdate = () => {
      // This will force the scene sync effect to run
      setForceUpdate((prev) => prev + 1);
    };

    window.addEventListener("sceneUpdate", handleSceneUpdate);
    return () => {
      window.removeEventListener("sceneUpdate", handleSceneUpdate);
    };
  }, []);

  // Then in your component, replace the scene sync effect
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    elements.forEach((element) => {
      const obj = getObject(element.nodeId);
      if (obj) {
        if (!scene.children.includes(obj)) {
          scene.add(obj);
        }
      }
    });

    // Find all THREE.js objects that should be removed from the scene
    const validNodeIds = new Set(elements.map((el) => el.nodeId));
    const objectsToRemove = scene.children.filter(
      (child) =>
        // Skip special objects
        !(child instanceof THREE.Light) &&
        !(child instanceof THREE.Camera) &&
        child.type !== "GridHelper" &&
        child.type !== "AxesHelper" &&
        child.type !== "AxesHelper" &&
        // Check if this object should remain
        !Array.from(validNodeIds).some((id) => getObject(id) === child)
    );

    objectsToRemove.forEach((child) => {
      scene.remove(child);
    });
  }, [elements, getObject, forceUpdate]);

  return (
    <div style={{ position: "relative" }} ref={mountRef}>
      {mode === "union" && selectedElements.length >= 2 && (
        <button
          onClick={() => {
            unionSelectedElements();
            // Force a re-render of the scene
            setForceUpdate((prev) => prev + 1);
          }}
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 1,
            padding: "8px 12px",
            backgroundColor: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Union Selected
        </button>
      )}
    </div>
  );
};

export default SkicScene;
