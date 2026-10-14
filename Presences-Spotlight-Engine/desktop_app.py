"""
Presences Spotlight AI — Dedicated School Gate Attendance Terminal
Google MediaPipe 478 3D Mesh Vision Pipeline + Appwrite Cloud Edge Terminal
Single-purpose, high-speed, installable school attendance marking engine.
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

# Suppress deprecation notices for clean enterprise console output
warnings.filterwarnings('ignore')

# PyQt6 Native Desktop GUI Components
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QTableWidget, QTableWidgetItem, QHeaderView, QLineEdit,
    QFileDialog, QDialog, QSlider, QTimeEdit, QCheckBox, QFrame, QScrollArea,
    QSizePolicy, QMessageBox, QAbstractItemView, QSpacerItem, QStackedWidget,
    QButtonGroup, QDialogButtonBox
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
    """Zero-lag QThread acquiring video frames for a camera channel and streaming rendered HUD to GUI."""
    frame_ready = pyqtSignal(int, QImage, float, int, int)  # cam_id, image, fps, width, height
    camera_error = pyqtSignal(int, str)  # cam_id, error_message

    def __init__(self, engine: SpotlightEngine, cam_id: int = 1, source: str = None, name: str = "", parent=None):
        super().__init__(parent)
        self.engine = engine
        self.cam_id = cam_id
        self.source = str(source) if source is not None else (config.CAMERA_1_SOURCE if cam_id == 1 else config.CAMERA_2_SOURCE)
        self.name = name or (config.CAMERA_1_NAME if cam_id == 1 else config.CAMERA_2_NAME)
        self.stream: Optional[RTSPVideoStream] = None
        self.running = True

    def run(self):
        try:
            self.stream = RTSPVideoStream(src=self.source, cam_id=self.cam_id, name=self.name).start()
        except Exception as e:
            self.camera_error.emit(self.cam_id, str(e))
            return

        # Ensure engine inference worker is active
        self.engine.start_worker()

        while self.running:
            if self.stream is None:
                self.msleep(30)
                continue

            grabbed, frame, fps = self.stream.read()
            if frame is None:
                self.msleep(15)
                continue

            h, w = frame.shape[:2]

            # Submit frame for background AI detection (non-blocking)
            if grabbed:
                self.engine.submit_frame(frame, cam_id=self.cam_id)

            # Render bounding boxes, name tags, and 3D mesh HUD overlay
            annotated_frame = self.engine.render_hud(frame, fps, cam_id=self.cam_id, cam_name=self.name)

            # Convert OpenCV BGR frame to Qt QImage
            rgb_frame = cv2.cvtColor(annotated_frame, cv2.COLOR_BGR2RGB)
            bytes_per_line = 3 * w
            q_image = QImage(rgb_frame.data, w, h, bytes_per_line, QImage.Format.Format_RGB888).copy()

            self.frame_ready.emit(self.cam_id, q_image, fps, w, h)
            self.msleep(15)  # Cap UI emission ~45-60 FPS for smooth rendering without CPU burn

    def reconnect(self, new_source: str, new_name: str = ""):
        self.source = str(new_source)
        if new_name:
            self.name = new_name
        if self.stream:
            self.stream.stop()
        try:
            self.stream = RTSPVideoStream(src=self.source, cam_id=self.cam_id, name=self.name).start()
        except Exception as e:
            self.camera_error.emit(self.cam_id, str(e))

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
    def __init__(self, cam_id: int = 1, title: str = "", parent=None):
        super().__init__(parent)
        self.cam_id = cam_id
        self.title = title or f"Camera {cam_id}"
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setStyleSheet("""
            QLabel {
                background-color: #030712;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
            }
        """)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.setMinimumSize(320, 180)
        self.current_pixmap: Optional[QPixmap] = None

        self.setText(f"Connecting {self.title}...\n(Google MediaPipe Vision Engine)")
        self.setStyleSheet("color: #64748b; font-size: 13px; font-weight: bold; background: #070b14; border-radius: 12px;")

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


# ─── 5. Modern Settings Dialog ────────────────────────────────────────────────
class SettingsDialog(QDialog):
    """Dedicated modal dialog for configuring school gate hardware and recognition parameters."""
    def __init__(self, main_window, parent=None):
        super().__init__(parent)
        self.main_window = main_window
        self.setWindowTitle("⚙️ School Terminal Configuration")
        self.resize(580, 560)
        self.setStyleSheet("""
            QDialog {
                background-color: #0b1120;
                color: #f8fafc;
            }
            QLabel {
                color: #e2e8f0;
                font-size: 12px;
            }
            QLineEdit, QTimeEdit, QSlider {
                background-color: #0f172a;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                color: #ffffff;
                padding: 8px;
                font-size: 12px;
            }
            QLineEdit:focus, QTimeEdit:focus {
                border: 1px solid #10b981;
            }
            QPushButton.action-btn {
                background-color: #1e293b;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                color: #ffffff;
                padding: 8px 14px;
                font-weight: 600;
                font-size: 12px;
            }
            QPushButton.action-btn:hover {
                background-color: #334155;
            }
            QPushButton.primary-btn {
                background-color: #10b981;
                border: none;
                border-radius: 8px;
                color: #022c22;
                padding: 10px 18px;
                font-weight: 700;
                font-size: 13px;
            }
            QPushButton.primary-btn:hover {
                background-color: #34d399;
            }
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(16)

        # Title
        hdr = QLabel("Presences Attendance Terminal Settings")
        hdr.setStyleSheet("font-size: 16px; font-weight: 800; color: #ffffff;")
        layout.addWidget(hdr)

        # 1. Gate / Terminal Name
        g_box = QVBoxLayout()
        g_box.setSpacing(4)
        g_box.addWidget(QLabel("School Terminal / Gate Label:"))
        self.edit_gate_name = QLineEdit(str(config.GATE_NAME))
        g_box.addWidget(self.edit_gate_name)
        layout.addLayout(g_box)

        # 2. Camera 1
        c1_box = QVBoxLayout()
        c1_box.setSpacing(4)
        c1_lbl = QLabel("🔹 Camera 1 (Primary Lane):")
        c1_lbl.setStyleSheet("color: #38bdf8; font-weight: 700;")
        c1_box.addWidget(c1_lbl)

        c1_row = QHBoxLayout()
        self.edit_cam1_name = QLineEdit(str(config.CAMERA_1_NAME))
        self.edit_cam1_name.setPlaceholderText("Lane 1 Name")
        self.edit_cam1_src = QLineEdit(str(config.CAMERA_1_SOURCE))
        self.edit_cam1_src.setPlaceholderText("0 or rtsp://...")
        btn_test_cam1 = QPushButton("⚡ Reconnect")
        btn_test_cam1.setProperty("class", "action-btn")
        btn_test_cam1.clicked.connect(self._test_cam1)
        c1_row.addWidget(self.edit_cam1_name, stretch=1)
        c1_row.addWidget(self.edit_cam1_src, stretch=2)
        c1_row.addWidget(btn_test_cam1)
        c1_box.addLayout(c1_row)
        layout.addLayout(c1_box)

        # 3. Camera 2
        c2_box = QVBoxLayout()
        c2_box.setSpacing(4)
        c2_lbl = QLabel("🔹 Camera 2 (Secondary Lane):")
        c2_lbl.setStyleSheet("color: #a78bfa; font-weight: 700;")
        c2_box.addWidget(c2_lbl)

        c2_row = QHBoxLayout()
        self.edit_cam2_name = QLineEdit(str(config.CAMERA_2_NAME))
        self.edit_cam2_name.setPlaceholderText("Lane 2 Name")
        self.edit_cam2_src = QLineEdit(str(config.CAMERA_2_SOURCE))
        self.edit_cam2_src.setPlaceholderText("1 or rtsp://...")
        btn_test_cam2 = QPushButton("⚡ Reconnect")
        btn_test_cam2.setProperty("class", "action-btn")
        btn_test_cam2.clicked.connect(self._test_cam2)
        c2_row.addWidget(self.edit_cam2_name, stretch=1)
        c2_row.addWidget(self.edit_cam2_src, stretch=2)
        c2_row.addWidget(btn_test_cam2)
        c2_box.addLayout(c2_row)
        layout.addLayout(c2_box)

        # Dual Camera Mode Toggle
        self.chk_dual = QCheckBox("Enable Simultaneous Dual-Camera Processing")
        self.chk_dual.setChecked(config.DUAL_CAMERA_MODE)
        self.chk_dual.setStyleSheet("font-weight: 600; color: #cbd5e1;")
        layout.addWidget(self.chk_dual)

        # 4. Deduplication Cooldown
        cd_box = QVBoxLayout()
        cd_box.setSpacing(4)
        cd_row = QHBoxLayout()
        cd_row.addWidget(QLabel("Cross-Camera Cooldown (Prevents duplicate marks):"))
        self.lbl_cooldown = QLabel(f"{config.CROSS_CAMERA_COOLDOWN_SEC}s")
        self.lbl_cooldown.setStyleSheet("color: #38bdf8; font-weight: bold;")
        cd_row.addStretch()
        cd_row.addWidget(self.lbl_cooldown)
        cd_box.addLayout(cd_row)

        self.slider_cooldown = QSlider(Qt.Orientation.Horizontal)
        self.slider_cooldown.setRange(10, 120)
        self.slider_cooldown.setValue(config.CROSS_CAMERA_COOLDOWN_SEC)
        self.slider_cooldown.valueChanged.connect(lambda v: self.lbl_cooldown.setText(f"{v}s"))
        cd_box.addWidget(self.slider_cooldown)
        layout.addLayout(cd_box)

        # 5. Late Cutoff Time
        time_row = QHBoxLayout()
        time_row.addWidget(QLabel("Morning Late Cutoff Time:"))
        self.edit_cutoff = QTimeEdit()
        self.edit_cutoff.setTime(QTime(config.CUTOFF_HOUR, config.CUTOFF_MINUTE))
        time_row.addStretch()
        time_row.addWidget(self.edit_cutoff)
        layout.addLayout(time_row)

        # 6. Smart Logistic Controls (Adaptive Illumination & Zero-False Safeguard)
        sl_box = QVBoxLayout()
        sl_box.setSpacing(6)
        sl_lbl = QLabel("🛡️ Smart Gate Logistic (100% Precision & Quality Engine):")
        sl_lbl.setStyleSheet("color: #34d399; font-weight: 700;")
        sl_box.addWidget(sl_lbl)

        self.chk_aie = QCheckBox("Adaptive Illumination Normalizer (CLAHE Backlight & Glare Compensation)")
        self.chk_aie.setChecked(config.ENABLE_ADAPTIVE_ILLUMINATION)
        self.chk_aie.setStyleSheet("font-weight: 600; color: #cbd5e1;")
        sl_box.addWidget(self.chk_aie)

        self.chk_zero_false = QCheckBox("Strict Zero-False Safeguard (Ambiguity Delta & Multi-Frame Consensus)")
        self.chk_zero_false.setChecked(config.STRICT_ZERO_FALSE_MODE)
        self.chk_zero_false.setStyleSheet("font-weight: 600; color: #cbd5e1;")
        sl_box.addWidget(self.chk_zero_false)

        cs_row = QHBoxLayout()
        cs_row.addWidget(QLabel("Consensus Frames Required (Walking Trajectory Agreement):"))
        self.lbl_consensus = QLabel(f"{config.CONSENSUS_FRAMES_REQUIRED} frames")
        self.lbl_consensus.setStyleSheet("color: #34d399; font-weight: bold;")
        cs_row.addStretch()
        cs_row.addWidget(self.lbl_consensus)
        sl_box.addLayout(cs_row)

        self.slider_consensus = QSlider(Qt.Orientation.Horizontal)
        self.slider_consensus.setRange(1, 4)
        self.slider_consensus.setValue(config.CONSENSUS_FRAMES_REQUIRED)
        self.slider_consensus.valueChanged.connect(lambda v: self.lbl_consensus.setText(f"{v} frames"))
        sl_box.addWidget(self.slider_consensus)
        layout.addLayout(sl_box)

        # 7. Audio Toggle & Test
        aud_row = QHBoxLayout()
        self.chk_sound = QCheckBox("Audio Confirmation Chime")
        self.chk_sound.setChecked(config.ENABLE_AUDIO)
        btn_test_sound = QPushButton("🔊 Test Chime")
        btn_test_sound.setProperty("class", "action-btn")
        btn_test_sound.clicked.connect(lambda: play_feedback_sound())
        aud_row.addWidget(self.chk_sound)
        aud_row.addStretch()
        aud_row.addWidget(btn_test_sound)
        layout.addLayout(aud_row)

        layout.addStretch()

        # Action Buttons
        btn_row = QHBoxLayout()
        btn_cancel = QPushButton("Cancel")
        btn_cancel.setProperty("class", "action-btn")
        btn_cancel.clicked.connect(self.reject)

        btn_save = QPushButton("💾 Save & Apply")
        btn_save.setProperty("class", "primary-btn")
        btn_save.clicked.connect(self._save_settings)

        btn_row.addStretch()
        btn_row.addWidget(btn_cancel)
        btn_row.addWidget(btn_save)
        layout.addLayout(btn_row)

    def _test_cam1(self):
        new_src = self.edit_cam1_src.text().strip()
        new_name = self.edit_cam1_name.text().strip() or "Lane 1"
        self.main_window._apply_cam1(new_src, new_name)
        QMessageBox.information(self, "Camera 1", f"Camera 1 reconnected to: {new_src} ({new_name})")

    def _test_cam2(self):
        new_src = self.edit_cam2_src.text().strip()
        new_name = self.edit_cam2_name.text().strip() or "Lane 2"
        self.main_window._apply_cam2(new_src, new_name)
        QMessageBox.information(self, "Camera 2", f"Camera 2 reconnected to: {new_src} ({new_name})")

    def _save_settings(self):
        config.GATE_NAME = self.edit_gate_name.text().strip() or config.GATE_NAME
        config.CAMERA_1_NAME = self.edit_cam1_name.text().strip() or "Lane 1"
        config.CAMERA_1_SOURCE = self.edit_cam1_src.text().strip() or "0"
        config.CAMERA_2_NAME = self.edit_cam2_name.text().strip() or "Lane 2"
        config.CAMERA_2_SOURCE = self.edit_cam2_src.text().strip() or "1"
        config.DUAL_CAMERA_MODE = self.chk_dual.isChecked()
        config.CROSS_CAMERA_COOLDOWN_SEC = self.slider_cooldown.value()
        config.ENABLE_AUDIO = self.chk_sound.isChecked()
        config.ENABLE_ADAPTIVE_ILLUMINATION = self.chk_aie.isChecked()
        config.STRICT_ZERO_FALSE_MODE = self.chk_zero_false.isChecked()
        config.CONSENSUS_FRAMES_REQUIRED = self.slider_consensus.value()

        qtime = self.edit_cutoff.time()
        config.CUTOFF_HOUR = qtime.hour()
        config.CUTOFF_MINUTE = qtime.minute()

        self.main_window._apply_cam1(config.CAMERA_1_SOURCE, config.CAMERA_1_NAME)
        self.main_window._apply_cam2(config.CAMERA_2_SOURCE, config.CAMERA_2_NAME)
        self.main_window.gate_title_lbl.setText(f"📍 {config.GATE_NAME}  •  Autonomous School Attendance Engine")
        self.main_window.btn_audio.setText("🔊 Audio ON" if config.ENABLE_AUDIO else "🔇 Audio OFF")
        self.main_window.btn_view_cam1.setText(f"📷 {config.CAMERA_1_NAME}")
        self.main_window.btn_view_cam2.setText(f"📷 {config.CAMERA_2_NAME}")
        if hasattr(self.main_window, 'logistic_badge'):
            status_txt = "● Zero-False (AIE ON)" if config.ENABLE_ADAPTIVE_ILLUMINATION else "● Zero-False Mode"
            self.main_window.logistic_badge.setText(status_txt)

        self.accept()
        QMessageBox.information(self, "Settings Saved", "Terminal hardware & Smart Logistic settings successfully applied!")


# ─── 6. Main Desktop Window ───────────────────────────────────────────────────
class SpotlightDesktopWindow(QMainWindow):
    """Enterprise Desktop Window for Presences Spotlight AI."""
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Presences Spotlight AI — School Attendance Terminal")
        self.resize(1360, 840)
        self.setMinimumSize(1080, 680)

        # Core Engine & Bridge
        self.engine = SpotlightEngine()
        self.bridge = AttendanceBridge()
        self.bridge.student_verified.connect(self._on_student_verified_ui)
        self.engine.attendance_callback = lambda rec: self.bridge.student_verified.emit(rec)

        # Background Workers (Dual Camera)
        self.fps1_last = 0.0
        self.fps2_last = 0.0

        self.camera1_worker = CameraWorker(self.engine, cam_id=1, source=config.CAMERA_1_SOURCE, name=config.CAMERA_1_NAME)
        self.camera1_worker.frame_ready.connect(self._on_frame_ready)
        self.camera1_worker.camera_error.connect(self._on_camera_error)
        self.camera1_worker.start()

        self.camera2_worker = None
        if config.DUAL_CAMERA_MODE:
            self.camera2_worker = CameraWorker(self.engine, cam_id=2, source=config.CAMERA_2_SOURCE, name=config.CAMERA_2_NAME)
            self.camera2_worker.frame_ready.connect(self._on_frame_ready)
            self.camera2_worker.camera_error.connect(self._on_camera_error)
            self.camera2_worker.start()

        self.sync_worker: Optional[CloudSyncWorker] = None

        # Build Clean Kiosk UI
        self._apply_global_styles()
        self._setup_ui()
        self._load_initial_history()

        # Real-time Header Clock Timer
        self.clock_timer = QTimer(self)
        self.clock_timer.timeout.connect(self._update_clock)
        self.clock_timer.start(1000)
        self._update_clock()

        # Timer to reset hero card after 6 seconds of inactivity
        self.card_reset_timer = QTimer(self)
        self.card_reset_timer.setSingleShot(True)
        self.card_reset_timer.timeout.connect(self._reset_hero_card)

        # Trigger initial background sync from Appwrite
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
            QPushButton.action-btn:checked {
                background-color: #0284c7;
                color: #ffffff;
                border: 1px solid #38bdf8;
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
                padding: 8px 10px;
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
        """)

    def _setup_ui(self):
        """Constructs the dedicated attendance kiosk interface."""
        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(16, 14, 16, 14)
        main_layout.setSpacing(12)

        # 1. Top Enterprise Header Bar
        top_bar = self._build_top_bar()
        main_layout.addWidget(top_bar)

        # 2. View Mode & Metrics Header Ribbon
        ribbon_bar = self._build_ribbon_bar()
        main_layout.addWidget(ribbon_bar)

        # 3. Central Dual Camera Viewports
        self.viewport_container = QWidget()
        self.viewport_layout = QHBoxLayout(self.viewport_container)
        self.viewport_layout.setContentsMargins(0, 0, 0, 0)
        self.viewport_layout.setSpacing(12)

        # Camera 1 Frame
        self.cam1_frame = QFrame()
        self.cam1_frame.setStyleSheet("background-color: #030712; border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 12px;")
        c1_layout = QVBoxLayout(self.cam1_frame)
        c1_layout.setContentsMargins(4, 4, 4, 4)
        c1_layout.setSpacing(0)
        self.viewport1 = VideoViewport(cam_id=1, title=config.CAMERA_1_NAME, parent=self)
        c1_layout.addWidget(self.viewport1)

        # Camera 2 Frame
        self.cam2_frame = QFrame()
        self.cam2_frame.setStyleSheet("background-color: #030712; border: 1px solid rgba(167, 139, 250, 0.25); border-radius: 12px;")
        c2_layout = QVBoxLayout(self.cam2_frame)
        c2_layout.setContentsMargins(4, 4, 4, 4)
        c2_layout.setSpacing(0)
        self.viewport2 = VideoViewport(cam_id=2, title=config.CAMERA_2_NAME, parent=self)
        c2_layout.addWidget(self.viewport2)

        self.viewport_layout.addWidget(self.cam1_frame, stretch=1)
        self.viewport_layout.addWidget(self.cam2_frame, stretch=1)
        main_layout.addWidget(self.viewport_container, stretch=65)

        # 4. Bottom Student Verification & Live Stream Ribbon (35%)
        bottom_row = QHBoxLayout()
        bottom_row.setSpacing(12)

        # Left: Hero Student Card
        self.hero_card = self._build_hero_card()
        bottom_row.addWidget(self.hero_card, stretch=55)

        # Right: Recent Attendance Table Feed
        self.feed_panel = self._build_feed_panel()
        bottom_row.addWidget(self.feed_panel, stretch=45)

        main_layout.addLayout(bottom_row, stretch=35)

    def _build_top_bar(self) -> QFrame:
        top_bar = QFrame(self)
        top_bar.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                padding: 6px 12px;
            }
        """)
        tb_layout = QHBoxLayout(top_bar)
        tb_layout.setContentsMargins(6, 4, 6, 4)
        tb_layout.setSpacing(10)

        # Brand Logo & Gate Label
        left_box = QHBoxLayout()
        left_box.setSpacing(10)
        logo_lbl = QLabel()
        logo_file = str(BASE_DIR / "logo.png")
        if os.path.exists(logo_file):
            pm = QPixmap(logo_file).scaled(28, 28, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            logo_lbl.setPixmap(pm)
        else:
            logo_lbl.setText("🛡️")
            logo_lbl.setStyleSheet("font-size: 20px;")
        left_box.addWidget(logo_lbl)

        title_box = QVBoxLayout()
        title_box.setSpacing(1)
        self.gate_title_lbl = QLabel(f"📍 {config.GATE_NAME}  •  Autonomous School Attendance Engine")
        self.gate_title_lbl.setStyleSheet("font-size: 13px; font-weight: 700; color: #ffffff;")
        
        self.clock_lbl = QLabel("Loading system clock...")
        self.clock_lbl.setStyleSheet("font-size: 11px; color: #94a3b8; font-weight: 500;")
        
        title_box.addWidget(self.gate_title_lbl)
        title_box.addWidget(self.clock_lbl)
        left_box.addLayout(title_box)
        tb_layout.addLayout(left_box)

        tb_layout.addStretch()

        # Status & Action Buttons
        actions_layout = QHBoxLayout()
        actions_layout.setSpacing(8)

        # Live FPS pill
        self.fps_badge = QLabel("Cam 1: -- FPS  |  Cam 2: -- FPS")
        self.fps_badge.setStyleSheet("""
            background-color: #0f172a;
            color: #10b981;
            font-family: 'JetBrains Mono', Consolas, monospace;
            font-weight: 700;
            font-size: 11px;
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 8px;
            padding: 5px 10px;
        """)
        actions_layout.addWidget(self.fps_badge)

        # Cloud Status Badge
        self.cloud_badge = QLabel("● Appwrite Connected")
        self.cloud_badge.setStyleSheet("""
            background-color: #0f172a;
            color: #38bdf8;
            font-weight: 700;
            font-size: 11px;
            border: 1px solid rgba(56, 189, 248, 0.3);
            border-radius: 8px;
            padding: 5px 10px;
        """)
        actions_layout.addWidget(self.cloud_badge)

        # Smart Logistic Status Badge
        self.logistic_badge = QLabel("● Zero-False (AIE ON)")
        self.logistic_badge.setStyleSheet("""
            background-color: #064e3b;
            color: #34d399;
            font-weight: 700;
            font-size: 11px;
            border: 1px solid rgba(52, 211, 153, 0.4);
            border-radius: 8px;
            padding: 5px 10px;
        """)
        actions_layout.addWidget(self.logistic_badge)

        # Sync Faces Button
        self.btn_sync = QPushButton("🔄 Sync Database")
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

        # Settings Modal Button
        self.btn_settings = QPushButton("⚙️ Settings")
        self.btn_settings.setProperty("class", "action-btn")
        self.btn_settings.clicked.connect(self._open_settings)
        actions_layout.addWidget(self.btn_settings)

        # Fullscreen Kiosk Mode
        self.btn_fs = QPushButton("⛶ Kiosk (F11)")
        self.btn_fs.setProperty("class", "action-btn")
        self.btn_fs.clicked.connect(self._toggle_fullscreen)
        actions_layout.addWidget(self.btn_fs)

        tb_layout.addLayout(actions_layout)
        return top_bar

    def _build_ribbon_bar(self) -> QWidget:
        ribbon = QWidget(self)
        r_layout = QHBoxLayout(ribbon)
        r_layout.setContentsMargins(0, 0, 0, 0)
        r_layout.setSpacing(10)

        # Camera View Mode Switcher
        mode_box = QHBoxLayout()
        mode_box.setSpacing(6)
        mode_lbl = QLabel("Display:")
        mode_lbl.setStyleSheet("font-size: 11px; font-weight: 700; color: #94a3b8;")
        mode_box.addWidget(mode_lbl)

        self.btn_view_dual = QPushButton("⊞ Dual View")
        self.btn_view_dual.setCheckable(True)
        self.btn_view_dual.setChecked(True)
        self.btn_view_dual.setProperty("class", "action-btn")
        self.btn_view_dual.clicked.connect(self._set_dual_view_mode)

        self.btn_view_cam1 = QPushButton(f"📷 {config.CAMERA_1_NAME}")
        self.btn_view_cam1.setCheckable(True)
        self.btn_view_cam1.setProperty("class", "action-btn")
        self.btn_view_cam1.clicked.connect(self._set_cam1_solo_mode)

        self.btn_view_cam2 = QPushButton(f"📷 {config.CAMERA_2_NAME}")
        self.btn_view_cam2.setCheckable(True)
        self.btn_view_cam2.setProperty("class", "action-btn")
        self.btn_view_cam2.clicked.connect(self._set_cam2_solo_mode)

        self.cam_mode_group = QButtonGroup(self)
        self.cam_mode_group.addButton(self.btn_view_dual)
        self.cam_mode_group.addButton(self.btn_view_cam1)
        self.cam_mode_group.addButton(self.btn_view_cam2)

        mode_box.addWidget(self.btn_view_dual)
        mode_box.addWidget(self.btn_view_cam1)
        mode_box.addWidget(self.btn_view_cam2)
        r_layout.addLayout(mode_box)

        r_layout.addStretch()

        # Compact KPIs Cards
        def make_mini_stat(title: str, val: str, color: str):
            f = QFrame()
            f.setStyleSheet("background-color: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 4px 10px;")
            fl = QHBoxLayout(f)
            fl.setContentsMargins(4, 2, 4, 2)
            fl.setSpacing(6)
            tl = QLabel(title)
            tl.setStyleSheet("font-size: 11px; color: #94a3b8; font-weight: 600;")
            vl = QLabel(val)
            vl.setStyleSheet(f"font-size: 13px; color: {color}; font-weight: 800; font-family: 'Segoe UI', system-ui;")
            fl.addWidget(tl)
            fl.addWidget(vl)
            return f, vl

        self.stat_present_frame, self.lbl_present = make_mini_stat("Present Today:", str(self.engine.counter_total_present), "#ffffff")
        self.stat_ontime_frame, self.lbl_ontime = make_mini_stat("On-Time:", str(self.engine.counter_on_time), "#34d399")
        self.stat_late_frame, self.lbl_late = make_mini_stat("Late:", str(self.engine.counter_late), "#fbbf24")
        self.stat_lane1_frame, self.lbl_lane1 = make_mini_stat("Lane 1:", str(self.engine.counter_lane1), "#38bdf8")
        self.stat_lane2_frame, self.lbl_lane2 = make_mini_stat("Lane 2:", str(self.engine.counter_lane2), "#a78bfa")

        r_layout.addWidget(self.stat_present_frame)
        r_layout.addWidget(self.stat_ontime_frame)
        r_layout.addWidget(self.stat_late_frame)
        r_layout.addWidget(self.stat_lane1_frame)
        r_layout.addWidget(self.stat_lane2_frame)

        return ribbon

    def _build_hero_card(self) -> QFrame:
        card = QFrame(self)
        card.setObjectName("heroCard")
        card.setStyleSheet("""
            QFrame#heroCard {
                background-color: rgba(15, 23, 42, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 14px;
                padding: 12px 18px;
            }
        """)
        c_layout = QHBoxLayout(card)
        c_layout.setContentsMargins(14, 12, 14, 12)
        c_layout.setSpacing(16)

        # Avatar circle
        self.hero_avatar = QLabel()
        logo_file = str(BASE_DIR / "logo.png")
        if os.path.exists(logo_file):
            pm = QPixmap(logo_file).scaled(34, 34, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            self.hero_avatar.setPixmap(pm)
        else:
            self.hero_avatar.setText("🛡️")
        self.hero_avatar.setFixedSize(54, 54)
        self.hero_avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.hero_avatar.setStyleSheet("""
            background-color: #1e293b;
            color: #94a3b8;
            font-size: 24px;
            font-weight: bold;
            border-radius: 27px;
            border: 2px solid #334155;
        """)
        c_layout.addWidget(self.hero_avatar)

        # Details Box
        info_box = QVBoxLayout()
        info_box.setSpacing(3)

        name_row = QHBoxLayout()
        self.hero_name = QLabel("Awaiting student arrival at gate...")
        self.hero_name.setStyleSheet("font-size: 17px; font-weight: 800; color: #ffffff;")
        
        self.hero_status_badge = QLabel("READY")
        self.hero_status_badge.setStyleSheet("""
            background-color: #1e293b;
            color: #94a3b8;
            font-size: 11px;
            font-weight: 700;
            border-radius: 6px;
            padding: 3px 8px;
        """)
        name_row.addWidget(self.hero_name)
        name_row.addWidget(self.hero_status_badge)
        name_row.addStretch()

        self.hero_details = QLabel("Dual-camera multi-angle face consensus scanning is active")
        self.hero_details.setStyleSheet("font-size: 12px; color: #94a3b8; font-weight: 500;")

        info_box.addLayout(name_row)
        info_box.addWidget(self.hero_details)
        c_layout.addLayout(info_box, stretch=1)

        # Verification Pill
        self.hero_pill = QLabel("Dual Gate • Online")
        self.hero_pill.setStyleSheet("""
            background-color: rgba(16, 185, 129, 0.1);
            color: #10b981;
            font-size: 11px;
            font-weight: 700;
            border: 1px solid rgba(16, 185, 129, 0.25);
            border-radius: 8px;
            padding: 6px 14px;
        """)
        c_layout.addWidget(self.hero_pill)

        return card

    def _build_feed_panel(self) -> QFrame:
        panel = QFrame(self)
        panel.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                padding: 10px;
            }
        """)
        p_layout = QVBoxLayout(panel)
        p_layout.setContentsMargins(10, 8, 10, 8)
        p_layout.setSpacing(6)

        # Header
        t_row = QHBoxLayout()
        t_lbl = QLabel("⚡ Live Gate Attendance Feed")
        t_lbl.setStyleSheet("font-size: 12px; font-weight: 700; color: #ffffff;")
        self.feed_count_lbl = QLabel("0 scanned")
        self.feed_count_lbl.setStyleSheet("color: #64748b; font-size: 11px; font-family: monospace;")
        t_row.addWidget(t_lbl)
        t_row.addStretch()
        t_row.addWidget(self.feed_count_lbl)
        p_layout.addLayout(t_row)

        # Feed Table
        self.feed_table = QTableWidget()
        self.feed_table.setColumnCount(5)
        self.feed_table.setHorizontalHeaderLabels(["Time", "Student Name", "Grade", "Status", "Lane"])
        self.feed_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.feed_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.feed_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.feed_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        self.feed_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self.feed_table.verticalHeader().setVisible(False)
        self.feed_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.feed_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.feed_table.setShowGrid(False)

        p_layout.addWidget(self.feed_table, stretch=1)
        return panel

    def _set_dual_view_mode(self):
        self.cam1_frame.show()
        self.cam2_frame.show()

    def _set_cam1_solo_mode(self):
        self.cam1_frame.show()
        self.cam2_frame.hide()

    def _set_cam2_solo_mode(self):
        self.cam1_frame.hide()
        self.cam2_frame.show()

    def _update_clock(self):
        now = datetime.now()
        self.clock_lbl.setText(now.strftime("%I:%M:%S %p   •   %A, %B %d, %Y"))

    # ─── Frame & Verification Slots ───────────────────────────────────────────
    def _on_frame_ready(self, cam_id: int, q_img: QImage, fps: float, w: int, h: int):
        if cam_id == 1:
            self.viewport1.update_frame(q_img)
            self.fps1_last = fps
        elif cam_id == 2:
            self.viewport2.update_frame(q_img)
            self.fps2_last = fps

        fps1_str = f"{self.fps1_last:.0f}" if self.fps1_last > 0 else "--"
        fps2_str = f"{self.fps2_last:.0f}" if self.fps2_last > 0 else "--"
        self.fps_badge.setText(f"Cam 1: {fps1_str} FPS  |  Cam 2: {fps2_str} FPS")

    def _on_camera_error(self, cam_id: int, err_msg: str):
        print(f"[Spotlight Camera {cam_id} Notice] {err_msg}")

    def _on_student_verified_ui(self, record: dict):
        """Called safely on Qt UI main thread whenever an attendance consensus is confirmed."""
        name = record.get("student_name", "Student")
        class_name = record.get("class_name", "")
        section = record.get("section", "")
        grade_str = f"{class_name}-{section}".strip("-") or "-"
        status = record.get("status", "present").lower()
        confidence = float(record.get("confidence", 0.95))
        time_str = record.get("time", datetime.now().strftime("%I:%M:%S %p"))
        lane_str = record.get("camera_lane") or (config.CAMERA_1_NAME if record.get("cam_id") == 1 else config.CAMERA_2_NAME)

        # Update Top Metric Counters
        self.lbl_present.setText(str(self.engine.counter_total_present))
        self.lbl_ontime.setText(str(self.engine.counter_on_time))
        self.lbl_late.setText(str(self.engine.counter_late))
        self.lbl_lane1.setText(str(self.engine.counter_lane1))
        self.lbl_lane2.setText(str(self.engine.counter_lane2))

        # Update Hero Verification Card
        self.hero_avatar.setText(name[0].upper() if name else "✓")
        self.hero_name.setText(name)
        self.hero_details.setText(f"Grade: {grade_str}  •  Arrival: {time_str}  •  {lane_str}  •  Match: {confidence*100:.1f}%")

        if status == "present":
            self.hero_avatar.setStyleSheet("""
                background-color: #064e3b; color: #34d399; font-size: 24px; font-weight: bold;
                border-radius: 27px; border: 2px solid #10b981;
            """)
            self.hero_status_badge.setText("PRESENT (ON-TIME)")
            self.hero_status_badge.setStyleSheet("background-color: #064e3b; color: #6ee7b7; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 3px 8px;")
            self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(6, 78, 59, 0.45); border: 1px solid #10b981; border-radius: 14px; padding: 12px 18px; }")
            self.hero_pill.setText(f"{lane_str} ✓")
            self.hero_pill.setStyleSheet("background-color: rgba(16, 185, 129, 0.2); color: #34d399; font-size: 11px; font-weight: bold; border-radius: 8px; padding: 6px 14px;")
        else:
            self.hero_avatar.setStyleSheet("""
                background-color: #78350f; color: #fcd34d; font-size: 24px; font-weight: bold;
                border-radius: 27px; border: 2px solid #f59e0b;
            """)
            self.hero_status_badge.setText("LATE ARRIVAL")
            self.hero_status_badge.setStyleSheet("background-color: #78350f; color: #fde68a; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 3px 8px;")
            self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(120, 53, 15, 0.45); border: 1px solid #f59e0b; border-radius: 14px; padding: 12px 18px; }")
            self.hero_pill.setText(f"{lane_str} (Late) ✓")
            self.hero_pill.setStyleSheet("background-color: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 11px; font-weight: bold; border-radius: 8px; padding: 6px 14px;")

        # Insert row into Feed Table
        self._insert_feed_row(time_str, name, grade_str, status, lane_str)
        self.feed_count_lbl.setText(f"{self.feed_table.rowCount()} scanned")

        # Reset hero card after 6s
        self.card_reset_timer.start(6000)

    def _reset_hero_card(self):
        """Returns hero card to idle listening state."""
        logo_file = str(BASE_DIR / "logo.png")
        if os.path.exists(logo_file):
            pm = QPixmap(logo_file).scaled(34, 34, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            self.hero_avatar.setPixmap(pm)
        else:
            self.hero_avatar.setText("🛡️")
        self.hero_avatar.setStyleSheet("background-color: #1e293b; color: #94a3b8; font-size: 24px; font-weight: bold; border-radius: 27px; border: 2px solid #334155;")
        self.hero_name.setText("Awaiting student arrival at gate...")
        self.hero_status_badge.setText("READY")
        self.hero_status_badge.setStyleSheet("background-color: #1e293b; color: #94a3b8; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 3px 8px;")
        self.hero_details.setText("Dual-camera multi-angle face consensus scanning is active")
        self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 12px 18px; }")
        self.hero_pill.setText("Dual Gate • Online")
        self.hero_pill.setStyleSheet("background-color: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 11px; font-weight: 700; border-radius: 8px; padding: 6px 14px;")

    def _insert_feed_row(self, time_val: str, name_val: str, grade_val: str, status_val: str, lane_val: str):
        self.feed_table.insertRow(0)

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

        item_lane = QTableWidgetItem(lane_val)
        item_lane.setForeground(QColor("#38bdf8"))
        item_lane.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

        self.feed_table.setItem(0, 0, item_time)
        self.feed_table.setItem(0, 1, item_name)
        self.feed_table.setItem(0, 2, item_grade)
        self.feed_table.setItem(0, 3, item_status)
        self.feed_table.setItem(0, 4, item_lane)

    def _load_initial_history(self):
        """Loads today's logged attendance from persistent SQLite database."""
        today_str = datetime.now().strftime("%Y-%m-%d")
        logs = self.engine.db.get_today_logs(today_str)
        for log in reversed(logs):
            grade_str = f"{log.get('class_name', '')}-{log.get('section', '')}".strip("-") or "-"
            lane_str = log.get("camera_lane", "Lane 1")
            self._insert_feed_row(
                log.get("marked_time", "--:--"),
                log.get("student_name", "Student"),
                grade_str,
                log.get("status", "present"),
                lane_str
            )
        self.feed_count_lbl.setText(f"{self.feed_table.rowCount()} scanned")

    def _apply_cam1(self, new_src: str, new_name: str = ""):
        config.CAMERA_1_SOURCE = new_src
        if new_name:
            config.CAMERA_1_NAME = new_name
        self.camera1_worker.reconnect(new_src, new_name)
        self.viewport1.title = new_name or config.CAMERA_1_NAME
        self.btn_view_cam1.setText(f"📷 {config.CAMERA_1_NAME}")

    def _apply_cam2(self, new_src: str, new_name: str = ""):
        config.CAMERA_2_SOURCE = new_src
        if new_name:
            config.CAMERA_2_NAME = new_name
        if self.camera2_worker:
            self.camera2_worker.reconnect(new_src, new_name)
        elif config.DUAL_CAMERA_MODE:
            self.camera2_worker = CameraWorker(self.engine, cam_id=2, source=new_src, name=new_name)
            self.camera2_worker.frame_ready.connect(self._on_frame_ready)
            self.camera2_worker.camera_error.connect(self._on_camera_error)
            self.camera2_worker.start()
        self.viewport2.title = new_name or config.CAMERA_2_NAME
        self.btn_view_cam2.setText(f"📷 {config.CAMERA_2_NAME}")

    def _open_settings(self):
        dlg = SettingsDialog(self, self)
        dlg.exec()

    def _sync_cloud(self):
        if self.sync_worker and self.sync_worker.isRunning():
            return
        self.btn_sync.setText("⏳ Syncing...")
        self.btn_sync.setEnabled(False)
        self.cloud_badge.setText("● Appwrite: Syncing...")
        self.cloud_badge.setStyleSheet("background-color: #0f172a; color: #fbbf24; font-weight: 700; font-size: 11px; border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 8px; padding: 5px 10px;")

        self.sync_worker = CloudSyncWorker(self.engine)
        self.sync_worker.sync_completed.connect(self._on_sync_finished)
        self.sync_worker.start()

    def _on_sync_finished(self, success: bool, total_models: int, distinct: int):
        self.btn_sync.setText("🔄 Sync Database")
        self.btn_sync.setEnabled(True)
        if success:
            self.cloud_badge.setText("● Appwrite Connected")
            self.cloud_badge.setStyleSheet("background-color: #0f172a; color: #10b981; font-weight: 700; font-size: 11px; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 5px 10px;")
        else:
            self.cloud_badge.setText("● Offline (Local Cache)")
            self.cloud_badge.setStyleSheet("background-color: #0f172a; color: #fbbf24; font-weight: 700; font-size: 11px; border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 8px; padding: 5px 10px;")

    def _toggle_audio(self):
        config.ENABLE_AUDIO = not config.ENABLE_AUDIO
        self.btn_audio.setText("🔊 Audio ON" if config.ENABLE_AUDIO else "🔇 Audio OFF")

    def _toggle_mesh(self):
        self.engine.show_mesh = not self.engine.show_mesh
        self.btn_mesh.setText("🕸️ Mesh ON" if self.engine.show_mesh else "🕸️ Mesh OFF")

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
        elif event.key() == ord('s') or event.key() == ord('S'):
            self._toggle_audio()
        elif event.key() == ord('m') or event.key() == ord('M'):
            self._toggle_mesh()
        elif event.key() == ord('r') or event.key() == ord('R'):
            self._sync_cloud()
        else:
            super().keyPressEvent(event)

    def closeEvent(self, event):
        reply = QMessageBox.question(
            self,
            "Confirm Exit",
            "Are you sure you want to stop Presences Attendance Terminal?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if reply == QMessageBox.StandardButton.Yes:
            if hasattr(self, 'camera1_worker') and self.camera1_worker:
                self.camera1_worker.stop()
            if hasattr(self, 'camera2_worker') and self.camera2_worker:
                self.camera2_worker.stop()
            self.engine.running = False
            event.accept()
        else:
            event.ignore()


# ─── 7. Application Entrypoint ────────────────────────────────────────────────
def launch_application():
    """Starts the native PyQt6 Desktop Application."""
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("presences.spotlight.ai.terminal.v2")
        except Exception:
            pass

    app = QApplication(sys.argv)
    app.setApplicationName("Presences Spotlight AI")
    app.setOrganizationName("Presences AI")

    icon_path = str(BASE_DIR / "app_icon.ico")
    if os.path.exists(icon_path):
        app.setWindowIcon(QIcon(icon_path))

    window = SpotlightDesktopWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    launch_application()
