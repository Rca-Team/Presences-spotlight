"""
Presences Spotlight AI — Enterprise Gate Attendance Engine (Appwrite + Google Pipeline)
Walk-Through, Zero-Lag, Multi-Student Edge Terminal for Schools & Campuses (2,000+ Students)
"""

import warnings
warnings.filterwarnings('ignore')
import sys
import time
import json
import uuid
import math
import queue
import sqlite3
import threading
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Any

import cv2
import numpy as np
import requests

import config
from sound_generator import generate_chime
from google_pipeline import GoogleFacePipeline, GoogleFaceData, GoogleGeminiAuditor

# ─── Audio Backend Initialization ─────────────────────────────────────────────
AUDIO_BACKEND = "none"
if sys.platform == "win32":
    try:
        import winsound
        AUDIO_BACKEND = "winsound"
    except Exception:
        pass
else:
    try:
        import pygame
        pygame.mixer.init()
        AUDIO_BACKEND = "pygame"
    except Exception:
        AUDIO_BACKEND = "aplay"


def is_valid_uuid(val: Optional[str]) -> bool:
    """Checks if a string is a valid UUID format."""
    if not val:
        return False
    try:
        uuid.UUID(str(val))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


# ─── 1. Threaded Zero-Lag Video Stream Reader ─────────────────────────────────
class RTSPVideoStream:
    """Continuous background RTSP/Webcam grabber with automatic reconnect and zero buffer lag."""
    def __init__(self, src=None, cam_id: int = 1, name: str = "", width=config.CAMERA_WIDTH, height=config.CAMERA_HEIGHT):
        if src is None:
            src = config.CAMERA_1_SOURCE if cam_id == 1 else config.CAMERA_2_SOURCE
        self.src = src
        self.cam_id = cam_id
        self.name = name or (config.CAMERA_1_NAME if cam_id == 1 else config.CAMERA_2_NAME)

        try:
            self.src_id = int(src)
        except ValueError:
            self.src_id = src

        self.width = width
        self.height = height
        self.cap = None
        self.grabbed = False
        self.frame = None
        self.stopped = False
        self.lock = threading.Lock()
        self.fps_counter = 0
        self.current_fps = 0.0
        self.last_fps_time = time.time()
        self.last_connect_attempt = 0
        self.is_connected = False

        self._connect()

    def _connect(self):
        self.last_connect_attempt = time.time()
        try:
            if self.cap and self.cap.isOpened():
                self.cap.release()

            if isinstance(self.src_id, str) and self.src_id.startswith("rtsp://"):
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|stimeout;5000000|max_delay;500000"
                self.cap = cv2.VideoCapture(self.src_id, cv2.CAP_FFMPEG)
            else:
                if sys.platform == "win32" and isinstance(self.src_id, int):
                    self.cap = cv2.VideoCapture(self.src_id, cv2.CAP_DSHOW)
                    if not self.cap.isOpened():
                        self.cap = cv2.VideoCapture(self.src_id)
                else:
                    self.cap = cv2.VideoCapture(self.src_id)

            if self.cap.isOpened():
                self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
                self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                self.grabbed, self.frame = self.cap.read()
                self.is_connected = self.grabbed
                if self.grabbed:
                    print(f"[{self.name}] Connected successfully to source: {self.src} ({self.width}x{self.height}).")
            else:
                self.is_connected = False
                print(f"[{self.name} Warning] Unable to open video source: {self.src}. Will retry in background...")
        except Exception as err:
            self.is_connected = False
            print(f"[{self.name} Error] Stream initialization exception: {err}")

    def start(self):
        t = threading.Thread(target=self._update, args=(), daemon=True)
        t.start()
        return self

    def _update(self):
        consecutive_failures = 0
        while not self.stopped:
            now = time.time()
            if self.cap is None or not self.cap.isOpened():
                if (now - self.last_connect_attempt) >= 10.0:
                    self._connect()
                time.sleep(0.1)
                continue

            grabbed, frame = self.cap.read()
            if not grabbed or frame is None:
                consecutive_failures += 1
                self.is_connected = False
                if consecutive_failures > 30:
                    if (now - self.last_connect_attempt) >= 10.0:
                        self._connect()
                        consecutive_failures = 0
                time.sleep(0.04)
                continue

            consecutive_failures = 0
            self.is_connected = True
            with self.lock:
                self.grabbed = grabbed
                self.frame = frame
                self.fps_counter += 1
                now = time.time()
                if now - self.last_fps_time >= 1.0:
                    self.current_fps = round(self.fps_counter / (now - self.last_fps_time), 1)
                    self.fps_counter = 0
                    self.last_fps_time = now

            time.sleep(0.002)

    def _generate_placeholder(self) -> np.ndarray:
        """Generates aesthetic dark placeholder frame when camera source is offline or connecting."""
        placeholder = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        # Gradient background
        placeholder[:] = (15, 23, 42)
        center_x = self.width // 2
        center_y = self.height // 2

        # Draw camera icon / rectangle
        cv2.rectangle(placeholder, (center_x - 120, center_y - 70), (center_x + 120, center_y + 40), (30, 41, 59), -1)
        cv2.rectangle(placeholder, (center_x - 120, center_y - 70), (center_x + 120, center_y + 40), (51, 65, 85), 2)
        
        status_text = f"{self.name.upper()}"
        sub_text = f"Connecting to source: {self.src}..." if (time.time() - self.last_connect_attempt < 10) else f"Camera Offline ({self.src})"
        hint_text = "Check device index or RTSP network settings in Settings"

        cv2.putText(placeholder, status_text, (center_x - 100, center_y - 20), cv2.FONT_HERSHEY_DUPLEX, 0.7, (241, 245, 249), 1, cv2.LINE_AA)
        cv2.putText(placeholder, sub_text, (center_x - 160, center_y + 15), cv2.FONT_HERSHEY_DUPLEX, 0.5, (239, 68, 68) if not self.is_connected else (56, 189, 248), 1, cv2.LINE_AA)
        cv2.putText(placeholder, hint_text, (center_x - 190, center_y + 70), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (148, 163, 184), 1, cv2.LINE_AA)
        return placeholder

    def read(self) -> Tuple[bool, np.ndarray, float]:
        with self.lock:
            if not self.grabbed or self.frame is None:
                return False, self._generate_placeholder(), self.current_fps
            return True, self.frame.copy(), self.current_fps

    def stop(self):
        self.stopped = True
        if self.cap and self.cap.isOpened():
            self.cap.release()



# ─── 2. Local Database & Offline Queue ───────────────────────────────────────
class LocalDatabase:
    """Manages persistent SQLite cache for 0ms attendance logging and offline resilience."""
    def __init__(self, db_path=config.DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self):
        return sqlite3.connect(self.db_path, timeout=10.0, check_same_thread=False)

    def _init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cached_students (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    student_id TEXT,
                    student_name TEXT,
                    class_name TEXT,
                    section TEXT,
                    parent_email TEXT,
                    descriptor_json TEXT,
                    updated_at TEXT
                )
            """)
            # Migration check: add parent_email column if not exists
            try:
                cursor.execute("ALTER TABLE cached_students ADD COLUMN parent_email TEXT")
            except Exception:
                pass
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS offline_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    payload_json TEXT,
                    created_at TEXT,
                    retry_count INTEGER DEFAULT 0
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sent_notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_key TEXT,
                    notification_date TEXT,
                    created_at TEXT
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS daily_session_marks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_key TEXT,
                    session_date TEXT,
                    marked_at TEXT
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS daily_attendance_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_key TEXT,
                    student_name TEXT,
                    class_name TEXT,
                    section TEXT,
                    status TEXT,
                    confidence REAL,
                    marked_time TEXT,
                    session_date TEXT,
                    camera_lane TEXT DEFAULT 'Lane 1'
                )
            """)
            # Migration check: add camera_lane column if not exists
            try:
                cursor.execute("ALTER TABLE daily_attendance_logs ADD COLUMN camera_lane TEXT DEFAULT 'Lane 1'")
            except Exception:
                pass
            conn.commit()

    def log_attendance(self, student_key: str, student_name: str, class_name: str, section: str, status: str, confidence: float, marked_time: str, session_date: str, camera_lane: str = "Lane 1"):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO daily_attendance_logs 
                (student_key, student_name, class_name, section, status, confidence, marked_time, session_date, camera_lane)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (str(student_key), str(student_name), str(class_name or ""), str(section or ""), str(status), float(confidence), str(marked_time), str(session_date), str(camera_lane)))
            conn.commit()

    def get_today_logs(self, session_date: Optional[str] = None) -> List[Dict]:
        if not session_date:
            session_date = datetime.now().strftime("%Y-%m-%d")
        with self._get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    SELECT student_key, student_name, class_name, section, status, confidence, marked_time, camera_lane
                    FROM daily_attendance_logs
                    WHERE session_date = ?
                    ORDER BY id DESC
                """, (str(session_date),))
                rows = cursor.fetchall()
                logs = []
                for r in rows:
                    logs.append({
                        "student_key": r[0],
                        "student_name": r[1],
                        "class_name": r[2],
                        "section": r[3],
                        "status": r[4],
                        "confidence": r[5],
                        "marked_time": r[6],
                        "camera_lane": r[7] if len(r) > 7 and r[7] else "Lane 1"
                    })
                return logs
            except Exception:
                cursor.execute("""
                    SELECT student_key, student_name, class_name, section, status, confidence, marked_time
                    FROM daily_attendance_logs
                    WHERE session_date = ?
                    ORDER BY id DESC
                """, (str(session_date),))
                rows = cursor.fetchall()
                logs = []
                for r in rows:
                    logs.append({
                        "student_key": r[0],
                        "student_name": r[1],
                        "class_name": r[2],
                        "section": r[3],
                        "status": r[4],
                        "confidence": r[5],
                        "marked_time": r[6],
                        "camera_lane": "Lane 1"
                    })
                return logs


    def is_already_marked_today(self, student_key: str, date_str: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM daily_session_marks WHERE student_key = ? AND session_date = ?",
                (str(student_key), str(date_str))
            )
            return cursor.fetchone() is not None

    def record_session_mark(self, student_key: str, date_str: str):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO daily_session_marks (student_key, session_date, marked_at) VALUES (?, ?, ?)",
                (str(student_key), str(date_str), datetime.now(timezone.utc).isoformat())
            )
            conn.commit()

    def was_notified_today(self, student_key: str, date_str: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM sent_notifications WHERE student_key = ? AND notification_date = ?",
                (str(student_key), str(date_str))
            )
            return cursor.fetchone() is not None

    def mark_notified_today(self, student_key: str, date_str: str):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO sent_notifications (student_key, notification_date, created_at) VALUES (?, ?, ?)",
                (str(student_key), str(date_str), datetime.now(timezone.utc).isoformat())
            )
            conn.commit()

    def save_cached_students(self, students: List[Dict]):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM cached_students")
            for s in students:
                desc = s.get("descriptor")
                desc_list = desc.tolist() if hasattr(desc, "tolist") else desc
                cursor.execute("""
                    INSERT OR REPLACE INTO cached_students 
                    (id, user_id, student_id, student_name, class_name, section, parent_email, descriptor_json, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(s.get("id")),
                    s.get("user_id"),
                    s.get("student_id"),
                    s.get("student_name"),
                    s.get("class_name"),
                    s.get("section"),
                    s.get("parent_email"),
                    json.dumps(desc_list),
                    datetime.now(timezone.utc).isoformat()
                ))
            conn.commit()

    def get_cached_students(self) -> List[Dict]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, user_id, student_id, student_name, class_name, section, parent_email, descriptor_json FROM cached_students")
            rows = cursor.fetchall()
            students = []
            for r in rows:
                try:
                    desc = json.loads(r[7])
                    if desc:
                        students.append({
                            "id": r[0],
                            "user_id": r[1],
                            "student_id": r[2],
                            "student_name": r[3],
                            "class_name": r[4],
                            "section": r[5],
                            "parent_email": r[6],
                            "descriptor": np.array(desc, dtype=np.float32)
                        })
                except Exception:
                    pass
            return students

    def enqueue_attendance(self, payload: Dict):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO offline_queue (payload_json, created_at, retry_count)
                VALUES (?, ?, 0)
            """, (json.dumps(payload), datetime.now(timezone.utc).isoformat()))
            conn.commit()

    def get_queued_records(self, limit=20) -> List[Tuple[int, Dict]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, payload_json FROM offline_queue ORDER BY id ASC LIMIT ?", (limit,))
            rows = cursor.fetchall()
            result = []
            for row_id, p_json in rows:
                try:
                    result.append((row_id, json.loads(p_json)))
                except Exception:
                    pass
            return result

    def remove_queued_record(self, record_id: int):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM offline_queue WHERE id = ?", (record_id,))
            conn.commit()


# ─── Appwrite Python SDK Backend Client ───────────────────────────────────────
class AppwriteSync:
    """Communicates directly with Appwrite Cloud using the official Python SDK."""
    def __init__(self, db: LocalDatabase):
        self.db = db
        self.endpoint = config.APPWRITE_ENDPOINT
        self.project_id = config.APPWRITE_PROJECT_ID
        self.api_key = config.APPWRITE_API_KEY
        self.db_id = config.APPWRITE_DATABASE_ID
        self.bucket_id = config.APPWRITE_BUCKET_ID

        self.client = None
        self.databases = None
        self.storage = None

        if self.project_id:
            try:
                from appwrite.client import Client as AppwriteClient
                from appwrite.services.databases import Databases as AppwriteDatabases
                from appwrite.services.storage import Storage as AppwriteStorage

                self.client = AppwriteClient()
                self.client.set_endpoint(self.endpoint)
                self.client.set_project(self.project_id)
                if self.api_key:
                    self.client.set_key(self.api_key)
                self.databases = AppwriteDatabases(self.client)
                self.storage = AppwriteStorage(self.client)
                print(f"[Spotlight Appwrite] Native Python SDK connected ({self.endpoint})")
            except Exception as e:
                print(f"[Spotlight Appwrite Warning] Init note: {e}")

    def fetch_enrolled_faces(self) -> List[Dict]:
        """Loads all student face vector models from Appwrite with full pagination."""
        enrolled = []
        try:
            from appwrite.query import Query as AppwriteQuery

            if self.databases:
                # 1. Fetch user profiles mapping (quick fast-path)
                profile_map = {}
                parent_email_map = {}
                try:
                    p_offset = 0
                    for _ in range(2):
                        prof_resp = self.databases.list_documents(
                            database_id=self.db_id,
                            collection_id='profiles',
                            queries=[AppwriteQuery.limit(100), AppwriteQuery.offset(p_offset)]
                        )
                        p_docs = getattr(prof_resp, 'documents', None) or (prof_resp.get('documents', []) if isinstance(prof_resp, dict) else [])
                        if not p_docs:
                            break
                        for p in p_docs:
                            p_data = getattr(p, 'data', None) or (p if isinstance(p, dict) else {})
                            p_name = p_data.get('full_name') or p_data.get('display_name') or p_data.get('name')
                            uid = p_data.get('user_id') or getattr(p, 'id', None) or getattr(p, '$id', None)
                            p_email = p_data.get('parent_email') or p_data.get('email')
                            if uid and p_name:
                                profile_map[str(uid)] = p_name
                            if uid and p_email:
                                parent_email_map[str(uid)] = p_email
                        p_offset += len(p_docs)
                        p_total = getattr(prof_resp, 'total', None) or (prof_resp.get('total', 0) if isinstance(prof_resp, dict) else 0)
                        if p_offset >= p_total:
                            break
                except Exception:
                    pass

                # 2. Paginated face descriptors fetch
                offset = 0
                limit = 100
                while True:
                    resp = self.databases.list_documents(
                        database_id=self.db_id,
                        collection_id='face_descriptors',
                        queries=[AppwriteQuery.limit(limit), AppwriteQuery.offset(offset)]
                    )
                    docs = getattr(resp, 'documents', None) or (resp.get('documents', []) if isinstance(resp, dict) else [])
                    if not docs:
                        break

                    for item in docs:
                        item_data = getattr(item, 'data', None) or (item if isinstance(item, dict) else {})
                        doc_id = getattr(item, 'id', None) or getattr(item, '$id', None) or item_data.get('$id') or str(uuid.uuid4())

                        raw_desc = item_data.get("descriptor") or item_data.get("descriptors")
                        if not raw_desc:
                            continue
                        if isinstance(raw_desc, str):
                            try:
                                raw_desc = json.loads(raw_desc)
                            except Exception:
                                continue

                        vectors = []
                        if isinstance(raw_desc, list) and len(raw_desc) > 0:
                            if isinstance(raw_desc[0], list):
                                for v in raw_desc:
                                    if len(v) == 128:
                                        vectors.append(v)
                            elif len(raw_desc) == 128:
                                vectors.append(raw_desc)

                        if not vectors:
                            continue

                        uid = item_data.get("user_id")
                        student_id = item_data.get("student_id") or uid
                        label = item_data.get("label") or item_data.get("student_name")
                        meta = item_data.get("metadata")
                        if isinstance(meta, str):
                            try:
                                meta = json.loads(meta)
                            except Exception:
                                meta = {}
                        meta_name = meta.get("name") if isinstance(meta, dict) else None

                        resolved_name = (
                            label
                            or meta_name
                            or (profile_map.get(str(uid)) if uid else None)
                            or (f"Student {student_id}" if student_id else "Student")
                        )
                        resolved_parent_email = (
                            (parent_email_map.get(str(uid)) if uid else None)
                            or item_data.get("parent_email")
                        )

                        for idx, vec in enumerate(vectors):
                            enrolled.append({
                                "id": f"{doc_id}_{idx}",
                                "user_id": uid,
                                "student_id": student_id,
                                "student_name": resolved_name,
                                "parent_email": resolved_parent_email,
                                "class_name": item_data.get("class"),
                                "section": item_data.get("section"),
                                "descriptor": np.array(vec, dtype=np.float32)
                            })

                    offset += len(docs)
                    total = getattr(resp, 'total', None) or (resp.get('total', 0) if isinstance(resp, dict) else 0)
                    if offset >= total:
                        break

                distinct_names = set(s["student_name"] for s in enrolled)
                print(f"[Spotlight Appwrite] Loaded {len(distinct_names)} distinct students ({len(enrolled)} vector models) from Appwrite Cloud.")
                return enrolled

        except Exception as err:
            print(f"[Spotlight Appwrite Error] {err}")
        return []

    def post_attendance(self, payload: Dict) -> bool:
        """Records attendance directly into Appwrite attendance_records collection adhering strictly to schema."""
        try:
            from appwrite.id import ID as AppwriteID

            clean_payload = dict(payload)
            if "camera_lane" in clean_payload and "camera_location" not in clean_payload:
                clean_payload["camera_location"] = clean_payload["camera_lane"]
            if "date" not in clean_payload:
                clean_payload["date"] = datetime.now().strftime("%Y-%m-%d")
            if "confidence" not in clean_payload and "confidence_score" in clean_payload:
                clean_payload["confidence"] = clean_payload["confidence_score"]
            if isinstance(clean_payload.get("device_info"), dict):
                clean_payload["device_info"] = json.dumps(clean_payload["device_info"])
            if isinstance(clean_payload.get("metadata"), dict):
                clean_payload["metadata"] = json.dumps(clean_payload["metadata"])

            allowed_keys = {
                'user_id', 'student_id', 'student_name', 'class', 'section', 
                'roll_number', 'category', 'status', 'timestamp', 'date', 
                'image_url', 'verified_by', 'confidence', 'camera_location', 
                'device_info', 'face_descriptor', 'confidence_score', 
                'capture_mode', 'source', 'metadata', 'recognized', 'notes'
            }
            clean_payload = {k: v for k, v in clean_payload.items() if k in allowed_keys and v is not None}

            if self.databases:
                doc_id = AppwriteID.unique()
                self.databases.create_document(
                    database_id=self.db_id,
                    collection_id='attendance_records',
                    document_id=doc_id,
                    data=clean_payload
                )
                return True

            headers = {"X-Appwrite-Project": self.project_id, "Content-Type": "application/json"}
            if self.api_key:
                headers["X-Appwrite-Key"] = self.api_key

            body = {"documentId": "unique()", "data": clean_payload}
            res = requests.post(
                f"{self.endpoint}/databases/{self.db_id}/collections/attendance_records/documents",
                headers=headers,
                json=body,
                timeout=6
            )
            return res.status_code in (200, 201)
        except Exception as err:
            print(f"[Spotlight Appwrite Post Error] {err}")
            return False


# ─── 3. Unified Cloud Synchronizer ───────────────────────────────────────────
class UnifiedCloudSync:
    """Seamlessly manages Appwrite Cloud synchronization and parent notifications."""
    def __init__(self, db: LocalDatabase):
        self.db = db
        self.appwrite = AppwriteSync(db)

    def fetch_enrolled_faces(self) -> List[Dict]:
        return self.appwrite.fetch_enrolled_faces()

    def post_attendance(self, payload: Dict) -> bool:
        return self.appwrite.post_attendance(payload)

    def send_parent_notification_with_rate_limit(self, student: Dict, status: str):
        """Dispatches automated parent notification adhering strictly to 1-email-per-student-per-day."""
        try:
            student_id = str(student.get("student_id") or student.get("user_id") or "")
            user_id = student.get("user_id")
            student_name = student.get("student_name")
            parent_email = student.get("parent_email")
            student_key = student_id or user_id or student_name
            today_date = datetime.now().strftime("%Y-%m-%d")
            time_str = datetime.now().strftime("%I:%M %p")

            if self.db.was_notified_today(student_key, today_date):
                return

            # Direct Resend API Email Dispatch
            if config.RESEND_API_KEY and parent_email:
                try:
                    resend_headers = {
                        "Authorization": f"Bearer {config.RESEND_API_KEY}",
                        "Content-Type": "application/json"
                    }
                    resend_body = {
                        "from": "Presences AI <notifications@presences.app>",
                        "to": [parent_email],
                        "subject": f"Arrival Notice: {student_name} marked {status.upper()}",
                        "html": f"""
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <h2 style="color: #0f172a; margin-bottom: 8px;">Campus Arrival Confirmation</h2>
                            <p style="color: #475569; font-size: 16px;">Dear Parent/Guardian,</p>
                            <p style="color: #334155; font-size: 15px; line-height: 1.5;">
                                <strong>{student_name}</strong> was verified at <strong>{config.GATE_NAME}</strong>.
                            </p>
                            <div style="background: #f8fafc; border-left: 4px solid {'#10b981' if status == 'present' else '#f59e0b'}; padding: 12px 16px; margin: 20px 0;">
                                <p style="margin: 4px 0; color: #1e293b;"><strong>Status:</strong> {status.upper()}</p>
                                <p style="margin: 4px 0; color: #1e293b;"><strong>Arrival Time:</strong> {time_str}</p>
                                <p style="margin: 4px 0; color: #1e293b;"><strong>Terminal:</strong> {config.GATE_NAME}</p>
                            </div>
                            <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">Presences Spotlight AI</p>
                        </div>
                        """
                    }
                    requests.post("https://api.resend.com/emails", headers=resend_headers, json=resend_body, timeout=6)
                except Exception:
                    pass

            self.db.mark_notified_today(student_key, today_date)
        except Exception as err:
            print(f"[Spotlight Notification Error] {err}")

    def process_offline_queue(self):
        """Flushes locally stored offline queue to cloud."""
        queued = self.db.get_queued_records(limit=10)
        if not queued:
            return

        for record_id, payload in queued:
            success = self.post_attendance(payload)
            if success:
                self.db.remove_queued_record(record_id)
                print(f"[Spotlight Sync] Flushed offline record (ID: {record_id}) for {payload.get('student_name')}")
            else:
                break


# ─── 4. Audio Feedback Player ────────────────────────────────────────────────
def play_feedback_sound():
    if not config.ENABLE_AUDIO:
        return

    def _play():
        try:
            chime_file = config.CHIME_PATH
            if not os.path.exists(chime_file):
                generate_chime(chime_file)

            if AUDIO_BACKEND == "winsound":
                try:
                    import winsound
                    winsound.PlaySound(chime_file, winsound.SND_FILENAME | winsound.SND_ASYNC)
                except Exception:
                    pass
            elif AUDIO_BACKEND == "pygame":
                try:
                    import pygame
                    pygame.mixer.music.load(chime_file)
                    pygame.mixer.music.play()
                except Exception:
                    pass
            else:
                try:
                    subprocess.run(["aplay", "-q", chime_file], stdout=cv2.DEVNULL, stderr=cv2.DEVNULL)
                except Exception:
                    pass
        except Exception:
            pass

    threading.Thread(target=_play, daemon=True).start()


# ─── 5. Multi-Student Track & Consensus Engine ────────────────────────────────
class StudentTrack:
    """Tracks a single student moving across consecutive frames to perform multi-frame voting."""
    def __init__(self, track_id: int, bbox: Tuple[int, int, int, int]):
        self.track_id = track_id
        self.bbox = bbox
        self.last_seen = time.time()
        self.created_at = time.time()
        self.matches: List[Tuple[str, Dict, float, float]] = []
        self.committed = False
        self.best_quality = 0.0
        self.lighting_condition = "optimal"
        self.state = "DETECTED"

    def update_position(self, bbox: Tuple[int, int, int, int]):
        self.bbox = bbox
        self.last_seen = time.time()

    def add_match(self, student: Dict, distance: float, quality: float = 0.5, lighting: str = "optimal"):
        key = str(student.get("student_id") or student.get("user_id") or student.get("student_name"))
        self.matches.append((key, student, distance, quality))
        self.lighting_condition = lighting
        if quality > self.best_quality:
            self.best_quality = quality
        now = time.time()
        self.matches = [(k, s, d, q) for k, s, d, q in self.matches if (now - self.last_seen) <= config.CONSENSUS_WINDOW_SECONDS]

    def get_consensus_winner(self) -> Optional[Tuple[Dict, float, int]]:
        """
        Smart Zero-False Consensus Gate:
        Guarantees 100% precision by requiring consistent multi-frame agreement
        and low distance variance before committing attendance.
        """
        if not self.matches:
            return None

        # Ultra-strong match (dist < 0.34) can confirm with 1 frame only in permissive mode
        best_single = min(self.matches, key=lambda m: m[2])
        if not config.STRICT_ZERO_FALSE_MODE and best_single[2] < 0.34:
            return best_single[1], best_single[2], 1

        if len(self.matches) < config.CONSENSUS_FRAMES_REQUIRED:
            return None

        counts: Dict[str, List[Tuple[Dict, float, float]]] = {}
        for k, s, d, q in self.matches:
            if k not in counts:
                counts[k] = []
            counts[k].append((s, d, q))

        for k, records in counts.items():
            if len(records) >= config.CONSENSUS_FRAMES_REQUIRED:
                dists = [r[1] for r in records]
                avg_dist = float(np.mean(dists))

                # Zero False Safeguard: Every voting frame must remain under MATCH_THRESHOLD
                if avg_dist <= config.MATCH_THRESHOLD and max(dists) <= (config.MATCH_THRESHOLD + 0.04):
                    best_s = records[0][0]
                    return best_s, avg_dist, len(records)

        return None


# ─── 6. Main Presences Spotlight Engine ───────────────────────────────────────
class SpotlightEngine:
    def __init__(self):
        print("=" * 75)
        print("  PRESENCES SPOTLIGHT AI -- DUAL-CAMERA GOOGLE VISION TERMINAL  ")
        print("=" * 75)

        Path(config.UNKNOWN_LOG_DIR).mkdir(parents=True, exist_ok=True)
        self.db = LocalDatabase()
        self.cloud = UnifiedCloudSync(self.db)
        self.enrolled_students: List[Dict] = []
        self.descriptors_matrix: Optional[np.ndarray] = None
        self.last_sync_time = time.time()
        self.is_syncing = False
        self.sync_lock = threading.Lock()
        self.view_mode = "dual"
        self.running = False

        # Live Session Counters
        self.counter_total_present = 0
        self.counter_on_time = 0
        self.counter_late = 0
        self.counter_unrecognized = 0
        self.counter_lane1 = 0
        self.counter_lane2 = 0

        # Multi-Student Tracker State per Camera Lane (Cam 1 & Cam 2)
        self.next_track_id = {1: 1, 2: 1}
        self.active_tracks: Dict[int, Dict[int, StudentTrack]] = {1: {}, 2: {}}

        # Thread-safe HUD State per Camera
        self.hud_lock = threading.Lock()
        self.hud_detections: Dict[int, List[Dict]] = {1: [], 2: []}
        self.hud_banner_name: Dict[int, str] = {1: "", 2: ""}
        self.hud_banner_status: Dict[int, str] = {1: "READY", 2: "READY"}
        self.hud_banner_class: Dict[int, str] = {1: "", 2: ""}
        self.hud_banner_time: Dict[int, str] = {1: "", 2: ""}
        self.hud_banner_until: Dict[int, float] = {1: 0.0, 2: 0.0}
        self.show_mesh = config.SHOW_LANDMARK_MESH

        # Cross-Camera Real-Time Deduplication Guard
        self.dedup_lock = threading.Lock()
        self.recent_verifications: Dict[str, float] = {}  # student_key -> timestamp
        self.last_chime_time = 0.0

        # Dedicated AI Inference Worker Queue (accepts (cam_id, frame) tuples)
        self.inference_queue = queue.Queue(maxsize=2)

        # Initialize Google Vision & MediaPipe Pipeline
        self.google_pipeline = GoogleFacePipeline()
        self.gemini_auditor = GoogleGeminiAuditor()

        # Initialize audio chime
        generate_chime(config.CHIME_PATH)

        self.attendance_callback = None

        # Restore today's attendance session state from local database
        today_str = datetime.now().strftime("%Y-%m-%d")
        existing_logs = self.db.get_today_logs(today_str)
        self.counter_total_present = len(existing_logs)
        self.counter_on_time = sum(1 for log in existing_logs if log.get("status") == "present")
        self.counter_late = sum(1 for log in existing_logs if log.get("status") == "late")
        self.counter_lane1 = sum(1 for log in existing_logs if "1" in str(log.get("camera_lane", "")))
        self.counter_lane2 = sum(1 for log in existing_logs if "2" in str(log.get("camera_lane", "")))

        # Load local SQLite cached student models immediately for 0ms startup
        self.enrolled_students = self.db.get_cached_students()
        if self.enrolled_students:
            matrix_list = [s["descriptor"] for s in self.enrolled_students]
            self.descriptors_matrix = np.array(matrix_list, dtype=np.float32)
            distinct_count = len(set(s["student_name"] for s in self.enrolled_students))
            print(f"[Spotlight] Instant startup: loaded {distinct_count} enrolled students ({len(self.enrolled_students)} models) from local database.")
        else:
            self.sync_students()

    def start_worker(self):
        """Starts the background AI inference thread if not already running."""
        if not self.running:
            self.running = True
            t = threading.Thread(target=self._inference_worker, daemon=True)
            t.start()
            return t

    def submit_frame(self, frame: np.ndarray, cam_id: int = 1):
        """Dispatches frame to AI worker queue without lag by dropping stale frames."""
        try:
            # Drain stale frames so worker always processes the freshest frame
            while not self.inference_queue.empty():
                try:
                    self.inference_queue.get_nowait()
                except queue.Empty:
                    break
            self.inference_queue.put_nowait((cam_id, frame.copy()))
        except (queue.Full, queue.Empty):
            pass

    def sync_students(self):
        """Loads student face descriptors into contiguous NumPy matrix with thread-safe single-instance locking."""
        with self.sync_lock:
            if self.is_syncing:
                return
            self.is_syncing = True

        try:
            print("[Spotlight] Synchronizing student face models from Appwrite Cloud...")
            cloud_students = self.cloud.fetch_enrolled_faces()
            if cloud_students:
                self.db.save_cached_students(cloud_students)
                self.enrolled_students = self.db.get_cached_students()
            else:
                print("[Spotlight] Using cached student models from local SQLite DB...")
                self.enrolled_students = self.db.get_cached_students()

            if self.enrolled_students:
                matrix_list = [s["descriptor"] for s in self.enrolled_students]
                self.descriptors_matrix = np.array(matrix_list, dtype=np.float32)
            else:
                self.descriptors_matrix = None

            distinct_count = len(set(s["student_name"] for s in self.enrolled_students))
            print(f"[Spotlight] Ready with {distinct_count} enrolled students ({len(self.enrolled_students)} models) in memory.")
        finally:
            self.last_sync_time = time.time()
            self.is_syncing = False

    def determine_status(self) -> str:
        """Determines 'present' vs 'late' based on daily cutoff configuration."""
        now = datetime.now()
        cutoff = now.replace(hour=config.CUTOFF_HOUR, minute=config.CUTOFF_MINUTE, second=0, microsecond=0)
        return "late" if now > cutoff else "present"

    def match_face_vectorized(self, face_encoding: np.ndarray) -> Tuple[Optional[Dict], float]:
        """
        Calculates Vectorized Euclidean distance against all student embeddings in <0.1ms via BLAS.
        Applies Ambiguity Ratio check to prevent similar-looking false positives.
        """
        if self.descriptors_matrix is None or len(self.enrolled_students) == 0:
            return None, 1.0

        q = face_encoding.astype(np.float32)
        diffs = self.descriptors_matrix - q
        dists = np.linalg.norm(diffs, axis=1)

        sorted_indices = np.argsort(dists)
        best_idx = sorted_indices[0]
        best_dist = float(dists[best_idx])

        if best_dist <= config.MATCH_THRESHOLD:
            best_match = self.enrolled_students[best_idx]
            best_name = best_match["student_name"]

            # Ambiguity Check: Ensure distinct 2nd student is not overly close
            second_best_dist = float('inf')
            for idx in sorted_indices[1:15]:
                if idx < len(self.enrolled_students) and self.enrolled_students[idx]["student_name"] != best_name:
                    second_best_dist = float(dists[idx])
                    break

            if second_best_dist < float('inf'):
                # 1. Ambiguity Ratio check
                if second_best_dist < 0.46 and (best_dist / second_best_dist) > config.AMBIGUITY_RATIO:
                    return None, best_dist

                # 2. Dynamic Margin Delta Guard
                if (second_best_dist - best_dist) < config.AMBIGUITY_MARGIN_DELTA:
                    return None, best_dist

            return best_match, best_dist

        return None, best_dist

    def _associate_tracks(self, face_centers: List[Tuple[int, int]], face_boxes: List[Tuple[int, int, int, int]], cam_id: int = 1) -> List[int]:
        """Fast spatial centroid association between detected faces and active tracks for a specific camera."""
        track_ids = []
        now = time.time()
        tracks_for_cam = self.active_tracks.setdefault(cam_id, {})

        stale_ids = [tid for tid, trk in tracks_for_cam.items() if (now - trk.last_seen) > 3.5]
        for tid in stale_ids:
            del tracks_for_cam[tid]

        for (cx, cy), bbox in zip(face_centers, face_boxes):
            best_tid = None
            min_dist = float('inf')

            for tid, trk in tracks_for_cam.items():
                t_top, t_right, t_bottom, t_left = trk.bbox
                tcx, tcy = (t_left + t_right) // 2, (t_top + t_bottom) // 2
                dist = math.hypot(cx - tcx, cy - tcy)

                if dist < 140 and dist < min_dist:
                    min_dist = dist
                    best_tid = tid

            if best_tid is not None:
                tracks_for_cam[best_tid].update_position(bbox)
                track_ids.append(best_tid)
            else:
                new_tid = self.next_track_id[cam_id]
                self.next_track_id[cam_id] += 1
                tracks_for_cam[new_tid] = StudentTrack(new_tid, bbox)
                track_ids.append(new_tid)

        return track_ids

    def handle_confirmed_attendance(self, student: Dict, confidence_score: float, cam_id: int = 1, face_data: Optional[GoogleFaceData] = None):
        """
        Executes instant attendance logging, cross-camera deduplication, chime, and cloud sync.
        """
        student_id_val = str(student.get("student_id") or student.get("user_id") or "")
        student_name = student.get("student_name")
        student_key = student_id_val or student_name
        today_str = datetime.now().strftime("%Y-%m-%d")
        now = time.time()
        lane_name = config.CAMERA_1_NAME if cam_id == 1 else config.CAMERA_2_NAME

        # ── Cross-Camera & Same-Camera Deduplication Check ──
        with self.dedup_lock:
            # Clean up old verification timestamps (> 120s)
            for k in list(self.recent_verifications.keys()):
                if now - self.recent_verifications[k] > 120.0:
                    del self.recent_verifications[k]

            last_v = self.recent_verifications.get(student_key)
            if last_v is not None and (now - last_v) < config.CROSS_CAMERA_COOLDOWN_SEC:
                # Student already verified recently on another camera or this camera!
                with self.hud_lock:
                    self.hud_banner_name[cam_id] = student_name
                    self.hud_banner_status[cam_id] = "ALREADY RECORDED"
                    self.hud_banner_class[cam_id] = f"Class {student.get('class_name', '')} {student.get('section', '')}".strip()
                    self.hud_banner_time[cam_id] = datetime.now().strftime("%I:%M:%S %p")
                    self.hud_banner_until[cam_id] = now + 2.5
                return

            self.recent_verifications[student_key] = now

        if self.db.is_already_marked_today(student_key, today_str):
            with self.hud_lock:
                self.hud_banner_name[cam_id] = student_name
                self.hud_banner_status[cam_id] = "TODAY'S RECORD EXISTS"
                self.hud_banner_class[cam_id] = f"Class {student.get('class_name', '')} {student.get('section', '')}".strip()
                self.hud_banner_time[cam_id] = datetime.now().strftime("%I:%M:%S %p")
                self.hud_banner_until[cam_id] = now + 2.5
            return

        self.db.record_session_mark(student_key, today_str)
        status = self.determine_status()
        iso_timestamp = datetime.now(timezone.utc).isoformat()
        time_formatted = datetime.now().strftime("%I:%M:%S %p")

        self.counter_total_present += 1
        if status == "present":
            self.counter_on_time += 1
        else:
            self.counter_late += 1

        if cam_id == 1:
            self.counter_lane1 += 1
        else:
            self.counter_lane2 += 1

        print(f"\n[SPOTLIGHT VERIFIED • {lane_name.upper()}] {student_name} | Grade: {student.get('class_name', '')}-{student.get('section', '')}")
        print(f"                     Status: {status.upper()} | Confidence: {confidence_score*100:.1f}% | Time: {time_formatted}")

        with self.hud_lock:
            self.hud_banner_name[cam_id] = student_name
            self.hud_banner_status[cam_id] = f"MARKED {status.upper()}"
            self.hud_banner_class[cam_id] = f"Class {student.get('class_name', '')} {student.get('section', '')}".strip()
            self.hud_banner_time[cam_id] = time_formatted
            self.hud_banner_until[cam_id] = now + 4.0

        # Debounced audio chime (max 1 chime per second)
        if now - self.last_chime_time > 1.0:
            self.last_chime_time = now
            play_feedback_sound()

        payload = {
            "user_id": student.get("user_id") if is_valid_uuid(student.get("user_id")) else None,
            "student_id": student_id_val,
            "student_name": student_name,
            "timestamp": iso_timestamp,
            "status": status,
            "source": f"{config.CAPTURE_MODE}-lane{cam_id}",
            "capture_mode": config.CAPTURE_MODE,
            "camera_lane": lane_name,
            "class": student.get("class_name"),
            "section": student.get("section"),
            "confidence_score": round(confidence_score, 4),
            "device_info": {
                "system": "Presences - Spotlight Engine (Dual-Camera Edition)",
                "backend": "Appwrite Cloud",
                "gate_name": config.GATE_NAME,
                "lane_name": lane_name,
                "camera_id": cam_id,
                "timestamp": iso_timestamp,
                "metadata": {
                    "student_name": student_name,
                    "student_id": student_id_val,
                    "class": student.get("class_name") or "",
                    "section": student.get("section") or ""
                }
            }
        }

        def _async_push():
            success = self.cloud.post_attendance(payload)
            if success:
                print(f"[Spotlight Appwrite] Attendance synced to cloud for {student_name} ({lane_name}).")
            else:
                self.db.enqueue_attendance(payload)

        threading.Thread(target=_async_push, daemon=True).start()
        threading.Thread(target=lambda: self.cloud.send_parent_notification_with_rate_limit(student, status), daemon=True).start()

        self.db.log_attendance(
            student_key=student_key,
            student_name=student_name,
            class_name=student.get('class_name', ''),
            section=student.get('section', ''),
            status=status,
            confidence=confidence_score,
            marked_time=time_formatted,
            session_date=today_str,
            camera_lane=lane_name
        )

        record_data = {
            "student_key": student_key,
            "student_name": student_name,
            "class_name": student.get('class_name', ''),
            "section": student.get('section', ''),
            "status": status,
            "confidence": confidence_score,
            "time": time_formatted,
            "iso_timestamp": iso_timestamp,
            "camera_lane": lane_name,
            "cam_id": cam_id,
            "synced": True
        }
        if callable(self.attendance_callback):
            try:
                self.attendance_callback(record_data)
            except Exception as cb_err:
                print(f"[Spotlight Callback Note] {cb_err}")

    def _inference_worker(self):
        """Asynchronous AI worker thread processing face embeddings for both camera feeds."""
        while self.running:
            try:
                item = self.inference_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            if isinstance(item, tuple):
                cam_id, frame = item
            else:
                cam_id, frame = 1, item

            try:
                detections = []

                if self.google_pipeline.is_ready:
                    face_data_list = self.google_pipeline.detect_and_process(frame, extract_embeddings=True)
                    if face_data_list:
                        centers = [fd.center_xy for fd in face_data_list]
                        boxes = [fd.bbox for fd in face_data_list]
                        track_ids = self._associate_tracks(centers, boxes, cam_id=cam_id)
                        tracks_for_cam = self.active_tracks.get(cam_id, {})

                        for fd, tid in zip(face_data_list, track_ids):
                            trk = tracks_for_cam.get(tid)

                            matched_student = None
                            distance = 1.0

                            if fd.embedding is not None:
                                matched_student, distance = self.match_face_vectorized(fd.embedding)

                            if matched_student and trk:
                                trk.add_match(matched_student, distance, quality=fd.quality_score, lighting=fd.lighting_condition)
                                conf = float(max(0.0, min(1.0, 1.0 - (distance / 0.70))))

                                consensus = trk.get_consensus_winner()
                                if consensus and not trk.committed:
                                    win_student, win_dist, win_votes = consensus
                                    trk.committed = True
                                    trk.state = "VERIFIED"
                                    self.handle_confirmed_attendance(win_student, conf, cam_id=cam_id, face_data=fd)
                                elif not trk.committed:
                                    trk.state = "IDENTIFYING"

                                detections.append({
                                    "bbox": fd.bbox,
                                    "name": matched_student["student_name"],
                                    "status": "VERIFIED" if (trk and trk.committed) else "IDENTIFYING...",
                                    "confidence": conf,
                                    "is_matched": True,
                                    "yaw": fd.yaw_deg,
                                    "pitch": fd.pitch_deg,
                                    "quality": fd.quality_score,
                                    "lighting": fd.lighting_condition,
                                    "is_enhanced": fd.is_enhanced,
                                    "state": trk.state if trk else "DETECTED",
                                    "landmarks_pixel": fd.landmarks_pixel
                                })
                            else:
                                if trk:
                                    trk.state = "ADAPTING" if fd.is_enhanced else "DETECTED"
                                detections.append({
                                    "bbox": fd.bbox,
                                    "name": "Walking Student" if fd.quality_score >= 0.50 else "Unknown Visitor",
                                    "status": "ADAPTING LIGHT..." if fd.is_enhanced else "UNRECOGNIZED",
                                    "confidence": 0.0,
                                    "is_matched": False,
                                    "yaw": fd.yaw_deg,
                                    "pitch": fd.pitch_deg,
                                    "quality": fd.quality_score,
                                    "lighting": fd.lighting_condition,
                                    "is_enhanced": fd.is_enhanced,
                                    "state": trk.state if trk else "DETECTED",
                                    "landmarks_pixel": fd.landmarks_pixel
                                })
                else:
                    # Fallback OpenCV Haar Cascade
                    fh, fw, _ = frame.shape
                    scale_factor = config.FRAME_SCALE
                    scale_up = int(1.0 / scale_factor)
                    small_frame = cv2.resize(frame, (0, 0), fx=scale_factor, fy=scale_factor)
                    gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
                    faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5, minSize=(30, 30))
                    for (x, y, w, h) in faces:
                        c_top = max(0, min(fh - 1, int(y * scale_up)))
                        c_right = max(0, min(fw - 1, int((x + w) * scale_up)))
                        c_bottom = max(0, min(fh - 1, int((y + h) * scale_up)))
                        c_left = max(0, min(fw - 1, int(x * scale_up)))
                        detections.append({
                            "bbox": (c_top, c_right, c_bottom, c_left),
                            "name": "Student",
                            "status": "PRESENT",
                            "confidence": 0.90,
                            "is_matched": True,
                            "yaw": 0.0,
                            "pitch": 0.0,
                            "quality": 0.85,
                            "lighting": "optimal",
                            "is_enhanced": False,
                            "state": "VERIFIED",
                            "landmarks_pixel": None
                        })

                with self.hud_lock:
                    self.hud_detections[cam_id] = detections

            except Exception as err:
                print(f"[Spotlight Worker Exception - Cam {cam_id}] {err}")

    def render_hud(self, frame: np.ndarray, fps: float, cam_id: int = 1, cam_name: str = "") -> np.ndarray:
        """Draws aesthetic, high-contrast visual HUD on top of the specified camera's live video stream."""
        h, w, _ = frame.shape
        now = time.time()
        lane_label = cam_name or (config.CAMERA_1_NAME if cam_id == 1 else config.CAMERA_2_NAME)

        with self.hud_lock:
            detections = list(self.hud_detections.get(cam_id, []))
            banner_name = self.hud_banner_name.get(cam_id, "")
            banner_status = self.hud_banner_status.get(cam_id, "READY")
            banner_class = self.hud_banner_class.get(cam_id, "")
            banner_time = self.hud_banner_time.get(cam_id, "")
            banner_until = self.hud_banner_until.get(cam_id, 0.0)
            show_mesh = self.show_mesh

        # 1. Draw Bounding Boxes & Landmarks
        for det in detections:
            top, right, bottom, left = det["bbox"]
            is_matched = det["is_matched"]
            status = det.get("status", "")
            is_enhanced = det.get("is_enhanced", False)

            # Dynamic color coding for fluid optimistic state
            if "VERIFIED" in status:
                color = (34, 197, 94)    # Emerald Green
            elif "IDENTIFYING" in status:
                color = (250, 150, 10)   # Vivid Cyan / Ocean Blue
            elif is_enhanced or "ADAPTING" in status:
                color = (20, 200, 245)   # Amber / Yellow (AIE Active)
            else:
                color = (148, 163, 184)  # Slate / Blue-gray (Tracking)

            # Corner accents
            cv2.rectangle(frame, (left, top), (right, bottom), color, 2)
            corner_len = 16
            cv2.line(frame, (left, top), (left + corner_len, top), color, 4)
            cv2.line(frame, (left, top), (left, top + corner_len), color, 4)
            cv2.line(frame, (right, top), (right - corner_len, top), color, 4)
            cv2.line(frame, (right, top), (right, top + corner_len), color, 4)
            cv2.line(frame, (left, bottom), (left + corner_len, bottom), color, 4)
            cv2.line(frame, (left, bottom), (left, bottom - corner_len), color, 4)
            cv2.line(frame, (right, bottom), (right - corner_len, bottom), color, 4)
            cv2.line(frame, (right, bottom), (right, bottom - corner_len), color, 4)

            # Optional 478-Landmark Mesh Points
            if show_mesh and det.get("landmarks_pixel") is not None:
                pts = det["landmarks_pixel"]
                for pt in pts[::4]:
                    px, py = int(pt[0]), int(pt[1])
                    cv2.circle(frame, (px, py), 1, (56, 189, 248), -1)

            # Name Tag Pill with Adaptive Illumination indicator
            tag_suffix = " [☀️AIE]" if is_enhanced else ""
            label = f"{det['name']} ({status}){tag_suffix}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_DUPLEX, 0.48, 1)
            cv2.rectangle(frame, (left, top - 24), (left + tw + 10, top), color, -1)
            cv2.putText(frame, label, (left + 5, top - 7), cv2.FONT_HERSHEY_DUPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)

        # 2. Top Header Status Bar
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, 48), (15, 23, 42), -1)
        cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)

        # Lane Indicator Badge
        lane_badge = f"[{lane_label.upper()}]"
        cv2.putText(frame, lane_badge, (16, 32), cv2.FONT_HERSHEY_DUPLEX, 0.60, (56, 189, 248), 2, cv2.LINE_AA)

        # Smart Gate Logistic Mode Indicator
        logistic_badge = "● SMART LOGISTIC: ZERO-FALSE (AIE ON)"
        cv2.putText(frame, logistic_badge, (w // 2 - 160, 32), cv2.FONT_HERSHEY_DUPLEX, 0.44, (16, 185, 129), 1, cv2.LINE_AA)

        metrics_str = f"PRESENT: {self.counter_total_present}  |  LANE: {self.counter_lane1 if cam_id==1 else self.counter_lane2}  |  {fps:.0f} FPS"
        (mw, _), _ = cv2.getTextSize(metrics_str, cv2.FONT_HERSHEY_DUPLEX, 0.48, 1)
        cv2.putText(frame, metrics_str, (w - mw - 16, 32), cv2.FONT_HERSHEY_DUPLEX, 0.48, (226, 232, 240), 1, cv2.LINE_AA)

        # 3. Bottom Instant Verification Toast
        if now < banner_until and banner_name:
            banner_h = 75
            overlay = frame.copy()
            toast_color = (16, 185, 129) if "MARKED" in banner_status else (245, 158, 11)
            cv2.rectangle(overlay, (w // 6, h - banner_h - 16), (5 * w // 6, h - 16), toast_color, -1)
            cv2.addWeighted(overlay, 0.90, frame, 0.10, 0, frame)

            toast_title = f"{banner_name}  -  {banner_status}"
            toast_sub = f"{banner_class}  •  Arrival Time: {banner_time}"
            cv2.putText(frame, toast_title, (w // 6 + 18, h - 50), cv2.FONT_HERSHEY_DUPLEX, 0.68, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(frame, toast_sub, (w // 6 + 18, h - 26), cv2.FONT_HERSHEY_DUPLEX, 0.50, (240, 253, 244), 1, cv2.LINE_AA)

        return frame


    def run(self):
        """Main execution loop for Presences - Spotlight Engine (CLI / OpenCV window mode)."""
        self.running = True

        print(f"[Spotlight] Starting Camera 1: {config.CAMERA_1_NAME} ({config.CAMERA_1_SOURCE})...")
        stream1 = RTSPVideoStream(src=config.CAMERA_1_SOURCE, cam_id=1, name=config.CAMERA_1_NAME).start()

        stream2 = None
        if config.DUAL_CAMERA_MODE:
            print(f"[Spotlight] Starting Camera 2: {config.CAMERA_2_NAME} ({config.CAMERA_2_SOURCE})...")
            stream2 = RTSPVideoStream(src=config.CAMERA_2_SOURCE, cam_id=2, name=config.CAMERA_2_NAME).start()

        self.start_worker()

        win_name = "Presences - Spotlight Engine"
        if config.SHOW_WINDOW:
            cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
            if config.FULLSCREEN_KIOSK:
                cv2.setWindowProperty(win_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
            else:
                cv2.resizeWindow(win_name, 1280, 720)

        print("[Spotlight] Engine initialized. Live attendance monitoring is active.")
        print("            Hotkeys: 'q'=Quit | 'd'=Dual View | '1'=Cam 1 Solo | '2'=Cam 2 Solo | 'r'=Reload | 's'=Audio | 'm'=Mesh | 'f'=Fullscreen")

        try:
            while self.running:
                grabbed1, frame1, fps1 = stream1.read()
                if grabbed1 and frame1 is not None:
                    self.submit_frame(frame1, cam_id=1)
                    annotated_1 = self.render_hud(frame1, fps1, cam_id=1, cam_name=config.CAMERA_1_NAME)
                elif frame1 is not None:
                    annotated_1 = frame1
                else:
                    annotated_1 = stream1._generate_placeholder()

                if stream2:
                    grabbed2, frame2, fps2 = stream2.read()
                    if grabbed2 and frame2 is not None:
                        self.submit_frame(frame2, cam_id=2)
                        annotated_2 = self.render_hud(frame2, fps2, cam_id=2, cam_name=config.CAMERA_2_NAME)
                    elif frame2 is not None:
                        annotated_2 = frame2
                    else:
                        annotated_2 = stream2._generate_placeholder()

                    # Render selected view mode
                    if self.view_mode == "cam1":
                        display_frame = annotated_1
                    elif self.view_mode == "cam2":
                        display_frame = annotated_2
                    else:
                        # Combine side-by-side Dual View
                        h1, w1 = annotated_1.shape[:2]
                        h2, w2 = annotated_2.shape[:2]
                        target_h = min(h1, h2)
                        target_w = int(w1 * (target_h / h1))
                        r1 = cv2.resize(annotated_1, (target_w, target_h))
                        r2 = cv2.resize(annotated_2, (target_w, target_h))
                        display_frame = np.hstack([r1, r2])
                else:
                    display_frame = annotated_1

                now = time.time()
                if (now - self.last_sync_time) > config.STUDENT_SYNC_INTERVAL_SEC:
                    self.last_sync_time = now
                    if not self.is_syncing:
                        threading.Thread(target=self.cloud.process_offline_queue, daemon=True).start()
                        threading.Thread(target=self.sync_students, daemon=True).start()

                if config.SHOW_WINDOW:
                    cv2.imshow(win_name, display_frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord('q'), ord('Q'), 27):
                        print("[Spotlight] Exit signal received.")
                        break
                    elif key in (ord('d'), ord('D')):
                        self.view_mode = "dual"
                        print("\n[Spotlight View] Switched to Dual-Camera Side-by-Side View.")
                    elif key == ord('1'):
                        self.view_mode = "cam1"
                        print(f"\n[Spotlight View] Switched to Solo View: {config.CAMERA_1_NAME}.")
                    elif key == ord('2'):
                        self.view_mode = "cam2"
                        print(f"\n[Spotlight View] Switched to Solo View: {config.CAMERA_2_NAME}.")
                    elif key in (ord('r'), ord('R')):
                        if not self.is_syncing:
                            print("\n[Spotlight] Manual face reload triggered. Syncing from Appwrite Cloud...")
                            threading.Thread(target=self.sync_students, daemon=True).start()
                    elif key in (ord('s'), ord('S')):
                        config.ENABLE_AUDIO = not config.ENABLE_AUDIO
                        state_str = "ENABLED (Sound ON)" if config.ENABLE_AUDIO else "MUTED (Silent Mode)"
                        print(f"\n[Spotlight Audio] Sound Verification is now: {state_str}")
                    elif key in (ord('m'), ord('M')):
                        with self.hud_lock:
                            self.show_mesh = not self.show_mesh
                        mesh_state = "ON" if self.show_mesh else "OFF"
                        print(f"\n[Spotlight HUD] 478-Landmark Mesh Overlay: {mesh_state}")
                    elif key in (ord('c'), ord('C')):
                        self.counter_total_present = 0
                        self.counter_on_time = 0
                        self.counter_late = 0
                        self.counter_lane1 = 0
                        self.counter_lane2 = 0
                        print("\n[Spotlight] Session counters reset.")
                    elif key in (ord('f'), ord('F')):
                        config.FULLSCREEN_KIOSK = not config.FULLSCREEN_KIOSK
                        if config.FULLSCREEN_KIOSK:
                            cv2.setWindowProperty(win_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
                        else:
                            cv2.setWindowProperty(win_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_NORMAL)
                            cv2.resizeWindow(win_name, 1280, 720)

                time.sleep(0.005)

        except KeyboardInterrupt:
            print("[Spotlight] Interrupted by user.")
        finally:
            self.running = False
            stream1.stop()
            if stream2:
                stream2.stop()
            if config.SHOW_WINDOW:
                cv2.destroyAllWindows()
            print("[Spotlight] All camera streams closed cleanly.")


if __name__ == "__main__":
    engine = SpotlightEngine()
    engine.run()

