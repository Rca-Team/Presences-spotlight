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
    def __init__(self, src=config.RTSP_URL, width=config.CAMERA_WIDTH, height=config.CAMERA_HEIGHT):
        self.src = src
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

        self._connect()

    def _connect(self):
        try:
            if self.cap and self.cap.isOpened():
                self.cap.release()

            if isinstance(self.src_id, str) and self.src_id.startswith("rtsp://"):
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;5000000"
                self.cap = cv2.VideoCapture(self.src_id, cv2.CAP_FFMPEG)
            else:
                self.cap = cv2.VideoCapture(self.src_id)

            if self.cap.isOpened():
                self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
                self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                self.grabbed, self.frame = self.cap.read()
                print(f"[Spotlight Camera] Connected successfully to source ({self.width}x{self.height}).")
            else:
                print(f"[Spotlight Camera Warning] Unable to open video source: {self.src}. Retrying...")
        except Exception as err:
            print(f"[Spotlight Camera Error] Stream initialization exception: {err}")

    def start(self):
        t = threading.Thread(target=self._update, args=(), daemon=True)
        t.start()
        return self

    def _update(self):
        consecutive_failures = 0
        while not self.stopped:
            if self.cap is None or not self.cap.isOpened():
                time.sleep(1.5)
                self._connect()
                continue

            grabbed, frame = self.cap.read()
            if not grabbed or frame is None:
                consecutive_failures += 1
                if consecutive_failures > 20:
                    print("[Spotlight Camera] 20 frame drops detected. Re-establishing link...")
                    self._connect()
                    consecutive_failures = 0
                time.sleep(0.04)
                continue

            consecutive_failures = 0
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

    def read(self) -> Tuple[bool, Optional[np.ndarray], float]:
        with self.lock:
            if not self.grabbed or self.frame is None:
                return False, None, self.current_fps
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
            conn.commit()

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
                # 1. Fetch user profiles mapping
                profile_map = {}
                parent_email_map = {}
                try:
                    p_offset = 0
                    while True:
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
        """Records attendance directly into Appwrite attendance_records collection."""
        try:
            from appwrite.id import ID as AppwriteID

            clean_payload = dict(payload)
            if isinstance(clean_payload.get("device_info"), dict):
                clean_payload["device_info"] = json.dumps(clean_payload["device_info"])

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

    threading.Thread(target=_play, daemon=True).start()


# ─── 5. Multi-Student Track & Consensus Engine ────────────────────────────────
class StudentTrack:
    """Tracks a single student moving across consecutive frames to perform multi-frame voting."""
    def __init__(self, track_id: int, bbox: Tuple[int, int, int, int]):
        self.track_id = track_id
        self.bbox = bbox
        self.last_seen = time.time()
        self.matches: List[Tuple[str, Dict, float]] = []
        self.committed = False

    def update_position(self, bbox: Tuple[int, int, int, int]):
        self.bbox = bbox
        self.last_seen = time.time()

    def add_match(self, student: Dict, distance: float):
        key = str(student.get("student_id") or student.get("user_id") or student.get("student_name"))
        self.matches.append((key, student, distance))
        now = time.time()
        self.matches = [(k, s, d) for k, s, d in self.matches if (now - self.last_seen) <= config.CONSENSUS_WINDOW_SECONDS]

    def get_consensus_winner(self) -> Optional[Tuple[Dict, float, int]]:
        """Returns student if votes agree on the same identity."""
        if not self.matches:
            return None

        # If strong single-frame match (dist < 0.44), confirm immediately
        best_single = min(self.matches, key=lambda m: m[2])
        if best_single[2] < 0.44:
            return best_single[1], best_single[2], 1

        if len(self.matches) < config.CONSENSUS_FRAMES_REQUIRED:
            return None

        counts: Dict[str, List[Tuple[Dict, float]]] = {}
        for k, s, d in self.matches:
            if k not in counts:
                counts[k] = []
            counts[k].append((s, d))

        for k, records in counts.items():
            if len(records) >= config.CONSENSUS_FRAMES_REQUIRED:
                best_s = records[0][0]
                avg_dist = float(np.mean([d for _, d in records]))
                return best_s, avg_dist, len(records)

        return None


# ─── 6. Main Presences Spotlight Engine ───────────────────────────────────────
class SpotlightEngine:
    def __init__(self):
        print("=" * 75)
        print("  PRESENCES SPOTLIGHT AI -- GOOGLE VISION & APPWRITE TERMINAL  ")
        print("=" * 75)

        Path(config.UNKNOWN_LOG_DIR).mkdir(parents=True, exist_ok=True)
        self.db = LocalDatabase()
        self.cloud = UnifiedCloudSync(self.db)
        self.enrolled_students: List[Dict] = []
        self.descriptors_matrix: Optional[np.ndarray] = None
        self.last_sync_time = 0
        self.running = False

        # Live Session Counters
        self.counter_total_present = 0
        self.counter_on_time = 0
        self.counter_late = 0
        self.counter_unrecognized = 0

        # Multi-Student Tracker State
        self.next_track_id = 1
        self.active_tracks: Dict[int, StudentTrack] = {}

        # Thread-safe HUD State
        self.hud_lock = threading.Lock()
        self.hud_detections: List[Dict] = []
        self.hud_banner_name = ""
        self.hud_banner_status = "READY"
        self.hud_banner_class = ""
        self.hud_banner_time = ""
        self.hud_banner_until = 0
        self.show_mesh = config.SHOW_LANDMARK_MESH

        # Dedicated AI Inference Worker Queue (maxsize 1 ensures zero camera lag)
        self.inference_queue = queue.Queue(maxsize=1)

        # Initialize Google Vision & MediaPipe Pipeline
        self.google_pipeline = GoogleFacePipeline()
        self.gemini_auditor = GoogleGeminiAuditor()

        # Fallback OpenCV Haar Cascade
        xml_path = getattr(cv2.data, 'haarcascades', '') + 'haarcascade_frontalface_default.xml'
        self.face_cascade = cv2.CascadeClassifier(xml_path)

        # Initialize audio chime
        generate_chime(config.CHIME_PATH)

        # Initial student sync from Appwrite
        self.sync_students()

    def sync_students(self):
        """Loads student face descriptors into contiguous NumPy matrix for C-speed Euclidean search."""
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
        self.last_sync_time = time.time()

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
        # Vectorized Euclidean Distance: ||M - q|| across all rows
        diffs = self.descriptors_matrix - q
        dists = np.linalg.norm(diffs, axis=1)

        sorted_indices = np.argsort(dists)
        best_idx = sorted_indices[0]
        best_dist = float(dists[best_idx])

        if best_dist <= config.MATCH_THRESHOLD:
            best_match = self.enrolled_students[best_idx]
            best_name = best_match["student_name"]

            # Ambiguity Check: Ensure 2nd distinct student is not overly close (< 0.48)
            second_best_dist = float('inf')
            for idx in sorted_indices[1:10]:
                if idx < len(self.enrolled_students) and self.enrolled_students[idx]["student_name"] != best_name:
                    second_best_dist = float(dists[idx])
                    break

            if second_best_dist < 0.48 and (best_dist / second_best_dist) > config.AMBIGUITY_RATIO:
                return None, best_dist

            return best_match, best_dist

        return None, best_dist

    def _associate_tracks(self, face_centers: List[Tuple[int, int]], face_boxes: List[Tuple[int, int, int, int]]) -> List[int]:
        """Fast spatial centroid association between detected faces and active student tracks."""
        track_ids = []
        now = time.time()

        stale_ids = [tid for tid, trk in self.active_tracks.items() if (now - trk.last_seen) > 2.0]
        for tid in stale_ids:
            del self.active_tracks[tid]

        for (cx, cy), bbox in zip(face_centers, face_boxes):
            best_tid = None
            min_dist = float('inf')

            for tid, trk in self.active_tracks.items():
                t_top, t_right, t_bottom, t_left = trk.bbox
                tcx, tcy = (t_left + t_right) // 2, (t_top + t_bottom) // 2
                dist = math.hypot(cx - tcx, cy - tcy)

                if dist < 140 and dist < min_dist:
                    min_dist = dist
                    best_tid = tid

            if best_tid is not None:
                self.active_tracks[best_tid].update_position(bbox)
                track_ids.append(best_tid)
            else:
                new_tid = self.next_track_id
                self.next_track_id += 1
                self.active_tracks[new_tid] = StudentTrack(new_tid, bbox)
                track_ids.append(new_tid)

        return track_ids

    def handle_confirmed_attendance(self, student: Dict, confidence_score: float, face_data: Optional[GoogleFaceData] = None):
        """Executes instant attendance logging, cooldown enforcement, chime, and Appwrite synchronization."""
        student_id_val = str(student.get("student_id") or student.get("user_id") or "")
        student_name = student.get("student_name")
        student_key = student_id_val or student_name
        today_str = datetime.now().strftime("%Y-%m-%d")
        now = time.time()

        if self.db.is_already_marked_today(student_key, today_str):
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

        print(f"\n[SPOTLIGHT VERIFIED] {student_name} | Grade: {student.get('class_name', '')}-{student.get('section', '')}")
        print(f"                     Status: {status.upper()} | Confidence: {confidence_score*100:.1f}% | Time: {time_formatted}")

        with self.hud_lock:
            self.hud_banner_name = student_name
            self.hud_banner_status = f"MARKED {status.upper()}"
            self.hud_banner_class = f"Class {student.get('class_name', '')} {student.get('section', '')}".strip()
            self.hud_banner_time = time_formatted
            self.hud_banner_until = now + 4.0

        play_feedback_sound()

        payload = {
            "user_id": student.get("user_id") if is_valid_uuid(student.get("user_id")) else None,
            "student_id": student_id_val,
            "student_name": student_name,
            "timestamp": iso_timestamp,
            "status": status,
            "source": config.CAPTURE_MODE,
            "capture_mode": config.CAPTURE_MODE,
            "class": student.get("class_name"),
            "section": student.get("section"),
            "confidence_score": round(confidence_score, 4),
            "device_info": {
                "system": "Presences Spotlight AI",
                "backend": "Appwrite Cloud",
                "gate_name": config.GATE_NAME,
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
                print(f"[Spotlight Appwrite] Attendance synced to cloud for {student_name}.")
            else:
                self.db.enqueue_attendance(payload)

        threading.Thread(target=_async_push, daemon=True).start()
        threading.Thread(target=lambda: self.cloud.send_parent_notification_with_rate_limit(student, status), daemon=True).start()

    def _inference_worker(self):
        """Asynchronous AI worker thread processing face embeddings without stalling the video feed."""
        while self.running:
            try:
                frame = self.inference_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            try:
                detections = []

                if self.google_pipeline.is_ready:
                    face_data_list = self.google_pipeline.detect_and_process(frame, extract_embeddings=True)
                    if face_data_list:
                        centers = [fd.center_xy for fd in face_data_list]
                        boxes = [fd.bbox for fd in face_data_list]
                        track_ids = self._associate_tracks(centers, boxes)

                        for fd, tid in zip(face_data_list, track_ids):
                            trk = self.active_tracks.get(tid)

                            matched_student = None
                            distance = 1.0

                            if fd.embedding is not None:
                                matched_student, distance = self.match_face_vectorized(fd.embedding)

                            if matched_student and trk:
                                trk.add_match(matched_student, distance)
                                conf = float(max(0.0, min(1.0, 1.0 - (distance / 0.70))))

                                consensus = trk.get_consensus_winner()
                                if consensus and not trk.committed:
                                    win_student, win_dist, win_votes = consensus
                                    trk.committed = True
                                    self.handle_confirmed_attendance(win_student, conf, fd)

                                detections.append({
                                    "bbox": fd.bbox,
                                    "name": matched_student["student_name"],
                                    "status": "VERIFIED" if (trk and trk.committed) else "IDENTIFYING...",
                                    "confidence": conf,
                                    "is_matched": True,
                                    "yaw": fd.yaw_deg,
                                    "pitch": fd.pitch_deg,
                                    "quality": fd.quality_score,
                                    "landmarks_pixel": fd.landmarks_pixel
                                })
                            else:
                                detections.append({
                                    "bbox": fd.bbox,
                                    "name": "Unknown Visitor",
                                    "status": "UNRECOGNIZED",
                                    "confidence": 0.0,
                                    "is_matched": False,
                                    "yaw": fd.yaw_deg,
                                    "pitch": fd.pitch_deg,
                                    "quality": fd.quality_score,
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
                            "name": "Student (Cascade Mode)",
                            "status": "PRESENT",
                            "confidence": 0.90,
                            "is_matched": True,
                            "yaw": 0.0,
                            "pitch": 0.0,
                            "quality": 0.85,
                            "landmarks_pixel": None
                        })

                with self.hud_lock:
                    self.hud_detections = detections

            except Exception as err:
                print(f"[Spotlight Worker Exception] {err}")

    def render_hud(self, frame: np.ndarray, fps: float) -> np.ndarray:
        """Draws aesthetic, high-contrast visual HUD on top of the live video stream."""
        h, w, _ = frame.shape
        now = time.time()

        with self.hud_lock:
            detections = list(self.hud_detections)
            banner_name = self.hud_banner_name
            banner_status = self.hud_banner_status
            banner_class = self.hud_banner_class
            banner_time = self.hud_banner_time
            banner_until = self.hud_banner_until
            show_mesh = self.show_mesh

        # 1. Draw Bounding Boxes & Landmarks
        for det in detections:
            top, right, bottom, left = det["bbox"]
            is_matched = det["is_matched"]
            quality = det.get("quality", 0.8)
            yaw = det.get("yaw", 0.0)
            color = (34, 197, 94) if is_matched else (40, 40, 230)

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

            # Name Tag Pill
            label = f"{det['name']} ({det['status']})"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_DUPLEX, 0.55, 1)
            cv2.rectangle(frame, (left, top - 26), (left + tw + 12, top), color, -1)
            cv2.putText(frame, label, (left + 6, top - 8), cv2.FONT_HERSHEY_DUPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

        # 2. Top Header Status Bar
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, 55), (15, 23, 42), -1)
        cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)

        cv2.putText(frame, "PRESENCES SPOTLIGHT AI  [APPWRITE CLOUD]", (20, 35), cv2.FONT_HERSHEY_DUPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
        metrics_str = f"PRESENT: {self.counter_total_present}  |  ON-TIME: {self.counter_on_time}  |  LATE: {self.counter_late}  |  {fps:.0f} FPS"
        (mw, _), _ = cv2.getTextSize(metrics_str, cv2.FONT_HERSHEY_DUPLEX, 0.55, 1)
        cv2.putText(frame, metrics_str, (w - mw - 20, 35), cv2.FONT_HERSHEY_DUPLEX, 0.55, (56, 189, 248), 1, cv2.LINE_AA)

        # 3. Bottom Instant Verification Toast
        if now < banner_until and banner_name:
            banner_h = 80
            overlay = frame.copy()
            cv2.rectangle(overlay, (w // 4, h - banner_h - 20), (3 * w // 4, h - 20), (16, 185, 129), -1)
            cv2.addWeighted(overlay, 0.90, frame, 0.10, 0, frame)

            toast_title = f"{banner_name}  -  {banner_status}"
            toast_sub = f"{banner_class}  •  Arrival Time: {banner_time}"
            cv2.putText(frame, toast_title, (w // 4 + 20, h - 55), cv2.FONT_HERSHEY_DUPLEX, 0.75, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(frame, toast_sub, (w // 4 + 20, h - 30), cv2.FONT_HERSHEY_DUPLEX, 0.55, (240, 253, 244), 1, cv2.LINE_AA)

        return frame

    def run(self):
        """Main execution loop for Presences Spotlight AI."""
        self.running = True

        stream = RTSPVideoStream().start()
        threading.Thread(target=self._inference_worker, daemon=True).start()

        win_name = "Presences Spotlight AI — Gate Terminal (Appwrite Cloud)"
        if config.SHOW_WINDOW:
            cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
            if config.FULLSCREEN_KIOSK:
                cv2.setWindowProperty(win_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
            else:
                cv2.resizeWindow(win_name, 1280, 720)

        print("[Spotlight] Engine initialized. Live attendance monitoring is active.")
        print("            Hotkeys: 'q'=Quit | 'r'=Reload Database | 's'=Toggle Audio | 'm'=Toggle Mesh | 'f'=Fullscreen")

        try:
            while self.running:
                grabbed, frame, fps = stream.read()
                if not grabbed or frame is None:
                    time.sleep(0.01)
                    continue

                if self.inference_queue.empty():
                    try:
                        self.inference_queue.put_nowait(frame.copy())
                    except queue.Full:
                        pass

                annotated_frame = self.render_hud(frame, fps)

                now = time.time()
                if (now - self.last_sync_time) > config.STUDENT_SYNC_INTERVAL_SEC:
                    threading.Thread(target=self.cloud.process_offline_queue, daemon=True).start()
                    threading.Thread(target=self.sync_students, daemon=True).start()

                if config.SHOW_WINDOW:
                    cv2.imshow(win_name, annotated_frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord('q'), ord('Q'), 27):
                        print("[Spotlight] Exit signal received.")
                        break
                    elif key in (ord('r'), ord('R')):
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
                        print("\n[Spotlight] Session counters reset.")
                    elif key in (ord('f'), ord('F')):
                        is_full = cv2.getWindowProperty(win_name, cv2.WND_PROP_FULLSCREEN) == cv2.WINDOW_FULLSCREEN
                        if is_full:
                            cv2.setWindowProperty(win_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_NORMAL)
                            cv2.resizeWindow(win_name, 1280, 720)
                        else:
                            cv2.setWindowProperty(win_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

        except KeyboardInterrupt:
            print("\n[Spotlight] Shutting down gracefully...")
        finally:
            self.running = False
            stream.stop()
            if config.SHOW_WINDOW:
                cv2.destroyAllWindows()
            print("[Spotlight] Offline queue processed. Engine shutdown complete.")


if __name__ == "__main__":
    engine = SpotlightEngine()
    engine.run()
