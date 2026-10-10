"""
Presences Spotlight AI — Native Full-Stack Desktop PC Application
Google MediaPipe 478 3D Mesh Vision Pipeline + Appwrite Cloud Gate Terminal
"""

import os
import sys
import time
import json
import csv
import queue
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import cv2
import numpy as np

# PyQt6 Native Desktop GUI Components
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QTableWidget, QTableWidgetItem, QHeaderView, QLineEdit,
    QFileDialog, QDialog, QSlider, QTimeEdit, QCheckBox, QFrame, QScrollArea,
    QSizePolicy, QMessageBox, QAbstractItemView, QSpacerItem
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer, QSize, QTime, QObject
from PyQt6.QtGui import QImage, QPixmap, QFont, QColor, QIcon, QPainter, QPen, QBrush

import config
from spotlight_engine import SpotlightEngine, RTSPVideoStream

# Setup Base Path (Handles PyInstaller onefile temp directory extraction)
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
    """Zero-lag QThread continuously acquiring video frames and streaming rendered HUD to GUI."""
    frame_ready = pyqtSignal(QImage, float, int, int)  # image, fps, width, height
    camera_error = pyqtSignal(str)

    def __init__(self, engine: SpotlightEngine, parent=None):
        super().__init__(parent)
        self.engine = engine
        self.stream: Optional[RTSPVideoStream] = None
        self.running = True
        self.show_mesh = config.SHOW_LANDMARK_MESH

    def run(self):
        try:
            self.stream = RTSPVideoStream().start()
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
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 14px;
            }
        """)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.setMinimumSize(480, 270)
        self.current_pixmap: Optional[QPixmap] = None

        # Placeholder message
        self.setText("Starting Presences Spotlight Camera...\n(Google MediaPipe 478 3D Mesh Engine)")
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


# ─── 5. Settings Modal Dialog ─────────────────────────────────────────────────
class SettingsDialog(QDialog):
    """Full Configuration Editor for Camera Source, Thresholds, and Cutoff Times."""
    def __init__(self, engine: SpotlightEngine, parent=None):
        super().__init__(parent)
        self.engine = engine
        self.setWindowTitle("Spotlight Engine Settings")
        self.setFixedSize(480, 420)
        self.setStyleSheet("""
            QDialog {
                background-color: #0b1120;
                color: #f8fafc;
            }
            QLabel {
                color: #e2e8f0;
                font-size: 13px;
                font-weight: 500;
            }
            QLineEdit, QTimeEdit, QSlider {
                background-color: #1e293b;
                border: 1px solid #334155;
                border-radius: 8px;
                color: #f8fafc;
                padding: 6px 10px;
                font-size: 13px;
            }
            QLineEdit:focus, QTimeEdit:focus {
                border: 1px solid #10b981;
            }
            QPushButton {
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                padding: 8px 16px;
            }
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(16)

        # Title
        title = QLabel("⚙️ Terminal Engine Configuration")
        title.setStyleSheet("font-size: 16px; font-weight: 700; color: #38bdf8;")
        layout.addWidget(title)

        # Camera Source
        layout.addWidget(QLabel("Camera Device Index or RTSP Stream URL:"))
        self.camera_input = QLineEdit(str(config.RTSP_URL))
        self.camera_input.setPlaceholderText("0 for USB webcam or rtsp://admin:pass@ip:554/stream")
        layout.addWidget(self.camera_input)

        # Match Threshold
        thresh_layout = QHBoxLayout()
        thresh_label = QLabel("Match Euclidean Distance Threshold:")
        self.thresh_val_label = QLabel(f"{config.MATCH_THRESHOLD:.2f}")
        self.thresh_val_label.setStyleSheet("color: #10b981; font-weight: bold;")
        thresh_layout.addWidget(thresh_label)
        thresh_layout.addStretch()
        thresh_layout.addWidget(self.thresh_val_label)
        layout.addLayout(thresh_layout)

        self.thresh_slider = QSlider(Qt.Orientation.Horizontal)
        self.thresh_slider.setRange(35, 60)
        self.thresh_slider.setValue(int(config.MATCH_THRESHOLD * 100))
        self.thresh_slider.valueChanged.connect(self._on_thresh_changed)
        layout.addWidget(self.thresh_slider)

        # Cutoff Time
        layout.addWidget(QLabel("Morning Late Cutoff Time:"))
        self.cutoff_edit = QTimeEdit()
        self.cutoff_edit.setTime(QTime(config.CUTOFF_HOUR, config.CUTOFF_MINUTE))
        layout.addWidget(self.cutoff_edit)

        # Checkboxes
        self.chk_audio = QCheckBox("Enable Audio Chime on Verified Attendance")
        self.chk_audio.setChecked(config.ENABLE_AUDIO)
        self.chk_audio.setStyleSheet("color: #cbd5e1; font-size: 13px;")
        layout.addWidget(self.chk_audio)

        self.chk_mesh = QCheckBox("Show Google MediaPipe 478 3D Mesh Points")
        self.chk_mesh.setChecked(self.engine.show_mesh)
        self.chk_mesh.setStyleSheet("color: #cbd5e1; font-size: 13px;")
        layout.addWidget(self.chk_mesh)

        layout.addStretch()

        # Action Buttons
        btn_layout = QHBoxLayout()
        btn_cancel = QPushButton("Cancel")
        btn_cancel.setStyleSheet("background-color: #334155; color: #cbd5e1;")
        btn_cancel.clicked.connect(self.reject)

        btn_save = QPushButton("Save & Apply")
        btn_save.setStyleSheet("background-color: #10b981; color: #022c22;")
        btn_save.clicked.connect(self._save_settings)

        btn_layout.addWidget(btn_cancel)
        btn_layout.addWidget(btn_save)
        layout.addLayout(btn_layout)

    def _on_thresh_changed(self, val: int):
        f_val = val / 100.0
        self.thresh_val_label.setText(f"{f_val:.2f}")

    def _save_settings(self):
        config.RTSP_URL = self.camera_input.text().strip()
        config.MATCH_THRESHOLD = self.thresh_slider.value() / 100.0
        qtime = self.cutoff_edit.time()
        config.CUTOFF_HOUR = qtime.hour()
        config.CUTOFF_MINUTE = qtime.minute()
        config.ENABLE_AUDIO = self.chk_audio.isChecked()
        self.engine.show_mesh = self.chk_mesh.isChecked()
        self.accept()


# ─── 6. Main Desktop Window ───────────────────────────────────────────────────
class SpotlightDesktopWindow(QMainWindow):
    """Main Native Desktop Window for Presences Spotlight AI."""
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Presences Spotlight AI — Gate Terminal")
        self.resize(1380, 840)
        self.setMinimumSize(1080, 680)

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

        # Build Full Native Interface
        self._setup_ui()
        self._load_initial_history()

        # Timer to reset hero card after 6 seconds of inactivity
        self.card_reset_timer = QTimer(self)
        self.card_reset_timer.setSingleShot(True)
        self.card_reset_timer.timeout.connect(self._reset_hero_card)

    def _setup_ui(self):
        """Builds modern obsidian glassmorphism UI layout."""
        self.setStyleSheet("""
            QMainWindow {
                background-color: #070b14;
            }
            QWidget {
                color: #f8fafc;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            }
            QFrame.glass-panel {
                background-color: rgba(15, 23, 42, 0.75);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
            }
            QFrame.metric-card {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                padding: 10px;
            }
            QPushButton.action-btn {
                background-color: #1e293b;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                color: #e2e8f0;
                font-size: 12px;
                font-weight: 600;
                padding: 7px 14px;
            }
            QPushButton.action-btn:hover {
                background-color: #334155;
                color: #ffffff;
            }
            QPushButton.action-btn:pressed {
                background-color: #0f172a;
            }
            QLineEdit.search-box {
                background-color: #0f172a;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                color: #f8fafc;
                padding: 7px 12px;
                font-size: 12px;
            }
            QLineEdit.search-box:focus {
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
                padding: 8px 10px;
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
        """)

        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(18, 16, 18, 16)
        main_layout.setSpacing(14)

        # ── TOP HEADER ──
        header = self._build_header()
        main_layout.addWidget(header)

        # ── METRIC RIBBON CARDS ──
        metric_ribbon = self._build_metrics_ribbon()
        main_layout.addWidget(metric_ribbon)

        # ── SPLIT BODY (Camera Left | History Right) ──
        body_layout = QHBoxLayout()
        body_layout.setSpacing(16)

        # Left Column: Video Viewport & Hero Verification Card
        left_col = self._build_camera_column()
        body_layout.addWidget(left_col, stretch=62)

        # Right Column: Live Attendance Activity Roster
        right_col = self._build_roster_column()
        body_layout.addWidget(right_col, stretch=38)

        main_layout.addLayout(body_layout, stretch=1)

        # ── FOOTER ──
        footer = self._build_footer()
        main_layout.addWidget(footer)

    def _build_header(self) -> QFrame:
        header = QFrame(self)
        header.setProperty("class", "glass-panel")
        header.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 8px 16px;
            }
        """)
        h_layout = QHBoxLayout(header)
        h_layout.setContentsMargins(8, 6, 8, 6)

        # Logo & App Title
        brand_layout = QHBoxLayout()
        brand_icon = QLabel("🛡️")
        brand_icon.setStyleSheet("font-size: 24px;")
        brand_layout.addWidget(brand_icon)

        title_box = QVBoxLayout()
        title_box.setSpacing(2)
        title_label = QLabel("PRESENCES SPOTLIGHT AI")
        title_label.setStyleSheet("font-size: 16px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff;")
        
        sub_layout = QHBoxLayout()
        sub_layout.setSpacing(8)
        gate_badge = QLabel(f"📍 {config.GATE_NAME}")
        gate_badge.setStyleSheet("color: #94a3b8; font-size: 11px; font-weight: 500;")
        
        tag_vision = QLabel("Google MediaPipe 3D Mesh")
        tag_vision.setStyleSheet("background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700;")
        
        tag_cloud = QLabel("Appwrite Cloud Active")
        tag_cloud.setStyleSheet("background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700;")
        
        sub_layout.addWidget(gate_badge)
        sub_layout.addWidget(tag_vision)
        sub_layout.addWidget(tag_cloud)
        sub_layout.addStretch()

        title_box.addWidget(title_label)
        title_box.addLayout(sub_layout)
        brand_layout.addLayout(title_box)
        h_layout.addLayout(brand_layout)

        h_layout.addStretch()

        # Status & Controls
        controls_layout = QHBoxLayout()
        controls_layout.setSpacing(10)

        # FPS & Stream Pill
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
        controls_layout.addWidget(self.fps_badge)

        # Sync Appwrite Button
        self.btn_sync = QPushButton("🔄 Sync Cloud")
        self.btn_sync.setProperty("class", "action-btn")
        self.btn_sync.clicked.connect(self._sync_cloud)
        controls_layout.addWidget(self.btn_sync)

        # Audio Toggle
        self.btn_audio = QPushButton("🔊 Audio ON" if config.ENABLE_AUDIO else "🔇 Audio OFF")
        self.btn_audio.setProperty("class", "action-btn")
        self.btn_audio.clicked.connect(self._toggle_audio)
        controls_layout.addWidget(self.btn_audio)

        # Mesh Toggle
        self.btn_mesh = QPushButton("🕸️ Mesh ON" if self.engine.show_mesh else "🕸️ Mesh OFF")
        self.btn_mesh.setProperty("class", "action-btn")
        self.btn_mesh.clicked.connect(self._toggle_mesh)
        controls_layout.addWidget(self.btn_mesh)

        # Settings Button
        btn_settings = QPushButton("⚙️ Settings")
        btn_settings.setProperty("class", "action-btn")
        btn_settings.clicked.connect(self._open_settings)
        controls_layout.addWidget(btn_settings)

        # Fullscreen Kiosk Button
        self.btn_fs = QPushButton("⛶ Kiosk (F11)")
        self.btn_fs.setProperty("class", "action-btn")
        self.btn_fs.clicked.connect(self._toggle_fullscreen)
        controls_layout.addWidget(self.btn_fs)

        h_layout.addLayout(controls_layout)
        return header

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
        self.card_enrolled, self.lbl_enrolled = create_card("Enrolled in Cloud", f"{distinct_count} students", "#38bdf8")

        grid.addWidget(self.card_total, 0, 0)
        grid.addWidget(self.card_ontime, 0, 1)
        grid.addWidget(self.card_late, 0, 2)
        grid.addWidget(self.card_enrolled, 0, 3)

        return ribbon

    def _build_camera_column(self) -> QWidget:
        container = QWidget(self)
        v_layout = QVBoxLayout(container)
        v_layout.setContentsMargins(0, 0, 0, 0)
        v_layout.setSpacing(12)

        # Video Viewport
        self.viewport = VideoViewport(self)
        v_layout.addWidget(self.viewport, stretch=1)

        # Live Verification Card (Banner)
        self.hero_card = self._build_hero_card()
        v_layout.addWidget(self.hero_card)

        return container

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
        self.hero_avatar = QLabel("⏳")
        self.hero_avatar.setFixedSize(48, 48)
        self.hero_avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.hero_avatar.setStyleSheet("""
            background-color: #1e293b;
            color: #94a3b8;
            font-size: 20px;
            font-weight: bold;
            border-radius: 24px;
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

    def _build_roster_column(self) -> QFrame:
        panel = QFrame(self)
        panel.setStyleSheet("""
            QFrame {
                background-color: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
            }
        """)
        p_layout = QVBoxLayout(panel)
        p_layout.setContentsMargins(14, 14, 14, 14)
        p_layout.setSpacing(10)

        # Header Row: Title & Total Count
        title_row = QHBoxLayout()
        t_label = QLabel("📋 Live Gate Activity")
        t_label.setStyleSheet("font-size: 14px; font-weight: 700; color: #f8fafc;")
        
        self.log_count_lbl = QLabel("0 logged")
        self.log_count_lbl.setStyleSheet("color: #64748b; font-size: 11px; font-family: monospace;")
        
        title_row.addWidget(t_label)
        title_row.addStretch()
        title_row.addWidget(self.log_count_lbl)
        p_layout.addLayout(title_row)

        # Search / Filter Bar & Export Button
        toolbar = QHBoxLayout()
        toolbar.setSpacing(8)

        self.search_box = QLineEdit()
        self.search_box.setProperty("class", "search-box")
        self.search_box.setPlaceholderText("🔍 Search student name or grade...")
        self.search_box.textChanged.connect(self._filter_roster)
        toolbar.addWidget(self.search_box, stretch=1)

        btn_export = QPushButton("📥 Export CSV")
        btn_export.setProperty("class", "action-btn")
        btn_export.setStyleSheet("background-color: #064e3b; color: #6ee7b7; border: 1px solid #059669;")
        btn_export.clicked.connect(self._export_csv)
        toolbar.addWidget(btn_export)

        p_layout.addLayout(toolbar)

        # Attendance Table
        self.roster_table = QTableWidget()
        self.roster_table.setColumnCount(5)
        self.roster_table.setHorizontalHeaderLabels(["Time", "Student Name", "Grade", "Status", "Match"])
        self.roster_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.roster_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.roster_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.roster_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        self.roster_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self.roster_table.verticalHeader().setVisible(False)
        self.roster_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.roster_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.roster_table.setShowGrid(False)

        p_layout.addWidget(self.roster_table, stretch=1)

        return panel

    def _build_footer(self) -> QWidget:
        footer = QWidget(self)
        f_layout = QHBoxLayout(footer)
        f_layout.setContentsMargins(4, 0, 4, 0)

        left_note = QLabel("Presences Spotlight AI — Autonomous Gate Attendance Terminal")
        left_note.setStyleSheet("color: #475569; font-size: 11px; font-weight: 500;")

        right_note = QLabel("Appwrite Cloud Realtime Sync • XNNPACK Accelerated")
        right_note.setStyleSheet("color: #475569; font-size: 11px; font-weight: 500;")

        f_layout.addWidget(left_note)
        f_layout.addStretch()
        f_layout.addWidget(right_note)
        return footer

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
        self.hero_details.setText(f"Grade: {grade_str}  •  Time: {time_str}  •  Match: {confidence*100:.1f}%")

        if status == "present":
            self.hero_avatar.setStyleSheet("""
                background-color: #064e3b; color: #34d399; font-size: 20px; font-weight: bold;
                border-radius: 24px; border: 2px solid #10b981;
            """)
            self.hero_status_badge.setText("PRESENT (ON-TIME)")
            self.hero_status_badge.setStyleSheet("background-color: #064e3b; color: #6ee7b7; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px;")
            self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(6, 78, 59, 0.45); border: 1px solid #10b981; border-radius: 14px; padding: 10px 16px; }")
            self.hero_pill.setText("Appwrite Synced ✓")
            self.hero_pill.setStyleSheet("background-color: rgba(16, 185, 129, 0.2); color: #34d399; font-size: 11px; font-weight: bold; border-radius: 8px; padding: 6px 12px;")
        else:
            self.hero_avatar.setStyleSheet("""
                background-color: #78350f; color: #fcd34d; font-size: 20px; font-weight: bold;
                border-radius: 24px; border: 2px solid #f59e0b;
            """)
            self.hero_status_badge.setText("LATE ARRIVAL")
            self.hero_status_badge.setStyleSheet("background-color: #78350f; color: #fde68a; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px;")
            self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(120, 53, 15, 0.45); border: 1px solid #f59e0b; border-radius: 14px; padding: 10px 16px; }")
            self.hero_pill.setText("Late Verified ✓")
            self.hero_pill.setStyleSheet("background-color: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 11px; font-weight: bold; border-radius: 8px; padding: 6px 12px;")

        # Insert row at the very top of the roster table
        self._insert_table_row(time_str, name, grade_str, status, f"{confidence*100:.1f}%")

        # Start timer to gracefully return hero card to scan mode
        self.card_reset_timer.start(6000)

    def _reset_hero_card(self):
        """Returns hero card to idle listening state."""
        self.hero_avatar.setText("🛡️")
        self.hero_avatar.setStyleSheet("background-color: #1e293b; color: #94a3b8; font-size: 20px; font-weight: bold; border-radius: 24px; border: 2px solid #334155;")
        self.hero_name.setText("Awaiting student arrival at corridor...")
        self.hero_status_badge.setText("READY")
        self.hero_status_badge.setStyleSheet("background-color: #1e293b; color: #94a3b8; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px;")
        self.hero_details.setText("Multi-angle 3D face consensus scanning is active")
        self.hero_card.setStyleSheet("QFrame#heroCard { background-color: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 10px 16px; }")
        self.hero_pill.setText("Gate 1 • Online")
        self.hero_pill.setStyleSheet("background-color: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 11px; font-weight: 600; border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 6px 12px;")

    def _insert_table_row(self, time_val: str, name_val: str, grade_val: str, status_val: str, conf_val: str):
        self.roster_table.insertRow(0)

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

        self.roster_table.setItem(0, 0, item_time)
        self.roster_table.setItem(0, 1, item_name)
        self.roster_table.setItem(0, 2, item_grade)
        self.roster_table.setItem(0, 3, item_status)
        self.roster_table.setItem(0, 4, item_conf)

        self.log_count_lbl.setText(f"{self.roster_table.rowCount()} logged")

    def _load_initial_history(self):
        """Loads today's logged attendance from persistent SQLite database."""
        today_str = datetime.now().strftime("%Y-%m-%d")
        logs = self.engine.db.get_today_logs(today_str)
        # logs are in reverse chronological order
        for log in reversed(logs):
            grade_str = f"{log.get('class_name', '')}-{log.get('section', '')}".strip("-") or "-"
            conf_str = f"{float(log.get('confidence', 0.95))*100:.1f}%"
            self._insert_table_row(
                log.get("marked_time", "--:--"),
                log.get("student_name", "Student"),
                grade_str,
                log.get("status", "present"),
                conf_str
            )

    def _filter_roster(self, query: str):
        query = query.strip().lower()
        for row in range(self.roster_table.rowCount()):
            name_item = self.roster_table.item(row, 1)
            grade_item = self.roster_table.item(row, 2)
            name_text = name_item.text().lower() if name_item else ""
            grade_text = grade_item.text().lower() if grade_item else ""
            match = (query in name_text) or (query in grade_text)
            self.roster_table.setRowHidden(row, not match)

    def _export_csv(self):
        """Exports the active attendance table to a CSV file."""
        row_count = self.roster_table.rowCount()
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
                writer.writerow(["Time", "Student Name", "Grade", "Status", "Confidence Match"])
                for row in range(row_count):
                    r_data = [
                        self.roster_table.item(row, col).text() if self.roster_table.item(row, col) else ""
                        for col in range(5)
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

        self.sync_worker = CloudSyncWorker(self.engine)
        self.sync_worker.sync_completed.connect(self._on_sync_finished)
        self.sync_worker.start()

    def _on_sync_finished(self, success: bool, total_models: int, distinct: int):
        self.btn_sync.setText("🔄 Sync Cloud")
        self.btn_sync.setEnabled(True)
        if success:
            self.lbl_enrolled.setText(f"{distinct} students")
            QMessageBox.information(
                self,
                "Cloud Synchronization",
                f"Successfully synchronized {distinct} enrolled students ({total_models} multi-angle models) from Appwrite Cloud!"
            )
        else:
            QMessageBox.warning(self, "Cloud Synchronization", "Sync failed. Operating on local offline SQLite cache.")

    def _toggle_audio(self):
        config.ENABLE_AUDIO = not config.ENABLE_AUDIO
        self.btn_audio.setText("🔊 Audio ON" if config.ENABLE_AUDIO else "🔇 Audio OFF")

    def _toggle_mesh(self):
        self.engine.show_mesh = not self.engine.show_mesh
        self.btn_mesh.setText("🕸️ Mesh ON" if self.engine.show_mesh else "🕸️ Mesh OFF")

    def _open_settings(self):
        dlg = SettingsDialog(self.engine, self)
        if dlg.exec():
            # Update mesh and audio buttons
            self.btn_audio.setText("🔊 Audio ON" if config.ENABLE_AUDIO else "🔇 Audio OFF")
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


# ─── 7. Application Entrypoint ────────────────────────────────────────────────
def launch_application():
    """Starts the native PyQt6 Desktop Application."""
    app = QApplication(sys.argv)
    app.setApplicationName("Presences Spotlight AI")
    app.setStyle("Fusion")

    window = SpotlightDesktopWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    launch_application()
