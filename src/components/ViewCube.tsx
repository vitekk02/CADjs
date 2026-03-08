import React, { FC, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { VIEWCUBE } from "../theme";
import { NamedView } from "../hooks/useCameraAnimation";

interface ViewCubeProps {
  camera: THREE.Camera | null;
  onViewChange: (viewName: NamedView) => void;
}

interface FaceDef {
  name: string;
  view: NamedView;
  rotation: THREE.Euler;
  position: THREE.Vector3;
}

const FACES: FaceDef[] = [
  { name: "FRONT", view: "front", rotation: new THREE.Euler(0, 0, 0), position: new THREE.Vector3(0, 0, 0.501) },
  { name: "BACK", view: "back", rotation: new THREE.Euler(0, Math.PI, 0), position: new THREE.Vector3(0, 0, -0.501) },
  { name: "TOP", view: "top", rotation: new THREE.Euler(-Math.PI / 2, 0, 0), position: new THREE.Vector3(0, 0.501, 0) },
  { name: "BOTTOM", view: "bottom", rotation: new THREE.Euler(Math.PI / 2, 0, 0), position: new THREE.Vector3(0, -0.501, 0) },
  { name: "RIGHT", view: "right", rotation: new THREE.Euler(0, Math.PI / 2, 0), position: new THREE.Vector3(0.501, 0, 0) },
  { name: "LEFT", view: "left", rotation: new THREE.Euler(0, -Math.PI / 2, 0), position: new THREE.Vector3(-0.501, 0, 0) },
];

function createFaceTexture(label: string, isHovered: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  // Face background
  const faceColor = isHovered ? "#6a8abf" : "#5a5a5a";
  ctx.fillStyle = faceColor;
  ctx.fillRect(0, 0, 128, 128);

  // Border
  ctx.strokeStyle = "#444444";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 126, 126);

  // Label
  ctx.fillStyle = isHovered ? VIEWCUBE.textBold : VIEWCUBE.text;
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const ViewCube: FC<ViewCubeProps> = ({ camera, onViewChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cubeCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const faceMeshesRef = useRef<THREE.Mesh[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const hoveredFaceRef = useRef<string | null>(null);
  // Track main camera via ref so the mini-scene doesn't re-create on projection toggle
  const mainCameraRef = useRef(camera);
  useEffect(() => { mainCameraRef.current = camera; }, [camera]);

  // Initialize the mini scene (once)
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const size = container.clientWidth || 120;

    const cubeScene = new THREE.Scene();
    sceneRef.current = cubeScene;

    const cubeCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cubeCamera.position.set(2, 2, 2);
    cubeCamera.lookAt(0, 0, 0);
    cubeCameraRef.current = cubeCamera;

    const cubeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    cubeRenderer.setSize(size, size);
    cubeRenderer.setPixelRatio(window.devicePixelRatio);
    cubeRenderer.setClearColor(0x000000, 0);
    container.appendChild(cubeRenderer.domElement);
    rendererRef.current = cubeRenderer;

    // Create face meshes with labeled textures
    const faceGeometry = new THREE.PlaneGeometry(1, 1);
    const meshes: THREE.Mesh[] = [];

    for (const face of FACES) {
      const texture = createFaceTexture(face.name, false);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
      });
      const mesh = new THREE.Mesh(faceGeometry, material);
      mesh.position.copy(face.position);
      mesh.rotation.copy(face.rotation);
      mesh.userData = { viewName: face.view, faceName: face.name };
      cubeScene.add(mesh);
      meshes.push(mesh);
    }
    faceMeshesRef.current = meshes;

    // Edge outlines for the cube
    const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const edgeMaterial = new THREE.LineBasicMaterial({ color: VIEWCUBE.faceBorder });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    cubeScene.add(edges);

    // Small axes indicator
    const axesGroup = new THREE.Group();
    const axisLen = 0.7;
    const axisOffset = -0.65;
    // X axis (red)
    const xLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(axisOffset, axisOffset, axisOffset),
        new THREE.Vector3(axisOffset + axisLen, axisOffset, axisOffset),
      ]),
      new THREE.LineBasicMaterial({ color: 0xff4444 })
    );
    axesGroup.add(xLine);
    // Y axis (green)
    const yLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(axisOffset, axisOffset, axisOffset),
        new THREE.Vector3(axisOffset, axisOffset + axisLen, axisOffset),
      ]),
      new THREE.LineBasicMaterial({ color: 0x44ff44 })
    );
    axesGroup.add(yLine);
    // Z axis (blue)
    const zLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(axisOffset, axisOffset, axisOffset),
        new THREE.Vector3(axisOffset, axisOffset, axisOffset + axisLen),
      ]),
      new THREE.LineBasicMaterial({ color: 0x4488ff })
    );
    axesGroup.add(zLine);
    cubeScene.add(axesGroup);

    // Light
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    cubeScene.add(ambient);

    // Animation loop — sync with main camera via ref
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      if (mainCameraRef.current && cubeCameraRef.current) {
        // Match the main camera's orientation
        const dir = new THREE.Vector3();
        mainCameraRef.current.getWorldDirection(dir);
        const dist = 3;
        cubeCameraRef.current.position.copy(dir.multiplyScalar(-dist));
        cubeCameraRef.current.up.copy(mainCameraRef.current.up);
        cubeCameraRef.current.lookAt(0, 0, 0);
      }

      cubeRenderer.render(cubeScene, cubeCameraRef.current!);
    };
    animate();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      // Dispose all scene resources
      cubeScene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
          obj.geometry?.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => { (m as THREE.Material & { map?: THREE.Texture }).map?.dispose(); m.dispose(); });
          } else if (mat) {
            (mat as THREE.Material & { map?: THREE.Texture }).map?.dispose();
            (mat as THREE.Material).dispose();
          }
        }
      });
      if (container.contains(cubeRenderer.domElement)) {
        container.removeChild(cubeRenderer.domElement);
      }
      cubeRenderer.dispose();
    };
  }, []); // Only initialize once

  // Handle click on a cube face
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!rendererRef.current || !cubeCameraRef.current) return;

      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cubeCameraRef.current);
      const intersects = raycaster.intersectObjects(faceMeshesRef.current);

      if (intersects.length > 0) {
        const viewName = intersects[0].object.userData.viewName as NamedView;
        if (viewName) {
          onViewChange(viewName);
        }
      }
    },
    [onViewChange]
  );

  // Handle hover for face highlighting
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!rendererRef.current || !cubeCameraRef.current) return;

      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cubeCameraRef.current);
      const intersects = raycaster.intersectObjects(faceMeshesRef.current);

      let newHovered: string | null = null;
      if (intersects.length > 0) {
        newHovered = intersects[0].object.userData.faceName as string;
      }

      if (newHovered !== hoveredFaceRef.current) {
        // Update textures
        for (const mesh of faceMeshesRef.current) {
          const faceName = mesh.userData.faceName as string;
          const isHovered = faceName === newHovered;
          const mat = mesh.material as THREE.MeshBasicMaterial;
          mat.map?.dispose();
          mat.map = createFaceTexture(faceName, isHovered);
          mat.needsUpdate = true;
        }
        hoveredFaceRef.current = newHovered;
      }
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    if (hoveredFaceRef.current) {
      for (const mesh of faceMeshesRef.current) {
        const faceName = mesh.userData.faceName as string;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.map = createFaceTexture(faceName, false);
        mat.needsUpdate = true;
      }
      hoveredFaceRef.current = null;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        width: "100%",
        height: "100%",
        cursor: "pointer",
        borderRadius: 8,
        overflow: "hidden",
      }}
    />
  );
};

export default ViewCube;
