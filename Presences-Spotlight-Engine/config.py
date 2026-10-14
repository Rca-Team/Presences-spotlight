import os
from pathlib import Path
from dotenv import load_dotenv

# Base directory for spotlight edge engine
BASE_DIR = Path(__file__).resolve().parent

# Load .env file from the current directory or parent directories
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")
load_dotenv(BASE_DIR.parent.parent / ".env")

# ─── 1. Google Vision Pipeline & MediaPipe Configuration ──────────────────────
VISION_PIPELINE = os.getenv("VISION_PIPELINE", "mediapipe").lower()

# Google MediaPipe Task Model Path (auto-downloaded if missing)
GOOGLE_MODEL_PATH = str(BASE_DIR / "face_landmarker.task")
GOOGLE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"

# MediaPipe Confidence Thresholds
GOOGLE_DETECTION_CONFIDENCE = float(os.getenv("GOOGLE_DETECTION_CONFIDENCE", "0.50"))
GOOGLE_PRESENCE_CONFIDENCE = float(os.getenv("GOOGLE_PRESENCE_CONFIDENCE", "0.50"))
GOOGLE_TRACKING_CONFIDENCE = float(os.getenv("GOOGLE_TRACKING_CONFIDENCE", "0.50"))
MAX_FACES_TO_DETECT = int(os.getenv("MAX_FACES_TO_DETECT", "10"))

# Canonical 5-Point Affine Face Alignment (Standardizes scale, tilt, rotation to 112x112)
ENABLE_CANONICAL_ALIGNMENT = os.getenv("ENABLE_CANONICAL_ALIGNMENT", "true").lower() in ("true", "1", "yes")

# Adaptive Illumination & Quality Normalization (AIE - Backlight, Shadow & Glare Fix)
ENABLE_ADAPTIVE_ILLUMINATION = os.getenv("ENABLE_ADAPTIVE_ILLUMINATION", "true").lower() in ("true", "1", "yes")
ENABLE_MOTION_BLUR_FILTER = os.getenv("ENABLE_MOTION_BLUR_FILTER", "true").lower() in ("true", "1", "yes")
MIN_QUALITY_FOR_ENCODING = float(os.getenv("MIN_QUALITY_FOR_ENCODING", "0.45"))

# 3D Head Pose Filtering (Tolerates normal walk-through head turns)
ENABLE_POSE_FILTER = os.getenv("ENABLE_POSE_FILTER", "false").lower() in ("true", "1", "yes")
MAX_POSE_YAW_DEG = float(os.getenv("MAX_POSE_YAW_DEG", "45.0"))
MAX_POSE_PITCH_DEG = float(os.getenv("MAX_POSE_PITCH_DEG", "35.0"))

# Face Quality Gate (Tolerant for typical school webcams and PoE bullet cameras)
MIN_SHARPNESS_LAPLACIAN = float(os.getenv("MIN_SHARPNESS_LAPLACIAN", "15.0"))
MIN_FACE_SIZE_PX = int(os.getenv("MIN_FACE_SIZE_PX", "50"))

# Anti-Spoofing & Liveness Guard (Eye Aspect Ratio EAR + 3D Mesh Depth check)
ENABLE_LIVENESS_GUARD = os.getenv("ENABLE_LIVENESS_GUARD", "false").lower() in ("true", "1", "yes")
MIN_EYE_ASPECT_RATIO = float(os.getenv("MIN_EYE_ASPECT_RATIO", "0.12"))

# Optional Google Gemini Vision Audit
ENABLE_GEMINI_AUDIT = os.getenv("ENABLE_GEMINI_AUDIT", "false").lower() in ("true", "1", "yes")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", os.getenv("VITE_GEMINI_API_KEY", ""))
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


# ─── 2. Cloud Backend Configuration (Appwrite Cloud Native) ───────────────────
BACKEND_TYPE = os.getenv("BACKEND_TYPE", "appwrite").lower()

# Appwrite Official Cloud Backend Configuration
APPWRITE_ENDPOINT = os.getenv("APPWRITE_ENDPOINT", os.getenv("VITE_APPWRITE_ENDPOINT", "https://sgp.cloud.appwrite.io/v1")).rstrip('/')
APPWRITE_PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID", os.getenv("VITE_APPWRITE_PROJECT_ID", "6accbd5d00053c5c1ac2"))
APPWRITE_API_KEY = os.getenv("APPWRITE_API_KEY", "")
APPWRITE_DATABASE_ID = os.getenv("APPWRITE_DATABASE_ID", os.getenv("VITE_APPWRITE_DATABASE_ID", "presences_db"))
APPWRITE_BUCKET_ID = os.getenv("APPWRITE_BUCKET_ID", "face-images")

# Resend Direct Parent Email Notification
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")

# Fallback Supabase Configuration (if legacy fallback ever needed)
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip('/')
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")


# ─── 3. Camera & Video Stream Settings ────────────────────────────────────────
# Dual Camera Configuration for simultaneous real-time monitoring
DUAL_CAMERA_MODE = os.getenv("DUAL_CAMERA_MODE", "true").lower() in ("true", "1", "yes")

# Camera 1 (Default: Primary Gate / Lane 1, USB index 0 or RTSP URL)
CAMERA_1_SOURCE = os.getenv("CAMERA_1_SOURCE", os.getenv("RTSP_URL", "0"))
CAMERA_1_NAME = os.getenv("CAMERA_1_NAME", "Lane 1 - Gate A")

# Camera 2 (Default: Secondary Gate / Lane 2, USB index 1 or RTSP URL)
CAMERA_2_SOURCE = os.getenv("CAMERA_2_SOURCE", "1")
CAMERA_2_NAME = os.getenv("CAMERA_2_NAME", "Lane 2 - Gate B")

# Fallback alias for backward compatibility
RTSP_URL = CAMERA_1_SOURCE

CAMERA_WIDTH = int(os.getenv("CAMERA_WIDTH", "1280"))
CAMERA_HEIGHT = int(os.getenv("CAMERA_HEIGHT", "720"))
TARGET_FPS = int(os.getenv("TARGET_FPS", "30"))

# Downscale factor for real-time face detection on CPU/GPU (0.5 = 640x360 for detection, then full res for embedding)
FRAME_SCALE = float(os.getenv("FRAME_SCALE", "0.5"))

# Cross-camera deduplication cooldown in seconds (prevents double marks when student crosses both camera angles)
CROSS_CAMERA_COOLDOWN_SEC = int(os.getenv("CROSS_CAMERA_COOLDOWN_SEC", "45"))



# ─── 4. Recognition & Anti-False Attendance Safeguards ───────────────────────
# Euclidean distance threshold (0.50 is the optimal threshold for Face-API.js / dlib 128-D vectors)
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.50"))

# Ambiguity Ratio: If best_distance / second_best_distance > 0.88, flag as ambiguous to prevent misidentifying similar students
AMBIGUITY_RATIO = float(os.getenv("AMBIGUITY_RATIO", "0.88"))

# Ambiguity Margin Delta: Absolute separation required between top candidate and runner-up candidate
AMBIGUITY_MARGIN_DELTA = float(os.getenv("AMBIGUITY_MARGIN_DELTA", "0.08"))

# Strict Zero False Mode: Enforces mandatory multi-frame consensus and margin checks
STRICT_ZERO_FALSE_MODE = os.getenv("STRICT_ZERO_FALSE_MODE", "true").lower() in ("true", "1", "yes")

# Multi-Frame Consensus: 2 frames minimum across walking trajectory
CONSENSUS_FRAMES_REQUIRED = int(os.getenv("CONSENSUS_FRAMES_REQUIRED", "2"))
CONSENSUS_WINDOW_SECONDS = float(os.getenv("CONSENSUS_WINDOW_SECONDS", "2.0"))


# ─── 5. Attendance & Cutoff Timings ───────────────────────────────────────────
# Cooldown seconds: Prevent marking the same student repeatedly during the arrival session (default: 60s)
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "60"))

# Morning Cutoff Time (24-Hour Format) for On-Time vs Late
CUTOFF_HOUR = int(os.getenv("CUTOFF_HOUR", "9"))
CUTOFF_MINUTE = int(os.getenv("CUTOFF_MINUTE", "0"))

# Sync interval in seconds to refresh enrolled students from Appwrite Cloud (e.g. every 5 min)
STUDENT_SYNC_INTERVAL_SEC = int(os.getenv("STUDENT_SYNC_INTERVAL_SEC", "300"))

# Gate & Device Info
GATE_NAME = os.getenv("GATE_NAME", "Main Building Gate - Spotlight 1")
CAPTURE_MODE = "spotlight-gate"


# ─── 6. Display & Audio Interface ─────────────────────────────────────────────
SHOW_WINDOW = os.getenv("SHOW_WINDOW", "true").lower() in ("true", "1", "yes")
FULLSCREEN_KIOSK = os.getenv("FULLSCREEN_KIOSK", "false").lower() in ("true", "1", "yes")
# Audio verification (Set to False for silent operation)
ENABLE_AUDIO = os.getenv("ENABLE_AUDIO", "false").lower() in ("true", "1", "yes")
# Toggle 478-Landmark wireframe mesh overlay by default
SHOW_LANDMARK_MESH = os.getenv("SHOW_LANDMARK_MESH", "false").lower() in ("true", "1", "yes")

# Local Storage
DB_PATH = str(BASE_DIR / "spotlight_local.db")
CHIME_PATH = str(BASE_DIR / "spotlight_chime.wav")
UNKNOWN_LOG_DIR = str(BASE_DIR / "unrecognized_snapshots")
