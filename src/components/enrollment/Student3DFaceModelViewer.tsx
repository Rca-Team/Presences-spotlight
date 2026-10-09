import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RotateCcw,
  RotateCw,
  Layers,
  Sparkles,
  Camera,
  Eye,
  Maximize2,
  Scan,
  Compass,
  Box
} from 'lucide-react';

export interface Student3DFaceModelProps {
  descriptor?: number[];
  descriptorsCloud?: number[][];
  sampleCount?: number;
  samplePoses?: string[];
  studentName?: string;
  admissionNumber?: string;
  className?: string;
}

type ViewMode = 'full' | 'wireframe' | 'points';

export default function Student3DFaceModelViewer({
  descriptor,
  descriptorsCloud,
  sampleCount = 10,
  samplePoses = ['front', 'left', 'right', 'up', 'down'],
  studentName,
  admissionNumber,
  className = '',
}: Student3DFaceModelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('full');
  const [autoRotate, setAutoRotate] = useState(true);
  const [showAngles, setShowAngles] = useState(true);
  const [showLaser, setShowLaser] = useState(true);
  const [rotationAngles, setRotationAngles] = useState({ yaw: 0, pitch: 0, roll: 0 });

  // References to meshes for dynamic toggles
  const faceMeshRef = useRef<THREE.Mesh | null>(null);
  const wireMeshRef = useRef<THREE.Mesh | null>(null);
  const landmarkPointsRef = useRef<THREE.Points | null>(null);
  const angleRaysGroupRef = useRef<THREE.Group | null>(null);
  const laserBeamRef = useRef<THREE.Line | null>(null);

  // Generate personalized face morph modifiers from 128D descriptor
  const morphParams = useMemo(() => {
    if (!descriptor || descriptor.length < 10) {
      return {
        widthFactor: 1.0,
        noseProminence: 1.0,
        chinDrop: 1.0,
        cheekboneWidth: 1.0,
        eyeDistance: 1.0,
      };
    }
    // Safely sample normalized dimensions
    const d0 = Number(descriptor[0] ?? 0);
    const d1 = Number(descriptor[1] ?? 0);
    const d2 = Number(descriptor[2] ?? 0);
    const d3 = Number(descriptor[3] ?? 0);
    const d4 = Number(descriptor[4] ?? 0);

    return {
      widthFactor: Math.min(Math.max(1.0 + d0 * 0.35, 0.85), 1.2),
      noseProminence: Math.min(Math.max(1.0 + d1 * 0.45, 0.8), 1.3),
      chinDrop: Math.min(Math.max(1.0 + d2 * 0.3, 0.85), 1.2),
      cheekboneWidth: Math.min(Math.max(1.0 + d3 * 0.35, 0.85), 1.25),
      eyeDistance: Math.min(Math.max(1.0 + d4 * 0.25, 0.88), 1.15),
    };
  }, [descriptor]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 360;

    // 1. Scene & Dark Viewport Background
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x060a14); // Deep cyber obsidian

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0.2, 4.2);
    cameraRef.current = camera;

    // 3. Renderer with high-DPI antialiasing
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.8;
    controls.minDistance = 1.8;
    controls.maxDistance = 7.5;
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.minPolarAngle = Math.PI * 0.15;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // 5. Lighting Setup (Cybernetic Biometric Illumination)
    const ambientLight = new THREE.AmbientLight(0x0f2b46, 1.8);
    scene.add(ambientLight);

    // Key front light (Cyan)
    const keyLight = new THREE.DirectionalLight(0x38bdf8, 2.2);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);

    // Fill light (Teal/Emerald)
    const fillLight = new THREE.DirectionalLight(0x10b981, 1.2);
    fillLight.position.set(-3, -1, 3);
    scene.add(fillLight);

    // Rim light from behind (Neon Blue)
    const rimLight = new THREE.DirectionalLight(0x6366f1, 2.5);
    rimLight.position.set(0, 2, -4);
    scene.add(rimLight);

    // 6. Cybernetic Grid Floor
    const gridHelper = new THREE.GridHelper(8, 20, 0x0ea5e9, 0x1e293b);
    gridHelper.position.y = -1.6;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.35;
    scene.add(gridHelper);

    // 7. BUILD 3D FACE GEOMETRY
    // Generate high-density parametric 3D face mesh (rows x cols)
    const latBands = 36;
    const lonBands = 36;
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const landmarkPositions: number[] = [];

    const { widthFactor, noseProminence, chinDrop, cheekboneWidth, eyeDistance } = morphParams;

    // Parametric 3D Face formulation with anatomical feature displacements
    for (let i = 0; i <= latBands; i++) {
      const theta = (i * Math.PI) / latBands - Math.PI / 2; // -PI/2 (bottom) to PI/2 (top)
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      for (let j = 0; j <= lonBands; j++) {
        const phi = (j * Math.PI * 0.75) / lonBands - (Math.PI * 0.75) / 2; // front hemisphere: -67.5° to +67.5°
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        // Normalized base head coordinates
        let x = 1.05 * widthFactor * sinPhi * cosTheta;
        let y = 1.35 * chinDrop * sinTheta;
        let z = 1.15 * cosPhi * cosTheta;

        // Apply Anatomical Displacements:
        // 1. Nose ridge and tip (centered around phi=0, theta near 0)
        const noseDistX = x / 0.22;
        const noseDistY = (y - 0.02) / 0.38;
        const noseGauss = Math.exp(-(noseDistX * noseDistX + noseDistY * noseDistY));
        if (z > 0.4) {
          z += 0.52 * noseProminence * noseGauss;
        }

        // 2. Eye sockets (lateral indentations at y ≈ 0.28)
        const leftEyeDist = Math.hypot((x - 0.42 * eyeDistance) / 0.24, (y - 0.28) / 0.18);
        const rightEyeDist = Math.hypot((x + 0.42 * eyeDistance) / 0.24, (y - 0.28) / 0.18);
        const eyeIndent = Math.max(Math.exp(-leftEyeDist * leftEyeDist), Math.exp(-rightEyeDist * rightEyeDist));
        z -= 0.18 * eyeIndent;

        // 3. Eyebrow arches (protrusions at y ≈ 0.44)
        const leftBrowDist = Math.hypot((x - 0.42 * eyeDistance) / 0.28, (y - 0.44) / 0.12);
        const rightBrowDist = Math.hypot((x + 0.42 * eyeDistance) / 0.28, (y - 0.44) / 0.12);
        const browRidge = Math.max(Math.exp(-leftBrowDist * leftBrowDist), Math.exp(-rightBrowDist * rightBrowDist));
        z += 0.12 * browRidge;

        // 4. Cheekbones (prominences at y ≈ 0.05, lateral)
        const leftCheekDist = Math.hypot((x - 0.62 * cheekboneWidth) / 0.3, (y - 0.05) / 0.24);
        const rightCheekDist = Math.hypot((x + 0.62 * cheekboneWidth) / 0.3, (y - 0.05) / 0.24);
        const cheekRidge = Math.max(Math.exp(-leftCheekDist * leftCheekDist), Math.exp(-rightCheekDist * rightCheekDist));
        z += 0.15 * cheekRidge;

        // 5. Lips and Philtrum (y ≈ -0.32)
        const lipDist = Math.hypot(x / 0.32, (y + 0.32) / 0.14);
        const lipGauss = Math.exp(-lipDist * lipDist);
        z += 0.14 * lipGauss;

        // 6. Chin (y ≈ -0.82)
        const chinDist = Math.hypot(x / 0.28, (y + 0.82) / 0.22);
        const chinGauss = Math.exp(-chinDist * chinDist);
        z += 0.22 * chinGauss;

        positions.push(x, y, z);
        uvs.push(j / lonBands, i / latBands);

        // Collect key biometric landmark points
        if ((i % 4 === 0 && j % 4 === 0) || (eyeIndent > 0.4) || (noseGauss > 0.4) || (lipGauss > 0.5) || (chinGauss > 0.6)) {
          landmarkPositions.push(x, y, z);
        }
      }
    }

    // Triangular indices for dense face mesh
    for (let i = 0; i < latBands; i++) {
      for (let j = 0; j < lonBands; j++) {
        const first = i * (lonBands + 1) + j;
        const second = first + lonBands + 1;

        indices.push(first, second, first + 1);
        indices.push(second, second + 1, first + 1);
      }
    }

    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    faceGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    faceGeometry.setIndex(indices);
    faceGeometry.computeVertexNormals();

    // Layer A: Semi-transparent holographic face surface
    const surfaceMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7, // Sky cyan
      emissive: 0x0369a1,
      emissiveIntensity: 0.15,
      metalness: 0.15,
      roughness: 0.35,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const faceMesh = new THREE.Mesh(faceGeometry, surfaceMaterial);
    faceMeshRef.current = faceMesh;
    scene.add(faceMesh);

    // Layer B: Polygonal Wireframe Tessellation
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8, // Neon cyan
      wireframe: true,
      transparent: true,
      opacity: 0.45,
    });
    const wireMesh = new THREE.Mesh(faceGeometry, wireMaterial);
    wireMeshRef.current = wireMesh;
    scene.add(wireMesh);

    // Layer C: Glowing Biometric Landmark Points
    const landmarksGeometry = new THREE.BufferGeometry();
    landmarksGeometry.setAttribute('position', new THREE.Float32BufferAttribute(landmarkPositions, 3));
    const landmarksMaterial = new THREE.PointsMaterial({
      color: 0x34d399, // Emerald highlight
      size: 0.045,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    });
    const landmarkPoints = new THREE.Points(landmarksGeometry, landmarksMaterial);
    landmarkPointsRef.current = landmarkPoints;
    scene.add(landmarkPoints);

    // 8. MULTI-ANGLE CAPTURE VECTORS (Orbital scanning camera nodes)
    const anglesGroup = new THREE.Group();
    angleRaysGroupRef.current = anglesGroup;

    const captureVectorPositions = [
      { pose: 'Front', pos: [0, 0, 2.5], color: 0x34d399 },
      { pose: 'Left', pos: [-1.4, 0.1, 2.1], color: 0x38bdf8 },
      { pose: 'Right', pos: [1.4, 0.1, 2.1], color: 0x38bdf8 },
      { pose: 'Look Up', pos: [0, 1.2, 2.2], color: 0x60a5fa },
      { pose: 'Look Down', pos: [0, -1.2, 2.2], color: 0x60a5fa },
      { pose: 'Top Left', pos: [-1.0, 0.9, 1.9], color: 0xa78bfa },
      { pose: 'Top Right', pos: [1.0, 0.9, 1.9], color: 0xa78bfa },
      { pose: 'Bottom Left', pos: [-1.0, -0.9, 1.9], color: 0xa78bfa },
      { pose: 'Bottom Right', pos: [1.0, -0.9, 1.9], color: 0xa78bfa },
      { pose: 'Tilt Left', pos: [-0.7, 0.3, 2.3], color: 0x2dd4bf },
    ];

    captureVectorPositions.slice(0, Math.min(sampleCount, 10)).forEach(({ pos, color }) => {
      // Small sensor target sphere
      const sphereGeo = new THREE.SphereGeometry(0.045, 12, 12);
      const sphereMat = new THREE.MeshBasicMaterial({ color });
      const nodeMesh = new THREE.Mesh(sphereGeo, sphereMat);
      nodeMesh.position.set(pos[0], pos[1], pos[2]);
      anglesGroup.add(nodeMesh);

      // Laser scan ray connecting camera to nose tip
      const rayGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(pos[0], pos[1], pos[2]),
        new THREE.Vector3(0, 0, 0.55),
      ]);
      const rayMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
      });
      const rayLine = new THREE.Line(rayGeo, rayMat);
      anglesGroup.add(rayLine);
    });
    scene.add(anglesGroup);

    // 9. ANIMATED BIOMETRIC LASER SCANNER BEAM
    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.4, 0, 0.8),
      new THREE.Vector3(1.4, 0, 0.8),
    ]);
    const laserMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      linewidth: 2,
      transparent: true,
      opacity: 0.85,
    });
    const laserBeam = new THREE.Line(laserGeo, laserMat);
    laserBeamRef.current = laserBeam;
    scene.add(laserBeam);

    // 10. Animation Loop
    let clock = new THREE.Clock();
    let prevYaw = 0;
    let prevPitch = 0;
    let prevRoll = 0;

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      const elapsed = clock.getElapsedTime();

      // Laser scanning line oscillation
      if (laserBeamRef.current) {
        const scanY = Math.sin(elapsed * 2.2) * 1.1;
        laserBeamRef.current.position.y = scanY;
        laserBeamRef.current.position.z = 0.35 + Math.cos(scanY * 1.5) * 0.2;
      }

      // Smooth auto-rotation
      if (autoRotate && controlsRef.current) {
        controlsRef.current.autoRotate = true;
        controlsRef.current.autoRotateSpeed = 1.8;
      } else if (controlsRef.current) {
        controlsRef.current.autoRotate = false;
      }

      controls.update();

      // Calculate camera angles relative to origin for HUD
      const camPos = camera.position;
      const yawDeg = Math.round((Math.atan2(camPos.x, camPos.z) * 180) / Math.PI);
      const pitchDeg = Math.round((Math.atan2(camPos.y, Math.hypot(camPos.x, camPos.z)) * 180) / Math.PI);
      const rollDeg = Math.round((camera.rotation.z * 180) / Math.PI);

      if (yawDeg !== prevYaw || pitchDeg !== prevPitch || rollDeg !== prevRoll) {
        prevYaw = yawDeg;
        prevPitch = pitchDeg;
        prevRoll = rollDeg;
        setRotationAngles({ yaw: yawDeg, pitch: pitchDeg, roll: rollDeg });
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth || 600;
      const h = containerRef.current.clientHeight || 360;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      controls.dispose();

      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((item) => item.dispose());
        else if (mat) mat.dispose();
      });

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [morphParams, sampleCount]);

  // Sync viewMode changes
  useEffect(() => {
    if (faceMeshRef.current && wireMeshRef.current && landmarkPointsRef.current) {
      if (viewMode === 'full') {
        faceMeshRef.current.visible = true;
        wireMeshRef.current.visible = true;
        landmarkPointsRef.current.visible = true;
      } else if (viewMode === 'wireframe') {
        faceMeshRef.current.visible = false;
        wireMeshRef.current.visible = true;
        landmarkPointsRef.current.visible = true;
      } else if (viewMode === 'points') {
        faceMeshRef.current.visible = false;
        wireMeshRef.current.visible = false;
        landmarkPointsRef.current.visible = true;
      }
    }
  }, [viewMode]);

  // Sync angle rays visibility
  useEffect(() => {
    if (angleRaysGroupRef.current) {
      angleRaysGroupRef.current.visible = showAngles;
    }
  }, [showAngles]);

  // Sync laser beam visibility
  useEffect(() => {
    if (laserBeamRef.current) {
      laserBeamRef.current.visible = showLaser;
    }
  }, [showLaser]);

  const setCameraPreset = (x: number, y: number, z: number) => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(x, y, z);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  };

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden border border-cyan-500/25 bg-[#060a14] shadow-2xl ${className}`}>
      {/* 3D Canvas Mount */}
      <div
        ref={containerRef}
        className="w-full h-[320px] sm:h-[380px] cursor-grab active:cursor-grabbing select-none"
        aria-label="Interactive 3D Face Biometric Model"
      />

      {/* Top HUD: Title & Vector Stats */}
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2 pointer-events-none">
        <div className="bg-slate-950/80 backdrop-blur-md border border-cyan-500/30 rounded-xl p-2 sm:px-3 sm:py-2 shadow-lg">
          <div className="flex items-center gap-1.5 text-cyan-400 font-extrabold text-xs">
            <Scan className="h-3.5 w-3.5 animate-pulse" />
            <span>TrueDepth 3D Facial Model</span>
          </div>
          <p className="text-[10px] text-white/70 font-mono mt-0.5">
            {sampleCount} Angles Synced · 128D Embedding · 1,368 Facets
          </p>
        </div>

        {/* Real-time Angle Orientation Telemetry */}
        <div className="bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-xl px-2.5 py-1.5 text-right font-mono text-[10px] text-white/80 shadow-lg">
          <div className="flex items-center gap-1.5 justify-end text-emerald-400 font-bold">
            <Compass className="h-3 w-3" />
            <span>Telemetry</span>
          </div>
          <span className="text-white/60">Yaw: </span>
          <span className="text-cyan-300 font-bold">{rotationAngles.yaw}°</span> ·{' '}
          <span className="text-white/60">Pitch: </span>
          <span className="text-emerald-300 font-bold">{rotationAngles.pitch}°</span>
        </div>
      </div>

      {/* Bottom Bar Controls */}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-2 bg-slate-950/85 backdrop-blur-md border border-white/10 rounded-xl p-1.5 sm:px-3 text-xs">
        {/* View Mode Switcher */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setViewMode('full')}
            className={`h-7 px-2 text-[11px] rounded-lg font-bold ${
              viewMode === 'full'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <Layers className="h-3 w-3 mr-1" />
            Mesh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setViewMode('wireframe')}
            className={`h-7 px-2 text-[11px] rounded-lg font-bold ${
              viewMode === 'wireframe'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <Box className="h-3 w-3 mr-1" />
            Wireframe
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setViewMode('points')}
            className={`h-7 px-2 text-[11px] rounded-lg font-bold ${
              viewMode === 'points'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Landmarks
          </Button>
        </div>

        {/* Camera Preset Quick Buttons */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            title="Front Face Perspective"
            onClick={() => setCameraPreset(0, 0.2, 4.2)}
            className="h-7 px-2 text-[10px] rounded-lg font-mono text-white/80 hover:bg-white/10"
          >
            Front
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="3/4 Left Profile Perspective"
            onClick={() => setCameraPreset(-2.8, 0.8, 3.0)}
            className="h-7 px-2 text-[10px] rounded-lg font-mono text-white/80 hover:bg-white/10"
          >
            Left
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="3/4 Right Profile Perspective"
            onClick={() => setCameraPreset(2.8, 0.8, 3.0)}
            className="h-7 px-2 text-[10px] rounded-lg font-mono text-white/80 hover:bg-white/10"
          >
            Right
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={autoRotate ? 'Pause 360° rotation' : 'Start 360° rotation'}
            onClick={() => setAutoRotate((prev) => !prev)}
            className={`h-7 px-2 rounded-lg ${
              autoRotate ? 'text-emerald-400 bg-emerald-500/10' : 'text-white/60 hover:text-white'
            }`}
          >
            <RotateCw className={`h-3 w-3 ${autoRotate ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Reset Perspective"
            onClick={() => setCameraPreset(0, 0.2, 4.2)}
            className="h-7 px-2 rounded-lg text-white/60 hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
