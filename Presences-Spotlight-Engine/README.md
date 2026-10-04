# 🌟 Presences Spotlight AI — Gate Attendance System (Google Pipeline Edition)

**Presences Spotlight AI** is an enterprise-grade, walk-through face recognition gate terminal built specifically for schools and campuses with **2,000+ to 5,000+ students**, powered by the **Google MediaPipe Vision Pipeline** and **Google AI**.

---

## 🚀 Key Features

- **Google MediaPipe 478 3D Landmark Mesh**: Ultra-low latency, hardware-accelerated face detection using Google's XNNPACK delegate.
- **5-Point Canonical Affine Face Alignment**: Standardizes head tilt, roll, and distance into normalized 112x112 facial representations for invariant matching.
- **3D Head Pose Estimation (Yaw, Pitch, Roll)**: Real-time Euler angle computation with visual target gauges to ensure pristine capture fidelity.
- **Multi-Dimensional Face Quality Gate**: Discards motion-blurred frames, extreme lighting, and out-of-bounds angles before computing embeddings.
- **Anti-Spoofing & Liveness Guard**: Real-time Eye Aspect Ratio (EAR) + 3D mesh depth verification to block photo/screen spoofing.
- **Walk-Through Multi-Student Tracking**: Centroid & IOU tracking across corridor video streams with 3+ frame consensus voting.
- **Sub-Millisecond Vector Search**: In-memory vectorized BLAS matrix matching searches 2,000+ student embeddings in **< 0.2 ms**.
- **Ambiguity Ratio Protection**: Rejects matches when two candidate identities have overly close confidence scores to prevent misidentifications.
- **Dual Cloud Backend**: Native support for **Appwrite Official Python SDK** and **Supabase REST / Edge Functions**.
- **1-Student-1-Email-Per-Day Rate Limiting**: Ensures parents receive exactly one arrival email per day.
- **Offline Resilience**: Instant 0ms SQLite logging with automatic background cloud sync.
- **High-Tech Kiosk HUD**: Live bounding boxes, 3D mesh wireframe toggle (`m`), student profile popups, on-time/late counters, and audio chime confirmation.

---

## 🛠️ Quick Start

### 1. Configure Environment
Copy `.env.example` to `.env` and fill in your cloud credentials and camera RTSP stream URL:
```bash
cp .env.example .env
```

### 2. 3D-Guided Multi-Angle Student Enrollment
To enroll a student with live 3D pose guidance (Frontal, Left 15°, Right 15°):
```bash
python enrollment_tool.py
```

### 3. Launch Spotlight Gate Engine (Google Pipeline)
To start the live gate terminal:
```bash
python spotlight_engine.py
```

### 4. Run Scalability Benchmark (2,000 to 5,000 Students)
To verify search speed on mega campus scale:
```bash
python benchmark_2k.py
```

---

## ⌨️ Live Terminal Hotkeys

| Key | Action |
|---|---|
| `q` / `ESC` | Exit terminal cleanly |
| `r` | Reload student face database from cloud |
| `s` | Toggle audio confirmation chime (Sound ON / Muted) |
| `m` | Toggle Google MediaPipe 478-Landmark wireframe mesh overlay |
| `f` | Toggle Fullscreen Kiosk Mode |
| `c` | Clear/reset live session metrics |
