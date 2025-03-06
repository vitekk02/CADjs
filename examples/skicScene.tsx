// src/ThreeScene.tsx
import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import {
  Brep,
  BrepConnection,
  BrepGraph,
  BrepNode,
  Edge,
  Face,
  Vertex,
} from "../src/geometry";
import { unionBrepCompound } from "../src/convertBRepToGeometry";

interface ThreeSceneProps {
  mode: "draw" | "move" | "union";
}

let globalIdCounter = 1; // for unique node IDs

const ThreeScene: React.FC<ThreeSceneProps> = ({ mode }) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // --- Three.js Core Objects ---
  const sceneRef = useRef<THREE.Scene>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // --- Connectivity Graph ---
  const brepGraphRef = useRef<BrepGraph>(new BrepGraph());

  // --- Draggable Objects (now generic Object3D to support both Mesh and Group) ---
  const draggableObjectsRef = useRef<THREE.Object3D[]>([]);

  // --- Drawing State ---
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const previewRectRef = useRef<THREE.Mesh | null>(null);

  // --- Move Mode State ---
  const selectedObjectRef = useRef<THREE.Object3D | null>(null);
  const moveOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const initialMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // --- Union Mode: Selected objects for union (generic Object3D) ---
  const selectedForUnionRef = useRef<THREE.Object3D[]>([]);

  // --- Initialization (Scene, Camera, Renderer, OrbitControls) ---
  useEffect(() => {
    const scene = new THREE.Scene();
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

  // --- Draw Mode (unchanged from before) ---
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
      const width = currentPoint.x - start.x;
      const height = currentPoint.y - start.y;
      if (previewRectRef.current) scene.remove(previewRectRef.current);
      const geometry = new THREE.PlaneGeometry(
        Math.abs(width),
        Math.abs(height)
      );
      const material = new THREE.MeshBasicMaterial({
        color: 0x0000ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      });
      const rectMesh = new THREE.Mesh(geometry, material);
      rectMesh.position.set(start.x + width / 2, start.y + height / 2, 0);
      previewRectRef.current = rectMesh;
      scene.add(rectMesh);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!isDrawingRef.current || !startPointRef.current) return;
      const endPoint = getMouseIntersection(event);
      if (!endPoint) return;
      isDrawingRef.current = false;
      let finalRectMesh: THREE.Mesh | null = null;
      if (previewRectRef.current) {
        finalRectMesh = previewRectRef.current;
        previewRectRef.current = null;
      }
      const start = startPointRef.current;
      const end = endPoint;
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);

      // Create the B‑rep.
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
      console.log("New rectangle BREP:", brep);

      const nodeId = "node_" + globalIdCounter++;
      if (finalRectMesh) {
        finalRectMesh.userData.draggable = true;
        finalRectMesh.userData.brep = brep;
        finalRectMesh.userData.nodeId = nodeId;
        draggableObjectsRef.current.push(finalRectMesh);
        const node: BrepNode = {
          id: nodeId,
          brep,
          mesh: finalRectMesh,
          connections: [],
        };
        brepGraphRef.current.addNode(node);
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
  }, [mode]);

  // --- Move Mode: Updated to use THREE.Object3D (supports groups) ---
  useEffect(() => {
    if (mode !== "move") return;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!renderer || !camera || !scene) return;
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
      const intersects = raycaster.intersectObjects(
        draggableObjectsRef.current,
        true
      );
      console.log("Intersects:", intersects);
      if (intersects.length > 0) {
        let picked = intersects[0].object;
        // If the picked object has a parent that is in our draggable list, select the parent.
        if (
          picked.parent &&
          draggableObjectsRef.current.includes(picked.parent)
        ) {
          picked = picked.parent;
        }
        selectedObjectRef.current = picked;
        const intersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(drawingPlane, intersection);
        moveOffsetRef.current
          .copy(selectedObjectRef.current.position)
          .sub(intersection);
        event.stopPropagation();
      }
      isDraggingRef.current = false;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!selectedObjectRef.current) return;
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
        selectedObjectRef.current.position.copy(
          intersection.clone().add(moveOffsetRef.current)
        );
      }
    };

    const onMouseUp = () => {
      selectedObjectRef.current = null;
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
  }, [mode]);

  // --- Union Mode: Updated Selection Handler ---
  useEffect(() => {
    if (mode !== "union") return;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!renderer || !camera || !scene) return;
    const raycaster = new THREE.Raycaster();

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(
        draggableObjectsRef.current,
        true
      );
      if (intersects.length > 0) {
        const obj = intersects[0].object;
        // Toggle selection.
        if (obj.userData.selected) {
          // If it's a Mesh, update color; if a Group, simply clear the flag.
          if (obj instanceof THREE.Mesh) {
            (obj.material as THREE.MeshBasicMaterial).color.set(0x0000ff);
          }
          obj.userData.selected = false;
          selectedForUnionRef.current = selectedForUnionRef.current.filter(
            (o) => o !== obj
          );
        } else {
          if (obj instanceof THREE.Mesh) {
            (obj.material as THREE.MeshBasicMaterial).color.set(0xff0000);
          }
          obj.userData.selected = true;
          selectedForUnionRef.current.push(obj);
        }
      }
    };

    const canvas = renderer.domElement;
    canvas.addEventListener("mousedown", onMouseDown);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
    };
  }, [mode]);

  // --- Union Selected Button Handler ---
  const unionSelected = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const selected = selectedForUnionRef.current;
    if (selected.length < 2) {
      alert("Select at least 2 objects to union.");
      return;
    }
    // Create a compound BRep using our resolver.
    let compoundBrep = unionBrepCompound(
      selected[0].userData.brep as Brep,
      selected[1].userData.brep as Brep
    );
    if (selected.length > 2) {
      for (let i = 2; i < selected.length; i++) {
        compoundBrep = unionBrepCompound(
          compoundBrep,
          selected[i].userData.brep as Brep
        );
      }
    }
    // Create a new group and attach selected objects.
    const group = new THREE.Group();
    selected.forEach((obj) => {
      group.attach(obj);
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshBasicMaterial).color.set(0x0000ff);
      }
      obj.userData.selected = false;
      // Remove from draggable list.
      const idx = draggableObjectsRef.current.indexOf(obj);
      if (idx > -1) draggableObjectsRef.current.splice(idx, 1);
    });
    scene.add(group);
    draggableObjectsRef.current.push(group);
    const nodeId = "node_" + globalIdCounter++;
    group.userData.nodeId = nodeId;
    group.userData.brep = compoundBrep;
    const newNode: BrepNode = {
      id: nodeId,
      brep: compoundBrep,
      mesh: group,
      connections: [],
    };
    brepGraphRef.current.addNode(newNode);
    selected.forEach((obj) => {
      const sourceId = obj.userData.nodeId;
      if (sourceId) {
        const connection: BrepConnection = {
          targetId: nodeId,
          connectionType: "union",
        };
        brepGraphRef.current.addConnection(sourceId, connection);
      }
    });
    selectedForUnionRef.current = [];
  };

  return (
    <div style={{ position: "relative" }} ref={mountRef}>
      {mode === "union" && (
        <button
          onClick={unionSelected}
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 1,
            padding: "8px 12px",
          }}
        >
          Union Selected
        </button>
      )}
    </div>
  );
};

export default ThreeScene;
