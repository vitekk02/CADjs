import React, { useRef, useEffect, useState, useMemo } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { useCadCore } from "../src/contexts/CoreContext";
import { SceneMode } from "../src/scene-operations";
import { ShapeType, useCadVisualizer } from "../src/contexts/VisualizerContext";
import useMoveMode from "../src/hooks/useMoveMode";
import { useCombineMode } from "../src/hooks/useCombineMode";
import { useSketchMode } from "../src/hooks/useSketchMode";
import { useExtrudeMode } from "../src/hooks/useExtrudeMode";
import { useFilletMode } from "../src/hooks/useFilletMode";
import { useSweepMode } from "../src/hooks/useSweepMode";
import { useLoftMode } from "../src/hooks/useLoftMode";
import { useRevolveMode } from "../src/hooks/useRevolveMode";
import { useMeasureMode } from "../src/hooks/useMeasureMode";
import { useCameraAnimation, NamedView } from "../src/hooks/useCameraAnimation";
import ViewCube from "../src/components/ViewCube";
import SketchToolbar from "../src/navbar/SketchToolbar";
import DimensionInput from "../src/components/DimensionInput";
import SketchContextMenu from "../src/components/SketchContextMenu";
import BrowserPanel from "../src/components/FeatureTree";
import SketchPropertiesPanel from "../src/components/SketchPropertiesPanel";
import { buildBrowserSections } from "../src/scene-operations/browser-sections";
import { SKETCH_PLANE, HELPERS } from "../src/theme";
import FileMenu from "../src/components/FileMenu";
import NavigationBar from "../src/components/NavigationBar";
import { useToast } from "../src/contexts/ToastContext";

interface SimpleCadSceneProps {
  initialMode?: SceneMode;
}

const SimpleCadScene: React.FC<SimpleCadSceneProps> = ({
  initialMode = "move",
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const {
    selectElement,
    deselectElement,
    elements,
    getObject,
    mode,
    removeElement,
    selectedElements,
    setMode,
    updateElementPosition,
    activeSketch,
    finishSketch,
    cancelSketch,
    solveSketch,
    featureTree,
    toggleNodeVisibility,
    toggleNodeExpanded,
    renameNode,
    deleteNode,
    sectionExpandedState,
    toggleSectionExpanded,
    originVisibility,
    toggleOriginVisibility,
    deselectAll,
    undo,
    redo,
    canUndo,
    canRedo,
    undoActionName,
    redoActionName,
    undoStack,
    redoStack,
    undoSketch,
    redoSketch,
    canUndoSketch,
    canRedoSketch,
    isOperationPending,
    duplicateSelectedElements,
    updatePrimitivesAndSolve,
    pinnedMeasurements,
    addConstraintAndSolve,
    removeConstraint: removeSketchConstraint,
    pushSketchUndo,
  } = useCadCore();
  const {
    drawShape,
    forceSceneUpdate,
    getMouseIntersection,
    highlightElement,
    mountRenderer,
    renderer,
    camera,
    scene,
    setCurrentShape,
    unhighlightElement,
    unmountRenderer,
    showGroundPlane,
    toggleGroundPlane,
    cursorPosition,
    updateCursorPosition,
    controls,
    projectionType,
    toggleProjection,
    navToolActiveRef,
    controlsRef,
    gridSpacing,
    setGridSpacing,
    gridSnapEnabled,
    setGridSnapEnabled,
  } = useCadVisualizer();
  const { showToast } = useToast();

  const [undoDropdownOpen, setUndoDropdownOpen] = useState(false);
  const [redoDropdownOpen, setRedoDropdownOpen] = useState(false);
  const [planeOffset, setPlaneOffset] = useState(0);
  const undoDropdownRef = useRef<HTMLDivElement>(null);
  const redoDropdownRef = useRef<HTMLDivElement>(null);

  const [
    { selectedObject },
    { handleMouseDown, handleMouseMove, handleMouseUp, clearSelection, cleanup: cleanupMove },
  ] = useMoveMode();
  const {
    handleCombineMouseDown,
    handleCombineMouseMove,
    performCombine,
    canCombine,
    operationType: combineOpType,
    setOperationType: setCombineOpType,
    targetBody: combineTarget,
    toolBodies: combineTools,
    keepTools: combineKeepTools,
    setKeepTools: setCombineKeepTools,
    resetSelection: resetCombineSelection,
    cleanup: cleanupCombine,
  } = useCombineMode();
  const {
    sketchSubMode,
    setSketchSubMode,
    handleSketchMode,
    handleKeyDown: handleSketchKeyDown,
    cleanupSketchPreview,
    startNewSketch,
    selectedPrimitives,
    applyConstraint,
    isChaining,
    cancelCurrentOperation,
    pendingLineDimension,
    clearPendingLineDimension,
    applyLineLengthConstraint,
    contextMenu: sketchContextMenu,
    closeContextMenu: closeSketchContextMenu,
    applyConstraintToContextMenuPrimitives,
    deleteConstraint: deleteSketchConstraint,
    // Plane selection
    isSelectingPlane,
    hoveredPlane,
    cancelPlaneSelection,
    selectPlaneAndStartSketch,
    handlePlaneSelectionMouseMove,
    handlePlaneSelectionClick,
    setPlaneOffset: setSketchPlaneOffset,
    toggleFixPoint,
    constraintFeedback,
    editingConstraintId,
  } = useSketchMode();

  const {
    selectedElement: extrudeSelectedElement,
    isExtruding,
    extrusionDepth,
    activeDirection: extrudeDirection,
    showDimensionInput: showExtrudeDimensionInput,
    dimensionInputPosition: extrudeDimensionPosition,
    handleMouseDown: handleExtrudeMouseDown,
    handleMouseMove: handleExtrudeMouseMove,
    handleMouseUp: handleExtrudeMouseUp,
    handleKeyDown: handleExtrudeKeyDown,
    handleDimensionSubmit: handleExtrudeDimensionSubmit,
    handleDimensionCancel: handleExtrudeDimensionCancel,
    handleDimensionChange: handleExtrudeDimensionChange,
    operationType: extrudeOpType,
    toggleOperationType: toggleExtrudeOpType,
    cleanup: cleanupExtrude,
    dimSceneBodies: dimExtrudeBodies,
  } = useExtrudeMode();

  const {
    selectedElement: filletSelectedElement,
    selectedEdgeIndices: filletSelectedEdges,
    radius: filletRadius,
    operationType: filletOpType,
    isApplying: filletIsApplying,
    showDimensionInput: showFilletDimensionInput,
    dimensionInputPosition: filletDimensionPosition,
    handleMouseDown: handleFilletMouseDown,
    handleMouseMove: handleFilletMouseMove,
    handleMouseUp: handleFilletMouseUp,
    handleKeyDown: handleFilletKeyDown,
    handleRadiusSubmit: handleFilletRadiusSubmit,
    handleRadiusCancel: handleFilletRadiusCancel,
    toggleOperationType: toggleFilletOpType,
    cleanup: cleanupFillet,
  } = useFilletMode();

  const {
    phase: sweepPhase,
    selectedProfile: sweepSelectedProfile,
    selectedPath: sweepSelectedPath,
    isApplying: sweepIsApplying,
    orientation: sweepOrientation,
    cornerMode: sweepCornerMode,
    setOrientation: setSweepOrientation,
    setCornerMode: setSweepCornerMode,
    handleMouseDown: handleSweepMouseDown,
    handleMouseMove: handleSweepMouseMove,
    handleKeyDown: handleSweepKeyDown,
    performSweep,
    canSweep,
    cleanup: cleanupSweep,
  } = useSweepMode();

  const {
    selectedProfiles: loftSelectedProfiles,
    isApplying: loftIsApplying,
    isRuled: loftIsRuled,
    setIsRuled: setLoftIsRuled,
    handleMouseDown: handleLoftMouseDown,
    handleMouseMove: handleLoftMouseMove,
    handleKeyDown: handleLoftKeyDown,
    performLoft,
    canLoft,
    cleanup: cleanupLoft,
  } = useLoftMode();

  const {
    phase: revolvePhase,
    isApplying: revolveIsApplying,
    angle: revolveAngle,
    angle2: revolveAngle2,
    direction: revolveDirection,
    showDimensionInput: revolveShowDimInput,
    dimensionInputPosition: revolveDimPos,
    setAngle: setRevolveAngle,
    setAngle2: setRevolveAngle2,
    setDirection: setRevolveDirection,
    flipAxis: flipRevolveAxis,
    handleMouseDown: handleRevolveMouseDown,
    handleMouseMove: handleRevolveMouseMove,
    handleKeyDown: handleRevolveKeyDown,
    performRevolve,
    selectOriginAxis,
    cleanup: cleanupRevolve,
  } = useRevolveMode();

  const {
    subMode: measureSubMode,
    statusText: measureStatusText,
    handleMouseDown: handleMeasureMouseDown,
    handleMouseMove: handleMeasureMouseMove,
    handleKeyDown: handleMeasureKeyDown,
    setSubMode: setMeasureSubMode,
    clearTemporaryMeasurements,
    cleanup: cleanupMeasure,
    measurements: temporaryMeasurements,
    selectedMeasurementId,
    selectMeasurement,
    pinMeasurement,
    unpinMeasurement,
    deleteMeasurement,
  } = useMeasureMode();

  // Camera animation (named views + fit all)
  const { animateToView, fitAll } = useCameraAnimation(camera, controls);

  const handleViewCubeClick = (viewName: NamedView) => {
    animateToView(viewName);
  };

  const handleFitAll = () => {
    fitAll(elements, getObject);
  };

  // Dimension input state
  const [dimensionInputVisible, setDimensionInputVisible] = useState(false);
  const [dimensionInputPosition, setDimensionInputPosition] = useState({
    x: 0,
    y: 0,
  });
  const [dimensionInputLabel, setDimensionInputLabel] = useState("");
  const [dimensionInputValue, setDimensionInputValue] = useState<
    number | undefined
  >(undefined);
  const [pendingDimensionPrimitiveId, setPendingDimensionPrimitiveId] =
    useState<string | null>(null);
  const [dimensionSource, setDimensionSource] = useState<
    "lineCreation" | "dimensionMode" | "constraintEdit" | null
  >(null);

  const selectedObjectRef = useRef<string | null>(null);
  useEffect(() => {
    selectedObjectRef.current = selectedObject;
  }, [selectedObject]);

  // Compute browser panel sections from feature tree
  const browserSections = useMemo(
    () =>
      buildBrowserSections(featureTree, sectionExpandedState, originVisibility),
    [featureTree, sectionExpandedState, originVisibility],
  );

  // Selection sync: tree → 3D viewport
  const handleBrowserSelect = (elementId: string) => {
    // Deselect any currently selected elements first
    deselectAll();
    selectElement(elementId);
  };

  // Route visibility toggles: origin items → originVisibility, others → featureTree
  const handleToggleVisibility = (nodeId: string) => {
    if (nodeId.startsWith("origin-")) {
      toggleOriginVisibility(nodeId);
    } else {
      toggleNodeVisibility(nodeId);
    }
  };

  // Determine which element is currently selected for tree highlight
  const selectedElementId =
    selectedElements.length === 1 ? selectedElements[0] : undefined;

  useEffect(() => {
    if (!mountRef.current) return;

    if (renderer) {
      unmountRenderer();
    }

    const cleanup = mountRenderer(mountRef.current);
    return cleanup;
  }, []);

  useEffect(() => {
    const setupElementVisualizations = () => {
      elements.forEach((element) => {
        const obj = getObject(element.nodeId);
        if (!obj) return;

        // Key tracks which data source was used to build helpers
        const currentKey = element.edgeGeometry
          ? `occ-${element.edgeGeometry.uuid}`
          : "fallback";

        // Skip if helpers already match current data source
        if (obj.userData.helperDataKey === currentKey) return;

        // Remove stale helpers when data source changed
        if (obj.userData.helperDataKey) {
          const toRemove: THREE.Object3D[] = [];
          obj.traverse((child) => {
            if (child.userData.isHelper) toRemove.push(child);
          });
          toRemove.forEach((child) => {
            child.parent?.remove(child);
          });
        }

        if (element.edgeGeometry) {
          // Clean OCC-based edge helper using LineSegments2 for fat lines
          const lineGeo = new LineSegmentsGeometry();
          lineGeo.setPositions(element.edgeGeometry.attributes.position.array as Float32Array);
          const edgeMaterial = new LineMaterial({
            color: HELPERS.edgeColor,
            linewidth: HELPERS.edgeWidth,
            depthTest: false,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
          });
          const edgeHelper = new LineSegments2(lineGeo, edgeMaterial);
          edgeHelper.renderOrder = 999;
          edgeHelper.userData.isHelper = true;
          edgeHelper.userData.helperType = "edge";
          edgeHelper.visible = false;
          obj.add(edgeHelper);

          // Vertex helper from precomputed topological corner positions
          const vertexGroup = new THREE.Group();
          vertexGroup.userData.isHelper = true;
          vertexGroup.userData.helperType = "vertex";
          const sphereGeo = new THREE.SphereGeometry(0.05, 16, 16);
          const sphereMat = new THREE.MeshBasicMaterial({ color: HELPERS.vertexColor, depthTest: false });
          if (element.vertexPositions !== undefined) {
            for (let i = 0; i < element.vertexPositions.length; i += 3) {
              const sphere = new THREE.Mesh(sphereGeo, sphereMat);
              sphere.position.set(
                element.vertexPositions[i],
                element.vertexPositions[i + 1],
                element.vertexPositions[i + 2],
              );
              sphere.renderOrder = 1000;
              vertexGroup.add(sphere);
            }
          } else {
            // No vertexPositions — show no vertex spheres.
            // All code paths that set edgeGeometry should also set vertexPositions.
          }
          vertexGroup.visible = false;
          obj.add(vertexGroup);
        } else {
          // Find the mesh geometry to create clean helpers via EdgesGeometry
          let meshGeometry: THREE.BufferGeometry | null = null;
          obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
              meshGeometry = (child as THREE.Mesh).geometry;
            }
          });

          if (meshGeometry) {
            // Create filtered edges (removes coplanar tessellation edges, keeps boundaries)
            const edges = new THREE.EdgesGeometry(meshGeometry, 15);
            const posArray = edges.attributes.position.array as Float32Array;

            // Edge helper using LineSegments2 for fat lines
            const lineGeo = new LineSegmentsGeometry();
            lineGeo.setPositions(posArray);
            const edgeMaterial = new LineMaterial({
              color: HELPERS.edgeColor,
              linewidth: HELPERS.edgeWidth,
              depthTest: false,
              resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            });
            const edgeHelper = new LineSegments2(lineGeo, edgeMaterial);
            edgeHelper.renderOrder = 999;
            edgeHelper.userData.isHelper = true;
            edgeHelper.userData.helperType = "edge";
            edgeHelper.visible = false;
            obj.add(edgeHelper);
            edges.dispose();

            // Vertex helper: only at "corner" vertices where edge direction changes significantly
            const CORNER_ANGLE_THRESHOLD = 25; // degrees
            const cosThreshold = Math.cos((180 - CORNER_ANGLE_THRESHOLD) * Math.PI / 180);

            // Collect edge segments as pairs of points
            const segments: { ax: number; ay: number; az: number; bx: number; by: number; bz: number }[] = [];
            for (let i = 0; i < posArray.length; i += 6) {
              segments.push({
                ax: posArray[i], ay: posArray[i + 1], az: posArray[i + 2],
                bx: posArray[i + 3], by: posArray[i + 4], bz: posArray[i + 5],
              });
            }

            // For each unique vertex, collect normalized directions of edges emanating from it
            const vertexDirs = new Map<string, { x: number; y: number; z: number; dirs: { dx: number; dy: number; dz: number }[] }>();
            const toKey = (x: number, y: number, z: number) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;

            for (const seg of segments) {
              let dx = seg.bx - seg.ax, dy = seg.by - seg.ay, dz = seg.bz - seg.az;
              const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (len < 1e-10) continue;
              dx /= len; dy /= len; dz /= len;

              const keyA = toKey(seg.ax, seg.ay, seg.az);
              if (!vertexDirs.has(keyA)) vertexDirs.set(keyA, { x: seg.ax, y: seg.ay, z: seg.az, dirs: [] });
              vertexDirs.get(keyA)!.dirs.push({ dx, dy, dz });

              const keyB = toKey(seg.bx, seg.by, seg.bz);
              if (!vertexDirs.has(keyB)) vertexDirs.set(keyB, { x: seg.bx, y: seg.by, z: seg.bz, dirs: [] });
              vertexDirs.get(keyB)!.dirs.push({ dx: -dx, dy: -dy, dz: -dz });
            }

            // A vertex is a "corner" if any pair of its edge directions has dot < cosThreshold
            const vertexGroup = new THREE.Group();
            vertexGroup.userData.isHelper = true;
            vertexGroup.userData.helperType = "vertex";
            const sphereGeo = new THREE.SphereGeometry(0.05, 16, 16);
            const sphereMat = new THREE.MeshBasicMaterial({ color: HELPERS.vertexColor, depthTest: false });

            for (const [, info] of vertexDirs) {
              let isCorner = false;
              const dirs = info.dirs;
              for (let i = 0; i < dirs.length && !isCorner; i++) {
                for (let j = i + 1; j < dirs.length && !isCorner; j++) {
                  const dot = dirs[i].dx * dirs[j].dx + dirs[i].dy * dirs[j].dy + dirs[i].dz * dirs[j].dz;
                  if (dot > cosThreshold) isCorner = true;
                }
              }
              if (isCorner) {
                const sphere = new THREE.Mesh(sphereGeo, sphereMat);
                sphere.position.set(info.x, info.y, info.z);
                sphere.renderOrder = 1000;
                vertexGroup.add(sphere);
              }
            }
            vertexGroup.visible = false;
            obj.add(vertexGroup);
          }
        }

        obj.userData.helperDataKey = currentKey;
      });
    };

    if (scene) {
      setupElementVisualizations();
    }
  }, [elements, scene]);

  // Keep LineMaterial resolution in sync with window size for all fat lines in the scene
  useEffect(() => {
    if (!scene) return;
    const handleResize = () => {
      const res = new THREE.Vector2(window.innerWidth, window.innerHeight);
      scene.traverse((child) => {
        if ((child instanceof LineSegments2 || child instanceof Line2) &&
            (child.material as LineMaterial).resolution) {
          (child.material as LineMaterial).resolution.copy(res);
        }
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [scene]);

  useEffect(() => {
    if (!renderer) return;

    const handleMouseMove = (event: MouseEvent) => {
      updateCursorPosition(event);
    };

    renderer.domElement.addEventListener("mousemove", handleMouseMove);

    return () => {
      renderer.domElement.removeEventListener("mousemove", handleMouseMove);
    };
  }, [renderer, updateCursorPosition]);

  // Global keyboard listener for sketch mode shortcuts
  useEffect(() => {
    if (mode !== "sketch") return;

    window.addEventListener("keydown", handleSketchKeyDown);

    return () => {
      window.removeEventListener("keydown", handleSketchKeyDown);
    };
  }, [mode, handleSketchKeyDown]);

  // Global keyboard listener for extrude mode (Escape to cancel)
  useEffect(() => {
    if (mode !== "extrude") return;

    window.addEventListener("keydown", handleExtrudeKeyDown);

    return () => {
      window.removeEventListener("keydown", handleExtrudeKeyDown);
    };
  }, [mode, handleExtrudeKeyDown]);

  // Dim 3D bodies when entering extrude mode (re-dim when elements change, e.g. new profile added)
  useEffect(() => {
    if (mode !== "extrude") return;
    dimExtrudeBodies();
  }, [mode, elements, dimExtrudeBodies]);

  // Global keyboard listener for fillet mode
  useEffect(() => {
    if (mode !== "fillet") return;

    window.addEventListener("keydown", handleFilletKeyDown);

    return () => {
      window.removeEventListener("keydown", handleFilletKeyDown);
    };
  }, [mode, handleFilletKeyDown]);

  // Global keyboard listener for sweep mode
  useEffect(() => {
    if (mode !== "sweep") return;

    window.addEventListener("keydown", handleSweepKeyDown);

    return () => {
      window.removeEventListener("keydown", handleSweepKeyDown);
    };
  }, [mode, handleSweepKeyDown]);

  // Global keyboard listener for loft mode
  useEffect(() => {
    if (mode !== "loft") return;

    window.addEventListener("keydown", handleLoftKeyDown);

    return () => {
      window.removeEventListener("keydown", handleLoftKeyDown);
    };
  }, [mode, handleLoftKeyDown]);

  // Global keyboard listener for revolve mode
  useEffect(() => {
    if (mode !== "revolve") return;

    window.addEventListener("keydown", handleRevolveKeyDown);

    return () => {
      window.removeEventListener("keydown", handleRevolveKeyDown);
    };
  }, [mode, handleRevolveKeyDown]);

  // Global keyboard listener for measure mode
  useEffect(() => {
    if (mode !== "measure") return;

    const handleMeasureKeys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      const key = event.key.toLowerCase();
      if (key === "p") {
        // Pin selected or last measurement (pinMeasurement has fallback-to-last)
        pinMeasurement();
      } else if (key === "c") {
        clearTemporaryMeasurements();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteMeasurement();
      } else {
        // Delegate D/E/A/Escape to the hook's handler
        handleMeasureKeyDown(event);
      }
    };

    window.addEventListener("keydown", handleMeasureKeys);

    return () => {
      window.removeEventListener("keydown", handleMeasureKeys);
    };
  }, [mode, handleMeasureKeyDown, clearTemporaryMeasurements, pinMeasurement, deleteMeasurement]);

  // Centralized mode cleanup: when mode changes, clean up the previous mode
  const modeCleanupMap = useMemo<Record<SceneMode, (() => void) | null>>(() => ({
    move: cleanupMove,
    extrude: cleanupExtrude,
    fillet: cleanupFillet,
    sweep: cleanupSweep,
    loft: cleanupLoft,
    revolve: cleanupRevolve,
    combine: cleanupCombine,
    measure: cleanupMeasure,
    sketch: null, // managed by finishSketch/cancelSketch
  }), [cleanupMove, cleanupExtrude, cleanupFillet, cleanupSweep,
       cleanupLoft, cleanupRevolve, cleanupCombine, cleanupMeasure]);

  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prevMode = prevModeRef.current;
    if (prevMode !== mode) {
      const cleanupFn = modeCleanupMap[prevMode];
      if (cleanupFn) cleanupFn();
    }
    prevModeRef.current = mode;
  }, [mode, modeCleanupMap]);

  // Global keyboard listener for undo/redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
  // In sketch mode with active sketch, routes to sketch undo/redo exclusively
  useEffect(() => {
    const handleUndoRedoKeys = (event: KeyboardEvent) => {
      const isUndo =
        (event.ctrlKey || event.metaKey) &&
        event.key === "z" &&
        !event.shiftKey;
      const isRedo =
        (event.ctrlKey || event.metaKey) &&
        (event.key === "y" ||
          (event.key === "z" && event.shiftKey) ||
          (event.key === "Z" && event.shiftKey));

      if (!isUndo && !isRedo) return;
      event.preventDefault();

      const inSketchMode = mode === "sketch" && activeSketch;

      if (isUndo) {
        if (inSketchMode) {
          undoSketch();
        } else {
          undo();
        }
      } else {
        if (inSketchMode) {
          redoSketch();
        } else {
          redo();
        }
      }
    };

    window.addEventListener("keydown", handleUndoRedoKeys);
    return () => {
      window.removeEventListener("keydown", handleUndoRedoKeys);
    };
  }, [mode, activeSketch, undo, redo, undoSketch, redoSketch]);

  // Global keyboard listener for Ctrl+D (duplicate)
  useEffect(() => {
    const handleDuplicate = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "d") {
        event.preventDefault();
        if (mode === "sketch" && activeSketch) return;
        if (isOperationPending) return;
        if (selectedElements.length === 0) return;
        duplicateSelectedElements();
      }
    };
    window.addEventListener("keydown", handleDuplicate);
    return () => window.removeEventListener("keydown", handleDuplicate);
  }, [mode, activeSketch, isOperationPending, selectedElements, duplicateSelectedElements]);

  // View shortcut keys (numpad + number keys)
  useEffect(() => {
    const handleViewKeys = (event: KeyboardEvent) => {
      // Skip if in input field
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      // Skip if in sketch mode or fillet mode (R and F keys conflict)
      if (mode === "sketch" || mode === "fillet") return;

      switch (event.key) {
        case "1":
        case "Numpad1":
          animateToView("front");
          event.preventDefault();
          break;
        case "3":
        case "Numpad3":
          animateToView("right");
          event.preventDefault();
          break;
        case "7":
        case "Numpad7":
          animateToView("top");
          event.preventDefault();
          break;
        case "0":
        case "Numpad0":
          animateToView("isometric");
          event.preventDefault();
          break;
        case "5":
        case "Numpad5":
          if (mode !== "sketch") {
            toggleProjection();
          }
          event.preventDefault();
          break;
        case "f":
          // F = Fit All, only in move mode to avoid conflict with fillet's F key
          if (mode === "move") {
            handleFitAll();
            event.preventDefault();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleViewKeys);
    return () => {
      window.removeEventListener("keydown", handleViewKeys);
    };
  }, [mode, animateToView, handleFitAll, toggleProjection]);

  // Prevent default browser context menu in sketch mode
  useEffect(() => {
    if (mode !== "sketch" || !renderer) return;

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    renderer.domElement.addEventListener("contextmenu", handleContextMenu);

    return () => {
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [mode, renderer]);

  // Show dimension input when primitive is selected in dimension mode
  useEffect(() => {
    // Don't interfere if showing line-creation dimension input
    if (dimensionSource === "lineCreation") return;

    if (
      mode !== "sketch" ||
      sketchSubMode !== "dimension" ||
      selectedPrimitives.length !== 1
    ) {
      if (dimensionSource === "dimensionMode") {
        setDimensionInputVisible(false);
        setPendingDimensionPrimitiveId(null);
        setDimensionSource(null);
      }
      return;
    }

    const primitiveId = selectedPrimitives[0];
    if (!activeSketch || !renderer) return;

    // Find the primitive
    const primitive = activeSketch.primitives.find((p) => p.id === primitiveId);
    if (!primitive) return;

    // Determine dimension type and position based on primitive type
    let label = "";
    let value: number | undefined;
    let worldPos = new THREE.Vector3();

    if (primitive.type === "line") {
      label = "Length";
      const p1 = activeSketch.primitives.find(
        (p) => p.id === primitive.p1Id && p.type === "point",
      );
      const p2 = activeSketch.primitives.find(
        (p) => p.id === primitive.p2Id && p.type === "point",
      );
      if (p1 && p2 && p1.type === "point" && p2.type === "point") {
        const length = Math.sqrt(
          Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2),
        );
        value = length;
        worldPos.set((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0);
      }
    } else if (primitive.type === "circle") {
      label = "Radius";
      value = primitive.radius;
      const center = activeSketch.primitives.find(
        (p) => p.id === primitive.centerId && p.type === "point",
      );
      if (center && center.type === "point") {
        worldPos.set(center.x + primitive.radius / 2, center.y, 0);
      }
    } else if (primitive.type === "arc") {
      label = "Radius";
      value = primitive.radius;
      const center = activeSketch.primitives.find(
        (p) => p.id === primitive.centerId && p.type === "point",
      );
      if (center && center.type === "point") {
        worldPos.set(center.x, center.y, 0);
      }
    } else {
      setDimensionInputVisible(false);
      return;
    }

    // Convert world position to screen position
    if (camera) {
      worldPos.project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      const screenX = ((worldPos.x + 1) / 2) * rect.width + rect.left;
      const screenY = ((-worldPos.y + 1) / 2) * rect.height + rect.top;

      setDimensionInputPosition({ x: screenX, y: screenY });
      setDimensionInputLabel(label);
      setDimensionInputValue(value);
      setPendingDimensionPrimitiveId(primitiveId);
      setDimensionSource("dimensionMode");
      setDimensionInputVisible(true);
    }
  }, [
    mode,
    sketchSubMode,
    selectedPrimitives,
    activeSketch,
    camera,
    renderer,
    dimensionSource,
  ]);

  // Show dimension input immediately after line creation
  useEffect(() => {
    if (!pendingLineDimension || !renderer || !camera) {
      return;
    }

    const worldPos = pendingLineDimension.midpoint.clone();
    worldPos.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const screenX = ((worldPos.x + 1) / 2) * rect.width + rect.left;
    const screenY = ((-worldPos.y + 1) / 2) * rect.height + rect.top;

    setDimensionInputPosition({ x: screenX, y: screenY });
    setDimensionInputLabel("Length");
    setDimensionInputValue(pendingLineDimension.length);
    setPendingDimensionPrimitiveId(pendingLineDimension.lineId);
    setDimensionSource("lineCreation");
    setDimensionInputVisible(true);
  }, [pendingLineDimension, renderer, camera]);

  // Show dimension input when double-clicking a constraint glyph
  const editingConstraintRef = useRef<{ id: string; type: string; primitiveIds: string[] } | null>(null);
  useEffect(() => {
    if (!editingConstraintId || !activeSketch || !renderer || !camera) return;

    const constraint = activeSketch.constraints.find(c => c.id === editingConstraintId);
    if (!constraint || constraint.value === undefined) return;

    // Store constraint info for submit handler
    editingConstraintRef.current = {
      id: constraint.id,
      type: constraint.type,
      primitiveIds: [...constraint.primitiveIds],
    };

    // Find position for the dimension input from the constraint's primitive positions
    let worldPos = new THREE.Vector3();
    const plane = activeSketch.plane;
    const sketchTo3D = (x: number, y: number) =>
      new THREE.Vector3().copy(plane.origin).addScaledVector(plane.xAxis, x).addScaledVector(plane.yAxis, y);

    if (constraint.primitiveIds.length === 2) {
      // Point-point distance: midpoint
      const p1 = activeSketch.primitives.find(p => p.id === constraint.primitiveIds[0] && p.type === "point");
      const p2 = activeSketch.primitives.find(p => p.id === constraint.primitiveIds[1] && p.type === "point");
      if (p1 && p1.type === "point" && p2 && p2.type === "point") {
        worldPos = sketchTo3D((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      }
    } else if (constraint.primitiveIds.length === 1) {
      const prim = activeSketch.primitives.find(p => p.id === constraint.primitiveIds[0]);
      if (prim?.type === "line") {
        const p1 = activeSketch.primitives.find(p => p.id === prim.p1Id && p.type === "point");
        const p2 = activeSketch.primitives.find(p => p.id === prim.p2Id && p.type === "point");
        if (p1 && p1.type === "point" && p2 && p2.type === "point") {
          worldPos = sketchTo3D((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        }
      } else if (prim?.type === "circle" || prim?.type === "arc") {
        const center = activeSketch.primitives.find(p => p.id === prim.centerId && p.type === "point");
        if (center && center.type === "point") {
          worldPos = sketchTo3D(center.x + (prim.radius || 0) / 2, center.y);
        }
      }
    }

    // Convert to screen coords
    worldPos.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const screenX = ((worldPos.x + 1) / 2) * rect.width + rect.left;
    const screenY = ((-worldPos.y + 1) / 2) * rect.height + rect.top;

    // Display value: convert angle from radians to degrees
    const displayValue = constraint.type === "angle"
      ? Math.round((constraint.value * 180) / Math.PI)
      : constraint.value;

    setDimensionInputPosition({ x: screenX, y: screenY });
    setDimensionInputLabel(constraint.type.charAt(0).toUpperCase() + constraint.type.slice(1));
    setDimensionInputValue(displayValue);
    setPendingDimensionPrimitiveId(constraint.id);
    setDimensionSource("constraintEdit");
    setDimensionInputVisible(true);
  }, [editingConstraintId, activeSketch, renderer, camera]);

  // Handle dimension input submission
  const handleDimensionSubmit = (value: number) => {
    if (dimensionSource === "constraintEdit" && editingConstraintRef.current && activeSketch) {
      const { id: oldId, type, primitiveIds } = editingConstraintRef.current;
      // Convert angle from degrees to radians
      const finalValue = type === "angle" ? (value * Math.PI) / 180 : value;
      // Remove old constraint and add new one with updated value
      pushSketchUndo();
      removeSketchConstraint(oldId);
      addConstraintAndSolve({
        id: `const_${Date.now()}`,
        type: type as any,
        primitiveIds,
        value: finalValue,
        driving: true,
      });
      editingConstraintRef.current = null;
      setDimensionInputVisible(false);
      setPendingDimensionPrimitiveId(null);
      setDimensionSource(null);
      return;
    }

    if (!pendingDimensionPrimitiveId) return;

    if (dimensionSource === "lineCreation") {
      applyLineLengthConstraint(pendingDimensionPrimitiveId, value);
    } else if (dimensionSource === "dimensionMode" && activeSketch) {
      const primitive = activeSketch.primitives.find(
        (p) => p.id === pendingDimensionPrimitiveId,
      );
      if (!primitive) return;

      if (primitive.type === "line") {
        applyConstraint("distance", value);
      } else if (primitive.type === "circle" || primitive.type === "arc") {
        applyConstraint("radius", value);
      }
    }

    setDimensionInputVisible(false);
    setPendingDimensionPrimitiveId(null);
    setDimensionSource(null);
  };

  const handleDimensionCancel = () => {
    if (dimensionSource === "lineCreation") {
      clearPendingLineDimension();
    }
    editingConstraintRef.current = null;
    setDimensionInputVisible(false);
    setPendingDimensionPrimitiveId(null);
    setDimensionSource(null);
  };

  // "Fully constrained" toast when DOF transitions to 0
  const prevDofRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeSketch) { prevDofRef.current = null; return; }
    if (prevDofRef.current !== null && prevDofRef.current > 0 && activeSketch.dof === 0) {
      showToast("Sketch fully constrained", "success");
    }
    prevDofRef.current = activeSketch.dof;
  }, [activeSketch?.dof, activeSketch, showToast]);

  // Close undo/redo dropdowns on click outside
  useEffect(() => {
    if (!undoDropdownOpen && !redoDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        undoDropdownOpen &&
        undoDropdownRef.current &&
        !undoDropdownRef.current.contains(event.target as Node)
      ) {
        setUndoDropdownOpen(false);
      }
      if (
        redoDropdownOpen &&
        redoDropdownRef.current &&
        !redoDropdownRef.current.contains(event.target as Node)
      ) {
        setRedoDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [undoDropdownOpen, redoDropdownOpen]);

  useEffect(() => {
    if (!renderer || !camera || !scene) return;

    const handleMoveMode = (event: MouseEvent) => {
      if (event.type === "mousedown") {
        handleMouseDown(event);
      } else if (event.type === "mousemove") {
        handleMouseMove(event);
      } else if (event.type === "mouseup") {
        handleMouseUp(event);
      }
    };

    if (mode === "move") {
      renderer.domElement.addEventListener("mousedown", handleMoveMode);
      renderer.domElement.addEventListener("mousemove", handleMoveMode);
      renderer.domElement.addEventListener("mouseup", handleMoveMode);
    } else if (mode === "combine") {
      renderer.domElement.addEventListener("mousedown", handleCombineMouseDown);
      renderer.domElement.addEventListener("mousemove", handleCombineMouseMove);
    } else if (mode === "sketch") {
      renderer.domElement.addEventListener("mousedown", handleSketchMode);
      renderer.domElement.addEventListener("mousemove", handleSketchMode);
      renderer.domElement.addEventListener("mouseup", handleSketchMode);
    } else if (mode === "extrude") {
      renderer.domElement.addEventListener("mousedown", handleExtrudeMouseDown);
      renderer.domElement.addEventListener("mousemove", handleExtrudeMouseMove);
      renderer.domElement.addEventListener("mouseup", handleExtrudeMouseUp);
    } else if (mode === "fillet") {
      renderer.domElement.addEventListener("mousedown", handleFilletMouseDown);
      renderer.domElement.addEventListener("mousemove", handleFilletMouseMove);
      renderer.domElement.addEventListener("mouseup", handleFilletMouseUp);
    } else if (mode === "sweep") {
      renderer.domElement.addEventListener("mousedown", handleSweepMouseDown);
      renderer.domElement.addEventListener("mousemove", handleSweepMouseMove);
    } else if (mode === "loft") {
      renderer.domElement.addEventListener("mousedown", handleLoftMouseDown);
      renderer.domElement.addEventListener("mousemove", handleLoftMouseMove);
    } else if (mode === "revolve") {
      renderer.domElement.addEventListener("mousedown", handleRevolveMouseDown);
      renderer.domElement.addEventListener("mousemove", handleRevolveMouseMove);
    } else if (mode === "measure") {
      renderer.domElement.addEventListener("mousedown", handleMeasureMouseDown);
      renderer.domElement.addEventListener("mousemove", handleMeasureMouseMove);
    }

    return () => {
      renderer.domElement.removeEventListener("mousedown", handleMoveMode);
      renderer.domElement.removeEventListener("mousemove", handleMoveMode);
      renderer.domElement.removeEventListener("mouseup", handleMoveMode);
      renderer.domElement.removeEventListener("mousedown", handleCombineMouseDown);
      renderer.domElement.removeEventListener("mousemove", handleCombineMouseMove);
      renderer.domElement.removeEventListener("mousedown", handleSketchMode);
      renderer.domElement.removeEventListener("mousemove", handleSketchMode);
      renderer.domElement.removeEventListener("mouseup", handleSketchMode);
      renderer.domElement.removeEventListener(
        "mousedown",
        handleExtrudeMouseDown,
      );
      renderer.domElement.removeEventListener(
        "mousemove",
        handleExtrudeMouseMove,
      );
      renderer.domElement.removeEventListener("mouseup", handleExtrudeMouseUp);
      renderer.domElement.removeEventListener(
        "mousedown",
        handleFilletMouseDown,
      );
      renderer.domElement.removeEventListener(
        "mousemove",
        handleFilletMouseMove,
      );
      renderer.domElement.removeEventListener("mouseup", handleFilletMouseUp);
      renderer.domElement.removeEventListener("mousedown", handleSweepMouseDown);
      renderer.domElement.removeEventListener("mousemove", handleSweepMouseMove);
      renderer.domElement.removeEventListener("mousedown", handleLoftMouseDown);
      renderer.domElement.removeEventListener("mousemove", handleLoftMouseMove);
      renderer.domElement.removeEventListener("mousedown", handleRevolveMouseDown);
      renderer.domElement.removeEventListener("mousemove", handleRevolveMouseMove);
      renderer.domElement.removeEventListener("mousedown", handleMeasureMouseDown);
      renderer.domElement.removeEventListener("mousemove", handleMeasureMouseMove);
    };
  }, [
    mode,
    camera,
    scene,
    elements,
    selectedElements,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleCombineMouseDown,
    handleCombineMouseMove,
    clearSelection,
    handleSketchMode,
    handleExtrudeMouseDown,
    handleExtrudeMouseMove,
    handleExtrudeMouseUp,
    handleFilletMouseDown,
    handleFilletMouseMove,
    handleFilletMouseUp,
    handleSweepMouseDown,
    handleSweepMouseMove,
    handleLoftMouseDown,
    handleLoftMouseMove,
    handleRevolveMouseDown,
    handleRevolveMouseMove,
    handleMeasureMouseDown,
    handleMeasureMouseMove,
  ]);

  // Plane selection event listeners
  useEffect(() => {
    if (!renderer || !isSelectingPlane) return;

    renderer.domElement.addEventListener(
      "mousemove",
      handlePlaneSelectionMouseMove,
    );
    renderer.domElement.addEventListener("click", handlePlaneSelectionClick);

    return () => {
      renderer.domElement.removeEventListener(
        "mousemove",
        handlePlaneSelectionMouseMove,
      );
      renderer.domElement.removeEventListener(
        "click",
        handlePlaneSelectionClick,
      );
    };
  }, [
    renderer,
    isSelectingPlane,
    handlePlaneSelectionMouseMove,
    handlePlaneSelectionClick,
  ]);

  // ── Persistent origin helpers (planes, axes, origin point) ──────────
  const originGroupRef = useRef<THREE.Group | null>(null);

  // Create persistent origin helpers on mount
  useEffect(() => {
    if (!scene) return;

    const group = new THREE.Group();
    group.userData.isOriginHelper = true;

    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];

    const planeSize = 4;
    const halfSize = planeSize / 2;

    // ── Planes ──────────────────────────────────────────────
    // XY plane (blue)
    const xyGeo = new THREE.PlaneGeometry(planeSize, planeSize);
    geometries.push(xyGeo);
    const xyMat = new THREE.MeshBasicMaterial({
      color: SKETCH_PLANE.xy,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(xyMat);
    const xyPlane = new THREE.Mesh(xyGeo, xyMat);
    xyPlane.position.set(halfSize, halfSize, 0);
    xyPlane.userData.originId = "origin-xy";
    group.add(xyPlane);

    // XZ plane (green)
    const xzGeo = new THREE.PlaneGeometry(planeSize, planeSize);
    geometries.push(xzGeo);
    const xzMat = new THREE.MeshBasicMaterial({
      color: SKETCH_PLANE.xz,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(xzMat);
    const xzPlane = new THREE.Mesh(xzGeo, xzMat);
    xzPlane.rotation.x = -Math.PI / 2;
    xzPlane.position.set(halfSize, 0, halfSize);
    xzPlane.userData.originId = "origin-xz";
    group.add(xzPlane);

    // YZ plane (red)
    const yzGeo = new THREE.PlaneGeometry(planeSize, planeSize);
    geometries.push(yzGeo);
    const yzMat = new THREE.MeshBasicMaterial({
      color: SKETCH_PLANE.yz,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(yzMat);
    const yzPlane = new THREE.Mesh(yzGeo, yzMat);
    yzPlane.rotation.y = Math.PI / 2;
    yzPlane.position.set(0, halfSize, halfSize);
    yzPlane.userData.originId = "origin-yz";
    group.add(yzPlane);

    // ── Axis lines ──────────────────────────────────────────
    // X axis (red)
    const xAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(planeSize, 0, 0),
    ]);
    geometries.push(xAxisGeo);
    const xAxisMat = new THREE.LineBasicMaterial({ color: SKETCH_PLANE.xAxis });
    materials.push(xAxisMat);
    const xAxis = new THREE.Line(xAxisGeo, xAxisMat);
    xAxis.userData.originId = "origin-x-axis";
    group.add(xAxis);

    // Y axis (green)
    const yAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, planeSize, 0),
    ]);
    geometries.push(yAxisGeo);
    const yAxisMat = new THREE.LineBasicMaterial({ color: SKETCH_PLANE.yAxis });
    materials.push(yAxisMat);
    const yAxis = new THREE.Line(yAxisGeo, yAxisMat);
    yAxis.userData.originId = "origin-y-axis";
    group.add(yAxis);

    // Z axis (blue)
    const zAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, planeSize),
    ]);
    geometries.push(zAxisGeo);
    const zAxisMat = new THREE.LineBasicMaterial({ color: SKETCH_PLANE.zAxis });
    materials.push(zAxisMat);
    const zAxis = new THREE.Line(zAxisGeo, zAxisMat);
    zAxis.userData.originId = "origin-z-axis";
    group.add(zAxis);

    // ── Origin sphere ───────────────────────────────────────
    const originGeo = new THREE.SphereGeometry(0.1, 16, 16);
    geometries.push(originGeo);
    const originMat = new THREE.MeshBasicMaterial({
      color: SKETCH_PLANE.origin,
    });
    materials.push(originMat);
    const originSphere = new THREE.Mesh(originGeo, originMat);
    originSphere.userData.originId = "origin-point";
    group.add(originSphere);

    // Store for disposal
    group.userData.materials = materials;
    group.userData.geometries = geometries;

    scene.add(group);
    originGroupRef.current = group;

    return () => {
      if (originGroupRef.current) {
        scene.remove(originGroupRef.current);
        materials.forEach((m) => m.dispose());
        geometries.forEach((g) => g.dispose());
        originGroupRef.current = null;
      }
    };
  }, [scene]);

  // Sync visibility of each origin child with originVisibility state
  useEffect(() => {
    if (!originGroupRef.current) return;
    originGroupRef.current.traverse((child) => {
      if (child.userData.originId) {
        child.visible = originVisibility[child.userData.originId] ?? true;
      }
    });
  }, [originVisibility]);

  // Hide persistent origin helpers while sketch plane selection is active; reset offset input
  useEffect(() => {
    if (!originGroupRef.current) return;
    originGroupRef.current.visible = !isSelectingPlane;
    if (isSelectingPlane) {
      setPlaneOffset(0);
      setSketchPlaneOffset(0);
    }
  }, [isSelectingPlane, setSketchPlaneOffset]);

  // Helper to get mode display label
  const getModeLabel = (): string => {
    switch (mode) {
      case "sketch":
        return isSelectingPlane ? "Select Plane" : "Sketch";
      case "extrude":
        return "Extrude";
      case "fillet":
        return filletOpType === "fillet" ? "Fillet" : "Chamfer";
      case "move":
        return "Move";
      case "combine":
        return combineOpType === "join" ? "Join" : combineOpType === "cut" ? "Cut" : "Intersect";
      case "sweep":
        return "Sweep";
      case "loft":
        return "Loft";
      case "revolve":
        return "Revolve";
      case "measure":
        return "Measure";
      default:
        return mode.charAt(0).toUpperCase() + mode.slice(1);
    }
  };

  // Check if we're in a boolean mode
  const isBooleanMode = mode === "combine";

  // Lock UI during active sketch or async operations
  const inActiveSketch = mode === "sketch" && !!activeSketch;
  const isLocked = inActiveSketch || isOperationPending;

  // Check if secondary bar should be shown
  const showSecondaryBar =
    (mode === "sketch" && !isSelectingPlane && activeSketch) ||
    isBooleanMode ||
    mode === "extrude" ||
    mode === "fillet" ||
    mode === "sweep" ||
    mode === "loft" ||
    mode === "revolve" ||
    mode === "measure";

  return (
    <div className="w-full h-screen flex overflow-hidden">
      {/* Browser Panel - left side */}
      <div className="flex-none w-56 bg-gray-800 bg-opacity-90 border-r border-gray-700 overflow-hidden">
        <BrowserPanel
          sections={browserSections}
          selectedElementId={selectedElementId}
          onSelectNode={handleBrowserSelect}
          onToggleVisibility={handleToggleVisibility}
          onToggleSectionExpanded={toggleSectionExpanded}
          onToggleItemExpanded={toggleNodeExpanded}
          onRenameNode={renameNode}
          onDeleteNode={deleteNode}
        />
      </div>

      {/* Center column: toolbars + canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Primary Toolbar */}
        <div className="flex-none h-12 bg-gray-900 border-b border-gray-700 flex items-center z-20">
          <div className="flex items-center px-3 gap-1 min-w-0 flex-1">
            {/* File menu */}
            <FileMenu />

            {/* Separator */}
            <div className="flex-none w-px h-6 bg-gray-600 mx-1" />

            {/* Primary mode buttons */}
            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isOperationPending
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : mode === "sketch"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isOperationPending}
              onClick={() => {
                if (mode !== "sketch") {
                  setMode("sketch");
                  startNewSketch();
                } else if (!activeSketch) {
                  startNewSketch();
                }
              }}
            >
              Sketch
            </button>
            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isLocked
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : mode === "extrude"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isLocked}
              onClick={() => setMode("extrude")}
            >
              Extrude
            </button>
            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isLocked
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : mode === "move"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isLocked}
              onClick={() => setMode("move")}
            >
              Move
            </button>

            {/* Separator */}
            <div className="flex-none w-px h-6 bg-gray-600 mx-1" />

            {/* Combine (Boolean) button */}
            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isLocked
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : isBooleanMode
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isLocked}
              onClick={() => setMode("combine")}
            >
              Combine
            </button>

            {/* Fillet / Chamfer button */}
            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isLocked
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : mode === "fillet"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isLocked}
              onClick={() => setMode("fillet")}
            >
              Fillet (Chamfer)
            </button>
            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isLocked
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : mode === "sweep"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isLocked}
              onClick={() => setMode("sweep")}
            >
              Sweep
            </button>
            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isLocked
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : mode === "loft"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isLocked}
              onClick={() => setMode("loft")}
            >
              Loft
            </button>
            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isLocked
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : mode === "revolve"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isLocked}
              onClick={() => setMode("revolve")}
            >
              Revolve
            </button>

            {/* Separator */}
            <div className="flex-none w-px h-6 bg-gray-600 mx-1" />

            <button
              className={`flex-none px-3 py-1.5 text-sm rounded ${
                isLocked
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : mode === "measure"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              disabled={isLocked}
              onClick={() => setMode("measure")}
            >
              Measure
            </button>

            {/* Separator */}
            <div className="flex-none w-px h-6 bg-gray-600 mx-1" />

            {/* Grid toggle */}
            <button
              className={`flex-none px-2 py-1.5 text-sm rounded ${
                showGroundPlane
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 hover:bg-gray-600 text-gray-200"
              }`}
              onClick={toggleGroundPlane}
              title={showGroundPlane ? "Hide Grid" : "Show Grid"}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 3h18v18H3V3zM3 9h18M3 15h18M9 3v18M15 3v18"
                />
              </svg>
            </button>

            {/* Fit All */}
            <button
              className="flex-none px-2 py-1.5 text-sm rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
              onClick={handleFitAll}
              title="Fit All (F)"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M8 8h8v8H8z"
                />
              </svg>
            </button>

            {/* Separator */}
            <div className="flex-none w-px h-6 bg-gray-600 mx-1" />

            {/* Undo/Redo buttons — switch to sketch undo when in sketch mode */}
            {(() => {
              const inSketch = mode === "sketch" && !!activeSketch;
              const effectiveCanUndo = inSketch ? canUndoSketch : canUndo;
              const effectiveCanRedo = inSketch ? canRedoSketch : canRedo;
              const effectiveUndo = inSketch ? undoSketch : undo;
              const effectiveRedo = inSketch ? redoSketch : redo;
              const undoTitle = inSketch
                ? `Undo sketch action (Ctrl+Z)`
                : undoActionName
                  ? `Undo ${undoActionName} (Ctrl+Z)`
                  : "Undo (Ctrl+Z)";
              const redoTitle = inSketch
                ? `Redo sketch action (Ctrl+Y)`
                : redoActionName
                  ? `Redo ${redoActionName} (Ctrl+Y)`
                  : "Redo (Ctrl+Y)";

              return (
                <div className="flex items-center gap-0.5">
                  {/* Undo button with dropdown */}
                  <div className="relative" ref={undoDropdownRef}>
                    <div className="flex">
                      <button
                        className={`flex-none px-2 py-1.5 text-sm ${!inSketch && canUndo ? "rounded-l" : "rounded"} ${
                          effectiveCanUndo
                            ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
                            : "bg-gray-800 text-gray-500 cursor-not-allowed"
                        }`}
                        onClick={() => {
                          effectiveUndo();
                          setUndoDropdownOpen(false);
                        }}
                        disabled={!effectiveCanUndo}
                        title={undoTitle}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H3M3 10l4-4M3 10l4 4"
                          />
                        </svg>
                      </button>
                      {!inSketch && (
                        <button
                          className={`flex-none px-1 py-1.5 text-sm rounded-r border-l border-gray-600 ${
                            canUndo
                              ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
                              : "bg-gray-800 text-gray-500 cursor-not-allowed"
                          }`}
                          onClick={() => {
                            setUndoDropdownOpen(!undoDropdownOpen);
                            setRedoDropdownOpen(false);
                          }}
                          disabled={!canUndo}
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                    {!inSketch && undoDropdownOpen && undoStack.length > 0 && (
                      <div className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-600 rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
                        {[...undoStack].reverse().map((snapshot, idx) => (
                          <button
                            key={snapshot.timestamp}
                            className="w-full px-3 py-1.5 text-sm text-left text-gray-200 hover:bg-gray-700"
                            onClick={() => {
                              for (let i = 0; i <= idx; i++) {
                                undo();
                              }
                              setUndoDropdownOpen(false);
                            }}
                          >
                            {snapshot.actionName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Redo button with dropdown */}
                  <div className="relative" ref={redoDropdownRef}>
                    <div className="flex">
                      <button
                        className={`flex-none px-2 py-1.5 text-sm ${!inSketch && canRedo ? "rounded-l" : "rounded"} ${
                          effectiveCanRedo
                            ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
                            : "bg-gray-800 text-gray-500 cursor-not-allowed"
                        }`}
                        onClick={() => {
                          effectiveRedo();
                          setRedoDropdownOpen(false);
                        }}
                        disabled={!effectiveCanRedo}
                        title={redoTitle}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 10H11a5 5 0 00-5 5v0a5 5 0 005 5h10M21 10l-4-4M21 10l-4 4"
                          />
                        </svg>
                      </button>
                      {!inSketch && (
                        <button
                          className={`flex-none px-1 py-1.5 text-sm rounded-r border-l border-gray-600 ${
                            canRedo
                              ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
                              : "bg-gray-800 text-gray-500 cursor-not-allowed"
                          }`}
                          onClick={() => {
                            setRedoDropdownOpen(!redoDropdownOpen);
                            setUndoDropdownOpen(false);
                          }}
                          disabled={!canRedo}
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                    {!inSketch && redoDropdownOpen && redoStack.length > 0 && (
                      <div className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-600 rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
                        {[...redoStack].reverse().map((snapshot, idx) => (
                          <button
                            key={snapshot.timestamp}
                            className="w-full px-3 py-1.5 text-sm text-left text-gray-200 hover:bg-gray-700"
                            onClick={() => {
                              for (let i = 0; i <= idx; i++) {
                                redo();
                              }
                              setRedoDropdownOpen(false);
                            }}
                          >
                            {snapshot.actionName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Right side: mode label */}
            <div className="ml-auto flex-none text-sm text-gray-400">
              {getModeLabel()}
            </div>
          </div>
        </div>

        {/* Secondary Action Bar */}
        {showSecondaryBar && (
          <div className="flex-none h-10 bg-gray-800 border-b border-gray-700 flex items-center z-20">
            <div className="flex items-center px-3 min-w-0 flex-1 overflow-visible">
              {/* Sketch mode tools */}
              {mode === "sketch" && !isSelectingPlane && activeSketch && (
                <SketchToolbar
                  activeSketch={activeSketch}
                  sketchSubMode={sketchSubMode}
                  onSubModeChange={setSketchSubMode}
                  onFinishSketch={async () => {
                    const success = await finishSketch();
                    if (!success) showToast("Failed to finish sketch", "error");
                  }}
                  onCancelSketch={cancelSketch}
                  onSolveSketch={solveSketch}
                  selectedPrimitives={selectedPrimitives}
                  onApplyConstraint={applyConstraint}
                  isChaining={isChaining}
                  isOperationPending={isOperationPending}
                  onToggleFixPoint={toggleFixPoint}
                  gridSpacing={gridSpacing}
                  onGridSpacingChange={setGridSpacing}
                  gridSnapEnabled={gridSnapEnabled}
                  onGridSnapToggle={() => setGridSnapEnabled(!gridSnapEnabled)}
                />
              )}

              {/* Combine (Boolean) mode controls */}
              {mode === "combine" && (
                <div className="flex items-center gap-3">
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      combineOpType === "join"
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setCombineOpType("join")}
                  >
                    Join
                  </button>
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      combineOpType === "cut"
                        ? "bg-orange-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setCombineOpType("cut")}
                  >
                    Cut
                  </button>
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      combineOpType === "intersect"
                        ? "bg-purple-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setCombineOpType("intersect")}
                  >
                    Intersect
                  </button>
                  <div className="w-px h-4 bg-gray-600" />
                  <span className="text-sm text-gray-400">
                    {!combineTarget
                      ? "Select target body"
                      : combineTools.length === 0
                        ? "Select tool body(ies)"
                        : `Target: 1, Tools: ${combineTools.length}`}
                  </span>
                  {combineOpType !== "join" && (
                    <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={combineKeepTools}
                        onChange={(e) => setCombineKeepTools(e.target.checked)}
                        className="w-3 h-3"
                      />
                      Keep Tools
                    </label>
                  )}
                  {canCombine && (
                    <button
                      className={`flex-none px-3 py-1 text-sm text-white rounded ${
                        combineOpType === "join"
                          ? "bg-green-600 hover:bg-green-500"
                          : combineOpType === "cut"
                            ? "bg-orange-600 hover:bg-orange-500"
                            : "bg-purple-600 hover:bg-purple-500"
                      }`}
                      onClick={performCombine}
                    >
                      {combineOpType === "join" ? "Join" : combineOpType === "cut" ? "Cut" : "Intersect"} ({combineTools.length})
                    </button>
                  )}
                </div>
              )}

              {/* Extrude mode controls */}
              {mode === "extrude" && (
                <div className="flex items-center gap-3">
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      extrudeOpType === "join"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={toggleExtrudeOpType}
                  >
                    Join
                  </button>
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      extrudeOpType === "cut"
                        ? "bg-orange-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={toggleExtrudeOpType}
                  >
                    Cut
                  </button>
                  <div className="w-px h-4 bg-gray-600" />
                  <span className="text-sm text-gray-400">
                    {extrudeSelectedElement
                      ? isExtruding
                        ? `Depth: ${extrusionDepth.toFixed(2)}${extrudeDirection ? ` (${extrudeDirection})` : ""}`
                        : showExtrudeDimensionInput
                          ? `Depth: ${extrusionDepth.toFixed(2)} — Enter depth, confirm to apply | Esc to cancel`
                          : extrudeOpType === "cut" ? "Drag arrow to cut" : "Drag arrow to extrude"
                      : "Select a flat shape"}
                  </span>
                  <span className="text-xs text-gray-500">
                    Shift: symmetric | Ctrl: fine
                  </span>
                </div>
              )}

              {/* Fillet/Chamfer mode controls */}
              {mode === "fillet" && (
                <div className="flex items-center gap-3">
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      filletOpType === "fillet"
                        ? "bg-orange-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={toggleFilletOpType}
                  >
                    Fillet
                  </button>
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      filletOpType === "chamfer"
                        ? "bg-orange-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={toggleFilletOpType}
                  >
                    Chamfer
                  </button>
                  <div className="w-px h-4 bg-gray-600" />
                  <span className="text-sm text-gray-400">
                    {filletIsApplying
                      ? "Applying..."
                      : !filletSelectedElement
                        ? "Select a 3D body"
                        : filletSelectedEdges.length === 0
                          ? "Click edges to select (Ctrl+click for multiple)"
                          : `${filletSelectedEdges.length} edge(s) | Radius: ${filletRadius.toFixed(2)}`}
                  </span>
                  <span className="text-xs text-gray-500">
                    F: toggle | Enter: apply
                  </span>
                </div>
              )}

              {/* Sweep mode controls */}
              {mode === "sweep" && (
                <div className="flex items-center gap-3">
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      sweepOrientation === "perpendicular"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setSweepOrientation("perpendicular")}
                  >
                    Perpendicular
                  </button>
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      sweepOrientation === "parallel"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setSweepOrientation("parallel")}
                  >
                    Parallel
                  </button>
                  <div className="w-px h-4 bg-gray-600" />
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      sweepCornerMode === "right"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setSweepCornerMode("right")}
                  >
                    Right
                  </button>
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      sweepCornerMode === "round"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setSweepCornerMode("round")}
                  >
                    Round
                  </button>
                  <div className="w-px h-4 bg-gray-600" />
                  <span className="text-sm text-gray-400">
                    {sweepIsApplying
                      ? "Applying sweep..."
                      : sweepPhase === "SELECT_PROFILE"
                        ? "Select a flat profile"
                        : sweepPhase === "SELECT_PATH"
                          ? "Select a path"
                          : "Ready to sweep"}
                  </span>
                  {canSweep && (
                    <button
                      className="flex-none px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded"
                      onClick={performSweep}
                    >
                      Sweep
                    </button>
                  )}
                  <span className="text-xs text-gray-500">
                    Enter: apply | Esc: cancel
                  </span>
                </div>
              )}

              {/* Loft mode controls */}
              {mode === "loft" && (
                <div className="flex items-center gap-3">
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      !loftIsRuled
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setLoftIsRuled(false)}
                  >
                    Smooth
                  </button>
                  <button
                    className={`px-2 py-1 text-xs rounded ${
                      loftIsRuled
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setLoftIsRuled(true)}
                  >
                    Ruled
                  </button>
                  <div className="w-px h-4 bg-gray-600" />
                  <span className="text-sm text-gray-400">
                    {loftIsApplying
                      ? "Applying loft..."
                      : loftSelectedProfiles.length < 2
                        ? `Select 2+ flat profiles (${loftSelectedProfiles.length} selected)`
                        : `${loftSelectedProfiles.length} profiles selected`}
                  </span>
                  {canLoft && (
                    <button
                      className="flex-none px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded"
                      onClick={performLoft}
                    >
                      Loft ({loftSelectedProfiles.length})
                    </button>
                  )}
                  <span className="text-xs text-gray-500">
                    Enter: apply | Esc: cancel
                  </span>
                </div>
              )}

              {/* Revolve mode controls */}
              {mode === "revolve" && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">
                    {revolveIsApplying
                      ? "Applying revolve..."
                      : revolvePhase === "SELECT_PROFILE"
                        ? "Select a flat profile"
                        : revolvePhase === "SELECT_AXIS"
                          ? "Click an edge, sketch line, or pick an axis"
                          : "Enter angle and confirm"}
                  </span>
                  {revolvePhase === "SELECT_AXIS" && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">Axis:</span>
                      <button
                        className="flex-none px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
                        onClick={() => selectOriginAxis("X")}
                      >
                        X
                      </button>
                      <button
                        className="flex-none px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
                        onClick={() => selectOriginAxis("Y")}
                      >
                        Y
                      </button>
                      <button
                        className="flex-none px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
                        onClick={() => selectOriginAxis("Z")}
                      >
                        Z
                      </button>
                    </div>
                  )}
                  {revolvePhase === "SET_ANGLE" && (
                    <>
                      <button
                        className={`px-2 py-1 text-xs rounded ${
                          revolveDirection === "one"
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                        }`}
                        onClick={() => setRevolveDirection("one")}
                      >
                        One Side
                      </button>
                      <button
                        className={`px-2 py-1 text-xs rounded ${
                          revolveDirection === "two"
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                        }`}
                        onClick={() => setRevolveDirection("two")}
                      >
                        Two Sides
                      </button>
                      <button
                        className={`px-2 py-1 text-xs rounded ${
                          revolveDirection === "symmetric"
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                        }`}
                        onClick={() => setRevolveDirection("symmetric")}
                      >
                        Symmetric
                      </button>
                      <div className="w-px h-4 bg-gray-600" />
                      <button
                        className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
                        onClick={flipRevolveAxis}
                        title="Flip axis direction"
                      >
                        Flip
                      </button>
                      <div className="w-px h-4 bg-gray-600" />
                      <input
                        type="number"
                        className="w-20 px-2 py-1 text-sm bg-gray-700 text-white rounded border border-gray-600"
                        value={revolveAngle}
                        onChange={(e) => setRevolveAngle(parseFloat(e.target.value) || 360)}
                        min={1}
                        max={360}
                      />
                      <span className="text-xs text-gray-500">deg</span>
                      {revolveDirection === "two" && (
                        <>
                          <input
                            type="number"
                            className="w-20 px-2 py-1 text-sm bg-gray-700 text-white rounded border border-gray-600"
                            value={revolveAngle2}
                            onChange={(e) => setRevolveAngle2(parseFloat(e.target.value) || 360)}
                            min={1}
                            max={360}
                          />
                          <span className="text-xs text-gray-500">deg</span>
                        </>
                      )}
                      <button
                        className="flex-none px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded"
                        onClick={() => performRevolve(revolveAngle)}
                      >
                        Revolve
                      </button>
                    </>
                  )}
                  <span className="text-xs text-gray-500">
                    Enter: apply | Esc: cancel
                  </span>
                </div>
              )}

              {/* Measure mode controls */}
              {mode === "measure" && (
                <div className="flex items-center gap-2">
                  <button
                    className={`flex-none px-2 py-1 text-xs rounded ${
                      measureSubMode === "distance"
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setMeasureSubMode("distance")}
                    title="Distance (D)"
                  >
                    Distance
                  </button>
                  <button
                    className={`flex-none px-2 py-1 text-xs rounded ${
                      measureSubMode === "edge-length"
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setMeasureSubMode("edge-length")}
                    title="Edge Length (E)"
                  >
                    Edge Length
                  </button>
                  <button
                    className={`flex-none px-2 py-1 text-xs rounded ${
                      measureSubMode === "angle"
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                    onClick={() => setMeasureSubMode("angle")}
                    title="Angle (A)"
                  >
                    Angle
                  </button>

                  <div className="w-px h-4 bg-gray-600 mx-1" />

                  <button
                    className="flex-none px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
                    onClick={() => pinMeasurement()}
                    title="Pin selected or last measurement (P)"
                  >
                    Pin
                  </button>
                  <button
                    className="flex-none px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
                    onClick={clearTemporaryMeasurements}
                    title="Clear temporary (C)"
                  >
                    Clear
                  </button>

                  <div className="w-px h-4 bg-gray-600 mx-1" />

                  <span className="text-sm text-gray-400">
                    {measureStatusText}
                  </span>
                  <span className="text-xs text-gray-500">
                    D/E/A: mode | P: pin | C: clear | Del: delete | Esc: cancel
                  </span>

                </div>
              )}
            </div>
          </div>
        )}

        {/* Canvas + right panel row */}
        <div className="flex-1 flex flex-row min-h-0">
        {/* Canvas area */}
        <div className="flex-1 relative min-h-0 overflow-hidden">
          <div ref={mountRef} className="absolute inset-0" />

          {/* ViewCube */}
          <ViewCube camera={camera} onViewChange={handleViewCubeClick} />

          {/* Measurement list panel */}
          {mode === "measure" && (temporaryMeasurements.length > 0 || pinnedMeasurements.length > 0) && (
            <div className="absolute top-2 right-[152px] z-20 w-56 max-h-[200px] overflow-y-auto bg-gray-800/90 border border-gray-700 rounded shadow-lg">
              <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-700">
                Measurements
              </div>
              {temporaryMeasurements.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-center justify-between px-2 py-0.5 cursor-pointer hover:bg-gray-700 ${
                    selectedMeasurementId === m.id ? "bg-gray-600" : ""
                  }`}
                  onClick={() => selectMeasurement(selectedMeasurementId === m.id ? null : m.id)}
                >
                  <span className="text-xs text-gray-300 truncate">
                    {m.type === "distance" ? `Dist: ${m.distance.toFixed(3)}` :
                     m.type === "edge-length" ? `Edge: ${m.length.toFixed(3)}` :
                     `Angle: ${m.angleDegrees.toFixed(1)}°`}
                  </span>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <button
                      className="px-1 py-0 text-[10px] rounded bg-gray-700 hover:bg-blue-600 text-gray-400 hover:text-white"
                      onClick={(e) => { e.stopPropagation(); pinMeasurement(m.id); }}
                      title="Pin"
                    >
                      Pin
                    </button>
                    <button
                      className="px-1 py-0 text-[10px] rounded bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white"
                      onClick={(e) => { e.stopPropagation(); deleteMeasurement(m.id); }}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {pinnedMeasurements.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-center justify-between px-2 py-0.5 cursor-pointer hover:bg-gray-700 ${
                    selectedMeasurementId === m.id ? "bg-gray-600" : ""
                  }`}
                  onClick={() => selectMeasurement(selectedMeasurementId === m.id ? null : m.id)}
                >
                  <span className="text-xs text-blue-400 truncate">
                    {m.type === "distance" ? `Dist: ${m.distance.toFixed(3)}` :
                     m.type === "edge-length" ? `Edge: ${m.length.toFixed(3)}` :
                     `Angle: ${m.angleDegrees.toFixed(1)}°`}
                    <span className="text-blue-500 ml-1">(pinned)</span>
                  </span>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <button
                      className="px-1 py-0 text-[10px] rounded bg-gray-700 hover:bg-yellow-600 text-gray-400 hover:text-white"
                      onClick={(e) => { e.stopPropagation(); unpinMeasurement(m.id); }}
                      title="Unpin"
                    >
                      Unpin
                    </button>
                    <button
                      className="px-1 py-0 text-[10px] rounded bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white"
                      onClick={(e) => { e.stopPropagation(); deleteMeasurement(m.id); }}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Projection toggle */}
          <button
            onClick={toggleProjection}
            disabled={mode === "sketch"}
            title={mode === "sketch"
              ? "Orthographic enforced in sketch mode"
              : `Switch to ${projectionType === "perspective" ? "Orthographic" : "Perspective"} (5)`}
            className="absolute top-[140px] right-[16px] z-10 px-2 py-1 rounded text-xs font-medium transition-colors"
            style={{
              width: 120,
              backgroundColor: "rgba(90, 90, 90, 0.85)",
              color: "#e0e0e0",
              border: "1px solid #444",
              opacity: mode === "sketch" ? 0.4 : 1,
              cursor: mode === "sketch" ? "not-allowed" : "pointer",
            }}
          >
            {projectionType === "perspective" ? "Perspective" : "Orthographic"}
          </button>

          {/* Constraint feedback toast */}
          {constraintFeedback && (
            <div
              className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded shadow-lg text-sm font-medium z-50 pointer-events-none ${
                constraintFeedback.type === "redundant"
                  ? "bg-yellow-500 text-black"
                  : "bg-red-500 text-white"
              }`}
            >
              {constraintFeedback.message}
            </div>
          )}

          {/* Dimension input overlay */}
          <DimensionInput
            visible={dimensionInputVisible}
            position={dimensionInputPosition}
            label={dimensionInputLabel}
            initialValue={dimensionInputValue}
            onSubmit={handleDimensionSubmit}
            onCancel={handleDimensionCancel}
          />

          {/* Extrude dimension input */}
          {mode === "extrude" && showExtrudeDimensionInput && (
            <DimensionInput
              visible={showExtrudeDimensionInput}
              position={extrudeDimensionPosition}
              label="Extrusion Depth"
              initialValue={extrusionDepth > 0 ? extrusionDepth : 1}
              externalValue={isExtruding ? extrusionDepth : undefined}
              onSubmit={handleExtrudeDimensionSubmit}
              onCancel={handleExtrudeDimensionCancel}
              onChange={handleExtrudeDimensionChange}
              showConfirmButton
            />
          )}

          {/* Fillet/Chamfer dimension input */}
          {mode === "fillet" && showFilletDimensionInput && (
            <DimensionInput
              visible={showFilletDimensionInput}
              position={filletDimensionPosition}
              label={
                filletOpType === "fillet" ? "Fillet Radius" : "Chamfer Distance"
              }
              initialValue={filletRadius}
              onSubmit={handleFilletRadiusSubmit}
              onCancel={handleFilletRadiusCancel}
            />
          )}

          {/* Sketch context menu for right-click constraints */}
          {mode === "sketch" && (
            <SketchContextMenu
              visible={sketchContextMenu.visible}
              x={sketchContextMenu.x}
              y={sketchContextMenu.y}
              primitiveIds={sketchContextMenu.primitiveIds}
              primitiveTypes={sketchContextMenu.primitiveTypes}
              constraintId={sketchContextMenu.constraintId}
              onClose={closeSketchContextMenu}
              onApplyConstraint={applyConstraintToContextMenuPrimitives}
              onDeleteConstraint={deleteSketchConstraint}
              onToggleFixPoint={toggleFixPoint}
            />
          )}

          {/* Plane selection hint overlay */}
          {mode === "sketch" && isSelectingPlane && (
            <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 z-20 pointer-events-none">
              <div className="bg-gray-800 bg-opacity-90 rounded-lg px-6 py-3 text-white shadow-lg">
                <div className="text-center">
                  <p className="text-sm font-medium mb-2">
                    Select a sketch plane
                  </p>
                  <p className="text-xs text-gray-400 mb-2">
                    Click a plane, use buttons, or click a body face
                  </p>
                  {hoveredPlane && (
                    <p
                      className="text-sm font-bold"
                      style={{
                        color:
                          hoveredPlane === "XY"
                            ? "#4488ff"
                            : hoveredPlane === "XZ"
                              ? "#44ff44"
                              : hoveredPlane === "face"
                                ? "#2e75b6"
                                : "#ff4444",
                      }}
                    >
                      {hoveredPlane === "XY"
                        ? "XY Plane (Front)"
                        : hoveredPlane === "XZ"
                          ? "XZ Plane (Top)"
                          : hoveredPlane === "face"
                            ? "Body Face"
                            : "YZ Plane (Side)"}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-center gap-2 pointer-events-auto">
                    <label className="text-xs text-gray-400">Offset:</label>
                    <input
                      type="number"
                      step="0.5"
                      value={planeOffset}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setPlaneOffset(v);
                        setSketchPlaneOffset(v);
                      }}
                      className="w-16 px-1 py-0.5 text-xs rounded bg-gray-700 border border-gray-600 text-white text-center"
                    />
                  </div>
                  <div className="mt-2 flex justify-center gap-2 pointer-events-auto">
                    <button
                      className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500"
                      onClick={() => selectPlaneAndStartSketch("XY", planeOffset || undefined)}
                    >
                      XY
                    </button>
                    <button
                      className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-500"
                      onClick={() => selectPlaneAndStartSketch("XZ", planeOffset || undefined)}
                    >
                      XZ
                    </button>
                    <button
                      className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-500"
                      onClick={() => selectPlaneAndStartSketch("YZ", planeOffset || undefined)}
                    >
                      YZ
                    </button>
                    <button
                      className="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-500"
                      onClick={cancelPlaneSelection}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation bar - above status bar */}
          <NavigationBar
            controlsRef={controlsRef}
            navToolActiveRef={navToolActiveRef}
            onFitAll={handleFitAll}
          />

          {/* Bottom status bar */}
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gray-900 bg-opacity-90 border-t border-gray-700 flex items-center px-3 text-xs text-gray-400 font-mono z-10 overflow-hidden whitespace-nowrap">
            <span className="flex-none">
              X: {cursorPosition ? cursorPosition.x.toFixed(2) : "--"} Y:{" "}
              {cursorPosition ? cursorPosition.y.toFixed(2) : "--"} Z:{" "}
              {cursorPosition ? cursorPosition.z.toFixed(2) : "--"}
            </span>

            {/* Sketch info in status bar */}
            {mode === "sketch" && activeSketch && (
              <>
                <div className="flex-none w-px h-4 bg-gray-600 mx-2" />
                <span className="flex-none text-blue-400">
                  {activeSketch.plane.type}
                </span>
                <div className="flex-none w-px h-4 bg-gray-600 mx-2" />
                <span className="flex-none">
                  DOF:{" "}
                  <span
                    className={
                      activeSketch.dof === 0
                        ? "text-green-400"
                        : "text-yellow-400"
                    }
                  >
                    {activeSketch.dof}
                  </span>
                </span>
                <div className="flex-none w-px h-4 bg-gray-600 mx-2" />
                <span
                  className={`flex-none ${
                    activeSketch.status === "fully_constrained"
                      ? "text-green-400"
                      : activeSketch.status === "overconstrained"
                        ? "text-red-400"
                        : "text-yellow-400"
                  }`}
                >
                  {activeSketch.status === "fully_constrained"
                    ? "Constrained"
                    : activeSketch.status === "overconstrained"
                      ? "Over"
                      : "Under"}
                </span>
                <div className="flex-none w-px h-4 bg-gray-600 mx-2" />
                <span className="flex-none">
                  {activeSketch.primitives.length}P{" "}
                  {activeSketch.constraints.length}C
                </span>
              </>
            )}

            {/* Element info on the right */}
            {selectedObjectRef.current &&
              (() => {
                const selectedElement = elements.find(
                  (el) => el.nodeId === selectedObjectRef.current,
                );
                return selectedElement ? (
                  <span className="ml-auto flex-none truncate">
                    {selectedObjectRef.current} (
                    {selectedElement.position.x.toFixed(1)},{" "}
                    {selectedElement.position.y.toFixed(1)},{" "}
                    {selectedElement.position.z.toFixed(1)})
                  </span>
                ) : null;
              })()}
          </div>
        </div>

        {/* Sketch Properties Panel - right side, below toolbar */}
        {mode === "sketch" && activeSketch && (
          <div className="flex-none w-60 bg-gray-800 bg-opacity-90 border-l border-gray-700 overflow-hidden">
            <SketchPropertiesPanel
              activeSketch={activeSketch}
              selectedPrimitives={selectedPrimitives}
              onUpdatePoint={updatePrimitivesAndSolve}
            />
          </div>
        )}
        </div>
        {/* end canvas + right panel row */}
      </div>
      {/* end center column */}
    </div>
  );
};

export default SimpleCadScene;
