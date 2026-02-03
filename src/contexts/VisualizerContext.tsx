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
import { SceneElement } from "../scene-operations/types";
import { useCadCore } from "./CoreContext";

export type ShapeType = "rectangle" | "triangle" | "circle" | "custom";

interface CadVisualizerContextType {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: OrbitControls | null;

  currentShape: ShapeType;
  setCurrentShape: (shape: ShapeType) => void;

  drawShape: (start: THREE.Vector3, end: THREE.Vector3) => void;

  createEdgeHelpers: (element: SceneElement) => THREE.LineSegments | null;
  createVertexHelpers: (element: SceneElement) => THREE.Object3D | null;
  getMouseIntersection: (event: MouseEvent) => THREE.Vector3 | null;

  mountRenderer: (container: HTMLDivElement) => void;
  unmountRenderer: () => void;

  highlightElement: (nodeId: string) => void;
  unhighlightElement: (nodeId: string) => void;

  forceSceneUpdate: () => void;

  customShapePoints: THREE.Vector3[];
  handleCustomShapePoint: (
    point: THREE.Vector3,
    isComplete?: boolean,
  ) => THREE.Mesh | null;
  createCustomShapePreview: (currentPoint: THREE.Vector3) => THREE.Mesh;
  resetCustomShape: () => void;
  customShapeInProgress: boolean;

  showGroundPlane: boolean;
  toggleGroundPlane: () => void;

  cursorPosition: THREE.Vector3 | null;
  updateCursorPosition: (event: MouseEvent) => void;
  sceneReady: boolean;

  setCameraRotationEnabled: (enabled: boolean) => void;
}

export const CadVisualizerContext = createContext<
  CadVisualizerContextType | undefined
>(undefined);

export const CadVisualizerProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { addElement, elements, getObject } = useCadCore();

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [customShapePoints, setCustomShapePoints] = useState<THREE.Vector3[]>(
    [],
  );
  const [customShapeInProgress, setCustomShapeInProgress] = useState<boolean>(false);
  const [currentShape, setCurrentShape] = useState<ShapeType>("rectangle");
  const [forceUpdate, setForceUpdate] = useState(0);
  const [showGroundPlane, setShowGroundPlane] = useState<boolean>(true);
  const groundPlaneRef = useRef<THREE.Group | null>(null);
  const [sceneReady, setSceneReady] = useState(false); // Track when scene is initialized
  const customPreviewRef = useRef<THREE.Mesh | THREE.Line | null>(null); // Track custom shape preview for disposal

  const toggleGroundPlane = useCallback(() => {
    setShowGroundPlane((prev) => !prev);
  }, []);

  const setCameraRotationEnabled = useCallback((enabled: boolean) => {
    if (controlsRef.current) {
      controlsRef.current.enableRotate = enabled;
    }
  }, []);

  const initSceneObjects = useCallback(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x808080);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(0, 0, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    // Debug: expose globally for inspection (development only)
    if (import.meta.env.DEV) {
      (window as any).__cadScene = scene;
      (window as any).__cadCamera = camera;
    }

    return { scene, camera, renderer };
  }, []);

  const mountRenderer = useCallback(
    (container: HTMLDivElement) => {
      containerRef.current = container;

      const { scene, camera, renderer } = initSceneObjects();

      container.appendChild(renderer.domElement);

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

      const animate = () => {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      // Signal that scene is ready - triggers re-render to update context value
      setSceneReady(true);

      const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener("resize", handleResize);

      // Store cleanup function for proper disposal
      cleanupRef.current = () => {
        window.removeEventListener("resize", handleResize);
        controls.dispose();
      };
    },
    [initSceneObjects],
  );

  const unmountRenderer = useCallback(() => {
    // Call cleanup function to remove event listeners and dispose controls
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (containerRef.current && rendererRef.current) {
      containerRef.current.removeChild(rendererRef.current.domElement);
    }
  }, []);

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
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const intersection = new THREE.Vector3();
      const result = raycaster.ray.intersectPlane(drawingPlane, intersection);
      return result ? intersection : null;
    },
    [],
  );

  const [cursorPosition, setCursorPosition] = useState<THREE.Vector3 | null>(
    null,
  );

  const updateCursorPosition = useCallback(
    (event: MouseEvent) => {
      const intersection = getMouseIntersection(event);
      setCursorPosition(intersection);
    },
    [getMouseIntersection],
  );

  const createCustomShape = useCallback(
    (points: THREE.Vector3[]) => {
      if (points.length < 3) {
        console.error("Cannot create custom shape with fewer than 3 points");
        return;
      }

      const center = new THREE.Vector3();
      points.forEach((point) => center.add(point));
      center.divideScalar(points.length);

      // local space vertices
      const vertices: Vertex[] = points.map(
        (point) =>
          new Vertex(
            point.x - center.x,
            point.y - center.y,
            point.z - center.z,
          ),
      );

      const edges: Edge[] = [];
      for (let i = 0; i < vertices.length; i++) {
        const nextIndex = (i + 1) % vertices.length;
        edges.push(new Edge(vertices[i], vertices[nextIndex]));
      }

      const face = new Face(vertices);
      const brep = new Brep(vertices, edges, [face]);

      const shape = new THREE.Shape();
      shape.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        shape.lineTo(vertices[i].x, vertices[i].y);
      }
      shape.closePath();

      const geometry = new THREE.ShapeGeometry(shape);
      const material = new THREE.MeshStandardMaterial({
        color: 0x0000ff,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(center);

      addElement(brep, center, mesh);

      return mesh;
    },
    [addElement],
  );

  // Start, add points to, and complete a custom shape
  const handleCustomShapePoint = useCallback(
    (point: THREE.Vector3, isComplete: boolean = false) => {
      // For the first point, start a new shape
      if (!customShapeInProgress) {
        setCustomShapePoints([point]);
        setCustomShapeInProgress(true);
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
        setCustomShapeInProgress(false);

        return result;
      }

      return null; // No shape created yet
    },
    [customShapePoints, customShapeInProgress, createCustomShape],
  );

  // Generate preview mesh for custom shape in progress
  const createCustomShapePreview = useCallback(
    (currentPoint: THREE.Vector3): THREE.Mesh => {
      // Dispose previous preview to prevent memory leak
      if (customPreviewRef.current) {
        customPreviewRef.current.geometry.dispose();
        if (Array.isArray(customPreviewRef.current.material)) {
          customPreviewRef.current.material.forEach((m) => m.dispose());
        } else {
          (customPreviewRef.current.material as THREE.Material).dispose();
        }
        sceneRef.current?.remove(customPreviewRef.current);
        customPreviewRef.current = null;
      }

      // Create a preview of the shape in progress
      const previewPoints = [...customShapePoints, currentPoint];

      // Need at least 3 points for a valid shape
      if (previewPoints.length < 3) {
        // For 2 points, just show a line
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(
          previewPoints,
        );
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x0088ff });
        const line = new THREE.Line(
          lineGeometry,
          lineMaterial,
        );
        customPreviewRef.current = line;
        return line as unknown as THREE.Mesh;
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

      const mesh = new THREE.Mesh(geometry, material);
      customPreviewRef.current = mesh;
      return mesh;
    },
    [customShapePoints],
  );
  const resetCustomShape = useCallback(() => {
    // Dispose preview mesh when resetting
    if (customPreviewRef.current) {
      customPreviewRef.current.geometry.dispose();
      if (Array.isArray(customPreviewRef.current.material)) {
        customPreviewRef.current.material.forEach((m) => m.dispose());
      } else {
        (customPreviewRef.current.material as THREE.Material).dispose();
      }
      sceneRef.current?.remove(customPreviewRef.current);
      customPreviewRef.current = null;
    }
    setCustomShapePoints([]);
    setCustomShapeInProgress(false);
  }, []);
  // Create and visualize a rectangle
  const createRectangle = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3) => {
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);

      // Calculate center position
      const position = new THREE.Vector3(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        0,
      );

      // Calculate dimensions
      const width = maxX - minX;
      const height = maxY - minY;
      const halfWidth = width / 2;
      const halfHeight = height / 2;

      // Create B-rep vertices in LOCAL space (centered at origin)
      const v1 = new Vertex(-halfWidth, -halfHeight, 0);
      const v2 = new Vertex(halfWidth, -halfHeight, 0);
      const v3 = new Vertex(halfWidth, halfHeight, 0);
      const v4 = new Vertex(-halfWidth, halfHeight, 0);
      const e1 = new Edge(v1, v2);
      const e2 = new Edge(v2, v3);
      const e3 = new Edge(v3, v4);
      const e4 = new Edge(v4, v1);
      const face = new Face([v1, v2, v3, v4]);
      const brep = new Brep([v1, v2, v3, v4], [e1, e2, e3, e4], [face]);

      // Create visual mesh (PlaneGeometry is already centered at origin)
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
    [addElement],
  );

  // Create and visualize a triangle
  const createTriangle = useCallback(
    (start: THREE.Vector3, end: THREE.Vector3) => {
      const direction = new THREE.Vector3().subVectors(end, start);
      const perpendicular = new THREE.Vector3(
        -direction.y,
        direction.x,
        0,
      ).normalize();
      const height = direction.length() * 0.866; // Height for equilateral triangle
      const thirdPoint = new THREE.Vector3().addVectors(
        start,
        new THREE.Vector3().addVectors(
          new THREE.Vector3().copy(direction).multiplyScalar(0.5),
          new THREE.Vector3().copy(perpendicular).multiplyScalar(height),
        ),
      );

      // Calculate center
      const center = new THREE.Vector3()
        .add(start)
        .add(end)
        .add(thirdPoint)
        .divideScalar(3);

      // Convert world coordinates to LOCAL space (relative to center)
      const localStart = new THREE.Vector3().subVectors(start, center);
      const localEnd = new THREE.Vector3().subVectors(end, center);
      const localThird = new THREE.Vector3().subVectors(thirdPoint, center);

      // Create B-rep in LOCAL space
      const v1 = new Vertex(localStart.x, localStart.y, localStart.z);
      const v2 = new Vertex(localEnd.x, localEnd.y, localEnd.z);
      const v3 = new Vertex(localThird.x, localThird.y, localThird.z);
      const e1 = new Edge(v1, v2);
      const e2 = new Edge(v2, v3);
      const e3 = new Edge(v3, v1);
      const face = new Face([v1, v2, v3]);
      const brep = new Brep([v1, v2, v3], [e1, e2, e3], [face]);

      // Create visual mesh in LOCAL space
      const vertices = [localStart, localEnd, localThird];

      const geometry = new THREE.BufferGeometry();
      geometry.setFromPoints(vertices);
      geometry.computeVertexNormals();
      geometry.setIndex([0, 1, 2]);

      const material = new THREE.MeshStandardMaterial({
        color: 0x0000ff,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(center);

      addElement(brep, center, mesh);
    },
    [addElement],
  );

  // Create and visualize a circle
  const createCircle = useCallback(
    (center: THREE.Vector3, radius: number) => {
      // Create B-rep in LOCAL space (centered at origin)
      const segments = 32;
      const vertices: Vertex[] = [];
      const edges: Edge[] = [];

      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        vertices.push(new Vertex(x, y, 0));
      }

      for (let i = 0; i < segments; i++) {
        const nextIdx = (i + 1) % segments;
        edges.push(new Edge(vertices[i], vertices[nextIdx]));
      }

      const face = new Face(vertices);
      const brep = new Brep(vertices, edges, [face]);

      // Create visual mesh (CircleGeometry is already centered at origin)
      const geometry = new THREE.CircleGeometry(radius, segments);
      const material = new THREE.MeshStandardMaterial({
        color: 0x0000ff,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(center);

      addElement(brep, center, mesh);
    },
    [addElement],
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
    ],
  );

  // In the VisualizerContext provider

  const createEdgeHelpers = (
    element: SceneElement,
  ): THREE.LineSegments | null => {
    if (!element || !element.brep) return null;

    let edgePositions: number[] = [];
    let brepToVisualize: Brep;

    // For compound BReps, use the unified BRep if it's already cached
    if (
      element.brep instanceof CompoundBrep ||
      ("children" in element.brep &&
        Array.isArray((element.brep as any).children))
    ) {
      const compoundBrep = element.brep as CompoundBrep;
      // Access the cached unified BRep directly (should be set after union operation)
      const unifiedBrep = (compoundBrep as any)._unifiedBRep as
        | Brep
        | undefined;
      if (unifiedBrep) {
        brepToVisualize = unifiedBrep;
      } else {
        // If no unified BRep yet, just use first child for now
        // (this shouldn't happen in practice after union completes)
        console.warn("CompoundBrep has no unified BRep cached yet");
        if (compoundBrep.children.length > 0) {
          brepToVisualize = compoundBrep.children[0];
        } else {
          return null;
        }
      }
    } else {
      brepToVisualize = element.brep;
    }

    // All BReps are stored in local space, so we just use their vertices directly
    if (!brepToVisualize.edges || brepToVisualize.edges.length === 0)
      return null;

    brepToVisualize.edges.forEach((edge) => {
      // Vertices are already in local space (centered at origin)
      edgePositions.push(
        edge.start.x,
        edge.start.y,
        edge.start.z,
        edge.end.x,
        edge.end.y,
        edge.end.z,
      );
    });

    // If no edges to show, return null
    if (edgePositions.length === 0) return null;

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePositions, 3),
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
    element: SceneElement,
  ): THREE.Object3D | null => {
    if (!element || !element.brep) return null;

    let brepToVisualize: Brep;

    // For compound BReps, use the unified BRep if it's already cached
    if (
      element.brep instanceof CompoundBrep ||
      ("children" in element.brep &&
        Array.isArray((element.brep as any).children))
    ) {
      const compoundBrep = element.brep as CompoundBrep;
      // Access the cached unified BRep directly (should be set after union operation)
      const unifiedBrep = (compoundBrep as any)._unifiedBRep as
        | Brep
        | undefined;
      if (unifiedBrep) {
        brepToVisualize = unifiedBrep;
      } else {
        // If no unified BRep yet, just use first child for now
        console.warn("CompoundBrep has no unified BRep cached yet");
        if (compoundBrep.children.length > 0) {
          brepToVisualize = compoundBrep.children[0];
        } else {
          return null;
        }
      }
    } else {
      brepToVisualize = element.brep;
    }

    // All BReps are stored in local space
    if (!brepToVisualize.vertices || brepToVisualize.vertices.length === 0) {
      return null;
    }

    const vertexGroup = new THREE.Group();

    brepToVisualize.vertices.forEach((vertex) => {
      const sphereGeometry = new THREE.SphereGeometry(0.05, 16, 16);
      const sphereMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: false,
        depthTest: false,
      });

      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
      // Vertices are already in local space, use them directly
      sphere.position.set(vertex.x, vertex.y, vertex.z);
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

    // Ensure all elements have corresponding objects in the scene
    elements.forEach((element) => {
      const obj = getObject(element.nodeId);
      if (obj) {
        if (!scene.children.includes(obj)) {
          scene.add(obj);
        }
      }
    });

    // Find objects to remove - more precise object comparison
    const validObjects = new Set(elements.map((el) => getObject(el.nodeId)));

    const objectsToRemove = scene.children.filter((child) => {
      // Don't remove if it's a special object type
      if (
        child instanceof THREE.Light ||
        child instanceof THREE.Camera ||
        child.type === "GridHelper" ||
        child.type === "AxesHelper" ||
        child.userData.isHelper ||
        child.userData.helperType === "gizmo" ||
        child.userData.helperType === "handleType" ||
        child.userData.isGroundPlane === true ||
        child.userData.isSketchGrid === true ||
        child.userData.isSelectionPlanes === true ||
        child.type === "TransformControlsGizmo" ||
        child.userData.isSketchPrimitive === true ||
        child.userData.primitiveId !== undefined
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
          (el) => el.nodeId === child.userData.nodeId,
        );
        if (matchingElement) return false;
      }

      return true;
    });

    // Remove stale objects
    if (objectsToRemove.length > 0) {
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
        0x444444,
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
        customShapeInProgress: customShapeInProgress,

        showGroundPlane,
        toggleGroundPlane,
        cursorPosition,
        updateCursorPosition,
        sceneReady,
        setCameraRotationEnabled,
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
      "useCadVisualizer must be used within a CadVisualizerProvider",
    );
  }
  return context;
};
