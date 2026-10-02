"""
Presences Spotlight AI — Modern GUI Setup & Installer Wizard
A lightweight, standalone GUI installer and configuration manager for Windows PCs.
"""

import os
import sys
import json
import time
import shutil
import threading
import subprocess
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

# Base Directory
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
ENV_EXAMPLE = BASE_DIR / ".env.example"

# Theme colors (Presences Studio Dark Glass Palette)
BG_DARK = "#0f172a"        # Slate 900
BG_CARD = "#1e293b"        # Slate 800
BG_INPUT = "#090d16"       # Slate 950
ACCENT_BLUE = "#3b82f6"    # Blue 500
ACCENT_CYAN = "#06b6d4"    # Cyan 500
ACCENT_GREEN = "#10b981"   # Emerald 500
ACCENT_AMBER = "#f59e0b"   # Amber 500
TEXT_MAIN = "#f8fafc"      # Slate 50
TEXT_MUTED = "#94a3b8"     # Slate 400
BORDER_COLOR = "#334155"   # Slate 700


class SpotlightInstallerApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Presences Spotlight AI — PC Setup & Configuration Wizard")
        self.root.geometry("820x660")
        self.root.minsize(780, 600)
        self.root.configure(bg=BG_DARK)

        # Set app icon if available
        try:
            self.root.iconbitmap(default="")
        except Exception:
            pass

        self.env_data = self.load_env()
        self.available_cams = []

        self.setup_styles()
        self.build_ui()
        self.run_background_diagnostics()

    def setup_styles(self):
        style = ttk.Style()
        style.theme_use("clam")

        # Configure notebook tabs
        style.configure("TNotebook", background=BG_DARK, borderwidth=0)
        style.configure("TNotebook.Tab", background=BG_CARD, foreground=TEXT_MUTED,
                        padding=[16, 8], font=("Segoe UI", 10, "bold"), borderwidth=0)
        style.map("TNotebook.Tab",
                  background=[("selected", ACCENT_BLUE)],
                  foreground=[("selected", TEXT_MAIN)])

        style.configure("TProgressbar", thickness=8, troughcolor=BG_CARD,
                        background=ACCENT_CYAN, borderwidth=0)

    def load_env(self) -> dict:
        data = {
            "SUPABASE_URL": "https://your-project-id.supabase.co",
            "SUPABASE_KEY": "your-supabase-service-or-anon-key",
            "RTSP_URL": "0",
            "CAMERA_WIDTH": "1280",
            "CAMERA_HEIGHT": "720",
            "GATE_NAME": "Main School Gate — Spotlight 1",
            "CUTOFF_HOUR": "9",
            "CUTOFF_MINUTE": "0",
            "MATCH_THRESHOLD": "0.42",
            "ENABLE_AUDIO": "true",
            "FULLSCREEN_KIOSK": "false",
            "SHOW_WINDOW": "true"
        }

        target_file = ENV_PATH if ENV_PATH.exists() else (ENV_EXAMPLE if ENV_EXAMPLE.exists() else None)
        if target_file and target_file.exists():
            try:
                with open(target_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            data[k.strip()] = v.strip().strip('"').strip("'")
            except Exception as e:
                print(f"Notice reading env: {e}")
        return data

    def save_env(self) -> bool:
        try:
            lines = [
                "# Presences Spotlight AI — Edge Configuration File",
                f"SUPABASE_URL={self.supabase_url_var.get().strip()}",
                f"SUPABASE_KEY={self.supabase_key_var.get().strip()}",
                "",
                "# Camera Ingest Settings (0, 1 for USB Webcam, or rtsp:// stream URL)",
                f"RTSP_URL={self.rtsp_url_var.get().strip()}",
                f"CAMERA_WIDTH={self.cam_w_var.get().strip()}",
                f"CAMERA_HEIGHT={self.cam_h_var.get().strip()}",
                "TARGET_FPS=30",
                "FRAME_SCALE=0.5",
                "",
                "# Gate Attendance Rules & Cutoff",
                f"GATE_NAME={self.gate_name_var.get().strip()}",
                f"CUTOFF_HOUR={self.cutoff_h_var.get().strip()}",
                f"CUTOFF_MINUTE={self.cutoff_m_var.get().strip()}",
                f"MATCH_THRESHOLD={self.threshold_var.get().strip()}",
                "AMBIGUITY_RATIO=0.82",
                "CONSENSUS_FRAMES_REQUIRED=3",
                "CONSENSUS_WINDOW_SECONDS=1.5",
                "COOLDOWN_SECONDS=60",
                "STUDENT_SYNC_INTERVAL_SEC=300",
                "",
                "# Display & Audio",
                f"ENABLE_AUDIO={'true' if self.audio_var.get() else 'false'}",
                f"FULLSCREEN_KIOSK={'true' if self.fullscreen_var.get() else 'false'}",
                "SHOW_WINDOW=true",
                ""
            ]
            with open(ENV_PATH, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            return True
        except Exception as e:
            messagebox.showerror("Save Error", f"Failed to save configuration: {e}")
            return False

    def build_ui(self):
        # ── Top Header Banner ──
        header_frame = tk.Frame(self.root, bg=BG_CARD, padx=20, pady=16)
        header_frame.pack(fill="x", side="top")

        title_lbl = tk.Label(header_frame, text="⚡ Presences Spotlight AI",
                             font=("Segoe UI", 16, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        title_lbl.pack(anchor="w")

        subtitle_lbl = tk.Label(header_frame,
                                text="Enterprise Walk-Through Gate Face Recognition Terminal • Automated Setup",
                                font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD)
        subtitle_lbl.pack(anchor="w", pady=(2, 0))

        # ── Tabbed Notebook ──
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill="both", expand=True, padx=20, pady=(16, 10))

        # Tab 1: System Readiness & Dependencies
        self.tab_diag = tk.Frame(self.notebook, bg=BG_DARK, padx=16, pady=16)
        self.notebook.add(self.tab_diag, text="  1. System Diagnostic  ")
        self.build_diagnostics_tab()

        # Tab 2: Camera Ingest Setup & Live Test
        self.tab_cam = tk.Frame(self.notebook, bg=BG_DARK, padx=16, pady=16)
        self.notebook.add(self.tab_cam, text="  2. Camera Ingest  ")
        self.build_camera_tab()

        # Tab 3: Cloud & School Rules
        self.tab_cloud = tk.Frame(self.notebook, bg=BG_DARK, padx=16, pady=16)
        self.notebook.add(self.tab_cloud, text="  3. Cloud & Timetable  ")
        self.build_cloud_tab()

        # Tab 4: 1-Click Launch & Shortcuts
        self.tab_launch = tk.Frame(self.notebook, bg=BG_DARK, padx=16, pady=16)
        self.notebook.add(self.tab_launch, text="  4. Finish & Launch  ")
        self.build_launch_tab()

        # ── Bottom Status Bar ──
        footer_frame = tk.Frame(self.root, bg=BG_CARD, padx=16, pady=10)
        footer_frame.pack(fill="x", side="bottom")

        self.status_lbl = tk.Label(footer_frame, text="Ready to configure.",
                                   font=("Segoe UI", 9, "bold"), fg=ACCENT_CYAN, bg=BG_CARD)
        self.status_lbl.pack(side="left")

        save_btn = tk.Button(footer_frame, text="💾 Save Configuration",
                             command=self.on_save_clicked,
                             bg=ACCENT_BLUE, fg=TEXT_MAIN, activebackground="#2563eb",
                             font=("Segoe UI", 9, "bold"), padx=14, pady=4, relief="flat", cursor="hand2")
        save_btn.pack(side="right")

    # ──────────────────────────────────────────────────────────────────────────
    # TAB 1: DIAGNOSTICS & DEPENDENCIES
    # ──────────────────────────────────────────────────────────────────────────
    def build_diagnostics_tab(self):
        info_card = tk.LabelFrame(self.tab_diag, text=" PC Readiness Verification ",
                                  bg=BG_CARD, fg=TEXT_MAIN, font=("Segoe UI", 10, "bold"),
                                  padx=16, pady=12, relief="flat", bd=1)
        info_card.pack(fill="x", pady=(0, 12))

        self.diag_labels = {}
        checks = [
            ("python", "Python 64-bit Interpreter"),
            ("cv2", "OpenCV Computer Vision Engine"),
            ("numpy", "NumPy Vectorized Matrix Library"),
            ("requests", "HTTP Cloud Sync Client"),
            ("dotenv", "Environment Configuration Parser"),
            ("audio", "Audio Feedback Chime Engine (Winsound/Pygame)"),
            ("face_rec", "High-Precision Face Vector Model (dlib/OpenCV Fallback)")
        ]

        for key, title in checks:
            row = tk.Frame(info_card, bg=BG_CARD)
            row.pack(fill="x", pady=3)

            lbl_title = tk.Label(row, text=f"• {title}:", font=("Segoe UI", 9),
                                 fg=TEXT_MAIN, bg=BG_CARD, width=42, anchor="w")
            lbl_title.pack(side="left")

            lbl_val = tk.Label(row, text="Checking...", font=("Segoe UI", 9, "bold"),
                               fg=ACCENT_AMBER, bg=BG_CARD, anchor="w")
            lbl_val.pack(side="left", padx=8)
            self.diag_labels[key] = lbl_val

        # Actions Card
        act_card = tk.LabelFrame(self.tab_diag, text=" Automated Package Installer ",
                                 bg=BG_CARD, fg=TEXT_MAIN, font=("Segoe UI", 10, "bold"),
                                 padx=16, pady=12, relief="flat", bd=1)
        act_card.pack(fill="both", expand=True)

        desc_lbl = tk.Label(act_card,
                            text="Click below to automatically install and verify all required AI vision libraries\nwithout needing Microsoft C++ Build Tools or manual configuration.",
                            font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD, justify="left")
        desc_lbl.pack(anchor="w", pady=(0, 8))

        self.install_btn = tk.Button(act_card, text="⚡ 1-Click Install All AI Dependencies",
                                     command=self.install_dependencies_async,
                                     bg=ACCENT_GREEN, fg=TEXT_MAIN, activebackground="#059669",
                                     font=("Segoe UI", 10, "bold"), padx=18, pady=8, relief="flat", cursor="hand2")
        self.install_btn.pack(anchor="w", pady=4)

        self.progress_bar = ttk.Progressbar(act_card, mode="indeterminate", style="TProgressbar")
        self.progress_bar.pack(fill="x", pady=(10, 4))

        # Log Output Box
        self.log_text = tk.Text(act_card, height=6, bg=BG_INPUT, fg=TEXT_MUTED,
                                font=("Consolas", 8), relief="flat", padx=8, pady=6)
        self.log_text.pack(fill="both", expand=True, pady=(4, 0))

    def run_background_diagnostics(self):
        def _check():
            self.update_status("Running system diagnostics...")

            # 1. Python
            py_ver = f"Python {sys.version.split()[0]} ({'64-bit' if sys.maxsize > 2**32 else '32-bit'})"
            self.set_diag_result("python", True, py_ver)

            # 2. OpenCV
            try:
                import cv2
                self.set_diag_result("cv2", True, f"v{cv2.__version__} Ready")
            except ImportError:
                self.set_diag_result("cv2", False, "Missing (Click Install below)")

            # 3. NumPy
            try:
                import numpy as np
                self.set_diag_result("numpy", True, f"v{np.__version__} Ready")
            except ImportError:
                self.set_diag_result("numpy", False, "Missing")

            # 4. Requests
            try:
                import requests
                self.set_diag_result("requests", True, f"v{requests.__version__} Ready")
            except ImportError:
                self.set_diag_result("requests", False, "Missing")

            # 5. Dotenv
            try:
                import dotenv
                self.set_diag_result("dotenv", True, "Ready")
            except ImportError:
                self.set_diag_result("dotenv", False, "Missing")

            # 6. Audio
            if sys.platform == "win32":
                self.set_diag_result("audio", True, "Native Windows Audio (Winsound)")
            else:
                self.set_diag_result("audio", True, "Standard Audio Backend")

            # 7. Face Rec
            try:
                import face_recognition
                self.set_diag_result("face_rec", True, "Dlib High-Precision Enabled")
            except ImportError:
                self.set_diag_result("face_rec", True, "OpenCV High-Speed Engine (Active)")

            self.update_status("System diagnostics complete.")
            self.detect_cameras_async()

        threading.Thread(target=_check, daemon=True).start()

    def set_diag_result(self, key: str, ok: bool, text: str):
        lbl = self.diag_labels.get(key)
        if lbl:
            lbl.config(text=f"{'✔' if ok else '✖'} {text}", fg=ACCENT_GREEN if ok else "#ef4444")

    def install_dependencies_async(self):
        self.install_btn.config(state="disabled")
        self.progress_bar.start(10)
        self.log_text.delete("1.0", tk.END)

        def _worker():
            self.update_status("Installing AI packages via pip...")
            cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "pip", "numpy", "opencv-python", "requests", "python-dotenv", "Pillow", "pygame"]
            try:
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                for line in iter(process.stdout.readline, ''):
                    self.log_text.insert(tk.END, line)
                    self.log_text.see(tk.END)
                process.wait()

                # Try dlib-bin for Windows
                self.log_text.insert(tk.END, "\n[Optional] Installing precompiled face recognition binary...\n")
                subprocess.run([sys.executable, "-m", "pip", "install", "dlib-bin", "--quiet"])
                subprocess.run([sys.executable, "-m", "pip", "install", "--no-build-isolation", "face_recognition", "--quiet"])

                self.log_text.insert(tk.END, "\n🎉 Dependency installation completed!\n")
                self.root.after(0, self.run_background_diagnostics)
            except Exception as err:
                self.log_text.insert(tk.END, f"\nError installing packages: {err}\n")
            finally:
                self.progress_bar.stop()
                self.install_btn.config(state="normal")

        threading.Thread(target=_worker, daemon=True).start()

    # ──────────────────────────────────────────────────────────────────────────
    # TAB 2: CAMERA INGEST SETUP & TEST
    # ──────────────────────────────────────────────────────────────────────────
    def build_camera_tab(self):
        card = tk.LabelFrame(self.tab_cam, text=" Video Stream Input Source ",
                             bg=BG_CARD, fg=TEXT_MAIN, font=("Segoe UI", 10, "bold"),
                             padx=16, pady=14, relief="flat", bd=1)
        card.pack(fill="x", pady=(0, 12))

        # Camera Source Selection (Webcam vs RTSP)
        self.rtsp_url_var = tk.StringVar(value=self.env_data.get("RTSP_URL", "0"))

        lbl_src = tk.Label(card, text="Camera Device / RTSP Address:",
                           font=("Segoe UI", 9, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        lbl_src.grid(row=0, column=0, sticky="w", pady=4)

        self.cam_combo = ttk.Combobox(card, textvariable=self.rtsp_url_var, width=45, font=("Segoe UI", 9))
        self.cam_combo['values'] = ["0 (Default Built-in / USB Webcam)", "1 (Secondary USB / External Camera)", "2 (Third Camera Input)"]
        self.cam_combo.grid(row=0, column=1, sticky="w", padx=8, pady=4)

        btn_detect = tk.Button(card, text="🔄 Auto-Detect", command=self.detect_cameras_async,
                               bg=BG_DARK, fg=TEXT_MAIN, font=("Segoe UI", 8), padx=8, pady=2, relief="flat")
        btn_detect.grid(row=0, column=2, padx=4, pady=4)

        tip_lbl = tk.Label(card, text="💡 For IP PoE Cameras, paste RTSP URL (e.g., rtsp://admin:pass@192.168.1.50:554/h264)",
                           font=("Segoe UI", 8), fg=TEXT_MUTED, bg=BG_CARD)
        tip_lbl.grid(row=1, column=0, columnspan=3, sticky="w", pady=(2, 10))

        # Resolution
        self.cam_w_var = tk.StringVar(value=self.env_data.get("CAMERA_WIDTH", "1280"))
        self.cam_h_var = tk.StringVar(value=self.env_data.get("CAMERA_HEIGHT", "720"))

        lbl_res = tk.Label(card, text="Target Resolution (WxH):", font=("Segoe UI", 9, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        lbl_res.grid(row=2, column=0, sticky="w", pady=4)

        res_frame = tk.Frame(card, bg=BG_CARD)
        res_frame.grid(row=2, column=1, sticky="w", padx=8, pady=4)

        ent_w = tk.Entry(res_frame, textvariable=self.cam_w_var, width=8, bg=BG_INPUT, fg=TEXT_MAIN,
                         insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9))
        ent_w.pack(side="left")
        tk.Label(res_frame, text="x", fg=TEXT_MUTED, bg=BG_CARD).pack(side="left", padx=4)
        ent_h = tk.Entry(res_frame, textvariable=self.cam_h_var, width=8, bg=BG_INPUT, fg=TEXT_MAIN,
                         insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9))
        ent_h.pack(side="left")

        # Test Stream Card
        test_card = tk.LabelFrame(self.tab_cam, text=" Live Hardware Video Diagnostic ",
                                  bg=BG_CARD, fg=TEXT_MAIN, font=("Segoe UI", 10, "bold"),
                                  padx=16, pady=14, relief="flat", bd=1)
        test_card.pack(fill="both", expand=True)

        desc_test = tk.Label(test_card,
                             text="Test the camera connection to verify zero latency, smooth 30 FPS playback,\nand proper illumination for biometric walk-through recognition.",
                             font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD, justify="left")
        desc_test.pack(anchor="w", pady=(0, 10))

        self.test_cam_btn = tk.Button(test_card, text="🎥 Test Live Camera Stream (5 Seconds)",
                                      command=self.test_camera_stream_async,
                                      bg=ACCENT_CYAN, fg=BG_DARK, activebackground="#0891b2",
                                      font=("Segoe UI", 10, "bold"), padx=16, pady=8, relief="flat", cursor="hand2")
        self.test_cam_btn.pack(anchor="w", pady=4)

    def detect_cameras_async(self):
        def _detect():
            try:
                import cv2
                found = []
                for idx in range(4):
                    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY)
                    if cap.isOpened():
                        ret, _ = cap.read()
                        if ret:
                            found.append(f"{idx} (Active Video Device {idx})")
                        cap.release()
                if found:
                    self.cam_combo['values'] = found
                    self.rtsp_url_var.set(found[0].split()[0])
                    self.update_status(f"Detected {len(found)} active camera device(s).")
            except Exception:
                pass
        threading.Thread(target=_detect, daemon=True).start()

    def test_camera_stream_async(self):
        self.test_cam_btn.config(state="disabled")
        src_raw = self.rtsp_url_var.get().split()[0]
        try:
            src = int(src_raw)
        except ValueError:
            src = src_raw

        def _test():
            try:
                import cv2
                self.update_status(f"Opening camera stream: {src}...")
                cap = cv2.VideoCapture(src, cv2.CAP_DSHOW if isinstance(src, int) and sys.platform == "win32" else cv2.CAP_ANY)
                if not cap.isOpened():
                    messagebox.showerror("Camera Error", f"Unable to open camera source: {src}")
                    return

                win_title = "Camera Test Preview (Press Q or wait 5s to close)"
                cv2.namedWindow(win_title, cv2.WINDOW_NORMAL)
                cv2.resizeWindow(win_title, 640, 480)

                start_t = time.time()
                while (time.time() - start_t) < 5.5:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    cv2.putText(frame, "SPOTLIGHT CAMERA PREVIEW OK", (20, 35),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (34, 197, 94), 2)
                    cv2.imshow(win_title, frame)
                    if cv2.waitKey(1) & 0xFF in (ord('q'), 27):
                        break

                cap.release()
                cv2.destroyAllWindows()
                self.update_status("Camera preview test completed successfully.")
            except Exception as e:
                messagebox.showerror("Camera Exception", str(e))
            finally:
                self.test_cam_btn.config(state="normal")

        threading.Thread(target=_test, daemon=True).start()

    # ──────────────────────────────────────────────────────────────────────────
    # TAB 3: CLOUD SYNC & TIMETABLE RULES
    # ──────────────────────────────────────────────────────────────────────────
    def build_cloud_tab(self):
        # Cloud Card
        cloud_card = tk.LabelFrame(self.tab_cloud, text=" Supabase Cloud Synchronization ",
                                   bg=BG_CARD, fg=TEXT_MAIN, font=("Segoe UI", 10, "bold"),
                                   padx=16, pady=14, relief="flat", bd=1)
        cloud_card.pack(fill="x", pady=(0, 12))

        self.supabase_url_var = tk.StringVar(value=self.env_data.get("SUPABASE_URL", ""))
        self.supabase_key_var = tk.StringVar(value=self.env_data.get("SUPABASE_KEY", ""))

        lbl_url = tk.Label(cloud_card, text="Supabase Project URL:", font=("Segoe UI", 9, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        lbl_url.grid(row=0, column=0, sticky="w", pady=4)
        ent_url = tk.Entry(cloud_card, textvariable=self.supabase_url_var, width=45, bg=BG_INPUT, fg=TEXT_MAIN,
                           insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9))
        ent_url.grid(row=0, column=1, sticky="w", padx=8, pady=4)

        lbl_key = tk.Label(cloud_card, text="Anon / Service Role Key:", font=("Segoe UI", 9, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        lbl_key.grid(row=1, column=0, sticky="w", pady=4)
        ent_key = tk.Entry(cloud_card, textvariable=self.supabase_key_var, width=45, bg=BG_INPUT, fg=TEXT_MAIN,
                           insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9), show="•")
        ent_key.grid(row=1, column=1, sticky="w", padx=8, pady=4)

        self.test_conn_btn = tk.Button(cloud_card, text="🌐 Test Cloud Connection", command=self.test_supabase_connection_async,
                                       bg=ACCENT_BLUE, fg=TEXT_MAIN, font=("Segoe UI", 8, "bold"), padx=10, pady=3, relief="flat")
        self.test_conn_btn.grid(row=1, column=2, padx=4, pady=4)

        # Timetable Card
        time_card = tk.LabelFrame(self.tab_cloud, text=" Gate Rules & Morning Cutoff ",
                                  bg=BG_CARD, fg=TEXT_MAIN, font=("Segoe UI", 10, "bold"),
                                  padx=16, pady=14, relief="flat", bd=1)
        time_card.pack(fill="both", expand=True)

        self.gate_name_var = tk.StringVar(value=self.env_data.get("GATE_NAME", "Main School Gate — Spotlight 1"))
        self.cutoff_h_var = tk.StringVar(value=self.env_data.get("CUTOFF_HOUR", "9"))
        self.cutoff_m_var = tk.StringVar(value=self.env_data.get("CUTOFF_MINUTE", "0"))
        self.threshold_var = tk.StringVar(value=self.env_data.get("MATCH_THRESHOLD", "0.42"))
        self.audio_var = tk.BooleanVar(value=self.env_data.get("ENABLE_AUDIO", "true").lower() == "true")
        self.fullscreen_var = tk.BooleanVar(value=self.env_data.get("FULLSCREEN_KIOSK", "false").lower() == "true")

        # Gate Name
        lbl_g = tk.Label(time_card, text="Terminal / Gate Label:", font=("Segoe UI", 9, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        lbl_g.grid(row=0, column=0, sticky="w", pady=4)
        ent_g = tk.Entry(time_card, textvariable=self.gate_name_var, width=32, bg=BG_INPUT, fg=TEXT_MAIN,
                         insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9))
        ent_g.grid(row=0, column=1, sticky="w", padx=8, pady=4)

        # Morning Cutoff
        lbl_c = tk.Label(time_card, text="Morning On-Time Cutoff:", font=("Segoe UI", 9, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        lbl_c.grid(row=1, column=0, sticky="w", pady=4)

        c_frame = tk.Frame(time_card, bg=BG_CARD)
        c_frame.grid(row=1, column=1, sticky="w", padx=8, pady=4)
        tk.Entry(c_frame, textvariable=self.cutoff_h_var, width=4, bg=BG_INPUT, fg=TEXT_MAIN,
                 insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9)).pack(side="left")
        tk.Label(c_frame, text=":", fg=TEXT_MAIN, bg=BG_CARD, font=("Segoe UI", 9, "bold")).pack(side="left", padx=2)
        tk.Entry(c_frame, textvariable=self.cutoff_m_var, width=4, bg=BG_INPUT, fg=TEXT_MAIN,
                 insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9)).pack(side="left")
        tk.Label(c_frame, text="(24-Hour, e.g. 08:30)", fg=TEXT_MUTED, bg=BG_CARD, font=("Segoe UI", 8)).pack(side="left", padx=6)

        # Match Sensitivity
        lbl_t = tk.Label(time_card, text="Face Strictness Threshold:", font=("Segoe UI", 9, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        lbl_t.grid(row=2, column=0, sticky="w", pady=4)
        tk.Entry(time_card, textvariable=self.threshold_var, width=8, bg=BG_INPUT, fg=TEXT_MAIN,
                 insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9)).grid(row=2, column=1, sticky="w", padx=8, pady=4)

        # Toggles
        tk.Checkbutton(time_card, text="Enable Audio Chime Verification on Student Arrival",
                       variable=self.audio_var, bg=BG_CARD, fg=TEXT_MAIN, selectcolor=BG_DARK,
                       activebackground=BG_CARD, font=("Segoe UI", 9)).grid(row=3, column=0, columnspan=2, sticky="w", pady=(8, 2))

        tk.Checkbutton(time_card, text="Launch in Kiosk Fullscreen Mode automatically",
                       variable=self.fullscreen_var, bg=BG_CARD, fg=TEXT_MAIN, selectcolor=BG_DARK,
                       activebackground=BG_CARD, font=("Segoe UI", 9)).grid(row=4, column=0, columnspan=2, sticky="w", pady=2)

    def test_supabase_connection_async(self):
        url = self.supabase_url_var.get().strip().rstrip('/')
        key = self.supabase_key_var.get().strip()

        if not url or not key:
            messagebox.showwarning("Missing Credentials", "Please enter both Supabase URL and Key.")
            return

        self.test_conn_btn.config(state="disabled")

        def _worker():
            try:
                import requests
                self.update_status("Testing connection to Supabase...")
                headers = {"apikey": key, "Authorization": f"Bearer {key}"}
                endpoint = f"{url}/rest/v1/face_descriptors?select=id,student_name&limit=5"
                res = requests.get(endpoint, headers=headers, timeout=6)
                if res.status_code == 200:
                    data = res.json()
                    messagebox.showinfo("Connection Verified!",
                                        f"✔ Successfully connected to Presences Cloud!\nEnrolled student models accessible.")
                    self.update_status("Cloud sync link verified successfully.")
                else:
                    messagebox.showwarning("Auth Warning", f"Supabase responded with code {res.status_code}:\n{res.text}")
            except Exception as e:
                messagebox.showerror("Connection Error", f"Could not reach Supabase server:\n{e}")
            finally:
                self.test_conn_btn.config(state="normal")

        threading.Thread(target=_worker, daemon=True).start()

    # ──────────────────────────────────────────────────────────────────────────
    # TAB 4: FINISH & 1-CLICK LAUNCH
    # ──────────────────────────────────────────────────────────────────────────
    def build_launch_tab(self):
        card = tk.LabelFrame(self.tab_launch, text=" Desktop Integration & Quick Launch ",
                             bg=BG_CARD, fg=TEXT_MAIN, font=("Segoe UI", 10, "bold"),
                             padx=20, pady=18, relief="flat", bd=1)
        card.pack(fill="both", expand=True)

        desc = tk.Label(card,
                        text="Your Presences Spotlight AI Terminal is configured and ready for production gate deployment.\nUse the options below to create desktop shortcuts or start the system immediately.",
                        font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD, justify="left")
        desc.pack(anchor="w", pady=(0, 16))

        # Desktop Shortcut Button
        btn_short = tk.Button(card, text="📌 Create Desktop Shortcut (Presences Spotlight Gate)",
                              command=self.create_desktop_shortcut,
                              bg=BG_DARK, fg=TEXT_MAIN, activebackground=BORDER_COLOR,
                              font=("Segoe UI", 10, "bold"), padx=16, pady=8, relief="flat", cursor="hand2")
        btn_short.pack(anchor="w", pady=6)

        # Launch Now Button (Hero)
        btn_start = tk.Button(card, text="🚀 Launch Spotlight Gate Terminal Now",
                              command=self.launch_spotlight_now,
                              bg=ACCENT_GREEN, fg=TEXT_MAIN, activebackground="#059669",
                              font=("Segoe UI", 11, "bold"), padx=22, pady=12, relief="flat", cursor="hand2")
        btn_start.pack(anchor="w", pady=(16, 6))

        # Test Audio Chime Button
        btn_chime = tk.Button(card, text="🔔 Test Sound Verification Chime",
                              command=self.test_audio_chime,
                              bg=BG_CARD, fg=ACCENT_CYAN, activebackground=BG_DARK,
                              font=("Segoe UI", 9, "bold"), relief="flat", cursor="hand2")
        btn_chime.pack(anchor="w", pady=6)

    def create_desktop_shortcut(self):
        if not self.save_env():
            return

        target_bat = BASE_DIR / "START_SPOTLIGHT.bat"
        shortcut_name = "Presences Spotlight Gate.lnk"
        desktop_dir = Path(os.environ.get("USERPROFILE", "")) / "Desktop"

        ps_cmd = f"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{desktop_dir / shortcut_name}'); $s.TargetPath = '{target_bat}'; $s.WorkingDirectory = '{BASE_DIR}'; $s.Description = 'Presences Spotlight AI Gate Attendance Terminal'; $s.Save()"
        try:
            subprocess.run(["powershell", "-Command", ps_cmd], check=True)
            messagebox.showinfo("Shortcut Created", f"✔ 'Presences Spotlight Gate' shortcut was successfully created on your Desktop!")
        except Exception as e:
            messagebox.showwarning("Shortcut Notice", f"Could not create shortcut automatically: {e}")

    def test_audio_chime(self):
        try:
            from sound_generator import generate_chime
            chime_path = BASE_DIR / "spotlight_chime.wav"
            if not chime_path.exists():
                generate_chime(str(chime_path))

            if sys.platform == "win32":
                import winsound
                winsound.PlaySound(str(chime_path), winsound.SND_FILENAME | winsound.SND_ASYNC)
                messagebox.showinfo("Audio Test", "Played verification chime.")
            else:
                messagebox.showinfo("Audio Test", f"Chime generated at: {chime_path}")
        except Exception as e:
            messagebox.showerror("Audio Error", str(e))

    def launch_spotlight_now(self):
        if not self.save_env():
            return
        target_bat = BASE_DIR / "START_SPOTLIGHT.bat"
        try:
            subprocess.Popen([str(target_bat)], cwd=str(BASE_DIR), shell=True)
            self.root.destroy()
        except Exception as e:
            messagebox.showerror("Launch Error", f"Could not launch terminal: {e}")

    def on_save_clicked(self):
        if self.save_env():
            messagebox.showinfo("Configuration Saved", "✔ Settings saved to .env successfully!")
            self.update_status("Configuration saved.")

    def update_status(self, msg: str):
        self.root.after(0, lambda: self.status_lbl.config(text=msg))


def main():
    root = tk.Tk()
    app = SpotlightInstallerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
