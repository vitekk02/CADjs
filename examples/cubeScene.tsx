// src/CubeScene.tsx
import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { createCubeBRep } from "../src/models/cubeBRep";
import { createGeometryFromBRep } from "../src/convertBRepToGeometry";

const CubeScene: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Create the scene and set a gray-ish background.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x808080);

    // 2. Set up the camera.
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    // 3. Create the renderer.
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current?.appendChild(renderer.domElement);

    // 4. Add ambient and directional lights.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    // 5. Set up OrbitControls to navigate the scene.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.update();

    // 6. Build the cube from B-rep data and convert it to Three.js geometry.
    const faces = createCubeBRep();
    const cubeGeometry = createGeometryFromBRep(faces);
    // Use a material with a standout color and double-sided faces.
    const material = new THREE.MeshStandardMaterial({
      color: 0xff5733,
      side: THREE.DoubleSide,
    });
    const cubeMesh = new THREE.Mesh(cubeGeometry, material);
    scene.add(cubeMesh);

    // 7. Animation loop: update controls and render the scene.
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update(); // Update damping on controls.
      renderer.render(scene, camera);
    };
    animate();

    // 8. Handle window resizing.
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    // Cleanup on component unmount.
    return () => {
      window.removeEventListener("resize", handleResize);
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      controls.dispose();
    };
  }, []);

  return <div ref={mountRef} />;
};

export default CubeScene;
