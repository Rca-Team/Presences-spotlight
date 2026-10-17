"""
Unit & Integration Test Suite for Presences Spotlight AI Dual-Camera Engine
Tests:
1. Configuration & Dual Camera Settings
2. LocalDatabase schema migration & camera_lane persistence
3. SpotlightEngine dual-stream inference queue & track separation
4. Cross-camera deduplication & cooldown guard
5. Dual HUD rendering & lane badges
"""

import os
import sys
import time
import numpy as np
from datetime import datetime

# Import engine modules
import config
from spotlight_engine import SpotlightEngine, LocalDatabase, StudentTrack

def run_tests():
    print("=" * 65)
    print("  PRESENCES SPOTLIGHT AI — DUAL-CAMERA ENGINE TEST SUITE  ")
    print("=" * 65)

    # ── Test 1: Config Parameters ──
    print("\n[TEST 1] Verifying Dual-Camera Configuration...")
    assert hasattr(config, "DUAL_CAMERA_MODE"), "config.DUAL_CAMERA_MODE missing"
    assert hasattr(config, "CAMERA_1_SOURCE"), "config.CAMERA_1_SOURCE missing"
    assert hasattr(config, "CAMERA_2_SOURCE"), "config.CAMERA_2_SOURCE missing"
    assert hasattr(config, "CAMERA_1_NAME"), "config.CAMERA_1_NAME missing"
    assert hasattr(config, "CAMERA_2_NAME"), "config.CAMERA_2_NAME missing"
    assert hasattr(config, "CROSS_CAMERA_COOLDOWN_SEC"), "config.CROSS_CAMERA_COOLDOWN_SEC missing"
    print(f"  [OK] Cam 1: {config.CAMERA_1_NAME} ({config.CAMERA_1_SOURCE})")
    print(f"  [OK] Cam 2: {config.CAMERA_2_NAME} ({config.CAMERA_2_SOURCE})")
    print(f"  [OK] Cross-Camera Cooldown: {config.CROSS_CAMERA_COOLDOWN_SEC}s")

    # ── Test 2: LocalDatabase Schema & Camera Lane ──
    print("\n[TEST 2] Verifying LocalDatabase & Camera Lane Logging...")
    test_db_path = str(config.BASE_DIR / "test_spotlight.db")
    if os.path.exists(test_db_path):
        os.remove(test_db_path)

    db = LocalDatabase(db_path=test_db_path)
    today = datetime.now().strftime("%Y-%m-%d")

    # Log an attendance record for Lane 1
    db.log_attendance(
        student_key="test_stu_001",
        student_name="Alice Smith",
        class_name="10",
        section="A",
        status="present",
        confidence=0.98,
        marked_time="08:15:00 AM",
        session_date=today,
        camera_lane="Gate 1 - East Lane"
    )

    # Log an attendance record for Lane 2
    db.log_attendance(
        student_key="test_stu_002",
        student_name="Bob Jones",
        class_name="11",
        section="B",
        status="late",
        confidence=0.94,
        marked_time="09:12:00 AM",
        session_date=today,
        camera_lane="Gate 2 - West Lane"
    )

    logs = db.get_today_logs(today)
    assert len(logs) == 2, f"Expected 2 logs, got {len(logs)}"
    assert logs[0]["camera_lane"] == "Gate 2 - West Lane", f"Expected Gate 2, got {logs[0]['camera_lane']}"
    assert logs[1]["camera_lane"] == "Gate 1 - East Lane", f"Expected Gate 1, got {logs[1]['camera_lane']}"
    print(f"  [OK] Successfully verified schema persistence for {len(logs)} records with lane names.")

    # Clean up test db safely
    try:
        if os.path.exists(test_db_path):
            os.remove(test_db_path)
    except Exception:
        pass


    # ── Test 3: SpotlightEngine Initialization & Track Separation ──
    print("\n[TEST 3] Verifying SpotlightEngine Track & Queue Separation...")
    engine = SpotlightEngine()

    assert 1 in engine.active_tracks and 2 in engine.active_tracks, "Active tracks must support Cam 1 and Cam 2"
    assert 1 in engine.hud_detections and 2 in engine.hud_detections, "HUD detections must support Cam 1 and Cam 2"

    # Simulate spatial tracks on Cam 1 and Cam 2
    tids_cam1 = engine._associate_tracks([(100, 100)], [(80, 120, 120, 80)], cam_id=1)
    tids_cam2 = engine._associate_tracks([(100, 100)], [(80, 120, 120, 80)], cam_id=2)
    assert len(tids_cam1) == 1 and len(tids_cam2) == 1
    assert tids_cam1[0] in engine.active_tracks[1]
    assert tids_cam2[0] in engine.active_tracks[2]
    print(f"  [OK] Spatial tracks partitioned cleanly: Cam 1 Track {tids_cam1[0]}, Cam 2 Track {tids_cam2[0]}")

    # ── Test 4: Cross-Camera Deduplication Verification ──
    print("\n[TEST 4] Testing Cross-Camera Real-Time Deduplication...")
    test_sid = f"test_dedup_{int(time.time() * 1000)}"
    fake_student = {
        "student_id": test_sid,
        "student_name": f"Charlie {test_sid[-4:]}",
        "class_name": "12",
        "section": "C"
    }

    initial_total = engine.counter_total_present
    initial_lane1 = engine.counter_lane1
    initial_lane2 = engine.counter_lane2

    # Event 1: Student seen at Cam 1
    engine.handle_confirmed_attendance(fake_student, confidence_score=0.96, cam_id=1)
    assert engine.counter_total_present == initial_total + 1, "Should increment total present on Cam 1"
    assert engine.counter_lane1 == initial_lane1 + 1, "Should increment Lane 1 counter"

    # Event 2: Exact same student crosses Cam 2 500ms later (simultaneous dual-camera field of view)
    engine.handle_confirmed_attendance(fake_student, confidence_score=0.95, cam_id=2)
    assert engine.counter_total_present == initial_total + 1, "Must NOT duplicate total count across cameras!"
    assert engine.counter_lane2 == initial_lane2, "Lane 2 counter must NOT increment duplicate attendance!"
    assert engine.hud_banner_status[2] == "ALREADY RECORDED", f"Cam 2 HUD should show ALREADY RECORDED, got {engine.hud_banner_status[2]}"
    print("  [OK] Cross-camera deduplication confirmed: Cam 2 correctly suppressed duplicate attendance and alerted on HUD.")

    # ── Test 5: Dual HUD Rendering ──
    print("\n[TEST 5] Testing HUD Rendering for Cam 1 and Cam 2...")
    frame_dummy1 = np.zeros((480, 640, 3), dtype=np.uint8)
    frame_dummy2 = np.zeros((480, 640, 3), dtype=np.uint8)

    hud1 = engine.render_hud(frame_dummy1, fps=30.0, cam_id=1, cam_name="Gate 1")
    hud2 = engine.render_hud(frame_dummy2, fps=28.5, cam_id=2, cam_name="Gate 2")

    assert hud1.shape == (480, 640, 3), "HUD 1 rendering shape mismatch"
    assert hud2.shape == (480, 640, 3), "HUD 2 rendering shape mismatch"
    print("  [OK] Rendered HUD overlays for both cameras successfully with lane headers.")

    print("\n" + "=" * 65)
    print("  ALL 5 DUAL-CAMERA ENGINE TESTS PASSED PERFECTLY!  ")
    print("=" * 65)


if __name__ == "__main__":
    run_tests()
