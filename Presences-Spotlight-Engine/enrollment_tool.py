"""
Presences Spotlight AI — Multi-Angle Student Face Enrollment Station (Google Pipeline Edition)
High-Accuracy 3D-Guided Multi-Angle Enrollment (Frontal, Left 15°, Right 15°) with Canonical Affine Alignment
"""

import os
import sys
import json
import time
import uuid
import requests
import cv2
import numpy as np

import config
from google_pipeline import GoogleFacePipeline, GoogleFaceData

APPWRITE_SDK_AVAILABLE = False
try:
    from appwrite.client import Client as AppwriteClient
    from appwrite.services.databases import Databases as AppwriteDatabases
    from appwrite.id import ID as AppwriteID
    APPWRITE_SDK_AVAILABLE = True
except ImportError:
    pass


class FaceEnrollmentStation:
    def __init__(self):
        self.url = config.SUPABASE_URL.rstrip('/')
        self.key = config.SUPABASE_KEY
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        self.pipeline = GoogleFacePipeline()
        self.appwrite_db = None

        if APPWRITE_SDK_AVAILABLE and config.APPWRITE_PROJECT_ID:
            try:
                client = AppwriteClient()
                client.set_endpoint(config.APPWRITE_ENDPOINT)
                client.set_project(config.APPWRITE_PROJECT_ID)
                if config.APPWRITE_API_KEY:
                    client.set_key(config.APPWRITE_API_KEY)
                self.appwrite_db = AppwriteDatabases(client)
                print(f"[Enrollment] Connected to Appwrite Project {config.APPWRITE_PROJECT_ID[:6]}...")
            except Exception as e:
                print(f"[Enrollment Appwrite Warning] {e}")

    def enroll_student_live(self):
        print("\n" + "=" * 70)
        print("  📸 PRESENCES SPOTLIGHT AI — GOOGLE 3D-GUIDED ENROLLMENT STATION")
        print("=" * 70)

        student_name = input("Enter Student Full Name: ").strip()
        if not student_name:
            print("Name cannot be empty.")
            return

        student_id = input("Enter Roll Number / Student ID: ").strip()
        class_name = input("Enter Class / Grade (e.g. 10): ").strip()
        section = input("Enter Section (e.g. A): ").strip()

        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("Error: Could not open camera device 0.")
            return

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

        steps = [
            {
                "title": "Step 1: Look STRAIGHT at camera (Frontal)",
                "target_yaw": 0.0,
                "yaw_tol": 7.0,
                "key": "frontal"
            },
            {
                "title": "Step 2: Turn head SLIGHTLY LEFT (~15 degrees)",
                "target_yaw": -15.0,
                "yaw_tol": 6.0,
                "key": "left_15"
            },
            {
                "title": "Step 3: Turn head SLIGHTLY RIGHT (~15 degrees)",
                "target_yaw": 15.0,
                "yaw_tol": 6.0,
                "key": "right_15"
            }
        ]

        captured_embeddings = []
        win_name = f"Presences AI Enrollment — {student_name}"
        cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(win_name, 1024, 600)

        for step_idx, step in enumerate(steps):
            print(f"\n[{step_idx+1}/3] {step['title']}")
            captured = False
            target_yaw = step["target_yaw"]
            yaw_tol = step["yaw_tol"]

            while not captured:
                ret, frame = cap.read()
                if not ret or frame is None:
                    time.sleep(0.01)
                    continue

                display = frame.copy()
                h, w, _ = display.shape

                # Process frame with Google MediaPipe Face Landmarker
                results = self.pipeline.detect_and_process(frame, extract_embeddings=True)

                is_in_pose = False
                detected_fd: Optional[GoogleFaceData] = None

                if results:
                    # Pick the largest / most prominent face
                    detected_fd = max(results, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[1] - f.bbox[3]))
                    top, right, bottom, left = detected_fd.bbox
                    yaw = detected_fd.yaw_deg
                    pitch = detected_fd.pitch_deg
                    sharpness = detected_fd.sharpness_score
                    quality = detected_fd.quality_score

                    # Check pose condition
                    yaw_diff = abs(yaw - target_yaw)
                    is_in_pose = (yaw_diff <= yaw_tol) and (sharpness >= config.MIN_SHARPNESS_LAPLACIAN)

                    color = (34, 197, 94) if is_in_pose else (56, 189, 248)  # Green when aligned, Cyan when adjusting

                    # Draw face box
                    cv2.rectangle(display, (left, top), (right, bottom), color, 2)

                    # Sub-badge with live pose
                    pose_txt = f"Yaw: {yaw:+.1f} deg (Target: {target_yaw:+.0f}) | Quality: {int(quality*100)}%"
                    cv2.rectangle(display, (left, bottom + 5), (left + 340, bottom + 32), (15, 23, 42), -1)
                    cv2.putText(display, pose_txt, (left + 8, bottom + 24), cv2.FONT_HERSHEY_DUPLEX, 0.45, color, 1, cv2.LINE_AA)

                    # Draw 5 anchor points
                    for pt in detected_fd.landmarks_5pts:
                        px, py = int(pt[0]), int(pt[1])
                        cv2.circle(display, (px, py), 3, (244, 114, 182), -1)

                # Header Overlay
                cv2.rectangle(display, (0, 0), (w, 60), (15, 23, 42), -1)
                cv2.putText(display, f"ENROLLMENT FOR: {student_name.upper()}  ({student_id})", (20, 26), cv2.FONT_HERSHEY_DUPLEX, 0.60, (255, 255, 255), 1, cv2.LINE_AA)
                cv2.putText(display, step["title"], (20, 48), cv2.FONT_HERSHEY_DUPLEX, 0.55, (56, 189, 248), 1, cv2.LINE_AA)

                # Bottom Instructions
                status_color = (34, 197, 94) if is_in_pose else (200, 200, 200)
                status_msg = "PRESS SPACE TO CAPTURE (Angle Perfect!)" if is_in_pose else "Adjust head angle until gauge turns GREEN... Press SPACE"
                cv2.rectangle(display, (0, h - 45), (w, h), (15, 23, 42), -1)
                cv2.putText(display, status_msg, (20, h - 16), cv2.FONT_HERSHEY_DUPLEX, 0.55, status_color, 1, cv2.LINE_AA)

                cv2.imshow(win_name, display)
                key = cv2.waitKey(1) & 0xFF

                if key == ord(' '):
                    if detected_fd and detected_fd.embedding is not None:
                        captured_embeddings.append(detected_fd.embedding.tolist())
                        print(f"✅ Successfully captured {step['key']} vector (Yaw: {detected_fd.yaw_deg:+.1f}°, Quality: {detected_fd.quality_score*100:.0f}%).")
                        captured = True
                    else:
                        print("⚠️ No valid face embedding found in this frame. Please hold steady and press SPACE again.")
                    time.sleep(0.3)

                elif key in (ord('q'), 27):
                    print("Enrollment cancelled by operator.")
                    cap.release()
                    cv2.destroyAllWindows()
                    return

        cap.release()
        cv2.destroyAllWindows()

        if len(captured_embeddings) == 3:
            print(f"\n[Cloud Upload] Uploading 3 multi-angle models for {student_name}...")
            payload = {
                "student_id": student_id,
                "student_name": student_name,
                "class": class_name,
                "section": section,
                "descriptor": captured_embeddings[0],
                "descriptors": captured_embeddings,
                "label": student_name,
                "metadata": {
                    "source": "google-mediapipe-3d-guided",
                    "angles_count": 3,
                    "pipeline": "Google MediaPipe 478 3D Mesh",
                    "created_at": time.time()
                }
            }

            uploaded = False
            if self.appwrite_db:
                try:
                    appwrite_payload = dict(payload)
                    appwrite_payload["descriptor"] = json.dumps(captured_embeddings[0])
                    appwrite_payload["descriptors"] = json.dumps(captured_embeddings)
                    appwrite_payload["metadata"] = json.dumps(payload["metadata"])
                    self.appwrite_db.create_document(
                        database_id=config.APPWRITE_DATABASE_ID,
                        collection_id='face_descriptors',
                        document_id=AppwriteID.unique(),
                        data=appwrite_payload
                    )
                    print(f"🎉 SUCCESS! {student_name} enrolled successfully into Appwrite Cloud!")
                    uploaded = True
                except Exception as err:
                    print(f"[Appwrite Note] {err}")

            if not uploaded:
                try:
                    res = requests.post(f"{self.url}/rest/v1/face_descriptors", headers=self.headers, json=payload, timeout=10)
                    if res.status_code in (200, 201):
                        print(f"🎉 SUCCESS! {student_name} enrolled successfully into Supabase Cloud!")
                    else:
                        print(f"Cloud response ({res.status_code}): {res.text}")
                except Exception as e:
                    print(f"Upload error: {e}")


if __name__ == "__main__":
    station = FaceEnrollmentStation()
    station.enroll_student_live()
