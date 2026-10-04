"""
Presences Spotlight AI — Full-Stack Desktop PC Application
All-in-One Standalone Edge Kiosk Application powered by Google Vision & Appwrite Cloud
"""

import os
import warnings
warnings.filterwarnings('ignore')
import sys
import time
import json
import base64
import threading
import webbrowser
from pathlib import Path
from typing import List, Dict, Optional

import cv2
import numpy as np
from flask import Flask, Response, render_template_string, jsonify, request

import config
from spotlight_engine import SpotlightEngine, RTSPVideoStream

# Setup Base Path (Handles PyInstaller onefile temp directory extraction)
if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).resolve().parent

app = Flask(__name__)
engine: Optional[SpotlightEngine] = None
stream: Optional[RTSPVideoStream] = None
live_history: List[Dict] = []
history_lock = threading.Lock()

# ─── Glassmorphism Full-Stack HTML5/CSS3/JS Web Kiosk UI ─────────────────────
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Presences Spotlight AI — Gate Terminal</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
                        mono: ['"JetBrains Mono"', 'monospace']
                    },
                    colors: {
                        brand: { 50: '#ecfdf5', 500: '#10b981', 600: '#059669', 700: '#047857' }
                    }
                }
            }
        }
    </script>
    <style>
        body { background-color: #090d16; color: #f8fafc; overflow-x: hidden; }
        .glass-panel { background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.08); }
        .glow-green { box-shadow: 0 0 35px -5px rgba(16, 185, 129, 0.4); }
        .glow-cyan { box-shadow: 0 0 35px -5px rgba(56, 189, 248, 0.3); }
        @keyframes pulse-ring { 0% { transform: scale(0.95); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.8; } 100% { transform: scale(0.95); opacity: 1; } }
        .pulse-live { animation: pulse-ring 3s infinite ease-in-out; }
    </style>
</head>
<body class="p-4 md:p-6 min-h-screen flex flex-col justify-between">
    
    <!-- Top Header -->
    <header class="flex items-center justify-between glass-panel px-6 py-4 rounded-2xl mb-6 shadow-2xl">
        <div class="flex items-center gap-4">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <svg class="w-6 h-6 text-slate-950 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
            </div>
            <div>
                <div class="flex items-center gap-2.5">
                    <h1 class="text-xl font-extrabold tracking-tight text-white">PRESENCES SPOTLIGHT AI</h1>
                    <span class="px-2.5 py-0.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">Google Pipeline</span>
                    <span class="px-2.5 py-0.5 text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full">Appwrite Cloud</span>
                </div>
                <p class="text-xs text-slate-400 font-medium mt-0.5" id="gate-name-label">Loading gate terminal...</p>
            </div>
        </div>

        <!-- Quick Status & Controls -->
        <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs font-mono">
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 pulse-live"></span>
                <span id="fps-counter" class="text-emerald-400 font-bold">30 FPS</span>
            </div>
            
            <button onclick="reloadStudents()" class="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700/60 transition flex items-center gap-1.5 shadow-sm active:scale-95">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                Sync Appwrite
            </button>

            <button onclick="toggleAudio()" id="audio-toggle-btn" class="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700/60 transition flex items-center gap-1.5 active:scale-95">
                🔊 Audio ON
            </button>

            <button onclick="toggleMesh()" id="mesh-toggle-btn" class="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700/60 transition flex items-center gap-1.5 active:scale-95">
                🕸️ 3D Mesh
            </button>
        </div>
    </header>

    <!-- Main Grid -->
    <main class="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        
        <!-- Left: Live Camera Viewport (8 Cols) -->
        <div class="lg:col-span-8 flex flex-col gap-4">
            <div class="glass-panel p-3 rounded-2xl relative overflow-hidden flex flex-col items-center justify-center min-h-[460px] shadow-2xl">
                <!-- Live Video MJPEG Stream -->
                <img src="/video_feed" alt="Live Camera Feed" class="w-full h-auto rounded-xl object-cover max-h-[560px] bg-slate-950 border border-slate-800/80" onerror="this.src=''; this.alt='Reconnecting to camera...';">
                
                <!-- Live Verification Overlay Banner -->
                <div id="verified-banner" class="absolute bottom-6 left-6 right-6 p-4 rounded-xl bg-emerald-950/90 border border-emerald-500/40 text-white flex items-center justify-between hidden transition-all duration-300 glow-green">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-lg">✓</div>
                        <div>
                            <div class="flex items-center gap-2">
                                <h3 id="banner-name" class="font-bold text-lg text-emerald-100">Student Name</h3>
                                <span id="banner-status" class="px-2 py-0.5 text-xs font-bold rounded bg-emerald-500 text-slate-950">PRESENT</span>
                            </div>
                            <p id="banner-class" class="text-xs text-emerald-300 font-medium">Class 10-A • 08:30:15 AM</p>
                        </div>
                    </div>
                    <span class="text-xs font-mono text-emerald-400 bg-emerald-900/60 px-2.5 py-1 rounded-lg border border-emerald-700/50">Verified & Synced</span>
                </div>
            </div>

            <!-- Stats Ribbon -->
            <div class="grid grid-cols-4 gap-4">
                <div class="glass-panel p-4 rounded-xl flex flex-col">
                    <span class="text-xs font-medium text-slate-400">Total Verified</span>
                    <span id="stat-total" class="text-2xl font-black text-white mt-1">0</span>
                </div>
                <div class="glass-panel p-4 rounded-xl flex flex-col">
                    <span class="text-xs font-medium text-slate-400">On-Time</span>
                    <span id="stat-ontime" class="text-2xl font-black text-emerald-400 mt-1">0</span>
                </div>
                <div class="glass-panel p-4 rounded-xl flex flex-col">
                    <span class="text-xs font-medium text-slate-400">Late Arrivals</span>
                    <span id="stat-late" class="text-2xl font-black text-amber-400 mt-1">0</span>
                </div>
                <div class="glass-panel p-4 rounded-xl flex flex-col">
                    <span class="text-xs font-medium text-slate-400">Enrolled in Cloud</span>
                    <span id="stat-enrolled" class="text-2xl font-black text-cyan-400 mt-1">0</span>
                </div>
            </div>
        </div>

        <!-- Right: Real-time Attendance Feed & History (4 Cols) -->
        <div class="lg:col-span-4 flex flex-col gap-4">
            <div class="glass-panel p-5 rounded-2xl flex-1 flex flex-col shadow-2xl">
                <div class="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
                    <h2 class="text-sm font-bold tracking-wide uppercase text-slate-300 flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
                        Live Corridor Activity
                    </h2>
                    <span class="text-xs text-slate-500 font-mono" id="feed-count">0 logged</span>
                </div>

                <!-- Feed Scrollable List -->
                <div id="attendance-feed" class="flex-1 overflow-y-auto max-h-[500px] space-y-2.5 pr-1">
                    <div class="text-center text-slate-500 text-xs py-12">
                        Waiting for students to pass the gate corridor...
                    </div>
                </div>
            </div>
        </div>
    </main>

    <!-- Footer -->
    <footer class="mt-6 flex items-center justify-between text-xs text-slate-500 border-t border-slate-800/60 pt-4 font-medium">
        <span>Presences Spotlight AI — Full Stack PC Terminal</span>
        <span>Google MediaPipe 478 3D Mesh • Appwrite Cloud Sync Active</span>
    </footer>

    <script>
        async function updateStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();

                document.getElementById('stat-total').innerText = data.total_present;
                document.getElementById('stat-ontime').innerText = data.on_time;
                document.getElementById('stat-late').innerText = data.late;
                document.getElementById('stat-enrolled').innerText = data.enrolled_count;
                document.getElementById('fps-counter').innerText = Math.round(data.fps) + ' FPS';
                document.getElementById('gate-name-label').innerText = data.gate_name + ' • ' + data.backend_type.toUpperCase();

                // Check banner
                const banner = document.getElementById('verified-banner');
                if (data.banner && data.banner.name) {
                    document.getElementById('banner-name').innerText = data.banner.name;
                    document.getElementById('banner-status').innerText = data.banner.status;
                    document.getElementById('banner-class').innerText = data.banner.class + ' • ' + data.banner.time;
                    banner.classList.remove('hidden');
                } else {
                    banner.classList.add('hidden');
                }

                // Render Feed
                const feedContainer = document.getElementById('attendance-feed');
                if (data.history && data.history.length > 0) {
                    document.getElementById('feed-count').innerText = data.history.length + ' verified today';
                    feedContainer.innerHTML = data.history.map(item => `
                        <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300">
                                    ${item.name.charAt(0)}
                                </div>
                                <div>
                                    <h4 class="text-xs font-bold text-slate-100">${item.name}</h4>
                                    <p class="text-[11px] text-slate-400 font-medium">Class ${item.class || '-'} • ${item.time}</p>
                                </div>
                            </div>
                            <span class="px-2 py-0.5 text-[10px] font-bold rounded ${item.status === 'present' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}">
                                ${item.status.toUpperCase()}
                            </span>
                        </div>
                    `).join('');
                }
            } catch (e) {
                console.error(e);
            }
        }

        async function reloadStudents() {
            await fetch('/api/reload', { method: 'POST' });
            alert('Cloud face models synchronized from Appwrite!');
            updateStatus();
        }

        async function toggleAudio() {
            const res = await fetch('/api/toggle_audio', { method: 'POST' });
            const data = await res.json();
            document.getElementById('audio-toggle-btn').innerText = data.enabled ? '🔊 Audio ON' : '🔇 Audio OFF';
        }

        async function toggleMesh() {
            const res = await fetch('/api/toggle_mesh', { method: 'POST' });
            const data = await res.json();
            document.getElementById('mesh-toggle-btn').innerText = data.mesh ? '🕸️ Mesh ON' : '🕸️ Mesh OFF';
        }

        setInterval(updateStatus, 800);
        updateStatus();
    </script>
</body>
</html>
"""


@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)


def generate_frames():
    """MJPEG frame generator streaming processed frames with HUD overlay."""
    global engine, stream
    while True:
        if stream is None or engine is None:
            time.sleep(0.05)
            continue

        grabbed, frame, fps = stream.read()
        if not grabbed or frame is None:
            time.sleep(0.01)
            continue

        # Put into AI worker queue if available
        if engine.inference_queue.empty():
            try:
                engine.inference_queue.put_nowait(frame.copy())
            except queue.Full:
                pass

        annotated_frame = engine.render_hud(frame, fps)

        ret, buffer = cv2.imencode('.jpg', annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ret:
            continue

        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.02)


@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/api/status')
def api_status():
    global engine, stream, live_history
    if engine is None or stream is None:
        return jsonify({"status": "starting"})

    now = time.time()
    with engine.hud_lock:
        banner = None
        if now < engine.hud_banner_until and engine.hud_banner_name:
            banner = {
                "name": engine.hud_banner_name,
                "status": engine.hud_banner_status,
                "class": engine.hud_banner_class,
                "time": engine.hud_banner_time
            }

    with history_lock:
        hist_copy = list(reversed(live_history[-30:]))

    distinct_enrolled = len(set(s["student_name"] for s in engine.enrolled_students))

    return jsonify({
        "total_present": engine.counter_total_present,
        "on_time": engine.counter_on_time,
        "late": engine.counter_late,
        "enrolled_count": distinct_enrolled,
        "fps": stream.current_fps,
        "gate_name": config.GATE_NAME,
        "backend_type": config.BACKEND_TYPE,
        "banner": banner,
        "history": hist_copy
    })


@app.route('/api/reload', methods=['POST'])
def api_reload():
    global engine
    if engine:
        threading.Thread(target=engine.sync_students, daemon=True).start()
    return jsonify({"success": True})


@app.route('/api/toggle_audio', methods=['POST'])
def api_toggle_audio():
    config.ENABLE_AUDIO = not config.ENABLE_AUDIO
    return jsonify({"enabled": config.ENABLE_AUDIO})


@app.route('/api/toggle_mesh', methods=['POST'])
def api_toggle_mesh():
    global engine
    if engine:
        with engine.hud_lock:
            engine.show_mesh = not engine.show_mesh
            mesh_state = engine.show_mesh
        return jsonify({"mesh": mesh_state})
    return jsonify({"mesh": False})


def run_desktop_application(port: int = 5055):
    """Initializes the Spotlight Engine and starts the Flask Full-Stack Kiosk Server."""
    global engine, stream

    print("=" * 75)
    print("  PRESENCES SPOTLIGHT AI — FULL-STACK STANDALONE DESKTOP APPLICATION  ")
    print("=" * 75)

    engine = SpotlightEngine()
    stream = RTSPVideoStream().start()

    # Wrap attendance callback to update live web history
    orig_handle = engine.handle_confirmed_attendance

    def custom_attendance_handler(student, confidence, face_data=None):
        orig_handle(student, confidence, face_data)
        with history_lock:
            live_history.append({
                "name": student.get("student_name", "Student"),
                "class": f"{student.get('class_name', '')}-{student.get('section', '')}".strip("-"),
                "status": engine.determine_status(),
                "time": datetime.now().strftime("%I:%M:%S %p"),
                "timestamp": time.time()
            })

    engine.handle_confirmed_attendance = custom_attendance_handler
    threading.Thread(target=engine._inference_worker, daemon=True).start()

    # Automatically open local desktop browser window
    app_url = f"http://127.0.0.1:{port}"
    print(f"\n[Spotlight Desktop] Live Dashboard launched at: {app_url}")
    threading.Timer(1.2, lambda: webbrowser.open(app_url)).start()

    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    run_desktop_application()
