// src/contexts/CadVisualizerContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useRef,
  ReactNode,
  useEffect,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { Brep, Edge, Face, Vertex } from "../geometry";
import { createTriangleBRep } from "../models/2d/triangle";
import { createCircleBRep } from "../models/2d/circle";
import { SceneElement } from "../scene-operations/types";
import { useCadCore } from "./CoreContext";

// Define types for shape creation
export type ShapeType = "rectangle" | "triangle" | "circle";

// Define the visualizer context type (UI helpers and visualization-specific functionality)
interface CadVisualizerContextType {
  // References to Three.js objects
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: OrbitControls | null;

  // Drawing-specific state
  currentShape: ShapeType;
  setCurrentShape: (shape: ShapeType) => void;

  // High-level drawing operations
  drawShape: (start: THREE.Vector3, end: THREE.Vector3) => void;

  // Helper visualization methods
  createEdgeHelpers: (element: SceneElement) => THREE.LineSegments | null;
  createVertexHelpers: (element: SceneElement) => THREE.Points | null;

  // Mouse interaction helpers
  getMouseIntersection: (event: MouseEvent) => THREE.Vector3 | null;

  // DOM management
  mountRenderer: (container: HTMLDivElement) => void;
  unmountRenderer: () => void;

  // Visualization effects
  highlightElement: (nodeId: string) => void;
  unhighlightElement: (nodeId: string) => void;

  // Force scene update
  forceSceneUpdate: () => void;
}

export const CadVisualizerContext = createContext<
  CadVisualizerContextType | undefined
>(undefined);

export const CadVisualizerProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { addElement, elements, getObject } = useCadCore();

  // Three.js object references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Drawing state
  const [currentShape, setCurrentShape] = useState<ShapeType>("rectangle");
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const previewShapeRef = useRef<THREE.Mesh | null>(null);

  // For forcing updates to the scene
  const [forceUpdate, setForceUpdate] = useState(0);

  // Initialize scene, camera, renderer
  const initSceneObjects = () => {
    // Setup scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x808080);

    // Setup camera
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 10);

    // Setup renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    // Store refs
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    return { scene, camera, renderer };
  };

  // Mount the renderer to a DOM element
  const mountRenderer = (container: HTMLDivElement) => {
    containerRef.current = container;

    const { scene, camera, renderer } = initSceneObjects();

    // Add to DOM
    container.appendChild(renderer.domElement);

    // Setup controls
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

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle window resizing
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    // Return cleanup function
    return () => {
      window.removeEventListener("resize", handleResize);
      controls.dispose();
    };
  };

  // Unmount the renderer
  const unmountRenderer = () => {
    if (containerRef.current && rendererRef.current) {
      containerRef.current.removeChild(rendererRef.current.domElement);
    }
  };

  // Helper to get mouse intersection with drawing plane
  const getMouseIntersection = (event: MouseEvent): THREE.Vector3 | null => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return null;

    const drawingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const raycaster = new THREE.Raycaster();

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

  // Create and visualize a rectangle
  const createRectangle = (start: THREE.Vector3, end: THREE.Vector3) => {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    // Create B-rep vertices, edges, and face
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

    // Calculate center position
    const position = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0);

    // Create visual mesh
    const width = maxX - minX;
    const height = maxY - minY;
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0000ff,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);

    // Add to scene via core context
    addElement(brep, position, mesh);
  };

  // Create and visualize a triangle
  const createTriangle = (start: THREE.Vector3, end: THREE.Vector3) => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const perpendicular = new THREE.Vector3(
      -direction.y,
      direction.x,
      0
    ).normalize();
    const height = direction.length() * 0.866; // Height for equilateral triangle
    const thirdPoint = new THREE.Vector3().addVectors(
      start,
      new THREE.Vector3().addVectors(
        new THREE.Vector3().copy(direction).multiplyScalar(0.5),
        new THREE.Vector3().copy(perpendicular).multiplyScalar(height)
      )
    );

    // Create B-rep
    const brep = createTriangleBRep(start, end, thirdPoint);

    // Calculate center
    const center = new THREE.Vector3()
      .add(start)
      .add(end)
      .add(thirdPoint)
      .divideScalar(3);

    // Create visual mesh
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

    // Add to scene via core context
    addElement(brep, center, mesh);
  };

  // Create and visualize a circle
  const createCircle = (center: THREE.Vector3, radius: number) => {
    // Create B-rep
    const brep = createCircleBRep(center, radius);

    // Create visual mesh
    const geometry = new THREE.CircleGeometry(radius, 32);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0000ff,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);

    // Add to scene via core context
    addElement(brep, center, mesh);
  };

  // Generic shape drawing function based on current shape type
  const drawShape = (start: THREE.Vector3, end: THREE.Vector3) => {
    switch (currentShape) {
      case "rectangle":
        createRectangle(start, end);
        break;
      case "triangle":
        createTriangle(start, end);
        break;
      case "circle":
        const radius = new THREE.Vector3().subVectors(end, start).length();
        createCircle(start, radius);
        break;
    }
  };

  // Create edge helpers for visualization
  const createEdgeHelpers = (
    element: SceneElement
  ): THREE.LineSegments | null => {
    if (!element || !element.brep.edges || element.brep.edges.length === 0)
      return null;

    const edgePositions: number[] = [];
    element.brep.edges.forEach((edge) => {
      edgePositions.push(
        edge.start.x,
        edge.start.y,
        edge.start.z,
        edge.end.x,
        edge.end.y,
        edge.end.z
      );
    });

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePositions, 3)
    );

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xff00ff,
      linewidth: 2,
    });
    const lines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    lines.position.copy(element.position);

    return lines;
  };

  // Create vertex helpers for visualization
  const createVertexHelpers = (element: SceneElement): THREE.Points | null => {
    if (
      !element ||
      !element.brep.vertices ||
      element.brep.vertices.length === 0
    )
      return null;

    const vertexPositions: number[] = [];
    element.brep.vertices.forEach((v) => {
      vertexPositions.push(v.x, v.y, v.z);
    });

    const vertexGeometry = new THREE.BufferGeometry();
    vertexGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertexPositions, 3)
    );

    const vertexMaterial = new THREE.PointsMaterial({
      color: 0xffff00,
      size: 0.1,
      sizeAttenuation: false,
    });

    const points = new THREE.Points(vertexGeometry, vertexMaterial);
    points.position.copy(element.position);

    return points;
  };

  // Highlight an element (e.g., on hover)
  const highlightElement = (nodeId: string) => {
    const object = getObject(nodeId);
    if (object instanceof THREE.Mesh) {
      (object.material as THREE.MeshStandardMaterial).color.set(0xff9900);
      (object.material as THREE.MeshStandardMaterial).needsUpdate = true;
    } else if (object instanceof THREE.Group) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshStandardMaterial).color.set(0xff9900);
          (child.material as THREE.MeshStandardMaterial).needsUpdate = true;
        }
      });
    }
  };

  // Unhighlight an element
  const unhighlightElement = (nodeId: string) => {
    const object = getObject(nodeId);
    const element = elements.find((el) => el.nodeId === nodeId);

    // If selected, keep it red, otherwise return to blue
    const color = element?.selected ? 0xff0000 : 0x0000ff;

    if (object instanceof THREE.Mesh) {
      (object.material as THREE.MeshStandardMaterial).color.set(color);
      (object.material as THREE.MeshStandardMaterial).needsUpdate = true;
    } else if (object instanceof THREE.Group) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshStandardMaterial).color.set(color);
          (child.material as THREE.MeshStandardMaterial).needsUpdate = true;
        }
      });
    }
  };

  // Force scene update
  const forceSceneUpdate = () => {
    setForceUpdate((prev) => prev + 1);
  };

  // Scene synchronization effect - keep Three.js scene in sync with core state
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    console.log("Scene sync running, elements:", elements.length);

    // Ensure all elements have corresponding objects in the scene
    elements.forEach((element) => {
      const obj = getObject(element.nodeId);
      if (obj) {
        if (!scene.children.includes(obj)) {
          console.log("Adding missing object to scene:", element.nodeId);
          scene.add(obj);
        }
      } else {
        console.error("Missing object for element:", element.nodeId);
      }
    });

    // Find objects to remove
    const validNodeIds = new Set(elements.map((el) => el.nodeId));
    const objectsToRemove = scene.children.filter(
      (child) =>
        // Skip special objects
        !(child instanceof THREE.Light) &&
        !(child instanceof THREE.Camera) &&
        child.type !== "GridHelper" &&
        child.type !== "AxesHelper" &&
        // Check if this object should remain
        !Array.from(validNodeIds).some((id) => getObject(id) === child)
    );

    // Remove stale objects
    if (objectsToRemove.length > 0) {
      console.log("Removing objects:", objectsToRemove.length);
      objectsToRemove.forEach((child) => {
        scene.remove(child);
      });
    }
  }, [elements, forceUpdate]);

  return (
    <CadVisualizerContext.Provider
      value={{
        // Three.js objects
        scene: sceneRef.current,
        camera: cameraRef.current,
        renderer: rendererRef.current,
        controls: controlsRef.current,

        // Drawing state
        currentShape,
        setCurrentShape,

        // Drawing operations
        drawShape,

        // Helper visualizations
        createEdgeHelpers,
        createVertexHelpers,

        // Mouse interaction
        getMouseIntersection,

        // DOM management
        mountRenderer,
        unmountRenderer,

        // Effects
        highlightElement,
        unhighlightElement,

        // Scene updates
        forceSceneUpdate,
      }}
    >
      {children}
    </CadVisualizerContext.Provider>
  );
};

// Custom hook for using the CAD visualizer
export const useCadVisualizer = () => {
  const context = useContext(CadVisualizerContext);
  if (context === undefined) {
    throw new Error(
      "useCadVisualizer must be used within a CadVisualizerProvider"
    );
  }
  return context;
};
