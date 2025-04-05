// src/contexts/CadVisualizerContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useRef,
  ReactNode,
  useEffect,
  useCallback,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { Brep, CompoundBrep, Edge, Face, Vertex } from "../geometry";
import { createTriangleBRep } from "../models/2d/triangle";
import { createCircleBRep } from "../models/2d/circle";
import { SceneElement } from "../scene-operations/types";
import { useCadCore } from "./CoreContext";

// Define types for shape creation
export type ShapeType = "rectangle" | "triangle" | "circle" | "custom";

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
  createVertexHelpers: (element: SceneElement) => THREE.Object3D | null;
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

  customShapePoints: THREE.Vector3[];
  handleCustomShapePoint: (
    point: THREE.Vector3,
    isComplete?: boolean
  ) => THREE.Mesh | null;
  createCustomShapePreview: (currentPoint: THREE.Vector3) => THREE.Mesh;
  resetCustomShape: () => void;
  customShapeInProgress: boolean;

  showGroundPlane: boolean;
  toggleGroundPlane: () => void;

  cursorPosition: THREE.Vector3 | null;
  updateCursorPosition: (event: MouseEvent) => void;
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
  // For custom shape drawing
  const [customShapePoints, setCustomShapePoints] = useState<THREE.Vector3[]>(
    []
  );
  const customShapeInProgressRef = useRef<boolean>(false);
  // Drawing state
  const [currentShape, setCurrentShape] = useState<ShapeType>("rectangle");

  // For forcing updates to the scene
  const [forceUpdate, setForceUpdate] = useState(0);
  const [showGroundPlane, setShowGroundPlane] = useState<boolean>(true);
  const groundPlaneRef = useRef<THREE.Group | null>(null);

  // Toggle ground plane visibility
  const toggleGroundPlane = useCallback(() => {
    setShowGroundPlane((prev) => !prev);
  }, []);

  // Initialize scene, camera, renderer
  const initSceneObjects = useCallback(() => {
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
  }, []);

  // Mount the renderer to a DOM element
  const mountRenderer = useCallback(
    (container: HTMLDivElement) => {
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
    },
    [initSceneObjects]
  );

  // Unmount the renderer
  const unmountRenderer = useCallback(() => {
    if (containerRef.current && rendererRef.current) {
      containerRef.current.removeChild(rendererRef.current.domElement);
    }
  }, []);

  // Helper to get mouse intersection with drawing plane
  const getMouseIntersection = useCallback(
    (event: MouseEvent): THREE.Vector3 | null => {
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
    },
    []
  );

  const [cursorPosition, setCursorPosition] = useState<THREE.Vector3 | null>(
    null
  );

  // Add this function
  const updateCursorPosition = useCallback(
    (event: MouseEvent) => {
      const intersection = getMouseIntersection(event);
      setCursorPosition(intersection);
    },
    [getMouseIntersection]
  );
  // Create and visualize a custom shape
  const createCustomShape = useCallback(
    (points: THREE.Vector3[]) => {
      if (points.length < 3) {
        console.error("Cannot create custom shape with fewer than 3 points");
        return;
      }

      // Calculate center position
      const center = new THREE.Vector3();
      points.forEach((point) => center.add(point));
      center.divideScalar(points.length);

      // Create B-rep vertices, edges, and face
      const vertices: Vertex[] = points.map(
        (point) => new Vertex(point.x, point.y, point.z)
      );

      const edges: Edge[] = [];
      for (let i = 0; i < vertices.length; i++) {
        const nextIndex = (i + 1) % vertices.length;
        edges.push(new Edge(vertices[i], vertices[nextIndex]));
      }

      const face = new Face(vertices);
      const brep = new Brep(vertices, edges, [face]);

      // Create visual mesh
      const shape = new THREE.Shape();
      shape.moveTo(points[0].x - center.x, points[0].y - center.y);
      for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i].x - center.x, points[i].y - center.y);
      }
      shape.closePath();

      const geometry = new THREE.ShapeGeometry(shape);
      const material = new THREE.MeshStandardMaterial({
        color: 0x0000ff,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(center);

      // Add to scene via core context
      addElement(brep, center, mesh);

      return mesh;
    },
    [addElement]
  );

  // Start, add points to, and complete a custom shape
  const handleCustomShapePoint = useCallback(
    (point: THREE.Vector3, isComplete: boolean = false) => {
      // For the first point, start a new shape
      if (!customShapeInProgressRef.current) {
        setCustomShapePoints([point]);
        customShapeInProgressRef.current = true;
        return null; // No shape created yet
      }

      // Add the point to our collection
      setCustomShapePoints((prevPoints) => [...prevPoints, point]);

      // If this completes the shape and we have enough points, create it
      if (isComplete && customShapePoints.length >= 2) {
        // Need at least 3 points (including this one) for a valid shape
        const allPoints = [...customShapePoints, point];

        // Create the shape
        const result = createCustomShape(allPoints);

        // Reset the custom shape state
        setCustomShapePoints([]);
        customShapeInProgressRef.current = false;

        return result;
      }

      return null; // No shape created yet
    },
    [customShapePoints, createCustomShape]
  );

  // Generate preview mesh for custom shape in progress
  const createCustomShapePreview = useCallback(
    (currentPoint: THREE.Vector3): THREE.Mesh => {
      // Create a preview of the shape in progress
      const previewPoints = [...customShapePoints, currentPoint];

      // Need at least 3 points for a valid shape
      if (previewPoints.length < 3) {
        // For 2 points, just show a line
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(
          previewPoints
        );
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x0088ff });
        return new THREE.Line(
          lineGeometry,
          lineMaterial
        ) as unknown as THREE.Mesh;
      }

      // Create a shape for preview (similar to final shape creation)
      const shape = new THREE.Shape();
      shape.moveTo(previewPoints[0].x, previewPoints[0].y);
      for (let i = 1; i < previewPoints.length; i++) {
        shape.lineTo(previewPoints[i].x, previewPoints[i].y);
      }
      shape.closePath();

      const geometry = new THREE.ShapeGeometry(shape);
      const material = new THREE.MeshBasicMaterial({
        color: 0x0088ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      });

      return new THREE.Mesh(geometry, material);
    },
    [customShapePoints]
  );
  const resetCustomShape = useCallback(() => {
    setCustomShapePoints([]);
    customShapeInProgressRef.current = false;
  }, []);
  // Create and visualize a rectangle
  const createRectangle = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3) => {
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
      const position = new THREE.Vector3(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        0
      );

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
    },
    [addElement]
  );

  // Create and visualize a triangle
  const createTriangle = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3) => {
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
    },
    [addElement]
  );

  // Create and visualize a circle
  const createCircle = useCallback(
    (center: THREE.Vector3, radius: number) => {
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
    },
    [addElement]
  );

  // Generic shape drawing function based on current shape type
  const drawShape = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3) => {
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
        case "custom":
          return handleCustomShapePoint(end);
        default:
          console.error("Unknown shape type:", currentShape);
          break;
      }
      return null;
    },
    [
      currentShape,
      createCircle,
      createRectangle,
      createTriangle,
      handleCustomShapePoint,
    ]
  );

  // In the VisualizerContext provider

  const createEdgeHelpers = (
    element: SceneElement
  ): THREE.LineSegments | null => {
    if (!element || !element.brep) return null;

    let edgePositions: number[] = [];

    // Handle compound BReps (created by union) differently
    if (
      element.brep instanceof CompoundBrep ||
      ("children" in element.brep &&
        Array.isArray((element.brep as any).children))
    ) {
      const compoundBrep = element.brep as CompoundBrep;

      // Create a map to track edges and how many times they appear
      const edgeMap = new Map<string, { edge: Edge; count: number }>();

      // Process all children's edges
      compoundBrep.children.forEach((childBrep) => {
        if (!childBrep.edges) return;

        childBrep.edges.forEach((edge) => {
          // Create a key for the edge (normalize direction by always sorting vertices)
          const vertexA = edge.start;
          const vertexB = edge.end;
          let key: string;

          // Sort vertices to ensure consistent key regardless of edge direction
          if (
            vertexA.x < vertexB.x ||
            (vertexA.x === vertexB.x && vertexA.y < vertexB.y) ||
            (vertexA.x === vertexB.x &&
              vertexA.y === vertexB.y &&
              vertexA.z < vertexB.z)
          ) {
            key = `${vertexA.x},${vertexA.y},${vertexA.z}-${vertexB.x},${vertexB.y},${vertexB.z}`;
          } else {
            key = `${vertexB.x},${vertexB.y},${vertexB.z}-${vertexA.x},${vertexA.y},${vertexA.z}`;
          }

          // Count occurrence of this edge
          if (edgeMap.has(key)) {
            const item = edgeMap.get(key);
            if (item) item.count += 1;
          } else {
            edgeMap.set(key, { edge, count: 1 });
          }
        });
      });

      // Only keep edges that appear exactly once (these are boundary edges)
      // Edges that appear twice or more are interior edges
      for (const [_, item] of edgeMap) {
        if (item.count === 1) {
          // This is a boundary edge - add it to positions
          const edge = item.edge;
          edgePositions.push(
            edge.start.x - element.position.x,
            edge.start.y - element.position.y,
            edge.start.z - element.position.z,
            edge.end.x - element.position.x,
            edge.end.y - element.position.y,
            edge.end.z - element.position.z
          );
        }
      }
    } else {
      // Original code for normal BReps
      if (!element.brep.edges || element.brep.edges.length === 0) return null;

      element.brep.edges.forEach((edge) => {
        // Store positions relative to element position
        edgePositions.push(
          edge.start.x - element.position.x,
          edge.start.y - element.position.y,
          edge.start.z - element.position.z,
          edge.end.x - element.position.x,
          edge.end.y - element.position.y,
          edge.end.z - element.position.z
        );
      });
    }

    // If no edges to show, return null
    if (edgePositions.length === 0) return null;

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePositions, 3)
    );

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      linewidth: 2,
      depthTest: false,
    });

    const lines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    lines.renderOrder = 999;

    // Set userData to mark this as a helper
    lines.userData.isHelper = true;
    lines.userData.helperType = "edge";
    lines.userData.elementId = element.nodeId;

    return lines;
  };

  const createVertexHelpers = (
    element: SceneElement
  ): THREE.Object3D | null => {
    if (!element || !element.brep) return null;

    // Set to track unique vertices to avoid duplicates
    const uniqueVertices = new Set<string>();
    const vertices: Vertex[] = [];

    if (
      element.brep instanceof CompoundBrep ||
      ("children" in element.brep &&
        Array.isArray((element.brep as any).children))
    ) {
      const compoundBrep = element.brep as CompoundBrep;

      // First, gather all boundary edges (similar to edge logic above)
      const edgeMap = new Map<string, { edge: Edge; count: number }>();

      // Process all children's edges
      compoundBrep.children.forEach((childBrep) => {
        if (!childBrep.edges) return;

        childBrep.edges.forEach((edge) => {
          // Same key generation as in createEdgeHelpers
          const vertexA = edge.start;
          const vertexB = edge.end;
          let key: string;

          if (
            vertexA.x < vertexB.x ||
            (vertexA.x === vertexB.x && vertexA.y < vertexB.y) ||
            (vertexA.x === vertexB.x &&
              vertexA.y === vertexB.y &&
              vertexA.z < vertexB.z)
          ) {
            key = `${vertexA.x},${vertexA.y},${vertexA.z}-${vertexB.x},${vertexB.y},${vertexB.z}`;
          } else {
            key = `${vertexB.x},${vertexB.y},${vertexB.z}-${vertexA.x},${vertexA.y},${vertexA.z}`;
          }

          if (edgeMap.has(key)) {
            const item = edgeMap.get(key);
            if (item) item.count += 1;
          } else {
            edgeMap.set(key, { edge, count: 1 });
          }
        });
      });

      // Now collect vertices from boundary edges
      for (const [_, item] of edgeMap) {
        if (item.count === 1) {
          // Boundary edge - add its vertices if not already added
          const edge = item.edge;
          const startKey = `${edge.start.x},${edge.start.y},${edge.start.z}`;
          const endKey = `${edge.end.x},${edge.end.y},${edge.end.z}`;

          if (!uniqueVertices.has(startKey)) {
            uniqueVertices.add(startKey);
            vertices.push(edge.start);
          }

          if (!uniqueVertices.has(endKey)) {
            uniqueVertices.add(endKey);
            vertices.push(edge.end);
          }
        }
      }
    } else {
      // Original code for normal BReps
      if (!element.brep.vertices || element.brep.vertices.length === 0) {
        return null;
      }

      vertices.push(...element.brep.vertices);
    }

    // If no vertices to show, return null
    if (vertices.length === 0) return null;

    const vertexGroup = new THREE.Group();

    vertices.forEach((vertex) => {
      const sphereGeometry = new THREE.SphereGeometry(0.05, 16, 16);
      const sphereMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: false,
        depthTest: false,
      });

      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
      // Position relative to element position
      sphere.position.set(
        vertex.x - element.position.x,
        vertex.y - element.position.y,
        vertex.z - element.position.z
      );
      sphere.renderOrder = 1000;
      vertexGroup.add(sphere);
    });

    // Set userData
    vertexGroup.userData.isHelper = true;
    vertexGroup.userData.helperType = "vertex";
    vertexGroup.userData.elementId = element.nodeId;

    return vertexGroup;
  };
  // Highlight an element (e.g., on hover)
  const highlightElement = (nodeId: string) => {
    const obj = getObject(nodeId);
    if (!obj) return;

    // Set the color of the main mesh
    if (obj instanceof THREE.Mesh) {
      (obj.material as THREE.MeshStandardMaterial).color.set(0xff9900);
      (obj.material as THREE.MeshStandardMaterial).needsUpdate = true;
    }

    // Show helpers
    obj.traverse((child) => {
      if (
        child.userData.helperType === "edge" ||
        child.userData.helperType === "vertex"
      ) {
        child.visible = true;
      }
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshStandardMaterial).color.set(0xff9900);
        (child.material as THREE.MeshStandardMaterial).needsUpdate = true;
      }
    });
  };

  // Unhighlight an element
  const unhighlightElement = (nodeId: string) => {
    const obj = getObject(nodeId);
    if (!obj) return;

    // Reset the color
    const element = elements.find((el) => el.nodeId === nodeId);
    const color = element?.selected ? 0xff0000 : 0x0000ff;

    // Hide helpers unless element is selected
    obj.traverse((child) => {
      if (
        child.userData.helperType === "edge" ||
        child.userData.helperType === "vertex"
      ) {
        child.visible = element?.selected || false;
      }
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshStandardMaterial).color.set(color);
        (child.material as THREE.MeshStandardMaterial).needsUpdate = true;
      }
    });
  };

  // Force scene update
  const forceSceneUpdate = () => {
    setForceUpdate((prev) => prev + 1);
  };

  // Scene synchronization effect - keep Three.js scene in sync with core state
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    console.log(
      "Scene sync running, elements:",
      elements.length,
      elements.map((e) => e.nodeId)
    );

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

    // Find objects to remove - more precise object comparison
    const validObjects = new Set(elements.map((el) => getObject(el.nodeId)));
    console.log({ validObjects });
    console.log(scene.children.map((child) => child.type));
    console.log(
      "Scene children:",
      scene.children.map((c) => ({
        id: c.id,
        type: c.type,
        isValid: validObjects.has(c),
        userData: c.userData,
      }))
    );
    const objectsToRemove = scene.children.filter((child) => {
      // Don't remove if it's a special object type
      if (
        child instanceof THREE.Light ||
        child instanceof THREE.Camera ||
        child.type === "GridHelper" ||
        child.type === "AxesHelper" ||
        child.userData.isHelper ||
        child.userData.helperType === "gizmo" ||
        child.userData.isGroundPlane === true ||
        child.type === "TransformControlsGizmo"
      ) {
        return false;
      }

      // Check if this object or any of its ancestors is in validObjects
      let curr = child;
      while (curr) {
        if (validObjects.has(curr)) {
          return false;
        }
        curr = curr.parent;
      }

      // Check by nodeId in userData
      if (child.userData && child.userData.nodeId) {
        const matchingElement = elements.find(
          (el) => el.nodeId === child.userData.nodeId
        );
        if (matchingElement) return false;
      }

      return true;
    });

    // Remove stale objects
    if (objectsToRemove.length > 0) {
      console.log("Removing objects:", objectsToRemove.length, objectsToRemove);
      objectsToRemove.forEach((child) => {
        scene.remove(child);
      });
    }
  }, [elements, getObject]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Clean up existing ground plane
    if (groundPlaneRef.current) {
      scene.remove(groundPlaneRef.current);
      groundPlaneRef.current = null;
    }

    if (showGroundPlane) {
      // Create ground plane group
      const groundGroup = new THREE.Group();
      groundGroup.userData.isGroundPlane = true;

      // Create grid
      const gridSize = 20;
      const gridDivisions = 20;
      const gridHelper = new THREE.GridHelper(
        gridSize,
        gridDivisions,
        0x888888,
        0x444444
      );
      gridHelper.rotation.x = Math.PI / 2; // Rotate to XY plane
      gridHelper.position.z = -0.02; // Slightly below objects

      // Create plane
      const planeGeometry = new THREE.PlaneGeometry(gridSize, gridSize);
      const planeMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(planeGeometry, planeMaterial);
      plane.position.z = -0.01;

      // Add both to group
      groundGroup.add(gridHelper);
      groundGroup.add(plane);
      scene.add(groundGroup);

      groundGroup.userData.isGroundPlane = true;
      groundPlaneRef.current = groundGroup;
    }

    // Force scene update
    forceSceneUpdate();
  }, [showGroundPlane]);

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

        customShapePoints,
        handleCustomShapePoint,
        createCustomShapePreview,
        resetCustomShape,
        customShapeInProgress: customShapeInProgressRef.current,

        showGroundPlane,
        toggleGroundPlane,
        cursorPosition,
        updateCursorPosition,
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
