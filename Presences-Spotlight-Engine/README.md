# 🌟 Presences Spotlight AI — Dual-Camera School Attendance Engine

**Presences Spotlight AI** is an enterprise-grade, walk-through face recognition gate terminal built specifically for schools and campuses with **2,000+ to 5,000+ students**, powered by **Google MediaPipe Vision Pipeline**, **Google AI**, and **Appwrite Cloud**.

---

## 🚀 Key Dual-Camera & School Features

- **Simultaneous Dual-Camera Processing**: Runs two camera streams in parallel (e.g., Gate 1 & Gate 2, or Entry Lane & Exit Lane, using USB webcams or RTSP PoE IP cameras).
- **Cross-Camera Real-Time Deduplication**: Centralized cooldown guard prevents double attendance marks, duplicate parent emails, or double audio chimes when a student crosses both camera angles simultaneously.
- **Side-by-Side Dual Viewport & Focus Modes**: Seamless PyQt6 UI allowing administrators to view both cameras concurrently (`⊞ Dual View`), or isolate either lane (`📷 Lane 1`, `📷 Lane 2`).
- **Google MediaPipe 478 3D Landmark Mesh**: Ultra-low latency, hardware-accelerated face detection using Google's XNNPACK delegate.
- **5-Point Canonical Affine Face Alignment**: Standardizes head tilt, roll, and distance into normalized 112x112 facial representations for invariant matching.
- **Sub-Millisecond Vector Search**: In-memory vectorized BLAS matrix matching searches 2,000+ student embeddings in **< 0.2 ms**.
- **Ambiguity Ratio Protection**: Rejects matches when two candidate identities have overly close confidence scores to prevent misidentifications.
- **Offline Resilience & Instant SQLite Logging**: 0ms attendance logging with lane tracking (`camera_lane`) and automatic background sync to Appwrite/Supabase.
- **Daily Attendance Reports & Export**: Filter by grade, status, or search query with one-click **Export to CSV / Excel**.
- **1-Student-1-Email-Per-Day Rate Limiting**: Ensures parents receive exactly one arrival notification per morning.

---

## 🛠️ Quick Start

### 1. Configure Environment
Copy `.env.example` to `.env` and set your camera sources and cloud credentials:
```bash
# Camera 1 (USB index 0 or RTSP URL)
CAMERA_1_SOURCE=0
CAMERA_1_NAME=Lane 1 - Gate A

# Camera 2 (USB index 1 or RTSP URL)
CAMERA_2_SOURCE=1
CAMERA_2_NAME=Lane 2 - Gate B

# Enable dual-camera simultaneous monitoring
DUAL_CAMERA_MODE=true
CROSS_CAMERA_COOLDOWN_SEC=45
```

### 2. Launch Dual-Camera Desktop Terminal (PyQt6)
To start the enterprise desktop application:
```bash
python desktop_app.py
```
*Or double-click `START_DESKTOP_APP.bat`.*

### 3. Launch CLI / OpenCV Engine
To run in terminal OpenCV mode:
```bash
python spotlight_engine.py
```

### 4. Run Dual-Camera Integration Test Suite
To verify dual camera tracking, cross-camera deduplication, and database logging:
```bash
python test_dual_camera_engine.py
```

---

## ⌨️ Live Terminal Hotkeys

| Key | Action |
|---|---|
| `q` / `ESC` | Exit terminal cleanly |
| `r` | Reload student face database from cloud |
| `s` | Toggle audio confirmation chime (Sound ON / Muted) |
| `m` | Toggle Google MediaPipe 478-Landmark wireframe mesh overlay |
| `f` / `F11` | Toggle Fullscreen Kiosk Mode |
| `c` | Clear/reset live session metrics |

