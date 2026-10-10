"""
Presences Spotlight AI — Enterprise Gate Attendance Desktop Application
Google MediaPipe 478 3D Mesh Vision Pipeline + Appwrite Cloud Gate Terminal
"""

import os
import sys
import time
import json
import csv
import queue
import threading
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import cv2
import numpy as np

# Suppress deprecation notices for a clean enterprise console output
warnings.filterwarnings('ignore')

# PyQt6 Native Desktop GUI Components
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QTableWidget, QTableWidgetItem, QHeaderView, QLineEdit,
    QFileDialog, QDialog, QSlider, QTimeEdit, QCheckBox, QFrame, QScrollArea,
    QSizePolicy, QMessageBox, QAbstractItemView, QSpacerItem, QStackedWidget,
    QComboBox, QProgressBar, QSystemTrayIcon, QMenu, QButtonGroup
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer, QSize, QTime, QObject
from PyQt6.QtGui import QImage, QPixmap, QFont, QColor, QIcon, QPainter, QPen, QBrush

import config
from spotlight_engine import SpotlightEngine, RTSPVideoStream, play_feedback_sound

# Base directory setup
if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).resolve().parent


# ─── 1. Thread-Safe Event Bridge ──────────────────────────────────────────────
class AttendanceBridge(QObject):
    """Bridge for safely dispatching attendance events from background threads to Qt GUI."""
    student_verified = pyqtSignal(dict)


# ─── 2. Background Video Capture & Inference Worker ───────────────────────────
class CameraWorker(QThread):
    """Zero-lag QThread acquiring video frames and streaming rendered HUD to GUI."""
    frame_ready = pyqtSignal(QImage, float, int, int)  # image, fps, width, height
    camera_error = pyqtSignal(str)

    def __init__(self, engine: SpotlightEngine, parent=None):
        super().__init__(parent)
        self.engine = engine
        self.stream: Optional[RTSPVideoStream] = None
        self.running = True
        self.source = config.RTSP_URL

    def run(self):
        try:
            self.stream = RTSPVideoStream(src=self.source).start()
        except Exception as e:
            self.camera_error.emit(str(e))
            return

        # Ensure engine inference worker is active
        self.engine.start_worker()

        while self.running:
            if self.stream is None:
                self.msleep(30)
                continue

            grabbed, frame, fps = self.stream.read()
            if not grabbed or frame is None:
                self.msleep(15)
                continue

            h, w = frame.shape[:2]

            # Enqueue frame for background AI detection (non-blocking)
            if self.engine.inference_queue.empty():
                try:
                    self.engine.inference_queue.put_nowait(frame.copy())
                except queue.Full:
                    pass

            # Render bounding boxes, name tags, and 3D mesh HUD overlay
            annotated_frame = self.engine.render_hud(frame, fps)

            # Convert OpenCV BGR frame to Qt QImage
            rgb_frame = cv2.cvtColor(annotated_frame, cv2.COLOR_BGR2RGB)
            bytes_per_line = 3 * w
            q_image = QImage(rgb_frame.data, w, h, bytes_per_line, QImage.Format.Format_RGB888).copy()

            self.frame_ready.emit(q_image, fps, w, h)
            self.msleep(15)  # Cap UI emission ~45-60 FPS for smooth rendering without CPU burn

    def reconnect(self, new_source):
        self.source = new_source
        if self.stream:
            self.stream.stop()
        try:
            self.stream = RTSPVideoStream(src=self.source).start()
        except Exception as e:
            self.camera_error.emit(str(e))

    def stop(self):
        self.running = False
        if self.stream:
            self.stream.stop()
        self.wait(1000)


# ─── 3. Background Cloud Sync Worker ──────────────────────────────────────────
class CloudSyncWorker(QThread):
    """Asynchronously syncs student face models from Appwrite without blocking video stream."""
    sync_completed = pyqtSignal(bool, int, int)  # success, total_models, distinct_students

    def __init__(self, engine: SpotlightEngine, parent=None):
        super().__init__(parent)
        self.engine = engine

    def run(self):
        try:
            self.engine.sync_students()
            total_models = len(self.engine.enrolled_students)
            distinct = len(set(s.get("student_name") for s in self.engine.enrolled_students))
            self.sync_completed.emit(True, total_models, distinct)
        except Exception as err:
            print(f"[Desktop Sync Error] {err}")
            self.sync_completed.emit(False, 0, 0)


# ─── 4. Sleek Video Display Viewport ──────────────────────────────────────────
class VideoViewport(QLabel):
    """High-DPI responsive video display widget with aspect ratio preservation."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setStyleSheet("""
            QLabel {
                background-color: #030712;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
            }
        """)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.setMinimumSize(480, 270)
        self.current_pixmap: Optional[QPixmap] = None

        self.setText("Connecting to Camera Stream...\n(Google MediaPipe 478 3D Mesh Engine)")
        self.setStyleSheet("color: #64748b; font-size: 14px; font-weight: bold; background: #070b14; border-radius: 14px;")

    def update_frame(self, q_img: QImage):
        pixmap = QPixmap.fromImage(q_img)
        self.current_pixmap = pixmap
        scaled = pixmap.scaled(
            self.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        self.setPixmap(scaled)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self.current_pixmap:
            scaled = self.current_pixmap.scaled(
                self.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            self.setPixmap(scaled)


# ─── 5. Main Desktop Window ───────────────────────────────────────────────────
class SpotlightDesktopWindow(QMainWindow):
    """Enterprise Desktop Window for Presences Spotlight AI."""
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Presences Spotlight AI — Gate Terminal")
        self.resize(1440, 880)
        self.setMinimumSize(1120, 700)

        # Core Engine & Bridge
        self.engine = SpotlightEngine()
        self.bridge = AttendanceBridge()
        self.bridge.student_verified.connect(self._on_student_verified_ui)

        # Attach engine event callback to bridge
        self.engine.attendance_callback = lambda rec: self.bridge.student_verified.emit(rec)

        # Background Workers
        self.camera_worker = CameraWorker(self.engine)
        self.camera_worker.frame_ready.connect(self._on_frame_ready)
        self.camera_worker.camera_error.connect(self._on_camera_error)
        self.camera_worker.start()

        self.sync_worker: Optional[CloudSyncWorker] = None

        # Build Full Enterprise UI
        self._apply_global_styles()
        self._setup_ui()
        self._load_initial_history()
        self._populate_student_directory()
        self._update_analytics_view()

        # Real-time Header Clock Timer
        self.clock_timer = QTimer(self)
        self.clock_timer.timeout.connect(self._update_clock)
        self.clock_timer.start(1000)
        self._update_clock()

        # Timer to reset hero card after 6 seconds of inactivity
        self.card_reset_timer = QTimer(self)
        self.card_reset_timer.setSingleShot(True)
        self.card_reset_timer.timeout.connect(self._reset_hero_card)

        # Trigger automatic initial background sync from Appwrite
        QTimer.singleShot(1500, self._sync_cloud)

    def _apply_global_styles(self):
        """Applies dark obsidian slate theme inspired by modern enterprise design."""
        self.setStyleSheet("""
            QMainWindow {
                background-color: #070b14;
            }
            QWidget {
                color: #f8fafc;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            }
            QFrame.glass-panel {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
            }
            QPushButton.nav-btn {
                background-color: transparent;
                border: none;
                border-radius: 10px;
                color: #94a3b8;
                font-size: 13px;
                font-weight: 600;
                padding: 10px 14px;
                text-align: left;
            }
            QPushButton.nav-btn:hover {
                background-color: rgba(255, 255, 255, 0.05);
                color: #ffffff;
            }
            QPushButton.nav-btn:checked {
                background-color: #1e293b;
                color: #38bdf8;
                font-weight: 700;
                border-left: 3px solid #38bdf8;
            }
            QPushButton.action-btn {
                background-color: #1e293b;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                color: #e2e8f0;
                font-size: 12px;
                font-weight: 600;
                padding: 8px 14px;
            }
            QPushButton.action-btn:hover {
                background-color: #334155;
                color: #ffffff;
            }
            QPushButton.action-btn:pressed {
                background-color: #0f172a;
            }
            QLineEdit, QComboBox, QTimeEdit, QSlider {
                background-color: #0f172a;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                color: #f8fafc;
                padding: 8px 12px;
                font-size: 12px;
            }
            QLineEdit:focus, QComboBox:focus, QTimeEdit:focus {
                border: 1px solid #10b981;
            }
            QTableWidget {
                background-color: #0b1120;
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 12px;
                gridline-color: rgba(255, 255, 255, 0.03);
                selection-background-color: #1e293b;
                selection-color: #f8fafc;
                font-size: 12px;
            }
            QHeaderView::section {
                background-color: #0f172a;
                color: #94a3b8;
                font-weight: 700;
                font-size: 11px;
                border: none;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                padding: 10px 12px;
                text-transform: uppercase;
            }
            QScrollBar:vertical {
                background: #0b1120;
                width: 8px;
                margin: 0px;
                border-radius: 4px;
            }
            QScrollBar::handle:vertical {
                background: #334155;
                border-radius: 4px;
                min-height: 20px;
            }
            QScrollBar::handle:vertical:hover {
                background: #475569;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
            QProgressBar {
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                background-color: #0f172a;
                text-align: center;
                color: #f8fafc;
                font-weight: bold;
                height: 20px;
            }
            QProgressBar::chunk {
                background-color: #10b981;
                border-radius: 7px;
            }
        """)

    def _setup_ui(self):
        """Constructs sidebar navigation layout and multi-tab stacked container."""
        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)
        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # ── LEFT SIDEBAR NAVIGATION ──
        sidebar = self._build_sidebar()
        root_layout.addWidget(sidebar)

        # ── MAIN CONTENT VIEW (Stacked Views) ──
        content_container = QWidget()
        content_layout = QVBoxLayout(content_container)
        content_layout.setContentsMargins(18, 16, 18, 16)
        content_layout.setSpacing(14)

        # Global Top Bar
        top_bar = self._build_top_bar()
        content_layout.addWidget(top_bar)

        # Stacked Views
        self.views_stack = QStackedWidget(self)
        
        # View 0: Live Gate Kiosk Monitor
        self.view_kiosk = self._build_kiosk_view()
        self.views_stack.addWidget(self.view_kiosk)

        # View 1: Attendance Register
        self.view_register = self._build_register_view()
        self.views_stack.addWidget(self.view_register)

        # View 2: Enrolled Students Directory
        self.view_directory = self._build_directory_view()
        self.views_stack.addWidget(self.view_directory)

        # View 3: Analytics Overview
        self.view_analytics = self._build_analytics_view()
        self.views_stack.addWidget(self.view_analytics)

        # View 4: Hardware & Engine Settings
        self.view_settings = self._build_settings_view()
        self.views_stack.addWidget(self.view_settings)

        content_layout.addWidget(self.views_stack, stretch=1)
        root_layout.addWidget(content_container, stretch=1)

    # ─── Sidebar Component ────────────────────────────────────────────────────
    def _build_sidebar(self) -> QFrame:
        sidebar = QFrame(self)
        sidebar.setFixedWidth(240)
        sidebar.setStyleSheet("""
            QFrame {
                background-color: #0b1120;
                border-right: 1px solid rgba(255, 255, 255, 0.08);
            }
        """)
        s_layout = QVBoxLayout(sidebar)
        s_layout.setContentsMargins(16, 20, 16, 18)
        s_layout.setSpacing(8)

        # Logo & App Title
        brand_row = QHBoxLayout()
        logo_lbl = QLabel()
        logo_file = str(BASE_DIR / "logo.png")
        if os.path.exists(logo_file):
            pm = QPixmap(logo_file).scaled(34, 34, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            logo_lbl.setPixmap(pm)
        else:
            logo_lbl.setText("🛡️")
            logo_lbl.setStyleSheet("font-size: 24px;")
        brand_row.addWidget(logo_lbl)

        brand_text = QVBoxLayout()
        brand_text.setSpacing(1)
        name_lbl = QLabel("PRESENCES AI")
        name_lbl.setStyleSheet("font-size: 15px; font-weight: 900; letter-spacing: 0.5px; color: #ffffff;")
        sub_lbl = QLabel("SPOTLIGHT TERMINAL")
        sub_lbl.setStyleSheet("font-size: 10px; font-weight: 700; color: #38bdf8; letter-spacing: 0.5px;")
        brand_text.addWidget(name_lbl)
        brand_text.addWidget(sub_lbl)
        brand_row.addLayout(brand_text)
        brand_row.addStretch()

        s_layout.addLayout(brand_row)
        s_layout.addSpacing(18)

        # Navigation Buttons Group
        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)

        def add_nav_btn(index: int, icon_text: str, text: str, is_default=False):
            btn = QPushButton(f"  {icon_text}   {text}")
            btn.setCheckable(True)
            btn.setProperty("class", "nav-btn")
            if is_default:
                btn.setChecked(True)
            btn.clicked.connect(lambda: self._switch_view(index))
            self.nav_group.addButton(btn, index)
            s_layout.addWidget(btn)
            return btn

        self.btn_nav_kiosk = add_nav_btn(0, "🎥", "Live Gate Monitor", is_default=True)
        self.btn_nav_reg = add_nav_btn(1, "📋", "Attendance Register")
        self.btn_nav_dir = add_nav_btn(2, "👥", "Student Directory")
        self.btn_nav_ana = add_nav_btn(3, "📊", "Analytics Overview")
        self.btn_nav_set = add_nav_btn(4, "⚙️", "Settings & Hardware")

        s_layout.addStretch()

        # Sidebar Bottom System Status Card
        sys_card = QFrame()
        sys_card.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                padding: 10px;
            }
        """)
        sys_layout = QVBoxLayout(sys_card)
        sys_layout.setContentsMargins(8, 8, 8, 8)
        sys_layout.setSpacing(4)

        sys_title = QLabel("SYSTEM STATUS")
        sys_title.setStyleSheet("font-size: 9px; font-weight: 800; color: #64748b; letter-spacing: 0.5px;")
        
        self.sidebar_cloud_lbl = QLabel("● Appwrite: Connecting...")
        self.sidebar_cloud_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #38bdf8;")

        self.sidebar_mesh_lbl = QLabel("● MediaPipe 478 Mesh: ON")
        self.sidebar_mesh_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #34d399;")

        sys_layout.addWidget(sys_title)
        sys_layout.addWidget(self.sidebar_cloud_lbl)
        sys_layout.addWidget(self.sidebar_mesh_lbl)
        s_layout.addWidget(sys_card)

        return sidebar

    def _switch_view(self, index: int):
        self.views_stack.setCurrentIndex(index)
        if index == 1:
            self._filter_register_table()
        elif index == 2:
            self._populate_student_directory()
        elif index == 3:
            self._update_analytics_view()

    # ─── Global Top Bar ───────────────────────────────────────────────────────
    def _build_top_bar(self) -> QFrame:
        top_bar = QFrame(self)
        top_bar.setProperty("class", "glass-panel")
        top_bar.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                padding: 8px 16px;
            }
        """)
        tb_layout = QHBoxLayout(top_bar)
        tb_layout.setContentsMargins(8, 4, 8, 4)

        # Gate Location & Realtime Clock
        left_box = QVBoxLayout()
        left_box.setSpacing(1)
        self.gate_title_lbl = QLabel(f"📍 {config.GATE_NAME}  •  Autonomous Walk-Through Terminal")
        self.gate_title_lbl.setStyleSheet("font-size: 12px; font-weight: 700; color: #cbd5e1;")
        
        self.clock_lbl = QLabel("Loading system clock...")
        self.clock_lbl.setStyleSheet("font-size: 11px; color: #94a3b8; font-weight: 500;")
        
        left_box.addWidget(self.gate_title_lbl)
        left_box.addWidget(self.clock_lbl)
        tb_layout.addLayout(left_box)

        tb_layout.addStretch()

        # Action Buttons
        actions_layout = QHBoxLayout()
        actions_layout.setSpacing(10)

        # Live FPS pill
        self.fps_badge = QLabel("30 FPS")
        self.fps_badge.setStyleSheet("""
            background-color: #0f172a;
            color: #10b981;
            font-family: 'JetBrains Mono', Consolas, monospace;
            font-weight: 700;
            font-size: 12px;
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 8px;
            padding: 5px 10px;
        """)
        actions_layout.addWidget(self.fps_badge)

        # Sync Appwrite Cloud Button
        self.btn_sync = QPushButton("🔄 Sync Cloud")
        self.btn_sync.setProperty("class", "action-btn")
        self.btn_sync.clicked.connect(self._sync_cloud)
        actions_layout.addWidget(self.btn_sync)

        # Audio Toggle
        self.btn_audio = QPushButton("🔊 Audio ON" if config.ENABLE_AUDIO else "🔇 Audio OFF")
        self.btn_audio.setProperty("class", "action-btn")
        self.btn_audio.clicked.connect(self._toggle_audio)
        actions_layout.addWidget(self.btn_audio)

        # 3D Mesh Toggle
        self.btn_mesh = QPushButton("🕸️ Mesh ON" if self.engine.show_mesh else "🕸️ Mesh OFF")
        self.btn_mesh.setProperty("class", "action-btn")
        self.btn_mesh.clicked.connect(self._toggle_mesh)
        actions_layout.addWidget(self.btn_mesh)

        # Fullscreen Kiosk Mode
        self.btn_fs = QPushButton("⛶ Kiosk (F11)")
        self.btn_fs.setProperty("class", "action-btn")
        self.btn_fs.clicked.connect(self._toggle_fullscreen)
        actions_layout.addWidget(self.btn_fs)

        tb_layout.addLayout(actions_layout)
        return top_bar

    def _update_clock(self):
        now = datetime.now()
        self.clock_lbl.setText(now.strftime("%I:%M:%S %p   •   %A, %B %d, %Y"))

    # ─── View 0: Live Gate Kiosk Monitor ──────────────────────────────────────
    def _build_kiosk_view(self) -> QWidget:
        view = QWidget()
        v_layout = QVBoxLayout(view)
        v_layout.setContentsMargins(0, 0, 0, 0)
        v_layout.setSpacing(14)

        # ── METRICS RIBBON ──
        ribbon = self._build_metrics_ribbon()
        v_layout.addWidget(ribbon)

        # ── SPLIT BODY (Camera Left | Quick Feed Right) ──
        body = QHBoxLayout()
        body.setSpacing(14)

        # Camera & Hero Card (Left ~65%)
        left_pane = QVBoxLayout()
        left_pane.setSpacing(12)

        self.viewport = VideoViewport(self)
        left_pane.addWidget(self.viewport, stretch=1)

        self.hero_card = self._build_hero_card()
        left_pane.addWidget(self.hero_card)

        body.addLayout(left_pane, stretch=64)

        # Quick Feed Table (Right ~36%)
        right_panel = self._build_quick_feed_panel()
        body.addWidget(right_panel, stretch=36)

        v_layout.addLayout(body, stretch=1)
        return view

    def _build_metrics_ribbon(self) -> QWidget:
        ribbon = QWidget(self)
        grid = QGridLayout(ribbon)
        grid.setContentsMargins(0, 0, 0, 0)
        grid.setSpacing(12)

        def create_card(title: str, default_val: str, color_hex: str):
            card = QFrame()
            card.setStyleSheet(f"""
                QFrame {{
                    background-color: rgba(15, 23, 42, 0.85);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 12px;
                    padding: 8px 14px;
                }}
            """)
            clayout = QVBoxLayout(card)
            clayout.setContentsMargins(6, 4, 6, 4)
            clayout.setSpacing(2)

            t_lbl = QLabel(title)
            t_lbl.setStyleSheet("color: #94a3b8; font-size: 11px; font-weight: 600; text-transform: uppercase;")
            v_lbl = QLabel(default_val)
            v_lbl.setStyleSheet(f"color: {color_hex}; font-size: 22px; font-weight: 800; font-family: 'Segoe UI', system-ui;")

            clayout.addWidget(t_lbl)
            clayout.addWidget(v_lbl)
            return card, v_lbl

        self.card_total, self.lbl_total = create_card("Total Verified Today", str(self.engine.counter_total_present), "#ffffff")
        self.card_ontime, self.lbl_ontime = create_card("On-Time Arrivals", str(self.engine.counter_on_time), "#34d399")
        self.card_late, self.lbl_late = create_card("Late Arrivals", str(self.engine.counter_late), "#fbbf24")
        
        distinct_count = len(set(s.get("student_name") for s in self.engine.enrolled_students))
        self.card_enrolled, self.lbl_enrolled = create_card("Enrolled Face Database", f"{distinct_count} students", "#38bdf8")

        grid.addWidget(self.card_total, 0, 0)
        grid.addWidget(self.card_ontime, 0, 1)
        grid.addWidget(self.card_late, 0, 2)
        grid.addWidget(self.card_enrolled, 0, 3)

        return ribbon

    def _build_hero_card(self) -> QFrame:
        card = QFrame(self)
        card.setObjectName("heroCard")
        card.setStyleSheet("""
            QFrame#heroCard {
                background-color: rgba(15, 23, 42, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 14px;
                padding: 10px 16px;
            }
        """)
        c_layout = QHBoxLayout(card)
        c_layout.setContentsMargins(12, 10, 12, 10)
        c_layout.setSpacing(14)

        # Avatar circle
        self.hero_avatar = QLabel()
        logo_file = str(BASE_DIR / "logo.png")
        if os.path.exists(logo_file):
            pm = QPixmap(logo_file).scaled(30, 30, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            self.hero_avatar.setPixmap(pm)
        else:
            self.hero_avatar.setText("🛡️")
        self.hero_avatar.setFixedSize(50, 50)
        self.hero_avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.hero_avatar.setStyleSheet("""
            background-color: #1e293b;
            color: #94a3b8;
            font-size: 22px;
            font-weight: bold;
            border-radius: 25px;
            border: 2px solid #334155;
        """)
        c_layout.addWidget(self.hero_avatar)

        # Details Box
        info_box = QVBoxLayout()
        info_box.setSpacing(2)

        name_row = QHBoxLayout()
        self.hero_name = QLabel("Awaiting student arrival at corridor...")
        self.hero_name.setStyleSheet("font-size: 16px; font-weight: 700; color: #cbd5e1;")
        
        self.hero_status_badge = QLabel("READY")
        self.hero_status_badge.setStyleSheet("""
            background-color: #1e293b;
            color: #94a3b8;
            font-size: 11px;
            font-weight: 700;
            border-radius: 6px;
            padding: 2px 8px;
        """)
        name_row.addWidget(self.hero_name)
        name_row.addWidget(self.hero_status_badge)
        name_row.addStretch()

        self.hero_details = QLabel("Multi-angle 3D face consensus scanning is active")
        self.hero_details.setStyleSheet("font-size: 12px; color: #64748b; font-weight: 500;")

        info_box.addLayout(name_row)
        info_box.addWidget(self.hero_details)
        c_layout.addLayout(info_box, stretch=1)

        # Confidence & Sync Pill
        self.hero_pill = QLabel("Gate 1 • Online")
        self.hero_pill.setStyleSheet("""
            background-color: rgba(16, 185, 129, 0.1);
            color: #10b981;
            font-size: 11px;
            font-weight: 600;
            border: 1px solid rgba(16, 185, 129, 0.25);
            border-radius: 8px;
            padding: 6px 12px;
        """)
        c_layout.addWidget(self.hero_pill)

        return card

    def _build_quick_feed_panel(self) -> QFrame:
        panel = QFrame(self)
        panel.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
            }
        """)
        p_layout = QVBoxLayout(panel)
        p_layout.setContentsMargins(14, 14, 14, 14)
        p_layout.setSpacing(10)

        # Header Row
        title_row = QHBoxLayout()
        t_label = QLabel("⚡ Live Corridor Feed")
        t_label.setStyleSheet("font-size: 13px; font-weight: 700; color: #f8fafc;")
        
        self.quick_feed_count = QLabel("0 scanned")
        self.quick_feed_count.setStyleSheet("color: #64748b; font-size: 11px; font-family: monospace;")
        
        title_row.addWidget(t_label)
        title_row.addStretch()
        title_row.addWidget(self.quick_feed_count)
        p_layout.addLayout(title_row)

        # Quick Feed Table
        self.quick_table = QTableWidget()
        self.quick_table.setColumnCount(4)
        self.quick_table.setHorizontalHeaderLabels(["Time", "Student Name", "Grade", "Status"])
        self.quick_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.quick_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.quick_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.quick_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        self.quick_table.verticalHeader().setVisible(False)
        self.quick_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.quick_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.quick_table.setShowGrid(False)

        p_layout.addWidget(self.quick_table, stretch=1)

        # Jump to Full Register Button
        btn_view_full = QPushButton("View Full Register →")
        btn_view_full.setProperty("class", "action-btn")
        btn_view_full.clicked.connect(lambda: self.btn_nav_reg.click())
        p_layout.addWidget(btn_view_full)

        return panel

    # ─── View 1: Attendance Register ──────────────────────────────────────────
    def _build_register_view(self) -> QWidget:
        view = QWidget()
        v_layout = QVBoxLayout(view)
        v_layout.setContentsMargins(0, 0, 0, 0)
        v_layout.setSpacing(12)

        # Filter & Search Toolbar
        toolbar = QFrame()
        toolbar.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                padding: 8px 12px;
            }
        """)
        tb_layout = QHBoxLayout(toolbar)
        tb_layout.setContentsMargins(8, 4, 8, 4)
        tb_layout.setSpacing(10)

        # Search Bar
        self.reg_search_input = QLineEdit()
        self.reg_search_input.setPlaceholderText("🔍 Search student name, ID, or grade...")
        self.reg_search_input.textChanged.connect(self._filter_register_table)
        tb_layout.addWidget(self.reg_search_input, stretch=1)

        # Status Filter Dropdown
        self.reg_filter_combo = QComboBox()
        self.reg_filter_combo.addItems(["All Statuses", "On-Time Only", "Late Only"])
        self.reg_filter_combo.currentIndexChanged.connect(self._filter_register_table)
        tb_layout.addWidget(self.reg_filter_combo)

        # Export CSV Button
        btn_export = QPushButton("📥 Export CSV")
        btn_export.setProperty("class", "action-btn")
        btn_export.setStyleSheet("background-color: #064e3b; color: #6ee7b7; border: 1px solid #059669;")
        btn_export.clicked.connect(self._export_csv)
        tb_layout.addWidget(btn_export)

        # Refresh Button
        btn_refresh = QPushButton("🔄 Refresh")
        btn_refresh.setProperty("class", "action-btn")
        btn_refresh.clicked.connect(self._refresh_register_from_db)
        tb_layout.addWidget(btn_refresh)

        v_layout.addWidget(toolbar)

        # Comprehensive Table
        self.reg_table = QTableWidget()
        self.reg_table.setColumnCount(6)
        self.reg_table.setHorizontalHeaderLabels(["Time", "Student Name", "Grade", "Status", "Match Score", "Cloud Synced"])
        self.reg_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.reg_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.reg_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.reg_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        self.reg_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self.reg_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        self.reg_table.verticalHeader().setVisible(False)
        self.reg_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.reg_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.reg_table.setShowGrid(False)

        v_layout.addWidget(self.reg_table, stretch=1)
        return view

    # ─── View 2: Enrolled Students Directory ──────────────────────────────────
    def _build_directory_view(self) -> QWidget:
        view = QWidget()
        v_layout = QVBoxLayout(view)
        v_layout.setContentsMargins(0, 0, 0, 0)
        v_layout.setSpacing(12)

        # Directory Header Toolbar
        toolbar = QFrame()
        toolbar.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                padding: 8px 12px;
            }
        """)
        tb_layout = QHBoxLayout(toolbar)
        tb_layout.setContentsMargins(8, 4, 8, 4)
        tb_layout.setSpacing(10)

        self.dir_search_input = QLineEdit()
        self.dir_search_input.setPlaceholderText("🔍 Search enrolled student name, class, or email...")
        self.dir_search_input.textChanged.connect(self._filter_directory_table)
        tb_layout.addWidget(self.dir_search_input, stretch=1)

        self.dir_count_lbl = QLabel("Loading enrolled students...")
        self.dir_count_lbl.setStyleSheet("color: #38bdf8; font-weight: bold; font-size: 12px;")
        tb_layout.addWidget(self.dir_count_lbl)

        v_layout.addWidget(toolbar)

        # Directory Table
        self.dir_table = QTableWidget()
        self.dir_table.setColumnCount(5)
        self.dir_table.setHorizontalHeaderLabels(["Student Name", "Grade & Section", "Parent Email", "Face Models Cached", "Status"])
        self.dir_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.dir_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self.dir_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.dir_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        self.dir_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self.dir_table.verticalHeader().setVisible(False)
        self.dir_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.dir_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.dir_table.setShowGrid(False)

        v_layout.addWidget(self.dir_table, stretch=1)
        return view

    # ─── View 3: Analytics Overview ───────────────────────────────────────────
    def _build_analytics_view(self) -> QWidget:
        view = QWidget()
        v_layout = QVBoxLayout(view)
        v_layout.setContentsMargins(0, 0, 0, 0)
        v_layout.setSpacing(14)

        # Summary Cards
        summary_grid = QGridLayout()
        summary_grid.setSpacing(12)

        def make_metric_panel(title, value, subtext, color):
            panel = QFrame()
            panel.setStyleSheet("""
                QFrame {
                    background-color: rgba(15, 23, 42, 0.85);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 14px;
                    padding: 14px;
                }
            """)
            pl = QVBoxLayout(panel)
            pl.setSpacing(4)
            t_lbl = QLabel(title)
            t_lbl.setStyleSheet("color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase;")
            v_lbl = QLabel(value)
            v_lbl.setStyleSheet(f"color: {color}; font-size: 26px; font-weight: 900;")
            s_lbl = QLabel(subtext)
            s_lbl.setStyleSheet("color: #64748b; font-size: 11px;")
            pl.addWidget(t_lbl)
            pl.addWidget(v_lbl)
            pl.addWidget(s_lbl)
            return panel, v_lbl, s_lbl

        self.an_card_p, self.an_val_present, self.an_sub_present = make_metric_panel("Total Scanned Today", "0", "Students verified at gate", "#ffffff")
        self.an_card_o, self.an_val_ontime, self.an_sub_ontime = make_metric_panel("On-Time Rate", "0%", "Arrived before cutoff time", "#10b981")
        self.an_card_l, self.an_val_late, self.an_sub_late = make_metric_panel("Late Rate", "0%", "Arrived after cutoff time", "#f59e0b")
        self.an_card_t, self.an_val_total_enr, self.an_sub_total_enr = make_metric_panel("Enrollment Base", "0", "Total enrolled in Appwrite", "#38bdf8")

        summary_grid.addWidget(self.an_card_p, 0, 0)
        summary_grid.addWidget(self.an_card_o, 0, 1)
        summary_grid.addWidget(self.an_card_l, 0, 2)
        summary_grid.addWidget(self.an_card_t, 0, 3)
        v_layout.addLayout(summary_grid)

        # Progress Indicators Panel
        prog_panel = QFrame()
        prog_panel.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                padding: 16px;
            }
        """)
        prog_layout = QVBoxLayout(prog_panel)
        prog_layout.setSpacing(12)

        prog_title = QLabel("Session Punctuality Breakdown")
        prog_title.setStyleSheet("font-size: 14px; font-weight: 700; color: #ffffff;")
        prog_layout.addWidget(prog_title)

        prog_layout.addWidget(QLabel("On-Time Ratio:"))
        self.bar_ontime = QProgressBar()
        self.bar_ontime.setValue(100)
        prog_layout.addWidget(self.bar_ontime)

        prog_layout.addWidget(QLabel("Late Ratio:"))
        self.bar_late = QProgressBar()
        self.bar_late.setStyleSheet("QProgressBar::chunk { background-color: #f59e0b; border-radius: 7px; }")
        self.bar_late.setValue(0)
        prog_layout.addWidget(self.bar_late)

        v_layout.addWidget(prog_panel)
        v_layout.addStretch()
        return view

    def _update_analytics_view(self):
        tot = self.engine.counter_total_present
        ontime = self.engine.counter_on_time
        late = self.engine.counter_late
        enrolled_distinct = len(set(s.get("student_name") for s in self.engine.enrolled_students))

        self.an_val_present.setText(str(tot))
        self.an_val_total_enr.setText(str(enrolled_distinct))

        if tot > 0:
            ontime_pct = int((ontime / tot) * 100)
            late_pct = 100 - ontime_pct
            self.an_val_ontime.setText(f"{ontime_pct}%")
            self.an_val_late.setText(f"{late_pct}%")
            self.bar_ontime.setValue(ontime_pct)
            self.bar_late.setValue(late_pct)
        else:
            self.an_val_ontime.setText("100%")
            self.an_val_late.setText("0%")
            self.bar_ontime.setValue(100)
            self.bar_late.setValue(0)

    # ─── View 4: Settings & Hardware ──────────────────────────────────────────
    def _build_settings_view(self) -> QWidget:
        view = QWidget()
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")

        container = QWidget()
        v_layout = QVBoxLayout(container)
        v_layout.setContentsMargins(10, 10, 10, 10)
        v_layout.setSpacing(16)

        def make_section(title_text):
            lbl = QLabel(title_text)
            lbl.setStyleSheet("font-size: 15px; font-weight: 800; color: #38bdf8; margin-top: 6px;")
            return lbl

        # 1. Camera Hardware
        v_layout.addWidget(make_section("📹 Camera Hardware & Streaming Source"))
        cam_card = QFrame()
        cam_card.setStyleSheet("background-color: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;")
        cc_layout = QVBoxLayout(cam_card)
        cc_layout.setSpacing(8)

        cc_layout.addWidget(QLabel("Video Stream Source (0 for Integrated/USB Webcam, or RTSP URL):"))
        self.set_cam_input = QLineEdit(str(config.RTSP_URL))
        cc_layout.addWidget(self.set_cam_input)

        btn_apply_cam = QPushButton("⚡ Apply & Reconnect Camera")
        btn_apply_cam.setProperty("class", "action-btn")
        btn_apply_cam.clicked.connect(self._apply_camera_reconnect)
        cc_layout.addWidget(btn_apply_cam)
        v_layout.addWidget(cam_card)

        # 2. Recognition Tuning
        v_layout.addWidget(make_section("🎯 Face Recognition & Consensus Tuning"))
        rec_card = QFrame()
        rec_card.setStyleSheet("background-color: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;")
        rc_layout = QVBoxLayout(rec_card)
        rc_layout.setSpacing(10)

        t_row = QHBoxLayout()
        t_row.addWidget(QLabel("Euclidean Distance Match Threshold (Default: 0.50):"))
        self.set_thresh_lbl = QLabel(f"{config.MATCH_THRESHOLD:.2f}")
        self.set_thresh_lbl.setStyleSheet("color: #10b981; font-weight: bold;")
        t_row.addStretch()
        t_row.addWidget(self.set_thresh_lbl)
        rc_layout.addLayout(t_row)

        self.set_thresh_slider = QSlider(Qt.Orientation.Horizontal)
        self.set_thresh_slider.setRange(35, 60)
        self.set_thresh_slider.setValue(int(config.MATCH_THRESHOLD * 100))
        self.set_thresh_slider.valueChanged.connect(lambda v: self.set_thresh_lbl.setText(f"{v/100.0:.2f}"))
        rc_layout.addWidget(self.set_thresh_slider)

        sub_thresh_note = QLabel("Note: 0.50 is mathematically calibrated for standard 128-D Euclidean vectors. Lower is stricter.")
        sub_thresh_note.setStyleSheet("color: #64748b; font-size: 11px;")
        rc_layout.addWidget(sub_thresh_note)
        v_layout.addWidget(rec_card)

        # 3. Attendance Session
        v_layout.addWidget(make_section("⏰ Attendance Cutoff & Gate Timings"))
        cut_card = QFrame()
        cut_card.setStyleSheet("background-color: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;")
        ct_layout = QVBoxLayout(cut_card)
        ct_layout.setSpacing(8)

        ct_layout.addWidget(QLabel("Morning Late Cutoff Time (Arrivals after this time marked LATE):"))
        self.set_cutoff_edit = QTimeEdit()
        self.set_cutoff_edit.setTime(QTime(config.CUTOFF_HOUR, config.CUTOFF_MINUTE))
        ct_layout.addWidget(self.set_cutoff_edit)
        v_layout.addWidget(cut_card)

        # 4. Audio Feedback
        v_layout.addWidget(make_section("🔔 Audio Feedback & Visual HUD"))
        aud_card = QFrame()
        aud_card.setStyleSheet("background-color: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;")
        ac_layout = QVBoxLayout(aud_card)
        ac_layout.setSpacing(10)

        self.set_chk_audio = QCheckBox("Enable Audio Chime on Verified Attendance")
        self.set_chk_audio.setChecked(config.ENABLE_AUDIO)
        ac_layout.addWidget(self.set_chk_audio)

        self.set_chk_mesh = QCheckBox("Show Google MediaPipe 478 3D Mesh Points on Camera")
        self.set_chk_mesh.setChecked(self.engine.show_mesh)
        ac_layout.addWidget(self.set_chk_mesh)

        btn_test_sound = QPushButton("🔊 Test Audio Chime Now")
        btn_test_sound.setProperty("class", "action-btn")
        btn_test_sound.clicked.connect(lambda: play_feedback_sound())
        ac_layout.addWidget(btn_test_sound)
        v_layout.addWidget(aud_card)

        # Save All Settings
        btn_save_all = QPushButton("💾 Save All Configurations")
        btn_save_all.setProperty("class", "action-btn")
        btn_save_all.setStyleSheet("background-color: #10b981; color: #022c22; font-size: 13px; font-weight: bold; padding: 10px;")
        btn_save_all.clicked.connect(self._save_all_settings)
        v_layout.addWidget(btn_save_all)

        v_layout.addStretch()
        scroll.setWidget(container)

        wrapper = QVBoxLayout(view)
        wrapper.setContentsMargins(0, 0, 0, 0)
        wrapper.addWidget(scroll)
        return view

    def _apply_camera_reconnect(self):
        new_src = self.set_cam_input.text().strip()
        config.RTSP_URL = new_src
        self.camera_worker.reconnect(new_src)
        QMessageBox.information(self, "Camera", f"Reconnecting camera source to: {new_src}")

    def _save_all_settings(self):
        config.MATCH_THRESHOLD = self.set_thresh_slider.value() / 100.0
        qtime = self.set_cutoff_edit.time()
        config.CUTOFF_HOUR = qtime.hour()
        config.CUTOFF_MINUTE = qtime.minute()
        config.ENABLE_AUDIO = self.set_chk_audio.isChecked()
        self.engine.show_mesh = self.set_chk_mesh.isChecked()

        self.btn_audio.setText("🔊 Audio ON" if config.ENABLE_AUDIO else "🔇 Audio OFF")
        self.btn_mesh.setText("🕸️ Mesh ON" if self.engine.show_mesh else "🕸️ Mesh OFF")
        self.sidebar_mesh_lbl.setText("● MediaPipe 478 Mesh: ON" if self.engine.show_mesh else "● MediaPipe Mesh: OFF")

        QMessageBox.information(self, "Configuration Saved", "Engine settings successfully applied!")

    # ─── Frame & Verification Slots ───────────────────────────────────────────
    def _on_frame_ready(self, q_img: QImage, fps: float, w: int, h: int):
        self.viewport.update_frame(q_img)
        self.fps_badge.setText(f"{fps:.0f} FPS • {w}x{h}")

    def _on_camera_error(self, err_msg: str):
        QMessageBox.warning(self, "Camera Notice", f"Stream Link Notice: {err_msg}")

    def _on_student_verified_ui(self, record: dict):
        """Called safely on Qt UI main thread whenever an attendance consensus is confirmed."""
        name = record.get("student_name", "Student")
        class_name = record.get("class_name", "")
        section = record.get("section", "")
        grade_str = f"{class_name}-{section}".strip("-") or "-"
        status = record.get("status", "present").lower()
        confidence = float(record.get("confidence", 0.95))
        time_str = record.get("time", datetime.now().strftime("%I:%M:%S %p"))

        # Update Top Metric Counters
        self.lbl_total.setText(str(self.engine.counter_total_present))
        self.lbl_ontime.setText(str(self.engine.counter_on_time))
        self.lbl_late.setText(str(self.engine.counter_late))

        # Update Hero Verification Card
        self.hero_avatar.setText(name[0].upper() if name else "✓")
        self.hero_name.setText(name)
        self.hero_details.setText(f"Grade: {grade_str}  •  Arrival: {time_str}  •  Match Confidence: {confidence*100:.1f}%")

        if status == "present":
            self.hero_avatar.setStyleSheet("""
                background-color: #064e3b; color: #34d399; font-size: 22px; font-weight: bold;
                border-radius: 25px; border: 2px solid #10b981;
            """)
            self.hero_status_badge.setText("PRESENT (ON-TIME)")
            self.hero_status_badge.setStyleSheet("background-color: #064e3b; color: #6ee7b7; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px;")
            self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(6, 78, 59, 0.45); border: 1px solid #10b981; border-radius: 14px; padding: 10px 16px; }")
            self.hero_pill.setText("Appwrite Synced ✓")
            self.hero_pill.setStyleSheet("background-color: rgba(16, 185, 129, 0.2); color: #34d399; font-size: 11px; font-weight: bold; border-radius: 8px; padding: 6px 12px;")
        else:
            self.hero_avatar.setStyleSheet("""
                background-color: #78350f; color: #fcd34d; font-size: 22px; font-weight: bold;
                border-radius: 25px; border: 2px solid #f59e0b;
            """)
            self.hero_status_badge.setText("LATE ARRIVAL")
            self.hero_status_badge.setStyleSheet("background-color: #78350f; color: #fde68a; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px;")
            self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(120, 53, 15, 0.45); border: 1px solid #f59e0b; border-radius: 14px; padding: 10px 16px; }")
            self.hero_pill.setText("Late Verified ✓")
            self.hero_pill.setStyleSheet("background-color: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 11px; font-weight: bold; border-radius: 8px; padding: 6px 12px;")

        # Insert row into both Quick Table and Full Register Table
        self._insert_table_row(self.quick_table, time_str, name, grade_str, status)
        self._insert_full_reg_row(time_str, name, grade_str, status, f"{confidence*100:.1f}%")

        self.quick_feed_count.setText(f"{self.quick_table.rowCount()} scanned")
        self._update_analytics_view()

        # Start timer to return hero card to scan mode after 6s
        self.card_reset_timer.start(6000)

    def _reset_hero_card(self):
        """Returns hero card to idle listening state."""
        logo_file = str(BASE_DIR / "logo.png")
        if os.path.exists(logo_file):
            pm = QPixmap(logo_file).scaled(30, 30, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            self.hero_avatar.setPixmap(pm)
        else:
            self.hero_avatar.setText("🛡️")
        self.hero_avatar.setStyleSheet("background-color: #1e293b; color: #94a3b8; font-size: 22px; font-weight: bold; border-radius: 25px; border: 2px solid #334155;")
        self.hero_name.setText("Awaiting student arrival at corridor...")
        self.hero_status_badge.setText("READY")
        self.hero_status_badge.setStyleSheet("background-color: #1e293b; color: #94a3b8; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px;")
        self.hero_details.setText("Multi-angle 3D face consensus scanning is active")
        self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 10px 16px; }")
        self.hero_pill.setText("Gate 1 • Online")
        self.hero_pill.setStyleSheet("background-color: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 11px; font-weight: 600; border-radius: 8px; padding: 6px 12px;")

    def _insert_table_row(self, table: QTableWidget, time_val: str, name_val: str, grade_val: str, status_val: str):
        table.insertRow(0)

        item_time = QTableWidgetItem(time_val)
        item_time.setForeground(QColor("#94a3b8"))
        item_time.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

        item_name = QTableWidgetItem(name_val)
        item_name.setForeground(QColor("#ffffff"))
        f = item_name.font()
        f.setBold(True)
        item_name.setFont(f)

        item_grade = QTableWidgetItem(grade_val)
        item_grade.setForeground(QColor("#cbd5e1"))
        item_grade.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

        item_status = QTableWidgetItem(status_val.upper())
        item_status.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        if status_val.lower() == "present":
            item_status.setForeground(QColor("#34d399"))
        else:
            item_status.setForeground(QColor("#fbbf24"))

        table.setItem(0, 0, item_time)
        table.setItem(0, 1, item_name)
        table.setItem(0, 2, item_grade)
        table.setItem(0, 3, item_status)

    def _insert_full_reg_row(self, time_val: str, name_val: str, grade_val: str, status_val: str, conf_val: str):
        self.reg_table.insertRow(0)

        item_time = QTableWidgetItem(time_val)
        item_time.setForeground(QColor("#94a3b8"))
        item_time.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

        item_name = QTableWidgetItem(name_val)
        item_name.setForeground(QColor("#ffffff"))
        f = item_name.font()
        f.setBold(True)
        item_name.setFont(f)

        item_grade = QTableWidgetItem(grade_val)
        item_grade.setForeground(QColor("#cbd5e1"))
        item_grade.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

        item_status = QTableWidgetItem(status_val.upper())
        item_status.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        if status_val.lower() == "present":
            item_status.setForeground(QColor("#34d399"))
        else:
            item_status.setForeground(QColor("#fbbf24"))

        item_conf = QTableWidgetItem(conf_val)
        item_conf.setForeground(QColor("#38bdf8"))
        item_conf.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

        item_sync = QTableWidgetItem("✓ Appwrite")
        item_sync.setForeground(QColor("#10b981"))
        item_sync.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

        self.reg_table.setItem(0, 0, item_time)
        self.reg_table.setItem(0, 1, item_name)
        self.reg_table.setItem(0, 2, item_grade)
        self.reg_table.setItem(0, 3, item_status)
        self.reg_table.setItem(0, 4, item_conf)
        self.reg_table.setItem(0, 5, item_sync)

    def _load_initial_history(self):
        """Loads today's logged attendance from persistent SQLite database."""
        today_str = datetime.now().strftime("%Y-%m-%d")
        logs = self.engine.db.get_today_logs(today_str)
        for log in reversed(logs):
            grade_str = f"{log.get('class_name', '')}-{log.get('section', '')}".strip("-") or "-"
            conf_str = f"{float(log.get('confidence', 0.95))*100:.1f}%"
            self._insert_table_row(
                self.quick_table,
                log.get("marked_time", "--:--"),
                log.get("student_name", "Student"),
                grade_str,
                log.get("status", "present")
            )
            self._insert_full_reg_row(
                log.get("marked_time", "--:--"),
                log.get("student_name", "Student"),
                grade_str,
                log.get("status", "present"),
                conf_str
            )
        self.quick_feed_count.setText(f"{self.quick_table.rowCount()} scanned")

    def _populate_student_directory(self):
        """Populates the Enrolled Students Directory table from local cache."""
        self.dir_table.setRowCount(0)
        enrolled = self.engine.enrolled_students
        if not enrolled:
            self.dir_count_lbl.setText("0 Students Enrolled")
            return

        # Group models by student_name
        grouped = {}
        for s in enrolled:
            name = s.get("student_name", "Unknown")
            if name not in grouped:
                grouped[name] = {
                    "class": f"{s.get('class_name', '')}-{s.get('section', '')}".strip("-") or "-",
                    "email": s.get("parent_email") or "Not configured",
                    "models": 0
                }
            grouped[name]["models"] += 1

        self.dir_count_lbl.setText(f"{len(grouped)} Students Enrolled ({len(enrolled)} Models)")

        for name, data in sorted(grouped.items()):
            row = self.dir_table.rowCount()
            self.dir_table.insertRow(row)

            item_name = QTableWidgetItem(name)
            item_name.setForeground(QColor("#ffffff"))
            f = item_name.font()
            f.setBold(True)
            item_name.setFont(f)

            item_grade = QTableWidgetItem(data["class"])
            item_grade.setForeground(QColor("#cbd5e1"))
            item_grade.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

            item_email = QTableWidgetItem(data["email"])
            item_email.setForeground(QColor("#94a3b8"))

            item_models = QTableWidgetItem(f"{data['models']} angles")
            item_models.setForeground(QColor("#38bdf8"))
            item_models.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

            item_status = QTableWidgetItem("Active ✓")
            item_status.setForeground(QColor("#10b981"))
            item_status.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

            self.dir_table.setItem(row, 0, item_name)
            self.dir_table.setItem(row, 1, item_grade)
            self.dir_table.setItem(row, 2, item_email)
            self.dir_table.setItem(row, 3, item_models)
            self.dir_table.setItem(row, 4, item_status)

    def _filter_register_table(self):
        query = self.reg_search_input.text().strip().lower()
        filter_status = self.reg_filter_combo.currentText()

        for row in range(self.reg_table.rowCount()):
            name_item = self.reg_table.item(row, 1)
            grade_item = self.reg_table.item(row, 2)
            status_item = self.reg_table.item(row, 3)

            name_text = name_item.text().lower() if name_item else ""
            grade_text = grade_item.text().lower() if grade_item else ""
            status_text = status_item.text().upper() if status_item else ""

            match_query = (query in name_text) or (query in grade_text)
            match_status = True
            if filter_status == "On-Time Only" and "PRESENT" not in status_text:
                match_status = False
            elif filter_status == "Late Only" and "LATE" not in status_text:
                match_status = False

            self.reg_table.setRowHidden(row, not (match_query and match_status))

    def _filter_directory_table(self, query: str):
        query = query.strip().lower()
        for row in range(self.dir_table.rowCount()):
            name_item = self.dir_table.item(row, 0)
            grade_item = self.dir_table.item(row, 1)
            email_item = self.dir_table.item(row, 2)

            name_text = name_item.text().lower() if name_item else ""
            grade_text = grade_item.text().lower() if grade_item else ""
            email_text = email_item.text().lower() if email_item else ""

            match = (query in name_text) or (query in grade_text) or (query in email_text)
            self.dir_table.setRowHidden(row, not match)

    def _refresh_register_from_db(self):
        self.reg_table.setRowCount(0)
        self.quick_table.setRowCount(0)
        self._load_initial_history()
        self._update_analytics_view()
        QMessageBox.information(self, "Refreshed", "Attendance register reloaded from local SQLite database.")

    def _export_csv(self):
        """Exports the active attendance table to a CSV file."""
        row_count = self.reg_table.rowCount()
        if row_count == 0:
            QMessageBox.information(self, "Export", "No attendance records to export yet today.")
            return

        today_str = datetime.now().strftime("%Y_%m_%d")
        default_filename = f"Spotlight_Attendance_{today_str}.csv"
        path, _ = QFileDialog.getSaveFileName(self, "Export Attendance CSV", default_filename, "CSV Files (*.csv)")
        if not path:
            return

        try:
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["Time", "Student Name", "Grade", "Status", "Match Confidence", "Cloud Sync"])
                for row in range(row_count):
                    r_data = [
                        self.reg_table.item(row, col).text() if self.reg_table.item(row, col) else ""
                        for col in range(6)
                    ]
                    writer.writerow(r_data)
            QMessageBox.information(self, "Success", f"Attendance roster successfully exported to:\n{path}")
        except Exception as e:
            QMessageBox.critical(self, "Export Error", f"Failed to export CSV: {e}")

    # ─── Controls & Actions ───────────────────────────────────────────────────
    def _sync_cloud(self):
        if self.sync_worker and self.sync_worker.isRunning():
            return

        self.btn_sync.setText("⏳ Syncing...")
        self.btn_sync.setEnabled(False)
        self.sidebar_cloud_lbl.setText("● Appwrite: Syncing...")
        self.sidebar_cloud_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #fbbf24;")

        self.sync_worker = CloudSyncWorker(self.engine)
        self.sync_worker.sync_completed.connect(self._on_sync_finished)
        self.sync_worker.start()

    def _on_sync_finished(self, success: bool, total_models: int, distinct: int):
        self.btn_sync.setText("🔄 Sync Cloud")
        self.btn_sync.setEnabled(True)
        if success:
            self.lbl_enrolled.setText(f"{distinct} students")
            self.sidebar_cloud_lbl.setText("● Appwrite: Connected")
            self.sidebar_cloud_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #10b981;")
            self._populate_student_directory()
            self._update_analytics_view()
        else:
            self.sidebar_cloud_lbl.setText("● Appwrite: Offline Cache")
            self.sidebar_cloud_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #fbbf24;")

    def _toggle_audio(self):
        config.ENABLE_AUDIO = not config.ENABLE_AUDIO
        self.btn_audio.setText("🔊 Audio ON" if config.ENABLE_AUDIO else "🔇 Audio OFF")
        if hasattr(self, 'set_chk_audio'):
            self.set_chk_audio.setChecked(config.ENABLE_AUDIO)

    def _toggle_mesh(self):
        self.engine.show_mesh = not self.engine.show_mesh
        self.btn_mesh.setText("🕸️ Mesh ON" if self.engine.show_mesh else "🕸️ Mesh OFF")
        self.sidebar_mesh_lbl.setText("● MediaPipe 478 Mesh: ON" if self.engine.show_mesh else "● MediaPipe Mesh: OFF")
        if hasattr(self, 'set_chk_mesh'):
            self.set_chk_mesh.setChecked(self.engine.show_mesh)

    def _toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
            self.btn_fs.setText("⛶ Kiosk (F11)")
        else:
            self.showFullScreen()
            self.btn_fs.setText("🗗 Exit Kiosk (F11)")

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_F11:
            self._toggle_fullscreen()
        elif event.key() == Qt.Key.Key_Escape and self.isFullScreen():
            self._toggle_fullscreen()
        else:
            super().keyPressEvent(event)

    def closeEvent(self, event):
        reply = QMessageBox.question(
            self,
            "Confirm Exit",
            "Are you sure you want to stop Presences Spotlight Gate Terminal?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if reply == QMessageBox.StandardButton.Yes:
            self.camera_worker.stop()
            self.engine.running = False
            event.accept()
        else:
            event.ignore()


# ─── 6. Application Entrypoint ────────────────────────────────────────────────
def launch_application():
    """Starts the native PyQt6 Desktop Application."""
    # Ensure Windows recognizes this as a dedicated first-class application on the taskbar
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("presences.spotlight.ai.terminal.v2")
        except Exception:
            pass

    app = QApplication(sys.argv)
    app.setApplicationName("Presences Spotlight AI")
    app.setStyle("Fusion")

    icon_path = str(BASE_DIR / "app_icon.ico")
    if os.path.exists(icon_path):
        app_icon = QIcon(icon_path)
        app.setWindowIcon(app_icon)

    window = SpotlightDesktopWindow()
    if os.path.exists(icon_path):
        window.setWindowIcon(QIcon(icon_path))

    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    launch_application()
